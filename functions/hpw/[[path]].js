// /hpw/<YYYY-MM-DD>, /hpw/high-scores, and the /card variant of each: the 40
// HPW boards as pages of their own, rendered at the edge.
//
// THE WEEK PICKER ON THE MEMBERS TAB IS DELIBERATELY NOT IN THE HASH (Reed,
// 2026-08-24), and this is the address a week has instead. A shared link
// needs somewhere to land and an og:image to preview with, and a hash
// parameter on the tab could offer neither; a page can. The tab is still
// where the boards are USED — this page links back to it and carries no
// picker of its own beyond the two arrows.
//
//   /hpw/<date>          the board for the week containing that day. Not a
//                        Monday? A future date? 302 to the canonical Monday,
//                        or to the live week, so one week has one URL.
//   /hpw/high-scores     Proof of #40HPW, with each row's best week linking
//                        to that week's page. ⚠️ THE PATH IS THE OLD NAME AND
//                        STAYS THAT WAY: the board was renamed on 2026-09-01,
//                        the URL is in the wild, and the collector's card bot
//                        (bots/hpw-cards/) screenshots this literal.
//   /hpw/<key>/card      THE SHARE CARD. The same board in a fixed 720x900
//                        frame with no nav, no footer and no theme toggle,
//                        which the collector's bot (bots/hpw-cards/) loads in
//                        headless Chromium and screenshots at 2x. It sets
//                        `data-card-ready="1"` on <html> once fonts and faces
//                        have settled; the bot waits on that selector.
//                        noindex — the page is the thing to index.
//   /hpw                 302 to the live week.
//
// ⚠️ THE ROWS ARE `assets/js/hpw-board.js`, THE SAME MODULE THE TAB PAINTS
// WITH, imported here by relative path so esbuild inlines it. A row here and a
// row on the tab are one function; a screenshot of either must not be
// distinguishable from the other. The query is `hoursBoard` out of the
// endpoint the tab fetches, for the same reason.
//
// The share control (Post to Nostr / Copy link / Share image) is a verb and is
// attached by /assets/js/hpw-page.js; the page ships the slot for it.

import { hoursBoard } from "../api/v1/members/hours.js";
import {
  pacificWeekStart, prevWeek, nextWeek, weekStartFromDate, weekDateString,
} from "../../assets/js/pacific-week.js";
import { boardHtml, weekLabel, weekSpan, hours, COPY } from "../../assets/js/hpw-board.js";
import { htmlEscape } from "../../assets/js/nostr-text.js";
import { cardHtml, CARD_W, CARD_H } from "../_shared/card-frame.js";
export { CARD_W, CARD_H };

export const SITE_ORIGIN = "https://onlyboosts.social";
const HIGH = "high-scores";
const ROWS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The card's frame (720x900, portrait) is functions/_shared/card-frame.js's;
// CARD_W / CARD_H are re-exported above for the test.

export async function onRequestGet({ request, env, params }) {
  let segs = params.path;
  if (segs == null) segs = [];
  if (!Array.isArray(segs)) segs = [segs];
  segs = segs.filter((s) => s !== "");

  const live = pacificWeekStart(Math.floor(Date.now() / 1000));
  if (segs.length === 0) return redirect(request, `/hpw/${weekDateString(live)}`);
  if (segs.length > 2 || (segs.length === 2 && segs[1] !== "card")) return notFound();
  const card = segs.length === 2;
  const key = segs[0];
  const tail = card ? "/card" : "";

  if (key === HIGH) {
    let data;
    try { data = await hoursBoard(env, { range: "all", limit: ROWS }); }
    catch (err) { console.error("[hpw] all-time board failed", err); return unavailable(); }
    const html = card ? renderCard({ kind: "all", body: data.body, live }) : renderPage({ kind: "all", body: data.body, live });
    return page(html, data.cache, { noindex: card });
  }

  if (!DATE_RE.test(key)) return notFound();
  const ws = weekStartFromDate(key);
  if (ws === null) return notFound();
  if (ws > live) return redirect(request, `/hpw/${weekDateString(live)}${tail}`);
  const canon = weekDateString(ws);
  if (canon !== key) return redirect(request, `/hpw/${canon}${tail}`);

  let data;
  try { data = await hoursBoard(env, { range: "week", week: key, limit: ROWS }); }
  catch (err) { console.error("[hpw] week board failed", err); return unavailable(); }
  const body = data.body;
  /* The endpoint deliberately has no floor (an empty board is a true answer
     for the tab's arrows), but a PAGE for a week before the index began is a
     URL with nothing behind it, and a crawler would walk them back forever
     through the ‹ arrow. */
  if (body.first_week != null && ws < body.first_week) return notFound();

  const view = { kind: "week", ws, live, first: body.first_week ?? null, body };
  const html = card ? renderCard(view) : renderPage(view);
  // An empty past week stays reachable but is not worth an index entry.
  return page(html, data.cache, { noindex: card || !(body.members || []).length });
}

