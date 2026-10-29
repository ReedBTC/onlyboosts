/* The discovery homepage's VERBS, and the two things only the browser can do.
 *
 * 1. Artwork fallback on every tile (primary → art2 → the glyph), the same
 *    walk every other surface with artwork uses.
 * 2. A rail the edge could not fill (its placeholder is still in the track)
 *    is fetched from the same endpoint and painted with the same two-sided
 *    tile module, so it is byte-identical to what the edge would have sent.
 *    The window rails (2026-10-22) are the same four charts over the week,
 *    the month and the year; a language slot (`lang-1`..`lang-3`) is the
 *    whole section, heading included, since the heading names the language.
 * 3. The PERSONAL rails. A signed-out visitor keeps the locked card (Reed's
 *    call, 2026-10-17: the carrot). A signed-in member gets their follows
 *    rail from the same POST the Shows · Follows feed makes, and the three
 *    recommendation shapes off one POST to /api/v1/recommend: Podcasts
 *    Recommended For You, Music Recommended For You, and up to five Because You Boosted X rails
 *    (one per most-boosted show; Reed's ask, 2026-10-18), cloned from the
 *    hidden prototype in index.html. Re-run on lb:session-change and on the
 *    storage event, like feeds.js.
 * 4. The FEATURED CAROUSEL at the top (Reed's call, 2026-10-19): the edge
 *    rendered it from the rails' first rows with the two-sided hero.js; this
 *    runs the rotation (seven seconds, paused on hover and focus, off under
 *    reduced motion and while the hero is off screen), the arrows and dots,
 *    the artwork fallback, and the Boost pill, which hands a click to the
 *    feed cards' own handlers. A rail the edge could not fill gets its slide
 *    rebuilt here from the rows fetched for the rail, with the same mappers.
 */
import { railListHtml, showTile, albumTile, episodeTile, memberTile, langRailHtml, bare } from '/assets/js/rail-tile.js?v=ob-v240'
import { heroHtml, slideHtml, showSlide, episodeSlide, memberSlide } from '/assets/js/hero.js?v=ob-v240'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v240'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v240'
import { boosterPageHref } from '/assets/js/booster-link.js?v=ob-v240'
import { languageName } from '/assets/js/lang-name.js?v=ob-v240'

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
  'shows-week':    { url: '/api/v1/charts/shows', rows: (j) => j.rows, tile: showTile, slide: (r) => showSlide('shows-week', r, { medium: 'podcast' }) },
  'albums-month':  { url: `/api/v1/podcasts?medium=music&sort=chart&range=1m&limit=${TILES}`, rows: (j) => j.podcasts, tile: albumTile, slide: (r) => showSlide('albums-month', r, { medium: 'music' }) },
  'episodes-year': { url: `/api/v1/episodes?not_medium=music&sort=chart&range=1y&limit=${TILES}`, rows: (j) => j.episodes, tile: (r, i) => episodeTile(r, i, '🎙'), slide: (r) => episodeSlide('episodes-year', r) },
  'songs-year':    { url: `/api/v1/episodes?medium=music&sort=chart&range=1y&limit=${TILES}`, rows: (j) => j.episodes, tile: (r, i) => episodeTile(r, i, '🎵'), slide: (r) => episodeSlide('songs-year', r) },
}
/* The window rails (2026-10-22): the same four charts over the other
   windows, no hero slide, the same rule as functions/index.js. */
const WINDOW_KINDS = {
  episodes: { url: (r) => `/api/v1/episodes?not_medium=music&sort=chart&range=${r}&limit=${TILES}`, rows: (j) => j.episodes, tile: (r, i) => episodeTile(r, i, '🎙') },
  songs:    { url: (r) => `/api/v1/episodes?medium=music&sort=chart&range=${r}&limit=${TILES}`, rows: (j) => j.episodes, tile: (r, i) => episodeTile(r, i, '🎵') },
  albums:   { url: (r) => `/api/v1/podcasts?medium=music&sort=chart&range=${r}&limit=${TILES}`, rows: (j) => j.podcasts, tile: albumTile },
  shows:    { url: (r) => `/api/v1/podcasts?not_medium=music&sort=chart&range=${r}&limit=${TILES}`, rows: (j) => j.podcasts, tile: showTile },
}
for (const [kind, k] of Object.entries(WINDOW_KINDS)) {
  for (const [w, range] of [['week', '1w'], ['month', '1m'], ['year', '1y']]) {
    const key = `${kind}-${w}`
    if (!SOURCES[key]) SOURCES[key] = { url: k.url(range), rows: k.rows, tile: k.tile, slide: () => null }
  }
}

