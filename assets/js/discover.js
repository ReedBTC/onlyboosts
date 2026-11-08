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
 * 5. THE RANK EXPLAINER (Reed's ask, 2026-10-30): a figure of the triplet
 *    under a tile ("₿ #5") looks pressable, so a click on one opens a small
 *    note saying what it means in that rail's own window ("Ranked 5th in
 *    sats this week") instead of following the tile's link. One note at a
 *    time; a click elsewhere, Escape or a scroll closes it.
 */
import { railListHtml, showTile, albumTile, episodeTile, latestTile, memberTile, langRailHtml, bare } from '/assets/js/rail-tile.js?v=ob-v266'
import { CARROT, carrotState, HOOKS } from '/assets/js/recommend-rails.js?v=ob-v266'
import { heroHtml, slideHtml, showSlide, episodeSlide, memberSlide } from '/assets/js/hero.js?v=ob-v266'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v266'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v266'
import { boosterPageHref } from '/assets/js/booster-link.js?v=ob-v266'
import { becauseVerb } from '/assets/js/recommend-rails.js?v=ob-v266'
import { languageName } from '/assets/js/lang-name.js?v=ob-v266'

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
        const m = await import('/assets/js/episode-card-actions.js?v=ob-v266')
        btn.disabled = false
        await m.onBoostClick(slide, btn)
      } else {
        const m = await import('/assets/js/show-card-actions.js?v=ob-v266')
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
/* ⚠️ A PERSONAL RAIL IS HIDDEN UNTIL IT HAS SOMETHING TO SHOW, AND A VISITOR
   WITH NO ACCOUNT AND NO IMPORTED LIST SEES ONE RAIL, THE CARROT (Reed's
   call, 2026-11-08: four locked cards in a row, "boom, boom, boom, boom",
   pushed everything a signed-out reader can see below them). index.html
   ships the four `hidden` and the carrot (`data-rail="personal"`) shown, so
   the no-script read is the signed-out state. Who sees what:
     signed out, nothing imported   the carrot alone
     signed out, an imported list   Podcasts / Music Recommended, each side
                                    that has rows (the podcast side with a
                                    note when both are empty); no follows
     signed in, no seeds            the two Follows rails alone
     signed in, with seeds          all four
   A seed is a boosted show or an entry on the member's list. `reveal` is
   the one place a rail un-hides. */
const PERSONAL = ['follows-latest', 'recommended', 'recommended-music', 'follows', 'follows-songs']
function railOf(sections, key) { return sections.find((s) => s.dataset.rail === key) }
function reveal(section) { if (section) section.hidden = false }
function conceal(section) { if (section) section.hidden = true }

/* ⚠️ THE CARROT STAYS UP UNTIL THE MEMBER HAS EVERYTHING, AND SAYS WHAT IS
   MISSING (Reed's ask, 2026-11-08: "advertising space to explain what the
   site is doing and why it's a good idea"). One rail, its copy by state:
   signed out and nothing imported, the two doors; an imported list, what
   logging in adds; signed in, whichever side has no seed (the endpoint's
   `sides`). It leads the personal block when nothing personal is painted
   and follows the block otherwise. Hidden only for a member with a seed on
   both sides. The copy is CARROT in recommend-rails.js, shared with the
   owner's /booster. The login and import buttons are delegated (see the
   click handlers below), so a rewritten card needs no wiring. */
function setCarrot(sections, state) {
  const carrot = railOf(sections, 'personal')
  if (!carrot) return
  if (!state) { carrot.hidden = true; return }
  const c = CARROT[state]
  const card = carrot.querySelector('.rail-locked-card > div')
  const h2 = carrot.querySelector('h2')
  if (!c || !card || !h2) return
  h2.textContent = c.h2
  card.querySelector('h3').textContent = c.h3
  card.querySelector('p').textContent = c.p
  card.querySelector('.rail-locked-actions').innerHTML = c.actions
  carrot.querySelector('.rail-track')?.classList.toggle('is-loading', state === 'loading')
  // Leads the block when it is the block; follows it otherwise.
  const last = railOf(sections, 'follows-songs')
  const first = railOf(sections, 'follows-latest') || railOf(sections, 'recommended')
  const atEnd = state !== 'signed-out' && state !== 'loading'
  if (atEnd && last && last.nextElementSibling !== carrot) last.after(carrot)
  else if (!atEnd && first && carrot.nextElementSibling !== first) first.before(carrot)
  carrot.hidden = false
}
function showCarrot(sections, on) {
  setCarrot(sections, on ? 'signed-out' : null)
  if (on) for (const k of PERSONAL) conceal(railOf(sections, k))
}
function lockedCardNote(section, title, text, actions = '') {
  const card = section.querySelector('.rail-locked-card > div')
  if (!card) return
  card.innerHTML = `<div><h3></h3><p></p></div>${actions ? `<span class="rail-locked-actions">${actions}</span>` : ''}`
  card.querySelector('h3').textContent = title
  card.querySelector('p').textContent = text
  reveal(section)
}

/* The two follows rails: the Shows chart and the Songs chart over the
   accounts the member follows (songs since 2026-10-30, Reed's ask). Both are
   bare, like every personal rail. */
const FOLLOWS = {
  'follows': {
    url: `/api/v1/podcasts?not_medium=music&sort=chart&range=all&limit=${TILES}`, rows: (j) => j.podcasts, tile: bare(showTile),
    empty: 'Nobody you follow has boosted a show yet. Follow a few boosters on the Members tab.',
  },
  'follows-songs': {
    url: `/api/v1/episodes?medium=music&sort=chart&range=all&limit=${TILES}`, rows: (j) => j.episodes, tile: bare((r, i) => episodeTile(r, i, '🎵')),
    empty: 'Nobody you follow has boosted a song yet. Follow a few boosters on the Members tab.',
  },
}

async function paintFollows(section, follows) {
  const track = section.querySelector('.rail-track')
  const spec = FOLLOWS[section.dataset.rail]
  if (!track || !spec) return
  try {
    const j = await getJson(spec.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ follows }),
    })
    const rows = spec.rows(j) || []
    track.classList.remove('rail-locked')
    track.removeAttribute('data-locked')
    track.innerHTML = railListHtml(rows.slice(0, TILES).map(spec.tile), { empty: spec.empty })
    wireArt(track)
    reveal(section)
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
  reveal(section)
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
    // "you boosted", "you follow" (a podcast on the favorites list) or "you
    // favorited" (an album there): the seed's pool, off the endpoint's `why`.
    const verb = sec.querySelector('[data-because-verb]')
    if (verb) verb.textContent = `you ${becauseVerb(b.seed, b.why)}`
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
function linkFullList(section, pubkey, hash = '#recommended') {
  const head = section?.querySelector('.rail-head')
  if (!head || !pubkey || head.querySelector('[data-rec-full]')) return
  const a = document.createElement('a')
  a.className = 'rail-more'
  a.dataset.recFull = '1'
  a.href = `${boosterPageHref(null, pubkey)}${hash}`
  a.textContent = 'Your full list →'
  headExtra(head, a)
}
/* A rail head's extra (the full-list link, the imported-list note) joins the
   `.rail-sub` line after a separator rather than standing as a third flex
   item, which shrank the heading onto two lines (Reed's screenshot,
   2026-11-08). `.rail-sub` wraps as one right-aligned block. */
