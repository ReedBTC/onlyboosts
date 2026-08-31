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
// growing content-row rules. The two stylesheets stay in step by hand.

import { htmlEscape, isSafeUrl } from "../../assets/js/nostr-text.js";
import { httpsUrl } from "../../assets/js/cover-art.js";
import { showPageHref, episodePageHref, publisherPageHref } from "../../assets/js/show-link.js";
import { rankLabel, competitionRanks } from "../../assets/js/rank.js";
import { weekDateString } from "../../assets/js/pacific-week.js";

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
 * error wiring: the page ships no client module, and a dead URL here costs one
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
 * section) — printed in golf's T-form via the site's one rankLabel. */
export function weekRowHtml(kind, r) {
  const w = who(kind, r);
  return `<li class="cb-row">` +
    `<span class="cb-pos">${esc(rankLabel(r.rank, r.tied))}</span>` +
    art(r, w.glyph) +
    w.html +
    `<span class="cb-fig">${esc(fmt(r.total_sats))}<span class="cb-unit"> sats</span></span>` +
    `<span class="cb-extra">${esc(fmt(r.booster_count))} booster${Number(r.booster_count) === 1 ? "" : "s"}</span>` +
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

export function boardHtml({ title, sub, rows, empty, board }) {
  const body = rows.length
    ? `<ol class="cb-list">${rows.join("")}</ol>`
    : `<p class="cb-empty">${esc(empty)}</p>`;
  return `<section class="cb-board"${board ? ` data-cb-board="${esc(board)}"` : ""}>` +
    `<h3 class="cb-head">${esc(title)}<small>${esc(sub)}</small></h3>` +
    body +
    `</section>`;
}

/* One category: the h2 and the pair. `weekly` and `ones` are the query rows. */
export function sectionHtml(kind, { weekly, ones, ws, isCurrent }) {
  const c = COPY.sections[kind];
  const onesRanks = competitionRanks(ones, (r) => Number(r.weeks));
  const weekBoard = boardHtml({
    board: `${kind}-week`,
    title: "Top 10",
    sub: isCurrent ? `In progress. ${weekSpan(ws)}.` : `${weekSpan(ws)}.`,
    rows: weekly.map((r) => weekRowHtml(kind, r)),
    empty: isCurrent ? COPY.emptyLive : COPY.emptyPast,
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

/* The words, in one place. Every string is user-visible board copy. The
 * qualifier rides the lead sentence and the og:description; the boards
 * themselves say what each figure is at the point of the number, the
 * vocabulary rule's short-label form. */
export const COPY = {
  eyebrow: "OnlyBoosts Charts",
  intro: "The top shows, episodes, artists, albums and songs by Nostr boosts, chart week by chart week.",
  formula: "Ranked by the OnlyBoosts Charts formula: rank in sats, plus rank in boosts, plus rank in boosters; the lowest total is first.",
  sections: {
    shows: { heading: "Shows", onesSub: "Most weeks finishing #1 on the weekly Shows chart. Completed weeks only." },
    episodes: { heading: "Episodes", onesSub: "Most weeks finishing #1 on the weekly Episodes chart. Completed weeks only." },
    artists: { heading: "Artists", onesSub: "Most weeks finishing #1 on the weekly Artists chart. Completed weeks only." },
    albums: { heading: "Albums", onesSub: "Most weeks finishing #1 on the weekly Albums chart. Completed weeks only." },
    songs: { heading: "Songs", onesSub: "Most weeks finishing #1 on the weekly Songs chart. Completed weeks only." },
  },
  emptyLive: "No Nostr boosts yet this week.",
  emptyPast: "No Nostr boosts that week.",
  emptyOnes: "No completed weeks yet.",
};
