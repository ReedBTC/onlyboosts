/* Client hydration for /booster/<npub>.
 *
 * The page is server-rendered (functions/booster/[npub].js) and, with one stated
 * exception, readable with no JavaScript at all. This module adds:
 *
 *   - the shared detail-page chrome (back link, section deep-links, the hash
 *     spy, copy-npub, "Show N more", the art2 fallback, share) — all of it in
 *     detail-page.js, shared with /show and /episode
 *   - the bio's More control, via show-desc.js, unchanged from /show
 *   - the header's own Primal backfill, which is NOT hydrateProfiles(); see below
 *   - the Shows and Albums drawer's range and sort, which need no fetch
 *   - "Episodes and Songs Boosted", the one section the server does not render
 *
 * THAT SECTION IS THE REASON THIS FILE IS NOT SMALL, exactly as on
 * /episode/<guid>. Its rows are the full Episodes-feed card, so it is painted by
 * feeds-podcasts.js#episodeCard rather than by a second implementation that
 * would drift from the homepage's, and that module pulls nostr-tools, the boost
 * thread and the action bar behind it — roughly 200KB, DYNAMICALLY imported and
 * only when the section is about to be read.
 */
import { copyText, showToast } from '/assets/js/copy-npub.js?v=ob-v60'
import { fetchProfiles } from '/assets/js/primal-profiles.js?v=ob-v60'
import { rangeControl, sortControl, rangeDays, rangeCutoff } from '/assets/js/feed-controls.js?v=ob-v60'
import { normalizeBoosts, toEpisodeShape } from '/assets/js/ob-data.js?v=ob-v60'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v60'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, wireArt2,
} from '/assets/js/detail-page.js?v=ob-v60'
import { initShowDesc } from '/assets/js/show-desc.js?v=ob-v60'
import { initBoostNoteActions } from '/assets/js/boost-note-actions.js?v=ob-v60'

const PK = document.body.dataset.boosterPk || ''
const NPUB = document.body.dataset.boosterNpub || PK

// ── Shared detail-page chrome ─────────────────────────
//
// Identical on /show/<guid> and /episode/<guid>; see detail-page.js. No
// HASH_ALIASES: none of this page's three section ids has ever been renamed, and
// that map is a repair for a rename that already happened rather than a licence
// for the next one.
initCopyNpub()
initShowMore()
initShare()
initBackLink()
const revealHashTarget = initHashRouting()
initHashSpy()
initBoostNoteActions()

/* ⚠️ initShowDesc() RUNS EXACTLY ONCE PER PAGE, on whichever path supplies the
 * bio. Calling it twice is not harmless: each call closes over its own `btn` and
 * registers its own resize listener, so a second call on a bio that overflows
 * leaves two listeners racing to append two "More" controls the next time the
 * window is resized. The server path is here; the Primal path calls it inside
 * hydrateHeader() and only when this one did not fire. */
const bioWrap = document.querySelector('[data-show-desc]')
const bioServerRendered = Boolean(bioWrap) && !bioWrap.hidden
if (bioServerRendered) initShowDesc()

// The rows in the Shows drawer are other shows' artwork, so they hit exactly the
// case the art2 chain exists for. The hero's avatar and banner are handled below
// rather than here — neither carries a second URL, so what they need is a
// removal on failure rather than a swap.
initArt2('.cs-art[data-art2]', 'span', 'cs-art cs-art--blank')

