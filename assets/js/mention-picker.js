/* The @mention menu on a plain <textarea>: the site's three composers.
 *
 * A VERB, attached after the composer exists: the reply box and the zap
 * message under a boost note (boost-actions.js) and the share modal's text
 * (hpw-share.js). The login widget's boost modal is React and has its own
 * component (`MentionAutocomplete.jsx`) over the same `mention-search.js`, so
 * all four editors search the same cache, rank the same way, insert the same
 * token and publish the same `nostr:npub1…` form.
 *
 * `attachMentionPicker(textarea)` wraps the textarea in a positioned host,
 * hangs the menu under it, and returns the composer's own map:
 *
 *     const picker = attachMentionPicker(ta)
 *     …
 *     const content = picker.expand()          // what gets signed
 *     const pTags = picker.pubkeys().map((pk) => ['p', pk])
 *
 * ⚠️ `expand()` IS THE NOTE. The textarea holds `@reed`; only the expansion
 * holds `nostr:npub1…`. A publish that reads `ta.value` directly ships the
 * label, which no client resolves and which the message's collector-side
 * mention rendering cannot link. Every caller reads the picker, never the
 * field.
 *
 * Keys while the menu is open: ↑ ↓ move, Enter or Tab pick, Escape closes.
 * A pointer pick is on mousedown with the default prevented, so the textarea
 * never blurs. Anything the menu does not handle falls through to the field.
 * Results are requested 250ms after the last keystroke and a late answer to
 * an earlier query is dropped, so the list never shows names for a lead-in
 * the typist has already left.
 *
 * Styled by the `.ob-mention-*` rules in boost-actions.css, which every page
 * with a composer links.
 */
import { searchUsers, mentionQueryAt, insertMention, createMentionMap, mentionedPubkeys, formatFollowers, isSafeUrl } from '/assets/js/mention-search.js?v=ob-v211'

const DEBOUNCE_MS = 250
const AVATAR_FALLBACK = '/assets/avatar-fallback.svg'

export function attachMentionPicker(textarea, { limit } = {}) {
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('attachMentionPicker needs a textarea')
  const map = createMentionMap()

  const host = document.createElement('div')
  host.className = 'ob-mention-host'
  textarea.parentNode.insertBefore(host, textarea)
  host.appendChild(textarea)

  const menu = document.createElement('div')
  menu.className = 'ob-mention-menu'
  menu.hidden = true
  menu.setAttribute('role', 'listbox')
  menu.id = `ob-mention-${Math.random().toString(36).slice(2, 8)}`
  host.appendChild(menu)
  textarea.setAttribute('aria-autocomplete', 'list')
  textarea.setAttribute('aria-controls', menu.id)
  textarea.setAttribute('aria-expanded', 'false')

  let items = []
  let active = 0
  let range = null
  let seq = 0
  let timer = null
  let destroyed = false

  function close() {
    clearTimeout(timer)
    seq++
    items = []
    range = null
    menu.hidden = true
    menu.replaceChildren()
    textarea.setAttribute('aria-expanded', 'false')
    textarea.removeAttribute('aria-activedescendant')
  }

  function paint() {
    menu.replaceChildren()
    if (!items.length) { menu.hidden = true; textarea.setAttribute('aria-expanded', 'false'); return }
    items.forEach((p, i) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'ob-mention-row'
      row.id = `${menu.id}-${i}`
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', i === active ? 'true' : 'false')
      if (i === active) row.classList.add('is-active')

      const img = document.createElement('img')
      img.className = 'ob-mention-pic'
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.loading = 'lazy'
      img.src = isSafeUrl(p.picture) ? p.picture : AVATAR_FALLBACK
      img.onerror = () => { img.onerror = null; img.src = AVATAR_FALLBACK }
      row.appendChild(img)

      const text = document.createElement('span')
      text.className = 'ob-mention-text'
      const name = document.createElement('span')
      name.className = 'ob-mention-name'
      name.textContent = p.displayName || p.name || p.npub.slice(0, 12)
      text.appendChild(name)
      const meta = document.createElement('span')
      meta.className = 'ob-mention-meta'
      const bits = []
      if (p.name && p.name !== name.textContent) bits.push(`@${p.name}`)
      else if (p.nip05) bits.push(p.nip05)
      const f = formatFollowers(p.followers)
      if (f) bits.push(`${f} followers`)
      meta.textContent = bits.join(' · ')
      text.appendChild(meta)
      row.appendChild(text)

      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(p) })
      row.addEventListener('mousemove', () => { if (active !== i) { active = i; paint() } })
      menu.appendChild(row)
    })
    menu.hidden = false
    textarea.setAttribute('aria-expanded', 'true')
    textarea.setAttribute('aria-activedescendant', `${menu.id}-${active}`)
    menu.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }

  function pick(profile) {
    if (!range) return
    const label = map.label(profile)
    const { text, caret } = insertMention(textarea.value, range, label)
    textarea.value = text
    textarea.setSelectionRange(caret, caret)
    close()
    textarea.focus()
    // Whatever else listens to the field (a counter, a dirty flag) sees the
    // change the same way it sees typing.
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function update() {
    if (destroyed) return
    const r = mentionQueryAt(textarea.value, textarea.selectionStart)
    if (!r || !r.query) { close(); return }
    range = r
    clearTimeout(timer)
    const mySeq = ++seq
    timer = setTimeout(async () => {
      const found = await searchUsers(r.query, limit)
      if (destroyed || mySeq !== seq) return
      items = found
      active = 0
      paint()
    }, DEBOUNCE_MS)
  }

  function onKeydown(e) {
    if (menu.hidden || !items.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; paint() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint() }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
  }
  function onBlur() { setTimeout(() => { if (document.activeElement !== textarea) close() }, 0) }

  textarea.addEventListener('input', update)
  textarea.addEventListener('click', update)
  const onKeyup = (e) => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) update() }
  textarea.addEventListener('keyup', onKeyup)
  textarea.addEventListener('keydown', onKeydown)
  textarea.addEventListener('blur', onBlur)

  return {
    /** The text as it is published: labels expanded to `nostr:npub1…`. */
    expand() { return map.expand(textarea.value) },
    /** The hex pubkeys the expanded text mentions, for the note's `p` tags. */
    pubkeys() { return mentionedPubkeys(map.expand(textarea.value)) },
    close,
    destroy() {
      destroyed = true
      close()
      textarea.removeEventListener('input', update)
      textarea.removeEventListener('click', update)
      textarea.removeEventListener('keyup', onKeyup)
      textarea.removeEventListener('keydown', onKeydown)
      textarea.removeEventListener('blur', onBlur)
      menu.remove()
    },
  }
}
