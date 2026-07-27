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
// ob-v13: nav and footer regrouped into Podcasts / Boosts columns, and
// /podcasts renamed to /shows. Required: a returning visitor's HTML cache
// holds pages whose links still point at /podcasts, which now costs a 301
// hop, and the runtime cache may hold the old page itself under a URL that
// no longer serves it. Also picks up page.css, where the about page's jump
// links became a numbered table of contents and the live stat strip came
// out entirely, and index.html's feed tabs, which now have hairline
// dividers between them.
// ob-v14: the boost-count pill came off the two Boosts panels. The markup
// and the code that filled it went together, so a returning visitor holding
// one half without the other would render an empty capsule.
// ob-v15: the Podcasts · Follows corpus is now one request instead of eight.
// assets/js/ob-live.js asks /api/v1/boosts/follows for the whole row budget
// at once, and the endpoint raises its own clamp to allow it. Required: the
// old module is what pins the request to 200 rows a page, so a returning
// visitor holding it keeps paying ~2s of serial round trips even though the
// deployed Function would answer in one.
// ob-v16: the four-tab ribbon became two dropdowns in a sticky feed bar, and
// the range/sort controls moved out of the panel heads into it. Required: the
// bar's markup lives in index.html while the controls that mount into it come
// from the new assets/js/feed-controls.js, so a returning visitor holding the
// old index.html would render a page whose feeds can't find their slot (and
// one holding the old feeds-podcasts.js would look for a panel head that is no
// longer there).
// ob-v17: the Shows feed is real. assets/js/shows-feed.js is a new module and
// feeds.js is what maps `shows` to it, so a returning visitor holding the old
// feeds.js would pick Shows from the menu and get a placeholder. Also carries
// the nav/footer change pointing Shows at /#shows instead of the /shows
// coming-soon page, which is cached HTML on every page of the site.
// ob-v18: the episode feed is called Episodes, not Podcasts — Shows made the
// old name ambiguous. Feed keys, panel ids and URL hashes went with it
// (#podcasts-* is aliased, not dropped). Required: the keys live in index.html's
// markup and in feeds.js's LOADERS, so a returning visitor holding one half
// without the other would find no panel for the feed it activates. Every page
// is also re-cached for the nav/footer's new hashes.
// ob-v19: the Explore menu and footer are regrouped into Feeds / Stats / More,
// and /stats is a new coming-soon page. Required: the nav and footer are baked
// into every page's HTML, so a returning visitor keeps the old grouping (with
// its Global/Follows entries and no Stats column) until the cache turns over.
// ob-v20: the about page's live stat strip is back (restored from 7f35bf4^).
// Required: the markup is in about.html and the .stat-* rules are in page.css,
// so a returning visitor holding one without the other gets either an unstyled
// row of numbers or nothing at all.
// ob-v21: every feed has a search box at the head of its panel. Not required
// for correctness — the slot is in index.html and the new
// assets/js/feed-search.js only fills a slot it finds, so either half alone
// degrades to the feed as it is today — but the feature is invisible until
// both land, and index.html is the cached half.
// ob-v23: the about page's publisher list drops Bowl After Bowl. Required
// because it is a factual correction about a named third party: HTML is served
// stale-while-revalidate, so without a bump a returning visitor reads the
// wrong list once more before the cache turns over.
// ob-v24: the about page's collector cadence was three times too slow (the
// incremental scan is every 5 minutes, not 15). Same reason as v23 — a stale
// page states a wrong figure to a returning visitor for one more navigation.
const VERSION = 'ob-v26';
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
