// /charts/<YYYY-MM-DD> — the OnlyBoosts Charts page: the week's Top 10 for
// Shows and Artists on the chart rule, and the Members 40 HPW board, each
// beside its Weeks at #1 companion, all rendered at the edge.
//
//   /charts/<date>   the charts for the week containing that day. Not a
//                    Monday? A future date? 302 to the canonical Monday, or to
//                    the live week, so one week has one URL — the /hpw rule.
//   /charts          302 to the live week.
//
//   /charts/<date>/card/shows          THE SHARE CARDS (2026-09-03). The same
//   /charts/<date>/card/artists        boards in the fixed 720x900 frame
//   /charts/weeks-at-1/card/shows      (functions/_shared/card-frame.js) the
//   /charts/weeks-at-1/card/artists    collector's bot screenshots, one per
//   /charts/weeks-at-1/card/members    board; noindex. The frames are ROUTES
//                    in this Function, not parts of the page above, so they
//                    outlive it: Reed's plan (2026-09-03) is to take the page
//                    down once the boards live on the homepage feeds, and the
//                    bot's contract (bots/hpw-cards/) names these URLs.
//
// ⚠️ THE WEEK IS THE 40 HPW WEEK: Monday 00:00 US Pacific, cut by
// assets/js/pacific-week.js on both sides of the query. The content ranking is
// sort=chart and nothing else — see functions/_shared/week-charts.js for the
// queries and "The OnlyBoosts Charts" in docs/feeds.md for the rule. The
// Members pair ranks by HOURS, the 40 HPW board's own rule, its left board
// rendered from the hours endpoint's hoursBoard — identical to the tab's.
//
// ⚠️ ONLY SHOWS, ARTISTS AND MEMBERS ARE ON THE PAGE (Reed, 2026-08-31): the
// episode-level charts are too sparse to be interesting yet. PAGE_KINDS is the
// page's list; week-charts.js keeps serving all five content kinds.
//
// ⚠️ THE WEEKS AT #1 BOARDS ARE THE SAME ON EVERY WEEK'S PAGE, deliberately:
// they count completed weeks over the whole index, so they are a property of
// the chart, not of the week on screen. Rendering them beside every week is
// the leaderboard idiom the 40 HPW tab established.
//
// The page is facts only — titles, figures, links. The one verb is the week
// picker's dropdown, mounted by /assets/js/charts-page.js over the static
// label; the arrows are plain links, so the no-JS page still steps.

import { pacificWeekStart, prevWeek, nextWeek, weekStartFromDate, weekDateString } from "../../assets/js/pacific-week.js";
import { weeklyChart, weeksAtNumberOne, hpwWeeksAtNumberOne } from "../_shared/week-charts.js";
import {
  sectionHtml, memberSectionHtml, memberOnesBoardHtml, boardHtml, weekRowHtml, onesRowHtml,
  weekLabel, weekSpan, COPY,
} from "../../assets/js/chart-board.js";
import { hoursBoard } from "../api/v1/members/hours.js";
import { weekBoard, onesBoard } from "../api/v1/charts/[[path]].js";
import { competitionRanks } from "../../assets/js/rank.js";
import { cardHtml } from "../_shared/card-frame.js";
import { htmlEscape } from "../../assets/js/nostr-text.js";

export const SITE_ORIGIN = "https://onlyboosts.social";
const ROWS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The page's sections, in order. Restoring a retired chart (episodes, albums,
// songs) is an element here plus a COPY entry in chart-board.js.
const PAGE_KINDS = ["shows", "artists"];
// The card frames' kinds. The members' WEEKLY card is /hpw/<date>/card; only
// their Weeks at #1 board is a chart card.
const WEEK_CARD_KINDS = new Set(PAGE_KINDS);
const ONES_CARD_KINDS = new Set([...PAGE_KINDS, "members"]);
// ⚠️ A PATH SEGMENT IN THE WILD once the collector renders it (the bot
// screenshots the literal), on the /hpw/high-scores rule: it does not move.
export const ONES_KEY = "weeks-at-1";

