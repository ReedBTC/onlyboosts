/* Chrome shared by the two server-rendered detail pages.
 *
 * /show/<podcast-guid> (functions/show/[guid].js) and /episode/<item-guid>
 * (functions/episode/[guid].js) are the same page shape: a hero, a run of
 * `.show-section` blocks with frozen ids, a wall of booster avatars, and a list
 * of boosts. Everything in this module is behaviour that belongs to that shape
 * rather than to either page's subject, and it was written for the show page
 * first — this is a move, not a rewrite.
 *
 * It stays deliberately small and dependency-light: the only imports are
 * copy-npub.js, cover-art.js and primal-profiles.js, all of which the show page
 * already carried. The heavy machinery (nostr-tools, the boost thread, the feed
 * card renderer) belongs to whichever page needs it and is lazy-imported there.
 *
 * Both pages read with NO JAVASCRIPT AT ALL. Nothing here is required for the
 * page to be complete and legible; it adds the interactive half and every
 * function degrades to what the server rendered.
 */
import { copyNpub, copyText, showToast } from '/assets/js/copy-npub.js?v=ob-v157'
import { coverChain, wireCoverFallback } from '/assets/js/cover-art.js?v=ob-v157'
import { fetchProfiles } from '/assets/js/primal-profiles.js?v=ob-v157'

// ── copy-npub ────────────────────────────────────────────────────────
/* Delegated rather than per-element: the community wall can hold 500 cards, and
 * the overflow half is in the DOM from first paint. */
export function initCopyNpub() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-copy-npub]')
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    copyNpub(el.getAttribute('data-copy-npub'))
  })
}

/* ── "Show N more" ──
 * ⚠️ MOVED TO assets/js/supporter-wall.js AND RE-EXPORTED. The wall emits the
 * button, and the homepage renders the wall without loading this module — which
 * is 156KB of thread machinery it has no other use for. The handler is generic
 * and scoped to the button's own <section>, so the same one still serves the two
 * podroll grids on /show. The three detail pages import it from here unchanged. */
export { initShowMore } from "./supporter-wall.js?v=ob-v157";

// ── share ────────────────────────────────────────────────────────────
/* The canonical URL, not location.href: the hash spy below rewrites the hash as
 * the reader scrolls, and Share is a gesture about the page rather than about
 * whichever section happened to be under the line when it was pressed. */
export function initShare() {
  document.querySelector('[data-share-page]')?.addEventListener('click', async () => {
    const url = document.querySelector('link[rel="canonical"]')?.href || location.href
    const ok = await copyText(url)
    showToast(ok ? 'Link copied' : 'Copy failed — clipboard blocked', !ok)
  })
}

