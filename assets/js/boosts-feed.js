/* Boosts feed — the note-level view behind the two Boosts feeds.
 *
 * One card per kind-1 boost note, newest first. The Episodes feeds render the
 * same data rolled up by episode; this renders the boosts themselves.
 *
 * Both scopes read ob-live.js now, cursor-paged off the same D1 table: Global
 * through GET /api/v1/boosts, Follows through POST /api/v1/boosts/follows,
 * which filters to the contact list server-side. They are one reader interface
 * with two backings, so the paging, the coverage pass and the sorting below are
 * shared rather than branched.
 *
 * Global used to open on the latest.json shard and page back a whole month
 * archive at a time. That is what a static export can offer and not what a feed
 * wants: the shard lags its own edge by the collector's publish interval, so the
 * newest boosts were missing from the feed whose job is to show them, and "load
 * older" fetched hundreds of KB to paint thirty more cards.
 *
 * Range and sort (feed-controls.js, shared with the Episodes rollup): the
 * range filters on when the boost was SENT, which is the axis a note feed is
 * ordered by. Sorting applies to the selected window, so a bounded window is
 * paged in completely before it's painted — see ensureCoverage below.
 *
 * Booster names and avatars are embedded in each record on both paths, so
 * unlike the old LB feed there is no profile round-trip and nothing to
 * repaint — the first paint is the final one.
 *
 * On the note shape: the feed carries each boost's identity and content
 * (id / booster.pk / ts / msg / sats) but not the signed event. That's
 * enough — the card needs only those fields, and reply / repost / like / zap
 * need only id + pubkey. The object handed to buildActionBar below is a
 * projection, not a verified event; don't pass it anywhere that assumes one.
 */
import { nip19 } from '/assets/widgets/nostr-tools.js?v=ob-v176'
import { buildActionBar, configureBoostActions } from '/assets/js/boost-actions.js?v=ob-v176'
// ⚠️ wireNpubCopy WAS IMPORTED HERE and is not any more. The avatar and the name
// were its only two callers on this feed, and both are now links to
// /booster/<npub>. Unlike the Episodes drawer — where the per-boost ⋮ menu
// absorbed the gesture — a Boosts card has no menu, so copying a booster's npub
// from this feed means opening their page, which leads with the button.
// Its own module rather than a third export from show-link.js; see the note at
// the head of booster-link.js and the ob-v53 entry in CLAUDE.md.
import { boosterPageHref, markBoosterLink } from '/assets/js/booster-link.js?v=ob-v176'
import { parseSegments, renderSegmentsInto, setCachedProfile } from '/assets/js/boosts-thread.js?v=ob-v176'
import { fetchProfiles } from '/assets/js/primal-profiles.js?v=ob-v176'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v176'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v176'
import { boosterLabel } from '/assets/js/ob-data.js?v=ob-v176'
import { clientLabel, hasClientLabel } from '/assets/js/client-label.js?v=ob-v176'
import { followsBoostReader, globalBoostReader } from '/assets/js/ob-live.js?v=ob-v176'
import { resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v176'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls,
  RANGE_OPTIONS,
} from '/assets/js/feed-controls.js?v=ob-v176'

import { showPageHref, episodePageHref } from '/assets/js/show-link.js?v=ob-v176'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v176'

const PAGE_SIZE = 30

// ── Range + sort ──────────────────────────────────────────────────────
// The range filters on boost time (b.ts), not on when the episode aired — a
// card here is one boost, so "the last 7 days" means the boosts sent in them.
// The Episodes rollup's identical buttons mean air date instead, which is why
// each feed writes its own tooltips.
function rangeTitle(key) {
  const days = rangeDays(key)
  return days ? `Boosts sent in the last ${days} days` : 'All boosts'
}

