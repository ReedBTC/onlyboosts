/* Range and sort on the #boosts section, on all three detail pages.
 *
 * THREE SECTIONS ARE THIS, and they were already one component before they had
 * any controls — assets/js/boost-list.js renders the list at the edge on all
 * three. What differs is the corpus, the sort menu and two strings, so those are
 * parameters and the behaviour is here once. Same arrangement, and the same
 * reasoning, as assets/js/episode-section.js:
 *
 *   /show/<guid>      #boosts   every boost sent to the show, across its whole
 *                               catalogue. Opens on the newest 24.
 *   /episode/<guid>   #boosts   every boost sent to one episode, all of them
 *                               server-rendered.
 *   /booster/<npub>   #boosts   every boost one person has sent. Opens on 24.
 *
 * The show page's is the one that changes character: a podcaster reads their
 * boosts off across every episode rather than one at a time, so with a range and
 * an order over the whole corpus that section stops being a sample of recent
 * activity and becomes the show's boost inbox.
 *
 * ⚠️ THE LIST IS ALREADY ON THE PAGE. Every row is server-rendered, complete,
 * with its message, its links and its mention chips in the document. This module
 * does not paint a first view and must never repaint one on load: it mounts the
 * two controls and takes over only when the reader asks it to.
 *
 * ⚠️ AND THE CORPUS IS NOT FETCHED UNTIL THEN — on the first control press or the
 * first "Load more", never on approach. A reader who reads the section and moves
 * on pays nothing for it, which matters most on exactly the page where the corpus
 * is largest.
 *
 * ⚠️ EVERY REPAINT RE-ATTACHES THE VERBS. These rows carry a full
 * reply / like / repost / zap bar, a ⋮ menu, and the Primal profile backfill
 * patching whatever the index could not fill. A rebuild that replaced the markup
 * and stopped there would produce a list of dead boost notes that looks correct.
 * See paintRows.
 */
import {
  boostRows, rowsFromRecords, sortBoostRows, filterBoostRows,
} from '/assets/js/boost-list.js?v=ob-v62'
import { rangeControl, sortControl, rangeDays, rangeCutoff } from '/assets/js/feed-controls.js?v=ob-v62'
import { wireBoostNotes } from '/assets/js/boost-note-actions.js?v=ob-v62'
import { hydrateProfiles } from '/assets/js/detail-page.js?v=ob-v62'

/* The sort menu, taken from boosts-feed.js#SORT_OPTIONS so the wording matches
 * the feed the reader was sent here from.
 *
 * Deliberately shorter than the Episodes rollup's: a card here is ONE boost, so
 * "most boosters" has nothing to count and there is no aggregate to rank. That
 * is also why no sort in this module paints a rank numeral.
 *
 * /episode passes a menu without `episode` — every row there targets the same
 * episode, so that sort would be a no-op that looked like a ranking. The same
 * call /booster's episode rollup makes in leaving "Most boosters" out of its
 * menu. */
export const BOOST_SORTS = [
  ['recent', 'Latest boost'],
  ['episode', 'Latest episode'],
  ['sats', 'Largest boost'],
]

/* ⚠️ THE RANGE TOOLTIPS ARE NOT A PARAMETER, and that is the point of them being
 * here. The Episodes feeds and the Boosts feed write their own because the range
 * means different things there — air date on one, boost time on the other. On all
 * three of these sections it means when the boost was SENT, so one wording serves
 * all three and there is no seam for a fourth reading to appear at. */
function rangeTitle(key, label) {
  const days = rangeDays(key)
  return days ? `Boosts sent in the last ${days} days` : label
}

/**
 * @param {object}   opts
 * @param {Function} opts.fetchCorpus  async () => { boosts, names, truncated } —
 *   boosts in the published record shape, names as a plain object
 * @param {Array}    [opts.sorts]      [key, label] pairs for the sort menu
 * @param {string}   [opts.sortTitle]  the sort control's tooltip
 * @param {string}   [opts.emptyText]  what an empty window says, per surface
 * @param {string}   [opts.truncatedNote] printed under the last row when the
 *   corpus was capped, so an order over a prefix never poses as one over
 *   everything
 */
