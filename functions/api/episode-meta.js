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

const PI_BASE = "https://api.podcastindex.org/api/1.0";
const PI_TIMEOUT_MS = 10_000;
const CHAPTERS_TIMEOUT_MS = 8_000;

// A chapters file is a list of {startTime,title} objects; the largest in the
// wild carry chapter art URLs and a few hundred rows and still land well under
// 100KB. 512KB is headroom, not a target.
const CHAPTERS_MAX_BYTES = 512 * 1024;

// The longest chapter list measured on a boosted feed is under 200 rows. The
// cap is a guard against a pathological file, not a page size.
const MAX_CHAPTERS = 400;

// Show notes. A full description is a few thousand characters; the caps are for
// the feed that pastes a transcript into <content:encoded>, which is a real
// thing publishers do. Truncation here is a cliff rather than PI's ellipsis, so
// the ceilings are set well past anything a reader would finish.
const NOTES_MAX_INPUT = 60_000;
const NOTES_MAX_CHARS = 20_000;
const NOTES_MAX_PARAGRAPHS = 80;

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

async function sha1Hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Podcast Index auth: X-Auth-Key + X-Auth-Date + Authorization=sha1(key+secret+date).
// Same scheme as /api/value; the keys never reach the browser.
async function piHeaders(key, secret) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    "User-Agent": "OnlyBoosts-Chapters/1.0",
    "X-Auth-Key": key,
    "X-Auth-Date": String(nowSec),
    Authorization: await sha1Hex(String(key) + String(secret) + String(nowSec)),
  };
}

async function piGet(path, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PI_TIMEOUT_MS);
  try {
    const resp = await fetch(PI_BASE + path, {
      headers,
      cf: { cacheTtl: 3600, cacheEverything: true },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

/* ── Show notes: publisher HTML → paragraphs of tokens ──────────────────────
 *
 * Podcast Index returns the longer of the feed's <description>,
 * <itunes:summary> and <content:encoded>, which means arbitrary
 * publisher-authored HTML. Three things this has to get right:
 *
 *   1. PARAGRAPHS SURVIVE. This is most of the reason the endpoint exists. The
 *      collector's clean_html collapses all whitespace, so D1's copy is one
 *      block; a real show note is a summary, then links, then boilerplate, and
 *      running them together is what makes the truncated version read badly.
 *   2. ANCHORS SURVIVE AS LINKS. A publisher writes "get the book here" with
 *      the URL only in the href, so stripping tags the way LB does loses the
 *      link entirely and leaves a sentence pointing at nothing.
 *   3. NOTHING BECOMES MARKUP. The output is a token tree the client turns into
 *      text nodes and anchors, never a string it could set as innerHTML.
 */
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", bull: "•", middot: "·", trade: "™",
  copy: "©", reg: "®", deg: "°", eacute: "é", euro: "€", pound: "£",
};
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Codepoints outside the Unicode range, and the surrogate block, come
      // back as the original text rather than throwing.
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return m;
      if (cp >= 0xd800 && cp <= 0xdfff) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

// Tags that end a paragraph. Everything else (<b>, <i>, <span>, <em>) is
// inline and contributes nothing but its text.
const BLOCK_TAG = /^(p|div|br|li|ul|ol|tr|table|h[1-6]|blockquote|section|article|pre|hr)$/;
const TAG_RE = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i;
const BARE_URL_RE = /https?:\/\/[^\s<>"']+/g;

function safeHref(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 2048) return null;
  const url = decodeEntities(raw).trim();
  // http(s) only, and never a scheme-relative or protocol-less string that a
  // browser would resolve somewhere unexpected.
  return /^https?:\/\//i.test(url) ? url : null;
}

/* One paragraph's plain text → tokens, linkifying bare URLs. Anchors are added
 * by the caller, which knows where they were; this only handles URLs a
 * publisher typed as text. */
function textTokens(text, out) {
  let cursor = 0;
  for (const m of text.matchAll(BARE_URL_RE)) {
    if (m.index > cursor) out.push({ t: "text", v: text.slice(cursor, m.index) });
    cursor = m.index + m[0].length;
    // A trailing sentence period belongs to the sentence, not the URL.
    const href = m[0].replace(/[.,;:)\]]+$/, "");
    const tail = m[0].slice(href.length);
    if (safeHref(href)) out.push({ t: "link", href, v: href });
    else out.push({ t: "text", v: href });
    if (tail) out.push({ t: "text", v: tail });
  }
  if (cursor < text.length) out.push({ t: "text", v: text.slice(cursor) });
}

