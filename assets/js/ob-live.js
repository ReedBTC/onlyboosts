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
import { normalizeBoosts } from '/assets/js/ob-data.js?v=ob-v136'

const BASE = '/api/v1/'

// Page size for the incremental note feed. A screenful at a time is the point
// there — the reader paints what it has and fetches more on demand — so this
// stays at the shared clampLimit default.
const PAGE_LIMIT = 200

// Guard against a runaway follow set quietly pulling the whole table. The
// podcasts rollup is the only caller that pages eagerly (it needs a corpus to
// group and range-filter over, not a screenful), and this bounds it.
const MAX_EAGER_ROWS = 1600
const MAX_EAGER_PAGES = 8

// The eager corpus asks for all of MAX_EAGER_ROWS in a single request, because
// on this endpoint a round trip costs ~270ms whether it carries 10 rows or 200
// — the time is the worker plus the edge→D1 hop, not the query. Fetching the
// corpus in eight serial pages therefore spent ~2.2s on latency alone to move
// data one request could have moved in ~0.3s. /api/v1/boosts/follows raises its
// own clamp (MAX_CORPUS_LIMIT) to allow it.
//
// If the server clamps lower than this — an older deploy, or a future decision
// to bring the ceiling back down — the page loop below simply runs more times
// and behaves exactly as it did before. Nothing here depends on getting the
// whole corpus in one response.
const EAGER_PAGE_LIMIT = MAX_EAGER_ROWS

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
    // The endpoint caps the author list at MAX_AUTHORS. Reporting what it
    // actually matched lets a caller tell a truncated follow set apart from
    // a complete one; see the note on getFollowsBoosts.
    matchedAuthors: Number.isFinite(data?.matched_authors) ? data.matched_authors : authors.length,
  }
}

/**
 * One page of the GLOBAL boost feed, newest first.
 *
 * The counterpart of getFollowsBoostPage, and deliberately the same shape: the
 * note feed's paging model is one reader interface with two backings, so the
 * renderer cannot tell the scopes apart.
 */
