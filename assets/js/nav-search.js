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
 *
 * A PASTED NPUB IS A LOOKUP, NOT A SEARCH (Reed's ask, 2026-10-22: "drop an
 * npub in the search window and it will search for the person who that
 * is"). An npub, a `nostr:npub…` or a 64-hex pubkey asks the member
 * endpoint alone (the FTS tables cannot match one) and the menu answers
 * one of two things: the member's row, or a line saying the account has
 * no boosts in the index, named through Primal's cache when it can be.
 * Enter on a found member opens their page; on a miss, the results page.
 */
import { showPageHref, episodePageHref, publisherPageHref } from './show-link.js?v=ob-v241'

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

/* ── The npub lookup ─────────────────────────────────────────────────── */
const NPUB = /^npub1[02-9ac-hj-np-z]{58}$/i
const HEX64 = /^[0-9a-f]{64}$/i
/** The pasted key with a `nostr:` prefix and whitespace off, or null when
 *  the query is not a key. */
export function pubkeyQuery(q) {
  const s = String(q || '').trim().replace(/^nostr:/i, '')
  return NPUB.test(s) || HEX64.test(s) ? s : null
}
/* npub → hex for the Primal lookup; bech32 as the mention picker writes it
   out, so this module stays free of the nostr-tools bundle. */
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
async function npubToHex(npub) {
  try {
    const data = npub.toLowerCase().slice(5, -6).split('').map((c) => B32.indexOf(c))
    if (data.some((v) => v < 0)) return null
    let acc = 0, bits = 0
    const out = []
    for (const v of data) {
      acc = (acc << 5) | v; bits += 5
      while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff) }
    }
    return out.length === 32 ? out.map((b) => b.toString(16).padStart(2, '0')).join('') : null
  } catch { return null }
}
let primalP = null
async function primalName(pk) {
  try {
    primalP ??= import('./primal-profiles.js?v=ob-v241')
    const { fetchProfiles } = await primalP
    const prof = (await fetchProfiles([pk])).get(pk)
    return prof?.display_name || prof?.name || ''
  } catch { return '' }
}
function missHtml(key, name) {
  const short = key.length > 20 ? key.slice(0, 12) + '…' + key.slice(-6) : key
  return `<div class="nsm-group"><h4 class="nsm-head">Members</h4>` +
    `<p class="nsm-empty nsm-miss">${name ? `<strong>${esc(name)}</strong> (${esc(short)})` : `<strong>${esc(short)}</strong>`} is not in the index: no boost published to Nostr under this account has been indexed yet.</p></div>`
}

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
      const key = pubkeyQuery(q)
      if (key) {
        const members = await fetch(`/api/v1/members?q=${encodeURIComponent(key)}&limit=1`, { signal }).then((r) => r.ok ? r.json() : null).catch(() => null)
        if (my !== seq) return
        const rows = rowsOf(null, members)
        if (rows.members.length) {
          menu.innerHTML = menuHtml(rows)
          open(); highlight(0) // Enter opens the member's page
          return
        }
        menu.innerHTML = missHtml(key, '')
        open(); highlight(-1)
        // Best-effort: Primal's cache names the account the reader pasted.
        const pk = members?.members?.[0]?.pk || (HEX64.test(key) ? key.toLowerCase() : null)
        const name = await primalName(pk || await npubToHex(key))
        if (my === seq && name) menu.innerHTML = missHtml(key, name)
        return
      }
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
    if (q.length >= MIN) location.href = allHref(pubkeyQuery(q) || q)
  })
  // A click lands on the row's own link; closing on blur has to wait for it.
  input.addEventListener('blur', () => { setTimeout(close, 180) })
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close() })
}

for (const form of document.querySelectorAll('[data-nav-search]')) mount(form)
