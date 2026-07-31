/* Client hydration for /show/<podcast-guid>.
 *
 * The page is server-rendered (functions/show/[guid].js) and readable with no
 * JavaScript at all — this module only adds the interactive parts:
 *
 *   - the back link's history.back() upgrade
 *   - opening a collapsed drawer when a #hash deep-links to its section, and
 *     keeping the address bar's hash on the section being scrolled through
 *   - copy-npub on every supporter avatar and boost row
 *   - the "Show N more" toggles (the community wall, both podroll grids)
 *   - the art2 fallback on the hero, the drawer rows and the podroll tiles
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
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js'
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

// ── "Show N more" ────────────────────────────────────────────────────
//
// Three of these now: the community wall's supporter overflow and one per
// podroll section. Scoped to the button's own <section> rather than to a named
// grid, which is what lets one handler serve all of them — the overflow items
// and the button that reveals them are always in the same section, and the two
// podroll grids are otherwise identical, so a selector naming one would fire on
// both. Delegated because the supporter grid can hold 500 cards.
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-show-more]')
  if (!btn) return
  for (const li of btn.closest('section')?.querySelectorAll('[data-overflow]') || []) {
    li.hidden = false
    li.removeAttribute('data-overflow')
  }
  btn.remove()
})

// ── share ────────────────────────────────────────────────────────────
document.querySelector('[data-share-page]')?.addEventListener('click', async () => {
  const url = document.querySelector('link[rel="canonical"]')?.href || location.href
  const ok = await copyText(url)
  showToast(ok ? 'Link copied' : 'Copy failed — clipboard blocked', !ok)
})

// ── Back ─────────────────────────────────────────────────────────────
//
// The show pages are a graph, not a tree: a community row on one page links to
// another show page, whose community rows link on again. Someone reading their
// way from the homepage through four shows has a real chain behind them, and
// manifest.webmanifest declares display:standalone, so an installed OnlyBoosts
// has no browser back button to walk it with.
//
// The server renders a link to the feed, which is the honest destination when
// there is no chain — a visitor who opened a shared link has nothing behind
// them, and history.back() would take them out of the site or nowhere at all.
// This only upgrades that link to history.back() when the previous document was
// one of ours, which is the case the chain is made of.
//
// document.referrer is the signal. Same-origin navigations pass the full URL
// under the default referrer policy, and no page here sets a document-level one
// (the no-referrer attributes on this site are on <img>, for hotlinked artwork).

function initBackLink() {
  const link = document.querySelector('[data-show-back]')
  if (!link) return

  let ref = null
  try { ref = document.referrer ? new URL(document.referrer) : null } catch { ref = null }
  // No referrer, another site, or ourselves (a reload keeps the referrer, and
  // going "back" to the page you are on is worse than the feed link).
  if (!ref || ref.origin !== location.origin || ref.href === location.href) return
  if (history.length <= 1) return

  const label = link.querySelector('[data-back-label]')
  if (label) label.textContent = 'Back'
  link.title = 'Back to the previous page'

  link.addEventListener('click', (e) => {
    // A modified click is a request for a new tab, and the href is still the
    // feed — let the browser have it rather than backing the current one.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    history.back()
  })
}

initBackLink()

// ── Deep links to a section ──────────────────────────────────────────
//
// Every section on this page has an id, and those ids are shareable URLs:
// /show/<guid>#podroll is how a podcaster sends someone to one part of their own
// page. See the contract note at the top of functions/show/[guid].js — the six
// ids are frozen.
//
// The browser does the scrolling; .show-section carries a scroll-margin-top so
// the heading clears the sticky nav. Only one case needs JavaScript: the episode
// drawer ships COLLAPSED, so a #episodes link lands on a closed box and answers
// the question with a lid. Any <details> inside the targeted section is opened.
//
// No manual scroll afterwards, deliberately. The drawer expands DOWNWARD from a
// summary already at the top of its section, so the section's own offset does not
// move and the browser's scroll is still correct — re-scrolling would only add a
// smooth-scroll animation on load that reads as a glitch.
//
// With JavaScript off the anchor still resolves and still scrolls; the drawer is
// simply closed, one click from open, which is what a visitor who scrolled to it
// themselves would find.
//
// RETIRED IDS, and the reason there is a map at all. The contract note says a
// rename here is a dead link because the browser resolves these itself and has
// nowhere to put a redirect. That is true of the browser; it is not true of this
// module, which already runs on load and on hashchange and can rewrite a hash
// the same way ALIASES does on the homepage. What it cannot do is help a reader
// with JavaScript off, or a crawler, or anything resolving the URL without a
// browser — so this is the repair for a rename that has already happened, never
// the licence for the next one. #inverse-podroll shipped on 2026-07-30 and was
// renamed the following day; it is the only entry and it stays forever.
const HASH_ALIASES = { 'inverse-podroll': 'reverse-podroll' }

function revealHashTarget() {
  let id = ''
  try { id = decodeURIComponent(location.hash.slice(1)) } catch { id = location.hash.slice(1) }
  if (!id) return

  // Rewrite in place, the way a 301 would: replaceState rather than pushState,
  // since a retired id is not a step the reader took and should not cost them a
  // press of Back. The browser found nothing to scroll to, so the scroll is ours.
  const alias = HASH_ALIASES[id]
  if (alias && document.getElementById(alias)) {
    id = alias
    history.replaceState(null, '', `#${alias}`)
    document.getElementById(alias).scrollIntoView()
  }

  // getElementById rather than querySelector: an id off the URL is untrusted
  // input and would otherwise be parsed as a CSS selector.
  const section = document.getElementById(id)
  if (!section) return
  for (const d of section.querySelectorAll('details:not([open])')) d.open = true
}

revealHashTarget()
// Also on in-page navigation: a shared link pasted into the address bar of an
// already-open page fires this and not a load.
//
// The scroll spy below does NOT reach this. It writes with replaceState, which
// fires no hashchange by specification, so passing the community wall cannot
// open the episode drawer as a side effect. That is the property that lets the
// two coexist: the spy reports where the reader is, and only a real navigation
// rearranges the page.
window.addEventListener('hashchange', revealHashTarget)

// ── The hash follows the scroll ──────────────────────────────────────
//
// The six section ids are shareable URLs, and until now the only way to get one
// was to already know it: nothing on the page links to a section, and the
// alternative shapes all put a visible affordance on the page. A permalink glyph
// beside each heading is the documentation-site convention, but it only reaches
// four of the six sections — #episodes and #community-shows are
// `show-section--bare`, with a <summary> standing in for the <h2> — and it asks
// the reader to notice a control before they can use it.
//
// So the address bar simply tracks the section being read, and copying the URL
// at any point yields a link back to that spot. Nothing on the page changes
// appearance and nothing new is clickable.
//
// Two things this is honest about. On iOS Safari and Chrome for Android the URL
// bar collapses while scrolling, so most phone readers will never watch it
// happen; the payoff there is only that Share and Copy Link carry the section.
// And the hash changes without being asked for, so it reports where the reader
// stopped rather than what they chose — which is why it is replaceState and
// never pushState. Scrolling is not navigation, and a Back button that replayed
// a scroll one section at a time would be worse than the feature.
//
// ⚠️ THE LINE IS READ FROM scroll-margin-top, NOT HARDCODED. The section that
// counts as current has to be the one an anchor would have parked at, or
// following your own copied link lands you somewhere other than where you copied
// it. Those are the same 5rem, and reading the computed value is what stops them
// drifting apart the next time the sticky nav changes height.
function initHashSpy() {
  const sections = [...document.querySelectorAll('.show-section[id]')]
  if (sections.length < 2) return

  const line = parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 80
  const bare = location.pathname + location.search
  let current = null
  let queued = false

  function update() {
    queued = false
    // Last section whose top has crossed the line. Measured live rather than
    // cached at init: a drawer opening, a "Show N more" and a re-sort of the
    // community rows all move every offset below them, and an observer set up
    // once would be reporting the layout the page had on load.
    let id = ''
    for (const s of sections) {
      if (s.getBoundingClientRect().top - line > 1) break
      id = s.id
    }

    // The last screenful belongs to the last section. Without this the final
    // section is the one the spy can never name: a short Recent Boosts on a show
    // with few of them sits entirely on screen at the bottom of the document
    // without its top ever reaching the line, so scrolling to it as far as the
    // page allows still reports the section above.
    const doc = document.documentElement
    if (scrollY + innerHeight >= doc.scrollHeight - 2) id = sections[sections.length - 1].id

    if (id === current) return
    current = id
    // Only on a change, which matters: Safari throttles replaceState to ~100
    // calls per 30s and throws past it, and an unguarded call per scroll frame
    // would spend that budget in a second.
    history.replaceState(null, '', id ? `#${id}` : bare)
  }

  // rAF-throttled: the read is six rects, and doing it inside the frame the
  // browser is already painting keeps it off the scroll handler's critical path.
  addEventListener('scroll', () => {
    if (queued) return
    queued = true
    requestAnimationFrame(update)
  }, { passive: true })

  // No run at init, deliberately. A page opened on #boosts is still being
  // scrolled there by the browser when this module executes, and measuring
  // mid-flight would replace the hash the reader arrived on with whichever
  // section happened to be under the line. The first scroll settles it.
}

initHashSpy()

// ── Artwork fallback ─────────────────────────────────────────────────
//
// Some feeds publish two channel-art URLs and the primary is dead: Homegrown
// Hits' <image> 404s while its <itunes:image> resolves. D1 carries the second as
// `artwork` and the Function emits it as `data-art2`, so there is nothing to
// fetch — this only swaps the src when the first one fails, then falls back to
// the blank tile the server would have rendered.
//
// TWO SURFACES on this page, and they are the same code: the hero, and every
// row of the community drawer. The drawer was the miss — its query selected
// `image` and not `artwork`, so a show whose art the site had already learned to
// repair on its own page kept rendering broken in every other show's drawer.
//
// It is a FALLBACK, not a replacement. Four of the five shows carrying an art2
// have a perfectly good primary; only the error path may use it.

/* Swap a dead image for the glyph tile the Function would have rendered had the
 * show carried no artwork at all. `tag` differs because the hero's blank is a
 * grid cell and a row's is an inline span standing in for the <img>. */
