/* The verbs on an episode card, attached to whatever rendered the facts.
 *
 * ⚠️ THE OTHER HALF OF assets/js/episode-card.js, and the rendering rule from
 * CLAUDE.md at its most literal. That module emits the card as an HTML string —
 * at the edge for /episode/<guid>, /booster/<npub> and the homepage's opening
 * feed, in the browser for every re-sort, range change and search pick after
 * that. Nothing in it needs a signer, a gesture, or knowledge of who is looking.
 * Everything that does is here:
 *
 *   the ⋮ subscribe menu       markup and links ship from the server, hidden;
 *                              this reveals it and owns the toggle
 *   the boost pill             ships hidden; this reveals it and owns the
 *                              resolve-and-pay sequence
 *   the drawer's hide control  ships hidden; <details> opens on its own, but
 *                              closing from the FOOT of a long thread is a
 *                              convenience only JavaScript can offer
 *   a lazy drawer's rows       on the homepage only, the boost notes are not
 *                              in the document; this fetches them the first
 *                              time a drawer opens and renders them through
 *                              the card module's own row function
 *   the per-boost ⋮ menu       copy npub / copy nevent, both clipboard gestures
 *   the reaction bars          reply / like / repost / zap, on every note
 *   artwork and avatar         the error-path fallbacks, which need an event
 *   fallbacks                  listener the server cannot attach
 *
 * ⚠️ IT IS THE SAME MODULE ON ALL FOUR SURFACES. That is the requirement the
 * whole refactor exists to meet: a reader who screenshots a card on the homepage
 * and a card on /episode/<guid> must not be able to tell them apart. There is one
 * boost path, one subscribe menu and one drawer, not four that agree by
 * inspection. boost-note-actions.js is the same seam one level down, for the
 * .note-card boost notes on the three detail pages; the two are deliberately
 * separate because a note card and an episode card are different objects with
 * different hooks, and merging them would put a switch inside the seam.
 *
 * ⚠️ THE HEAVY IMPORTS ARE DEFERRED. boost-actions.js and the nostr-tools it
 * pulls are dynamic imports that nothing reaches until a reader opens a drawer or
 * copies an nevent. That matters most on the two DETAIL pages, which never loaded
 * either before; on the homepage nostr-tools arrives anyway, because feeds.js and
 * follow-set.js both import it directly. Do not read this as the homepage's
 * bundle having shrunk — measured, it grew by 12.3KB gzipped. See the header of
 * feeds-podcasts.js.
 */
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js?v=ob-v93'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v93'
import { copyText, showToast, copyNpub } from '/assets/js/copy-npub.js?v=ob-v93'
import { withBoostBusy } from '/assets/js/boost-button.js?v=ob-v93'
import { wireArt2, blankTile, hydrateProfiles } from '/assets/js/detail-page.js?v=ob-v93'
// The row renderer, for a drawer that fills on open. THE SAME FUNCTION the edge
// and the inline card run, so a row fetched here is byte-identical to one that
// shipped in the document. episode-card.js is already in the graph on every
// surface this module runs on, so a static import costs nothing.
import { boostRowsHtml, namesFrom } from '/assets/js/episode-card.js?v=ob-v93'
import { normalizeBoosts, toEpisodeShape } from '/assets/js/ob-data.js?v=ob-v93'

const VALUE_API = '/api/value'   // Podcast Index value-block proxy (splits)

// ── Entry point ──────────────────────────────────────────────────────
/**
 * Wire every episode card under `root` that isn't wired already.
 *
 * Idempotent by a marker attribute rather than by the caller keeping track: the
 * homepage appends a page of cards to a container that already holds thirty, and
 * /episode's community drawer rebuilds its list on every re-sort. Calling this on
 * the whole container after either is the simple thing, so it has to be the
 * correct thing.
 *
 * Safe on a root with no cards, which is why every page module can call it
 * unconditionally.
 */