/* The language rails (2026-10-22), the edge's rule rebuilt here when a slot
   kept its placeholder: the podcast side's non-English languages by boosts
   (the facet /api/v1/languages answers, the untagged bucket out), each
   kept when its year chart has five or more rows, the first three. One
   answer shared by the three slots. */
const LANG_RAILS = 3
const LANG_MIN_ROWS = 5
let langRailsP = null
function languageRails() {
  return langRailsP ??= (async () => {
    const j = await getJson('/api/v1/languages?not_medium=music')
    const langs = (j.languages || []).filter((r) => r.lang && r.lang !== 'en' && r.lang !== 'unknown')
      .sort((a, b) => Number(b.boosts) - Number(a.boosts) || Number(b.shows) - Number(a.shows)).map((r) => r.lang).slice(0, 8)
    const out = []
    for (const lang of langs) {
      if (out.length >= LANG_RAILS) break
      const c = await getJson(`/api/v1/podcasts?not_medium=music&sort=chart&range=1y&limit=${TILES}&lang=${encodeURIComponent(lang)}`)
      const rows = c.podcasts || []
      if (rows.length >= LANG_MIN_ROWS) out.push({ lang, rows })
    }
    return out
  })()
}
async function fillLangRail(section, n) {
  const one = (await languageRails())[n - 1]
  if (!one) { section.innerHTML = ''; return null }
  section.innerHTML = langRailHtml(n, one.lang, one.rows)
  wireArt(section)
  return n === 1 && one.rows[0]
    ? showSlide('lang-1', one.rows[0], { medium: 'podcast', eyebrow: `#1 ${languageName(one.lang)} Podcast This Year` })
    : null
}

async function getJson(url, init) {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

/** Fills a rail the edge left a placeholder in. Resolves to the rail's first
 *  row as a hero slide spec (or null), so the hero can gain the slide too. */
async function fillRail(section) {
  const key = section.dataset.rail
  const track = section.querySelector('.rail-track')
  if (!track || !track.querySelector('.rail-placeholder')) return null
  try {
    const slot = /^lang-([1-9])$/.exec(key)
    if (slot) return await fillLangRail(section, Number(slot[1]))
    if (key === 'hpw-week') {
      const j = await getJson('/api/v1/members/hours?range=week')
      const members = (j.members || []).slice(0, TILES)
      track.innerHTML = railListHtml(members.map((m, i) => memberTile(m, i, j.goal_hours)), { empty: 'No qualifying boosts yet this week.' })
      wireArt(track)
      return members[0] ? memberSlide('hpw-week', members[0], j.goal_hours) : null
    }
    const src = SOURCES[key]
    if (!src) { track.innerHTML = '<p class="rail-empty">Unavailable right now.</p>'; return null }
    const rows = src.rows(await getJson(src.url)) || []
    track.innerHTML = railListHtml(rows.slice(0, TILES).map(src.tile), { empty: 'Nothing here yet.' })
    wireArt(track)
    return rows[0] ? src.slide(rows[0]) : null
  } catch (e) {
    console.warn('[discover] rail', key, e)
    track.innerHTML = '<p class="rail-empty">This rail could not load. Reload to try again.</p>'
    return null
  }
}

/* ── 4. The featured carousel ──────────────────────────────────────────── */
const HERO_MS = 7000

function wireHeroArt(root) {
  for (const img of root.querySelectorAll('.hero-art:not([data-art-wired])')) {
    img.dataset.artWired = '1'
    const chain = coverChain(img.dataset.art2).filter((u) => u !== img.getAttribute('src'))
    const exhausted = () => {
      const glyph = img.closest('.hero-slide')?.dataset.kind === 'member' ? '👤' : '🎙'
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'hero-art hero-art--none', textContent: glyph }))
    }
    const fail = () => { if (chain.length) wireCoverFallback(img, chain, exhausted); else exhausted() }
    if (img.complete && img.naturalWidth === 0) { fail(); continue }
    img.onerror = () => { img.onerror = null; fail() }
  }
  for (const bg of root.querySelectorAll('.hero-bg:not([data-art-wired])')) {
    bg.dataset.artWired = '1'
    if (bg.complete && bg.naturalWidth === 0) { bg.remove(); continue }
    bg.onerror = () => bg.remove()
  }
}

/* The Boost pill: revealed here, and a click goes to the feed cards' own
   handlers (the show card's for a show or album, the episode card's for an
   episode or song), which read the subject off the slide's attributes
   exactly as off a card. Loaded on first use: the homepage's first view
   does not carry the cards' modules otherwise. */
