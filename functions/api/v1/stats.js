// GET /api/v1/stats — top-line totals (mirrors meta.json, straight from D1).
import { json, preflight } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env }) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM boosts)                                   AS boosts,
            (SELECT COALESCE(SUM(sats),0) FROM boosts)                     AS total_sats,
            (SELECT COUNT(*) FROM podcasts)                                AS shows,
            (SELECT COUNT(*) FROM episodes)                               AS episodes,
            (SELECT COUNT(DISTINCT booster_pubkey) FROM boosts)          AS boosters,
            (SELECT MIN(created_at) FROM boosts)                          AS earliest,
            (SELECT MAX(created_at) FROM boosts)                          AS latest`
  ).first();
  return json(request, row, { cache: 60 });
}
