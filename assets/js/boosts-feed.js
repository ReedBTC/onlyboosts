/* Boosts feed — the note-level view behind the two Boosts tabs.
 *
 * Where feeds-podcasts.js rolls the snapshot up *by episode* (one card per
 * episode, boosts nested inside), this renders the boosts themselves: one card
 * per kind-1 boost note, newest first. Same snapshot, different axis.
 *
 * On the note shape: the snapshot carries each boost's identity and content
 * (event_id / booster_pubkey / created_at / message / sats) but not the signed
 * event. That's enough — the card only needs those fields, and reply / repost
 * / like / zap only need id + pubkey. We deliberately do NOT synthesize a
 * fake event object and pass it around as if it were real; the projection
 * below is named for what it is and never leaves this module except as the
 * minimal {id, pubkey, kind, content, created_at, tags} the action bar wants.
 *
 * Global vs Follows is a filter over the same rows — see follow-set.js.
 */
import {
  parseSegments,
  renderSegmentsInto,
  fetchProfilesFromPrimal,
  setCachedProfile,
  getCachedProfile,
} from '/assets/js/boosts-thread.js'
import { buildActionBar, configureBoostActions } from '/assets/js/boost-actions.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'
import { resolveFollows } from '/assets/js/follow-set.js'

const API_URL = '/api/community-boosts'
const PAGE_SIZE = 30
const PROFILE_CHUNK = 80   // Primal user_infos drops results on larger batches

// ── tiny DOM helper (same shape as feeds-podcasts.js's) ───────────────
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

