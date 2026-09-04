// The OnlyBoosts Charts boards' rows, as HTML strings — the FACTS half of the
// charts, on the hpw-board.js pattern. The boards live on the homepage (the
// Shows and Artists feeds, the Members tab) and in the share cards; the
// /charts page they were written for was torn down on 2026-09-04.
//
// ⚠️ TWO-SIDED SINCE 2026-09-03. It was functions/_shared/chart-board.js,
// server-only, while the /charts page was the boards' one surface; the move
// it was written to allow happened when the boards joined the Shows and
// Artists feeds on the homepage (Reed's ask): assets/js/charts-block.js
// paints them in the browser from /api/v1/charts, and functions/charts/
// [[path]].js keeps importing this by relative path for the page and the
// card frames, so a row on the tab, on the page and in a screenshot is one
// function. The discipline is hpw-board.js's, enforced the same way by
// scripts/test-weekly-charts.mjs: siblings imported as './x.js?v=…', no DOM,
// no fetch, no Date.now(), every locale pinned to en-US in UTC.
//
// The classes are .cb-*, restating the .hpw-* grammar in
// assets/css/chart-board.css the way .mb-shell restates .bs-shell: the boards
// must LOOK like the 40 HPW boards (Reed's spec) without the members' CSS
// growing content-row rules. The two stylesheets stay in step by hand. The
// MEMBERS pair is the exception that imports rather than restates: its left
// board IS hpw-board.js's boardHtml, and its Weeks at #1 rows wear the .hpw-*
// classes outright, so a member row here and on the tab are one grammar.
//
// ⚠️ THE WEEKLY ROWS PRINT COMPONENT RANKS, NOT RAW FIGURES (Reed's ask,
// 2026-08-31): a `sats/boosters/boosts` column head on the board, and each
// row's standing in the three components as `3/5/T9` — the formula in the
// open at the row, where the raw figures took too much room. A component T
// is computed over the whole week's corpus (peers_* from week-charts.js),
// never over the visible ten.

import { htmlEscape, isSafeUrl } from './nostr-text.js?v=ob-v189';
import { httpsUrl } from './cover-art.js?v=ob-v189';
import { showPageHref, episodePageHref, publisherPageHref } from './show-link.js?v=ob-v189';
import { boosterPageHref } from './booster-link.js?v=ob-v189';
import { rankLabel, competitionRanks } from './rank.js?v=ob-v189';
import { weekDateString } from './pacific-week.js?v=ob-v189';
import { initials } from './hpw-board.js?v=ob-v189';

const esc = htmlEscape;

/* en-US in UTC — safe for a Pacific Monday because Pacific is BEHIND UTC; see
 * weekLabel in hpw-board.js for the one-directional argument. */
