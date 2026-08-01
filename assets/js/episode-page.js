/* Client hydration for /episode/<item-guid>.
 *
 * The page is server-rendered (functions/episode/[guid].js) and, with one stated
 * exception, readable with no JavaScript at all. This module adds:
 *
 *   - the shared detail-page chrome (back link, section deep-links, the hash
 *     spy, copy-npub, "Show N more", the art2 fallback, share, and the Primal
 *     profile backfill) — all of it in detail-page.js, shared with /show
 *   - the hero's Boost button, which pays THIS EPISODE's value block
 *   - the chapters drawer under the player, which the server cannot render
 *     because nothing in D1 holds a <podcast:chapters> URL
 *   - "Other Episodes/Songs This Community Boosts", the one section the server
 *     does not render
 *
 * THAT SECTION IS THE REASON THIS FILE IS NOT SMALL. Its rows are the full
 * Episodes-feed card — artwork, player, ⋮ subscribe menu, boost pill, and a
 * drawer of the individual boost notes with a reply / like / repost / zap bar on
 * each — so it is painted by feeds-podcasts.js#episodeCard rather than by a
 * second implementation that would drift from the homepage's. That module pulls
 * nostr-tools, the boost thread and the action bar behind it, roughly 200KB, so
 * it is DYNAMICALLY imported and only when the section is about to be read. A
 * visitor who never scrolls past the community wall pays none of it.
 */
import { showToast } from '/assets/js/copy-npub.js'
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'
import { rangeControl, sortControl, rangeDays } from '/assets/js/feed-controls.js'
import { normalizeBoosts, toEpisodeShape } from '/assets/js/ob-data.js'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, hydrateProfiles,
} from '/assets/js/detail-page.js'

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
const revealHashTarget = initHashRouting()
initHashSpy()

// One art2 surface here, not three: the hero. The community cards below build
// their own chain through cover-art.js inside episodeCard, the way the feed
// does, so they never carry a data-art2 attribute. The chain is one link longer
// than the show page's — episode art, then the show's primary, then the show's
// second chance — which is what data-art3 is for.
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
      // Deliberately empty rather than a link to this very page.
      //
      // assets/js/episode-link.js is the single owner of what a boost note
      // points at, and it still resolves to Boost Me Bitch on every surface. A
      // note published from here has to be identical to the same episode boosted
      // from the Episodes feed, so this page does not get to make its own
      // decision — flipping that target is one change in that one module, and
      // the note the feed publishes follows at the same moment. Until then,
      // passing this page's URL would give the same episode two different notes
      // depending on where it was boosted from, which is the exact bug that
      // module was written to fix.
      bmbUrl: '',
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

// ── Chapters ─────────────────────────────────────────────────────────
//
/* The drawer under the player, filled from /api/chapters.
 *
 * ⚠️ THIS IS THE ONE PIECE OF THE HERO THAT IS NOT SERVER-RENDERED, and the
 * reason is that nothing in D1 knows this episode's <podcast:chapters> URL. The
 * endpoint resolves it through Podcast Index and fetches the file; see the note
 * at the head of functions/api/chapters.js, including what would change if the
 * collector ever stored the URL.
 *
 * The drawer ships hidden and is revealed only once rows come back — about half
 * the feeds in this index publish chapters at all, and a feed that does may not
 * do so on every episode, so an empty lid is the common failure to avoid.
 *
 * No IntersectionObserver, unlike the community section below: this sits above
 * the fold, so there is nothing to wait for, and the payload is a few hundred
 * bytes against that section's ~200KB of card machinery.
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

async function initChapters() {
  const drawer = document.querySelector('[data-chapters]')
  const audio = document.querySelector('.ep-player-row .pcast-player')
  if (!drawer || !audio || !EPISODE?.itemGuid) return

  const qs = new URLSearchParams({ guid: EPISODE.itemGuid })
  if (EPISODE.guid) qs.set('podcastGuid', EPISODE.guid)
  if (EPISODE.feed) qs.set('feedUrl', EPISODE.feed)

  let chapters = []
  try {
    const resp = await fetch(`/api/chapters?${qs}`, { headers: { Accept: 'application/json' } })
    if (!resp.ok) return
    const data = await resp.json()
    chapters = Array.isArray(data?.chapters) ? data.chapters : []
  } catch { return }
  // Nothing to show is the ordinary outcome, not a failure: the drawer stays
  // hidden and the page is the page it was before.
  if (!chapters.length) return

  const list = drawer.querySelector('[data-chapters-list]')
  const count = drawer.querySelector('[data-chapters-count]')
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
  if (count) count.textContent = String(chapters.length)
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

initChapters()

// ── Other episodes this community boosts ─────────────────────────────
//
// The community is the set of pubkeys that boosted THIS episode; the section is
// every other episode those pubkeys have boosted, painted as the same cards the
// Episodes feed uses and carrying the same range and sort controls.
//
// EVERY FIGURE IS COMMUNITY-SCOPED BY CONSTRUCTION. The endpoint joins through
// the community set, so a card's boosters, boosts and sats are what THESE people
// sent that episode and never its global totals — which is why the sort is
// tagged "Community Sort:" rather than "Sort:", the same wording the show page's
// equivalent uses.
//
// Measured over all 22,366 indexed boosts, the corpus behind this runs to a
// median of 248 boost rows across 189 distinct other episodes, a p90 of 1,171
// rows, and a maximum of 3,368. The endpoint caps it at 2,000 and says when it
// did; the note under the list passes that on rather than letting a ranking over
// a prefix pose as a ranking over everything.

const CARDS_PER_PAGE = 30

// The Episodes feed's five sorts, with its own labels. "Latest boost" and
// "Latest episode" are chronological rather than ranked, so no rank badge is
// painted under them — a numeral there would read as a score.
const CE_SORTS = [
  ['boosts', 'Most boosts'],
  ['count', 'Most boosters'],
  ['sats', 'Most sats'],
  ['recent', 'Latest boost'],
  ['episode', 'Latest episode'],
]

/* The corpus, fetched once and lazily.
 *
 * IntersectionObserver with a generous margin rather than a fetch on load: this
 * section sits below the hero and the stat tiles, so most readers reach it a
 * scroll or two in, and between the response (~75KB gzipped at the median,
 * ~600KB at the cap) and the card renderer (~200KB of module) it is the most
 * expensive thing on the page. Starting it 800px out means it is normally in
 * flight before the reader arrives, and a reader who never scrolls that far
 * pays none of it.
 *
 * A deep link to #community-episodes lands inside the observer's margin and
 * fires it immediately, which is the case that would otherwise be worst.
 *
 * ⚠️ THE OBSERVED ELEMENT MUST NOT BE display:none. An observer never reports a
 * hidden target as intersecting, so a section that hid itself could never fire
 * its own hydration. The section therefore ships EMPTY (a zero-height block with
 * a real position, which is the sentinel this needs) and its body ships hidden.
 * See renderCommunityEpisodes in functions/episode/[guid].js.
 */
