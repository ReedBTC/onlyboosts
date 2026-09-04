// A show's whole episode catalogue, from Podcast Index, for the /show page's
// episode drawer.
//
// WHY THIS EXISTS. The drawer is server-rendered from D1's `episodes` table,
// which holds only the episodes carrying an indexed boost — a small slice of
// most shows' output (LINUX Unplugged: 64 rows against 676 in its feed). Until
// 2026-09-04 that made an episode nobody had boosted yet un-boostable here: the
// reader had to go to Fountain or Boost Me Bitch to send the first one. This
// Function is the list those episodes hang their Boost buttons on. Boosting one
// needs nothing else this site does not already have — /api/value resolves a
// value block for any item guid, indexed or not — and the boost's note is picked
// up by the collector on the next cycle, which is what creates the episode's
// page. See "The Catalogue" in docs/show-pages-spec.md.
//
// ⚠️ NOTHING HERE TOUCHES D1 AND NOTHING IS STORED. Podcast Index's catalogue is
// PI's fact, not ours; it is projected to five fields, edge-cached for an hour
// per colo, and merged in the browser onto the rows the edge rendered. That is a
// deliberate exception to the rendering rule (the facts rendered by JavaScript
// are not the site's facts, and the indexed rows still ship in the HTML), and
// the spec section above writes it down.
//
// GET /api/catalogue?podcastGuid=<guid>[&feedUrl=<url>]
//   → { episodes: [ { guid, title, date, dur, img } ], truncated }
//   → { episodes: [], truncated: false, reason: "…" }
//
// `truncated` is true when the answer hit PI's ceiling for one call (1,000
// items; there is no offset parameter, so an item past it is unreachable).
// Every failure answers 200 with an empty list, on /api/episode-meta's
// argument: the list is strictly additive to a page whose subject is boosts,
// and a 500 here is a broken drawer on a page that is otherwise fine.
//
// ⚠️ THIS IS NOT A MONEY PATH. It borrows /api/value's Podcast Index auth
// through _shared/podcast-index.js, the way /api/episode-meta does, and stays
// separate from that endpoint for the reason written at the top of the shared
// module: a metadata lookup must never share a code path with value-block
// resolution.

import { piHeaders, piGet } from "../_shared/podcast-index.js";

// PI's ceiling for one episodes call. `max` is the only lever the endpoint
// offers, so this is also the most any reader can be shown.
export const PI_EPISODE_MAX = 1000;

// The upstream body is bounded. Without `fulltext` PI cuts every description to
// 100 words, so a 1,000-item answer measures low single-digit megabytes; 8MB is
// headroom over that, not a target. Past it the body is abandoned mid-stream
// and the lookup answers as a miss.
export const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;

// Matches the bound on functions/show/[guid].js — the same guids reach both.
const GUID_MAX = 400;
const FEED_URL_MAX = 2048;

// A reader is waiting behind this one (the drawer shows a loading line), so it
// is shorter than /api/episode-meta's 10s and longer than the show page's
// render-path 2.5s.
const TIMEOUT_MS = 6_000;

