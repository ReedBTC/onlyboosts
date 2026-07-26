// POST /api/v1/boosts/follows — the boost feed filtered to a follow set.
// Body: { authors: [npub|hex, ...], since?, until?, cursor?, limit? }
// Follow lists get large, so this is a POST (server does an indexed IN query —
// the thing that's painful to do client-side).
import { json, preflight, BOOST_SELECT, boostRecord, toHexPubkey,
         encodeCursor, decodeCursor, clampLimit } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// D1 rejects a statement carrying more than 100 bound parameters. One bind per
// author blew that at 99 follows (100 with the LIMIT, fewer still once a cursor
// adds three more) and surfaced as a 500 — which is an ordinary follow list, so
// the endpoint was failing for most real users and failing *worse* on page two
// than page one.
//
// The author list is therefore interpolated into the SQL instead of bound, and
// only the handful of range/cursor/limit values stay bound. That is safe here
// and nowhere near a general licence to build SQL by concatenation: every value
// interpolated has been through toHexPubkey, whose two branches return either a
// /^[0-9a-f]{64}$/ match or bytes rendered via toString(16).padStart(2,"0").
// Both are hex-only by construction, so no input can carry a quote or a comma
// out of the helper. HEX64 below re-asserts that at the point of use, so the
// guarantee survives a future edit to toHexPubkey.
const HEX64 = /^[0-9a-f]{64}$/;

// With the binds gone the ceiling is statement size (~66 bytes per author).
// 2,000 would be a 132KB query; 1,000 keeps it near 66KB while still covering
// follow lists far larger than typical.
const MAX_AUTHORS = 1000;

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
  // Interpolated, not bound — see the note on HEX64 above.
  const where = [`b.booster_pubkey IN (${hexes.map((h) => `'${h}'`).join(",")})`];
  const args = [];

  if (Number.isFinite(body.since)) { where.push("b.created_at >= ?"); args.push(body.since); }
  if (Number.isFinite(body.until)) { where.push("b.created_at <= ?"); args.push(body.until); }
  const cur = decodeCursor(body.cursor);
  if (cur) { where.push("(b.created_at < ? OR (b.created_at = ? AND b.event_id < ?))");
             args.push(cur.ts, cur.ts, cur.id); }

  const sql = `${BOOST_SELECT} WHERE ${where.join(" AND ")}
    ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`;
  args.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const boosts = results.map(boostRecord);
  return json(request, {
    matched_authors: hexes.length,
    count: boosts.length,
    next_cursor: boosts.length === limit ? encodeCursor(results[results.length - 1]) : null,
    boosts,
  });
}