function wireHeroBoost(hero) {
  for (const b of hero.querySelectorAll('[data-hero-boost]')) b.hidden = false
  if (hero.dataset.boostWired) return
  hero.dataset.boostWired = '1'
  hero.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('[data-hero-boost]')
    if (!btn || btn.disabled) return
    e.preventDefault()
    const slide = btn.closest('.hero-slide')
    if (!slide) return
    btn.disabled = true
    try {
      const kind = slide.dataset.kind
      if (kind === 'episode' || kind === 'song') {
        const m = await import('/assets/js/episode-card-actions.js?v=ob-v240')
        btn.disabled = false
        await m.onBoostClick(slide, btn)
      } else {
        const m = await import('/assets/js/show-card-actions.js?v=ob-v240')
        btn.disabled = false
        await m.onShowBoost(slide, btn)
      }
    } catch (err) {
      console.warn('[discover] hero boost', err)
      btn.disabled = false
    }
  })
}

const hero = { el: null, timer: null, paused: false, visible: true, reduced: false }

function heroSlides() { return hero.el ? Array.from(hero.el.querySelectorAll('.hero-slide')) : [] }
function heroIndex() {
  const strip = hero.el?.querySelector('[data-hero-slides]')
  if (!strip || !strip.clientWidth) return 0
  return Math.round(strip.scrollLeft / strip.clientWidth)
}
function heroGo(i, smooth = true) {
  const strip = hero.el?.querySelector('[data-hero-slides]')
  const n = heroSlides().length
  if (!strip || !n) return
  const to = ((i % n) + n) % n
  strip.scrollTo({ left: to * strip.clientWidth, behavior: smooth && !hero.reduced ? 'smooth' : 'auto' })
  markHeroDot(to)
}
function markHeroDot(i) {
  for (const b of hero.el?.querySelectorAll('[data-hero-to]') || []) {
    if (Number(b.dataset.heroTo) === i) b.setAttribute('aria-current', 'true')
    else b.removeAttribute('aria-current')
  }
}
function heroTick() {
  clearInterval(hero.timer)
  hero.timer = null
  if (hero.reduced || hero.paused || !hero.visible || document.hidden || heroSlides().length < 2) return
  hero.timer = setInterval(() => heroGo(heroIndex() + 1), HERO_MS)
}

/* The dots follow the slides: rebuilt after a slide is added. */
function syncHeroChrome() {
  const el = hero.el
  if (!el) return
  const slides = heroSlides()
  const n = slides.length
  slides.forEach((s, i) => s.setAttribute('aria-label', `${i + 1} of ${n}: ${s.querySelector('.hero-eyebrow')?.textContent || ''}`))
  const dots = el.querySelector('[data-hero-dots]')
  if (dots) {
    dots.innerHTML = slides.map((s, i) =>
      `<li><button type="button" data-hero-to="${i}" aria-label="Slide ${i + 1} of ${n}"></button></li>`).join('')
    for (const b of dots.querySelectorAll('button')) b.setAttribute('aria-label', `Slide ${Number(b.dataset.heroTo) + 1} of ${n}: ${slides[Number(b.dataset.heroTo)].querySelector('.hero-eyebrow')?.textContent || ''}`)
    dots.hidden = n < 2
  }
  for (const a of el.querySelectorAll('[data-hero-dir]')) a.hidden = n < 2
  markHeroDot(heroIndex())
  wireHeroArt(el)
  wireHeroBoost(el)
  heroTick()
}

function initHero() {
  const el = document.querySelector('[data-hero]')
  if (!el || el.dataset.heroWired) { if (el) syncHeroChrome(); return }
  el.dataset.heroWired = '1'
  hero.el = el
  hero.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const strip = el.querySelector('[data-hero-slides]')
  el.addEventListener('click', (e) => {
    const dir = e.target?.closest?.('[data-hero-dir]')
    if (dir) { heroGo(heroIndex() + Number(dir.dataset.heroDir)); heroTick(); return }
    const to = e.target?.closest?.('[data-hero-to]')
    if (to) { heroGo(Number(to.dataset.heroTo)); heroTick() }
  })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { heroGo(heroIndex() - 1); heroTick() }
    else if (e.key === 'ArrowRight') { heroGo(heroIndex() + 1); heroTick() }
  })
  const pause = () => { hero.paused = true; heroTick() }
  const resume = () => { hero.paused = false; heroTick() }
  el.addEventListener('mouseenter', pause)
  el.addEventListener('mouseleave', resume)
  el.addEventListener('focusin', pause)
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) resume() })
  el.addEventListener('touchstart', pause, { passive: true })
  let scrollT = null
  strip?.addEventListener('scroll', () => {
    clearTimeout(scrollT)
    scrollT = setTimeout(() => markHeroDot(heroIndex()), 80)
  }, { passive: true })
  document.addEventListener('visibilitychange', heroTick)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => { hero.visible = entries.some((x) => x.isIntersecting); heroTick() }, { threshold: 0.3 }).observe(el)
  }
  // A resize changes the slide width; stay on the same slide.
  let resizeT = null
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => heroGo(heroIndex(), false), 120) })
  syncHeroChrome()
}

