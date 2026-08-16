/* THE EPISODE CARD. One definition, four surfaces, both sides of the wire.
 *
 * ⚠️ THIS FILE IS THE FACTS HALF OF THE RENDERING RULE, and it is the module the
 * rule's one standing exception was closed with. Everything a card shows that
 * comes out of the database and is the same for every visitor is built here, as
 * an HTML STRING, by a function with no DOM and no network — so the identical
 * bytes are produced at the edge by a Pages Function and in the browser by a
 * feed renderer. The verbs live next door in episode-card-actions.js and attach
 * to whatever this produced, wherever it was produced.
 *
 *   facts, here          artwork and its fallback chain, title, show, air date,
 *                        rank, the "Nostr Stats:" line, and the boost notes
 *                        inside the drawer
 *   verbs, next door     the ⋮ subscribe menu, the boost pill, the drawer's
 *                        hide control, the per-boost ⋮ menu, and the
 *                        reply / like / repost / zap bars
 *
 * WHAT THIS REPLACED. `feeds-podcasts.js#episodeCard` built the card as DOM with
 * event listeners closed over an item object, so it existed only as JavaScript
 * and the two sections built from it — `#community-episodes` on /episode/<guid>
 * and `#episodes` on /booster/<npub> — did not exist without it. CLAUDE.md
 * recorded that as the one standing exception to the rendering rule, with
 * instructions to close it rather than add a second. This is the close: three
 * surfaces plus the homepage's default feed now render from one definition, and
 * there is no longer one card plus three call sites that can drift.
 *
 * ⚠️ IMPORTS ARE RELATIVE AND STAMPED, which is what makes a two-sided module
 * possible. `'./show-link.js?v=ob-v61'` resolves in the browser against this
 * module's own stamped URL and yields the stamped absolute form; esbuild strips
 * the query and reads the file off disk when wrangler bundles the Functions. An
 * absolute `/assets/js/…` import works in the browser and cannot be bundled, so
 * it is the one form a module imported from `functions/` may not use.
 * scripts/stamp-assets.js stamps both shapes. Everything imported here is itself
 * dependency-free for the same reason.
 *
 * ⚠️ NO Intl DEFAULTS. Dates are formatted `en-US` in UTC, never in the caller's
 * locale, because a card rendered at the edge and the same card rendered in the
 * browser have to be the same string — that is the whole contract. It is also
 * what functions/_shared/detail-page.js has always done, so the site now has one
 * date format rather than one for the feeds and another for the detail pages.
 */
import { showPageHref, episodePageHref } from './show-link.js?v=ob-v64'
import { episodeBoostLink } from './episode-link.js?v=ob-v64'
import { boosterPageHref, boosterLinkAttrs } from './booster-link.js?v=ob-v64'
import { coverChain } from './cover-art.js?v=ob-v64'
import { htmlEscape, isSafeUrl, renderMessage } from './nostr-text.js?v=ob-v64'

const esc = htmlEscape

// ── Episodes vs Songs ────────────────────────────────────────────────
// Two of the feed bar's options render through this card, and they differ by one
// thing: which side of <podcast:medium> a boost's show falls on. A music feed's
// item is a track on an album, not an episode of a show, so the rollup, the
// ranking and the card are all identical and only the words change. That makes
// the difference a copy table rather than a second renderer.
//
// It lives here rather than in feeds-podcasts.js because the edge renderers need
// it too; that module re-exports it, so nothing that imported it from there had
// to change.
export const COPY = {
  other: {
    untitled: 'Untitled episode',
    listen: 'Listen to this episode',
    dated: 'Episode aired',
    seeAllTitle: 'Every indexed boost to this episode',
    seeAllOutTitle: 'Open this episode on Boost Me Bitch',
    noun: 'episode',
    searchPlaceholder: 'Search episodes…',
    searchLabel: 'Search episodes',
    searchNoun: 'episode',
    rangeLabel: 'Filter by episode air date',
    rangeTitle: (days) => (days ? `Episodes aired in the last ${days} days` : 'All episodes'),
    sortTitle: 'Sort episodes',
    sortDateLabel: 'Latest episode',
    // The line above the search box. A rollup card is an aggregate, so the
    // scope names the corpus the RANKING was computed over rather than which
    // cards survived a filter — see mountFeedNote in feed-controls.js.
    noteGlobal: 'Ranks based on every boost in the index',
    noteFollows: 'Ranks based on only boosts from the accounts you follow',
    moreLabel: (n) => `Load ${n} more episode${n === 1 ? '' : 's'}`,
    loadFail: ['Couldn’t load podcast boosts', 'The boosts feed is unavailable right now — please try again later.'],
    noFollows: ['You’re not following anyone yet', 'Follow some npubs in any Nostr client and the episodes they boost will show up here.'],
    emptyFollows: ['No episodes from your follows yet', 'Nobody you follow has boosted a podcast episode recently. Switch to Global to see everyone.'],
    emptyGlobal: ['No boosted episodes yet', 'When someone boosts a podcast episode on Nostr, it’ll show up here.'],
    emptyWindow: ['No episodes in this window', 'Nothing the community boosted aired in this time range — try a wider one.'],
    outOfRange: 'aired outside this time range — widen the range, or clear the search.',
    // A miss now means three different things, and the old single line ("No
    // matching episode in this view") read as all three at once. On All/Global
    // the search has seen the entire index, so a miss is a COVERAGE boundary and
    // saying "in this view" invites the reader to go looking for a view that
    // holds it; there isn't one until somebody boosts it.
    searchNoneAll: 'No episode matches. The index holds only episodes someone has boosted on Nostr.',
    searchNoneRange: 'No episode matches in this time range. Try All.',
    searchNoneFollows: 'No match among the episodes your follows have boosted. Switch to Global to search everyone.',
  },
  music: {
    untitled: 'Untitled track',
    listen: 'Listen to this track',
    dated: 'Released',
    seeAllTitle: 'Every indexed boost to this track',
    seeAllOutTitle: 'Open this track on Boost Me Bitch',
    noun: 'track',
    searchPlaceholder: 'Search songs…',
    searchLabel: 'Search songs',
    searchNoun: 'song',
    rangeLabel: 'Filter by release date',
    rangeTitle: (days) => (days ? `Songs released in the last ${days} days` : 'All songs'),
    sortTitle: 'Sort songs',
    sortDateLabel: 'Latest release',
    noteGlobal: 'Ranks based on every boost in the index',
    noteFollows: 'Ranks based on only boosts from the accounts you follow',
    moreLabel: (n) => `Load ${n} more song${n === 1 ? '' : 's'}`,
    loadFail: ['Couldn’t load music boosts', 'The boosts feed is unavailable right now — please try again later.'],
    noFollows: ['You’re not following anyone yet', 'Follow some npubs in any Nostr client and the songs they boost will show up here.'],
    emptyFollows: ['No songs from your follows yet', 'Nobody you follow has boosted a music track recently. Switch to Global to see everyone.'],
    emptyGlobal: ['No boosted songs yet', 'When someone boosts a track from a music feed on Nostr, it’ll show up here.'],
    emptyWindow: ['No songs in this window', 'Nothing the community boosted was released in this time range — try a wider one.'],
    outOfRange: 'was released outside this time range — widen the range, or clear the search.',
    searchNoneAll: 'No song matches. The index holds only tracks someone has boosted on Nostr.',
    searchNoneRange: 'No song matches in this time range. Try All.',
    searchNoneFollows: 'No match among the songs your follows have boosted. Switch to Global to search everyone.',
  },
}

