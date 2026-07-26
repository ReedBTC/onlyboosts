// OnlyBoosts service worker
// - HTML: network-first (always try fresh, fall back to cache offline)
// - Boost snapshot (/api/community-boosts): stale-while-revalidate (returning
//   visitors see cached boosts instantly; the fresh snapshot loads in the
//   background for the next visit)
// - Widget bundles (/assets/widgets/*): stale-while-revalidate (serve
//   cached immediately, refresh in background, next page picks up new code)
// - Other same-origin static assets: stale-while-revalidate (serve cached
//   instantly, revalidate in background — deploys propagate within one
//   navigation without a VERSION bump, and a cached asset survives a
//   transient network blip instead of failing the whole resource load)
// - Cross-origin (fonts on first deploy, Nostr relays, third-party): pass through

// Fork note: the LB changelog that used to sit here (v13–lb-v43) was
// removed — it narrated merch, episode, and leaderboard work that no
// longer exists in this repo. The caching strategies it explained are
// unchanged and documented at the top of this file; the original
// rationale is still readable via `git show lb/main:sw.js`.

// ── OnlyBoosts ───────────────────────────────────────────────────────
// ob-v1: forked from localbitcoiners at lb-v43; version counter restarts.
// Cache keys are namespaced by VERSION, so the `ob-` prefix also guarantees
// no collision with an LB cache on a shared origin during local dev.
// ob-v2: site identity wired in (onlyboosts.social, npub, lightning address).
// login-widget.js and nostr-tools.js were both rebuilt, so bump to evict the
// stale stale-while-revalidate copies — a returning visitor holding the
// previous widget bundle would otherwise boost the old recipient.
// ob-v11: the Follows tabs are hidden while signed out. Required bump, not
// cosmetic: assets/js/sign-in-prompt.js was deleted, and a returning visitor
// holding the previous boosts-feed.js / feeds-podcasts.js would still carry a
// static import of it — a 404 on that import fails the whole module and the
// feed renders "couldn't load" instead of boosts.
// ob-v10: the Follows feeds now repaint on sign-in. The fix spans the widget
// bundle (which dispatches lb:session-change) and feeds.js/follow-set.js
// (which listen), so a returning visitor holding one half and not the other
// would still see the stale "Sign in to see this feed" for a navigation.
// ob-v9: nav rework — Donate button (login-widget.js rebuilt), Feeds /
// Community / More groups in Explore, and the coming-soon pages. The theme
// tokens and the widget bootstrap moved out of index.html into
// assets/css/theme.css and assets/js/nav-widget-boot.js; a returning visitor
// holding the precached index.html would otherwise render unstyled until
// those two new files fetched.
// ob-v8: feed order (Podcasts first), range-driven Podcasts titles, ranks
// restricted to Global, boost source line, subtitles removed.
// ob-v7: rank numbers on the ranked Podcasts sorts.
// ob-v6: Podcasts tabs restored to the episode-card feed (drawer, range
// filter, sort menu) on top of the new data, via ob-data.js#toEpisodeShape.
// podcasts-feed.js is gone; feeds-podcasts.js is back. Bump so a returning
// visitor doesn't hold a bundle pointing at the deleted module.
// ob-v5: new collector data feed. The site now reads /api/data/* (manifest,
// latest.json, month archives, per-show shards) instead of the single
// /api/community-boosts snapshot, which is gone along with feeds-podcasts.js.
// A returning visitor holding the old bundle would request an endpoint that
// no longer exists, so this bump is required, not cosmetic.
// ob-v4: all four feed loaders wired — boosts-feed.js and follow-set.js are
// new modules, feeds.js and feeds-podcasts.js changed. Bump so a returning
// visitor doesn't hold a stale feeds.js whose LOADERS map only had one entry.
// ob-v3: brand art + single-page rework. feeds.html and boosts.html were
// folded into index.html as four hash-routed tabs and deleted, so a
// returning visitor's precache still lists two URLs that now 404 — the bump
// is what drops them. Also picks up the new palette and the logo/favicon/
// banner PNGs.
// ob-v12: the two Follows tabs moved off the static shards onto the D1 query
// API (/api/v1/boosts/follows) via the new assets/js/ob-live.js. Required, not
// cosmetic: a returning visitor holding the previous boosts-feed.js /
// feeds-podcasts.js would keep downloading month archives to filter them
// client-side, and neither bundle imports the new module.
const VERSION = 'ob-v12';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;
const WIDGET_CACHE = `${VERSION}-widgets`;
const SNAPSHOT_CACHE = `${VERSION}-snapshot`;

