// /charts/<YYYY-MM-DD> — the OnlyBoosts Charts page: the week's Top 10 for
// Shows, Episodes, Artists, Albums and Songs, each beside its Weeks at #1
// companion, all rendered at the edge.
//
//   /charts/<date>   the five charts for the week containing that day. Not a
//                    Monday? A future date? 302 to the canonical Monday, or to
//                    the live week, so one week has one URL — the /hpw rule.
//   /charts          302 to the live week.
//
// ⚠️ THE WEEK IS THE 40 HPW WEEK: Monday 00:00 US Pacific, cut by
// assets/js/pacific-week.js on both sides of the query. The ranking is
// sort=chart and nothing else — see functions/_shared/week-charts.js for the
// queries and "The OnlyBoosts Charts" in docs/feeds.md for the rule.
//
// ⚠️ THE WEEKS AT #1 BOARDS ARE THE SAME ON EVERY WEEK'S PAGE, deliberately:
// they count completed weeks over the whole index, so they are a property of
// the chart, not of the week on screen. Rendering them beside every week is
// the high-scores idiom the 40 HPW tab established.
//
// The page is facts only — titles, figures, links — so it ships no client
// module of its own; the arrows are plain links and the boards are finished
// HTML. A verb that arrives later (a share control, a picker menu) mounts the
// way hpw-page.js does, without moving the facts.

import { pacificWeekStart, prevWeek, nextWeek, weekStartFromDate, weekDateString } from "../../assets/js/pacific-week.js";
import { KINDS, weeklyChart, weeksAtNumberOne } from "../_shared/week-charts.js";
import { sectionHtml, weekLabel, COPY } from "../_shared/chart-board.js";
import { htmlEscape } from "../../assets/js/nostr-text.js";

export const SITE_ORIGIN = "https://onlyboosts.social";
const ROWS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env, params }) {
  let segs = params.path;
  if (segs == null) segs = [];
  if (!Array.isArray(segs)) segs = [segs];
  segs = segs.filter((s) => s !== "");

  const live = pacificWeekStart(Math.floor(Date.now() / 1000));
  if (segs.length === 0) return redirect(request, `/charts/${weekDateString(live)}`);
  if (segs.length > 1) return notFound();
  const key = segs[0];

  if (!DATE_RE.test(key)) return notFound();
  const ws = weekStartFromDate(key);
  if (ws === null) return notFound();
  if (ws > live) return redirect(request, `/charts/${weekDateString(live)}`);
  const canon = weekDateString(ws);
  if (canon !== key) return redirect(request, `/charts/${canon}`);

  const we = nextWeek(ws);
  const isCurrent = ws >= live;

  let first, weekly, ones;
  try {
    /* The floor, the five weekly Top 10s, and the five companions, together.
       The floor is load-bearing here (unlike the hours endpoint's best-effort
       first_week): a page for a week before the index began is a URL with
       nothing behind it, and a crawler would walk the ‹ arrow back forever. */
    const firstQ = env.DB.prepare("SELECT MIN(created_at) AS t FROM boosts").first()
      .then((r) => (r && r.t ? pacificWeekStart(r.t) : null));
    const weeklyQ = Promise.all(KINDS.map((k) => weeklyChart(env, k, ws, we, ROWS)));
    const onesQ = Promise.all(KINDS.map((k) => weeksAtNumberOne(env, k, live, ROWS)));
    [first, weekly, ones] = await Promise.all([firstQ, weeklyQ, onesQ]);
  } catch (err) {
    console.error("[charts] queries failed", err);
    return unavailable();
  }
  if (first != null && ws < first) return notFound();

  const html = renderPage({ ws, we, live, first, isCurrent, weekly, ones });
  const empty = weekly.every((rows) => rows.length === 0);
  return page(html, isCurrent ? 60 : 300, { noindex: empty });
}

/* ⚠️ Pages routes by method; a HEAD with no handler falls through to the
   static 404. Same status and headers as the GET, no body. */
export async function onRequestHead(ctx) {
  const resp = await onRequestGet(ctx);
  return new Response(null, { status: resp.status, headers: resp.headers });
}

// ── the responses ────────────────────────────────────────────────────────────

function page(html, maxAge, { noindex = false } = {}) {
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": `public, max-age=${maxAge}`,
  };
  if (noindex) headers["X-Robots-Tag"] = "noindex";
  return new Response(html, { status: 200, headers });
}

function redirect(request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = "";
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "public, max-age=60" },
  });
}

