// POST /api/v1/boosts/ingest — index a boost note the moment it is published.
//
// Body: { event, episode?: { title?, showTitle? } }
//   `event`   the signed kind-1 boost note, exactly as it was published;
//   `episode` display hints for a STUB row, used only when D1 has no row for
//             the episode (or show) the note names. Unverified, and replaced
//             wholesale by the collector on its next tick.
//
// ── Why this exists ──────────────────────────────────────────────────────────
//
// Everything the site shows comes out of D1, and D1 is fed by the collector on
// a timer (two minutes since 2026-09-06, five before): scan the relays, resolve
// guids, dedupe, enrich from Podcast Index, push the delta. So a boost sent
// from THIS site took anywhere from seconds to several minutes to appear on it. This endpoint is
// the second sink for the site's own boosts: the widget publishes the note to
// the relays, and when at least one relay acks it, hands the same event here,
// and the row is on the feeds before the modal closes.
//
// ⚠️ THE COLLECTOR REMAINS THE SOURCE OF TRUTH; WHAT IS WRITTEN HERE IS
// PROVISIONAL. Three properties of the collector's delta make that safe:
//
//   - its boost insert is keyed on the Nostr event id, so the row it writes
//     for this note collides with the one written here and the boost is never
//     counted twice;
//   - its podcast and episode projections are `INSERT OR REPLACE` from its own
//     database, so every aggregate recomputed here, and every stub row built
//     from the hints, is overwritten by the collector's authoritative version
//     within one cycle;
//   - every row this endpoint writes is recorded in `boosts_edge`, so the
//     collector can tell an edge-written row from its own: it replaces those
//     rather than ignoring them (its parse, guid canonicalization and client
//     classification win), and it sweeps any that never turn up on a relay.
//
// The collector-side half of that contract lives in
// `bots/global-boost-scan/d1_sync.py`; the table is in `d1/schema.sql`.
//
// ⚠️ THE TRUST LEVEL IS UNCHANGED FROM THE COLLECTOR'S. Anyone may already
// publish a boost note from a burner key and be indexed by the scan; this
// endpoint removes the wait, not the requirement. What it holds a submission
// to is the same shape the site's own signing oracle would sign — the note's
// signature has to verify, and `validateBoostTemplate` (imported from
// `sign-boost.js`, not restated) has to accept it — so it cannot be used to
// index a note the site could not have produced. A fabricated note is no more
// possible here than on Nostr, and `excludes.json` answers it the same way.
//
// ⚠️ THIS IS A MONEY-ADJACENT WRITE AND MUST NEVER BE CACHED. It is a POST, so
// the service worker's fetch handler ignores it (`request.method !== 'GET'`),
// and the response is `no-store` regardless.
//
// ⚠️ NO EPISODE METADATA IS FETCHED HERE. The stub carries the title the widget
// already had and nothing else; artwork falls back to the show's through the
// same chain every row uses (`e_image || p_image` in BOOST_SELECT), and the
// date, duration, enclosure and shownotes arrive with the collector's enrich.
// Asking Podcast Index from the edge would be a second enricher disagreeing
// with the first.
import { corsHeaders, preflight } from "../_common.js";
import { validateBoostTemplate } from "../../sign-boost.js";
import { verifyEvent, nip19 } from "../../../_shared/nostr-sign.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// ── Constants ────────────────────────────────────────────────────────────────

// How far a note's created_at may sit from the clock. Wider than the oracle's
// ±5 minutes because the note is SIGNED before the payment runs (the presigned
// path in ExternalBoostModal) and reaches here after it settles; an UNCERTAIN
// leg can hold that for minutes. Anything older is left to the collector,
// which accepts any date at all.
export const INGEST_SKEW_SECS = 15 * 60;

// The collector's slug for both of this site's publish paths (bot-signed and
// donor-signed) — `clients.py` maps the bot's pubkey and the `onlyboosts.social`
// client tag to it. ⚠️ RESTATED: a Function cannot import from the collector.
const CLIENT_ID = "onlyboosts";
const CLIENT_TAG = "onlyboosts.social";

// Display hints are capped; a title longer than this is not a title.
const MAX_TITLE = 300;

