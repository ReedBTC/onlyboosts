/* Episodes feed — the per-episode rollup behind the two Episodes feeds.
 *
 * The file and its `renderPodcasts` export keep the old name on purpose: the
 * feed the UI calls Episodes was called Podcasts until Shows arrived and made
 * that ambiguous. The user-facing name, the feed key and the URL hash all
 * renamed; a module filename is not a URL, and renaming it would only cost the
 * git history that follows it. The two stay a matched pair, so this is not a
 * half-rename — see the naming note in CLAUDE.md.
 *
 * A list of podcast episodes the network has boosted on Nostr — framed as
 * "here's what the community is boosting," not a leaderboard. The card is the
 * EPISODE; clicking it opens a modal with the individual boosts (who, how many
 * sats, their message, when) plus a "listen" link out to the episode.
 *
 * Unlike Events / Marketplace this feed is NOT a live relay subscription. It
 * reads the collector's published feed via ob-data.js (a Cloudflare Pages
 * Function proxying the static JSON the collector pushes
 * hourly), which is network-wide rather than scoped to any one show's
 * audience. Booster names and avatars are embedded in the feed, so the
 * batched profile lookup only runs for the stragglers the collector couldn't
 * resolve. "Follows" narrows by the viewer's kind-3 contact list.
 *
 * Ordering: episodes are ranked by raw boost volume, with total sats as the
 * tiebreaker, and both scopes open on the All air-date window. Range and sort
 * are QUERIES rather than array operations, so changing either refetches; the
 * chrome they mount into the sticky feed bar is shared with the note feed
 * (feed-controls.js).
 *
 * Entry point: renderPodcasts({ panel, list }) — lazy-imported by feeds.js
 * the first time the feed is opened.
 */
import { nip19 } from '/assets/widgets/nostr-tools.js?v=ob-v60'
import {
  fetchProfilesFromPrimal,
  setCachedProfile,
  parseSegments,
  renderSegmentsInto,
} from '/assets/js/boosts-thread.js?v=ob-v60'
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js?v=ob-v60'
import { episodeBoostLink } from '/assets/js/episode-link.js?v=ob-v60'
import { buildActionBar, configureBoostActions } from '/assets/js/boost-actions.js?v=ob-v60'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v60'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v60'
import { toEpisodeShape, normalizeBoosts, episodeApiToBoosts } from '/assets/js/ob-data.js?v=ob-v60'
import {
  getEpisodePage, searchEpisodes, SEARCH_HITS, SEARCH_MIN_CHARS,
} from '/assets/js/ob-live.js?v=ob-v60'
import { copyText, showToast, copyNpub } from '/assets/js/copy-npub.js?v=ob-v60'
import { boostButton, withBoostBusy } from '/assets/js/boost-button.js?v=ob-v60'
import {
  rangeDays, rangeControl, sortControl, mountFeedControls,
} from '/assets/js/feed-controls.js?v=ob-v60'
// Its own module, not two more exports of feed-controls.js — see the ⚠️ note
// at the top of that file for the four-hour window that shape opens.
import { mountFeedNote, resetFeedNote } from '/assets/js/feed-note.js?v=ob-v60'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v60'
import { showPageHref, episodePageHref } from '/assets/js/show-link.js?v=ob-v60'
// Its own module rather than a third export from show-link.js, which every feed
// renderer imports: a stale copy of that file against a fresh copy of this one
// is a link-time error that takes all eight feeds down. See the note at its head
// and the ob-v53 entry in CLAUDE.md.
import { boosterPageHref, markBoosterLink } from '/assets/js/booster-link.js?v=ob-v60'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v60'

const VALUE_API = '/api/value'   // Podcast Index value-block proxy (splits)
const INITIAL_CARDS = 30       // episodes rendered per "load more" batch

// ── Episodes vs Songs ────────────────────────────────────────────────
// This module renders two of the feed bar's options, and they differ by one
// thing: which side of <podcast:medium> a boost's show falls on. A music feed's
// item is a track on an album, not an episode of a show, so the rollup, the
// ranking and the card are all identical and only the words change. That makes
// the difference a copy table rather than a second renderer — see
// ob-data.js#mediumPredicate for the split itself.
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

// ── Tiny DOM helper (same contract as feeds-market.js / merch.js's h) ──
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v)
  }
  for (const c of [].concat(children)) {
    if (c == null) continue
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return el
}

function renderPlaceholder(list, title, body) {
  list.className = ''
  list.innerHTML = ''
  list.appendChild(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }),
    document.createTextNode(body),
  ]))
}

// ── Formatting ───────────────────────────────────────────────────────
function fmtSats(n) {
  if (!n || n < 0) return '0'
  if (n < 1000) return String(n)
  const k = n / 1000
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'k'
}

