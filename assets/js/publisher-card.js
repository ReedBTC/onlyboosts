/* THE ARTIST CARD — facts half, as an HTML string.
 *
 * The third card built on the show card's discipline: everything out of the
 * database and identical for every visitor is a string from a function with no
 * DOM, no network and no clock, so a card painted on hydration and the same
 * card rebuilt after a re-sort are byte-identical. The verbs live next door in
 * publisher-card-actions.js. No surface server-renders this card today — only
 * the landing feed is edge-rendered, and it is Shows — but the module keeps the
 * two-sided rules (relative stamped imports, en-US in UTC, no Date.now) so
 * gaining an edge surface later is a change to a Function alone.
 *
 * THE SUBJECT IS THE PUBLISHER TIER: <podcast:publisher>, the level above an
 * album. In practice the publisher is the ARTIST — Wavlake, Fountain and RSS
 * Blue mint one publisher feed per artist — so the surface says "artist" and
 * the code says "publisher", the same product/module seam as Podcasts →
 * Episodes. See "The medium split" in CLAUDE.md and docs/feeds.md.
 *
 * The title links to /artist/<guid> — the publisher page shipped 2026-08-30,
 * and this is the href-goes-here-once moment the earlier note promised. The
 * drawer stays the inline navigation: the artist's INDEXED albums, each
 * linking to its /show page.
 *
 * ⚠️ THE DRAWER IS INDEX-ONLY — Reed's call, 2026-08-30. Nothing without at
 * least one Nostr boost appears anywhere on this site (the podroll excepted,
 * and it is not a ranked feed). The first cut listed the publisher feed's own
 * full catalogue and rendered hundreds of titleless off-index rows linking to
 * raw XML. The rows are now the declaring shows the card's own figures were
 * computed over, windowed with the card's range. `publisher_albums` — the
 * artist's catalogue file — is still collected and deliberately unrendered;
 * if off-index content ever comes to this site it comes site-wide.
 *
 * ⚠️ NO BOOST PILL, DELIBERATELY. A publisher feed can carry its own value
 * block, but /api/value resolves through Podcast Index, which cannot see most
 * publisher feeds (measured: PI returns an empty object for Wavlake artist
 * guids — the majority). A pill that fails for most artists is worse than
 * none; boosting stays at the album and song level, one drawer-click away.
 */
import { showPageHref, publisherPageHref } from './show-link.js?v=ob-v170'
import { coverChain } from './cover-art.js?v=ob-v170'
import { htmlEscape } from './nostr-text.js?v=ob-v170'
import { num, fmtSats, plural, shortDate } from './show-card.js?v=ob-v170'
// Re-exported: artists-feed.js reads the formatting helpers through this
// module the way shows-feed.js reads them through show-card.js. ⚠️ An import
// is NOT a re-export — this line shipped missing once, and the unresolved
// named import was a LINK-TIME error: renderArtists never executed and the
// whole feed painted the load-failure placeholder (the ob-v53 class, caught
// on the preview deploy).
export { num, fmtSats, plural, shortDate } from './show-card.js?v=ob-v170'

const esc = htmlEscape

// One table, not a medium pair: the Artists feed has no not-music half. Kept in
// the same shape as show-card.js#COPY so the renderer reads the two identically.
export const COPY = {
  glyph: '🎤',
  unidentified: 'Unnamed artist',
  noun: 'artist',
  drawer: 'Albums with Nostr Boosts',
  noItems: 'No album boosts recorded for this artist in this range.',
  untitledItem: 'Untitled release',
  drawerLoading: 'Loading albums…',
  drawerFail: 'Couldn’t load this artist’s albums.',
  drawerFoot: 'See all boosts to this artist',
  // The group labels inside a MIXED drawer — an artist who declares podcasts
  // beside their albums. Unmixed drawers render neither.
  albumsGroup: 'Albums',
  showsGroup: 'Shows',
  rangeLabel: 'Filter by when the artist was boosted',
  rangeTitle: (days) => (days ? `Artists boosted in the last ${days} days` : 'All time'),
  sortTitle: 'Sort artists',
  noteGlobal: 'Ranks based on every boost in the index',
  noteFollows: 'Ranks based on only boosts from the accounts you follow',
  noFollows: ['You’re not following anyone yet', 'Follow some npubs in any Nostr client and the artists they boost will show up here.'],
  moreLabel: (n) => `Load ${n} more artist${n === 1 ? '' : 's'}`,
  countLine: (shown) => `Showing ${shown}`,
  searchPlaceholder: 'Search artists…',
  searchLabel: 'Search artists',
  searchNoun: 'artist',
  loadFail: ['Couldn’t load artists', ' The publisher index is unavailable right now — please try again later.'],
  rangeFail: ['Couldn’t load artists', ' The boosts feed is unavailable right now — please try again later.'],
  emptyAll: ['No artists in this window', ' When someone boosts music whose feed names its artist, that artist will appear here.'],
  emptyWindow: ['No artists in this window', ' Nothing was boosted in this time range — try a wider one.'],
  outOfRange: (label) => ` ${label} wasn’t boosted in this time range — widen the range, or clear the search.`,
  // On All the search has seen every artist the index can name. An artist is
  // here only when a feed someone boosted declares them — the coverage
  // boundary is the publisher tag, not our indexing.
  searchNoneAll: 'No artist matches. Artists appear here when a boosted feed names its publisher.',
  searchNoneRange: 'No artist matches in this time range. Try All.',
}

