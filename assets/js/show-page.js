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
// The same 1W/1M/All segmented control and "Sort: X ▾" dropdown the feeds use.
// feed-controls.js imports nothing, so this costs the page ~4KB and no
// transitive dependencies; mountFeedControls is not used here (that one is for
// the homepage's sticky bar, which this page has no equivalent of).
import { rangeControl, sortControl } from '/assets/js/feed-controls.js'
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
// The server ships every row with all three windows' figures packed into data
// attributes (see renderCommunityShows in functions/show/[guid].js), so this
// never fetches anything: a range or sort change is a re-order and a re-label
// of nodes already in the DOM.
//
// The range means what it means on the Shows feed — when the boost was SENT,
// not when anything aired. A show-level rollup is a list of boosts, so the last
// seven days can only be the boosts sent in them.
//
// One measured fact drives the empty state: across the live index the median
// community has boosted exactly ONE other show in the last 7 days, and 47% of
// shows have boosted none. So 1W being empty is the normal case, not a fault,
// and it has to read as an answer rather than as a broken list. All is the
// opening range for the same reason.

const CS_SORTS = [
  ['members', 'Most of this community'],
  ['boosts', 'Most boosts'],
  ['sats', 'Most sats'],
  ['recent', 'Recently boosted'],
]

const CS_RANGE_TITLE = {
  '1w': 'Boosted by this community in the last 7 days',
  '1m': 'Boosted by this community in the last 30 days',
  all: 'Every show this community has boosted',
}

const CS_EMPTY = {
  '1w': 'Nobody in this community has boosted another show in the last 7 days.',
  '1m': 'Nobody in this community has boosted another show in the last 30 days.',
  all: 'This community has not boosted anything else.',
}

// Mirrors compact() in functions/show/[guid].js. Duplicated rather than shared
// because this is a no-build site with a Pages Function on one side and an ES
// module on the other, and there is nowhere to define it once — the same reason
// the .ob-scopenote copy is duplicated. Keep the two matching.
function csCompact(n) {
  const v = Number(n || 0)
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (v >= 1e4) return Math.round(v / 1e3) + 'k'
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(v)
}

const csNum = (n) => Number(n || 0).toLocaleString('en-US')

// Must produce byte-for-byte what communityMeta() renders server-side.
function csMeta(members, boosts, sats, size) {
  return `${csNum(members)} of ${csNum(size)} booster${size === 1 ? '' : 's'} · ` +
    `${csNum(boosts)} boost${boosts === 1 ? '' : 's'} · ${csCompact(sats)} sats`
}

function initCommunityShows() {
  const root = document.querySelector('[data-community-shows]')
  if (!root) return
  const list = root.querySelector('[data-cs-list]')
  const slot = root.querySelector('[data-cs-controls]')
  const emptyEl = root.querySelector('[data-cs-empty]')
  if (!list || !slot || !emptyEl) return

  // [boosts, sats, members, latest] per window, parsed once.
  const rows = Array.from(list.querySelectorAll('.cs-row')).map((el) => {
    const win = (key) => {
      const [b, s, m, t] = String(el.dataset[key] || '').split(',').map(Number)
      return { boosts: b || 0, sats: s || 0, members: m || 0, latest: t || 0 }
    }
    return {
      el,
      rankEl: el.querySelector('.cs-rank'),
      metaEl: el.querySelector('.cs-meta'),
      w: { all: win('all'), '1m': win('1m'), '1w': win('1w') },
    }
  })
  if (!rows.length) return

  const size = Number(root.dataset.communitySize || 0)

  let range = 'all'
  let sort = 'members'

  function paint() {
    // Rank is recomputed per view rather than retained. This is not the feeds'
    // search, where a filter has to preserve a row's standing in the full list
    // — here the range IS the list, so a show's position within it is the
    // honest number.
    const visible = rows.filter((r) => r.w[range].boosts > 0)
    visible.sort((a, b) => {
      const x = a.w[range]
      const y = b.w[range]
      if (sort === 'boosts') return y.boosts - x.boosts || y.sats - x.sats
      if (sort === 'sats') return y.sats - x.sats || y.boosts - x.boosts
      if (sort === 'recent') return y.latest - x.latest || y.boosts - x.boosts
      return y.members - x.members || y.boosts - x.boosts || y.sats - x.sats
    })

    for (const r of rows) r.el.hidden = true

    const frag = document.createDocumentFragment()
    visible.forEach((r, i) => {
      const w = r.w[range]
      r.el.hidden = false
      if (r.rankEl) r.rankEl.textContent = String(i + 1)
      if (r.metaEl) r.metaEl.textContent = csMeta(w.members, w.boosts, w.sats, size)
      frag.appendChild(r.el)
    })
    list.appendChild(frag)

    emptyEl.textContent = visible.length ? '' : CS_EMPTY[range]
    emptyEl.hidden = !!visible.length
    list.hidden = !visible.length
    // The drawer's own count follows the range, so the summary can't claim 45
    // shows over a window holding three.
    const countEl = root.querySelector('.cs-count')
    if (countEl) countEl.textContent = csNum(visible.length)
  }

  slot.append(
    rangeControl(range, (key) => { range = key; paint() }, {
      label: 'Filter by when the boost was sent',
      titleFor: (key) => CS_RANGE_TITLE[key] || key,
    }),
    sortControl(CS_SORTS, sort, (key) => { sort = key; paint() }, {
      title: 'Change how these shows are ranked',
    }),
  )
  slot.hidden = false
  paint()
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
