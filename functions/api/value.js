// Value-block resolver for every boost surface on the site.
//
// ⚠️ THE SHOW'S OWN RSS IS THE SOURCE, AND PODCAST INDEX IS THE FALLBACK
// (2026-09-23; it was the other way round from the day this Function
// shipped). A publisher edits their feed and PI's episode records keep the
// block each song was ingested with: measured on Jimmy V's collection, the
// feed declares one channel block and no item blocks, and PI answered ten of
// thirteen songs with a stale seven-leg block (Fountain Boostbot at 1%, a leg
// with a custom value the feed no longer names). Every song boost from here
// paid it. The site's rule is that an external boost pays exactly what the
// show published, and only the feed says what that is. PI cannot even tell an
// item's own block from a copy of the feed's: it labels both `episode`.
//
// So: fetch the feed (bounded: wall clock, byte cap, streamed read), read the
// item's block, then the channel's. PI answers only when the feed is
// unreachable, is not RSS, or carries no <podcast:value> at all — the Anchor
// and Spotify case that made PI the source in the first place, where PI holds
// a block the feed never publishes — or when a truncated feed leaves the item
// unread. Resolved server-side because PI's credentials must stay off the
// browser (Cloudflare env: PODCAST_INDEX_KEY / PODCAST_INDEX_SECRET) and
// because a third-party feed has no CORS headers. The design record is *The
// Value Block Comes From The RSS* in docs/money-paths.md.
//
// Returns a normalized value block:
//   { level: 'episode'|'feed', source: 'rss'|'pi', value: { model, recipients:
//     [ {name,type,address,split,customKey?,customValue?,fee} ] } }
// or { value: null } when neither source has a payable block.

const PI_BASE = "https://api.podcastindex.org/api/1.0";
const FETCH_TIMEOUT_MS = 10_000;