// The same keys as the shows endpoint, because /api/v1/publishers spells its
// aggregates the same way — see SORTS there. 'latest' is chronology, no rank.
export const SORT_OPTIONS = [
  /* ⚠️ THE ONLYBOOSTS CHARTS — see show-card.js; the same composite, one tier
   * up. Server-ranked on every row; never renumbered client-side. */
  ['chart', 'Chart rank'],
  ['boosters', 'Most boosters'],
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
  ['latest', 'Recently boosted'],
]
export const RANKED_SORTS = new Set(['chart', 'boosts', 'sats', 'boosters'])

export const PUBLISHER_CARDS_PER_PAGE = 25

// Same one-liner as show-card.js#showRankValue, same precondition: the rows
// arrive already ordered by the value being ranked.
export function publisherRankValue(sortKey) {
  return (p) => Number(p && p[sortKey]) || 0
}

/* An API record → the card's own shape. */
export function toCard(p) {
  return {
    guid: p.guid,
    title: typeof p.title === 'string' ? p.title : '',
    img: typeof p.img === 'string' ? p.img : '',
    art2: typeof p.art2 === 'string' ? p.art2 : '',
    feed: typeof p.feed === 'string' ? p.feed : '',
    albums: num(p.albums),
    boosts: num(p.boosts),
    sats: num(p.sats),
    boosters: num(p.boosters),
    latest: num(p.latest),
    rank: Number.isFinite(p.rank) ? p.rank : null,
    // The chart sort's corpus-true tie flag, riding beside its rank.
    tied: p.tied === true,
  }
}

function attr(name, value) {
  return value == null || value === '' ? '' : ` ${name}="${esc(value)}"`
}

/* ── One card ──────────────────────────────────────────────────────────
 * The show card's classes throughout, on the identical-across-surfaces rule: a
 * reader who screenshots an artist card and a show card should see the same
 * component with a different subject.
 */
