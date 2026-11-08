/* boosted-rails.js — what one member boosts, as rails, two-sided.
 *
 * /booster/<npub>'s four fact rails for every reader who is not the member
 * (Reed's call, 2026-11-08: the recommendations are the member's own view;
 * a visitor to a member's page gets what that member boosts, in the
 * homepage's shape): Podcasts Boosted, Albums Boosted, Episodes Boosted,
 * Songs Boosted, each ranked by the sats this member sent, the figure under
 * the title. The two rollups these replace ("Shows and Albums Boosted",
 * "Episodes and Songs Boosted") were deliberately NOT split on medium until
 * 2026-11-07; the split is Reed's ask of 2026-11-08, one rail per side.
 *
 * Rendered at the edge by functions/booster/[npub].js from two GROUP BY
 * queries over the member's boosts; nothing in the browser repaints them.
 *
 * ⚠️ IMPORTS ITS SIBLING AS './rail-tile.js?v=…' like every two-sided module.
 * No Date.now(), no locale. */
import { tileHtml, railListHtml, kSats } from './rail-tile.js?v=ob-v264'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const isMusic = (r) => String(r?.medium || 'podcast') === 'music'
const line = (r) => `${kSats(r.sats)} sats · ${Number(r.boosts) || 0} boost${Number(r.boosts) === 1 ? '' : 's'}`

/** A show row: { guid, title, img, art2, medium, sats, boosts }. */
export function boostedShowTile(r, i) {
  return tileHtml({
    rank: i + 1,
    href: `/show/${encodeURIComponent(r.guid)}`,
    title: r.title || 'Untitled show',
    sub: line(r),
    img: r.img, art2: r.art2, glyph: isMusic(r) ? '💿' : '🎙',
  })
}

/** An episode row: { guid, title, img, show: { guid, title, img, art2, medium }, sats, boosts }. */
export function boostedEpisodeTile(r, i) {
  const title = r.title || r.show?.title || 'Untitled episode'
  return tileHtml({
    rank: i + 1,
    href: `/episode/${encodeURIComponent(r.guid)}`,
    title,
    sub: line(r),
    img: r.img || r.show?.img, art2: r.show?.art2, glyph: isMusic(r.show) ? '🎵' : '🎙',
  })
}

function rail(key, title, sub, list) {
  return `
    <section class="rail" data-rail="${esc(key)}" aria-labelledby="rail-${esc(key)}">
      <div class="rail-head">
        <h2 id="rail-${esc(key)}">${esc(title)}</h2>
        <span class="rail-sub">${esc(sub)}</span>
      </div>
      <div class="rail-track">${list}</div>
    </section>`
}

const LIMIT = 20

/** The two show rails' HTML (podcasts, then albums), '' with nothing to show. */
export function boostedShowRailsHtml(rows) {
  const pods = (rows || []).filter((r) => !isMusic(r)).slice(0, LIMIT)
  const albums = (rows || []).filter(isMusic).slice(0, LIMIT)
  const out = []
  if (pods.length) out.push(rail('boosted-podcasts', 'Podcasts Boosted', 'Ranked by the sats this member has sent each one', railListHtml(pods.map(boostedShowTile))))
  if (albums.length) out.push(rail('boosted-albums', 'Albums Boosted', 'Ranked by the sats this member has sent each one', railListHtml(albums.map(boostedShowTile))))
  return out.join('')
}

/** The two episode rails' HTML (episodes, then songs), '' with nothing to show. */
export function boostedEpisodeRailsHtml(rows) {
  const eps = (rows || []).filter((r) => !isMusic(r.show)).slice(0, LIMIT)
  const songs = (rows || []).filter((r) => isMusic(r.show)).slice(0, LIMIT)
  const out = []
  if (eps.length) out.push(rail('boosted-episodes', 'Episodes Boosted', 'Ranked by the sats this member has sent each one', railListHtml(eps.map(boostedEpisodeTile))))
  if (songs.length) out.push(rail('boosted-songs', 'Songs Boosted', 'Ranked by the sats this member has sent each one', railListHtml(songs.map(boostedEpisodeTile))))
  return out.join('')
}
