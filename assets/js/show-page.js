/* Client hydration for /show/<podcast-guid>.
 *
 * The page is server-rendered (functions/show/[guid].js) and readable with no
 * JavaScript at all — this module only adds the interactive parts:
 *
 *   - copy-npub on every supporter avatar and boost row
 *   - the "show N more supporters" toggle
 *   - share (copy the canonical URL)
 *   - boost buttons, show-level and per-episode
 *
 * The boost buttons ship `hidden` and reveal themselves here. That is
 * deliberate: whether a show is boostable depends on a Podcast Index value
 * block we haven't resolved at render time, and a button that only ever
 * reports failure is worse than no button. See docs/show-pages-spec.md.
 */
import { copyNpub, copyText, showToast } from '/assets/js/copy-npub.js'
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'

const VALUE_API = '/api/value'

function payload() {
  const el = document.getElementById('show-boost-payload')
  if (!el) return null
  try { return JSON.parse(el.textContent) } catch { return null }
}

const SHOW = payload()

// ── copy-npub ────────────────────────────────────────────────────────
// Delegated rather than per-element: the supporters grid can hold 500 cards,
// and the overflow half is in the DOM from first paint.
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-copy-npub]')
  if (!el) return
  e.preventDefault()
  e.stopPropagation()
  copyNpub(el.getAttribute('data-copy-npub'))
})

// ── supporters overflow ──────────────────────────────────────────────
document.querySelector('[data-show-more="supporter"]')?.addEventListener('click', function () {
  for (const li of document.querySelectorAll('[data-supporter-grid] [data-overflow]')) {
    li.hidden = false
    li.removeAttribute('data-overflow')
  }
  this.remove()
})

// ── share ────────────────────────────────────────────────────────────
document.querySelector('[data-share-page]')?.addEventListener('click', async () => {
  const url = document.querySelector('link[rel="canonical"]')?.href || location.href
  const ok = await copyText(url)
  showToast(ok ? 'Link copied' : 'Copy failed — clipboard blocked', !ok)
})

// ── boosting ─────────────────────────────────────────────────────────

/* Resolve a value block through /api/value.
 *
 * MONEY PATH. This mirrors the resolve-then-open sequence in
 * feeds-podcasts.js rather than sharing code with it: that module is the
 * episode feed's renderer and importing it here would pull the whole feed in,
 * while refactoring its boost path would touch the site's most sensitive
 * function for no behavioural gain. The two are allowed to look alike; they use
 * the same `fromApiValue` / `applyExternalOverrides` helpers, which is where
 * the actual split logic lives.
 *
 * `itemGuid` null asks for the feed-level block (boosting the show itself).
 */
async function resolveValue(itemGuid) {
  if (!SHOW) return null
  const qs = new URLSearchParams()
  if (SHOW.guid) qs.set('podcastGuid', SHOW.guid)
  if (SHOW.feed) qs.set('feedUrl', SHOW.feed)
  if (itemGuid) qs.set('guid', itemGuid)
  if (![...qs.keys()].length) return null

  let data = null
  try {
    const resp = await fetch(`${VALUE_API}?${qs}`, { headers: { Accept: 'application/json' } })
    // A server/config failure and "this show has no value block" are different
    // outcomes and must not be conflated — otherwise an outage reads as every
    // show being un-boostable.
    if (!resp.ok) return { error: true }
    data = await resp.json()
  } catch { return { error: true } }
  if (data && data.error) return { error: true }

  const parsed = fromApiValue(data)
  if (!parsed) return null

  const recipients = applyExternalOverrides(parsed.recipients)
  const totalWeight = recipients.reduce((a, r) => a + (r.splitWeight || 0), 0)
  if (!recipients.length || totalWeight <= 0) return null
  return { recipients, totalWeight }
}

async function openBoost(bundle, { itemGuid = '', episodeTitle = '' } = {}) {
  await ensureLoginWidget()
  if (!window.LBLogin?.openExternalBoost) {
    showToast('Boost is unavailable right now.', true)
    return
  }
  window.LBLogin.openExternalBoost({
    episode: {
      showTitle: SHOW?.title || '',
      episodeTitle,
      podcastGuid: SHOW?.guid || '',
      itemGuid,
      bmbUrl: '',
    },
    recipientsBundle: bundle,
  })
}

function wireBoostButton(btn, itemGuid, episodeTitle) {
  btn.hidden = false
  btn.addEventListener('click', async () => {
    if (btn.disabled) return
    const prev = btn.textContent
    btn.disabled = true
    btn.textContent = 'Loading…'
    try {
      const bundle = await resolveValue(itemGuid)
      if (!bundle) {
        showToast(itemGuid ? 'This episode has no value block to boost.' : 'This show has no value block to boost.', true)
        return
      }
      if (bundle.error) {
        showToast('Couldn’t load boost splits — please try again in a moment.', true)
        return
      }
      btn.textContent = 'Opening…'
      await openBoost(bundle, { itemGuid, episodeTitle })
    } catch (err) {
      console.warn('[show] boost failed', err)
      showToast('Couldn’t start the boost — try again.', true)
    } finally {
      btn.disabled = false
      btn.textContent = prev
    }
  })
}

/* Reveal the boost controls only once we know the show has a payable block.
 *
 * One probe for the whole page: the feed-level block is what the show button
 * pays, and an episode without its own block falls back to that same feed
 * block server-side (see functions/api/value.js), so a show with a feed block
 * has every episode boostable. A show with none has nothing to boost at any
 * level, and the buttons stay hidden.
 */
async function initBoosting() {
  if (!SHOW || (!SHOW.guid && !SHOW.feed)) return
  const probe = await resolveValue(null)
  // A transient failure leaves the buttons hidden rather than showing controls
  // that would fail on click; a reload retries.
  if (!probe || probe.error) return

  const showBtn = document.querySelector('[data-show-boost]')
  if (showBtn) wireBoostButton(showBtn, '', '')

  for (const btn of document.querySelectorAll('[data-ep-boost]')) {
    const guid = btn.getAttribute('data-ep-boost')
    if (!guid) continue
    wireBoostButton(btn, guid, btn.getAttribute('data-ep-title') || '')
  }
}

initBoosting()
