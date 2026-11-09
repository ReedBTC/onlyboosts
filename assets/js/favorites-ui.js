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
 * THE MIGRATION GATE IS LIFTED (2026-10-03). `ITEMS_ALLOWED` kept the episode
 * hearts hidden until both shipped apps read the three-element item; both
 * have since 2026-09-08, so the three kinds are revealed alike now. See
 * docs/favorites.md.
 *
 * ⚠️ THE PRIVATE HALF IS PAINTED ONLY ONCE THE WIDGET IS LOADED, because
 * opening it needs the signer. A member with a private list sees empty hearts
 * until their first click (or a login on this page) brings the widget in,
 * after which the list is re-read with NIP-44 and the hearts fill. That is a
 * known cost of not loading 1MB to draw an outline.
 */
import { fetchFavorites, syncFavorites, widgetDeps, saveMode, loadMode } from '/assets/js/favorites-sync.js?v=ob-v268'
import { statedVisibility, feedGuidOf } from '/assets/js/favorites-merge.js?v=ob-v268'
import { setFavoriteState, changeFor, keyFor, isFollow, WORD_BUSY, WORD_WAIT } from '/assets/js/favorite-button.js?v=ob-v268'
import { getSessionPubkey } from '/assets/js/follow-set.js?v=ob-v268'
import { buildOpml, opmlFilename } from '/assets/js/opml.js?v=ob-v268'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v268'
import { initAccountSettings, noteSettingsChange } from '/assets/js/account-settings.js?v=ob-v268'

const WIDGET_SRC = '/assets/widgets/login-widget.js?v=ob-v268'

const state = {
  pubkey: null,
  keys: new Set(),     // what the member's list holds, as favorites-merge keys
  feeds: [],           // the feed guids on it (feeds, and the feeds of item entries), for the recommendations
  trusted: false,
  privateOpened: false,
  privateUnread: false, // the list has an encrypted half this read could not open
  loading: null,
  everRead: false,     // the lazy read: a page with no hearts never reads
  local: false,        // signed out, with a list imported from OPML in this browser (see below)
}

/* ------------------------------------------------------------------------ */
/* The local list: an OPML import with no account                            */

/* ⚠️ A VISITOR WITH NO NOSTR ACCOUNT CAN IMPORT THEIR OPML (Reed's ask,
 * 2026-11-07: the recommendations are the carrot, and a subscription list is
 * enough to seed them). The list lives in THIS BROWSER ONLY, under
 * LOCAL_KEY, as rows { guid, title, medium, image, feed }: it is what the
 * resolve endpoint answered, nothing the person typed. It is durable across
 * sessions (Reed: fine, it is not sensitive), it is the feeds `OBFavorites`
 * reports while signed out, and it is offered for saving to the Nostr list
 * on the first trusted read after a login (`offerLocalMerge`), then cleared.
 * Hearts stay hidden signed out as before; the panel is where the list is
 * managed (Forget, remove one, Export). */
const LOCAL_KEY = 'ob_local_follows'
function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    const rows = raw ? JSON.parse(raw)?.rows : null
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.guid === 'string' && r.guid) : []
  } catch { return [] }
}
function saveLocal(rows) {
  try {
    if (!rows.length) localStorage.removeItem(LOCAL_KEY)
    else localStorage.setItem(LOCAL_KEY, JSON.stringify({ v: 1, at: Date.now(), rows }))
  } catch {}
}
function addLocal(rows) {
  const have = loadLocal()
  const seen = new Set(have.map((r) => r.guid))
  let added = 0
  for (const r of rows) {
    if (!r?.guid || seen.has(r.guid)) continue
    seen.add(r.guid)
    have.push({ guid: r.guid, title: r.title ?? null, medium: r.medium ?? null, image: r.image ?? null, feed: r.feed ?? null })
    added++
  }
  saveLocal(have)
  return added
}

/* ------------------------------------------------------------------------ */
/* Painting                                                                  */

function buttons(root = document) {
  return root.querySelectorAll ? root.querySelectorAll('[data-fav]') : []
}

function allowed(btn) {
  const k = btn.dataset.fav
  return k === 'show' || k === 'episode' || k === 'artist'
}

