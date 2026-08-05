// Live Podcast Index lookup for /episode/<item-guid>: chapters and full show
// notes, both of which the page cannot get from its own data.
//
// ONE UPSTREAM CALL SERVES BOTH. Podcast Index's episodes/byguid returns the
// episode object, which carries `chaptersUrl` and `description`; this Function
// fetches the chapters file that URL points at and cleans the description into
// paragraphs. Two problems with one shape:
//
//   CHAPTERS — `<podcast:chapters>` points at a per-episode JSON file, and
//   neither the URL nor the file is in our data at all. The collector stores an
//   episode's title, art, air date, duration, enclosure and description; it has
//   never stored a chapters URL.
//
//   ⚠️ SHOW NOTES — the collector DOES store a description, and it is
//   TRUNCATED. Podcast Index cuts text fields to 100 words unless the request
//   carries `fulltext`, which enrich.py does not send, so D1 holds a ~1,000
//   character prefix of every episode's notes. Measured over 2,218 episodes in
//   the live index: median 590 characters, maximum 1,055, and 0.6% cut
//   mid-sentence. That is why the drawer's text is REPLACED from here rather
//   than merely being decorated: this call asks for `fulltext` and gets the
//   whole thing. The collector could fix it at source by adding the parameter,
//   which would make the notes half of this endpoint unnecessary; the chapters
//   half would still be needed.
//
// Both hops are edge-cached and the whole thing is off the page's critical
// path. The page server-renders D1's truncated notes and swaps in these, so a
// reader with no JavaScript still gets notes; chapters are the one thing on
// that page which genuinely needs it.
//
// ⚠️ THIS IS NOT A MONEY PATH, unlike its neighbour /api/value, but it borrows
// that file's Podcast Index auth and feed-id resolution verbatim. The two are
// separate deliberately: a metadata lookup must never share a code path with
// value-block resolution, where a wrong answer moves sats.
//
// GET /api/episode-meta?guid=<item_guid>[&podcastGuid=][&feedUrl=][&feedId=]
//   → { chapters: [ { start, title } ], notes: [ [ token, … ], … ] }
//   → { chapters: [], notes: [], reason: "…" }
//
// ⚠️ NOTES ARE A TOKEN TREE, NOT HTML, and that is the point: the client builds
// text nodes and anchors with DOM calls, so nothing this endpoint returns can
// reach innerHTML. Each paragraph is an array of { t: "text", v } and
// { t: "link", href, v } tokens. Returning cleaned HTML would be one innerHTML
// away from a third-party description being able to write markup into the page.
//
// Both fields are strictly additive, so EVERY failure answers 200 with empty
// ones. A 500 here would be a broken drawer on a page whose subject is boosts.

// The Podcast Index auth and the description parser both live in _shared now:
// /show/<guid> asks the same API for a show's description and renders it
// through the same token tree. Both were moved out of this file verbatim.
import { piHeaders, piGet } from "../_shared/podcast-index.js";
import { parseNotes } from "../_shared/rich-text.js";

const CHAPTERS_TIMEOUT_MS = 8_000;

// A chapters file is a list of {startTime,title} objects; the largest in the
// wild carry chapter art URLs and a few hundred rows and still land well under
// 100KB. 512KB is headroom, not a target.
const CHAPTERS_MAX_BYTES = 512 * 1024;

// The longest chapter list measured on a boosted feed is under 200 rows. The
// cap is a guard against a pathological file, not a page size.
const MAX_CHAPTERS = 400;

// Matches the bound on functions/episode/[guid].js — the same guids reach both.
const GUID_MAX = 400;

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