// ── The hero's own image fallbacks ───────────────────────────────────
//
// Two images, two different failures. Both are hotlinked from a stranger's
// kind-0, so both are likelier to be dead than anything Podcast Index serves.
//
// wireArt2 with an empty chain is exactly "call this when the src fails", which
// is what both want; it also catches the case a deferred module cannot observe
// directly, where the image has already failed before this runs.
function initHeroArt() {
  const avatarImg = document.querySelector('[data-bs-avatar] img')
  if (avatarImg) {
    wireArt2(avatarImg, () => {
      // Back to the blank circle the server would have rendered.
      avatarImg.closest('[data-bs-avatar]')?.classList.add('is-blank')
      avatarImg.remove()
    })
  }

  // ⚠️ DIRECT CHILD, and it has to be. The avatar is positioned against the
  // banner, so it lives INSIDE [data-bs-banner] — a descendant selector here
  // matches the banner's own image first only while there IS one, and picks up
  // the AVATAR's image on the 57% of profiles with no banner. A dead avatar
  // would then take the banner's exit: image removed, strip marked blank, and
  // the face silently gone.
  const bannerImg = document.querySelector('[data-bs-banner] > img')
  if (bannerImg) {
    // The banner has no fallback and no placeholder worth showing: a broken
    // strip of wallpaper is worse than the flat tint the blank variant paints,
    // which is what every profile with no banner at all already gets.
    wireArt2(bannerImg, () => {
      const strip = bannerImg.closest('[data-bs-banner]')
      bannerImg.remove()
      strip?.classList.add('bs-banner--blank')
    })
  }
}

initHeroArt()

// ── The lightning address and LNURL chips ────────────────────────────
//
// Their own handler rather than the shared [data-copy-npub] one, which toasts
// "npub copied" — true of every other copy control on the site and false of
// these two. Delegated for symmetry with initCopyNpub, though there is at most
// one chip on the page.
document.addEventListener('click', async (e) => {
  const el = e.target.closest?.('[data-bs-copy]')
  if (!el) return
  e.preventDefault()
  const value = el.getAttribute('data-bs-copy')
  const label = el.getAttribute('data-bs-copy-label') || 'Copied'
  if (!value) return
  const ok = await copyText(value)
  showToast(ok ? `${label} copied` : 'Copy failed — clipboard blocked', !ok)
})

// ── The header's profile backfill ────────────────────────────────────
//
// ⚠️ NOT hydrateProfiles(), and the difference is the point. That function
// patches `.sup-name` / `.boost-who` / `.sup-avatar` inside a community card or
// a boost row, and it fills a name and a picture because those are the only two
// fields a card has. This header has five, and the two it adds — the bio and the
// lightning address — are the reason the page exists. So the lookup is the same
// (one Primal batch, post-paint, best-effort) and the patch is this page's own.
//
// It is worth doing rather than a nicety. 51 boosters in the index have no
// kind-0 the collector could resolve on any of the five profile relays, and one
// of them has 374 boosts and 97,300 sats; more commonly a booster's kind-0
// simply had not been fetched when the collector last ran. Primal's cache is a
// different source from those relays and answers a single pubkey in one round
// trip.
//
// Everything below runs POST-PAINT and changes nothing on failure: the header is
// complete and readable as rendered, and a visitor with no JavaScript keeps the
// shortened npub, the blank circle and no bio.
/* Bare URLs in a string → text nodes and anchors, appended to `el`.
 *
 * ⚠️ THIS IS THE PRIMAL PATH ONLY, AND IT IS DELIBERATELY POORER THAN THE
 * SERVER'S. renderBioText on the server resolves `nostr:` mentions into faces;
 * doing that here would need a bech32 decoder, and the only one on the client is
 * inside nostr-tools — 102KB pulled onto a page whose whole design is that it
 * reads without it, to serve the minority of profiles where D1 has no `about`
 * and Primal does. So a Primal-supplied bio gets its links and leaves any
 * mention as the raw npub text. Stated rather than hidden; if it ever matters,
 * the fix is a small standalone decoder, not the whole library.
 *
 * Nothing here touches innerHTML — a bio is a stranger's free text.
 */
const BIO_URL_RE = /https?:\/\/[^\s<>"']+/g
function paintBioText(el, text) {
  const src = String(text || '').slice(0, 2000)
  const frag = document.createDocumentFragment()
  let cursor = 0
  for (const m of src.matchAll(BIO_URL_RE)) {
    if (m.index > cursor) frag.appendChild(document.createTextNode(src.slice(cursor, m.index)))
    cursor = m.index + m[0].length
    // A trailing sentence period is punctuation, not part of the URL — the same
    // trim linkifyNotes makes on /episode.
    const raw = m[0].replace(/[.,;:)\]]+$/, '')
    const tail = m[0].slice(raw.length)
    let ok = false
    try { const u = new URL(raw); ok = u.protocol === 'http:' || u.protocol === 'https:' } catch { ok = false }
    if (ok) {
      const a = document.createElement('a')
      a.href = raw
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = raw.length > 60 ? raw.slice(0, 59) + '…' : raw
      frag.appendChild(a)
    } else {
      frag.appendChild(document.createTextNode(raw))
    }
    if (tail) frag.appendChild(document.createTextNode(tail))
  }
  frag.appendChild(document.createTextNode(src.slice(cursor)))
  el.replaceChildren(frag)
}

