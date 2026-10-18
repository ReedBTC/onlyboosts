/* The discovery homepage's VERBS, and the two things only the browser can do.
 *
 * 1. Artwork fallback on every tile (primary → art2 → the glyph), the same
 *    walk every other surface with artwork uses.
 * 2. A rail the edge could not fill (its placeholder is still in the track)
 *    is fetched from the same endpoint and painted with the same two-sided
 *    tile module, so it is byte-identical to what the edge would have sent.
 * 3. The PERSONAL rails. A signed-out visitor keeps the locked card (Reed's
 *    call, 2026-10-17: the carrot). A signed-in member gets their follows
 *    rail from the same POST the Shows · Follows feed makes, and the three
 *    recommendation shapes off one POST to /api/v1/recommend: Recommended
 *    For You, Recommended Music, and up to five Because You Boosted X rails
 *    (one per most-boosted show; Reed's ask, 2026-10-18), cloned from the
 *    hidden prototype in index.html. Re-run on lb:session-change and on the
 *    storage event, like feeds.js.
 */
import { railListHtml, showTile, albumTile, episodeTile, artistTile, memberTile } from '/assets/js/rail-tile.js?v=ob-v221'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v221'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v221'

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
    const src = SOURCES[key]
    if (!src) { track.innerHTML = '<p class="rail-empty">Unavailable right now.</p>'; return }
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

function unlock(section, html) {
  const track = section.querySelector('.rail-track')
  if (!track) return
  track.classList.remove('rail-locked')
  track.removeAttribute('data-locked')
  track.innerHTML = html
  wireArt(track)
}

/* The Because rails: the hidden prototype cloned once per entry, in order,
   just above the prototype (so they sit where Reed placed the rail). A
   re-run (sign-out, account switch) removes the previous clones first. */
function paintBecause(proto, entries) {
  for (const old of document.querySelectorAll('[data-rail^="because-"]')) old.remove()
  if (!proto) return
  entries.forEach((b, i) => {
    const sec = proto.cloneNode(true)
    sec.hidden = false
    sec.dataset.rail = `because-${i}`
    sec.setAttribute('aria-labelledby', `rail-because-${i}`)
    const h2 = sec.querySelector('h2')
    if (h2) h2.id = `rail-because-${i}`
    const a = sec.querySelector('[data-because-seed]')
    if (a) { a.textContent = b.seed.title || 'this show'; a.href = `/show/${encodeURIComponent(b.seed.guid)}` }
    const sub = sec.querySelector('[data-because-sub]')
    if (sub) sub.textContent = `What the other boosters of ${b.seed.title || 'this show'} also boost`
    const track = sec.querySelector('.rail-track')
    if (track) track.innerHTML = railListHtml(b.rows.map(b.seed.medium === 'music' ? albumTile : showTile))
    proto.before(sec)
    wireArt(sec)
  })
}

/* Recommended For You, Recommended Music and the Because rails, all off one
   POST: the member's boosted shows are the seeds (favorites join them once
   the favorites list has an accessor here), and the endpoint sums the
   collector's similarity scores over them. /about#recommendations is the
   method in full. */
async function paintRecommended(sections, pubkey) {
  const rec = sections.find((s) => s.dataset.rail === 'recommended')
  const music = sections.find((s) => s.dataset.rail === 'recommended-music')
  const because = sections.find((s) => s.dataset.rail === 'because')
  try {
    const j = await getJson('/api/v1/recommend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey, limit: TILES }),
    })
    const none = (what) => `Boost a few ${what} and the ${what} their other boosters boost will rank here.`
    if (rec) {
      if (j.podcasts?.length) unlock(rec, railListHtml(j.podcasts.map(showTile)))
      else lockedCardNote(rec, j.seeds ? 'Nothing to recommend yet' : 'No boosts from this account yet', j.seeds ? 'Too few other members have boosted the shows you boost for the overlap to mean anything yet; it grows with every boost.' : none('shows'))
    }
    if (music) {
      if (j.music?.length) unlock(music, railListHtml(j.music.map(albumTile)))
      else lockedCardNote(music, j.seeds ? 'Nothing to recommend yet' : 'No music boosts from this account yet', j.seeds ? 'Too few other members have boosted the albums you boost for the overlap to mean anything yet.' : none('albums'))
    }
    paintBecause(because, Array.isArray(j.because) ? j.because.filter((b) => b?.seed && b.rows?.length) : [])
  } catch (e) {
    console.warn('[discover] recommend', e)
    for (const s of [rec, music]) if (s) lockedCardNote(s, 'Your recommendations could not be loaded', 'Reload to try again.')
  }
}

let personalRun = 0
async function paintPersonal() {
  const my = ++personalRun
  const sections = Array.from(document.querySelectorAll('[data-rail-personal]'))
  if (!sections.length) return
  const res = await resolveFollows()
  if (my !== personalRun) return
  if (res.status === 'signed-out') { paintBecause(null, []); return } // the locked cards stay: the carrot
  for (const s of sections) {
    if (s.dataset.rail !== 'follows') continue
    if (res.status === 'ok') paintFollows(s, res.follows)
    else if (res.status === 'empty') lockedCardNote(s, 'You follow nobody yet', 'Follow a few boosters on the Members tab and their shows will rank here.')
    else lockedCardNote(s, 'Your follow list could not be read', 'The relays did not answer. Reload to try again.')
  }
  if (res.pubkey) paintRecommended(sections, res.pubkey)
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

/* ── Boot ──────────────────────────────────────────────────────────────── */
wireArt(document)
for (const s of document.querySelectorAll('[data-rail]:not([data-rail-personal])')) fillRail(s)
paintPersonal()
window.addEventListener('lb:session-change', paintPersonal)
window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') paintPersonal() })
