/* The week picker's markup and its delegate, shared by every board that steps
 * through weeks: the 40 HPW This Week board (members-board.js) and, since
 * 2026-09-03, the Shows and Artists Top 10 boards on the homepage
 * (charts-block.js). One picker, one stepper shape, one delegate — a second
 * copy of pickerHtml is exactly the drift hpw-board.js was moved out to stop.
 *
 * Browser-only: the markup is buttons, and the delegate is the verb. The
 * markup half is pure (no DOM, no clock; the week rule is pacific-week.js's),
 * which is what lets scripts/test-hpw-cards.mjs render it.
 *
 * ⚠️ THE TITLE IS THE PICKER, RATHER THAN A CONTROL ROW ABOVE OR BELOW IT.
 * Reed's call, 2026-08-24. The board's header is what a scoreboard navigates by,
 * so the arrows flank the word they change and nothing new is added to a tab
 * that already carries a range, a sort, a lookup and a rules dialog.
 *
 * ⚠️ ARROWS ARE THE PRIMARY AND THE MENU IS THE JUMP, and the split is about
 * what people actually ask for. "Last week" is one press on a 44px target that
 * behaves identically under a mouse and a thumb; a month grid would make that
 * common case a page-flip, and its unit is a DAY where the board's unit is a
 * week, so every pick would silently snap somewhere the reader did not tap. The
 * menu exists for the jump a year back, which is why it is behind the label
 * rather than in front of it — and why the Proof of #40HPW rows and the Weeks
 * at #1 rows are wired as jumps too.
 *
 * The menu is deliberately the site's own `.pcast-sort-menu`: this is the same
 * kind of choice the feeds' Sort pill makes and a second menu shape for one
 * idea makes the site look like two sites. Its LENGTH IS DATA — 99 weeks today
 * and one more every Monday — so it scrolls, exactly as the language menu does
 * for the same reason.
 *
 * Both arrows render even when disabled. A control that vanishes at the end of
 * a range moves the two beside it, so the header reflows as the reader walks
 * back through the weeks.
 *
 * ⚠️ THE THREE PIECES ARE ONE BORDERED GROUP, AND THE FIRST VERSION WAS NOT.
 * Reed's call, 2026-08-24, on seeing it: the arrows were transparent until
 * hover and the label wore the title's type, so the control was invisible at
 * rest and a touch device never saw the hover state that would have revealed
 * it. The segmented stepper is in hpw-board.css — everything here builds is the
 * same markup it always was, which is the point of the chrome living in CSS.
 *
 * ⚠️ THE CARET SPAN IS DELIBERATELY EMPTY. It held `▾` (U+25BE) inside a
 * Playfair element, and Playfair carries no such glyph — so it was already
 * falling through to whatever face the platform substituted, at whatever size
 * that face draws it. It is two borders and a rotation now, sized in CSS, the
 * same call `.drawer-hint`'s chevron makes. Putting a character back in here
 * stacks a glyph on top of the drawn one.
 */
import { weekSeries, weekDateString, weekStartFromDate, prevWeek, nextWeek } from './pacific-week.js?v=ob-v189'
import { weekTitle } from './hpw-board.js?v=ob-v189'
import { htmlEscape as esc } from './nostr-text.js?v=ob-v189'

/* The stepper over a week: ‹ [This Week ▾] ›. `ws` is the week on screen,
 * `live` the live week, `first` the index's first week or null. */
export function pickerHtml(ws, live, first) {
  const atNewest = !live || ws >= live
  const atOldest = first != null && ws <= first
  const arrow = (dir, glyph, label, off) =>
    `<button type="button" class="hpw-arrow" data-hpw-step="${dir}"` +
    ` aria-label="${esc(label)}" title="${esc(label)}"${off ? ' disabled' : ''}>${glyph}</button>`
  /* No menu without `first`: that query is allowed to fail quietly, and a
     menu built from a guess would offer weeks before the index begins as though
     they were empty rather than absent. The arrows still work, so nothing the
     reader can do is lost. */
  const weeks = (first != null && live) ? weekSeries(first, live) : []
  const menu = weeks.length
    ? `<div class="pcast-sort-menu hpw-weeks" data-hpw-menu hidden role="listbox">` +
        weeks.map((w) =>
          `<button type="button" class="pcast-sort-item${w === ws ? ' is-active' : ''}" role="option"` +
          ` aria-selected="${w === ws}" data-hpw-goweek="${esc(weekDateString(w))}">` +
          `${esc(weekTitle(w, live))}</button>`).join('') +
      `</div>`
    : ''
  const label = esc(weekTitle(ws, live))
  const pick = weeks.length
    ? `<button type="button" class="hpw-pick" data-hpw-pick aria-haspopup="listbox" aria-expanded="false"` +
      ` title="Pick a week">${label}<span class="hpw-pick-caret" aria-hidden="true"></span></button>`
    : `<span class="hpw-pick hpw-pick--static">${label}</span>`
  return `<span class="hpw-nav" data-hpw-nav>` +
    arrow('prev', '‹', 'Previous week', atOldest) +
    `<span class="hpw-pick-wrap">${pick}${menu}</span>` +
    arrow('next', '›', 'Next week', atNewest) +
  `</span>`
}