/* Slides for the rails the browser filled: added to the hero in the page's
   rail order, or the whole hero built if the edge rendered none. */
function patchHero(specs) {
  const fresh = specs.filter(Boolean)
  if (!fresh.length) return
  const order = Array.from(document.querySelectorAll('[data-rail]:not([data-rail-personal])')).map((s) => s.dataset.rail)
  fresh.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  let el = document.querySelector('[data-hero]')
  if (!el) {
    const first = document.querySelector('#discover .rail')
    if (!first) return
    first.insertAdjacentHTML('beforebegin', heroHtml(fresh))
    initHero()
    return
  }
  const strip = el.querySelector('[data-hero-slides]')
  if (!strip) return
  for (const spec of fresh) {
    if (strip.querySelector(`[data-slide="${CSS.escape(spec.key)}"]`)) continue
    const after = Array.from(strip.querySelectorAll('.hero-slide')).find((s) => order.indexOf(s.dataset.slide) > order.indexOf(spec.key))
    const html = slideHtml(spec, 1, 1)
    if (after) after.insertAdjacentHTML('beforebegin', html)
    else strip.insertAdjacentHTML('beforeend', html)
  }
  syncHeroChrome()
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
    track.innerHTML = railListHtml(rows.slice(0, TILES).map(bare(showTile)), {
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
  /* The nav's "Because You Boosted" link is /#rail-because, so the FIRST
     clone keeps that id and the hidden prototype gives it up. */
  const protoH2 = proto.querySelector('h2')
  if (protoH2) { protoH2.id = 'rail-because-proto'; proto.setAttribute('aria-labelledby', 'rail-because-proto') }
  entries.forEach((b, i) => {
    const sec = proto.cloneNode(true)
    sec.hidden = false
    sec.dataset.rail = `because-${i}`
    const id = i === 0 ? 'rail-because' : `rail-because-${i}`
    sec.setAttribute('aria-labelledby', id)
    const h2 = sec.querySelector('h2')
    if (h2) h2.id = id
    const a = sec.querySelector('[data-because-seed]')
    if (a) { a.textContent = b.seed.title || 'this show'; a.href = `/show/${encodeURIComponent(b.seed.guid)}` }
    const sub = sec.querySelector('[data-because-sub]')
    if (sub) sub.textContent = `What the other boosters of ${b.seed.title || 'this show'} also boost`
    const track = sec.querySelector('.rail-track')
    if (track) track.innerHTML = railListHtml(b.rows.map(bare(b.seed.medium === 'music' ? albumTile : showTile)))
    proto.before(sec)
    wireArt(sec)
  })
  // A link into a rail that has just been painted lands on it now.
  if (location.hash === '#rail-because') document.getElementById('rail-because')?.scrollIntoView({ block: 'start' })
}

/* The member's own page carries the full lists (#recommended, 2026-10-20);
   each recommendation rail's head gets the link once the rail is painted. */
function linkFullList(section, pubkey) {
  const head = section?.querySelector('.rail-head')
  if (!head || !pubkey || head.querySelector('[data-rec-full]')) return
  const a = document.createElement('a')
  a.className = 'rail-more'
  a.dataset.recFull = '1'
  a.href = `${boosterPageHref(null, pubkey)}#recommended`
  a.textContent = 'Your full list →'
  head.appendChild(a)
}

/* Podcasts Recommended For You, Music Recommended For You and the Because rails, all off one
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
      if (j.podcasts?.length) { unlock(rec, railListHtml(j.podcasts.map(bare(showTile)))); linkFullList(rec, pubkey) }
      else lockedCardNote(rec, j.seeds ? 'Nothing to recommend yet' : 'No boosts from this account yet', j.seeds ? 'Too few other members have boosted the shows you boost for the overlap to mean anything yet; it grows with every boost.' : none('shows'))
    }
    if (music) {
      if (j.music?.length) { unlock(music, railListHtml(j.music.map(bare(albumTile)))); linkFullList(music, pubkey) }
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
  if (res.status === 'signed-out') {
    paintBecause(null, [])
    // The nav's Because link, signed out: the carrot is the locked rail above it.
    if (location.hash === '#rail-because') document.getElementById('rail-recommended')?.scrollIntoView({ block: 'start' })
    return // the locked cards stay: the carrot
  }
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
initHero()
Promise.all(Array.from(document.querySelectorAll('[data-rail]:not([data-rail-personal])')).map(fillRail))
  .then(patchHero)
  .catch((e) => console.warn('[discover] hero patch', e))
paintPersonal()
window.addEventListener('lb:session-change', paintPersonal)
window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') paintPersonal() })
