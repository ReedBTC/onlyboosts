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
 * ── Enter submits the whole query (Reed's ask, 2026-08-27) ───────────
 *
 * Where the caller supplies `onSubmit`, the box has a second outcome: Enter
 * with no suggestion highlighted hands the QUERY to the feed, which becomes
 * the full scrollable result list rather than a five-row menu. Two changes
 * ride the flag, and both are what a submitting combobox does everywhere
 * else (a video site's search, a search engine's):
 *
 *   - suggestions are NOT auto-highlighted. Enter used to pick the top hit
 *     because the first row was pre-selected; with a submit action that same
 *     keystroke must mean "search for what I typed", so a suggestion is only
 *     picked once the reader has arrowed to it or clicked it.
 *   - the menu grows a footer row naming the submit ("See all results for
 *     …"), because a mouse-only reader would otherwise never learn Enter
 *     does anything.
 *
 * Without `onSubmit` nothing changes — the member lookup keeps the old
 * behaviour, where Enter takes the top suggestion, deliberately.
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
 *
 * ── Two backends, and which one a feed gets is not a preference ──────
 *
 * `getEntries` is the original: the feed hands over the corpus it is already
 * holding and the ladder below scores it in memory. That is right for a feed
 * whose window IS the corpus — Shows, Albums and Boosts all load theirs.
 *
 * `searchRemote` is for a feed that pages a ranked list off the server, where
 * the loaded pages are a prefix of the corpus rather than the whole of it. An
 * in-memory index there can only find what has already been scrolled past,
 * which is the failure the Episodes and Songs feeds had the moment their
 * ranking moved server-side. A feed supplies one or the other, never both.
 *
 * The remote path is debounced and every request is abortable, because it now
 * costs a round trip per keystroke where the local one costs 12ms for 200
 * queries over the 1,384-show index. Responses are sequence-guarded as well as
 * aborted: an aborted fetch is not guaranteed to lose the race, so a stale
 * answer has to be dropped on arrival rather than merely asked to stop.
 */

const MAX_HITS = 5

// Long enough that a burst of typing is one request, short enough that the menu
// still feels attached to the keyboard.
const REMOTE_DEBOUNCE_MS = 220

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
 * @param {Function} [opts.getEntries]   () => Array<{key, label, sub, img, extra}>, in
 *   the feed's current display order. `label` is shown and matched, `sub` is
 *   shown only, `extra` is matched only. Called lazily on the first keystroke
 *   after each refresh(), so it may be as expensive as one pass over the
 *   corpus. Order is the tie-break: equal scores resolve to the higher-ranked
 *   entry, which is why a bare "the" offers the biggest shows first.
 * @param {Function} [opts.searchRemote] async (query, {signal}) => Array<entry>,
 *   already ordered and already trimmed to what should be shown. The ladder is
 *   not applied to these: the server decided the ordering, and re-scoring it
 *   here would reorder a ranked answer by a different rule. Supply this OR
 *   getEntries.
 * @param {Function} [opts.minChars]     shortest query worth sending remotely
 * @param {Function} [opts.noMatchText]  () => string, the menu's no-hit line.
 *   A function rather than a string because what a miss MEANS depends on the
 *   feed's live range and scope.
 * @param {Function} opts.onPick         called with the picked entry, or null
 * @param {Function} [opts.onSubmit]     called with the trimmed query when the
 *   reader submits it whole (Enter with nothing highlighted, or the menu's
 *   footer row). Supplying it turns off suggestion auto-highlight — see the
 *   header. Clearing still arrives as onPick(null), one channel for "the box
 *   is empty again" whichever mode filled it.
 * @returns {{refresh: Function, clear: Function, selection: object|null}|null}
 */
export function mountFeedSearch(panel, opts) {
  const host = panel?.querySelector('[data-feed-search]')
  if (!host) return null

  const uid = Math.random().toString(36).slice(2, 8)
  const menuId = `feed-search-menu-${uid}`

  const remote = typeof opts.searchRemote === 'function'
  const submits = typeof opts.onSubmit === 'function'
  const minChars = Math.max(1, opts.minChars || 1)

  let entries = null      // lazily built by getEntries(), dropped on refresh()
  let selection = null    // the picked entry once something is picked
  let submitted = false   // a whole-query submit is the active filter
  let hits = []           // what the menu is currently showing
  let active = -1         // keyboard cursor into hits
  let state = 'ready'     // ready | short | loading | error — remote path only
  let timer = null        // debounce handle
  let inflight = null     // AbortController for the request in flight
  let seq = 0             // monotonic request id; a late reply below it is stale

  // With a submit action, nothing is pre-selected: Enter means "search for
  // what I typed" until the reader arrows into the menu. Without one, the top
  // hit is highlighted so Enter takes it — the original contract.
  const autoActive = (n) => (submits ? -1 : (n ? 0 : -1))

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

  function searchLocal(raw) {
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

  /* Stop the remote path where it stands: the pending debounce and the request
   * itself. Bumping `seq` is what actually retires an answer, since aborting a
   * fetch does not guarantee the promise loses the race. */
  function cancelRemote() {
    if (timer) { clearTimeout(timer); timer = null }
    if (inflight) { inflight.abort(); inflight = null }
    seq++
  }

  async function runRemote(raw) {
    const mine = ++seq
    const ctl = new AbortController()
    inflight = ctl
    try {
      const found = await opts.searchRemote(raw.trim(), { signal: ctl.signal })
      if (mine !== seq) return
      hits = (found || []).slice(0, MAX_HITS)
      state = 'ready'
    } catch (e) {
      if (mine !== seq || e?.name === 'AbortError') return
      console.warn('[feed-search] remote search failed', e)
      hits = []
      state = 'error'
    } finally {
      if (inflight === ctl) inflight = null
    }
    // The reader may have emptied the box or picked something while this was
    // out; either way the menu it would open no longer describes anything.
    if (!input.value || selection) return
    active = autoActive(hits.length)
    renderMenu()
    open()
    setActive(active)
  }

  function renderMenu() {
    menu.replaceChildren()
    if (!hits.length) {
      // A miss, a query too short to send, a request in flight and a failed one
      // all put a single line here, and they must not read alike: "no match" in
      // place of "still looking" is a wrong answer rather than a slow one.
      const line = state === 'loading' ? 'Searching…'
        : state === 'error' ? 'Search is unavailable right now.'
        : state === 'short' ? 'Keep typing to search.'
        : (opts.noMatchText?.() || `No matching ${opts.noun || 'result'} in this view.`)
      menu.appendChild(h('div', {
        class: 'feed-search-empty' + (state === 'loading' ? ' is-loading' : ''),
        text: line,
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
    appendSubmitRow()
  }

  /* The footer row that makes the submit discoverable by mouse. It is not one
   * of `hits`, so the arrow keys never land on it — Enter with nothing
   * highlighted IS this row's action, and it says so. */
  function appendSubmitRow() {
    if (!submits) return
    const q = input.value.trim()
    if (q.length < minChars) return
    const row = h('button', {
      class: 'feed-search-item feed-search-all', type: 'button',
    }, [
      h('span', { class: 'feed-search-text' }, [
        h('span', { class: 'feed-search-label', text: `See all results for “${q}”` }),
      ]),
    ])
    row.addEventListener('mousedown', (ev) => ev.preventDefault())
    row.addEventListener('click', () => submitQuery(q))
    menu.appendChild(row)
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

  // The WHOLE entry becomes the selection, not just its key and label. A remote
  // hit arrives carrying its record and the server's rank for it, and that is
  // the copy the renderer paints — re-deriving either from the loaded pages is
  // exactly what the remote path exists to stop it doing.
  function pick(e) {
    cancelRemote()
    selection = { ...e }
    submitted = false
    input.value = e.label
    clearBtn.hidden = false
    field.classList.add('is-filtered')
    close()
    opts.onPick?.(selection)
  }

  /* The whole-query submit. The input keeps what was typed — it IS the filter
   * now — and `hits` is dropped so a refocus cannot reopen a menu describing
   * the suggestions the reader just declined. */
  function submitQuery(q) {
    cancelRemote()
    selection = null
    submitted = true
    hits = []
    state = 'ready'
    clearBtn.hidden = false
    field.classList.add('is-filtered')
    close()
    opts.onSubmit?.(q)
  }

  // Dropping the filter — a pick or a submitted query alike. `silent` is for
  // the caller's own clear(), where the renderer is already repainting and
  // doesn't need telling twice.
  function clear({ silent = false, focus = false } = {}) {
    const had = !!selection || submitted
    cancelRemote()
    selection = null
    submitted = false
    input.value = ''
    clearBtn.hidden = true
    field.classList.remove('is-filtered')
    hits = []
    state = 'ready'
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
    /* A submitted query survives editing — retyping should not refetch the
     * unfiltered feed under the reader's cursor — but EMPTYING the box drops
     * it: at that point nothing on screen names the filter and the × has just
     * vanished with the text, so leaving it active would strand the reader in
     * results mode with no visible way out. */
    if (submitted && !input.value) {
      submitted = false
      field.classList.remove('is-filtered')
      opts.onPick?.(null)
    }
    clearBtn.hidden = !input.value

    if (!remote) {
      hits = searchLocal(input.value)
      if (!input.value) { close(); return }
      active = autoActive(hits.length)
      renderMenu()
      open()
      setActive(active)
      return
    }

    cancelRemote()
    if (!input.value) { hits = []; state = 'ready'; close(); return }
    const q = input.value.trim()
    if (q.length < minChars) {
      hits = []
      state = 'short'
    } else {
      // The previous hits stay up under the new request rather than blanking to
      // a spinner on every keystroke — the loading line only shows when there is
      // nothing yet to leave in place.
      state = 'loading'
      timer = setTimeout(() => { timer = null; runRemote(q) }, REMOTE_DEBOUNCE_MS)
    }
    active = autoActive(hits.length)
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
      if (submits) {
        // A suggestion the reader has arrowed to wins; otherwise the typed
        // query is the ask, whether or not the menu happens to be open.
        if (!menu.hidden && hits.length && active >= 0) { e.preventDefault(); pick(hits[active]); return }
        e.preventDefault()
        const q = input.value.trim()
        if (q.length >= minChars) submitQuery(q)
        return
      }
      if (menu.hidden || !hits.length) return
      e.preventDefault()
      pick(hits[active >= 0 ? active : 0])
      return
    }
    if (e.key === 'Escape') {
      if (!menu.hidden) { close(); return }
      if (selection || submitted || input.value) { e.preventDefault(); clear({ focus: true }) }
    }
  })

  clearBtn.addEventListener('click', () => clear({ focus: true }))

  return {
    /* Drop the cached index — the corpus behind it changed (range, page,
     * account).
     *
     * ⚠️ A NO-OP ON THE REMOTE PATH, and deliberately. There is no index to
     * drop there, and cancelling in-flight work here would be a hang: every
     * rebuild() calls this, so a "load more" landing while someone is typing
     * would kill their request and nothing would reschedule it, leaving the menu
     * on "Searching…" for good. A suggestion fetched against the previous range
     * is self-correcting anyway — picking it re-queries under the current one
     * and says "Not in this range" if that is the truth.
     *
     * `hits` is only dropped while the menu is CLOSED. Clearing it under an open
     * menu leaves rows on screen that the arrow keys and Enter no longer know
     * about, since both read `hits`; closed, the only thing it feeds is the
     * focus handler's decision to reopen, which is exactly what should not
     * survive a corpus change. */
    refresh() { entries = null; if (menu.hidden) hits = [] },
    /** Drop the filter. Silent by default: the caller is already repainting. */
    clear(o = {}) { clear({ silent: true, ...o }) },
    get selection() { return selection },
  }
}