function headExtra(head, ...nodes) {
  const sub = head.querySelector('.rail-sub')
  if (!sub) { for (const n of nodes) head.appendChild(n); return }
  sub.appendChild(document.createTextNode(' · '))
  for (const n of nodes) sub.appendChild(n)
}

/* Podcasts Recommended For You, Music Recommended For You and the Because rails, all off one
   POST: the member's boosted shows are the seeds, and the feeds on their
   favorites list once favorites-ui.js has read it (2026-11-07; see
   onFavoritesRead below), and the endpoint sums the collector's similarity
   scores over them. A seed is never recommended, so following a show takes
   it off the rails. /about#recommendations is the method in full. */
let lastRecommend = { sections: null, pubkey: null, feeds: '' }
/* A rail seeded by a list imported without an account says so, and opens the
   list (the panel's manage view) from its head. */
function importedNote(section) {
  const head = section.querySelector('.rail-head')
  if (!head || head.querySelector('[data-opml-manage]')) return
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'rail-more rail-more--btn'
  b.setAttribute('data-opml-manage', '')
  b.textContent = 'Manage'
  headExtra(head, document.createTextNode('From your imported OPML · '), b)
}
async function paintRecommended(sections, pubkey, favorites = []) {
  lastRecommend = { sections, pubkey, feeds: favorites.join(',') }
  const rec = sections.find((s) => s.dataset.rail === 'recommended')
  const music = sections.find((s) => s.dataset.rail === 'recommended-music')
  const because = sections.find((s) => s.dataset.rail === 'because')
  try {
    const j = await getJson('/api/v1/recommend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(pubkey ? { pubkey } : {}), limit: TILES, ...(favorites.length ? { favorites } : {}) }),
    })
    if (lastRecommend.pubkey !== pubkey || lastRecommend.sections !== sections) return
    const pods = j.podcasts?.length ? j.podcasts : null
    const albums = j.music?.length ? j.music : null
    // No seeds, nothing to recommend from: the rails stay hidden (a signed-in
    // member with no boosts and no list sees the Follows rails and the carrot).
    if (!j.seeds && !pods && !albums) { conceal(rec); conceal(music); paintBecause(because, []); setCarrot(sections, pubkey ? 'no-seeds' : 'signed-out'); return }
    const sides = j.sides && typeof j.sides === 'object' ? j.sides : { podcast: pods ? 1 : 0, music: albums ? 1 : 0 }
    const hasPod = sides.podcast > 0 || !!pods
    const hasMusic = sides.music > 0 || !!albums
    // A member whose list is empty (no follows, no favorites, nothing
    // imported) is asked for them even with boosts to seed from (Reed,
    // 2026-11-08: a boosted-once account saw only "no music yet").
    setCarrot(sections, carrotState({ signedIn: !!pubkey, imported: true, sides: j.sides, pods: pods?.length || 0, albums: albums?.length || 0, listEmpty: !favorites.length }))
    // An empty rail is a hook, not a shrug (Reed, the same day): no seed on
    // the side, it says what makes one; seeds but no overlap, it says the
    // overlap grows with use.
    if (rec) {
      if (pods) { unlock(rec, railListHtml(pods.map(bare(showTile)))); if (pubkey) linkFullList(rec, pubkey); else importedNote(rec) }
      else if (pubkey && !hasPod) lockedCardNote(rec, HOOKS.podcastsNone.title, HOOKS.podcastsNone.text, HOOKS.podcastsNone.actions)
      else if (pubkey) lockedCardNote(rec, HOOKS.podcastsThin.title, HOOKS.podcastsThin.text, HOOKS.podcastsThin.actions)
      else if (!albums) {
        lockedCardNote(rec, 'Nothing to recommend yet', 'Too few other members have boosted the podcasts you imported for the overlap to mean anything yet.')
        importedNote(rec)
      } else conceal(rec)
    }
    if (music) {
      if (albums) { unlock(music, railListHtml(albums.map(bare(albumTile)))); if (pubkey) linkFullList(music, pubkey); else importedNote(music) }
      // An imported list rarely holds music, so an empty music side is no
      // rail for it; a member's own empty side is the hook.
      else if (pubkey && !hasMusic) lockedCardNote(music, HOOKS.musicNone.title, HOOKS.musicNone.text, HOOKS.musicNone.actions)
      else if (pubkey) lockedCardNote(music, HOOKS.musicThin.title, HOOKS.musicThin.text, HOOKS.musicThin.actions)
      else conceal(music)
    }
    paintBecause(because, Array.isArray(j.because) ? j.because.filter((b) => b?.seed && b.rows?.length) : [])
  } catch (e) {
    console.warn('[discover] recommend', e)
    setCarrot(sections, pubkey ? null : 'imported')
    if (rec) lockedCardNote(rec, 'Your recommendations could not be loaded', 'Reload to try again.')
    conceal(music)
  }
}