export function wireEpisodeCards(root) {
  const cards = Array.from(root?.querySelectorAll?.('[data-episode-card]:not([data-wired])') || [])
  if (!cards.length) return
  for (const card of cards) {
    card.setAttribute('data-wired', '')
    try { wireCard(card) } catch (err) {
      // One malformed card must not cost the other twenty-nine their verbs.
      console.warn('[episode-card] wiring failed', err)
    }
  }
}

function wireCard(card) {
  wireArtwork(card)
  wireAvatars(card)
  wireSubscribeMenu(card)
  wireBoostPill(card)
  wireDrawer(card)
}

// ── Artwork ──────────────────────────────────────────────────────────
/* The card's own fallback chain, walked through the same helper the /show and
 * /episode heroes use.
 *
 * The server emitted `src` plus `data-art2` and `data-art3` — episode art, then
 * the show's primary, then the show's second-chance `<itunes:image>`. wireArt2
 * reads exactly those two attributes, so this is the one artwork fallback on the
 * site rather than a feed-shaped copy of it. An exhausted chain drops to the
 * glyph tile the server would have rendered for a show with no artwork at all.
 */
function wireArtwork(card) {
  const img = card.querySelector('.pcast-card-media img')
  if (!img) return
  const media = img.closest('.pcast-card-media')
  wireArt2(img, () => {
    img.remove()
    media?.classList.add('pcast-card-media--none')
    media?.appendChild(document.createTextNode('🎙'))
  })
}

/* A booster avatar whose picture fails to load falls back to the initials chip.
 *
 * `data-initials` is what the server put there for exactly this: it knows the
 * display name and the npub the chip is derived from, and the browser would
 * otherwise have to re-derive them from the row. A dead hotlink is common enough
 * (15% of records carry no picture at all, and a hosted one can go away) that
 * leaving a broken image is not an option.
 */
function wireAvatars(card) {
  for (const img of card.querySelectorAll('img.pcast-avatar[data-initials]')) {
    img.addEventListener('error', () => {
      const chip = document.createElement('span')
      chip.className = img.className.replace('is-interactive', '').trim() + ' pcast-avatar--none'
      chip.setAttribute('style', img.getAttribute('style') || '')
      chip.textContent = img.dataset.initials || '👤'
      img.replaceWith(chip)
    }, { once: true })
  }
}

// ── The ⋮ subscribe menu ─────────────────────────────────────────────
// The links inside it are facts and were rendered by the server; only the
// open/close is attached here, which is why the wrapper ships `hidden` — a ⋮
// that does nothing is worse than no ⋮.
function wireSubscribeMenu(card) {
  const wrap = card.querySelector('[data-subscribe-menu]')
  if (!wrap) return
  const btn = wrap.querySelector('.pcast-cardmenu-btn')
  const menu = wrap.querySelector('.pcast-cardmenu-menu')
  if (!btn || !menu) return
  wrap.hidden = false
  attachMenu({ wrap, btn, menu })
  for (const a of menu.querySelectorAll('a')) a.addEventListener('click', () => closeMenu({ btn, menu }))
}

/* One popup's open/close, shared by the two menus on a card.
 *
 * Both close on an outside click, on Escape, and scroll themselves into view on
 * open. That last one is not cosmetic: the menu is position:absolute and opens
 * downward, so on the homepage it can land below the fold and inside
 * /episode's community drawer it can land past the bottom of a scroll container
 * that clips it. `block: 'nearest'` is a no-op when the menu is already fully
 * visible, so it costs the common case nothing.
 */
function attachMenu({ wrap, btn, menu, stop = false }) {
  const onDoc = (e) => { if (!wrap.contains(e.target)) closeMenu({ btn, menu }) }
  const onKey = (e) => { if (e.key === 'Escape') closeMenu({ btn, menu }) }

  function open() {
    menu.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    try { menu.scrollIntoView({ block: 'nearest' }) } catch {}
    document.addEventListener('click', onDoc, true)
    document.addEventListener('keydown', onKey)
  }
  // Held on the element so closeMenu can reach them from anywhere.
  menu._obClose = () => {
    document.removeEventListener('click', onDoc, true)
    document.removeEventListener('keydown', onKey)
  }
  btn.addEventListener('click', (e) => {
    if (stop) e.stopPropagation()
    menu.hidden ? open() : closeMenu({ btn, menu })
  })
}