/* Fill a `nostr:` mention chip the server could not resolve.
 *
 * These are the COMMON case rather than the edge, which is why they ride the
 * same batch as the subject: a mentioned npub need never have boosted anything,
 * so most of them are in no table of ours at all.
 */
function fillMention(el, prof) {
  const missing = (el.getAttribute('data-missing') || '').split(' ')
  if (missing.includes('name') && prof.name) {
    const nameEl = el.querySelector('.bs-mention-name')
    if (nameEl) nameEl.textContent = '@' + prof.name
  }
  if (missing.includes('pic') && prof.picture) {
    const blank = el.querySelector('.bs-mention-pic.is-blank')
    if (blank) {
      const img = document.createElement('img')
      img.className = 'bs-mention-pic'
      img.alt = ''
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      // A dead hotlink returns the chip to the blank dot it already had.
      img.onerror = () => { img.replaceWith(blank) }
      img.src = prof.picture
      blank.replaceWith(img)
    }
  }
  el.removeAttribute('data-missing')
}

async function hydrateHeader() {
  const card = document.querySelector('.bs-card')
  if (!card) return

  // Two kinds of gap, one request. The subject's own fields are missing on the
  // 51 boosters with no kind-0 and on anyone the collector has not resolved yet;
  // the bio's mentions are missing far more often than that. Batching them means
  // a header with an unresolved subject AND three mentions costs one round trip.
  const subjectMissing = Boolean(PK) && card.hasAttribute('data-missing')
  const mentionEls = Array.from(card.querySelectorAll('.bs-mention[data-pk][data-missing]'))

  const want = new Set()
  if (subjectMissing) want.add(PK)
  for (const el of mentionEls) want.add(el.getAttribute('data-pk'))
  if (!want.size) return

  const found = await fetchProfiles([...want])
  if (!found.size) return

  for (const el of mentionEls) {
    const prof = found.get(el.getAttribute('data-pk'))
    if (prof) fillMention(el, prof)
  }

  if (!subjectMissing) return
  const prof = found.get(PK)
  if (!prof) return

  const missing = (card.getAttribute('data-missing') || '').split(' ')

  if (missing.includes('name') && prof.name) {
    const h1 = card.querySelector('[data-bs-name]')
    if (h1) h1.textContent = prof.name
    // The <title> and the share card were built from the npub server-side and
    // are deliberately left alone: og:* is read by crawlers that never run this,
    // so changing the document title here would make the tab disagree with the
    // link preview for no reader's benefit.
  }

  if (missing.includes('pic') && prof.picture) {
    const wrap = card.querySelector('[data-bs-avatar]')
    if (wrap && !wrap.querySelector('img')) {
      const img = document.createElement('img')
      img.alt = ''
      img.width = 120
      img.height = 120
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      // A dead hotlink returns the header to the blank circle it already had.
      img.onerror = () => { img.remove(); wrap.classList.add('is-blank') }
      img.src = prof.picture
      wrap.classList.remove('is-blank')
      wrap.appendChild(img)
    }
  }

  // `about` is read defensively: a reader holding a cached copy of
  // primal-profiles.js from before this field was added sees `undefined`, which
  // is the whole reason a new FIELD is safe where a new named export is not.
  if (missing.includes('about') && prof.about) {
    const wrap = card.querySelector('[data-show-desc]')
    const body = card.querySelector('[data-bs-about]')
    if (wrap && body) {
      // Links, but no mention faces — see the note over paintBioText.
      paintBioText(body, prof.about)
      wrap.hidden = false
      // The one call on this path. It did not run at load, because there was no
      // bio to clamp; now there is. See the note beside the server-path call.
      if (!bioServerRendered) initShowDesc()
    }
  }

  if (missing.includes('lud16') && (prof.lud16 || prof.lud06)) {
    const slot = card.querySelector('[data-bs-contact]')
    if (slot) {
      const value = prof.lud16 || prof.lud06
      const isAddr = Boolean(prof.lud16)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'bs-chip'
      btn.setAttribute('data-bs-copy', value)
      btn.setAttribute('data-bs-copy-label', isAddr ? 'Lightning address' : 'LNURL')
      btn.title = isAddr ? 'Copy lightning address' : 'Copy LNURL'
      const glyph = document.createElement('span')
      glyph.className = 'bs-chip-glyph'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.textContent = '⚡'
      btn.append(glyph, document.createTextNode(
        isAddr ? String(value).slice(0, 44) : 'Copy LNURL'))
      // Prepended: the lightning address leads the row wherever both chips are
      // present, which is the order the server renders too.
      slot.prepend(btn)
      slot.hidden = false
    }
  }

  card.removeAttribute('data-missing')
}