/* Latest From Podcasts You Follow (2026-11-08, Reed's ask: follows were the
   input the dropped followed-podcasts feed was missing): the list's podcast
   feed guids to /api/v1/follows/latest, which asks Podcast Index for their
   newest episodes (D1 holds boosted episodes only). Painted for a signed-in
   member and for an imported list alike; hidden with nothing followed.
   TEN TILES, like every other rail (Reed's call, 2026-11-08: the one rail
   with a scroll bar looked odd); the long rail with View more is the
   member's own page, /booster#latest, which the head links. */
const LATEST_LIMIT = 10
async function paintLatest(sections, feeds, { local = false, pubkey = null } = {}) {
  const section = railOf(sections, 'follows-latest')
  if (!section) return
  if (!feeds.length) { conceal(section); return }
  const key = feeds.join(',')
  if (section.dataset.latestFor === key) return
  section.dataset.latestFor = key
  try {
    const j = await getJson('/api/v1/follows/latest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feeds, limit: LATEST_LIMIT }),
    })
    if (section.dataset.latestFor !== key) return
    if (j.episodes?.length) { unlock(section, railListHtml(j.episodes.map(latestTile))); if (local) importedNote(section); else linkFullList(section, pubkey, '#latest') }
    else if (j.shows) lockedCardNote(section, 'Nothing new to show just now', 'The newest episodes of the podcasts you follow could not be read from Podcast Index. Reload to try again.')
    else lockedCardNote(section, 'None of the podcasts you follow are in the index yet', 'A podcast joins the index with its first Nostr boost. Boost one of yours and its new episodes will show here.')
  } catch (e) {
    console.warn('[discover] latest', e)
    section.dataset.latestFor = ''
    lockedCardNote(section, 'Your latest episodes could not be loaded', 'Reload to try again.')
  }
}

