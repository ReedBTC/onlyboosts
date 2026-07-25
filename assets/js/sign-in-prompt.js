/* The "Sign in" affordance inside a signed-out Follows feed placeholder.
 *
 * Shared by boosts-feed.js and feeds-podcasts.js so the two Follows tabs
 * offer the same button, rather than sending the user hunting for the nav.
 *
 * There is nothing to do on success: signing in makes the widget dispatch
 * `lb:session-change`, which feeds.js turns into a re-hydration of whichever
 * Follows feed is on screen — including this placeholder's own panel. So the
 * button's job ends at opening the modal.
 */
import { ensureLoginWidget } from '/assets/js/widget-loader.js'

/**
 * A button that lazy-loads the login widget and opens its login modal.
 *
 * @param {string} [text] label; the default names Nostr because this is the
 *   first sign-in prompt many visitors meet.
 * @returns {HTMLButtonElement}
 */
export function signInButton(text = 'Sign in with Nostr') {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'feed-signin-btn'
  btn.textContent = text

  btn.addEventListener('click', async () => {
    if (btn.disabled) return
    btn.disabled = true
    // The bundle is ~1MB, so the click can sit for a moment on a cold cache.
    btn.textContent = 'Loading…'
    try {
      await ensureLoginWidget()
      window.LBLogin?.requestLogin?.()
    } catch (e) {
      console.error('[feeds] login widget load failed', e)
    } finally {
      // Restored either way: the modal can be dismissed without signing in,
      // and a successful login replaces this whole placeholder anyway.
      btn.textContent = text
      btn.disabled = false
    }
  })

  return btn
}