function blankTile(img, tag, className) {
  const blank = document.createElement(tag)
  blank.className = className
  blank.setAttribute('aria-hidden', 'true')
  blank.textContent = '🎙️'
  img.replaceWith(blank)
}

/* Wire one image's art2 chain.
 *
 * The chain excludes whatever `src` already holds, so the second URL is only
 * ever tried after the first has actually failed — art2's presence means the
 * feed publishes two DIFFERENT URLs, not that the primary is dead, and four of
 * the five shows carrying one have a perfectly good primary.
 *
 * An image can already have failed by the time this deferred module runs (the
 * hero is loading="eager"; a lazy row can be above the fold), and `error` has
 * been and gone with no listener attached. `complete` with no intrinsic width is
 * the only way to see that after the fact.
 */
function wireArt2(img, onExhausted) {
  const chain = coverChain(img.dataset.art2).filter((u) => u !== img.getAttribute('src'))
  const onFail = () => { if (chain.length) wireCoverFallback(img, chain, onExhausted); else onExhausted() }
  if (img.complete && img.naturalWidth === 0) { onFail(); return }
  img.onerror = () => { img.onerror = null; onFail() }
}

function initHeroArt() {
  const img = document.querySelector('.show-art img')
  if (!img) return
  wireArt2(img, () => blankTile(img, 'div', 'show-art-blank'))
}

