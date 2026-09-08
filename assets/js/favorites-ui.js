/**
 * favorites-ui.js — the Favorite hearts on every page: reveal, paint, toggle.
 *
 * Loaded on EVERY page by nav.js (a dynamic import at the end of its IIFE),
 * lazily: a page with no hearts costs the module and no relay read. One
 * controller per page:
 *
 *   1. Reads the signed-in member's list ONCE (favorites-sync.js#fetchFavorites)
 *      and paints every `[data-fav]` button on the page from it: revealed,
 *      and filled where the list holds that show, episode or artist. A
 *      MutationObserver paints buttons that arrive later (a feed re-sort, a
 *      drawer opening), so no renderer has to call anything.
 *   2. Handles the click by delegation: one publish cycle through
 *      favorites-sync.js#syncFavorites, with the busy state on the button,
 *      the Public/Private question the first time, and a toast for every
 *      outcome that is not a quiet success.
 *   3. Re-reads on `lb:session-change`, so a login paints hearts and a logout
 *      hides them.
 *   4. Exposes `window.OBFavorites` — `getMode()`, `setMode(mode)`, `reload()`
 *      — for the account menu's Favorites row in the widget, which is a
 *      React component in the bundle and cannot import a site module. A mode
 *      change from the menu is a whole-list move and runs the same publish
 *      cycle as a heart, with `userChose` set, because the spec lets only a
 *      choice flip a list's half.
 *
 * ⚠️ SIGNED OUT GETS NOTHING (Reed, 2026-09-06). The buttons ship `hidden` and
 * are revealed only when a session pubkey exists. That pubkey is read the way
 * follow-set.js reads it — off localStorage, or off the widget if it happens
 * to be loaded — so painting hearts on a cold page costs no widget load. The
 * widget is loaded on the FIRST CLICK, through the nav's own loader, because
 * signing needs it; the read of the public half does not.
 *
 * ⚠️ THE MIGRATION GATE: `ITEMS_ALLOWED` is false until both shipped apps read
 * the three-element item (docs/favorites.md). While false, episode hearts are
 * never revealed, so nothing on screen promises what the writer refuses.
 *
 * ⚠️ THE PRIVATE HALF IS PAINTED ONLY ONCE THE WIDGET IS LOADED, because
 * opening it needs the signer. A member with a private list sees empty hearts
 * until their first click (or a login on this page) brings the widget in,
 * after which the list is re-read with NIP-44 and the hearts fill. That is a
 * known cost of not loading 1MB to draw an outline.
 */
import { fetchFavorites, syncFavorites, widgetDeps, saveMode, loadMode } from '/assets/js/favorites-sync.js?v=ob-v204'
import { statedVisibility } from '/assets/js/favorites-merge.js?v=ob-v204'
import { setFavoriteState, changeFor, keyFor } from '/assets/js/favorite-button.js?v=ob-v204'
import { getSessionPubkey } from '/assets/js/follow-set.js?v=ob-v204'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v204'

/** Flip to true when Chad confirms BMB and StableKraft read `["i", feed, item]`. */
export const ITEMS_ALLOWED = false

const WIDGET_SRC = '/assets/widgets/login-widget.js?v=ob-v204'

const state = {
  pubkey: null,
  keys: new Set(),     // what the member's list holds, as favorites-merge keys
  trusted: false,
  privateOpened: false,
  loading: null,
  everRead: false,     // the lazy read: a page with no hearts never reads
}

/* ------------------------------------------------------------------------ */
/* Painting                                                                  */

function buttons(root = document) {
  return root.querySelectorAll ? root.querySelectorAll('[data-fav]') : []
}

function allowed(btn) {
  if (btn.dataset.fav === 'episode') return ITEMS_ALLOWED
  return btn.dataset.fav === 'show' || btn.dataset.fav === 'artist'
}

function paint(btn) {
  if (!state.pubkey || !allowed(btn)) { btn.hidden = true; return }
  if (!state.everRead && !state.loading) reload()
  btn.hidden = false
  const key = keyFor(btn)
  setFavoriteState(btn, state.trusted ? state.keys.has(key) : null)
}

function paintAll(root = document) {
  for (const btn of buttons(root)) paint(btn)
}

/* ------------------------------------------------------------------------ */
/* Reading the list                                                          */

function keysOf(entries) {
  const keys = new Set()
  for (const e of entries ?? []) {
    if (e.kind === 'podcast:item:guid') {
      if (e.feed) keys.add(`${e.id} @ ${e.feed}`)
    } else keys.add(e.id)
  }
  return keys
}