// ⚠️ ALL FOUR RANGES NOW, AND 1Y IS NOT WALKED. Reed's call, 2026-08-23, on
// seeing it missing beside the members wall's four buttons.
//
// This feed WALKS a bounded window in rather than querying it: `ensureCoverage`
// has to hold every boost in the range before it can sort them, or "largest
// boost" ranks whichever pages happened to land. At ~38 boosts a day 1W is ~280
// rows and 1M ~1,140, both a handful of 200-row requests. A year is ~13,900,
// which is ~70 sequential requests and several megabytes before the first card
// paints, and that is why 1Y was left out rather than merely slow.
//
// ⚠️ WHAT UNBLOCKED IT WAS NOT A NEW QUERY. `/api/v1/boosts` does take `since`,
// but `globalBoostReader` deliberately does not pass it — a `since`-bounded page
// returns no cursor, so the client could not page back OUT when the reader
// widens their range again. That note still stands.
//
// What 1Y gets instead is the treatment **All already has**: it is not
// pre-walked, a non-chronological sort ranks only what has been loaded, and the
// count line says so in those words. The honesty was already built; 1Y was the
// one bounded window big enough to need it. See UNWALKED below.
/* Named for what it is rather than for what it filtered: it was
   `WALKED_RANGES`, a subset with '1y' removed, and both halves of that name are
   now wrong. */
const BOOST_RANGES = RANGE_OPTIONS

/* The windows that are NOT paged in before they are painted. `all` has no
   cutoff to page to; `1y` has one and is deliberately left unwalked, because
   reaching it costs ~70 sequential requests before the first card. */
const UNWALKED = new Set(['all', '1y'])

// Deliberately shorter than the Episodes rollup's menu: an episode card
// aggregates many boosts and can be ranked by boosters / boosts / sats, but a
// single boost's only quantitative axis is its own size.
const SORT_OPTIONS = [
  ['recent', 'Latest boost'],
  ['episode', 'Latest episode'],
  ['sats', 'Largest boost'],
]

// `episode.date` is null on ~12% of records (and on every record with no
// episode metadata at all), so undated boosts sort to the bottom of the
// episode order rather than to the top, where a 0 would put them.
function epTime(b) {
  const t = b.episode?.date
  return Number.isFinite(t) ? t : -Infinity
}
const SORTERS = {
  recent: (a, b) => b.ts - a.ts,
  // Compared before subtracting: two undated rows would otherwise be
  // -Infinity - -Infinity, i.e. NaN, in the comparator.
  episode: (a, b) => {
    const ea = epTime(a)
    const eb = epTime(b)
    return ea === eb ? b.ts - a.ts : eb - ea
  },
  sats: (a, b) => ((b.sats || 0) - (a.sats || 0)) || (b.ts - a.ts),
}

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) {
    if (kid == null) continue
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid)
  }
  return el
}

function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

/* ⚠️ THE LOCAL LABEL MAP AND ITS RESOLVER WERE DELETED ON 2026-08-24, and what
 * replaced them is a different FIELD as much as a different table. They read
 * `b.client` — the raw NIP-89 tag, exactly as the publisher signed it — which
 * is on ~1.3% of the corpus and absent from Fountain, the app behind ~94% of
 * it. So this card carried a "via" line that was correct and almost never
 * present, and the map needed domain-shaped keys ('fountain.fm',
 * 'localbitcoiners.com') plus a suffix-stripping fallback to cope with whatever
 * string an app happened to write.
 *
 * `client_app.id` is the collector's own derivation from three signals and
 * covers 99.8% of rows, as an opaque slug that needs no normalising. So the
 * table is now a plain slug lookup shared with the detail pages
 * (client-label.js), and a rename lands on both surfaces at once.
 */