function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`
  return String(n)
}

function renderPlaceholder(list, title, body) {
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''),
  ]))
}

// ── snapshot → renderable rows ────────────────────────────────────────
// Keeps only rows with the identity fields a card and its action bar need.
// A row missing event_id or booster_pubkey can't be replied to or linked, so
// it's dropped rather than rendered as a dead-end card.
function buildRows(data) {
  const boosts = Array.isArray(data?.boosts) ? data.boosts : []
  const episodes = (data?.episodes && typeof data.episodes === 'object') ? data.episodes : {}
  const shows = (data?.shows && typeof data.shows === 'object') ? data.shows : {}

  const rows = []
  for (const b of boosts) {
    if (!b?.event_id || !b?.booster_pubkey) continue
    if (!Number.isFinite(b.created_at)) continue
    rows.push({
      id: String(b.event_id).toLowerCase(),
      pubkey: String(b.booster_pubkey).toLowerCase(),
      created_at: b.created_at,
      message: typeof b.message === 'string' ? b.message : '',
      sats: Number.isFinite(b.sats) ? b.sats : 0,
      episode: episodes[b.item_guid] || null,
      show: shows[b.podcast_guid] || null,
      itemUrl: isSafeUrl(b.item_url) ? b.item_url : null,
      showUrl: isSafeUrl(b.show_url) ? b.show_url : null,
    })
  }
  // Newest first. The snapshot's own order isn't guaranteed — it's appended to
  // hourly by the collector, and episodes/shows get deduped across runs.
  rows.sort((a, b) => b.created_at - a.created_at)
  return rows
}

// ── card ──────────────────────────────────────────────────────────────
// Structure mirrors boosts-thread.js#renderNoteCard so the shared .note-card
// CSS applies, plus a boost-meta row (sats + what was boosted) that a plain
// kind-1 card has no concept of. Not calling renderNoteCard directly: it
// caches cards by event id and appends the action bar itself, so appending
// our meta row afterwards would double up on a cached repaint.
function renderBoostCard(row) {
  const profile = getCachedProfile(row.pubkey)

  const img = h('img', { alt: '', referrerpolicy: 'no-referrer' })
  img.src = profile?.picture || '/assets/avatar-fallback.svg'
  img.onerror = () => { img.src = '/assets/avatar-fallback.svg' }

  const nameWrap = h('div', { class: 'note-author-name-wrap' }, [
    h('span', { class: 'author-name', text: profile?.name || (row.pubkey.slice(0, 8) + '…') }),
    profile?.nip05 ? h('span', { class: 'author-handle', text: profile.nip05 }) : null,
  ])

  const time = h('time', {
    datetime: new Date(row.created_at * 1000).toISOString(),
    title: new Date(row.created_at * 1000).toLocaleString(),
    text: relTime(row.created_at),
  })

  const card = h('article', { class: 'note-card' }, [
    h('div', { class: 'note-author' }, [img, nameWrap, time]),
  ])

  // What was boosted. The episode title links out to the listening URL; the
  // show name is context. Both are optional — the collector can know about a
  // boost before Podcast Index has resolved its episode.
  const epTitle = row.episode?.title || ''
  const showTitle = row.show?.title || ''
  if (epTitle || showTitle || row.sats > 0) {
    const bits = []
    if (row.sats > 0) {
      bits.push(h('span', { class: 'ob-boost-sats' }, [
        fmtSats(row.sats), h('span', { class: 'ob-bolt', 'aria-hidden': 'true', text: '⚡' }),
      ]))
    }
    if (epTitle) {
      bits.push(row.itemUrl
        ? h('a', { class: 'ob-boost-ep', href: row.itemUrl, target: '_blank', rel: 'noopener noreferrer', text: epTitle })
        : h('span', { class: 'ob-boost-ep', text: epTitle }))
    }
    if (showTitle) bits.push(h('span', { class: 'ob-boost-show', text: showTitle }))
    card.appendChild(h('div', { class: 'ob-boost-meta' }, bits))
  }

  const msg = (row.message || '').trim()
  if (msg) {
    const body = h('div', { class: 'note-body' })
    // Shared tokenizer: nostr: mentions → chips, URLs → links, rest as text.
    // inEmbed keeps a quoted note as a chip rather than firing an embed fetch
    // for every card in a 30-card page.
    renderSegmentsInto(body, parseSegments(msg), { inEmbed: true })
    card.appendChild(body)
  }

  // Reply / repost / like / zap. The boost IS a kind-1 note, so id + pubkey is
  // all these need — same projection feeds-podcasts.js uses.
  const ev = {
    id: row.id, pubkey: row.pubkey, kind: 1,
    content: row.message || '', created_at: row.created_at, tags: [],
  }
  try { card.appendChild(buildActionBar(ev, card)) }
  catch (e) { console.warn('[boosts] action bar failed', e) }

  return card
}

// ── profiles ──────────────────────────────────────────────────────────
async function loadProfiles(pubkeys) {
  const unique = [...new Set(pubkeys)].filter((pk) => !getCachedProfile(pk))
  for (let i = 0; i < unique.length; i += PROFILE_CHUNK) {
    try {
      const got = await fetchProfilesFromPrimal(unique.slice(i, i + PROFILE_CHUNK))
      for (const [pk, prof] of got) setCachedProfile(pk, prof)
    } catch { /* this chunk degrades to a truncated pubkey + fallback avatar */ }
  }
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {object}   opts
 * @param {Element}  opts.list   the [data-feed-list] container to fill
 * @param {string}   opts.scope  'global' | 'follows'
 */
export async function renderBoosts({ list, scope = 'global' }) {
  if (!list) return

  // Resolve the audience first — a signed-out Follows tab should say so
  // rather than download a 1.4MB snapshot it can't filter.
  let follows = null
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
        ' Follow some npubs in any Nostr client and their boosts will show up here.')
      return
    }
    follows = new Set(res.follows)
  }

  let data
  try {
    const resp = await fetch(API_URL, { headers: { Accept: 'application/json' } })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    data = await resp.json()
  } catch (e) {
    console.error('[boosts] fetch failed', e)
    renderPlaceholder(list, 'Couldn’t load boosts',
      ' The boosts feed is unavailable right now — please try again later.')
    return
  }

  let rows = buildRows(data)
  if (follows) rows = rows.filter((r) => follows.has(r.pubkey))

  if (!rows.length) {
    if (follows) {
      renderPlaceholder(list, 'No boosts from your follows yet',
        ' Nobody you follow has boosted a podcast on Nostr in this snapshot. The Global tab shows everyone.')
    } else {
      renderPlaceholder(list, 'No boosts yet',
        ' When someone boosts a podcast episode on Nostr, it’ll show up here.')
    }
    return
  }

  // Pre-warm the boost widget once the feed is up so the first Reply/Zap click
  // doesn't pay the cold-start cost. Deferred so it can't compete with first
  // paint. Same pattern as feeds-podcasts.js.
  setTimeout(() => {
    ensureLoginWidget()
      .then(() => { try { configureBoostActions({}) } catch {} })
      .catch(() => {})
  }, 1200)

  const cards = h('div', { class: 'ob-boost-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })
  let shown = 0

  function renderMore() {
    const slice = rows.slice(shown, shown + PAGE_SIZE)
    for (const row of slice) cards.appendChild(renderBoostCard(row))
    shown += slice.length

    moreWrap.replaceChildren()
    if (shown < rows.length) {
      moreWrap.appendChild(h('button', {
        class: 'pcast-showmore', type: 'button',
        onclick: () => renderMore(),
      }, `Show more (${rows.length - shown} left)`))
    }

    // Names and avatars enrich the cards but shouldn't gate first paint:
    // render with truncated pubkeys, then repaint this page once profiles land.
    loadProfiles(slice.map((r) => r.pubkey)).then(() => {
      const repainted = h('div', { class: 'ob-boost-list' })
      for (const row of rows.slice(0, shown)) repainted.appendChild(renderBoostCard(row))
      cards.replaceChildren(...repainted.childNodes)
    })
  }

  list.replaceChildren(cards, moreWrap)
  renderMore()

  const count = list.closest('.feed-panel')?.querySelector('.feed-count')
  if (count) {
    count.textContent = `${rows.length} boost${rows.length === 1 ? '' : 's'}`
    count.hidden = false
  }
}