function paint(btn) {
  if (!allowed(btn)) { btn.hidden = true; return }
  /* ⚠️ THE FIRST BUTTON ON A PAGE STARTS THE READ, BEFORE THE SIGNED-IN
   * GATE. The read is what learns the session (`state.pubkey`), so with the
   * gate first a button that arrived before any read was hidden and the read
   * never asked for: /booster's rows are made after the list is read, the
   * page has no other heart, and the owner's Follow buttons stayed hidden
   * (Reed's phone, 2026-11-08; a desktop passed on timing alone). reload()
   * sets the pubkey and paints every button synchronously before its first
   * await, so the fall-through below sees the fresh state. */
  if (!state.everRead && !state.loading) reload()
  if (!state.pubkey) { btn.hidden = true; return }
  btn.hidden = false
  /* ⚠️ A BUTTON IN FLIGHT KEEPS ITS WORD. A click re-reads the list before
   * deciding (below), and that read's first paintAll wrote "Follow" over
   * "Saving…" for the whole wait, so the press looked ignored for twenty
   * seconds (Reed, 2026-11-08). setBusy(btn, false) repaints it at the end. */
  if (btn.classList.contains('is-busy')) return
  const key = keyFor(btn)
  setFavoriteState(btn, knownState(key))
}

/* What the list says about one key: true, false, or null for "cannot say".
 * ⚠️ A KEY ABSENT FROM THE PUBLIC HALF IS NOT "OFF" WHILE A PRIVATE HALF
 * SITS UNOPENED: the page reads without the signer (no prompt on page
 * load), so a private favorite is invisible until the first click opens the
 * half. Painting it off is what made a favorited show look unfavorited. */
function knownState(key) {
  if (!state.trusted) return null
  if (state.keys.has(key)) return true
  return state.privateUnread ? null : false
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

/* The feed guids a list names: every feed entry, and the feed of every item
 * entry (a favorited episode is a signal about its show). Artists are not
 * feeds and are left out. What the recommendations take as seeds.
 *
 * ⚠️ BARE GUIDS, THE FORM D1 STORES. A feed entry's `id` is the whole
 * `podcast:guid:<guid>` identifier and an item entry's `feed` is already bare
 * (parse() strips it); the first paint of this sent the identifier, nothing
 * matched a seed, and every followed show stayed recommended (Reed's report,
 * 2026-11-07). */
export function feedGuidsOf(entries) {
  const out = new Set()
  for (const e of entries ?? []) {
    if (e.kind === 'podcast:guid') { const g = feedGuidOf(e.id); if (g) out.add(g) }
    else if (e.kind === 'podcast:item:guid' && e.feed) out.add(e.feed)
  }
  return [...out]
}

/* ⚠️ THE LIST REACHES THE RECOMMENDATIONS THROUGH THIS EVENT (2026-11-07).
 * discover.js listens on window and asks /api/v1/recommend again with the
 * feeds, so a followed show leaves the rails and starts seeding them (the
 * endpoint always took `favorites`; nothing sent them). Fired after every
 * read, trusted or not, so a listener can tell "no list" from "no read". */
function announce() {
  try {
    window.dispatchEvent(new CustomEvent('ob:favorites-read', {
      detail: { pubkey: state.pubkey, trusted: state.trusted, local: state.local, feeds: state.trusted || state.local ? state.feeds.slice() : [] },
    }))
  } catch (err) { console.warn('[favorites] announce', err) }
}

async function load({ withWidget = false } = {}) {
  const pubkey = getSessionPubkey()
  state.pubkey = pubkey
  state.everRead = true
  if (!pubkey) {
    const local = loadLocal()
    state.keys = new Set(); state.trusted = false; state.privateOpened = false; state.privateUnread = false
    state.local = local.length > 0
    state.feeds = local.map((r) => r.guid)
    paintAll()
    announce()
    return
  }
  state.local = false
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
      state.feeds = feedGuidsOf(r.entries)
      // No private content on the list, nothing to open: a click need not
      // read the list again (a new member's every press did, 2026-11-08).
      state.privateOpened = r.parsedPrivate !== null || !r.read?.content
      state.privateUnread = !!r.read?.content && r.parsedPrivate === null
    }
  } catch (err) {
    console.warn('[favorites] read failed', err)
    state.trusted = false
  }
  paintAll()
  announce()
  if (state.trusted && state.pubkey === pubkey && loadLocal().length) offerLocalMerge(pubkey)
}