export async function getGlobalBoostPage({ cursor = null, limit = PAGE_LIMIT, since = null, signal } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (cursor) qs.set('cursor', cursor)
  // Passed through because the endpoint has it. The note feed does NOT use it —
  // see the warning over globalBoostReader for why the window is applied over
  // the rows in hand instead.
  if (since) qs.set('since', String(since))
  const resp = await fetch(`/api/v1/boosts?${qs}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`boosts: HTTP ${resp.status}`)
  const data = await resp.json()
  return {
    rows: normalizeBoosts(data),
    cursor: typeof data?.next_cursor === 'string' ? data.next_cursor : null,
  }
}

/**
 * A page-at-a-time reader over the global boost feed.
 *
 * ⚠️ THIS REPLACES latest.json PLUS AN ARCHIVE WALK. The feed used to read the
 * most recent ~1,000 boosts from a static shard and then page backwards through
 * month archives, which is what a static export can offer and not what a feed
 * wants: the shard lags its own edge by the publish interval, so the newest
 * boosts were missing from the feed whose job is to show them, and "load older"
 * cost a whole month's file to paint thirty more cards.
 *
 * Same interface as followsBoostReader, so the renderer's paging, its coverage
 * pass and its sorting are shared between the two scopes rather than branched.
 *
 * ⚠️ NO `since`, deliberately, and the reason is the one already written over
 * ensureCoverage in boosts-feed.js: on a short page the endpoint returns no
 * cursor, and the client cannot mint the opaque cursor it would then need to
 * keep paging PAST the window when the reader widens their range again. The
 * window is applied where it always was, over the rows in hand, once the
 * coverage pass has paged enough of them to cover it.
 */
export function globalBoostReader() {
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
        const page = await getGlobalBoostPage({ cursor })
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
 * Normally one request: EAGER_PAGE_LIMIT asks for the whole budget at once, so
 * the loop exists for the case where the server hands back less than it was
 * asked for. See the note on EAGER_PAGE_LIMIT.
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
    const page = await getFollowsBoostPage(authors, {
      cursor, signal, limit: Math.min(EAGER_PAGE_LIMIT, maxRows - rows.length),
    })
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

/* ── The episode rollup ──────────────────────────────────────────────
 *
 * GET|POST /api/v1/episodes — the ranked, range-filtered episode list, rolled
 * up SERVER-SIDE over the whole boost table.
 *
 * ⚠️ THIS REPLACED A CLIENT-SIDE ROLLUP, AND THE REASON IS CORRECTNESS RATHER
 * THAN COST. The Episodes and Songs feeds used to build their corpus from
 * latest.json plus three month archives and group it in the browser, which
 * ranked over whatever those shards happened to hold: measured against the full
 * index, 7 of the true all-time top 10 episodes were missing outright, only 20
 * of the true top 100 appeared, and the true #7 rendered at #128 because only
 * its last-three-months sats were counted. Songs was worse again, painting 84
 * of 601 music episodes, because music is ~5% of a stream that window was sized
 * for. A ranked feed that ranks the wrong things is not a thin feed; it is a
 * wrong one.
 *
 * `include=boosts` is what makes this usable by the existing card. Each episode
 * carries its own boost notes inline, in the collector's record shape minus the
 * podcast/episode blocks, which ob-data.js#episodeApiToBoosts hydrates back
 * from the parent. That is what lets the whole downstream chain — normalizeBoosts
 * → toEpisodeShape → buildEpisodes → episodeCardHtml — run completely unchanged
 * over a corpus that now comes from D1 instead of from static shards.
 *
 * ⚠️ INLINE NOTES ARE CAPPED AT 50 PER EPISODE while `boosts` is the true total,
 * so `boosts_inline.length < boosts` is the truncation signal. It bites on
 * exactly one episode in the index today (the single one with 55 boosts). The
 * card therefore takes its FIGURES from the aggregates and its NOTES from the
 * inline list, which is why they are carried separately rather than being
 * recounted from the rows.
 *
 * Follows is POST because a kind-3 list does not fit in a query string. The
 * response echoes how many keys were accepted, so a silent drop is visible.
 * Follows-scoped pages scope the inline notes to the same follow set: a drawer
 * showing boosts the card's own numbers did not count would read as a bug.
 */
const EPISODES_API = '/api/v1/episodes'

// The server caps a page at 200. 60 is two "load more" batches of the feed's
// own 30, so the second batch costs no request — worth it because a page with
// include=boosts is dominated by the notes, not the episodes.
const EPISODE_PAGE = 60

/**
 * One page of the ranked episode list.
 *
 * @param {object}   opts
 * @param {'music'|null} [opts.medium]  'music' selects the Songs/Albums half.
 *   The Episodes half passes NOT_MUSIC instead of `medium: 'podcast'` — the
 *   split is a partition, so it has to keep video and undeclared feeds too.
 * @param {string}   [opts.sort]    recent|episode|count|boosts|sats
 * @param {string}   [opts.range]   1w|1m|1y|all, filtered on AIR DATE
 * @param {string}   [opts.lang]    a 2-3 letter subtag, or 'unknown' for the
 *   shows that declare no `<language>` at all. Omitted or 'all' sends nothing.
 *   ⚠️ The language belongs to the SHOW, so this selects episodes whose FEED
 *   declares it, and `lang=en` deliberately excludes the untagged rather than
 *   absorbing them — see the header of feed-lang.js.
 * @param {number}   [opts.offset]
 * @param {string[]} [opts.follows] hex or npub; presence switches to POST
 * @param {string}   [opts.q]       free-text over episode title + show name.
 *   Every returned record then carries `rank`, its position in the FULL ordering
 *   under this same sort/range/medium — see searchEpisodes below.
 * @param {boolean}  [opts.withBoosts] inline each episode's notes. Default true;
 *   the typeahead turns it off because it dominates the payload.
 * @returns {Promise<{records: object[], nextOffset: number|null, follows: number|null}>}
 */
export async function getEpisodePage({
  medium = null, sort = 'boosts', range = 'all', lang = null,
  offset = 0, limit = EPISODE_PAGE, follows = null, q = null,
  withBoosts = true, signal,
} = {}) {
  const qs = new URLSearchParams({
    sort, range,
    limit: String(limit), offset: String(offset),
  })
  if (withBoosts) qs.set('include', 'boosts')
  if (q) qs.set('q', q)
  // 'all' is the absence of a filter rather than a value the endpoint knows, so
  // an unfiltered feed sends the query string it always sent.
  if (lang && lang !== 'all') qs.set('lang', lang)
  // Deliberately not `medium=podcast`. Both are the same 6,123 episodes today,
  // but a show that declares `video` (there are two in the index, neither with
  // an enriched boosted episode yet) would be dropped by one and kept by the
  // other, and the partition rule says everything that is not music belongs to
  // Episodes.
  if (medium === 'music') qs.set('medium', 'music')
  else qs.set('not_medium', 'music')

  const init = { headers: { Accept: 'application/json' }, signal }
  if (follows && follows.length) {
    init.method = 'POST'
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({ follows })
  }

  const resp = await fetch(`${EPISODES_API}?${qs}`, init)
  if (!resp.ok) throw new Error(`episodes: HTTP ${resp.status}`)
  const data = await resp.json()
  return {
    records: Array.isArray(data?.episodes) ? data.episodes : [],
    nextOffset: Number.isFinite(data?.next_offset) ? data.next_offset : null,
    // How many of the keys we sent were accepted. A number lower than what we
    // passed means entries were dropped as unparseable rather than the follow
    // set being small.
    follows: Number.isFinite(data?.follows) ? data.follows : null,
  }
}

// How many suggestions the typeahead asks for. Same MAX_HITS the local search
// ladder shows, so the menu never has to drop a row the server bothered to rank.
export const SEARCH_HITS = 5

// The endpoint rejects a one-character q, so the box must not spend a request
// asking. Kept here rather than in the renderer because it is the API's rule.
export const SEARCH_MIN_CHARS = 2

/**
 * The feed's own search, run over the whole index instead of the loaded pages.
 *
 * ⚠️ THIS IS `/api/v1/episodes?q=`, NOT `/api/v1/search?type=episodes`, and the
 * choice is forced rather than stylistic. The search endpoint is a flat
 * relevance-ordered "does this exist" lookup with no medium filter and no
 * follows scoping at all — pointed at these feeds it would offer Songs inside
 * Episodes, and on a Follows feed it would suggest episodes nobody the reader
 * follows has boosted, every one of which would then filter to an empty list.
 * The episodes endpoint applies the active medium, range, sort AND scope, which
 * is the only way a suggestion is guaranteed to be something the feed can show.
 *
 * The cost of that is the ordering: hits come back in the feed's ACTIVE SORT
 * rather than by relevance, so the suggestions read as the feed with non-matches
 * removed. That is the same thing picking one does, which is what makes the two
 * agree.
 *
 * Notes are left off deliberately. Measured at 80KB for 5 rows with
 * `include=boosts` against 4KB without, and this runs while someone is typing;
 * the pick re-asks for the one row it needs with the notes attached.
 *
 * @returns {Promise<object[]>} raw records, each carrying `rank`
 */
export async function searchEpisodes({
  q, medium = null, sort = 'boosts', range = 'all', lang = null,
  follows = null, limit = SEARCH_HITS, signal,
} = {}) {
  const text = typeof q === 'string' ? q.trim() : ''
  if (text.length < SEARCH_MIN_CHARS) return []
  const { records } = await getEpisodePage({
    medium, sort, range, lang, follows, signal,
    q: text, limit, offset: 0, withBoosts: false,
  })
  return records
}

/* ── The show-level rollup, behind Shows and Albums ──────────────────────────
 *
 * ⚠️ `range` MEANS BOOST TIME HERE, where the episode reader above means AIR
 * DATE. A show is in the 1W view because someone boosted it this week and its
 * figures are that week's; an episode is in the 1W view because it AIRED this
 * week, however long ago it was boosted. The endpoints keep the same split, and
 * each feed writes its own tooltips for exactly this reason.
 *
 * What this replaces: the All range read the collector's published per-show
 * rollup whole (~440KB of every show, to paint thirty cards) and the windowed
 * ranges walked latest.json plus month archives and GROUPed the boosts in the
 * browser. That was the last client-side aggregation on the site.
 */
const PODCASTS_API = '/api/v1/podcasts'

// One screen and a bit. The feed paints 30 at a time, so a page is one press of
// "load more" rather than a fetch per press.
const SHOW_PAGE = 60

/**
 * One page of the ranked show list.
 *
 * @param {'music'|null} [opts.medium]  'music' selects Albums; everything else
 *   is the Shows half, sent as not_medium=music so the partition keeps video and
 *   the 33% of shows Podcast Index cannot identify.
 * @param {string} [opts.sort]   boosts|sats|boosters|latest
 * @param {string} [opts.range]  1w|1m|1y|all, filtered on BOOST TIME
 * @param {string} [opts.lang]   a 2-3 letter subtag, or 'unknown'. See the note
 *   on getEpisodePage; the language means the same thing on both endpoints,
 *   unlike `range`.
 * @param {string} [opts.q]      free text over title + author, or a pasted guid.
 *   Every record then carries `rank`, its position in the full ordering.
 */
export async function getShowPage({
  medium = null, sort = 'boosts', range = 'all', lang = null,
  offset = 0, limit = SHOW_PAGE, q = null, signal,
} = {}) {
  const qs = new URLSearchParams({
    sort, range, limit: String(limit), offset: String(offset),
  })
  if (medium === 'music') qs.set('medium', 'music')
  else qs.set('not_medium', 'music')
  if (q) qs.set('q', q)
  if (lang && lang !== 'all') qs.set('lang', lang)

  const resp = await fetch(`${PODCASTS_API}?${qs}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`podcasts: HTTP ${resp.status}`)
  const data = await resp.json()
  return {
    records: Array.isArray(data?.podcasts) ? data.podcasts : [],
    nextOffset: Number.isFinite(data?.next_offset) ? data.next_offset : null,
  }
}

