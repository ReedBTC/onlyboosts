/* The nav bar's section ribbons (2026-10-20, Reed's call after Rotten
 * Tomatoes' section menus): Podcasts, Music and #40HPW (Members until
 * 2026-10-21; the key stays `members`) each open a panel
 * under the bar with two top-five lists, a Discover column of that side's
 * rails, and the first list's #1 at the right.
 *
 * The markup is in partials/nav.html, on every page. Each ribbon is a
 * <details>, so a press on the caret opens it with no script; this module
 * adds what a menu bar expects (open on hover, one open at a time, Escape
 * and an outside click close) and FILLS THE LISTS the first time a ribbon
 * opens. The lists are data and the nav is a partial on static pages too,
 * so they are fetched here rather than rendered at the edge: the links are
 * on the page from the first byte and the lists land a beat after the
 * ribbon opens, from endpoints the browser caches.
 *
 * Loaded on every page by nav.js (a dynamic import, like nav-search.js).
 * Browser-only: not two-sided, so Date.now() is fine here.
 *
 * ⚠️ SOURCES IS KEYED BY THE PARTIAL'S data-ribbon-list VALUES. A key with
 * no slot fetches nothing; a slot with no key stays empty. Where a row
 * links is the cards' rule (show-link.js, booster-link.js), so a row the
 * rule declines is printed without a link rather than with a dead one.
 */
import { showPageHref, episodePageHref } from '/assets/js/show-link.js?v=ob-v248'
import { boosterPageHref } from '/assets/js/booster-link.js?v=ob-v248'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v248'

const HOVER_OPEN_MS = 120
const HOVER_CLOSE_MS = 220

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
const n = (v) => Number(v) || 0
const boosters = (v) => `${n(v)} booster${n(v) === 1 ? '' : 's'}`
const sats = (v) => {
  const s = n(v)
  return (s >= 1e6 ? (s / 1e6).toFixed(1) + 'M' : s >= 1e3 ? (s / 1e3).toFixed(1) + 'k' : String(s)) + ' sats'
}
const memberName = (m) => m.name || (m.npub ? m.npub.slice(0, 12) + '…' : 'Unknown')

/* One entry per list slot: the endpoint, where its rows are, and the row →
 * { title, sub?, href, fig, img, art2?, person?, gold? } mapping. */
const SOURCES = {
  'shows-week': {
    url: '/api/v1/charts/shows?limit=5', rows: (d) => d.rows,
    item: (r) => ({ title: r.title, href: showPageHref(r.guid), fig: boosters(r.booster_count), img: r.image, art2: r.artwork, glyph: '🎙' }),
  },
  'shows-year': {
    url: '/api/v1/podcasts?not_medium=music&sort=chart&range=1y&limit=5', rows: (d) => d.podcasts,
    item: (r) => ({ title: r.title, href: showPageHref(r.guid), fig: boosters(r.boosters), img: r.img, art2: r.art2, glyph: '🎙' }),
  },
  'albums-month': {
    url: '/api/v1/podcasts?medium=music&sort=chart&range=1m&limit=5', rows: (d) => d.podcasts,
    item: (r) => ({ title: r.title, sub: r.author, href: showPageHref(r.guid), fig: boosters(r.boosters), img: r.img, art2: r.art2, glyph: '🎵' }),
  },
  'songs-year': {
    url: '/api/v1/episodes?medium=music&sort=chart&range=1y&limit=5', rows: (d) => d.episodes,
    item: (r) => ({ title: r.title, sub: r.show?.title, href: episodePageHref(r.guid, r.title), fig: boosters(r.boosters), img: r.img || r.show?.img, art2: r.show?.art2, glyph: '🎵' }),
  },
  'hpw-week': {
    url: '/api/v1/members/hours?limit=5', rows: (d) => d.members, goal: (d) => n(d.goal_hours) || 40,
    item: (m, goal) => {
      const h = n(m.seconds) / 3600
      return { title: memberName(m), href: boosterPageHref(m.npub, m.pk), fig: `${h.toFixed(1)} HPW`, img: m.pic, person: true, gold: h >= goal, glyph: '👤' }
    },
  },
  /* The week's biggest boosts: the boost feed ordered by sats, over the
     last seven days (boosts.js's sort=sats). The row names who boosted
     what; the link is the boosted episode's page, or the show's. */
  'boosts-week': {
    url: '/api/v1/boosts?sort=sats&range=1w&limit=5', rows: (d) => d.boosts,
    item: (b) => {
      const who = b.booster?.dname || b.booster?.name || (b.booster?.npub ? b.booster.npub.slice(0, 12) + '…' : 'Someone')
      const what = b.episode?.title || b.podcast?.title || 'a show'
      const href = (b.episode?.guid && b.episode?.title && episodePageHref(b.episode.guid, b.episode.title))
        || (b.podcast?.guid && showPageHref(b.podcast.guid)) || null
      return { title: `${who} → ${what}`, href, fig: sats(b.sats), img: b.booster?.pic, person: true, glyph: '👤' }
    },
  },
}

