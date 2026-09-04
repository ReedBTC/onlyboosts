// Podcast Index auth and a bounded GET, shared by the metadata lookups.
//
// Two callers today: /api/episode-meta (chapters + full show notes) and
// /show/<guid> (the show description). Both ask Podcast Index for text the
// collector does not store, and both are strictly additive to a page whose
// subject is boosts, so both treat an upstream failure as "we learned nothing"
// rather than as an error.
//
// ⚠️ /api/value KEEPS ITS OWN COPY OF THIS, DELIBERATELY. That endpoint
// resolves value blocks, where a wrong answer moves sats; a metadata lookup
// must never share a code path with it. The duplication is the boundary.

const PI_BASE = "https://api.podcastindex.org/api/1.0";

// The default is the one /api/episode-meta has always used. A caller on a
// page's render path passes its own, much shorter — see fetchShowNotes in
// functions/show/[guid].js, where this fetch is racing a reader's TTFB rather
// than filling a drawer after paint.
const DEFAULT_TIMEOUT_MS = 10_000;

async function sha1Hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Podcast Index auth: X-Auth-Key + X-Auth-Date + Authorization=sha1(key+secret+date).
// The keys are Cloudflare secrets and never reach the browser.
export async function piHeaders(key, secret, userAgent = "OnlyBoosts/1.0") {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    "User-Agent": userAgent,
    "X-Auth-Key": key,
    "X-Auth-Date": String(nowSec),
    Authorization: await sha1Hex(String(key) + String(secret) + String(nowSec)),
  };
}

/* One PI call. Returns the parsed body, or null for anything that is not a
 * clean answer — a non-2xx, a timeout, a body that will not parse, or a body
 * past `maxBytes`. The caller cannot tell those apart on purpose: every one of
 * them means the same thing to a surface that is additive, and collapsing them
 * here is what keeps that decision out of the callers.
 *
 * cacheEverything puts the response in the colo's cache for an hour, which is
 * what makes a per-request lookup affordable: the first reader of a show pays
 * the round trip and the rest of that hour's readers in the same colo do not.
 *
 * `maxBytes` is the bounded read every upstream fetch here is held to (see
 * CLAUDE.md, "Pages Functions bound every upstream fetch"). The body is
 * streamed and abandoned the moment it passes the cap, because resp.json()
 * buffers the whole thing before anything can be measured. The two lookups
 * that predate the option answer a single record each and pass none; the
 * catalogue lookup (/api/catalogue) answers with up to a thousand and passes
 * one. A capped body is a null like any other miss.
 */
export async function piGet(path, headers, { timeoutMs = DEFAULT_TIMEOUT_MS, cacheTtl = 3600, maxBytes = 0 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(PI_BASE + path, {
      headers,
      cf: { cacheTtl, cacheEverything: true },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    if (!maxBytes) return await resp.json();
    const text = await readBounded(resp, ctrl, maxBytes);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Stream the body, bailing once cumulative bytes exceed the cap. The same shape
// as readBounded() in functions/api/data/[[path]].js, which is the reference.
async function readBounded(resp, ctrl, maxBytes) {
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const text = await resp.text();
    return text.length > maxBytes ? null : text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { ctrl.abort(); } catch {}
      try { reader.cancel(); } catch {}
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(out);
}
