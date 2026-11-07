/* recommend-rails.js — a member's recommendations as rails, two-sided.
 *
 * The answer of POST /api/v1/recommend ({ podcasts, music, because }) laid
 * out as the homepage's rails: Recommended Podcasts, Recommended Music, then
 * one Because rail per seed. Rendered at the edge by functions/booster/[npub].js
 * for the #recommended section (2026-11-07, Reed's ask: the same sideways
 * shape the homepage uses for everything a signed-in member sees) and again in
 * the browser by booster-page.js once the member's favorites list is read and
 * handed to the endpoint, so both paints come out of one function.
 *
 * Tiles are BARE (title alone): the homepage's rule for the personal rails
 * (Reed's call, 2026-10-29). A Because rail's verb follows the seed: "boosted"
 * for a show the member boosted, "follow" for a podcast on their favorites
 * list and "favorited" for an album there (Reed's wording, 2026-11-07: a
 * podcast is followed, music is favorited, the event underneath is the same).
 *
 * ⚠️ IMPORTS ITS SIBLING AS './rail-tile.js?v=…' like every two-sided module;
 * the Function reaches it by relative path and esbuild inlines it. No
 * Date.now(), no locale. */
import { railListHtml, showTile, albumTile, bare } from './rail-tile.js?v=ob-v251'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** The verb a Because rail's heading uses for its seed. */
export function becauseVerb(seed, why) {
  if (why === 'follow') return seed?.medium === 'music' ? 'favorited' : 'follow'
  return 'boosted'
}

function rail(key, title, sub, list) {
  return `
    <section class="rail" data-rail="${esc(key)}" aria-labelledby="rail-${esc(key)}">
      <div class="rail-head">
        <h2 id="rail-${esc(key)}">${title}</h2>
        <span class="rail-sub">${sub} · <a href="/about#recommendations">How this works</a></span>
      </div>
      <div class="rail-track">${list}</div>
    </section>`
}

/**
 * The rails' HTML, or '' when there is nothing to show. `who` is the
 * member's name as the page prints it ("Reed"), or null for "this member";
 * the caller decides whether the viewer is the member ("you").
 */
export function recommendRailsHtml(recs, who = null) {
  const pods = recs?.podcasts || []
  const music = recs?.music || []
  const because = (recs?.because || []).filter((b) => b?.seed?.guid && b.rows?.length)
  if (!pods.length && !music.length && !because.length) return ''
  const name = esc(who || 'this member')
  const does = who === 'you' ? 'do' : 'does'
  const out = []
  if (pods.length) {
    out.push(rail('recommended', 'Recommended Podcasts',
      `Podcasts boosted by the members who boost the same podcasts ${name} ${does}`, railListHtml(pods.map(bare(showTile)))))
  }
  if (music.length) {
    out.push(rail('recommended-music', 'Recommended Music',
      `Music boosted by the members who boost the same albums ${name} ${does}`, railListHtml(music.map(bare(albumTile)))))
  }
  because.forEach((b, i) => {
    const t = esc(clip(String(b.seed.title || 'this show'), 80))
    const verb = becauseVerb(b.seed, b.why)
    out.push(rail(`because-${i}`,
      `Because ${name} ${verb} <a href="/show/${encodeURIComponent(b.seed.guid)}">${t}</a>`,
      `What the other boosters of ${t} also boost`, railListHtml(b.rows.map(bare(b.seed.medium === 'music' ? albumTile : showTile)))))
  })
  return out.join('')
}
