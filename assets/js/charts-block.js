/* The chart boards on the Shows and Artists feeds: the week's Top 10 with the
 * week picker in its title, beside Weeks at #1 — the #40HPW pair's exact
 * arrangement, one feed over. Reed's ask, 2026-09-03: the three default feeds
 * (Shows, Artists, Members' boosts) each read chart, then search, then the
 * sortable feed, and the Charts page comes down once they do.
 *
 * The rows are assets/js/chart-board.js, the two-sided module the /charts
 * page and the card frames render with, so a board here and a screenshot of
 * it are one function. The data is /api/v1/charts/<kind>, the page's own
 * queries behind JSON. The picker is week-picker.js, the members' own. The
 * share button is hpw-share.js with the chart boards' overrides.
 *
 * ⚠️ IT NEVER THROWS AND IT NEVER BLOCKS THE FEED BELOW IT — the members
 * boards' discipline: a chart that cannot load leaves the block saying so and
 * costs the reader nothing else.
 *
 * One instance per kind; the two blocks (shows, artists) are separate roots
 * with separate state, which is why this is a factory and not module state.
 */
import { boardHtml, weekRowHtml, onesRowHtml, weekSpan, weekLabel, COPY } from '/assets/js/chart-board.js?v=ob-v184'
import { competitionRanks } from '/assets/js/rank.js?v=ob-v184'
import { weekDateString } from '/assets/js/pacific-week.js?v=ob-v184'
import { pickerHtml, wireWeekPicker, steppedWeek } from '/assets/js/week-picker.js?v=ob-v184'
import { mountShare } from '/assets/js/hpw-share.js?v=ob-v184'

const API = '/api/v1/charts'
const ROWS = 10
const SITE = 'https://onlyboosts.social'
const TAB_OF = { shows: '/#shows', artists: '/#artists' }
const PLACEHOLDER = 'Share your message about the OnlyBoosts Charts'

