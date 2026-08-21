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
import { nip19 } from '/assets/widgets/nostr-tools.js?v=ob-v96'
import { buildActionBar, configureBoostActions } from '/assets/js/boost-actions.js?v=ob-v96'
// ⚠️ wireNpubCopy WAS IMPORTED HERE and is not any more. The avatar and the name
// were its only two callers on this feed, and both are now links to
// /booster/<npub>. Unlike the Episodes drawer — where the per-boost ⋮ menu
// absorbed the gesture — a Boosts card has no menu, so copying a booster's npub
// from this feed means opening their page, which leads with the button.
// Its own module rather than a third export from show-link.js; see the note at
// the head of booster-link.js and the ob-v53 entry in CLAUDE.md.
import { boosterPageHref, markBoosterLink } from '/assets/js/booster-link.js?v=ob-v96'
import { parseSegments, renderSegmentsInto, setCachedProfile } from '/assets/js/boosts-thread.js?v=ob-v96'
import { fetchProfiles } from '/assets/js/primal-profiles.js?v=ob-v96'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v96'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v96'
import { boosterLabel } from '/assets/js/ob-data.js?v=ob-v96'
import { followsBoostReader, globalBoostReader } from '/assets/js/ob-live.js?v=ob-v96'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls,
  RANGE_OPTIONS,
} from '/assets/js/feed-controls.js?v=ob-v96'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v96'
import { showPageHref, episodePageHref } from '/assets/js/show-link.js?v=ob-v96'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v96'

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

// 1W / 1M / All, and deliberately no 1Y where the ranked feeds have one.
//
// This feed WALKS its window in rather than querying it: ensureCoverage below
// has to hold every boost in the range before it can sort them, or "largest
// boost" ranks whichever pages happened to land. The network publishes ~38
// boosts a day, so 1W is ~280 rows and 1M ~1,140, both a handful of 200-row
// requests; a year is ~13,900 rows, which is ~70 sequential requests and
// several megabytes before the first card paints. Widening this feed to a year
// means giving it a `since`-scoped query the way /api/v1/episodes and
// /api/v1/podcasts have, so the window is answered rather than walked. That is
// a different feature, not a fourth button.
//
// Derived here rather than exported from feed-controls.js on purpose. Assets
// ship max-age=14400 and each module URL expires on its own clock, so a new
// named export there is unresolvable for up to four hours in any browser
// holding the older copy — and an unresolved named import is a LINK-TIME error
// that takes the whole module down. Filtering a table that module already
// exported degrades instead: an older RANGE_OPTIONS has no '1y' row, so this is
// a no-op and the feed still renders. See feed-note.js for the full note.
const WALKED_RANGES = RANGE_OPTIONS.filter(([key]) => key !== '1y')

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