export function copyFor(medium) {
  return medium === 'music' ? COPY.music : COPY.other
}

/* ── Which parts of the card a surface shows ──────────────────────────
 *
 * ⚠️ TWO KNOBS, NOT A LICENCE TO FORK THE CARD. The rendering rule in CLAUDE.md
 * draws the line already: the card, its chrome and its boost drawer are
 * identical everywhere, and what may legitimately differ is "which figures are
 * meaningful" and "which sections exist". These are exactly those two.
 *
 * It was FOUR booleans for about an hour — stats, player, subscribe menu, boost
 * rail — and three of them only ever moved together, which is a table that
 * describes 16 cards when the site has two. So:
 *
 *   stats    the "Nostr Stats:" line. OFF on /booster/<npub>, where every card
 *            aggregates ONE person's boosts: "1 booster · 3 boosts" restates the
 *            page's own subject on every row, and the booster count is 1 by
 *            construction. CLAUDE.md names this case verbatim — "a booster page
 *            has no booster count".
 *
 *   layout   'feed' (default) or 'compact'. Compact is the two detail-page
 *            drawers, and it means three things that go together: no inline
 *            <audio>, no ⋮ subscribe menu, and the boost pill in a right-hand
 *            rail of its own rather than at the end of the stats line.
 *
 *            The player and the ⋮ both go for the same reason — every card's
 *            title links to that episode's own page, which carries a player and
 *            a subscribe path on a surface with room for them, where this is a
 *            75vh scroll box inside a page with six other sections. And with the
 *            ⋮ gone the card's right edge is free, which is what lets the pill
 *            sit vertically centred instead of riding the bottom of the card.
 *            On the homepage none of that holds: it is a browsing surface with
 *            no page behind each card, so the card is whole.
 *
 * ⚠️ THE SERVER DECLARES THE VARIANT AND THE CLIENT INHERITS IT, through the
 * `card` key in the state element. That is the whole reason it is data rather
 * than a flag each side sets for itself: a re-sort in the browser repaints these
 * cards, and a surface that turned the player off at the edge and on in
 * episode-section.js would grow one the moment the reader touched a control. One
 * declaration, in the Function, per surface.
 *
 * Spacing is NOT here. The compact card's padding, artwork size and type scale
 * are CSS, scoped to `.ce-scroll` in episode-page.css, because a padding value
 * cannot make the two sides render different markup and does not need to travel.
 */
export const CARD_PARTS = { stats: true, layout: 'feed' }

// ── Formatting ───────────────────────────────────────────────────────
function fmtSats(n) {
  if (!n || n < 0) return '0'
  if (n < 1000) return String(n)
  const k = n / 1000
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'k'
}

