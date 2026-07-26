/* Boosts feed — the note-level view behind the two Boosts tabs.
 *
 * One card per kind-1 boost note, newest first. The Podcasts tabs render the
 * same data rolled up by show; this renders the boosts themselves.
 *
 * The two tabs read different backends. Global comes from ob-data.js: the
 * latest.json shard for the first page, then month archives from the manifest
 * for paging back. Follows comes from ob-live.js — the D1 query API filters to
 * the contact list server-side and pages by cursor, because the shards are
 * global by construction and scoping them client-side meant downloading months
 * of boosts to keep the handful that matched.
 *
 * Booster names and avatars are embedded in each record on both paths, so
 * unlike the old LB feed there is no profile round-trip and nothing to
 * repaint — the first paint is the final one.
 *
 * On the note shape: the feed carries each boost's identity and content
 * (id / booster.pk / ts / msg / sats) but not the signed event. That's
 * enough — the card needs only those fields, and reply / repost / like / zap
 * need only id + pubkey. The object handed to buildActionBar below is a
 * projection, not a verified event; don't pass it anywhere that assumes one.
 */
import { nip19 } from '/assets/widgets/nostr-tools.js'
import { buildActionBar, configureBoostActions } from '/assets/js/boost-actions.js'
import { wireNpubCopy } from '/assets/js/copy-npub.js'
import { parseSegments, renderSegmentsInto } from '/assets/js/boosts-thread.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'
import { resolveFollows } from '/assets/js/follow-set.js'
import {
  getLatestBoosts, getBoostMonths, getBoostMonth, boosterLabel,
} from '/assets/js/ob-data.js'
import { followsBoostReader } from '/assets/js/ob-live.js'

const PAGE_SIZE = 30

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

// The `client` tag as published by the boosting app, tidied for display.
// Apps write it inconsistently — a bare name ("BoostMeBitch"), a domain
// ("localbitcoiners.com"), sometimes with a version suffix — so known values
// get a canonical label and anything else is shown as-is minus a domain
// suffix. Unknown clients are still worth surfacing: seeing an unfamiliar app
// name is more useful than hiding it.
const CLIENT_LABELS = {
  'boostmebitch': 'Boost Me Bitch',
  'localbitcoiners.com': 'Local Bitcoiners',
  'onlyboosts.social': 'OnlyBoosts',
  'fountain': 'Fountain',
  'fountain.fm': 'Fountain',
  'castamatic': 'Castamatic',
  'podverse': 'Podverse',
  'truefans': 'TrueFans',
  'curiocaster': 'CurioCaster',
  'podcastguru': 'Podcast Guru',
}
function clientLabel(raw) {
  if (!raw) return null
  const key = String(raw).trim().toLowerCase()
  if (!key) return null
  if (CLIENT_LABELS[key]) return CLIENT_LABELS[key]
  const bare = key.replace(/^www\./, '').replace(/\.(com|fm|social|app|net|io|org)$/, '')
  if (CLIENT_LABELS[bare]) return CLIENT_LABELS[bare]
  // Fall back to the raw value with its original casing, trimmed of a version
  // suffix like "SomeApp/1.2.3".
  return String(raw).trim().split('/')[0].slice(0, 32)
}

