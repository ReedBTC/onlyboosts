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
 * The headings say "you" on every page, the homepage's wording (Reed's call,
 * 2026-11-07, over "Because Reed boosted": the page's reader is nearly
 * always the member).
 *
 * ⚠️ IMPORTS ITS SIBLING AS './rail-tile.js?v=…' like every two-sided module;
 * the Function reaches it by relative path and esbuild inlines it. No
 * Date.now(), no locale. */
import { railListHtml, showTile, albumTile, latestTile, bare, lockedRailHtml } from './rail-tile.js?v=ob-v274'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** The verb a Because rail's heading uses for its seed. */
export function becauseVerb(seed, why) {
  if (why === 'follow') return seed?.medium === 'music' ? 'favorited' : 'follow'
  return 'boosted'
}

/* ⚠️ THE CARROT'S COPY, ONE TABLE FOR BOTH PAGES (Reed's asks of 2026-11-08:
   one locked rail in place of four for a signed-out visitor, kept up as
   "advertising space" until the member has a seed on both sides and a list,
   and the same on the member's own page). The homepage's discover.js paints
   it into its static rail; /booster renders it through carrotRailHtml for the
   owner. The login and import buttons are delegated on both pages. */
export const LOGIN_BTN = '<button type="button" class="ob-cta" data-lb-login-trigger>Log in</button>'
export const IMPORT_BTN = '<button type="button" class="ob-cta ob-cta--quiet" data-opml-import>Import OPML</button>'
export const browse = (href, text) => `<a class="ob-cta ob-cta--quiet" href="${href}">${text}</a>`
export const CARROT_SUB = 'Podcasts and music from your boosts, your follows and your podcast app\'s subscriptions'
export const CARROT = {
  'loading': {
    h2: 'Recommended For You',
    h3: 'Loading your follows and favorites…',
    p: 'Your Nostr follow list and your follows and favorites are being read from the relays. Your rails appear here as they arrive.',
    actions: '',
  },
  'signed-out': {
    h2: 'Recommended For You',
    h3: 'Log in or import your OPML for personalized recommendations',
    p: 'The newest episodes of the podcasts you follow, podcasts and music recommended from what you boost, and the top podcasts and songs from the accounts you follow on Nostr. No account? Import your podcast app\'s subscription list instead.',
    actions: LOGIN_BTN + IMPORT_BTN,
  },
  'imported': {
    h2: 'More Recommendations',
    h3: 'Log in with Nostr to see what your follows boost',
    p: 'Your imported list lives in this browser. Log in and it is saved to your Nostr follows and favorites, and two more rails appear: the top podcasts and songs from the accounts you follow.',
    actions: LOGIN_BTN,
  },
  'no-seeds': {
    h2: 'More Recommendations',
    h3: 'Boost or follow a podcast, or favorite an album, for personalized recommendations',
    p: 'Podcasts Recommended For You is built from the podcasts you boost and follow, Music Recommended For You from the albums you boost and favorite: what else their boosters boost, minus what you already have. The podcasts you follow get a rail of their newest episodes. Your podcast app\'s OPML counts too.',
    actions: IMPORT_BTN + browse('/podcasts/shows', 'Browse podcasts'),
  },
  'no-list': {
    h2: 'More Recommendations',
    h3: 'You haven\'t followed or favorited anything yet',
    p: 'Your boosts seed these rails. Follow the podcasts you listen to and favorite the albums you like: each one adds to the recommendations, the podcasts you follow get a rail of their newest episodes, and the list goes with you to every Podcasting 2.0 app that reads it. Importing your podcast app\'s OPML follows them all at once.',
    actions: IMPORT_BTN + browse('/podcasts/shows', 'Browse podcasts') + browse('/music/albums', 'Browse albums'),
  },
  'no-podcasts': {
    h2: 'More Recommendations',
    h3: 'You haven\'t boosted or followed a podcast yet',
    p: 'Boost or follow one and Podcasts Recommended For You appears here: the podcasts boosted by the members who boost the same podcasts you do. Your podcast app\'s OPML counts too.',
    actions: IMPORT_BTN + browse('/podcasts/shows', 'Browse podcasts'),
  },
  'no-music': {
    h2: 'More Recommendations',
    h3: 'You haven\'t favorited any music yet',
    p: 'Favorite an album or boost a song and Music Recommended For You appears here: the albums boosted by the members who boost the same music you do.',
    actions: browse('/music/albums', 'Browse albums'),
  },
}
/** Which carrot a member sees, or null for one with a seed on both sides and
 *  a list. `sides` is the endpoint's seed count per medium side. */
