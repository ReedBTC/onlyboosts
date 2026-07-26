/* Shows feed — the show-level view behind the Shows option in the feed bar.
 *
 * The card is the SHOW, where the Episodes feeds' card is one EPISODE. Same
 * boosts underneath, rolled up a level: how much a show has taken, how many
 * people sent it, across how many episodes. Expanding a card lists that show's
 * episodes with their own boost totals.
 *
 * An earlier pass at this replaced the episode feed with it and was reverted
 * (1f24c77) — correctly, since the two views answer different questions and the
 * episode one was never up for replacement. Shows now has its own slot in the
 * feed bar, so nothing is displaced.
 *
 * ── Two sources, one card shape ──────────────────────────────────────
 *
 * The range filter is what decides where a card's numbers come from, because
 * only one of the two sources can answer each range honestly:
 *
 *   All      podcasts/index.json — the collector's own per-show rollup, 1,384
 *            shows with genuinely all-time counts, in one ~440KB request.
 *            Nothing is aggregated in the browser.
 *   1W / 1M  the boost corpus, grouped by podcast.guid here. The published
 *            index has no per-window breakdown, so a windowed view can only be
 *            built from the boosts themselves — and it must be, or a "last 7
 *            days" card would be showing all-time sat totals.
 *
 * That split is also why the windowed ranges are cheap: they read the same
 * latest.json + month archives the Episodes feeds already pull, and ob-data.js
 * caches them for the page's lifetime. Opening Episodes first makes this free.
 *
 * Scope: Global only, deliberately. podcasts/index.json is computed over
 * everyone, so it cannot serve a Follows audience — its counts would be wrong
 * for a filtered one. A Shows · Follows would have to roll the D1 corpus up by
 * show (ob-live.js#getFollowsBoosts, the way feeds-podcasts.js does by
 * episode); it just isn't built yet, which is why the scope menu stays hidden
 * on this feed.
 */
import {
  getPodcastIndex, getPodcastDetail,
  getLatestBoosts, getBoostMonths, getBoostMonth,
} from '/assets/js/ob-data.js'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls,
} from '/assets/js/feed-controls.js'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js'
import { showPageHref } from '/assets/js/show-link.js'

const PAGE_SIZE = 25       // show cards per "load more" batch
const DRAWER_EPISODES = 50 // episodes listed per expanded show

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) {
    if (kid == null) continue
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid)
  }
  return el
}

function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

// The shards stringify their numerics ("9", "55987", "None"), and the index
// is not contractually typed either — coerce rather than trusting typeof.
function num(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}

