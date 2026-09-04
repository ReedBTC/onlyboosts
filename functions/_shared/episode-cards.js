// Server-rendered episode cards, for the three surfaces that show a list of them.
//
// ⚠️ THIS FILE OWNS NO MARKUP. Every byte of a card comes from
// assets/js/episode-card.js, which the browser imports over a stamped URL and
// which esbuild inlines here off the filesystem when wrangler bundles the Pages
// Functions. What lives in this module is the little that is genuinely
// server-side: turning D1 boost rows into the item shape, applying the surface's
// opening sort, and writing the small state element the client adopts the result
// through. If a change to how a card LOOKS lands here, it has landed in the
// wrong file.
//
// The three callers and what differs between them:
//
//   functions/index.js          Episodes · Global, ranked by /api/v1/episodes
//   functions/episode/[guid].js #community-episodes, over this episode's
//                               community corpus
//   functions/booster/[npub].js #episodes, over one person's own corpus
//
// Both open on Chart rank since 2026-09-03 (Reed's ask), the chart formula
// over the drawer's own rows — sortEpisodeItems(…, 'chart') in episode-card.js.
// They opened on Most boosts and Most sats respectively before that.
//
// Only the corpus and the opening sort differ, which is why they share this.
import {
  COPY, CARD_PARTS, buildEpisodes, renderEpisodeCards, sortEpisodeItems, RANKED_SORTS,
  episodeRankValue, episodeRanks,
} from "../../assets/js/episode-card.js";
import { rankLabel } from "../../assets/js/rank.js";
import { normalizeBoosts, toEpisodeShape } from "../../assets/js/ob-data.js";
import { jsonForScript } from "./detail-page.js";

// One page of cards, matching CARDS_PER_PAGE in the two client modules. A
// server render that painted a different number than the client's first slice
// would make "Load N more" skip or repeat rows.
export const CARDS_PER_PAGE = 30;

/**
 * Boost records (the collector's published shape, which is also what every
 * /api/v1 endpoint returns) → ranked items ready to render.
 *
 * ⚠️ THE SAME CHAIN THE BROWSER RUNS, function for function: normalizeBoosts →
 * toEpisodeShape → buildEpisodes → sortEpisodeItems. That is the point of it
 * being reachable from here — a card built at the edge and the same card rebuilt
 * in the browser after a re-sort have to be the same string, and the only way to
 * guarantee that is for both to run the same code over the same model.
 */
export function itemsFromBoosts(records, { sort = "boosts" } = {}) {
  const rows = normalizeBoosts({ boosts: Array.isArray(records) ? records : [] });
  const shaped = toEpisodeShape(rows);
  const items = sortEpisodeItems(buildEpisodes(shaped), sort);
  return { items, profiles: shaped.profiles };
}

/**
 * A page of cards plus the state element that lets the client take over.
 *
 * `total` is the number of items the whole ranked view holds, not the number
 * painted: the client needs it to label its "Load N more" without refetching
 * anything, and a section that says "Showing 30 of 30" when there are 189 is a
 * lie the reader can't see through.
 */
export function renderCardPage(items, {
  copy = COPY.other, profiles = new Map(), sort = "boosts", range = "all",
  limit = CARDS_PER_PAGE, showRanks = true, parts = CARD_PARTS, state = {},
} = {}) {
  const page = items.slice(0, limit);

  /* ⚠️ COMPETITION RANKS, NOT POSITIONS. This was `i + 1` until 2026-08-18,
   * which meant two episodes with the same boost count were numbered #4 and #5
   * by whichever had more sats — a tiebreak the ORDER BY carries so that paging
   * is stable, and which must not decide a standing. Ties now share the better
   * place and the next value skips the group. See assets/js/rank.js.
   *
   * `page` is a prefix of the full ranked view from index 0, which is what makes
   * this exact with no seed. Stamped here rather than left to the client so a
   * card is numbered the same whichever side rendered it. Chronological sorts
   * pass no rank at all — a numeral under "Latest boost" reads as a score when
   * it is only order. */
  const ranked = showRanks && RANKED_SORTS.has(sort);
  /* episodeRanks over the WHOLE view (the chart's standing is a rank sum over
   * everything, not over the page), then the page's prefix of it. */
  const ranks = ranked ? episodeRanks(items, sort).slice(0, page.length) : null;
  // The chart has no single figure to carry across a page boundary; the
  // homepage adoption this serves ranks on one axis.
  const valueOf = ranked && sort !== "chart" ? episodeRankValue(sort) : null;

  const html = renderEpisodeCards(page, {
    copy,
    profiles,
    parts,
    // The label, not the number: `T4` where the place is shared. The last card
    // of this page can only see the ties inside it — the client re-syncs that
    // one row once it has fetched what follows. See assets/js/rank.js.
    rankOf: (_it, i) => (ranks ? rankLabel(ranks[i].rank, ranks[i].tied) : null),
  });
  // ⚠️ `card` RIDES THE STATE, and that is not incidental. episode-section.js and
  // feeds-podcasts.js both repaint these cards on a re-sort, so the variant has to
  // travel with them — a surface that hid the player at the edge and re-rendered
  // it in the browser would grow one the first time the reader changed a sort.
  // One declaration per surface, here, in the Function.
  /* ⚠️ THE LAST PAINTED CARD'S RANK AND VALUE RIDE THE STATE, and they exist
   * for exactly one case: the homepage adopts these cards without their data,
   * so when it later fetches page two it holds no row ahead of the first one it
   * has to number. A tie straddling that boundary would restart as a new run
   * and every card below it would be off by the size of the tie. Absent on an
   * unranked sort, where the client numbers nothing. */
  const boundary = ranks && page.length
    ? {
        lastRank: ranks[page.length - 1].rank,
        lastValue: valueOf ? valueOf(page[page.length - 1], page.length - 1) : null,
      }
    : {};

  return html + stateScript({
    sort, range, count: page.length, total: items.length, card: parts,
    ...boundary, ...state,
  });
}

/* The handover, as one <script type="application/json">.
 *
 * ⚠️ IT CARRIES STATE, NEVER CONTENT. The temptation is to embed the rows the
 * cards were built from so the client can re-sort without a request — and that
 * is the whole payload again, in JSON, next to the HTML it already produced.
 * Measured on the homepage's opening page: 431KB of records against the markup
 * they became. So the client gets the four numbers it cannot derive from the DOM
 * and fetches the corpus only if the reader actually touches a control.
 *
 * `type="application/json"` is not executable and needs no CSP allowance; the
 * `<` escape in jsonForScript is what keeps a `</script>` inside a value from
 * closing the element early.
 */
function stateScript(state) {
  return `<script type="application/json" data-feed-state>${jsonForScript(state)}</script>`;
}
