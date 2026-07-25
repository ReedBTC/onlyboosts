// GET /api/v1/boosts — the boost feed, filterable + cursor-paginated (newest first).
// Query params: podcast=<guid> item=<guid> booster=<npub|hex> since= until= cursor= limit=
import { json, preflight, BOOST_SELECT, boostRecord, toHexPubkey,
         encodeCursor, decodeCursor, clampLimit } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const limit = clampLimit(u.searchParams.get("limit"));
  const where = [];
  const args = [];

  const podcast = u.searchParams.get("podcast");
  if (podcast) { where.push("b.podcast_guid = ?"); args.push(podcast); }
  const item = u.searchParams.get("item");
  if (item) { where.push("b.item_guid = ?"); args.push(item); }
  const booster = u.searchParams.get("booster");
  if (booster) {
    const hex = toHexPubkey(booster);
    if (!hex) return json(request, { error: "bad booster (npub or hex)" }, { status: 400 });
    where.push("b.booster_pubkey = ?"); args.push(hex);
  }
  const since = parseInt(u.searchParams.get("since"), 10);
  if (Number.isFinite(since)) { where.push("b.created_at >= ?"); args.push(since); }
  const until = parseInt(u.searchParams.get("until"), 10);
  if (Number.isFinite(until)) { where.push("b.created_at <= ?"); args.push(until); }

  const cur = decodeCursor(u.searchParams.get("cursor"));
  if (cur) { where.push("(b.created_at < ? OR (b.created_at = ? AND b.event_id < ?))");
             args.push(cur.ts, cur.ts, cur.id); }

  const sql = `${BOOST_SELECT}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`;
  args.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const boosts = results.map(boostRecord);
  return json(request, {
    count: boosts.length,
    next_cursor: boosts.length === limit ? encodeCursor(results[results.length - 1]) : null,
    boosts,
  });
}