function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`
  return String(n)
}

function relTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

function shortDate(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

function renderPlaceholder(list, title, body) {
  list.className = ''
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''),
  ]))
}

// ── Range + sort ──────────────────────────────────────────────────────
// The range filters on boost time: a show is in the 1W view if it was boosted
// in the last 7 days, and its numbers are that week's numbers. (The Episodes
// feeds' identical buttons mean episode air date, which is a different axis —
// each feed writes its own tooltips for exactly that reason.)
function rangeTitle(key) {
  const days = rangeDays(key)
  return days ? `Shows boosted in the last ${days} days` : 'All time'
}

// Same five axes as the episode rollup, one level up. `episodes` is the axis
// that only exists here — an episode card can't have an episode count.
const SORT_OPTIONS = [
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
  ['boosters', 'Most boosters'],
  ['episodes', 'Most episodes'],
  ['latest', 'Recently boosted'],
]

// Sorts where a position means something, so the card gets a rank number.
// 'latest' is chronology, not standing.
const RANKED_SORTS = new Set(['boosts', 'sats', 'boosters', 'episodes'])

// Every comparator breaks ties on sats, then on most-recent boost, so the
// order is stable across repaints.
const bySats = (a, b) => b.sats - a.sats || b.latest - a.latest
const SORTERS = {
  boosts: (a, b) => b.boosts - a.boosts || bySats(a, b),
  sats: bySats,
  boosters: (a, b) => b.boosters - a.boosters || bySats(a, b),
  episodes: (a, b) => b.episodes - a.episodes || bySats(a, b),
  latest: (a, b) => b.latest - a.latest || bySats(a, b),
}

// ── Sources ───────────────────────────────────────────────────────────
// Both produce the same card shape:
//
//   { guid, title, img, feed, file, boosts, sats, boosters, episodes, latest,
//     eps }
//
// `eps` is the episode list when we already hold it (the windowed rollup has
// every boost in memory, so it comes for free) and null when we don't (the
// all-time index carries counts only, so the drawer fetches the shard).

/** All time: the collector's published per-show rollup, as published. */
async function loadAllTime() {
  const rows = await getPodcastIndex()
  return rows.map((p) => ({
    guid: p.guid,
    title: typeof p.title === 'string' ? p.title : '',
    img: typeof p.img === 'string' ? p.img : '',
    feed: typeof p.feed === 'string' ? p.feed : '',
    // Verbatim from the rollup — the collector owns its own layout, so a
    // shard path is never built by hand from the guid.
    file: typeof p.file === 'string' ? p.file : '',
    boosts: num(p.boosts),
    sats: num(p.sats),
    boosters: num(p.boosters),
    episodes: num(p.episodes),
    latest: num(p.latest),
    eps: null,
  }))
}

/**
 * Enough boost rows to cover a cutoff, newest-first.
 *
 * latest.json is ~1,000 boosts spanning ~26 days, so 1W is already covered by
 * it and 1M needs one archive. Walking until the oldest row is past the cutoff
 * (rather than taking a fixed number of months) is what keeps that true as the
 * network's volume changes.
 */
async function loadRowsSince(cutoff) {
  const [latest, months] = await Promise.all([getLatestBoosts(), getBoostMonths()])
  const seen = new Set()
  const rows = []
  let oldest = Infinity
  const take = (arr) => {
    for (const b of arr) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      rows.push(b)
      if (b.ts < oldest) oldest = b.ts
    }
  }
  take(latest)
  for (let i = 0; i < months.length && oldest > cutoff; i++) {
    try {
      take(await getBoostMonth(months[i].file))
    } catch (e) {
      console.warn('[shows] month load failed', months[i].file, e)
    }
  }
  return rows.filter((b) => b.ts >= cutoff)
}

/** A window: the boosts in it, grouped by show. */
async function loadWindow(cutoff) {
  const rows = await loadRowsSince(cutoff)
  const byShow = new Map()

  for (const b of rows) {
    const guid = b.podcast.guid
    // ~2% of rows carry no show guid, so there's nothing to group them under.
    // They're still counted in the Boosts feed; they just can't be a card here.
    if (!guid) continue

    let s = byShow.get(guid)
    if (!s) {
      s = {
        guid, title: b.podcast.title || '', img: b.podcast.img || '',
        feed: b.podcast.feed || '', file: `podcasts/${guid}.json`,
        boosts: 0, sats: 0, boosters: 0, episodes: 0, latest: 0,
        eps: [],
        _boosters: new Set(),
        _eps: new Map(),
      }
      byShow.set(guid, s)
    }
    // Metadata is embedded per boost and any given row can be missing a piece,
    // so fill from whichever row has it.
    if (!s.title && b.podcast.title) s.title = b.podcast.title
    if (!s.img && b.podcast.img) s.img = b.podcast.img
    if (!s.feed && b.podcast.feed) s.feed = b.podcast.feed

    s.boosts++
    s.sats += b.sats || 0
    if (b.ts > s.latest) s.latest = b.ts
    s._boosters.add(b.booster.pk)

    // Episode guid is an opaque key — sometimes a UUID, sometimes a URL.
    const eg = b.episode.guid
    if (!eg) continue
    let e = s._eps.get(eg)
    if (!e) {
      e = {
        guid: eg, title: b.episode.title || '', img: b.episode.img || '',
        date: b.episode.date || 0, num: b.episode.num || 0,
        url: b.episode.url || '', boosts: 0, sats: 0,
      }
      s._eps.set(eg, e)
    }
    if (!e.title && b.episode.title) e.title = b.episode.title
    if (!e.date && b.episode.date) e.date = b.episode.date
    if (!e.url && b.episode.url) e.url = b.episode.url
    e.boosts++
    e.sats += b.sats || 0
  }

  const out = []
  for (const s of byShow.values()) {
    s.boosters = s._boosters.size
    s.episodes = s._eps.size
    s.eps = [...s._eps.values()]
    delete s._boosters
    delete s._eps
    out.push(s)
  }
  return out
}

// One entry per range for the page's lifetime. The HTTP layer is already
// cached by ob-data.js; this caches the *grouping*, so toggling 1M → All → 1M
// repaints instantly instead of re-walking a few thousand rows.
const byRange = new Map()

function loadRange(key) {
  if (byRange.has(key)) return byRange.get(key)
  const cutoff = rangeCutoff(key)
  const p = (cutoff ? loadWindow(cutoff) : loadAllTime())
  byRange.set(key, p)
  // A failed load shouldn't poison the range for the rest of the session.
  p.catch(() => byRange.delete(key))
  return p
}

// ── Episode drawer ────────────────────────────────────────────────────
// Newest episode first: the list reads as the show's recent catalogue, with
// each row carrying what it took. The episode-level ranking question is what
// the Episodes feeds are for.
function renderEpisodes(into, eps, { truncatedFrom = 0 } = {}) {
  if (!eps.length) {
    into.replaceChildren(h('div', { class: 'ob-show-note', text: 'No episodes recorded for this show yet.' }))
    return
  }
  const list = h('ul', { class: 'ob-ep-list' })
  for (const e of eps) {
    const title = e.title || 'Untitled episode'
    const meta = [shortDate(e.date), e.boosts ? plural(e.boosts, 'boost', 'boosts') : null]
      .filter(Boolean).join(' · ')
    list.appendChild(h('li', { class: 'ob-ep' }, [
      h('div', { class: 'ob-ep-main' }, [
        isSafeUrl(e.url)
          ? h('a', {
              class: 'ob-ep-title', href: e.url,
              target: '_blank', rel: 'noopener noreferrer', text: title,
            })
          : h('span', { class: 'ob-ep-title', text: title }),
        meta ? h('span', { class: 'ob-ep-meta', text: meta }) : null,
      ]),
      e.sats ? h('span', { class: 'ob-ep-sats' }, [fmtSats(e.sats), h('span', { class: 'pcast-bolt', 'aria-hidden': 'true', text: ' ⚡' })]) : null,
    ]))
  }
  into.replaceChildren(list)
  if (truncatedFrom > eps.length) {
    into.appendChild(h('div', { class: 'ob-show-note',
      text: `Showing the ${eps.length} most recent of ${truncatedFrom} episodes.` }))
  }
}

function sortEpisodes(eps) {
  return [...eps].sort((a, b) => num(b.date) - num(a.date))
}

// ── Card ──────────────────────────────────────────────────────────────
// Built out of the episode card's chrome (.pcast-card and friends) rather than
// a parallel set of its own, so the two feeds read as one system. Only the
// stat row and the episode list are new.
function renderShowCard(s, rank) {
  // 462 of the 1,384 shows in the index (33%) have no title and no art: the
  // collector holds a boost tagged with their guid but Podcast Index doesn't
  // know the feed, so there is nothing to enrich from. They're the long tail —
  // median 1 boost, 3.8% of all sats, and the first one doesn't appear until
  // #28 on any sort — so they never crowd the first page. Kept rather than
  // filtered (they're real boosts to real shows) but labelled for what they
  // are, with the guid shown, so an unnamed card reads as incomplete data
  // rather than a broken site.
  const named = !!s.title
  const art = isSafeUrl(s.img)
    ? h('img', { src: s.img, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
    : null
  const media = h('div', { class: 'pcast-card-media' + (art ? '' : ' pcast-card-media--none') }, art || '🎙')
  // A dead host or a hotlink block falls back to the same glyph a show with no
  // art gets, rather than leaving an empty box.
  if (art) {
    art.onerror = () => {
      media.classList.add('pcast-card-media--none')
      media.replaceChildren(document.createTextNode('🎙'))
    }
  }

  const stats = h('div', { class: 'pcast-meta ob-show-stats' }, [
    h('span', { class: 'pcast-sats' }, [fmtSats(s.sats), h('span', { class: 'pcast-bolt', 'aria-hidden': 'true', text: ' ⚡' })]),
    h('span', { class: 'pcast-dot', 'aria-hidden': 'true', text: '·' }),
    h('span', { text: plural(s.boosts, 'boost', 'boosts') }),
    h('span', { class: 'pcast-dot', 'aria-hidden': 'true', text: '·' }),
    h('span', { text: plural(s.boosters, 'booster', 'boosters') }),
    h('span', { class: 'pcast-dot', 'aria-hidden': 'true', text: '·' }),
    h('span', { text: plural(s.episodes, 'episode', 'episodes') }),
  ])

  const head = h('div', { class: 'pcast-card-head' }, [
    rank ? h('div', { class: 'pcast-rank', text: String(rank) }) : null,
    media,
    h('div', { class: 'pcast-card-body' }, [
      // Named shows link to their landing page (/show/<guid>); unnamed ones
      // don't, because there is no page — the qualifying rule for a landing
      // page is exactly "has a title". See docs/show-pages-spec.md.
      h('h3', {
        class: 'pcast-title' + (named ? '' : ' ob-show-unnamed'),
      }, named && showPageHref(s.guid)
        ? [h('a', { class: 'ob-show-link', href: showPageHref(s.guid), text: s.title })]
        : (named ? s.title : 'Unidentified show')),
      // The guid stands in for a name we don't have. It's the only handle on
      // the show, and it's what you'd search the collector for.
      named ? null : h('div', { class: 'ob-show-guid', text: s.guid }),
      stats,
      s.latest ? h('div', { class: 'ob-show-latest', text: `last boost ${relTime(s.latest)}` }) : null,
    ]),
  ])

  // No drawer when there's nothing to put in it. A show can legitimately have
  // boosts and no episodes: the all-time index reports 0 for shows whose boosts
  // never carried an episode guid, and the windowed rollup counts distinct
  // guids, so the same holds there. Offering a drawer would spend a shard fetch
  // to say "no episodes".
  if (!s.episodes) return h('article', { class: 'pcast-card' }, [head])

  const details = h('div', { class: 'pcast-details', hidden: 'hidden' })
  const caret = h('span', { class: 'pcast-drawer-caret', 'aria-hidden': 'true', text: '▾' })
  const drawer = h('button', {
    class: 'pcast-drawer', type: 'button', 'aria-expanded': 'false',
  }, [caret, h('span', { text: plural(s.episodes, 'episode', 'episodes') })])

  const card = h('article', { class: 'pcast-card' }, [head, drawer, details])
  let loaded = false

  drawer.addEventListener('click', async () => {
    const open = drawer.getAttribute('aria-expanded') === 'true'
    drawer.setAttribute('aria-expanded', open ? 'false' : 'true')
    details.hidden = open
    card.classList.toggle('is-open', !open)
    if (open || loaded) return
    loaded = true

    // Windowed ranges hold every boost in memory, so the list is already
    // built and costs nothing. The all-time index carries counts only, so that
    // path pays for the show's detail shard. Measured across the index: 3.5KB
    // at the median, 15KB at p90, and 1.95MB for the single most-boosted show
    // (the shards carry every boost and full shownotes). Cheap for nearly
    // every show, which is why it's an explicit expand rather than eager, and
    // ob-data.js caches it for the rest of the session.
    if (s.eps) {
      renderEpisodes(details, sortEpisodes(s.eps).slice(0, DRAWER_EPISODES), { truncatedFrom: s.eps.length })
      return
    }
    if (!s.file) {
      renderEpisodes(details, [])
      return
    }
    details.replaceChildren(h('div', { class: 'ob-show-note', text: 'Loading episodes…' }))
    try {
      const detail = await getPodcastDetail(s.file)
      const eps = detail.episodes.map((e) => ({
        guid: e.guid, title: e.title || '', img: e.img || '',
        date: num(e.date), num: num(e.num), url: e.url || '',
        boosts: num(e.boosts), sats: num(e.sats),
      }))
      renderEpisodes(details, sortEpisodes(eps).slice(0, DRAWER_EPISODES), { truncatedFrom: eps.length })
    } catch (e) {
      console.warn('[shows] detail load failed', s.file, e)
      loaded = false   // collapsing and reopening retries
      details.replaceChildren(h('div', { class: 'ob-show-note', text: 'Couldn’t load this show’s episodes.' }))
    }
  })

  return card
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} [opts.panel] the feed's panel, for its feed key
 * @param {Element} opts.list    the [data-feed-list] container to fill
 */
export async function renderShows({ panel, list }) {
  if (!list) return
  // Shows never re-renders today (Global only, so no account switch reaches
  // it), but the reset is what makes that a fact about the feed rather than an
  // assumption baked into this one.
  resetFeedSearch(panel)

  // All time is the opening view: it's the one request that needs no archive
  // walk, and the all-time leaderboard is the question a show-level feed is
  // for. The windowed ranges narrow it.
  let rangeKey = 'all'
  // Raw boost volume, matching the episode rollup's default — the ranking the
  // feed is *for*. 'boosters' ranks by distinct people instead, which differs
  // wherever someone boosts the same show repeatedly (most of them).
  let sortKey = 'boosts'
  let shows = []
  let sorted = []   // every show in the range, in sort order, rank stamped
  let view = []     // what's painted: `sorted`, or the one searched show
  let shown = 0
  let seq = 0
  let search = null

  const cards = h('div', { class: 'pcast-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  function paintMore() {
    const slice = view.slice(shown, shown + PAGE_SIZE)
    slice.forEach((s) => {
      // The rank is the show's position in the full sorted list, stamped in
      // repaint() before any search filter narrowed it — so a searched show
      // still reads #47 rather than #1. Numbering continues across pages.
      cards.appendChild(renderShowCard(s, RANKED_SORTS.has(sortKey) ? s._rank : null))
    })
    shown += slice.length
    moreWrap.replaceChildren()
    const remaining = view.length - shown
    if (remaining <= 0) return
    const batch = Math.min(PAGE_SIZE, remaining)
    moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
      h('button', {
        class: 'pcast-showmore', type: 'button', onclick: paintMore,
      }, `Load ${batch} more show${batch === 1 ? '' : 's'}`),
      h('div', { class: 'pcast-more-count', text: `Showing ${shown} of ${view.length}` }),
    ]))
  }

  function repaint() {
    // Rank first, filter second. Stamping the position before the search
    // narrows the list is what lets one searched card carry its standing in
    // the whole ranking; ranking the filtered list would renumber it to #1.
    sorted = [...shows].sort(SORTERS[sortKey] || SORTERS.boosts)
    sorted.forEach((s, i) => { s._rank = i + 1 })
    // The index is the current range in the current order, so it's dropped
    // whenever either changes. Rebuilt lazily on the next keystroke.
    search?.refresh()
    const picked = search?.selection || null
    view = picked ? sorted.filter((s) => s.guid === picked.key) : sorted
    shown = 0
    cards.replaceChildren()
    moreWrap.replaceChildren()
    if (!view.length) {
      cards.appendChild(picked
        ? h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: 'Not in this range' }),
            ` ${picked.label} wasn’t boosted in this time range — widen the range, or clear the search.`,
          ])
        : h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: 'No shows in this window' }),
            rangeKey === 'all'
              ? ' When someone boosts a podcast episode on Nostr, its show will appear here.'
              : ' Nothing was boosted in this time range — try a wider one.',
          ]))
      return
    }
    paintMore()
  }

  // A range change means a different source, so it can fetch. The seq guard
  // covers a second click landing while the first is still in flight.
  async function applyRange(key) {
    if (key === rangeKey) return
    rangeKey = key
    const mine = ++seq
    if (!byRange.has(key)) {
      list.className = ''
      list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
        h('strong', { text: 'Loading this window…' }),
        ' Rolling the boosts in this range up by show.',
      ]))
    }
    let next
    try {
      next = await loadRange(key)
    } catch (e) {
      console.error('[shows] range load failed', key, e)
      if (mine !== seq) return
      renderPlaceholder(list, 'Couldn’t load shows',
        ' The boosts feed is unavailable right now — please try again later.')
      return
    }
    if (mine !== seq) return
    shows = next
    list.replaceChildren(cards, moreWrap)
    repaint()
  }

  try {
    shows = await loadRange(rangeKey)
  } catch (e) {
    console.error('[shows] index fetch failed', e)
    renderPlaceholder(list, 'Couldn’t load shows',
      ' The podcast index is unavailable right now — please try again later.')
    return
  }

  mountFeedControls(panel?.dataset.feed || 'shows', [
    rangeControl(rangeKey, applyRange, {
      label: 'Filter by when the show was boosted', titleFor: rangeTitle,
    }),
    sortControl(SORT_OPTIONS, sortKey, (key) => {
      if (key === sortKey) return
      sortKey = key
      repaint()
    }, { title: 'Sort shows' }),
  ])

  // Search the shows in the current range. The sub-line is the show's own
  // numbers, so two similarly-named feeds are told apart by their size rather
  // than by a guid nobody recognises — except on the 33% with no title at all,
  // where the guid is the only handle there is.
  search = mountFeedSearch(panel, {
    placeholder: 'Search shows…',
    label: 'Search shows',
    noun: 'show',
    onPick: () => repaint(),
    getEntries: () => sorted.map((s) => ({
      key: s.guid,
      label: s.title || 'Unidentified show',
      sub: s.title
        ? `${plural(s.boosts, 'boost', 'boosts')} · ${fmtSats(s.sats)} sats`
        : s.guid,
      // Matched, not shown. The guid is the only handle on the 33% of shows
      // with no title, and it's what you'd have copied off one of their cards.
      extra: s.guid,
      img: s.img,
    })),
  })

  list.className = ''
  list.replaceChildren(cards, moreWrap)
  repaint()
}
