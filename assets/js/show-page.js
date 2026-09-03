/* Client hydration for /show/<podcast-guid>.
 *
 * The page is server-rendered (functions/show/[guid].js) and readable with no
 * JavaScript at all — this module only adds the interactive parts.
 *
 * Most of them are not this page's: the back link, the section deep-links and
 * the hash spy, copy-npub, the "Show N more" toggles, the art2 fallback, share
 * and the Primal profile backfill are the same behaviour on /episode/<guid>, so
 * they live in detail-page.js and are called from here. What stays is what only
 * a SHOW has — the two drawers' sorts, and the four boost paths.
 *
 * The boost buttons ship `hidden` and reveal themselves here. That is
 * deliberate: whether a show is boostable depends on a Podcast Index value
 * block we haven't resolved at render time, and a button that only ever
 * reports failure is worse than no button. See docs/show-pages-spec.md.
 */
import { showToast } from '/assets/js/copy-npub.js?v=ob-v187'
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js?v=ob-v187'
import { episodeBoostLink } from '/assets/js/episode-link.js?v=ob-v187'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v187'
// The same "Sort: X ▾" dropdown the feeds use. feed-controls.js imports
// nothing, so this costs the page ~4KB and no transitive dependencies;
// rangeControl and mountFeedControls are deliberately not used (no range here,
// and no sticky bar to mount into).
import { sortControl } from '/assets/js/feed-controls.js?v=ob-v187'
// The drawers' chart standing, the same function the Function ordered them by.
import { chartRanks, rankLabel } from '/assets/js/rank.js?v=ob-v187'
// The drawer's per-row buttons are server-rendered, so only the busy-state
// helper is needed here — the builder is for the feeds, which make theirs in JS.
import { withBoostBusy } from '/assets/js/boost-button.js?v=ob-v187'
import {
  initCopyNpub, initShowMore, initShare, initBackLink,
  initHashRouting, initHashSpy, initArt2, hydrateProfiles, initStatWindows,
} from '/assets/js/detail-page.js?v=ob-v187'
// Its own module rather than a ninth export from detail-page.js, deliberately:
// a stale copy of that file against a fresh copy of this one is a link-time
// error that takes the whole page's JavaScript down. See the note at its head.
import { initShowDesc } from '/assets/js/show-desc.js?v=ob-v187'
// The reaction bar and ⋮ on this page's server-rendered boost notes. Its own
// module for the same reason show-desc.js is; see the note at its head.
import { initBoostNoteActions } from '/assets/js/boost-note-actions.js?v=ob-v187'
import { initBoostSection } from '/assets/js/boost-section.js?v=ob-v187'

const VALUE_API = '/api/value'

function payload() {
  const el = document.getElementById('show-boost-payload')
  if (!el) return null
  try { return JSON.parse(el.textContent) } catch { return null }
}

const SHOW = payload()

// ── Shared detail-page chrome ─────────────────────────
//
// Identical on /episode/<guid>; see detail-page.js for what each one does and
// why. HASH_ALIASES is this page's own: #inverse-podroll shipped on 2026-07-30
// and was renamed the following day. It is the only entry and it stays forever
// — the repair for a rename that already happened, never the licence for the
// next one.
const HASH_ALIASES = { 'inverse-podroll': 'reverse-podroll' }

initCopyNpub()
initShowMore()
initShowDesc()
initShare()
initBackLink()
initHashRouting(HASH_ALIASES)
initHashSpy()
initStatWindows()
initBoostNoteActions()

// Three surfaces carry another show's artwork, and all three hit the case the
// art2 chain exists for. The community drawer's rows were the miss: the query
// selected `image` and not `artwork`, so a show whose art the site had already
// learned to repair on its own page kept rendering broken in every OTHER show's
// drawer. 8 of the 371 podroll edges carry one, and Homegrown Hits — the show
// the whole chain exists for — is in Bowl After Bowl's podroll.
initArt2('.show-art img', 'div', 'show-art-blank')
initArt2('.cs-art[data-art2]', 'span', 'cs-art cs-art--blank')
initArt2('.pr-art[data-art2]', 'span', 'pr-art pr-art--blank')

// ── The episode drawer's sort ─────────────────────────────────────────
//
// Same shape as the community drawer below: every row ships its four figures in
// one `data-ep` attribute, so a sort is a re-order of nodes already in the DOM.
// No range control — a show's catalogue is not a window, and the Episodes feed
// on the homepage is where "what aired lately" is asked.
//
// "Chart Rank" is the default (Reed's ask, 2026-09-03: the chart formula over
// this show's own episodes) and reproduces the server's own order, which the
// Function computed with the same rank.js#chartRanks, so the first paint and
// the first sort agree. It was "Latest Episode" until then. `published` is
// null on a real slice of rows and packs as 0; those sink rather than floating
// to the top, which is the trap the homepage feed's episode sort documents.

const EP_SORTS = [
  ['chart', 'Chart Rank'],
  ['latest', 'Latest Episode'],
  ['boosters', 'Most Boosters'],
  ['boosts', 'Most Boosts'],
  ['sats', 'Most Sats'],
]