const ALLOWED_ORIGINS = new Set([
  "https://onlyboosts.social",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

// Exact-match lookup, never startsWith — a prefix check lets a lookalike
// origin get reflected into Access-Control-Allow-Origin.
function pickCorsOrigin(originHeader) {
  return (typeof originHeader === "string" && ALLOWED_ORIGINS.has(originHeader))
    ? originHeader : "https://onlyboosts.social";
}

function headersFor(request, extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": pickCorsOrigin(request.headers.get("Origin")),
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

// The browser may hold a good answer ten minutes; a catalogue changes when an
// episode airs, which is daily at the very most. Longer than that and a reader
// who just watched a new episode land in their app would open the drawer and
// not find it.
const CACHE_OK = "public, max-age=600";
// A miss is retried on the next open rather than remembered.
const CACHE_MISS = "no-store";

function empty(request, reason, status = 200) {
  return new Response(JSON.stringify({ episodes: [], truncated: false, reason }), {
    status,
    headers: headersFor(request, { "Cache-Control": CACHE_MISS }),
  });
}

// One PI episode → the five fields a drawer row needs. Everything else PI
// sends (descriptions, enclosures, transcripts, value blocks) is dropped here,
// which is what turns PI's multi-megabyte answer into ~100 bytes a row. Every
// field is coerced: these are third-party values and the browser builds DOM
// nodes from them, never markup, but a number that arrives as a string still
// has to sort.
export function projectEpisode(e) {
  if (!e || typeof e !== "object") return null;
  const guid = typeof e.guid === "string" ? e.guid.trim() : "";
  if (!guid || guid.length > GUID_MAX) return null;
  const date = Number(e.datePublished);
  const dur = Number(e.duration);
  const img = typeof e.image === "string" && /^https?:\/\//i.test(e.image) && e.image.length <= 2048
    ? e.image : "";
  return {
    guid,
    title: typeof e.title === "string" ? e.title.trim().slice(0, 500) : "",
    date: Number.isFinite(date) && date > 0 ? Math.floor(date) : 0,
    dur: Number.isFinite(dur) && dur > 0 ? Math.floor(dur) : 0,
    img,
  };
}

// Newest first, undated last, then guid so the order is total and a cached
// answer and a fresh one agree. Duplicated guids (a feed that repeats one) keep
// the first occurrence.
export function projectCatalogue(items) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const ep = projectEpisode(raw);
    if (!ep || seen.has(ep.guid)) continue;
    seen.add(ep.guid);
    out.push(ep);
  }
  out.sort((a, b) => {
    if (!a.date !== !b.date) return a.date ? -1 : 1;
    return b.date - a.date || (a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0);
  });
  return out;
}

// PI's episodes/bypodcastguid is one call and the usual path. A show PI keys
// only by feed id (older records) answers with nothing there, so the fallback
// is the route /api/value takes: resolve the feed id, then episodes/byfeedid.
async function fetchItems(headers, podcastGuid, feedUrl) {
  const opts = { timeoutMs: TIMEOUT_MS, maxBytes: MAX_UPSTREAM_BYTES };
  const byGuid = await piGet(
    `/episodes/bypodcastguid?guid=${encodeURIComponent(podcastGuid)}&max=${PI_EPISODE_MAX}`,
    headers, opts,
  );
  if (Array.isArray(byGuid?.items) && byGuid.items.length) return byGuid.items;

  const feed = await piGet(`/podcasts/byguid?guid=${encodeURIComponent(podcastGuid)}`, headers, opts);
  let feedId = Number(feed?.feed?.id);
  if (!Number.isInteger(feedId) || feedId <= 0) {
    if (!feedUrl) return Array.isArray(byGuid?.items) ? byGuid.items : null;
    const byUrl = await piGet(`/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`, headers, opts);
    feedId = Number(byUrl?.feed?.id);
    if (!Number.isInteger(feedId) || feedId <= 0) return Array.isArray(byGuid?.items) ? byGuid.items : null;
  }
  const byId = await piGet(`/episodes/byfeedid?id=${feedId}&max=${PI_EPISODE_MAX}`, headers, opts);
  if (Array.isArray(byId?.items)) return byId.items;
  return Array.isArray(byGuid?.items) ? byGuid.items : null;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const podcastGuid = (url.searchParams.get("podcastGuid") || "").trim();
  const feedUrlRaw = (url.searchParams.get("feedUrl") || "").trim();

  if (!podcastGuid) return empty(request, "podcastGuid required", 400);
  if (podcastGuid.length > GUID_MAX) return empty(request, "podcastGuid too long", 400);

  let feedUrl = "";
  if (feedUrlRaw && feedUrlRaw.length <= FEED_URL_MAX) {
    try {
      const u = new URL(feedUrlRaw);
      if ((u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password) feedUrl = u.toString();
    } catch { /* an unparseable feed URL is simply no fallback */ }
  }

  const key = env.PODCAST_INDEX_KEY;
  const secret = env.PODCAST_INDEX_SECRET;
  if (!key || !secret) return empty(request, "podcast index not configured", 503);

  const headers = await piHeaders(key, secret, "OnlyBoosts-Catalogue/1.0");
  const items = await fetchItems(headers, podcastGuid, feedUrl);
  if (!items) return empty(request, "podcast index unavailable");

  const episodes = projectCatalogue(items);
  return new Response(JSON.stringify({ episodes, truncated: items.length >= PI_EPISODE_MAX }), {
    headers: headersFor(request, { "Cache-Control": CACHE_OK }),
  });
}

// Pages routes by method; a HEAD with no handler falls through to the static
// lookup and 404s for a URL whose GET is fine. See CLAUDE.md.
export async function onRequestHead(ctx) {
  const resp = await onRequestGet(ctx);
  return new Response(null, { status: resp.status, headers: resp.headers });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": pickCorsOrigin(request.headers.get("Origin")),
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