// ── Back ─────────────────────────────────────────────────────────────
//
// These pages are a graph, not a tree: a community row on one page links to
// another page, whose rows link on again. Someone reading their way from the
// homepage through four of them has a real chain behind them, and
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
export function initBackLink() {
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

// ── Deep links to a section ──────────────────────────────────────────
//
// Every section on these pages has an id, and those ids are shareable URLs:
// /show/<guid>#podroll is how a podcaster sends someone to one part of their own
// page. See the contract notes at the top of functions/show/[guid].js and
// functions/episode/[guid].js — both lists are frozen.
//
// The browser does the scrolling; .show-section carries a scroll-margin-top so
// the heading clears the sticky nav. Only one case needs JavaScript: a drawer
// that ships COLLAPSED answers its own anchor with a lid. Any SECTION-LEVEL
// drawer (`.ep-drawer`) inside the target is opened — never a card's own; see
// the note at the selector.
//
// No manual scroll afterwards, deliberately. A drawer expands DOWNWARD from a
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
// the licence for the next one.
export function initHashRouting(aliases = {}) {
  function revealHashTarget() {
    let id = ''
    try { id = decodeURIComponent(location.hash.slice(1)) } catch { id = location.hash.slice(1) }
    if (!id) return

    // Rewrite in place, the way a 301 would: replaceState rather than pushState,
    // since a retired id is not a step the reader took and should not cost them a
    // press of Back. The browser found nothing to scroll to, so the scroll is ours.
    const alias = aliases[id]
    if (alias && document.getElementById(alias)) {
      id = alias
      history.replaceState(null, '', `#${alias}`)
      document.getElementById(alias).scrollIntoView()
    }

    // getElementById rather than querySelector: an id off the URL is untrusted
    // input and would otherwise be parsed as a CSS selector.
    const section = document.getElementById(id)
    if (!section) return
    /* ⚠️ `.ep-drawer` ONLY, NEVER EVERY <details> IN THE SECTION.
     *
     * This used to be `details:not([open])`, which opened the section's own
     * drawer AND every drawer nested inside it — and the card rollups are full
     * of those: each episode card carries a `<details class="pcast-card-details">`
     * holding its boost notes, which ships closed because that is thirty
     * collapsed lists and not thirty open ones.
     *
     * The way it bit is initHashSpy, three functions down. The spy rewrites the
     * hash as the reader scrolls, so a reader who scrolled past "Episodes and
     * Songs Boosted" was left on /booster/<npub>#episodes — and the next RELOAD
     * ran this over that section and opened every card's drawer at once. The
     * reader never typed a URL or clicked an anchor; the page simply came back
     * expanded.
     *
     * `.ep-drawer` is the class every SECTION-level drawer on these three pages
     * carries, and it is the only kind this ever needed to reach: exactly one
     * ships collapsed (/show's episode drawer) and the rest ship `open`. A card's
     * own drawer is the reader's to open. */
    for (const d of section.querySelectorAll('details.ep-drawer:not([open])')) d.open = true
  }

  revealHashTarget()
  // Also on in-page navigation: a shared link pasted into the address bar of an
  // already-open page fires this and not a load.
  //
  // The scroll spy below does NOT reach this. It writes with replaceState, which
  // fires no hashchange by specification, so passing one section cannot open
  // another's drawer as a side effect. That is the property that lets the two
  // coexist: the spy reports where the reader is, and only a real navigation
  // rearranges the page.
  window.addEventListener('hashchange', revealHashTarget)
  return revealHashTarget
}

// ── The hash follows the scroll ──────────────────────────────────────
//
// The section ids are shareable URLs, and until this existed the only way to get
// one was to already know it: nothing on the page links to a section, and the
// alternative shapes all put a visible affordance on the page. A permalink glyph
// beside each heading is the documentation-site convention, but it only reaches
// the sections that have an <h2> — the drawers are `show-section--bare`, with a
// <summary> standing in for one — and it asks the reader to notice a control
// before they can use it.
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
export function initHashSpy() {
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
      // A section that isn't on the page yet is skipped rather than counted.
      // /episode's community-episodes section ships `hidden` and reveals itself
      // after hydrating; display:none gives a rect of all zeroes, so a top of 0
      // is always under the line and the spy would otherwise name it while the
      // reader is still at the head of the document.
      if (!s.offsetHeight) continue
      if (s.getBoundingClientRect().top - line > 1) break
      id = s.id
    }

    // The last screenful belongs to the last section. Without this the final
    // section is the one the spy can never name: a short boost list sits
    // entirely on screen at the bottom of the document without its top ever
    // reaching the line, so scrolling to it as far as the page allows still
    // reports the section above.
    const doc = document.documentElement
    if (scrollY + innerHeight >= doc.scrollHeight - 2) id = sections[sections.length - 1].id

    if (id === current) return
    current = id
    // Only on a change, which matters: Safari throttles replaceState to ~100
    // calls per 30s and throws past it, and an unguarded call per scroll frame
    // would spend that budget in a second.
    history.replaceState(null, '', id ? `#${id}` : bare)
  }

  // rAF-throttled: the read is a handful of rects, and doing it inside the frame
  // the browser is already painting keeps it off the scroll handler's critical
  // path.
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

// ── Artwork fallback ─────────────────────────────────────────────────
//
// Some feeds publish two channel-art URLs and the primary is dead: Homegrown
// Hits' <image> 404s while its <itunes:image> resolves. D1 carries the second as
// `artwork` and the Functions emit it as `data-art2`, so there is nothing to
// fetch — this only swaps the src when the first one fails, then falls back to
// the blank tile the server would have rendered.
//
// It is a FALLBACK, not a replacement. Four of the five shows carrying an art2
// have a perfectly good primary; only the error path may use it.

/* Swap a dead image for the glyph tile the Function would have rendered had the
 * show carried no artwork at all. `tag` differs because a hero's blank is a grid
 * cell and a row's is an inline span standing in for the <img>. */
export function blankTile(img, tag, className, glyph = '🎙️') {
  const blank = document.createElement(tag)
  blank.className = className
  blank.setAttribute('aria-hidden', 'true')
  blank.textContent = glyph
  img.replaceWith(blank)
}

/* Wire one image's fallback chain.
 *
 * The chain excludes whatever `src` already holds, so the second URL is only
 * ever tried after the first has actually failed — art2's presence means the
 * feed publishes two DIFFERENT URLs, not that the primary is dead.
 *
 * TWO ATTRIBUTES, because two surfaces need chains of different lengths. A show
 * has one fallback (`data-art2`, its <itunes:image>); an EPISODE hero has two,
 * since an episode with its own art falls back to the show's primary before the
 * show's second chance. `data-art3` is that third link and is absent everywhere
 * else. coverChain dedupes, so a show whose art2 equals its image still costs
 * one request rather than two.
 *
 * An image can already have failed by the time this deferred module runs (a hero
 * is loading="eager"; a lazy row can be above the fold), and `error` has been and
 * gone with no listener attached. `complete` with no intrinsic width is the only
 * way to see that after the fact.
 */
