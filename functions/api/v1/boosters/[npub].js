// GET /api/v1/boosters/:npub — one booster's profile + their boosts (npub or hex).
import { json, preflight, BOOST_SELECT, boostRecord, toHexPubkey,
         encodeCursor, decodeCursor, clampLimit } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env, params }) {
  const hex = toHexPubkey(params.npub);
  if (!hex) return json(request, { error: "bad npub/hex" }, { status: 400 });

  const prof = await env.DB.prepare(
    `SELECT pubkey, name, display_name, picture, nip05 FROM profiles WHERE pubkey = ?`
  ).bind(hex).first();

  const u = new URL(request.url);
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
    booster: prof
      ? { pk: hex, npub: params.npub.startsWith("npub") ? params.npub : null,
          name: prof.name, display_name: prof.display_name, pic: prof.picture, nip05: prof.nip05 }
      : { pk: hex, npub: null, name: null, pic: null },
    count: boosts.length,
    next_cursor: boosts.length === limit ? encodeCursor(results[results.length - 1]) : null,
    boosts,
  });
}