hydrateHeader()

// ── Shows and Albums ─────────────────────────────────────────────────
//
// ⚠️ NO FETCH, EVER. Every row shipped four windows of figures packed into one
// `data-bs` attribute (see showRow in functions/booster/[npub].js), so a range
// change and a re-sort are both a re-read of an attribute, a re-order of nodes
// already in the DOM, and a relabel of the meta line. The show page's community
// drawer does the same thing for one window and a sort; this is that pattern
// with the range added, which is affordable only because a booster's whole
// history is one bounded set the server can aggregate in a single pass.
//
// ⚠️ THE META LINE IS RELABELLED ON EVERY REPAINT, unlike the show page's, whose
// text is fixed at render time. The figures on a row are the SELECTED WINDOW's,
// so a row reading "12 boosts" under 1W and "418 boosts" under All is the same
// row telling the truth twice. Leaving the server's all-time text in place while
// the ranking moved would be the worst of both.
//
// THE RANGE IS BOOST TIME, which is the same axis /api/v1/podcasts uses and the
// opposite of the Episodes rollup below it. A show is in the 1W view because
// this person boosted it this week; an episode is in the 1W view because it
// AIRED this week. Both are deliberate; see the warning in CLAUDE.md against
// unifying them.
const SHOW_SORTS = [
  ['boosts', 'Most Boosts'],
  ['sats', 'Most Sats'],
  ['eps', 'Most Episodes'],
  ['recent', 'Recently Boosted'],
]

// Offsets into the packed attribute, by range key. Three figures per window, in
// RANGE_OPTIONS order, then the latest timestamp at 12.
const WINDOW_AT = { '1w': 0, '1m': 3, '1y': 6, all: 9 }
const LATEST_AT = 12

