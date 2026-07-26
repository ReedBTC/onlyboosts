/* Feed search — the typeahead that sits at the top of every feed panel.
 *
 * One box per feed, mounted into the panel's own [data-feed-search] slot,
 * which puts it *below* the sticky feed bar and inside the scrolling column:
 * the range/sort controls stay pinned, the search scrolls away with the cards
 * it filters.
 *
 * What it searches is the feed's own subject — episodes on Episodes, shows on
 * Shows, boosters on Boosts — and each renderer supplies its own index through
 * getEntries(). The box never fetches: it indexes the corpus the feed already
 * holds for the selected range, so a suggestion is always something the feed
 * can actually show you.
 *
 * ── It picks, it doesn't live-filter ─────────────────────────────────
 *
 * Typing shows the five best hits and nothing else moves. Choosing one is what
 * applies the filter, and the filter is always to exactly one subject. That's
 * the behaviour a ranked feed needs: the question is "where does this show
 * stand", and the answer is one card carrying its own rank badge, not a
 * shortlist whose positions would have to be renumbered.
 *
 * ── Rank retention is the caller's half of the contract ──────────────
 *
 * The module yields a key; the renderer decides what to do with it. Every
 * renderer here does the same thing in the same order, and the order is what
 * matters:
 *
 *   1. sort the full corpus for the selected range
 *   2. stamp each row with its 1-based position under that sort
 *   3. filter to the selected key
 *   4. paint, reading the stamped position
 *
 * Ranking before filtering is what makes a searched card say #47 instead of
 * #1. Reversing those two steps would renumber the survivor and quietly answer
 * a different question.
 */

const MAX_HITS = 5

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

function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

function norm(s) {
  return typeof s === 'string' ? s.toLowerCase().trim() : ''
}

// Drawn rather than typed: the obvious character for this is U+2315, which a
// good half of the system font stacks render as a box.
function searchIcon() {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'feed-search-icon')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '15')
  svg.setAttribute('height', '15')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const circle = document.createElementNS(NS, 'circle')
  circle.setAttribute('cx', '7')
  circle.setAttribute('cy', '7')
  circle.setAttribute('r', '4.5')
  const line = document.createElementNS(NS, 'line')
  line.setAttribute('x1', '10.5')
  line.setAttribute('y1', '10.5')
  line.setAttribute('x2', '14')
  line.setAttribute('y2', '14')
  svg.append(circle, line)
  return svg
}

