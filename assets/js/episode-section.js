/* A drawer of episode cards over one bounded corpus, on a detail page.
 *
 * TWO SECTIONS ARE THIS, and they were two near-identical implementations until
 * the card became one definition and the difference between them shrank to a
 * copy table:
 *
 *   /episode/<guid>  #community-episodes  every OTHER episode this episode's
 *                    boosters have boosted, opening on Most boosts
 *   /booster/<npub>  #episodes            everything one person has boosted,
 *                    opening on Most sats
 *
 * Same drawer, same controls, same scroll container, same load-more, same cards.
 * What differs is the corpus, the opening sort, the sort menu and three strings,
 * so those are parameters and the behaviour is here once.
 *
 * ⚠️ THE CARDS ARE ALREADY ON THE PAGE. Both sections are server-rendered by
 * their Pages Function, ranked and complete, with every boost note in the
 * document — see functions/_shared/episode-cards.js. This module does not paint
 * a first view and must never repaint one on load: it attaches the verbs, mounts
 * the two controls, and takes over only when the reader asks it to.
 *
 * ⚠️ AND THE CORPUS IS NOT FETCHED UNTIL THEN. It used to be pulled on approach,
 * unconditionally, at a median of ~75KB gzipped and up to ~600KB at the cap —
 * for a section most readers scroll past. Now the server's ranking answers the
 * opening view and the corpus is fetched on the first control change or the
 * first "Load more", which are both explicit gestures with a place to show a
 * loading state. A reader who reads the section and moves on never pays for it.
 *
 * ⚠️ RANKING IN THE BROWSER IS CORRECT HERE AND WRONG ON THE FEEDS, and the
 * distinction is the paging. These sections hold their WHOLE corpus in one
 * bounded response, so sorting it in memory sorts everything they have and a
 * re-sort costs no round trip. The homepage feeds hold a PREFIX of a much larger
 * corpus and must ask the server, which is why /api/v1/episodes exists. Both use
 * the same comparators, from episode-card.js, so the two cases share code
 * without sharing the mistake.
 */
import { competitionRanks, rankLabel } from '/assets/js/rank.js?v=ob-v94'
import { renderEpisodeCards, sortEpisodeItems, filterEpisodeItems, buildEpisodes, COPY, episodeRankValue }
  from '/assets/js/episode-card.js?v=ob-v94'
import { wireEpisodeCards, hydrateCardProfiles, prewarmBoosting }
  from '/assets/js/episode-card-actions.js?v=ob-v94'
import { normalizeBoosts, toEpisodeShape } from '/assets/js/ob-data.js?v=ob-v94'
import { rangeControl, sortControl, rangeDays, rangeCutoff } from '/assets/js/feed-controls.js?v=ob-v94'

const CARDS_PER_PAGE = 30   // matches CARDS_PER_PAGE in functions/_shared/episode-cards.js

/**
 * @param {object}   opts
 * @param {string}   opts.selector    the section's own data attribute selector
 * @param {string}   opts.prefix      the `data-<prefix>-*` slot prefix ('ce'|'be')
 * @param {Array}    opts.sorts       [key, label] pairs for the sort menu
 * @param {Set}      opts.rankedSorts which of them print a rank badge
 * @param {string}   opts.sortTag     'Sort: ' or 'Community Sort: '
 * @param {string}   opts.sortTitle   the sort control's tooltip
 * @param {Function} opts.fetchCorpus async () => boost records
 * @param {string}   opts.truncatedNote  printed under the last page when the
 *   corpus was capped, so a ranking over a prefix never poses as one over
 *   everything
 * @param {string}   opts.emptyTitle
 * @param {string}   opts.emptyBody
 */
