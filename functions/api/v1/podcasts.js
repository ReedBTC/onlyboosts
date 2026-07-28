// GET /api/v1/podcasts — per-show aggregates. sort=recent|sats|boosts, cursor-paginated by rank.
import { json, preflight, clampLimit } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

const SORTS = { recent: "latest_ts", sats: "total_sats", boosts: "boost_count" };

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const col = SORTS[u.searchParams.get("sort")] || "latest_ts";
  const limit = clampLimit(u.searchParams.get("limit"));
  const offset = Math.max(0, parseInt(u.searchParams.get("offset"), 10) || 0);

  const sql = `SELECT podcast_guid, title, image, artwork, feed_url, medium, author, boost_count,
                      total_sats, booster_count, episode_count, latest_ts
               FROM podcasts ORDER BY ${col} DESC, podcast_guid LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(limit, offset).all();
  const podcasts = results.map((r) => ({
    guid: r.podcast_guid, title: r.title, img: r.image,
    // Second-chance art: <itunes:image> where it differs from <image>. Null for
    // most shows. Matches the shards' `art2`; see DATA-API.md.
    art2: r.artwork || null,
    feed: r.feed_url,
    medium: r.medium, author: r.author,
    boosts: r.boost_count, sats: r.total_sats, boosters: r.booster_count,
    episodes: r.episode_count, latest: r.latest_ts,
  }));
  return json(request, {
    count: podcasts.length,
    next_offset: podcasts.length === limit ? offset + limit : null,
    podcasts,
  });
}