async function load({ withWidget = false } = {}) {
  const pubkey = getSessionPubkey()
  state.pubkey = pubkey
  state.everRead = true
  if (!pubkey) {
    state.keys = new Set(); state.trusted = false; state.privateOpened = false
    paintAll()
    return
  }
  // Paint the outlines at once; the fill follows the read.
  paintAll()
  const deps = withWidget && window.LBLogin ? await widgetDeps(window.LBLogin) : { pubkey }
  if (deps.pubkey && deps.pubkey !== pubkey) return // the widget knows a different account; the session change will re-run
  try {
    const r = await fetchFavorites(pubkey, { ...deps, pubkey })
    if (state.pubkey !== pubkey) return
    state.trusted = r.trusted
    if (r.trusted) {
      state.keys = keysOf(r.entries)
      state.privateOpened = r.parsedPrivate !== null
    }
  } catch (err) {
    console.warn('[favorites] read failed', err)
    state.trusted = false
  }
  paintAll()
}

function reload(opts) {
  state.loading = load(opts).finally(() => { state.loading = null })
  return state.loading
}

/* ------------------------------------------------------------------------ */
/* The widget, on the first click                                            */

function ensureWidget() {
  if (window.LBLogin) return Promise.resolve()
  if (typeof window.__lbEnsureWidget === 'function') return window.__lbEnsureWidget()
  return new Promise((resolve, reject) => {
    if (!document.querySelector('script[src*="login-widget.js"]')) {
      const s = document.createElement('script')
      s.src = WIDGET_SRC
      s.async = true
      s.onerror = () => reject(new Error('Failed to load login widget'))
      document.head.appendChild(s)
    }
    const started = Date.now()
    const iv = setInterval(() => {
      if (window.LBLogin) { clearInterval(iv); resolve(); return }
      if (Date.now() - started > 15000) { clearInterval(iv); reject(new Error('login widget load timed out')) }
    }, 60)
  })
}

/* ------------------------------------------------------------------------ */
/* The Public / Private question                                             */

/**
 * The first favorite on a list that cannot say which half it lives in. The
 * spec allows no default, so this is a real question with two answers and a
 * way out. Resolves to 'public' | 'private' | null.
 */
function askMode() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.className = 'ob-fav-ask'
    wrap.setAttribute('role', 'dialog')
    wrap.setAttribute('aria-modal', 'true')
    wrap.setAttribute('aria-labelledby', 'ob-fav-ask-title')
    wrap.innerHTML =
      `<div class="ob-fav-ask-card">` +
        `<h2 id="ob-fav-ask-title">Who can see your favorites?</h2>` +
        `<p>Your favorites are saved to your Nostr account so other podcast apps can show them too. Choose once; you can change it later in the account menu.</p>` +
        `<div class="ob-fav-ask-row">` +
          `<button type="button" class="ob-fav-ask-btn" data-mode="public"><strong>Public</strong><span>Anyone can see what you favorite</span></button>` +
          `<button type="button" class="ob-fav-ask-btn" data-mode="private"><strong>Private</strong><span>Encrypted so only you can read the list</span></button>` +
        `</div>` +
        `<button type="button" class="ob-fav-ask-cancel" data-cancel>Not now</button>` +
      `</div>`
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v) }
    const onKey = (e) => { if (e.key === 'Escape') done(null) }
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-mode]')
      if (b) { done(b.dataset.mode); return }
      if (e.target.closest?.('[data-cancel]') || e.target === wrap) done(null)
    })
    document.addEventListener('keydown', onKey)
    document.body.appendChild(wrap)
    wrap.querySelector('[data-mode="public"]')?.focus()
  })
}

/* ------------------------------------------------------------------------ */
/* The click                                                                 */

const MESSAGES = {
  degraded: 'Couldn’t reach enough relays to read your favorites safely. Nothing was changed; try again in a moment.',
  'not-landed': 'No relay accepted the update. Nothing was changed; try again in a moment.',
  'no-nip44': 'Your signer can’t encrypt a private list, so this favorite wasn’t saved.',
  'items-gated': 'Episode favorites are coming soon; other apps can’t read them yet. Until then a list holding episodes from another app can’t be changed here.',
  'sign-failed': 'Your signer didn’t sign the update, so nothing was changed.',
  'bad-change': 'This one can’t be favorited.',
}

