/* The /show episode drawer's catalogue: every episode Podcast Index has for
 * the show, merged onto the rows the edge rendered.
 *
 * WHY. The edge renders the drawer from D1's `episodes` table, which holds
 * only the episodes carrying an indexed boost — a small slice of most shows'
 * output. Until 2026-09-04 an episode nobody had boosted yet could not be
 * boosted HERE at all; the reader went to Fountain or Boost Me Bitch to send
 * the first one. This module adds the rest of the show's episodes, each with
 * the same Boost button the indexed rows carry (show-page.js wires it through
 * the same /api/value path, which resolves a block for any item guid), so the
 * first boost can start on this page. The boost's note is picked up by the
 * collector on its next cycle, which is what creates the episode's page.
 *
 * WHAT A ROW IS. An INDEXED row (the edge's) keeps its figures, its
 * /episode link and wears the brand outline (`.ep-row--indexed`). A row known
 * only to Podcast Index shows date and duration — never "0 sats", which
 * would be a claim about the episode where the blank is only a statement
 * about our index — links its title to BMB's episode deep link, and carries
 * the Boost button. One chronological list, newest first; the sort control
 * reorders both kinds together and the un-indexed rows sink under every
 * figure-based sort. Reed's calls, 2026-09-04.
 *
 * ⚠️ FETCHED ON INTENT, NEVER ON LOAD. The drawer ships closed and most
 * readers never open it; the catalogue is a Podcast Index call and tens of
 * kilobytes, so it is asked for when the summary is hovered or focused (a
 * prefetch, so the open feels instant) or when the drawer opens, whichever
 * comes first, and exactly once.
 *
 * ⚠️ THIS IS A DELIBERATE EXCEPTION TO THE RENDERING RULE. These rows are
 * facts rendered by JavaScript. They are Podcast Index's facts rather than
 * the site's — nothing here is in D1 and nothing is wanted in a crawler's
 * copy of the page — and the indexed rows still ship in the HTML, so search
 * and a reader with no JavaScript lose nothing they had. Written down in
 * "The Catalogue" in docs/show-pages-spec.md.
 *
 * ⚠️ buildRow RESTATES functions/show/[guid].js#episodeRow. Same element
 * order, same classes, same " · " meta separator, the same fmtDate /
 * fmtDuration (two-sided, in boost-list.js), so the two kinds of row read as
 * one list. A change to one wants the same change to the other.
 *
 * Every string here is third-party (Podcast Index relays the publisher's
 * feed) and reaches the page only as a text node or an attribute set through
 * the DOM — no innerHTML anywhere in this file.
 */
import { fmtDate, fmtDuration } from '/assets/js/boost-list.js?v=ob-v192'
import { bmbEpisodeUrl } from '/assets/js/episode-link.js?v=ob-v192'
import { isSafeUrl } from '/assets/js/nostr-text.js?v=ob-v192'

const API = '/api/catalogue'

// Matches the Function's PI_EPISODE_MAX; the one figure the status line prints.
const PI_EPISODE_MAX = 1000

function el(tag, className) {
  const n = document.createElement(tag)
  if (className) n.className = className
  return n
}