function initEpisodeSort() {
  const root = document.querySelector('[data-episode-drawer]')
  if (!root) return
  const list = root.querySelector('.ep-list')
  const slot = root.querySelector('[data-ep-controls]')
  if (!list || !slot) return

  const rows = Array.from(list.querySelectorAll('.ep-row')).map((el) => {
    const [boosters, boosts, sats, published] = String(el.dataset.ep || '').split(',').map(Number)
    return { el, boosters: boosters || 0, boosts: boosts || 0, sats: sats || 0, published: published || 0 }
  })
  if (rows.length < 2) return   // nothing to order

  let sort = 'chart'

  function paint() {
    const order = sort === 'chart'
      ? chartRanks(rows, { sats: (r) => r.sats, boosts: (r) => r.boosts, breadth: (r) => r.boosters }).map((e) => e.row)
      : rows.slice().sort((a, b) => {
      if (sort === 'boosters') return b.boosters - a.boosters || b.sats - a.sats
      if (sort === 'boosts') return b.boosts - a.boosts || b.sats - a.sats
      if (sort === 'sats') return b.sats - a.sats || b.boosts - a.boosts
      // Undated rows sink instead of leading, then the server's tiebreak.
      if (!a.published !== !b.published) return a.published ? -1 : 1
      return b.published - a.published || b.sats - a.sats
    })
    const frag = document.createDocumentFragment()
    for (const r of order) frag.appendChild(r.el)
    list.appendChild(frag)
  }

  // Appended, not assigned: the band is already on screen carrying the
  // "See All Episodes" link, which needs no JavaScript and so is not ours to
  // reveal. Only the sort is conditional, and only on there being an order to
  // change — a one-row drawer keeps the link and gets no pill.
  slot.appendChild(sortControl(EP_SORTS, sort, (key) => { sort = key; paint() }, {
    tag: 'Sort: ',
    title: 'Change how these episodes are ordered',
  }))
}

initEpisodeSort()

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
// Chart Rank first and default (Reed's ask, 2026-09-03), the chart formula over
// these rows with the community's boosters as the breadth component; the
// Function ordered the list with the same rank.js#chartRanks. Most Boosters
// until then.
const CS_SORTS = [
  ['chart', 'Chart Rank'],
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

  let sort = 'chart'

  function paint() {
    // Rank is recomputed per sort rather than retained. That differs from the
    // feeds' search, where filtering to one row has to preserve its standing in
    // the full list; here the list is never filtered, so a row's position under
    // the current sort IS its rank — and under the chart it is the tuple's
    // competition rank, T-marked where shared.
    const charted = sort === 'chart'
      ? chartRanks(rows, { sats: (r) => r.sats, boosts: (r) => r.boosts, breadth: (r) => r.members })
      : null
    const order = charted ? charted.map((e) => e.row) : rows.slice().sort((a, b) => {
      if (sort === 'boosts') return b.boosts - a.boosts || b.sats - a.sats
      if (sort === 'sats') return b.sats - a.sats || b.boosts - a.boosts
      return b.members - a.members || b.boosts - a.boosts || b.sats - a.sats
    })
    const frag = document.createDocumentFragment()
    order.forEach((r, i) => {
      if (r.rankEl) r.rankEl.textContent = charted ? rankLabel(charted[i].rank, charted[i].tied) : String(i + 1)
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
      // publishes the same note it would from the feed — /episode/<item-guid>
      // for a titled episode, Boost Me Bitch for the 500 with no page. Null on a
      // show-level boost (no itemGuid), where there is no episode to point at;
      // the note template omits both the link line and the `r` tag.
      bmbUrl: episodeBoostLink({
        itemGuid,
        // The drawer row carries its title in data-ep-title, which is what
        // decides whether this episode has a page of ours.
        title: episodeTitle || '',
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

// ── Profile fallback ───────────────────────────────────
//
// Post-paint and best-effort: fills the supporter cards, boost rows and mention
// chips the Function marked `data-missing` because the index had no kind-0 for
// them. See detail-page.js.
hydrateProfiles()

// ── The boost inbox ──────────────────────────────────────────────────
//
// #boosts opens on the newest 24 and, once the reader touches a control, holds
// every boost this show has ever received. That is the change that makes the
// range mean something here: a podcaster reads boosts off across the whole
// catalogue rather than one episode at a time, so this section is the show's
// inbox rather than a sample of the last few days.
//
// The corpus is one bounded request — the heaviest show in the index carries
// 1,404 boosts against a cap of 2,000 — and it is not made until a control moves
// or "Load more" is pressed. Everything else is boost-section.js's, shared with
// the identical section on /episode and /booster.
initBoostSection({
  fetchCorpus: async () => {
    const guid = SHOW?.guid
    if (!guid) throw new Error('corpus: no show guid')
    // ?corpus=1 answers this and nothing else — no episode list, no supporter
    // GROUP BY. /api/v1/boosts?podcast=<guid> is deliberately not the source: it
    // is cursor-paged at 200 a page, so the heaviest show would take seven round
    // trips before the reader's chosen order could cover all of it.
    const resp = await fetch(`/api/v1/podcasts/${encodeURIComponent(guid)}?corpus=1`, {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) throw new Error(`corpus: HTTP ${resp.status}`)
    return (await resp.json())?.corpus || {}
  },
  sortTitle: 'Sort the boosts sent to this show',
  emptyText: 'Nobody boosted this show in this time range \u2014 try a wider one.',
  // The cap is 2,000 against a measured heaviest show of 1,404, so this line is
  // unreachable today. It is here because an order over a prefix must never pose
  // as an order over everything.
  truncatedNote:
    'Sorted over this show\u2019s 2,000 most recent boosts. It has received more than that, so an older boost may be missing.',
})
