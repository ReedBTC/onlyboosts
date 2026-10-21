/* The search results page's VERBS. The facts are the charts page's own cards,
 * rendered at the edge by functions/search.js; this attaches to them exactly
 * what the feeds attach on /charts, through the same modules, so a card on a
 * results page and the same card on its feed behave identically:
 *
 *   show and album cards    show-card-actions.js   artwork fallback, the
 *                                                  relative last-boost time,
 *                                                  the boost pill, the drawer
 *   episode and song cards  episode-card-actions.js the same, plus the faces
 *                                                  and the subscribe menu; the
 *                                                  drawer's notes fetch on open
 *   artist cards            publisher-card-actions.js
 *   the members wall        supporter-wall.js      the show-more button
 *
 * Nothing here renders: a results page with this module missing is the same
 * list, readable, with its links working and its verbs absent.
 */
import { wireShowCards } from '/assets/js/show-card-actions.js?v=ob-v231'
import { wireEpisodeCards, hydrateCardProfiles, prewarmBoosting } from '/assets/js/episode-card-actions.js?v=ob-v231'
import { wirePublisherCards } from '/assets/js/publisher-card-actions.js?v=ob-v231'
import { initShowMore } from '/assets/js/supporter-wall.js?v=ob-v231'

// The /discover pages are the same list of the same cards (2026-10-20).
const main = document.getElementById('search') || document.getElementById('discover') || document
wireShowCards(main)
wireEpisodeCards(main)
hydrateCardProfiles(main)
wirePublisherCards(main)
initShowMore()
if (main.querySelector?.('[data-episode-card], [data-show-card]')) prewarmBoosting()
