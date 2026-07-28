/* The circle boost button, and nothing else.
 *
 * ⚠️ This module is CHROME, not a money path. It builds a button and reports
 * clicks; every caller owns its own resolve-and-pay sequence, because what a
 * boost pays differs by surface:
 *
 *   feeds-podcasts.js  an EPISODE's value block (/api/value with a guid)
 *   shows-feed.js      a SHOW's feed-level block (no guid)
 *   show-page.js       the same, for another show entirely
 *
 * Sharing the button and not the handler is the seam on purpose. The three
 * handlers all resolve through fromApiValue / applyExternalOverrides, which is
 * where split logic belongs; folding them together here would put payment
 * routing inside a UI helper.
 *
 * The show page's community drawer is server-rendered and so builds the same
 * markup in functions/show/[guid].js instead of calling this. The class name
 * and the busy/disabled states are the contract between the two — .ob-boost-
 * circle is defined once in theme.css, which every page loads.
 */

// The bolt, matching .pcast-btn-bolt's path and the #cs-bolt symbol on the show
// page. Inline rather than a <use>: these are built one at a time by feeds that
// have no symbol sheet to reference.
const BOLT = '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-hidden="true"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clip-rule="evenodd"/></svg>'

/**
 * @param {object}   opts
 * @param {string}   opts.label    what it boosts, for the tooltip and the
 *   accessible name. There is no visible text, so this is the only thing a
 *   screen reader gets — pass the show or episode title, not "Boost".
 * @param {Function} opts.onClick  async (btn) => void. Called with the button
 *   so the handler can drive its own busy state; re-entry is blocked here.
 */
export function circleBoostButton({ label, onClick }) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'ob-boost-circle'
  btn.title = `Boost ${label}`
  btn.setAttribute('aria-label', `Boost ${label}`)
  btn.innerHTML = BOLT
  btn.addEventListener('click', (e) => {
    // The card behind it is clickable in places, and on the Shows cards the
    // whole title is a link — a boost must never also navigate.
    e.preventDefault()
    e.stopPropagation()
    if (btn.disabled) return
    onClick(btn)
  })
  return btn
}

/** Run `fn` with the button held in its busy state, whatever the outcome. */
export async function withBoostBusy(btn, fn) {
  btn.disabled = true
  btn.classList.add('is-busy')
  try {
    return await fn()
  } finally {
    btn.disabled = false
    btn.classList.remove('is-busy')
  }
}