function initShows() {
  const root = document.querySelector('[data-booster-shows]')
  if (!root) return
  const list = root.querySelector('[data-bs-shows-list]')
  const slot = root.querySelector('[data-bs-shows-controls]')
  const emptyEl = root.querySelector('[data-bs-shows-empty]')
  if (!list || !slot) return

  const rows = Array.from(list.querySelectorAll('.cs-row')).map((el) => ({
    el,
    rankEl: el.querySelector('.cs-rank'),
    metaEl: el.querySelector('[data-bs-meta]'),
    nums: String(el.dataset.bs || '').split(',').map(Number),
  }))
  // ⚠️ NO `rows.length < 2` GUARD, deliberately, and it is a divergence from
  // initEpisodeSort on /show. 36.3% of boosters in the index have exactly one
  // boost, so a one-row drawer is not an edge case here — it is over a third of
  // every page of this type. A control that disappears on a third of pages is a
  // worse rule than one that is always there, and the range control is still
  // meaningful on a single row: it answers whether that boost was this week.
  if (!rows.length) return

  let sort = 'boosts'
  let range = 'all'

  const figure = (r, i) => r.nums[WINDOW_AT[range] + i] || 0
  const boostsOf = (r) => figure(r, 0)
  const satsOf = (r) => figure(r, 1)
  const epsOf = (r) => figure(r, 2)
  const latestOf = (r) => r.nums[LATEST_AT] || 0

  function fmtSats(n) {
    const v = Number(n || 0)
    if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B'
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
    if (v >= 1e4) return Math.round(v / 1e3) + 'k'
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
    return String(v)
  }
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

  function paint() {
    // A row with no boosts inside the window is not in the window. That is the
    // filter, and it is why the packed figures carry a boost count per window
    // rather than only sats: a zero-sat boost is still a boost.
    const inWindow = range === 'all' ? rows : rows.filter((r) => boostsOf(r) > 0)

    const keep = new Set(inWindow)
    for (const r of rows) r.el.hidden = !keep.has(r)

    if (!inWindow.length) {
      if (emptyEl) {
        emptyEl.textContent = `Nothing boosted in the last ${rangeDays(range)} days — try a wider range.`
        emptyEl.hidden = false
      }
      return
    }
    if (emptyEl) emptyEl.hidden = true

    const order = inWindow.slice().sort((a, b) => {
      if (sort === 'sats') return satsOf(b) - satsOf(a) || boostsOf(b) - boostsOf(a)
      if (sort === 'eps') return epsOf(b) - epsOf(a) || satsOf(b) - satsOf(a)
      if (sort === 'recent') return latestOf(b) - latestOf(a) || satsOf(b) - satsOf(a)
      return boostsOf(b) - boostsOf(a) || satsOf(b) - satsOf(a)
    })

    const frag = document.createDocumentFragment()
    order.forEach((r, i) => {
      // Rank is recomputed per view rather than retained. That differs from the
      // feeds' search contract, where filtering to one row has to preserve its
      // standing in the full list; here the range IS the list, so a row's
      // position under the current view is its rank.
      if (r.rankEl) r.rankEl.textContent = String(i + 1)
      if (r.metaEl) {
        r.metaEl.textContent =
          `${plural(boostsOf(r), 'boost', 'boosts')} · ${fmtSats(satsOf(r))} sats · ` +
          `${plural(epsOf(r), 'episode', 'episodes')}`
      }
      frag.appendChild(r.el)
    })
    list.appendChild(frag)
  }

  slot.append(
    rangeControl(range, (key) => { if (key !== range) { range = key; paint() } }, {
      label: 'Filter by when the show was boosted',
      titleFor: (key, label) => (rangeDays(key) ? `Boosted in the last ${rangeDays(key)} days` : label),
    }),
    sortControl(SHOW_SORTS, sort, (key) => { if (key !== sort) { sort = key; paint() } }, {
      tag: 'Sort: ',
      title: 'Change how these shows are ranked',
    }),
  )
  slot.hidden = false
  paint()
}

initShows()

// ── Episodes and Songs ───────────────────────────────────────────────
//
// The same section as #community-episodes on /episode/<guid>, with a different
// corpus behind it: every boost this one person has sent, rather than every
// boost their community has. Structurally it is that section — the observer, the
// lazy card renderer, the range and sort, the scroll container and the load-more
// inside it — so see the notes over initCommunityEpisodes in episode-page.js for
// why each piece is shaped the way it is.
//
// One difference worth naming: the figures here are NOT community-scoped, they
// are this person's own. So the sort is tagged plainly "Sort:" rather than
// "Community Sort:" — a card's boosts and sats are what this booster sent that
// episode, which is exactly what the section claims.

const CARDS_PER_PAGE = 30

const EP_SORTS = [
  ['sats', 'Most Sats'],
  ['boosts', 'Most Boosts'],
  ['recent', 'Latest Boost'],
  ['episode', 'Latest Episode'],
]

