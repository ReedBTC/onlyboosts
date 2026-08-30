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
 * ⚠️ THE TITLE IS NOT A LINK. There is no /publisher/<guid> page yet, and a
 * dead link is worse than a plain name. The drawer is the navigation: the
 * artist's own album list, each row linking to its /show page where one
 * exists. When a publisher page ships, the href goes here and every surface
 * gets it at once.
 *
 * ⚠️ NO BOOST PILL, DELIBERATELY. A publisher feed can carry its own value
 * block, but /api/value resolves through Podcast Index, which cannot see most
 * publisher feeds (measured: PI returns an empty object for Wavlake artist
 * guids — the majority). A pill that fails for most artists is worse than
 * none; boosting stays at the album and song level, one drawer-click away.
 */
import { showPageHref } from './show-link.js?v=ob-v161'
import { coverChain } from './cover-art.js?v=ob-v161'
import { htmlEscape, isSafeUrl } from './nostr-text.js?v=ob-v161'
import { num, fmtSats, plural, shortDate } from './show-card.js?v=ob-v161'

const esc = htmlEscape

// One table, not a medium pair: the Artists feed has no not-music half. Kept in
// the same shape as show-card.js#COPY so the renderer reads the two identically.
export const COPY = {
  glyph: '🎤',
  unidentified: 'Unnamed artist',
  noun: 'artist',
  drawer: 'Albums',
  noItems: 'No albums recorded for this artist yet.',
  drawerLoading: 'Loading albums…',
  drawerFail: 'Couldn’t load this artist’s albums.',
  rangeLabel: 'Filter by when the artist was boosted',
  rangeTitle: (days) => (days ? `Artists boosted in the last ${days} days` : 'All time'),
  sortTitle: 'Sort artists',
  noteGlobal: 'Ranks based on every boost in the index',
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
  ['boosters', 'Most boosters'],
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
  ['latest', 'Recently boosted'],
]
export const RANKED_SORTS = new Set(['boosts', 'sats', 'boosters'])

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

  const titleEl =
    `<h3 class="pcast-title${named ? '' : ' ob-show-unnamed'}">${esc(named ? p.title : copy.unidentified)}</h3>`

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
      `</div>` +
    `</details>`

  return `<article class="pcast-card" data-publisher-card` +
    attr('data-guid', p.guid) +
    attr('data-title', p.title) +
    `>${head}${drawer}</article>`
}

/* ── The drawer's album rows ───────────────────────────────────────────
 *
 * ⚠️ PUBLISHER ORDER, NOT BOOST ORDER. The list is the artist's own
 * channel-level album list, the podroll rule one tier up: reordering it (or
 * filtering it) would misreport what they published. Figures appear only on
 * rows we index — null stats mean "we do not index this feed", not zero.
 *
 * A linked row's title goes to its /show page; an unlinked row goes to the
 * album's own feed URL, the podroll's render rule for a show we have no page
 * for. Exported for publisher-card-actions.js, the episodeRowsHtml arrangement.
 */
export function albumRowsHtml(albums, copy = COPY) {
  if (!albums.length) return `<div class="ob-show-note">${esc(copy.noItems)}</div>`

  const rows = albums.map((a) => {
    const title = a.title || 'Untitled release'
    const href = a.linked && a.guid ? showPageHref(a.guid) : null
    const titleEl = href
      ? `<a class="ob-ep-title" href="${esc(href)}" title="Nostr boosts to ${esc(title)}">${esc(title)}</a>`
      : isSafeUrl(a.url)
        ? `<a class="ob-ep-title" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`
        : `<span class="ob-ep-title">${esc(title)}</span>`
    const meta = a.boosts != null ? plural(num(a.boosts), 'boost', 'boosts') : ''
    return `<li class="ob-ep">` +
      `<div class="ob-ep-main">${titleEl}` +
      (meta ? `<span class="ob-ep-meta">${esc(meta)}</span>` : '') +
      `</div>` +
      (a.sats ? `<span class="ob-ep-sats">${esc(fmtSats(num(a.sats)))}<span class="pcast-bolt" aria-hidden="true"> ⚡</span></span>` : '') +
      `</li>`
  }).join('')

  return `<ul class="ob-ep-list">${rows}</ul>`
}
