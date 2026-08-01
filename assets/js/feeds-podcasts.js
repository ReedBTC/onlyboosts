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
 * tiebreaker. The opening air-date window differs by scope — see
 * defaultRange. Both are user-switchable from the sticky feed bar, whose
 * range/sort chrome is shared with the note feed (feed-controls.js).
 *
 * Entry point: renderPodcasts({ panel, list }) — lazy-imported by feeds.js
 * the first time the feed is opened.
 */
import { nip19 } from '/assets/widgets/nostr-tools.js'
import {
  fetchProfilesFromPrimal,
  setCachedProfile,
  parseSegments,
  renderSegmentsInto,
} from '/assets/js/boosts-thread.js'
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js'
import { episodeBoostLink } from '/assets/js/episode-link.js'
import { buildActionBar, configureBoostActions } from '/assets/js/boost-actions.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'
import { resolveFollows } from '/assets/js/follow-set.js'
import {
  getLatestBoosts, getBoostMonths, getBoostMonth, toEpisodeShape, mediumPredicate,
} from '/assets/js/ob-data.js'
import { getFollowsBoosts } from '/assets/js/ob-live.js'
import { copyText, showToast, copyNpub } from '/assets/js/copy-npub.js'
import { boostButton, withBoostBusy } from '/assets/js/boost-button.js'
import {
  RANGE_OPTIONS, rangeDays, rangeCutoff,
  rangeControl, sortControl, mountFeedControls,
} from '/assets/js/feed-controls.js'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js'
import { showPageHref } from '/assets/js/show-link.js'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js'

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
    seeAllTitle: 'Open this episode on Boost Me Bitch',
    noun: 'episode',
    searchPlaceholder: 'Search episodes…',
    searchLabel: 'Search episodes',
    searchNoun: 'episode',
    rangeLabel: 'Filter by episode air date',
    rangeTitle: (days) => (days ? `Episodes aired in the last ${days} days` : 'All episodes'),
    sortTitle: 'Sort episodes',
    sortDateLabel: 'Latest episode',
    moreLabel: (n) => `Load ${n} more episode${n === 1 ? '' : 's'}`,
    loadFail: ['Couldn’t load podcast boosts', 'The boosts feed is unavailable right now — please try again later.'],
    noFollows: ['You’re not following anyone yet', 'Follow some npubs in any Nostr client and the episodes they boost will show up here.'],
    emptyFollows: ['No episodes from your follows yet', 'Nobody you follow has boosted a podcast episode recently. Switch to Global to see everyone.'],
    emptyGlobal: ['No boosted episodes yet', 'When someone boosts a podcast episode on Nostr, it’ll show up here.'],
    emptyWindow: ['No episodes in this window', 'Nothing the community boosted aired in this time range — try a wider one.'],
    outOfRange: 'aired outside this time range — widen the range, or clear the search.',
  },
  music: {
    untitled: 'Untitled track',
    listen: 'Listen to this track',
    dated: 'Released',
    seeAllTitle: 'Open this track on Boost Me Bitch',
    noun: 'track',
    searchPlaceholder: 'Search songs…',
    searchLabel: 'Search songs',
    searchNoun: 'song',
    rangeLabel: 'Filter by release date',
    rangeTitle: (days) => (days ? `Songs released in the last ${days} days` : 'All songs'),
    sortTitle: 'Sort songs',
    sortDateLabel: 'Latest release',
    moreLabel: (n) => `Load ${n} more song${n === 1 ? '' : 's'}`,
    loadFail: ['Couldn’t load music boosts', 'The boosts feed is unavailable right now — please try again later.'],
    noFollows: ['You’re not following anyone yet', 'Follow some npubs in any Nostr client and the songs they boost will show up here.'],
    emptyFollows: ['No songs from your follows yet', 'Nobody you follow has boosted a music track recently. Switch to Global to see everyone.'],
    emptyGlobal: ['No boosted songs yet', 'When someone boosts a track from a music feed on Nostr, it’ll show up here.'],
    emptyWindow: ['No songs in this window', 'Nothing the community boosted was released in this time range — try a wider one.'],
    outOfRange: 'was released outside this time range — widen the range, or clear the search.',
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

// A booster avatar. `interactive` wires click/keyboard to copy the npub.
// Avatars load eagerly (they're tiny, and `loading=lazy` left off-screen
// ones perpetually unloaded → looked broken); a picture that fails to load
// (dead host, hotlink block) swaps to the initials chip via onerror.
function avatarEl(profile, npub, { size = 26, interactive = false, cls = '' } = {}) {
  const style = `--pcast-av:${size}px`
  const makeInitials = () => wire(h('span', { class: 'pcast-avatar pcast-avatar--none ' + cls, style }, initials(profile, npub)))

  function wire(n) {
    if (interactive && npub) {
      n.classList.add('is-interactive')
      n.setAttribute('role', 'button')
      n.setAttribute('tabindex', '0')
      n.setAttribute('title', 'Copy npub')
      n.addEventListener('click', (e) => { e.stopPropagation(); copyNpub(npub) })
      n.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); copyNpub(npub) }
      })
    }
    return n
  }

  const pic = profile?.picture
  if (pic && isSafeImg(pic)) {
    const img = h('img', { class: 'pcast-avatar ' + cls, style, src: pic, alt: '', referrerpolicy: 'no-referrer' })
    img.addEventListener('error', () => { img.replaceWith(makeInitials()) }, { once: true })
    return wire(img)
  }
  return makeInitials()
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

