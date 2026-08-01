/* Show-level feed — the rollup behind both Shows and Albums in the feed bar.
 *
 * The card is the SHOW, where the Episodes feeds' card is one EPISODE. Same
 * boosts underneath, rolled up a level: how much a show has taken, how many
 * people sent it, across how many episodes. Expanding a card lists that show's
 * episodes with their own boost totals.
 *
 * ── Shows vs Albums ──────────────────────────────────────────────────
 *
 * One renderer serves both, split on <podcast:medium>: a "music" feed is an
 * album whose items are tracks, everything else is a show whose items are
 * episodes. The rollup, the ranking and the card are identical, so the two
 * differ only in the copy table below and in which half of the corpus they
 * keep. Measured against the live index: 818 podcast, 465 music, 2 video.
 *
 * The split is a hard dependency on podcasts/index.json, which is where the
 * medium is published (it's a property of the show, not of a boost — see
 * ob-data.js#mediumPredicate). That's free on the All range, which reads that
 * file anyway, and it makes the windowed ranges need one request they used to
 * do without. Acceptable because All is the opening range on both feeds: a
 * visitor who reaches 1W has already loaded the index, and one that couldn't
 * load it never got past the first paint either.
 *
 * An earlier pass at this replaced the episode feed with it and was reverted
 * (1f24c77) — correctly, since the two views answer different questions and the
 * episode one was never up for replacement. Shows now has its own slot in the
 * feed bar, so nothing is displaced.
 *
 * ── Two sources, one card shape ──────────────────────────────────────
 *
 * The range filter is what decides where a card's numbers come from, because
 * only one of the two sources can answer each range honestly:
 *
 *   All      podcasts/index.json — the collector's own per-show rollup, 1,384
 *            shows with genuinely all-time counts, in one ~440KB request.
 *            Nothing is aggregated in the browser.
 *   1W / 1M  the boost corpus, grouped by podcast.guid here. The published
 *            index has no per-window breakdown, so a windowed view can only be
 *            built from the boosts themselves — and it must be, or a "last 7
 *            days" card would be showing all-time sat totals.
 *
 * That split is also why the windowed ranges are cheap: they read the same
 * latest.json + month archives the Episodes feeds already pull, and ob-data.js
 * caches them for the page's lifetime. Opening Episodes first makes this free.
 *
 * Scope: Global only on both, deliberately. podcasts/index.json is computed
 * over everyone, so it cannot serve a Follows audience — its counts would be
 * wrong for a filtered one. A Shows · Follows would have to roll the D1 corpus
 * up by show (ob-live.js#getFollowsBoosts, the way feeds-podcasts.js does by
 * episode); it just isn't built yet, which is why the scope menu stays hidden
 * on both of these feeds. The two Songs feeds have the axis because they are
 * episode-level and go through feeds-podcasts.js, which never reads this file.
 */
import {
  getPodcastIndex, getPodcastDetail, getShowMediums, getShowAuthors,
  getLatestBoosts, getBoostMonths, getBoostMonth,
} from '/assets/js/ob-data.js'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls,
} from '/assets/js/feed-controls.js'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js'
import { showPageHref, episodePageHref } from '/assets/js/show-link.js'
// Show-level boosting. Same four pieces the episode feed uses, and deliberately
// the same ones: fromApiValue / applyExternalOverrides are where the split
// logic lives, and sharing them is what keeps every surface paying the value
// block a feed actually published.
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'
import { episodeBoostLink } from '/assets/js/episode-link.js'
import { showToast } from '/assets/js/copy-npub.js'
import { boostButton, withBoostBusy } from '/assets/js/boost-button.js'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js'

const PAGE_SIZE = 25       // show cards per "load more" batch
const DRAWER_EPISODES = 50 // episodes listed per expanded show

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

// The shards stringify their numerics ("9", "55987", "None"), and the index
// is not contractually typed either — coerce rather than trusting typeof.
function num(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}