// What we precache on SW install. Widget bundle deliberately excluded —
// it's only needed when a user clicks Boost, not on every visit. Lazy
// loading the bundle on first interaction keeps cold-load lighter.
//
// The boost-feed snapshot (/api/community-boosts) is excluded too: it's
// large and refreshes hourly, so stale-while-revalidate handles it
// better than precaching a copy that's stale by first paint.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/onlyboosts_favicon.png',
  '/assets/onlyboosts_pfp.png',
  '/assets/onlyboosts_banner.png',
  '/assets/avatar-fallback.svg',
  '/assets/css/theme.css',
  '/assets/css/page.css',
  '/assets/css/nav.css',
  '/assets/css/footer.css',
  '/assets/css/boosts-thread.css',
  '/assets/css/boost-actions.css',
  '/assets/js/boosts-thread.js',
  '/assets/js/calendar-events.js',
  '/assets/js/boost-actions.js',
  '/assets/js/nav.js',
  '/assets/js/nav-widget-boot.js',
  '/assets/js/widget-loader.js',
  '/assets/js/sw-register.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Best-effort precache: don't fail install if one asset is missing
      Promise.all(
        // { cache: 'reload' } forces each precache fetch past the browser
        // HTTP cache, so a VERSION bump re-pulls genuinely fresh assets
        // (e.g. images replaced under the same filename) instead of
        // re-caching a stale copy the browser already had.
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isHTMLRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

function isWidgetRequest(url) {
  return url.pathname.startsWith('/assets/widgets/');
}

function isSnapshotRequest(url) {
  return url.pathname.startsWith('/api/data/');
}

// Stale-while-revalidate helper: serve cached immediately if present,
// fetch fresh in the background, update cache for next visit. Falls
// back to network-only when no cached copy exists yet.
//
// The background fetch uses { cache: 'no-cache' } so it always REVALIDATES
// with the server (conditional request → 304 or fresh) instead of being
// satisfied by the browser's HTTP cache. Cloudflare Pages serves assets with
// `max-age=14400` (4h), so a plain fetch could re-populate the SW cache with a
// copy up to 4h stale — which made deploys look "stuck" for frequent reloaders
// even after a VERSION bump. Revalidating kills that window; the cached copy is
// still returned instantly, so first paint isn't slowed.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkP = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);
  return cached || networkP;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isHTMLRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache real successful same-origin responses. Without
          // this guard, a 5xx page or Cloudflare challenge HTML would
          // get cached and served as the offline fallback for that
          // URL until the next successful fetch — returning visitors
          // could land on a stuck error page. Mirrors the guard the
          // static-asset branch already has below.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(HTML_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  if (isSnapshotRequest(url)) {
    // Boosts show up instantly on repeat visits from the cached snapshot;
    // the fresh one updates the cache in background. The Pages Function
    // already caches upstream for 5 min, so freshness is bounded.
    event.respondWith(staleWhileRevalidate(request, SNAPSHOT_CACHE));
    return;
  }

  if (isWidgetRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, WIDGET_CACHE));
    return;
  }

  // Other same-origin static assets (CSS, JS, data, images): serve the
  // cached copy instantly and revalidate in the background. A cached
  // asset stays usable through a transient network failure, and a deploy
  // is picked up on the next navigation without needing a VERSION bump.
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});