export async function onRequestGet({ request, env, params }) {
  let segs = params.path;
  if (segs == null) segs = [];
  if (!Array.isArray(segs)) segs = [segs];
  segs = segs.filter((s) => s !== "");

  const live = pacificWeekStart(Math.floor(Date.now() / 1000));
  if (segs.length === 0) return redirect(request, `/charts/${weekDateString(live)}`);
  /* The card frames: /charts/<key>/card/<kind>. Anything else with more than
     one segment is a 404, the /hpw rule. */
  const card = segs.length === 3 && segs[1] === "card";
  if (segs.length > 1 && !card) return notFound();
  const key = segs[0];

  if (card && key === ONES_KEY) {
    const kind = segs[2];
    if (!ONES_CARD_KINDS.has(kind)) return notFound();
    let data;
    try { data = await onesBoard(env, { kind, limit: ROWS }); }
    catch (err) { console.error("[charts] weeks-at-1 card failed", err); return unavailable(); }
    return page(renderOnesCard({ kind, rows: data.body.rows }), data.cache, { noindex: true });
  }

  if (!DATE_RE.test(key)) return notFound();
  const ws = weekStartFromDate(key);
  if (ws === null) return notFound();
  const tail = card ? `/card/${segs[2]}` : "";
  if (ws > live) return redirect(request, `/charts/${weekDateString(live)}${tail}`);
  const canon = weekDateString(ws);
  if (canon !== key) return redirect(request, `/charts/${canon}${tail}`);

  if (card) {
    const kind = segs[2];
    if (!WEEK_CARD_KINDS.has(kind)) return notFound();
    let data;
    try { data = await weekBoard(env, { kind, week: canon, limit: ROWS }); }
    catch (err) { console.error("[charts] week card failed", err); return unavailable(); }
    const b = data.body;
    if (b.first_week != null && ws < b.first_week) return notFound();
    return page(renderWeekCard({ kind, ws, isCurrent: b.is_current, rows: b.rows }), data.cache, { noindex: true });
  }

  const we = nextWeek(ws);
  const isCurrent = ws >= live;

  let first, weekly, ones, hours, mOnes;
  try {
    /* The floor, the content boards, and the members pair, together. The
       floor is load-bearing here (unlike the hours endpoint's best-effort
       first_week): a page for a week before the index began is a URL with
       nothing behind it, and a crawler would walk the ‹ arrow back forever. */
    const firstQ = env.DB.prepare("SELECT MIN(created_at) AS t FROM boosts").first()
      .then((r) => (r && r.t ? pacificWeekStart(r.t) : null));
    const weeklyQ = Promise.all(PAGE_KINDS.map((k) => weeklyChart(env, k, ws, we, ROWS)));
    const onesQ = Promise.all(PAGE_KINDS.map((k) => weeksAtNumberOne(env, k, live, ROWS)));
    const hoursQ = hoursBoard(env, { range: "week", week: canon, limit: ROWS });
    const mOnesQ = hpwWeeksAtNumberOne(env, live, ROWS);
    [first, weekly, ones, hours, mOnes] = await Promise.all([firstQ, weeklyQ, onesQ, hoursQ, mOnesQ]);
  } catch (err) {
    console.error("[charts] queries failed", err);
    return unavailable();
  }
  if (first != null && ws < first) return notFound();

  const html = renderPage({ ws, live, first, isCurrent, weekly, ones, hours: hours.body, mOnes });
  const empty = weekly.every((rows) => rows.length === 0) && !(hours.body.members || []).length;
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

/* The week stepper, in the .hpw-nav grammar so hpw-board.css dresses it and
   the picker the client module mounts is the tab's own. The label ships
   static; charts-page.js upgrades it to the dropdown. */
function arrowsHtml({ ws, live, first }) {
  const prev = prevWeek(ws), next = nextWeek(ws);
  const prevOff = first != null && prev < first;
  const nextOff = next > live;
  const arrow = (off, href, glyph, label) => off
    ? `<span class="hpw-arrow" aria-disabled="true" aria-label="${htmlEscape(label)}">${glyph}</span>`
    : `<a class="hpw-arrow" href="${htmlEscape(href)}" aria-label="${htmlEscape(label)}" title="${htmlEscape(label)}">${glyph}</a>`;
  return `<div class="cb-nav-wrap"><span class="hpw-nav">` +
    arrow(prevOff, `/charts/${weekDateString(prev)}`, "‹", "Previous week") +
    `<span class="hpw-pick-wrap"><span class="hpw-pick hpw-pick--static">Week of ${htmlEscape(weekLabel(ws))}</span></span>` +
    arrow(nextOff, `/charts/${weekDateString(next)}`, "›", "Next week") +
    `</span></div>`;
}

/* The og:description. It carries the qualifier in full because it is the
   string that travels without the page around it. */
function leadSentence(ws) {
  return `The top shows, artists and members for the week of ${weekLabel(ws)}, ` +
    `ranked by Nostr boosts; every figure counts only the boosts published to Nostr and indexed by OnlyBoosts.`;
}

export function renderPage({ ws, live, first, isCurrent, weekly, ones, hours, mOnes }) {
  const key = weekDateString(ws);
  const pageUrl = `${SITE_ORIGIN}/charts/${key}`;
  const sections = PAGE_KINDS.map((kind, i) =>
    sectionHtml(kind, { weekly: weekly[i], ones: ones[i], ws, isCurrent })).join("\n") +
    "\n" + memberSectionHtml({ hours, ones: mOnes, ws, isCurrent });
  const body = `
<div class="charts-page" data-charts-week="${htmlEscape(key)}"${isCurrent ? ' data-charts-live="1"' : ""}${
    first != null ? ` data-charts-first="${htmlEscape(String(first))}"` : ""} data-charts-livews="${htmlEscape(String(live))}">
  ${arrowsHtml({ ws, live, first })}
${sections}
  <p class="cb-formula">${htmlEscape(COPY.formula)} <a href="/about#charts">About the OnlyBoosts Charts</a></p>
</div>`;
  const ogTitle = `OnlyBoosts Charts: Week of ${weekLabel(ws)}`;
  return shell({
    title: `${ogTitle} — OnlyBoosts`,
    /* The banner IS the heading (Reed, 2026-09-01): the big week h1 restated
       the stepper pill right under it, and the lead sentence is carried by
       the og:description where it travels alone. The week's name survives in
       <title>, the canonical, and the pill. */
    headerHtml: `<header class="cb-masthead">
  <img src="/assets/onlyboosts_charts_banner_clear.png" alt="OnlyBoosts Charts" width="1200" height="333" />
</header>`,
    body,
    canonical: pageUrl,
    og: { title: ogTitle, description: leadSentence(ws), image: `${SITE_ORIGIN}/assets/onlyboosts_banner.png`, url: pageUrl },
    scripts: `<script src="/assets/js/charts-page.js?v=ob-v188" type="module"></script>`,
  });
}

// ── the cards ────────────────────────────────────────────────────────────────

/* The kicker's second line names the kind; the board's own title names the
   week or the board. Both cards link both board stylesheets: the content
   boards are .cb-* with the stepper's .hpw-nav grammar, the members board is
   .hpw-* rows in a .cb-board shell. */
const CARD_LINKS = `  <link rel="stylesheet" href="/assets/css/hpw-board.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/chart-board.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v188" />`;

/* The rows sized to the frame. The hpw card's numbers, restated for the .cb-*
   rows: the collector measures the ceiling per card kind (see card-frame.js),
   so a change here wants a re-measure before it is believed. */
const CARD_CSS = `
    .card .cb-board, .card .hpw-board { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0.7rem 1.1rem 0.6rem; }
    .card .cb-head, .card .hpw-title { margin-bottom: 0.4rem; flex: none; font-size: 1.1rem; }
    .card .cb-colhead { flex: none; }
    .card .cb-list, .card .hpw-list { flex: 1; min-height: 0; overflow: hidden; }
    .card .cb-row { padding: 0.22rem 0.5rem; gap: 0.55rem; }
    .card .cb-art { width: 40px; height: 40px; border-radius: 8px; }
    .card .cb-art--none { font-size: 1rem; }
    .card .cb-name { font-size: 0.95rem; }
    .card .cb-sub, .card .cb-week-jump { font-size: 0.62rem; }
    .card .cb-ranks, .card .cb-fig { font-size: 1rem; }
    .card .hpw-row { padding: 0.22rem 0.5rem; gap: 0.55rem; }
    .card .hpw-face { width: 40px; height: 40px; }
    .card .hpw-face--none { font-size: 0.85rem; }
    .card .hpw-name { font-size: 0.95rem; }
    .card .hpw-week, .card .hpw-week-jump { font-size: 0.62rem; }
    .card .hpw-hours { font-size: 1.05rem; }`;

/* The footer names the tab the board lives on — the share note's link, and
   where the page is going. */
const TAB_OF = { shows: "/#shows", artists: "/#artists", members: "/#members" };

export function renderWeekCard({ kind, ws, isCurrent, rows }) {
  const heading = COPY.sections[kind].heading;
  const board = boardHtml({
    board: `${kind}-week`,
    title: `Week of ${weekLabel(ws)}`,
    sub: isCurrent ? `In progress. ${weekSpan(ws)}.` : `${weekSpan(ws)}.`,
    rows: rows.map((r) => weekRowHtml(kind, r)),
    empty: isCurrent ? COPY.emptyLive : COPY.emptyPast,
    colhead: true,
    card: true,
  });
  return cardHtml({
    title: `OnlyBoosts Charts: ${heading}, Week of ${weekLabel(ws)}`,
    kicker: COPY.eyebrow,
    kickerSub: `${heading} Top 10`,
    board,
    footer: `onlyboosts.social${TAB_OF[kind]}`,
    links: CARD_LINKS,
    css: CARD_CSS,
  });
}

export function renderOnesCard({ kind, rows }) {
  const heading = COPY.sections[kind].heading;
  const weekHref = (d) => `/charts/${d}`;
  const board = kind === "members"
    ? memberOnesBoardHtml(rows, { weekHref, card: true })
    : boardHtml({
        board: `${kind}-ones`,
        title: "Weeks at #1",
        sub: COPY.sections[kind].onesSub,
        rows: rows.map((r, i) => onesRowHtml(kind, r, competitionRanks(rows, (x) => Number(x.weeks))[i], { weekHref })),
        empty: COPY.emptyOnes,
        card: true,
      });
  return cardHtml({
    title: `OnlyBoosts Charts: ${heading}, Weeks at #1`,
    kicker: COPY.eyebrow,
    kickerSub: `${heading}: Weeks at #1`,
    board,
    footer: `onlyboosts.social${TAB_OF[kind]}`,
    links: CARD_LINKS,
    css: CARD_CSS,
  });
}

// ── the shell ────────────────────────────────────────────────────────────────

/* The plain content-page chrome (page.css), the same shape /about, /stats and
   /hpw wear. The boards sit in a widened column (.cb-inner, 60rem — the site's
   own --feed-track measure) so a pair fits side by side. feed-cards.css is for
   the picker's .pcast-sort-menu; hpw-board.css dresses the stepper and the
   Members pair's rows. */
function shell({ title, eyebrow, h1, lead, body, canonical = null, og = null, scripts = "", noindex = false, headerHtml = null }) {
  /* The week pages hand in a masthead (the charts banner on the page ground,
     the homepage's own pattern — the wordmark's darker blue would go muddy on
     the navy band); the 404/503 shells keep the text header. */
  const header = headerHtml || `<section class="page-header">
  <p class="page-eyebrow">${htmlEscape(eyebrow)}</p>
  <h1>${htmlEscape(h1)}</h1>
  <p>${htmlEscape(lead)}</p>
</section>`;
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

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/feed-cards.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/hpw-board.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/chart-board.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v188" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v188" />
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
                 Podcasts opens Shows (Episodes until 2026-09-03), Music opens
                 Artists and Members opens Boosts. **Those three hrefs and
                 TAB_DEFAULT move together.**

                 The Global vs Follows axis stays deliberately absent: it is the
                 second dropdown on the page itself, and listing both scopes
                 here made the nav a grid restating a control the page has. -->
            <div class="nav-explore-group">
              <h4>Feeds</h4>
              <a href="/#shows"><span aria-hidden="true">🎙</span> Podcasts</a>
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

${header}

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
        <li><a href="/#shows">🎙 Podcasts</a></li>
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

<script src="/assets/js/nav.js?v=ob-v188" defer></script>
${scripts}
<script src="/assets/js/nav-widget-boot.js?v=ob-v188"></script>
<script src="/assets/js/sw-register.js?v=ob-v188" defer></script>
</body>
</html>`;
}
