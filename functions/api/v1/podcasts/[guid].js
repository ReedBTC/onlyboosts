// GET /api/v1/podcasts/:guid — one show: aggregate + its episodes + recent boosts.
import { json, preflight, BOOST_SELECT, boostRecord, clampLimit } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env, params }) {
  const guid = params.guid;
  const show = await env.DB.prepare(
    `SELECT podcast_guid, title, image, feed_url, medium, boost_count, total_sats,
            booster_count, episode_count, latest_ts FROM podcasts WHERE podcast_guid = ?`
  ).bind(guid).first();
  if (!show) return json(request, { error: "podcast not found" }, { status: 404 });

  const eps = await env.DB.prepare(
    `SELECT item_guid, title, image, published, duration, episode_number,
            enclosure_url, description, boost_count, total_sats
     FROM episodes WHERE podcast_guid = ? ORDER BY total_sats DESC LIMIT 500`
  ).bind(guid).all();

  const limit = clampLimit(new URL(request.url).searchParams.get("limit"), 50, 200);
  const recent = await env.DB.prepare(
    `${BOOST_SELECT} WHERE b.podcast_guid = ? ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
  ).bind(guid, limit).all();

  return json(request, {
    show: {
      guid: show.podcast_guid, title: show.title, img: show.image, feed: show.feed_url,
      medium: show.medium, boosts: show.boost_count, sats: show.total_sats,
      boosters: show.booster_count, episodes: show.episode_count, latest: show.latest_ts,
    },
    episodes: eps.results.map((e) => ({
      guid: e.item_guid, title: e.title, img: e.image || show.image, date: e.published,
      num: e.episode_number, duration: e.duration, url: e.enclosure_url,
      shownotes: e.description, boosts: e.boost_count, sats: e.total_sats,
    })),
    boosts: recent.results.map(boostRecord),
  });
}
