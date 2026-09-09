/**
 * The @mention menu under the boost modal's message field.
 *
 * The React half of what `assets/js/mention-picker.js` does for the site's
 * plain textareas: the same `mention-search.js` (imported by relative path and
 * inlined by Vite), so the boost modal searches the same Primal cache, ranks
 * by the same follower count, and inserts the same `@label` token that the
 * modal's map expands to `nostr:npub1…` at publish. The two menus are kept
 * separate because this one has to live inside a controlled field: the parent
 * owns `value` and the caret, this component only reports a pick.
 *
 * Props:
 *   textareaRef  the <textarea> (keys are read off it while the menu is open)
 *   value        the field's current text
 *   caret        the field's selectionStart, tracked by the parent
 *   onPick(profile, range)   the parent inserts the label and moves the caret
 *
 * Rendered inline, absolutely positioned under the field inside a `relative`
 * wrapper the parent supplies — no portal, so it is already inside `.lb-w`
 * and needs no scope of its own. Keys: ↑ ↓ move, Enter or Tab pick, Escape
 * closes; a pointer pick is on mousedown with the default prevented so the
 * field keeps focus. A late answer to a query the typist has left is dropped.
 *
 * ⚠️ TOKENS WITH MIRRORED FALLBACKS, like every other class in this widget:
 * `test-boost-modal-render.mjs` asserts each fallback equals the token's
 * value in theme.css, and refuses an alpha on a `var()`.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { searchUsers, mentionQueryAt, formatFollowers, isSafeUrl } from '../../../assets/js/mention-search.js'

const DEBOUNCE_MS = 250

export default function MentionAutocomplete({ textareaRef, value, caret, onPick }) {
  const [range, setRange] = useState(null)
  const [items, setItems] = useState([])
  const [active, setActive] = useState(0)
  const [closed, setClosed] = useState(null)   // the range Escape dismissed
  const seqRef = useRef(0)

  // Follow the caret: the `@` lead-in it sits in, or nothing.
  useEffect(() => {
    const r = mentionQueryAt(value, caret)
    seqRef.current++
    if (!r || !r.query || (closed && closed.start === r.start)) {
      setRange(null)
      setItems([])
      if (!r) setClosed(null)
      return
    }
    setRange(r)
    const mySeq = seqRef.current
    const t = setTimeout(async () => {
      const found = await searchUsers(r.query)
      if (mySeq !== seqRef.current) return
      setItems(found)
      setActive(0)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, caret, closed])

  const pick = useCallback((profile) => {
    if (!range || !profile) return
    onPick(profile, range)
    setRange(null)
    setItems([])
  }, [range, onPick])

  // Keys are taken off the field only while there is something to pick.
  useEffect(() => {
    const ta = textareaRef?.current
    if (!ta || !range || items.length === 0) return
    function onKey(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[active]) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setClosed(range); setRange(null); setItems([]) }
    }
    ta.addEventListener('keydown', onKey, true)
    return () => ta.removeEventListener('keydown', onKey, true)
  }, [textareaRef, range, items, active, pick])

  if (!range || items.length === 0) return null

  return (
    <div
      role="listbox"
      className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-y-auto p-1 rounded-lg border border-[var(--modal-line,#b9d4e6)] bg-[var(--modal-bg,#f4fafd)] shadow-[0_12px_32px_rgba(11,58,82,0.18)]"
    >
      {items.map((p, i) => {
        const primary = p.displayName || p.name || p.npub.slice(0, 12)
        const bits = []
        if (p.name && p.name !== primary) bits.push(`@${p.name}`)
        else if (p.nip05) bits.push(p.nip05)
        const f = formatFollowers(p.followers)
        if (f) bits.push(`${f} followers`)
        return (
          <button
            key={p.pubkey}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => { e.preventDefault(); pick(p) }}
            onMouseMove={() => { if (active !== i) setActive(i) }}
            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left ${i === active ? 'bg-[var(--modal-inset,#e6f1f9)]' : ''}`}
          >
            {isSafeUrl(p.picture) ? (
              <img
                src={p.picture}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                className="w-7 h-7 rounded-full object-cover shrink-0 bg-[var(--modal-inset,#e6f1f9)]"
                onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
              />
            ) : (
              <span className="w-7 h-7 rounded-full shrink-0 bg-[var(--modal-inset,#e6f1f9)]" aria-hidden="true" />
            )}
            <span className="flex flex-col min-w-0 leading-tight">
              <span className="text-sm font-semibold text-[var(--ink,#0f2733)] truncate">{primary}</span>
              {bits.length > 0 && <span className="text-[11px] text-[var(--muted,#5a7488)] truncate">{bits.join(' · ')}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
