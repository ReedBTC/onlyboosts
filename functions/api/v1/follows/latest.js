/**
 * POST /api/v1/follows/latest — the newest episodes of the podcasts a member
 * follows (the homepage's "Latest From Podcasts You Follow" rail, 2026-11-08,
 * Reed's ask: follows were the input the dropped followed-podcasts feed was
 * missing).
 *
 *   body   { feeds: [guid], limit? }        bare podcast guids, the list's feed entries
 *   200    { episodes: [row], shows, source: 'pi' | 'index' }
 *
 * A row is { guid, title, img, date, duration, show: { guid, title, img, art2 } },
 * newest first. `shows` is how many of the guids are podcasts the index
 * knows; music feeds are left out (an album favorite has no new episodes).
 *
 * ⚠️ D1 HOLDS BOOSTED EPISODES ONLY, so the newest episode of a followed show
 * is usually not in it. The rail asks Podcast Index: one `podcasts/byfeedurl`
 * (or `byguid`) per show for its feed id, cached a week at the edge since the
 * id never changes, then ONE `episodes/byfeedid?id=a,b,c` for the lot, cached
 * ten minutes. At most SHOWS_MAX shows a request, the ones with the newest
 * episode first by `podcasts.newest_item_ts` (the collector's PI-sourced date;
 * absent on an older remote, so the query falls back to unordered). Without
 * PI keys, or when PI answers nothing, the index's own newest boosted episodes
 * of those shows are the answer, marked `source: 'index'`.
 *
 * POST and `no-store`: a follow list is personal. Nothing is stored per member.
 */
import { json, preflight, corsHeaders } from "../_common.js";
import { piHeaders, piGet } from "../../../_shared/podcast-index.js";

export const SHOWS_MAX = 40;
export const FEEDS_MAX = 500;
const PI_PARALLEL = 6;
const PI_BYTES = 512 * 1024;
const ID_TTL = 7 * 86400;
const ITEMS_TTL = 600;
const GUID_RE = /^[\x21-\x7e]{1,128}$/;

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json(request, { error: "bad json" }, { status: 400, cache: 0 }); }
  if (!body || typeof body !== "object" || !Array.isArray(body.feeds)) return json(request, { error: "feeds required" }, { status: 400, cache: 0 });
  const feeds = [...new Set(body.feeds.filter((g) => typeof g === "string" && GUID_RE.test(g)))].slice(0, FEEDS_MAX);
  const limit = Math.min(40, Math.max(1, Number.parseInt(body.limit, 10) || 20));
  if (!env.DB) return json(request, { error: "no database" }, { status: 503, cache: 0 });

  const answer = (data) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(request) },
  });
  if (!feeds.length) return answer({ episodes: [], shows: 0, source: "index" });

  const shows = await followedPodcasts(env, feeds);
  if (!shows.length) return answer({ episodes: [], shows: 0, source: "index" });
  const byGuid = new Map(shows.map((s) => [s.guid, s]));

  let episodes = null;
  const key = env.PODCAST_INDEX_KEY;
  const secret = env.PODCAST_INDEX_SECRET;
  if (key && secret) {
    try { episodes = await fromPodcastIndex(shows.slice(0, SHOWS_MAX), key, secret, limit); } catch (e) { console.warn("[follows/latest] pi", e?.message); }
  }
  if (episodes && episodes.length) return answer({ episodes, shows: shows.length, source: "pi" });

  const { results } = await env.DB.prepare(
    `SELECT item_guid, podcast_guid, title, image, published, duration
       FROM episodes WHERE podcast_guid IN (SELECT value FROM json_each(?1)) AND published IS NOT NULL
      ORDER BY published DESC LIMIT ?2`,
  ).bind(JSON.stringify(shows.map((s) => s.guid)), limit).all();
  const rows = (results ?? []).map((r) => row({
    guid: r.item_guid, title: r.title, img: r.image, date: r.published, duration: r.duration,
  }, byGuid.get(r.podcast_guid)));
  return answer({ episodes: rows, shows: shows.length, source: "index" });
}

/** The followed guids that are podcasts the index knows, newest episode first. */
async function followedPodcasts(env, feeds) {
  const bound = JSON.stringify(feeds);
  const base = `SELECT podcast_guid, title, image, artwork, feed_url{COL} FROM podcasts
     WHERE podcast_guid IN (SELECT value FROM json_each(?1)) AND COALESCE(medium, 'podcast') != 'music'`;
  let results;
  try {
    ({ results } = await env.DB.prepare(base.replace("{COL}", ", newest_item_ts") + " ORDER BY newest_item_ts IS NULL, newest_item_ts DESC").bind(bound).all());
  } catch (e) {
    if (!/no such column/i.test(String(e?.message || e))) throw e;
    ({ results } = await env.DB.prepare(base.replace("{COL}", "")).bind(bound).all());
  }
  return (results ?? []).map((r) => ({
    guid: r.podcast_guid, title: r.title || null, img: r.image || null, art2: r.artwork || null,
    feed: r.feed_url || null, newest: r.newest_item_ts ?? null,
  }));
}

async function fromPodcastIndex(shows, key, secret, limit) {
  const headers = await piHeaders(key, secret, "OnlyBoosts-Follows/1.0");
  const idOpts = { timeoutMs: 5000, cacheTtl: ID_TTL, maxBytes: PI_BYTES };
  const byFeedId = new Map();
  const queue = shows.slice();
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      const r = s.feed
        ? await piGet(`/podcasts/byfeedurl?url=${encodeURIComponent(s.feed)}`, headers, idOpts)
        : await piGet(`/podcasts/byguid?guid=${encodeURIComponent(s.guid)}`, headers, idOpts);
      const id = Number(r?.feed?.id);
      if (Number.isInteger(id) && id > 0) byFeedId.set(id, s);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PI_PARALLEL, queue.length) }, worker));
  if (!byFeedId.size) return [];
  const ids = [...byFeedId.keys()].join(",");
  const max = Math.min(100, Math.max(limit * 3, 30));
  const r = await piGet(`/episodes/byfeedid?id=${ids}&max=${max}`, headers, { timeoutMs: 8000, cacheTtl: ITEMS_TTL, maxBytes: 2 * 1024 * 1024 });
  const items = Array.isArray(r?.items) ? r.items : [];
  return items
    .filter((it) => it && typeof it === "object" && byFeedId.has(Number(it.feedId)))
    .map((it) => row({
      guid: typeof it.guid === "string" && it.guid ? it.guid : (it.id != null ? String(it.id) : null),
      title: it.title, img: it.image || it.feedImage || null,
      date: Number(it.datePublished) || null, duration: Number(it.duration) || null,
    }, byFeedId.get(Number(it.feedId))))
    .filter((e) => e.guid && e.title)
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, limit);
}

function row(e, show) {
  return {
    guid: e.guid || null, title: e.title || null, img: e.img || null,
    date: e.date || null, duration: e.duration || null,
    show: show ? { guid: show.guid, title: show.title, img: show.img, art2: show.art2 } : null,
  };
}
