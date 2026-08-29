// The share-card image for /hpw/<week>: /api/og/hpw/<YYYY-MM-DD>.png and
// /api/og/hpw/high-scores.png.
//
// THE IMAGE IS NOT RENDERED HERE. It is a real Chromium screenshot of the
// /hpw/<week>/card page, taken on the collector machine at the end of each
// incremental cycle (bots/hpw-cards/), written into the shards tree and
// rsynced to the VPS with them, so it lands at
// relay.mynostr.app/onlyboosts/hpw/<name>. Reed's call, 2026-08-29, over
// rasterizing at the edge: a wasm SVG renderer would have added ~1.1MB to a
// 109KB Functions bundle and drawn blanks for the emoji in members' names; a
// browser draws the card the way the site draws it, and the machine already
// running the pipeline has one.
//
// So this route is a proxy in front of a file we publish, on the shape of
// /api/og/booster/<npub>: a strict name allowlist (never a path passthrough),
// a bounded fetch, the type checked AND the bytes checked, and the site banner
// for anything else. Two things it has to know about the upstream:
//
//   ⚠️ IT ANSWERS 200 FOR A MISSING FILE. relay.mynostr.app serves Nostr on
//   the same origin, so an unknown path falls through to the relay and answers
//   `200 text/plain "Please use a Nostr client to connect."`. The data proxy
//   under /api/data/ guards the same trap by parsing JSON; here the guard is
//   the PNG signature in the first eight bytes, which no text answer carries.
//
//   ⚠️ A WEEK NOT YET RENDERED IS NOT AN ERROR. The bot renders after the
//   cycle in which a board changed, so a page can exist for a few minutes
//   before its picture does. The banner covers that window and is cached
//   briefly (TTL_FALLBACK) so the real card is picked up on the next look.

import { weekStartFromDate, weekDateString } from "../../../../assets/js/pacific-week.js";
import { readBounded, bannerResponse, MAX_IMAGE_BYTES } from "../../../_shared/og-image.js";

export const UPSTREAM_BASE = "https://relay.mynostr.app/onlyboosts/hpw/";
const FETCH_TIMEOUT_MS = 6_000;
// The one shape the collector writes. `high-scores` is a literal, not a
// wildcard; a date is checked below for being the Monday it claims to be.
const NAME_RE = /^(\d{4}-\d{2}-\d{2}|high-scores)\.png$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The card for a live week is re-rendered every cycle the board moves, so
// this is the endpoint's own 300s rather than the avatar route's day.
const TTL_CARD = 300;

export async function onRequestGet({ request, env, params }) {
  let name = params.name;
  if (Array.isArray(name)) name = name[0];
  if (typeof name !== "string" || !NAME_RE.test(name)) return new Response("Not found", { status: 404 });

  /* A date that is not a Monday names the same week as the Monday it falls in,
     and the bot writes one file per week; answer with the canonical name the
     way /hpw/<date> does, so the two never disagree about what a week is
     called. An unparseable date is a 404. */
  if (name !== "high-scores.png") {
    const ws = weekStartFromDate(name.slice(0, 10));
    if (ws === null) return new Response("Not found", { status: 404 });
    const canon = `${weekDateString(ws)}.png`;
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

/* ⚠️ PAGES ROUTES BY METHOD, AND A HEAD FALLS THROUGH TO THE STATIC LOOKUP
   WHEN ONLY onRequestGet IS EXPORTED — answering 404 for a URL whose GET is
   fine. Found by the collector's bot on 2026-08-29. Most OG scrapers GET, but
   link checkers and some CDNs HEAD first. Same answer, no body. */
export async function onRequestHead(ctx) {
  const resp = await onRequestGet(ctx);
  return new Response(null, { status: resp.status, headers: resp.headers });
}

// One bounded fetch. Returns a Response ready to send, or null for "use the
// banner" — every failure lands on null rather than throwing.
export async function fetchCard(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "OnlyBoosts-OG-Image/1.0", Accept: "image/png" },
      redirect: "follow",
      signal: ctrl.signal,
      cf: { cacheTtl: TTL_CARD, cacheEverything: true },
    });
    if (resp.status !== 200) return null;

    const ctype = (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (ctype !== "image/png") return null;

    const cl = parseInt(resp.headers.get("content-length") || "", 10);
    if (Number.isFinite(cl) && cl > MAX_IMAGE_BYTES) return null;

    const bytes = await readBounded(resp, ctrl);
    if (!bytes || !isPng(bytes)) return null;

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": `public, max-age=${TTL_CARD}`,
        "X-Content-Type-Options": "nosniff",
        "X-OB-Image": "card",
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isPng(buf) {
  const b = new Uint8Array(buf);
  if (b.byteLength < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((v, i) => b[i] === v);
}
