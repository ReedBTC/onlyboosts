// The songs an episode plays, for /episode/<item-guid>'s player and its
// chapters list: every <podcast:valueTimeSplit> window in the item, read from
// the show's own RSS (functions/_shared/time-splits.js), each named.
//
//   GET /api/episode-songs?guid=<item guid>&feedUrl=<the show's feed>
//   → { songs: [ { start, duration, pct, feedGuid, itemGuid, title, album,
//                  artist, image, indexed } ], inline: n }
//   → { songs: [], reason: "…" }
//
// WHO NAMES A SONG, surest first: our own index (D1 knows the title, the
// album and its art for every song anyone boosted), then Podcast Index's
// episode record, asked by item guid and the album's feed guid. A song
// neither knows still comes back, with its window and no title, so the
// player can mark it; the client renders it as "A song".
//
// `indexed` says the song has an /episode page here (a D1 row); the client
// links the title only then, since /episode 302s away from an item it does
// not know.
//
// NOT A MONEY ENDPOINT. The boost path reads its own answer from /api/value
// at the moment of paying; nothing here decides who is paid. So it caches:
// an hour when the feed answered, six when it has no windows, five minutes
// when it could not be read.
//
// Every failure answers 200 with an empty list: the player works without it.

import { piHeaders, piGet } from "../_shared/podcast-index.js";
import { findItem, readTimeSplits, fetchFeedText } from "../_shared/time-splits.js";
import { headOf } from "../_shared/head.js";

const GUID_MAX = 400;
const D1_CHUNK = 90;          // D1 allows 100 bound parameters
const PI_LOOKUPS_MAX = 40;    // a long show runs ~30 songs; past that, D1 only
const PI_CONCURRENCY = 4;

const ALLOWED_ORIGINS = new Set([
  "https://onlyboosts.social",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
function pickCorsOrigin(o) {
  return (typeof o === "string" && ALLOWED_ORIGINS.has(o)) ? o : "https://onlyboosts.social";
}

/* D1's names for the songs it knows. An item guid can sit in more than one
 * feed; the row in the window's own feed wins, otherwise any. */
async function namesFromIndex(env, songs) {
  const out = new Map();
  if (!env.DB || !songs.length) return out;
  const guids = [...new Set(songs.map((s) => s.itemGuid))];
  for (let i = 0; i < guids.length; i += D1_CHUNK) {
    const chunk = guids.slice(i, i + D1_CHUNK);
    const { results } = await env.DB.prepare(
      `SELECT e.item_guid, e.podcast_guid, e.title, e.image,
              p.title AS album, p.author, p.image AS p_image
         FROM episodes e
         LEFT JOIN podcasts p ON p.podcast_guid = e.podcast_guid
        WHERE e.item_guid IN (${chunk.map(() => "?").join(",")})`
    ).bind(...chunk).all();
    for (const r of results || []) {
      const list = out.get(r.item_guid) || [];
      list.push(r);
      out.set(r.item_guid, list);
    }
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch { out[i] = null; }
    }
  }));
  return out;
}

export async function onRequestGet({ request, env }) {
  const headers = {
    "Access-Control-Allow-Origin": pickCorsOrigin(request.headers.get("Origin") || ""),
    Vary: "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
  const answer = (body, maxAge) => new Response(JSON.stringify(body), {
    status: 200, headers: { ...headers, "Cache-Control": `public, max-age=${maxAge}` },
  });
  const none = (reason, maxAge) => answer({ songs: [], reason }, maxAge);

  const params = new URL(request.url).searchParams;
  const guid = (params.get("guid") || "").trim();
  const feedUrl = (params.get("feedUrl") || "").trim();
  if (!guid || guid.length > GUID_MAX || !feedUrl || feedUrl.length > 2048) {
    return new Response(JSON.stringify({ error: "guid and feedUrl required" }), { status: 400, headers });
  }

  const feed = await fetchFeedText(feedUrl);
  if (!feed) return none("feed unavailable", 300);
  const item = findItem(feed.text, guid);
  if (!item) return none(feed.truncated ? "item past the read cap" : "item not in the feed", feed.truncated ? 3600 : 21600);
  const { songs, inline } = readTimeSplits(item);
  if (!songs.length) return answer({ songs: [], inline, reason: "no song windows" }, 21600);

  let index = new Map();
  try { index = await namesFromIndex(env, songs); } catch (err) { console.warn("[episode-songs] index read failed", err); }

  const named = songs.map((s) => {
    const rows = index.get(s.itemGuid) || [];
    const r = rows.find((x) => x.podcast_guid === s.feedGuid) || rows[0] || null;
    return {
      ...s,
      title: r?.title || null, album: r?.album || null, artist: r?.author || null,
      image: r?.image || r?.p_image || null, indexed: !!r,
    };
  });

  // Podcast Index for the ones our index has never seen, bounded twice.
  const misses = named.filter((s) => !s.title).slice(0, PI_LOOKUPS_MAX);
  if (misses.length && env.PODCAST_INDEX_KEY && env.PODCAST_INDEX_SECRET) {
    const h = await piHeaders(env.PODCAST_INDEX_KEY, env.PODCAST_INDEX_SECRET, "OnlyBoosts-Songs/1.0");
    await mapLimit(misses, PI_CONCURRENCY, async (s) => {
      const r = await piGet(`/episodes/byguid?guid=${encodeURIComponent(s.itemGuid)}&podcastguid=${encodeURIComponent(s.feedGuid)}`, h);
      const ep = r?.episode;
      if (!ep || typeof ep !== "object") return;
      if (typeof ep.title === "string" && ep.title.trim()) s.title = ep.title.trim();
      if (!s.album && typeof ep.feedTitle === "string") s.album = ep.feedTitle;
      if (!s.image) s.image = ep.image || ep.feedImage || null;
    });
  }

  return answer({ songs: named, inline }, 3600);
}

export const onRequestHead = headOf(onRequestGet);