// ── "See all boosts" link ────────────────────────────────────────────
// Adapter onto episode-link.js, which owns the target. Only the item→primitives
// mapping lives here, because only this module knows the rollup's shape; the URL
// itself is shared with show-page.js so both surfaces publish the same link.
function boostMeBitchLink(item) {
  return episodeBoostLink({
    itemGuid: item.guid,
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
        bmbUrl: boostMeBitchLink(item) || '',
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
  const { ep, show, boosts, distinctBoosters, totalSats, latest } = item
  const detailsId = 'pcast-d-' + (++cardUid)

  const bmbUrl = boostMeBitchLink(item)

  // Episode art — links to the episode's Boost Me Bitch page (its full boost
  // feed), the same target as the episode title and show name below.
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
  const media = bmbUrl
    ? h('a', { class: mediaClass, href: bmbUrl, target: '_blank', rel: 'noopener noreferrer', title: 'See all boosts on Boost Me Bitch' }, hasArt ? mediaImg : '🎙')
    : h('div', { class: mediaClass }, hasArt ? mediaImg : '🎙')

  // Booster faces on the drawer bar, stacked — the first MAX_FACES of them.
  const avatars = h('span', { class: 'pcast-avatars' },
    distinctBoosters.slice(0, MAX_FACES).map((b) =>
      avatarEl(profileFor(b.booster_pubkey), b.booster_npub, { size: 22 })))

  // A Fountain episode URL, when we have one (present on ~98% of episodes).
  const link = episodeLink(boosts, show, copy)
  const fountainUrl = link && link.episode ? link.url : null

  // Title links to the episode's Boost Me Bitch page (its full boost feed);
  // plain text if we can't build that link.
  const titleText = ep.title || copy.untitled
  const titleEl = bmbUrl
    ? h('a', { class: 'pcast-title pcast-title-link', href: bmbUrl, target: '_blank', rel: 'noopener noreferrer', title: 'See all boosts on Boost Me Bitch' }, titleText)
    : h('div', { class: 'pcast-title', text: titleText })

  // Shownotes teaser: first ~2 lines of the description, with a link out to the
  // full description on the episode's Boost Me Bitch page.
  const descText = htmlToText(ep.description)
  const descP = descText ? h('p', { class: 'pcast-desc', text: descText }) : null

  // A compact "Listen on Fountain" link under the description. (The old "See
  // full description →" link was dropped — the art, show name, and title all
  // link to the Boost Me Bitch page now.)
  const linksRow = fountainUrl
    ? h('div', { class: 'pcast-links' }, [
        h('a', { class: 'pcast-fountain-link', href: fountainUrl, target: '_blank', rel: 'noopener noreferrer', title: 'Listen on Fountain' }, 'Listen on Fountain ↗'),
      ])
    : null

  // Show name — links to the show's landing page on OnlyBoosts. It used to
  // point at Boost Me Bitch alongside the art and the episode title; those two
  // still do, so the outbound affordance is intact and the show NAME now goes
  // to the show page, which is what it names. Falls back to plain text for a
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
  const nBoosters = distinctBoosters.length
  const nBoosts = boosts.length
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
      if (!built) { built = true; buildDetails(details, boosts, toggle, () => card, bmbUrl, copy) }
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
function buildDetails(details, boosts, toggle, getCard, bmbUrl, copy) {
  for (const b of boosts) details.appendChild(boostRow(b))
  const hide = h('button', {
    class: 'pcast-drawer-close', type: 'button',
    onclick: () => { toggle(); try { getCard().scrollIntoView({ block: 'nearest' }) } catch {} },
  }, [h('span', { class: 'pcast-drawer-caret', 'aria-hidden': 'true', text: '▴' }), 'Hide boosts'])
  const seeAll = bmbUrl
    ? h('a', {
        class: 'pcast-seeall', href: bmbUrl, target: '_blank', rel: 'noopener noreferrer',
        title: copy.seeAllTitle,
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

  const nameEl = h('button', {
    class: 'pcast-boost-name', type: 'button', title: 'Copy npub',
    onclick: () => copyNpub(b.booster_npub),
  }, name)

  const satsEl = (b.sats != null)
    ? h('span', { class: 'pcast-boost-sats' }, [`${fmtSats(b.sats)} `, h('span', { class: 'pcast-bolt', 'aria-hidden': 'true', text: '⚡' })])
    : null

  const head = h('div', { class: 'pcast-boost-head' }, [
    avatarEl(profile, b.booster_npub, { size: 34, interactive: true }),
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
  const menu = h('div', { class: 'pcast-more-menu', hidden: 'hidden' }, [
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
// Every comparator breaks ties on total sats, then on most-recent-boost so the
// order stays stable. 'count' ranks by distinct people, 'boosts' by raw boost
// volume — they differ on the ~16% of episodes where someone boosted the same
// episode repeatedly.
const bySats = (a, b) => b.totalSats - a.totalSats || b.latest - a.latest
const SORTERS = {
  recent: (a, b) => b.latest - a.latest || b.totalSats - a.totalSats,
  episode: (a, b) => (b.ep.published || 0) - (a.ep.published || 0) || bySats(a, b),
  count: (a, b) => b.distinctBoosters.length - a.distinctBoosters.length || bySats(a, b),
  boosts: (a, b) => b.boosts.length - a.boosts.length || bySats(a, b),
  sats: bySats,
}
export function sortItems(items, key) {
  return [...items].sort(SORTERS[key] || SORTERS.recent)
}

// ── Air-date range filter ────────────────────────────────────────────
// Scopes the feed to episodes that *aired* recently (ep.published), which is
// independent of when they were boosted — an old episode boosted today is in
// the feed's data but out of the 1W view. The note feed's identical-looking
// buttons filter on boost time instead, which is why the tooltips are written
// per feed rather than in feed-controls.js.
//
// On the music side the same field is the track's release date, which is why
// the tooltips come out of the copy table rather than being written here.
export function filterItems(items, key) {
  const cutoff = rangeCutoff(key)
  if (!cutoff) return items
  return items.filter((it) => (it.ep.published || 0) >= cutoff)
}
// Pick the opening range.
//
// Global opens on All: that tab's whole job is the network-wide picture, and
// a 7-day air-date window hides most of what the community has boosted —
// including every boost on an older episode, which is a lot of them.
//
// Follows opens on 1W and widens until something's there (a quiet week would
// otherwise leave the feed blank). A personal feed is small enough to read
// week by week, and "nothing this week" is useful information there.
function defaultRange(items, scope) {
  if (scope !== 'follows') return 'all'
  for (const [key] of RANGE_OPTIONS) {
    if (filterItems(items, key).length) return key
  }
  return 'all'
}

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

// ── Boost corpus ─────────────────────────────────────────────────────
// Both tabs group boosts by episode, so unlike the note feed neither can
// paint until it holds a corpus to roll up and range-filter over. What
// differs is where that corpus comes from.

/**
 * Global: latest.json plus the three most recent month archives.
 *
 * The range filter offers 1W / 1M / All, so "All" needs more than the recent
 * 1,000 boosts to mean anything — but pulling all 22 archives would be ~20MB.
 * Three months keeps the default views honest at ~4MB worst case.
 */
async function loadGlobalRows() {
  const [latest, months] = await Promise.all([getLatestBoosts(), getBoostMonths()])
  const seen = new Set()
  const rows = []
  const take = (arr) => {
    for (const b of arr) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      rows.push(b)
    }
  }
  take(latest)
  const archives = await Promise.all(
    months.slice(0, 3).map((m) => getBoostMonth(m.file).catch((e) => {
      console.warn('[podcasts] month load failed', m.file, e)
      return []
    }))
  )
  for (const a of archives) take(a)
  return rows
}

/**
 * Follows: the D1 query API, filtered to the contact list server-side.
 *
 * No month window here. The three-month bound above exists because the shards
 * are global and big; a follow set's boosts are a thin slice of the same
 * table, so the query walks the follow set's own history and stops on the row
 * budget in ob-live.js rather than at an archive boundary. That makes "All"
 * mean more on this tab than on Global, which is the right way round — a
 * Follows audience is exactly the one whose older boosts are worth finding.
 */
async function loadFollowsRows(authors) {
  const { rows, truncated } = await getFollowsBoosts(authors)
  if (truncated) {
    // Worth knowing when tuning the budget: the rollup is over a prefix of the
    // follow set's history, not all of it.
    console.info('[podcasts] follows corpus truncated at', rows.length, 'boosts')
  }
  return rows
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
  // previous run left behind before deciding whether this one gets one.
  resetFeedSearch(panel)
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

  let data
  try {
    // Which side of <podcast:medium> this feed shows. The corpus is the same
    // boosts either way; the medium is a property of the show, so it's joined
    // in from the published rollup rather than read off the boost — see
    // ob-data.js#mediumPredicate. Fetched alongside the corpus rather than
    // before it: the two are independent requests and serializing them would
    // put a whole round-trip in front of every feed's first paint.
    const [{ test: inMedium, ok: mediumOk }, rows] = await Promise.all([
      mediumPredicate(medium),
      follows ? loadFollowsRows(follows) : loadGlobalRows(),
    ])
    // `ok` is false when the rollup is unreachable, in which case `test` keeps
    // everything — so Episodes degrades to an unsplit feed, while Songs would
    // silently look empty. Only the music side treats that as an error,
    // because only there is "no results" a lie.
    if (!mediumOk && medium === 'music') {
      renderPlaceholder(list, 'Couldn’t sort podcasts from music',
        ' The show index that says which feeds are music is unavailable right now — please try again later.')
      return
    }
    data = toEpisodeShape(rows.filter((b) => inMedium(b.podcast.guid)))
    // Seed from the embedded identities so the cards paint with real names
    // and avatars immediately — no profile round-trip, no repaint.
    seedProfiles(data.profiles)
  } catch (e) {
    console.error('[podcasts] fetch failed', e)
    renderPlaceholder(list, ...copy.loadFail)
    return
  }

  const items = buildEpisodes(data)
  if (!items.length) {
    renderPlaceholder(list, ...(follows ? copy.emptyFollows : copy.emptyGlobal))
    return
  }

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

  // Names/avatars enrich the cards but shouldn't gate first paint — render
  // immediately with initials, repaint once booster profiles resolve, and
  // resolve message-mention profiles in the background for opened threads.
  const profilesReady = loadBoosterProfiles(items)
  loadMentionProfiles(items)

  // Most boosts is the opening sort on both tabs — raw boost volume is the
  // ranking the feed is *for*. ('count' ranks by distinct boosters instead;
  // the two differ on the ~16% of episodes someone boosted more than once.)
  let sortKey = 'boosts'
  let rangeKey = defaultRange(items, scope)
  let search = null
  // `sorted` is every episode in the range, ranked. `view` is what's painted:
  // the same list, or the single episode the search box picked out of it.
  let sorted = []
  let view = []
  let shown = 0
  const cards = h('div', { class: 'pcast-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  function renderMore() {
    if (!view.length) {
      const picked = search?.selection || null
      cards.appendChild(picked
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
    const next = view.slice(shown, shown + INITIAL_CARDS)
    next.forEach((it) => {
      // The rank was stamped in rebuild(), over the whole ranked list and
      // before any search filter narrowed it — so a searched episode keeps the
      // standing it has in the feed. Numbering continues across "Show more"
      // pages rather than restarting at 1 each time.
      const el = episodeCard(it, (showRanks && RANKED_SORTS.has(sortKey)) ? it._rank : null, copy)
      el._pcastItem = it   // lets repaintProfiles map avatars regardless of sort order
      cards.appendChild(el)
    })
    shown += next.length
    moreWrap.innerHTML = ''
    const remaining = view.length - shown
    if (remaining > 0) {
      const batch = Math.min(INITIAL_CARDS, remaining)
      moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
        h('button', {
          class: 'pcast-showmore', type: 'button', onclick: renderMore,
        }, copy.moreLabel(batch)),
        h('div', { class: 'pcast-more-count', text: `Showing ${shown} of ${view.length}` }),
      ]))
    }
  }

  // Rank first, filter second: ranking the filtered list instead would tell a
  // searched episode it's #1 of 1, which is the opposite of what the search is
  // being asked.
  function rebuild() {
    sorted = sortItems(filterItems(items, rangeKey), sortKey)
    sorted.forEach((it, i) => { it._rank = i + 1 })
    search?.refresh()
    const picked = search?.selection || null
    view = picked ? sorted.filter((it) => it.guid === picked.key) : sorted
    shown = 0
    cards.innerHTML = ''
    moreWrap.innerHTML = ''
    renderMore()
    repaintProfiles(cards)
  }

  function applySort(key) {
    if (key === sortKey) return
    sortKey = key
    rebuild()
  }

  function applyRange(key) {
    if (key === rangeKey) return
    rangeKey = key
    rebuild()
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
    onPick: () => rebuild(),
    getEntries: () => sorted.map((it) => ({
      key: it.guid,
      label: it.ep.title || copy.untitled,
      sub: it.show?.title || '',
      // The show name matches as well as showing: "no agenda" should find that
      // show's episodes whatever their own titles are.
      extra: it.show?.title || '',
      img: it.ep.image,
    })),
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
