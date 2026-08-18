// The share-card image for /booster/<npub>.
//
// og:image on the booster page used to name the avatar URL straight out of the
// profile row, and a link preview fetcher cannot run an error handler: it makes
// one request and either draws what came back or draws nothing. Measured over
// the 61 boosters behind the last 100 boosts on 2026-08-18, 5 of the 49 stored
// pictures answered 404 (the person moved hosts and the kind-0 we hold is the
// old one) and 7 were over 1MB, the largest 4.3MB. Signal Desktop reads at most
// 1MB of image (`MAX_IMAGE_BYTES_TO_LOAD` in ts/linkPreviews/linkPreviewFetch);
// Android and iOS stop at 2MB. So about a quarter of booster pages could not
// produce a preview image on Desktop, and no meta tag fixes any of it.
//
// This route puts something we control in front of the picture:
//
//   1. the avatar is looked up BY NPUB in D1, never taken from the query string,
//      so this is not an open image proxy — the only URLs it will ever fetch are
//      the ones the index already holds;
//   2. the fetch is bounded the way every upstream fetch here is: a wall-clock
//      timeout, a byte cap, and a streamed read;
//   3. Cloudflare is asked to resize on the way through (`cf.image`). On a zone
//      with Image Resizing enabled that turns a 4MB PNG into a ~40KB JPEG; on one
//      without it the option is ignored and the original passes through, which
//      the byte cap then handles;
//   4. anything that is not a 200 image of a plain raster type, or is still over
//      MAX_IMAGE_BYTES after all that, is answered with the site banner instead,
//      the same fallback the page names when there is no picture at all.
//
// The cap is 900KB, under Signal Desktop's 1MB rather than at it, since the
// fetcher counts bytes on the wire and a Content-Length is not always sent.

import { toHexPubkey } from "../../v1/_common.js";
import { isSafeUrl } from "../../../../assets/js/nostr-text.js";

const FETCH_TIMEOUT_MS = 6_000;
const MAX_IMAGE_BYTES = 900 * 1024;
const NPUB_MAX = 128;
const BANNER_PATH = "/assets/onlyboosts_banner.png";

// SVG is excluded on purpose: served from this origin it would be a document,
// not a picture, and no preview fetcher accepts it as an image anyway.
const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Success is cached for a day: an avatar changes rarely and the page it serves
// is edge-cached itself. A fallback is cached briefly, so a transient upstream
// failure does not pin the banner onto someone's share card for a day.
const TTL_IMAGE = 86_400;
const TTL_FALLBACK = 300;

export async function onRequestGet({ request, env, params }) {
  let raw = params.npub;
  if (Array.isArray(raw)) raw = raw[0];
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw form */ }
  if (!raw || raw.length > NPUB_MAX) return new Response("Not found", { status: 404 });
  const hex = toHexPubkey(raw);
  if (!hex) return new Response("Not found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(cacheKey).catch(() => null);
  if (hit) return hit;

  let pic = null;
  try {
    const row = await env.DB.prepare(`SELECT picture FROM profiles WHERE pubkey = ?`).bind(hex).first();
    pic = isSafeUrl(row?.picture) ? row.picture : null;
  } catch {
    pic = null;
  }

  let out = pic ? await fetchAvatar(pic) : null;
  if (!out) out = await banner(request, env);

  try { await cache.put(cacheKey, out.clone()); } catch { /* cache is best-effort */ }
  return out;
}

// One bounded fetch. Returns a Response ready to send, or null for "use the
// banner" — every failure mode lands on null rather than throwing, because a
// share card is not worth a 5xx.
async function fetchAvatar(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "OnlyBoosts-OG-Image/1.0", Accept: "image/*" },
      redirect: "follow",
      signal: ctrl.signal,
      cf: {
        cacheTtl: TTL_IMAGE,
        cacheEverything: true,
        // Ignored on a zone without Image Resizing; see the header comment.
        image: { width: 600, height: 600, fit: "cover", format: "jpeg", quality: 85, metadata: "none" },
      },
    });
    if (resp.status !== 200) return null;

    const ctype = (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!RASTER_TYPES.has(ctype)) return null;

    const cl = parseInt(resp.headers.get("content-length") || "", 10);
    if (Number.isFinite(cl) && cl > MAX_IMAGE_BYTES) return null;

    const bytes = await readBounded(resp, ctrl);
    if (!bytes) return null;

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": ctype,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": `public, max-age=${TTL_IMAGE}`,
        "X-Content-Type-Options": "nosniff",
        "X-OB-Image": "avatar",
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function banner(request, env) {
  const url = new URL(BANNER_PATH, request.url);
  try {
    const resp = await env.ASSETS.fetch(new Request(url.toString()));
    if (resp.ok) {
      const bytes = await resp.arrayBuffer();
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": `public, max-age=${TTL_FALLBACK}`,
          "X-Content-Type-Options": "nosniff",
          "X-OB-Image": "fallback",
        },
      });
    }
  } catch { /* fall through to the redirect */ }
  // The asset fetch itself failed; hand the fetcher the static URL directly.
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": `public, max-age=${TTL_FALLBACK}` },
  });
}

// Stream the body, bailing once cumulative bytes exceed the cap. arrayBuffer()
// would buffer the whole thing before we could check size.
async function readBounded(resp, ctrl) {
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const buf = await resp.arrayBuffer();
    return buf.byteLength > MAX_IMAGE_BYTES ? null : buf;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      try { ctrl.abort(); } catch {}
      try { reader.cancel(); } catch {}
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}