function artHtml(it, cls) {
  const chain = coverChain(it.img, it.art2)
  return chain.length
    ? `<img class="${cls}" alt="" referrerpolicy="no-referrer" loading="lazy" data-chain="${esc(JSON.stringify(chain))}" data-glyph="${esc(it.glyph || '🎙')}" />`
    : `<span class="${cls} ${cls}--none" aria-hidden="true">${esc(it.glyph || '🎙')}</span>`
}

function rowHtml(it, i) {
  const label = esc(it.title || 'Untitled') + (it.sub ? ` <span class="nav-ribbon-sub">· ${esc(it.sub)}</span>` : '')
  const text = it.href ? `<a href="${esc(it.href)}">${label}</a>` : `<span>${label}</span>`
  return `<li class="${it.person ? 'nav-ribbon-row--person' : ''}${it.gold ? ' nav-ribbon-row--gold' : ''}">`
    + `<span class="nav-ribbon-rank">${i + 1}</span>${artHtml(it, 'nav-ribbon-thumb')}${text}`
    + `<span class="nav-ribbon-fig">${esc(it.fig || '')}</span></li>`
}

/* Set each thumb's src through the cover chain, so a dead image walks to
   art2 and then to the glyph rather than showing a broken icon. */
function wireArt(root) {
  root.querySelectorAll('img[data-chain]').forEach((img) => {
    let chain = []
    try { chain = JSON.parse(img.dataset.chain) } catch { /* no art */ }
    const glyph = img.dataset.glyph || '🎙'
    delete img.dataset.chain
    delete img.dataset.glyph
    const cls = img.className
    wireCoverFallback(img, chain, () => {
      const span = document.createElement('span')
      span.className = `${cls} ${cls}--none`
      span.setAttribute('aria-hidden', 'true')
      span.textContent = glyph
      img.replaceWith(span)
    })
  })
}

async function fillList(ol) {
  const src = SOURCES[ol.dataset.ribbonList]
  if (!src) return null
  const d = await fetch(src.url, { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  const goal = src.goal ? src.goal(d) : 0
  const items = (src.rows(d) || []).slice(0, 5).map((r) => src.item(r, goal))
  ol.innerHTML = items.length ? items.map(rowHtml).join('') : '<li class="nav-ribbon-empty">Nothing yet this period.</li>'
  wireArt(ol)
  return items[0] || null
}

/* The featured block at the right is the FIRST list's #1: its art, large,
   its title and its figure. Round for a person. */
function fillFeatured(ribbon, key, it) {
  const feat = ribbon.querySelector(`[data-ribbon-feat="${key}"]`)
  if (!feat || !it) return
  const art = feat.querySelector('[data-ribbon-feat-art]')
  const title = feat.querySelector('[data-ribbon-feat-title]')
  const line = feat.querySelector('[data-ribbon-feat-line]')
  art.innerHTML = artHtml(it, 'nav-ribbon-feat-img')
  if (it.href) { art.href = it.href; title.href = it.href } else { art.removeAttribute('href'); title.removeAttribute('href') }
  title.textContent = it.title || 'Untitled'
  line.textContent = [it.sub, it.fig].filter(Boolean).join(' · ')
  feat.classList.toggle('nav-ribbon-feat--person', !!it.person)
  feat.classList.toggle('nav-ribbon-feat--gold', !!it.gold)
  wireArt(art)
  feat.hidden = false
}

function fillRibbon(ribbon) {
  if (ribbon.dataset.filled) return
  ribbon.dataset.filled = '1'
  ribbon.querySelectorAll('[data-ribbon-list]').forEach((ol, i) => {
    ol.innerHTML = '<li class="nav-ribbon-empty">Loading…</li>'
    fillList(ol).then((first) => { if (i === 0) fillFeatured(ribbon, ol.dataset.ribbonList, first) })
      .catch((err) => {
        console.warn('[nav] ribbon list failed', ol.dataset.ribbonList, err?.message)
        ol.innerHTML = '<li class="nav-ribbon-empty">Unavailable right now.</li>'
      })
  })
}

export function initRibbons() {
  const ribbons = Array.from(document.querySelectorAll('details.nav-ribbon'))
  if (!ribbons.length) return
  const closeAll = (except) => ribbons.forEach((d) => { if (d !== except && d.open) d.open = false })

  ribbons.forEach((d) => {
    let t = null
    const later = (fn, ms) => { clearTimeout(t); t = setTimeout(fn, ms) }
    d.addEventListener('toggle', () => { if (d.open) { closeAll(d); fillRibbon(d) } })
    // Hover opens and closes with a little intent, as a menu bar does; a
    // touch screen fires neither and uses the caret.
    d.addEventListener('mouseenter', () => later(() => { d.open = true }, HOVER_OPEN_MS))
    d.addEventListener('mouseleave', () => later(() => { d.open = false }, HOVER_CLOSE_MS))
    // Keyboard: leaving the ribbon by Tab closes it.
    d.addEventListener('focusout', (e) => { if (!d.contains(e.relatedTarget)) d.open = false })
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('details.nav-ribbon')) closeAll(null)
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(null) })
}

initRibbons()
