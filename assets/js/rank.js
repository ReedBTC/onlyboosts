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
 * ⚠️ THE "T" IS ON EVERY SURFACE, in two forms: a feed card prints `T4` beside
 * the card and a detail-page tile prints `T#4` in its chip, because the tile
 * stands alone where the card sits in the list it is a rank on. `T4` is golf's
 * own form; `T#4` would be the two conventions stacked.
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
 * ⚠️ `tied` IS ONLY AS COMPLETE AS THE ROWS YOU PASS. It is true when a loaded
 * neighbour (or the seed) shares the value, so the LAST row of an open-ended
 * list reports a tie it shares backwards and cannot see one that continues into
 * rows not yet fetched. That direction of error is the safe one — the rank
 * itself is still right, and the row simply does not yet disclose its tie — and
 * it resolves the moment more rows arrive and this is recomputed. The feeds
 * therefore re-sync their painted labels after every append.
 *
 * @param {Array} list        rows already in rank order
 * @param {(row:any, i:number)=>number} valueOf  the figure the sort ranks on
 * @param {object} [seed]
 * @param {number} [seed.startIndex]  absolute position of list[0] (default 0)
 * @param {?number} [seed.prevValue]  value of the row before list[0], if any
 * @param {?number} [seed.prevRank]   rank of that row
 * @returns {{rank:number, tied:boolean}[]}
 */
export function competitionRanks(list, valueOf, seed = null) {
  const startIndex = seed && Number.isFinite(seed.startIndex) ? seed.startIndex : 0
  const hasPrev = seed != null && seed.prevValue != null && Number.isFinite(seed.prevRank)
  const vals = list.map(valueOf)
  const out = new Array(list.length)
  // The rank of the equal-value run currently open. A run that began before
  // list[0] keeps the rank it was given there, which is the whole point of the
  // seed: the first row of a page can be tied with the last row of the one
  // before it, and must not be renumbered as if the page started a new run.
  let runRank = hasPrev ? seed.prevRank : startIndex + 1
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    const prev = i > 0 ? vals[i - 1] : (hasPrev ? seed.prevValue : null)
    const hasBack = i > 0 || hasPrev
    if (hasBack && v !== prev) runRank = startIndex + i + 1
    out[i] = {
      rank: runRank,
      tied: (hasBack && v === prev) || (i + 1 < vals.length && v === vals[i + 1]),
    }
  }
  return out
}

/**
 * Mark ties inside a SERVER-RANKED result slice, in place.
 *
 * For rows that arrive already carrying `_rank` — a `q=` search result, where
 * each row's rank was computed over the whole ordering and the rows on hand
 * are a filtered slice of it. A rank repeated inside the slice is provably a
 * tie; a partner the filter removed stays invisible, which is the same safe
 * direction competitionRanks' own `tied` errs in — the rank is right and the
 * row merely does not yet disclose its tie.
 */
export function markSliceTies(rows) {
  const seen = new Map()
  for (const r of rows) {
    if (Number.isFinite(r._rank)) seen.set(r._rank, (seen.get(r._rank) || 0) + 1)
  }
  for (const r of rows) r._tied = (seen.get(r._rank) || 0) > 1
}

/**
 * The numeral as a reader sees it: `4`, or `T4` where the place is shared.
 *
 * ⚠️ NO `#` HERE. The feed card prints a bare position beside the card, where
 * the detail page's chip prints `#4` because it stands alone in a tile with no
 * list around it. `T4` is golf's own form, which is where the notation comes
 * from; `T#4` would be the two conventions stacked.
 */
export function rankLabel(rank, tied) {
  if (rank == null) return null
  return `${tied ? 'T' : ''}${rank}`
}

/**
 * The OnlyBoosts Charts standing, computed over a list held WHOLE — the
 * detail pages' drawers, which open on it since 2026-09-03 (Reed's ask: "the
 * same formula as for the charts, but limited to just the items in these
 * lists"). The feeds and the tiles get theirs from SQL (feed-rank.js,
 * week-charts.js, the four endpoints); this is the same rule in JS for a
 * caller that already holds every row it is ranking, so the edge and the
 * browser order a drawer identically.
 *
 * ⚠️ THE RULE, VERBATIM FROM "The OnlyBoosts Charts" IN docs/feeds.md: each
 * row's competition rank in sats, in boosts and in the breadth key (boosters;
 * shows for a member; episodes for a booster's shows), summed — lowest total
 * first; ties break breadth → sats → boosts; what is still equal on the whole
 * tuple shares a place (a T#) and the next distinct tuple skips the group.
 * The component ranks are competition ranks too (equal values share), which
 * is what SQL's RANK() gives the endpoints. A change to the chain here or
 * there is a change to both; scripts/test-charts.mjs holds this function to
 * its brute-forced implementation of the same rule.
 *
 * ⚠️ THE MENU CALLS IT "Overall" ON THE DETAIL PAGES (Reed, 2026-09-03), where
 * the homepage feeds and the members wall say "Chart rank": inside a drawer
 * the standing is over that list alone, not the OnlyBoosts Charts, and the
 * word says so. The key stays `chart` everywhere.
 *
 * O(n²) in the component ranking, which is fine for a drawer (the largest
 * holds 500 rows) and would not be for a feed.
 *
 * @param {Array} rows
 * @param {{sats:(r)=>number, boosts:(r)=>number, breadth:(r)=>number}} of
 * @returns {{row:any, rank:number, tied:boolean, score:number,
 *            rSats:number, rBoosts:number, rBreadth:number}[]} in chart order
 */
export function chartRanks(rows, of) {
  const S = rows.map((r) => Number(of.sats(r)) || 0)
  const B = rows.map((r) => Number(of.boosts(r)) || 0)
  const K = rows.map((r) => Number(of.breadth(r)) || 0)
  const rk = (vals) => vals.map((v) => 1 + vals.filter((x) => x > v).length)
  const rS = rk(S), rB = rk(B), rK = rk(K)
  const scored = rows.map((row, i) => ({
    row, i, sats: S[i], boosts: B[i], breadth: K[i],
    rSats: rS[i], rBoosts: rB[i], rBreadth: rK[i], score: rS[i] + rB[i] + rK[i],
  }))
  // The tuple standing; the original index last, so the order is stable and a
  // full tie keeps the caller's own order (which is the server's, or the DOM's).
  scored.sort((a, b) => a.score - b.score || b.breadth - a.breadth
    || b.sats - a.sats || b.boosts - a.boosts || a.i - b.i)
  const tup = (x) => `${x.score}|${x.breadth}|${x.sats}|${x.boosts}`
  let runRank = 1
  for (let i = 0; i < scored.length; i++) {
    if (i > 0 && tup(scored[i]) !== tup(scored[i - 1])) runRank = i + 1
    scored[i].rank = runRank
  }
  for (let i = 0; i < scored.length; i++) {
    scored[i].tied = (i > 0 && tup(scored[i]) === tup(scored[i - 1]))
      || (i + 1 < scored.length && tup(scored[i]) === tup(scored[i + 1]))
  }
  return scored.map(({ i, ...rest }) => rest)
}
