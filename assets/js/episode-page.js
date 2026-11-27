/* Client hydration for /episode/<item-guid>.
 *
 * The page is server-rendered (functions/episode/[guid].js) and readable with no
 * JavaScript at all. This module adds:
 *
 *   - the shared detail-page chrome (back link, section deep-links, the hash
 *     spy, copy-npub, "Show N more", the art2 fallback, share, and the Primal
 *     profile backfill) — all of it in detail-page.js, shared with /show
 *   - the hero's Boost button, which pays THIS EPISODE's value block
 *   - the chapters drawer under the player, which the server cannot render
 *     because nothing in D1 holds a <podcast:chapters> URL
 *   - the verbs on "Other Episodes This Community Boosts" ("Other Songs" on a
 *     music feed; the heading and the corpus are split on medium)
 *
 * ⚠️ THAT LAST SECTION USED TO BE THE REASON THIS FILE WAS NOT SMALL, and it is
 * now four lines at the foot of it. Its rows are the full Episodes-feed card,
 * which existed only as JavaScript — so the section was client-rendered, was the
 * one part of this page that did not exist without a script, and pulled ~200KB
 * of renderer to paint itself. The card is `assets/js/episode-card.js` now, an
 * HTML-string builder the Pages Function runs at the edge, so the section ships
 * finished and `episode-section.js` only attaches its controls and its verbs.
 * That module is shared with the structurally identical section on
 * /booster/<npub>.
 */
import { showToast } from '/assets/js/copy-npub.js?v=ob-v318'
import { fromApiValue, applyExternalOverrides, combineTimeSplit } from '/assets/js/value-block.js?v=ob-v318'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v318'
import { episodeBoostLink } from '/assets/js/episode-link.js?v=ob-v318'
import { initEpisodeSection } from '/assets/js/episode-section.js?v=ob-v318'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, hydrateProfiles, initStatWindows,
} from '/assets/js/detail-page.js?v=ob-v318'
// The reaction bar and ⋮ on the server-rendered boost notes at the foot of
// this page. The community cards above them carry their own, through the feed
// renderer they are built by.
import { initBoostNoteActions } from '/assets/js/boost-note-actions.js?v=ob-v318'
import { initBoostSection, BOOST_SORTS } from '/assets/js/boost-section.js?v=ob-v318'
import { mountPlayer, chaptersBesideSongs } from '/assets/js/player.js?v=ob-v318'
import { favoriteButtonHtml } from '/assets/js/favorite-button.js?v=ob-v318'
import { boostButton, withBoostBusy } from '/assets/js/boost-button.js?v=ob-v318'

const VALUE_API = '/api/value'

function payload() {
  const el = document.getElementById('episode-boost-payload')
  if (!el) return null
  try { return JSON.parse(el.textContent) } catch { return null }
}

const EPISODE = payload()

// ── Shared detail-page chrome ─────────────────────────
//
// Identical on /show/<guid>; see detail-page.js. No HASH_ALIASES: none of this
// page's three section ids has ever been renamed, and the map is a repair for a
// rename that already happened rather than a licence for the next one.
initCopyNpub()
initShowMore()
initShare()
initBackLink()
// The return value used to be kept so the community section could re-reveal its
// own anchor after hydrating: it shipped as a zero-height block, so a deep link
// to #community-episodes parked on whatever followed it. The section has a real
// height from first paint now, and the browser's own scroll is correct.
initHashRouting()
initHashSpy()
initStatWindows()
initBoostNoteActions()

// One art2 call here, for the hero. The community cards below carry the same
// data-art2 / data-art3 attributes and are wired through the same helper by
// episode-card-actions.js, per card, as they are on every other surface. The
// hero's chain is one link longer than the show page's — episode art, then the
// show's primary, then the show's second chance — which is what data-art3 is for.
initArt2('.show-art img[data-art2]', 'div', 'show-art-blank')

