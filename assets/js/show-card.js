/* THE SHOW CARD. One definition, both sides of the wire.
 *
 * ⚠️ THIS IS THE FACTS HALF OF THE RENDERING RULE, and it is the second card on
 * this site to be split that way. Everything the card shows that comes out of
 * the database and is the same for every visitor is built here, as an HTML
 * STRING, by a function with no DOM and no network — so the identical bytes are
 * produced at the edge by a Pages Function and in the browser by shows-feed.js
 * after a re-sort. The verbs live next door in show-card-actions.js.
 *
 *   facts, here          artwork and its fallback chain, the title and where it
 *                        links, the guid stand-in for an unidentified show, the
 *                        "Nostr Stats:" line, the rank, the drawer's lid and its
 *                        footer
 *   verbs, next door     the boost pill's click, the drawer's fetch-on-open, and
 *                        the relative time on the last-boost line
 *
 * WHAT THIS REPLACED. `shows-feed.js#renderShowCard` built the card as DOM with
 * listeners closed over a show object, so it existed only as JavaScript and the
 * homepage could not open on it. That mattered the moment Shows became the
 * landing feed: functions/index.js can only splice a STRING into index.html, so
 * a DOM-only card meant the front door going back to painting a shell and then
 * fetching. See CLAUDE.md, "One Module, Imported From Both Sides".
 *
 * ⚠️ IMPORTS ARE RELATIVE AND STAMPED. `'./show-link.js?v=ob-v113'` resolves in
 * the browser against this module's own stamped URL; esbuild strips the query
 * and reads the file off disk when wrangler bundles the Functions. An absolute
 * `/assets/js/…` import works in the browser and cannot be bundled, so it is the
 * one form a module imported from `functions/` may not use. Everything imported
 * here is itself dependency-free for the same reason.
 *
 * ⚠️ NO Intl DEFAULTS AND NO CLOCK. Three things in the DOM version could not
 * survive the crossing and each is fixed here rather than carried:
 *
 *   relTime()     read Date.now(), so "last boost 3d ago" was a different string
 *                 at the edge (behind a 300s cache) than in the browser. The
 *                 TIMESTAMP is the fact and the "3d ago" is a reading of it that
 *                 depends on when you look, so the absolute date is rendered
 *                 here and show-card-actions.js upgrades it off `data-ts`. That
 *                 is the facts/verbs line, not a workaround for it: a crawler
 *                 and a JavaScript-off reader get a date that is true forever.
 *   shortDate()   called toLocaleDateString(undefined, …), so the drawer's
 *                 episode rows were formatted in the reader's locale.
 *   plural()      called n.toLocaleString() unpinned, same problem one field over.
 *
 * All three are now en-US in UTC, which is what episode-card.js and
 * functions/_shared/detail-page.js already do. The site has one date format.
 */
import { showPageHref, episodePageHref } from './show-link.js?v=ob-v191'
import { coverChain } from './cover-art.js?v=ob-v191'
import { htmlEscape, isSafeUrl } from './nostr-text.js?v=ob-v191'

const esc = htmlEscape

