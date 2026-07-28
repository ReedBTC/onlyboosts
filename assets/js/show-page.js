/* Client hydration for /show/<podcast-guid>.
 *
 * The page is server-rendered (functions/show/[guid].js) and readable with no
 * JavaScript at all — this module only adds the interactive parts:
 *
 *   - copy-npub on every supporter avatar and boost row
 *   - the "show N more supporters" toggle
 *   - share (copy the canonical URL)
 *   - boost buttons, show-level and per-episode
 *   - the range/sort controls on the community-shows drawer
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
// The same "Sort: X ▾" dropdown the feeds use. feed-controls.js imports
// nothing, so this costs the page ~4KB and no transitive dependencies;
// rangeControl and mountFeedControls are deliberately not used (no range here,
// and no sticky bar to mount into).
import { sortControl } from '/assets/js/feed-controls.js'
// The drawer's per-row buttons are server-rendered, so only the busy-state
// helper is needed here — the builder is for the feeds, which make theirs in JS.
import { withBoostBusy } from '/assets/js/boost-button.js'
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

// ── Other shows this community boosts ────────────────────────────────
//
// Every row ships its three figures packed into one `data-cs` attribute (see
// renderCommunityShows in functions/show/[guid].js), so this never fetches and
// never re-labels: a sort is a re-order and a renumber of nodes already in the
// DOM, and the text on a row is fixed at render time.
//
// THERE IS NO RANGE CONTROL, and that is a decision rather than an omission. A
// time window is an episode-level question; which shows an audience overlaps
// with is a standing fact, not a recent one. The data agreed — the median
// community had boosted one other show in the last 7 days and 47% had boosted
// none, so two of three ranges were empty on half the site.
//
// Every sort is scoped to this community, because every figure is: the query
// counts only boosts sent by a member, so "most sats" means most sats from
// these boosters, never the show's global total.

// "Community Sort:" is the tag, so each option can be the bare measure — the
// label already says whose boosts these are, and repeating "here" on every row
// of the menu only crowded it.
const CS_SORTS = [
  ['members', 'Most Boosters'],
  ['boosts', 'Most Boosts'],
  ['sats', 'Most Sats'],
]

function initCommunityShows() {
  const root = document.querySelector('[data-community-shows]')
  if (!root) return
  const list = root.querySelector('[data-cs-list]')
  const slot = root.querySelector('[data-cs-controls]')
  if (!list || !slot) return

  const rows = Array.from(list.querySelectorAll('.cs-row')).map((el) => {
    const [boosts, sats, members] = String(el.dataset.cs || '').split(',').map(Number)
    return {
      el,
      rankEl: el.querySelector('.cs-rank'),
      boosts: boosts || 0,
      sats: sats || 0,
      members: members || 0,
    }
  })
  if (!rows.length) return

  let sort = 'members'

  function paint() {
    // Rank is recomputed per sort rather than retained. That differs from the
    // feeds' search, where filtering to one row has to preserve its standing in
    // the full list; here the list is never filtered, so a row's position under
    // the current sort IS its rank.
    const order = rows.slice().sort((a, b) => {
      if (sort === 'boosts') return b.boosts - a.boosts || b.sats - a.sats
      if (sort === 'sats') return b.sats - a.sats || b.boosts - a.boosts
      return b.members - a.members || b.boosts - a.boosts || b.sats - a.sats
    })
    const frag = document.createDocumentFragment()
    order.forEach((r, i) => {
      if (r.rankEl) r.rankEl.textContent = String(i + 1)
      frag.appendChild(r.el)
    })
    list.appendChild(frag)
  }

  slot.appendChild(sortControl(CS_SORTS, sort, (key) => { sort = key; paint() }, {
    tag: 'Community Sort: ',
    title: 'Change how these shows are ranked',
  }))
  slot.hidden = false
}

initCommunityShows()

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
 *
 * `target` names WHICH show to resolve, defaulting to this page's. The
 * community-shows drawer passes another show's guid and feed URL, and it is the
 * only caller that does — those two values come straight from the D1 row the
 * server rendered, and are the same identifiers Podcast Index keys that show's
 * own splits on. Nothing here rewrites a leg; see applyExternalOverrides.
 */
async function resolveValue(itemGuid, target = SHOW) {
  if (!target) return null
  const qs = new URLSearchParams()
  if (target.guid) qs.set('podcastGuid', target.guid)
  if (target.feed) qs.set('feedUrl', target.feed)
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

async function openBoost(bundle, { itemGuid = '', episodeTitle = '', target = SHOW } = {}) {
  await ensureLoginWidget()
  if (!window.LBLogin?.openExternalBoost) {
    showToast('Boost is unavailable right now.', true)
    return
  }
  window.LBLogin.openExternalBoost({
    episode: {
      showTitle: target?.title || '',
      episodeTitle,
      podcastGuid: target?.guid || '',
      itemGuid,
      // Same builder the Episodes feed uses, so an episode boosted from here
      // publishes the same note it would from the feed. Null on a show-level
      // boost (no itemGuid), where there is no episode to point at; the note
      // template omits both the link line and the `r` tag.
      bmbUrl: episodeBoostLink({
        itemGuid,
        podcastGuid: target?.guid || null,
        // The show payload carries no Podcast Index numeric id (see the
        // "two fields the feed doesn't carry" note in CLAUDE.md), so this
        // always resolves through ?podcast=<guid>.
        feedId: null,
      }) || '',
    },
    recipientsBundle: bundle,
  })
}

/* Boost another show, from a row of the community-shows drawer.
 *
 * MONEY PATH, and the one place on this page that pays a show other than the
 * one it is about — so the target is read off the row's own data attributes and
 * threaded through resolveValue and openBoost together. Passing a guid to one
 * and not the other would resolve one show's splits and label the note with
 * another's.
 *
 * Unlike the hero button there is no up-front probe: a page can carry 150 rows
 * and probing each would be 150 requests to Podcast Index on load. So these
 * reveal themselves optimistically and resolve on click, and a show with no
 * payable block reports it in a toast at that point.
 */
async function onCommunityBoost(btn) {
  const target = {
    guid: btn.getAttribute('data-cs-boost') || '',
    feed: btn.getAttribute('data-cs-feed') || '',
    title: btn.getAttribute('data-cs-title') || '',
  }
  if (!target.guid && !target.feed) return
  if (btn.disabled) return

  await withBoostBusy(btn, async () => {
    try {
      const bundle = await resolveValue(null, target)
      if (!bundle) {
        showToast(`${target.title || 'This show'} has no value block to boost.`, true)
        return
      }
      if (bundle.error) {
        showToast('Couldn’t load boost splits — please try again in a moment.', true)
        return
      }
      await openBoost(bundle, { target })
    } catch (err) {
      console.warn('[show] community boost failed', err)
      showToast('Couldn’t start the boost — try again.', true)
    }
  })
}

// Delegated, and revealed in one pass: 150 rows means 150 listeners otherwise.
function initCommunityBoosts() {
  const btns = document.querySelectorAll('[data-cs-boost]')
  if (!btns.length) return
  for (const b of btns) b.hidden = false
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-cs-boost]')
    if (btn) onCommunityBoost(btn)
  })
}

initCommunityBoosts()

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