function fullDate(unixSec) {
  if (!unixSec) return ''
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ── Clipboard + toast ────────────────────────────────────────────────
// copyText / showToast / copyNpub live in copy-npub.js — the boosts feed
// needs the same gesture. copyNevent stays here; it's specific to the boost
// drawer and is the only caller that needs nip19.
async function copyNevent(eventId, author) {
  let nevent = ''
  try { nevent = nip19.neventEncode({ id: eventId, author: author || undefined }) } catch {}
  if (!nevent) { showToast('Could not build nevent', true); return }
  const ok = await copyText(nevent)
  showToast(ok ? 'nevent copied' : 'Copy failed — clipboard blocked', !ok)
}

// ── Avatars ──────────────────────────────────────────────────────────
function isSafeImg(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' }
  catch { return false }
}

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
const MAX_FACES = 10

/* A booster avatar.
 *
 * ⚠️ `interactive` USED TO MEAN "click to copy the npub" AND NOW MEANS "link to
 * that booster's page". The copy gesture is not lost, it moved: /booster/<npub>
 * leads with a Copy npub button, and the per-boost ⋮ menu below carries one too,
 * so the drawer keeps it inline. A face that opens someone's history is the same
 * navigation the show name and the episode title already are, where a face that
 * copies a string was a dead end.
 *
 * The anchor WRAPS the image rather than replacing it, so `.pcast-avatar` keeps
 * sizing the img or the initials chip exactly as before and the error swap below
 * still works on the node it was built for. `.pcast-avatar-link` is the wrapper
 * and does nothing but sit in the flex row without disturbing it.
 *
 * Avatars load eagerly (they're tiny, and `loading=lazy` left off-screen ones
 * perpetually unloaded → looked broken); a picture that fails to load (dead
 * host, hotlink block) swaps to the initials chip via onerror.
 */
// `pk` is the hex pubkey, and it is a fallback for the LINK only — `npub` is
// still what the initials chip is derived from. It is separate from `npub`
// rather than pre-collapsed by the caller because boosterPageHref tries the two
// in turn; see the note on that function.
function avatarEl(profile, npub, { size = 26, interactive = false, cls = '', label = '', pk = null } = {}) {
  const style = `--pcast-av:${size}px`
  const makeInitials = () => h('span', { class: 'pcast-avatar pcast-avatar--none ' + cls, style }, initials(profile, npub))

  let node
  const pic = profile?.picture
  if (pic && isSafeImg(pic)) {
    const img = h('img', { class: 'pcast-avatar ' + cls, style, src: pic, alt: '', referrerpolicy: 'no-referrer' })
    img.addEventListener('error', () => { img.replaceWith(makeInitials()) }, { once: true })
    node = img
  } else {
    node = makeInitials()
  }

  const href = interactive ? boosterPageHref(npub, pk) : null
  if (!href) return node

  node.classList.add('is-interactive')
  const a = h('a', { class: 'pcast-avatar-link', href })
  // Secondary: the booster's NAME beside this avatar links to the same page, and
  // one row should not offer two tab stops and two announcements for one
  // destination. The name is the primary link because it carries the text.
  markBoosterLink(a, { label, secondary: true })
  a.appendChild(node)
  return a
}

// ── Episode link ladder ──────────────────────────────────────────────
// Prefer a per-boost Fountain episode URL (present on ~98% of episodes);
// otherwise fall back to a show-level smart link, and label the button so a
// show fallback never poses as an episode link.
function episodeLink(boosts, show, copy) {
  const withUrl = boosts.find((b) => b.item_url)
  if (withUrl && isSafeImg(withUrl.item_url)) {
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

// ── Data shaping ─────────────────────────────────────────────────────
// Group boosts by episode, resolve episode/show records, drop episodes we
// can't render (null Podcast Index episode record → no title/art), and sort
// by most-recent boost.
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
  return out
}

// ── The episode's own link ───────────────────────────────────────────
// Adapter onto episode-link.js, which owns the target. Only the item→primitives
// mapping lives here, because only this module knows the rollup's shape; the URL
// itself is shared with show-page.js and episode-page.js so all three surfaces
// publish the same link. It resolves to /episode/<item-guid> for a titled
// episode and falls back to Boost Me Bitch for the 500 that have no page.
function episodeNoteLink(item) {
  return episodeBoostLink({
    itemGuid: item.guid,
    title: item.ep?.title || '',
    podcastGuid: item.ep?.podcast_guid || item.show?.podcast_guid || null,
    feedId: item.ep?.feed_id || item.show?.feed_id || null,
  })
}

// ── Episode media helpers ────────────────────────────────────────────
// Podcast Index descriptions are HTML; strip to plain text for the 2-line
// teaser. DOMParser is inert (no script execution, no resource loading), so
// this is XSS-safe — unlike innerHTML.
function htmlToText(html) {
  if (!html) return ''
  try {
    const doc = new DOMParser().parseFromString(String(html), 'text/html')
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  } catch { return '' }
}

function safeHttpUrl(u) {
  try { const x = new URL(u); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : null }
  catch { return null }
}

// The "↓ Download MP3" button was removed. Every browser's native audio
// controls already carry Download in their ⋮ menu, and the button cost a full
// row of card height to duplicate it. The blob-fetch trick it used (a plain
// <a download> is ignored cross-origin without Content-Disposition) is
// recoverable from git history if a surface ever needs it again.


// ── Boost wiring ─────────────────────────────────────────────────────
// The boost modal + payment live in the login-widget bundle (window.LBLogin),
// lazy-loaded on first boost click. The loader is shared with every other
// trigger on the page — this one awaits /api/value first, so a nav Boost
// click can easily land mid-flight and would otherwise pull the 1MB bundle
// a second time. See widget-loader.js.
const ensureWidgetLoaded = ensureLoginWidget

// After openExternalBoost, the widget's gate chain (session restore / wallet
// unlock) can run for several seconds on a cold widget before any modal shows.
// Wait for a modal to appear so the boost button can stay in its loading state
// until then, instead of reverting and looking like nothing happened.
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

// Boost click: resolve the episode's value block live from Podcast Index (via
// /api/value), apply the external overrides, then hand off to the widget's
// external-boost modal. No value block → a toast, no modal.
async function onBoostClick(item, btn, copy = COPY.other) {
  const { ep, show } = item
  // The data feed has no Podcast Index numeric id, so identify the show by
  // its guid / RSS URL and let /api/value resolve the id server-side.
  const feedId = ep.feed_id || show?.feed_id || null
  const podcastGuid = ep.podcast_guid || show?.podcast_guid || null
  const feedUrl = show?.feed_url || null
  const guid = ep.item_guid || item.guid
  if (!feedId && !podcastGuid && !feedUrl) {
    showToast('Can’t identify this show’s feed', true); return
  }

  await withBoostBusy(btn, async () => {
  try {
    const qs = new URLSearchParams()
    if (feedId) qs.set('feedId', String(feedId))
    else {
      if (podcastGuid) qs.set('podcastGuid', podcastGuid)
      if (feedUrl) qs.set('feedUrl', feedUrl)
    }
    if (guid) qs.set('guid', guid)
    const url = `${VALUE_API}?${qs}`
    let data = null
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } })
      // Distinguish a server/config error (e.g. the value proxy is down or the
      // PI keys aren't set) from a genuine "this episode has no value block" —
      // otherwise an outage looks like every episode is un-boostable.
      if (!resp.ok) { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
      data = await resp.json()
    } catch { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
    if (data && data.error) { showToast('Boost splits are unavailable right now.', true); return }
    const parsed = fromApiValue(data)
    if (!parsed) { showToast(`This ${copy.noun} has no value block to boost.`, true); return }

    const recipients = applyExternalOverrides(parsed.recipients)
    const totalWeight = recipients.reduce((a, r) => a + (r.splitWeight || 0), 0)
    if (!recipients.length || totalWeight <= 0) { showToast(`This ${copy.noun} has no payable recipients.`, true); return }

    await ensureWidgetLoaded()
    if (!window.LBLogin?.openExternalBoost) { showToast('Boost is unavailable right now.', true); return }
    window.LBLogin.openExternalBoost({
      episode: {
        showTitle: show?.title || '',
        episodeTitle: ep.title || '',
        podcastGuid: ep.podcast_guid || show?.podcast_guid || '',
        itemGuid: guid || '',
        bmbUrl: episodeNoteLink(item) || '',
      },
      recipientsBundle: { recipients, totalWeight },
    })
    // Hold the busy state until a modal (boost / login / wallet) opens.
    await waitForModal()
  } catch (e) {
    console.warn('[podcasts] boost failed', e)
    showToast('Couldn’t start the boost — try again.', true)
  }
  })
}