/* ⚠️ PAGES ROUTES BY METHOD, AND A HEAD FALLS THROUGH TO THE STATIC 404 WHEN
   ONLY onRequestGet IS EXPORTED. The two OG image routes learned this from the
   collector's bot on 2026-08-29 and this page repeated it on 2026-08-30: a
   `curl -I` on /hpw/high-scores answered 404 while GET answered 200. Same
   status and headers, no body. */
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
    // The live week moves every Monday, so nothing here is worth caching
    // longer than the board it points at.
    headers: { Location: url.toString(), "Cache-Control": "public, max-age=60" },
  });
}

function unavailable() {
  return new Response(shell({
    title: "Board unavailable — OnlyBoosts",
    eyebrow: "503",
    h1: "The board is unavailable",
    lead: "The index did not answer. Try again in a moment.",
    body: `<div class="soon-card"><p><a href="/#members">Back to the Members tab</a></p></div>`,
    noindex: true,
  }), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function notFound() {
  return new Response(shell({
    title: "Week not found — OnlyBoosts",
    eyebrow: "404",
    h1: "Week not found",
    lead: "The boards are addressed by a week's Monday, as /hpw/YYYY-MM-DD, or as /hpw/high-scores.",
    body: `<div class="soon-card"><p><a href="/#members">The 40 HPW boards on the Members tab</a></p></div>`,
    noindex: true,
  }), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

// ── the page ─────────────────────────────────────────────────────────────────

/* What the two shapes share: the board itself, and the words around it. */
function describe(view) {
  const { kind, body, live } = view;
  const members = body.members || [];
  const goal = body.goal_hours || 40;
  if (kind === "all") {
    return {
      goal, members,
      key: HIGH,
      title: COPY.proofTitle,
      sub: COPY.proofSub(goal),
      empty: COPY.emptyAll,
      isCurrent: false,
      ogTitle: `Nostr Gang: ${COPY.proofTitle}`,
      lead: leadSentence(members, null, goal),
    };
  }
  const ws = view.ws;
  const isCurrent = ws >= live;
  return {
    goal, members,
    key: weekDateString(ws),
    /* The page names the week where the tab says "This Week": a link is read
       later, by somebody who was not there, and "This Week" on a page opened
       next month is wrong in a way a date never is. The tab's relative title
       is kept for its own picker. */
    title: `Week of ${weekLabel(ws)}`,
    sub: COPY.weekSub(ws, isCurrent),
    empty: isCurrent ? COPY.emptyLive : COPY.emptyPast,
    isCurrent,
    ogTitle: `Nostr Gang #40HPW: Week of ${weekLabel(ws)}`,
    lead: leadSentence(members, ws),
  };
}

/* The og:description, and the one sentence on the page that says what the
   figures are. It carries the qualifier in full because it is the string that
   travels without the page around it. */
function leadSentence(members, ws, goal = 40) {
  const top = members[0];
  const rule = "Boost an episode on Nostr and the board assumes you listened to all of it.";
  if (!top) return `${rule} Nobody is on this board yet.`;
  const name = top.name || "Somebody";
  /* Proof ranks by a count of weeks, so the sentence has to name that count
     rather than the hours: "leads with 58.4 hours" over a board ordered by
     something else is a description of a different table. */
  if (ws === null && top.weeks != null) {
    const n = top.weeks;
    return `${rule} ${members.length} member${members.length === 1 ? " has" : "s have"} cleared ` +
      `${goal} hours in a week. ${name} leads with ${n} such week${n === 1 ? "" : "s"}, ` +
      `the best of them ${hours(top.seconds)} hours.`;
  }
  const when = ws ? ` for the week of ${weekLabel(ws)}` : " of all time";
  return `${rule} ${name} leads${when} with ${hours(top.seconds)} hours across ` +
    `${top.episodes} episode${top.episodes === 1 ? "" : "s"}.`;
}

function arrowsHtml(view) {
  const { ws, live, first } = view;
  const prev = prevWeek(ws), next = nextWeek(ws);
  const prevOff = first != null && prev < first;
  const nextOff = next > live;
  const arrow = (off, href, glyph, label) => off
    ? `<span class="hpw-arrow" aria-disabled="true" aria-label="${htmlEscape(label)}">${glyph}</span>`
    : `<a class="hpw-arrow" href="${htmlEscape(href)}" aria-label="${htmlEscape(label)}" title="${htmlEscape(label)}">${glyph}</a>`;
  return `<span class="hpw-nav">` +
    arrow(prevOff, `/hpw/${weekDateString(prev)}`, "‹", "Previous week") +
    `<span class="hpw-pick-wrap"><span class="hpw-pick hpw-pick--static">Week of ${htmlEscape(weekLabel(ws))}</span></span>` +
    arrow(nextOff, `/hpw/${weekDateString(next)}`, "›", "Next week") +
    `</span>`;
}

export function renderPage(view) {
  const d = describe(view);
  const pageUrl = `${SITE_ORIGIN}/hpw/${d.key}`;
  const image = `${SITE_ORIGIN}/api/og/hpw/${d.key}.png`;
  const board = boardHtml({
    board: view.kind === "all" ? "all" : "week",
    title: d.title,
    titleHtml: view.kind === "week" ? arrowsHtml(view) : null,
    sub: d.sub,
    members: d.members,
    goal: d.goal,
    empty: d.empty,
    // On Proof of #40HPW a row's best week links to that week's page.
    weekHref: view.kind === "all" ? (date) => `/hpw/${date}` : null,
  });
  const body = `
<div class="hpw-page" data-hpw-page="${htmlEscape(d.key)}"${d.isCurrent ? ' data-hpw-live="1"' : ""} data-hpw-image="${htmlEscape(image)}" data-hpw-url="${htmlEscape(pageUrl)}">
  <div class="hpw-boards hpw-boards--page">${board}</div>
  <!-- The share control mounts here: Post to Nostr, Copy link, Share image.
       A verb, so hpw-page.js attaches it; empty in the document. -->
  <div class="hpw-share" data-hpw-share hidden></div>
  <p class="hpw-page-links">
    <a href="/#members">The live boards on the Members tab</a>
    ${view.kind === "week" ? ` · <a href="/hpw/${HIGH}">${htmlEscape(COPY.proofTitle)}</a>` : ""}
  </p>
</div>`;
  return shell({
    title: `${d.ogTitle} — OnlyBoosts`,
    eyebrow: COPY.challenge,
    h1: d.title,
    lead: COPY.intro,
    body,
    canonical: pageUrl,
    og: { title: d.ogTitle, description: d.lead, image, url: pageUrl },
    scripts: `<script src="/assets/js/hpw-page.js?v=ob-v184" type="module"></script>`,
    extraCss: `
    /* The tab supplies the accent family off body[data-active-feed]; this page
       has no active feed and supplies the brand, as .show-main does. */
    .hpw-page { --accent: var(--brand); --accent-d: var(--brand-d); --accent-dd: var(--brand-dd); --tint: rgba(0, 175, 240, 0.1); }
    .hpw-boards--page { grid-template-columns: 1fr; }
    .hpw-page-links { margin: 1.25rem 0 0; font-size: 0.86rem; color: var(--muted); text-align: center; }
    .hpw-page-links a { color: var(--brand-dd); }
    :root[data-theme="dark"] .hpw-page-links a { color: var(--brand-d); }`,
  });
}

// ── the card ─────────────────────────────────────────────────────────────────

/* The frame the bot screenshots is functions/_shared/card-frame.js since
   2026-09-03 (the chart cards share it); this supplies the 40 HPW board and
   the rules that size its rows to the frame. The numbers are the ones the
   collector measured (see the frame's note); change one and have the bot
   re-measure. */
export function renderCard(view) {
  const d = describe(view);
  const board = boardHtml({
    board: view.kind === "all" ? "all" : "week",
    title: d.title,
    sub: view.kind === "week" && d.isCurrent
      ? `In progress. ${weekSpan(view.ws)}.`
      : d.sub,
    members: d.members,
    goal: d.goal,
    empty: d.empty,
    card: true,
  });
  return cardHtml({
    title: d.ogTitle,
    kicker: COPY.challenge,
    kickerSub: COPY.intro,
    board,
    footer: "onlyboosts.social/#members",
    links: `  <link rel="stylesheet" href="/assets/css/hpw-board.css?v=ob-v184" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v184" />`,
    css: `
    .card .hpw-board { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0.7rem 1.1rem 0.6rem; }
    .card .hpw-title { margin-bottom: 0.4rem; flex: none; font-size: 1.1rem; }
    .card .hpw-list { flex: 1; min-height: 0; overflow: hidden; }
    .card .hpw-row { padding: 0.22rem 0.5rem; gap: 0.55rem; }
    .card .hpw-face { width: 40px; height: 40px; }
    .card .hpw-face--none { font-size: 0.85rem; }
    .card .hpw-who { line-height: 1.2; }
    .card .hpw-name { font-size: 0.95rem; }
    .card .hpw-week, .card .hpw-week-jump { font-size: 0.62rem; }
    .card .hpw-hours { font-size: 1.05rem; }`,
  });
}

// ── the shell ────────────────────────────────────────────────────────────────

/* The plain content-page chrome (page.css: navy header, cream main, a 640px
   column), the same shape /about and /stats wear. The board sits in that
   column at the width it has on the tab. */
function shell({ title, eyebrow, h1, lead, body, canonical = null, og = null, scripts = "", extraCss = "", noindex = false }) {
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
  <!-- The card is PORTRAIT (720x900 at 2x), so it takes the square summary
       thumbnail, as the square artwork on the other detail pages does: a
       large card crops a wide band out of the middle of a tall board, where
       the square loses a little top and bottom. Nostr clients and chat apps
       show the image at its own shape and are unaffected. -->
  <meta property="og:image" content="${htmlEscape(og.image)}" />
  <meta property="og:image:alt" content="${htmlEscape(og.title)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${htmlEscape(og.title)}" />
  <meta name="twitter:description" content="${htmlEscape(og.description)}" />
  <meta name="twitter:image" content="${htmlEscape(og.image)}" />
` : ""}
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v184" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v184" />
  <!-- feed-cards.css for the share pill and its menu; boost-actions.css for
       the composer behind Post to Nostr. Both are the same chrome the tab
       already has. -->
  <link rel="stylesheet" href="/assets/css/feed-cards.css?v=ob-v184" />
  <link rel="stylesheet" href="/assets/css/boost-actions.css?v=ob-v184" />
  <link rel="stylesheet" href="/assets/css/hpw-board.css?v=ob-v184" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v184" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v184" />
  ${extraCss ? `<style>${extraCss}\n  </style>` : ""}
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
  <div class="page-inner">
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

<script src="/assets/js/nav.js?v=ob-v184" defer></script>
${scripts}
<script src="/assets/js/nav-widget-boot.js?v=ob-v184"></script>
<script src="/assets/js/sw-register.js?v=ob-v184" defer></script>
</body>
</html>`;
}
