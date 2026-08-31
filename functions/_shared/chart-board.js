// The OnlyBoosts Charts boards' rows, as HTML strings — the FACTS half of the
// /charts page, on the hpw-board.js pattern.
//
// SERVER-ONLY, unlike hpw-board.js: no tab paints these boards, so there is no
// browser importer and the file lives in functions/_shared rather than
// assets/js. It still keeps the two-sided module's discipline — no DOM, no
// fetch, no Date.now(), every locale pinned to en-US in UTC — because at the
// edge the clock is the moment the response was cached, and because gaining a
// client surface later should be a move, not a rewrite.
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

import { htmlEscape, isSafeUrl } from "../../assets/js/nostr-text.js";
import { httpsUrl } from "../../assets/js/cover-art.js";
import { showPageHref, episodePageHref, publisherPageHref } from "../../assets/js/show-link.js";
import { boosterPageHref } from "../../assets/js/booster-link.js";
import { rankLabel, competitionRanks } from "../../assets/js/rank.js";
import { weekDateString } from "../../assets/js/pacific-week.js";
import { boardHtml as hpwBoardHtml, initials, COPY as HPW_COPY } from "../../assets/js/hpw-board.js";

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
  const c = (rank, peers) => rankLabel(rank, Number(peers) > 1);
  return `<li class="cb-row">` +
    `<span class="cb-pos">${esc(rankLabel(r.rank, r.tied))}</span>` +
    art(r, w.glyph) +
    w.html +
    `<span class="cb-ranks" title="This week's rank in sats / boosters / boosts">` +
      `${esc(c(r.r_sats, r.peers_sats))}/${esc(c(r.r_boosters, r.peers_boosters))}/${esc(c(r.r_boosts, r.peers_boosts))}` +
    `</span>` +
    `</li>`;
}

/* One weeks-at-#1 row. The sub-line is the most recent #1 week, linking to
 * that week's own page — the high-scores board's discovery idiom, one URL
 * scheme over. Ranks are competitionRanks over the weeks figure, computed by
 * the caller so a board is ranked once, not per row. */
export function onesRowHtml(kind, r, rk) {
  const date = weekDateString(r.last_week_start);
  const sub = `<a class="cb-sub cb-week-jump" href="/charts/${esc(date)}"` +
    ` title="Show the whole board for this week">Last: ${esc(weekLabel(r.last_week_start))}</a>`;
  const w = who(kind, r, sub);
  return `<li class="cb-row">` +
    `<span class="cb-pos">${esc(rankLabel(rk.rank, rk.tied))}</span>` +
    art(r, w.glyph) +
    w.html +
    `<span class="cb-fig">${esc(fmt(r.weeks))}<span class="cb-unit"> wk${Number(r.weeks) === 1 ? "" : "s"}</span></span>` +
    `</li>`;
}

export function boardHtml({ title, sub, rows, empty, board, colhead = false }) {
  const body = rows.length
    ? `<ol class="cb-list">${rows.join("")}</ol>`
    : `<p class="cb-empty">${esc(empty)}</p>`;
  return `<section class="cb-board"${board ? ` data-cb-board="${esc(board)}"` : ""}>` +
    `<h3 class="cb-head">${esc(title)}<small>${esc(sub)}</small></h3>` +
    (colhead && rows.length ? `<div class="cb-colhead">sats/boosters/boosts</div>` : "") +
    body +
    `</section>`;
}

/* One content category: the h2 and the pair. `weekly` and `ones` are the
 * query rows. */
