/* Client hydration for /booster/<npub>.
 *
 * The page is server-rendered (functions/booster/[npub].js) and readable with no
 * JavaScript at all. This module adds:
 *
 *   - the shared detail-page chrome (back link, section deep-links, the hash
 *     spy, copy-npub, "Show N more", the art2 fallback, share) — all of it in
 *     detail-page.js, shared with /show and /episode
 *   - the bio's More control, via show-desc.js, unchanged from /show
 *   - the header's own Primal backfill, which is NOT hydrateProfiles(); see below
 *   - the SHARED backfill over #boosts, which is hydrateProfiles(); see the foot
 *   - the Shows and Albums drawer's range and sort, which need no fetch
 *   - the verbs on "Episodes and Songs Boosted"
 *
 * ⚠️ THAT LAST SECTION USED TO BE THE REASON THIS FILE WAS NOT SMALL, exactly as
 * on /episode/<guid>, and it is now one call. Its rows are the full
 * Episodes-feed card, which existed only as JavaScript; the card is
 * `assets/js/episode-card.js` now and the Function renders it at the edge, so
 * `episode-section.js` attaches the controls and the verbs and nothing else.
 * That module is shared with the identical section on /episode/<guid>.
 */
import { copyText, showToast } from '/assets/js/copy-npub.js?v=ob-v99'
import { fetchProfiles } from '/assets/js/primal-profiles.js?v=ob-v99'
import { rangeControl, sortControl, rangeDays } from '/assets/js/feed-controls.js?v=ob-v99'
import { initEpisodeSection } from '/assets/js/episode-section.js?v=ob-v99'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, wireArt2, hydrateProfiles,
} from '/assets/js/detail-page.js?v=ob-v99'
import { initShowDesc } from '/assets/js/show-desc.js?v=ob-v99'
import { initBoostNoteActions } from '/assets/js/boost-note-actions.js?v=ob-v99'
import { initBoostSection } from '/assets/js/boost-section.js?v=ob-v99'

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

/* This person's whole boost history, fetched at most once.
 *
 * ⚠️ TWO SECTIONS ON THIS PAGE WANT THE SAME 2,000 ROWS: the Episodes and Songs
 * rollup below, which groups them by episode, and #boosts at the foot, which
 * orders them as notes. They are lazy and gesture-gated independently, so a
 * reader who uses both would otherwise make the same request twice — and the
 * response carries this person's entire history, which on the heaviest booster in
 * the index is 975 rows. One promise, shared, and whichever section is touched
 * first pays for both.
 *
 * A failure is not cached: the promise is cleared so the other section, or a
 * second press, can try again rather than inheriting a rejection it never made.
 */
let corpusPromise = null
function boosterCorpus() {
  if (!corpusPromise) {
    corpusPromise = (async () => {
      const resp = await fetch(`/api/v1/boosters/${encodeURIComponent(NPUB)}?corpus=1`, {
        headers: { Accept: 'application/json' },
      })
      if (!resp.ok) throw new Error(`corpus: HTTP ${resp.status}`)
      return (await resp.json())?.corpus || {}
    })().catch((err) => { corpusPromise = null; throw err })
  }
  return corpusPromise
}

// ── Episodes and Songs ───────────────────────────────────────────────
//
// Everything this person has boosted at the episode level, painted as the
// Episodes feed's own card. Structurally the same section as
// #community-episodes on /episode/<guid> — same drawer, same controls, same
// cards — so both go through episode-section.js and this is a copy table.
//
// ⚠️ IT IS SERVER-RENDERED, as every other section on this page already was.
// The Function fetches the corpus, ranks it and paints the first thirty cards;
// everything here is verbs.
//
// TWO DIFFERENCES FROM THE TWIN. The figures are this person's own rather than
// community-scoped, so the sort is tagged plainly "Sort:". And it opens on Most
// sats rather than Most boosts: every card here is one person's giving to one
// episode and the median booster has two boosts in total, so a boost-count
// ranking is mostly ties.
//
// "Most boosters" is absent from the menu and that is not an omission: a card
// here aggregates ONE person's boosts, so the distinct-booster count is 1 on
// every row and sorting by it would be a no-op that looked like a ranking. Same
// reasoning that keeps it off the Boosts note feed.
initEpisodeSection({
  selector: '[data-booster-episodes]',
  prefix: 'be',
  sorts: [
    ['sats', 'Most Sats'],
    ['boosts', 'Most Boosts'],
    ['recent', 'Latest Boost'],
    ['episode', 'Latest Episode'],
  ],
  rankedSorts: new Set(['sats', 'boosts']),
  sortTag: 'Sort: ',
  sortTitle: 'Change how these episodes are ranked',
  fetchCorpus: async () => (await boosterCorpus()).boosts || [],
  // The cap is 2,000 against a measured heaviest booster of 975, so this line is
  // unreachable today. It is here because a ranking over a prefix must never
  // pose as a ranking over everything.
  truncatedNote:
    'Ranked over this booster\u2019s 2,000 most recent boosts. They have sent more than that, so an episode boosted only long ago may be missing.',
  emptyTitle: 'Nothing in this window',
  emptyBody: 'Nothing this booster sent sats to aired or was released in this time range \u2014 try a wider one.',
})