/** The Shows/Albums typeahead. Same reasoning as searchEpisodes above. */
export async function searchShows({
  q, medium = null, sort = 'boosts', range = 'all', lang = null,
  limit = SEARCH_HITS, signal,
} = {}) {
  const text = typeof q === 'string' ? q.trim() : ''
  if (text.length < SEARCH_MIN_CHARS) return []
  const { records } = await getShowPage({
    medium, sort, range, lang, signal, q: text, limit, offset: 0,
  })
  return records
}

/**
 * One show's episode list, for the feed card's drawer.
 *
 * ⚠️ THIS RETIRES THE PER-SHOW SHARD FETCH, which was the single largest
 * request the site could make: the shards carry every boost and full shownotes,
 * measured at 3.5KB median, 15KB at p90 and **1.95MB** for the most-boosted
 * show. `boosts=0` drops the recent-notes array the drawer never reads.
 *
 * `since` windows the rows to the boosts inside the range and recomputes each
 * episode's figures over it, because the card above the drawer is showing the
 * window's numbers and a drawer of all-time ones would contradict it.
 */
export async function getShowEpisodes({ guid, since = null, signal } = {}) {
  const qs = new URLSearchParams({ boosts: '0' })
  if (since) qs.set('since', String(since))
  const resp = await fetch(
    `${PODCASTS_API}/${encodeURIComponent(guid)}?${qs}`,
    { headers: { Accept: 'application/json' }, signal },
  )
  if (!resp.ok) throw new Error(`podcast detail: HTTP ${resp.status}`)
  const data = await resp.json()
  return Array.isArray(data?.episodes) ? data.episodes : []
}