/* The same stepper shape over a short list of BOARDS rather than weeks:
 * ‹ [Proof of #40HPW] ›, flipping between the Members tab's two all-time
 * boards (Reed's ask, 2026-09-03: "kind of like how you can toggle between
 * weeks"). Both arrows always work — two items wrap around — so the control
 * reads the same at either end. `data-hpw-flip` is its own attribute, so the
 * week delegate below never mistakes a flip for a step. */
export function flipHtml(labels, index, { group = 'stack' } = {}) {
  const arrow = (dir, glyph, label) =>
    `<button type="button" class="hpw-arrow" data-hpw-flip="${dir}" data-hpw-flip-group="${esc(group)}"` +
    ` aria-label="${esc(label)}" title="${esc(label)}">${glyph}</button>`
  return `<span class="hpw-nav" data-hpw-nav>` +
    arrow('prev', '‹', `Show ${labels[(index + labels.length - 1) % labels.length]}`) +
    `<span class="hpw-pick-wrap"><span class="hpw-pick hpw-pick--static">${esc(labels[index])}</span></span>` +
    arrow('next', '›', `Show ${labels[(index + 1) % labels.length]}`) +
  `</span>`
}

/* One delegated listener for a boards block, wired once. A board's markup is
 * replaced on every press, so a handler bound to an arrow would not survive
 * the press that used it; and the jump buttons live in the OTHER board, which
 * is repainted on its own schedule, so a single delegate is the only shape
 * that covers both without two wiring paths.
 *
 *   go(ws)     the reader picked a week (a menu row or a jump button)
 *   step(dir)  an arrow: 'prev' | 'next'
 *   flip(dir, group)  a board-stack arrow (flipHtml); optional
 */
export function wireWeekPicker(root, { go, step, flip = null }) {
  if (!root || root.dataset.pickWired) return
  root.dataset.pickWired = '1'
  const closeMenus = () => {
    for (const m of root.querySelectorAll('[data-hpw-menu]')) {
      m.hidden = true
      m.closest('.hpw-pick-wrap')?.querySelector('[data-hpw-pick]')?.setAttribute('aria-expanded', 'false')
    }
  }
  root.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-hpw-pick]')
    if (pick) {
      const menu = pick.closest('.hpw-pick-wrap')?.querySelector('[data-hpw-menu]')
      if (!menu) return
      const open = menu.hidden
      closeMenus()
      menu.hidden = !open
      pick.setAttribute('aria-expanded', String(open))
      /* Ninety-nine rows deep, the week on screen is usually well below the
         fold of its own menu. Opening on it rather than at the top is what
         makes the menu a jump rather than a scroll. */
      if (open) menu.querySelector('.is-active')?.scrollIntoView({ block: 'center' })
      return
    }
    const goEl = e.target.closest('[data-hpw-goweek]')
    if (goEl) {
      closeMenus()
      const ws = weekStartFromDate(goEl.dataset.hpwGoweek)
      if (ws) go(ws, { jump: !goEl.closest('[data-hpw-menu]') })
      return
    }
    const stepEl = e.target.closest('[data-hpw-step]')
    if (stepEl && !stepEl.disabled) {
      closeMenus()
      step(stepEl.dataset.hpwStep === 'prev' ? 'prev' : 'next')
      return
    }
    const flipEl = e.target.closest('[data-hpw-flip]')
    if (flipEl && flip) {
      closeMenus()
      flip(flipEl.dataset.hpwFlip === 'prev' ? 'prev' : 'next', flipEl.dataset.hpwFlipGroup)
    }
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.hpw-pick-wrap')) closeMenus()
  }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus() })
}

/* The arithmetic every stepping board shares: where one press lands, bounded
 * by the index's first week and the live week. Null when the press is off
 * the end (the arrow was disabled, or a race). */
export function steppedWeek(from, dir, { live, first }) {
  if (!from) return null
  const to = dir === 'prev' ? prevWeek(from) : nextWeek(from)
  if (first != null && to < first) return null
  if (live && to > live) return null
  return to
}
