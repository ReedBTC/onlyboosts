/* The verbs on an artist card — the other half of publisher-card.js.
 *
 * The show card's seam, one tier up, and deliberately its own module rather
 * than a switch inside show-card-actions.js: an artist card and a show card
 * are different objects with different hooks. Three verbs, no money path:
 *
 *   artwork fallback     the error path needs a listener the string cannot carry
 *   the last-boost line  the absolute date is the fact; "3d ago" is a reading
 *   the drawer's rows    the album list fetches on first open
 *
 * No boost pill — see the header of publisher-card.js for why that is a
 * decision and not a gap.
 */
import { wireArt2 } from '/assets/js/detail-page.js?v=ob-v167'
import { getPublisherAlbums, getPublisherAlbumsFollows } from '/assets/js/ob-live.js?v=ob-v167'
import { COPY, albumRowsHtml } from '/assets/js/publisher-card.js?v=ob-v167'
import { num } from '/assets/js/show-card.js?v=ob-v167'

/**
 * Wire every artist card under `root` that isn't wired already. Idempotent by
 * the same marker attribute wireShowCards uses, and safe on a root with no
 * cards, so every caller calls it unconditionally.
 */
export function wirePublisherCards(root) {
  const cards = Array.from(root?.querySelectorAll?.('[data-publisher-card]:not([data-wired])') || [])
  if (!cards.length) return
  for (const card of cards) {
    card.setAttribute('data-wired', '')
    try { wireCard(card) } catch (err) {
      // One malformed card must not cost the rest their verbs.
      console.warn('[publisher-card] wiring failed', err)
    }
  }
}

function wireCard(card) {
  wireArtwork(card)
  wireLatest(card)
  wireDrawer(card)
}

function wireArtwork(card) {
  const img = card.querySelector('.pcast-card-media img')
  if (!img) return
  const media = img.closest('.pcast-card-media')
  wireArt2(img, () => {
    img.remove()
    media?.classList.add('pcast-card-media--none')
    media?.appendChild(document.createTextNode(COPY.glyph))
  })
}

// Identical mechanics and thresholds to show-card-actions.js#wireLatest, and
// identical on purpose: the two cards sit in adjacent feeds and must read the
// same. Past a month the absolute date the string rendered is the better answer.
function wireLatest(card) {
  const el = card.querySelector('.ob-show-latest[data-latest-ts]')
  if (!el) return
  const ts = num(el.getAttribute('data-latest-ts'))
  if (!ts) return
  const rel = relTime(ts)
  if (rel) el.textContent = `last boost ${rel}`
}

function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  return ''
}

/* Fill on first open.
 *
 * ⚠️ THE WINDOW IS READ AT OPEN TIME, NOT AT WIRE TIME — the show drawer's
 * rule, for the show drawer's reason: the rows are scoped to the same range
 * the card's figures were computed over, and the feed writes the active
 * cutoff onto the list container as `data-since`, changing it in place. A
 * failure resets the marker so collapsing and reopening retries. */
function wireDrawer(card) {
  const details = card.querySelector('details.pcast-card-details')
  const body = details?.querySelector('[data-lazy-albums]')
  if (!details || !body) return

  let loaded = false
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return
    loaded = true

    const guid = card.getAttribute('data-guid')
    const status = body.querySelector('[data-drawer-status]')
    const listEl = card.closest('[data-artist-list]')
    const since = num(listEl?.getAttribute('data-since')) || null
    // The follows set rides the container as a JS property — the show
    // drawer's arrangement, one tier up; see show-card-actions.js.
    const follows = Array.isArray(listEl?.obFollows) && listEl.obFollows.length ? listEl.obFollows : null

    try {
      const albums = follows
        ? await getPublisherAlbumsFollows({ guid, follows, since })
        : (await getPublisherAlbums({ guid, since })).albums
      status?.remove()
      body.insertAdjacentHTML('afterbegin', albumRowsHtml(albums, COPY))
    } catch (err) {
      console.warn('[publisher-card] album load failed', guid, err)
      loaded = false
      if (status) status.textContent = COPY.drawerFail
    }
  })
}
