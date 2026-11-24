/* An episode's <podcast:valueTimeSplit> windows, read from the show's own RSS.
 *
 * A music show tags each song it plays with a window: a startTime and a
 * duration into the episode, a remotePercentage (the song's share of a boost
 * made while it plays), and a <podcast:remoteItem feedGuid itemGuid> naming
 * the song in its own album feed. The windows are what let the player say
 * which song is on, put the song's heart on the chapters list, and (later)
 * pay the song from the boost button. A chapter never names a song; the two
 * are distinct row types and are never mapped onto each other (BMB's rule:
 * on some shows they overlap, and "the window covering this chapter" names
 * the wrong song).
 *
 * ONLY A WINDOW WITH A remoteItem IS READ. A window can instead list inline
 * <podcast:valueRecipient>s (a guest's share, no song identity); those are
 * counted and left for the boost work to decide on, since they name no song
 * to show or favorite.
 *
 * Workers have no DOMParser, so this is the namespace-agnostic regex reading
 * functions/api/value.js uses, kept separate from that money path on purpose:
 * a change made here for the player cannot move a payment.
 *
 * Pure functions above the fetch, so scripts/test-episode-songs.mjs runs the
 * parser on real feed text with no network. */

const NS = "(?:[A-Za-z0-9_-]+:)?";

export const MAX_WINDOWS = 120;

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
const num = (v) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
};
const okGuid = (g) => typeof g === "string" && g.trim() !== "" && g.length <= 400;

/* The <item> whose <guid> is `itemGuid`, as text, or null. */
export function findItem(xml, itemGuid) {
  const want = String(itemGuid || "").trim();
  if (!want) return null;
  const re = /<item(?=[\s>])[\s\S]*?<\/item\s*>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const g = /<guid(?=[\s>])[^>]*>([\s\S]*?)<\/guid\s*>/i.exec(m[0]);
    if (g && decodeEntities(stripCdata(g[1])).trim() === want) return m[0];
  }
  return null;
}

/* One item's windows → { songs, inline }, songs sorted by start.
 *   songs   [{ start, duration, pct, feedGuid, itemGuid, feedUrl, medium }]
 *   inline  how many windows carried recipients and no remoteItem */
export function readTimeSplits(itemXml) {
  const songs = [];
  let inline = 0;
  const re = new RegExp(
    `<${NS}valueTimeSplit(?=[\\s>/])([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}valueTimeSplit\\s*>)`, "gi");
  let m;
  while ((m = re.exec(itemXml || "")) && songs.length < MAX_WINDOWS) {
    const a = parseAttrs(m[1]);
    const start = num(a.startTime), duration = num(a.duration);
    if (start == null || start < 0 || duration == null || duration <= 0) continue;
    const ri = new RegExp(`<${NS}remoteItem(?=[\\s>/])([^>]*)>`, "i").exec(m[2] || "");
    if (!ri) { inline++; continue; }
    const r = parseAttrs(ri[1]);
    if (!okGuid(r.itemGuid) || !okGuid(r.feedGuid)) continue;
    // The spec's default is 100: the whole boost to the song.
    let pct = a.remotePercentage == null || a.remotePercentage === "" ? 100 : num(a.remotePercentage);
    if (pct == null || pct < 0 || pct > 100) pct = null;
    songs.push({
      start, duration, pct,
      feedGuid: r.feedGuid.trim(), itemGuid: r.itemGuid.trim(),
      feedUrl: /^https?:\/\//i.test(r.feedUrl || "") ? r.feedUrl : null,
      medium: r.medium || null,
    });
  }
  songs.sort((x, y) => x.start - y.start);
  return { songs, inline };
}

/* Fetch a feed bounded three ways (time, bytes, a streamed read). Returns
 * { text, truncated } or null when it cannot be read. */
export async function fetchFeedText(feedUrl, { timeoutMs = 6000, maxBytes = 4 * 1024 * 1024, userAgent = "OnlyBoosts-Songs/1.0" } = {}) {
  let url;
  try {
    url = new URL(feedUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
  } catch { return null; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": userAgent, Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
      cf: { cacheTtl: 600, cacheEverything: true },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const reader = resp.body?.getReader?.();
    if (!reader) {
      const t = await resp.text();
      return t.length > maxBytes ? { text: t.slice(0, maxBytes), truncated: true } : { text: t, truncated: false };
    }
    const chunks = []; let total = 0, truncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value); total += value.byteLength;
      if (total >= maxBytes) { truncated = true; try { reader.cancel(); } catch {} break; }
    }
    const buf = new Uint8Array(total); let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return { text: new TextDecoder("utf-8").decode(buf.subarray(0, maxBytes)), truncated };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
