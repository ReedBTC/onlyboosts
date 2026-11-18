import { useEffect, useId, useReducer, useRef, useState } from 'react'
import { gifGrid, GifApiError, normalise, searchable } from '../lib/gifGrid.js'
import { pickedGif } from '../lib/gif.js'

/**
 * The GIF picker of the boost modal (2026-11-12): a search over
 * gifs.nostr.build, laid over the modal's own card.
 *
 * The grid is nostr.build's own module (`lib/gifGrid.js`, vendored whole) and
 * this component is the feedback around it, written to that service's guide
 * (https://gifs.nostr.build/developers). The rules that are theirs, and that
 * a change here would break:
 *
 * - **No key and no header.** The request is a plain `fetch`; the site is
 *   known by its registered Origin. An origin that is not registered gets an
 *   answer the browser will not show the page, which lands here as "GIFs are
 *   unavailable right now": that, on a preview URL, is a registration to add
 *   at gifs.nostr.build, not a bug in this file.
 * - **"GIFs from nostr.build", linked, in the header.** A condition of use.
 * - **One request per search, never cancelled, sent after a pause in typing,**
 *   and none for a single Latin letter. A late answer is ignored (`seq`).
 * - **The scrolling element is the grid's `root`, held in state**, so the
 *   grid is made once the element exists and its observers measure the
 *   picker's own scroller rather than the window.
 * - **The field is not focused on a phone**: the keyboard would cover the
 *   grid the picker opened to show.
 * - **One pick per opening.**
 *
 * ⚠️ NOT A PORTAL, ON PURPOSE. It renders inside the modal's card, so it is
 * already inside `.lb-w` and under the modal's own stacking; the form beneath
 * stays mounted (the amount, the message and the mention map are state the
 * booster has typed) and the modal marks it `inert` while this is open.
 *
 * The search state is the example page's, kept in one mutable record with a
 * repaint after every change, so the field, the chips, the status line and the
 * grid cannot disagree: `want` is what was asked for, `onShow` what the grid
 * is showing.
 */
export const GIF_STARTERS = ['thank you', 'applause', 'fire', 'lol', 'mind blown', 'love', 'yes', 'gm']
const SKELETON_RATIOS = [1.3, 1, 1.78, 0.8, 1.5, 1, 1.2, 1.6]
const TYPING_PAUSE_MS = 300

