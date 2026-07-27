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
import { episodeBoostLink } from '/assets/js/episode-link.js'
import { ensureLoginWidget } from '/assets/js/widget-loader.js'
// Fallback identity lookup for what the index didn't have — see the profile
// hydration at the foot of this file.
import { fetchProfiles } from '/assets/js/primal-profiles.js'

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
      // Same builder the Episodes feed uses, so an episode boosted from here
      // publishes the same note it would from the feed. Null on a show-level
      // boost (no itemGuid), where there is no episode to point at; the note
      // template omits both the link line and the `r` tag.
      bmbUrl: episodeBoostLink({
        itemGuid,
        podcastGuid: SHOW?.guid || null,
        // The show payload carries no Podcast Index numeric id (see the
        // "two fields the feed doesn't carry" note in CLAUDE.md), so this
        // always resolves through ?podcast=<guid>.
        feedId: null,
      }) || '',
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

// ── Profile fallback ─────────────────────────────────────────────────
//
// The server renders every identity it can from the D1 `profiles` table, which
// the collector fills from kind-0 events for people who have BOOSTED. Two gaps
// survive that, and both paint as a shortened npub and a blank circle:
//
//   - a booster whose kind-0 the collector hadn't resolved when it last ran
//   - an npub MENTIONED inside a boost message, who need never have boosted
//     anything and so is not in that table at all
//
// A normal Nostr client would ask the relays. This asks Primal's cache, which
// answers a batch of pubkeys in one round trip instead of a fan-out, and is the
// same fallback the Episodes feed already uses. The index stays the fast path;
// this only fills what the index missed.
//
// Everything here is post-paint and best-effort. The server output is complete
// and readable on its own, a visitor with no JavaScript keeps exactly what
// shipped before, and an unreachable cache changes nothing.

async function hydrateProfiles() {
  const els = Array.from(document.querySelectorAll('[data-pk][data-missing]'))
  if (!els.length) return

  const found = await fetchProfiles(els.map((el) => el.getAttribute('data-pk')))
  if (!found.size) return

  for (const el of els) {
    const prof = found.get(el.getAttribute('data-pk'))
    if (!prof) continue
    const missing = (el.getAttribute('data-missing') || '').split(' ')

    // A mention chip is the element itself; a supporter card and a boost row
    // are containers holding the pieces to patch.
    if (el.classList.contains('nostr-mention')) {
      if (prof.name) el.textContent = '@' + prof.name
      el.removeAttribute('data-missing')
      continue
    }

    if (missing.includes('name') && prof.name) {
      const nameEl = el.querySelector('.sup-name, .boost-who')
      if (nameEl) {
        nameEl.textContent = prof.name
        nameEl.setAttribute('title', prof.name)
      }
      // The avatar's aria-label names the person it belongs to.
      const btn = el.querySelector('.sup-avatar')
      if (btn) btn.setAttribute('aria-label', `Copy npub for ${prof.name}`)
    }

    if (missing.includes('pic') && prof.picture) {
      const btn = el.querySelector('.sup-avatar')
      if (btn && !btn.querySelector('img')) {
        const img = document.createElement('img')
        img.alt = ''
        img.loading = 'lazy'
        img.referrerPolicy = 'no-referrer'
        // A dead hotlink returns the card to the blank circle it already had.
        img.onerror = () => { img.remove(); btn.classList.add('is-blank') }
        img.src = prof.picture
        btn.classList.remove('is-blank')
        btn.appendChild(img)
      }
    }

    el.removeAttribute('data-missing')
  }
}

hydrateProfiles()
