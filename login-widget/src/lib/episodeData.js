/**
 * Episode-related helpers used by the multi-leg boost flow.
 *
 * Note on parsing: there used to be a `parseSplits` / `parseEpisodeMeta`
 * pair here that mirrored the inline parser in `index.html`. They were
 * never wired (the home page does its own parsing because it runs
 * before the widget bundle loads, and `payAllLegs.js` only consumes
 * already-parsed splits via the LBLogin API). Removed to avoid
 * carrying two copies of the same logic that could drift over time.
 *
 * `formatEpisodeComment` lives here rather than in `payAllLegs.js`
 * because the format is part of the wire contract with the receiving
 * bot — keeping it in a small, named helper makes the contract easy
 * to find and update.
 */

/**
 * Format the episode tag we send in the LNURL comment. Bots can
 * match on a fixed regex:
 *   /^OnlyBoosts(Site|Ep\d{3})$/
 *
 * Examples:
 *   8       -> "OnlyBoostsEp008"
 *   42      -> "OnlyBoostsEp042"
 *   null    -> "OnlyBoostsSite"   (site-level boost from the nav's
 *              "Boost" button; no episode context)
 *
 * Renamed from LB's `LocalBitcoiners(Show|EpNNN)` on fork. The string is a
 * wire contract with whatever bot reads the invoice comment — if a receiver
 * is already matching the old prefix, update it there in the same change.
 */
export function formatEpisodeComment(episodeNumber) {
  if (episodeNumber == null) return 'OnlyBoostsSite'
  const n = parseInt(episodeNumber, 10)
  if (!Number.isFinite(n) || n <= 0) return 'OnlyBoostsSite'
  return `OnlyBoostsEp${String(n).padStart(3, '0')}`
}