export default function GifPicker({ onPick, onClose }) {
  const statusId = useId()
  const [, repaint] = useReducer((n) => n + 1, 0)
  const [text, setText] = useState('')
  const [scroller, setScroller] = useState(null)
  const boxRef = useRef(null)
  const fieldRef = useRef(null)
  const dialogRef = useRef(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const stRef = useRef(null)
  if (!stRef.current) {
    stRef.current = {
      grid: null, gone: false, picked: false, timer: 0, seq: 0,
      want: '', asked: '', onShow: '', count: 0,
      loading: false, pending: false, retrying: false,
      problem: '',   // '' | 'many' (429) | 'down'
    }
  }
  const st = stRef.current
  const paint = () => { if (!st.gone) repaint() }

  async function run(q, retry = false) {
    clearTimeout(st.timer)
    if (!st.grid) return
    st.pending = false
    st.retrying = retry
    st.want = normalise(q)
    if (!searchable(st.want)) {
      // Nothing is sent, and a search on its way no longer lands.
      st.seq++
      st.loading = false
      st.asked = st.onShow
      st.problem = ''
      st.grid.search(st.want)
      return paint()
    }
    // Already on its way: nothing to ask again.
    if (st.want === st.asked && st.loading) return paint()
    // Already on show: nothing is sent, and a search on its way is dropped.
    if (st.want === st.onShow && !st.problem) {
      st.seq++
      st.loading = false
      st.asked = st.onShow
      st.grid.search('')
      return paint()
    }
    const mine = ++st.seq
    st.asked = st.want
    st.loading = true
    st.problem = ''
    paint()
    try {
      const n = await st.grid.search(st.want)
      if (mine !== st.seq || n === undefined) return
      st.onShow = st.asked
      st.count = n
    } catch (e) {
      if (mine !== st.seq) return
      st.problem = e instanceof GifApiError && e.status === 429 ? 'many' : 'down'
      // The old results are not this search's answer.
      st.grid?.clear()
      st.onShow = ''
      st.count = 0
    }
    st.loading = false
    st.retrying = false
    paint()
  }

  useEffect(() => {
    if (!scroller || !boxRef.current) return undefined
    st.gone = false
    let grid
    try {
      grid = gifGrid(boxRef.current, {
        root: scroller,
        maxColumns: 3,
        onPick: (item) => {
          if (st.picked) return
          const gif = pickedGif(item)
          if (!gif) return
          st.picked = true
          onPickRef.current?.(gif)
        },
      })
    } catch {
      // ⚠️ AN EFFECT THAT THROWS UNMOUNTS THE WIDGET ROOT, and the form under
      // this picker with it. A browser without the observers the grid needs
      // gets the same line as a search that failed, and keeps its boost.
      st.want = GIF_STARTERS[0]
      st.problem = 'down'
      paint()
      return undefined
    }
    st.grid = grid
    run(GIF_STARTERS[0])
    return () => {
      st.gone = true
      st.seq++
      clearTimeout(st.timer)
      st.grid = null
      grid.destroy()
    }
    // `run` reads the record above and nothing from a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller])

  useEffect(() => {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const el = coarse ? dialogRef.current : fieldRef.current
    el?.focus({ preventScroll: true })
  }, [])

  function onType(e) {
    const value = e.target.value
    setText(value)
    clearTimeout(st.timer)
    st.retrying = false
    const query = normalise(value)
    if (!searchable(query)) return run(query)
    st.want = query
    // Back to what is on show: settled at once, nothing sent.
    if (query === st.onShow && !st.problem) return run(query)
    // The same words as the last search, even after an error: Enter or Try
    // again asks again, typing them does not.
    st.pending = query !== st.asked
    if (st.pending) st.timer = setTimeout(() => run(query), TYPING_PAUSE_MS)
    return paint()
  }
  function onFieldKey(e) {
    if (e.key !== 'Enter') return
    // Enter searches now, and reaches nothing around the picker.
    e.preventDefault()
    e.stopPropagation()
    const query = normalise(text)
    if (query === st.asked && st.problem === 'down') run(query, true)
    else run(query)
  }
  function onClear() {
    setText('')
    clearTimeout(st.timer)
    st.retrying = false
    run('')
    fieldRef.current?.focus()
  }
  // A chip never focuses the field: on a phone that raises the keyboard over
  // the results the tap asked for.
  function onChip(word) {
    setText(word)
    run(word)
  }
  function onKeyDown(e) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose?.()
  }

  const canSearch = searchable(st.want)
  const searching = canSearch && (st.pending || st.loading)
  const result = st.count
    ? `${st.count} GIFs for “${st.onShow}”`
    : `No GIFs for “${st.onShow}”. Try other words, or one of these.`
  let status = ''
  if (!st.want) status = st.onShow ? result : ''
  else if (!canSearch) status = st.count ? `Keep typing to search. Showing GIFs for “${st.onShow}”.` : 'Keep typing to search.'
  else if (searching) status = `Searching for “${st.want}”…`
  else if (st.problem === 'many') status = 'Too many searches for now: give it a minute.'
  else if (st.problem === 'down') status = 'GIFs are unavailable right now.'
  else status = st.onShow ? result : ''
  const trying = st.retrying && st.loading
  const showAgain = trying || (st.problem === 'down' && !searching && canSearch)
  const pressed = searching ? st.want : st.onShow

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Add a GIF" onKeyDown={onKeyDown}
      className="absolute inset-0 z-10 flex flex-col rounded-lg bg-[var(--modal-bg,#f4fafd)] focus:outline-none">
      <div className="px-4 sm:px-6 pt-4 pb-2 border-b border-[var(--modal-line,#b9d4e6)] shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <input ref={fieldRef} type="search" value={text} onChange={onType} onKeyDown={onFieldKey}
              enterKeyHint="search" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={500}
              aria-label="Search GIFs" aria-describedby={statusId} placeholder="Search GIFs"
              className="w-full bg-[var(--modal-field,#ffffff)] border border-[var(--modal-line,#b9d4e6)] rounded-lg pl-3 pr-16 py-2 text-base sm:text-sm text-[var(--ink,#0f2733)] focus:outline-none focus:border-[var(--brand,#00aff0)] focus:ring-2 focus:ring-[var(--brand-ring,rgba(0,175,240,0.32))]" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {searching && (
                <svg className="animate-spin w-3.5 h-3.5 text-[var(--brand-d,#068ace)]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {text && (
                <button type="button" onClick={onClear} aria-label="Clear the search"
                  className="w-6 h-6 rounded-full text-xs leading-none text-[var(--muted,#5a7488)] hover:text-[var(--ink,#0f2733)] hover:bg-[var(--modal-inset,#e6f1f9)] transition-colors">✕</button>
              )}
            </span>
          </div>
          <button type="button" onClick={() => onClose?.()}
            className="shrink-0 px-2 py-2 text-sm text-[var(--muted,#5a7488)] hover:text-[var(--ink,#0f2733)] transition-colors">Cancel</button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto py-0.5" role="group" aria-label="Try">
          {GIF_STARTERS.map((word) => (
            <button key={word} type="button" onClick={() => onChip(word)} aria-pressed={word === pressed}
              className={`shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full border text-xs transition-colors ${word === pressed
                ? 'border-[var(--brand,#00aff0)] bg-[var(--modal-inset,#e6f1f9)] text-[var(--ink,#0f2733)]'
                : 'border-[var(--modal-line,#b9d4e6)] text-[var(--muted,#5a7488)] hover:text-[var(--ink,#0f2733)]'}`}>{word}</button>
          ))}
        </div>
        <div className="flex items-baseline justify-between gap-3 min-h-[1rem]">
          <p className="text-[11px] text-[var(--muted,#5a7488)] leading-snug min-w-0">
            <span id={statusId} role="status" aria-live="polite">{status}</span>
            {showAgain && (
              <button type="button" onClick={() => { if (st.problem === 'down' && !st.retrying) run(st.asked || st.want, true) }}
                aria-disabled={trying ? 'true' : undefined}
                className="ml-2 underline text-[var(--brand-d,#068ace)] hover:text-[var(--ink,#0f2733)]">{trying ? 'Trying again…' : 'Try again'}</button>
            )}
          </p>
          <p className="text-[11px] text-[var(--muted,#5a7488)] shrink-0">
            GIFs from <a href="https://nostr.build" target="_blank" rel="noopener noreferrer" className="underline text-[var(--brand-d,#068ace)] hover:text-[var(--ink,#0f2733)]">nostr.build</a>
          </p>
        </div>
      </div>
      <div ref={setScroller} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-3">
        {searching && !st.count && (
          <div className="grid grid-cols-2 gap-2" aria-hidden="true">
            {SKELETON_RATIOS.map((ratio, i) => (
              <span key={i} className="block w-full rounded-lg animate-pulse bg-[var(--modal-inset,#e6f1f9)]" style={{ aspectRatio: ratio }} />
            ))}
          </div>
        )}
        {/* ⚠️ `gif-grid` IS WRITTEN HERE, NOT LEFT TO THE MODULE. gifGrid adds the
            class itself, and React rewrites the whole attribute the first time
            the opacity changes: the class goes, `position: relative` with it,
            and every tile is placed against the picker instead, over the
            search field. Seen in a browser on the second search. */}
        <div ref={boxRef} aria-busy={searching ? 'true' : 'false'}
          className={`gif-grid transition-opacity duration-150 ${searching && st.count ? 'opacity-50' : 'opacity-100'}`} />
      </div>
    </div>
  )
}
