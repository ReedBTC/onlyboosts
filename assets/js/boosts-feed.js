/* Boosts feed — the note-level view behind the two Boosts tabs.
 *
 * One card per kind-1 boost note, newest first. The Podcasts tabs render the
 * same data rolled up by show; this renders the boosts themselves.
 *
 * Data comes from ob-data.js: latest.json for the first page, then month
 * archives from the manifest for paging back. Booster names and avatars are
 * embedded in each record, so unlike the old LB feed there is no profile
 * round-trip and nothing to repaint — the first paint is the final one.
 *
 * On the note shape: the feed carries each boost's identity and content
 * (id / booster.pk / ts / msg / sats) but not the signed event. That's
 * enough — the card needs only those fields, and reply / repost / like / zap
 * need only id + pubkey. The object handed to buildActionBar below is a
 * projection, not a verified event; don't pass it anywhere that assumes one.
 */
import { buildActionBar, configureBoostActions } from '/assets/js/boost-actions.js'
import { parseSegments, renderSegmentsInto } from '/assets/js/boosts-thread.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'
import { resolveFollows } from '/assets/js/follow-set.js'
import { signInButton } from '/assets/js/sign-in-prompt.js'
import {
  getLatestBoosts, getBoostMonths, getBoostMonth, boosterLabel,
} from '/assets/js/ob-data.js'

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

// `extra` is an optional node appended under the body text — the signed-out
// Follows state puts its Sign in button there.
function renderPlaceholder(list, title, body, extra = null) {
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''), extra,
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

  const nameWrap = h('div', { class: 'note-author-name-wrap' }, [
    h('span', { class: 'author-name', text: boosterLabel(b.booster) }),
  ])

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

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} opts.list   the [data-feed-list] container to fill
 * @param {string}  opts.scope  'global' | 'follows'
 */
export async function renderBoosts({ list, scope = 'global' }) {
  if (!list) return

  // Resolve the audience first — a signed-out Follows tab should say so
  // rather than download a 1MB shard it can't filter.
  let follows = null
  if (scope === 'follows') {
    const res = await resolveFollows()
    if (res.status === 'signed-out') {
      renderPlaceholder(list, 'Sign in to see this feed',
        ' Follows feeds read your kind-3 contact list, so they need a signed-in npub.',
        signInButton())
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

  let all, months
  try {
    ;[all, months] = await Promise.all([getLatestBoosts(), getBoostMonths()])
  } catch (e) {
    console.error('[boosts] fetch failed', e)
    renderPlaceholder(list, 'Couldn’t load boosts',
      ' The boosts feed is unavailable right now — please try again later.')
    return
  }

  const match = (b) => !follows || follows.has(b.booster.pk)
  let rows = all.filter(match)
  // Month archives already covered by latest.json. latest.json is the most
  // recent ~1,000 boosts regardless of month, so the newest archive overlaps
  // it — dedupe by id when pulling more in rather than trusting boundaries.
  const seen = new Set(all.map((b) => b.id))
  let monthIdx = 0

  if (!rows.length && !months.length) {
    renderPlaceholder(list, 'No boosts yet',
      ' When someone boosts a podcast episode on Nostr, it’ll show up here.')
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

  // Pull older months until we have something to show. A Follows feed can
  // legitimately match nothing in the most recent 1,000 boosts while having
  // plenty further back, so "no results" must mean "we looked", not "the
  // first page was empty".
  async function pullOlder() {
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
        if (!match(b)) continue
        rows.push(b)
        added++
      }
      if (added) {
        rows.sort((a, b) => b.ts - a.ts)
        return true
      }
    }
    return false
  }

  function paintMore() {
    const slice = rows.slice(shown, shown + PAGE_SIZE)
    for (const b of slice) cards.appendChild(renderBoostCard(b))
    shown += slice.length
    updateMoreButton()
  }

  function updateMoreButton() {
    moreWrap.replaceChildren()
    const remaining = rows.length - shown
    const canPage = remaining > 0 || monthIdx < months.length
    if (!canPage) return
    const label = remaining > 0
      ? `Show more (${remaining} loaded)`
      : `Load older boosts (${months[monthIdx].month})`
    const btn = h('button', { class: 'pcast-showmore', type: 'button' }, label)
    btn.addEventListener('click', async () => {
      if (remaining > 0) { paintMore(); return }
      btn.disabled = true
      btn.textContent = 'Loading…'
      const got = await pullOlder()
      if (got) paintMore()
      else updateMoreButton()
    })
    moreWrap.appendChild(btn)
  }

  list.replaceChildren(cards, moreWrap)

  if (!rows.length) {
    // Nothing in the recent page — go looking before declaring it empty.
    const spinner = h('div', { class: 'feed-placeholder' }, [
      h('strong', { text: 'Looking further back…' }),
      ' No matches in the most recent boosts, checking the archives.',
    ])
    list.replaceChildren(spinner)
    const got = await pullOlder()
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
    // Deliberately "N+" while archives remain unread — the number is what
    // we've loaded, not the feed's total, and claiming otherwise would be a
    // lie that shrinks as you page.
    const more = monthIdx < months.length ? '+' : ''
    count.textContent = `${rows.length}${more} boost${rows.length === 1 ? '' : 's'}`
    count.hidden = false
  }
}