export function sectionHtml(kind, { weekly, ones, ws, isCurrent }) {
  const c = COPY.sections[kind];
  const onesRanks = competitionRanks(ones, (r) => Number(r.weeks));
  const weekBoard = boardHtml({
    board: `${kind}-week`,
    title: "Top 10",
    sub: isCurrent ? `In progress. ${weekSpan(ws)}.` : `${weekSpan(ws)}.`,
    rows: weekly.map((r) => weekRowHtml(kind, r)),
    empty: isCurrent ? COPY.emptyLive : COPY.emptyPast,
    colhead: true,
  });
  const onesBoard = boardHtml({
    board: `${kind}-ones`,
    title: "Weeks at #1",
    sub: c.onesSub,
    rows: ones.map((r, i) => onesRowHtml(kind, r, onesRanks[i])),
    empty: COPY.emptyOnes,
  });
  return `<section class="cb-section" id="${esc(kind)}">` +
    `<h2 class="cb-section-h">${esc(c.heading)}</h2>` +
    `<div class="cb-pairs">${weekBoard}${onesBoard}</div>` +
    `</section>`;
}

/* One member's weeks-at-#1 row, wearing the .hpw-* classes outright — a
 * member row here and on the tab must be one grammar, and this board differs
 * from a tab row only in its figure (weeks, not hours). */
export function memberOnesRowHtml(m, rk) {
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
  const date = weekDateString(m.last_week_start);
  const week = `<a class="hpw-week hpw-week-jump" href="/charts/${esc(date)}"` +
    ` title="Show this page for that week">Last: ${esc(weekLabel(m.last_week_start))}</a>`;
  return `<li class="hpw-row">` +
    `<span class="hpw-pos">${esc(rankLabel(rk.rank, rk.tied))}</span>` +
    face +
    `<span class="hpw-who">${whoM}${week}</span>` +
    `<span class="hpw-hours">${esc(String(m.weeks))}<span class="hpw-unit"> wk${Number(m.weeks) === 1 ? "" : "s"}</span></span>` +
    `</li>`;
}

/* The Members pair. The LEFT board is hpw-board.js's boardHtml over the hours
 * endpoint's own envelope — identical to the tab's weekly 40 HPW board by
 * construction, gold rows and all. The RIGHT is the Weeks at #1 companion:
 * most weeks finishing #1 on that board, by hours. `hours` is hoursBoard's
 * `body`; `ones` is hpwWeeksAtNumberOne's rows. */
export function memberSectionHtml({ hours, ones, ws, isCurrent }) {
  const left = hpwBoardHtml({
    board: "members-week",
    title: "Top 10",
    sub: isCurrent ? `In progress. ${weekSpan(ws)}.` : `${weekSpan(ws)}.`,
    members: hours.members || [],
    goal: hours.goal_hours || 40,
    empty: isCurrent ? HPW_COPY.emptyLive : HPW_COPY.emptyPast,
  });
  const ranks = competitionRanks(ones, (r) => Number(r.weeks));
  const body = ones.length
    ? `<ol class="hpw-list">${ones.map((m, i) => memberOnesRowHtml(m, ranks[i])).join("")}</ol>`
    : `<p class="cb-empty">${esc(COPY.emptyOnes)}</p>`;
  const right = `<section class="cb-board" data-cb-board="members-ones">` +
    `<h3 class="cb-head">Weeks at #1<small>${esc(COPY.sections.members.onesSub)}</small></h3>` +
    body +
    `</section>`;
  return `<section class="cb-section" id="members">` +
    `<h2 class="cb-section-h">${esc(COPY.sections.members.heading)}</h2>` +
    `<div class="cb-pairs">${left}${right}</div>` +
    `</section>`;
}

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
  intro: "The top shows, artists and members by Nostr boosts, chart week by chart week.",
  formula: "Ranked by the OnlyBoosts Charts formula: rank in sats, plus rank in boosts, plus rank in boosters; the lowest total is first.",
  sections: {
    shows: { heading: "Shows", onesSub: "Most weeks finishing #1 on the weekly Shows chart. Completed weeks only." },
    artists: { heading: "Artists", onesSub: "Most weeks finishing #1 on the weekly Artists chart. Completed weeks only." },
    members: { heading: "Members", onesSub: "Most weeks finishing #1 on the weekly 40 HPW board. Completed weeks only." },
  },
  emptyLive: "No Nostr boosts yet this week.",
  emptyPast: "No Nostr boosts that week.",
  emptyOnes: "No completed weeks yet.",
};
