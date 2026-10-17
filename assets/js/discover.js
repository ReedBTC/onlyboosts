/* The discovery homepage's VERBS, and the two things only the browser can do.
 *
 * 1. Artwork fallback on every tile (primary → art2 → the glyph), the same
 *    walk every other surface with artwork uses.
 * 2. A rail the edge could not fill (its placeholder is still in the track)
 *    is fetched from the same endpoint and painted with the same two-sided
 *    tile module, so it is byte-identical to what the edge would have sent.
 * 3. The PERSONAL rails. A signed-out visitor keeps the locked card (Reed's
 *    call, 2026-10-17: the carrot). A signed-in member gets their follows
 *    rail from the same POST the Shows · Follows feed makes, and, until the
 *    recommendations endpoint lands, an honest line in the Recommended slot.
 *    Re-run on lb:session-change and on the storage event, like feeds.js.
 */
import { railListHtml, showTile, albumTile, episodeTile, artistTile, memberTile } from '/assets/js/rail-tile.js?v=ob-v219'
import { rowsFromRecords } from '/assets/js/boost-list.js?v=ob-v219'
import { initBoostNoteActions, wireBoostNotes } from '/assets/js/boost-note-actions.js?v=ob-v219'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v219'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v219'

const TILES = 10

/* ── 1. Artwork ────────────────────────────────────────────────────────── */
function wireArt(root) {
  for (const img of root.querySelectorAll('.rt-media img:not([data-art-wired])')) {
    img.dataset.artWired = '1'
    const media = img.closest('.rt-media')
    const chain = coverChain(img.dataset.art2).filter((u) => u !== img.getAttribute('src'))
    const exhausted = () => {
      if (!media) return
      const glyph = media.closest('.rail')?.dataset.glyph || '🎙'
      media.classList.add('rt-media--none')
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'rt-glyph', textContent: glyph }))
    }
    const fail = () => { if (chain.length) wireCoverFallback(img, chain, exhausted); else exhausted() }
    if (img.complete && img.naturalWidth === 0) { fail(); continue }
    img.onerror = () => { img.onerror = null; fail() }
  }
}

/* ── 2. Rails the edge did not fill ────────────────────────────────────── */
const SOURCES = {
  'shows-week':    { url: '/api/v1/charts/shows', rows: (j) => j.rows, tile: showTile },
  'artists-week':  { url: '/api/v1/charts/artists', rows: (j) => j.rows, tile: artistTile },
  'albums-month':  { url: `/api/v1/podcasts?medium=music&sort=chart&range=1m&limit=${TILES}`, rows: (j) => j.podcasts, tile: albumTile },
  'episodes-year': { url: `/api/v1/episodes?not_medium=music&sort=chart&range=1y&limit=${TILES}`, rows: (j) => j.episodes, tile: (r, i) => episodeTile(r, i, '🎙') },
  'songs-year':    { url: `/api/v1/episodes?medium=music&sort=chart&range=1y&limit=${TILES}`, rows: (j) => j.episodes, tile: (r, i) => episodeTile(r, i, '🎵') },
}

