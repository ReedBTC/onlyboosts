/**
 * POST /api/v1/favorites/resolve — name the entries on a member's favorites list.
 *
 * A kind-10333 list carries guids and nothing else: a feed guid, an item guid
 * under its feed, a publisher guid. This turns them into what a page can show
 * (title, artwork, medium, and where the row links), from the index first and
 * from Podcast Index for what the index has never seen. The spec says the
 * lookup wins over the list's medium hint, and this is that lookup.
 *
 *   body   { feeds: [guid], items: [[feedGuid, itemGuid]], publishers: [guid] }
 *   200    { feeds: {guid: row}, items: {"feedGuid|itemGuid": row}, publishers: {guid: row} }
 *
 * A row is { title, image, artwork, medium, href, indexed }. `href` is the
 * page here when there is one, BoostMeBitch's address for a show the index
 * cannot name (the podroll tiles' rule), or null. `indexed` says which side
 * answered. A guid nobody could name is simply absent from the answer, and
 * the client renders the guid.
 *
 * ⚠️ BOUNDED ON BOTH SIDES. The index side is one bound JSON array unrolled by
 * json_each (the follows endpoint's pattern: 100 binds and 100KB of statement
 * text are the two D1 limits an IN list hits). The Podcast Index side is
 * capped at PI_MAX lookups per request, first come, through `piGet`'s
 * timeout, byte cap and edge cache; a list of 400 unknown feeds resolves
 * over a few page loads rather than in one 400-request burst. Not
 * `/api/catalogue`'s job: that one resolves ONE feed's whole episode list.
 *
 * Cached 5 minutes. Nothing here is per viewer.
 */
import { json, preflight } from "../_common.js";
import { piHeaders, piGet } from "../../../_shared/podcast-index.js";

export const MAX_FEEDS = 500;
export const MAX_ITEMS = 500;
export const MAX_PUBLISHERS = 100;
export const PI_MAX = 8;
const PI_BYTES = 256 * 1024;

const GUID = /^[^\s"'<>]{1,512}$/;
const okGuid = (g) => typeof g === "string" && GUID.test(g);

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json(request, { error: "bad json" }, { status: 400, cache: 0 }); }
  if (!body || typeof body !== "object") return json(request, { error: "bad body" }, { status: 400, cache: 0 });

  const feeds = uniq((Array.isArray(body.feeds) ? body.feeds : []).filter(okGuid)).slice(0, MAX_FEEDS);
  const items = uniqPairs((Array.isArray(body.items) ? body.items : [])
    .filter((p) => Array.isArray(p) && okGuid(p[0]) && okGuid(p[1]))).slice(0, MAX_ITEMS);
  const publishers = uniq((Array.isArray(body.publishers) ? body.publishers : []).filter(okGuid)).slice(0, MAX_PUBLISHERS);

  if (!env.DB) return json(request, { error: "no database" }, { status: 503, cache: 0 });

  const out = { feeds: {}, items: {}, publishers: {} };

  // Items name a feed too; resolve those feeds for the row's show line.
  const feedSet = uniq([...feeds, ...items.map((p) => p[0])]);

  if (feedSet.length) {
    const { results } = await env.DB.prepare(
      `SELECT podcast_guid, title, image, artwork, medium, author
       FROM podcasts WHERE podcast_guid IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(feedSet)).all();
    for (const r of results ?? []) {
      out.feeds[r.podcast_guid] = feedRow(r, true);
    }
  }

  if (items.length) {
    const { results } = await env.DB.prepare(
      `SELECT item_guid, podcast_guid, title, image
       FROM episodes WHERE item_guid IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(uniq(items.map((p) => p[1])))).all();
    const byItem = new Map((results ?? []).map((r) => [r.item_guid, r]));
    for (const [feed, item] of items) {
      const r = byItem.get(item);
      // The pair is the identity: an item guid is unique only inside its feed,
      // so a row under another feed is not this favorite.
      if (!r || (r.podcast_guid && r.podcast_guid !== feed)) continue;
      out.items[feed + "|" + item] = itemRow(r, feed, true);
    }
  }

  if (publishers.length) {
    const { results } = await env.DB.prepare(
      `SELECT publisher_guid, title, image, artwork
       FROM publishers WHERE publisher_guid IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(publishers)).all();
    for (const r of results ?? []) {
      out.publishers[r.publisher_guid] = {
        title: r.title || null, image: r.image || null, artwork: r.artwork || null, medium: "publisher",
        href: r.title ? `/artist/${encodeURIComponent(r.publisher_guid)}` : null, indexed: true,
      };
    }
  }

  // Podcast Index, for what the index has never seen. Feeds first, then item
  // pairs, up to PI_MAX lookups in all.
  const key = env.PODCAST_INDEX_KEY;
  const secret = env.PODCAST_INDEX_SECRET;
  if (key && secret) {
    let budget = PI_MAX;
    const headers = await piHeaders(key, secret, "OnlyBoosts-Favorites/1.0");
    const opts = { timeoutMs: 4000, cacheTtl: 3600, maxBytes: PI_BYTES };

    for (const guid of feedSet) {
      if (budget <= 0) break;
      if (out.feeds[guid]) continue;
      budget--;
      const r = await piGet(`/podcasts/byguid?guid=${encodeURIComponent(guid)}`, headers, opts);
      const f = r?.feed;
      if (!f || typeof f !== "object" || !f.title) continue;
      out.feeds[guid] = feedRow({
        podcast_guid: guid, title: f.title, image: f.image || f.artwork || null,
        artwork: f.artwork && f.artwork !== f.image ? f.artwork : null,
        medium: typeof f.medium === "string" && f.medium ? f.medium : null, author: f.author || null,
      }, false);
    }

    for (const [feed, item] of items) {
      if (budget <= 0) break;
      if (out.items[feed + "|" + item]) continue;
      budget--;
      const r = await piGet(
        `/episodes/byguid?guid=${encodeURIComponent(item)}&podcastguid=${encodeURIComponent(feed)}`,
        headers, opts,
      );
      const e = r?.episode;
      if (!e || typeof e !== "object" || !e.title) continue;
      out.items[feed + "|" + item] = itemRow({
        item_guid: item, podcast_guid: feed, title: e.title, image: e.image || e.feedImage || null,
      }, feed, false);
    }
  }

  return json(request, out, { cache: 300 });
}

function feedRow(r, indexed) {
  const title = r.title || null;
  return {
    title,
    image: r.image || null,
    artwork: r.artwork || null,
    medium: r.medium || null,
    author: r.author || null,
    // A show with a page here links here; one the index cannot name links to
    // BMB, the podroll tiles' rule for a show we have no page for.
    href: indexed && title
      ? `/show/${encodeURIComponent(r.podcast_guid)}`
      : `https://boostmebitch.com/?podcast=${encodeURIComponent(r.podcast_guid)}`,
    indexed,
  };
}

function itemRow(r, feed, indexed) {
  const title = r.title || null;
  const bmb = `https://boostmebitch.com/?podcast=${encodeURIComponent(feed)}&episode=${encodeURIComponent(r.item_guid)}`;
  return {
    title,
    image: r.image || null,
    // The qualifying rule for an episode page is the TITLE (show-link.js#episodePageHref).
    href: indexed && title ? `/episode/${encodeURIComponent(r.item_guid)}` : bmb,
    indexed,
  };
}

function uniq(arr) { return [...new Set(arr)]; }
function uniqPairs(pairs) {
  const seen = new Set();
  const out = [];
  for (const p of pairs) {
    const k = p[0] + "|" + p[1];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([p[0], p[1]]);
  }
  return out;
}