// ── Boosting this episode ────────────────────────────────────────────
//
/* MONEY PATH. This mirrors the resolve-then-open sequence in show-page.js and
 * feeds-podcasts.js rather than sharing code with either: the feed module is the
 * Episodes renderer and importing it eagerly here would defeat the lazy load
 * above, while refactoring it would touch the site's most sensitive function for
 * no behavioural gain. All three use the same `fromApiValue` /
 * `applyExternalOverrides` helpers, which is where the split logic actually
 * lives, and neither of them rewrites a leg.
 *
 * `itemGuid` is always sent, so this asks for the EPISODE's own value block.
 * /api/value falls back to the feed-level block server-side when an episode has
 * none of its own, which is what makes an episode of a boostable show boostable.
 */
async function resolveValue(target, itemGuid, { at = null, song = null } = {}) {
  if (!target) return null
  const qs = new URLSearchParams()
  if (target.guid) qs.set('podcastGuid', target.guid)
  if (target.feed) qs.set('feedUrl', target.feed)
  if (itemGuid) qs.set('guid', itemGuid)
  if (at != null) qs.set('at', String(at))
  if (song) qs.set('song', song)
  if (![...qs.keys()].length) return null

  let data = null
  try {
    const resp = await fetch(`${VALUE_API}?${qs}`, { headers: { Accept: 'application/json' } })
    // A server/config failure and "this episode has no value block" are
    // different outcomes and must not be conflated — otherwise an outage reads
    // as every episode being un-boostable.
    if (!resp.ok) return { error: true }
    data = await resp.json()
  } catch { return { error: true } }
  if (data && data.error) return { error: true }

  const parsed = fromApiValue(data)
  if (!parsed) return null

  const recipients = applyExternalOverrides(parsed.recipients)
  const totalWeight = recipients.reduce((a, r) => a + (r.splitWeight || 0), 0)
  if (!recipients.length || totalWeight <= 0) return null
  return { recipients, totalWeight, timeSplit: data?.timeSplit || null }
}

/* A SONG'S OWN BOOST (Reed, 2026-11-25). Each song row in the chapters list
 * and the player bar's now-playing line carry a Boost button for that song; it
 * pays the song as if boosted while it played, whether or not anything is
 * playing: the song's value block at its window's percentage, the show's at
 * the rest, one press. The hero's "Boost this Episode" pays the episode alone
 * and never looks at the player: a reader boosting the show for playing them
 * the music should not have to race the end of a track to do it.
 *
 * ⚠️ THE FEED HAS THE LAST WORD ON THE SONG AND ITS SHARE. The page knows the
 * song from /api/episode-songs (cached an hour, labels only); /api/value reads
 * the feed now and answers only with a window naming that same song
 * (`song=` + `at=` inside its window). A song the feed no longer places there
 * is refused with a message, never paid as whatever sits at that second now.
 *
 * Returns { bundle, song, ts } or { message } to show the reader. */
async function resolveSongBoost(s) {
  const start = Math.max(0, Number(s?.start) || 0)
  const duration = Math.max(0, Number(s?.duration) || 0)
  if (!s?.itemGuid || !s?.feedGuid || !(duration > 0)) return { message: 'This song can’t be boosted.' }
  // A second inside the window, clear of its first instant: the edge treats
  // position zero as nothing playing.
  const probe = Math.round((start + Math.min(1, duration / 2)) * 1000) / 1000
  const host = await resolveValue(EPISODE, EPISODE.itemGuid, { at: probe, song: s.itemGuid })
  if (!host) return { message: 'This episode has no value block to boost.' }
  if (host.error) return { message: 'Couldn’t load boost splits — please try again in a moment.' }
  const ws = host.timeSplit
  if (!ws || ws.itemGuid !== s.itemGuid) {
    return { message: 'The show’s feed no longer lists this song here. Reload the page and try again.' }
  }
  const songBundle = await resolveValue({ guid: ws.feedGuid, feed: ws.feedUrl || null }, ws.itemGuid)
  if (songBundle?.error) return { message: 'Couldn’t load this song’s splits — please try again in a moment.' }
  const combined = songBundle ? combineTimeSplit(host, songBundle, ws.pct) : null
  if (!combined) return { message: 'This song has no value block, so it can’t be boosted. You can still boost the episode.' }
  // The boostagram's `ts`: where the player is, if it is inside this song;
  // otherwise the song's start, the moment the boost stands for.
  const st = window.LBPlayer?.state?.()
  const inside = st?.started && st.itemGuid === EPISODE.itemGuid &&
    st.positionSec >= start && st.positionSec < start + duration
  const ts = Math.floor(inside ? st.positionSec : start)
  const song = {
    feedGuid: ws.feedGuid, itemGuid: ws.itemGuid, pct: ws.pct,
    title: s.title || '', artist: s.artist || '',
  }
  return { bundle: combined, song, ts }
}

