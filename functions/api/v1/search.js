// GET /api/v1/search?q=&type=boosts|podcasts — FTS5 search over boostagram text
// or podcast titles.
import { json, preflight, BOOST_SELECT, boostRecord, clampLimit } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "").trim();
  if (q.length < 2) return json(request, { error: "q must be >= 2 chars" }, { status: 400 });
  const type = u.searchParams.get("type") === "podcasts" ? "podcasts" : "boosts";
  const limit = clampLimit(u.searchParams.get("limit"), 30, 100);
  // FTS5 MATCH: quote the query as a phrase-ish prefix to keep it safe + forgiving
  const match = q.replace(/["]/g, " ") + "*";

  if (type === "podcasts") {
    const { results } = await env.DB.prepare(
      `SELECT p.podcast_guid, p.title, p.image, p.feed_url, p.boost_count, p.total_sats,
              p.booster_count, p.episode_count, p.latest_ts
       FROM podcasts_fts f JOIN podcasts p ON p.podcast_guid = f.podcast_guid
       WHERE podcasts_fts MATCH ? ORDER BY p.total_sats DESC LIMIT ?`
    ).bind(match, limit).all();
    return json(request, {
      type, q, count: results.length,
      podcasts: results.map((r) => ({
        guid: r.podcast_guid, title: r.title, img: r.image, feed: r.feed_url,
        boosts: r.boost_count, sats: r.total_sats, boosters: r.booster_count,
        episodes: r.episode_count, latest: r.latest_ts,
      })),
    });
  }

  const { results } = await env.DB.prepare(
    `${BOOST_SELECT}
     JOIN boosts_fts f ON f.event_id = b.event_id
     WHERE boosts_fts MATCH ? ORDER BY b.created_at DESC LIMIT ?`
  ).bind(match, limit).all();
  return json(request, { type, q, count: results.length, boosts: results.map(boostRecord) });
}