// ── Shows vs Albums ──────────────────────────────────────────────────
// Two of the feed bar's options render through this card and differ by one
// thing: which side of <podcast:medium> a show falls on. A music feed's item is
// a track on an album, not an episode of a show, so the rollup, the ranking and
// the card are identical and only the words change. That makes the difference a
// copy table rather than a second renderer.
//
// It lives here rather than in shows-feed.js because the edge renderer needs it
// too; that module re-exports it, so nothing that imported it from there had to
// change. Same arrangement COPY has in episode-card.js.
export const COPY = {
  other: {
    glyph: '🎙',
    unidentified: 'Unidentified show',
    noun: 'show',
    drawer: 'Episodes with Nostr Boosts',
    noItems: 'No episodes recorded for this show yet.',
    truncated: (n, total) => `Showing the ${n} most recent of ${total} episodes.`,
    untitledItem: 'Untitled episode',
    drawerLoading: 'Loading episodes…',
    drawerFail: 'Couldn’t load this show’s episodes.',
    drawerFoot: 'See all boosts to this show',
    rangeLabel: 'Filter by when the show was boosted',
    rangeTitle: (days) => (days ? `Shows boosted in the last ${days} days` : 'All time'),
    sortTitle: 'Sort shows',
    // The line above the search box is composed live from the view — see
    // viewNote in feed-note.js; nothing static here to keep in step.
    noFollows: ['You’re not following anyone yet', 'Follow some npubs in any Nostr client and the shows they boost will show up here.'],
    moreLabel: (n) => `Load ${n} more show${n === 1 ? '' : 's'}`,
    // No total to count against: the endpoint pages rather than reporting how
    // many shows the range holds, so this states what is on screen and nothing
    // it cannot support.
    countLine: (shown) => `Showing ${shown}`,
    searchPlaceholder: 'Search shows…',
    searchLabel: 'Search shows',
    searchNoun: 'show',
    loadFail: ['Couldn’t load shows', ' The podcast index is unavailable right now — please try again later.'],
    rangeFail: ['Couldn’t load shows', ' The boosts feed is unavailable right now — please try again later.'],
    loading: ['Loading this window…', ' Rolling the boosts in this range up by show.'],
    emptyAll: ['No shows in this window', ' When someone boosts a podcast episode on Nostr, its show will appear here.'],
    emptyWindow: ['No shows in this window', ' Nothing was boosted in this time range — try a wider one.'],
    outOfRange: (label) => ` ${label} wasn’t boosted in this time range — widen the range, or clear the search.`,
    // A miss means two different things and the single old line read as both.
    // On All the search has seen the whole index, so it is a COVERAGE boundary
    // rather than a filter to widen: a show nobody has boosted on Nostr is not
    // in the index and will not be until somebody does.
    searchNoneAll: 'No show matches. The index holds only shows someone has boosted on Nostr.',
    searchNoneRange: 'No show matches in this time range. Try All.',
  },
  music: {
    glyph: '💿',
    unidentified: 'Unidentified release',
    noun: 'album',
    drawer: 'Tracks with Nostr Boosts',
    noItems: 'No tracks recorded for this release yet.',
    truncated: (n, total) => `Showing the ${n} most recent of ${total} tracks.`,
    untitledItem: 'Untitled track',
    drawerLoading: 'Loading tracks…',
    drawerFail: 'Couldn’t load this release’s tracks.',
    drawerFoot: 'See all boosts to this album',
    rangeLabel: 'Filter by when the album was boosted',
    rangeTitle: (days) => (days ? `Albums boosted in the last ${days} days` : 'All time'),
    sortTitle: 'Sort albums',
    noFollows: ['You’re not following anyone yet', 'Follow some npubs in any Nostr client and the albums they boost will show up here.'],
    moreLabel: (n) => `Load ${n} more album${n === 1 ? '' : 's'}`,
    countLine: (shown) => `Showing ${shown}`,
    searchPlaceholder: 'Search albums…',
    searchLabel: 'Search albums',
    searchNoun: 'album',
    loadFail: ['Couldn’t load albums', ' The podcast index is unavailable right now — please try again later.'],
    rangeFail: ['Couldn’t load albums', ' The boosts feed is unavailable right now — please try again later.'],
    loading: ['Loading this window…', ' Rolling the boosts in this range up by album.'],
    emptyAll: ['No albums in this window', ' When someone boosts a track from a music feed on Nostr, its album will appear here.'],
    emptyWindow: ['No albums in this window', ' Nothing was boosted in this time range — try a wider one.'],
    outOfRange: (label) => ` ${label} wasn’t boosted in this time range — widen the range, or clear the search.`,
    searchNoneAll: 'No album matches. The index holds only releases someone has boosted on Nostr.',
    searchNoneRange: 'No album matches in this time range. Try All.',
  },
}

// 'music' is Albums; everything else is Shows. A PARTITION, not a narrowing —
// video and the feeds Podcast Index cannot identify come here, which is why the
// query parameter is not_medium=music and never medium=podcast. See CLAUDE.md.
export function copyFor(medium) {
  return medium === 'music' ? COPY.music : COPY.other
}

