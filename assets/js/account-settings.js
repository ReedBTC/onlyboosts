/**
 * account-settings.js — the account menu's settings follow the account.
 *
 * Reed's ask, 2026-09-09: the wallet connection comes back on its own after a
 * login, so the menu's other settings should too. The wallet's copy is
 * encrypted-to-self in THIS browser's localStorage; a setting that should
 * follow the account onto another device has to live on the relays, and the
 * pattern for that already exists next door: BoostMeBitch keeps its
 * preferences in a NIP-78 event, kind 30078, `d` = `boostmebitch:settings`,
 * content NIP-44 encrypted to the member's own key (lib/nostr/settings-backup.ts).
 * This is the same shape under `onlyboosts:settings`:
 *
 *   { "theme": "dark" | "light", "favoritesMode": "public" | "private", "updatedAt": <unix s> }
 *
 * Encrypted even though nothing in it is secret, so a sensitive setting can
 * join later without a schema change, and so nobody can enumerate who keeps
 * a private favorites list off a plaintext field.
 *
 * ⚠️ TWO SOURCES, NEWEST WINS. The device keeps `updatedAt` for its own last
 * change; a relay copy is applied only when its `updatedAt` is later. A flip
 * made on this device a moment before the relay answers is not undone.
 *
 * ⚠️ THE FAVORITES LIST'S OWN MODE IS ON THE LIST (its `visibility` tag), so
 * `favoritesMode` here is only the member's CHOICE as this site stores it,
 * used where the list itself cannot say; it never flips a list by itself
 * (the spec lets only a userChose cycle do that; see favorites-ui.js#setMode).
 *
 * ⚠️ THE THEME IS APPLIED BY PRESSING THE NAV'S OWN TOGGLE, so nav.js keeps
 * ownership of the attribute, the storage write, the labels and the
 * cross-tab sync — the same way the account menu's row does it.
 *
 * Writes are debounced and need the widget (the signer signs, NIP-44
 * encrypts); a signer without NIP-44, or a signed-out visitor, keeps the
 * settings on this device only, silently. Reads happen on login, which is
 * also when the widget is guaranteed to be here.
 */
import { readNewestEvent, readWriteRelays, relaySet } from '/assets/js/favorites-read.js?v=ob-v206'
import { publishEvent, widgetDeps, loadMode, saveMode, PUBLISH_RELAYS } from '/assets/js/favorites-sync.js?v=ob-v206'
import { getSessionPubkey } from '/assets/js/follow-set.js?v=ob-v206'

export const SETTINGS_KIND = 30078
export const SETTINGS_D_TAG = 'onlyboosts:settings'
export const PUSH_DELAY_MS = 1500
const TS_PREFIX = 'ob-settings-ts:'

/* ------------------------------------------------------------------------ */
/* Pure parts                                                                */

const isTheme = (v) => v === 'dark' || v === 'light'
const isMode = (v) => v === 'public' || v === 'private'

/** The plaintext that goes to the signer. Only known fields, only valid values. */
export function serializeSettings({ theme, favoritesMode, updatedAt }) {
  const out = {}
  if (isTheme(theme)) out.theme = theme
  if (isMode(favoritesMode)) out.favoritesMode = favoritesMode
  out.updatedAt = Number.isFinite(updatedAt) ? Math.floor(updatedAt) : 0
  return JSON.stringify(out)
}

/** The plaintext back, or null when it is not ours. Unknown fields ignored. */
export function parseSettings(text) {
  let p
  try { p = JSON.parse(text) } catch { return null }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  return {
    theme: isTheme(p.theme) ? p.theme : null,
    favoritesMode: isMode(p.favoritesMode) ? p.favoritesMode : null,
    updatedAt: Number.isFinite(p.updatedAt) ? Math.floor(p.updatedAt) : 0,
  }
}

/** This device's copy of the settings for `pubkey`. */
export function localSettings(store, pubkey) {
  let theme = null
  let ts = 0
  try { const t = store?.getItem?.('ob-theme'); theme = isTheme(t) ? t : null } catch {}
  try { ts = Number(store?.getItem?.(TS_PREFIX + pubkey)) || 0 } catch {}
  return { theme, favoritesMode: loadMode(store, pubkey), updatedAt: ts }
}

/** Newest wins, per the header; equal timestamps keep the device's own. */
export function remoteWins(local, remote) {
  if (!remote) return false
  return (remote.updatedAt || 0) > (local?.updatedAt || 0)
}

export function markChanged(store, pubkey, now = () => Date.now()) {
  try { store?.setItem?.(TS_PREFIX + pubkey, String(Math.floor(now() / 1000))) } catch {}
}

/* ------------------------------------------------------------------------ */
/* Applying                                                                  */

