/* Where a boost note points a reader back to, for one episode.
 *
 * ONE function, imported by every surface that starts a boost, so the link in a
 * published note doesn't depend on which page the booster happened to be on.
 * It didn't used to be: the Episodes feed built this inline while
 * `show-page.js` passed `bmbUrl: ''`, so the same episode boosted from two
 * places produced two different notes, one carrying a link and an `r` tag and
 * one carrying neither.
 *
 * ⚠️  THE TARGET IS TEMPORARY. It resolves to boostmebitch.com because
 * OnlyBoosts has no per-episode page yet. When it does, this function changes
 * and every boost note follows; that is the whole reason it exists as a
 * function rather than as two inline URL builders. Show pages (`/show/<guid>`)
 * already exist and are NOT the target: a boost note is about one episode, and
 * pointing it at the show would drop the part the reader cares about.
 *
 * ⚠️  ONE OTHER SURFACE points at BMB and is not built here: the
 * "See All Episodes" link on the /show episode drawer's control band, in
 * `renderEpisodes` (functions/show/[guid].js). It is show-level rather than
 * episode-level, and a Pages Function cannot import a client module — nothing
 * else in functions/ reaches outside functions/ either. It is not a boost note,
 * so retiring BMB does not have to retire it, but CHANGE THE TWO TOGETHER.
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
