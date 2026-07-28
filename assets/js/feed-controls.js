/* Shared feed controls — the 1W/1M/All range buttons, the "Sort: X ▾"
 * dropdown, and the sticky bar both mount into.
 *
 * These started out inside feeds-podcasts.js, where the Episodes rollup was
 * the only view with a range filter. The Boosts note feed now carries the same
 * two controls, so the chrome lives here and each renderer supplies its own
 * options and semantics:
 *
 *   Episodes  range filters on when the episode AIRED, sorts include the
 *             per-episode aggregates (most boosters / boosts / sats)
 *   Boosts    range filters on when the BOOST was sent, and the only
 *             quantitative axis one boost has is its own size
 *
 * Mounting: the controls used to sit in each panel's own head. They now share
 * the sticky feed bar in index.html, which is outside the panels — so a group
 * is tagged with the feed that owns it and the bar shows only the active one.
 * That show/hide is CSS off body[data-active-feed], not JS: feeds hydrate once
 * and keep their controls forever, so a declarative rule is the only version
 * that can't leave a re-visited feed with someone else's controls (or none).
 */

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) {
    if (kid == null) continue
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid)
  }
  return el
}

// [key, label, days] — days null means unbounded. Order is display order, and
// defaultRange() in feeds-podcasts.js walks it narrowest-first, so keep it so.
export const RANGE_OPTIONS = [
  ['1w', '1W', 7],
  ['1m', '1M', 30],
  ['all', 'All', null],
]

/** Days in a range key, or null for the unbounded one. */
export function rangeDays(key) {
  const found = RANGE_OPTIONS.find((o) => o[0] === key)
  return found ? found[2] : null
}

/** The epoch-second cutoff for a range key, or null if it has none. */
export function rangeCutoff(key) {
  const days = rangeDays(key)
  return days ? Math.floor(Date.now() / 1000) - days * 86400 : null
}

/**
 * Borderless 1W/1M/All segmented control — the selected segment's faint tint
 * is the only chrome, which is what gives the group its shape.
 *
 * @param {string}   initialKey
 * @param {Function} onPick    called with the new range key
 * @param {object}   [opts]
 * @param {string}   [opts.label]    group label for screen readers
 * @param {Function} [opts.titleFor] (key, label) => tooltip; the range means
 *   different things per feed, so the wording is the caller's to own.
 */
export function rangeControl(initialKey, onPick, opts = {}) {
  const titleFor = opts.titleFor || ((key, label) => (
    rangeDays(key) ? `Last ${rangeDays(key)} days` : label
  ))
  const wrap = h('div', {
    class: 'pcast-range', role: 'group',
    'aria-label': opts.label || 'Filter by date',
  })
  const btns = RANGE_OPTIONS.map(([key, label]) =>
    h('button', {
      class: 'pcast-range-btn', type: 'button',
      title: titleFor(key, label),
      onclick: () => { setActive(key); onPick(key) },
    }, label))
  function setActive(key) {
    btns.forEach((el, i) => {
      const on = RANGE_OPTIONS[i][0] === key
      el.classList.toggle('is-active', on)
      el.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
  }
  setActive(initialKey)
  wrap.append(...btns)
  return wrap
}

/**
 * "Sort: X ▾" dropdown — matches the card ⋮ menus (outside-click / Escape to
 * close). Calls onPick(key) on selection.
 *
 * @param {Array<[string,string]>} options  [key, label] pairs, in menu order
 * @param {object} [opts]
 * @param {string} [opts.tag]  the label before the current value. Defaults to
 *   "Sort: "; the show page's community drawer overrides it to name what is
 *   being sorted, since it sits inside a drawer rather than in the feed bar
 *   where the surrounding chrome already says.
 */
export function sortControl(options, initialKey, onPick, opts = {}) {
  const labelFor = (k) => (options.find((o) => o[0] === k) || options[0])[1]
  const wrap = h('div', { class: 'pcast-sort' })
  const curEl = h('span', { class: 'pcast-sort-cur', text: labelFor(initialKey) })
  const btn = h('button', {
    class: 'pcast-sort-btn', type: 'button',
    'aria-haspopup': 'true', 'aria-expanded': 'false',
    title: opts.title || 'Change sort order',
  }, [
    h('span', { class: 'pcast-sort-tag', text: opts.tag || 'Sort: ' }),
    curEl,
    h('span', { class: 'pcast-sort-caret', 'aria-hidden': 'true', text: '▾' }),
  ])

  let activeKey = initialKey
  const items = options.map(([k, label]) =>
    h('button', {
      class: 'pcast-sort-item', type: 'button',
      onclick: () => { activeKey = k; curEl.textContent = label; close(); onPick(k) },
    }, label))
  const menu = h('div', { class: 'pcast-sort-menu', hidden: 'hidden' }, items)
  wrap.append(btn, menu)

  function refreshActive() {
    items.forEach((el, i) => el.classList.toggle('is-active', options[i][0] === activeKey))
  }
  function onDoc(e) { if (!wrap.contains(e.target)) close() }
  function onKey(e) { if (e.key === 'Escape') close() }
  function open() {
    refreshActive()
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true')
    document.addEventListener('click', onDoc, true); document.addEventListener('keydown', onKey)
  }
  function close() {
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', onDoc, true); document.removeEventListener('keydown', onKey)
  }
  btn.addEventListener('click', () => { menu.hidden ? open() : close() })
  return wrap
}

/**
 * Put a feed's controls in the sticky bar, tagged with the feed that owns
 * them. Replaces that feed's previous group if it had one (a Follows feed
 * re-renders on an account switch), and leaves every other feed's alone.
 *
 * @param {string}    feed      feed key, e.g. 'boosts-global'
 * @param {Element[]} children  controls, in display order
 */
export function mountFeedControls(feed, children) {
  const bar = document.querySelector('[data-feed-controls]')
  if (!bar) return null
  const prev = bar.querySelector(`[data-controls-for="${feed}"]`)
  if (prev) prev.remove()
  const wrap = h('div', { class: 'pcast-controls', 'data-controls-for': feed })
  for (const c of children) if (c) wrap.appendChild(c)
  bar.appendChild(wrap)
  return wrap
}
