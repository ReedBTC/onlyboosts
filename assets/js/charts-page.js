/* /charts/<week>: the verbs. The boards and the arrow links are in the
 * document (functions/charts/[[path]].js rendered them); this upgrades the
 * static week label into the Members tab's own picker — the same segmented
 * stepper, the same .pcast-sort-menu — navigating to the picked week's page
 * rather than repainting in place, since here every week has a URL. Without
 * this module the label stays static and the arrows still step, which is the
 * no-JS page working as designed.
 *
 * The menu is built only when the server disclosed the index's first week
 * (data-charts-first) — the tab's own rule: a menu built from a guess would
 * offer weeks before the index begins as though they were empty rather than
 * absent. */
import { weekSeries, weekStartFromDate, weekDateString } from '/assets/js/pacific-week.js?v=ob-v186'
import { weekTitle } from '/assets/js/hpw-board.js?v=ob-v186'
import { htmlEscape as esc } from '/assets/js/nostr-text.js?v=ob-v186'

const page = document.querySelector('.charts-page')
const wrap = page?.querySelector('.hpw-pick-wrap')
const label = wrap?.querySelector('.hpw-pick--static')
const ws = weekStartFromDate(page?.dataset.chartsWeek || '')
const live = Number(page?.dataset.chartsLivews) || null
const first = Number(page?.dataset.chartsFirst) || null

if (page && wrap && label && ws != null && live && first != null) {
  const weeks = weekSeries(first, live)
  if (weeks.length) {
    const items = weeks.map((w) =>
      `<button type="button" class="pcast-sort-item${w === ws ? ' is-active' : ''}" role="option"` +
      ` aria-selected="${w === ws}" data-charts-goweek="${esc(weekDateString(w))}">` +
      `${esc(weekTitle(w, live))}</button>`).join('')
    /* The button keeps the label's own text — the page names the week by date
     * even when it is the live one, where the tab says "This Week"; a link is
     * read later, by somebody who was not there. The menu keeps the tab's
     * relative titles, because it is pressed now. */
    wrap.innerHTML =
      `<button type="button" class="hpw-pick" data-charts-pick aria-haspopup="listbox" aria-expanded="false"` +
      ` title="Pick a week">${esc(label.textContent)}<span class="hpw-pick-caret" aria-hidden="true"></span></button>` +
      `<div class="pcast-sort-menu hpw-weeks" data-charts-menu hidden role="listbox">${items}</div>`
    const pick = wrap.querySelector('[data-charts-pick]')
    const menu = wrap.querySelector('[data-charts-menu]')
    const close = () => { menu.hidden = true; pick.setAttribute('aria-expanded', 'false') }
    pick.addEventListener('click', () => {
      const open = menu.hidden
      menu.hidden = !open
      pick.setAttribute('aria-expanded', String(open))
      /* Deep menus open on the shown week, not at the top — the jump idiom. */
      if (open) menu.querySelector('.is-active')?.scrollIntoView({ block: 'center' })
    })
    menu.addEventListener('click', (e) => {
      const go = e.target.closest('[data-charts-goweek]')
      if (go) { close(); location.href = '/charts/' + go.dataset.chartsGoweek }
    })
    document.addEventListener('click', (e) => { if (!e.target.closest('.hpw-pick-wrap')) close() }, true)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  }
}