// ── Card ─────────────────────────────────────────────────────────────
// Card head: episode art, show name, the episode TITLE as a link out to the
// Fountain episode, a booster/when/sats meta row, and a ⋮ menu (top-right)
// of show-level subscribe links. A low-profile drawer bar under the head
// toggles the inline boost thread, which is built lazily on first open and
// carries its own "hide" control so a long thread is easy to close without
// scrolling back up.
let cardUid = 0
// `rank` is the card's 1-based position under the current sort, or null when
// the sort isn't a ranking. Only the quantitative sorts (most boosters / most
// boosts / most sats) get a number — on "Latest boost" or "Latest episode" a
// rank would read as a score when it's really just chronology.
export function episodeCard(item, rank = null, copy = COPY.other) {
  const { ep, show, boosts, distinctBoosters, latest } = item
  // Same rule as the counts below: the server's total, falling back to the rows.
  const totalSats = item.totals?.sats ?? item.totalSats
  const detailsId = 'pcast-d-' + (++cardUid)

  // Two links, and the first is preferred everywhere it exists. `epHref` is
  // this episode's page here; `outHref` is the Boost Me Bitch fallback, which
  // only the 500 untitled episodes now use. See show-link.js for the rule and
  // episode-link.js for what a boost note carries.
  const epHref = episodePageHref(item.guid, ep.title)
  const outHref = epHref ? null : episodeNoteLink(item)

  // Episode art — links to the episode's page, the same target as the title
  // below it. It used to open Boost Me Bitch in a new tab, which was the
  // outbound half of a deliberate split back when the title was the only thing
  // pointing at a page of ours; now that every episode surface resolves here,
  // the art opening somewhere else would be the odd one out.
  //
  // Episode art first, then the show's primary and second-chance artwork. That
  // last link is what `art2` bought: a feed whose channel art 404s still paints
  // the URL the same feed also published. An exhausted chain drops to the glyph
  // rather than leaving a broken image, which is what the old single-URL
  // version showed. The callback closes over `media`, declared just below —
  // safe because an image error is always dispatched asynchronously, long after
  // the binding is initialised.
  const mediaImg = h('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
  const hasArt = wireCoverFallback(mediaImg, ep.imageChain || coverChain(ep.image), () => {
    mediaImg.remove()
    media.classList.add('pcast-card-media--none')
    media.appendChild(document.createTextNode('🎙'))
  })
  const mediaClass = 'pcast-card-media' + (hasArt ? '' : ' pcast-card-media--none')
  const media = epHref
    ? h('a', { class: mediaClass, href: epHref, title: `Nostr boosts to ${ep.title || copy.untitled}` }, hasArt ? mediaImg : '🎙')
    : outHref
      ? h('a', { class: mediaClass, href: outHref, target: '_blank', rel: 'noopener noreferrer', title: 'See all boosts on Boost Me Bitch' }, hasArt ? mediaImg : '🎙')
      : h('div', { class: mediaClass }, hasArt ? mediaImg : '🎙')

  /* Booster faces on the drawer bar, stacked — the first MAX_FACES of them.
   *
   * ⚠️ DELIBERATELY NOT LINKED, and the only pfps on the site that are not.
   * This stack lives inside the drawer's <summary>, which is itself an
   * interactive element: an anchor nested in one is both a navigation and a
   * toggle on the same click, and it puts up to ten extra tab stops inside a
   * control whose whole job is to open. These faces were never interactive
   * either — they have no copy gesture to have moved — so this is a place the
   * sweep did not reach rather than one it took something from. The same
   * boosters are linked, individually, on the rows inside the drawer. */
  const avatars = h('span', { class: 'pcast-avatars' },
    distinctBoosters.slice(0, MAX_FACES).map((b) =>
      avatarEl(profileFor(b.booster_pubkey), b.booster_npub, { size: 22 })))

  // A Fountain episode URL, when we have one (present on ~98% of episodes).
  const link = episodeLink(boosts, show, copy)
  const fountainUrl = link && link.episode ? link.url : null

  // The episode TITLE goes to that episode's landing page, the same move the
  // show name below made when /show/<guid> landed: the name of a thing points at
  // the page for that thing. It navigates in place, as the art above it and
  // "See all boosts" in the drawer now do — every episode affordance on this
  // card resolves to the same page, and the boost note published from it points
  // there too.
  //
  // Falls back to the BMB link for an episode with no page — 500 of the 7,182
  // in the index have no title and so nothing to render a page from. Those cards
  // read "Untitled episode", which is exactly the case where sending someone to
  // a fuller record elsewhere is the right answer. See show-link.js for the rule.
  const titleText = ep.title || copy.untitled
  const titleEl = epHref
    ? h('a', { class: 'pcast-title pcast-title-link', href: epHref, title: `Nostr boosts to ${titleText}` }, titleText)
    : outHref
      ? h('a', { class: 'pcast-title pcast-title-link', href: outHref, target: '_blank', rel: 'noopener noreferrer', title: 'See all boosts on Boost Me Bitch' }, titleText)
      : h('div', { class: 'pcast-title', text: titleText })

  // Shownotes teaser: first ~2 lines of the description. The full notes are on
  // the episode's own page, which the title and art above already link to.
  const descText = htmlToText(ep.description)
  const descP = descText ? h('p', { class: 'pcast-desc', text: descText }) : null

  // A compact "Listen on Fountain" link under the description, and the only
  // outbound link left on a titled card: the art, the title and "See all boosts"
  // all resolve to /episode/<item-guid> now, and the show name to /show/<guid>.
  const linksRow = fountainUrl
    ? h('div', { class: 'pcast-links' }, [
        h('a', { class: 'pcast-fountain-link', href: fountainUrl, target: '_blank', rel: 'noopener noreferrer', title: 'Listen on Fountain' }, 'Listen on Fountain ↗'),
      ])
    : null

  // Show name — links to the show's landing page on OnlyBoosts. It used to
  // point at Boost Me Bitch alongside the art and the episode title; the ART
  // still does, so the outbound affordance is intact, and both names now go to
  // the page for the thing they name. Falls back to plain text for a
  // show with no page (no guid, or a synthetic one) — see show-link.js.
  const showHref = showPageHref(show?.podcast_guid)
  const showEl = show?.title
    ? (showHref
        ? h('a', { class: 'pcast-show pcast-show-link', href: showHref, title: `Nostr boosts to ${show.title}` }, show.title)
        : h('div', { class: 'pcast-show', text: show.title }))
    : null

  // The counts sit in the card body, under the Fountain link, rather than on
  // the drawer bar where they used to be. Two reasons: the drawer is now named
  // for what it opens ("Nostr Interactions") instead of doubling as a stat
  // line, and these figures need the "Nostr Stats:" qualifier, which is the
  // per-card replacement for the scope-note paragraph that used to sit above
  // the whole feed. The sats stay on the drawer bar beside the booster faces;
  // they are the visual anchor there and repeating them here would only echo.
  // ⚠️ THE FIGURES ARE THE SERVER'S, NOT A COUNT OF THE ROWS IN THIS CARD. The
  // endpoint caps the notes it inlines at 50 per episode while reporting the
  // true all-time totals, so counting `boosts` here would understate the one
  // episode in the index that exceeds the cap. It falls back to the rows for a
  // card built from anything that does not carry totals.
  const nBoosters = item.totals?.boosters ?? distinctBoosters.length
  const nBoosts = item.totals?.boosts ?? boosts.length
  const statsRow = h('div', { class: 'pcast-meta pcast-nstats' }, [
    h('span', { class: 'ob-stats-label', text: 'Nostr Stats:' }),
    h('span', { text: `${nBoosters.toLocaleString()} booster${nBoosters === 1 ? '' : 's'}` }),
    h('span', { class: 'pcast-dot', 'aria-hidden': 'true', text: '·' }),
    h('span', { text: `${nBoosts.toLocaleString()} boost${nBoosts === 1 ? '' : 's'}` }),
    // Boost rides the end of this line. It used to be a labelled button in a
    // row of its own beneath the player, alongside "↓ Download MP3"; that row
    // cost a full band of card height for two controls, and the download
    // duplicated what every browser's own audio ⋮ menu already offers. The
    // pill is the same one the Shows cards and the /show community drawer
    // use, right-aligned by .ob-boost-pill's own margin-left.
    boostButton({
      label: ep.title || copy.untitled,
      onClick: (btn) => onBoostClick(item, btn, copy),
    }),
  ])

  const body = h('div', { class: 'pcast-card-body' }, [
    showEl,
    titleEl,
    descP,
    linksRow,
    statsRow,
  ])

  // Media column: episode art with the air date tucked directly beneath it —
  // keeps the date off the body's right edge so the ⋮ menu can hug the corner
  // and the body reclaims the width.
  const mediaCol = h('div', { class: 'pcast-media-col' }, [
    media,
    ep.published ? h('div', { class: 'pcast-card-aired', title: copy.dated }, fullDate(ep.published)) : null,
  ])
  // Rank badge sits at the head of the row on ranked sorts. aria-hidden
  // because the visual order already conveys it to a screen reader, and an
  // announced "1." before every episode title is noise.
  const rankEl = rank == null ? null
    : h('div', { class: 'pcast-rank', 'aria-hidden': 'true', text: String(rank) })
  const head = h('div', { class: 'pcast-card-head' }, [rankEl, mediaCol, body, subscribeMenu(item)])

  // Inline audio player (native controls, no preload until played).
  const audioUrl = safeHttpUrl(ep.enclosure_url)
  let player = null
  if (audioUrl) {
    const a = h('audio', { class: 'pcast-player', controls: 'controls', preload: 'none' })
    if (ep.enclosure_type) a.appendChild(h('source', { src: audioUrl, type: ep.enclosure_type }))
    else a.src = audioUrl
    player = h('div', { class: 'pcast-player-row' }, a)
  }

  const details = h('div', { class: 'pcast-details', id: detailsId, hidden: 'hidden' })
  let built = false
  function toggle() {
    const open = drawer.getAttribute('aria-expanded') === 'true'
    if (open) {
      drawer.setAttribute('aria-expanded', 'false')
      details.hidden = true
      card.classList.remove('is-open')
    } else {
      if (!built) { built = true; buildDetails(details, boosts, toggle, () => card, epHref, outHref, copy) }
      drawer.setAttribute('aria-expanded', 'true')
      details.hidden = false
      card.classList.add('is-open')
    }
  }

  // The drawer is named for what it opens rather than for a count. It holds
  // the boost notes themselves, each with a reply / like / repost / zap bar,
  // so "Nostr Interactions" describes the contents and carries the qualifier
  // at the same time. The counts it used to carry moved up into the card body
  // as the "Nostr Stats:" line; LB's older "N local boosters" label is two
  // renames back.
  // The colon is load-bearing: the booster faces and the sats sit immediately
  // to the right, so the label reads as introducing them rather than as a
  // heading floating above an unexplained row of avatars.
  const drawerLabel = 'Nostr Interactions:'
  const drawerMeta = h('span', { class: 'pcast-drawer-meta' }, [
    avatars,
    totalSats > 0 ? h('span', { class: 'pcast-sats' }, [`${fmtSats(totalSats)} `, h('span', { class: 'pcast-bolt', 'aria-hidden': 'true', text: '⚡' })]) : null,
  ])
  const drawer = h('button', {
    class: 'pcast-drawer', type: 'button',
    'aria-expanded': 'false', 'aria-controls': detailsId, onclick: toggle,
  }, [
    h('span', { class: 'pcast-drawer-caret', 'aria-hidden': 'true', text: '▾' }),
    h('span', { class: 'pcast-drawer-label', text: drawerLabel }),
    drawerMeta,
  ])

  const card = h('div', { class: 'pcast-card' }, [head, player, drawer, details])
  return card
}

// Populate a card's boost thread: every boost (no truncation — hiding
// comments implied some weren't worth showing), then a bottom "hide" that
// collapses the drawer and brings the card head back into view so a long
// thread is easy to close without scrolling all the way back up.
function buildDetails(details, boosts, toggle, getCard, epHref, outHref, copy) {
  for (const b of boosts) details.appendChild(boostRow(b))
  const hide = h('button', {
    class: 'pcast-drawer-close', type: 'button',
    onclick: () => { toggle(); try { getCard().scrollIntoView({ block: 'nearest' }) } catch {} },
  }, [h('span', { class: 'pcast-drawer-caret', 'aria-hidden': 'true', text: '▴' }), 'Hide boosts'])
  // "See all boosts" now means this episode's own page, which is a fuller
  // answer than the drawer above it: the drawer holds the boosts this feed
  // loaded, where the page holds every one in the index plus the community
  // rollup. The ↗ and the new tab go with the destination — they belong to a
  // link that leaves the site, and only the untitled-episode fallback does.
  const seeAll = epHref
    ? h('a', { class: 'pcast-seeall', href: epHref, title: copy.seeAllTitle }, 'See all boosts')
    : outHref
      ? h('a', {
          class: 'pcast-seeall', href: outHref, target: '_blank', rel: 'noopener noreferrer',
          title: copy.seeAllOutTitle,
        }, ['See all boosts', h('span', { 'aria-hidden': 'true', text: ' ↗' })])
      : null
  details.appendChild(h('div', { class: 'pcast-details-foot' }, [seeAll, hide]))
}

// Subscribe (⋮) menu on the card head — show-level app links.
function subscribeMenu(item) {
  const links = subscribeLinks(item)
  if (!links.length) return null

  const wrap = h('div', { class: 'pcast-cardmenu' })
  const btn = h('button', {
    class: 'pcast-cardmenu-btn', type: 'button',
    'aria-haspopup': 'true', 'aria-expanded': 'false',
    'aria-label': 'Subscribe to this show', title: 'Subscribe',
  }, '⋮')

  const menu = h('div', { class: 'pcast-cardmenu-menu', hidden: 'hidden' }, [
    h('div', { class: 'pcast-cardmenu-label', text: 'Follow this show on' }),
    ...links.map((l) => h('a', {
      class: 'pcast-cardmenu-item', href: l.url, target: '_blank', rel: 'noopener noreferrer',
      onclick: () => close(),
    }, l.label)),
  ])
  wrap.append(btn, menu)

  function onDoc(e) { if (!wrap.contains(e.target)) close() }
  function onKey(e) { if (e.key === 'Escape') close() }
  function open() {
    menu.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    // Scrolled into view on open, minimally. The menu is position:absolute and
    // opens downward, so on the homepage it can land below the fold and on
    // /episode/<guid> it can land past the bottom of that section's scroll
    // container, which clips it. `block: 'nearest'` is a no-op when the menu is
    // already fully visible, so this costs the common case nothing.
    try { menu.scrollIntoView({ block: 'nearest' }) } catch {}
    document.addEventListener('click', onDoc, true)
    document.addEventListener('keydown', onKey)
  }
  function close() {
    menu.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', onDoc, true)
    document.removeEventListener('keydown', onKey)
  }
  btn.addEventListener('click', () => { menu.hidden ? open() : close() })
  return wrap
}

function boostRow(b) {
  const profile = profileFor(b.booster_pubkey)
  const name = profile?.name?.trim() || (b.booster_npub ? b.booster_npub.slice(0, 12) + '…' : 'anon')

  // The primary link of the row: the avatar beside it points at the same page
  // and is marked secondary, so this is the one that is announced and tabbed to.
  // Falls back to a plain span when there is no identifier to key on, which
  // cannot happen for a real record but must not emit a dead href if it does.
  const href = boosterPageHref(b.booster_npub, b.booster_pubkey)
  const nameEl = href
    ? markBoosterLink(h('a', { class: 'pcast-boost-name', href }, name), { label: name })
    : h('span', { class: 'pcast-boost-name' }, name)

  const satsEl = (b.sats != null)
    ? h('span', { class: 'pcast-boost-sats' }, [`${fmtSats(b.sats)} `, h('span', { class: 'pcast-bolt', 'aria-hidden': 'true', text: '⚡' })])
    : null

  const head = h('div', { class: 'pcast-boost-head' }, [
    avatarEl(profile, b.booster_npub, { size: 34, interactive: true, label: name, pk: b.booster_pubkey }),
    h('div', { class: 'pcast-boost-who' }, [
      nameEl,
      h('span', { class: 'pcast-boost-when', text: fullDate(b.created_at) }),
    ]),
    satsEl,
    moreMenu(b),
  ])

  const parts = [head]
  const msg = (b.message || '').trim()
  if (msg) {
    const msgEl = h('div', { class: 'pcast-boost-msg' })
    // Reuse the boost-thread tokenizer: nostr: mentions → chips, URLs →
    // links, everything else plain text nodes. inEmbed keeps a quoted note
    // as a chip instead of triggering an embed fetch.
    renderSegmentsInto(msgEl, parseSegments(msg), { inEmbed: true })
    parts.push(msgEl)
  }
  const row = h('div', { class: 'pcast-boost' }, parts)

  // Reuse the shared boosts-page action bar (Reply / Repost / Like / Zap). The
  // boost IS a kind-1 note, so id + pubkey is all these actions need.
  if (b.event_id && b.booster_pubkey) {
    const ev = { id: b.event_id, pubkey: b.booster_pubkey, kind: 1, content: b.message || '', created_at: b.created_at, tags: [] }
    try { row.appendChild(buildActionBar(ev, row)) } catch (e) { console.warn('[podcasts] action bar failed', e) }
  }
  return row
}

// Per-boost overflow (⋮) menu — its one item copies the boost note's nevent.
function moreMenu(b) {
  const wrap = h('div', { class: 'pcast-more' })
  const btn = h('button', {
    class: 'pcast-more-btn', type: 'button', 'aria-label': 'More options',
    'aria-haspopup': 'true', 'aria-expanded': 'false',
  }, '⋮')
  // Copy npub is here because the avatar and the name above it stopped copying
  // when they became links to /booster/<npub>. The gesture is on the booster's
  // own page too, but this menu was already on the row and keeps it one click
  // away rather than one navigation — which matters for the reader who wants the
  // npub precisely so they do NOT have to go somewhere else for it.
  const npub = b.booster_npub || b.booster_pubkey
  const menu = h('div', { class: 'pcast-more-menu', hidden: 'hidden' }, [
    npub ? h('button', {
      class: 'pcast-more-item', type: 'button',
      onclick: () => { close(); copyNpub(npub) },
    }, 'Copy npub') : null,
    h('button', {
      class: 'pcast-more-item', type: 'button',
      onclick: () => { close(); copyNevent(b.event_id, b.booster_pubkey) },
    }, 'Copy nevent'),
  ])
  wrap.append(btn, menu)

  function onDoc(e) { if (!wrap.contains(e.target)) close() }
  function onKey(e) { if (e.key === 'Escape') close() }
  function open() {
    menu.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    // Same reason as the subscribe menu above.
    try { menu.scrollIntoView({ block: 'nearest' }) } catch {}
    document.addEventListener('click', onDoc, true)
    document.addEventListener('keydown', onKey)
  }
  function close() {
    menu.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', onDoc, true)
    document.removeEventListener('keydown', onKey)
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    menu.hidden ? open() : close()
  })
  return wrap
}