function closeMenu({ btn, menu }) {
  menu.hidden = true
  btn.setAttribute('aria-expanded', 'false')
  menu._obClose?.()
}

// ── The boost pill ───────────────────────────────────────────────────
/* Reveal the pill the server rendered, and own the click.
 *
 * ⚠️ THE HANDLER IS THIS SURFACE'S, NOT boost-button.js's. That module is chrome
 * and deliberately does not know what a boost pays; every caller owns its own
 * resolve-and-pay sequence because an episode, a show and another show's row all
 * pay different things. What changed is that the four surfaces showing an EPISODE
 * card now share one handler instead of the feed owning it and two page modules
 * borrowing the feed's — see the boost table in CLAUDE.md.
 *
 * IT DOES NOT PROBE. Resolving a value block per card would be one Podcast Index
 * round trip per card on a page that can hold thirty, so the pill appears
 * optimistically and an unpayable show is reported in a toast at click time. Same
 * behaviour as the /show community rows.
 */
function wireBoostPill(card) {
  const btn = card.querySelector('[data-boost-episode]')
  if (!btn) return
  btn.hidden = false
  btn.addEventListener('click', (e) => {
    // The card behind it is clickable in places — the art, the title and the
    // show name are all links — so a boost must never also navigate.
    e.preventDefault()
    e.stopPropagation()
    if (btn.disabled) return
    onBoostClick(card, btn)
  })
}

// After openExternalBoost, the widget's gate chain (session restore / wallet
// unlock) can run for several seconds on a cold widget before any modal shows.
// Wait for a modal to appear so the button can stay in its loading state until
// then, instead of reverting and looking like nothing happened.
function waitForModal(timeoutMs = 40000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const tick = () => {
      if (document.querySelector('[role="dialog"]')) return resolve('modal')
      if (Date.now() - t0 > timeoutMs) return resolve('timeout')
      setTimeout(tick, 200)
    }
    tick()
  })
}

/* Resolve this episode's value block live from Podcast Index (via /api/value),
 * apply the external overrides, then hand off to the widget's external-boost
 * modal. No value block → a toast, no modal.
 *
 * Everything it needs comes off the card's data attributes, because there is no
 * item object to close over: the card may have been built by a Pages Function
 * that finished running before this module loaded. The data feed carries no
 * Podcast Index numeric id, so the show is identified by its guid / RSS URL and
 * /api/value resolves the id server-side.
 */