/* The comparators, and why they are here rather than imported.
 *
 * These are the Episodes feed's own, and the feed stopped exporting them when
 * its ranking moved into /api/v1/episodes — for the reason that it PAGES, so its
 * loaded rows are a prefix of the corpus and ranking them in the browser ranks
 * the wrong things. This section holds its WHOLE corpus, one bounded response
 * fetched once, so ranking it in memory ranks everything it has and a re-sort
 * costs no round trip. episode-page.js carries the same copies for the same
 * reason; the two feeds' cases are genuinely different and one shared export
 * would have to serve both.
 *
 * "Most boosters" is absent from the menu above and that is not an omission: a
 * card here aggregates ONE person's boosts, so the distinct-booster count is 1
 * on every row and sorting by it would be a no-op that looked like a ranking.
 * That is the same reasoning that keeps it off the Boosts note feed.
 */
const bySats = (a, b) => b.totalSats - a.totalSats || b.latest - a.latest
const SORTERS = {
  recent: (a, b) => b.latest - a.latest || b.totalSats - a.totalSats,
  episode: (a, b) => (b.ep.published || 0) - (a.ep.published || 0) || bySats(a, b),
  boosts: (a, b) => b.boosts.length - a.boosts.length || bySats(a, b),
  sats: bySats,
}
const RANKED = new Set(['sats', 'boosts'])

function sortItems(items, key) {
  return [...items].sort(SORTERS[key] || SORTERS.sats)
}

// The range filters on when the episode AIRED, the same axis the Episodes feed
// uses — and the opposite of the Shows drawer above, whose range is boost time.
// Both are deliberate.
function filterItems(items, key) {
  const cutoff = rangeCutoff(key)
  if (!cutoff) return items
  return items.filter((it) => (it.ep.published || 0) >= cutoff)
}

function whenApproached(el, run) {
  if (typeof IntersectionObserver !== 'function') { run(); return }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    io.disconnect()
    run()
  }, { rootMargin: '800px 0px' })
  io.observe(el)
}

async function fetchCorpus() {
  const resp = await fetch(`/api/v1/boosters/${encodeURIComponent(NPUB)}?corpus=1`, {
    headers: { Accept: 'application/json' },
  })
  if (!resp.ok) throw new Error(`corpus: HTTP ${resp.status}`)
  return resp.json()
}

