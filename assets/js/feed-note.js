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
 *   SyntaxError: The requested module '/assets/js/feed-controls.js?v=ob-v139' does not
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
 */
export function mountFeedNote(panel, text) {
  const host = panel?.querySelector('[data-feed-note]')
  if (!host) return null
  if (!text) { host.textContent = ''; host.hidden = true; return null }
  host.textContent = text
  host.hidden = false
  return host
}

/** Empty a panel's note slot and hide it again. */
export function resetFeedNote(panel) {
  return mountFeedNote(panel, null)
}
