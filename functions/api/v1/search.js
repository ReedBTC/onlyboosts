// GET /api/v1/search?q=&type=boosts|podcasts|episodes — FTS5 search over
// boostagram text, podcast titles/authors, or episode titles.
import { json, preflight, BOOST_SELECT, boostRecord, clampLimit } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "").trim();
  if (q.length < 2) return json(request, { error: "q must be >= 2 chars" }, { status: 400 });
  const TYPES = new Set(["boosts", "podcasts", "episodes"]);
  const asked = u.searchParams.get("type");
  const type = TYPES.has(asked) ? asked : "boosts";
  const limit = clampLimit(u.searchParams.get("limit"), 30, 100);
  // FTS5 MATCH: quote the query as a phrase-ish prefix to keep it safe + forgiving
  const match = q.replace(/["]/g, " ") + "*";

  if (type === "episodes") {
    // Flat relevance-ordered lookup. The ranked, sort-aware version lives on
    // /api/v1/episodes?q= — use that one for the feed, where the question is
    // "where does this stand" rather than "does this exist".
    const { results } = await env.DB.prepare(
      `SELECT e.item_guid, e.podcast_guid, e.title, e.image, e.published,
              e.boost_count, e.total_sats, e.booster_count, e.latest_ts,
              p.title AS p_title, p.image AS p_image
       FROM episodes_fts f
       JOIN episodes e ON e.item_guid = f.item_guid
       LEFT JOIN podcasts p ON p.podcast_guid = e.podcast_guid
       WHERE episodes_fts MATCH ? ORDER BY e.total_sats DESC LIMIT ?`
    ).bind(match, limit).all();
    return json(request, {
      type, q, count: results.length,
      episodes: results.map((r) => ({
        guid: r.item_guid, title: r.title, img: r.image || r.p_image,
        date: r.published,
        show: { guid: r.podcast_guid, title: r.p_title, img: r.p_image },
        boosts: r.boost_count, sats: r.total_sats, boosters: r.booster_count,
        latest: r.latest_ts,
      })),
    });
  }

  if (type === "podcasts") {
    const { results } = await env.DB.prepare(
      // author is both RETURNED and MATCHED: podcasts_fts carries it alongside
      // title (see d1/schema.sql), so an artist name finds its feed here.
      `SELECT p.podcast_guid, p.title, p.image, p.feed_url, p.author, p.boost_count, p.total_sats,
              p.booster_count, p.episode_count, p.latest_ts
       FROM podcasts_fts f JOIN podcasts p ON p.podcast_guid = f.podcast_guid
       WHERE podcasts_fts MATCH ? ORDER BY p.total_sats DESC LIMIT ?`
    ).bind(match, limit).all();
    return json(request, {
      type, q, count: results.length,
      podcasts: results.map((r) => ({
        guid: r.podcast_guid, title: r.title, img: r.image, feed: r.feed_url,
        author: r.author,
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