// Same shape as the oracle's limiter, its own counter. A boost that went the
// bot route has already spent one signing call; this must not spend a second
// of the same five. Friction, not a security boundary — see sign-boost.js.
const RATE_LIMIT = 10;
const RATE_WINDOW_SECS = 60;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

// ── Helpers ──────────────────────────────────────────────────────────────────

function reply(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}

/** Fixed-window counter in KV, keyed on the caller's address. Exported for the
 *  test, which is the only way to exercise the boundary without waiting. */
export async function overRateLimit(kv, ip, now = Date.now()) {
  const window = Math.floor(now / 1000 / RATE_WINDOW_SECS);
  const key = `ingest:${ip}:${window}`;
  const current = Number(await kv.get(key)) || 0;
  if (current >= RATE_LIMIT) return true;
  await kv.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECS * 2 });
  return false;
}

function hint(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  return s.length > MAX_TITLE ? s.slice(0, MAX_TITLE) : s;
}

/**
 * Read the boost row out of a verified, validated event.
 *
 * ⚠️ MIRRORS `classify_boost` IN `bots/global-boost-scan/classify.py` for the
 * one shape this endpoint accepts: the `i` tags name the show and the item
 * (third element, when present, is the item's URL), the sats are the `amount`
 * tag rounded from millisats, and the message is the content verbatim. The
 * collector's other amount sources (zap receipts, prose) and its Fountain
 * trailer strip never apply to a note this site built, so they are not
 * reproduced here; if the collector ever disagrees with a row written here,
 * its replace wins.
 */
export function boostRowFromEvent(event) {
  let podcastGuid = null, itemGuid = null, itemUrl = null;
  for (const t of event.tags) {
    if (t[0] !== "i" || typeof t[1] !== "string") continue;
    const url = typeof t[2] === "string" && t[2] ? t[2] : null;
    if (t[1].startsWith("podcast:item:guid:")) {
      itemGuid = t[1].slice("podcast:item:guid:".length);
      itemUrl = url;
    } else if (t[1].startsWith("podcast:guid:")) {
      podcastGuid = t[1].slice("podcast:guid:".length);
    }
  }
  // The validator guarantees exactly one `amount`, plain digits, > 0.
  const msat = Number(event.tags.find((t) => t[0] === "amount")[1]);
  const client = event.tags.find((t) => t[0] === "client")?.[1] ?? null;
  return {
    event_id: event.id,
    booster_pubkey: event.pubkey,
    booster_npub: nip19.npubEncode(event.pubkey),
    created_at: event.created_at,
    sats: Math.round(msat / 1000),
    amount_source: "amount_tag",
    podcast_guid: podcastGuid || null,
    item_guid: itemGuid || null,
    item_url: itemUrl,
    client,
    client_id: CLIENT_ID,
    client_via: null,
    message: event.content,
  };
}

/**
 * Everything a submission has to be before it is written. Throws with a
 * caller-facing message; none of them echo the input.
 *
 * Order matters: the cheap structural checks first, the signature second (it
 * is the one expensive step and it is what makes the pubkey a claim rather
 * than a field), the template validator third — it reads the tags, and reading
 * them off an unverified event would be validating a forgery's shape.
 */
export function validateSubmission(body) {
  if (!body || typeof body !== "object") throw new Error("bad request");
  const ev = body.event;
  if (!ev || typeof ev !== "object") throw new Error("missing event");
  if (ev.kind !== 1) throw new Error("only kind 1 boost notes are indexed");
  if (typeof ev.id !== "string" || !HEX64.test(ev.id)) throw new Error("invalid id");
  if (typeof ev.pubkey !== "string" || !HEX64.test(ev.pubkey)) throw new Error("invalid pubkey");
  if (typeof ev.sig !== "string" || !HEX128.test(ev.sig)) throw new Error("invalid signature");
  if (!Number.isInteger(ev.created_at)) throw new Error("invalid created_at");
  if (typeof ev.content !== "string" || !Array.isArray(ev.tags)) throw new Error("invalid event");

  let verified = false;
  try { verified = verifyEvent(ev); } catch { verified = false; }
  if (!verified) throw new Error("signature does not verify");

  // The oracle's own allowlist, with the wider clock window. A note it would
  // not sign is a note this endpoint does not index.
  validateBoostTemplate(ev, { skewSecs: INGEST_SKEW_SECS });

  const client = ev.tags.find((t) => t[0] === "client")?.[1];
  if (client !== CLIENT_TAG) throw new Error("not this site's note");

  const row = boostRowFromEvent(ev);
  // The aggregates hang off the show. A note naming only an item would still
  // be a boost to the collector, but the site's own template always names the
  // show, so a note without one is not one of ours.
  if (!row.podcast_guid) throw new Error("no podcast guid");

  const hints = body.episode && typeof body.episode === "object" ? body.episode : {};
  return {
    row,
    episodeTitle: hint(hints.title),
    showTitle: hint(hints.showTitle),
  };
}

