/* One place that decides whether a title links to its landing page.
 *
 * Two landing pages, two rules, one module. The filename still says "show"
 * because the show rule was here first and a module filename is not a URL — the
 * same call the site makes for feeds-podcasts.js, which renders Episodes and
 * Songs. See the naming note in CLAUDE.md.
 *
 * Show titles appear on three surfaces — the Shows feed's cards, the Episodes
 * feed's cards, and the boost cards' meta line — and all three link to
 * /show/<podcast-guid>. Episode titles appear on the Episodes and Songs cards
 * and link to /episode/<item-guid>. The rule for *whether* to link is subtle
 * enough in both cases that copies of it would drift, and keeping the pair
 * together is what stops the two rules drifting from each other.
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

/**
 * The landing-page URL for an episode, or null when there isn't one.
 *
 * The qualifying rule is the TITLE, not the guid, and that is not the same test
 * as the show one above. `functions/episode/[guid].js` serves a page for any
 * episode the collector has enriched, and enrichment is what produces a title:
 * 6,682 of the 7,182 episodes carrying an indexed boost have one, and that
 * figure is exactly the collector's own `eps_enriched`. The other 500 are boosts
 * tagged with an item guid Podcast Index cannot identify — they render as
 * "Untitled episode" and have nothing behind them.
 *
 * A missing SHOW is deliberately not disqualifying, which is why nothing here
 * looks at the podcast guid. 23 titled episodes carry none, and the page renders
 * for them: it is keyed on the item guid alone, and only the eyebrow link and
 * the boost button drop out.
 *
 * ⚠️ `itemGuid` IS SOMETIMES A URL rather than a UUID — 9% of the distinct guids
 * contain a slash and 30 are full http(s) URLs — so it is encoded and never
 * parsed. Cloudflare Pages keeps an encoded %2F inside one path segment rather
 * than routing on it.
 *
 * Callers should treat null as "fall back to whatever they linked before":
 * an unidentified episode is still a real card, it just has no page of ours.
 */
/**
 * The landing-page URL for an artist (publisher) guid, or null when there
 * isn't one. The third rule in this module, beside the show and episode ones
 * and here for the same reason: artist titles appear on the Artists feed's
 * cards and on /artist's own community rollup, and copies of the rule would
 * drift. The qualifying test matches /artist/<guid>'s own: the page 404s a
 * publisher with no title (the one bare row a stale link produced), so callers
 * check the title before asking, the same discipline the show rule has.
 */
export function publisherPageHref(guid) {
  if (typeof guid !== 'string') return null
  const g = guid.trim()
  if (!g) return null
  return `/artist/${encodeURIComponent(g)}`
}

export function episodePageHref(itemGuid, title) {
  if (typeof itemGuid !== 'string') return null
  const g = itemGuid.trim()
  if (!g) return null
  if (typeof title !== 'string' || !title.trim()) return null
  return `/episode/${encodeURIComponent(g)}`
}