function parseNotes(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const src = raw.slice(0, NOTES_MAX_INPUT);

  // Walk the tags. Text between them accumulates into the current paragraph,
  // either as free text or as the label of an open anchor.
  const paragraphs = [];
  let para = [];        // tokens for the paragraph being built
  let buf = "";         // plain text pending
  let href = null;      // the open anchor's target, if any
  let anchorText = "";

  const flushText = () => {
    if (!buf) return;
    // Runs of two or more newlines are the publisher's own paragraph breaks in
    // a plain-text description; a single one is a wrap and reads as a space.
    // Same rule LB applies to its stripped shownotes.
    const parts = decodeEntities(buf).split(/\n{2,}/);
    parts.forEach((part, i) => {
      if (i > 0) endPara();
      const t = part.replace(/[ \t\r\n]+/g, " ");
      if (t) textTokens(t, para);
    });
    buf = "";
  };
  const endPara = () => {
    // Adjacent text tokens are merged before anything else: a dropped anchor
    // (no label, or an unsafe href) leaves the text on either side of it split
    // in two, and rendering those separately puts a double space in the
    // sentence.
    const merged = [];
    for (const tok of para) {
      const prev = merged[merged.length - 1];
      if (tok.t === "text" && prev && prev.t === "text") prev.v += tok.v;
      else merged.push({ ...tok });
    }
    const tokens = [];
    for (const tok of merged) {
      if (tok.t === "text") {
        tok.v = tok.v.replace(/\s{2,}/g, " ");
        if (!tok.v.trim()) continue;
      }
      tokens.push(tok);
    }
    if (tokens.length) {
      // Trim the edges of the paragraph without disturbing the joins inside it.
      const first = tokens[0];
      if (first.t === "text") first.v = first.v.replace(/^\s+/, "");
      const last = tokens[tokens.length - 1];
      if (last.t === "text") last.v = last.v.replace(/\s+$/, "");
      paragraphs.push(tokens);
    }
    para = [];
  };

  let cursor = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src)) !== null) {
    const chunk = src.slice(cursor, m.index);
    if (href !== null) anchorText += chunk;
    else buf += chunk;
    cursor = m.index + m[0].length;

    const name = m[1].toLowerCase();
    const closing = m[0][1] === "/";

    if (name === "a") {
      if (closing) {
        if (href !== null) {
          const label = decodeEntities(anchorText).replace(/\s+/g, " ").trim();
          flushText();
          // An anchor with no text at all (an image link, usually) is dropped
          // rather than rendered as a bare href the publisher never wrote.
          if (label) para.push({ t: "link", href, v: label });
          href = null;
          anchorText = "";
        }
      } else {
        // A nested <a> is malformed; close the outer one first so its label is
        // not swallowed.
        if (href !== null) { const label = decodeEntities(anchorText).replace(/\s+/g, " ").trim(); if (label) para.push({ t: "link", href, v: label }); }
        const hm = m[0].match(HREF_RE);
        href = safeHref(hm ? (hm[1] ?? hm[2] ?? hm[3]) : null);
        anchorText = "";
        // An unsafe or missing href leaves the anchor's TEXT in the paragraph:
        // href stays null, so the label falls through to the plain-text path.
      }
      continue;
    }
    if (BLOCK_TAG.test(name)) {
      flushText();
      endPara();
    }
  }
  // The tail after the last tag, before the open-anchor flush rather than after
  // it: a description that ends inside an unclosed <a> carries that anchor's
  // label here, and checking the anchor first would push an empty link and then
  // print its text as loose prose.
  const tail = src.slice(cursor);
  if (href !== null) anchorText += tail;
  else buf += tail;
  flushText();
  if (href !== null) {
    const label = decodeEntities(anchorText).replace(/\s+/g, " ").trim();
    if (label) para.push({ t: "link", href, v: label });
  }
  endPara();

  // Bound the result by total characters as well as paragraph count, and cut
  // INSIDE a paragraph rather than only between them — a feed that pastes a
  // transcript into <content:encoded> can put the whole thing in one <p>, which
  // a paragraph-count cap would wave through.
  const out = [];
  let budget = NOTES_MAX_CHARS;
  for (const p of paragraphs) {
    if (out.length >= NOTES_MAX_PARAGRAPHS || budget <= 0) break;
    const kept = [];
    for (const tok of p) {
      if (budget <= 0) break;
      if (tok.v.length <= budget) { kept.push(tok); budget -= tok.v.length; continue; }
      // A link is kept whole or not at all: half a label under a full href is
      // worse than dropping it.
      if (tok.t === "text") kept.push({ t: "text", v: `${tok.v.slice(0, budget)}…` });
      budget = 0;
    }
    if (kept.length) out.push(kept);
  }
  return out;
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

  const headers = await piHeaders(key, secret);
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