function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`
  return String(n)
}

// The npub to copy for a booster. The feed carries one on most records, but
// `booster.npub` is nullable where `booster.pk` is not — so derive it from the
// hex pubkey when it's missing rather than leaving those cards inert.
function boosterNpub(booster) {
  if (booster?.npub) return booster.npub
  try { return nip19.npubEncode(booster.pk) } catch { return '' }
}

function renderPlaceholder(list, title, body) {
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''),
  ]))
}

// ── card ──────────────────────────────────────────────────────────────
// Mirrors boosts-thread.js#renderNoteCard's structure so the shared
// .note-card CSS applies, plus a boost-meta row (sats + what was boosted)
// that a plain kind-1 card has no concept of. Not calling renderNoteCard
// directly: it caches by event id and appends its own action bar, so our
// meta row would double up on a cached repaint.
function renderBoostCard(b) {
  // Avatar falls back to the show art before the generic placeholder — for a
  // booster with no kind-0 picture, the podcast they boosted is more
  // informative than an anonymous silhouette.
  const avatar = (isSafeUrl(b.booster.pic) && b.booster.pic)
    || (isSafeUrl(b.podcast.img) && b.podcast.img)
    || '/assets/avatar-fallback.svg'

  const img = h('img', { alt: '', referrerpolicy: 'no-referrer' })
  img.src = avatar
  img.onerror = () => { img.src = '/assets/avatar-fallback.svg' }

  const nameEl = h('span', { class: 'author-name', text: boosterLabel(b.booster) })
  const nameWrap = h('div', { class: 'note-author-name-wrap' }, [nameEl])

  // Avatar and name both copy the booster's npub — the same gesture the
  // Podcasts feed's booster avatars already offer.
  const npub = boosterNpub(b.booster)
  wireNpubCopy(img, npub)
  wireNpubCopy(nameEl, npub)

  const time = h('time', {
    datetime: new Date(b.ts * 1000).toISOString(),
    title: new Date(b.ts * 1000).toLocaleString(),
    text: relTime(b.ts),
  })

  const card = h('article', { class: 'note-card' }, [
    h('div', { class: 'note-author' }, [img, nameWrap, time]),
  ])

  // What was boosted. Every part is optional: podcast.guid is null on ~2% of
  // rows and episode.title on ~11%, so the row renders whatever it has and
  // is skipped entirely when it has nothing.
  const bits = []
  if (b.sats > 0) {
    bits.push(h('span', { class: 'ob-boost-sats' }, [
      fmtSats(b.sats), h('span', { class: 'ob-bolt', 'aria-hidden': 'true', text: '⚡' }),
    ]))
  }
  if (b.episode.title) {
    bits.push(isSafeUrl(b.episode.url)
      ? h('a', {
          class: 'ob-boost-ep', href: b.episode.url,
          target: '_blank', rel: 'noopener noreferrer', text: b.episode.title,
        })
      : h('span', { class: 'ob-boost-ep', text: b.episode.title }))
  }
  if (b.podcast.title) bits.push(h('span', { class: 'ob-boost-show', text: b.podcast.title }))
  if (bits.length) card.appendChild(h('div', { class: 'ob-boost-meta' }, bits))

  // Where the boost was sent from. Only ~3.5% of records carry a client tag
  // (Fountain, the largest source, doesn't emit one), so the line is omitted
  // rather than rendered as "Unknown" on the other 96% — a column of
  // "Unknown" would be noise, not information.
  const via = clientLabel(b.client)
  if (via) {
    card.appendChild(h('div', { class: 'ob-boost-via' }, [
      h('span', { class: 'ob-via-label', text: 'via ' }),
      h('span', { class: 'ob-via-name', text: via }),
    ]))
  }

  if (b.msg) {
    const body = h('div', { class: 'note-body' })
    // Shared tokenizer: nostr: mentions → chips, URLs → links, rest as text.
    // msg is verbatim from the boosting client and routinely contains both.
    // inEmbed keeps a quoted note as a chip rather than firing an embed fetch
    // for every card on the page.
    renderSegmentsInto(body, parseSegments(b.msg), { inEmbed: true })
    card.appendChild(body)
  }

  const ev = {
    id: b.id, pubkey: b.booster.pk, kind: 1,
    content: b.msg || '', created_at: b.ts, tags: [],
  }
  try { card.appendChild(buildActionBar(ev, card)) }
  catch (e) { console.warn('[boosts] action bar failed', e) }

  return card
}

// ── paging sources ────────────────────────────────────────────────────
// Global pages through immutable month shards; Follows pages through a D1
// cursor. The rendering below shouldn't care which, so both are wrapped in one
// interface:
//
//   rows        accumulated rows, newest-first (a stable array, mutated in place)
//   hasMore     whether anything is left to fetch
//   loadMore()  fetch the next batch, resolving to how many rows it added
//   moreLabel   what the "load older" button says
//
// loadMore() resolving to 0 means "nothing left", so both implementations keep
// pulling until they add something rather than returning 0 on a batch that
// happened to be all duplicates.

async function createGlobalSource() {
  const [all, months] = await Promise.all([getLatestBoosts(), getBoostMonths()])
  // latest.json is the most recent ~1,000 boosts regardless of month, so the
  // newest archive overlaps it. Dedupe by id rather than trusting boundaries.
  const seen = new Set(all.map((b) => b.id))
  let monthIdx = 0

  const src = {
    rows: all.slice(),
    get hasMore() { return monthIdx < months.length },
    get moreLabel() { return `Load older boosts (${months[monthIdx].month})` },
    async loadMore() {
      while (monthIdx < months.length) {
        const m = months[monthIdx++]
        let batch
        try {
          batch = await getBoostMonth(m.file)
        } catch (e) {
          console.warn('[boosts] month load failed', m.file, e)
          continue
        }
        let added = 0
        for (const b of batch) {
          if (seen.has(b.id)) continue
          seen.add(b.id)
          src.rows.push(b)
          added++
        }
        if (added) {
          src.rows.sort((a, b) => b.ts - a.ts)
          return added
        }
      }
      return 0
    },
  }
  return src
}

async function createFollowsSource(authors) {
  const reader = followsBoostReader(authors)
  // Pull the first page here so a fetch failure surfaces as "couldn't load"
  // alongside the Global path's, rather than after the empty list is painted.
  await reader.loadMore()
  return {
    rows: reader.rows,
    get hasMore() { return reader.hasMore },
    // No month to name: the cursor walks the follow set's own history, which
    // doesn't line up with archive boundaries.
    get moreLabel() { return 'Load older boosts' },
    loadMore: () => reader.loadMore(),
  }
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} opts.list   the [data-feed-list] container to fill
 * @param {string}  opts.scope  'global' | 'follows'
 */
export async function renderBoosts({ list, scope = 'global' }) {
  if (!list) return

  // Resolve the audience first — a signed-out Follows tab should say so
  // without touching the network, and the query below can't be built at all
  // until we know who to scope it to.
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
    // Kept as the array the API takes, not a Set — the filtering that used to
    // need fast membership tests now happens in SQL.
    follows = res.follows
  }

  let source
  try {
    source = follows
      ? await createFollowsSource(follows)
      : await createGlobalSource()
  } catch (e) {
    console.error('[boosts] fetch failed', e)
    renderPlaceholder(list, 'Couldn’t load boosts',
      ' The boosts feed is unavailable right now — please try again later.')
    return
  }

  const rows = source.rows

  if (!rows.length && !source.hasMore) {
    renderPlaceholder(list,
      follows ? 'No boosts from your follows yet' : 'No boosts yet',
      follows
        ? ' Nobody you follow has boosted a podcast on Nostr yet. The Global tab shows everyone.'
        : ' When someone boosts a podcast episode on Nostr, it’ll show up here.')
    return
  }

  setTimeout(() => {
    ensureLoginWidget()
      .then(() => { try { configureBoostActions({}) } catch {} })
      .catch(() => {})
  }, 1200)

  const cards = h('div', { class: 'ob-boost-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })
  let shown = 0

  function paintMore() {
    const slice = rows.slice(shown, shown + PAGE_SIZE)
    for (const b of slice) cards.appendChild(renderBoostCard(b))
    shown += slice.length
    updateMoreButton()
  }

  function updateMoreButton() {
    moreWrap.replaceChildren()
    const remaining = rows.length - shown
    const canPage = remaining > 0 || source.hasMore
    if (!canPage) return
    const label = remaining > 0
      ? `Show more (${remaining} loaded)`
      : source.moreLabel
    const btn = h('button', { class: 'pcast-showmore', type: 'button' }, label)
    btn.addEventListener('click', async () => {
      if (remaining > 0) { paintMore(); return }
      btn.disabled = true
      btn.textContent = 'Loading…'
      let got = 0
      try {
        got = await source.loadMore()
      } catch (e) {
        console.warn('[boosts] load more failed', e)
      }
      if (got) paintMore()
      else updateMoreButton()
    })
    moreWrap.appendChild(btn)
  }

  list.replaceChildren(cards, moreWrap)

  if (!rows.length) {
    // Nothing in the first batch — go looking before declaring it empty.
    // Reachable on Global, where latest.json can lag the archives. The
    // Follows reader already walks until it finds something or runs out, so
    // an empty rows[] there means hasMore is false and we returned above.
    const spinner = h('div', { class: 'feed-placeholder' }, [
      h('strong', { text: 'Looking further back…' }),
      ' No matches in the most recent boosts, checking the archives.',
    ])
    list.replaceChildren(spinner)
    let got = 0
    try {
      got = await source.loadMore()
    } catch (e) {
      console.warn('[boosts] archive walk failed', e)
    }
    if (!got) {
      renderPlaceholder(list,
        follows ? 'No boosts from your follows yet' : 'No boosts yet',
        follows
          ? ' Nobody you follow has boosted a podcast on Nostr yet. The Global tab shows everyone.'
          : ' When someone boosts a podcast episode on Nostr, it’ll show up here.')
      return
    }
    list.replaceChildren(cards, moreWrap)
  }

  paintMore()

  const count = list.closest('.feed-panel')?.querySelector('.feed-count')
  if (count) {
    // Deliberately "N+" while more remains unread — the number is what we've
    // loaded, not the feed's total, and claiming otherwise would be a lie that
    // shrinks as you page.
    const more = source.hasMore ? '+' : ''
    count.textContent = `${rows.length}${more} boost${rows.length === 1 ? '' : 's'}`
    count.hidden = false
  }
}
