/* Copy-to-clipboard + toast, shared by the boost and podcast feeds.
 *
 * Lifted verbatim out of feeds-podcasts.js, which had the only copy of it —
 * the boosts feed needed the same "click a booster, get their npub" gesture
 * and a second implementation would have drifted. The toast element and its
 * `.pcast-toast` class name are unchanged so the existing styles still apply;
 * the name is historical, it's the site's only toast.
 */

/**
 * Write `text` to the clipboard. Returns whether it landed.
 *
 * navigator.clipboard only exists in secure contexts (HTTPS / localhost), so
 * the legacy execCommand path stays as the fallback for plain-HTTP LAN
 * previews — which is exactly how the site gets tested on a phone.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

let toastTimer = null

/** Transient centred toast. One element, reused. */
export function showToast(msg, isError = false) {
  let t = document.querySelector('.pcast-toast')
  if (!t) {
    t = document.createElement('div')
    t.className = 'pcast-toast'
    t.setAttribute('role', 'status')
    t.setAttribute('aria-live', 'polite')
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.classList.toggle('is-error', !!isError)
  t.classList.add('is-visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2200)
}

/** Copy an npub, reporting success or failure through the toast. */
export async function copyNpub(npub) {
  if (!npub) { showToast('No npub for this account', true); return }
  const ok = await copyText(npub)
  showToast(ok ? 'npub copied' : 'Copy failed — clipboard blocked', !ok)
}

/**
 * Make `el` copy `npub` on click or Enter/Space.
 *
 * No-op without an npub, so a caller can wire unconditionally and let a
 * record missing one simply stay inert rather than offering a button that
 * reports a failure. Clicks are stopped from propagating — these sit inside
 * cards that have their own click targets.
 */
export function wireNpubCopy(el, npub) {
  if (!el || !npub) return el
  el.classList.add('ob-copy-npub')
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  el.setAttribute('title', 'Copy npub')
  el.addEventListener('click', (e) => { e.stopPropagation(); copyNpub(npub) })
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    copyNpub(npub)
  })
  return el
}