/* ── Members ─────────────────────────────────────────────────────────
 *
 * ⚠️ THE MEMBER SEARCH IS A QUERY, NOT AN INDEX OVER WHAT IS LOADED, and that
 * is the whole reason it exists. The Boosts feed used to score the boosts the
 * browser happened to be holding, so a member was findable only if they turned
 * up in what the reader had already scrolled past. Measured against the whole
 * corpus on 2026-08-23: the first page reaches 34 of 2,011 members (2%), 500
 * boosts reaches 164 (8%), and paging in all 23,259 boosts still only reaches
 * 684 (34%) — a third of members have never appeared in the note feed at all,
 * so loading more could never close it.
 */
const MEMBERS_API = '/api/v1/members'

/**
 * @param {string} opts.q  a name, an npub (whole or a prefix), or a hex pubkey.
 * @returns {Promise<Array<{pk, npub, name, pic, boosts, sats}>>} most sats
 *   first. Never throws for a miss; an empty list is a real answer.
 */
export async function searchMembers({ q, limit = SEARCH_HITS, signal } = {}) {
  const text = typeof q === 'string' ? q.trim() : ''
  if (text.length < SEARCH_MIN_CHARS) return []
  const qs = new URLSearchParams({ q: text, limit: String(limit) })
  const resp = await fetch(`${MEMBERS_API}?${qs}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`members: HTTP ${resp.status}`)
  const data = await resp.json()
  return Array.isArray(data?.members) ? data.members : []
}

/**
 * One member's boosts, newest first.
 *
 * ⚠️ THE PICK HAS TO FETCH, NOT FILTER. Filtering the loaded rows is what the
 * search box did before, and it fails in the same way for the same reason: the
 * member the reader just picked out of the whole index will usually have no
 * boosts in the window the browser is holding, so the list would empty itself
 * the moment the search succeeded. `booster=` is a parameter /api/v1/boosts has
 * always taken and it rides `idx_boosts_booster`.
 */
export async function getMemberBoosts({ pk, limit = 200, signal } = {}) {
  const qs = new URLSearchParams({ booster: pk, limit: String(limit) })
  const resp = await fetch(`/api/v1/boosts?${qs}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`member boosts: HTTP ${resp.status}`)
  const data = await resp.json()
  return normalizeBoosts(data)
}