// The five figures the collector projects onto a show, recomputed from every
// boost D1 holds for it. Same formulas as `_podcast_upsert_sql` in d1_sync.py
// (that one reads the box database through the alias map; this one reads D1,
// which is why the collector's replace is the last word).
const PODCAST_RECOUNT = `
  UPDATE podcasts SET
    boost_count   = (SELECT COUNT(*)                        FROM boosts WHERE podcast_guid = ?),
    total_sats    = (SELECT COALESCE(SUM(sats), 0)          FROM boosts WHERE podcast_guid = ?),
    booster_count = (SELECT COUNT(DISTINCT booster_pubkey)  FROM boosts WHERE podcast_guid = ?),
    episode_count = (SELECT COUNT(DISTINCT item_guid)       FROM boosts WHERE podcast_guid = ?),
    latest_ts     = (SELECT MAX(created_at)                 FROM boosts WHERE podcast_guid = ?)
  WHERE podcast_guid = ?`;

// The four the collector projects onto an episode (`_episode_upsert_sql`).
const EPISODE_RECOUNT = `
  UPDATE episodes SET
    boost_count   = (SELECT COUNT(*)                        FROM boosts WHERE item_guid = ?),
    total_sats    = (SELECT COALESCE(SUM(sats), 0)          FROM boosts WHERE item_guid = ?),
    booster_count = (SELECT COUNT(DISTINCT booster_pubkey)  FROM boosts WHERE item_guid = ?),
    latest_ts     = (SELECT MAX(created_at)                 FROM boosts WHERE item_guid = ?)
  WHERE item_guid = ?`;

// ⚠️ THE ONE TABLE THE EDGE OWNS, created by the edge. Every other table in D1
// is created and altered by hand from `schema.sql`, on the collector box, which
// holds the credentials; this endpoint provisions its own marker table so it
// works from the first deploy rather than after an out-of-band step, and the
// statement is a no-op on every request after the first. The definition is
// restated in `schema.sql` so a rebuilt database carries it too.
const EDGE_TABLE = `
  CREATE TABLE IF NOT EXISTS boosts_edge (
    event_id     TEXT PRIMARY KEY,
    ingested_at  INTEGER NOT NULL,
    podcast_guid TEXT,
    item_guid    TEXT
  )`;

/**
 * Write one validated submission. Returns what was done, so the caller and the
 * test can see which rows were new.
 *
 * Two round trips: one batch of reads (does the boost, the show, the episode
 * exist), one batch of writes. The reads decide whether a stub row and its FTS
 * entry are needed, which is a branch D1's batch cannot express. The insert of
 * the boost itself is `OR IGNORE`, so a race between two identical submissions
 * costs at most a duplicated FTS row, never a duplicated boost.
 */