const FAVORITES_WAIT_MS = 8000
let personalRun = 0
async function paintPersonal() {
  const my = ++personalRun
  const sections = Array.from(document.querySelectorAll('[data-rail-personal]'))
  if (!sections.length) return
  const latest = railOf(sections, 'follows-latest')
  if (latest) latest.dataset.latestFor = ''
  const res = await resolveFollows()
  if (my !== personalRun) return
  if (res.status === 'signed-out') {
    paintBecause(null, [])
    // Signed out, the four personal rails are one: the carrot. The nav's
    // Discover links to any of them land on it.
    showCarrot(sections, true)
    if (/^#rail-(follows-latest|recommended|recommended-music|follows|follows-songs|because)$/.test(location.hash)) document.getElementById('rail-personal')?.scrollIntoView({ block: 'start' })
    // A list imported from OPML without an account seeds the two Recommended
    // rails and the Because rails on its own (2026-11-07), and they take the
    // carrot's place once painted; the follows rails need a Nostr follow
    // list and stay hidden.
    lastRecommend = { sections, pubkey: null, feeds: '' }
    const api = await favoritesApi()
    const local = api ? await api.ensureRead().catch(() => []) : []
    if (my !== personalRun) return
    if (local.length) { paintRecommended(sections, null, local); paintLatest(sections, local, { local: true }) }
    return
  }
  // Signed in: the carrot says the lists are loading, and each rail appears
  // as it is painted (Reed, 2026-11-08: a "boost or follow" card that flipped
  // once the read landed looked like the site forgetting his follow).
  setCarrot(sections, 'loading')
  for (const k of PERSONAL) conceal(railOf(sections, k))
  for (const s of sections) {
    if (!FOLLOWS[s.dataset.rail]) continue
    if (res.status === 'ok') paintFollows(s, res.follows)
    else if (res.status === 'empty') lockedCardNote(s, 'You follow nobody yet', `Follow a few boosters on the Members tab and their ${s.dataset.rail === 'follows' ? 'shows' : 'songs'} will rank here.`)
    else lockedCardNote(s, 'Your follow list could not be read', 'The relays did not answer. Reload to try again.')
  }
  if (res.pubkey) {
    const api = await favoritesApi()
    if (my !== personalRun) return
    // The list is read lazily and only where a heart is on the page; this
    // page has none, so ask, and wait for it (bounded) so the first answer
    // carries the follows: painted off the boosts alone, a new member's
    // carrot said "boost or follow a podcast" for the seconds the read
    // took. A read that outlasts the wait still lands through
    // ob:favorites-read.
    let feeds = api?.feeds?.() || []
    if (api?.ensureRead) {
      feeds = await Promise.race([api.ensureRead().catch(() => feeds), new Promise((r) => setTimeout(() => r(null), FAVORITES_WAIT_MS))]) ?? (api.feeds?.() || [])
    }
    if (my !== personalRun) return
    paintRecommended(sections, res.pubkey, feeds)
    paintLatest(sections, feeds, { pubkey: res.pubkey })
  }
}

/* The favorites list, read: repaint the recommendations with it as seeds
   when it names feeds the last request did not carry. Also fires on a
   favorite made on this page (favorites-ui reloads after a publish), so the
   rails follow a heart press. */
function onFavoritesRead(e) {
  const d = e.detail || {}
  const { sections, pubkey } = lastRecommend
  if (!sections) return
  // Signed in: this account's trusted read. Signed out: the imported list.
  const mine = pubkey ? (d.trusted && d.pubkey === pubkey) : (d.local && !d.pubkey)
  if (!mine) return
  const feeds = Array.isArray(d.feeds) ? d.feeds : []
  if (!feeds.length || feeds.join(',') === lastRecommend.feeds) return
  paintRecommended(sections, pubkey, feeds)
  paintLatest(sections, feeds, { local: !pubkey, pubkey })
}
window.addEventListener('ob:favorites-read', onFavoritesRead)

/* The favorites controller, which nav.js loads lazily; awaited here so an
   early click or an early paint never finds window.OBFavorites missing. The
   same module URL, so the same instance. */
async function favoritesApi() {
  try { await import('/assets/js/favorites-ui.js?v=ob-v266') } catch {}
  return window.OBFavorites || null
}

/* The Import OPML button on the locked cards, and the Manage link a rail
   painted from an imported list carries (2026-11-07). */
document.addEventListener('click', async (e) => {
  const b = e.target && e.target.closest && e.target.closest('[data-opml-import], [data-opml-manage]')
  if (!b) return
  e.preventDefault()
  const api = await favoritesApi()
  if (b.hasAttribute('data-opml-manage')) api?.manageOpml?.(); else api?.importOpml?.()
})

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
/* ── 5. The rank explainer ─────────────────────────────────────────────── */
/* What each ranked rail ranks, and over which window. The keys are the
   rails' (and their hero slides') own; a lang slot is the year's podcasts
   in one language. The weekly chart is the Pacific week; every other
   window is trailing, which is what the rail's chart link opens. */
const NOUN = { shows: 'podcast', albums: 'album', episodes: 'podcast episode', songs: 'song' }
const WINDOW = {
  week: ['this week', 'in the last 7 days'],
  month: ['this month', 'in the last 30 days'],
  year: ['this year', 'in the last 365 days'],
}
function railScope(key, el) {
  /* Movers' hero slide prints the show's place on this week's chart. */
  if (key === 'shows-week' || key === 'movers') return { noun: 'podcast', when: 'this week', span: 'since Monday, US Pacific time' }
  if (/^lang-\d$/.test(key)) {
    const lang = document.querySelector(`[data-rail="${key}"] h2[data-lang]`)?.dataset.lang
    return { noun: `${lang ? languageName(lang) + ' ' : ''}podcast`, when: WINDOW.year[0], span: WINDOW.year[1] }
  }
  const m = /^(shows|albums|episodes|songs)-(week|month|year)$/.exec(key)
  return m ? { noun: NOUN[m[1]], when: WINDOW[m[2]][0], span: WINDOW[m[2]][1] } : null
}
const ordinal = (n) => {
  const v = n % 100
  return n + (v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'))
}
const FIG_WHAT = { sats: 'sats', boosts: 'boosts', boosters: 'boosters (different people boosting)' }
let openNote = null
function closeNote() { openNote?.fig.removeAttribute('aria-expanded'); openNote?.note.remove(); openNote = null }
function explain(fig) {
  if (openNote?.fig === fig) { closeNote(); return }
  closeNote()
  const what = scopeOf(fig)
  if (!what) return
  const { scope, k, n } = what
  const note = document.createElement('div')
  note.className = 'rt-note'
  note.id = 'rt-note'
  note.setAttribute('role', 'dialog')
  note.setAttribute('aria-label', `Ranked ${ordinal(n)} in ${k} ${scope.when}`)
  const head = Object.assign(document.createElement('strong'), { textContent: `Ranked ${ordinal(n)} in ${k} ${scope.when}` })
  const body = Object.assign(document.createElement('p'), {
    textContent: `Of every ${scope.noun} boosted ${scope.when} (${scope.span}), it received ${n === 1 ? 'the most' : `the ${ordinal(n)} most`} ${FIG_WHAT[k]} in the index. Its chart place adds its ranks in sats, boosts and boosters.`,
  })
  const more = Object.assign(document.createElement('a'), { href: '/about#charts', textContent: 'How the chart works' })
  note.append(head, body, more)
  document.body.append(note)
  const r = fig.getBoundingClientRect()
  const w = note.offsetWidth
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, document.documentElement.clientWidth - w - 8))
  const below = r.bottom + 8 + note.offsetHeight < window.innerHeight
  note.style.left = `${left + window.scrollX}px`
  note.style.top = `${(below ? r.bottom + 6 : r.top - note.offsetHeight - 6) + window.scrollY}px`
  fig.setAttribute('aria-expanded', 'true')
  fig.setAttribute('aria-controls', note.id)
  /* Where the page and the figure's rail stood at opening: a scroll closes
     the note only once it has really moved, so a rail still gliding after
     a flick on a phone does not close it the instant it opens. */
  const track = fig.closest('.rail-list')
  openNote = { fig, note, y: window.scrollY, x: track?.scrollLeft ?? 0, track }
}
/* The figure's place and its rail's window, or null when there is nothing
   to explain; then the click is left alone and follows the tile's link. */