function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`
  return String(n)
}

function relTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

function shortDate(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

function renderPlaceholder(list, title, body) {
  list.className = ''
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''),
  ]))
}

// ── Copy ──────────────────────────────────────────────────────────────
// Everything that differs between Shows and Albums. Nothing structural does.
const COPY = {
  other: {
    glyph: '🎙',
    unidentified: 'Unidentified show',
    noun: 'show',
    drawer: 'Episodes with Nostr Boosts',
    noItems: 'No episodes recorded for this show yet.',
    truncated: (n, total) => `Showing the ${n} most recent of ${total} episodes.`,
    untitledItem: 'Untitled episode',
    rangeLabel: 'Filter by when the show was boosted',
    rangeTitle: (days) => (days ? `Shows boosted in the last ${days} days` : 'All time'),
    sortTitle: 'Sort shows',
    moreLabel: (n) => `Load ${n} more show${n === 1 ? '' : 's'}`,
    countLine: (shown, total) => `Showing ${shown} of ${total}`,
    searchPlaceholder: 'Search shows…',
    searchLabel: 'Search shows',
    searchNoun: 'show',
    loadFail: ['Couldn’t load shows', ' The podcast index is unavailable right now — please try again later.'],
    rangeFail: ['Couldn’t load shows', ' The boosts feed is unavailable right now — please try again later.'],
    loading: ['Loading this window…', ' Rolling the boosts in this range up by show.'],
    emptyAll: ['No shows in this window', ' When someone boosts a podcast episode on Nostr, its show will appear here.'],
    emptyWindow: ['No shows in this window', ' Nothing was boosted in this time range — try a wider one.'],
    outOfRange: (label) => ` ${label} wasn’t boosted in this time range — widen the range, or clear the search.`,
  },
  music: {
    glyph: '💿',
    unidentified: 'Unidentified release',
    noun: 'album',
    drawer: 'Tracks with Nostr Boosts',
    noItems: 'No tracks recorded for this release yet.',
    truncated: (n, total) => `Showing the ${n} most recent of ${total} tracks.`,
    untitledItem: 'Untitled track',
    rangeLabel: 'Filter by when the album was boosted',
    rangeTitle: (days) => (days ? `Albums boosted in the last ${days} days` : 'All time'),
    sortTitle: 'Sort albums',
    moreLabel: (n) => `Load ${n} more album${n === 1 ? '' : 's'}`,
    countLine: (shown, total) => `Showing ${shown} of ${total}`,
    searchPlaceholder: 'Search albums…',
    searchLabel: 'Search albums',
    searchNoun: 'album',
    loadFail: ['Couldn’t load albums', ' The podcast index is unavailable right now — please try again later.'],
    rangeFail: ['Couldn’t load albums', ' The boosts feed is unavailable right now — please try again later.'],
    loading: ['Loading this window…', ' Rolling the boosts in this range up by album.'],
    emptyAll: ['No albums in this window', ' When someone boosts a track from a music feed on Nostr, its album will appear here.'],
    emptyWindow: ['No albums in this window', ' Nothing was boosted in this time range — try a wider one.'],
    outOfRange: (label) => ` ${label} wasn’t boosted in this time range — widen the range, or clear the search.`,
  },
}

// ── Range + sort ──────────────────────────────────────────────────────
// The range filters on boost time: a show is in the 1W view if it was boosted
// in the last 7 days, and its numbers are that week's numbers. (The Episodes
// feeds' identical buttons mean episode air date, which is a different axis —
// each feed writes its own tooltips for exactly that reason.)

// ── On the absence of an episode count ────────────────────────────────
// There used to be a fifth axis here, 'Most episodes', and a matching figure
// on every card. Both are gone, and the data behind them is still loaded (the
// drawer needs it) but never displayed as a number.
//
// The reason: sats, boosts and boosters are measures of boost activity and
// have no meaning outside it, so "as published to Nostr" is the only available
// reading of them. An episode count is different in kind — it is a property of
// the podcast, with a true value out in the world — so printing one next to a
// show's name reads as a claim about the show. Ours is not that claim. It
// counts episodes carrying at least one boost we indexed, which excludes
// keysend boosts entirely and any boost published before NIP-73 tagging was
// in use.
//
// Measured against the shows' own RSS: we held 70 for Rabbit Hole Recap
// against 415 real episodes, and 64 for LINUX Unplugged against 676. It also
// runs the other way — 22 against 21 for Local Bitcoiners — because episodes
// are keyed off item_guid from boosts and a feed can drop or re-guid an item.
// So the number was not even reliably a subset, and no label short enough to
// fit a card could have fixed it.
const SORT_OPTIONS = [
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
  ['boosters', 'Most boosters'],
  ['latest', 'Recently boosted'],
]

// Sorts where a position means something, so the card gets a rank number.
// 'latest' is chronology, not standing.
const RANKED_SORTS = new Set(['boosts', 'sats', 'boosters'])

// Every comparator breaks ties on sats, then on most-recent boost, so the
// order is stable across repaints.
const bySats = (a, b) => b.sats - a.sats || b.latest - a.latest
const SORTERS = {
  boosts: (a, b) => b.boosts - a.boosts || bySats(a, b),
  sats: bySats,
  boosters: (a, b) => b.boosters - a.boosters || bySats(a, b),
  latest: (a, b) => b.latest - a.latest || bySats(a, b),
}

// ── Sources ───────────────────────────────────────────────────────────
// Both produce the same card shape:
//
//   { guid, title, img, feed, file, boosts, sats, boosters, episodes, latest,
//     eps }
//
// `eps` is the episode list when we already hold it (the windowed rollup has
// every boost in memory, so it comes for free) and null when we don't (the
// all-time index carries counts only, so the drawer fetches the shard).

/** All time: the collector's published per-show rollup, as published. */
async function loadAllTime() {
  const rows = await getPodcastIndex()
  return rows.map((p) => ({
    guid: p.guid,
    // <podcast:medium>, straight off the rollup — which is why the all-time
    // range gets the Shows/Albums split for free. The collector already
    // defaults an un-enriched feed to "podcast" per the namespace.
    music: typeof p.medium === 'string' && p.medium.toLowerCase() === 'music',
    title: typeof p.title === 'string' ? p.title : '',
    img: typeof p.img === 'string' ? p.img : '',
    // The feed's OTHER artwork URL, published only when it differs from `img`.
    // A handful of shows have a dead primary and a live second — see
    // cover-art.js.
    art2: typeof p.art2 === 'string' ? p.art2 : '',
    feed: typeof p.feed === 'string' ? p.feed : '',
    // <itunes:author>: the artist on a music feed, the host or publisher on a
    // podcast. Matched by the search box, never displayed here — the credit
    // line belongs on the show's own page, next to its name.
    author: typeof p.author === 'string' ? p.author : '',
    // Verbatim from the rollup — the collector owns its own layout, so a
    // shard path is never built by hand from the guid.
    file: typeof p.file === 'string' ? p.file : '',
    boosts: num(p.boosts),
    sats: num(p.sats),
    boosters: num(p.boosters),
    episodes: num(p.episodes),
    latest: num(p.latest),
    eps: null,
  }))
}

/**
 * Enough boost rows to cover a cutoff, newest-first.
 *
 * latest.json is ~1,000 boosts spanning ~26 days, so 1W is already covered by
 * it and 1M needs one archive. Walking until the oldest row is past the cutoff
 * (rather than taking a fixed number of months) is what keeps that true as the
 * network's volume changes.
 */
async function loadRowsSince(cutoff) {
  const [latest, months] = await Promise.all([getLatestBoosts(), getBoostMonths()])
  const seen = new Set()
  const rows = []
  let oldest = Infinity
  const take = (arr) => {
    for (const b of arr) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      rows.push(b)
      if (b.ts < oldest) oldest = b.ts
    }
  }
  take(latest)
  for (let i = 0; i < months.length && oldest > cutoff; i++) {
    try {
      take(await getBoostMonth(months[i].file))
    } catch (e) {
      console.warn('[shows] month load failed', months[i].file, e)
    }
  }
  return rows.filter((b) => b.ts >= cutoff)
}

/** A window: the boosts in it, grouped by show. */
async function loadWindow(cutoff) {
  // A boost record carries no medium (it's a property of the show), so the
  // windowed path joins it in from the same rollup the all-time path reads
  // wholesale. Deliberately not caught: a group with no medium would land in
  // Shows and never in Albums, so a silent failure is a feed that quietly
  // hides every album. The caller's error placeholder is the honest answer.
  const [rows, mediums, authors] = await Promise.all([
    loadRowsSince(cutoff), getShowMediums(), getShowAuthors(),
  ])
  const byShow = new Map()

  for (const b of rows) {
    const guid = b.podcast.guid
    // ~2% of rows carry no show guid, so there's nothing to group them under.
    // They're still counted in the Boosts feed; they just can't be a card here.
    if (!guid) continue

    let s = byShow.get(guid)
    if (!s) {
      s = {
        guid, title: b.podcast.title || '', img: b.podcast.img || '',
        art2: b.podcast.art2 || '',
        feed: b.podcast.feed || '', file: `podcasts/${guid}.json`,
        music: mediums.get(guid) === 'music',
        // Boost records carry no author (it's a show-level fact, same as the
        // medium), so it joins through the rollup those rows already loaded.
        author: authors.get(guid) || '',
        boosts: 0, sats: 0, boosters: 0, episodes: 0, latest: 0,
        eps: [],
        _boosters: new Set(),
        _eps: new Map(),
      }
      byShow.set(guid, s)
    }
    // Metadata is embedded per boost and any given row can be missing a piece,
    // so fill from whichever row has it.
    if (!s.title && b.podcast.title) s.title = b.podcast.title
    if (!s.img && b.podcast.img) s.img = b.podcast.img
    if (!s.art2 && b.podcast.art2) s.art2 = b.podcast.art2
    if (!s.feed && b.podcast.feed) s.feed = b.podcast.feed

    s.boosts++
    s.sats += b.sats || 0
    if (b.ts > s.latest) s.latest = b.ts
    s._boosters.add(b.booster.pk)

    // Episode guid is an opaque key — sometimes a UUID, sometimes a URL.
    const eg = b.episode.guid
    if (!eg) continue
    let e = s._eps.get(eg)
    if (!e) {
      e = {
        guid: eg, title: b.episode.title || '', img: b.episode.img || '',
        date: b.episode.date || 0, num: b.episode.num || 0,
        url: b.episode.url || '', boosts: 0, sats: 0,
      }
      s._eps.set(eg, e)
    }
    if (!e.title && b.episode.title) e.title = b.episode.title
    if (!e.date && b.episode.date) e.date = b.episode.date
    if (!e.url && b.episode.url) e.url = b.episode.url
    e.boosts++
    e.sats += b.sats || 0
  }

  const out = []
  for (const s of byShow.values()) {
    s.boosters = s._boosters.size
    s.episodes = s._eps.size
    s.eps = [...s._eps.values()]
    delete s._boosters
    delete s._eps
    out.push(s)
  }
  return out
}

// One entry per range for the page's lifetime. The HTTP layer is already
// cached by ob-data.js; this caches the *grouping*, so toggling 1M → All → 1M
// repaints instantly instead of re-walking a few thousand rows.
//
// Keyed by range alone, NOT by medium: every row carries its own `music` flag
// and the renderer filters after the fact, so Shows and Albums share one
// grouping per range. Opening either makes the other free.
const byRange = new Map()

function loadRange(key) {
  if (byRange.has(key)) return byRange.get(key)
  const cutoff = rangeCutoff(key)
  const p = (cutoff ? loadWindow(cutoff) : loadAllTime())
  byRange.set(key, p)
  // A failed load shouldn't poison the range for the rest of the session.
  p.catch(() => byRange.delete(key))
  return p
}

// ── Episode drawer ────────────────────────────────────────────────────
// Newest episode first: the list reads as the show's recent catalogue, with
// each row carrying what it took. The episode-level ranking question is what
// the Episodes feeds are for.
//
// The row's TITLE links to that episode's page here, the same rule and the same
// module every other episode surface uses — see show-link.js#episodePageHref and
// the link section in CLAUDE.md. It used to point at `e.url`, the audio itself,
// which was the only destination this row had before the pages existed; that URL
// is now the fallback for an episode with no title to qualify it, and it is the
// only branch that still opens a new tab.
//
// Both sources feeding this carry a guid: the All path maps it off the per-show
// shard, and the windowed rollup keys its own episode map on it.
function renderEpisodes(into, eps, copy, { truncatedFrom = 0 } = {}) {
  if (!eps.length) {
    into.replaceChildren(h('div', { class: 'ob-show-note', text: copy.noItems }))
    return
  }
  const list = h('ul', { class: 'ob-ep-list' })
  for (const e of eps) {
    const title = e.title || copy.untitledItem
    const epHref = episodePageHref(e.guid, e.title)
    const meta = [shortDate(e.date), e.boosts ? plural(e.boosts, 'boost', 'boosts') : null]
      .filter(Boolean).join(' · ')
    list.appendChild(h('li', { class: 'ob-ep' }, [
      h('div', { class: 'ob-ep-main' }, [
        epHref
          ? h('a', {
              class: 'ob-ep-title', href: epHref,
              title: `Nostr boosts to ${title}`, text: title,
            })
          : isSafeUrl(e.url)
            ? h('a', {
                class: 'ob-ep-title', href: e.url,
                target: '_blank', rel: 'noopener noreferrer', text: title,
              })
            : h('span', { class: 'ob-ep-title', text: title }),
        meta ? h('span', { class: 'ob-ep-meta', text: meta }) : null,
      ]),
      e.sats ? h('span', { class: 'ob-ep-sats' }, [fmtSats(e.sats), h('span', { class: 'pcast-bolt', 'aria-hidden': 'true', text: ' ⚡' })]) : null,
    ]))
  }
  into.replaceChildren(list)
  if (truncatedFrom > eps.length) {
    into.appendChild(h('div', { class: 'ob-show-note', text: copy.truncated(eps.length, truncatedFrom) }))
  }
}

function sortEpisodes(eps) {
  return [...eps].sort((a, b) => num(b.date) - num(a.date))
}

// ── Boost wiring ──────────────────────────────────────────────────────
//
// MONEY PATH. A show-level boost: it resolves the FEED-level value block (no
// `guid` parameter) and pays exactly the split that feed published. The episode
// feed's equivalent is feeds-podcasts.js#onBoostClick, which this deliberately
// mirrors rather than imports — that module is the episode renderer, and
// pulling it in here would drag the whole feed with it. The two share
// fromApiValue / applyExternalOverrides, which is where the split logic lives.
//
// applyExternalOverrides is a documented passthrough and must stay one. No leg
// of a third party's value block is ever rewritten, renamed, merged or dropped;
// see the money-paths section of CLAUDE.md.
const VALUE_API = '/api/value'

// Hold the loading state until the widget actually shows something: its gate
// chain (session restore, wallet unlock) can run for seconds on a cold bundle,
// and a button that reverts before then reads as a click that did nothing.
function waitForModal(timeoutMs = 40000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const tick = () => {
      if (document.querySelector('[role="dialog"]')) return resolve('modal')
      if (Date.now() - t0 > timeoutMs) return resolve('timeout')
      setTimeout(tick, 200)
    }
    tick()
  })
}

async function onShowBoost(s, btn, copy) {
  // The rollup carries no Podcast Index numeric id, so the show is identified
  // by guid and/or feed URL and /api/value resolves the id server-side.
  if (!s.guid && !s.feed) { showToast(`Can’t identify this ${copy.noun}’s feed`, true); return }

  await withBoostBusy(btn, async () => {
  try {
    const qs = new URLSearchParams()
    if (s.guid) qs.set('podcastGuid', s.guid)
    if (s.feed) qs.set('feedUrl', s.feed)

    let data = null
    try {
      const resp = await fetch(`${VALUE_API}?${qs}`, { headers: { Accept: 'application/json' } })
      // A server/config failure and "this show has no value block" are
      // different outcomes and must not be conflated — otherwise an outage
      // reads as every show being un-boostable.
      if (!resp.ok) { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
      data = await resp.json()
    } catch { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
    if (data && data.error) { showToast('Boost splits are unavailable right now.', true); return }

    const parsed = fromApiValue(data)
    if (!parsed) { showToast(`This ${copy.noun} has no value block to boost.`, true); return }

    const recipients = applyExternalOverrides(parsed.recipients)
    const totalWeight = recipients.reduce((a, r) => a + (r.splitWeight || 0), 0)
    if (!recipients.length || totalWeight <= 0) { showToast(`This ${copy.noun} has no payable recipients.`, true); return }

    await ensureLoginWidget()
    if (!window.LBLogin?.openExternalBoost) { showToast('Boost is unavailable right now.', true); return }
    window.LBLogin.openExternalBoost({
      episode: {
        showTitle: s.title || '',
        // No episode: this is the show itself. The note template drops the
        // link line and the `r` tag when there's no item to point at.
        episodeTitle: '',
        podcastGuid: s.guid || '',
        itemGuid: '',
        bmbUrl: episodeBoostLink({ itemGuid: '', podcastGuid: s.guid || null, feedId: null }) || '',
      },
      recipientsBundle: { recipients, totalWeight },
    })
    await waitForModal()
  } catch (e) {
    console.warn('[shows] boost failed', e)
    showToast('Couldn’t start the boost — try again.', true)
  }
  })
}

// ── Card ──────────────────────────────────────────────────────────────
// Built out of the episode card's chrome (.pcast-card and friends) rather than
// a parallel set of its own, so the two feeds read as one system. Only the
// stat row and the episode list are new.
function renderShowCard(s, rank, copy) {
  // 462 of the 1,384 shows in the index (33%) have no title and no art: the
  // collector holds a boost tagged with their guid but Podcast Index doesn't
  // know the feed, so there is nothing to enrich from. They're the long tail —
  // median 1 boost, 3.8% of all sats, and the first one doesn't appear until
  // #28 on any sort — so they never crowd the first page. Kept rather than
  // filtered (they're real boosts to real shows) but labelled for what they
  // are, with the guid shown, so an unnamed card reads as incomplete data
  // rather than a broken site.
  const named = !!s.title
  // Primary artwork, then the feed's second-chance URL, then the glyph. A dead
  // host or a hotlink block falls back to the same glyph a show with no art
  // gets, rather than leaving an empty box — `art2` just gives it one more real
  // URL to try first. See cover-art.js.
  const art = h('img', { alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
  const media = h('div', { class: 'pcast-card-media' }, art)
  const hasArt = wireCoverFallback(art, coverChain(s.img, s.art2), () => {
    media.classList.add('pcast-card-media--none')
    media.replaceChildren(document.createTextNode(copy.glyph))
  })
  if (!hasArt) {
    media.classList.add('pcast-card-media--none')
    media.replaceChildren(document.createTextNode(copy.glyph))
  }

  // "Nostr Stats:" carries the qualifier that used to sit in a paragraph above
  // the whole feed. Two words on the line the figures are already on, rather
  // than three lines of caveat before the first card. It says what the numbers
  // are counted from, which is the only reading of them that is true.
  const stats = h('div', { class: 'pcast-meta ob-show-stats' }, [
    h('span', { class: 'ob-stats-label', text: 'Nostr Stats:' }),
    h('span', { class: 'pcast-sats' }, [fmtSats(s.sats), h('span', { class: 'pcast-bolt', 'aria-hidden': 'true', text: ' ⚡' })]),
    h('span', { class: 'pcast-dot', 'aria-hidden': 'true', text: '·' }),
    h('span', { text: plural(s.boosts, 'boost', 'boosts') }),
    h('span', { class: 'pcast-dot', 'aria-hidden': 'true', text: '·' }),
    h('span', { text: plural(s.boosters, 'booster', 'boosters') }),
    // No episode count. See the note above SORT_OPTIONS: sats, boosts and
    // boosters are measures of boost activity, but an episode count reads as a
    // fact about the show, and ours isn't one.
    //
    // The boost button rides the end of this line rather than sitting in a
    // button row of its own. It's the same pill the community drawer on a
    // /show page uses, right-aligned by .ob-boost-pill's own margin-left,
    // which is what keeps it off the figures on a narrow card. Withheld from
    // unidentified shows for the same reason they get no landing page: Podcast
    // Index doesn't know the feed, so there is no block to resolve and the
    // button could only ever fail.
    named && (s.guid || s.feed)
      ? boostButton({
          label: s.title || copy.noun,
          onClick: (btn) => onShowBoost(s, btn, copy),
        })
      : null,
  ])

  const head = h('div', { class: 'pcast-card-head' }, [
    rank ? h('div', { class: 'pcast-rank', text: String(rank) }) : null,
    media,
    h('div', { class: 'pcast-card-body' }, [
      // Named shows link to their landing page (/show/<guid>); unnamed ones
      // don't, because there is no page — the qualifying rule for a landing
      // page is exactly "has a title". See docs/show-pages-spec.md.
      h('h3', {
        class: 'pcast-title' + (named ? '' : ' ob-show-unnamed'),
      }, named && showPageHref(s.guid)
        ? [h('a', { class: 'ob-show-link', href: showPageHref(s.guid), text: s.title })]
        : (named ? s.title : copy.unidentified)),
      // The guid stands in for a name we don't have. It's the only handle on
      // the show, and it's what you'd search the collector for.
      named ? null : h('div', { class: 'ob-show-guid', text: s.guid }),
      stats,
      s.latest ? h('div', { class: 'ob-show-latest', text: `last boost ${relTime(s.latest)}` }) : null,
    ]),
  ])

  // No drawer when there's nothing to put in it. A show can legitimately have
  // boosts and no episodes: the all-time index reports 0 for shows whose boosts
  // never carried an episode guid, and the windowed rollup counts distinct
  // guids, so the same holds there. Offering a drawer would spend a shard fetch
  // to say "no episodes".
  if (!s.episodes) return h('article', { class: 'pcast-card' }, [head])

  const details = h('div', { class: 'pcast-details', hidden: 'hidden' })
  const caret = h('span', { class: 'pcast-drawer-caret', 'aria-hidden': 'true', text: '▾' })
  const drawer = h('button', {
    class: 'pcast-drawer', type: 'button', 'aria-expanded': 'false',
  // Named, not counted — see the note above SORT_OPTIONS. The drawer bar is
  // full-width, so it has room to say exactly what the rows are rather than
  // leaving "Episodes" to imply the show's catalogue.
  }, [caret, h('span', { text: copy.drawer })])

  const card = h('article', { class: 'pcast-card' }, [head, drawer, details])
  let loaded = false

  drawer.addEventListener('click', async () => {
    const open = drawer.getAttribute('aria-expanded') === 'true'
    drawer.setAttribute('aria-expanded', open ? 'false' : 'true')
    details.hidden = open
    card.classList.toggle('is-open', !open)
    if (open || loaded) return
    loaded = true

    // Windowed ranges hold every boost in memory, so the list is already
    // built and costs nothing. The all-time index carries counts only, so that
    // path pays for the show's detail shard. Measured across the index: 3.5KB
    // at the median, 15KB at p90, and 1.95MB for the single most-boosted show
    // (the shards carry every boost and full shownotes). Cheap for nearly
    // every show, which is why it's an explicit expand rather than eager, and
    // ob-data.js caches it for the rest of the session.
    if (s.eps) {
      renderEpisodes(details, sortEpisodes(s.eps).slice(0, DRAWER_EPISODES), copy, { truncatedFrom: s.eps.length })
      return
    }
    if (!s.file) {
      renderEpisodes(details, [], copy)
      return
    }
    details.replaceChildren(h('div', { class: 'ob-show-note', text: 'Loading episodes…' }))
    try {
      const detail = await getPodcastDetail(s.file)
      const eps = detail.episodes.map((e) => ({
        guid: e.guid, title: e.title || '', img: e.img || '',
        date: num(e.date), num: num(e.num), url: e.url || '',
        boosts: num(e.boosts), sats: num(e.sats),
      }))
      renderEpisodes(details, sortEpisodes(eps).slice(0, DRAWER_EPISODES), copy, { truncatedFrom: eps.length })
    } catch (e) {
      console.warn('[shows] detail load failed', s.file, e)
      loaded = false   // collapsing and reopening retries
      details.replaceChildren(h('div', { class: 'ob-show-note', text: 'Couldn’t load this show’s episodes.' }))
    }
  })

  return card
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} [opts.panel]  the feed's panel, for its feed key
 * @param {Element} opts.list     the [data-feed-list] container to fill
 * @param {string}  opts.medium   'other' (Shows) | 'music' (Albums)
 */
export async function renderShows({ panel, list, medium = 'other' }) {
  if (!list) return
  const copy = COPY[medium] || COPY.other
  const wantMusic = medium === 'music'
  // Every row carries its own medium, so the shared per-range grouping is
  // narrowed here rather than at load time.
  const inMedium = (rows) => rows.filter((s) => s.music === wantMusic)
  // Neither of these re-renders today (Global only, so no account switch
  // reaches them), but the reset is what makes that a fact about the feed
  // rather than an assumption baked into this one.
  resetFeedSearch(panel)

  // All time is the opening view: it's the one request that needs no archive
  // walk, and the all-time leaderboard is the question a show-level feed is
  // for. The windowed ranges narrow it.
  let rangeKey = 'all'
  // Raw boost volume, matching the episode rollup's default — the ranking the
  // feed is *for*. 'boosters' ranks by distinct people instead, which differs
  // wherever someone boosts the same show repeatedly (most of them).
  let sortKey = 'boosts'
  let shows = []
  let sorted = []   // every show in the range, in sort order, rank stamped
  let view = []     // what's painted: `sorted`, or the one searched show
  let shown = 0
  let seq = 0
  let search = null

  const cards = h('div', { class: 'pcast-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  function paintMore() {
    const slice = view.slice(shown, shown + PAGE_SIZE)
    slice.forEach((s) => {
      // The rank is the show's position in the full sorted list, stamped in
      // repaint() before any search filter narrowed it — so a searched show
      // still reads #47 rather than #1. Numbering continues across pages.
      cards.appendChild(renderShowCard(s, RANKED_SORTS.has(sortKey) ? s._rank : null, copy))
    })
    shown += slice.length
    moreWrap.replaceChildren()
    const remaining = view.length - shown
    if (remaining <= 0) return
    const batch = Math.min(PAGE_SIZE, remaining)
    moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
      h('button', {
        class: 'pcast-showmore', type: 'button', onclick: paintMore,
      }, copy.moreLabel(batch)),
      h('div', { class: 'pcast-more-count', text: copy.countLine(shown, view.length) }),
    ]))
  }

  function repaint() {
    // Rank first, filter second. Stamping the position before the search
    // narrows the list is what lets one searched card carry its standing in
    // the whole ranking; ranking the filtered list would renumber it to #1.
    sorted = [...shows].sort(SORTERS[sortKey] || SORTERS.boosts)
    sorted.forEach((s, i) => { s._rank = i + 1 })
    // The index is the current range in the current order, so it's dropped
    // whenever either changes. Rebuilt lazily on the next keystroke.
    search?.refresh()
    const picked = search?.selection || null
    view = picked ? sorted.filter((s) => s.guid === picked.key) : sorted
    shown = 0
    cards.replaceChildren()
    moreWrap.replaceChildren()
    if (!view.length) {
      const empty = rangeKey === 'all' ? copy.emptyAll : copy.emptyWindow
      cards.appendChild(picked
        ? h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: 'Not in this range' }),
            copy.outOfRange(picked.label),
          ])
        : h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: empty[0] }), empty[1],
          ]))
      return
    }
    paintMore()
  }

  // A range change means a different source, so it can fetch. The seq guard
  // covers a second click landing while the first is still in flight.
  async function applyRange(key) {
    if (key === rangeKey) return
    rangeKey = key
    const mine = ++seq
    if (!byRange.has(key)) {
      list.className = ''
      list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
        h('strong', { text: copy.loading[0] }), copy.loading[1],
      ]))
    }
    let next
    try {
      next = await loadRange(key)
    } catch (e) {
      console.error('[shows] range load failed', key, e)
      if (mine !== seq) return
      renderPlaceholder(list, ...copy.rangeFail)
      return
    }
    if (mine !== seq) return
    shows = inMedium(next)
    list.replaceChildren(cards, moreWrap)
    repaint()
  }

  try {
    shows = inMedium(await loadRange(rangeKey))
  } catch (e) {
    console.error('[shows] index fetch failed', e)
    renderPlaceholder(list, ...copy.loadFail)
    return
  }

  mountFeedControls(panel?.dataset.feed || (wantMusic ? 'albums' : 'shows'), [
    rangeControl(rangeKey, applyRange, {
      label: copy.rangeLabel, titleFor: (key) => copy.rangeTitle(rangeDays(key)),
    }),
    sortControl(SORT_OPTIONS, sortKey, (key) => {
      if (key === sortKey) return
      sortKey = key
      repaint()
    }, { title: copy.sortTitle }),
  ])

  // Search the shows in the current range. The sub-line is the show's own
  // numbers, so two similarly-named feeds are told apart by their size rather
  // than by a guid nobody recognises — except on the 33% with no title at all,
  // where the guid is the only handle there is.
  search = mountFeedSearch(panel, {
    placeholder: copy.searchPlaceholder,
    label: copy.searchLabel,
    noun: copy.searchNoun,
    onPick: () => repaint(),
    getEntries: () => sorted.map((s) => ({
      key: s.guid,
      label: s.title || copy.unidentified,
      sub: s.title
        ? `${plural(s.boosts, 'boost', 'boosts')} · ${fmtSats(s.sats)} sats`
        : s.guid,
      // Matched, not shown. The guid is the only handle on the 33% of shows
      // with no title, and it's what you'd have copied off one of their cards.
      // The author joins it so an artist or host finds their own work: "Theo
      // Katzman" reaches the album, "Guy Swann" reaches Bitcoin Audible.
      // Deliberately not in `sub` — it would push the show's own numbers off a
      // narrow card, and a name is a way in rather than a way to tell two
      // similar results apart. An author hit ranks below every title hit,
      // which is what the scoring ladder in feed-search.js already does.
      extra: [s.guid, s.author].filter(Boolean).join(' '),
      img: s.img,
    })),
  })

  list.className = ''
  list.replaceChildren(cards, moreWrap)
  repaint()
}