function reload(opts) {
  lastReadOpts = opts
  state.loading = load(opts).finally(() => {
    state.loading = null
    settleRetry()
  })
  return state.loading
}

/* ------------------------------------------------------------------------ */
/* A degraded read retries itself                                            */

/**
 * The read's guard is right and stays: an untrusted read keeps what is on
 * the device and the hearts paint unknown. But it was the one reader on the
 * page with no way back. On a phone, every launch is a cold page load against
 * a radio that is not up yet, so the first read fails at t=0 and the member
 * saw unknown hearts for the life of the page, or until they pressed one.
 * BMB met the same fault from Android (its #430, 2026-09-23); this is its
 * ladder: three rungs at 2, 8 and 20 seconds, armed when a read ends
 * untrusted, and re-armed from the first rung when the page comes back —
 * `online`, `focus`, or the document turning visible.
 *
 * ⚠️ ONLY A TRUSTED READ RESETS THE BUDGET. A retry's own pass goes through
 * `loading` on its way back to untrusted; resetting on anything but success
 * is a retry storm (BMB measured two reads every four seconds for as long as
 * the page was open). A wake resets it too, deliberately: the fault it is
 * about is the one a wake ends. The retry repeats the read that failed, with
 * the same options, so a read that was going to open the private half still
 * does; a timer never loads the widget on its own.
 */
const READ_RETRY_GAPS_MS = [2_000, 8_000, 20_000]
let retryStep = 0
let retryTimer = null
let lastReadOpts

function readWorthRetrying() {
  return !!state.pubkey && state.everRead && !state.trusted && !state.loading
}

function cancelRetry() {
  clearTimeout(retryTimer)
  retryTimer = null
}

function armRetry() {
  if (retryTimer || retryStep >= READ_RETRY_GAPS_MS.length) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryStep += 1
    if (readWorthRetrying()) reload(lastReadOpts)
  }, READ_RETRY_GAPS_MS[retryStep])
}

/** After every read: a trusted one clears the ladder, an untrusted one arms
 *  the next rung. Nothing here runs a read itself. */
function settleRetry() {
  if (state.trusted || !state.pubkey) { cancelRetry(); retryStep = 0; return }
  armRetry()
}

function onWake() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  retryStep = 0
  cancelRetry()
  if (readWorthRetrying()) reload(lastReadOpts)
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
 * A favorite on a list that holds entries and cannot say which half it lives
 * in (no visibility tag, entries in both halves, or a content this signer
 * cannot open). The spec says ask rather than guess there, and only there: an
 * empty list is public by rule and never reaches this dialog (2026-10-03,
 * Reed's call, following the spec's #47). Resolves to 'public' | 'private' |
 * null.
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
        `<h2 id="ob-fav-ask-title">Who can see your follows and favorites?</h2>` +
        `<p>The podcasts you follow and the music you favorite are saved to your Nostr account as one list, so other podcast apps can show them too. Choose once; you can change it later in the account menu.</p>` +
        `<div class="ob-fav-ask-row">` +
          `<button type="button" class="ob-fav-ask-btn" data-mode="public"><strong>Public</strong><span>Anyone can see what you follow and favorite</span></button>` +
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
  'sign-failed': 'Your signer didn’t sign the update, so nothing was changed.',
  'bad-change': 'This one can’t be favorited.',
}

/* ⚠️ A CLICK CAN LAND BEFORE THE SIGNER IS BACK. The widget boots on a STUB
 * user built from the profile cache and restores the real signer behind it
 * (a NIP-46 reconnect takes seconds), and a stub cannot sign or decrypt: the
 * click used to proceed anyway, read without the private half and fail or
 * misreport. So the click waits for the real session, up to SIGNER_WAIT_MS.
 * `isSessionReady` is the widget's own answer; an older bundle without it
 * falls back to the presence of a signer. */
const SIGNER_WAIT_MS = 20_000
function sessionReady() {
  const w = window.LBLogin
  if (!w) return false
  if (typeof w.isSessionReady === 'function') return w.isSessionReady()
  return !!w.getUser?.()?.pubkey && !!w.getNDK?.()?.signer
}
async function waitForSession() {
  const started = Date.now()
  while (!sessionReady()) {
    if (Date.now() - started > SIGNER_WAIT_MS) return false
    await new Promise((r) => setTimeout(r, 150))
  }
  return true
}

