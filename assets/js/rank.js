/* Standard competition ranking — the site's one definition of "rank".
 *
 * ⚠️ A RANK IS THE COUNT OF ROWS STRICTLY AHEAD, PLUS ONE. Everything tied
 * shares the better place and the next distinct value skips past the whole
 * group: 1, 2, 2, 4. It is what golf ("T4"), the Olympics and the US News
 * rankings display, and it was chosen on 2026-08-18 over the two alternatives
 * for reasons worth keeping here, since both look right until measured:
 *
 *   • ORDINAL (1,2,3,4) is what this site shipped, numbering cards by position.
 *     A feed orders ties by sats then guid so that paging is stable, which is a
 *     DISPLAY order — and under ordinal that display order silently decided
 *     which of two equal episodes was 4th and which was 5th.
 *   • DENSE (1,2,2,3) is the intuitive fix and inflates the tail. There are only
 *     31 distinct boost counts across 6,422 episodes, so dense collapses the
 *     whole corpus into 31 places and an episode with 2 boosts prints "#30"
 *     while 2,273 episodes sit ahead of it.
 *
 * Competition ranking is honest at both ends, which is why no cutoff is needed:
 * that same episode prints #2274 and every word of it is true.
 *
 * ⚠️ THE FEEDS PRINT THE NUMERAL AND NOT THE "T", and the detail pages print
 * both. That is not an inconsistency: a tie on a feed is VISIBLE, because the
 * two cards sit next to each other showing one numeral and the same figure,
 * where a stat tile on /show has no list around it and needs the marker to say
 * so. It also means a feed never has to know whether a tie continues past the
 * rows it has loaded, which it cannot know.
 *
 * TWO-SIDED, so it is imported by the browser and inlined into a Pages Function
 * off the filesystem, and therefore carries no imports of its own at all.
 */

/**
 * Competition ranks for an ordered run of rows.
 *
 * ⚠️ THE LIST MUST BE A CONTIGUOUS PREFIX OF THE FULL ORDERING, or a seed must
 * describe the row immediately before it. That is what makes this exact
 * client-side with no extra request: the ranked feeds page forward from offset
 * 0 and only ever append, so the browser always holds every row ahead of the
 * one it is numbering.
 *
 * @param {Array} list        rows already in rank order
 * @param {(row:any, i:number)=>number} valueOf  the figure the sort ranks on
 * @param {object} [seed]
 * @param {number} [seed.startIndex]  absolute position of list[0] (default 0)
 * @param {?number} [seed.prevValue]  value of the row before list[0], if any
 * @param {?number} [seed.prevRank]   rank of that row
 * @returns {number[]} one 1-based rank per row
 */
export function competitionRanks(list, valueOf, seed = null) {
  const startIndex = seed && Number.isFinite(seed.startIndex) ? seed.startIndex : 0
  const hasPrev = seed != null && seed.prevValue != null && Number.isFinite(seed.prevRank)
  const out = new Array(list.length)
  // The rank of the equal-value run currently open. A run that began before
  // list[0] keeps the rank it was given there, which is the whole point of the
  // seed: the first row of a page can be tied with the last row of the one
  // before it, and must not be renumbered as if the page started a new run.
  let runRank = hasPrev ? seed.prevRank : startIndex + 1
  let last = hasPrev ? seed.prevValue : null
  for (let i = 0; i < list.length; i++) {
    const v = valueOf(list[i], i)
    if (i > 0 || hasPrev) {
      if (v !== last) runRank = startIndex + i + 1
    }
    out[i] = runRank
    last = v
  }
  return out
}
