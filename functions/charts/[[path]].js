// /charts/<key>/card/<kind> — THE CHART SHARE-CARD FRAMES, and nothing else.
//
//   /charts/<YYYY-MM-DD>/card/shows      that week's Shows Top 10 (chart rule)
//   /charts/<YYYY-MM-DD>/card/artists    that week's Artists Top 10
//   /charts/weeks-at-1/card/shows        Shows: Weeks at #1 (completed weeks)
//   /charts/weeks-at-1/card/artists      Artists: Weeks at #1
//   /charts/weeks-at-1/card/members      Members: Weeks at #1 on the 40 HPW board
//
// Each is the board in the fixed 720x900 frame (functions/_shared/card-frame.js)
// the collector's bot (bots/hpw-cards/) screenshots at 2x and publishes as
// shards/charts/<key>.png, which /api/og/charts/<key>.png proxies and the
// share modal (hpw-share.js) uploads to Blossom. noindex. A non-Monday date
// 302s to its Monday keeping /card/<kind>; a future date to the live week; a
// week before the index, or an unknown kind, is a 404.
//
// ⚠️ THE ONLYBOOSTS CHARTS PAGE THAT LIVED HERE IS GONE (torn down 2026-09-04,
// Reed's call, two days after it shipped). The same boards live on the
// homepage now — the Shows and Artists feeds carry the weekly Top 10 with the
// week picker beside Weeks at #1 (assets/js/charts-block.js), and the Members
// tab stacks its Weeks at #1 behind Proof of #40HPW — so the page had become
// a second copy of three things one tab over, and the CHARTS wordmark links
// that pointed at it went with it. `/charts` and `/charts/<date>` 302 to the
// Shows feed, since the page's URL was linked from the site for two days;
// the card routes are unchanged because the bot's contract names them. The
// page's renderer (sectionHtml, the stepper, the masthead) is in git before
// this commit; the queries it used are still functions/_shared/week-charts.js,
// serving /api/v1/charts.
//
// ⚠️ THE WEEK IS THE 40 HPW WEEK: Monday 00:00 US Pacific, cut by
// assets/js/pacific-week.js. The ranking is sort=chart and nothing else.

import { pacificWeekStart, weekStartFromDate, weekDateString } from "../../assets/js/pacific-week.js";
import { memberOnesBoardHtml, boardHtml, weekRowHtml, onesRowHtml, weekLabel, weekSpan, COPY } from "../../assets/js/chart-board.js";
import { weekBoard, onesBoard } from "../api/v1/charts/[[path]].js";
import { competitionRanks } from "../../assets/js/rank.js";
import { cardHtml } from "../_shared/card-frame.js";

const ROWS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The card frames' kinds. The members' WEEKLY card is /hpw/<date>/card; only
// their Weeks at #1 board is a chart card.
const WEEK_CARD_KINDS = new Set(["shows", "artists"]);
const ONES_CARD_KINDS = new Set(["shows", "artists", "members"]);
// ⚠️ A PATH SEGMENT IN THE WILD: the collector's bot screenshots the literal,
// on the /hpw/high-scores rule. It does not move.
export const ONES_KEY = "weeks-at-1";
// Where the torn-down page's URLs land.
const HOME = "/#shows";