function setBusy(btn, on) {
  btn.disabled = on
  btn.classList.toggle('is-busy', on)
  const word = btn.querySelector('.ob-fav-word')
  if (on && word) word.textContent = on === 'wait' ? WORD_WAIT : WORD_BUSY
  if (!on) paint(btn)
}

async function onClick(btn) {
  if (btn.disabled) return
  /* "Connecting…" until the signer is here, "Saving…" only once a write
     can actually happen (the Coordinator's review, 2026-10-30). */
  setBusy(btn, 'wait')
  try {
    await ensureWidget()
    const user = window.LBLogin?.getUser?.()
    if (!user?.pubkey) { window.LBLogin?.requestLogin?.(); return }
    if (!await waitForSession()) {
      showToast('Your signer is still connecting. Try again in a moment.', true)
      return
    }
    setBusy(btn, true)

    // The signer is here now: if the private half was never opened, open it
    // before deciding anything, or an entry hidden in it reads as absent.
    if (!state.privateOpened || state.pubkey !== user.pubkey) await reload({ withWidget: true })

    /* ⚠️ ADD OR REMOVE IS DECIDED HERE, AFTER THE FULL READ, never off the
     * button as it was painted before the click. A favorite in the private
     * half painted as off, so the click asked to ADD what the list already
     * held, the sync answered `unchanged`, nothing was signed, and the page
     * said nothing at all (Reed, 2026-10-29). */
    const key = keyFor(btn)
    const known = knownState(key)
    if (known === null) {
      showToast(state.trusted && state.privateUnread
        ? 'Your signer couldn’t open your private favorites list, so nothing was changed.'
        : MESSAGES.degraded, true)
      return
    }
    const wasOn = known

    const deps = await widgetDeps(window.LBLogin)
    const base = { ...deps, store: window.localStorage }
    const change = changeFor(btn, wasOn)
    let r = await syncFavorites(change, base)

    if (r.status === 'needs-mode') {
      const mode = await askMode()
      if (!mode) return
      saveMode(window.localStorage, deps.pubkey, mode)
      noteSettingsChange()
      r = await syncFavorites(change, { ...base, mode, userChose: true })
    }

    if (r.status === 'published' || r.status === 'unchanged') {
      if (wasOn) state.keys.delete(key); else state.keys.add(key)
      state.trusted = true
      for (const b of buttons()) if (keyFor(b) === key) paint(b)
      // Every outcome says something: an `unchanged` answer is the list
      // already agreeing, which the reader is owed as much as a publish.
      // A podcast show is followed, everything else favorited (Reed, 2026-11-07).
      showToast(isFollow(btn)
        ? (r.status === 'published'
            ? (wasOn ? 'Unfollowed' : 'Following this podcast')
            : (wasOn ? 'You were not following it' : 'Already following'))
        : (r.status === 'published'
            ? (wasOn ? 'Removed from your favorites' : 'Added to your favorites')
            : (wasOn ? 'Not in your favorites' : 'Already in your favorites')))
      return
    }
    showToast(MESSAGES[r.status] || 'Couldn’t update your favorites.', true)
    console.warn('[favorites] sync', r)
  } catch (err) {
    console.warn('[favorites] click failed', err)
    showToast('Couldn’t update your favorites.', true)
  } finally {
    setBusy(btn, false)
  }
}

/* ------------------------------------------------------------------------ */
/* OPML: import, export, the local list                                      */

const FEED_PREFIX = 'podcast:guid:'
let mergeOffered = null

/**
 * Add a batch of feeds to the list, ONE publish (the OPML import's Add).
 * `rows` are the resolve endpoint's { guid, title, medium, … }. Signed out,
 * they go to the local list. Resolves to { status, added }: `status` is the
 * sync's, or 'local'. Rows already on the list are left as they are; an
 * import never removes (Reed's rule).
 */
