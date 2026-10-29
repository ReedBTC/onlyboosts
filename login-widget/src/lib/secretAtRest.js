// The NIP-46 client secret AT REST, so a phone stays signed in.
//
// A remote-signer login (Amber, nsec.app, any bunker) is two halves: the
// bunker pointer and user pubkey, in localStorage, and the local client's
// hex private key, which until 2026-10-29 lived in sessionStorage only. That
// split was a deliberate defence: an exfiltrated localStorage dump could not
// reconnect to the bunker without the secret. Its cost was paid on phones,
// where the browser throws sessionStorage away whenever it evicts the tab,
// which on a phone is most of the time the app is not on screen. Every
// return then found a record with no secret, called it unrestorable, signed
// the member out and opened the login modal in their face (Reed, 2026-10-29:
// "constantly asking me to log in... bam, right in your face").
//
// So the secret now has an at-rest copy, wrapped: AES-GCM under a key
// generated NON-EXTRACTABLE by WebCrypto and held in IndexedDB, the one
// place a browser will keep a CryptoKey without ever handing its bytes to
// script. The ciphertext goes in localStorage beside the record. What that
// buys, stated plainly: a localStorage dump is still useless on its own, and
// so is an IndexedDB dump (the key's bytes are not readable, and a copied
// CryptoKey object does not leave the profile that made it). What it does
// not buy: a script running live on this origin (XSS, a hostile extension)
// can call unwrap exactly as this module does. That was already true of the
// sessionStorage copy while the tab lived, so the exposure is the same
// class over a longer window, which is the trade a persistent login is.
//
// The module touches no global at import time, imports nothing, and every
// storage call is best effort: no IndexedDB or no WebCrypto (an old WebView,
// a private window that refuses the database) leaves the behaviour exactly
// as it was, a session that lasts the tab. `wrapSecret` and `unwrapSecret`
// take the key as an argument so the codec is testable without a browser.

const DB_NAME = 'lb_keys'
const DB_STORE = 'keys'
const WRAP_KEY_ID = 'nip46-wrap-v1'
const BLOB_KEY = 'lb_nostr_nip46_secret_v1'
const HEX64 = /^[0-9a-f]{64}$/i

function subtle() {
  const c = globalThis.crypto
  return c && c.subtle ? c.subtle : null
}

function b64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(s) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function hexToBytes(hex) {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
function bytesToHex(bytes) {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** Encrypt a 64-hex secret under an AES-GCM CryptoKey. Returns the blob
 *  stored at rest, `{ v, iv, ct }` with the two byte fields base64. Throws
 *  on a malformed secret rather than storing something that is not one. */
export async function wrapSecret(hex, key) {
  if (!HEX64.test(hex || '')) throw new Error('secret must be 64 hex characters')
  const s = subtle()
  if (!s) throw new Error('WebCrypto unavailable')
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  const ct = await s.encrypt({ name: 'AES-GCM', iv }, key, hexToBytes(hex.toLowerCase()))
  return { v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) }
}

/** The secret back out of a blob, or null for anything that does not
 *  decrypt to a 32-byte key under this key: a tampered blob, another
 *  profile's blob, a shape this version does not know. */
export async function unwrapSecret(blob, key) {
  try {
    if (!blob || blob.v !== 1 || typeof blob.iv !== 'string' || typeof blob.ct !== 'string') return null
    const s = subtle()
    if (!s) return null
    const pt = await s.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct))
    const bytes = new Uint8Array(pt)
    return bytes.length === 32 ? bytesToHex(bytes) : null
  } catch {
    return null
  }
}

// ── The browser side: the key in IndexedDB, the blob in localStorage ────

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
  })
}

function openDb() {
  const idb = globalThis.indexedDB
  if (!idb) return Promise.reject(new Error('IndexedDB unavailable'))
  return new Promise((resolve, reject) => {
    let req
    try { req = idb.open(DB_NAME, 1) } catch (e) { reject(e); return }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

/** The wrapping key, made on first use. The get and the put share one
 *  readwrite transaction, so two tabs racing to create it cannot each
 *  wrap a secret under a key the other then overwrites. */
async function wrappingKey(create) {
  const s = subtle()
  if (!s) return null
  const db = await openDb()
  try {
    const tx = db.transaction(DB_STORE, create ? 'readwrite' : 'readonly')
    const store = tx.objectStore(DB_STORE)
    let key = await idbRequest(store.get(WRAP_KEY_ID))
    if (!key && create) {
      key = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await idbRequest(store.put(key, WRAP_KEY_ID))
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
    })
    return key || null
  } finally {
    try { db.close() } catch {}
  }
}

/** Keep the secret at rest. Best effort: a browser that refuses either
 *  store leaves no copy, and the session lasts the tab as it used to. */
export async function storeSecret(hex) {
  try {
    const key = await wrappingKey(true)
    if (!key) return false
    const blob = await wrapSecret(hex, key)
    localStorage.setItem(BLOB_KEY, JSON.stringify(blob))
    return true
  } catch {
    return false
  }
}

/** The secret from its at-rest copy, or null. */
export async function readSecret() {
  try {
    const raw = localStorage.getItem(BLOB_KEY)
    if (!raw) return null
    const key = await wrappingKey(false)
    if (!key) return null
    return await unwrapSecret(JSON.parse(raw), key)
  } catch {
    return null
  }
}

/** Forget the at-rest copy. The wrapping key stays; it is useless without
 *  a blob and the next login reuses it. */
export function dropSecret() {
  try { localStorage.removeItem(BLOB_KEY) } catch {}
}
