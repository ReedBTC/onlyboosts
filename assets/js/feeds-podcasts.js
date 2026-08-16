/* Episodes and Songs — the per-episode rollup behind two of the feed bar's five
 * what-options.
 *
 * The file and its `renderPodcasts` export keep the old name on purpose: the
 * feed the UI calls Episodes was called Podcasts until Shows arrived and made
 * that ambiguous. The user-facing name, the feed key and the URL hash all
 * renamed; a module filename is not a URL, and renaming it would only cost the
 * git history that follows it. The two stay a matched pair, so this is not a
 * half-rename — see the naming note in CLAUDE.md.
 *
 * ⚠️ THE CARD IS NOT HERE ANY MORE. `episodeCard` lived in this file and existed
 * only as JavaScript, which is why the two sections built from it — the
 * community rollup on /episode/<guid> and the episode list on /booster/<npub> —
 * did not render without it, and why the homepage's front door was an empty
 * shell for a crawler. It is `assets/js/episode-card.js` now: an HTML-string
 * builder with no DOM, imported by this module AND by the Pages Functions that
 * render those three surfaces at the edge. What remains here is the FEED — the
 * corpus, the paging, the range and sort, the search, and the placeholders — all
 * of which is this view's and none of which is the card's.
 *
 * So this module's job is narrow now: fetch a page of ranked episodes, hand the
 * items to the shared renderer, and let episode-card-actions.js attach the verbs
 * to whatever came back.
 *
 * ⚠️ THAT DID NOT MAKE THE HOMEPAGE'S MODULE GRAPH SMALLER, and it is worth
 * knowing why before anyone claims it did. This file dropped its static imports
 * of boosts-thread.js, nostr-tools and boost-actions.js — the tokenizer moved to
 * nostr-text.js and the reaction bar is a dynamic import inside the drawer — but
 * `follow-set.js` and `feeds.js` both still import the first two directly, so
 * they arrive on the homepage regardless. Measured before and after: 20 modules
 * at 124.5KB gzipped, against 23 at 136.8KB. The win here is one card definition
 * and a crawlable front door, not a lighter bundle.
 *
 * ⚠️ IT ALSO ADOPTS RATHER THAN REPLACES. Episodes · Global is server-rendered
 * into index.html by functions/index.js, so on the opening feed this module
 * finds thirty finished cards already on the page and wires them instead of
 * fetching the same rows again. See adoptServerCards below.
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
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v66'
import { toEpisodeShape, normalizeBoosts, episodeApiToBoosts } from '/assets/js/ob-data.js?v=ob-v66'
import {
  getEpisodePage, searchEpisodes, SEARCH_HITS, SEARCH_MIN_CHARS,
} from '/assets/js/ob-live.js?v=ob-v66'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v66'
import {
  rangeDays, rangeControl, sortControl, mountFeedControls,
} from '/assets/js/feed-controls.js?v=ob-v66'
// Its own module, not two more exports of feed-controls.js — see the ⚠️ note
// at the top of that file for the four-hour window that shape opens.
import { mountFeedNote, resetFeedNote } from '/assets/js/feed-note.js?v=ob-v66'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v66'
// The card, and the card's verbs. One definition each, shared with the edge.
import {
  COPY, buildEpisodes, renderEpisodeCards, RANKED_SORTS, SORT_OPTIONS,
} from '/assets/js/episode-card.js?v=ob-v66'
import {
  wireEpisodeCards, hydrateCardProfiles, prewarmBoosting,
} from '/assets/js/episode-card-actions.js?v=ob-v66'

const INITIAL_CARDS = 30       // episodes rendered per "load more" batch

/* Re-exported because this module's name is the one three other files learned.
 *
 * COPY and buildEpisodes were defined here and moved into episode-card.js with
 * the card that reads them; RANKED_SORTS decides when a position is worth
 * printing and moved for the same reason. Every caller inside this repo now
 * imports them from their new home, so these exist for the one thing a rename
 * cannot reach: a reader following a note in CLAUDE.md or a stale bookmark into
 * this file. They cost nothing and can go whenever both are updated.
 */
