// Server-rendered show cards, for the homepage's opening feed.
//
// ⚠️ THIS FILE OWNS NO MARKUP. Every byte of a card comes from
// assets/js/show-card.js, which the browser imports over a stamped URL and which
// esbuild inlines here off the filesystem when wrangler bundles the Pages
// Functions. What lives in this module is the little that is genuinely
// server-side: turning API rows into the card shape, stamping the ranks, and
// writing the small state element the client adopts the result through. If a
// change to how a card LOOKS lands here, it has landed in the wrong file.
//
// The twin of functions/_shared/episode-cards.js, which serves the same purpose
// for the episode card on three surfaces. This one has a single caller
// (functions/index.js) because the show card has a single surface; it is a
// separate module anyway rather than a branch inside that Function, so the day a
// second surface wants show cards there is somewhere for it to call.
import {
  COPY, renderShowCards, toCard, showRankValue, RANKED_SORTS, SHOW_CARDS_PER_PAGE,
} from "../../assets/js/show-card.js";
import { competitionRanks, rankLabel } from "../../assets/js/rank.js";
import { jsonForScript } from "./detail-page.js";

// Re-exported, never redeclared: the number lives in the card module so the
// browser and the edge read the same one. See the note over it there.
export { SHOW_CARDS_PER_PAGE };

/**
 * `/api/v1/podcasts` rows → cards ready to render.
 *
 * ⚠️ THE SAME FUNCTION THE BROWSER RUNS, which is the point of it being
 * reachable from here. shows-feed.js maps the identical `toCard` over the
 * identical response shape, so a card built at the edge and the same card
 * rebuilt in the browser after a re-sort are the same string by construction
 * rather than by inspection.
 *
 * ⚠️ THE ORDER IS THE SERVER'S AND IS NOT RE-DERIVED. `/api/v1/podcasts` answers
 * already ordered by the active sort, with a tiebreak that makes paging a total
 * order. Re-sorting here by the same key would drop that tiebreak and could
 * reorder a run of tied shows against the ranking D1 actually answered — and
 * competitionRanks assumes the rows it is handed are already ordered by the
 * value it ranks. The array order IS the answer.
 */
export function cardsFromPodcasts(records) {
  return (Array.isArray(records) ? records : []).map(toCard);
}

/**
 * A page of cards plus the state element that lets the client take over.
 */
export function renderShowCardPage(cards, {
  copy = COPY.other, sort = "boosters", range = "all", lang = null,
  limit = SHOW_CARDS_PER_PAGE, showRanks = true, since = null, state = {},
} = {}) {
  const page = cards.slice(0, limit);

  /* ⚠️ COMPETITION RANKS, NOT POSITIONS: ties share the better place and the
   * next distinct value skips the group, so two shows with the same booster
   * count are not separated by the sats tiebreak the endpoint pages by. That
   * tiebreak exists so paging is stable; it must never be what decides a
   * standing. See assets/js/rank.js.
   *
   * `page` is a prefix of the full ranked view from index 0, which is what makes
   * this exact with no seed. Chronological sorts pass no rank at all — a numeral
   * under "Recently boosted" reads as a score when it is only order. */
  const ranked = showRanks && RANKED_SORTS.has(sort);
  /* ⚠️ THE CHART SORT'S STANDING IS THE SERVER'S, ON EVERY ROW — a tuple
   * (score, then boosters, sats, boosts) that competitionRanks cannot
   * re-derive from any single figure. Each record's own rank and tie flag are
   * stamped verbatim, the same server-rank path the browser renderers take
   * for this sort, and the tie flag is corpus-true rather than page-local.
   * The single-column sorts keep the client-computed competition ranks. */
  const chart = ranked && sort === "chart";
  const valueOf = ranked && !chart ? showRankValue(sort) : null;
  const ranks = valueOf ? competitionRanks(page, valueOf) : null;

  const html = renderShowCards(page, {
    copy,
    // The label, not the number: `T4` where the place is shared. On the
    // single-column sorts the last card can only see the ties inside this
    // page — the client re-syncs that one row once it has fetched what
    // follows (see assets/js/rank.js); under chart the flag is already true.
    rankOf: chart
      ? (s) => rankLabel(s.rank, s.tied)
      : (_s, i) => (ranks ? rankLabel(ranks[i].rank, ranks[i].tied) : null),
  });

  /* ⚠️ THE LAST PAINTED CARD'S RANK AND VALUE RIDE THE STATE, and they exist for
   * exactly one case: the homepage adopts these cards as markup with no data
   * behind them, so when it later fetches page two it holds no row ahead of the
   * first one it has to number. A tie straddling that boundary would restart as
   * a new run and every card below it would be off by the size of the tie.
   * Absent on an unranked sort, where the client numbers nothing — and on
   * chart, where every row wears the server's rank and the client's
   * renumbering paths return early (renumber / syncRankLabels). */
  const boundary = ranks && page.length
    ? {
        lastRank: ranks[page.length - 1].rank,
        lastValue: valueOf(page[page.length - 1], page.length - 1),
      }
    : {};

  /* ⚠️ `data-since` IS READ AT DRAWER-OPEN TIME, not at wire time — see
   * wireDrawer in show-card-actions.js. It scopes the drawer's episode rows to
   * the same window the cards' own figures were computed over. Empty on All,
   * which is the homepage's opening range. */
  const attrs = since ? ` data-since="${Number(since)}"` : "";

  return `<div class="pcast-list" data-show-list${attrs}>${html}</div>` + stateScript({
    sort, range, lang, count: page.length, ...boundary, ...state,
  });
}

/* The handover, as one <script type="application/json">.
 *
 * ⚠️ IT CARRIES STATE, NEVER CONTENT. The temptation is to embed the rows the
 * cards were built from so the client can re-sort without a request — and that
 * is the whole payload again, in JSON, next to the HTML it already produced. So
 * the client gets the few numbers it cannot derive from the DOM and fetches the
 * corpus only if the reader actually touches a control.
 *
 * `type="application/json"` is not executable and needs no CSP allowance; the
 * `<` escape in jsonForScript is what keeps a `</script>` inside a value from
 * closing the element early.
 */
function stateScript(state) {
  return `<script type="application/json" data-feed-state>${jsonForScript(state)}</script>`;
}