export function wireArt2(img, onExhausted) {
  const chain = coverChain(img.dataset.art2, img.dataset.art3)
    .filter((u) => u !== img.getAttribute('src'))
  const onFail = () => { if (chain.length) wireCoverFallback(img, chain, onExhausted); else onExhausted() }
  if (img.complete && img.naturalWidth === 0) { onFail(); return }
  img.onerror = () => { img.onerror = null; onFail() }
}

/* Every [data-art2] under one selector, wired to the same blank tile.
 *
 * Wired per element rather than delegated: `error` does not bubble, and only
 * five shows in the whole index carry an art2, so this is 0 or 1 nodes on a
 * typical page. */
export function initArt2(selector, tag, className) {
  for (const img of document.querySelectorAll(selector)) {
    wireArt2(img, () => blankTile(img, tag, className))
  }
}

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
// shipped, and an unreachable cache changes nothing.
export async function hydrateProfiles(root = document) {
  const els = Array.from(root.querySelectorAll('[data-pk][data-missing]'))
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

    // A bare avatar is the element itself too, and is picture-only: the stacked
    // faces on an episode card's drawer bar carry no name to patch. They are the
    // one identity on that card the row-level hooks don't reach, which is what
    // the feed's old repaintProfiles pass existed to refresh.
    if (el.classList.contains('pcast-avatar')) {
      if (missing.includes('pic') && prof.picture) fillCardAvatar(el, prof.picture)
      el.removeAttribute('data-missing')
      continue
    }

    // `.author-name` is the boost card's, `.sup-name` the community wall's,
    // `.pcast-boost-name` the episode card's drawer row. `.boost-who` was the
    // boost row's before those rows became the same .note-card the Boosts feed
    // paints; it is kept so a reader holding a stale copy of a page against a
    // fresh copy of this module still gets names.
    if (missing.includes('name') && prof.name) {
      const nameEl = el.querySelector('.sup-name, .author-name, .boost-who, .pcast-boost-name')
      if (nameEl) {
        nameEl.textContent = prof.name
        nameEl.setAttribute('title', prof.name)
      }
      const btn = el.querySelector('.sup-avatar')
      if (btn) btn.setAttribute('aria-label', `Copy npub for ${prof.name}`)
    }

    if (missing.includes('pic') && prof.picture) {
      // An episode card's drawer row: a `.pcast-avatar` chip standing in for the
      // picture, which becomes an <img> of the same size. Checked before the two
      // below because that row has neither a `.note-author` nor a `.sup-avatar`.
      const chip = el.querySelector('.pcast-avatar')
      if (chip) { fillCardAvatar(chip, prof.picture); el.removeAttribute('data-missing'); continue }

      // TWO SHAPES, because the two surfaces resolve a missing picture
      // differently. A community card has an EMPTY `.sup-avatar` to construct an
      // <img> into; a boost card always has one already, showing the site
      // placeholder, so it only needs its src swapped. Doing the second as the
      // first would append a second image inside the first.
      const existing = el.querySelector('.note-author img')
      if (existing) {
        const fallback = existing.getAttribute('src')
        existing.onerror = () => { existing.onerror = null; existing.src = fallback }
        existing.src = prof.picture
      } else {
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
    }

    el.removeAttribute('data-missing')
  }
}

/* One episode-card avatar, filled from a late-arriving picture.
 *
 * The card renders a `.pcast-avatar` chip carrying the booster's initials when
 * the index had no picture. Swapping in an <img> rather than setting a
 * background keeps the element the same shape the stylesheet sizes — `--pcast-av`
 * rides on the inline style and has to survive — and a dead hotlink puts the
 * chip straight back rather than leaving a broken image where a face was.
 *
 * Takes either the chip itself (the stacked faces on the drawer bar) or an <img>
 * that is already there (nothing calls it that way today, and it costs one line
 * to be right if something ever does).
 */
function fillCardAvatar(chip, picture) {
  if (chip.tagName === 'IMG') { chip.src = picture; return }
  const img = document.createElement('img')
  img.className = chip.className.replace('pcast-avatar--none', '').trim()
  img.setAttribute('style', chip.getAttribute('style') || '')
  img.alt = ''
  img.referrerPolicy = 'no-referrer'
  img.dataset.initials = chip.textContent || ''
  img.onerror = () => { img.replaceWith(chip) }
  img.src = picture
  chip.replaceWith(img)
}
