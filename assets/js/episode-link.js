/* Where a boost note points a reader back to, for one episode.
 *
 * ONE function, imported by every surface that starts a boost, so the link in a
 * published note doesn't depend on which page the booster happened to be on.
 * It didn't used to be: the Episodes feed built this inline while
 * `show-page.js` passed `bmbUrl: ''`, so the same episode boosted from two
 * places produced two different notes, one carrying a link and an `r` tag and
 * one carrying neither.
 *
 * ⚠️  THE TARGET IS NOW `/episode/<item-guid>` — this site's own page. It was
 * boostmebitch.com from the fork until the episode pages existed, and the flip
 * was deliberately held back as its own decision on its own commit rather than
 * being taken as a side effect of the pages landing: this line decides what
 * every note published from every surface points at, permanently. **Notes
 * already published keep pointing at BMB and always will** — a published event
 * cannot be recalled, which is exactly why the change was worth deciding rather
 * than drifting into.
 *
 * BMB REMAINS THE FALLBACK, and it is not a formality. The page's qualifying
 * rule is that the episode has a TITLE: 6,682 of the 7,182 episodes carrying an
 * indexed boost have one, and the other 500 are boosts tagged with an item guid
 * Podcast Index cannot identify. Those have no page of ours, so they keep the
 * link they always had rather than being handed a URL that 404s. That is why
 * `title` is a parameter — the same test `show-link.js#episodePageHref` applies,
 * restated here because this module cannot import it without dragging a DOM
 * module into the note path.
 *
 * Show pages (`/show/<guid>`) are NOT the target and never were: a boost note is
 * about one episode, and pointing it at the show would drop the part the reader
 * cares about.
 *
 * ⚠️  ONE SURFACE STILL POINTS AT BMB ON PURPOSE, and it is not a boost note:
 * "See All Episodes" on the episode drawer's control band in
 * functions/show/[guid].js (`renderEpisodes`, through `bmbShowUrl()`). That link
 * exists to reach a show's FULL catalogue, which is the one thing this site does
 * not have — our drawer lists only the episodes carrying an indexed boost. The
 * podroll tile for a show we have no page of our own for resolves through the
 * same helper and stays for the same reason. Both are show-level; neither is
 * built here, because a Pages Function cannot import a client module.
 *
 * Boost Me Bitch restores a detail view from URL params: `?feed=<piFeedId>` or
 * `?podcast=<podcastGuid>` picks the show, and `&episode=<itemGuid>` opens that
 * episode, where itemGuid is the RSS item guid (exactly our item_guid). Prefer
 * ?feed, a direct Podcast Index lookup, and fall back to the podcast guid.
 * Episodes older than a show's most recent ~50 aren't in BMB's list and land on
 * the show instead of the exact episode, which is a graceful degradation rather
 * than a broken link.
 */

// ABSOLUTE, because this string is published into a Nostr event and read
// wherever that event is rendered. A site-relative path would resolve against
// whatever client is displaying the note.
const SITE_ORIGIN = 'https://onlyboosts.social'

/**
 * @param {object} p
 * @param {string} [p.itemGuid]     RSS item guid. Opaque — sometimes a URL
 *                                  rather than a UUID, so it is never parsed,
 *                                  only encoded.
 * @param {string} [p.title]        The episode's title. Its PRESENCE is the
 *                                  qualifying test for a page of ours; the
 *                                  value is never used in the URL.
 * @param {string} [p.podcastGuid]  The show's podcast:guid.
 * @param {string|number} [p.feedId] Podcast Index numeric feed id, when known.
 * @returns {string|null} null when there is no episode to link to, or no way to
 *          identify the show for the fallback. Callers treat null as "omit the
 *          link", which is also what a show-level boost gets: there is no
 *          episode in it.
 */
export function episodeBoostLink({ itemGuid, title, podcastGuid, feedId } = {}) {
  const ep = itemGuid ? String(itemGuid).trim() : ''
  if (!ep) return null

  // A titled episode has a page here, whatever we know about its show — the
  // page is keyed on the item guid alone, and 23 titled episodes in the index
  // carry no podcast guid at all. So this branch does not depend on the show
  // being identifiable, where the BMB fallback below does.
  if (typeof title === 'string' && title.trim()) {
    return `${SITE_ORIGIN}/episode/${encodeURIComponent(ep)}`
  }

  const p = new URLSearchParams()
  if (feedId) p.set('feed', String(feedId))
  else if (podcastGuid) p.set('podcast', String(podcastGuid))
  else return null

  p.set('episode', ep)
  return 'https://boostmebitch.com/?' + p.toString()
}
