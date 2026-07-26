// POST /api/v1/boosts/follows — the boost feed filtered to a follow set.
// Body: { authors: [npub|hex, ...], since?, until?, cursor?, limit? }
// Follow lists get large, so this is a POST (server does an indexed IN query —
// the thing that's painful to do client-side).
import { json, preflight, BOOST_SELECT, boostRecord, toHexPubkey,
         encodeCursor, decodeCursor, clampLimit } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// ── How the follow set reaches SQLite ─────────────────────────────────────────
//
// D1 imposes two limits that a large `IN (...)` runs into from opposite sides:
// at most 100 bound parameters per statement, and at most 100,000 bytes of SQL
// statement text.
//
// Binding one parameter per author hits the first at 99 follows — an ordinary
// follow list — and hits it harder mid-pagination, where the cursor adds three
// more binds. Interpolating the authors into the statement instead trades that
// for the second limit: at ~67 bytes per author the text runs out around 1,480,
// which is why this endpoint used to truncate at 1,000.
//
// Passing the whole list as ONE bound parameter — a JSON array, unrolled by
// json_each — escapes both. The statement text is a fixed ~180 bytes however
// many authors there are, and parameter *values* don't count toward the
// statement-length limit. Verified against SQLite 3.51: the plan still resolves
// through idx_boosts_booster (`SEARCH b USING INDEX idx_boosts_booster`) rather
// than degrading to a table scan, and results are identical to the interpolated
// form.
//
// json_each is part of the JSON1 extension, which D1 documents as supported,
// but Cloudflare does not enumerate the table-valued functions specifically.
// So correctness does not rest on it: if D1 rejects the statement, runFallback
// below reproduces the previous interpolated-and-truncated behaviour. The
// fallback is a strict regression to what shipped before, never worse.
const HEX64 = /^[0-9a-f]{64}$/;

// Not a technical limit — the JSON path has no author ceiling worth naming.
// This is an abuse guard, so a client can't post a million pubkeys and make us
// build a query out of them. Well beyond any real Nostr contact list.
const MAX_AUTHORS = 10000;

// The fallback path is still bounded by statement text, so it keeps the old
// ceiling. Only reachable if json_each is unavailable.
const MAX_AUTHORS_FALLBACK = 1000;

function buildTail(body, args) {
  const where = [];
  if (Number.isFinite(body.since)) { where.push("b.created_at >= ?"); args.push(body.since); }
  if (Number.isFinite(body.until)) { where.push("b.created_at <= ?"); args.push(body.until); }
  const cur = decodeCursor(body.cursor);
  if (cur) {
    where.push("(b.created_at < ? OR (b.created_at = ? AND b.event_id < ?))");
    args.push(cur.ts, cur.ts, cur.id);
  }
  return where;
}

// Primary: the follow set travels as a single bound JSON array.
async function runJsonEach(env, hexes, body, limit) {
  const args = [JSON.stringify(hexes)];
  const where = ["b.booster_pubkey IN (SELECT value FROM json_each(?))", ...buildTail(body, args)];
  const sql = `${BOOST_SELECT} WHERE ${where.join(" AND ")}
    ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`;
  args.push(limit);
  return { ...(await env.DB.prepare(sql).bind(...args).all()), used: hexes.length };
}

// Fallback: authors interpolated into the statement, so the list must be
// truncated to keep the SQL under 100KB. Safe to interpolate because every
// value has been through toHexPubkey and re-tested against HEX64 — both
// branches of that helper return hex-only strings by construction, so nothing
// can carry a quote or comma into the SQL. Do not generalize the pattern.
async function runInterpolated(env, hexes, body, limit) {
  const used = hexes.slice(0, MAX_AUTHORS_FALLBACK);
  const args = [];
  const where = [
    `b.booster_pubkey IN (${used.map((h) => `'${h}'`).join(",")})`,
    ...buildTail(body, args),
  ];
  const sql = `${BOOST_SELECT} WHERE ${where.join(" AND ")}
    ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`;
  args.push(limit);
  return { ...(await env.DB.prepare(sql).bind(...args).all()), used: used.length };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json(request, { error: "invalid JSON" }, { status: 400 }); }
  const raw = Array.isArray(body?.authors) ? body.authors : null;
  if (!raw || raw.length === 0) return json(request, { error: "authors[] required" }, { status: 400 });

  const hexes = [...new Set(raw.map(toHexPubkey).filter(Boolean))]
    .filter((h) => HEX64.test(h))
    .slice(0, MAX_AUTHORS);
  if (hexes.length === 0) return json(request, { error: "no valid authors" }, { status: 400 });

  const limit = clampLimit(body.limit);

  let out;
  try {
    out = await runJsonEach(env, hexes, body, limit);
  } catch (e) {
    // Only a missing json_each should land here. Anything else (a genuine
    // query error, a D1 outage) will fail the retry the same way and surface
    // as a 500, which is what it should be.
    console.warn("[follows] json_each unavailable, falling back:", e?.message);
    out = await runInterpolated(env, hexes, body, limit);
  }

  const boosts = out.results.map(boostRecord);
  return json(request, {
    // What the query actually filtered on. Equals the caller's deduped list
    // unless something truncated it, so a client can tell the difference.
    matched_authors: out.used,
    count: boosts.length,
    next_cursor: boosts.length === limit ? encodeCursor(out.results[out.results.length - 1]) : null,
    boosts,
  });
}
