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
import { copyText, showToast } from '/assets/js/copy-npub.js?v=ob-v260'
import { fetchProfiles } from '/assets/js/primal-profiles.js?v=ob-v260'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, wireArt2, hydrateProfiles, initStatWindows,
} from '/assets/js/detail-page.js?v=ob-v260'
import { initShowDesc } from '/assets/js/show-desc.js?v=ob-v260'
import { initBoostNoteActions } from '/assets/js/boost-note-actions.js?v=ob-v260'
import { initBoostSection } from '/assets/js/boost-section.js?v=ob-v260'
import { initFavoritesSection } from '/assets/js/favorites-section.js?v=ob-v260'
import { feedGuidsOf } from '/assets/js/favorites-ui.js?v=ob-v260'
import { recommendRailsHtml } from '/assets/js/recommend-rails.js?v=ob-v260'

const PK = document.body.dataset.boosterPk || ''
const NPUB = document.body.dataset.boosterNpub || PK

// ── Shared detail-page chrome ─────────────────────────
//
// Identical on /show/<guid> and /episode/<guid>; see detail-page.js.
// HASH_ALIASES: #shows and #episodes were the two rollups until 2026-11-07
// (Reed's call: #boosts answers both, with its By show menu and a search that
// reads the titles); the ids are in the wild, so each lands on the list. The
// map is a repair for a rename that already happened, never a licence for the
// next one.
const HASH_ALIASES = { shows: 'boosts', episodes: 'boosts' }
initCopyNpub()
initShowMore()
initShare()
initBackLink()
const revealHashTarget = initHashRouting(HASH_ALIASES)
initHashSpy()
initStatWindows()
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

/* This person's whole boost history, fetched at most once.
 *
 * One consumer since 2026-11-07, #boosts at the foot (the Episodes and Songs
 * rollup shared it until then); the promise stays memoised because every
 * control on that band (the By show menu, the search, the range, the sort)
 * asks for it, and the response is this person's entire history, 975 rows on
 * the heaviest booster in the index.
 *
 * A failure is not cached: the promise is cleared so a second press can try
 * again rather than inheriting a rejection it never made.
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

// ── Boosts Sent ──────────────────────────────────────────────────────
//
// The same section, the same module and the same controls as on /show and
// /episode. It opens on the newest 24 and holds this person's whole history once
// a control moves, over the corpus the rollup above already fetches.
initBoostSection({
  fetchCorpus: boosterCorpus,
  /* THIS PAGE ONLY (2026-11-07, Reed's ask, with the two rollups removed):
   * the band gains a By show menu, every show this person has boosted by how
   * often, and the search reads the show and episode titles beside the
   * message, so "what did this person send to X" is answered here. /show and
   * /episode keep neither: every row there is the same show, so a show menu
   * is a no-op and a title match returns everything (boost-list.js). */
  showMenu: true,
  searchFields: ['message', 'p_title', 'e_title'],
  searchPlaceholder: 'Search messages, shows and episodes…',
  sortTitle: 'Sort the boosts this booster has sent',
  emptyText: 'This booster sent nothing in this time range \u2014 try a wider one.',
  // The cap is 2,000 against a measured heaviest booster of 975, so this line is
  // unreachable today. It is here because an order over a prefix must never pose
  // as an order over everything.
  truncatedNote:
    'Sorted over this booster\u2019s 2,000 most recent boosts. They have sent more than that, so an older boost may be missing.',
})

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
 * The recommendation rails above carry no identities at all.
 *
 * Post-paint and best-effort, like every other use of it: the section is
 * complete and readable as rendered, this is one WebSocket to a cache with a 6s
 * timeout, and an unreachable Primal leaves the page exactly as it shipped.
 */
const boostsSection = document.getElementById('boosts')
if (boostsSection) hydrateProfiles(boostsSection)

// The Favorites section (docs/favorites.md): the member's kind-10333 list,
// read off the relays and resolved through /api/v1/favorites/resolve.
//
// ⚠️ THE RECOMMENDATION RAILS FOLLOW IT (2026-11-07). The Function renders
// #recommended off the member's boosts alone (the list is a Nostr event only
// the browser reads); once this section has read the list, its feeds go to
// /api/v1/recommend as favorites and the rails are repainted with the same
// two-sided recommendRailsHtml the edge used, so a followed show leaves the
// rails and starts seeding them. The public half for any viewer, the private
// half too when the viewer is the member. A section the edge omitted (no
// recommendations off the boosts) is created after Favorites when the list
// produces some. Allowed to fail: the edge's rails stay.
initFavoritesSection({
  pubkey: PK,
  root: document.querySelector('[data-booster-favorites]'),
  onEntries: (entries, { owner } = {}) => { repaintRecommended(feedGuidsOf(entries), !!owner).catch((err) => console.warn('[booster] recommend', err)) },
})

// For the OWNER the rails carry the homepage's hooks and carrot (2026-11-08,
// Reed's ask): an empty side says what makes a seed, and a rail under them
// says what is still missing (recommend-rails.js#CARROT). A visitor to
// another member's page sees the rails alone, as the edge rendered them.
async function repaintRecommended(favorites, owner = false) {
  if (!favorites.length && !owner) return
  const resp = await fetch('/api/v1/recommend', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ pubkey: PK, ...(favorites.length ? { favorites } : {}), limit: 20 }),
  })
  if (!resp.ok) throw new Error(`recommend: HTTP ${resp.status}`)
  const rails = recommendRailsHtml(await resp.json(), { owner, feeds: favorites })
  let section = document.querySelector('[data-booster-recommended]')
  if (!rails) { section?.remove(); return }
  if (!section) {
    section = document.createElement('section')
    section.className = 'show-section show-section--bare'
    section.id = 'recommended'
    section.dataset.boosterRecommended = ''
    section.innerHTML = '<div class="bs-rails"></div>'
    const fav = document.querySelector('[data-booster-favorites]')
    if (fav) fav.after(section); else return
  }
  section.querySelector('.bs-rails').innerHTML = rails
  wireRailArt(section)
}

// The carrot's Import OPML button opens the panel (favorites-ui.js is loaded
// by nav.js lazily; ask for it if it has not arrived).
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-opml-import]')
  if (!b) return
  e.preventDefault()
  if (!window.OBFavorites) await import('/assets/js/favorites-ui.js?v=ob-v260').catch(() => null)
  window.OBFavorites?.importOpml?.()
})

/* A rail tile's artwork falls back like the homepage's (discover.js#wireArt):
 * the art2 chain, then a glyph in place of the image. Run over the edge's
 * rails at boot and over every repaint. */
function wireRailArt(root) {
  for (const img of root.querySelectorAll('.rt-media img:not([data-art-wired])')) {
    img.dataset.artWired = '1'
    const media = img.closest('.rt-media')
    wireArt2(img, () => {
      if (!media) return
      media.classList.add('rt-media--none')
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'rt-glyph', textContent: '🎙' }))
    })
  }
}
wireRailArt(document)