function unavailable() {
  return new Response(shell({
    title: "Charts unavailable — OnlyBoosts",
    eyebrow: "503",
    h1: "The charts are unavailable",
    lead: "The index did not answer. Try again in a moment.",
    body: `<div class="soon-card"><p><a href="/">Back to the feeds</a></p></div>`,
    noindex: true,
  }), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function notFound() {
  return new Response(shell({
    title: "Week not found — OnlyBoosts",
    eyebrow: "404",
    h1: "Week not found",
    lead: "The charts are addressed by a week's Monday, as /charts/YYYY-MM-DD.",
    body: `<div class="soon-card"><p><a href="/charts">This week's charts</a></p></div>`,
    noindex: true,
  }), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

// ── the page ─────────────────────────────────────────────────────────────────

function arrowsHtml({ ws, live, first }) {
  const prev = prevWeek(ws), next = nextWeek(ws);
  const prevOff = first != null && prev < first;
  const nextOff = next > live;
  const arrow = (off, href, glyph, label) => off
    ? `<span class="cb-arrow" aria-disabled="true" aria-label="${htmlEscape(label)}">${glyph}</span>`
    : `<a class="cb-arrow" href="${htmlEscape(href)}" aria-label="${htmlEscape(label)}" title="${htmlEscape(label)}">${glyph}</a>`;
  return `<div class="cb-nav-wrap"><span class="cb-nav">` +
    arrow(prevOff, `/charts/${weekDateString(prev)}`, "‹", "Previous week") +
    `<span class="cb-pick">Week of ${htmlEscape(weekLabel(ws))}</span>` +
    arrow(nextOff, `/charts/${weekDateString(next)}`, "›", "Next week") +
    `</span></div>`;
}

/* The og:description. It carries the qualifier in full because it is the
   string that travels without the page around it. */
function leadSentence(ws) {
  return `The top shows, episodes, artists, albums and songs for the week of ${weekLabel(ws)}, ` +
    `ranked by Nostr boosts; every figure counts only the boosts published to Nostr and indexed by OnlyBoosts.`;
}

export function renderPage({ ws, live, first, isCurrent, weekly, ones }) {
  const key = weekDateString(ws);
  const pageUrl = `${SITE_ORIGIN}/charts/${key}`;
  const sections = KINDS.map((kind, i) =>
    sectionHtml(kind, { weekly: weekly[i], ones: ones[i], ws, isCurrent })).join("\n");
  const body = `
<div class="charts-page" data-charts-week="${htmlEscape(key)}"${isCurrent ? ' data-charts-live="1"' : ""}>
  ${arrowsHtml({ ws, live, first })}
${sections}
  <p class="cb-formula">${htmlEscape(COPY.formula)} <a href="/about#charts">About the OnlyBoosts Charts</a></p>
</div>`;
  const ogTitle = `OnlyBoosts Charts: Week of ${weekLabel(ws)}`;
  return shell({
    title: `${ogTitle} — OnlyBoosts`,
    eyebrow: COPY.eyebrow,
    h1: `Week of ${weekLabel(ws)}`,
    lead: COPY.intro,
    body,
    canonical: pageUrl,
    og: { title: ogTitle, description: leadSentence(ws), image: `${SITE_ORIGIN}/assets/onlyboosts_banner.png`, url: pageUrl },
  });
}

// ── the shell ────────────────────────────────────────────────────────────────

/* The plain content-page chrome (page.css), the same shape /about, /stats and
   /hpw wear. The boards sit in a widened column (.cb-inner, 60rem — the site's
   own --feed-track measure) so a pair fits side by side. */
function shell({ title, eyebrow, h1, lead, body, canonical = null, og = null, noindex = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <!-- Shared CSP. Every page carries the same policy so tightening happens in
       lockstep; see CLAUDE.md. -->
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    font-src 'self' data:;
    connect-src 'self' https: wss:;
    media-src 'self' https:;
    base-uri 'self';
    form-action 'self';
    object-src 'none';
  " />

  <title>${htmlEscape(title)}</title>
  ${noindex ? `<meta name="robots" content="noindex" />` : ""}
  ${og ? `<meta name="description" content="${htmlEscape(og.description)}" />` : ""}
  ${canonical ? `<link rel="canonical" href="${htmlEscape(canonical)}" />` : ""}
  <link rel="icon" type="image/png" href="/assets/onlyboosts_favicon.png" />

  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#00aff0" />
  <link rel="apple-touch-icon" href="/assets/onlyboosts_pfp.png" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="OnlyBoosts" />
${og ? `
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${htmlEscape(og.url)}" />
  <meta property="og:title" content="${htmlEscape(og.title)}" />
  <meta property="og:description" content="${htmlEscape(og.description)}" />
  <meta property="og:site_name" content="OnlyBoosts" />
  <!-- The image is the flattened site banner (1800x600), the one artwork on
       this site that IS the large-card shape — the fallback rule from the
       detail pages. A per-week rendered card can replace it later the way the
       hpw share cards did. -->
  <meta property="og:image" content="${htmlEscape(og.image)}" />
  <meta property="og:image:alt" content="${htmlEscape(og.title)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${htmlEscape(og.title)}" />
  <meta name="twitter:description" content="${htmlEscape(og.description)}" />
  <meta name="twitter:image" content="${htmlEscape(og.image)}" />
` : ""}
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v175" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v175" />
  <link rel="stylesheet" href="/assets/css/chart-board.css?v=ob-v175" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v175" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v175" />
  <style>
    /* No feed is active on this page, so it supplies the brand accent itself,
       the same call /hpw and .show-main make. */
    .charts-page { --accent: var(--brand); --accent-d: var(--brand-d); --accent-dd: var(--brand-dd); --tint: rgba(0, 175, 240, 0.1); }
    .page-main .cb-inner { max-width: 60rem; margin: 0 auto; }
  </style>
</head>
<body>

<!-- NAV:START (generated by scripts/sync-partials.js — edit the partial) -->
<!-- ══════════════════════════════ NAV ══════════════════════════════
     SHARED NAV — single source of truth. Do NOT edit the copies inside the
     page files; edit THIS file, then run scripts/sync-partials.js to
     push it into every page (between the NAV:START / NAV:END markers).
     Styles live in /assets/css/nav.css; behavior in /assets/js/nav.js. -->
<!-- Theme boot. Runs before the nav (the first visible element) is parsed,
     so a returning dark-mode visitor never sees a light flash. The choice is
     per-browser (localStorage key ob-theme); absence means light, which is what
     every visitor saw before the toggle existed. The toggle itself is wired
     in nav.js; this only replays the stored choice.
     ⚠️ No backticks or dollar-brace in this file — sync-partials.js injects
     it into the edge Functions inside a template literal and exits nonzero
     if either appears. -->
<script>
(function () {
  try {
    if (localStorage.getItem('ob-theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) { /* storage blocked — the light default stands */ }
})();
</script>
<header id="top-nav">
  <div class="nav-inner">
    <a class="nav-logo" href="/" aria-label="OnlyBoosts home">
      <img src="/assets/onlyboosts_pfp.png" alt="" />
    </a>
    <a class="nav-site-name" href="/">OnlyBoosts</a>
    <nav aria-label="Main navigation">
      <!-- Single "Explore" menu = the whole site map. Grouped dropdown on
           desktop, full-screen overlay on mobile. -->
      <details class="nav-explore">
        <summary aria-label="Explore the site">
          <span class="nav-explore-glyph" aria-hidden="true">🧭</span>
          <span class="nav-explore-text">Explore</span>
          <span class="caret" aria-hidden="true">▾</span>
        </summary>
        <div class="nav-explore-panel">
          <div class="nav-explore-head">
            <span>Explore</span>
            <button type="button" class="nav-explore-close" aria-label="Close menu">✕</button>
          </div>
          <a class="nav-explore-home" href="/"><span aria-hidden="true">🏠</span> Home</a>
          <div class="nav-explore-groups">
            <!-- ⚠️ FEEDS IS ONE ENTRY PER TAB, NOT PER FEED. Reed's call,
                 2026-08-23. It listed all five sub-feeds, which was right while
                 the homepage hid them behind a dropdown and wrong the moment
                 the tabs put them on screen: the nav then restated a control
                 the page carries, in a different order, using different words
                 for the same things. Each entry lands on that tab's DEFAULT
                 sub-feed — TAB_DEFAULT in the index.html controller — so
                 Podcasts opens Episodes, Music opens Albums and Members opens
                 Boosts. **Those three hrefs and TAB_DEFAULT move together.**

                 The Global vs Follows axis stays deliberately absent: it is the
                 second dropdown on the page itself, and listing both scopes
                 here made the nav a grid restating a control the page has. -->
            <div class="nav-explore-group">
              <h4>Feeds</h4>
              <a href="/#episodes-global"><span aria-hidden="true">🎙</span> Podcasts</a>
              <a href="/#artists"><span aria-hidden="true">🎵</span> Music</a>
              <a href="/#members"><span aria-hidden="true">👥</span> Members</a>
            </div>
            <!-- Stats: the aggregate view over the same data. A coming-soon
                 page for now (noindex, out of the sitemap).

                 ⚠️ /boosters (Community) WAS THE SECOND ENTRY AND THE PAGE IS
                 DELETED, not redirected. Reed's call, 2026-08-23: the Members
                 tab now answers what it promised — the member lookup, the
                 top-members wall and the #40HPW boards — so leaving a
                 placeholder here pointed a reader at a promise for content that
                 exists one tab over. It was never linked from anywhere but this
                 menu and the footer, was noindex and out of the sitemap, so it
                 has no inbound links to preserve and gets no redirect. -->
            <div class="nav-explore-group">
              <h4>Stats</h4>
              <a href="/stats"><span aria-hidden="true">📊</span> Boost Stats</a>
            </div>
            <div class="nav-explore-group">
              <h4>More</h4>
              <a href="/about"><span aria-hidden="true">ℹ️</span> About</a>
              <a href="https://github.com/ReedBTC/onlyboosts" target="_blank" rel="noopener"><span aria-hidden="true">💻</span> Source</a>
              <a href="#" data-lb-bug-trigger><span aria-hidden="true">🐞</span> Report a bug</a>
            </div>
          </div>
        </div>
      </details>
    </nav>
    <!-- Dark-mode toggle. Shows the theme you would SWITCH TO (moon in
         light, sun in dark); nav.js owns the click, the storage write and
         the aria-label, and keeps other open tabs in step via the storage event. -->
    <button type="button" class="nav-theme-toggle" aria-label="Switch to dark mode" title="Switch to dark mode">
      <span class="ntt-moon" aria-hidden="true">🌙</span>
      <span class="ntt-sun" aria-hidden="true">☀️</span>
    </button>
    <div id="lb-boost-slot" aria-label="Donate">
      <button
        type="button"
        class="lb-boost-placeholder"
        data-lb-boost-trigger="show"
        aria-label="Donate to OnlyBoosts"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clip-rule="evenodd"/>
        </svg>
        <span class="lb-label-long">Donate</span>
        <span class="lb-label-short">Donate</span>
      </button>
    </div>
    <div id="lb-identity-slot" aria-label="Account">
      <!-- Static placeholder swapped out by IdentityWidget once the
           bundle loads. Picks shimmer vs sign-in based on whether a
           saved session exists; populated by inline script below. -->
    </div>
  </div>
</header>
<!-- NAV:END -->

<section class="page-header">
  <p class="page-eyebrow">${htmlEscape(eyebrow)}</p>
  <h1>${htmlEscape(h1)}</h1>
  <p>${htmlEscape(lead)}</p>
</section>

<main class="page-main">
  <div class="cb-inner">
${body}
  </div>
</main>

<!-- FOOTER:START (generated by scripts/sync-partials.js — edit the partial) -->
<!-- ══════════════════════════════ FOOTER ══════════════════════════════
     SHARED FOOTER — single source of truth. Do NOT edit the copies inside
     the page files; edit THIS file, then run scripts/sync-partials.js
     to push it into every page (between FOOTER:START / FOOTER:END markers).
     Styles live in /assets/css/footer.css. -->
<footer id="site-footer">
  <div class="footer-top">

    <div class="footer-col footer-about">
      <h3>OnlyBoosts</h3>
      <p>A Nostr client for only podcast boosts. Every Podcasting 2.0 boostagram published to Nostr, cached and indexed for stats by episode, show and booster. Sort, filter, search, view all or just see boosts from your follows on Nostr.</p>
    </div>

    <!-- Same two groups as the nav's Explore menu, in the same order — the
         footer is the nav's site map repeated, so they're regrouped together
         or not at all. -->
    <div class="footer-col">
      <!-- ⚠️ ONE ENTRY PER TAB, and it mirrors the nav's Explore menu exactly.
           The two are the site map and are regrouped together or not at all;
           each lands on that tab's default sub-feed. See partials/nav.html. -->
      <h3>Feeds</h3>
      <ul>
        <li><a href="/#episodes-global">🎙 Podcasts</a></li>
        <li><a href="/#artists">🎵 Music</a></li>
        <li><a href="/#members">👥 Members</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Stats</h3>
      <ul>
        <li><a href="/stats">📊 Boost Stats</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Connect</h3>
      <ul>
        <li><a href="/about">ℹ️ About</a></li>
        <li><a href="https://github.com/ReedBTC/onlyboosts" target="_blank" rel="noopener">💻 Site Source</a></li>
        <li><a href="#" data-lb-bug-trigger">🐞 Report a bug</a></li>
      </ul>
    </div>

  </div>
  <div class="footer-bottom">
    <p class="footer-made">
      Made with <span role="img" aria-label="love">💜</span> by
      <a class="footer-maker" href="https://njump.me/npub1xgyjasdztryl9sg6nfdm2wcj0j3qjs03sq7a0an32pg0lr5l6yaqxhgu7s" target="_blank" rel="noopener">
        <img src="/assets/reed_pfp.png" alt="" width="24" height="24" loading="lazy" />
        Reed
      </a>
    </p>
  </div>
</footer>
<!-- FOOTER:END -->

<script src="/assets/js/nav.js?v=ob-v175" defer></script>
<script src="/assets/js/nav-widget-boot.js?v=ob-v175"></script>
<script src="/assets/js/sw-register.js?v=ob-v175" defer></script>
</body>
</html>`;
}
