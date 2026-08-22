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
 * The split is a QUERY PARAMETER, not a client-side join: /api/v1/podcasts
 * takes medium=music or not_medium=music and answers already split, so the
 * browser never reconciles two datasets. This used to read podcasts/index.json
 * to join guid -> medium in memory, which cost the windowed ranges a request
 * the All range got for free; that whole path is gone with the rest of
 * ob-data.js's fetching half. The medium is still a property of the SHOW
 * rather than of a boost, which is why it is not on the boost record.
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
  getShowPage, searchShows, getShowEpisodes, SEARCH_HITS, SEARCH_MIN_CHARS,
} from '/assets/js/ob-live.js?v=ob-v105'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls,
} from '/assets/js/feed-controls.js?v=ob-v105'
// Its own module, not two more exports of feed-controls.js — see the ⚠️ note
// at the top of that file for the four-hour window that shape opens.
import { mountFeedNote, resetFeedNote } from '/assets/js/feed-note.js?v=ob-v105'
import {
  LANG_ALL, languageOptions, langControl, langNote, langNoMatchText, langLabelFor,
} from '/assets/js/feed-lang.js?v=ob-v105'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v105'
import { competitionRanks, rankLabel } from '/assets/js/rank.js?v=ob-v105'
import { showPageHref, episodePageHref } from '/assets/js/show-link.js?v=ob-v105'
// Show-level boosting. Same four pieces the episode feed uses, and deliberately
// the same ones: fromApiValue / applyExternalOverrides are where the split
// logic lives, and sharing them is what keeps every surface paying the value
// block a feed actually published.
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js?v=ob-v105'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v105'
import { episodeBoostLink } from '/assets/js/episode-link.js?v=ob-v105'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v105'
import { boostButton, withBoostBusy } from '/assets/js/boost-button.js?v=ob-v105'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v105'

/* ── The hash's language, on an already-hydrated feed ──
 * The twin of the map in feeds-podcasts.js, and there for the same reason: a
 * feed hydrates once and then owns its control, so a URL pasted into an open tab
 * needs a way in that is not the loader. One listener, keyed by feed, so Shows
 * and Albums share it and a re-render replaces its entry rather than stacking a
 * second listener that requeries twice.
 */
const LANG_APPLY = new Map()
document.addEventListener('lb:set-feed-lang', (e) => {
  const detail = e && e.detail
  const apply = detail && detail.feed && LANG_APPLY.get(detail.feed)
  if (apply) apply(detail.lang || LANG_ALL)
})

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
    // The line above the search box. See mountFeedNote in feed-controls.js.
    noteGlobal: 'Ranks based on every boost in the index',
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
    rangeLabel: 'Filter by when the album was boosted',
    rangeTitle: (days) => (days ? `Albums boosted in the last ${days} days` : 'All time'),
    sortTitle: 'Sort albums',
    noteGlobal: 'Ranks based on every boost in the index',
    moreLabel: (n) => `Load ${n} more album${n === 1 ? '' : 's'}`,
    // No total to count against: the endpoint pages rather than reporting how
    // many shows the range holds, so this states what is on screen and nothing
    // it cannot support.
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

/* ⚠️ THE COMPARATORS ARE GONE, AND THAT WAS A CORRECTNESS FIX RATHER THAN A
 * SPEEDUP — the same move the Episodes feeds made, and this was the last
 * client-side aggregation on the site.
 *
 * All time read the collector's published per-show rollup WHOLE: ~440KB
 * describing every show in the index, downloaded to paint thirty cards. The
 * windowed ranges were worse in kind rather than in size — they walked
 * latest.json plus month archives and GROUPed the boosts by show in the
 * browser, so "the last 30 days" ranked over whatever those shards happened to
 * hold rather than over the window.
 *
 * `/api/v1/podcasts` aggregates over the whole boosts table inside the window,
 * so range and sort are QUERIES now and changing either refetches. SORT_OPTIONS
 * survives because its keys are the endpoint's own sort values, and RANKED_SORTS
 * because it still decides when a position is worth printing.
 */

// ── Source ────────────────────────────────────────────────────────────
/**
 * One page of ranked shows, adapted into the shape the card already reads.
 *
 * The endpoint returns the same record whichever range asked for it: on All it
 * reads the precomputed aggregate columns, on 1W/1M it GROUPs the boosts inside
 * the window. So the card does not know or care which one answered, and neither
 * does anything below this function.
 *
 * `eps` is no longer carried. The windowed rollup used to arrive with every
 * boost in memory, so the drawer's episode list came free; now BOTH ranges fetch
 * it on expand, through one endpoint that windows the rows the same way the card
 * was windowed. That is a request the windowed drawer did not previously make,
 * and in exchange the All drawer stops fetching the per-show shard, which ran to
 * 1.95MB on the most-boosted show.
 */
