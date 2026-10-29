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
import { coverChain } from './cover-art.js?v=ob-v239'
import { rankLabel } from './rank.js?v=ob-v239'
import { showPageHref, episodePageHref, publisherPageHref } from './show-link.js?v=ob-v239'
import { boosterPageHref } from './booster-link.js?v=ob-v239'
import { languageName } from './lang-name.js?v=ob-v239'

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

/** "38.8k sats · 7 boosters", the one figure line an unranked tile carries.
 *  Sats first: the site's one order for the three figures is sats, boosts,
 *  boosters (Reed's call, 2026-10-29), and this line names two of them. */
export function statsLine({ boosters, sats }) {
  const parts = []
  if (sats != null) parts.push(`${kSats(sats)} sats`)
  if (boosters != null) parts.push(`${Number(boosters)} booster${Number(boosters) === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/**
 * The chart triplet under a charted tile — rank in sats / boosts / boosters,
 * which is the chart formula's own order and the order the detail pages'
 * stat tiles print (Reed's call, 2026-10-29: one order for the three figures
 * everywhere; it was sats / boosters / boosts until then). It says WHY a
 * tile is where it is. Reed's call, 2026-10-17: the "7 boosters · 38.8k
 * sats" line was unreadable at tile size. Reads either the weekly chart's
 * `r_*` columns or a ranked endpoint's `chart` object; null when the row
 * carries neither. Returns the three places as numbers; `rankTriplet` is the
 * plain-text form, `rankTripletHtml` the iconed one the tiles and the hero
 * print.
 */
function tripletOf(r) {
  const c = r && r.chart
  if (c && c.sats != null) return { sats: c.sats, boosts: c.boosts, boosters: c.boosters }
  if (r && r.r_sats != null) return { sats: r.r_sats, boosts: r.r_boosts, boosters: r.r_boosters }
  return null
}
export function rankTriplet(r) {
  const t = tripletOf(r)
  return t ? `${t.sats}/${t.boosts}/${t.boosters}` : null
}
export const TRIPLET_TITLE = 'Rank in sats / boosts / boosters'

/* ⚠️ ONE ICON PER FIGURE, AND THE SAME THREE WHEREVER THE TRIPLET IS PRINTED
 * (Reed's ask, 2026-10-29: the words do not fit at tile size, so a Bitcoin
 * sign marks sats, a speech bubble boosts and a person boosters). Lucide's
 * shapes (ISC), stroked in currentColor so they take the line's colour in
 * both themes. Each figure carries its own tooltip and the icon is hidden
 * from assistive tech, the tooltip's words being the label. */
const SVG = (d) => `<svg class="rt-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`
export const FIGURE_ICONS = {
  sats: SVG('<path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727"/>'),
  boosts: SVG('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  boosters: SVG('<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>'),
}
/* ⚠️ THE MEDIUM BADGE ON THE ARTWORK (Reed's ask, 2026-10-29): a rail can
 * mix the two sides (New and Noteworthy, Podcasters Recommend), and a reader
 * who opens an album expecting a show is surprised, so every content tile
 * says which side it is on, a microphone or a music note in the artwork's
 * top-right corner, opposite the rank. The partition rule applies: anything
 * not `music` is the podcast side. A person's tile carries none. */
const MEDIUM_BADGE = {
  podcast: { word: 'Podcast', svg: SVG('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>') },
  music: { word: 'Music', svg: SVG('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>') },
}
export const mediumSide = (m) => (m === 'music' ? 'music' : 'podcast')
function mediumBadge(medium) {
  const b = medium && MEDIUM_BADGE[mediumSide(medium)]
  return b ? `<span class="rt-medium rt-medium--${mediumSide(medium)}" title="${b.word}"><span class="rt-sr">${b.word}: </span>${b.svg}</span>` : ''
}

const FIGURE_WORD = { sats: 'sats', boosts: 'boosts', boosters: 'boosters' }
export function rankTripletHtml(r) {
  const t = tripletOf(r)
  if (!t) return null
  return ['sats', 'boosts', 'boosters'].map((k) =>
    `<span class="rt-fig" title="#${esc(t[k])} in ${FIGURE_WORD[k]}">${FIGURE_ICONS[k]}<span class="rt-sr">Rank in ${FIGURE_WORD[k]}: </span>${esc(t[k])}</span>`
  ).join('')
}

/**
 * One tile. `rank`/`tied` come from the server's ranking (never re-derived
 * here); `href` null renders the tile as a plain figure rather than a dead
 * link. `glyph` is the no-artwork fallback text (a medium's emoji). `sub`
 * is the one line under the title; `subTitle` its tooltip; `gold` marks the
 * rank badge (a #40HPW member over the goal).
 */
export function tileHtml({ rank = null, tied = false, href = null, title, sub = '', subHtml = '', subTitle = '', subClass = '', img = null, art2 = null, glyph = '🎙', gold = false, person = false, medium = null }) {
  const chain = coverChain(img, art2)
  const media = chain.length
    ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(chain[0])}"${attr('data-art2', chain[1])} />`
    : `<span class="rt-glyph" aria-hidden="true">${esc(glyph)}</span>`
  const badge = rank != null
    ? `<span class="rt-rank${gold ? ' rt-rank--gold' : ''}"${tied ? ' data-tied="1"' : ''}>${esc(rankLabel(rank, tied))}</span>`
    : ''
  const inner =
    `<span class="rt-media${chain.length ? '' : ' rt-media--none'}">${media}${badge}${person ? '' : mediumBadge(medium)}</span>` +
    `<span class="rt-title">${esc(title || 'Untitled')}</span>` +
    (subHtml || sub ? `<span class="rt-sub${subClass ? ' ' + subClass : ''}"${attr('title', subTitle)}>${subHtml || esc(sub)}</span>` : '')
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
  const t = rankTripletHtml(r)
  return t ? { subHtml: t, subClass: 'rt-ranks' } : { sub: fallback }
}
export function showTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: showPageHref(r.guid),
    title: r.title,
    ...subOf(r, statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats })),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎙', medium: r.medium || 'podcast',
  })
}
export function albumTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: showPageHref(r.guid),
    title: r.title,
    ...subOf(r, r.author || statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats })),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎵', medium: 'music',
  })
}
export function episodeTile(r, i, glyph = '🎙') {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: episodePageHref(r.guid, r.title),
    title: r.title,
    ...subOf(r, r.show?.title || statsLine({ boosters: r.boosters, sats: r.sats })),
    img: r.img || r.show?.img, art2: r.show?.art2, glyph,
    medium: r.show?.medium || (glyph === '🎵' ? 'music' : 'podcast'),
  })
}
export function artistTile(r, i) {
  return tileHtml({
    rank: r.rank ?? i + 1, tied: !!r.tied,
    href: publisherPageHref(r.guid),
    title: r.title,
    ...subOf(r, statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats })),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎤', medium: 'music',
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

/* ── A LANGUAGE RAIL, head and track together (2026-10-22, Reed's ask: the
 * year's top podcasts in each of the three largest non-English languages).
 * The heading names the language, so the whole inside of the <section> is
 * rendered here rather than the track alone: functions/index.js fills the
 * section's marker pair with this and discover.js rebuilds it with the same
 * call when the edge could not. `n` is the slot (1..3), which is the
 * heading's id (`rail-lang-<n>`), the address the nav's Discover column
 * links. ── */
export function langChartHref(lang) {
  return `/podcasts/shows?range=1y&lang=${encodeURIComponent(lang)}`
}
export function langRailTitle(lang) {
  return `Top ${languageName(lang)} Podcasts This Year`
}
export function langRailHtml(n, lang, rows) {
  const href = langChartHref(lang)
  return `<div class="rail-head"><h2 id="rail-lang-${Number(n)}"><a href="${esc(href)}">${esc(langRailTitle(lang))}</a></h2>` +
    `<a class="rail-more" href="${esc(href)}">View the chart →</a></div>` +
    `<div class="rail-track">${railListHtml(rows.map(showTile), { empty: `No ${languageName(lang)}-language podcasts boosted this year.` })}</div>`
}