async function onBoostClick(card, btn) {
  const d = card.dataset
  const noun = d.noun || 'episode'
  const feedId = d.feedId || null
  const podcastGuid = d.showGuid || null
  const feedUrl = d.feedUrl || null
  const guid = d.guid || null
  if (!feedId && !podcastGuid && !feedUrl) {
    showToast('Can’t identify this show’s feed', true); return
  }

  await withBoostBusy(btn, async () => {
    try {
      const qs = new URLSearchParams()
      if (feedId) qs.set('feedId', String(feedId))
      else {
        if (podcastGuid) qs.set('podcastGuid', podcastGuid)
        if (feedUrl) qs.set('feedUrl', feedUrl)
      }
      if (guid) qs.set('guid', guid)

      let data = null
      try {
        const resp = await fetch(`${VALUE_API}?${qs}`, { headers: { Accept: 'application/json' } })
        // Distinguish a server/config error (the value proxy is down, the PI keys
        // aren't set) from a genuine "this episode has no value block" —
        // otherwise an outage looks like every episode is un-boostable.
        if (!resp.ok) { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
        data = await resp.json()
      } catch { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
      if (data && data.error) { showToast('Boost splits are unavailable right now.', true); return }

      const parsed = fromApiValue(data)
      if (!parsed) { showToast(`This ${noun} has no value block to boost.`, true); return }

      const recipients = applyExternalOverrides(parsed.recipients)
      const totalWeight = recipients.reduce((a, r) => a + (r.splitWeight || 0), 0)
      if (!recipients.length || totalWeight <= 0) { showToast(`This ${noun} has no payable recipients.`, true); return }

      await ensureLoginWidget()
      if (!window.LBLogin?.openExternalBoost) { showToast('Boost is unavailable right now.', true); return }
      window.LBLogin.openExternalBoost({
        episode: {
          showTitle: d.showTitle || '',
          episodeTitle: d.title || '',
          podcastGuid: podcastGuid || '',
          itemGuid: guid || '',
          // ⚠️ THE LINK THE PUBLISHED NOTE CARRIES, resolved by
          // episode-link.js#episodeBoostLink when the card was rendered rather
          // than from location.href. Every surface that can start an external
          // boost passes the same builder's answer, so one episode boosted from
          // two pages cannot produce two different notes. It is absolute because
          // the string is read wherever the event is rendered.
          bmbUrl: d.boostUrl || '',
        },
        recipientsBundle: { recipients, totalWeight },
      })
      // Hold the busy state until a modal (boost / login / wallet) opens.
      await waitForModal()
    } catch (e) {
      console.warn('[episode-card] boost failed', e)
      showToast('Couldn’t start the boost — try again.', true)
    }
  })
}

// ── The drawer ───────────────────────────────────────────────────────
/* <details> opens on its own; this adds what it cannot.
 *
 * ⚠️ ON THE DETAIL PAGES THE ROWS ARE ALREADY IN THE DOCUMENT. The old DOM
 * builder created them on first open, which is why a crawler saw an episode
 * card with no boosts under it and why this section could not exist without
 * JavaScript. They are facts and they ship; what is deferred is the ~200KB of
 * reaction machinery behind them, which is the part worth deferring.
 *
 * ⚠️ ON THE HOMEPAGE THEY ARE NOT (`data-lazy-boosts` on the body), and the
 * first open fetches them — see `drawer` under CARD_PARTS in episode-card.js
 * for the measurement that decided it. The fetch is the one thing here that
 * can fail, so the enrichment guard is set only once rows are on screen: a
 * failed open leaves a status line and the footer's "See all boosts" link, and
 * the next open tries again.
 *
 * `toggle` fires on open AND on close, so the one-shot guard is explicit.
 */
function wireDrawer(card) {
  const details = card.querySelector('.pcast-card-details')
  if (!details) return

  const hide = details.querySelector('[data-drawer-hide]')
  if (hide) {
    hide.hidden = false
    hide.addEventListener('click', () => {
      details.open = false
      // Back to the head of the card, so closing from the foot of a long thread
      // doesn't leave the reader somewhere below where they started.
      try { card.scrollIntoView({ block: 'nearest' }) } catch {}
    })
  }

  let enriched = false
  let filling = false
  details.addEventListener('toggle', async () => {
    if (!details.open || enriched || filling) return
    const body = details.querySelector('.pcast-details[data-lazy-boosts]')
    if (body) {
      filling = true
      let ok = false
      try { ok = await fillLazyDrawer(card, body) }
      finally { filling = false }
      // The reader may have closed it while the rows were in flight; the rows
      // are in place either way, so the next open finds them and needs nothing.
      if (!ok) return
      // The rows arrived after wireCard ran, so the two per-card passes that
      // touched the inline rows run again over these: the avatar error
      // fallback, and the Primal backfill for whatever the index couldn't name.
      wireAvatars(details)
      hydrateCardProfiles(details)
    }
    enriched = true
    for (const row of details.querySelectorAll('.pcast-boost')) wireBoostMenu(row)
    attachActionBars(details)
  })
}

/* Fetch one episode's boosts and render them into a lazy drawer.
 *
 * `/api/v1/episodes/<guid>?names=1` is the endpoint /episode/<guid>#boosts
 * already rebuilds its rows from: every boost sent to the episode (capped at
 * 500 against a measured worst case of 55), in the published record shape,
 * plus the display names for any npub MENTIONED in a message. So a homepage
 * drawer holds the episode's whole thread where the inline cap was 50, and its
 * @mention chips come off the same D1 lookup the detail pages use.
 *
 * The rows go through normalizeBoosts → toEpisodeShape, which is the chain
 * every card is built from, and then boostRowsHtml — the function that renders
 * an inline drawer. `data-lazy-boosts` comes off on success and the guard in
 * wireDrawer takes it from there; on failure the attribute stays, the status
 * line says so, and the footer's link to the episode page is the way through.
 *
 * ⚠️ item_guid IS NOT ALWAYS A UUID — 9% carry a slash and some are full URLs —
 * so it is encoded whole into one path segment, exactly as /episode/<guid> is.
 * Returns true when rows are on screen.
 */
async function fillLazyDrawer(card, body) {
  const guid = card.dataset.guid
  if (!guid) return false
  const foot = body.querySelector('.pcast-details-foot')
  let status = body.querySelector('.pcast-boosts-status')
  if (!status) {
    status = el('div', { class: 'pcast-boosts-status', role: 'status' })
    body.insertBefore(status, foot || null)
  }
  status.textContent = 'Loading boosts…'
  try {
    const res = await fetch(`/api/v1/episodes/${encodeURIComponent(guid)}?names=1`, {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const shaped = toEpisodeShape(normalizeBoosts({ boosts: data?.boosts || [] }))
    // Newest first, the order buildEpisodes gives an inline drawer.
    const rows = shaped.boosts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    // Booster names first, then the mention lookup on top — the server's map
    // is the better answer for a chip and the profiles fill in behind it.
    const names = namesFrom(shaped.profiles)
    for (const [pk, name] of Object.entries(data?.names || {})) if (name) names.set(pk, name)
    const html = boostRowsHtml(rows, shaped.profiles, names)
    status.remove()
    if (foot) foot.insertAdjacentHTML('beforebegin', html)
    else body.insertAdjacentHTML('beforeend', html)
    body.removeAttribute('data-lazy-boosts')
    return true
  } catch (err) {
    console.warn('[episode-card] drawer fetch failed', err)
    status.textContent = foot?.querySelector('.pcast-seeall')
      ? 'Couldn’t load these boosts. “See all boosts” below has every one.'
      : 'Couldn’t load these boosts.'
    return false
  }
}

/* The per-boost ⋮ menu: copy npub, copy nevent.
 *
 * Built rather than revealed, unlike the subscribe menu above: both items are
 * clipboard gestures, so there is no link for the server to have rendered and
 * nothing to say without JavaScript. Copy npub is here because the avatar and
 * the name above it stopped copying when they became links to /booster/<npub> —
 * one click away rather than one navigation, which matters for the reader who
 * wants the npub precisely so they do NOT have to go somewhere else for it.
 */
function wireBoostMenu(row) {
  const wrap = row.querySelector('[data-boost-menu]')
  if (!wrap || wrap.dataset.built) return
  wrap.dataset.built = '1'

  const eventId = row.dataset.eventId || ''
  const pubkey = row.dataset.pubkey || ''
  const npub = row.dataset.npub || pubkey

  const btn = el('button', { class: 'pcast-more-btn', type: 'button', 'aria-label': 'More options', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, '⋮')
  const menu = el('div', { class: 'pcast-more-menu', hidden: 'hidden' })
  if (npub) {
    const b = el('button', { class: 'pcast-more-item', type: 'button' }, 'Copy npub')
    b.addEventListener('click', () => { closeMenu({ btn, menu }); copyNpub(npub) })
    menu.appendChild(b)
  }
  if (eventId) {
    const b = el('button', { class: 'pcast-more-item', type: 'button' }, 'Copy nevent')
    b.addEventListener('click', () => { closeMenu({ btn, menu }); copyNevent(eventId, pubkey) })
    menu.appendChild(b)
  }
  wrap.append(btn, menu)
  wrap.hidden = false
  attachMenu({ wrap, btn, menu, stop: true })
}

/* nostr-tools, and ONLY here.
 *
 * Encoding an nevent is the one thing on this card that needs it, and it happens
 * on a click inside a menu inside a drawer. A static import would put 102KB in
 * front of every visitor for a gesture almost nobody makes; a dynamic one costs
 * the person making it a moment. The bundle is usually already in the graph by
 * then anyway — boost-actions.js pulled it when the drawer opened.
 */
async function copyNevent(eventId, author) {
  let nevent = ''
  try {
    const { nip19 } = await import('/assets/widgets/nostr-tools.js?v=ob-v93')
    nevent = nip19.neventEncode({ id: eventId, author: author || undefined })
  } catch {}
  if (!nevent) { showToast('Could not build nevent', true); return }
  const ok = await copyText(nevent)
  showToast(ok ? 'nevent copied' : 'Copy failed — clipboard blocked', !ok)
}

/* Reply / like / repost / zap on every note in an opened drawer.
 *
 * ⚠️ THE EVENT PASSED TO buildActionBar IS A PROJECTION, NOT A SIGNED EVENT.
 * It is built from the row's data attributes and carries no `sig` and no real
 * `tags` — the boost record the collector publishes does not include the signed
 * event, and neither does D1. Reply, like and zap need only the id and the
 * pubkey; `content` is here because the reply composer quotes it, and it is read
 * back out of the DOM rather than duplicated into an attribute. REPOST is the
 * one that needs the note itself, which is why it fetches rather than
 * re-broadcasting this object — a silent failure that was fixed in b6c0bd4 and
 * that this shape would otherwise reintroduce. Nothing may pass it anywhere that
 * assumes a verified event.
 *
 * The same projection and the same caveat as boost-note-actions.js#projectEvent;
 * the two differ only in which classes they read, because a .note-card and a
 * .pcast-boost are different objects.
 */
async function attachActionBars(details) {
  let actions
  try {
    actions = await import('/assets/js/boost-actions.js?v=ob-v93')
    // The signer. Without it the bar still renders and each button reports that
    // it needs a sign-in, which is the same behaviour every other surface has.
    await ensureLoginWidget()
    actions.configureBoostActions({})
  } catch (err) {
    // The notes are complete and readable without this. A failed import must
    // cost the reactions and nothing else.
    console.warn('[episode-card] actions unavailable', err)
    return
  }

  for (const row of details.querySelectorAll('.pcast-boost[data-event-id]')) {
    if (row.dataset.barred) continue
    row.dataset.barred = '1'
    const ev = {
      id: row.dataset.eventId,
      pubkey: row.dataset.pubkey,
      kind: 1,
      content: row.querySelector('.pcast-boost-msg')?.textContent || '',
      created_at: Number(row.dataset.ts) || 0,
      tags: [],
    }
    if (!ev.id || !ev.pubkey) continue
    try { row.appendChild(actions.buildActionBar(ev, row)) }
    catch (err) { console.warn('[episode-card] action bar failed', err) }
  }
}

// ── Profiles ─────────────────────────────────────────────────────────
/**
 * Fill the names and faces the index couldn't, from Primal's cache.
 *
 * A thin pass-through to detail-page.js#hydrateProfiles, which is the one
 * implementation of this on the site: the server marks exactly the elements it
 * could not fill with `data-pk` + `data-missing`, and that function patches them
 * and clears the attribute. It is re-exported here so a caller wiring cards does
 * not have to know that the community wall's backfill and the card's are the
 * same code — they are, and that is the point.
 *
 * Always post-paint and best-effort: every card is complete and readable from
 * the index alone, and an unreachable cache changes nothing.
 */
export function hydrateCardProfiles(root) {
  return hydrateProfiles(root).catch((err) => {
    console.warn('[episode-card] profile backfill unavailable', err)
  })
}

/** Pre-warm the boost widget so the first Boost click isn't a cold start. */
export function prewarmBoosting(delayMs = 1200) {
  setTimeout(() => { ensureLoginWidget().catch(() => {}) }, delayMs)
}

// ── Tiny DOM helper ──────────────────────────────────────────────────
function el(tag, attrs = {}, text = null) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  if (text != null) node.textContent = text
  return node
}
