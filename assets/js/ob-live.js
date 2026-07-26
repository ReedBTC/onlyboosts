/* OnlyBoosts data client — the live half.
 *
 * The counterpart to ob-data.js. That module reads immutable JSON shards off
 * the CDN, which is the right shape for the two Global views: every visitor
 * asks for the same bytes, so they cache. A Follows view can't work that way —
 * the audience is the signed-in user's own kind-3 contact list, so there is no
 * shared response to cache. It used to be done by downloading the global
 * shards and filtering client-side, which meant pulling megabytes to keep the
 * few hundred rows that matched, and paging backwards through month archives
 * until something turned up.
 *
 * This talks to the D1-backed query API at /api/v1/* instead: same-origin, an
 * indexed `IN` over the follow set, and cursor pagination. Records come back
 * in the same shape as the shards, so both halves normalize through
 * ob-data.js#normalizeBoosts and every consumer downstream sees one data model.
 *
 * Nothing here is cached in-process. The shard cache in ob-data.js is keyed by
 * path and safe because those files are immutable; these responses are
 * per-user and change as boosts arrive, so a page-lifetime cache would serve a
 * stale feed. The endpoints set their own short Cache-Control.
 */
import { normalizeBoosts } from '/assets/js/ob-data.js'

const BASE = '/api/v1/'

// The server clamps to 200 (clampLimit in functions/api/v1/_common.js). Ask
// for that: these are same-origin round trips against an indexed query, so
// fewer, larger pages beat more, smaller ones.
const PAGE_LIMIT = 200

// Guard against a runaway follow set quietly pulling the whole table. The
// podcasts rollup is the only caller that pages eagerly (it needs a corpus to
// group and range-filter over, not a screenful), and this bounds it.
const MAX_EAGER_ROWS = 1600
const MAX_EAGER_PAGES = 8

/**
 * POST a JSON body to an /api/v1 path and return the parsed response.
 *
 * The content-type check mirrors ob-data.js#fetchJson. It matters less here —
 * these are our own Functions, not the relay host that answers a missing file
 * with 200 text/plain — but an HTML error page from an edge failure would
 * otherwise parse-throw somewhere less obvious than the fetch that caused it.
 */
async function postJson(path, body, { signal } = {}) {
  const resp = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) throw new Error(`live ${path}: HTTP ${resp.status}`)
  const ctype = resp.headers.get('content-type') || ''
  if (!ctype.includes('json')) throw new Error(`live ${path}: not JSON (${ctype})`)
  return resp.json()
}

/**
 * One page of the follow-scoped boost feed, newest first.
 *
 * @param {string[]} authors  hex pubkeys (the endpoint also accepts npubs)
 * @param {string|null} cursor  `next_cursor` from the previous page
 * @returns {Promise<{rows: object[], cursor: string|null, matchedAuthors: number}>}
 *   `cursor` is null when the server has no more rows to give.
 */
export async function getFollowsBoostPage(authors, { cursor = null, limit = PAGE_LIMIT, signal } = {}) {
  const data = await postJson('boosts/follows', {
    authors, limit, cursor: cursor || null,
  }, { signal })
  return {
    rows: normalizeBoosts(data),
    cursor: typeof data?.next_cursor === 'string' ? data.next_cursor : null,
    // The endpoint caps the author list at 2,000 (MAX_AUTHORS). Reporting what
    // it actually matched lets a caller tell a truncated follow set apart from
    // a complete one; see the note on getFollowsBoosts.
    matchedAuthors: Number.isFinite(data?.matched_authors) ? data.matched_authors : authors.length,
  }
}

/**
 * A page-at-a-time reader over the follow feed, for a view that renders
 * incrementally rather than needing the whole corpus up front.
 *
 * `rows` accumulates; `loadMore()` appends the next page and returns how many
 * rows it added; `hasMore` is false once the server stops handing out cursors.
 * Dedupes by event id — the cursor is (created_at, event_id) so pages
 * shouldn't overlap, but a boost arriving mid-page-walk shifts the window and
 * the feed must not render the same card twice.
 */
export function followsBoostReader(authors) {
  const seen = new Set()
  let cursor = null
  let exhausted = false

  const reader = {
    rows: [],
    get hasMore() { return !exhausted },
    async loadMore() {
      let added = 0
      // Loop rather than return 0 on an all-duplicate page: returning 0 reads
      // as "nothing left" to the caller, which would strand rows the server
      // still has.
      while (!exhausted && added === 0) {
        const page = await getFollowsBoostPage(authors, { cursor })
        cursor = page.cursor
        if (!cursor) exhausted = true
        for (const b of page.rows) {
          if (seen.has(b.id)) continue
          seen.add(b.id)
          reader.rows.push(b)
          added++
        }
      }
      if (added) reader.rows.sort((a, b) => b.ts - a.ts)
      return added
    },
  }
  return reader
}

/**
 * The follow feed as one bounded corpus, for views that must group or
 * aggregate before they can paint anything.
 *
 * Bounded on purpose: the podcasts rollup offers an "All" range filter, and
 * "all" for a follow set with a long history is still not a reason to walk the
 * entire table. Stops at MAX_EAGER_ROWS / MAX_EAGER_PAGES, whichever comes
 * first, and reports whether it stopped early so the caller can say so.
 *
 * @returns {Promise<{rows: object[], truncated: boolean, matchedAuthors: number}>}
 */
export async function getFollowsBoosts(authors, { maxRows = MAX_EAGER_ROWS, signal } = {}) {
  const seen = new Set()
  const rows = []
  let cursor = null
  let pages = 0
  let matchedAuthors = authors.length
  let truncated = false

  while (pages < MAX_EAGER_PAGES && rows.length < maxRows) {
    const page = await getFollowsBoostPage(authors, { cursor, signal })
    pages++
    matchedAuthors = page.matchedAuthors
    for (const b of page.rows) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      rows.push(b)
    }
    cursor = page.cursor
    if (!cursor) break
  }
  // A cursor still in hand means the server had more than we were willing
  // to ask for.
  if (cursor) truncated = true

  rows.sort((a, b) => b.ts - a.ts)
  return { rows, truncated, matchedAuthors }
}