export function initBoostSection({
  fetchCorpus,
  sorts = BOOST_SORTS,
  sortTitle = 'Sort boosts',
  emptyText = 'Nothing was boosted in this time range — try a wider one.',
  truncatedNote = '',
}) {
  const section = document.querySelector('[data-boost-section]')
  if (!section) return          // the server renders nothing when there is nothing

  const list = section.querySelector('[data-bs-list]')
  const moreSlot = section.querySelector('[data-bs-more]')
  if (!list || !moreSlot) return

  const stateEl = section.querySelector('[data-boost-state]')
  let state = {}
  try { state = JSON.parse(stateEl?.textContent || '{}') } catch {}
  stateEl?.remove()

  // The band is absent below boost-list.js#CONTROLS_MIN, which is a real state
  // rather than a missing element: the section still pages, it just cannot be
  // reordered. Everything below tolerates a null slot.
  const ctrlSlot = section.querySelector('[data-bs-controls]')

  /* ⚠️ THE ROW VARIANT COMES FROM THE SERVER, NOT FROM THIS MODULE. Which lines a
   * row prints differs per page — the episode chip is suppressed on /episode, the
   * booster link on /booster, the show name everywhere but /booster — and it
   * travels in the state element so a repaint here cannot render a different row
   * than the edge did. See the note at the emit site in boost-list.js. */
  const rowOpts = state.row || {}

  let sortKey = state.sort || sorts[0][0]
  let rangeKey = state.range || 'all'

  /* How many rows a page holds, declared by the Function.
   *
   * ⚠️ IT IS 24 ON TWO PAGES AND EVERY ROW ON THE THIRD, and that asymmetry is the
   * server's to declare. /episode server-renders all of its boosts under a
   * sub-line promising exactly that, so a re-sort there must not silently cut the
   * list to 24 and grow a "Load more" the page never had. */
  const pageSize = Math.max(1, Number(state.page) || 24)

  // What the server painted, and what the whole view holds. `total` is why the
  // load-more control is correct before anything is fetched.
  let painted = Number(state.count) || 0
  let total = Number(state.total) || painted

  // The corpus, once the reader asks for it. `rows` stays null until then, and
  // `null` vs `[]` is load-bearing: empty means fetched-and-empty.
  let rows = null
  let names = new Map()
  let truncated = false
  let view = []
  let corpusPromise = null

  whenApproached(section, () => {
    mountControls()
    paintMore()
  })

  // ── Controls ───────────────────────────────────────────────────────
  function mountControls() {
    if (!ctrlSlot) return
    ctrlSlot.append(
      rangeControl(rangeKey, (key) => { if (key !== rangeKey) { rangeKey = key; onControlChange() } }, {
        label: 'Filter by when the boost was sent',
        titleFor: rangeTitle,
        // All four, where /#boosts-global offers three. That feed omits 1Y
        // because it WALKS month archives to cover a window — ~13,900 rows and
        // ~70 sequential requests at the network's ~38 boosts a day. This section
        // holds its whole corpus in one bounded response, so filtering it to a
        // year costs nothing.
      }),
      sortControl(sorts, sortKey, (key) => { if (key !== sortKey) { sortKey = key; onControlChange() } }, {
        title: sortTitle,
      }),
    )
    ctrlSlot.hidden = false
  }

  /* A control moved, so the whole list is rebuilt — which needs the corpus.
   *
   * The band is marked busy while the one fetch this section ever makes is in
   * flight rather than left live: a second press during it would queue a rebuild
   * against a corpus that had not arrived.
   */
  async function onControlChange() {
    ctrlSlot?.setAttribute('aria-busy', 'true')
    try {
      await ensureCorpus()
    } finally {
      ctrlSlot?.removeAttribute('aria-busy')
    }
    if (!rows) return
    rebuild()
  }

  // ── The corpus ─────────────────────────────────────────────────────
  function ensureCorpus() {
    if (corpusPromise) return corpusPromise
    corpusPromise = (async () => {
      let res = null
      try { res = await fetchCorpus() } catch (err) {
        // The section is complete without this. A failed fetch leaves the
        // server's rows exactly as they were and the control simply does not
        // act, which is the honest failure of the two.
        console.warn('[boost-section] corpus unavailable', err)
        corpusPromise = null
        return
      }
      rows = rowsFromRecords(res?.boosts)
      // Back to a Map: renderMessage does names.get(pk), and JSON has no Maps.
      names = new Map(Object.entries(res?.names || {}))
      truncated = !!res?.truncated
    })()
    return corpusPromise
  }

  // ── Painting ───────────────────────────────────────────────────────
  function buildView() {
    view = sortBoostRows(filterBoostRows(rows, rangeCutoff(rangeKey)), sortKey)
    total = view.length
  }

  function rebuild() {
    buildView()
    painted = 0
    list.textContent = ''
    moreSlot.textContent = ''
    if (!view.length) {
      const li = document.createElement('li')
      const p = document.createElement('p')
      p.className = 'show-empty'
      p.textContent = emptyText
      li.appendChild(p)
      list.appendChild(li)
      return
    }
    paintNextPage()
  }

  /* Append the next page of rows.
   *
   * ⚠️ IT SKIPS WHAT IS ALREADY ON SCREEN, and that guard is not paranoia. On the
   * first "Load more" the rows in the DOM are the SERVER's, rendered when the page
   * was and edge-cached for up to five minutes; the corpus just fetched is
   * current. A boost landing in that window shifts the newest 24, and appending
   * blind would paint a row the reader is already looking at. Comparing event ids
   * is exact and costs one Set.
   */
  function paintNextPage() {
    const already = new Set(
      Array.from(list.querySelectorAll('[data-boost-note][data-event-id]'))
        .map((el) => el.dataset.eventId))
    const next = []
    let consumed = 0
    for (const r of view.slice(painted)) {
      consumed++
      if (already.has(r.event_id)) continue
      next.push(r)
      if (next.length >= pageSize) break
    }
    // ⚠️ ADVANCE BY WHAT WAS CONSUMED, not by the page size. A skipped duplicate
    // still moves the cursor, so counting the page instead would re-walk those
    // entries on the next press and paint one of them twice.
    painted = Math.min(view.length, painted + consumed)
    if (next.length) paintRows(next)
    paintMore()
  }

  /* Rows into the list, then the verbs back onto them.
   *
   * ⚠️ THE SECOND HALF IS NOT OPTIONAL. A boost note is a card, a message, a
   * reaction bar, a ⋮ menu and — where the index had no name or face — a hook the
   * Primal backfill fills in. Only the first two come out of boost-list.js, so a
   * paint that stopped at insertAdjacentHTML would leave rows that read correctly
   * and do nothing: no reply, no like, no repost, no zap, and a truncated npub
   * where the row above it shows a name.
   *
   * Both calls are scoped to the list and both are safe to repeat.
   * wireBoostNotes skips a card that already carries a bar; hydrateProfiles works
   * off `data-missing`, which it clears as it goes.
   */
  function paintRows(batch) {
    list.insertAdjacentHTML('beforeend', boostRows(batch, names, rowOpts))
    wireBoostNotes(list)
    hydrateProfiles(list)
  }

  function paintMore() {
    moreSlot.textContent = ''
    const remaining = total - painted
    if (remaining > 0) {
      const group = document.createElement('div')
      group.className = 'bs-more-group'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'bs-more-btn'
      btn.textContent = `Load ${Math.min(pageSize, remaining)} more`
      btn.addEventListener('click', async () => {
        btn.disabled = true
        btn.textContent = 'Loading…'
        await ensureCorpus()
        if (!rows) { btn.disabled = false; btn.textContent = 'Try again'; return }
        // First press: the corpus has only just arrived and there is no view yet.
        // Build it without repainting what the server already showed.
        if (!view.length) buildView()
        paintNextPage()
      })
      const count = document.createElement('div')
      count.className = 'bs-more-count'
      count.textContent = `Showing ${painted} of ${total}`
      group.append(btn, count)
      moreSlot.appendChild(group)
      return
    }
    if (truncated && truncatedNote) {
      // Only at the end of the list, where it is an answer rather than a warning:
      // the order above is over a recent prefix of the history rather than the
      // whole of it, and a reader who got this far is the one for whom that
      // distinction matters.
      const note = document.createElement('p')
      note.className = 'bs-note'
      note.textContent = truncatedNote
      moreSlot.appendChild(note)
    }
  }
}

/* Run `fn` when the section comes near the viewport, once.
 *
 * The #boosts section is at the foot of all three pages, under the stats, the
 * rollups and the community wall, so most readers never reach it. Nothing here is
 * expensive on its own — the corpus is still behind a gesture — but a control
 * band and a load-more button on a section nobody scrolls to are two elements
 * built for nothing.
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