function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`
  return String(n)
}

// The npub to copy for a booster. The feed carries one on most records, but
// `booster.npub` is nullable where `booster.pk` is not — so derive it from the
// hex pubkey when it's missing rather than leaving those cards inert.
function boosterNpub(booster) {
  if (booster?.npub) return booster.npub
  try { return nip19.npubEncode(booster.pk) } catch { return '' }
}

function renderPlaceholder(list, title, body) {
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''),
  ]))
}

// ── card ──────────────────────────────────────────────────────────────
// Mirrors boosts-thread.js#renderNoteCard's structure so the shared
// .note-card CSS applies, plus a boost-meta row (sats + what was boosted)
// that a plain kind-1 card has no concept of. Not calling renderNoteCard
// directly: it caches by event id and appends its own action bar, so our
// meta row would double up on a cached repaint.
function renderBoostCard(b) {
  // Avatar falls back to the show art before the generic placeholder — for a
  // booster with no kind-0 picture, the podcast they boosted is more
  // informative than an anonymous silhouette. Four links in the chain, and the
  // last is guaranteed, so this always resolves to something: the booster's
  // own picture, the show's primary art, its second-chance art, the silhouette.
  const img = h('img', { alt: '', referrerpolicy: 'no-referrer' })
  wireCoverFallback(img, coverChain(
    b.booster.pic, b.podcast.img, b.podcast.art2, '/assets/avatar-fallback.svg',
  ))

  /* ⚠️ THE AVATAR AND THE NAME USED TO COPY THE NPUB AND NOW OPEN THAT
   * BOOSTER'S PAGE. The gesture moved rather than being dropped:
   * /booster/<npub> leads with a Copy npub button, and the card's own ⋮ menu is
   * where a reader who wants the identifier without leaving the feed finds it.
   *
   * The NAME is the primary link and the avatar is marked secondary — one card
   * offering two tab stops and two announcements for one destination is what
   * that flag exists to prevent. Both stay clickable with a mouse.
   *
   * The label falls back to the pubkey because `booster.npub` is nullable where
   * `booster.pk` is not, and /booster/<npub> accepts either form. */
  const npub = boosterNpub(b.booster)
  const label = boosterLabel(b.booster)
  const href = boosterPageHref(npub, b.booster.pk)

  const nameEl = href
    ? markBoosterLink(h('a', { class: 'author-name', href, text: label }), { label })
    : h('span', { class: 'author-name', text: label })
  const nameWrap = h('div', { class: 'note-author-name-wrap' }, [nameEl])

  // The avatar is wrapped rather than turned into a link, so wireCoverFallback
  // above keeps operating on the <img> it was handed.
  const avatarEl = href
    ? markBoosterLink(h('a', { class: 'note-avatar-link', href }, [img]), { label, secondary: true })
    : img

  const time = h('time', {
    datetime: new Date(b.ts * 1000).toISOString(),
    title: new Date(b.ts * 1000).toLocaleString(),
    text: relTime(b.ts),
  })

  const card = h('article', { class: 'note-card' }, [
    h('div', { class: 'note-author' }, [avatarEl, nameWrap, time]),
  ])

  // What was boosted. Every part is optional: podcast.guid is null on ~2% of
  // rows and episode.title on ~11%, so the row renders whatever it has and
  // is skipped entirely when it has nothing.
  const bits = []
  if (b.sats > 0) {
    bits.push(h('span', { class: 'ob-boost-sats' }, [
      fmtSats(b.sats), h('span', { class: 'ob-bolt', 'aria-hidden': 'true', text: '⚡' }),
    ]))
  }
  // Which app published the note, beside the sats — the same chip, in the same
  // position, that boost-list.js renders on the three detail pages. The two
  // renderers are separate by design (this one builds DOM, that one a string),
  // so the SHARED part is the label table: both read client-label.js, and a
  // rename lands on both. Absent when the collector could not attribute the
  // boost, which is ~0.2% of rows; see hasClientLabel.
  if (hasClientLabel(b.clientId)) {
    bits.push(h('span', { class: 'ob-boost-via', text: `via ${clientLabel(b.clientId)}` }))
  }
  // The episode title goes to that episode's landing page — the same rule the
  // Episodes cards apply, through the same module. It used to point at
  // `episode.url`, the audio itself, which was the only destination this card
  // had before the pages existed; that URL is now the fallback for the 500
  // episodes with no title of their own to qualify them, and it opens in a new
  // tab where the page navigates in place.
  if (b.episode.title) {
    const epHref = episodePageHref(b.episode.guid, b.episode.title)
    bits.push(epHref
      ? h('a', {
          class: 'ob-boost-ep', href: epHref,
          title: `Nostr boosts to ${b.episode.title}`, text: b.episode.title,
        })
      : isSafeUrl(b.episode.url)
        ? h('a', {
            class: 'ob-boost-ep', href: b.episode.url,
            target: '_blank', rel: 'noopener noreferrer', text: b.episode.title,
          })
        : h('span', { class: 'ob-boost-ep', text: b.episode.title }))
  }
  // The show name links to its landing page. Both names on this row now point at
  // the page for the thing they name, which is the same pairing the Episodes
  // cards carry.
  if (b.podcast.title) {
    const href = showPageHref(b.podcast.guid)
    bits.push(href
      ? h('a', {
          class: 'ob-boost-show ob-boost-show-link', href,
          title: `Nostr boosts to ${b.podcast.title}`,
          text: b.podcast.title,
        })
      : h('span', { class: 'ob-boost-show', text: b.podcast.title }))
  }
  if (bits.length) card.appendChild(h('div', { class: 'ob-boost-meta' }, bits))

  if (b.msg) {
    const body = h('div', { class: 'note-body' })
    // Shared tokenizer: nostr: mentions → chips, URLs → links, rest as text.
    // msg is verbatim from the boosting client and routinely contains both.
    // inEmbed keeps a quoted note as a chip rather than firing an embed fetch
    // for every card on the page.
    renderSegmentsInto(body, parseSegments(b.msg), { inEmbed: true })
    card.appendChild(body)
  }

  const ev = {
    id: b.id, pubkey: b.booster.pk, kind: 1,
    content: b.msg || '', created_at: b.ts, tags: [],
  }
  try { card.appendChild(buildActionBar(ev, card)) }
  catch (e) { console.warn('[boosts] action bar failed', e) }

  return card
}

// ── paging sources ────────────────────────────────────────────────────
// Global pages through immutable month shards; Follows pages through a D1
// cursor. The rendering below shouldn't care which, so both are wrapped in one
// interface:
//
//   rows        accumulated rows, newest-first (a stable array, mutated in place)
//   hasMore     whether anything is left to fetch
//   loadMore()  fetch the next batch, resolving to how many rows it added
//   moreLabel   what the "load older" button says
//
// loadMore() resolving to 0 means "nothing left", so both implementations keep
// pulling until they add something rather than returning 0 on a batch that
// happened to be all duplicates.

/* ⚠️ THE GLOBAL SOURCE NO LONGER READS STATIC SHARDS.
 *
 * It used to open on `latest.json` — the most recent ~1,000 boosts — and page
 * backwards a WHOLE MONTH ARCHIVE at a time. Two things were wrong with that,
 * and neither was speed. The shard lags its own edge by the collector's publish
 * interval, so the newest boosts on the site were missing from the feed whose
 * entire job is to show them; and "load older" fetched a month (hundreds of KB)
 * to paint thirty more cards, which is why the button had to name the month
 * rather than a count.
 *
 * `/api/v1/boosts` is cursor-paged off the same table everything else reads, so
 * the two scopes are now one reader interface with two backings and the button
 * says the same thing on both.
 */
async function createGlobalSource() {
  const reader = globalBoostReader()
  // Pull the first page here so a fetch failure surfaces as "couldn't load"
  // rather than after an empty list is painted — same as the Follows path.
  await reader.loadMore()
  return {
    rows: reader.rows,
    get hasMore() { return reader.hasMore },
    // No month to name any more: the cursor walks the table itself, which does
    // not line up with archive boundaries.
    moreLabel: 'Load older boosts',
    loadMore: () => reader.loadMore(),
  }
}

async function createFollowsSource(authors) {
  const reader = followsBoostReader(authors)
  // Pull the first page here so a fetch failure surfaces as "couldn't load"
  // alongside the Global path's, rather than after the empty list is painted.
  await reader.loadMore()
  return {
    rows: reader.rows,
    get hasMore() { return reader.hasMore },
    // No month to name: the cursor walks the follow set's own history, which
    // doesn't line up with archive boundaries.
    get moreLabel() { return 'Load older boosts' },
    loadMore: () => reader.loadMore(),
  }
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} [opts.panel] the feed's panel, for its feed key
 * @param {Element} opts.list   the [data-feed-list] container to fill
 * @param {string}  opts.scope  'global' | 'follows'
 */
export async function renderBoosts({ panel, list, scope = 'global' }) {
  if (!list) return
  /* ⚠️ STILL CALLED THOUGH NOTHING MOUNTS HERE ANY MORE, and deliberately: a
     reader who loaded this page before the lookup moved may still be holding a
     cached module that mounted a box into this panel's host. Clearing it is one
     call and the alternative is a dead search box over a feed that no longer
     reads it. */
  resetFeedSearch(panel)

  // Resolve the audience first — a signed-out Follows tab should say so
  // without touching the network, and the query below can't be built at all
  // until we know who to scope it to.
  let follows = null
  if (scope === 'follows') {
    const res = await resolveFollows()
    if (res.status === 'signed-out') {
      renderPlaceholder(list, 'Sign in to see this feed',
        ' Follows feeds read your kind-3 contact list, so they need a signed-in npub.')
      return
    }
    if (res.status === 'unavailable') {
      renderPlaceholder(list, 'Couldn’t load your follow list',
        ' We couldn’t reach a relay holding your kind-3 contact list — please try again later.')
      return
    }
    if (res.status === 'empty') {
      renderPlaceholder(list, 'You’re not following anyone yet',
        ' Follow some npubs in any Nostr client and their boosts will show up here.')
      return
    }
    // Kept as the array the API takes, not a Set — the filtering that used to
    // need fast membership tests now happens in SQL.
    follows = res.follows
  }

  let source
  try {
    source = follows
      ? await createFollowsSource(follows)
      : await createGlobalSource()
  } catch (e) {
    console.error('[boosts] fetch failed', e)
    renderPlaceholder(list, 'Couldn’t load boosts',
      ' The boosts feed is unavailable right now — please try again later.')
    return
  }

  const rows = source.rows

  if (!rows.length && !source.hasMore) {
    renderPlaceholder(list,
      follows ? 'No boosts from your follows yet' : 'No boosts yet',
      follows
        ? ' Nobody you follow has boosted a podcast on Nostr yet. Switch to Global to see everyone.'
        : ' When someone boosts a podcast episode on Nostr, it’ll show up here.')
    return
  }

  setTimeout(() => {
    ensureLoginWidget()
      .then(() => { try { configureBoostActions({}) } catch {} })
      .catch(() => {})
  }, 1200)

  const cards = h('div', { class: 'ob-boost-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })
  // Opening view is the whole feed, newest first — what this feed showed
  // before it had controls.
  let rangeKey = 'all'
  let sortKey = 'recent'
  let view = rows
  let shown = 0
  // Guards an in-flight coverage fetch against a newer selection landing
  // while it's still running.
  let seq = 0

  // The rows in the selected window, in the selected order. 'recent' over
  // 'all' is the source's own order, so the default view is the source's own
  // array — paging appends to it and nothing has to be copied or re-sorted.
  //
  /* ⚠️ THIS FEED HAS NO SEARCH, AND THAT IS NOT AN OMISSION. It carried a
     member filter until 2026-08-23; the lookup now leads the Members tab and
     NAVIGATES to /booster/<npub> instead. Reed's call, and the argument is that
     a filter was answering the wrong question — "where is this person" is
     answered by their page, not by a narrowed slice of one feed.

     Two attempts are buried here, so neither comes back: `boosterEntries()`
     indexed the boosts in memory, which reached 34 of 2,011 members on the
     first page and only 684 after paging in all 23,259; `pickedRows` fixed that
     by fetching the member's own corpus, at which point the feed was rendering
     a different subject than the one its controls described. See
     mountMemberLookup in members-board.js. */
  function buildView() {
    const cutoff = rangeCutoff(rangeKey)
    const scoped = cutoff ? rows.filter((b) => b.ts >= cutoff) : rows
    return sortKey === 'recent' ? scoped : [...scoped].sort(SORTERS[sortKey])
  }

  function oldestTs() { return rows.length ? rows[rows.length - 1].ts : Infinity }

  // Whether the loaded corpus stops short of the window's cutoff. A bounded
  // range has to be paged in completely before it's sorted, or the order would
  // be over whichever pages happened to be loaded rather than over the window
  // the user asked for.
  function needsCoverage() {
    const cutoff = rangeCutoff(rangeKey)
    return !!cutoff && source.hasMore && oldestTs() > cutoff
  }

  /* ⚠️ ONE FACT, ONE POLICY, AND THEY ARE SEPARATE ON PURPOSE.
     `needsCoverage()` is the FACT that the loaded corpus does not yet reach the
     window's cutoff; `shouldPreWalk()` is the POLICY that we will sit and page
     until it does. Folding 1Y into the fact would have taken the load-older
     button away from it too, because that button is gated on the same
     condition — and a 1Y view that neither walks nor offers to load more is a
     window the reader can never actually fill. */
  function shouldPreWalk() { return needsCoverage() && !UNWALKED.has(rangeKey) }

  // Cheap by construction, and now identically so on both scopes: a page is
  // ob-live.js's 200 rows. The network publishes ~38 boosts a day, so 1W is
  // ~280 rows (2 requests) and 1M ~1,140 (6) even on Global, where every boost
  // in the window counts. It used to be 0 requests for 1W on Global, because
  // latest.json arrived holding ~1,000 rows spanning ~26 days; that shard is
  // also what made the feed lag its own edge, which is the trade.
  //
  // On Follows it's the same page walk, which is
  // left alone deliberately. The network publishes ~38 boosts a day, so even a
  // follow set covering every booster alive bounds 1W at ~280 rows (2 requests)
  // and 1M at ~1,140 (6). A real contact list is a fraction of that, and pages
  // sized to the *worst* case would mean fetching thousands of rows to fill a
  // window holding a couple of hundred. /api/v1/boosts/follows does take a
  // `since`, which would answer any window in one query — but on a short page
  // it returns no cursor, and the client can't mint the opaque cursor it would
  // then need to keep paging *past* the window when the range widens again.
  async function ensureCoverage() {
    while (shouldPreWalk()) {
      let got = 0
      try {
        got = await source.loadMore()
      } catch (e) {
        console.warn('[boosts] coverage load failed', e)
        break
      }
      if (!got) break
    }
  }

  function paint({ reset = false } = {}) {
    if (reset) { shown = 0; cards.replaceChildren() }
    view = buildView()
    if (!view.length) {
      cards.replaceChildren(h('div', { class: 'feed-placeholder' }, [
        h('strong', { text: 'No boosts in this window' }),
        ' Nothing was boosted in this time range — try a wider one.',
      ]))
      moreWrap.replaceChildren()
      return
    }
    const slice = view.slice(shown, shown + PAGE_SIZE)
    const painted = slice.map((b) => {
      const el = renderBoostCard(b)
      cards.appendChild(el)
      return { b, el }
    })
    shown += slice.length
    updateMoreButton()
    hydrateProfiles(painted)
  }

  function updateMoreButton() {
    moreWrap.replaceChildren()
    const remaining = view.length - shown
    /* Paging further back means something on All, and on any window the corpus
       does not yet reach back to — which is 1Y until it has been filled. A
       pre-walked window is already covered in full, so once it is all on screen
       there is nothing left to fetch *for that window*, and the button goes.
       ⚠️ The 1Y button therefore disappears by itself when the year is covered,
       rather than sitting there loading rows the range filter discards. */
    const canLoadOlder = source.hasMore && (rangeKey === 'all' || needsCoverage())
    if (remaining <= 0 && !canLoadOlder) return

    const btn = h('button', { class: 'pcast-showmore', type: 'button' },
      remaining > 0 ? `Show more (${remaining} more)` : source.moreLabel)
    btn.addEventListener('click', async () => {
      if (remaining > 0) { paint(); return }
      btn.disabled = true
      btn.textContent = 'Loading…'
      let got = 0
      try {
        got = await source.loadMore()
      } catch (e) {
        console.warn('[boosts] load more failed', e)
      }
      // Older rows land after everything on screen in the chronological
      // order, so that page can just be appended. Under any other sort they
      // can outrank what's painted, so the list is rebuilt instead.
      if (got) paint({ reset: sortKey !== 'recent' })
      else updateMoreButton()
    })

    /* ⚠️ THE CLAIM THE COUNT LINE MAKES DEPENDS ON COVERAGE, NOT ON THE RANGE.
       A window that is fully in hand can say "of N in this window"; one that is
       not can only describe what has been loaded, whatever button produced it.
       Keying this on `rangeKey !== 'all'` was right while every bounded window
       was pre-walked, and would have made a half-loaded 1Y claim completeness. */
    const covered = rangeKey !== 'all' && !needsCoverage()
    const note = covered
      ? `Showing ${shown} of ${view.length} in this window`
      : (sortKey === 'recent'
          ? `Showing ${shown} of ${view.length} loaded`
          : `Ranked over the ${view.length} boosts loaded so far`)
    moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
      btn, h('div', { class: 'pcast-more-count', text: note }),
    ]))
  }

  // Range/sort changes both go through here: widen the corpus first if the new
  // window reaches past it, then repaint from the top.
  async function apply(fn) {
    fn()
    const mine = ++seq
    if (needsCoverage()) {
      shown = 0
      cards.replaceChildren(h('div', { class: 'feed-placeholder' }, [
        h('strong', { text: 'Loading this window…' }),
        ' Fetching the rest of the boosts in this range so the order is complete.',
      ]))
      moreWrap.replaceChildren()
      await ensureCoverage()
      if (mine !== seq) return
    }
    paint({ reset: true })
  }

  /* ⚠️ THE FALLBACK KEY IS `members-${scope}` AND IT MUST TRACK THE FEED MAP.
     The panel's own `data-feed` is the real answer; this only fires if the
     renderer is handed a panel without one. It said `boosts-${scope}` after the
     type was renamed on 2026-08-23, which tags the controls group with a key no
     `body[data-active-feed]` rule matches — so the group mounts and is never
     shown, and the feed loses its range and sort with nothing thrown. */
  mountFeedControls(panel?.dataset.feed || `members-${scope}`, [
    rangeControl(rangeKey, (key) => {
      if (key !== rangeKey) apply(() => { rangeKey = key })
    }, {
      label: 'Filter by when the boost was sent',
      titleFor: rangeTitle,
      options: BOOST_RANGES,
    }),
    sortControl(SORT_OPTIONS, sortKey, (key) => {
      if (key !== sortKey) apply(() => { sortKey = key })
    }, { title: 'Sort boosts' }),
  ])

  list.replaceChildren(cards, moreWrap)

  if (!rows.length) {
    // Nothing in the first batch — go looking before declaring it empty.
    // Reachable on Global, where latest.json can lag the archives. The
    // Follows reader already walks until it finds something or runs out, so
    // an empty rows[] there means hasMore is false and we returned above.
    const spinner = h('div', { class: 'feed-placeholder' }, [
      h('strong', { text: 'Looking further back…' }),
      ' No matches in the most recent boosts, checking the archives.',
    ])
    list.replaceChildren(spinner)
    let got = 0
    try {
      got = await source.loadMore()
    } catch (e) {
      console.warn('[boosts] archive walk failed', e)
    }
    if (!got) {
      renderPlaceholder(list,
        follows ? 'No boosts from your follows yet' : 'No boosts yet',
        follows
          ? ' Nobody you follow has boosted a podcast on Nostr yet. Switch to Global to see everyone.'
          : ' When someone boosts a podcast episode on Nostr, it’ll show up here.')
      return
    }
    list.replaceChildren(cards, moreWrap)
  }

  paint()
}

// ── Profile fallback ─────────────────────────────────────────────────
//
// The collector embeds a booster's name and picture in every record, so cards
// normally paint complete and first paint is final. Two things it can't cover,
// both of which would otherwise read as `@npub1abc…`:
//
//   - a booster whose kind-0 hadn't been resolved when the collector last ran
//   - an npub MENTIONED inside a boost message, who need never have boosted
//     anything and so is in no index of ours at all
//
// Both fall back to Primal's cache, which is what the Episodes feed has always
// done for the same two gaps (feeds-podcasts.js#loadMentionProfiles). One batch
// per page of cards, post-paint and best-effort: an unreachable cache leaves
// the cards exactly as they rendered.
function mentionPubkeys(text) {
  const out = []
  for (const m of String(text || '').matchAll(/nostr:((?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi)) {
    try {
      const d = nip19.decode(m[1])
      if (d.type === 'npub') out.push(d.data)
      else if (d.type === 'nprofile') out.push(d.data.pubkey)
    } catch { /* not a valid identifier; the tokenizer renders it as text */ }
  }
  return out
}

async function hydrateProfiles(painted) {
  const want = new Set()
  for (const { b } of painted) {
    if (b.booster?.pk && (!b.booster.name || !b.booster.pic)) want.add(b.booster.pk)
    for (const pk of mentionPubkeys(b.msg)) want.add(pk)
  }
  if (!want.size) return

  const found = await fetchProfiles([...want])
  if (!found.size) return

  // Seed the tokenizer's cache first: mention chips read from it at render
  // time, so it has to be warm before any card is rebuilt.
  for (const [pk, prof] of found) setCachedProfile(pk, prof)

  for (const { b, el } of painted) {
    const prof = b.booster?.pk ? found.get(b.booster.pk) : null
    const mentionsResolved = mentionPubkeys(b.msg).some((pk) => found.has(pk))
    const boosterImproved = prof && ((!b.booster.name && prof.name) || (!b.booster.pic && prof.picture))
    if (!mentionsResolved && !boosterImproved) continue

    if (boosterImproved) {
      if (!b.booster.name && prof.name) b.booster.name = prof.name
      if (!b.booster.pic && prof.picture) b.booster.pic = prof.picture
    }
    // Rebuild rather than patch: the card is one function of the record, so
    // re-running it is the only way to be sure the avatar, the display name and
    // the mention chips inside the message all agree.
    if (el.isConnected) el.replaceWith(renderBoostCard(b))
  }
}

