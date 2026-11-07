/**
 * POST /api/v1/feeds/resolve — name the podcasts behind a list of feed addresses.
 *
 * The OPML import's lookup (2026-11-07). A subscription list carries feed
 * URLs and a follow is keyed by `podcast:guid`, so each address has to become
 * a guid before it can go on a kind 10333 list. Reed's own Fountain export
 * measured 71 feeds: 55 matched the index by feed URL outright, 3 more were
 * shows the index holds under a DIFFERENT feed URL (which only Podcast Index
 * can say), 13 unknown. So the index is the fast path and PI's
 * `podcasts/byfeedurl` the authority.
 *
 *   body   { urls: [string] }                          (http(s), up to MAX_URLS)
 *   200    { feeds: { <url>: row | null } }
 *
 * A row is { guid, title, image, artwork, medium, feed, indexed }; `guid` is
 * null when PI holds the feed but assigns it no podcast:guid (nothing can
 * follow it). ⚠️ THREE STATES: a row, `null` (both sides answered: no such
 * feed), or ABSENT (not asked this time, or the ask failed). The browser
 * sends what came back absent again; it never calls an absent key "not
 * found" (assets/js/opml.js#sortOpmlAnswers).
 *
 * ⚠️ BOUNDED ON BOTH SIDES. The index side is one bound JSON array unrolled
 * by json_each (the follows endpoint's pattern). The PI side is at most
 * PI_MAX lookups a request, a few at a time, each through `piGet`'s timeout,
 * byte cap and edge cache, so a 500-feed file resolves over a handful of
 * requests rather than one 500-call burst.
 *
 * ⚠️ AN ADDRESS THAT LOOKS PRIVATE IS NOT LOOKED UP, HERE TOO. The browser
 * never sends one (opml.js#looksPrivate runs before anything leaves the
 * device), and the route refuses to depend on who is calling it: such an
 * address is left absent, and is neither bound into a D1 statement nor sent
 * to PI. POST and `no-store`: a subscription list is personal.
 */
import { json, preflight, corsHeaders } from "../_common.js";
import { piHeaders, piGet } from "../../../_shared/podcast-index.js";
import { opmlFeedUrl, looksPrivate } from "../../../../assets/js/opml.js";

export const MAX_URLS = 200;
export const PI_MAX = 40;
const PI_PARALLEL = 6;
const PI_BYTES = 256 * 1024;

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json(request, { error: "bad json" }, { status: 400, cache: 0 }); }
  if (!body || typeof body !== "object" || !Array.isArray(body.urls)) return json(request, { error: "urls required" }, { status: 400, cache: 0 });

  // As given → normalized; the answer is keyed by the address AS GIVEN, which
  // is what the browser keyed its plan by.
  const asked = new Map();
  for (const raw of body.urls) {
    if (typeof raw !== "string" || asked.has(raw)) continue;
    const url = opmlFeedUrl(raw);
    if (!url || looksPrivate(url)) continue;
    asked.set(raw, url);
    if (asked.size >= MAX_URLS) break;
  }
  if (!env.DB) return json(request, { error: "no database" }, { status: 503, cache: 0 });

  const feeds = {};
  const pending = new Map(asked); // raw → normalized, still unanswered

  // 1. The index, by feed URL, on the spellings a feed goes by: as given, the
  //    other scheme, with and without the trailing slash. One statement.
  const variants = new Map(); // variant → [raw]
  for (const [raw, url] of pending) {
    for (const v of spellings(url)) {
      if (!variants.has(v)) variants.set(v, []);
      variants.get(v).push(raw);
    }
  }
  if (variants.size) {
    const { results } = await env.DB.prepare(
      `SELECT podcast_guid, title, image, artwork, medium, feed_url
       FROM podcasts WHERE feed_url IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify([...variants.keys()])).all();
    for (const r of results ?? []) {
      for (const raw of variants.get(r.feed_url) ?? []) {
        if (!pending.has(raw)) continue;
        pending.delete(raw);
        feeds[raw] = row({
          guid: r.podcast_guid, title: r.title, image: r.image, artwork: r.artwork,
          medium: r.medium, feed: r.feed_url,
        }, true);
      }
    }
  }

  // 2. Podcast Index for the rest, PI_MAX of them, a few at a time.
  const key = env.PODCAST_INDEX_KEY;
  const secret = env.PODCAST_INDEX_SECRET;
  if (key && secret && pending.size) {
    const headers = await piHeaders(key, secret, "OnlyBoosts-OPML/1.0");
    const opts = { timeoutMs: 5000, cacheTtl: 3600, maxBytes: PI_BYTES };
    const queue = [...pending].slice(0, PI_MAX);
    const worker = async () => {
      while (queue.length) {
        const [raw, url] = queue.shift();
        const r = await piGet(`/podcasts/byfeedurl?url=${encodeURIComponent(url)}`, headers, opts);
        if (r === null) continue; // the ask failed: leave it absent
        const f = r?.feed;
        if (!f || typeof f !== "object" || Array.isArray(f) || !(f.title || f.id)) { feeds[raw] = null; continue; }
        feeds[raw] = row({
          guid: typeof f.podcastGuid === "string" && f.podcastGuid ? f.podcastGuid : null,
          title: f.title, image: f.image || f.artwork || null,
          artwork: f.artwork && f.artwork !== f.image ? f.artwork : null,
          medium: typeof f.medium === "string" && f.medium ? f.medium : null,
          feed: typeof f.url === "string" && f.url ? f.url : url,
        }, false);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PI_PARALLEL, queue.length) }, worker));
  }

  return new Response(JSON.stringify({ feeds }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(request) },
  });
}

function row(r, indexed) {
  return {
    guid: r.guid || null,
    title: r.title || null,
    image: r.image || null,
    artwork: r.artwork || null,
    medium: r.medium || null,
    feed: r.feed || null,
    indexed,
  };
}

/** The spellings one feed address goes by in the wild. */
export function spellings(url) {
  const out = new Set([url]);
  const other = url.startsWith("https://") ? "http://" + url.slice(8) : "https://" + url.slice(7);
  out.add(other);
  for (const u of [url, other]) {
    if (u.endsWith("/")) out.add(u.slice(0, -1)); else out.add(u + "/");
  }
  return [...out];
}
