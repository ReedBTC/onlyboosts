// The share-card images for the chart boards:
//
//   /api/og/charts/shows-<YYYY-MM-DD>.png      that week's Shows Top 10
//   /api/og/charts/artists-<YYYY-MM-DD>.png    that week's Artists Top 10
//   /api/og/charts/shows-weeks-at-1.png        Shows: Weeks at #1
//   /api/og/charts/artists-weeks-at-1.png      Artists: Weeks at #1
//   /api/og/charts/members-weeks-at-1.png      Members: Weeks at #1
//
// The same arrangement as /api/og/hpw/<name>.png, and it shares that route's
// fetch: a Chromium screenshot of the matching /charts/…/card frame, taken on
// the collector machine (bots/hpw-cards/), written into the shards tree under
// charts/ and rsynced to the VPS. This is a proxy in front of a file we
// publish — a strict name allowlist, a bounded fetch, the PNG signature
// checked because the upstream answers 200 text/plain for a missing file, and
// the site banner for anything else (X-OB-Image: fallback), which the share
// modal refuses to upload as "the board".

import { weekStartFromDate, weekDateString } from "../../../../assets/js/pacific-week.js";
import { bannerResponse } from "../../../_shared/og-image.js";
import { fetchCard } from "../hpw/[name].js";

export const UPSTREAM_BASE = "https://relay.mynostr.app/onlyboosts/charts/";
// The five shapes the collector writes. Literal kinds, never a wildcard.
export const NAME_RE = /^((shows|artists)-(\d{4}-\d{2}-\d{2})|(shows|artists|members)-weeks-at-1)\.png$/;

export async function onRequestGet({ request, env, params }) {
  let name = params.name;
  if (Array.isArray(name)) name = name[0];
  const m = typeof name === "string" ? NAME_RE.exec(name) : null;
  if (!m) return new Response("Not found", { status: 404 });

  /* A weekly key names a Monday; any other date in the week is answered with
     the canonical name, the way /charts/<date> and the hpw route do, so the
     two never disagree about what a week is called. */
  if (m[3]) {
    const ws = weekStartFromDate(m[3]);
    if (ws === null) return new Response("Not found", { status: 404 });
    const canon = `${m[2]}-${weekDateString(ws)}.png`;
    if (canon !== name) {
      const url = new URL(request.url);
      url.pathname = url.pathname.replace(/[^/]+$/, canon);
      return new Response(null, {
        status: 302,
        headers: { Location: url.toString(), "Cache-Control": "public, max-age=86400" },
      });
    }
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(cacheKey).catch(() => null);
  if (hit) return hit;

  let out = await fetchCard(UPSTREAM_BASE + name);
  if (!out) out = await bannerResponse(request, env);

  try { await cache.put(cacheKey, out.clone()); } catch { /* cache is best-effort */ }
  return out;
}

/* Pages routes by method; a HEAD with no handler falls through to the static
   404. Same answer, no body. */
export async function onRequestHead(ctx) {
  const resp = await onRequestGet(ctx);
  return new Response(null, { status: resp.status, headers: resp.headers });
}