// ── Range + sort ──────────────────────────────────────────────────────
// The range filters on BOOST time: a show is in the 1W view if it was boosted in
// the last 7 days, and its numbers are that week's numbers. Since 2026-08-31
// that is the ONE reading site-wide — the Episodes feeds' identical buttons
// retired their air-date axis the same day. See Range and sort in docs/feeds.md.
//
// On the absence of an episode count: there used to be a fifth axis here, 'Most
// episodes', and a matching figure on every card. Both are gone. Sats, boosts
// and boosters are measures of boost activity and have no meaning outside it, so
// "as published to Nostr" is the only available reading of them. An episode
// count is different in kind — it is a property of the podcast, with a true
// value out in the world — so printing one next to a show's name reads as a
// claim about the show, and ours is not that claim.
export const SORT_OPTIONS = [
  /* ⚠️ THE ONLYBOOSTS CHARTS — rank in sats + rank in boosts + rank in
   * boosters, summed, lowest total first; see "The OnlyBoosts Charts" in
   * docs/feeds.md. Server-ranked on every row (rank + tie flag through
   * toCard); the renderer never renumbers chart rows. First in the menu as
   * the composite the single-axis sorts feed into, and the feeds OPEN on it
   * since 2026-08-31 — the opening constant is pinned to functions/index.js
   * (FEED.sort) and shows-feed.js (DEFAULT_SORT), which move together. */
  ['chart', 'Chart rank'],
  ['boosters', 'Most boosters'],
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
  ['latest', 'Recently boosted'],
]

// Sorts where a position means something, so the card gets a rank number.
// 'latest' is chronology, not standing.
export const RANKED_SORTS = new Set(['chart', 'boosts', 'sats', 'boosters'])

// Show cards per page, and per "Load more" batch. ⚠️ ONE NUMBER, READ BY BOTH
// SIDES: functions/_shared/show-cards.js re-exports it and shows-feed.js
// imports it, because a server render that painted a different number than the
// client's first slice would make "Load N more" skip or repeat rows.
export const SHOW_CARDS_PER_PAGE = 25

/* The value a rank is computed over, for a given sort.
 *
 * ⚠️ THE SORT KEYS AND THE CARD FIELDS ARE THE SAME NAMES ON PURPOSE, which is
 * what makes this one line. `/api/v1/podcasts` orders by the same aggregate it
 * projects under that name, so competitionRanks is being handed rows already
 * ordered by exactly the value it is about to rank — the precondition it does
 * not check and cannot detect. Rename either side and this is where it breaks.
 */
export function showRankValue(sortKey) {
  return (s) => Number(s && s[sortKey]) || 0
}

// ── Formatting ───────────────────────────────────────────────────────
// The published index is not contractually typed and the shards stringify their
// numerics ("9", "55987", "None") — coerce rather than trusting typeof.
export function num(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}

