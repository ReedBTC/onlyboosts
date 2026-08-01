/* Where a boost note points a reader back to, for one episode.
 *
 * ONE function, imported by every surface that starts a boost, so the link in a
 * published note doesn't depend on which page the booster happened to be on.
 * It didn't used to be: the Episodes feed built this inline while
 * `show-page.js` passed `bmbUrl: ''`, so the same episode boosted from two
 * places produced two different notes, one carrying a link and an `r` tag and
 * one carrying neither.
 *
 * ⚠️  THE TARGET IS STILL boostmebitch.com, AND THAT IS NOW A DECISION RATHER
 * THAN A CONSTRAINT. It was written when OnlyBoosts had no per-episode page;
 * `/episode/<item-guid>` (functions/episode/[guid].js) shipped alongside this
 * note and the pages exist. The flip was deliberately deferred: changing the
 * line below changes what every boost note published from every surface points
 * at, permanently and unrecallably, so it is its own decision on its own commit
 * rather than a side effect of the pages landing.
 *
 * When it is made, it is ONE change here and every surface follows at the same
 * moment — which is the whole reason this exists as a function rather than as
 * inline URL builders. Two things go with it:
 *
 *   - 6,682 of the 7,182 episodes carrying an indexed boost qualify for a page
 *     (they have a title). The other 500 do not, so the builder still needs a
 *     fallback for them rather than emitting a URL that 404s.
 *   - `assets/js/episode-page.js` passes `bmbUrl: ''` today for exactly this
 *     reason: an episode boosted from its own page must publish the same note it
 *     would from the feed, and until this function moves, the feed's note is the
 *     BMB one.
 *
 * Show pages (`/show/<guid>`) are NOT the target and never were: a boost note is
 * about one episode, and pointing it at the show would drop the part the reader
 * cares about.
 *
 * ⚠️  TWO OTHER SURFACES point at BMB and are not built here. Both are in
 * functions/show/[guid].js, both are SHOW-level rather than episode-level, and
 * both resolve through one `bmbShowUrl()` in that file:
 *
 *   - "See All Episodes" on the episode drawer's control band (`renderEpisodes`)
 *   - a podroll tile for a show we have no page of our own for (`podrollTile`),
 *     which is 44% of them
 *
 * A Pages Function cannot import a client module — nothing else in functions/
 * reaches outside functions/ either — so they are built there rather than here.
 * Neither is a boost note, so retiring BMB does not have to retire them, but
 * CHANGE ALL THREE TOGETHER.
 *
 * Boost Me Bitch restores a detail view from URL params: `?feed=<piFeedId>` or
 * `?podcast=<podcastGuid>` picks the show, and `&episode=<itemGuid>` opens that
 * episode, where itemGuid is the RSS item guid (exactly our item_guid). Prefer
 * ?feed, a direct Podcast Index lookup, and fall back to the podcast guid.
 * Episodes older than a show's most recent ~50 aren't in BMB's list and land on
 * the show instead of the exact episode, which is a graceful degradation rather
 * than a broken link.
 */

/**
 * @param {object} p
 * @param {string} [p.itemGuid]     RSS item guid. Opaque — sometimes a URL
 *                                  rather than a UUID, so it is never parsed,
 *                                  only encoded.
 * @param {string} [p.podcastGuid]  The show's podcast:guid.
 * @param {string|number} [p.feedId] Podcast Index numeric feed id, when known.
 * @returns {string|null} null when there is no episode to link to, or no way to
 *          identify the show. Callers treat null as "omit the link", which is
 *          also what a show-level boost gets: there is no episode in it.
 */
export function episodeBoostLink({ itemGuid, podcastGuid, feedId } = {}) {
  const ep = itemGuid ? String(itemGuid).trim() : ''
  if (!ep) return null

  const p = new URLSearchParams()
  if (feedId) p.set('feed', String(feedId))
  else if (podcastGuid) p.set('podcast', String(podcastGuid))
  else return null

  p.set('episode', ep)
  return 'https://boostmebitch.com/?' + p.toString()
}