async function loadShowPage({ medium, sort, range, lang, offset, signal }) {
  const { records, nextOffset } = await getShowPage({
    medium: medium === 'music' ? 'music' : null,
    sort, range, lang, offset, signal,
  })
  return { items: records.map(toCard), nextOffset }
}

function toCard(p) {
  return {
    guid: p.guid,
    title: typeof p.title === 'string' ? p.title : '',
    img: typeof p.img === 'string' ? p.img : '',
    // The feed's OTHER artwork URL, published only when it differs from `img`.
    // A handful of shows have a dead primary and a live second — see
    // cover-art.js.
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
    // Present only on a search hit: the position in the FULL ordering, which a
    // filtered page cannot be numbered by. See the rank note in repaint().
    rank: Number.isFinite(p.rank) ? p.rank : null,
  }
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
// `since` is the active range's cutoff (null on All). It reaches the card only
// to scope the drawer's episode list to the same window the card's own figures
// were computed over.
function renderShowCard(s, rank, copy, since = null) {
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

    /* Both ranges fetch now, and both fetch the same thing.
     *
     * ⚠️ THIS RETIRES THE PER-SHOW SHARD, which was the largest request the
     * site could make: 3.5KB at the median and 15KB at p90, but **1.95MB** for
     * the most-boosted show, because a shard carries every boost it ever had
     * plus full shownotes. The endpoint returns the episode rows and nothing
     * else.
     *
     * The windowed ranges used to build this list in memory for free, since the
     * browser was holding every boost in the window anyway. It no longer is —
     * that aggregation is the thing that moved — so the window is passed to the
     * server instead and the rows come back scoped and recounted. A drawer
     * showing all-time figures under a card showing the week's would contradict
     * the card it opened from.
     */
    details.replaceChildren(h('div', { class: 'ob-show-note', text: 'Loading episodes…' }))
    try {
      const rows = await getShowEpisodes({ guid: s.guid, since })
      const eps = rows.map((e) => ({
        guid: e.guid, title: e.title || '', img: e.img || '',
        date: num(e.date), num: num(e.num), url: e.url || '',
        boosts: num(e.boosts), sats: num(e.sats),
      }))
      renderEpisodes(details, sortEpisodes(eps).slice(0, DRAWER_EPISODES), copy, { truncatedFrom: eps.length })
    } catch (e) {
      console.warn('[shows] episode load failed', s.guid, e)
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
 * @param {string}  [opts.lang]   the feed's OPENING language, off the hash
 *                                (`#shows?lang=de`). Must reach the first query.
 */
export async function renderShows({ panel, list, medium = 'other', lang = null }) {
  if (!list) return
  const copy = COPY[medium] || COPY.other
  const wantMusic = medium === 'music'
  // Neither of these re-renders today (Global only, so no account switch
  // reaches them), but the reset is what makes that a fact about the feed
  // rather than an assumption baked into this one.
  resetFeedSearch(panel)
  resetFeedNote(panel)

  // All time is the opening view: the all-time leaderboard is the question a
  // show-level feed is for. The windowed ranges narrow it.
  let rangeKey = 'all'
  // Raw boost volume, matching the episode rollup's default — the ranking the
  // feed is *for*. 'boosters' ranks by distinct people instead, which differs
  // wherever someone boosts the same show repeatedly (most of them).
  let sortKey = 'boosts'
  // No language filter, which is NOT the same as English: 341 shows on this
  // side of the medium split and 253 on the music side declare no <language>
  // at all, so All is the only key that holds every card. See feed-lang.js.
  const feedKey = panel?.dataset.feed || (medium === 'music' ? 'albums' : 'shows')
  // The hash's language is the opening state. langLabelFor names it from the
  // subtag so the feed note reads correctly on the first paint, before the menu
  // request has landed.
  let langKey = (typeof lang === 'string' && lang) ? lang : LANG_ALL
  let langLabel = langLabelFor(langKey)
  let langOptions = null
  let langCtl = null
  // Fired here rather than where the control is mounted, so this small GROUP BY
  // overlaps the first page's much heavier one instead of following it. It is
  // never awaited on the render path — see the insert below. `languageOptions`
  // never rejects; it resolves null when the endpoint is unavailable or the feed
  // holds one bucket, and a null menu is a control that is simply not mounted.
  const langOptionsP = languageOptions({ medium: wantMusic ? 'music' : null })

  let shows = []          // the pages pulled so far, in the server's order
  let nextOffset = 0
  let loading = false
  let view = []           // what's painted: `shows`, or the one searched show
  let shown = 0
  let seq = 0
  let search = null
  // A pick is a fetch now, the same shape feeds-podcasts.js uses: `picked` is
  // the chosen suggestion, `pickedItem` the card built for it.
  let picked = null
  let pickedItem = null
  let pickLoading = false
  let pickSeq = 0

  const cards = h('div', { class: 'pcast-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  const cutoff = () => rangeCutoff(rangeKey)

  function paintMore() {
    const slice = view.slice(shown, shown + PAGE_SIZE)
    slice.forEach((s) => {
      cards.appendChild(renderShowCard(
        s, RANKED_SORTS.has(sortKey) ? rankLabel(s._rank, s._tied) : null, copy, cutoff(),
      ))
    })
    shown += slice.length
    moreWrap.replaceChildren()

    // Two different "more" buttons behind one control. Inside the pages already
    // held it is a slice, and past them it is a REQUEST — so the label stays
    // the same and the work does not.
    const local = view.length - shown
    const canFetch = !picked && nextOffset != null
    if (local <= 0 && !canFetch) return
    const batch = local > 0 ? Math.min(PAGE_SIZE, local) : PAGE_SIZE
    const btn = h('button', {
      class: 'pcast-showmore', type: 'button',
      onclick: async () => {
        if (local > 0) { paintMore(); return }
        if (loading) return
        loading = true
        btn.disabled = true
        btn.textContent = 'Loading…'
        try {
          const next = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, offset: nextOffset })
          shows = shows.concat(next.items)
          nextOffset = next.nextOffset
          rebuild({ keepShown: true })
        } catch (e) {
          console.warn('[shows] load more failed', e)
          btn.disabled = false
          btn.textContent = copy.moreLabel(batch)
        } finally {
          loading = false
        }
      },
    }, copy.moreLabel(batch))
    moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
      btn,
      // No total to count against: the endpoint pages rather than reporting how
      // many shows the whole range holds, so this says what is on screen.
      h('div', { class: 'pcast-more-count', text: copy.countLine(shown) }),
    ]))
  }

  /* ⚠️ RANK FIRST, FILTER SECOND, and the two halves now come from different
   * places. An unfiltered page is numbered by POSITION, because the server
   * returned it in rank order from offset 0 and numbering continues across
   * pages. A searched card cannot be numbered that way at all: it is one row out
   * of a filtered query and its standing is a fact about the whole index, so it
   * carries the `rank` the server computed and is never renumbered here.
   * Ranking the filtered list would tell a searched show it is #1 of 1, which
   * answers a different question.
   */
  /* ⚠️ THE LAST PAINTED CARD'S "T" IS THE ONE THING AN APPEND CAN CHANGE.
   * `keepShown` paints from `shown` onward and never re-renders what is already
   * on screen, but a card at the end of the loaded run could not see a tie
   * continuing into rows it had not fetched, so it painted a bare rank. Once
   * those rows arrive this writes the corrected label back. Idempotent, and on
   * a full repaint every label already matches, so it is a no-op. */
  function syncRankLabels() {
    if (picked) return
    const els = cards.querySelectorAll('.pcast-card')
    view.forEach((s, i) => {
      const node = els[i]?.querySelector('.pcast-rank')
      if (!node) return
      const label = RANKED_SORTS.has(sortKey) ? rankLabel(s._rank, s._tied) : null
      if (label != null && node.textContent !== label) node.textContent = label
    })
  }

  function rebuild({ keepShown = false } = {}) {
    /* ⚠️ COMPETITION RANKS, NOT POSITIONS: ties share the better place and the
     * next distinct value skips the group, so two shows with the same boost
     * count are not separated by the sats tiebreak the endpoint pages by. This
     * feed is never server-adopted, so `shows` is always a prefix from offset 0
     * and needs no seed. See assets/js/rank.js. */
    if (!picked) {
      const ranks = competitionRanks(shows, (s) => Number(s[sortKey]) || 0)
      shows.forEach((s, i) => { s._rank = ranks[i].rank; s._tied = ranks[i].tied })
    }
    search?.refresh()
    view = picked ? (pickedItem ? [pickedItem] : []) : shows
    const from = keepShown ? shown : 0
    shown = from
    if (!keepShown) cards.replaceChildren()
    moreWrap.replaceChildren()
    if (!view.length) {
      const empty = rangeKey === 'all' ? copy.emptyAll : copy.emptyWindow
      cards.appendChild(pickLoading
        ? h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: 'Loading…' }),
            `Fetching ${picked?.label || 'that one'}.`,
          ])
        : picked
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
    syncRankLabels()
  }

  /* Fetch the picked show under the feed's CURRENT range and sort.
   *
   * Re-issuing the query the suggestion came from is what makes the row
   * findable: same q, same filters, same ordering, so the pick is inside the
   * same handful of hits it was chosen from. It runs again on every range or
   * sort change, because both move the ranking the card is reporting and either
   * can push the show out of the window entirely.
   */
  async function resolvePick() {
    const mine = ++pickSeq
    // Dropping the filter comes through here too, and it has to repaint:
    // bumping pickSeq has already retired any resolve still in flight.
    if (!picked) { pickedItem = null; pickLoading = false; rebuild(); return }
    pickLoading = true
    pickedItem = null
    rebuild()
    try {
      const records = await searchShows({
        q: picked.query, medium: wantMusic ? 'music' : null,
        sort: sortKey, range: rangeKey, lang: langKey, limit: SEARCH_HITS,
      })
      if (mine !== pickSeq) return
      const hit = records.find((r) => r.guid === picked.key)
      pickedItem = hit ? toCard(hit) : null
      if (pickedItem) pickedItem._rank = pickedItem.rank
    } catch (e) {
      if (mine !== pickSeq) return
      console.warn('[shows] search pick failed', e)
      showToast('Couldn’t open that search result — please try again.', true)
    } finally {
      if (mine === pickSeq) { pickLoading = false; rebuild() }
    }
  }

  /* A range or sort change is a new QUERY, so it refetches from offset 0.
   *
   * The previous cards stay on screen while it is in flight rather than being
   * cleared to a spinner: a feed that blanks on every control press reads as
   * broken, and the answer usually arrives in well under a second.
   */
  /* ⚠️ NOT GUARDED BY `loading`, and that is the point. Dropping a second press
   * while the first is in flight would leave the control showing one range and
   * the cards showing another, since the key is already set by the time this
   * runs. Overlapping queries are allowed and the sequence guard makes the last
   * one win. `loading` is still SET, so the load-more button stays disabled
   * while a fresh first page is on its way to replacing it.
   */
  async function requery() {
    const mine = ++seq
    loading = true
    try {
      const page = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, offset: 0 })
      if (mine !== seq) return
      shows = page.items
      nextOffset = page.nextOffset
      rebuild()
      // The unfiltered list is still fetched under a live search filter, since
      // clearing the box has to reveal the new range rather than fetch again.
      if (picked) resolvePick()
    } catch (e) {
      if (mine !== seq) return
      console.error('[shows] requery failed', e)
      showToast(copy.rangeFail[0], true)
    } finally {
      if (mine === seq) loading = false
    }
  }

  let first
  try {
    first = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, offset: 0 })
  } catch (e) {
    console.error('[shows] index fetch failed', e)
    renderPlaceholder(list, ...copy.loadFail)
    return
  }
  shows = first.items
  nextOffset = first.nextOffset

  // The same line the Episodes and Songs feeds carry. There is no Follows scope
  // here yet, so it has one form; when Shows · Follows lands it gains the second
  // and this becomes the scope-dependent pick the other renderer already makes.
  // Through langNote even though the filter is provably All here, so this line
  // and the language control's cannot drift into two versions of one sentence.
  mountFeedNote(panel, langNote(copy.noteGlobal, langKey, langLabel, copy.noun))

  const controls = mountFeedControls(panel?.dataset.feed || (wantMusic ? 'albums' : 'shows'), [
    rangeControl(rangeKey, (key) => {
      if (key === rangeKey) return
      rangeKey = key
      requery()
    }, {
      label: copy.rangeLabel, titleFor: (key) => copy.rangeTitle(rangeDays(key)),
    }),
    sortControl(SORT_OPTIONS, sortKey, (key) => {
      if (key === sortKey) return
      sortKey = key
      requery()
    }, { title: copy.sortTitle }),
  ])

  /* A language change is a QUERY, exactly like the range and the sort, because
   * the ranking is computed over the filtered corpus server-side. Filtering the
   * loaded pages instead would rank a German show against the English ones it
   * was ranked beside, and could only ever find the languages inside the prefix
   * the reader had already paged in.
   *
   * The menu is fetched, so it is INSERTED into the bar when it lands rather
   * than awaited: re-mounting the group would throw away a control the reader
   * may already have open, and blocking would hold the whole bar for a menu
   * nobody has reached for. A null menu never inserts, which leaves exactly the
   * control bar that shipped before this existed.
   */
  function applyLang(key, label) {
    if (key === langKey) return
    langKey = key
    langLabel = label || langLabelFor(key)
    // "Ranks based on every boost in the index" stops being true the moment
    // this is anything but All.
    mountFeedNote(panel, langNote(copy.noteGlobal, langKey, langLabel, copy.noun))
    // The controller writes the hash from this, so a shareable URL falls out of
    // using the control. Reported on a COERCION too, which is what takes an
    // unshowable language back out of the address bar.
    document.dispatchEvent(new CustomEvent('lb:feed-lang', {
      detail: { feed: feedKey, lang: langKey === LANG_ALL ? '' : langKey },
    }))
    requery()
  }

  // Rebuilt rather than mutated: sortControl owns its own label and checkmark,
  // and an externally-set language has to move both.
  function mountLangControl() {
    if (!langOptions || !controls) return
    const next = langControl(langOptions, langKey, applyLang)
    if (langCtl && langCtl.parentNode === controls) controls.replaceChild(next, langCtl)
    // Before the sort pill: filters together, the ordering at the end.
    else controls.insertBefore(next, controls.lastElementChild)
    langCtl = next
  }

  /* The hash, on a feed already on screen. Registered even when the menu never
   * arrives: the QUERY works without it, so a URL can still filter a feed whose
   * control was withheld. */
  LANG_APPLY.set(feedKey, (key) => {
    // ⚠️ A URL can name a language THIS feed has none of — the music half holds
    // six buckets against the podcast half's nineteen. Coerce rather than paint
    // an empty feed under a filter the menu cannot display as selected.
    const want = (key && key !== LANG_ALL && langOptions
      && !langOptions.some((o) => o[0] === key)) ? LANG_ALL : (key || LANG_ALL)
    if (want === langKey) return
    applyLang(want, langLabelFor(want))
    mountLangControl()
  })

  langOptionsP.then((opts) => {
    if (!opts || !controls) return
    langOptions = opts
    // ⚠️ The opening language came from a URL and nothing has checked it against
    // what this feed holds. A stale or hand-written `?lang=` with no menu row is
    // dropped here, which reports and rewrites the hash.
    if (langKey !== LANG_ALL && !opts.some((o) => o[0] === langKey)) {
      applyLang(LANG_ALL, 'All')
    }
    mountLangControl()
  })

  search = mountFeedSearch(panel, {
    placeholder: copy.searchPlaceholder,
    label: copy.searchLabel,
    noun: copy.searchNoun,
    minChars: SEARCH_MIN_CHARS,
    onPick: (entry) => { picked = entry; resolvePick() },
    /* ⚠️ SEARCHES THE WHOLE INDEX, not the pages loaded. The in-memory index
     * this replaces read the full range, which was true only while the browser
     * downloaded every show; now the feed pages a ranked list and those pages
     * are a prefix of it.
     *
     * The guid and the author are still matched: the guid is the only handle on
     * the 33% of shows with no title, and an author lets a host or artist find
     * their own work. Both happen server-side now — the author through
     * `podcasts_fts`, which indexes it beside the title, and the guid as an
     * equality, since FTS5 does not index it and a pasted one is all hyphens.
     */
    searchRemote: async (query, { signal }) => {
      const records = await searchShows({
        q: query, medium: wantMusic ? 'music' : null,
        // ⚠️ THE LANGUAGE HAS TO TRAVEL WITH THE SEARCH, like the medium: a
        // suggestion the feed would then filter away to nothing is the
        // documented failure that keeps /api/v1/search off these feeds.
        sort: sortKey, range: rangeKey, lang: langKey, signal,
      })
      return records.map((r) => ({
        key: r.guid,
        label: r.title || copy.unidentified,
        // The show's own numbers, so two similarly-named feeds are told apart
        // by their size rather than by a guid nobody recognises — except on the
        // untitled ones, where the guid is the only handle there is.
        sub: r.title
          ? `${plural(num(r.boosts), 'boost', 'boosts')} · ${fmtSats(num(r.sats))} sats`
          : r.guid,
        img: r.img,
        query,
      }))
    },
    // The language is tested FIRST because it is the narrowest of the two
    // filters and the only one whose fix is a single press. It also outranks
    // the All case, where the line would otherwise call a coverage boundary on
    // a show that is in the index and merely in another language.
    noMatchText: () => (langKey !== LANG_ALL ? langNoMatchText(langKey, langLabel, copy.noun)
      : rangeKey === 'all' ? copy.searchNoneAll
      : copy.searchNoneRange),
  })

  list.className = ''
  list.replaceChildren(cards, moreWrap)
  rebuild()
}