export function weekLabel(unixSec) {
  if (!unixSec) return "";
  const d = new Date(Number(unixSec) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/* The span a week covers. `+ 6 days` rather than `+ WEEK` — still Sunday
 * whichever DST offset is in force; the hpw-board.js reasoning. */
export function weekSpan(ws) {
  const end = Number(ws) + 6 * 86400;
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  const a = new Date(Number(ws) * 1000).toLocaleDateString("en-US", opts);
  const b = new Date(end * 1000).toLocaleDateString("en-US", opts);
  const year = new Date(end * 1000).toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" });
  return `${a} to ${b}, ${year}`;
}

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

/* Title + href per kind. The linking rules are show-link.js's, restated only
 * in WHICH function each kind calls; the title checks are the callers' duty
 * there and are made here. */
function subject(kind, r) {
  const title = (r.title || "").trim();
  if (kind === "episodes" || kind === "songs") {
    return {
      title: title || (kind === "songs" ? "Untitled track" : "Untitled episode"),
      href: episodePageHref(r.guid, title),
      sub: (r.p_title || "").trim() || null,
      glyph: kind === "songs" ? "🎵" : "🎙",
    };
  }
  if (kind === "artists") {
    return { title: title || "Unknown artist", href: title ? publisherPageHref(r.guid) : null, sub: null, glyph: "🎤" };
  }
  // shows / albums. The sub-line is the author credit, suppressed when it
  // repeats the title — the creditLine rule's mechanical half.
  const author = (r.author || "").trim();
  const rep = author && author.replace(/^the\s+/i, "").toLowerCase() === title.replace(/^the\s+/i, "").toLowerCase();
  return {
    title: title || (kind === "albums" ? "Untitled album" : "Untitled show"),
    href: title ? showPageHref(r.guid) : null,
    sub: author && !rep ? author : null,
    glyph: kind === "albums" ? "🎵" : "🎙",
  };
}

/* Square artwork, not the members' round face: these rows are shows and
 * episodes, whose art is square by specification. Promoted to https, then held
 * to http(s) — third-party feed content, the hpw face's own discipline. No
 * error wiring: the page ships no facts-side JS, and a dead URL here costs one
 * thumbnail, the same trade the hpw faces make. */
function art(r, glyph) {
  const src = [r.image, r.artwork, r.p_image].map(httpsUrl).find((u) => u && isSafeUrl(u)) || null;
  return src
    ? `<img class="cb-art" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="cb-art cb-art--none" aria-hidden="true">${glyph}</span>`;
}

function who(kind, r, subline) {
  const s = subject(kind, r);
  const name = s.href
    ? `<a class="cb-name" href="${esc(s.href)}">${esc(s.title)}</a>`
    : `<span class="cb-name">${esc(s.title)}</span>`;
  const sub = subline !== undefined ? subline : (s.sub ? `<span class="cb-sub">${esc(s.sub)}</span>` : "");
  return { html: `<span class="cb-who">${name}${sub}</span>`, glyph: s.glyph };
}

/* One weekly-chart row. The position is the SERVER's rank and tie flag — a
 * tuple standing the renderer must never renumber (docs/feeds.md, the Charts
 * section) — and the triplet is the row's standing in each component, in the
 * column head's order: sats / boosters / boosts. */
export function weekRowHtml(kind, r) {
  const w = who(kind, r);
  /* `#2`, or `T#9` when the component place is shared — the detail tiles'
   * chip form (feed-rank.js), and the site's own line: a bare numeral belongs
   * to a position in the visible list, where these are standings in three
   * orderings that are NOT on screen, so each wears the #. The left column's
   * bare position keeps the feed-card form for exactly the same reason. */
  const c = (rank, peers) => `${Number(peers) > 1 ? "T" : ""}#${rank}`;
  return `<li class="cb-row">` +
    `<span class="cb-pos">${esc(rankLabel(r.rank, r.tied))}</span>` +
    art(r, w.glyph) +
    w.html +
    `<span class="cb-ranks" title="This week's rank in sats / boosters / boosts">` +
      `${esc(c(r.r_sats, r.peers_sats))}/${esc(c(r.r_boosters, r.peers_boosters))}/${esc(c(r.r_boosts, r.peers_boosts))}` +
    `</span>` +
    `</li>`;
}

/* The most recent #1 week under a weeks-at-#1 row: the Proof of #40HPW
 * board's discovery idiom, one board over. `weekHref(dateString)` makes it a
 * LINK (the /charts page, where every week has a URL); omitted, it is the
 * picker's jump BUTTON (`data-hpw-goweek`, the tab's delegate), which shows
 * that week on the Top 10 board beside it — hpw-board.js's exact rule. */
function lastWeek(cls, r, weekHref) {
  const date = weekDateString(r.last_week_start);
  const label = `Last: ${esc(weekLabel(r.last_week_start))}`;
  return weekHref
    ? `<a class="${cls} hpw-week-jump" href="${esc(weekHref(date))}" title="Show the whole board for this week">${label}</a>`
    : `<button type="button" class="${cls} hpw-week-jump" data-hpw-goweek="${esc(date)}" title="Show the whole board for this week">${label}</button>`;
}

/* One weeks-at-#1 row. The sub-line is the most recent #1 week (see lastWeek).
 * Ranks are competitionRanks over the weeks figure, computed by the caller so
 * a board is ranked once, not per row. */
export function onesRowHtml(kind, r, rk, { weekHref = null } = {}) {
  const sub = lastWeek("cb-sub", r, weekHref);
  const w = who(kind, r, sub);
  return `<li class="cb-row">` +
    `<span class="cb-pos">${esc(rankLabel(rk.rank, rk.tied))}</span>` +
    art(r, w.glyph) +
    w.html +
    `<span class="cb-fig">${esc(fmt(r.weeks))}<span class="cb-unit"> wk${Number(r.weeks) === 1 ? "" : "s"}</span></span>` +
    `</li>`;
}

/* `title` is escaped text; `titleHtml` is markup and overrides it — only the
 * tab's weekly board passes the second, and only because its title IS the
 * week picker (hpw-board.js's rule). `card` marks the list for the
 * collector's clip guard (`data-card-list`); only a card frame passes it. */
export function boardHtml({ title, titleHtml, sub, rows, empty, board, colhead = false, card = false }) {
  const body = rows.length
    ? `<ol class="cb-list"${card ? " data-card-list" : ""}>${rows.join("")}</ol>`
    : `<p class="cb-empty">${esc(empty)}</p>`;
  /* "rank in" is what stops the triplet reading as counts (`8/8/7` lies
   * without it); the ⓘ is the feed note's own explainer link, same target,
   * same new-tab call — a reader mid-browse gets the formula beside the
   * board, not over it. */
  const head = `<div class="cb-colhead">rank in sats/boosters/boosts ` +
    `<a class="cb-colhead-info" href="/about#charts" target="_blank" rel="noopener"` +
    ` title="How the OnlyBoosts Charts work" aria-label="How the OnlyBoosts Charts work">ⓘ</a></div>`;
  return `<section class="cb-board"${board ? ` data-cb-board="${esc(board)}"` : ""}>` +
    `<h3 class="cb-head">${titleHtml || esc(title)}<small>${esc(sub)}</small></h3>` +
    (colhead && rows.length ? head : "") +
    body +
    `</section>`;
}

/* sectionHtml — one content category's h2 over its pair of boards — was the
 * /charts page's and went with it (2026-09-04); the homepage block builds its
 * pair from boardHtml directly. */

/* One member's weeks-at-#1 row, wearing the .hpw-* classes outright — a
 * member row here and on the tab must be one grammar, and this board differs
 * from a tab row only in its figure (weeks, not hours). */
export function memberOnesRowHtml(m, rk, { weekHref = null } = {}) {
  const href = boosterPageHref(m.npub, m.pk);
  const name = m.name || (m.npub ? m.npub.slice(0, 12) + "…" : (m.pk || "").slice(0, 12) + "…");
  const upgraded = httpsUrl(m.pic);
  const pic = upgraded && isSafeUrl(upgraded) ? upgraded : null;
  const face = pic
    ? `<img class="hpw-face" src="${esc(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="hpw-face hpw-face--none" aria-hidden="true">${esc(initials(m.name, m.pk))}</span>`;
  const whoM = href
    ? `<a class="hpw-name" href="${esc(href)}">${esc(name)}</a>`
    : `<span class="hpw-name">${esc(name)}</span>`;
  const week = lastWeek("hpw-week", m, weekHref);
  return `<li class="hpw-row">` +
    `<span class="hpw-pos">${esc(rankLabel(rk.rank, rk.tied))}</span>` +
    face +
    `<span class="hpw-who">${whoM}${week}</span>` +
    `<span class="hpw-hours">${esc(String(m.weeks))}<span class="hpw-unit"> wk${Number(m.weeks) === 1 ? "" : "s"}</span></span>` +
    `</li>`;
}

/* The members' Weeks at #1 board on its own: the page's right-hand board,
 * the Members tab's second stacked board (charts-block.js / members-board.js)
 * and the members-weeks-at-1 card are all this. `.hpw-*` rows inside a
 * `.cb-board` shell, the page's own arrangement. */
export function memberOnesBoardHtml(ones, { weekHref = null, titleHtml = null, card = false } = {}) {
  const ranks = competitionRanks(ones, (r) => Number(r.weeks));
  const body = ones.length
    ? `<ol class="hpw-list"${card ? " data-card-list" : ""}>${ones.map((m, i) => memberOnesRowHtml(m, ranks[i], { weekHref })).join("")}</ol>`
    : `<p class="cb-empty">${esc(COPY.emptyOnes)}</p>`;
  return `<section class="cb-board" data-cb-board="members-ones">` +
    `<h3 class="cb-head">${titleHtml || "Weeks at #1"}<small>${esc(COPY.sections.members.onesSub)}</small></h3>` +
    body +
    `</section>`;
}

/* memberSectionHtml — the page's Members pair — went with the page too; the
 * tab paints the weekly 40 HPW board itself and stacks memberOnesBoardHtml
 * behind Proof of #40HPW. */

/* The words, in one place. Every string is user-visible board copy. The
 * qualifier rides the lead sentence and the og:description; the boards
 * themselves say what each figure is at the point of the number, the
 * vocabulary rule's short-label form.
 *
 * ⚠️ ONLY SHOWS, ARTISTS AND MEMBERS ARE ON THE PAGE — Reed's call,
 * 2026-08-31, the day it shipped with five: the episode-level charts are too
 * sparse to be interesting yet. week-charts.js still serves all five kinds
 * (the machinery is generic and tested), so restoring one is a COPY entry
 * and a PAGE_KINDS element, not new queries. */
export const COPY = {
  eyebrow: "OnlyBoosts Charts",
  sections: {
    shows: { heading: "Shows", onesSub: "Most weeks finishing #1 on the weekly Shows chart. Completed weeks only." },
    artists: { heading: "Artists", onesSub: "Most weeks finishing #1 on the weekly Artists chart. Completed weeks only." },
    members: { heading: "Members", onesSub: "Most weeks finishing #1 on the weekly 40 HPW board. Completed weeks only." },
  },
  emptyLive: "No Nostr boosts yet this week.",
  emptyPast: "No Nostr boosts that week.",
  emptyOnes: "No completed weeks yet.",
};