// The `client` tag as published by the boosting app, tidied for display.
// Apps write it inconsistently — a bare name ("BoostMeBitch"), a domain
// ("localbitcoiners.com"), sometimes with a version suffix — so known values
// get a canonical label and anything else is shown as-is minus a domain
// suffix. Unknown clients are still worth surfacing: seeing an unfamiliar app
// name is more useful than hiding it.
const CLIENT_LABELS = {
  'boostmebitch': 'Boost Me Bitch',
  'localbitcoiners.com': 'Local Bitcoiners',
  'onlyboosts.social': 'OnlyBoosts',
  'fountain': 'Fountain',
  'fountain.fm': 'Fountain',
  'castamatic': 'Castamatic',
  'podverse': 'Podverse',
  'truefans': 'TrueFans',
  'curiocaster': 'CurioCaster',
  'podcastguru': 'Podcast Guru',
}
function clientLabel(raw) {
  if (!raw) return null
  const key = String(raw).trim().toLowerCase()
  if (!key) return null
  if (CLIENT_LABELS[key]) return CLIENT_LABELS[key]
  const bare = key.replace(/^www\./, '').replace(/\.(com|fm|social|app|net|io|org)$/, '')
  if (CLIENT_LABELS[bare]) return CLIENT_LABELS[bare]
  // Fall back to the raw value with its original casing, trimmed of a version
  // suffix like "SomeApp/1.2.3".
  return String(raw).trim().split('/')[0].slice(0, 32)
}

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

  // Where the boost was sent from. Only ~3.5% of records carry a client tag
  // (Fountain, the largest source, doesn't emit one), so the line is omitted
  // rather than rendered as "Unknown" on the other 96% — a column of
  // "Unknown" would be noise, not information.
  const via = clientLabel(b.client)
  if (via) {
    card.appendChild(h('div', { class: 'ob-boost-via' }, [
      h('span', { class: 'ob-via-label', text: 'via ' }),
      h('span', { class: 'ob-via-name', text: via }),
    ]))
  }

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
  // A re-render (account switch) may end on a placeholder, so clear any box a
  // previous run left behind before deciding whether this one gets one.
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
  let search = null
  // The window's rows before the search narrows them — what the booster index
  // is built over, so a suggestion is always someone this window can show.
  let scopedRows = rows

  // The rows in the selected window, in the selected order. 'recent' over
  // 'all' is the source's own order, so the default view is the source's own
  // array — paging appends to it and nothing has to be copied or re-sorted.
  //
  // A search here narrows to one BOOSTER rather than one card: this feed's
  // subject is the person, and a single note is not something anyone knows the
  // name of. There's no rank to retain — a card is one boost, so the feed has
  // no ranked sort and never paints a rank badge.
  function buildView() {
    const cutoff = rangeCutoff(rangeKey)
    scopedRows = cutoff ? rows.filter((b) => b.ts >= cutoff) : rows
    // The corpus behind the index just changed (new window, or a page of older
    // rows landed), so drop it; it rebuilds on the next keystroke.
    search?.refresh()
    const picked = search?.selection || null
    const scoped = picked
      ? scopedRows.filter((b) => b.booster.pk === picked.key)
      : scopedRows
    return sortKey === 'recent' ? scoped : [...scoped].sort(SORTERS[sortKey])
  }

  /** Distinct boosters in the current window, most boosts first. */
  function boosterEntries() {
    const by = new Map()
    for (const b of scopedRows) {
      const pk = b.booster?.pk
      if (!pk) continue
      let e = by.get(pk)
      if (!e) {
        e = { pk, label: boosterLabel(b.booster), npub: boosterNpub(b.booster), pic: b.booster.pic, n: 0, sats: 0 }
        by.set(pk, e)
      }
      // Names and avatars are embedded per record and a given row can be
      // missing either, so fill from whichever row has one.
      if (!e.pic && b.booster.pic) e.pic = b.booster.pic
      e.n++
      e.sats += b.sats || 0
    }
    return [...by.values()]
      .sort((a, b) => b.n - a.n || b.sats - a.sats)
      .map((e) => ({
        key: e.pk,
        label: e.label,
        sub: `${e.npub ? e.npub.slice(0, 12) + '…' : ''}${e.npub ? ' · ' : ''}${e.n.toLocaleString()} boost${e.n === 1 ? '' : 's'}`,
        // Matchable, not shown: a pasted npub or hex pubkey finds its booster
        // even though the row displays a truncated one.
        extra: `${e.npub} ${e.pk}`,
        img: e.pic,
      }))
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
    while (needsCoverage()) {
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
      const picked = search?.selection || null
      cards.replaceChildren(picked
        ? h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: 'Nothing in this window' }),
            ` ${picked.label} sent no boosts in this time range — widen the range, or clear the search.`,
          ])
        : h('div', { class: 'feed-placeholder' }, [
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
    // Paging further back only means anything on All: a bounded window is
    // already covered in full, so once it's all on screen there is nothing
    // left to fetch *for that window*.
    const canLoadOlder = rangeKey === 'all' && source.hasMore
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

    // On All, a non-chronological order can only rank what's been loaded, so
    // say what that is rather than implying it's the whole archive.
    const note = rangeKey !== 'all'
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

  mountFeedControls(panel?.dataset.feed || `boosts-${scope}`, [
    rangeControl(rangeKey, (key) => {
      if (key !== rangeKey) apply(() => { rangeKey = key })
    }, {
      label: 'Filter by when the boost was sent',
      titleFor: rangeTitle,
      options: WALKED_RANGES,
    }),
    sortControl(SORT_OPTIONS, sortKey, (key) => {
      if (key !== sortKey) apply(() => { sortKey = key })
    }, { title: 'Sort boosts' }),
  ])

  // Boosters, not boosts: see buildView. The index covers the loaded window,
  // so on All it grows as older pages land.
  search = mountFeedSearch(panel, {
    placeholder: 'Search boosters by name or npub…',
    label: 'Search boosters',
    noun: 'booster',
    glyph: '👤',
    onPick: () => paint({ reset: true }),
    getEntries: boosterEntries,
  })

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