// ── Profiles ─────────────────────────────────────────────────────────
// Booster kind-0s aren't in the snapshot; fetch them once (only ~50 distinct
// boosters) and stash in a module map the card/modal renderers read.
const profiles = new Map()
function profileFor(pubkey) { return profiles.get(pubkey) || null }

/* Seed the map from identities that came embedded in the data feed.
 *
 * renderPodcasts does this inline for its own corpus; the episode page's
 * community section is the second consumer of these cards and holds a corpus of
 * its own, so the seeding is a function rather than a reach into a module map.
 * setCachedProfile feeds the same identity to the boost-thread tokenizer, which
 * is what makes an @mention chip inside a boost message agree with the avatar
 * and display name above it.
 */
export function seedProfiles(map) {
  for (const [pk, prof] of map) {
    if (!profiles.has(pk)) { profiles.set(pk, prof); setCachedProfile(pk, prof) }
  }
}

// nostr: mentions inside a boost message (npub / nprofile). Matches how
// boosts-thread parses them — bare npubs without the scheme aren't linked
// there either, so we keep parity.
const MENTION_RE = /nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+)/gi

function mentionPubkeys(text) {
  const out = []
  for (const m of (text || '').matchAll(MENTION_RE)) {
    try {
      const d = nip19.decode(m[1])
      if (d.type === 'npub') out.push(d.data)
      else if (d.type === 'nprofile') out.push(d.data.pubkey)
    } catch {}
  }
  return out
}

