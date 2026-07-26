/* One place that decides whether a show title links to its landing page.
 *
 * Show titles appear on three surfaces — the Shows feed's cards, the Episodes
 * feed's cards, and the boost cards' meta line — and all three link to
 * /show/<podcast-guid>. The rule for *whether* to link is subtle enough that
 * three copies of it would drift.
 *
 * Two ways a title can have no page behind it:
 *
 *   1. No guid at all. ~2% of boost records carry no podcast guid.
 *   2. A SYNTHETIC guid. ob-data.js#toEpisodeShape keys its rollup on
 *      `unknown:<item_guid>` when a boost has no podcast guid, so the string is
 *      present and looks real while pointing at nothing. Linking it would
 *      manufacture a 404 out of data we already know is incomplete.
 *
 * Beyond that the page's own qualifying rule is simply "the show has a title",
 * which is why every caller checks the title before asking for a href. A show
 * we can name is a show with a page.
 */

const SYNTHETIC_PREFIX = 'unknown:'

/**
 * The landing-page URL for a show guid, or null when there isn't one.
 *
 * Callers should treat null as "render plain text": an unidentified show is
 * still a real row worth showing, it just has nothing to link to.
 */
export function showPageHref(guid) {
  if (typeof guid !== 'string') return null
  const g = guid.trim()
  if (!g || g.startsWith(SYNTHETIC_PREFIX)) return null
  return `/show/${encodeURIComponent(g)}`
}