export async function ingestBoost(db, { row, episodeTitle, showTitle }) {
  const reads = [
    db.prepare("SELECT 1 AS present FROM boosts WHERE event_id = ?").bind(row.event_id),
    db.prepare("SELECT title FROM podcasts WHERE podcast_guid = ?").bind(row.podcast_guid),
  ];
  if (row.item_guid) {
    reads.push(db.prepare("SELECT title FROM episodes WHERE item_guid = ?").bind(row.item_guid));
  }
  const [boostR, podR, epR] = await db.batch(reads);
  if (boostR.results?.length) {
    return { ingested: false, reason: "exists" };
  }
  const podcast = podR.results?.[0] ?? null;
  const episode = epR?.results?.[0] ?? null;

  const stmts = [
    db.prepare(EDGE_TABLE),
    db.prepare(
      `INSERT OR IGNORE INTO boosts (event_id, booster_pubkey, booster_npub, created_at, sats,
         amount_source, podcast_guid, item_guid, item_url, client, client_id, client_via, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(row.event_id, row.booster_pubkey, row.booster_npub, row.created_at, row.sats,
            row.amount_source, row.podcast_guid, row.item_guid, row.item_url, row.client,
            row.client_id, row.client_via, row.message),
    db.prepare("INSERT OR IGNORE INTO boosts_edge (event_id, ingested_at, podcast_guid, item_guid) VALUES (?, ?, ?, ?)")
      .bind(row.event_id, Math.floor(Date.now() / 1000), row.podcast_guid, row.item_guid),
  ];
  if (row.message) {
    stmts.push(db.prepare("INSERT INTO boosts_fts (event_id, message) VALUES (?, ?)")
      .bind(row.event_id, row.message));
  }

  // ── the show ──
  // Every surface that can start a boost on this site sits on an indexed show,
  // so the stub below is a guard rather than a path in use. It carries the
  // title the widget passed and nothing else; a titleless stub renders as a
  // show the site has no page for, which is the truth until the collector
  // enriches it.
  const podcastStub = !podcast;
  if (podcastStub) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO podcasts (podcast_guid, title) VALUES (?, ?)")
      .bind(row.podcast_guid, showTitle));
    if (showTitle) {
      stmts.push(db.prepare("INSERT INTO podcasts_fts (podcast_guid, title, author) VALUES (?, ?, NULL)")
        .bind(row.podcast_guid, showTitle));
    }
  }
  const g = row.podcast_guid;
  stmts.push(db.prepare(PODCAST_RECOUNT).bind(g, g, g, g, g, g));

  // ── the episode ──
  // This is the stub that matters: the catalogue drawer boosts episodes the
  // index has never seen, and without a row the episode page 302s to the show
  // and the feed card has no title. The collector's `INSERT OR REPLACE`
  // overwrites every column of it, including the ones left null here.
  const episodeStub = !!row.item_guid && !episode;
  if (row.item_guid) {
    if (episodeStub) {
      stmts.push(db.prepare("INSERT OR IGNORE INTO episodes (item_guid, podcast_guid, title) VALUES (?, ?, ?)")
        .bind(row.item_guid, row.podcast_guid, episodeTitle));
      const show = podcast?.title ?? showTitle;
      if (episodeTitle || show) {
        stmts.push(db.prepare("INSERT INTO episodes_fts (item_guid, title, show) VALUES (?, ?, ?)")
          .bind(row.item_guid, episodeTitle, show));
      }
    }
    const i = row.item_guid;
    stmts.push(db.prepare(EPISODE_RECOUNT).bind(i, i, i, i, i));
  }

  await db.batch(stmts);
  return {
    ingested: true,
    stubs: { podcast: podcastStub, episode: episodeStub },
  };
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    return reply(request, { error: "index not configured" }, 503);
  }
  // ⚠️ FAIL CLOSED WITH NO COUNTER BOUND, as the oracle does and for the same
  // reason: an in-memory counter is per-isolate and therefore no limit at all.
  // The widget treats every non-2xx here as "the collector will catch up", so
  // an unconfigured binding costs the fast path and nothing else.
  const kv = env.SIGN_RATELIMIT;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return reply(request, { error: "index not configured" }, 503);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    if (await overRateLimit(kv, ip)) return reply(request, { error: "too many requests" }, 429);
  } catch {
    return reply(request, { error: "index not configured" }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return reply(request, { error: "invalid JSON" }, 400); }

  let submission;
  try { submission = validateSubmission(body); } catch (e) {
    return reply(request, { error: e instanceof Error ? e.message : "invalid submission" }, 400);
  }

  try {
    const done = await ingestBoost(db, submission);
    return reply(request, {
      ok: true,
      ...done,
      event_id: submission.row.event_id,
      podcast_guid: submission.row.podcast_guid,
      item_guid: submission.row.item_guid,
    });
  } catch (e) {
    // A failed write is the collector's problem to fix on its next tick; the
    // caller only needs to know the fast path did not happen.
    return reply(request, { error: "index write failed" }, 502);
  }
}

// Only POST (and OPTIONS) are exported deliberately, the oracle's reasoning: a
// GET falls through to the asset handler and answers 404, which is the honest
// answer on a path that exists only to be posted to.