// The first index where `q` starts a word inside `label`, or -1. A hit at 0 is
// a prefix match and is scored higher up the ladder, so it's excluded here.
function wordStart(label, q) {
  let i = label.indexOf(q)
  while (i > 0) {
    if (/[\s\-–—:,.'"“”‘’(\[/|]/.test(label[i - 1])) return i
    i = label.indexOf(q, i + 1)
  }
  return -1
}

/**
 * How well one entry answers a query. -1 is no match at all.
 *
 * A ladder rather than a fuzzy distance: the queries this box gets are the
 * opening words of a title or a name the user already knows, so where the
 * match lands is far more informative than how many characters it shares.
 * Every term has to appear somewhere (label or extra), which is what keeps a
 * two-word query from matching on one of its words.
 */
function scoreEntry(e, q, terms) {
  for (const t of terms) if (!e._hay.includes(t)) return -1
  const label = e._label
  if (label === q) return 1000
  if (label.startsWith(q)) return 900
  const ws = wordStart(label, q)
  if (ws > 0) return 800 - Math.min(ws, 60)
  const li = label.indexOf(q)
  if (li > 0) return 700 - Math.min(li, 60)
  // Matched only in the secondary field — the show behind an episode, or a
  // booster's npub. Worth finding, worth ranking below a title hit.
  const si = e._extra.indexOf(q)
  if (si === 0) return 600
  if (si > 0) return 550 - Math.min(si, 60)
  // Every term landed, just not contiguously ("joe rogan protocol").
  return 400
}

/**
 * Empty a panel's search slot and hide it again.
 *
 * Every renderer calls this before it does anything else, because a renderer
 * can run more than once against the same panel: the two Follows feeds
 * re-render on an account switch, and the new run may bail early on a
 * placeholder (signed out, empty follow list) without ever mounting a box. The
 * slot would otherwise keep the previous account's search sitting above a
 * "sign in" card, still holding a filter nothing is applying.
 */
export function resetFeedSearch(panel) {
  const host = panel?.querySelector('[data-feed-search]')
  if (!host) return
  host.replaceChildren()
  host.hidden = true
}

/**
 * Mount a feed's search box into its panel.
 *
 * @param {Element}  panel               the feed's <section class="feed-panel">
 * @param {object}   opts
 * @param {string}   opts.placeholder    input placeholder
 * @param {string}   opts.label          accessible name for the input
 * @param {Function} opts.getEntries     () => Array<{key, label, sub, img, extra}>, in
 *   the feed's current display order. `label` is shown and matched, `sub` is
 *   shown only, `extra` is matched only. Called lazily on the first keystroke
 *   after each refresh(), so it may be as expensive as one pass over the
 *   corpus. Order is the tie-break: equal scores resolve to the higher-ranked
 *   entry, which is why a bare "the" offers the biggest shows first.
 * @param {Function} opts.onPick         called with {key, label} or null
 * @returns {{refresh: Function, clear: Function, selection: object|null}|null}
 */
export function mountFeedSearch(panel, opts) {
  const host = panel?.querySelector('[data-feed-search]')
  if (!host) return null

  const uid = Math.random().toString(36).slice(2, 8)
  const menuId = `feed-search-menu-${uid}`

  let entries = null      // lazily built by getEntries(), dropped on refresh()
  let selection = null    // {key, label} once something is picked
  let hits = []           // what the menu is currently showing
  let active = -1         // keyboard cursor into hits

  const input = h('input', {
    class: 'feed-search-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    'aria-controls': menuId,
    'aria-label': opts.label || 'Search this feed',
    placeholder: opts.placeholder || 'Search',
  })

  const clearBtn = h('button', {
    class: 'feed-search-clear', type: 'button', hidden: 'hidden',
    'aria-label': 'Clear search',
  }, '×')

  const field = h('div', { class: 'feed-search-field' }, [
    searchIcon(),
    input,
    clearBtn,
  ])

  const menu = h('div', {
    class: 'feed-search-menu', id: menuId, role: 'listbox', hidden: 'hidden',
    'aria-label': opts.label || 'Search results',
  })

  const wrap = h('div', { class: 'feed-search-wrap' }, [field, menu])
  host.replaceChildren(wrap)
  host.hidden = false

  function ensureEntries() {
    if (!entries) {
      try {
        entries = opts.getEntries() || []
      } catch (e) {
        console.warn('[feed-search] index build failed', e)
        entries = []
      }
      // Precomputed once per index, not once per keystroke: the haystack is
      // what every term is tested against, so it carries both fields.
      // The two text fields are deliberately not the same one. `sub` is shown
      // and never matched; `extra` is matched and never shown. Matching what's
      // displayed sounds friendlier and isn't: the shows sub-line reads "506
      // boosts · 12k sats", which made every show in the index a weak hit for
      // "boost" and pushed the real ones out of a five-row menu.
      for (const e of entries) {
        e._label = norm(e.label)
        e._extra = norm(e.extra)
        e._hay = `${e._label} ${e._extra}`
      }
    }
    return entries
  }

  function search(raw) {
    const q = norm(raw)
    if (!q) return []
    const terms = q.split(/\s+/).filter(Boolean)
    const scored = []
    const all = ensureEntries()
    for (let i = 0; i < all.length; i++) {
      const s = scoreEntry(all[i], q, terms)
      if (s >= 0) scored.push([s, i, all[i]])
    }
    scored.sort((a, b) => b[0] - a[0] || a[1] - b[1])
    return scored.slice(0, MAX_HITS).map((row) => row[2])
  }

  function renderMenu() {
    menu.replaceChildren()
    if (!hits.length) {
      menu.appendChild(h('div', {
        class: 'feed-search-empty',
        text: `No matching ${opts.noun || 'result'} in this view.`,
      }))
      return
    }
    hits.forEach((e, i) => {
      const art = isSafeUrl(e.img)
        ? h('img', {
            class: 'feed-search-thumb', src: e.img, alt: '',
            loading: 'lazy', referrerpolicy: 'no-referrer',
          })
        : h('span', { class: 'feed-search-thumb feed-search-thumb--none', 'aria-hidden': 'true', text: opts.glyph || '🎙' })
      if (art.tagName === 'IMG') {
        art.onerror = () => {
          art.replaceWith(h('span', {
            class: 'feed-search-thumb feed-search-thumb--none',
            'aria-hidden': 'true', text: opts.glyph || '🎙',
          }))
        }
      }
      const item = h('button', {
        class: 'feed-search-item' + (i === active ? ' is-active' : ''),
        type: 'button', role: 'option', id: `${menuId}-${i}`,
        'aria-selected': i === active ? 'true' : 'false',
      }, [
        art,
        h('span', { class: 'feed-search-text' }, [
          h('span', { class: 'feed-search-label', text: e.label }),
          e.sub ? h('span', { class: 'feed-search-sub', text: e.sub }) : null,
        ]),
      ])
      // mousedown would blur the input before click lands, closing the menu
      // out from under the pointer.
      item.addEventListener('mousedown', (ev) => ev.preventDefault())
      item.addEventListener('click', () => pick(e))
      menu.appendChild(item)
    })
  }

  function open() {
    if (!menu.hidden) return
    menu.hidden = false
    input.setAttribute('aria-expanded', 'true')
    document.addEventListener('click', onDocClick, true)
  }

  function close() {
    if (menu.hidden) return
    menu.hidden = true
    active = -1
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    document.removeEventListener('click', onDocClick, true)
  }

  function onDocClick(e) {
    if (!wrap.contains(e.target)) close()
  }

  function setActive(i) {
    active = i
    menu.querySelectorAll('.feed-search-item').forEach((el, n) => {
      const on = n === active
      el.classList.toggle('is-active', on)
      el.setAttribute('aria-selected', on ? 'true' : 'false')
      if (on) {
        input.setAttribute('aria-activedescendant', el.id)
        el.scrollIntoView({ block: 'nearest' })
      }
    })
    if (active < 0) input.removeAttribute('aria-activedescendant')
  }

  function pick(e) {
    selection = { key: e.key, label: e.label }
    input.value = e.label
    clearBtn.hidden = false
    field.classList.add('is-filtered')
    close()
    opts.onPick?.(selection)
  }

  // Dropping the filter. `silent` is for the caller's own clear(), where the
  // renderer is already repainting and doesn't need telling twice.
  function clear({ silent = false, focus = false } = {}) {
    const had = !!selection
    selection = null
    input.value = ''
    clearBtn.hidden = true
    field.classList.remove('is-filtered')
    hits = []
    close()
    if (focus) input.focus()
    if (had && !silent) opts.onPick?.(null)
  }

  input.addEventListener('input', () => {
    // Editing the text means the box no longer describes the active filter,
    // so the filter goes with it and the feed repaints unfiltered underneath
    // the suggestions.
    if (selection) {
      selection = null
      field.classList.remove('is-filtered')
      opts.onPick?.(null)
    }
    clearBtn.hidden = !input.value
    hits = search(input.value)
    if (!input.value) { close(); return }
    active = hits.length ? 0 : -1
    renderMenu()
    open()
    setActive(active)
  })

  input.addEventListener('focus', () => {
    if (input.value && !selection && hits.length) { renderMenu(); open(); setActive(active) }
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (menu.hidden || !hits.length) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((active + step + hits.length) % hits.length)
      return
    }
    if (e.key === 'Enter') {
      if (menu.hidden || !hits.length) return
      e.preventDefault()
      pick(hits[active >= 0 ? active : 0])
      return
    }
    if (e.key === 'Escape') {
      if (!menu.hidden) { close(); return }
      if (selection || input.value) { e.preventDefault(); clear({ focus: true }) }
    }
  })

  clearBtn.addEventListener('click', () => clear({ focus: true }))

  return {
    /** Drop the cached index — the corpus behind it changed (range, page, account). */
    refresh() { entries = null; hits = [] },
    /** Drop the filter. Silent by default: the caller is already repainting. */
    clear(o = {}) { clear({ silent: true, ...o }) },
    get selection() { return selection },
  }
}
