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
import { coverChain } from './cover-art.js?v=ob-v229'
import { rankLabel } from './rank.js?v=ob-v229'
import { showPageHref, episodePageHref, publisherPageHref } from './show-link.js?v=ob-v229'
import { boosterPageHref } from './booster-link.js?v=ob-v229'

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
 * The chart triplet under a charted tile — rank in sats / boosters / boosts,
 * the same figure and the same order the chart view's `cb-ranks` prints
 * (chart-board.js), which is what says WHY a tile is where it is. Reed's
 * call, 2026-10-17: the "7 boosters · 38.8k sats" line was unreadable at
 * tile size. Reads either the weekly chart's `r_*` columns or a ranked
 * endpoint's `chart` object; null when the row carries neither.
 */
export function rankTriplet(r) {
  const c = r && r.chart
  if (c && c.sats != null) return `${c.sats}/${c.boosters}/${c.boosts}`
  if (r && r.r_sats != null) return `${r.r_sats}/${r.r_boosters}/${r.r_boosts}`
  return null
}
export const TRIPLET_TITLE = 'Rank in sats / boosters / boosts'

/**
 * One tile. `rank`/`tied` come from the server's ranking (never re-derived
 * here); `href` null renders the tile as a plain figure rather than a dead
 * link. `glyph` is the no-artwork fallback text (a medium's emoji). `sub`
 * is the one line under the title; `subTitle` its tooltip; `gold` marks the
 * rank badge (a #40HPW member over the goal).
 */
export function tileHtml({ rank = null, tied = false, href = null, title, sub = '', subTitle = '', subClass = '', img = null, art2 = null, glyph = '🎙', gold = false, person = false }) {
  const chain = coverChain(img, art2)
  const media = chain.length
    ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(chain[0])}"${attr('data-art2', chain[1])} />`
    : `<span class="rt-glyph" aria-hidden="true">${esc(glyph)}</span>`
  const badge = rank != null
    ? `<span class="rt-rank${gold ? ' rt-rank--gold' : ''}"${tied ? ' data-tied="1"' : ''}>${esc(rankLabel(rank, tied))}</span>`
    : ''
  const inner =
    `<span class="rt-media${chain.length ? '' : ' rt-media--none'}">${media}${badge}</span>` +
    `<span class="rt-title">${esc(title || 'Untitled')}</span>` +
    (sub ? `<span class="rt-sub${subClass ? ' ' + subClass : ''}"${attr('title', subTitle)}>${esc(sub)}</span>` : '')
  /* A PERSON'S tile is round (Reed's call, 2026-10-18): a face in a circle
     reads as an individual where a square reads as content. The class is
     the only difference; discover.css does the rest. */
  const li = `<li class="rail-tile${person ? ' rail-tile--person' : ''}">`
  return href
    ? `${li}<a class="rt" href="${esc(href)}">${inner}</a></li>`
    : `${li}<span class="rt">${inner}</span></li>`
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
function subOf(r, fallback) {
  const t = rankTriplet(r)
  return t ? { sub: t, subTitle: TRIPLET_TITLE, subClass: 'rt-ranks' } : { sub: fallback }
}
export function showTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: showPageHref(r.guid),
    title: r.title,
    ...subOf(r, statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats })),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎙',
  })
}
export function albumTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: showPageHref(r.guid),
    title: r.title,
    ...subOf(r, r.author || statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats })),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎵',
  })
}
export function episodeTile(r, i, glyph = '🎙') {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: episodePageHref(r.guid, r.title),
    title: r.title,
    ...subOf(r, r.show?.title || statsLine({ boosters: r.boosters, sats: r.sats })),
    img: r.img || r.show?.img, art2: r.show?.art2, glyph,
  })
}
export function artistTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: publisherPageHref(r.guid),
    title: r.title,
    ...subOf(r, statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats })),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎤',
  })
}

/** A #40HPW row (the hours endpoint's member shape) as a tile: the face, the
 *  name, "34.3 HPW · 26 episodes", gold past the goal. Reed's call,
 *  2026-10-17: the rail looks like every other rail, not like the board. */
export function memberTile(m, i, goalHours = 40) {
  const h = Number(m.seconds) / 3600
  const eps = Number(m.episodes) || 0
  return tileHtml({
    rank: i + 1,
    href: boosterPageHref(m.npub, m.pk),
    title: m.name || (m.npub ? m.npub.slice(0, 12) + '…' : 'Unknown'),
    sub: `${h.toFixed(1)} HPW · ${eps} episode${eps === 1 ? '' : 's'}`,
    subTitle: 'Hours of podcasts boosted this week · episodes that counted',
    img: m.pic, glyph: '👤', gold: h >= goalHours, person: true,
  })
}

/** A member from the member search (/api/v1/members?q=) as a tile. */
export function memberSearchTile(m) {
  return tileHtml({
    href: boosterPageHref(m.npub, m.pk),
    title: m.name || (m.npub ? m.npub.slice(0, 12) + '…' : 'Unknown'),
    sub: statsLine({ boosters: null, sats: m.sats }).replace(/^/, m.boosts != null ? `${Number(m.boosts)} boost${Number(m.boosts) === 1 ? '' : 's'} · ` : ''),
    img: m.pic, glyph: '👤', person: true,
  })
}