// en-US in UTC, deliberately — see the header. A card built at the edge and the
// same card rebuilt in the browser after a re-sort must be the same string, and
// the reader must not watch the date change under them.
function fullDate(unixSec) {
  if (!unixSec) return ''
  const d = new Date(Number(unixSec) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

/* Publisher HTML → plain text for the two-line teaser.
 *
 * A tag strip rather than a parse. The DOM version used DOMParser, which does
 * not exist at the edge; `parseNotes` in functions/_shared/rich-text.js does the
 * job properly but is server-only and returns a token tree this card has no use
 * for. Stripping is safe here because the result is ESCAPED before it reaches
 * the page — nothing this returns is ever treated as markup.
 *
 * In practice it runs on nothing: `description` is one of the two fields
 * ob-data.js#toEpisodeShape documents as absent, since it only exists in the
 * per-show shard. It is kept so a card built from a source that does carry one
 * renders it rather than printing tags.
 */
function htmlToText(html) {
  if (!html) return ''
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function attr(name, value) {
  return value == null || value === '' ? '' : ` ${name}="${esc(value)}"`
}

// ── Data shaping ─────────────────────────────────────────────────────
/* Group boosts by episode, resolve episode/show records, drop episodes we can't
 * render (null Podcast Index episode record → no title/art), and sort by
 * most-recent boost.
 *
 * Moved here from feeds-podcasts.js with the card it feeds: the two edge
 * renderers build items with it before rendering them, so it cannot live in a
 * module that imports nostr-tools. feeds-podcasts.js re-exports it.
 */
export function buildEpisodes(data) {
  const { boosts = [], episodes = {}, shows = {} } = data || {}
  const byGuid = new Map()
  for (const b of boosts) {
    if (!b || !b.item_guid) continue
    const arr = byGuid.get(b.item_guid)
    if (arr) arr.push(b)
    else byGuid.set(b.item_guid, [b])
  }

  const out = []
  for (const [guid, list] of byGuid) {
    const ep = episodes[guid]
    if (!ep) continue                       // null episode record → can't render a card
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    const show = shows[ep.podcast_guid] || shows[list[0].podcast_guid] || null
    const distinct = []
    const seen = new Set()
    for (const b of list) {
      if (seen.has(b.booster_pubkey)) continue
      seen.add(b.booster_pubkey)
      distinct.push(b)
    }
    out.push({
      guid,
      ep,
      show,
      boosts: list,
      distinctBoosters: distinct,
      latest: list[0].created_at || 0,
      totalSats: list.reduce((s, b) => s + (b.sats || 0), 0),
    })
  }
  out.sort((a, b) => b.latest - a.latest)
  return out
}

// ── Ranking ──────────────────────────────────────────────────────────
/* The comparators and the air-date filter, in one place at last.
 *
 * ⚠️ THREE COPIES OF THESE EXISTED and this is the one. They were
 * `feeds-podcasts.js#sortItems` / `#filterItems` until the feeds' ranking moved
 * into /api/v1/episodes, at which point that module stopped exporting them —
 * correctly, because a PAGED feed holds a prefix of its corpus and ranking a
 * prefix in the browser ranks the wrong things. The two sections that hold their
 * WHOLE corpus in one bounded response then grew private copies (episode-page.js
 * and booster-page.js), each with its own note explaining why. The distinction
 * is real and survives: these are for a caller holding everything, and the feeds
 * still ask the server. What was never justified was three transcriptions of one
 * comparator table.
 *
 * Every comparator breaks ties on total sats, then on the most recent boost, so
 * the order is stable. `count` ranks by distinct people and `boosts` by raw
 * volume; they differ wherever someone boosted the same episode more than once.
 */
const bySats = (a, b) => b.totalSats - a.totalSats || b.latest - a.latest
export const EPISODE_SORTERS = {
  recent: (a, b) => b.latest - a.latest || b.totalSats - a.totalSats,
  episode: (a, b) => (b.ep.published || 0) - (a.ep.published || 0) || bySats(a, b),
  count: (a, b) => b.distinctBoosters.length - a.distinctBoosters.length || bySats(a, b),
  boosts: (a, b) => b.boosts.length - a.boosts.length || bySats(a, b),
  sats: bySats,
}

// Sorts where a position means something. Kept beside the table so the two can't
// drift — adding a quantitative sort means adding it here too. On "Latest boost"
// or "Latest episode" a rank badge would read as a score when it is chronology.
export const RANKED_SORTS = new Set(['count', 'boosts', 'sats'])

export const SORT_OPTIONS = [
  ['recent', 'Latest boost'],
  ['episode', 'Latest episode'],
  ['count', 'Most boosters'],
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
]

export function sortEpisodeItems(items, key, fallback = 'recent') {
  return [...items].sort(EPISODE_SORTERS[key] || EPISODE_SORTERS[fallback])
}

// The range filters on when the episode AIRED (ep.published), not on when it was
// boosted. That is the Episodes feed's axis and the opposite of the Shows feed's;
// both are deliberate. See the range table in CLAUDE.md.
export function filterEpisodeItems(items, cutoff) {
  if (!cutoff) return items
  return items.filter((it) => (it.ep.published || 0) >= cutoff)
}

// ── Episode link ladder ──────────────────────────────────────────────
// Prefer a per-boost Fountain episode URL (present on ~98% of episodes);
// otherwise fall back to a show-level smart link, and label the button so a
// show fallback never poses as an episode link.
function episodeLink(boosts, show, copy) {
  const withUrl = boosts.find((b) => b.item_url)
  if (withUrl && isSafeUrl(withUrl.item_url)) {
    // Every episode URL in the snapshot is a fountain.fm link, so name the
    // app; keep a generic label as a defensive fallback if that ever changes.
    let label = copy.listen
    try {
      if (new URL(withUrl.item_url).hostname.replace(/^www\./, '') === 'fountain.fm') label = 'Listen on Fountain'
    } catch {}
    return { url: withUrl.item_url, label, episode: true }
  }
  const showName = show?.title ? show.title : 'the show'
  if (show?.itunes_id) {
    return { url: `https://pod.link/${show.itunes_id}`, label: `Find it on ${showName}`, episode: false }
  }
  if (show?.feed_id) {
    return { url: `https://podcastindex.org/podcast/${show.feed_id}`, label: 'Find it on Podcast Index', episode: false }
  }
  return null
}

// ── The episode's own link ───────────────────────────────────────────
// Adapter onto episode-link.js, which owns the target. Only the item→primitives
// mapping lives here, because only this module knows the rollup's shape; the URL
// itself is shared with show-page.js and episode-page.js so all three surfaces
// publish the same link. It resolves to /episode/<item-guid> for a titled
// episode and falls back to Boost Me Bitch for the 500 that have no page.
export function episodeNoteLink(item) {
  return episodeBoostLink({
    itemGuid: item.guid,
    title: item.ep?.title || '',
    podcastGuid: item.ep?.podcast_guid || item.show?.podcast_guid || null,
    feedId: item.ep?.feed_id || item.show?.feed_id || null,
  })
}

// ── Subscribe links ──────────────────────────────────────────────────
// Show-level (not episode) deep links into podcast apps, built purely from
// snapshot fields — no runtime lookups:
//   • Fountain    — the fountain.fm/show/<id> URL a booster's own event
//                   carried (show_url); present on ~98% of episodes.
//   • Podcast Guru— app.podcastguru.io/podcast/<itunesId> (id alone resolves;
//                   the slug in a canonical URL is cosmetic).
//   • CurioCaster — curiocaster.com/podcast/pi<podcastIndexFeedId>.
//   • Castamatic  — castamatic.com/guid/<podcastGuid>.
//   • Podverse    — Podverse uses opaque internal ids, but its API exposes a
//                   by-podcast-guid route that 302-redirects a browser to the
//                   real /podcast/<id> page, so we can link straight from guid.
// CurioCaster + Castamatic + Podverse work for every show (feed_id / guid
// always present); the others appear only when their id is available.
function subscribeLinks(item) {
  const { ep, show, boosts } = item
  const feedId = ep.feed_id || show?.feed_id || null
  const guid = ep.podcast_guid || null
  const itunes = show?.itunes_id || null
  const fountain = boosts.find((b) => typeof b.show_url === 'string' && /^https?:\/\/fountain\.fm\/show\//.test(b.show_url))?.show_url

  const out = []
  if (fountain) out.push({ label: 'Fountain', url: fountain })
  if (itunes)   out.push({ label: 'Podcast Guru', url: `https://app.podcastguru.io/podcast/${itunes}` })
  if (feedId)   out.push({ label: 'CurioCaster', url: `https://curiocaster.com/podcast/pi${feedId}` })
  if (guid)     out.push({ label: 'Castamatic', url: `https://castamatic.com/guid/${encodeURIComponent(guid)}` })
  if (guid)     out.push({ label: 'Podverse', url: `https://api.podverse.fm/api/v1/podcast/by-podcast-guid/${encodeURIComponent(guid)}` })
  return out.filter((l) => isSafeUrl(l.url))
}

// ── Avatars ──────────────────────────────────────────────────────────
function initials(profile, npub) {
  const name = profile?.name?.trim()
  if (name) return name.slice(0, 2).toUpperCase()
  return (npub || '').replace(/^npub1/, '').slice(0, 2).toUpperCase() || '👤'
}

// How many booster faces the drawer bar stacks. The row is one non-wrapping
// flex line at a fixed 14px stride, so an uncapped stack on a heavily boosted
// episode (55 boosters ≈ 780px) is wider than the 720px panel and spills the
// card out of the feed. The exact count is already stated in the drawer label
// beside it, so the faces are decorative and safe to truncate; CSS trims the
// row further on narrow viewports.
export const MAX_FACES = 10

/* A booster avatar.
 *
 * ⚠️ `interactive` MEANS "link to that booster's page", not "click to copy the
 * npub". The copy gesture is not lost, it moved: /booster/<npub> leads with a
 * Copy npub button and the per-boost ⋮ menu below carries one too.
 *
 * The anchor WRAPS the image rather than replacing it, so `.pcast-avatar` keeps
 * sizing the img or the initials chip exactly as before.
 *
 * Avatars load eagerly (they're tiny, and `loading=lazy` left off-screen ones
 * perpetually unloaded → looked broken). A picture that fails to load swaps to
 * the initials chip, which is a VERB and lives in episode-card-actions.js —
 * `data-initials` is what that swap builds the chip from, since the server
 * cannot attach an error handler and this file may not emit an inline one.
 */
function avatarHtml(profile, npub, { size = 26, interactive = false, label = '', pk = null, hook = false } = {}) {
  const style = `--pcast-av:${size}px`
  const chip = initials(profile, npub)
  const pic = profile?.picture
  const hasPic = !!(pic && isSafeUrl(pic))
  // `hook` marks a face that is NOT inside an element already carrying one — the
  // stack on the drawer bar, where the row-level hook lives on the row. Without
  // it those faces are the one identity on the card the Primal backfill cannot
  // reach, which is what the old repaintProfiles pass existed to refresh.
  const mark = (hook && !hasPic && pk) ? ` data-pk="${esc(pk)}" data-missing="pic"` : ''

  const node = hasPic
    ? `<img class="pcast-avatar" style="${esc(style)}" src="${esc(pic)}" alt="" referrerpolicy="no-referrer" data-initials="${esc(chip)}" />`
    : `<span class="pcast-avatar pcast-avatar--none" style="${esc(style)}"${mark}>${esc(chip)}</span>`

  const href = interactive ? boosterPageHref(npub, pk) : null
  if (!href) return node

  // Secondary: the booster's NAME beside this avatar links to the same page, and
  // one row should not offer two tab stops and two announcements for one
  // destination. The name is the primary link because it carries the text.
  return `<a class="pcast-avatar-link" href="${esc(href)}"${boosterLinkAttrs({ label, secondary: true })}>` +
    node.replace('class="pcast-avatar', 'class="pcast-avatar is-interactive') +
    `</a>`
}

// ── The card ─────────────────────────────────────────────────────────
/**
 * One episode as HTML.
 *
 * @param {object}  item              a buildEpisodes() item
 * @param {object}  [opts]
 * @param {?number} [opts.rank]       1-based position under the current sort, or
 *   null when the sort isn't a ranking. Only the quantitative sorts get a number.
 * @param {object}  [opts.copy]       COPY.other (Episodes) or COPY.music (Songs)
 * @param {Map}     [opts.profiles]   hex pubkey → {name, picture}, for the faces,
 *   the row names and the @mention chips inside a boost message. Both sides fill
 *   it from what they already hold: the edge from the `profiles` table, the
 *   browser from the identities the collector embeds in every boost record.
 */
export function episodeCardHtml(item, {
  rank = null, copy = COPY.other, profiles = new Map(), names = null, parts = CARD_PARTS,
} = {}) {
  const { ep, show, boosts, distinctBoosters } = item
  const nameMap = names || namesFrom(profiles)
  const showStats = parts.stats !== false
  const compact = parts.layout === 'compact'
  // Same rule as the counts below: the server's total, falling back to the rows.
  const totalSats = item.totals?.sats ?? item.totalSats

  // Two links, and the first is preferred everywhere it exists. `epHref` is this
  // episode's page here; `outHref` is the Boost Me Bitch fallback, which only the
  // 500 untitled episodes now use. See show-link.js for the rule and
  // episode-link.js for what a boost note carries.
  const epHref = episodePageHref(item.guid, ep.title)
  const outHref = epHref ? null : episodeNoteLink(item)
  const titleText = ep.title || copy.untitled

  /* Episode art — links to the episode's page, the same target as the title.
   *
   * Episode art first, then the show's primary and second-chance artwork. That
   * last link is what `art2` bought: a feed whose channel art 404s still paints
   * the URL the same feed also published. `data-art2` / `data-art3` are the
   * chain's tail and are read by detail-page.js#wireArt2 — the same two
   * attributes and the same walker the /show and /episode heroes use, so the
   * fallback is one implementation across every surface that has artwork. An
   * exhausted chain drops to the glyph rather than leaving a broken image. */
  const chain = coverChain(ep.imageChain || [ep.image])
  const mediaInner = chain.length
    ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(chain[0])}"` +
      attr('data-art2', chain[1]) + attr('data-art3', chain[2]) + ` />`
    : '🎙'
  const mediaClass = 'pcast-card-media' + (chain.length ? '' : ' pcast-card-media--none')
  const media = epHref
    ? `<a class="${mediaClass}" href="${esc(epHref)}" title="Nostr boosts to ${esc(titleText)}">${mediaInner}</a>`
    : outHref
      ? `<a class="${mediaClass}" href="${esc(outHref)}" target="_blank" rel="noopener noreferrer" title="See all boosts on Boost Me Bitch">${mediaInner}</a>`
      : `<div class="${mediaClass}">${mediaInner}</div>`

  /* Booster faces on the drawer bar, stacked — the first MAX_FACES of them.
   *
   * ⚠️ DELIBERATELY NOT LINKED, and the only pfps on the site that are not.
   * This stack lives inside the drawer's <summary>, which is itself an
   * interactive element: an anchor nested in one is both a navigation and a
   * toggle on the same click, and it puts up to ten extra tab stops inside a
   * control whose whole job is to open. The same boosters are linked,
   * individually, on the rows inside the drawer. */
  const avatars = `<span class="pcast-avatars">` +
    distinctBoosters.slice(0, MAX_FACES)
      .map((b) => avatarHtml(profiles.get(b.booster_pubkey), b.booster_npub, { size: 22, pk: b.booster_pubkey, hook: true }))
      .join('') +
    `</span>`

  // A Fountain episode URL, when we have one (present on ~98% of episodes).
  const link = episodeLink(boosts, show, copy)
  const fountainUrl = link && link.episode ? link.url : null

  // The episode TITLE goes to that episode's landing page, the same move the
  // show name below made when /show/<guid> landed: the name of a thing points at
  // the page for that thing. Falls back to the BMB link for an episode with no
  // page — 500 of the 7,182 in the index have no title and so nothing to render
  // a page from. See show-link.js for the rule.
  const titleEl = epHref
    ? `<a class="pcast-title pcast-title-link" href="${esc(epHref)}" title="Nostr boosts to ${esc(titleText)}">${esc(titleText)}</a>`
    : outHref
      ? `<a class="pcast-title pcast-title-link" href="${esc(outHref)}" target="_blank" rel="noopener noreferrer" title="See all boosts on Boost Me Bitch">${esc(titleText)}</a>`
      : `<div class="pcast-title">${esc(titleText)}</div>`

  // Shownotes teaser: first ~2 lines of the description. The full notes are on
  // the episode's own page, which the title and art above already link to.
  const descText = htmlToText(ep.description)
  const descP = descText ? `<p class="pcast-desc">${esc(descText)}</p>` : ''

  // A compact "Listen on Fountain" link under the description, and the only
  // outbound link left on a titled card: the art, the title and "See all boosts"
  // all resolve to /episode/<item-guid>, and the show name to /show/<guid>.
  const linksRow = fountainUrl
    ? `<div class="pcast-links"><a class="pcast-fountain-link" href="${esc(fountainUrl)}" target="_blank" rel="noopener noreferrer" title="Listen on Fountain">Listen on Fountain ↗</a></div>`
    : ''

  // Show name — links to the show's landing page. Falls back to plain text for a
  // show with no page (no guid, or a synthetic one) — see show-link.js.
  const showHref = showPageHref(show?.podcast_guid)
  const showEl = show?.title
    ? (showHref
        ? `<a class="pcast-show pcast-show-link" href="${esc(showHref)}" title="Nostr boosts to ${esc(show.title)}">${esc(show.title)}</a>`
        : `<div class="pcast-show">${esc(show.title)}</div>`)
    : ''

  /* The counts sit in the card body, under the Fountain link. The drawer is
   * named for what it opens ("Nostr Interactions") rather than doubling as a
   * stat line, and these figures need the "Nostr Stats:" qualifier, which is the
   * per-card replacement for the scope-note paragraph that used to sit above the
   * whole feed. The sats stay on the drawer bar beside the booster faces.
   *
   * ⚠️ THE FIGURES ARE THE SERVER'S, NOT A COUNT OF THE ROWS IN THIS CARD. The
   * endpoint caps the notes it inlines at 50 per episode while reporting the
   * true all-time totals, so counting `boosts` here would understate the one
   * episode in the index that exceeds the cap. It falls back to the rows for a
   * card built from anything that does not carry totals. */
  const nBoosters = item.totals?.boosters ?? distinctBoosters.length
  const nBoosts = item.totals?.boosts ?? boosts.length

  /* ⚠️ THE BOOST PILL SHIPS `hidden` AND JAVASCRIPT REVEALS IT. Boosting needs a
   * signer and a value-block lookup, so it is a VERB and cannot work without the
   * module that attaches it; a button that is present and inert is worse than one
   * that arrives. This is the same arrangement functions/show/[guid].js has
   * always used for its hero and community-row buttons, and .ob-boost-pill is
   * defined once in theme.css. The markup is here rather than in the actions
   * module so the card is one object with one definition — only the click is
   * attached elsewhere. */
  const pill = `<button type="button" class="ob-boost-pill" hidden data-boost-episode` +
    ` title="Boost ${esc(titleText)}" aria-label="Boost ${esc(titleText)}">Boost</button>`

  const figures = showStats
    ? `<span class="ob-stats-label">Nostr Stats:</span>` +
      `<span>${esc(nBoosters.toLocaleString('en-US'))} booster${nBoosters === 1 ? '' : 's'}</span>` +
      `<span class="pcast-dot" aria-hidden="true">·</span>` +
      `<span>${esc(nBoosts.toLocaleString('en-US'))} boost${nBoosts === 1 ? '' : 's'}</span>`
    : ''

  // ⚠️ NEVER AN EMPTY .pcast-meta. It carries a top margin, so a row with nothing
  // in it is a gap the reader reads as a mistake — which is exactly what the
  // compact card with no figures would be, since its pill has moved to the rail.
  const statsRow = (figures || !compact)
    ? `<div class="pcast-meta pcast-nstats">${figures}${compact ? '' : pill}</div>`
    : ''

  /* The right rail: the boost pill, vertically centred against the whole card
   * head rather than sitting at the end of the last line of the body.
   *
   * It exists only in the compact layout, and only because the ⋮ subscribe menu
   * has come off there — the two occupy the same edge, and a pill centred
   * vertically would otherwise collide with a menu button pinned to the top of
   * it. `.pcast-card-rail` stretches to the head's height and centres its one
   * child; see feed-cards.css. */
  const rail = compact ? `<div class="pcast-card-rail">${pill}</div>` : ''

  const body = `<div class="pcast-card-body">${showEl}${titleEl}${descP}${linksRow}${statsRow}</div>`

  // Media column: episode art with the air date tucked directly beneath it —
  // keeps the date off the body's right edge so the ⋮ menu can hug the corner
  // and the body reclaims the width.
  const mediaCol = `<div class="pcast-media-col">${media}` +
    (ep.published ? `<div class="pcast-card-aired" title="${esc(copy.dated)}">${esc(fullDate(ep.published))}</div>` : '') +
    `</div>`

  // Rank badge sits at the head of the row on ranked sorts. aria-hidden because
  // the visual order already conveys it to a screen reader, and an announced
  // "1." before every episode title is noise.
  const rankEl = rank == null ? ''
    : `<div class="pcast-rank" aria-hidden="true">${esc(String(rank))}</div>`

  const head = `<div class="pcast-card-head">${rankEl}${mediaCol}${body}` +
    (compact ? rail : subscribeMenuHtml(item)) + `</div>`

  // Inline audio player (native controls, no preload until played). The element
  // is a fact — it is the episode's enclosure — and needs no JavaScript at all;
  // the browser's own controls are the interaction.
  //
  // A <source> when the feed declared a MIME type, `src` on the element when it
  // did not — `enclosure_type` is the second of the two fields toEpisodeShape
  // documents as absent, so on the feeds the browser sniffs it, which is what it
  // has always done here.
  const audioUrl = (!compact && isSafeUrl(ep.enclosure_url)) ? ep.enclosure_url : null
  const playerHtml = !audioUrl ? ''
    : ep.enclosure_type
      ? `<div class="pcast-player-row"><audio class="pcast-player" controls preload="none">` +
        `<source src="${esc(audioUrl)}" type="${esc(ep.enclosure_type)}" /></audio></div>`
      : `<div class="pcast-player-row">` +
        `<audio class="pcast-player" controls preload="none" src="${esc(audioUrl)}"></audio></div>`

  /* ⚠️ A <details>, NOT A BUTTON AND A HIDDEN DIV. The drawer holds the boost
   * notes, which are FACTS, so they are in the document — and a control that
   * only JavaScript can open would leave them unreachable, which is the exact
   * shape this refactor exists to remove. <details> opens on its own, so the
   * expand costs nothing and matches `.ep-drawer`, the drawer idiom /show and
   * /episode have always used. `.pcast-drawer` is now a <summary> carrying the
   * same classes and the same children, so it looks identical; feed-cards.css
   * carries the two-line delta (marker off, caret rotation off [open]). */
  const drawerMeta = `<span class="pcast-drawer-meta">${avatars}` +
    (totalSats > 0 ? `<span class="pcast-sats">${esc(fmtSats(totalSats))} <span class="pcast-bolt" aria-hidden="true">⚡</span></span>` : '') +
    `</span>`

  // The drawer is named for what it opens rather than for a count. The colon is
  // load-bearing: the booster faces and the sats sit immediately to its right, so
  // the label reads as introducing them rather than as a heading floating above
  // an unexplained row of avatars.
  const drawer = `<details class="pcast-card-details">` +
    `<summary class="pcast-drawer">` +
      `<span class="pcast-drawer-caret" aria-hidden="true">▾</span>` +
      `<span class="pcast-drawer-label">Nostr Interactions:</span>` +
      drawerMeta +
    `</summary>` +
    `<div class="pcast-details">${boostRowsHtml(boosts, profiles, nameMap)}${detailsFootHtml(epHref, outHref, copy)}</div>` +
    `</details>`

  /* The card's data attributes are the whole contract with
   * episode-card-actions.js, which has no item object to close over. They are
   * primitives the boost path needs — /api/value takes a feed id, a podcast guid
   * or a feed URL, and the published note takes the episode's own link — plus
   * the noun, so a toast on a music card says "track". Nothing here duplicates
   * text that is already in the markup. */
  return `<div class="pcast-card" data-episode-card` +
    attr('data-guid', item.guid) +
    attr('data-title', ep.title || '') +
    attr('data-noun', copy.noun) +
    attr('data-show-guid', ep.podcast_guid || show?.podcast_guid) +
    attr('data-show-title', show?.title) +
    attr('data-feed-url', show?.feed_url) +
    attr('data-feed-id', ep.feed_id || show?.feed_id) +
    attr('data-boost-url', episodeNoteLink(item)) +
    `>${head}${playerHtml}${drawer}</div>`
}

/* The ⋮ subscribe menu.
 *
 * The LINKS are facts and are rendered here; the toggle is a verb and is
 * attached by episode-card-actions.js, which is why the wrapper ships `hidden`.
 * Rendering the anchors server-side rather than passing a JSON blob down means
 * there is one place that knows what a subscribe link is, and no attribute
 * carrying a re-encoded copy of five URLs on every card.
 */
function subscribeMenuHtml(item) {
  const links = subscribeLinks(item)
  if (!links.length) return ''
  return `<div class="pcast-cardmenu" hidden data-subscribe-menu>` +
    `<button class="pcast-cardmenu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Subscribe to this show" title="Subscribe">⋮</button>` +
    `<div class="pcast-cardmenu-menu" hidden>` +
      `<div class="pcast-cardmenu-label">Follow this show on</div>` +
      links.map((l) => `<a class="pcast-cardmenu-item" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join('') +
    `</div></div>`
}

/* Every boost in the drawer — no truncation, since hiding comments implied some
 * weren't worth showing.
 *
 * ⚠️ THE ROWS ARE IN THE DOCUMENT, WHERE THEY USED TO BE BUILT ON FIRST OPEN.
 * That laziness was the DOM builder's, and it was the reason a crawler saw an
 * episode card with no boosts under it. They are facts; they ship. The cost is
 * paid where it is smallest — the rows are inside a closed <details>, so the
 * browser lays out none of them until the reader opens one — and the bytes are
 * bytes the homepage already downloaded as JSON before this changed.
 */
function boostRowsHtml(boosts, profiles, names) {
  return boosts.map((b) => boostRowHtml(b, profiles, names)).join('')
}

function boostRowHtml(b, profiles, names) {
  const profile = profiles.get(b.booster_pubkey) || null
  const realName = profile?.name?.trim() || null
  const name = realName || (b.booster_npub ? b.booster_npub.slice(0, 12) + '…' : 'anon')

  // The primary link of the row: the avatar beside it points at the same page
  // and is marked secondary, so this is the one that is announced and tabbed to.
  // Falls back to a plain span when there is no identifier to key on, which
  // cannot happen for a real record but must not emit a dead href if it does.
  const href = boosterPageHref(b.booster_npub, b.booster_pubkey)
  const nameEl = href
    ? `<a class="pcast-boost-name" href="${esc(href)}"${boosterLinkAttrs({ label: name })}>${esc(name)}</a>`
    : `<span class="pcast-boost-name">${esc(name)}</span>`

  const satsEl = (b.sats != null)
    ? `<span class="pcast-boost-sats">${esc(fmtSats(b.sats))} <span class="pcast-bolt" aria-hidden="true">⚡</span></span>`
    : ''

  // What the index couldn't supply is declared for the client to fill from
  // Primal (detail-page.js#hydrateProfiles), the same hook the community wall
  // and the /show boost rows use. Nothing waits on it: the row is complete and
  // readable as rendered.
  const missing = [realName ? null : 'name', profile?.picture ? null : 'pic'].filter(Boolean).join(' ')

  const head = `<div class="pcast-boost-head">` +
    avatarHtml(profile, b.booster_npub, { size: 34, interactive: true, label: name, pk: b.booster_pubkey }) +
    `<div class="pcast-boost-who">${nameEl}<span class="pcast-boost-when">${esc(fullDate(b.created_at))}</span></div>` +
    satsEl +
    moreMenuHtml() +
    `</div>`

  const msg = (b.message || '').trim()
  const msgEl = msg ? `<div class="pcast-boost-msg">${renderMessage(msg, names)}</div>` : ''

  /* ⚠️ THE ROW IS THE `[data-boost-note]` ELEMENT, the same contract
   * functions/_shared/detail-page.js#boostRow declares on the .note-card it
   * emits: id, pubkey and timestamp, and the message read back out of the DOM
   * rather than duplicated into an attribute. The reaction bar is attached here
   * by episode-card-actions.js instead of boost-note-actions.js because it
   * arrives when the DRAWER opens rather than when the section approaches the
   * viewport — but it is the same buildActionBar and the same projection.
   *
   * ⚠️ THAT PROJECTION IS NOT A SIGNED EVENT. It carries no `sig` and no real
   * `tags`, which is exactly what made repost silently wrong until b6c0bd4.
   * Reply, like and zap need only the id and the pubkey; repost needs the note
   * itself and gets it by fetching. Nothing may pass this object anywhere that
   * assumes a verified event. */
  return `<div class="pcast-boost" data-boost-note` +
    attr('data-event-id', b.event_id) +
    attr('data-pubkey', b.booster_pubkey) +
    attr('data-npub', b.booster_npub) +
    attr('data-ts', b.created_at) +
    (missing ? ` data-pk="${esc(b.booster_pubkey)}" data-missing="${esc(missing)}"` : '') +
    `>${head}${msgEl}</div>`
}

/* Per-boost overflow (⋮) menu — copy npub, copy nevent.
 *
 * Emitted empty and `hidden`: both items are clipboard gestures, so unlike the
 * subscribe menu there is no link to render and nothing to say without
 * JavaScript. The wrapper is here rather than injected so the row's flex layout
 * is the same object on both sides.
 */
function moreMenuHtml() {
  return `<div class="pcast-more" hidden data-boost-menu></div>`
}

/* The drawer's footer.
 *
 * "See all boosts" is a LINK — this episode's own page, which holds every boost
 * in the index plus the community rollup rather than the ones this feed loaded —
 * so it is a fact and ships visible. "Hide boosts" is a verb (it closes the
 * <details> and scrolls the card head back into view), so it ships hidden and
 * episode-card-actions.js reveals it. The ↗ and the new tab go with the
 * destination: only the untitled-episode fallback leaves the site.
 */
function detailsFootHtml(epHref, outHref, copy) {
  const seeAll = epHref
    ? `<a class="pcast-seeall" href="${esc(epHref)}" title="${esc(copy.seeAllTitle)}">See all boosts</a>`
    : outHref
      ? `<a class="pcast-seeall" href="${esc(outHref)}" target="_blank" rel="noopener noreferrer" title="${esc(copy.seeAllOutTitle)}">See all boosts<span aria-hidden="true"> ↗</span></a>`
      : ''
  return `<div class="pcast-details-foot">${seeAll}` +
    `<button class="pcast-drawer-close" type="button" hidden data-drawer-hide>` +
    `<span class="pcast-drawer-caret" aria-hidden="true">▴</span>Hide boosts</button></div>`
}

/* profiles (pk → {name, picture}) → names (pk → name), which is what
 * renderMessage takes.
 *
 * Derived rather than cached against the Map identity: the feed MUTATES its
 * profiles map as pages arrive, so a WeakMap keyed on it would hand back the
 * names from the first page forever. renderEpisodeCards below is the answer to
 * the cost — it derives this once for a whole page of cards.
 */
function namesFrom(profiles) {
  const m = new Map()
  for (const [pk, p] of profiles) if (p?.name) m.set(pk, p.name)
  return m
}

/**
 * A whole page of cards, which is how every surface actually calls this.
 *
 * @param {Array}    items
 * @param {object}   [opts]
 * @param {object}   [opts.copy]     COPY.other or COPY.music
 * @param {Map}      [opts.profiles] hex pubkey → {name, picture}
 * @param {Function} [opts.rankOf]   (item, index) => number|null. A function
 *   rather than a flag because the four surfaces number differently: the feeds
 *   stamp `_rank` over the server's ordering and keep it through a search, the
 *   two detail sections renumber on every re-sort, and the chronological sorts
 *   pass null so a numeral never reads as a score.
 */
export function renderEpisodeCards(items, {
  copy = COPY.other, profiles = new Map(), rankOf = null, parts = CARD_PARTS,
} = {}) {
  const names = namesFrom(profiles)
  return items
    .map((it, i) => episodeCardHtml(it, { rank: rankOf ? rankOf(it, i) : null, copy, profiles, names, parts }))
    .join('')
}