export async function onRequestGet({ request, env, params }) {
  let segs = params.path;
  if (segs == null) segs = [];
  if (!Array.isArray(segs)) segs = [segs];
  segs = segs.filter((s) => s !== "");

  /* Anything that is not a card frame is the old page's address, or garbage
     under it: the Shows feed, where the boards are now. */
  const card = segs.length === 3 && segs[1] === "card";
  if (!card) return redirect(request, HOME, 60);
  const key = segs[0];
  const kind = segs[2];

  if (key === ONES_KEY) {
    if (!ONES_CARD_KINDS.has(kind)) return notFound();
    let data;
    try { data = await onesBoard(env, { kind, limit: ROWS }); }
    catch (err) { console.error("[charts] weeks-at-1 card failed", err); return unavailable(); }
    return page(renderOnesCard({ kind, rows: data.body.rows }), data.cache);
  }

  if (!DATE_RE.test(key) || !WEEK_CARD_KINDS.has(kind)) return notFound();
  const ws = weekStartFromDate(key);
  if (ws === null) return notFound();
  const live = pacificWeekStart(Math.floor(Date.now() / 1000));
  if (ws > live) return redirect(request, `/charts/${weekDateString(live)}/card/${kind}`);
  const canon = weekDateString(ws);
  if (canon !== key) return redirect(request, `/charts/${canon}/card/${kind}`);

  let data;
  try { data = await weekBoard(env, { kind, week: canon, limit: ROWS }); }
  catch (err) { console.error("[charts] week card failed", err); return unavailable(); }
  const b = data.body;
  /* A card for a week before the index began is a URL with nothing behind it. */
  if (b.first_week != null && ws < b.first_week) return notFound();
  return page(renderWeekCard({ kind, ws, isCurrent: b.is_current, rows: b.rows }), data.cache);
}

/* ⚠️ Pages routes by method; a HEAD with no handler falls through to the
   static 404. Same status and headers as the GET, no body. */
export async function onRequestHead(ctx) {
  const resp = await onRequestGet(ctx);
  return new Response(null, { status: resp.status, headers: resp.headers });
}

// ── the responses ────────────────────────────────────────────────────────────

function page(html, maxAge) {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      // The card is the thing the bot photographs, never a page to index.
      "X-Robots-Tag": "noindex",
    },
  });
}

function redirect(request, path, maxAge = 60) {
  const url = new URL(request.url);
  const [pathname, hash] = path.split("#");
  url.pathname = pathname;
  url.search = "";
  url.hash = hash ? `#${hash}` : "";
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": `public, max-age=${maxAge}` },
  });
}

/* Plain answers: a card frame has no nav to dress a 404 or 503 in, and the
   only readers of these URLs are the bot and a share modal that has already
   fetched the PNG. */
function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" },
  });
}
function unavailable() {
  return new Response("The index did not answer. Try again in a moment.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ── the cards ────────────────────────────────────────────────────────────────

/* Both cards link both board stylesheets: the content boards are .cb-* with
   the stepper's .hpw-nav grammar, the members board is .hpw-* rows in a
   .cb-board shell. Written here so scripts/stamp-assets.js sees an href it
   can restamp. */
const CARD_LINKS = `  <link rel="stylesheet" href="/assets/css/hpw-board.css?v=ob-v190" />
  <link rel="stylesheet" href="/assets/css/chart-board.css?v=ob-v190" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v190" />`;

/* The rows sized to the frame. ⚠️ MEASURED BY THE BOT, 2026-09-03: the weekly
   cards' list box is 296.9 → 829 (the column head costs 27.4px), ceiling
   53.3px a row against rows of 49.2–50.2px — 3.1px in hand before the tenth
   show drops off the card. The weeks-at-1 cards have the hpw card's 56.0px
   ceiling. Change a number here and have the bot re-measure
   (bots/hpw-cards/test-clip-guard.py) before believing a budget. */
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

/* The footer names the tab the board lives on — the share note's link. */
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

/* No weekHref: with the page gone a row's "Last:" week has no URL to link, so
   it renders as the tab's jump button, which the frame's css makes inert. */
export function renderOnesCard({ kind, rows }) {
  const heading = COPY.sections[kind].heading;
  const board = kind === "members"
    ? memberOnesBoardHtml(rows, { card: true })
    : boardHtml({
        board: `${kind}-ones`,
        title: "Weeks at #1",
        sub: COPY.sections[kind].onesSub,
        rows: rows.map((r, i) => onesRowHtml(kind, r, competitionRanks(rows, (x) => Number(x.weeks))[i])),
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