async function importFeeds(rows) {
  const user = window.LBLogin?.getUser?.()
  if (!user?.pubkey && !getSessionPubkey()) {
    const added = addLocal(rows)
    await reload()
    return { status: 'local', added }
  }
  await ensureWidget()
  if (!window.LBLogin?.getUser?.()?.pubkey) { window.LBLogin?.requestLogin?.(); return { status: 'signed-out', added: 0 } }
  if (!await waitForSession()) return { status: 'signer-wait', added: 0 }
  const me = window.LBLogin.getUser().pubkey
  if (!state.privateOpened || state.pubkey !== me) await reload({ withWidget: true })
  if (!state.trusted) return { status: 'degraded', added: 0 }
  const changes = []
  for (const r of rows) {
    if (!r?.guid) continue
    const id = FEED_PREFIX + r.guid
    if (state.keys.has(id)) continue
    changes.push({ op: 'add', kind: 'feed', id, medium: r.medium === 'music' ? 'music' : (r.medium || null) })
  }
  if (!changes.length) return { status: 'unchanged', added: 0 }
  const deps = await widgetDeps(window.LBLogin)
  const base = { ...deps, store: window.localStorage }
  let r = await syncFavorites(changes, base)
  if (r.status === 'needs-mode') {
    const mode = await askMode()
    if (!mode) return { status: 'cancelled', added: 0 }
    saveMode(window.localStorage, deps.pubkey, mode)
    noteSettingsChange()
    r = await syncFavorites(changes, { ...base, mode, userChose: true })
  }
  if (r.status === 'published' || r.status === 'unchanged') {
    for (const c of changes) state.keys.add(c.id)
    await reload({ withWidget: true })
    return { status: r.status, added: changes.length }
  }
  console.warn('[favorites] import', r)
  return { status: r.status, added: 0 }
}

/**
 * The list as an OPML file: every FEED entry (followed podcasts and
 * favorited albums; episodes and songs have no place in the format), named
 * and addressed through /api/v1/favorites/resolve, or the local list. A
 * download, built on the device; nothing is uploaded.
 */
async function exportOpml() {
  let shows = []
  let missing = 0
  try {
    const pubkey = getSessionPubkey()
    if (pubkey) {
      const deps = window.LBLogin ? await widgetDeps(window.LBLogin) : {}
      const r = await fetchFavorites(pubkey, { ...deps, pubkey })
      if (!r.trusted) { showToast(MESSAGES.degraded, true); return { status: 'degraded' } }
      const guids = [...new Set(r.entries.filter((e) => e.kind === 'podcast:guid').map((e) => feedGuidOf(e.id)).filter(Boolean))]
      if (!guids.length) { showToast('Nothing to export yet: follow a podcast first.', true); return { status: 'empty' } }
      const resp = await fetch('/api/v1/favorites/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feeds: guids }),
      })
      const named = resp.ok ? (await resp.json())?.feeds || {} : {}
      for (const g of guids) {
        const row = named[g]
        if (row?.feed) shows.push({ url: row.feed, title: row.title || g })
        else missing++
      }
    } else {
      const local = loadLocal()
      if (!local.length) { showToast('Nothing to export yet: import an OPML file or log in.', true); return { status: 'empty' } }
      for (const r of local) { if (r.feed) shows.push({ url: r.feed, title: r.title || r.guid }); else missing++ }
    }
    const created = new Date()
    const { xml, written } = buildOpml(shows, { title: 'OnlyBoosts podcasts', created })
    if (!written) { showToast('None of these feeds has an address the index knows yet, so there is nothing to write.', true); return { status: 'empty' } }
    const a = document.createElement('a')
    a.href = 'data:text/x-opml;charset=utf-8,' + encodeURIComponent(xml)
    a.download = opmlFilename(created)
    document.body.appendChild(a); a.click(); a.remove()
    showToast(missing ? `Exported ${written} podcasts; ${missing} had no feed address yet and were left out.` : `Exported ${written} podcasts.`)
    return { status: 'ok', written, missing }
  } catch (err) {
    console.warn('[favorites] export', err)
    showToast('Couldn’t build the export.', true)
    return { status: 'error' }
  }
}