// The feed fetch. A reader is waiting behind this one, so the clock is the
// catalogue's 6s rather than PI's 10s. The cap follows the collector's podroll
// pass (streamed and abandoned): a channel block sits in the head, and an item
// past the cap is reported as unread rather than absent, so PI still answers
// for it. One indexed feed is 50MB; nothing here needs all of it.
const RSS_TIMEOUT_MS = 6_000;
const RSS_MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED_ORIGINS = new Set([
  "https://onlyboosts.social",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function pickCorsOrigin(originHeader) {
  return (typeof originHeader === "string" && ALLOWED_ORIGINS.has(originHeader))
    ? originHeader : "https://onlyboosts.social";
}

async function sha1Hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Podcast Index auth: X-Auth-Key + X-Auth-Date + Authorization=sha1(key+secret+date).
async function piHeaders(key, secret) {
  const nowSec = Math.floor(Date.now() / 1000);
  const auth = await sha1Hex(String(key) + String(secret) + String(nowSec));
  return {
    "User-Agent": "OnlyBoosts-Value/1.0",
    "X-Auth-Key": key,
    "X-Auth-Date": String(nowSec),
    Authorization: auth,
  };
}

async function piGet(path, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(PI_BASE + path, {
      headers,
      cf: { cacheTtl: 600, cacheEverything: true },
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

// ---------------------------------------------------------------------------
// The RSS side.
//
// Regex, not an XML parser: Workers have no DOMParser, and this is third-party
// markup read from a deliberately truncated prefix, the same shape the
// collector's podroll and publisher passes take. Every tag is matched on its
// local name with any namespace prefix, since feeds bind the podcast
// namespace to whatever prefix they like.

const NS = "(?:[A-Za-z0-9_-]+:)?";

function decodeEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function stripCdata(str) {
  return String(str).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function parseAttrs(tag) {
  const out = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}
// Remove every <name>…</name> block (and self-closing <name/>) from a fragment.
function stripBlocks(frag, name) {
  const re = new RegExp(`<${NS}${name}(?=[\\s>/])[^>]*?/>|<${NS}${name}(?=[\\s>/])[\\s\\S]*?</${NS}${name}\\s*>`, "gi");
  return frag.replace(re, "");
}

// The first <podcast:value> element of a fragment, depth-aware: a
// valueTimeSplit nests a second <podcast:value> inside the first, so a
// non-greedy match to the first close tag would hand back half a block.
// Returns { attrs, inner } or null.
function firstValueElement(frag) {
  const tok = new RegExp(`<(/?)${NS}value(?=[\\s>/])([^>]*)>`, "gi");
  let m, depth = 0, start = -1, attrs = null;
  while ((m = tok.exec(frag))) {
    const closing = m[1] === "/";
    const selfClosing = !closing && /\/\s*$/.test(m[2]);
    if (start < 0) {
      if (closing) continue;
      if (selfClosing) return null;      // <podcast:value/> declares nothing
      start = tok.lastIndex; attrs = parseAttrs(m[2]); depth = 1;
      continue;
    }
    if (closing) { depth -= 1; if (depth === 0) return { attrs, inner: frag.slice(start, m.index) }; }
    else if (!selfClosing) depth += 1;
  }
  return null;
}

// One <podcast:value> block → the PI shape normalizeValue already reads, so
// both sources come out identical. Time splits are cut out first: their
// recipients belong to a window of the episode, not to the boost.
function valueFromXml(frag) {
  const el = firstValueElement(frag);
  if (!el) return null;
  const body = stripBlocks(el.inner, "valueTimeSplit");
  const destinations = [];
  const re = new RegExp(`<${NS}valueRecipient(?=[\\s>/])([^>]*)>`, "gi");
  let m;
  while ((m = re.exec(body))) {
    const a = parseAttrs(m[1]);
    destinations.push({ name: a.name, type: a.type, address: a.address, split: a.split,
      customKey: a.customKey, customValue: a.customValue, fee: /^true$/i.test(a.fee || "") });
  }
  const model = {};
  if (el.attrs.type) model.type = el.attrs.type;
  if (el.attrs.method) model.method = el.attrs.method;
  if (el.attrs.suggested) model.suggested = el.attrs.suggested;
  return normalizeValue({ model, destinations });
}

// The channel's own markup: the document with every <item> and <liveItem>
// cut out. Not "everything before the first item": Sovereign Feeds writes a
// liveItem ABOVE the channel block, and a channel block after the last item is
// legal RSS. An item the cap left unclosed survives the strip, so the
// fragment is cut at the first opening tag still standing; anything after it
// is half an item.
function channelXml(xml) {
  const s = stripBlocks(stripBlocks(xml, "item"), "liveItem");
  const cut = s.search(new RegExp(`<${NS}(?:item|liveItem)(?=[\\s>/])`, "i"));
  return cut < 0 ? s : s.slice(0, cut);
}

// Read the feed's answer for one item guid (or the channel alone, with none).
//   { channel: value|null, item: value|null, itemFound: bool, truncated: bool }
// An item whose closing tag never arrived (the cap) is not found; the caller
// reads `truncated` to tell "not published" from "not read".
export function readRssValue(xml, itemGuid, truncated = false) {
  const out = { channel: null, item: null, itemFound: false, truncated };
  if (!/<channel(?=[\s>])/i.test(xml)) return null;      // not RSS at all
  if (itemGuid) {
    const want = String(itemGuid).trim();
    const re = /<item(?=[\s>])[\s\S]*?<\/item\s*>/gi;
    let m;
    while ((m = re.exec(xml))) {
      const g = /<guid(?=[\s>])[^>]*>([\s\S]*?)<\/guid\s*>/i.exec(m[0]);
      if (!g) continue;
      if (decodeEntities(stripCdata(g[1])).trim() !== want) continue;
      out.itemFound = true;
      out.item = valueFromXml(m[0]);
      break;
    }
  }
  out.channel = valueFromXml(channelXml(xml));
  return out;
}

// Fetch the feed, bounded three ways. Null when it cannot be read as RSS;
// otherwise readRssValue's answer, with `truncated` set if the cap cut it.
async function fetchRssValue(feedUrl, itemGuid) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RSS_TIMEOUT_MS);
  try {
    const resp = await fetch(feedUrl, {
      headers: { "User-Agent": "OnlyBoosts-Value/1.0", Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
      cf: { cacheTtl: 600, cacheEverything: true },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const reader = resp.body?.getReader?.();
    let text, truncated = false;
    if (!reader) {
      text = await resp.text();
      if (text.length > RSS_MAX_BYTES) { text = text.slice(0, RSS_MAX_BYTES); truncated = true; }
    } else {
      const chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value); total += value.byteLength;
        if (total >= RSS_MAX_BYTES) { truncated = true; try { reader.cancel(); } catch {} break; }
      }
      const buf = new Uint8Array(total); let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
      text = new TextDecoder("utf-8").decode(buf.subarray(0, RSS_MAX_BYTES));
    }
    return readRssValue(text, itemGuid, truncated);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The Podcast Index side.

// PI value shape is { model:{type,method,suggested}, destinations:[...] }.
// Normalize destinations → recipients, keeping only payable node/lnaddress
// legs with a positive split. Returns null when nothing payable remains.
function normalizeValue(v) {
  if (!v || !Array.isArray(v.destinations)) return null;
  const recipients = [];
  for (const d of v.destinations) {
    const type = (d.type || "").trim();
    const address = (d.address || "").trim();
    const split = Number(d.split);
    if (type !== "node" && type !== "lnaddress") continue;
    if (!address || !Number.isFinite(split) || split <= 0) continue;
    const rec = { name: (d.name || "").trim(), type, address, split, fee: d.fee === true };
    if (d.customKey && d.customValue) { rec.customKey = String(d.customKey); rec.customValue = String(d.customValue); }
    recipients.push(rec);
  }
  if (recipients.length === 0) return null;
  return { model: v.model || null, recipients };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": pickCorsOrigin(origin),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const key = env.PODCAST_INDEX_KEY;
  const secret = env.PODCAST_INDEX_SECRET;
  if (!key || !secret) {
    return new Response(JSON.stringify({ error: "Podcast Index not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const params = new URL(request.url).searchParams;
  let feedId = params.get("feedId");
  const guid = params.get("guid");
  // The OnlyBoosts data feed carries a show's RSS URL and podcast guid but not
  // Podcast Index's numeric feed id, so callers may pass either of those
  // instead and we resolve the id here. Doing it server-side keeps the PI
  // credentials off the client and lets the lookup share this Function's
  // edge cache.
  const feedUrl = params.get("feedUrl");
  const podcastGuid = params.get("podcastGuid");

  if (!feedId && !feedUrl && !podcastGuid) {
    return new Response(JSON.stringify({ error: "feedId, feedUrl or podcastGuid required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (feedId && !/^\d+$/.test(feedId)) {
    return new Response(JSON.stringify({ error: "feedId must be numeric" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const headers = await piHeaders(key, secret);
  const json = (body) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });

  // Same rule as /api/catalogue: http(s), bounded, and no credentials in it.
  // The URL reaches a third-party host AND an upstream API, so it is checked
  // once here and trusted below.
  let rssUrl = null;
  if (feedUrl) {
    try {
      const u = new URL(feedUrl);
      if ((u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && feedUrl.length <= 2048) rssUrl = feedUrl;
    } catch {}
  }

  // PI's record for this feed, resolved once and only when something below
  // needs it. ⚠️ THE FEED URL RESOLVES BEFORE THE GUID (2026-09-06; it was
  // the other way round, on the argument that a guid is stable where a URL
  // can move). The URL moving is exactly the case that broke: Podcast Index
  // keeps ONE feed per podcastGuid for `byguid`, and after Stacker News Live
  // moved hosts in August 2025 that was the dead Anchor record, whose value
  // block is a year old (a keysend split of 95/4/1 where the live feed
  // declares 98/2). The collector stores the live feed's URL once it resolves
  // the move (enrich.resolve_show), so the URL the page passes names the
  // record that carries the show's current splits. The guid is the fallback
  // for a URL PI does not know; a stale stored URL resolves to the same
  // record the guid does. Restated in docs/money-paths.md.
  let piRecord;   // { id, url } | null, undefined until asked
  async function resolvePi() {
    if (piRecord !== undefined) return piRecord;
    piRecord = null;
    if (feedId) {
      const r = await piGet(`/podcasts/byfeedid?id=${encodeURIComponent(feedId)}`, headers);
      piRecord = { id: feedId, url: r?.feed?.url || null, feed: r?.feed || null };
      return piRecord;
    }
    let r = null;
    if (rssUrl) r = await piGet(`/podcasts/byfeedurl?url=${encodeURIComponent(rssUrl)}`, headers);
    if (!(r?.feed?.id) && podcastGuid) r = await piGet(`/podcasts/byguid?guid=${encodeURIComponent(podcastGuid)}`, headers);
    if (r?.feed?.id) piRecord = { id: String(r.feed.id), url: r.feed.url || null, feed: r.feed };
    return piRecord;
  }

  // 1) The feed itself. A caller that passed no URL (a guid or a feedId
  // alone) still gets the feed's own answer, through the URL PI's record
  // names — the same record the fallback below would read, so nothing is
  // worse than the old path.
  let rss = null;
  if (rssUrl) rss = await fetchRssValue(rssUrl, guid);
  else {
    const rec = await resolvePi();
    let u = null;
    try { const p = new URL(rec?.url || ""); if ((p.protocol === "http:" || p.protocol === "https:") && !p.username && !p.password) u = rec.url; } catch {}
    if (u) rss = await fetchRssValue(u, guid);
  }
  if (rss) {
    if (guid && rss.item) return json({ level: "episode", source: "rss", value: rss.item });
    if (guid && !rss.itemFound && rss.truncated) {
      // The item may sit past the cap. PI's record of it is the next best
      // reading; the channel block is still the feed's own answer after that.
      const rec = await resolvePi();
      if (rec) {
        const epRes = await piGet(`/episodes/byguid?guid=${encodeURIComponent(guid)}&feedid=${encodeURIComponent(rec.id)}`, headers);
        const epValue = normalizeValue(epRes?.episode?.value);
        if (epValue) return json({ level: "episode", source: "pi", value: epValue });
      }
    }
    if (rss.channel) return json({ level: "feed", source: "rss", value: rss.channel });
  }

  // 2) Podcast Index. The feed was unreachable, was not RSS, or declares no
  // value block anywhere (Anchor and Spotify strip the tag while PI keeps
  // the block from the host's own settings).
  const rec = await resolvePi();
  if (!rec) {
    // Not an error — plenty of feeds simply aren't in Podcast Index. The
    // caller shows "no value block" rather than a failure.
    return json({ value: null, reason: "feed not found in Podcast Index" });
  }
  if (guid) {
    const epRes = await piGet(`/episodes/byguid?guid=${encodeURIComponent(guid)}&feedid=${encodeURIComponent(rec.id)}`, headers);
    const epValue = normalizeValue(epRes?.episode?.value);
    if (epValue) return json({ level: "episode", source: "pi", value: epValue });
  }
  const feedObj = rec.feed?.value !== undefined ? rec.feed
    : (await piGet(`/podcasts/byfeedid?id=${encodeURIComponent(rec.id)}`, headers))?.feed;
  const feedValue = normalizeValue(feedObj?.value);
  if (feedValue) return json({ level: "feed", source: "pi", value: feedValue });

  return json({ value: null });
}