export function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`
  return String(n)
}

// en-US, pinned. See the header: a card built at the edge and the same card
// rebuilt in the browser after a re-sort must be the same string.
// Exported for the feed's search sub-line, which formats the same two figures.
export function plural(n, one, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

// en-US in UTC, matching episode-card.js#fullDate and detail-page.js.
export function shortDate(unixSec) {
  const n = num(unixSec)
  if (!n) return ''
  const d = new Date(n * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function attr(name, value) {
  return value == null || value === '' ? '' : ` ${name}="${esc(value)}"`
}

/* An API record → the card's own shape.
 *
 * Kept here beside the renderer so the edge and the browser shape a row the same
 * way. `rank` is present only on a search hit: the position in the FULL
 * ordering, which a filtered page cannot be numbered by.
 */
export function toCard(p) {
  return {
    guid: p.guid,
    title: typeof p.title === 'string' ? p.title : '',
    img: typeof p.img === 'string' ? p.img : '',
    // The feed's OTHER artwork URL, published only when it differs from `img`.
    // A handful of shows have a dead primary and a live second — see cover-art.js.
    art2: typeof p.art2 === 'string' ? p.art2 : '',
    feed: typeof p.feed === 'string' ? p.feed : '',
    // <itunes:author>: the artist on a music feed, the host or publisher on a
    // podcast. Matched by the search box server-side, never displayed here —
    // the credit line belongs on the show's own page, next to its name.
    author: typeof p.author === 'string' ? p.author : '',
    boosts: num(p.boosts),
    sats: num(p.sats),
    boosters: num(p.boosters),
    episodes: num(p.episodes),
    latest: num(p.latest),
    rank: Number.isFinite(p.rank) ? p.rank : null,
    // The chart sort's corpus-true tie flag, riding beside its rank.
    tied: p.tied === true,
  }
}

/* ── One card ──────────────────────────────────────────────────────────
 *
 * @param {object} s       a row through toCard()
 * @param {string} [rank]  the rank LABEL ('4' or 'T4'), already formatted by
 *                         rank.js#rankLabel. Null on a chronological sort.
 * @param {object} copy    COPY.other or COPY.music
 */
export function showCardHtml(s, { rank = null, copy = COPY.other } = {}) {
  /* 462 of the 1,384 shows in the index (33%) have no title and no art: the
   * collector holds a boost tagged with their guid but Podcast Index doesn't
   * know the feed, so there is nothing to enrich from. They're the long tail —
   * median 1 boost, 3.8% of all sats, and the first one doesn't appear until #28
   * on any sort — so they never crowd the first page. Kept rather than filtered
   * (they're real boosts to real shows) but labelled for what they are, with the
   * guid shown, so an unnamed card reads as incomplete data rather than a broken
   * site. */
  const named = !!s.title

  /* Artwork: the feed's primary, then its second-chance URL, then the glyph.
   * `data-art2` is the chain's tail and is read by detail-page.js#wireArt2 — the
   * same attribute and the same walker every other surface with artwork uses, so
   * the fallback is one implementation site-wide. The DOM version called
   * wireCoverFallback() here, which is a VERB and has moved next door. */
  const chain = coverChain(s.img, s.art2)
  const mediaInner = chain.length
    ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(chain[0])}"` +
      attr('data-art2', chain[1]) + ` />`
    : esc(copy.glyph)
  const mediaClass = 'pcast-card-media' + (chain.length ? '' : ' pcast-card-media--none')
  const media = `<div class="${mediaClass}">${mediaInner}</div>`

  /* ⚠️ THE BOOST PILL SHIPS `hidden` AND JAVASCRIPT REVEALS IT. Boosting needs a
   * signer and a value-block lookup, so it is a VERB and cannot work without the
   * module that attaches it; a button that is present and inert is worse than
   * one that arrives. Same arrangement episode-card.js and the /show hero use,
   * and .ob-boost-pill is defined once in theme.css.
   *
   * Withheld entirely from unidentified shows for the same reason they get no
   * landing page: Podcast Index doesn't know the feed, so there is no value
   * block to resolve and the button could only ever fail. */
  const boostable = named && (s.guid || s.feed)
  const pill = boostable
    ? `<button type="button" class="ob-boost-pill" hidden data-boost-show` +
      ` title="Boost ${esc(s.title)}" aria-label="Boost ${esc(s.title)}">Boost</button>`
    : ''

  /* "Nostr Stats:" carries the qualifier that used to sit in a paragraph above
   * the whole feed. Two words on the line the figures are already on, rather
   * than three lines of caveat before the first card. The boost pill rides the
   * end of this line rather than sitting in a button row of its own,
   * right-aligned by .ob-boost-pill's own margin-left. */
  const stats =
    `<div class="pcast-meta ob-show-stats">` +
      `<span class="ob-stats-label">Nostr Stats:</span>` +
      `<span class="pcast-sats">${esc(fmtSats(s.sats))}<span class="pcast-bolt" aria-hidden="true"> ⚡</span></span>` +
      `<span class="pcast-dot" aria-hidden="true">·</span>` +
      `<span>${esc(plural(s.boosts, 'boost', 'boosts'))}</span>` +
      `<span class="pcast-dot" aria-hidden="true">·</span>` +
      `<span>${esc(plural(s.boosters, 'booster', 'boosters'))}</span>` +
      pill +
    `</div>`

  // Named shows link to their landing page; unnamed ones don't, because there is
  // no page — the qualifying rule for one is exactly "has a title". See
  // docs/show-pages-spec.md and show-link.js.
  const href = named ? showPageHref(s.guid) : null
  const titleEl = href
    ? `<h3 class="pcast-title"><a class="ob-show-link" href="${esc(href)}" title="Nostr boosts to ${esc(s.title)}">${esc(s.title)}</a></h3>`
    : `<h3 class="pcast-title${named ? '' : ' ob-show-unnamed'}">${esc(named ? s.title : copy.unidentified)}</h3>`

  // The guid stands in for a name we don't have. It's the only handle on the
  // show, and it's what you'd search the collector for.
  const guidEl = named ? '' : `<div class="ob-show-guid">${esc(s.guid)}</div>`

  /* ⚠️ THE ABSOLUTE DATE IS RENDERED AND THE RELATIVE ONE IS ATTACHED. See the
   * header. `data-ts` is the fact; show-card-actions.js rewrites the text to
   * "3d ago" for a reader who has JavaScript, and a crawler keeps a date that
   * does not go stale. */
  const latestEl = s.latest
    ? `<div class="ob-show-latest" data-latest-ts="${esc(String(s.latest))}">last boost ${esc(shortDate(s.latest))}</div>`
    : ''

  // aria-hidden because the visual order already conveys the rank to a screen
  // reader, and an announced "1." before every show title is noise.
  const rankEl = rank == null ? ''
    : `<div class="pcast-rank" aria-hidden="true">${esc(String(rank))}</div>`

  const head = `<div class="pcast-card-head">${rankEl}${media}` +
    `<div class="pcast-card-body">${titleEl}${guidEl}${stats}${latestEl}</div></div>`

  /* No drawer when there's nothing to put in it. A show can legitimately have
   * boosts and no episodes: the index reports 0 for shows whose boosts never
   * carried an episode guid, and the windowed rollup counts distinct guids, so
   * the same holds there. Offering a drawer would spend a fetch to say "no
   * episodes". */
  const drawer = s.episodes ? drawerHtml(s, copy, href) : ''

  /* The card's data attributes are the whole contract with show-card-actions.js,
   * which has no show object to close over. They are the primitives the boost
   * path needs — /api/value takes a podcast guid or a feed URL — plus the guid
   * the drawer fetches on, and the noun so a toast on a music card says "album".
   * Nothing here duplicates text that is already in the markup. */
  return `<article class="pcast-card" data-show-card` +
    attr('data-guid', s.guid) +
    attr('data-title', s.title) +
    attr('data-noun', copy.noun) +
    attr('data-feed-url', s.feed) +
    `>${head}${drawer}</article>`
}