export { COPY, buildEpisodes, RANKED_SORTS, SORT_OPTIONS }

// ── Tiny DOM helper, for the feed's own chrome ───────────────────────
// The CARD is a string now; this builds the placeholders and the load-more
// control around it, which are this view's and belong to no other surface.
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
 * with them — and then came BACK, in episode-card.js, for the three surfaces
 * that hold their whole corpus in one response and legitimately rank it in
 * memory. The distinction is the paging: a feed holds a PREFIX and must ask the
 * server; /episode's community rollup and /booster's episode list hold
 * everything they have and must not.
 *
 * THE MEDIUM SPLIT MOVED TOO. The endpoint takes the medium as a parameter, so a
 * ~103KB fetch and a guid→medium join both left the page.
 */

// One page of ranked episodes, adapted into the shape the card already reads.
//
// Nothing downstream knows the corpus changed: the endpoint returns each
// episode's notes inline in the collector's own record shape, so
// ob-data.js#episodeApiToBoosts hydrates the podcast/episode blocks back onto
// them and the existing normalizeBoosts → toEpisodeShape → buildEpisodes chain
// runs unmodified over them — the same chain the two edge renderers run.
async function loadEpisodePage({ medium, sort, range, offset, follows, q = null, limit, signal }) {
  const { records, nextOffset } = await getEpisodePage({
    medium: medium === 'music' ? 'music' : null,
    sort, range, offset, follows, q, limit, signal,
  })
  const { boosts, totals } = episodeApiToBoosts(records)
  const shaped = toEpisodeShape(normalizeBoosts({ boosts }))

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
  // Booster identities ride along in every record, so the cards paint with real
  // names and avatars with no profile round trip. The stragglers the collector
  // couldn't resolve are marked in the markup and filled post-paint from Primal.
  return { items, nextOffset, profiles: shaped.profiles }
}

