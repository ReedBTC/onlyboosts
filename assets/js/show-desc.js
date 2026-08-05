/* The show description's "More" toggle, on /show/<guid>.
 *
 * The description itself is server-rendered (functions/show/[guid].js, from a
 * live Podcast Index lookup) and reads in full with no JavaScript at all. This
 * only decides whether it needs collapsing and adds the control that undoes it.
 *
 * ⚠️ THE CLAMP IS APPLIED HERE, NOT SHIPPED IN THE MARKUP, and the order is the
 * point: the page renders expanded and this collapses it, so a reader with no
 * JavaScript gets the whole description rather than three lines with no way to
 * reach the rest. The "Show N more" toggles on this page work the same way
 * round for the same reason.
 *
 * ⚠️ A NEW MODULE RATHER THAN A NEW EXPORT ON detail-page.js. Assets ship
 * max-age=14400, so a reader can hold a stale detail-page.js against a fresh
 * show-page.js for hours; an unresolved named import is a link-time error, so
 * that pairing would take the whole page's JavaScript down rather than costing
 * one toggle. A URL with no cached old version can only resolve or 404. See the
 * note in CLAUDE.md — this is the shape assets/js/feed-note.js exists in.
 */

// Matches the -webkit-line-clamp in show-page.css. Only used to decide whether
// the clamp bites at all; the clamp itself is CSS.
const COLLAPSE_LABEL = 'More'
const EXPAND_LABEL = 'Less'

function overflows(body) {
  // scrollHeight against clientHeight while clamped. The one-pixel tolerance is
  // for subpixel line heights, which otherwise report a two-line description as
  // overflowing its three-line box by a fraction.
  return body.scrollHeight > body.clientHeight + 1
}

export function initShowDesc() {
  const wrap = document.querySelector('[data-show-desc]')
  const body = wrap?.querySelector('[data-show-desc-body]')
  if (!wrap || !body) return

  let btn = null
  let expanded = false

  const measure = () => {
    // An expanded description stays expanded: the reader asked for it, and a
    // resize is not a reason to fold their own choice back up.
    if (expanded) return
    wrap.classList.add('is-clamped')
    if (overflows(body)) {
      if (!btn) {
        btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'show-desc-more'
        btn.textContent = COLLAPSE_LABEL
        btn.setAttribute('aria-expanded', 'false')
        btn.setAttribute('aria-controls', 'show-desc-body')
        body.id = 'show-desc-body'
        btn.addEventListener('click', () => {
          expanded = !expanded
          wrap.classList.toggle('is-clamped', !expanded)
          btn.textContent = expanded ? EXPAND_LABEL : COLLAPSE_LABEL
          btn.setAttribute('aria-expanded', String(expanded))
        })
        wrap.appendChild(btn)
      }
      return
    }
    // It fits. Leave no clamp and no control behind — a "More" that reveals
    // nothing is worse than the two lines it sits under.
    wrap.classList.remove('is-clamped')
    btn?.remove()
    btn = null
  }

  // Measured after the webfonts settle, not on parse: the body copy is a
  // self-hosted serif, and a description measured against the fallback metrics
  // can cross or clear three lines when the real face swaps in. `fonts.ready`
  // resolves immediately where there is nothing left to load.
  const start = () => { measure() }
  if (document.fonts?.ready) document.fonts.ready.then(start, start)
  else start()

  // A narrower viewport turns three lines into four, so the decision is not one
  // a page makes once. Debounced, because the check forces layout.
  let t = 0
  addEventListener('resize', () => {
    clearTimeout(t)
    t = setTimeout(measure, 150)
  })
}
