/* Feed note — the one line above a ranked feed's search box saying what the
 * cards below are ranked over.
 *
 * ⚠️ WHY THIS IS ITS OWN FILE RATHER THAN TWO MORE EXPORTS OF feed-controls.js
 *
 * It was those two exports for exactly one deploy, and it took every feed on
 * the site down. Assets here ship `max-age=14400`, so the browser holds each
 * module URL for up to four hours ON ITS OWN CLOCK. Adding a named export to an
 * existing module and importing it from modules that already exist therefore
 * has a failure window measured in hours: a visitor holding a three-hour-old
 * feed-controls.js who fetches a fresh feeds-podcasts.js gets
 *
 *   SyntaxError: The requested module '/assets/js/feed-controls.js?v=ob-v172' does not
 *   provide an export named 'mountFeedNote'
 *
 * and an unresolved named import is a LINK-TIME error: the module never
 * executes, so it takes down everything in the file rather than the one feature
 * that was added. All three renderers import from feed-controls.js, so all
 * eight feeds failed together. Bumping sw.js does not help, because the service
 * worker's cache is only consulted for clients it already controls, and the
 * HTTP cache underneath it is per-URL either way.
 *
 * A NEW module URL has no cached old version anywhere in the world, so it can
 * only resolve or 404. That is the safe shape for adding behaviour, and it is
 * why this file exists. The rule generalises: adding to an existing module is
 * safe for its OWN callers only if they turn over atomically with it, which two
 * separately-cached URLs never do.
 *
 * ── What the line is for ──────────────────────────────────────────────
 *
 * It exists only on the ranked feeds. Global vs Follows is self-explanatory on
 * the Boosts note feed, where a card is one kind-1 note and the axis is the
 * same one every Nostr client has; on Episodes, Songs, Shows and Albums a card
 * is an AGGREGATE, so the scope is a statement about the corpus the ranking was
 * computed over rather than about which cards were kept, and nothing on screen
 * said so.
 *
 * The slot ships empty and `hidden` in index.html, so a feed that renders "sign
 * in" or an error never grows a line describing a ranking that isn't there.
 * Same contract as the search slot beneath it.
 */

/**
 * Fill a panel's [data-feed-note] slot.
 *
 * @param {Element} panel
 * @param {string}  text   plain text; null or empty leaves the slot hidden
 * @param {object}  [opts]
 * @param {object}  [opts.info]  { href, title, label } — a small ⓘ link
 *   appended after the text. The href is a site-internal constant (see
 *   CHART_INFO below), never user-supplied, which is why it skips isSafeUrl.
 */
export function mountFeedNote(panel, text, opts = {}) {
  const host = panel?.querySelector('[data-feed-note]')
  if (!host) return null
  if (!text) { host.textContent = ''; host.hidden = true; return null }
  host.textContent = text
  const info = opts.info
  if (info && info.href) {
    host.append(' ')
    const a = document.createElement('a')
    a.className = 'feed-note-info'
    a.href = info.href
    if (info.title) a.title = info.title
    a.setAttribute('aria-label', info.label || info.title || 'More about this ranking')
    a.textContent = 'ⓘ'
    host.append(a)
  }
  host.hidden = false
  return host
}

/* The ⓘ beside the chart note. One constant rather than three renderer
 * copies, so the target and the wording cannot drift. /about#charts is the
 * section that states the whole formula; the title carries the one-line
 * version for a reader who only hovers. */
export const CHART_INFO = {
  href: '/about#charts',
  title: 'How the OnlyBoosts Charts work',
  label: 'How the OnlyBoosts Charts work',
}

/**
 * The note's base sentence, composed from the view itself.
 *
 * It replaced a fixed corpus line ("Ranks based on every boost in the index")
 * on 2026-08-31, Reed's ask: the fixed line said nothing about the view on
 * screen. This says what orders the list, and appends a corpus clause only
 * when the corpus deviates from the default (all time, everyone) — the
 * Follows scope and a range window are claims a reader cannot see from the
 * cards, where "every boost in the index" was the default restated.
 *
 * One switch covers every renderer's sort spelling ('count' and 'boosters'
 * are one ranking; 'recent' and 'latest' are one chronology), the same union
 * the hash's shape-only sort validation already tolerates. Returns no
 * trailing period, matching what langNote expects of its base.
 *
 * @param {object} view
 * @param {string} view.sort     the renderer's current sort key
 * @param {number} view.days     rangeDays(rangeKey) — 0 means all time
 * @param {boolean} view.follows
 * @param {string} view.noun     the ROW's word: show, album, episode, track, artist
 */
export function viewNote({ sort, days, follows, noun = 'show' }) {
  let head
  switch (sort) {
    case 'chart':
      head = `Chart rank sums each ${noun}'s place in sats, boosts and boosters; the lowest total leads`
      break
    case 'sats': head = 'Ranked by total sats boosted'; break
    case 'boosts': head = 'Ranked by number of boosts'; break
    case 'count':
    case 'boosters': head = 'Ranked by distinct boosters'; break
    case 'episode':
      head = noun === 'track' ? 'Ordered by latest release' : 'Ordered by latest episode'
      break
    default: head = 'Ordered by most recent boost'
  }
  const corpus = follows
    ? (days ? `Counting only the last ${days} days of boosts from the accounts you follow`
      : 'Counting only boosts from the accounts you follow')
    : (days ? `Counting boosts from the last ${days} days` : '')
  return corpus ? `${head}. ${corpus}` : head
}

/** Empty a panel's note slot and hide it again. */
export function resetFeedNote(panel) {
  return mountFeedNote(panel, null)
}
