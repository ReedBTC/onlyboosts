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
 *   - the verbs on "Other Episodes/Songs This Community Boosts"
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
import { showToast } from '/assets/js/copy-npub.js?v=ob-v118'
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js?v=ob-v118'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v118'
import { episodeBoostLink } from '/assets/js/episode-link.js?v=ob-v118'
import { initEpisodeSection } from '/assets/js/episode-section.js?v=ob-v118'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, hydrateProfiles,
} from '/assets/js/detail-page.js?v=ob-v118'
// The reaction bar and ⋮ on the server-rendered boost notes at the foot of
// this page. The community cards above them carry their own, through the feed
// renderer they are built by.
import { initBoostNoteActions } from '/assets/js/boost-note-actions.js?v=ob-v118'
import { initBoostSection, BOOST_SORTS } from '/assets/js/boost-section.js?v=ob-v118'

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
async function resolveValue(target, itemGuid) {
  if (!target) return null
  const qs = new URLSearchParams()
  if (target.guid) qs.set('podcastGuid', target.guid)
  if (target.feed) qs.set('feedUrl', target.feed)
  if (itemGuid) qs.set('guid', itemGuid)
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
  return { recipients, totalWeight }
}

async function openBoost(bundle, { target, itemGuid, episodeTitle }) {
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

/* Seek the player to a chapter and start it.
 *
 * The element is preload="none", so on a first click there is no duration yet
 * and assigning currentTime is silently dropped. play() is what triggers the
 * load, so the assignment is queued behind loadedmetadata and applied then. On
 * every later click readyState is already past that and it applies immediately.
 */
function seekTo(audio, secs) {
  const apply = () => { try { audio.currentTime = secs } catch { /* not seekable */ } }
  if (audio.readyState >= 1) apply()
  else audio.addEventListener('loadedmetadata', apply, { once: true })
  const p = audio.play()
  if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay policy */ })
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

function paintChapters(chapters) {
  const drawer = document.querySelector('[data-chapters]')
  const audio = document.querySelector('.ep-player-row .pcast-player')
  // Nothing to show is the ordinary outcome, not a failure: the drawer stays
  // hidden and the page is the page it was before.
  if (!drawer || !audio || !Array.isArray(chapters) || !chapters.length) return

  const list = drawer.querySelector('[data-chapters-list]')
  if (!list) return

  const starts = []
  const buttons = []
  const frag = document.createDocumentFragment()
  for (const c of chapters) {
    const secs = Math.max(0, Math.floor(Number(c.start) || 0))
    const li = document.createElement('li')
    li.className = 'ep-chapter'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ep-chapter-btn'
    const time = document.createElement('span')
    time.className = 'ep-chapter-time'
    time.textContent = fmtChapterTime(secs)
    const title = document.createElement('span')
    title.className = 'ep-chapter-title'
    // textContent throughout: a chapter title is a publisher's string arriving
    // from a third-party file, so it never touches innerHTML.
    title.textContent = String(c.title || '')
    btn.append(time, title)
    btn.addEventListener('click', () => seekTo(audio, secs))
    li.appendChild(btn)
    frag.appendChild(li)
    starts.push(secs)
    buttons.push(btn)
  }
  list.appendChild(frag)
  drawer.hidden = false

  // The row covering the playhead, tracked as it advances. The last chapter
  // whose start is at or behind the current time wins; the quarter-second
  // tolerance is so a click-seek lands on the chapter it came from rather than
  // the one before it.
  let active = -1
  const syncActive = () => {
    const t = audio.currentTime
    let idx = -1
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= t + 0.25) idx = i
      else break
    }
    if (idx === active) return
    if (active >= 0) {
      buttons[active].classList.remove('is-active')
      buttons[active].removeAttribute('aria-current')
    }
    active = idx
    if (idx >= 0) {
      buttons[idx].classList.add('is-active')
      buttons[idx].setAttribute('aria-current', 'true')
    }
  }
  audio.addEventListener('timeupdate', syncActive)
  audio.addEventListener('seeked', syncActive)
}

async function initEpisodeMeta() {
  // The notes drawer is on every page; the chapters one only where there is
  // audio to seek. Either is reason enough to make the call.
  if (!EPISODE?.itemGuid) return
  if (!document.querySelector('[data-notes]') && !document.querySelector('[data-chapters]')) return

  const qs = new URLSearchParams({ guid: EPISODE.itemGuid })
  if (EPISODE.guid) qs.set('podcastGuid', EPISODE.guid)
  if (EPISODE.feed) qs.set('feedUrl', EPISODE.feed)

  let data = null
  try {
    const resp = await fetch(`/api/episode-meta?${qs}`, { headers: { Accept: 'application/json' } })
    if (!resp.ok) return
    data = await resp.json()
  } catch { return }
  if (!data) return

  // `notes` absent means the lookup told us nothing, where an empty array would
  // mean the episode has none — and the difference matters, because the server
  // already rendered a truncated set that must not be blanked by a miss.
  paintNotes(data.notes)
  paintChapters(data.chapters)
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
  // The Episodes feed's five sorts, opening on the same "Most boosts" it does.
  sorts: [
    ['boosts', 'Most boosts'],
    ['count', 'Most boosters'],
    ['sats', 'Most sats'],
    ['recent', 'Latest boost'],
    ['episode', 'Latest episode'],
  ],
  // "Latest boost" and "Latest episode" are chronological rather than ranked, so
  // no rank badge is painted under them — a numeral there would read as a score.
  rankedSorts: new Set(['boosts', 'count', 'sats']),
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