async function onClick(btn) {
  if (btn.disabled) return
  const wasOn = btn.getAttribute('aria-pressed') === 'true'
  btn.disabled = true
  btn.classList.add('is-busy')
  try {
    await ensureWidget()
    const user = window.LBLogin?.getUser?.()
    if (!user?.pubkey) { window.LBLogin?.requestLogin?.(); return }

    // The widget is here now: if the private half was never opened, open it
    // before deciding anything, or an entry hidden in it reads as absent.
    if (!state.privateOpened || state.pubkey !== user.pubkey) await reload({ withWidget: true })

    const deps = await widgetDeps(window.LBLogin)
    const base = { ...deps, store: window.localStorage, itemsAllowed: ITEMS_ALLOWED }
    const change = changeFor(btn, wasOn)
    let r = await syncFavorites(change, base)

    if (r.status === 'needs-mode') {
      const mode = await askMode()
      if (!mode) return
      saveMode(window.localStorage, deps.pubkey, mode)
      r = await syncFavorites(change, { ...base, mode, userChose: true })
    }

    if (r.status === 'published' || r.status === 'unchanged') {
      const key = keyFor(btn)
      if (wasOn) state.keys.delete(key); else state.keys.add(key)
      state.trusted = true
      for (const b of buttons()) if (keyFor(b) === key) paint(b)
      if (r.status === 'published') showToast(wasOn ? 'Removed from your favorites' : 'Added to your favorites')
      return
    }
    showToast(MESSAGES[r.status] || 'Couldn’t update your favorites.', true)
    console.warn('[favorites] sync', r)
  } catch (err) {
    console.warn('[favorites] click failed', err)
    showToast('Couldn’t update your favorites.', true)
  } finally {
    btn.disabled = false
    btn.classList.remove('is-busy')
  }
}

/* ------------------------------------------------------------------------ */
/* The account menu's API                                                    */

/**
 * The list's mode as this member would see it in a setting: the choice
 * stored here, else what the list itself says (its visibility tag, or the
 * half that holds entries), else null. `source` says which answered.
 */
async function getMode() {
  const pubkey = getSessionPubkey()
  if (!pubkey) return { mode: null, source: 'signed-out' }
  const stored = loadMode(window.localStorage, pubkey)
  if (stored) return { mode: stored, source: 'setting' }
  try {
    const r = await fetchFavorites(pubkey, { pubkey })
    if (!r.trusted) return { mode: null, source: 'unknown' }
    const stated = statedVisibility(r.read.tags)
    if (stated) return { mode: stated, source: 'list' }
    const hasPublic = r.read.tags.some((t) => t[0] === 'i')
    const hasContent = !!r.read.content
    if (hasPublic && !hasContent) return { mode: 'public', source: 'list' }
    if (hasContent && !hasPublic) return { mode: 'private', source: 'list' }
    return { mode: null, source: hasPublic || hasContent ? 'ambiguous' : 'empty' }
  } catch {
    return { mode: null, source: 'unknown' }
  }
}

/**
 * Change the list's mode: a whole-list move, published through the same
 * cycle as a heart with `userChose` set. Resolves to the sync result; on
 * anything but success the stored choice is put back so the menu does not
 * show a state the list does not have.
 */
async function setMode(mode) {
  if (mode !== 'public' && mode !== 'private') return { status: 'bad-change' }
  try {
    await ensureWidget()
    const user = window.LBLogin?.getUser?.()
    if (!user?.pubkey) { window.LBLogin?.requestLogin?.(); return { status: 'signed-out' } }
    const deps = await widgetDeps(window.LBLogin)
    const previous = loadMode(window.localStorage, deps.pubkey)
    saveMode(window.localStorage, deps.pubkey, mode)
    const r = await syncFavorites(null, { ...deps, store: window.localStorage, itemsAllowed: ITEMS_ALLOWED, mode, userChose: true })
    if (r.status === 'published' || r.status === 'unchanged') {
      await reload({ withWidget: true })
      showToast(mode === 'private' ? 'Your favorites are private now' : 'Your favorites are public now')
      return r
    }
    saveMode(window.localStorage, deps.pubkey, previous)
    showToast(MESSAGES[r.status] || 'Couldn’t change that.', true)
    console.warn('[favorites] setMode', r)
    return r
  } catch (err) {
    console.warn('[favorites] setMode failed', err)
    showToast('Couldn’t change that.', true)
    return { status: 'error' }
  }
}

/* ------------------------------------------------------------------------ */
/* Boot                                                                      */

function boot() {
  window.OBFavorites = { getMode, setMode, reload: () => reload({ withWidget: true }), ITEMS_ALLOWED }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-fav]')
    if (!btn) return
    // A card behind it may be a link; a favorite must never also navigate.
    e.preventDefault()
    e.stopPropagation()
    onClick(btn)
  }, true)

  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.matches?.('[data-fav]')) paint(node)
        paintAll(node)
      }
    }
  })
  mo.observe(document.body, { childList: true, subtree: true })

  window.addEventListener('lb:session-change', () => reload({ withWidget: true }))
  window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') reload() })

  // Lazy: read only when this page has a heart to paint. A page without one
  // (about, stats) loads the module for the menu's API and nothing more.
  if (buttons().length) reload()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
}