/* The drawer's lid and its empty body.
 *
 * ⚠️ A <details>, NOT A BUTTON BESIDE A HIDDEN DIV, which is what the DOM
 * version was. <details> opens with no JavaScript, so the reader always gets
 * something when they press it — and what they get with no JavaScript is the
 * footer link to the show's own page, which is a better answer than the inert
 * button they used to get. Same element and the same classes episode-card.js
 * uses, so feed-cards.css's caret rotation off [open] applies unchanged.
 *
 * ⚠️ THE BODY IS ALWAYS LAZY, and that is a fact about the data rather than a
 * variant to make configurable. The rows come from /api/v1/podcasts/<guid>,
 * scoped to the card's own range, so they are never in hand when the card is
 * built — at the edge OR in the browser. There is no inline counterpart to
 * choose between, which is why this card has no `parts` table the way the
 * episode card does. Add one when a second surface actually wants a variant.
 */
function drawerHtml(s, copy, href) {
  // ⚠️ THE EPISODE CARD'S OWN FOOTER CLASSES, not a parallel pair. A reader who
  // screenshots the two drawers must not be able to tell them apart, and
  // .pcast-details-foot / .pcast-seeall are already defined in feed-cards.css
  // for exactly this row. Inventing .ob-ep-foot here would have been two
  // definitions of one thing, and only one of them styled.
  const foot = href
    ? `<div class="pcast-details-foot"><a class="pcast-seeall" href="${esc(href)}">${esc(copy.drawerFoot)} →</a></div>`
    : ''
  return `<details class="pcast-card-details">` +
    `<summary class="pcast-drawer">` +
      `<span class="pcast-drawer-caret" aria-hidden="true">▾</span>` +
      `<span>${esc(copy.drawer)}</span>` +
    `</summary>` +
    // `data-lazy-episodes` is the hook show-card-actions.js fills on first open.
    // The rows land in front of the footer, so a filled drawer and this one are
    // the same markup with a list inserted.
    `<div class="pcast-details" data-lazy-episodes>` +
      `<div class="pcast-boosts-status" data-drawer-status>${esc(copy.drawerLoading)}</div>` +
      foot +
    `</div>` +
    `</details>`
}

