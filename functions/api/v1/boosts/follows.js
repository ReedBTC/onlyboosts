// POST /api/v1/boosts/follows — the boost feed filtered to a follow set.
// Body: { authors: [npub|hex, ...], since?, until?, cursor?, limit? }
// Follow lists get large, so this is a POST (server does an indexed IN query —
// the thing that's painful to do client-side).
import { json, preflight, BOOST_SELECT, boostRecord, toHexPubkey,
         encodeCursor, decodeCursor, clampLimit } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

const MAX_AUTHORS = 2000;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json(request, { error: "invalid JSON" }, { status: 400 }); }
  const raw = Array.isArray(body?.authors) ? body.authors : null;
  if (!raw || raw.length === 0) return json(request, { error: "authors[] required" }, { status: 400 });

  const hexes = [...new Set(raw.map(toHexPubkey).filter(Boolean))].slice(0, MAX_AUTHORS);
  if (hexes.length === 0) return json(request, { error: "no valid authors" }, { status: 400 });

  const limit = clampLimit(body.limit);
  const where = [`b.booster_pubkey IN (${hexes.map(() => "?").join(",")})`];
  const args = [...hexes];

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