function whenApproached(el, run) {
  if (typeof IntersectionObserver !== 'function') { run(); return }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    io.disconnect()
    run()
  }, { rootMargin: '800px 0px' })
  io.observe(el)
}

async function fetchCommunity(guid) {
  const resp = await fetch(`/api/v1/episodes/${encodeURIComponent(guid)}?community=1`, {
    headers: { Accept: 'application/json' },
  })
  if (!resp.ok) throw new Error(`community: HTTP ${resp.status}`)
  return resp.json()
}

function initCommunityEpisodes() {
  const section = document.querySelector('[data-community-episodes]')
  const guid = document.body.dataset.episodeGuid
  if (!section || !guid) return

  const body = section.querySelector('[data-ce-body]')
  const scroll = section.querySelector('[data-ce-scroll]')
  const listSlot = section.querySelector('[data-ce-list]')
  const moreSlot = section.querySelector('[data-ce-more]')
  const ctrlSlot = section.querySelector('[data-ce-controls]')
  if (!body || !scroll || !listSlot || !moreSlot || !ctrlSlot) return

  /* The section is `hidden` from the server and stays that way unless there is
   * something to show. An empty heading over nothing is worse than no heading,
   * and this can legitimately be empty: an episode boosted by one person who has
   * boosted nothing else has no community overlap at all. A failed fetch takes
   * the same exit — the rest of the page is complete without this. */
  const giveUp = () => { section.remove() }

  whenApproached(section, async () => {
    // Revealed before the fetch, not after: the heading and its "Loading…" line
    // are the feedback that something is coming. On a failure the section is
    // removed outright, so the worst case is a heading that appears and goes
    // rather than one that sits over an error.
    body.hidden = false

    let data
    try {
      data = await fetchCommunity(guid)
    } catch (err) {
      console.warn('[episode] community episodes unavailable', err)
      giveUp()
      return
    }

    const rows = normalizeBoosts({ boosts: data?.community?.boosts || [] })
    if (!rows.length) { giveUp(); return }

    // Everything from here needs the card renderer, which is the heavy import.
    const feed = await import('/assets/js/feeds-podcasts.js')
    const shaped = toEpisodeShape(rows)
    feed.seedProfiles(shaped.profiles)
    const items = feed.buildEpisodes(shaped)
    if (!items.length) { giveUp(); return }

    // Names and avatars enrich the cards but must not gate first paint: render
    // with what the index embedded, repaint once the stragglers resolve, and
    // resolve message-mention profiles in the background for opened drawers.
    const profilesReady = feed.loadBoosterProfiles(items)
    feed.loadMentionProfiles(items)

    // Same defaults as Episodes · Global, which is the feed these cards come
    // from: raw boost volume is the ranking the list is for, over the whole
    // window rather than a recent slice.
    let sortKey = 'boosts'
    let rangeKey = 'all'
    let view = []
    let shown = 0

    const cards = document.createElement('div')
    cards.className = 'pcast-list'
    const moreWrap = document.createElement('div')
    moreWrap.className = 'pcast-more-wrap'

    function renderMore() {
      const next = view.slice(shown, shown + CARDS_PER_PAGE)
      for (const it of next) {
        // The rank was stamped in rebuild(), over the whole ranked list, so
        // numbering continues across pages rather than restarting at 1.
        const ranked = feed.RANKED_SORTS.has(sortKey) ? it._rank : null
        const el = feed.episodeCard(it, ranked, feed.COPY.other)
        el._pcastItem = it   // repaintProfiles maps avatars through this
        cards.appendChild(el)
      }
      shown += next.length
      moreWrap.textContent = ''
      const remaining = view.length - shown
      if (remaining > 0) {
        const batch = Math.min(CARDS_PER_PAGE, remaining)
        const group = document.createElement('div')
        group.className = 'pcast-more-group'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'pcast-showmore'
        btn.textContent = `Load ${batch} more`
        btn.addEventListener('click', renderMore)
        const count = document.createElement('div')
        count.className = 'pcast-more-count'
        count.textContent = `Showing ${shown} of ${view.length}`
        group.append(btn, count)
        moreWrap.appendChild(group)
      } else if (data?.community?.truncated) {
        // Only at the end of the list, where it is an answer rather than a
        // warning: the ranking above is over the community's most recent 2,000
        // boosts, not its whole history, and a reader who got this far is the
        // one for whom that distinction matters.
        const note = document.createElement('p')
        note.className = 'ce-note'
        note.textContent =
          'Ranked over this community’s 2,000 most recent boosts. They have sent more than that, so an episode boosted only long ago may be missing.'
        moreWrap.appendChild(note)
      }
    }

    // Rank first, filter second — the ordering the feeds' search contract
    // depends on. There is no search here, but the range filter is the same
    // narrowing: rank over everything in the window, then paint.
    function rebuild() {
      view = feed.sortItems(feed.filterItems(items, rangeKey), sortKey)
      view.forEach((it, i) => { it._rank = i + 1 })
      shown = 0
      cards.textContent = ''
      moreWrap.textContent = ''
      if (!view.length) {
        const empty = document.createElement('div')
        empty.className = 'feed-placeholder'
        const strong = document.createElement('strong')
        strong.textContent = 'Nothing in this window'
        empty.append(strong, document.createTextNode(
          'Nothing this community boosted aired or was released in this time range — try a wider one.'))
        cards.appendChild(empty)
        return
      }
      // Back to the top of the window, not of the page. A re-sort or a range
      // change replaces the list under the reader; leaving the box scrolled
      // halfway down would land them in the middle of a ranking they just asked
      // to have rebuilt, with #1 out of sight above.
      scroll.scrollTop = 0
      renderMore()
      feed.repaintProfiles(cards)
    }

    // The range filters on when an episode AIRED, not on when it was boosted —
    // the same axis the Episodes feed uses, and the reason the tooltips are
    // written per surface rather than inside feed-controls.js. The wording is
    // neutral because this list is deliberately NOT split on medium: a music
    // community also boosting podcasts is the interesting half of the finding,
    // so one list carries both and "aired or released" covers them.
    ctrlSlot.append(
      rangeControl(rangeKey, (key) => { if (key !== rangeKey) { rangeKey = key; rebuild() } }, {
        label: 'Filter by air or release date',
        titleFor: (key, label) => (rangeDays(key)
          ? `Aired or released in the last ${rangeDays(key)} days`
          : label),
      }),
      sortControl(CE_SORTS, sortKey, (key) => { if (key !== sortKey) { sortKey = key; rebuild() } }, {
        tag: 'Community Sort: ',
        title: 'Change how these episodes are ranked',
      }),
    )
    ctrlSlot.hidden = false

    listSlot.textContent = ''
    listSlot.appendChild(cards)
    moreSlot.appendChild(moreWrap)
    rebuild()

    // The section was an empty zero-height block when the browser resolved the
    // URL, so an anchor pointing at it parked on whatever followed. Now that it
    // has a height, put the reader where they asked to be.
    if (location.hash === '#community-episodes') {
      revealHashTarget()
      section.scrollIntoView()
    }

    profilesReady.then(() => feed.repaintProfiles(cards))

    // Wire the shared reply / repost / like / zap actions once the widget is up,
    // so the boost notes inside an opened drawer work and hydrate the reader's
    // existing likes and reposts. Deferred: nothing on screen needs it yet.
    setTimeout(async () => {
      try {
        // Already in the graph — feeds-podcasts.js imports it — so this resolves
        // from cache rather than fetching again.
        const actions = await import('/assets/js/boost-actions.js')
        await ensureLoginWidget()
        actions.configureBoostActions({})
      } catch { /* the cards still read; only the action bars stay inert */ }
    }, 1200)
  })
}

initCommunityEpisodes()

// ── Profile fallback ───────────────────────────────────
//
// Post-paint and best-effort: fills the community-wall cards, boost rows and
// mention chips the Function marked `data-missing` because the index had no
// kind-0 for them. See detail-page.js.
hydrateProfiles()