/* The community drawer's rows are other shows' artwork, which is exactly the
 * case art2 exists for: Homegrown Hits appears in these drawers right across the
 * site, and the row was rendering its dead <image> URL on every one of them
 * while its own page had already recovered. The rows are server-rendered, so the
 * Function emits data-art2 the same way the hero does.
 *
 * Wired per element rather than delegated: `error` does not bubble, and only
 * five shows in the whole index carry an art2, so this is 0 or 1 nodes on a
 * typical page and never more than the drawer's 150-row cap.
 */
function initCommunityArt() {
  for (const img of document.querySelectorAll('.cs-art[data-art2]')) {
    wireArt2(img, () => blankTile(img, 'span', 'cs-art cs-art--blank'))
  }
}

/* The podroll tiles are other shows' artwork too, and 8 of the 371 live edges
 * carry an art2. Same wiring as the drawer rows; only the blank tile differs,
 * because a podroll tile's stand-in is a full-size square rather than a 44px
 * thumbnail. */
function initPodrollArt() {
  for (const img of document.querySelectorAll('.pr-art[data-art2]')) {
    wireArt2(img, () => blankTile(img, 'span', 'pr-art pr-art--blank'))
  }
}

initHeroArt()
initCommunityArt()
initPodrollArt()

// ── The episode drawer's sort ─────────────────────────────────────────
//
// Same shape as the community drawer below: every row ships its four figures in
// one `data-ep` attribute, so a sort is a re-order of nodes already in the DOM.
// No range control — a show's catalogue is not a window, and the Episodes feed
// on the homepage is where "what aired lately" is asked.
//
// "Latest episode" is the default and reproduces the server's own ORDER BY, so
// the first paint and the first sort agree. `published` is null on a real slice
// of rows and packs as 0; those sink rather than floating to the top, which is
// the trap the homepage feed's episode sort documents.

const EP_SORTS = [
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

  let sort = 'latest'

  function paint() {
    const order = rows.slice().sort((a, b) => {
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