const PROFILE_CHUNK = 80  // Primal user_infos drops results on large batches

async function fetchProfilesInto(pubkeys) {
  for (let i = 0; i < pubkeys.length; i += PROFILE_CHUNK) {
    try {
      const got = await fetchProfilesFromPrimal(pubkeys.slice(i, i + PROFILE_CHUNK))
      for (const [pk, prof] of got) {
        profiles.set(pk, prof)
        setCachedProfile(pk, prof)  // also feed the tokenizer's mention cache
      }
    } catch { /* leave this chunk unresolved; it degrades to npub + initials */ }
  }
}

// Two phases, deliberately separate: boosters drive the visible card avatars
// and row names, so resolve them first and let the caller repaint on that.
// Message-mention profiles (for @DisplayName inside boost text) are a larger,
// lower-priority set fetched after — kept in their own requests so they can't
// crowd boosters out of a single response.
// Booster names/avatars now arrive embedded in the data feed, so this only
// has to fetch the stragglers — records whose booster had no kind-0 when the
// collector ran. Seeding happens in renderPodcasts before first paint.
export async function loadBoosterProfiles(items) {
  const pks = new Set()
  for (const it of items) for (const b of it.boosts) {
    if (b.booster_pubkey && !profiles.has(b.booster_pubkey)) pks.add(b.booster_pubkey)
  }
  if (!pks.size) return
  await fetchProfilesInto([...pks])
}