async function boostSong(s) {
  try {
    const r = await resolveSongBoost(s)
    if (r.message) { showToast(r.message, true); return }
    await openBoost(r.bundle, {
      target: EPISODE,
      itemGuid: EPISODE.itemGuid,
      episodeTitle: EPISODE.episodeTitle,
      song: r.song, ts: r.ts,
    })
  } catch (err) {
    console.warn('[episode] song boost failed', err)
    showToast('Couldn’t start the boost — try again.', true)
  }
}

/* The Boost button for one song, the site's one boost pill (boost-button.js).
 * Shown to everyone: boosting needs a wallet, not an account. It resolves on
 * the press, not on load, since an episode can carry thirty songs. */
function songBoostNode(s) {
  if (!EPISODE || (!EPISODE.guid && !EPISODE.feed) || !s?.itemGuid || !s?.feedGuid) return null
  const label = s.title ? `${s.title}${s.artist ? ` by ${s.artist}` : ''}` : 'this song'
  return boostButton({ label, onClick: (btn) => withBoostBusy(btn, () => boostSong(s)) })
}

async function openBoost(bundle, { target, itemGuid, episodeTitle, song = null, ts = null }) {
  await ensureLoginWidget()
  if (!window.LBLogin?.openExternalBoost) {
    showToast('Boost is unavailable right now.', true)
    return
  }
  window.LBLogin.openExternalBoost({
    episode: {
      showTitle: target?.title || '',
      episodeTitle: episodeTitle || '',
      podcastGuid: target?.guid || '',
      itemGuid: itemGuid || '',
      // A link to this very page, and it comes from the shared builder rather
      // than from `location.href` — episode-link.js is the single owner of what
      // a boost note points at, and this page does not get its own opinion. The
      // two now agree, which is the point: an episode boosted from here
      // publishes the same note it would from the feed.
      //
      // This field was deliberately empty until that builder moved off Boost Me
      // Bitch, because a page passing its own URL while the feed passed BMB is
      // exactly the two-notes-for-one-episode bug the module was written to fix.
      bmbUrl: episodeBoostLink({
        itemGuid: itemGuid || '',
        title: episodeTitle || '',
        podcastGuid: target?.guid || null,
        // The page payload carries no Podcast Index numeric id, so the BMB
        // fallback — reached only by an untitled episode, which this page
        // cannot be, since a title is what qualifies it for a page — would
        // resolve through ?podcast=<guid>.
        feedId: null,
      }) || '',
      feedUrl: target?.feed || '',   // the boostagram's `url` (bLIP-10)
      // The song on when Boost was pressed, and the seconds into the episode.
      // Absent, the boost is the show's alone, exactly as before.
      ...(song ? { song } : {}),
      ...(ts != null ? { ts } : {}),
    },
    recipientsBundle: bundle,
  })
}

/* Reveal the hero's Boost button only once we know there is a payable block.
 *
 * One probe, on load: a page has exactly one boost button of its own, so there
 * is nothing to amortize, and a button that only ever reports failure is worse
 * than no button. A transient failure leaves it hidden rather than showing a
 * control that would fail on click; a reload retries.
 *
 * The community cards below take the opposite approach — they reveal
 * optimistically and resolve on click, because a page can carry a hundred of
 * them and probing each would be a hundred requests to Podcast Index on load.
 * That is the same split show-page.js makes.
 */
