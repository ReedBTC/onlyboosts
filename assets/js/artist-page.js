/* Client hydration for /artist/<guid>.
 *
 * The page is server-rendered (functions/artist/[guid].js) and readable with
 * no JavaScript at all. This module adds the shared detail-page chrome, the
 * bio's More control, the artwork fallbacks, and the two drawers' sorts —
 * both of which are re-orders of nodes already in the DOM, never fetches,
 * because every row ships its figures packed in one attribute.
 *
 * No boost BUTTON — the page-wide decision — but the wall and #boosts are
 * here, so the page carries the shared boost-section machinery, the note
 * verbs, and the Primal backfill like its three siblings.
 */
import { sortControl } from '/assets/js/feed-controls.js?v=ob-v175'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, hydrateProfiles,
} from '/assets/js/detail-page.js?v=ob-v175'
import { initShowDesc } from '/assets/js/show-desc.js?v=ob-v175'
import { initBoostNoteActions } from '/assets/js/boost-note-actions.js?v=ob-v175'
import { initBoostSection } from '/assets/js/boost-section.js?v=ob-v175'

const GUID = document.body.dataset.artistGuid || ''

// ── Shared detail-page chrome ─────────────────────────
// Identical on the other three pages; see detail-page.js. No HASH_ALIASES:
// nothing here has ever been renamed.
initCopyNpub()
initShowMore()
initShare()
initBackLink()
initHashRouting()
initHashSpy()
initShowDesc()
initBoostNoteActions()

// The hero, the album rows and the community rows all carry another feed's
// artwork, so all three ride the art2 chain.
initArt2('.show-art img', 'div', 'show-art-blank')
initArt2('.ep-art[data-art2]', 'span', 'ep-art ep-art--blank')
initArt2('.cs-art[data-art2]', 'span', 'cs-art cs-art--blank')

// ── The albums drawer's sort ──────────────────────────────────────────
// The show page's episode-drawer arrangement: every row packs its four axes
// in `data-al`, so a sort is a re-order. "Most Sats" reproduces the server's
// own ORDER BY, so the first paint and the first sort agree.
const AL_SORTS = [
  ['sats', 'Most Sats'],
  ['boosters', 'Most Boosters'],
  ['boosts', 'Most Boosts'],
  ['latest', 'Recently Boosted'],
]

function initAlbumSort() {
  // Two drawers can carry the attribute now — #albums and, on an artist who
  // also declares podcasts, #shows. Each gets its own control over its own
  // rows; the partition never re-merges.
  document.querySelectorAll('[data-artist-albums]').forEach(initOneAlbumDrawer)
}

function initOneAlbumDrawer(root) {
  const list = root.querySelector('[data-al-list]')
  const slot = root.querySelector('[data-al-controls]')
  if (!list || !slot) return

  const rows = Array.from(list.querySelectorAll('.ep-row')).map((el) => {
    const [boosters, boosts, sats, latest] = String(el.dataset.al || '').split(',').map(Number)
    return { el, boosters: boosters || 0, boosts: boosts || 0, sats: sats || 0, latest: latest || 0 }
  })
  // One row needs no ordering, and a control that cannot change anything is
  // noise — the same rule the community sort applies below.
  if (rows.length < 2) return

  function paint(sort) {
    const order = rows.slice().sort((a, b) => {
      if (sort === 'boosters') return b.boosters - a.boosters || b.sats - a.sats
      if (sort === 'boosts') return b.boosts - a.boosts || b.sats - a.sats
      if (sort === 'latest') return b.latest - a.latest || b.sats - a.sats
      return b.sats - a.sats || b.boosts - a.boosts
    })
    const frag = document.createDocumentFragment()
    order.forEach((r) => frag.appendChild(r.el))
    list.appendChild(frag)
  }

  slot.appendChild(sortControl(AL_SORTS, 'sats', (key) => paint(key), {
    title: 'Change how these albums are ranked',
  }))
  slot.hidden = false
}
initAlbumSort()

// ── The community drawer's sort ───────────────────────────────────────
// The show page's community sort verbatim, over artists instead of shows.
// Rank is recomputed per sort rather than retained: the list is never
// filtered, so a row's position under the current sort IS its rank.
const CS_SORTS = [
  ['members', 'Most Boosters'],
  ['boosts', 'Most Boosts'],
  ['sats', 'Most Sats'],
]

function initCommunityArtists() {
  const root = document.querySelector('[data-community-artists]')
  if (!root) return
  const list = root.querySelector('[data-cs-list]')
  const slot = root.querySelector('[data-cs-controls]')
  if (!list || !slot) return

  const rows = Array.from(list.querySelectorAll('.cs-row')).map((el) => {
    const [boosts, sats, members] = String(el.dataset.cs || '').split(',').map(Number)
    return {
      el,
      rankEl: el.querySelector('.cs-rank'),
      boosts: boosts || 0,
      sats: sats || 0,
      members: members || 0,
    }
  })
  if (rows.length < 2) return

  let sort = 'members'
  function paint() {
    const order = rows.slice().sort((a, b) => {
      if (sort === 'boosts') return b.boosts - a.boosts || b.sats - a.sats
      if (sort === 'sats') return b.sats - a.sats || b.boosts - a.boosts
      return b.members - a.members || b.boosts - a.boosts || b.sats - a.sats
    })
    const frag = document.createDocumentFragment()
    order.forEach((r, i) => {
      if (r.rankEl) r.rankEl.textContent = String(i + 1)
      frag.appendChild(r.el)
    })
    list.appendChild(frag)
  }

  slot.appendChild(sortControl(CS_SORTS, sort, (key) => { sort = key; paint() }, {
    tag: 'Community Sort: ',
    title: 'Change how these artists are ranked',
  }))
  slot.hidden = false
}
initCommunityArtists()

// ── The #boosts section's range and sort ──────────────────────────────
// The shared machinery all four pages use; the corpus is fetched on the first
// control press, never on load. See boost-section.js.
initBoostSection({
  fetchCorpus: async () => {
    if (!GUID) throw new Error('corpus: no artist guid')
    const resp = await fetch(`/api/v1/publishers/${encodeURIComponent(GUID)}?corpus=1`, {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) throw new Error(`corpus: HTTP ${resp.status}`)
    return (await resp.json())?.corpus || {}
  },
  sortTitle: 'Sort the boosts sent to this artist’s albums',
  emptyText: 'Nobody boosted this artist in this time range — try a wider one.',
  truncatedNote:
    'Sorted over the 2,000 most recent boosts to this artist’s albums. They have received more than that, so an older boost may be missing.',
})

/* The shared Primal backfill, over the whole document — this page has no
 * private patch path (the bio is the artist's own plain text, no mention
 * chips), so the unscoped call is safe here exactly as it is on /show. It
 * fills the wall's and the boost rows' data-missing markers. */
hydrateProfiles()
