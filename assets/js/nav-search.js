/* The site search in the nav bar — the typeahead behind `[data-nav-search]`.
 *
 * Typing two or more characters asks `/api/v1/search?type=all` (shows,
 * episodes and artists in one answer) and `/api/v1/members?q=` (people) and
 * paints a grouped menu under the field. Enter opens the full results page
 * (/search?q=), or the highlighted row when the arrow keys have picked one;
 * Escape closes. Every row is a real link, so the menu works with a mouse, a
 * keyboard or a screen reader without any of this.
 *
 * Loaded on every page by nav.js (a dynamic import, like favorites-ui.js),
 * because the bar is on every page. It mounts nothing until the field exists.
 *
 * ⚠️ WHERE A ROW LINKS IS THE SAME RULE THE CARDS USE: show-link.js decides
 * whether a show, an episode or an artist has a page here. A row the rule
 * declines gets no link and is not shown, rather than a dead click.
 */
import { showPageHref, episodePageHref, publisherPageHref } from './show-link.js?v=ob-v232'

const MIN = 2
const LIMIT = 5
const DEBOUNCE_MS = 160

const GROUPS = [
  { key: 'shows',    label: 'Shows' },
  { key: 'episodes', label: 'Episodes' },
  { key: 'artists',  label: 'Artists' },
  { key: 'members',  label: 'Members' },
]

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function httpsImg(u) {
  if (typeof u !== 'string') return ''
  if (u.startsWith('http://')) return 'https://' + u.slice(7)
  return u.startsWith('https://') || u.startsWith('/') ? u : ''
}

/* Rows out of the two answers, each already carrying its href. */
function rowsOf(all, members) {
  const out = { shows: [], episodes: [], artists: [], members: [] }
  for (const s of all?.shows || []) {
    const href = showPageHref(s.guid)
    if (href) out.shows.push({ href, title: s.title, sub: s.author || '', img: s.img })
  }
  for (const e of all?.episodes || []) {
    const href = episodePageHref(e.guid, e.title)
    if (href) out.episodes.push({ href, title: e.title, sub: e.show?.title || '', img: e.img || e.show?.img })
  }
  for (const a of all?.artists || []) {
    const href = publisherPageHref(a.guid)
    if (href) out.artists.push({ href, title: a.title, sub: 'Artist', img: a.img })
  }
  for (const m of members?.members || []) {
    if (!m.npub) continue
    out.members.push({ href: '/booster/' + encodeURIComponent(m.npub), title: m.name || m.npub.slice(0, 12) + '…', sub: 'Member', img: m.pic })
  }
  return out
}

function menuHtml(rows) {
  let n = 0
  let html = ''
  for (const g of GROUPS) {
    const list = rows[g.key]
    if (!list || !list.length) continue
    html += `<div class="nsm-group"><h4 class="nsm-head">${g.label}</h4>`
    for (const r of list) {
      const img = httpsImg(r.img)
      html += `<a class="nsm-item" role="option" href="${esc(r.href)}" data-idx="${n++}">` +
        (img ? `<img class="nsm-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="nsm-img nsm-img--none" aria-hidden="true"></span>') +
        `<span class="nsm-text"><span class="nsm-title">${esc(r.title)}</span>` +
        (r.sub ? `<span class="nsm-sub">${esc(r.sub)}</span>` : '') +
        `</span></a>`
    }
    html += '</div>'
  }
  if (!n) return '<p class="nsm-empty">Nothing matches here. Press Enter for the full search.</p>'
  return html
}
function allHref(q) { return '/search?q=' + encodeURIComponent(q) }

function mount(form) {
  const input = form.querySelector('input[type="search"]')
  const menu = form.querySelector('.nav-search-menu')
  if (!input || !menu) return
  let timer = 0
  let ctrl = null
  let active = -1
  let seq = 0

  function items() { return Array.from(menu.querySelectorAll('.nsm-item')) }
  function close() {
    menu.hidden = true
    active = -1
    input.setAttribute('aria-expanded', 'false')
  }
  function open() {
    menu.hidden = false
    input.setAttribute('aria-expanded', 'true')
  }
  function highlight(i) {
    const list = items()
    list.forEach((el, k) => el.classList.toggle('is-active', k === i))
    active = list.length ? Math.max(-1, Math.min(i, list.length - 1)) : -1
    if (active >= 0) list[active].scrollIntoView({ block: 'nearest' })
  }

  async function search(q) {
    const my = ++seq
    if (ctrl) ctrl.abort()
    ctrl = new AbortController()
    const { signal } = ctrl
    const enc = encodeURIComponent(q)
    try {
      const [all, members] = await Promise.all([
        fetch(`/api/v1/search?type=all&q=${enc}&limit=${LIMIT}`, { signal }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/v1/members?q=${enc}&limit=4`, { signal }).then((r) => r.ok ? r.json() : null).catch(() => null),
      ])
      if (my !== seq) return
      menu.innerHTML = menuHtml(rowsOf(all, members)) +
        `<a class="nsm-all" href="${esc(allHref(q))}">See all results for “${esc(q)}” →</a>`
      open()
      highlight(-1)
    } catch (e) {
      if (e && e.name === 'AbortError') return
      console.warn('[nav-search]', e)
    }
  }

  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-expanded', 'false')
  input.addEventListener('input', () => {
    clearTimeout(timer)
    const q = input.value.trim()
    if (q.length < MIN) { close(); return }
    timer = setTimeout(() => search(q), DEBOUNCE_MS)
  })
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= MIN && menu.innerHTML) open()
  })
  input.addEventListener('keydown', (e) => {
    if (menu.hidden) {
      if (e.key === 'ArrowDown' && input.value.trim().length >= MIN) { e.preventDefault(); search(input.value.trim()) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1) }
    else if (e.key === 'Escape') { close() }
  })
  /* Enter is the full results page (Reed's call, 2026-10-17: a typed query
     deserves every hit, not the first), unless the reader has walked the
     arrow keys onto a row, in which case it is that row. */
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const list = items()
    if (active >= 0 && list[active]) { location.href = list[active].getAttribute('href'); return }
    const q = input.value.trim()
    if (q.length >= MIN) location.href = allHref(q)
  })
  // A click lands on the row's own link; closing on blur has to wait for it.
  input.addEventListener('blur', () => { setTimeout(close, 180) })
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close() })
}

for (const form of document.querySelectorAll('[data-nav-search]')) mount(form)