async function initBoosting() {
  const btn = document.querySelector('[data-episode-boost]')
  if (!btn || !EPISODE || (!EPISODE.guid && !EPISODE.feed)) return

  const probe = await resolveValue(EPISODE, EPISODE.itemGuid)
  if (!probe || probe.error) return

  btn.hidden = false
  btn.addEventListener('click', async () => {
    if (btn.disabled) return
    const prev = btn.textContent
    btn.disabled = true
    btn.textContent = 'Loading…'
    try {
      // The episode alone, whatever is playing (Reed, 2026-11-25). A song is
      // boosted from its own button; see resolveSongBoost.
      const bundle = await resolveValue(EPISODE, EPISODE.itemGuid)
      if (!bundle) { showToast('This episode has no value block to boost.', true); return }
      if (bundle.error) { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
      btn.textContent = 'Opening…'
      await openBoost(bundle, {
        target: EPISODE,
        itemGuid: EPISODE.itemGuid,
        episodeTitle: EPISODE.episodeTitle,
      })
    } catch (err) {
      console.warn('[episode] boost failed', err)
      showToast('Couldn’t start the boost — try again.', true)
    } finally {
      btn.disabled = false
      btn.textContent = prev
    }
  })
}

initBoosting()

// ── Chapters and full show notes ─────────────────────────────────────
//
/* One call to /api/episode-meta fills both drawers in the player card.
 *
 * CHAPTERS are the one piece of the hero that cannot be server-rendered at all:
 * nothing in D1 knows this episode's <podcast:chapters> URL, so the endpoint
 * resolves it through Podcast Index and fetches the file. The drawer ships
 * hidden and is revealed only once rows come back — about half the feeds in this
 * index publish chapters, and a feed that does may not on every episode, so an
 * empty lid is the failure to avoid.
 *
 * ⚠️ SHOW NOTES ARE REPLACED, NOT FILLED. The page server-renders D1's copy,
 * which Podcast Index truncated to 100 words when the collector fetched it
 * (median 590 characters, and 0.6% cut mid-sentence). This call asks for
 * `fulltext` and gets the whole thing back WITH ITS PARAGRAPHS, which the
 * collector's clean_html had also flattened. So the swap is not cosmetic: it is
 * the difference between a clipped block and the publisher's actual notes. The
 * server-rendered version stays as the no-JavaScript reading.
 *
 * No IntersectionObserver, unlike the community section below: this sits above
 * the fold, so there is nothing to wait for, and the payload is a few KB against
 * that section's ~200KB of card machinery.
 */
function fmtChapterTime(totalSecs) {
  const s = Math.max(0, Math.floor(totalSecs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  // The hour segment is dropped under an hour in, so a 40-minute episode reads
  // 12:30 rather than 0:12:30. Minutes are padded only when hours are shown.
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/* The notes drawer, repainted from the token tree the endpoint returns.
 *
 * ⚠️ TOKENS, NEVER HTML. Each paragraph is an array of { t: 'text' } and
 * { t: 'link' } tokens built server-side from a third-party description, and
 * they become text nodes and anchors through DOM calls. Nothing here touches
 * innerHTML, which is the whole reason the endpoint returns a tree rather than
 * the cleaned markup it could just as easily have sent.
 */
function paintNotes(notes) {
  const drawer = document.querySelector('[data-notes]')
  const body = drawer?.querySelector('[data-notes-body]')
  if (!drawer || !body || !Array.isArray(notes) || !notes.length) return

  const frag = document.createDocumentFragment()
  for (const para of notes) {
    if (!Array.isArray(para) || !para.length) continue
    const p = document.createElement('p')
    for (const tok of para) {
      const v = String(tok?.v ?? '')
      if (!v) continue
      if (tok.t === 'link' && /^https?:\/\//i.test(String(tok.href || ''))) {
        const a = document.createElement('a')
        a.href = tok.href
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = v
        p.appendChild(a)
      } else {
        p.appendChild(document.createTextNode(v))
      }
    }
    if (p.childNodes.length) frag.appendChild(p)
  }
  if (!frag.childNodes.length) return

  body.replaceChildren(frag)
  drawer.hidden = false
}

// ── The player, and the chapters and songs it plays ──────────────────
//
/* The page's <audio> becomes the player bar (player.js), which draws a tick
 * at each chapter and a stretch for each song. The drawer under it lists both
 * in ONE list, by start time, as two kinds of row:
 *
 *   a chapter   its time and title; a click seeks there
 *   a song      ♪, its title and artist on one line, and its heart, from the
 *               episode's <podcast:valueTimeSplit> windows (/api/episode-songs)
 *
 * ⚠️ A HEART RIDES A SONG ROW, NEVER A CHAPTER. A chapter is not mapped to a
 * window even when one looks like the other: on some shows they overlap and
 * "the window covering this chapter" names the wrong song (BMB's rule). The
 * heart is a sibling of the seek button, not a child, because a button inside
 * a button is invalid and the inner one would never receive its own click.
 * It is the site's ordinary episode heart for the song's own feed and item,
 * so favorites-ui.js reveals and paints it the way it does every other.
 */
const audioEl = document.querySelector('.ep-player-row .pcast-player')
const player = audioEl && EPISODE
  ? mountPlayer(audioEl, { itemGuid: EPISODE.itemGuid, duration: EPISODE.duration })
  : null

function songHeartNode(song) {
  if (!song?.feedGuid || !song?.itemGuid) return null
  const html = favoriteButtonHtml({
    kind: 'episode', guid: song.feedGuid, itemGuid: song.itemGuid,
    medium: 'music', label: song.title || 'this song',
  })
  if (!html) return null
  const t = document.createElement('template')
  t.innerHTML = html
  return t.content.firstElementChild
}

function rowButton(secs, titleText, subText) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'ep-chapter-btn'
  const time = document.createElement('span')
  time.className = 'ep-chapter-time'
  time.textContent = fmtChapterTime(secs)
  const title = document.createElement('span')
  title.className = 'ep-chapter-title'
  // textContent throughout: every title here is a publisher's string from a
  // third-party file, so none of it touches innerHTML.
  title.textContent = titleText
  // A song's artist rides the same line as its title: "♪ Song - Artist".
  if (subText) {
    const sub = document.createElement('span')
    sub.className = 'ep-chapter-sub'
    sub.textContent = ' - ' + subText
    title.appendChild(sub)
  }
  btn.append(time, title)
  btn.addEventListener('click', () => player?.seek(secs))
  return btn
}

function paintContents(chapters, songs) {
  const drawer = document.querySelector('[data-chapters]')
  const list = drawer?.querySelector('[data-chapters-list]')
  const chs = Array.isArray(chapters) ? chapters : []
  const sgs = Array.isArray(songs) ? songs.filter((s) => Number(s.duration) > 0) : []
  if (player) {
    player.setChapters(chs)
    player.setSongs(sgs, { heart: songHeartNode, boost: songBoostNode })
  }
  // Nothing to show is the ordinary outcome, not a failure: the drawer stays
  // hidden and the page is the page it was before.
  if (!drawer || !list || !player || (!chs.length && !sgs.length)) return

  // A chapter that starts with a song is that song named twice; the song row
  // stays (it carries the heart) and the chapter goes. See player.js.
  const rows = [
    ...chaptersBesideSongs(chs, sgs).map((c) => ({ kind: 'chapter', start: Math.max(0, Math.floor(Number(c.start) || 0)), c })),
    ...sgs.map((s) => ({ kind: 'song', start: Math.max(0, Math.floor(Number(s.start) || 0)), s })),
  ].sort((a, b) => a.start - b.start || (a.kind === 'chapter' ? -1 : 1))

  const chapterBtns = new Map(), songBtns = new Map()
  const frag = document.createDocumentFragment()
  for (const r of rows) {
    const li = document.createElement('li')
    if (r.kind === 'chapter') {
      li.className = 'ep-chapter'
      const btn = rowButton(r.start, String(r.c.title || ''), null)
      li.appendChild(btn)
      chapterBtns.set(r.c, btn)
    } else {
      li.className = 'ep-chapter ep-song'
      // The artist or nothing: an album title after the dash reads as the
      // artist's name ("Distant - Kiss Up - EP").
      const who = r.s.artist || ''
      const btn = rowButton(r.start, '♪ ' + (r.s.title || 'A song'), who)
      li.appendChild(btn)
      // The song's two verbs, beside its row: Favorite (signed in) and Boost.
      const verbs = document.createElement('span')
      verbs.className = 'ep-song-verbs'
      const heart = songHeartNode(r.s)
      if (heart) verbs.appendChild(heart)
      const boost = songBoostNode(r.s)
      if (boost) verbs.appendChild(boost)
      if (verbs.childNodes.length) li.appendChild(verbs)
      songBtns.set(r.s, btn)
    }
    frag.appendChild(li)
  }
  list.replaceChildren(frag)

  // The drawer is named for what it holds.
  const summary = drawer.querySelector('summary')
  const label = summary && [...summary.childNodes].find((n) => n.nodeType === 3)
  const keptChapters = chaptersBesideSongs(chs, sgs).length
  if (label) label.textContent = keptChapters && sgs.length ? 'Chapters and Songs' : sgs.length ? 'Songs' : 'Chapters'
  drawer.hidden = false

  // The rows covering the playhead, tracked as it advances: the chapter it is
  // in and the song it is in, which can both be lit at once.
  let lit = []
  player.subscribe((st) => {
    for (const b of lit) { b.classList.remove('is-active'); b.removeAttribute('aria-current') }
    lit = []
    const c = st.chapter && chs.find((x) => Math.floor(Number(x.start) || 0) === Math.floor(st.chapter.start) && String(x.title || '') === st.chapter.title)
    const cb = c && chapterBtns.get(c)
    const sb = st.song && songBtns.get(st.song)
    for (const b of [cb, sb]) if (b) { b.classList.add('is-active'); b.setAttribute('aria-current', 'true'); lit.push(b) }
  })
}

async function initEpisodeMeta() {
  // The notes drawer is on every page; the chapters one only where there is
  // audio to seek. Either is reason enough to make the call.
  if (!EPISODE?.itemGuid) return
  if (!document.querySelector('[data-notes]') && !document.querySelector('[data-chapters]')) return

  const qs = new URLSearchParams({ guid: EPISODE.itemGuid })
  if (EPISODE.guid) qs.set('podcastGuid', EPISODE.guid)
  if (EPISODE.feed) qs.set('feedUrl', EPISODE.feed)

  const getJson = async (url) => {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } })
      return resp.ok ? await resp.json() : null
    } catch { return null }
  }
  // The songs come from the show's own RSS rather than Podcast Index, so they
  // are a second call, made beside the first; either may fail alone.
  const songsQs = EPISODE.feed && player
    ? new URLSearchParams({ guid: EPISODE.itemGuid, feedUrl: EPISODE.feed })
    : null
  const [data, songs] = await Promise.all([
    getJson(`/api/episode-meta?${qs}`),
    songsQs ? getJson(`/api/episode-songs?${songsQs}`) : null,
  ])

  // `notes` absent means the lookup told us nothing, where an empty array would
  // mean the episode has none — and the difference matters, because the server
  // already rendered a truncated set that must not be blanked by a miss.
  if (data) paintNotes(data.notes)
  paintContents(data?.chapters, songs?.songs)
}