export function carrotState({ signedIn, imported = false, sides = null, pods = 0, albums = 0, listEmpty = true }) {
  if (!signedIn) return imported ? 'imported' : 'signed-out'
  const hasPod = (sides?.podcast > 0) || pods > 0
  const hasMusic = (sides?.music > 0) || albums > 0
  if (!hasPod && !hasMusic) return 'no-seeds'
  if (listEmpty) return 'no-list'
  if (!hasPod) return 'no-podcasts'
  if (!hasMusic) return 'no-music'
  return null
}
/* An empty Recommended rail is a hook, not a shrug (Reed, 2026-11-08): no
   seed on the side, what makes one; seeds but no overlap, that it grows. */
export const HOOKS = {
  podcastsNone: { title: 'No podcasts to recommend from yet', text: 'Boost or follow a podcast and the podcasts its other boosters boost will rank here. Your podcast app\'s OPML counts too.', actions: IMPORT_BTN + browse('/podcasts/shows', 'Browse podcasts') },
  podcastsThin: { title: 'Nothing to recommend yet', text: 'Too few other members have boosted the podcasts you boost and follow for the overlap to mean anything yet. Every boost and follow grows it.', actions: browse('/podcasts/shows', 'Browse podcasts') },
  musicNone: { title: 'No music to recommend from yet', text: 'Boost a song or favorite an album and the albums its other boosters boost will rank here.', actions: browse('/music/albums', 'Browse albums') },
  musicThin: { title: 'Nothing to recommend yet', text: 'Too few other members have boosted the albums you boost and favorite for the overlap to mean anything yet. Every boost and favorite grows it.', actions: browse('/music/albums', 'Browse albums') },
}
/** The carrot as a rail of its own (the owner's /booster). */
export function carrotRailHtml(state) {
  const c = CARROT[state]
  if (!c) return ''
  return rail('personal', esc(c.h2), esc(CARROT_SUB), lockedRailHtml({ title: c.h3, text: c.p, actions: c.actions }))
}

/** Latest From Podcasts You Follow on the owner's /booster (2026-11-08,
 *  Reed's ask: the homepage draws ten, the member's own page the long rail).
 *  `more` appends the View more tile, the last tile of the track, which
 *  booster-page.js answers by asking the endpoint for a larger page. */
export const LATEST_SUB = 'The newest episodes of the podcasts on your follows list, from Podcast Index'
export const MORE_TILE = '<li class="rail-tile rail-tile--more"><button type="button" class="rt rt-more" data-latest-more><span class="rt-media rt-media--more">View more</span></button></li>'
export function latestRailHtml(episodes, { more = false } = {}) {
  const tiles = (episodes || []).map(latestTile)
  if (more && tiles.length) tiles.push(MORE_TILE)
  return rail('follows-latest', 'Latest From Podcasts You Follow', LATEST_SUB, railListHtml(tiles))
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

/** The rails' HTML, or '' when there is nothing to show. For the OWNER
 *  (`owner`, with `feeds` the list's feed guids), an empty side is its hook
 *  and the carrot follows the rails, as on the homepage (2026-11-08); a
 *  visitor to someone else's page sees neither. */
export function recommendRailsHtml(recs, { owner = false, feeds = [] } = {}) {
  const pods = recs?.podcasts || []
  const music = recs?.music || []
  const because = (recs?.because || []).filter((b) => b?.seed?.guid && b.rows?.length)
  if (!pods.length && !music.length && !because.length && !owner) return ''
  const sides = recs?.sides && typeof recs.sides === 'object' ? recs.sides : null
  const out = []
  const PSUB = 'Podcasts boosted by the members who boost the same podcasts you do'
  const MSUB = 'Music boosted by the members who boost the same albums you do'
  if (pods.length) out.push(rail('recommended', 'Recommended Podcasts', PSUB, railListHtml(pods.map(bare(showTile)))))
  else if (owner) out.push(rail('recommended', 'Recommended Podcasts', PSUB, lockedRailHtml(sides?.podcast > 0 ? HOOKS.podcastsThin : HOOKS.podcastsNone)))
  if (music.length) out.push(rail('recommended-music', 'Recommended Music', MSUB, railListHtml(music.map(bare(albumTile)))))
  else if (owner) out.push(rail('recommended-music', 'Recommended Music', MSUB, lockedRailHtml(sides?.music > 0 ? HOOKS.musicThin : HOOKS.musicNone)))
  because.forEach((b, i) => {
    const t = esc(clip(String(b.seed.title || 'this show'), 80))
    const verb = becauseVerb(b.seed, b.why)
    out.push(rail(`because-${i}`,
      `Because you ${verb} <a href="/show/${encodeURIComponent(b.seed.guid)}">${t}</a>`,
      `What the other boosters of ${t} also boost`, railListHtml(b.rows.map(bare(b.seed.medium === 'music' ? albumTile : showTile)))))
  })
  if (owner) out.push(carrotRailHtml(carrotState({ signedIn: true, sides, pods: pods.length, albums: music.length, listEmpty: !feeds.length })))
  return out.join('')
}