/* ── The drawer's episode rows ─────────────────────────────────────────
 *
 * Newest first: the list reads as the show's recent catalogue, with each row
 * carrying what it took. The episode-level RANKING question is what the Episodes
 * feeds are for, so no row here is numbered.
 *
 * The row's TITLE links to that episode's page, the same rule and the same
 * module every other episode surface uses — see show-link.js#episodePageHref and
 * the link section in CLAUDE.md. `e.url` (the audio itself) is the fallback for
 * an episode with no title to qualify it, and is the only branch that opens a
 * new tab.
 *
 * Exported because show-card-actions.js renders it into an already-painted
 * drawer: the same function on both sides, so a fetched row is byte-identical to
 * one this module produced. That is the arrangement boostRowsHtml has in
 * episode-card.js.
 */
export function episodeRowsHtml(eps, copy, { truncatedFrom = 0 } = {}) {
  if (!eps.length) return `<div class="ob-show-note">${esc(copy.noItems)}</div>`

  const rows = eps.map((e) => {
    const title = e.title || copy.untitledItem
    const epHref = episodePageHref(e.guid, e.title)
    const meta = [shortDate(e.date), e.boosts ? plural(e.boosts, 'boost', 'boosts') : null]
      .filter(Boolean).join(' · ')
    const titleEl = epHref
      ? `<a class="ob-ep-title" href="${esc(epHref)}" title="Nostr boosts to ${esc(title)}">${esc(title)}</a>`
      : isSafeUrl(e.url)
        ? `<a class="ob-ep-title" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`
        : `<span class="ob-ep-title">${esc(title)}</span>`
    return `<li class="ob-ep">` +
      `<div class="ob-ep-main">${titleEl}` +
      (meta ? `<span class="ob-ep-meta">${esc(meta)}</span>` : '') +
      `</div>` +
      (e.sats ? `<span class="ob-ep-sats">${esc(fmtSats(e.sats))}<span class="pcast-bolt" aria-hidden="true"> ⚡</span></span>` : '') +
      `</li>`
  }).join('')

  const note = truncatedFrom > eps.length
    ? `<div class="ob-show-note">${esc(copy.truncated(eps.length, truncatedFrom))}</div>`
    : ''
  return `<ul class="ob-ep-list">${rows}</ul>${note}`
}

// Newest episode first. Kept beside the renderer because both sides sort before
// slicing to DRAWER_EPISODES, and a different order either side would show
// different rows rather than the same rows rearranged.
export function sortEpisodeRows(eps) {
  return [...eps].sort((a, b) => num(b.date) - num(a.date))
}

/* ── A page of cards ───────────────────────────────────────────────────
 * `rankOf` is a function rather than a field on the row so the caller owns the
 * scheme: the edge stamps a competition rank over a prefix from offset 0, and
 * shows-feed.js re-stamps after every append. See rank.js.
 */
export function renderShowCards(cards, { copy = COPY.other, rankOf = () => null } = {}) {
  return cards.map((s, i) => showCardHtml(s, { rank: rankOf(s, i), copy })).join('')
}