initEpisodeMeta()

// ── Other episodes this community boosts ─────────────────────────────
//
// The community is the set of pubkeys that boosted THIS episode; the section is
// every other episode those pubkeys have boosted, painted as the same cards the
// Episodes feed uses and carrying the same range and sort controls.
//
// ⚠️ IT IS SERVER-RENDERED. The Function fetches the corpus, ranks it and paints
// the first thirty cards, so everything below is verbs — see the note over
// renderCommunityEpisodes in functions/episode/[guid].js for why that was the
// change worth making, and episode-section.js for the behaviour, which is shared
// with the identical section on /booster/<npub>.
//
// EVERY FIGURE IS COMMUNITY-SCOPED BY CONSTRUCTION. The query joins through the
// community set, so a card's boosters, boosts and sats are what THESE people
// sent that episode and never its global totals — which is why the sort is
// tagged "Community Sort:" rather than "Sort:", the same wording the show page's
// equivalent uses.
//
// Measured over all 22,366 indexed boosts, the corpus behind this runs to a
// median of 248 boost rows across 189 distinct other episodes, a p90 of 1,171
// rows, and a maximum of 3,368. The query caps it at 2,000 and says when it did;
// the note under the last page passes that on rather than letting a ranking over
// a prefix pose as a ranking over everything.
initEpisodeSection({
  selector: '[data-community-episodes]',
  prefix: 'ce',
  // The Episodes feed's sorts, opening on Chart rank as it does — the chart
  // formula over THESE rows (Reed's ask, 2026-09-03; Most boosts until then).
  sorts: [
    ['chart', 'Overall'],
    ['sats', 'Most sats'],
    ['boosts', 'Most boosts'],
    ['count', 'Most boosters'],
    ['recent', 'Latest boost'],
    ['episode', 'Latest episode'],
  ],
  // "Latest boost" and "Latest episode" are chronological rather than ranked, so
  // no rank badge is painted under them — a numeral there would read as a score.
  rankedSorts: new Set(['chart', 'boosts', 'count', 'sats']),
  sortTag: 'Community Sort: ',
  sortTitle: 'Change how these episodes are ranked',
  fetchCorpus: async () => {
    const guid = document.body.dataset.episodeGuid
    const resp = await fetch(`/api/v1/episodes/${encodeURIComponent(guid)}?community=1`, {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) throw new Error(`community: HTTP ${resp.status}`)
    return (await resp.json())?.community?.boosts || []
  },
  truncatedNote:
    'Ranked over this community\u2019s 2,000 most recent boosts. They have sent more than that, so an episode boosted only long ago may be missing.',
  emptyTitle: 'Nothing in this window',
  emptyBody: 'Nothing this community boosted aired or was released in this time range \u2014 try a wider one.',
})

// ── Profile fallback ───────────────────────────────────
//
// Post-paint and best-effort: fills the community-wall cards, boost rows and
// mention chips the Function marked `data-missing` because the index had no
// kind-0 for them. See detail-page.js.
hydrateProfiles()

// ── This episode's boosts ────────────────────────────────────────────
//
// The one surface of the three where every boost is already on the page: the
// busiest episode in the index carries 55 against a cap of 500, so the sub-line
// promises all of them and the server renders all of them. What this adds is the
// range and the order, over the corpus the page already holds.
//
// ⚠️ "LATEST EPISODE" IS DROPPED FROM THE MENU. Every row here targets the same
// episode, so that sort would be a no-op that looked like a ranking. The same
// call /booster's episode rollup makes in leaving "Most boosters" out of its own.
initBoostSection({
  sorts: BOOST_SORTS.filter(([key]) => key !== 'episode'),
  fetchCorpus: async () => {
    const guid = document.body.dataset.episodeGuid
    if (!guid) throw new Error('corpus: no episode guid')
    // No ?corpus=1 here, unlike the other two pages: `boosts` on this endpoint
    // already IS every boost to this episode. ?names=1 is the only thing the
    // rebuild needs that the default response does not carry — the display names
    // behind the @Name chips inside the messages.
    const resp = await fetch(`/api/v1/episodes/${encodeURIComponent(guid)}?names=1`, {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) throw new Error(`corpus: HTTP ${resp.status}`)
    const body = await resp.json()
    return { boosts: body?.boosts || [], names: body?.names || {}, truncated: false }
  },
  sortTitle: 'Sort the boosts sent to this episode',
  emptyText: 'Nobody boosted this episode in this time range \u2014 try a wider one.',
})