// ── Boosts Sent ──────────────────────────────────────────────────────
//
// The same section, the same module and the same controls as on /show and
// /episode. It opens on the newest 24 and holds this person's whole history once
// a control moves, over the corpus the rollup above already fetches.
const boostSection = initBoostSection({
  fetchCorpus: boosterCorpus,
  sortTitle: 'Sort the boosts this booster has sent',
  emptyText: 'This booster sent nothing in this time range \u2014 try a wider one.',
  // The cap is 2,000 against a measured heaviest booster of 975, so this line is
  // unreachable today. It is here because an order over a prefix must never pose
  // as an order over everything.
  truncatedNote:
    'Sorted over this booster\u2019s 2,000 most recent boosts. They have sent more than that, so an older boost may be missing.',
})

/* ── The Shows rollup is the show picker for #boosts ──────────────────
 *
 * "What did this person say about THIS show" is a different question from the
 * per-episode one #episodes answers, and it is the one a podcaster reading their
 * own boosters actually has. The filter itself lives on #boosts, where the range,
 * the sort and the message search already are and compose with it; what lives
 * here is only the way in.
 *
 * ⚠️ THE ROLLUP IS THE PICKER RATHER THAN A DROPDOWN ON THAT BAND, and the data
 * decided it. Sampled over 30 active boosters on 2026-08-16, the median has
 * boosted 10 distinct shows, the mean 27 and the heaviest 188. A menu of 188
 * entries is not a dropdown; this list already is one, ranked by what the person
 * gave, scrollable, carrying the artwork and its own range and sort. And the pick
 * happens where the question is asked — beside "40.1k sats across 38 episodes".
 *
 * ⚠️ /booster ONLY, and structurally so rather than by a flag. The picker is a
 * section no other page has, so /show and /episode never call setShow, never grow
 * a chip and pay nothing. A boost list about one show cannot be filtered by show.
 *
 * Delegated from the rollup rather than bound per row: the list can hold 188 of
 * them and booster-page.js#initShows hides and reveals rows as the range changes.
 */
function initShowFilterPicker() {
  // No band to put the chip on means no picker: below boost-list.js#CONTROLS_MIN
  // the server ships no controls at all, and a button leading to a filtered list
  // with no visible filter and no way to clear it is a trap.
  if (!boostSection?.canFilter) return
  const rollup = document.querySelector('[data-booster-shows]')
  if (!rollup) return

  const btns = rollup.querySelectorAll('[data-bs-show-filter]')
  // One show is the whole history, so filtering to it is a no-op that looks like
  // a control. Two is the first count at which the question has an answer.
  if (btns.length < 2) return
  for (const btn of btns) btn.hidden = false

  // No preventDefault and no stopPropagation: the button is a SIBLING of the
  // row's link rather than nested inside it, and type="button" submits nothing,
  // so there is no default to cancel and nothing above this listening.
  rollup.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-bs-show-filter]')
    if (!btn) return
    boostSection.setShow(btn.dataset.bsShowFilter, btn.dataset.bsShowLabel || '')
  })
}

initShowFilterPicker()

/* ── The Primal fallback over the boost list ──────────────────────────
 *
 * ⚠️ THIS PAGE WAS THE ONE MISSING IT. /show and /episode have called
 * hydrateProfiles() since they were written; /booster never imported it, so the
 * `nostr:` mentions inside its boost messages stayed as truncated npubs forever.
 * Measured on a real page before this landed: 16 mention chips, 11 of them
 * showing `@npub1cvcgs83gw…`, all 11 carrying the `data-pk` + `data-missing`
 * hook the server had correctly emitted, and nothing on the page reading it.
 * Primal answered all 6 distinct pubkeys behind them in 732ms — "jack mallers",
 * "Bowl After Bowl", "Local Bitcoiners". A 100% fill rate on content that was
 * rendering as gibberish.
 *
 * ⚠️ SCOPED TO #boosts, AND NOT document. An unscoped call would also match the
 * `.bs-mention` chip inside the BIO, which has its own patch path a few hundred
 * lines up (fillMention, selecting `.bs-mention[data-pk][data-missing]`).
 * hydrateProfiles does not know that chip's shape, so it would find nothing to
 * fill and then STRIP `data-missing` on its way out — and the header's own
 * backfill, racing it, would then select nothing and the bio mention would never
 * resolve. Fixing one gap by opening another.
 *
 * The other two regions are already covered and must not be double-handled:
 * #episodes goes through episode-section.js → hydrateCardProfiles, and #shows
 * carries no identities at all.
 *
 * Post-paint and best-effort, like every other use of it: the section is
 * complete and readable as rendered, this is one WebSocket to a cache with a 6s
 * timeout, and an unreachable Primal leaves the page exactly as it shipped.
 */
const boostsSection = document.getElementById('boosts')
if (boostsSection) hydrateProfiles(boostsSection)
