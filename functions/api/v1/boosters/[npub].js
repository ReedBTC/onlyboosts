// GET /api/v1/boosters/:npub — one booster's profile + their boosts (npub or hex).
//
// Two shapes, and which one you get is the `corpus` parameter:
//
//   (default)   cursor-paged boosts, newest-first — the public API shape
//   ?corpus=1   every boost this person has sent, in one bounded response
//
// THE CORPUS MODE EXISTS FOR /booster/<npub>, which rolls one person's whole
// history up by episode in the browser and cannot do that from a prefix of it.
// It is the same shape and the same reasoning as `?community=1` on
// /api/v1/episodes/<guid>: a client that has to GROUP BY needs the whole window
// or its ranking is over whatever it happened to page in.
//
// ⚠️ THE CAP IS NOT A PAGE SIZE, and it is generous on purpose. Measured over
// all 1,999 boosters in the live index, the heaviest has 975 boosts, the p99 has
// 164 and the median has 2 — so CORPUS_CAP truncates nobody today and is a guard
// against a future outlier rather than a window. If it ever bites, `truncated`
// says so and the page passes that on rather than letting a ranking over a
// prefix pose as a ranking over everything.
import { json, preflight, BOOST_SELECT, boostRecord, toHexPubkey,
         encodeCursor, decodeCursor, clampLimit } from "../_common.js";
import { lookupMentionNames } from "../../../_shared/detail-page.js";

// See the note above: ~2x the heaviest booster in the index.
const CORPUS_CAP = 2000;

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env, params }) {
  const hex = toHexPubkey(params.npub);
  if (!hex) return json(request, { error: "bad npub/hex" }, { status: 400 });

  // ⚠️ EVERY COLUMN IS NAMED, never SELECT *. That is what made the collector's
  // five-column migration a non-event on this side: a table gaining columns
  // cannot change an existing response. The five below (about, lud16, lud06,
  // website, banner) landed 2026-08-13 and are what the booster page's header
  // is built from. All of them are nullable — coverage runs 54% for `about`
  // down to 4.4% for `lud06`.
  const prof = await env.DB.prepare(
    `SELECT pubkey, name, display_name, picture, nip05,
            about, lud16, lud06, website, banner
     FROM profiles WHERE pubkey = ?`
  ).bind(hex).first();

  const u = new URL(request.url);

  // The npub as it should be echoed back. Accepting hex on input is a
  // convenience; every consumer wants the bech32 form, and when the caller gave
  // us hex we can still recover it from any of their boost rows, which store it.
  const givenNpub = String(params.npub || "").startsWith("npub") ? params.npub : null;

  const booster = (npubFromRows) => ({
    pk: hex,
    npub: givenNpub || npubFromRows || null,
    name: prof?.name ?? null,
    display_name: prof?.display_name ?? null,
    pic: prof?.picture ?? null,
    nip05: prof?.nip05 ?? null,
    about: prof?.about ?? null,
    lud16: prof?.lud16 ?? null,
    lud06: prof?.lud06 ?? null,
    website: prof?.website ?? null,
    banner: prof?.banner ?? null,
  });

  // ── the whole history, one response ────────────────────────────────────────
  if (u.searchParams.get("corpus") === "1") {
    const { boosts, truncated, names, npub: seen } = await fetchBoosterCorpus(env, hex, { names: true });
    return json(request, {
      booster: booster(seen),
      // Nested rather than flat, so a caller can never mistake this for the
      // paged shape and start looking for a cursor that is deliberately absent.
      corpus: { boosts, truncated, count: boosts.length, names },
    });
  }

  // ── the paged shape ────────────────────────────────────────────────────────
  const limit = clampLimit(u.searchParams.get("limit"));
  const args = [hex];
  let curClause = "";
  const cur = decodeCursor(u.searchParams.get("cursor"));
  if (cur) { curClause = " AND (b.created_at < ? OR (b.created_at = ? AND b.event_id < ?))";
             args.push(cur.ts, cur.ts, cur.id); }
  args.push(limit);

  const { results } = await env.DB.prepare(
    `${BOOST_SELECT} WHERE b.booster_pubkey = ?${curClause}
     ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
  ).bind(...args).all();

  const boosts = results.map(boostRecord);
  return json(request, {
    booster: booster(results[0]?.booster_npub),
    count: boosts.length,
    next_cursor: boosts.length === limit ? encodeCursor(results[results.length - 1]) : null,
    boosts,
  });
}

/* Every boost one person has sent, bounded and newest-first.
 *
 * ⚠️ EXPORTED, AND functions/booster/[npub].js CALLS IT DIRECTLY. That page
 * server-renders the first thirty cards of its Episodes and Songs section, so it
 * needs the corpus inside its own Promise.all rather than through a subrequest
 * to this endpoint. One query definition, two callers, no HTTP hop — and the
 * page cannot rank over a corpus assembled differently from the one the client
 * later fetches to re-sort with.
 *
 * One row over the cap is fetched purely to detect the truncation, then dropped.
 * Asking for exactly the cap cannot tell "there are precisely this many" from
 * "there are more".
 *
 * ⚠️ `names` RIDES ALONG FOR THE BOOST LIST, NOT FOR THE EPISODE ROLLUP. The
 * rollup (episode-section.js) ignores it; #boosts needs it, because a boost
 * message renders `nostr:npub1…` as an `@Name` chip and the name comes from a
 * `profiles` lookup the edge runs when it renders the page. A row rebuilt in the
 * browser without it would show a truncated npub where the row beside it, painted
 * by the edge, showed a name. See the same note over fetchShowCorpus.
 *
 * ⚠️ AND IT IS OPT-IN, because of the OTHER caller. functions/booster/[npub].js
 * runs this inside its own Promise.all to server-render the episode rollup, and
 * that page already runs its own mention lookup over the 24 rows it prints.
 * Defaulting the flag on would have put a second lookup, over up to 2,000
 * messages, on the TTFB of every booster page to fill a map that render throws
 * away.
 */
export async function fetchBoosterCorpus(env, hex, { names: wantNames = false } = {}) {
  const { results } = await env.DB.prepare(
    `${BOOST_SELECT} WHERE b.booster_pubkey = ?
     ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
  ).bind(hex, CORPUS_CAP + 1).all();

  const rows = results || [];
  const truncated = rows.length > CORPUS_CAP;
  const kept = truncated ? rows.slice(0, CORPUS_CAP) : rows;
  return {
    boosts: kept.map(boostRecord),
    truncated,
    // A plain object rather than the Map lookupMentionNames returns: this
    // crosses the wire as JSON, and the client turns it back into a Map.
    names: wantNames
      ? Object.fromEntries(await lookupMentionNames(env, kept.map((r) => r.message)))
      : null,
    npub: rows[0]?.booster_npub,
  };
}