async function getJson(path, signal) {
  const resp = await fetch(path, { headers: { Accept: 'application/json' }, signal })
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`)
  return resp.json()
}

/* The share button's options for a chart board. The image is the collector's
 * card for that board; the link is the tab the board lives on, live or past
 * (Reed, 2026-09-03: the Charts page is coming down, so no link points at it;
 * the picture names the week). */
function shareOpts(kind, { key, title, isLive }) {
  const heading = COPY.sections[kind].heading
  return {
    key, title, isLive,
    image: `/api/og/charts/${key}.png`,
    link: `${SITE}${TAB_OF[kind]}`,
    alt: `OnlyBoosts Charts: ${heading}, ${title}`,
    tag: 'onlyboosts',
    filename: `onlyboosts-charts-${key}.png`,
    placeholder: PLACEHOLDER,
  }
}

/**
 * Fill one feed's chart block. Idempotent by a marker, because the feed can
 * be activated many times and this is one fetch pair. `root` is the
 * `[data-charts-block]` element; `kind` is 'shows' | 'artists'.
 */
export async function renderChartsBlock(root, kind) {
  if (!root || root.dataset.chartsState === 'done' || root.dataset.chartsState === 'loading') return
  const host = root.querySelector('[data-charts-boards]')
  if (!host || !TAB_OF[kind]) return
  root.dataset.chartsState = 'loading'
  host.innerHTML = '<p class="cb-empty">Loading the charts…</p>'

  /* ══ THE WEEK PICKER'S STATE ══ — the members board's four values, per
   * block. `live` and `first` come off the envelope, never off Date.now(). */
  let live = null, first = null, shown = null
  let seq = 0

  const weekBoardHtml = (ws, rows, isCurrent, empty) => boardHtml({
    board: `${kind}-week`,
    titleHtml: pickerHtml(ws, live, first),
    sub: isCurrent ? `In progress. ${weekSpan(ws)}.` : `${weekSpan(ws)}.`,
    rows: rows.map((r) => weekRowHtml(kind, r)),
    empty,
    colhead: true,
  })
  const onesBoardHtml = (rows) => {
    const ranks = competitionRanks(rows, (r) => Number(r.weeks))
    return boardHtml({
      board: `${kind}-ones`,
      title: 'Weeks at #1',
      sub: COPY.sections[kind].onesSub,
      // No weekHref: the row's week is the picker's jump button.
      rows: rows.map((r, i) => onesRowHtml(kind, r, ranks[i])),
      empty: COPY.emptyOnes,
    })
  }
  const shareWeek = () => {
    const el = host.querySelector(`[data-cb-board="${kind}-week"]`)
    if (!el || !shown) return
    const isLive = !live || shown >= live
    mountShare(el, shareOpts(kind, {
      key: `${kind}-${weekDateString(shown)}`,
      title: `Week of ${weekLabel(shown)}`,
      isLive,
    }))
  }

  /* ⚠️ THE TITLE IS REPAINTED BEFORE THE FETCH, NOT AFTER IT, and the
   * previous week's rows are not kept under the new title — members-board.js's
   * showWeek, for the same two reasons. */
  async function showWeek(ws, { scroll = false } = {}) {
    const mine = ++seq
    shown = ws
    const isCurrent = !live || ws >= live
    const paint = (html) => {
      const el = host.querySelector(`[data-cb-board="${kind}-week"]`)
      if (el) el.outerHTML = html
    }
    paint(weekBoardHtml(ws, [], isCurrent, 'Loading the chart…'))
    if (scroll) host.querySelector(`[data-cb-board="${kind}-week"]`)?.scrollIntoView({ block: 'nearest' })
    try {
      const qs = isCurrent ? '' : `?week=${weekDateString(ws)}`
      const data = await getJson(`${API}/${kind}${qs}`)
      if (mine !== seq) return
      // Render the week the SERVER resolved, never the one asked for.
      shown = data.week_start || ws
      if (data.current_week) live = data.current_week
      if (data.first_week) first = data.first_week
      const cur = data.is_current !== false
      paint(weekBoardHtml(shown, data.rows || [], cur, cur ? COPY.emptyLive : COPY.emptyPast))
      shareWeek()
    } catch (err) {
      if (mine !== seq) return
      console.warn(`[charts:${kind}] week failed`, err)
      paint(weekBoardHtml(shown, [], isCurrent, 'This week could not be loaded.'))
    }
  }

  try {
    const [week, ones] = await Promise.all([
      getJson(`${API}/${kind}`),
      // The companion is allowed to fail on its own; the Top 10 still paints.
      getJson(`${API}/${kind}/weeks-at-1`).catch((err) => { console.warn(`[charts:${kind}] weeks-at-1 failed`, err); return null }),
    ])
    live = week.current_week || week.week_start || null
    first = week.first_week ?? null
    shown = week.week_start || live
    const cur = week.is_current !== false
    host.innerHTML =
      weekBoardHtml(shown, week.rows || [], cur, cur ? COPY.emptyLive : COPY.emptyPast) +
      (ones
        ? onesBoardHtml(ones.rows || [])
        : `<section class="cb-board" data-cb-board="${kind}-ones"><h3 class="cb-head">Weeks at #1</h3><p class="cb-empty">This board is unavailable right now.</p></section>`)
    wireWeekPicker(root, {
      go: (ws, { jump } = {}) => showWeek(ws, { scroll: !!jump }),
      step: (dir) => { const to = steppedWeek(shown || live, dir, { live, first }); if (to) showWeek(to) },
    })
    shareWeek()
    if (ones) {
      const el = host.querySelector(`[data-cb-board="${kind}-ones"]`)
      if (el) mountShare(el, shareOpts(kind, { key: `${kind}-weeks-at-1`, title: 'Weeks at #1', isLive: false }))
    }
    root.dataset.chartsState = 'done'
  } catch (err) {
    console.warn(`[charts:${kind}] boards failed`, err)
    host.innerHTML = '<p class="cb-empty">The charts are unavailable right now.</p>'
    // Not 'done': approaching the feed again retries.
    root.dataset.chartsState = ''
  }
}
