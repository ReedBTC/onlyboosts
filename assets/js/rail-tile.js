/* The discovery homepage's tile and rail — FACTS, two-sided.
 *
 * A rail is a row of square artwork tiles with a rank badge, a title and one
 * line under it; the homepage Function renders every fact rail with this and
 * discover.js rebuilds a rail with the same function when the edge could not,
 * or when a rail is personal (Follows, Recommended) and can only be built in
 * the browser. Same source on both sides, byte-identical by construction —
 * see "One Module, Imported From Both Sides" in CLAUDE.md.
 *
 * ⚠️ TWO-SIDED RULES: siblings are imported as './x.js?v=…' (the stamper
 * rewrites the version), no clock reads, no unpinned locale, nothing from the
 * DOM. Verbs (the artwork fallback walk) are attached by discover.js.
 */
import { coverChain } from './cover-art.js?v=ob-v219'
import { rankLabel } from './rank.js?v=ob-v219'
import { showPageHref, episodePageHref, publisherPageHref } from './show-link.js?v=ob-v219'

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
function attr(name, v) { return v ? ` ${name}="${esc(v)}"` : '' }

/** Compact sats: 1234 -> "1.2k", 38849 -> "38.8k", 1500000 -> "1.5M". */
export function kSats(n) {
  n = Number(n) || 0
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

/** "7 boosters · 38.8k sats", the one figure line a ranked tile carries. */
export function statsLine({ boosters, sats }) {
  const parts = []
  if (boosters != null) parts.push(`${Number(boosters)} booster${Number(boosters) === 1 ? '' : 's'}`)
  if (sats != null) parts.push(`${kSats(sats)} sats`)
  return parts.join(' · ')
}

/**
 * One tile. `rank`/`tied` come from the server's ranking (never re-derived
 * here); `href` null renders the tile as a plain figure rather than a dead
 * link. `glyph` is the no-artwork fallback text (a medium's emoji).
 */
export function tileHtml({ rank = null, tied = false, href = null, title, sub = '', img = null, art2 = null, glyph = '🎙' }) {
  const chain = coverChain(img, art2)
  const media = chain.length
    ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(chain[0])}"${attr('data-art2', chain[1])} />`
    : `<span class="rt-glyph" aria-hidden="true">${esc(glyph)}</span>`
  const badge = rank != null
    ? `<span class="rt-rank"${tied ? ' data-tied="1"' : ''}>${esc(rankLabel(rank, tied))}</span>`
    : ''
  const inner =
    `<span class="rt-media${chain.length ? '' : ' rt-media--none'}">${media}${badge}</span>` +
    `<span class="rt-title">${esc(title || 'Untitled')}</span>` +
    (sub ? `<span class="rt-sub">${esc(sub)}</span>` : '')
  return href
    ? `<li class="rail-tile"><a class="rt" href="${esc(href)}">${inner}</a></li>`
    : `<li class="rail-tile"><span class="rt">${inner}</span></li>`
}

/** The row. An empty list renders the rail's own empty line, never nothing. */
export function railListHtml(tiles, { empty = 'Nothing here yet.' } = {}) {
  if (!tiles.length) return `<p class="rail-empty">${esc(empty)}</p>`
  return `<ol class="rail-list">${tiles.join('')}</ol>`
}

/* ── Row → tile, one mapper per subject, so the edge and the browser agree
 * on what a tile says. Each takes the row shape its endpoint answers:
 * the weekly chart's (`image`/`artwork`/`booster_count`) or the ranked
 * endpoints' records (`img`/`art2`/`boosters`); both are accepted so a rail
 * can be rebuilt from either source. `rank`/`tied` are the server's. ── */
export function showTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: showPageHref(r.guid),
    title: r.title,
    sub: statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats }),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎙',
  })
}
export function albumTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: showPageHref(r.guid),
    title: r.title,
    sub: r.author || statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats }),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎵',
  })
}
export function episodeTile(r, i, glyph = '🎙') {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: episodePageHref(r.guid, r.title),
    title: r.title,
    sub: r.show?.title || statsLine({ boosters: r.boosters, sats: r.sats }),
    img: r.img || r.show?.img, art2: r.show?.art2, glyph,
  })
}
export function artistTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: publisherPageHref(r.guid),
    title: r.title,
    sub: statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats }),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎤',
  })
}
