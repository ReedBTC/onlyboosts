// The pieces every share-card image route shares: the bounded body read, the
// byte cap, and the site banner as the answer to any failure.
//
// Two routes use them — /api/og/booster/<npub> (an avatar, fetched from
// wherever the kind-0 points) and /api/og/hpw/<week>.png (a leaderboard card,
// fetched from the collector's publish tree on the VPS). Both put something we
// control in front of an image a preview fetcher will request exactly once
// and cannot fall back from, so both answer the banner rather than a 5xx.
//
// ⚠️ THE CAP IS 900KB, UNDER SIGNAL DESKTOP'S 1MB RATHER THAN AT IT (measured
// 2026-08-18; see the booster route's header). The fetcher counts bytes on the
// wire and a Content-Length is not always sent, so the read is streamed and
// abandoned rather than buffered and measured.

export const MAX_IMAGE_BYTES = 900 * 1024;
export const TTL_FALLBACK = 300;
export const BANNER_PATH = "/assets/onlyboosts_banner.png";

// Stream the body, bailing once cumulative bytes exceed the cap. arrayBuffer()
// would buffer the whole thing before we could check size.
export async function readBounded(resp, ctrl, cap = MAX_IMAGE_BYTES) {
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const buf = await resp.arrayBuffer();
    return buf.byteLength > cap ? null : buf;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
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

// The banner, served from this origin with a short life so a transient
// upstream failure does not pin it onto a share card for a day. If even the
// asset fetch fails, hand the fetcher the static URL directly.
export async function bannerResponse(request, env) {
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
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": `public, max-age=${TTL_FALLBACK}` },
  });
}