/* ── The languages present in the index ──────────────────────────────
 *
 * The menu behind the ranked feeds' language filter. It is fetched rather than
 * declared because the set grows the first time anybody boosts a show in a new
 * language, and a hardcoded table goes stale silently — see feed-lang.js, which
 * owns everything about how the answer becomes a menu.
 */
const LANGUAGES_API = '/api/v1/languages'

/**
 * @param {'music'|null} [opts.medium]  the same partition every other reader
 *   here draws. ⚠️ PASS IT. The endpoint is medium-aware and the two halves
 *   disagree — German is 38 shows on the podcast side against 2 on music — so a
 *   menu built without it offers a feed options matching nothing it can show.
 * @returns {Promise<Array<{lang: string, shows: number, boosts: number, sats: number}>>}
 *   ordered by show count, with the untagged bucket included as a peer row
 *   under the key 'unknown'.
 */
export async function getLanguages({ medium = null, signal } = {}) {
  const qs = new URLSearchParams()
  if (medium === 'music') qs.set('medium', 'music')
  else qs.set('not_medium', 'music')
  const resp = await fetch(`${LANGUAGES_API}?${qs}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`languages: HTTP ${resp.status}`)
  const data = await resp.json()
  return Array.isArray(data?.languages) ? data.languages : []
}