/* One un-indexed row. `show` is the page's boost payload (guid, feed, img). */
function buildRow(ep, show, glyph) {
  const li = el('li', 'ep-row')
  li.dataset.guid = ep.guid
  // boosters,boosts,sats,published — the pack show-page.js's sort reads. Three
  // zeros because the site has no figures for this episode, not because they
  // are zero; nothing prints them.
  li.dataset.ep = `0,0,0,${ep.date || 0}`

  const src = (ep.img && isSafeUrl(ep.img) && ep.img) || (show.img && isSafeUrl(show.img) && show.img) || null
  if (src) {
    const img = el('img', 'ep-art')
    img.src = src
    img.alt = ''
    img.width = 44
    img.height = 44
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    li.appendChild(img)
  } else {
    const blank = el('span', 'ep-art ep-art--blank')
    blank.setAttribute('aria-hidden', 'true')
    blank.textContent = glyph
    li.appendChild(blank)
  }

  const main = el('div', 'ep-main')
  const title = el('p', 'ep-title')
  const name = ep.title || 'Untitled episode'
  const bmb = bmbEpisodeUrl({ itemGuid: ep.guid, podcastGuid: show.guid })
  if (bmb) {
    const a = el('a', 'ep-title-link')
    a.href = bmb
    a.target = '_blank'
    a.rel = 'noopener'
    a.title = `${name} on Boost Me Bitch`
    a.textContent = name
    title.appendChild(a)
  } else {
    title.textContent = name
  }
  main.appendChild(title)

  const meta = el('p', 'ep-meta')
  meta.textContent = [fmtDate(ep.date), fmtDuration(ep.dur)].filter(Boolean).join(' · ')
  main.appendChild(meta)
  li.appendChild(main)

  const btn = el('button', 'btn btn-boost btn-sm')
  btn.type = 'button'
  btn.setAttribute('data-ep-boost', ep.guid)
  btn.setAttribute('data-ep-title', ep.title || '')
  btn.hidden = true
  btn.textContent = 'Boost'
  li.appendChild(btn)
  return li
}

/**
 * @param {object} p
 * @param {object} p.show    The page's boost payload: { guid, feed, img, title }.
 * @param {function} p.onRows Called with the new <li> elements once they are in
 *                            the list, so the sort can adopt them and the
 *                            Boost buttons can be wired.
 */
export function initEpisodeCatalogue({ show, onRows } = {}) {
  const root = document.querySelector('[data-episode-drawer][data-catalogue]')
  if (!root || !show?.guid) return
  const list = root.querySelector('.ep-list')
  if (!list) return
  const status = root.querySelector('[data-ep-status]')
  const summary = root.querySelector('summary')
  const glyph = root.dataset.glyph || '🎙'

  function setStatus(text) {
    if (!status) return
    status.textContent = text
    status.hidden = !text
  }

  let started = false
  async function load() {
    if (started) return
    started = true
    setStatus('Loading episodes…')
    list.setAttribute('aria-busy', 'true')

    let data = null
    try {
      const qs = new URLSearchParams({ podcastGuid: show.guid })
      if (show.feed) qs.set('feedUrl', show.feed)
      const resp = await fetch(`${API}?${qs}`, { headers: { Accept: 'application/json' } })
      if (resp.ok) data = await resp.json()
    } catch { /* answered below */ }
    list.removeAttribute('aria-busy')

    const eps = Array.isArray(data?.episodes) ? data.episodes : []
    if (!eps.length) {
      // The indexed rows are still there and still right; only the rest of the
      // catalogue is missing, and the line says so without dressing it up.
      setStatus('Couldn’t load the rest of this show’s episodes.')
      return
    }

    const have = new Set(Array.from(list.querySelectorAll('.ep-row[data-guid]'), (r) => r.dataset.guid))
    const fresh = []
    for (const ep of eps) {
      if (!ep || typeof ep.guid !== 'string' || !ep.guid || have.has(ep.guid)) continue
      have.add(ep.guid)
      fresh.push(buildRow(ep, show, glyph))
    }
    root.querySelector('[data-ep-empty]')?.remove()
    if (fresh.length) {
      const frag = document.createDocumentFragment()
      for (const li of fresh) frag.appendChild(li)
      list.appendChild(frag)
    }
    // A statement about the LIST, not an episode count for the show: PI's
    // ceiling is the one number a reader needs to know is in play.
    setStatus(data.truncated ? `Showing the most recent ${PI_EPISODE_MAX.toLocaleString('en-US')} episodes.` : '')
    if (fresh.length) onRows?.(fresh)
  }

  if (summary) {
    summary.addEventListener('pointerenter', load, { once: true })
    summary.addEventListener('focus', load, { once: true })
  }
  root.addEventListener('toggle', () => { if (root.open) load() })
  if (root.open) load()
}