function initEpisodes() {
  const section = document.querySelector('[data-booster-episodes]')
  if (!section || !PK) return

  const body = section.querySelector('[data-be-body]')
  const scroll = section.querySelector('[data-be-scroll]')
  const listSlot = section.querySelector('[data-be-list]')
  const moreSlot = section.querySelector('[data-be-more]')
  const ctrlSlot = section.querySelector('[data-be-controls]')
  if (!body || !scroll || !listSlot || !moreSlot || !ctrlSlot) return

  // An empty heading over nothing is worse than no heading, and this can
  // legitimately be empty: a booster whose every boost carries no item guid has
  // no episode-level history at all. A failed fetch takes the same exit — the
  // rest of the page is complete without this.
  const giveUp = () => { section.remove() }

  whenApproached(section, async () => {
    // Revealed before the fetch: the heading and its "Loading…" line are the
    // feedback that something is coming.
    body.hidden = false

    let data
    try {
      data = await fetchCorpus()
    } catch (err) {
      console.warn('[booster] episode corpus unavailable', err)
      giveUp()
      return
    }

    const rows = normalizeBoosts({ boosts: data?.corpus?.boosts || [] })
    if (!rows.length) { giveUp(); return }

    const feed = await import('/assets/js/feeds-podcasts.js?v=ob-v60')
    const shaped = toEpisodeShape(rows)
    feed.seedProfiles(shaped.profiles)
    const items = feed.buildEpisodes(shaped)
    if (!items.length) { giveUp(); return }

    const profilesReady = feed.loadBoosterProfiles(items)
    feed.loadMentionProfiles(items)

    // Sats rather than the feed's own "most boosts" default. On this page every
    // card is one person's giving to one episode, and the median booster has two
    // boosts total, so a boost-count ranking is mostly ties; sats is the axis
    // that actually orders a single person's history.
    let sortKey = 'sats'
    let rangeKey = 'all'
    let view = []
    let shown = 0

    const cards = document.createElement('div')
    cards.className = 'pcast-list'
    const moreWrap = document.createElement('div')
    moreWrap.className = 'pcast-more-wrap'

    function renderMore() {
      const next = view.slice(shown, shown + CARDS_PER_PAGE)
      for (const it of next) {
        const ranked = RANKED.has(sortKey) ? it._rank : null
        const el = feed.episodeCard(it, ranked, feed.COPY.other)
        el._pcastItem = it   // repaintProfiles maps avatars through this
        cards.appendChild(el)
      }
      shown += next.length
      moreWrap.textContent = ''
      const remaining = view.length - shown
      if (remaining > 0) {
        const batch = Math.min(CARDS_PER_PAGE, remaining)
        const group = document.createElement('div')
        group.className = 'pcast-more-group'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'pcast-showmore'
        btn.textContent = `Load ${batch} more`
        btn.addEventListener('click', renderMore)
        const count = document.createElement('div')
        count.className = 'pcast-more-count'
        count.textContent = `Showing ${shown} of ${view.length}`
        group.append(btn, count)
        moreWrap.appendChild(group)
      } else if (data?.corpus?.truncated) {
        // Only at the end of the list, where it is an answer rather than a
        // warning. The cap is 2,000 boosts against a measured heaviest booster
        // of 975, so this line is unreachable today and is here because a
        // ranking over a prefix must never pose as a ranking over everything.
        const note = document.createElement('p')
        note.className = 'ce-note'
        note.textContent =
          'Ranked over this booster’s 2,000 most recent boosts. They have sent more than that, so an episode boosted only long ago may be missing.'
        moreWrap.appendChild(note)
      }
    }

    // Rank first, filter second — the ordering the feeds' search contract
    // depends on. There is no search here, but the range filter is the same
    // narrowing: rank over everything in the window, then paint.
    function rebuild() {
      view = sortItems(filterItems(items, rangeKey), sortKey)
      view.forEach((it, i) => { it._rank = i + 1 })
      shown = 0
      cards.textContent = ''
      moreWrap.textContent = ''
      if (!view.length) {
        const empty = document.createElement('div')
        empty.className = 'feed-placeholder'
        const strong = document.createElement('strong')
        strong.textContent = 'Nothing in this window'
        empty.append(strong, document.createTextNode(
          'Nothing this booster has boosted aired or was released in this time range — try a wider one.'))
        cards.appendChild(empty)
        return
      }
      // Back to the top of the window, not of the page: a re-sort replaces the
      // list under the reader, and leaving the box scrolled halfway would land
      // them mid-ranking with #1 out of sight above.
      scroll.scrollTop = 0
      renderMore()
      feed.repaintProfiles(cards)
    }

    ctrlSlot.append(
      rangeControl(rangeKey, (key) => { if (key !== rangeKey) { rangeKey = key; rebuild() } }, {
        label: 'Filter by air or release date',
        titleFor: (key, label) => (rangeDays(key)
          ? `Aired or released in the last ${rangeDays(key)} days`
          : label),
      }),
      sortControl(EP_SORTS, sortKey, (key) => { if (key !== sortKey) { sortKey = key; rebuild() } }, {
        tag: 'Sort: ',
        title: 'Change how these episodes are ranked',
      }),
    )
    ctrlSlot.hidden = false

    listSlot.textContent = ''
    listSlot.appendChild(cards)
    moreSlot.appendChild(moreWrap)
    rebuild()

    // The section was an empty zero-height block when the browser resolved the
    // URL, so an anchor pointing at it parked on whatever followed. Now that it
    // has a height, put the reader where they asked to be.
    if (location.hash === '#episodes') {
      revealHashTarget()
      section.scrollIntoView()
    }

    profilesReady.then(() => feed.repaintProfiles(cards))

    // Wire the shared reply / repost / like / zap actions once the widget is up,
    // so the boost notes inside an opened drawer work. Deferred: nothing on
    // screen needs it yet.
    setTimeout(async () => {
      try {
        const actions = await import('/assets/js/boost-actions.js?v=ob-v60')
        await ensureLoginWidget()
        actions.configureBoostActions({})
      } catch { /* the cards still read; only the action bars stay inert */ }
    }, 1200)
  })
}

initEpisodes()