async function getJson(url, init) {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

async function fillRail(section) {
  const key = section.dataset.rail
  const track = section.querySelector('.rail-track')
  if (!track || !track.querySelector('.rail-placeholder')) return
  try {
    if (key === 'hpw-week') {
      const j = await getJson('/api/v1/members/hours?range=week')
      track.innerHTML = railListHtml((j.members || []).slice(0, TILES).map((m, i) => memberTile(m, i, j.goal_hours)), { empty: 'No qualifying boosts yet this week.' })
      wireArt(track)
      return
    }
    if (key === 'boosts-latest') {
      /* The boost row's client half: records through the shape layer the
         detail pages' repaint uses, then the same row renderer. The names
         map is empty here (a mention chip then shows the npub until
         hydrateProfiles fills it). */
      const j = await getJson('/api/v1/boosts?limit=12')
      const { boostRows } = await import('/assets/js/boost-list.js?v=ob-v219')
      const rows = rowsFromRecords(j.boosts || [])
      track.innerHTML = rows.length
        ? `<ul class="boost-list ob-boost-list" data-bs-list>${boostRows(rows, new Map(), { noun: 'episode', showTarget: true, linkBooster: true, showShow: true })}</ul>`
        : '<p class="rail-empty">No boosts yet.</p>'
      await wireBoosts(track)
      return
    }
    const src = SOURCES[key]
    if (!src) return
    const rows = src.rows(await getJson(src.url)) || []
    track.innerHTML = railListHtml(rows.slice(0, TILES).map(src.tile), { empty: 'Nothing here yet.' })
    wireArt(track)
  } catch (e) {
    console.warn('[discover] rail', key, e)
    track.innerHTML = '<p class="rail-empty">This rail could not load. Reload to try again.</p>'
  }
}

/* ── 3. Personal rails ─────────────────────────────────────────────────── */
function lockedCardNote(section, title, text) {
  const card = section.querySelector('.rail-locked-card > div')
  if (!card) return
  card.innerHTML = `<div><h3></h3><p></p></div>`
  card.querySelector('h3').textContent = title
  card.querySelector('p').textContent = text
}

async function paintFollows(section, follows) {
  const track = section.querySelector('.rail-track')
  if (!track) return
  try {
    const j = await getJson(`/api/v1/podcasts?not_medium=music&sort=chart&range=all&limit=${TILES}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ follows }),
    })
    const rows = j.podcasts || []
    track.classList.remove('rail-locked')
    track.removeAttribute('data-locked')
    track.innerHTML = railListHtml(rows.slice(0, TILES).map(showTile), {
      empty: 'Nobody you follow has boosted a show yet. Follow a few boosters on the Members tab.',
    })
    wireArt(track)
    const link = section.querySelector('[data-follows-link]')
    if (link) link.hidden = false
  } catch (e) {
    console.warn('[discover] follows rail', e)
    lockedCardNote(section, 'Your follows could not be loaded', 'Reload to try again.')
  }
}

let personalRun = 0
async function paintPersonal() {
  const my = ++personalRun
  const sections = Array.from(document.querySelectorAll('[data-rail-personal]'))
  if (!sections.length) return
  const res = await resolveFollows()
  if (my !== personalRun) return
  for (const s of sections) {
    const key = s.dataset.rail
    if (res.status === 'signed-out') continue // the locked card stays: the carrot
    if (key === 'follows') {
      if (res.status === 'ok') paintFollows(s, res.follows)
      else if (res.status === 'empty') lockedCardNote(s, 'You follow nobody yet', 'Follow a few boosters on the Members tab and their shows will rank here.')
      else lockedCardNote(s, 'Your follow list could not be read', 'The relays did not answer. Reload to try again.')
    } else if (key === 'recommended') {
      lockedCardNote(s, 'Your recommendations are being built',
        'They will rank the shows the people who boost what you boost are listening to. Keep boosting and favoriting; that is what feeds them.')
    }
  }
}

/* The Log in buttons on the locked cards: the nav's own login, lazily. */
document.addEventListener('click', async (e) => {
  const b = e.target && e.target.closest && e.target.closest('[data-lb-login-trigger]')
  if (!b) return
  e.preventDefault()
  try {
    if (window.__lbEnsureWidget) await window.__lbEnsureWidget()
    if (window.LBLogin?.requestLogin) window.LBLogin.requestLogin()
  } catch (err) { console.error('[discover] login widget', err) }
})

/* ── The boost rows' verbs: the reaction bar, and the mention chips' names ── */
async function wireBoosts(root) {
  try {
    await wireBoostNotes(root)
    const { hydrateProfiles } = await import('/assets/js/detail-page.js?v=ob-v219')
    hydrateProfiles(root)
  } catch (e) { console.warn('[discover] boost rows', e) }
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
wireArt(document)
for (const s of document.querySelectorAll('[data-rail]:not([data-rail-personal])')) fillRail(s)
initBoostNoteActions()
{
  const boosts = document.querySelector('[data-rail="boosts-latest"] [data-boost-section]')
  if (boosts && !boosts.querySelector('.rail-placeholder')) {
    import('/assets/js/detail-page.js?v=ob-v219').then((m) => m.hydrateProfiles(boosts)).catch(() => {})
  }
}
paintPersonal()
window.addEventListener('lb:session-change', paintPersonal)
window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') paintPersonal() })