export async function loadMentionProfiles(items) {
  const pks = new Set()
  for (const it of items) for (const b of it.boosts) for (const pk of mentionPubkeys(b.message)) pks.add(pk)
  await fetchProfilesInto([...pks].filter((pk) => !profiles.has(pk)))
}

// ── Sorting ──────────────────────────────────────────────────────────
// Sorts where a position means something. Kept next to SORT_OPTIONS so the
// two can't drift — adding a quantitative sort means adding it here too.
export const RANKED_SORTS = new Set(['count', 'boosts', 'sats'])

export const SORT_OPTIONS = [
  ['recent', 'Latest boost'],
  ['episode', 'Latest episode'],
  ['count', 'Most boosters'],
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
]
// Put this feed's range buttons + sort dropdown in the sticky feed bar.
function mountControls(feed, { sortKey, rangeKey, onSort, onRange, copy }) {
  mountFeedControls(feed, [
    rangeControl(rangeKey, onRange, {
      label: copy.rangeLabel, titleFor: (key) => copy.rangeTitle(rangeDays(key)),
    }),
    // Only the date sort's label changes between the two feeds; the rest are
    // measures of boost activity and read the same either way.
    sortControl(
      SORT_OPTIONS.map(([k, label]) => [k, k === 'episode' ? copy.sortDateLabel : label]),
      sortKey, onSort, { title: copy.sortTitle },
    ),
  ])
}

// ── The corpus ───────────────────────────────────────────────────────
//
/* ⚠️ RANKING MOVED TO THE SERVER, AND IT WAS A CORRECTNESS FIX RATHER THAN A
 * SPEEDUP.
 *
 * Both feeds used to pull latest.json plus three month archives and roll the
 * whole thing up in the browser, which ranked over whatever those shards
 * happened to hold rather than over the index. Measured against the full corpus:
 * 7 of the true all-time top 10 episodes were missing outright, only 20 of the
 * true top 100 appeared at all, and the true #7 painted at #128 because only its
 * last-three-months sats were counted. Songs was worse — 84 of 601 music
 * episodes — because music is ~5% of a boost stream whose window was sized for
 * the other 95%.
 *
 * /api/v1/episodes aggregates over every boost, so the range filter and the sort
 * menu are QUERIES now rather than array operations, and changing either
 * refetches. filterItems / sortItems / defaultRange and the SORTS table went
 * with them; SORT_OPTIONS survives because its keys are the endpoint's own sort
 * values, and RANKED_SORTS because it still decides when a position is worth
 * printing.
 *
 * ⚠️ ONE CALLER OUTLIVED THE FIRST TWO and was not caught here: the community
 * section on /episode/<guid> imports this module for `episodeCard` and was also
 * calling `sortItems` / `filterItems`, which left it painting an empty list.
 * It carries its own copy now, correctly — that section holds its whole bounded
 * corpus in one response, where these feeds hold a paged prefix, so ranking in
 * memory is right there and wrong here. Don't re-export these to serve it.
 *
 * THE MEDIUM SPLIT MOVED TOO. mediumPredicate() and the podcasts/index.json
 * rollup it joined through are no longer read by these feeds at all — the
 * endpoint takes the medium as a parameter, so a ~103KB fetch and a guid→medium
 * join both left the page.
 */

// One page of ranked episodes, adapted into the shape the card already reads.
//
// Nothing downstream knows the corpus changed: the endpoint returns each
// episode's notes inline in the collector's own record shape, so
// ob-data.js#episodeApiToBoosts hydrates the podcast/episode blocks back onto
// them and the existing normalizeBoosts → toEpisodeShape → buildEpisodes chain
// runs unmodified over them.
async function loadEpisodePage({ medium, sort, range, offset, follows, q = null, limit, signal }) {
  const { records, nextOffset } = await getEpisodePage({
    medium: medium === 'music' ? 'music' : null,
    sort, range, offset, follows, q, limit, signal,
  })
  const { boosts, totals } = episodeApiToBoosts(records)
  const shaped = toEpisodeShape(normalizeBoosts({ boosts }))
  // Booster identities ride along in every record, so the cards paint with real
  // names and avatars with no profile round trip.
  seedProfiles(shaped.profiles)

  // ⚠️ buildEpisodes ENDS WITH A SORT BY RECENCY, which would throw away the
  // ranking we just asked the server for. The API's order is the answer, so the
  // built items are put back into it here.
  const built = new Map(buildEpisodes(shaped).map((it) => [it.guid, it]))
  const items = []
  for (const r of records) {
    const it = built.get(r.guid)
    if (!it) continue
    // ⚠️ FIGURES FROM THE AGGREGATES, NOTES FROM THE ROWS. Inline notes are
    // capped at 50 per episode while the record's counts are true all-time
    // totals, so recounting the rows would understate the one episode in the
    // index that exceeds the cap.
    it.totals = totals.get(r.guid) || null
    // A `q=` response ranks each hit against the WHOLE ordering rather than
    // against the handful of rows it returned, so a searched card can only get
    // its position from here. An unfiltered page carries no rank and is
    // numbered by position instead, in rebuild().
    if (Number.isFinite(r.rank)) it._rank = r.rank
    items.push(it)
  }
  return { items, nextOffset }
}

// ── Entry point ──────────────────────────────────────────────────────
/**
 * @param {Element} opts.list    the [data-feed-list] container
 * @param {string}  opts.scope   'global' | 'follows'
 * @param {string}  opts.medium  'other' (Episodes) | 'music' (Songs) — which
 *                               side of <podcast:medium> this feed shows
 */