function currentTheme(doc) {
  return doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/**
 * Apply a remote copy to this device: the theme through the nav's own toggle
 * (pressed only when it differs), the favorites choice into the store.
 * Returns what changed.
 */
export function applySettings(remote, { store, pubkey, doc = document }) {
  const changed = {}
  if (remote.theme && remote.theme !== currentTheme(doc)) {
    const btn = doc.querySelector('.nav-theme-toggle')
    if (btn) btn.click()
    else {
      if (remote.theme === 'dark') doc.documentElement.setAttribute('data-theme', 'dark')
      else doc.documentElement.removeAttribute('data-theme')
      try { store?.setItem?.('ob-theme', remote.theme) } catch {}
    }
    changed.theme = remote.theme
  }
  if (remote.favoritesMode && remote.favoritesMode !== loadMode(store, pubkey)) {
    saveMode(store, pubkey, remote.favoritesMode)
    changed.favoritesMode = remote.favoritesMode
  }
  try { store?.setItem?.(TS_PREFIX + pubkey, String(remote.updatedAt || 0)) } catch {}
  return changed
}

/* ------------------------------------------------------------------------ */
/* The relay side                                                            */

/**
 * Read and decrypt the account's settings event. `deps` as favorites-sync's
 * widgetDeps plus `store`, and the injectable `connect`/`verify`/`now`/
 * `readRelays`. Resolves to the parsed settings, or null (none, unreadable,
 * no NIP-44, degraded read — all the same answer: nothing to apply).
 */
export async function pullSettings(deps) {
  const { pubkey } = deps
  if (!pubkey || typeof deps.decrypt !== 'function') return null
  let extra = []
  try { extra = await readWriteRelays(pubkey, readOpts(deps)) } catch {}
  const r = await readNewestEvent(pubkey, SETTINGS_KIND, { ...readOpts(deps), extraRelays: extra, dTag: SETTINGS_D_TAG })
  if (!r.event || !r.event.content) return null
  try {
    const text = await deps.decrypt(r.event.content)
    return typeof text === 'string' ? parseSettings(text) : null
  } catch {
    return null
  }
}

/** Encrypt, sign and publish this device's settings. Resolves to `{ landed, relays }` or null when it could not. */
export async function pushSettings(deps) {
  const { pubkey, store } = deps
  if (!pubkey || typeof deps.encrypt !== 'function' || typeof deps.sign !== 'function') return null
  const local = localSettings(store, pubkey)
  if (!local.theme && !local.favoritesMode) return null
  let content
  try { content = await deps.encrypt(serializeSettings(local)) } catch { return null }
  if (typeof content !== 'string' || !content) return null
  let signed
  try {
    signed = await deps.sign({
      kind: SETTINGS_KIND,
      tags: [['d', SETTINGS_D_TAG]],
      content,
      created_at: Math.floor((deps.now?.() ?? Date.now()) / 1000),
    })
  } catch { return null }
  if (!signed || signed.pubkey !== pubkey) return null
  let extra = []
  try { extra = await readWriteRelays(pubkey, readOpts(deps)) } catch {}
  return publishEvent(signed, relaySet(deps.publishRelays ?? PUBLISH_RELAYS, extra), {
    connect: deps.connect, now: deps.now, timeoutMs: deps.publishTimeoutMs,
  })
}

function readOpts(deps) {
  const o = {}
  if (deps.readRelays) o.relays = deps.readRelays
  if (deps.connect) o.connect = deps.connect
  if (deps.verify) o.verify = deps.verify
  if (deps.now) o.now = deps.now
  if (deps.readTimeoutMs) o.timeoutMs = deps.readTimeoutMs
  return o
}

/* ------------------------------------------------------------------------ */
/* Wiring, in the page                                                       */

let pushTimer = null

async function widgetOrNull() {
  const L = typeof window !== 'undefined' ? window.LBLogin : null
  if (!L?.getUser?.()?.pubkey) return null
  const deps = await widgetDeps(L)
  return deps.pubkey ? { ...deps, store: window.localStorage } : null
}

/** A setting changed on this device: stamp it, and push it shortly if signed in. */
export function noteSettingsChange() {
  const pubkey = getSessionPubkey()
  if (!pubkey) return
  markChanged(window.localStorage, pubkey)
  clearTimeout(pushTimer)
  pushTimer = setTimeout(async () => {
    const deps = await widgetOrNull()
    if (!deps || deps.pubkey !== pubkey) return
    try { await pushSettings(deps) } catch (err) { console.warn('[settings] push failed', err) }
  }, PUSH_DELAY_MS)
}

/** A login: bring the account's settings onto this device if they are newer. */
export async function restoreSettings() {
  const deps = await widgetOrNull()
  if (!deps) return null
  try {
    const remote = await pullSettings(deps)
    const local = localSettings(deps.store, deps.pubkey)
    if (!remoteWins(local, remote)) return null
    return applySettings(remote, { store: deps.store, pubkey: deps.pubkey })
  } catch (err) {
    console.warn('[settings] restore failed', err)
    return null
  }
}

export function initAccountSettings() {
  if (typeof document === 'undefined') return
  // The theme changes through nav.js's toggle; our listener runs after its,
  // so it sees the new value. Registered on the document, not the button,
  // because nav.js's is too and the button set can change.
  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('.nav-theme-toggle')) noteSettingsChange()
  })
  window.addEventListener('lb:session-change', () => { restoreSettings() })
  if (window.LBLogin?.getUser?.()?.pubkey) restoreSettings()
}