export function publisherCardHtml(p, { rank = null, copy = COPY } = {}) {
  const named = !!p.title

  const chain = coverChain(p.img, p.art2)
  const mediaInner = chain.length
    ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(chain[0])}"` +
      attr('data-art2', chain[1]) + ` />`
    : esc(copy.glyph)
  const mediaClass = 'pcast-card-media' + (chain.length ? '' : ' pcast-card-media--none')
  const media = `<div class="${mediaClass}">${mediaInner}</div>`

  // Named artists link to their landing page — /artist/<guid>, the page's own
  // qualifying rule being the title, same as the show card's arrangement.
  const href = named ? publisherPageHref(p.guid) : null
  const titleEl = href
    ? `<h3 class="pcast-title"><a class="ob-show-link" href="${esc(href)}" title="Nostr boosts to ${esc(p.title)}">${esc(p.title)}</a></h3>`
    : `<h3 class="pcast-title${named ? '' : ' ob-show-unnamed'}">${esc(named ? p.title : copy.unidentified)}</h3>`

  // The same qualifier, at the point of the numbers — see Vocabulary in
  // CLAUDE.md. No album count on the face: like the episode count the show
  // card dropped, a catalogue size reads as a claim about the artist's work
  // rather than about boost activity, and the drawer answers it properly.
  const stats =
    `<div class="pcast-meta ob-show-stats">` +
      `<span class="ob-stats-label">Nostr Stats:</span>` +
      `<span class="pcast-sats">${esc(fmtSats(p.sats))}<span class="pcast-bolt" aria-hidden="true"> ⚡</span></span>` +
      `<span class="pcast-dot" aria-hidden="true">·</span>` +
      `<span>${esc(plural(p.boosts, 'boost', 'boosts'))}</span>` +
      `<span class="pcast-dot" aria-hidden="true">·</span>` +
      `<span>${esc(plural(p.boosters, 'booster', 'boosters'))}</span>` +
    `</div>`

  // Absolute date rendered, relative form attached — the facts/verbs line the
  // show card drew; see wireLatest in publisher-card-actions.js.
  const latestEl = p.latest
    ? `<div class="ob-show-latest" data-latest-ts="${esc(String(p.latest))}">last boost ${esc(shortDate(p.latest))}</div>`
    : ''

  const rankEl = rank == null ? ''
    : `<div class="pcast-rank" aria-hidden="true">${esc(String(rank))}</div>`

  const head = `<div class="pcast-card-head">${rankEl}${media}` +
    `<div class="pcast-card-body">${titleEl}${stats}${latestEl}</div></div>`

  /* Every listed artist gets the drawer: the endpoint only lists publishers
   * with at least one indexed show, so there is always something behind the
   * lid. The body is always lazy — the album list is never in hand when the
   * card is built, same fact-about-the-data as the show card's drawer. */
  const drawer =
    `<details class="pcast-card-details">` +
      `<summary class="pcast-drawer">` +
        `<span class="pcast-drawer-caret" aria-hidden="true">▾</span>` +
        `<span>${esc(copy.drawer)}</span>` +
      `</summary>` +
      `<div class="pcast-details" data-lazy-albums>` +
        `<div class="pcast-boosts-status" data-drawer-status>${esc(copy.drawerLoading)}</div>` +
        (href
          ? `<div class="pcast-details-foot"><a class="pcast-seeall" href="${esc(href)}">${esc(copy.drawerFoot)} →</a></div>`
          : '') +
      `</div>` +
    `</details>`

  return `<article class="pcast-card" data-publisher-card` +
    attr('data-guid', p.guid) +
    attr('data-title', p.title) +
    `>${head}${drawer}</article>`
}

/* ── The drawer's album rows ───────────────────────────────────────────
 *
 * INDEXED ALBUMS BY SATS — the same reading the show card's episode drawer
 * gives: the rows are what the card's own figures were computed over, in the
 * order of what they took. Every row has a boost by construction (the
 * endpoint reads `podcasts WHERE publisher_guid`), and a row links to its
 * /show page on the same qualifying rule every other surface uses: the title.
 * ⚠️ NO EXTERNAL BRANCH, deliberately — an off-index URL cannot be rendered
 * from here even if a record carries one; see the index-only note above.
 * Exported for publisher-card-actions.js, the episodeRowsHtml arrangement.
 */
export function albumRowsHtml(albums, copy = COPY) {
  if (!albums.length) return `<div class="ob-show-note">${esc(copy.noItems)}</div>`

  /* The medium partition, in miniature — DEFENSIVE since 2026-08-31: the
   * artist tier is music-only server-side now, so every list arriving here
   * is unmixed and renders with no group labels. The grouping stays because
   * it costs two filters and turns a future data regression (a podcast row
   * reaching an "Albums" lid — the V4V Roundtable case Reed caught at
   * launch) into labelled honesty instead of a silent lie. */
  const music = albums.filter((a) => a.medium === 'music')
  const other = albums.filter((a) => a.medium !== 'music')
  if (music.length && other.length) {
    return `<div class="ob-show-note">${esc(copy.albumsGroup)}</div>` + rowsHtml(music, copy) +
      `<div class="ob-show-note">${esc(copy.showsGroup)}</div>` + rowsHtml(other, copy)
  }
  return rowsHtml(albums, copy)
}

function rowsHtml(albums, copy) {
  const rows = albums.map((a) => {
    const title = a.title || (a.medium === 'music' ? copy.untitledItem : 'Unidentified show')
    const href = a.title && a.guid ? showPageHref(a.guid) : null
    const titleEl = href
      ? `<a class="ob-ep-title" href="${esc(href)}" title="Nostr boosts to ${esc(title)}">${esc(title)}</a>`
      : `<span class="ob-ep-title">${esc(title)}</span>`
    const meta = a.boosts ? plural(num(a.boosts), 'boost', 'boosts') : ''
    return `<li class="ob-ep">` +
      `<div class="ob-ep-main">${titleEl}` +
      (meta ? `<span class="ob-ep-meta">${esc(meta)}</span>` : '') +
      `</div>` +
      (a.sats ? `<span class="ob-ep-sats">${esc(fmtSats(num(a.sats)))}<span class="pcast-bolt" aria-hidden="true"> ⚡</span></span>` : '') +
      `</li>`
  }).join('')

  return `<ul class="ob-ep-list">${rows}</ul>`
}
