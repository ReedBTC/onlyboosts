/* Podcasts feed — the show-level view behind the two Podcasts tabs.
 *
 * The collector now publishes the rollup, so Global is a straight read of
 * podcasts/index.json (1,376 shows, each with boost/sat/booster/episode
 * counts and a `file` pointer to its detail shard). Nothing is aggregated in
 * the browser. This replaces feeds-podcasts.js, which rolled a flat boost
 * list up client-side because LB's snapshot had no show index.
 *
 * Follows can't use that index: it's computed over everyone, so its counts
 * would be wrong for a filtered audience. Instead it rolls up the boost feed
 * itself, restricted to the viewer's follows — the one case where a
 * client-side rollup is still the right answer.
 *
 * Expanding a show pulls its detail shard (podcasts/<guid>.json) for the
 * episode list. Those are fetched lazily and cached by ob-data.js, because
 * they're large — ~570KB for a show with 130 episodes and 542 boosts.
 */
import { resolveFollows } from '/assets/js/follow-set.js'
import {
  getPodcastIndex, getPodcastDetail, getLatestBoosts, getBoostMonths, getBoostMonth,
} from '/assets/js/ob-data.js'

const PAGE_SIZE = 25

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

function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`
  return String(n)
}

function relTime(ts) {
  if (!Number.isFinite(ts)) return ''
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

function renderPlaceholder(list, title, body) {
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''),
  ]))
}

function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

// ── show card ─────────────────────────────────────────────────────────
function renderShowCard(p) {
  const art = h('img', { class: 'ob-show-art', alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
  art.src = (isSafeUrl(p.img) && p.img) || '/assets/avatar-fallback.svg'
  art.onerror = () => { art.src = '/assets/avatar-fallback.svg' }

  const stats = h('div', { class: 'ob-show-stats' }, [
    h('span', {}, [h('strong', { text: fmtSats(p.sats) }), ' sats']),
    h('span', { text: plural(p.boosts || 0, 'boost', 'boosts') }),
    h('span', { text: plural(p.boosters || 0, 'booster', 'boosters') }),
    h('span', { text: plural(p.episodes || 0, 'episode', 'episodes') }),
  ])

  const body = h('div', { class: 'ob-show-body' }, [
    h('h3', { class: 'ob-show-title', text: p.title || 'Untitled show' }),
    stats,
    p.latest ? h('span', { class: 'ob-show-latest', text: `last boost ${relTime(p.latest)}` }) : null,
  ])

  const drawer = h('div', { class: 'ob-show-drawer', hidden: 'hidden' })
  let loaded = false

  const toggle = h('button', {
    class: 'ob-show-toggle', type: 'button', 'aria-expanded': 'false',
    text: 'Episodes',
  })
  toggle.addEventListener('click', async () => {
    const open = toggle.getAttribute('aria-expanded') === 'true'
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true')
    drawer.hidden = open
    if (open || loaded) return

    // Detail shards are big, so only fetch on first expand. `file` comes from
    // the rollup rather than being built from the guid — the collector owns
    // its own layout.
    loaded = true
    drawer.replaceChildren(h('div', { class: 'ob-show-loading', text: 'Loading episodes…' }))
    try {
      const detail = await getPodcastDetail(p.file)
      renderEpisodes(drawer, detail)
    } catch (e) {
      console.warn('[podcasts] detail load failed', p.file, e)
      loaded = false   // let the user retry by collapsing and reopening
      drawer.replaceChildren(h('div', { class: 'ob-show-loading', text: 'Couldn’t load this show’s episodes.' }))
    }
  })

  return h('article', { class: 'ob-show-card' }, [
    h('div', { class: 'ob-show-head' }, [art, body, toggle]),
    drawer,
  ])
}

function renderEpisodes(drawer, detail) {
  const eps = [...detail.episodes]
  // Shards stringify their numerics ("9", "55987"), and date can be a string
  // too — ob-data only normalizes the boost records, not the episode list,
  // so coerce here rather than trusting the wire types.
  const n = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : 0 }
  eps.sort((a, b) => n(b.date) - n(a.date))

  if (!eps.length) {
    drawer.replaceChildren(h('div', { class: 'ob-show-loading', text: 'No episodes recorded for this show yet.' }))
    return
  }

  const ul = h('ul', { class: 'ob-ep-list' })
  for (const e of eps.slice(0, 50)) {
    const title = e.title || 'Untitled episode'
    ul.appendChild(h('li', { class: 'ob-ep' }, [
      h('div', { class: 'ob-ep-main' }, [
        isSafeUrl(e.url)
          ? h('a', { class: 'ob-ep-title', href: e.url, target: '_blank', rel: 'noopener noreferrer', text: title })
          : h('span', { class: 'ob-ep-title', text: title }),
        h('span', { class: 'ob-ep-meta', text:
          [n(e.date) ? new Date(n(e.date) * 1000).toLocaleDateString() : null,
           n(e.boosts) ? plural(n(e.boosts), 'boost', 'boosts') : null,
          ].filter(Boolean).join(' · ') }),
      ]),
      n(e.sats) ? h('span', { class: 'ob-ep-sats' }, [fmtSats(n(e.sats)), ' ⚡']) : null,
    ]))
  }
  drawer.replaceChildren(ul)
  if (eps.length > 50) {
    drawer.appendChild(h('div', { class: 'ob-show-loading',
      text: `Showing the 50 most recent of ${eps.length} episodes.` }))
  }
}

// ── follows rollup ────────────────────────────────────────────────────
// The published index is computed over everyone, so it can't answer "what do
// my follows boost". Roll the boost feed up instead, restricted to follows.
async function rollupFromBoosts(follows) {
  const [latest, months] = await Promise.all([getLatestBoosts(), getBoostMonths()])
  const seen = new Set()
  const rows = []
  const take = (arr) => {
    for (const b of arr) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      if (follows.has(b.booster.pk)) rows.push(b)
    }
  }
  take(latest)
  // Two most recent archives on top of latest.json. A hard bound on purpose:
  // pulling all 22 months would be ~20MB to build one view. If a show a user
  // follows only ever got boosted a year ago it won't appear here — an
  // acceptable trade for a view that's about what people are boosting *now*.
  for (const m of months.slice(0, 2)) {
    try { take(await getBoostMonth(m.file)) }
    catch (e) { console.warn('[podcasts] month load failed', m.file, e) }
  }

  const byShow = new Map()
  for (const b of rows) {
    const guid = b.podcast.guid
    if (!guid) continue          // ~2% of rows have no show guid to group by
    let agg = byShow.get(guid)
    if (!agg) {
      agg = {
        guid, title: b.podcast.title, img: b.podcast.img, feed: b.podcast.feed,
        boosts: 0, sats: 0, latest: 0, file: `podcasts/${guid}.json`,
        _boosters: new Set(), _eps: new Set(),
      }
      byShow.set(guid, agg)
    }
    agg.boosts++
    agg.sats += b.sats || 0
    agg.latest = Math.max(agg.latest, b.ts)
    agg._boosters.add(b.booster.pk)
    if (b.episode.guid) agg._eps.add(b.episode.guid)
    if (!agg.title && b.podcast.title) agg.title = b.podcast.title
    if (!agg.img && b.podcast.img) agg.img = b.podcast.img
  }
  const out = [...byShow.values()]
  for (const a of out) {
    a.boosters = a._boosters.size
    a.episodes = a._eps.size
    delete a._boosters; delete a._eps
  }
  out.sort((a, b) => b.latest - a.latest)
  return out
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} opts.list   the [data-feed-list] container to fill
 * @param {string}  opts.scope  'global' | 'follows'
 */
export async function renderPodcasts({ list, scope = 'global' }) {
  if (!list) return

  let shows
  if (scope === 'follows') {
    const res = await resolveFollows()
    if (res.status === 'signed-out') {
      renderPlaceholder(list, 'Sign in to see this feed',
        ' Follows feeds read your kind-3 contact list, so they need a signed-in npub.')
      return
    }
    if (res.status === 'unavailable') {
      renderPlaceholder(list, 'Couldn’t load your follow list',
        ' We couldn’t reach a relay holding your kind-3 contact list — please try again later.')
      return
    }
    if (res.status === 'empty') {
      renderPlaceholder(list, 'You’re not following anyone yet',
        ' Follow some npubs in any Nostr client and the podcasts they boost will show up here.')
      return
    }
    try {
      shows = await rollupFromBoosts(new Set(res.follows))
    } catch (e) {
      console.error('[podcasts] follows rollup failed', e)
      renderPlaceholder(list, 'Couldn’t load podcasts',
        ' The boosts feed is unavailable right now — please try again later.')
      return
    }
    if (!shows.length) {
      renderPlaceholder(list, 'No podcasts from your follows yet',
        ' Nobody you follow has boosted a podcast recently. The Global tab shows every show.')
      return
    }
  } else {
    try {
      shows = await getPodcastIndex()
    } catch (e) {
      console.error('[podcasts] index fetch failed', e)
      renderPlaceholder(list, 'Couldn’t load podcasts',
        ' The podcast index is unavailable right now — please try again later.')
      return
    }
    if (!shows.length) {
      renderPlaceholder(list, 'No podcasts yet',
        ' When someone boosts a podcast episode on Nostr, its show will show up here.')
      return
    }
  }

  let sortKey = 'latest'
  const SORTS = {
    latest:   { label: 'Recently boosted', cmp: (a, b) => (b.latest || 0) - (a.latest || 0) },
    sats:     { label: 'Most sats',        cmp: (a, b) => (b.sats || 0) - (a.sats || 0) },
    boosts:   { label: 'Most boosts',      cmp: (a, b) => (b.boosts || 0) - (a.boosts || 0) },
    boosters: { label: 'Most boosters',    cmp: (a, b) => (b.boosters || 0) - (a.boosters || 0) },
  }

  const cards = h('div', { class: 'ob-show-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })
  let shown = 0
  let sorted = [...shows].sort(SORTS[sortKey].cmp)

  function paintMore() {
    const slice = sorted.slice(shown, shown + PAGE_SIZE)
    for (const p of slice) cards.appendChild(renderShowCard(p))
    shown += slice.length
    moreWrap.replaceChildren()
    if (shown < sorted.length) {
      moreWrap.appendChild(h('button', {
        class: 'pcast-showmore', type: 'button', onclick: paintMore,
      }, `Show more (${sorted.length - shown} left)`))
    }
  }

  function repaint() {
    sorted = [...shows].sort(SORTS[sortKey].cmp)
    shown = 0
    cards.replaceChildren()
    paintMore()
  }

  const sortSel = h('select', { class: 'ob-sort', 'aria-label': 'Sort shows' })
  for (const [k, v] of Object.entries(SORTS)) {
    sortSel.appendChild(h('option', { value: k, text: v.label }))
  }
  sortSel.value = sortKey
  sortSel.addEventListener('change', () => { sortKey = sortSel.value; repaint() })

  list.replaceChildren(h('div', { class: 'ob-show-toolbar' }, [sortSel]), cards, moreWrap)
  paintMore()

  const count = list.closest('.feed-panel')?.querySelector('.feed-count')
  if (count) {
    count.textContent = plural(shows.length, 'show', 'shows')
    count.hidden = false
  }
}