/** The import / manage panel, loaded on first use (opml-import.js). */
async function openOpml(view) {
  try {
    const { openOpmlPanel } = await import('/assets/js/opml-import.js?v=ob-v268')
    if (!state.everRead) await reload()
    const pubkey = getSessionPubkey()
    openOpmlPanel({
      view,
      signedIn: !!pubkey,
      isFollowed: (guid) => state.feeds.includes(guid) || state.keys.has(FEED_PREFIX + guid),
      local: () => loadLocal(),
      addRows: importFeeds,
      removeLocal: (guid) => { saveLocal(loadLocal().filter((r) => r.guid !== guid)); return reload() },
      forgetLocal: () => { saveLocal([]); return reload() },
      exportOpml,
      requestLogin: async () => { await ensureWidget(); window.LBLogin?.requestLogin?.() },
    })
  } catch (err) {
    console.warn('[favorites] opml panel', err)
    showToast('Couldn’t open the import.', true)
  }
}

/**
 * Signed in with a list imported before logging in: offer it to the Nostr
 * list once per account per page, then clear it on a save or a forget.
 * "Later" leaves it, and asks again on the next page.
 */
function offerLocalMerge(pubkey) {
  if (mergeOffered === pubkey) return
  mergeOffered = pubkey
  const local = loadLocal()
  const n = local.length
  const wrap = document.createElement('div')
  wrap.className = 'ob-fav-ask'
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-modal', 'true')
  wrap.innerHTML =
    `<div class="ob-fav-ask-card">` +
      `<h2>Save your imported podcasts?</h2>` +
      `<p>You imported ${n} podcast${n === 1 ? '' : 's'} from an OPML file before logging in. Save them to your Nostr follows and favorites, so every Podcasting 2.0 app that reads your list sees them too? Nothing already on your list is removed.</p>` +
      `<div class="ob-fav-ask-row">` +
        `<button type="button" class="ob-fav-ask-btn" data-do="save"><strong>Save to my list</strong><span>One signed update, published to your relays</span></button>` +
        `<button type="button" class="ob-fav-ask-btn" data-do="forget"><strong>Forget them</strong><span>Clear the imported list from this browser</span></button>` +
      `</div>` +
      `<button type="button" class="ob-fav-ask-cancel" data-cancel>Later</button>` +
    `</div>`
  const done = () => { wrap.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e) => { if (e.key === 'Escape') done() }
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest?.('[data-do]')
    if (b) {
      done()
      if (b.dataset.do === 'forget') { saveLocal([]); showToast('Imported list forgotten'); return }
      const r = await importFeeds(local)
      if (r.status === 'published' || r.status === 'unchanged') { saveLocal([]); showToast(r.added ? `Saved ${r.added} podcasts to your list` : 'Your list already had them all') }
      else showToast(MESSAGES[r.status] || 'Couldn’t save them; the imported list is still here.', true)
      return
    }
    if (e.target.closest?.('[data-cancel]') || e.target === wrap) done()
  })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(wrap)
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
    const r = await syncFavorites(null, { ...deps, store: window.localStorage, mode, userChose: true })
    if (r.status === 'published' || r.status === 'unchanged') {
      noteSettingsChange()
      await reload({ withWidget: true })
      showToast(mode === 'private' ? 'Your follows and favorites are private now' : 'Your follows and favorites are public now')
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
  window.OBFavorites = {
    getMode, setMode, reload: () => reload({ withWidget: true }),
    /* The current list's feed guids, and a read on demand: the homepage's
     * rails carry no hearts, so nothing else would trigger the lazy read
     * there. `ensureRead` resolves to the feeds once a read has happened. */
    feeds: () => (state.trusted || state.local ? state.feeds.slice() : []),
    ensureRead: async () => {
      if (!state.everRead && !state.loading) reload()
      if (state.loading) await state.loading.catch(() => {})
      return state.trusted || state.local ? state.feeds.slice() : []
    },
    /* OPML (2026-11-07): the import panel, the export, and the local list a
     * signed-out visitor imported. The panel module loads on first use. */
    importOpml: () => openOpml('import'),
    manageOpml: () => openOpml(loadLocal().length ? 'manage' : 'import'),
    exportOpml,
    localFollows: () => loadLocal(),
  }
  // The account menu's settings follow the account (account-settings.js):
  // restored on login, pushed on change.
  initAccountSettings()

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
  // A degraded read retries itself, and the page coming back is the moment
  // to ask again (see the ladder above).
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('focus', onWake)
  window.addEventListener('online', onWake)

  // Lazy: read only when this page has a heart to paint. A page without one
  // (about, stats) loads the module for the menu's API and nothing more.
  if (buttons().length) reload()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
}