// The chapters URL comes out of Podcast Index, which means it is a
// publisher-controlled string reaching an outbound fetch. http(s) only, no
// embedded credentials, bounded length.
function safeChaptersUrl(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Stream the body, bailing once cumulative bytes exceed the cap. resp.text()
// buffers the whole thing before the size can be checked — the same shape as
// readBounded() in functions/api/data/[[path]].js, which is the reference.
async function readBounded(resp, ctrl) {
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const text = await resp.text();
    return text.length > CHAPTERS_MAX_BYTES ? null : text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > CHAPTERS_MAX_BYTES) {
      try { ctrl.abort(); } catch {}
      try { reader.cancel(); } catch {}
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder("utf-8").decode(buf);
}

/* The chapters file → [{ start, title }], sorted by start.
 *
 * UNTITLED ENTRIES ARE DROPPED, and so are `toc: false` ones. Both are markers
 * rather than chapters — ad boundaries, segment cues, an audio-only art change
 * — and a row with a timestamp and no label is a seek button that says nothing
 * about where it lands. Same rule LB applies; see renderChaptersDisclosure in
 * lb/main:functions/_middleware.js.
 */
function normalizeChapters(data) {
  const list = Array.isArray(data?.chapters) ? data.chapters : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    if (c.toc === false) continue;
    const start = Number(c.startTime);
    const title = typeof c.title === "string" ? c.title.trim() : "";
    if (!title || !Number.isFinite(start) || start < 0) continue;
    out.push({ start: Math.floor(start), title: title.slice(0, 200) });
  }
  out.sort((a, b) => a.start - b.start);
  return out.slice(0, MAX_CHAPTERS);
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": pickCorsOrigin(request.headers.get("Origin") || ""),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Two cache lives, and the difference is whether we learned anything. A
  // resolved answer (rows, or a feed that genuinely publishes no chapters) is
  // stable for hours; a timeout or an upstream error is not an answer at all
  // and must not be cached as one. Same principle as the podroll collector's
  // rule that only a clean read may overwrite a stored list.
  const answer = (body, maxAge) => new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
  // ⚠️ `notes` DEFAULTS TO THE FIELD BEING ABSENT, not to an empty array, and
  // the client depends on it: an empty array would mean "this episode has no
  // notes" and would blank the truncated set the server already rendered, where
  // a missing field means "we did not learn anything, keep what you have".
  const none = (reason, maxAge = 21600, extra = {}) =>
    answer({ chapters: [], reason, ...extra }, maxAge);

  const params = new URL(request.url).searchParams;
  const guid = params.get("guid");
  if (!guid || guid.length > GUID_MAX) {
    return new Response(JSON.stringify({ error: "guid required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const key = env.PODCAST_INDEX_KEY;
  const secret = env.PODCAST_INDEX_SECRET;
  // Not configured is a deployment fact, not an answer about this episode —
  // 503 so it reads as our failure in a log rather than as "no chapters".
  if (!key || !secret) {
    return new Response(JSON.stringify({ error: "Podcast Index not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const podcastGuid = params.get("podcastGuid");
  const feedUrl = params.get("feedUrl");
  let feedId = params.get("feedId");
  if (feedId && !/^\d+$/.test(feedId)) feedId = null;

  const headers = await piHeaders(key, secret, "OnlyBoosts-Chapters/1.0");
  // ⚠️ `fulltext` IS WHAT MAKES THE NOTES WHOLE. Without it Podcast Index cuts
  // every text field to 100 words, which is exactly the truncation D1 inherited
  // from the collector. It is a valueless parameter — its presence is the flag.
  const epQuery = `/episodes/byguid?fulltext&guid=${encodeURIComponent(guid)}`;

  // Ask for the episode by the cheapest identifier we hold. podcastguid is one
  // hop where a feed id has to be resolved first, so it is tried first and the
  // feed-id path is the fallback — an unsupported parameter comes back without
  // an episode, which is indistinguishable from a miss and lands in the same
  // place.
  let ep = null;
  if (podcastGuid) {
    const r = await piGet(`${epQuery}&podcastguid=${encodeURIComponent(podcastGuid)}`, headers);
    ep = r?.episode || null;
  }
  if (!ep && !feedId) feedId = await resolveFeedId({ podcastGuid, feedUrl, headers });
  if (!ep && feedId) {
    const r = await piGet(`${epQuery}&feedid=${encodeURIComponent(feedId)}`, headers);
    ep = r?.episode || null;
  }
  if (!ep) return none("episode not found in Podcast Index");

  // The notes are already in hand at this point — they came back on the episode
  // object — so they ride every exit below rather than being lost when the
  // chapters half fails. The two halves of this response are independent.
  const notes = parseNotes(ep.description);

  const url = safeChaptersUrl(ep.chaptersUrl);
  // The common case by a wide margin: about half the feeds in this index
  // publish chapters at all, and a feed that publishes them does not
  // necessarily do so on every episode.
  if (!url) return none("no chapters published for this episode", 21600, { notes });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAPTERS_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "OnlyBoosts-Chapters/1.0", Accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true },
      signal: ctrl.signal,
    });
    if (!resp.ok) return none("chapters file unavailable", 300, { notes });

    const cl = parseInt(resp.headers.get("content-length") || "", 10);
    if (Number.isFinite(cl) && cl > CHAPTERS_MAX_BYTES) return none("chapters file too large", 21600, { notes });

    const text = await readBounded(resp, ctrl);
    if (text === null) return none("chapters file too large", 21600, { notes });

    let data = null;
    try { data = JSON.parse(text); } catch { return none("chapters file was not JSON", 21600, { notes }); }

    const chapters = normalizeChapters(data);
    if (!chapters.length) return none("chapters file had no titled entries", 21600, { notes });
    return answer({ chapters, notes }, 21600);
  } catch (err) {
    // A timeout means we failed to read the file, not that there is nothing in
    // it, so this is the short cache. The notes still ride along: they came off
    // the episode object and have nothing to do with why this failed.
    return none(err?.name === "AbortError" ? "chapters fetch timed out" : "chapters fetch failed", 300, { notes });
  } finally {
    clearTimeout(timer);
  }
}

// podcastGuid first: it is a stable identifier where a feed URL can move.
// Lifted from /api/value, which resolves the same id for the same reason —
// the OnlyBoosts data feed carries a show's guid and RSS URL but not Podcast
// Index's numeric feed id.
async function resolveFeedId({ podcastGuid, feedUrl, headers }) {
  if (podcastGuid) {
    const r = await piGet(`/podcasts/byguid?guid=${encodeURIComponent(podcastGuid)}`, headers);
    const id = r?.feed?.id ?? null;
    if (id) return String(id);
  }
  if (feedUrl) {
    let ok = false;
    try {
      const u = new URL(feedUrl);
      ok = (u.protocol === "http:" || u.protocol === "https:") && feedUrl.length <= 2048;
    } catch {}
    if (ok) {
      const r = await piGet(`/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`, headers);
      const id = r?.feed?.id ?? null;
      if (id) return String(id);
    }
  }
  return null;
}