export function initEpisodeSection({
  selector, prefix, sorts, rankedSorts, sortTag, sortTitle,
  fetchCorpus, truncatedNote, emptyTitle, emptyBody,
}) {
  const section = document.querySelector(selector)
  if (!section) return          // the server renders nothing when there is nothing

  const q = (name) => section.querySelector(`[data-${prefix}-${name}]`)
  const listSlot = q('list')
  const moreSlot = q('more')
  const ctrlSlot = q('controls')
  const scroll = q('scroll')
  if (!listSlot || !moreSlot || !ctrlSlot || !scroll) return

  const stateEl = listSlot.querySelector('[data-feed-state]')
  let state = {}
  try { state = JSON.parse(stateEl?.textContent || '{}') } catch {}
  stateEl?.remove()

  const cards = listSlot
  let sortKey = state.sort || sorts[0][0]
  let rangeKey = state.range || 'all'
  const truncated = !!state.truncated
  /* ⚠️ THE CARD VARIANT COMES FROM THE SERVER, NOT FROM THIS MODULE. Each
   * surface's Function declares which parts of the card it shows — /booster hides
   * the "Nostr Stats:" figures, both detail drawers hide the player — and it
   * travels in the state element so a repaint here cannot render a different card
   * than the edge did. Setting it in both places would be two declarations that
   * only agree until one is edited. */
  const parts = state.card || undefined

  /* What the server painted, and what the whole ranked view holds.
   *
   * `total` is why the load-more control can be correct before anything is
   * fetched: the server counted the view it ranked, so the button knows how many
   * are left and the count line can say "Showing 30 of 189" rather than guessing.
   */
  let painted = Number(state.count) || 0
  let total = Number(state.total) || painted

  // The corpus, once the reader asks for it. `items` stays null until then, and
  // `null` vs `[]` is load-bearing: empty means fetched-and-empty.
  let items = null
  let profiles = new Map()
  let view = []
  let corpusPromise = null

  // ── The verbs ──────────────────────────────────────────────────────
  // Attached as the section approaches, not on load: the cards are already
  // readable, and this is where the boost widget and (on a drawer open) the
  // reaction machinery come from. A deep link to the section lands inside the
  // margin and fires immediately.
  whenApproached(section, () => {
    enhance()
    mountControls()
    paintMore()
    prewarmBoosting()
  })

  function enhance() {
    wireEpisodeCards(cards)
    hydrateCardProfiles(cards)
  }

  // ── Controls ───────────────────────────────────────────────────────
  function mountControls() {
    ctrlSlot.append(
      rangeControl(rangeKey, (key) => { if (key !== rangeKey) { rangeKey = key; onControlChange() } }, {
        // The range filters on when the episode AIRED, not on when it was
        // boosted — the same axis the Episodes feed uses, and the reason the
        // tooltips are written per surface rather than inside feed-controls.js.
        // The wording is neutral because neither list is split on medium: a
        // music community also boosting podcasts is the interesting half of the
        // finding, so one list carries both and "aired or released" covers them.
        label: 'Filter by air or release date',
        titleFor: (key, label) => (rangeDays(key)
          ? `Aired or released in the last ${rangeDays(key)} days`
          : label),
      }),
      sortControl(sorts, sortKey, (key) => { if (key !== sortKey) { sortKey = key; onControlChange() } }, {
        tag: sortTag,
        title: sortTitle,
      }),
    )
    ctrlSlot.hidden = false
  }

  /* A control moved, so the whole list is rebuilt — which needs the corpus.
   *
   * The controls are disabled while it is in flight rather than left live: a
   * second press during the one fetch this section ever makes would queue a
   * rebuild against a corpus that had not arrived.
   */
  async function onControlChange() {
    ctrlSlot.setAttribute('aria-busy', 'true')
    try {
      await ensureCorpus()
    } finally {
      ctrlSlot.removeAttribute('aria-busy')
    }
    if (!items) return
    rebuild()
  }

  // ── The corpus ─────────────────────────────────────────────────────
  function ensureCorpus() {
    if (corpusPromise) return corpusPromise
    corpusPromise = (async () => {
      let records = null
      try { records = await fetchCorpus() } catch (err) {
        console.warn('[episode-section] corpus unavailable', err)
        return
      }
      const shaped = toEpisodeShape(normalizeBoosts({ boosts: records || [] }))
      profiles = shaped.profiles
      items = buildEpisodes(shaped)
    })()
    return corpusPromise
  }

  // ── Painting ───────────────────────────────────────────────────────

  /* ⚠️ COMPETITION RANKS, NOT POSITIONS. This section holds its subject's whole
   * corpus in memory and sorts it here, so `view` is the complete ordering and
   * needs no seed. Two episodes with the same booster count share a place
   * rather than being split by the sats tiebreak inside sortEpisodeItems. */
  function stampRanks() {
    const ranks = competitionRanks(view, episodeRankValue(sortKey))
    // No open end here and so no seam to re-sync: `view` IS the whole ordering,
    // which is what lets these sections mark every tie on the first paint.
    view.forEach((it, i) => { it._rank = ranks[i].rank; it._tied = ranks[i].tied })
  }

  function rankOf(it) {
    return rankedSorts.has(sortKey) ? rankLabel(it._rank, it._tied) : null
  }

  /* Rank first, filter second — the same ordering the feeds' search contract
   * depends on. There is no search here, but the range filter is the same
   * narrowing: rank over everything in the window, then paint. */
  function rebuild() {
    view = sortEpisodeItems(filterEpisodeItems(items, rangeCutoff(rangeKey)), sortKey)
    stampRanks()
    total = view.length
    painted = 0
    cards.textContent = ''
    moreSlot.textContent = ''
    if (!view.length) {
      const empty = document.createElement('div')
      empty.className = 'feed-placeholder'
      const strong = document.createElement('strong')
      strong.textContent = emptyTitle
      empty.append(strong, document.createTextNode(emptyBody))
      cards.appendChild(empty)
      return
    }
    // Back to the top of the window, not of the page. A re-sort or a range
    // change replaces the list under the reader; leaving the box scrolled
    // halfway down would land them in the middle of a ranking they just asked to
    // have rebuilt, with #1 out of sight above.
    scroll.scrollTop = 0
    paintNextPage()
  }

  /* Append the next page of cards.
   *
   * ⚠️ IT SKIPS WHAT IS ALREADY ON SCREEN, and that guard is not paranoia. On the
   * first "Load more" the cards in the DOM are the SERVER's, ranked over the
   * corpus as it stood when the page was rendered and cached for up to five
   * minutes; the corpus this just fetched is current. A boost landing in that
   * window can shift the top thirty, and appending blind would paint a card the
   * reader is already looking at. Comparing guids is exact and costs one Set.
   */
  function paintNextPage() {
    const already = new Set(
      Array.from(cards.querySelectorAll('[data-episode-card][data-guid]'))
        .map((el) => el.dataset.guid))
    const next = []
    let consumed = 0
    for (const it of view.slice(painted)) {
      consumed++
      if (already.has(it.guid)) continue
      next.push(it)
      if (next.length >= CARDS_PER_PAGE) break
    }
    // ⚠️ ADVANCE BY WHAT WAS CONSUMED, not by the page size. A skipped duplicate
    // still moves the cursor, so counting the page instead would re-walk those
    // entries on the next press and paint one of them twice.
    painted = Math.min(view.length, painted + consumed)
    if (next.length) {
      cards.insertAdjacentHTML('beforeend', renderEpisodeCards(next, { copy: COPY.other, profiles, rankOf, parts }))
      enhance()
    }
    paintMore()
  }

  function paintMore() {
    moreSlot.textContent = ''
    const remaining = total - painted
    if (remaining > 0) {
      const group = document.createElement('div')
      group.className = 'pcast-more-group'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'pcast-showmore'
      btn.textContent = `Load ${Math.min(CARDS_PER_PAGE, remaining)} more`
      btn.addEventListener('click', async () => {
        btn.disabled = true
        btn.textContent = 'Loading…'
        await ensureCorpus()
        if (!items) { btn.disabled = false; btn.textContent = 'Try again'; return }
        // First press: the corpus has only just arrived and there is no ranked
        // view yet. Build it without repainting what the server already showed.
        if (!view.length) {
          view = sortEpisodeItems(filterEpisodeItems(items, rangeCutoff(rangeKey)), sortKey)
          stampRanks()
          total = view.length
        }
        paintNextPage()
      })
      const count = document.createElement('div')
      count.className = 'pcast-more-count'
      count.textContent = `Showing ${painted} of ${total}`
      group.append(btn, count)
      moreSlot.appendChild(group)
      return
    }
    if (truncated && truncatedNote) {
      // Only at the end of the list, where it is an answer rather than a
      // warning: the ranking above is over a recent prefix of the history, not
      // the whole of it, and a reader who got this far is the one for whom that
      // distinction matters.
      const note = document.createElement('p')
      note.className = 'ce-note'
      note.textContent = truncatedNote
      moreSlot.appendChild(note)
    }
  }
}

/* Run `fn` when the section comes near the viewport, once.
 *
 * ⚠️ THE OLD VERSION OF THIS NOTE WARNED THAT THE OBSERVED ELEMENT MUST NOT BE
 * display:none, because the section used to hide itself and hydrate itself, and
 * an observer never reports a hidden target as intersecting. That constraint is
 * gone with the hydration: the section is server-rendered and visible, or it is
 * not rendered at all. What is deferred now is only the verbs.
 */
function whenApproached(el, fn) {
  if (typeof IntersectionObserver !== 'function') { fn(); return }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    io.disconnect()
    fn()
  }, { rootMargin: '800px 0px' })
  io.observe(el)
}