function scopeOf(fig) {
  const key = fig.closest('[data-rail]')?.dataset.rail || fig.closest('[data-slide]')?.dataset.slide
  const scope = railScope(key || '', fig)
  const k = fig.dataset.fig
  const n = Number(fig.dataset.place)
  return scope && FIG_WHAT[k] && n > 0 ? { scope, k, n } : null
}
document.addEventListener('click', (e) => {
  const fig = e.target.closest?.('.rt-ranks .rt-fig')
  if (fig && scopeOf(fig)) { e.preventDefault(); e.stopPropagation(); explain(fig); return }
  if (openNote && !openNote.note.contains(e.target)) closeNote()
}, true)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const f = openNote?.fig; closeNote(); f?.focus(); return }
  const fig = (e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.rt-ranks .rt-fig')
  if (fig && scopeOf(fig)) { e.preventDefault(); e.stopPropagation(); explain(fig) }
}, true)
document.addEventListener('scroll', () => {
  if (!openNote) return
  const moved = Math.abs(window.scrollY - openNote.y) + Math.abs((openNote.track?.scrollLeft ?? 0) - openNote.x)
  if (moved > 24) closeNote()
}, { capture: true, passive: true })
window.addEventListener('resize', closeNote)

window.addEventListener('lb:session-change', paintPersonal)
window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') paintPersonal() })