// ── Entry point ──────────────────────────────────────────────────────
/**
 * @param {Element} opts.panel   the feed panel
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
  /* ⚠️ CARDS ON SCREEN THAT `items` DOES NOT DESCRIBE.
   *
   * The server-rendered opening page is HTML with no item objects behind it, and
   * building them would mean shipping the same rows twice — once as markup and
   * once as JSON — which is the cost the server render was supposed to remove.
   * It turns out nothing needs them: a rank is a position, a "load more" is a
   * request from an offset, and a search pick replaces the list outright. So the
   * count is all that is kept, `items` holds only what THIS module fetched, and
   * every rank is offset by it. Any requery drops it to zero, because a requery
   * replaces those cards. */
  let adoptedCount = 0
  // The search filter lives here rather than being read back off the module,
  // because resolving a pick is a FETCH: `picked` is the chosen suggestion,
  // `pickedItem` the card built for it, and the gap between them is a state the
  // feed has to paint rather than an instant array filter.
  let picked = null
  let pickedItem = null
  let pickLoading = false
  let pickSeq = 0
  // Every identity the feed has seen, merged across pages: the card reads names
  // and faces out of it for the booster rows, the drawer-bar stack and the
  // @mention chips inside a boost message.
  const profiles = new Map()
  // `let`, because adoption REUSES the container the server painted rather than
  // copying its markup into this one. Copying would mean serialising and
  // re-parsing the whole opening page — 1.1MB of it — to end up with the same
  // nodes, which is most of the work the server render exists to avoid.
  let cards = h('div', { class: 'pcast-list' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  function mergeProfiles(map) {
    for (const [pk, prof] of map) if (!profiles.has(pk)) profiles.set(pk, prof)
  }

  /* The opening page, already rendered.
   *
   * functions/index.js server-renders Episodes · Global into the static shell,
   * so on that one feed the cards are on the page before this module is even
   * fetched. Adopting them rather than fetching the same rows again is the whole
   * point of having rendered them: it saves a 431KB request and a full repaint,
   * and it means the first thing the reader sees is the last thing they see.
   *
   * The state element is the contract, and it is deliberately tiny — the sort
   * and range the server used (so the controls open on the right values), how
   * many cards it painted, and where the next page starts. It is REMOVED on
   * adoption so a re-render after an account switch takes the fetching path.
   */
  function adoptServerCards() {
    const stateEl = list.querySelector('[data-feed-state]')
    if (!stateEl) return null
    let state = null
    try { state = JSON.parse(stateEl.textContent || '{}') } catch { return null }
    const painted = list.querySelector('.pcast-list')
    if (!state || !painted || !painted.querySelector('[data-episode-card]')) return null
    // A mismatch means the shell was rendered for a different feed than the one
    // being hydrated, which should be impossible and must not paint the wrong
    // list if it ever is.
    if (state.scope !== scope || state.medium !== medium) return null
    stateEl.remove()
    return { state, painted }
  }

  const adopted = (scope === 'global' && !follows) ? adoptServerCards() : null

  if (adopted) {
    sortKey = adopted.state.sort || sortKey
    rangeKey = adopted.state.range || rangeKey
    adoptedCount = Number(adopted.state.count) || 0
    nextOffset = adopted.state.nextOffset ?? null
    // The container the server painted IS the one this module appends to, so a
    // "load more" adds to the list already on screen instead of starting a
    // second one beside it — and no node is rebuilt.
    cards = adopted.painted
    list.appendChild(moreWrap)
  } else {
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
    mergeProfiles(first.profiles)

    list.className = ''
    list.innerHTML = ''
    list.append(cards, moreWrap)
  }

  // There is a ranking, so say what it ranks over. Mounted here rather than at
  // the top of the function so it shares the search box's contract: a feed that
  // ends on "sign in" or a load failure never grows a line describing a list it
  // isn't showing.
  mountFeedNote(panel, follows ? copy.noteFollows : copy.noteGlobal)

  // Pre-warm the boost widget in the background once the feed is up, so the
  // first Boost click doesn't pay the cold-start cost (bundle load + session /
  // wallet restore). Deferred so it doesn't compete with first paint. The
  // reaction bars are NOT wired here any more — they arrive with the drawer that
  // holds them, which is where episode-card-actions.js attaches them.
  prewarmBoosting()

  /* Every card currently in `cards` gets its verbs, and every identity the index
   * couldn't fill gets one more chance.
   *
   * Called after each paint and each append, and safe to call on cards that are
   * already wired — wireEpisodeCards skips them by a marker attribute, which is
   * what lets the two paths share one line. The profile backfill is post-paint
   * and best-effort by contract: the cards are complete and readable without it.
   */
  function enhance() {
    wireEpisodeCards(cards)
    hydrateCardProfiles(cards)
  }

  function rankOf(it) {
    return (showRanks && RANKED_SORTS.has(sortKey)) ? it._rank : null
  }

  function cardsHtml(list_) {
    return renderEpisodeCards(list_, { copy, profiles, rankOf })
  }

  /* Paint the cards currently in `view`, and the control under them.
   *
   * ⚠️ THE RANK IS THE POSITION IN THE SERVER'S ORDER, stamped over `items`
   * before any search filter narrows it — so a searched episode keeps the
   * standing it has in the feed rather than being renumbered to #1. That is the
   * same contract the client-side ranking kept; only who computes the order
   * changed. Numbering continues across pages rather than restarting.
   */
  function paint() {
    if (!view.length) {
      // Three empty states, and conflating any two of them tells the reader
      // something false: still fetching, fetched and genuinely outside the
      // range, or no search at all and the window itself is empty.
      cards.innerHTML = ''
      moreWrap.innerHTML = ''
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
    cards.innerHTML = cardsHtml(view)
    paintMore()
    enhance()
  }

  /* Append the newest page rather than repainting the list.
   *
   * The endpoint returns pages in rank order from a fixed offset, so a later
   * page can never outrank a painted card and there is nothing to re-sort — the
   * note feed's situation is the opposite and is why IT repaints. Appending is
   * also what keeps an open drawer open and what makes adopting the
   * server-rendered page possible at all, since those cards have no item objects
   * a repaint could rebuild them from.
   */
  function appendPage(newItems) {
    cards.insertAdjacentHTML('beforeend', cardsHtml(newItems))
    paintMore()
    enhance()
  }

  function paintMore() {
    moreWrap.innerHTML = ''
    // "Load more" is a REQUEST, not a slice, so it reports what it is doing and
    // cannot be pressed twice. A search selection hides it: the list is one card,
    // and paging under it would be paging something the reader filtered away.
    if (nextOffset == null || picked) return
    const shown = adoptedCount + items.length
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
          mergeProfiles(next.profiles)
          const start = adoptedCount + items.length
          next.items.forEach((it, i) => { it._rank = start + i + 1 })
          items = items.concat(next.items)
          nextOffset = next.nextOffset
          appendPage(next.items)
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
      // No total to count against: the endpoint pages rather than reporting how
      // many episodes the whole range holds, so this says what is on screen and
      // nothing it cannot support.
      h('div', { class: 'pcast-more-count', text: `Showing ${shown}` }),
    ]))
  }

  /* Rank first, filter second — ranking the filtered list would tell a searched
   * episode it is #1 of 1, which answers a different question.
   *
   * ⚠️ THE TWO HALVES OF THAT COME FROM DIFFERENT PLACES, and the ordering
   * survives the move. An unfiltered page is numbered by position, because the
   * server returned it in rank order from offset 0. A searched card cannot be
   * numbered that way at all: it is one row out of a filtered query and its
   * standing is a fact about the whole index, so it carries the `rank` the
   * server computed and `pickedItem` is never renumbered here.
   */
  function rebuild() {
    if (!picked) items.forEach((it, i) => { it._rank = adoptedCount + i + 1 })
    search?.refresh()
    view = picked ? (pickedItem ? [pickedItem] : []) : items
    paint()
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
    // A pick paints one card in place of the list, so the server's cards are
    // gone the moment one resolves — and their count must stop offsetting ranks.
    adoptedCount = 0
    // Dropping the filter comes through here too (editing the box or pressing
    // ×), and it has to repaint: bumping pickSeq above has already retired any
    // resolve still in flight, so nothing else is going to.
    if (!picked) { pickedItem = null; pickLoading = false; await refetchUnfiltered(); return }
    pickLoading = true
    pickedItem = null
    rebuild()
    try {
      const page = await loadEpisodePage({
        medium, sort: sortKey, range: rangeKey, offset: 0, follows,
        q: picked.query, limit: SEARCH_HITS,
      })
      if (mine !== pickSeq) return
      mergeProfiles(page.profiles)
      pickedItem = page.items.find((it) => it.guid === picked.key) || null
    } catch (e) {
      if (mine !== pickSeq) return
      console.warn('[podcasts] search pick failed', e)
      showToast('Couldn’t open that search result — please try again.', true)
    } finally {
      if (mine === pickSeq) { pickLoading = false; rebuild() }
    }
  }

  /* Clearing a search has to reveal the full list again.
   *
   * On a feed that fetched its own first page `items` still holds it and this is
   * a repaint. On the ADOPTED feed it does not — those cards were the server's
   * and a pick replaced them — so the page has to be fetched once, which is the
   * one request adoption defers rather than avoids. It is paid by the reader who
   * searched and then cleared, which is the right person to charge for it.
   */
  async function refetchUnfiltered() {
    if (items.length) { rebuild(); return }
    try {
      const page = await loadEpisodePage({ medium, sort: sortKey, range: rangeKey, offset: 0, follows })
      mergeProfiles(page.profiles)
      items = page.items
      nextOffset = page.nextOffset
    } catch (e) {
      console.warn('[podcasts] reload failed', e)
      showToast('Couldn’t reload the feed — please try again.', true)
    }
    rebuild()
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
      mergeProfiles(page.profiles)
      items = page.items
      nextOffset = page.nextOffset
      // The answer arrived, so the server's opening page is about to be replaced
      // wholesale and stops offsetting anything.
      adoptedCount = 0
      rebuild()
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

  if (adopted) {
    // Nothing to paint — the cards are already on the page. They still need
    // their verbs, their late-arriving faces, and a load-more under them.
    search?.refresh()
    paintMore()
    enhance()
  } else {
    rebuild()
  }
}