export async function renderPodcasts({ panel, list, scope = 'global', medium = 'other' }) {
  const copy = COPY[medium] || COPY.other
  // Ranks are meaningful on Global, where the ordering is a leaderboard over
  // the whole network. On Follows the population is just "whoever you happen
  // to follow", so a #1 would imply a standing that doesn't exist.
  const showRanks = scope !== 'follows'
  // A re-render (account switch) may end on a placeholder, so clear any box a
  // previous run left behind before deciding whether this one gets one. The
  // scope line above it takes the same treatment for the same reason.
  resetFeedSearch(panel)
  resetFeedNote(panel)
  // Follows scoping applies to the raw boost rows, BEFORE the episode rollup:
  // an episode should only appear if someone you follow boosted it, and its
  // booster counts / sat totals must reflect only those boosts. Scoping after
  // the rollup would list the right episodes with wrong numbers — which is
  // also why the published podcasts/index.json can't serve this tab, since its
  // aggregates are computed over everyone.
  let follows = null
  if (scope === 'follows') {
    const res = await resolveFollows()
    if (res.status === 'signed-out') {
      renderPlaceholder(list, 'Sign in to see this feed', 'Follows feeds read your kind-3 contact list, so they need a signed-in npub.')
      return
    }
    if (res.status === 'unavailable') {
      renderPlaceholder(list, 'Couldn’t load your follow list', 'We couldn’t reach a relay holding your kind-3 contact list — please try again later.')
      return
    }
    if (res.status === 'empty') {
      renderPlaceholder(list, ...copy.noFollows)
      return
    }
    // The array the query API takes. The membership testing this used to do
    // client-side is now an indexed IN over the follow set.
    follows = res.follows
  }

  // Most boosts is the opening sort on both feeds — raw boost volume is the
  // ranking the feed is FOR. ('count' ranks by distinct boosters instead; the
  // two differ on the ~16% of episodes someone boosted more than once.)
  let sortKey = 'boosts'
  // Both scopes open on All now. Global always did; Follows used to widen from
  // 1W until something appeared, which needed the whole corpus in hand to test
  // — three requests to reproduce, against a feed whose whole history is thin
  // enough that All is the useful opening view anyway.
  let rangeKey = 'all'

  let items = []
  let nextOffset = 0
  let loading = false
  let search = null
  let view = []
  // The search filter lives here rather than being read back off the module,
  // because resolving a pick is a FETCH now: `picked` is the chosen suggestion,
  // `pickedItem` the card built for it, and the gap between them is a state the
  // feed has to paint rather than an instant array filter.
  let picked = null
  let pickedItem = null
  let pickLoading = false
  let pickSeq = 0
  const cards = h('div', { class: 'pcast-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  // The first page decides whether there is a feed at all, so it is the one
  // fetch that can render a placeholder instead of cards.
  let first
  try {
    first = await loadEpisodePage({ medium, sort: sortKey, range: rangeKey, offset: 0, follows })
  } catch (e) {
    console.error('[podcasts] fetch failed', e)
    renderPlaceholder(list, ...copy.loadFail)
    return
  }
  if (!first.items.length) {
    renderPlaceholder(list, ...(follows ? copy.emptyFollows : copy.emptyGlobal))
    return
  }
  items = first.items
  nextOffset = first.nextOffset

  // There is a ranking, so say what it ranks over. Mounted here rather than at
  // the top of the function so it shares the search box's contract: a feed that
  // ends on "sign in" or a load failure never grows a line describing a list it
  // isn't showing.
  mountFeedNote(panel, follows ? copy.noteFollows : copy.noteGlobal)

  // Pre-warm the boost widget in the background once the feed is up, so the
  // first Boost click doesn't pay the cold-start cost (bundle load + session /
  // wallet restore). Deferred so it doesn't compete with first paint.
  setTimeout(() => {
    ensureWidgetLoaded()
      // Wire the shared reply/repost/like/zap actions once the widget (window.
      // LBLogin) is up, so boost-comment action bars work and hydrate the
      // user's existing likes/reposts.
      .then(() => { try { configureBoostActions({}) } catch {} })
      .catch(() => {})
  }, 1200)

  // Names/avatars enrich the cards but must not gate first paint — render
  // immediately with what the records embedded, repaint once the stragglers
  // resolve, and resolve message-mention profiles in the background.
  let profilesReady = loadBoosterProfiles(items)
  loadMentionProfiles(items)

  /* Paint the cards currently in `view`, and the control under them.
   *
   * ⚠️ THE RANK IS THE POSITION IN THE SERVER'S ORDER, stamped over `items`
   * before any search filter narrows it — so a searched episode keeps the
   * standing it has in the feed rather than being renumbered to #1. That is the
   * same contract the client-side ranking kept; only who computes the order
   * changed. Numbering continues across pages rather than restarting.
   */
  function paint() {
    cards.innerHTML = ''
    moreWrap.innerHTML = ''
    if (!view.length) {
      // Three empty states, and conflating any two of them tells the reader
      // something false: still fetching, fetched and genuinely outside the
      // range, or no search at all and the window itself is empty.
      cards.appendChild(pickLoading
        ? h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: 'Loading…' }),
            `Fetching ${picked?.label || 'that one'}.`,
          ])
        : picked
          ? h('div', { class: 'feed-placeholder' }, [
              h('strong', { text: 'Not in this range' }),
              `${picked.label} ${copy.outOfRange}`,
            ])
          : h('div', { class: 'feed-placeholder' }, [
              h('strong', { text: copy.emptyWindow[0] }),
              copy.emptyWindow[1],
            ]))
      return
    }
    view.forEach((it) => {
      const el = episodeCard(it, (showRanks && RANKED_SORTS.has(sortKey)) ? it._rank : null, copy)
      el._pcastItem = it   // lets repaintProfiles map avatars regardless of order
      cards.appendChild(el)
    })
    // "Load more" is a REQUEST now, not a slice, so it reports what it is doing
    // and cannot be pressed twice. A search selection hides it: the list is one
    // card, and paging under it would be paging something the reader filtered
    // away.
    if (nextOffset != null && !picked) {
      const btn = h('button', {
        class: 'pcast-showmore', type: 'button',
        onclick: async () => {
          if (loading) return
          loading = true
          btn.disabled = true
          btn.textContent = 'Loading…'
          try {
            const next = await loadEpisodePage({
              medium, sort: sortKey, range: rangeKey, offset: nextOffset, follows,
            })
            items = items.concat(next.items)
            nextOffset = next.nextOffset
            profilesReady = loadBoosterProfiles(next.items)
            loadMentionProfiles(next.items)
            rebuild()
            profilesReady.then(() => repaintProfiles(cards))
          } catch (e) {
            console.warn('[podcasts] load more failed', e)
            btn.disabled = false
            btn.textContent = copy.moreLabel(INITIAL_CARDS)
          } finally {
            loading = false
          }
        },
      }, copy.moreLabel(INITIAL_CARDS))
      moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
        btn,
        // No total to count against: the endpoint pages rather than reporting
        // how many episodes the whole range holds, so this says what is on
        // screen and nothing it cannot support.
        h('div', { class: 'pcast-more-count', text: `Showing ${items.length}` }),
      ]))
    }
  }

  /* Rank first, filter second — ranking the filtered list would tell a searched
   * episode it is #1 of 1, which answers a different question.
   *
   * ⚠️ THE TWO HALVES OF THAT NOW COME FROM DIFFERENT PLACES, and the ordering
   * survives the move. An unfiltered page is numbered by position, because the
   * server returned it in rank order from offset 0. A searched card cannot be
   * numbered that way at all: it is one row out of a filtered query and its
   * standing is a fact about the whole index, so it carries the `rank` the
   * server computed and `pickedItem` is never renumbered here.
   */
  function rebuild() {
    if (!picked) items.forEach((it, i) => { it._rank = i + 1 })
    search?.refresh()
    view = picked ? (pickedItem ? [pickedItem] : []) : items
    paint()
    repaintProfiles(cards)
  }

  /* Fetch the picked episode under the feed's CURRENT range and sort.
   *
   * The suggestion already carries everything the menu row needed, but not the
   * boost notes the card's drawer opens onto: those are ~16KB an episode, so the
   * typeahead asks for the list without them and this asks again for the one row
   * that was chosen. Re-issuing the same query is what makes that row findable —
   * same q, same filters, same ordering, so the pick is inside the same handful
   * of hits it came out of.
   *
   * It runs again on every range or sort change, because both move the ranking
   * the card is reporting, and either can push the episode out of the window
   * entirely. Nothing found means exactly that, and paint() says so.
   */
  async function resolvePick() {
    const mine = ++pickSeq
    // Dropping the filter comes through here too (editing the box or pressing
    // ×), and it has to repaint: bumping pickSeq above has already retired any
    // resolve still in flight, so nothing else is going to.
    if (!picked) { pickedItem = null; pickLoading = false; rebuild(); return }
    pickLoading = true
    pickedItem = null
    rebuild()
    try {
      const page = await loadEpisodePage({
        medium, sort: sortKey, range: rangeKey, offset: 0, follows,
        q: picked.query, limit: SEARCH_HITS,
      })
      if (mine !== pickSeq) return
      pickedItem = page.items.find((it) => it.guid === picked.key) || null
      if (pickedItem) {
        loadBoosterProfiles([pickedItem]).then(() => repaintProfiles(cards))
        loadMentionProfiles([pickedItem])
      }
    } catch (e) {
      if (mine !== pickSeq) return
      console.warn('[podcasts] search pick failed', e)
      showToast('Couldn’t open that search result — please try again.', true)
    } finally {
      if (mine === pickSeq) { pickLoading = false; rebuild() }
    }
  }

  /* A range or sort change is a new QUERY, so it refetches from offset 0.
   *
   * The previous cards stay on screen while it is in flight rather than being
   * cleared to a spinner: a feed that blanks on every control press reads as
   * broken, and the answer usually arrives in well under a second. A failure
   * leaves the old view in place and says so, which is the honest outcome —
   * the reader still has the list they had.
   */
  async function requery() {
    if (loading) return
    loading = true
    try {
      const page = await loadEpisodePage({ medium, sort: sortKey, range: rangeKey, offset: 0, follows })
      items = page.items
      nextOffset = page.nextOffset
      profilesReady = loadBoosterProfiles(items)
      loadMentionProfiles(items)
      rebuild()
      profilesReady.then(() => repaintProfiles(cards))
      // The unfiltered list is still fetched under a live search filter, since
      // clearing the box has to reveal the new range rather than fetch again.
      // The card on screen, though, is the picked one, and its rank moved.
      if (picked) resolvePick()
    } catch (e) {
      console.warn('[podcasts] requery failed', e)
      showToast('Couldn’t reload the feed — please try again.', true)
    } finally {
      loading = false
    }
  }

  function applySort(key) {
    if (key === sortKey) return
    sortKey = key
    requery()
  }

  function applyRange(key) {
    if (key === rangeKey) return
    rangeKey = key
    requery()
  }

  mountControls(panel?.dataset.feed || `episodes-${scope}`,
    { sortKey, rangeKey, onSort: applySort, onRange: applyRange, copy })

  // Search the episodes in the current range. The show's name is the sub-line
  // because episode titles repeat across shows far more than they collide
  // within one ("Episode 42", "Weekly Roundup"), so the show is what tells two
  // hits apart.
  search = mountFeedSearch(panel, {
    placeholder: copy.searchPlaceholder,
    label: copy.searchLabel,
    noun: copy.searchNoun,
    minChars: SEARCH_MIN_CHARS,
    onPick: (entry) => { picked = entry; resolvePick() },
    /* ⚠️ SEARCHES THE WHOLE INDEX, not the loaded pages, and that is the half of
     * the server-side ranking move that was missing.
     *
     * The in-memory index this replaces read `items`, which was the entire
     * corpus while the rollup happened in the browser and became a PREFIX of it
     * the moment the endpoint started paging a ranked list. A show sitting at
     * #300 was then unfindable until the reader had pressed "load more" nine
     * times, which is the opposite of what a search is for.
     *
     * The show name is still matched as well as the episode title, because "no
     * agenda" has to find that show's episodes whatever their own titles are.
     * That match now happens in `episodes_fts`, whose `show` column exists for
     * this: title alone returned 2 hits for "UNGOVERNABLE" against the show's
     * own 135 episodes, all 2 belonging to other shows.
     */
    searchRemote: async (query, { signal }) => {
      const records = await searchEpisodes({
        // Same 'music'|null the data layer takes everywhere else. Passing this
        // feed's own 'other' would happen to work, since anything that isn't
        // 'music' becomes not_medium=music, but only by accident.
        q: query, medium: medium === 'music' ? 'music' : null,
        sort: sortKey, range: rangeKey, follows, signal,
      })
      return records.map((r) => ({
        key: r.guid,
        label: r.title || copy.untitled,
        // Shown, not matched. Episode titles repeat across shows far more than
        // they collide within one ("Episode 42", "Weekly Roundup"), so the show
        // is what tells two hits apart.
        sub: r.show?.title || '',
        img: r.img,
        // The query that produced this hit, carried so the pick can re-issue it
        // and land on the same row with its notes attached.
        query,
      }))
    },
    // What a miss MEANS depends on where the reader is standing: on All/Global
    // the search has seen the whole index, so there is no wider view to send
    // them to and the old "in this view" was pointing at one.
    noMatchText: () => (follows ? copy.searchNoneFollows
      : rangeKey === 'all' ? copy.searchNoneAll
      : copy.searchNoneRange),
  })

  list.className = ''
  list.innerHTML = ''
  list.append(cards, moreWrap)
  rebuild()

  // Repaint avatars/names in place once profiles land. repaintProfiles reads
  // each card's _pcastItem, so it's correct even after a re-sort rebuilds the
  // list into a different order.
  profilesReady.then(() => repaintProfiles(cards))
}

// Swap decorative card avatars in place after profiles resolve, so we don't
// tear down and rebuild the whole list. Modal rows read profileFor() live, so
// they're already correct whenever a card is opened after this runs.
export function repaintProfiles(cards) {
  cards.querySelectorAll('.pcast-card').forEach((cardEl) => {
    const it = cardEl._pcastItem
    if (!it) return
    const holder = cardEl.querySelector('.pcast-avatars')
    if (!holder) return
    holder.innerHTML = ''
    for (const b of it.distinctBoosters.slice(0, MAX_FACES)) {
      holder.appendChild(avatarEl(profileFor(b.booster_pubkey), b.booster_npub, { size: 22 }))
    }
  })
}
