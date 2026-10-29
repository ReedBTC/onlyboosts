// The signer session at rest (2026-10-29): the NIP-46 client secret's
// wrapped copy, and the boot path that no longer opens the login modal.
//
//   node scripts/test-session-secret.mjs
//
// The codec (`wrapSecret` / `unwrapSecret` in login-widget/src/lib/
// secretAtRest.js) is run for real under Node's WebCrypto with a generated
// AES-GCM key: a round trip, the blob carrying no trace of the secret, a
// tampered blob and another key both answering null, a malformed secret
// refused. The browser side (IndexedDB for the key, localStorage for the
// blob) has no Node stand-in, so it and the wiring are held by text scan:
// saveSession stores the copy, clearSession drops it, restoreSession falls
// back to it when the tab's copy is gone, the built widget carries the
// storage keys, and the page-load restore's 'permanent' branch passes
// `openLogin: false` and never calls setLoginOpen(true) itself.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')
const { wrapSecret, unwrapSecret } = await import(path.join(root, 'login-widget/src/lib/secretAtRest.js'))

let n = 0
function test(name, fn) { return Promise.resolve().then(fn).then(() => { n++; console.log('ok', name) }) }

const subtle = globalThis.crypto.subtle
const newKey = () => subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')

await test('the codec: a secret round-trips under its key', async () => {
  const key = await newKey()
  const blob = await wrapSecret(secret, key)
  assert.equal(blob.v, 1)
  assert.equal(typeof blob.iv, 'string')
  assert.equal(typeof blob.ct, 'string')
  assert.equal(await unwrapSecret(blob, key), secret)
  // Uppercase in, lowercase out: the key's bytes are what is stored.
  assert.equal(await unwrapSecret(await wrapSecret(secret.toUpperCase(), key), key), secret)
})

await test('the codec: the blob carries no trace of the secret, and two wraps differ', async () => {
  const key = await newKey()
  const a = await wrapSecret(secret, key)
  const b = await wrapSecret(secret, key)
  const text = JSON.stringify(a)
  assert.ok(!text.includes(secret))
  assert.ok(!text.includes(secret.slice(0, 16)))
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.ct, b.ct)
})

await test('the codec: a tampered blob, another key, and a foreign shape all answer null', async () => {
  const key = await newKey()
  const other = await newKey()
  const blob = await wrapSecret(secret, key)
  const ct = Buffer.from(blob.ct, 'base64')
  ct[0] ^= 0x01
  assert.equal(await unwrapSecret({ ...blob, ct: ct.toString('base64') }, key), null)
  assert.equal(await unwrapSecret(blob, other), null)
  assert.equal(await unwrapSecret({ ...blob, v: 2 }, key), null)
  assert.equal(await unwrapSecret(null, key), null)
  assert.equal(await unwrapSecret({ v: 1, iv: 'not base64!', ct: blob.ct }, key), null)
})

await test('the codec: only a 64-hex secret is wrapped', async () => {
  const key = await newKey()
  await assert.rejects(wrapSecret('abc', key))
  await assert.rejects(wrapSecret(secret + '00', key))
  await assert.rejects(wrapSecret('', key))
  await assert.rejects(wrapSecret(null, key))
})

await test('the module imports nothing and touches no global at import time', () => {
  const raw = read('login-widget/src/lib/secretAtRest.js')
  assert.ok(!/^\s*import\s/m.test(raw), 'secretAtRest.js must import nothing')
  // Every reference to the two browser stores is inside a function body
  // (comments off first: the header names both stores in prose).
  const src = raw.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const g of ['indexedDB', 'localStorage']) {
    for (const m of src.matchAll(new RegExp(`\\b${g}\\b`, 'g'))) {
      const before = src.slice(0, m.index)
      const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length
      assert.ok(depth > 0, `${g} referenced at top level`)
    }
  }
})

await test('the session wiring: save stores the copy, clear drops it, restore falls back to it', () => {
  const src = read('login-widget/src/lib/sessionPersistence.js')
  assert.match(src, /import \{ storeSecret, readSecret, dropSecret \} from '\.\/secretAtRest\.js'/)
  const save = src.slice(src.indexOf('export function saveSession'), src.indexOf('export function loadSession'))
  assert.match(save, /storeSecret\(clientSecret\)/)
  const clear = src.slice(src.indexOf('export function clearSession'), src.indexOf('export function saveProfile'))
  assert.match(clear, /dropSecret\(\)/)
  const nip46 = src.slice(src.indexOf("if (record.method === 'nip46') {"), src.indexOf("return { kind: 'permanent' }\n}"))
  assert.match(nip46, /clientSecret = await readSecret\(\)/)
  // The fallback runs only when the tab's copy is missing, and a missing
  // at-rest copy is still 'permanent'.
  assert.match(nip46, /if \(!isHex64\(clientSecret\)\) \{\s*\n[^]*?clientSecret = await readSecret\(\)\s*\n\s*if \(!isHex64\(clientSecret\)\) return \{ kind: 'permanent' \}/)
  // sessionStorage is re-seeded from it.
  assert.match(nip46, /sessionStorage\.setItem\(NIP46_SECRET_KEY, clientSecret\)/)
})

await test('the boot path signs out quietly; the modal opens behind a tap only', () => {
  const src = read('login-widget/src/index.jsx')
  const fn = src.slice(src.indexOf('function forceLogoutWithMessage('), src.indexOf('function ensureRealRestore'))
  assert.match(fn, /function forceLogoutWithMessage\(message, \{ openLogin = true \} = \{\}\)/)
  assert.match(fn, /if \(openLogin\) setLoginOpen\(true\)/)
  assert.ok(!/^\s*setLoginOpen\(true\)/m.test(fn), 'the modal must be behind the flag')
  const boot = src.slice(src.indexOf('Kick off async session restore'), src.indexOf('getUser() {'))
  assert.match(boot, /forceLogoutWithMessage\([^)]*\{ openLogin: false \}\)/)
  assert.ok(!boot.includes('setLoginOpen(true)'), 'the boot path must not open the login modal')
  // The gesture-backed callers still open it.
  const demand = src.slice(src.indexOf('function ensureRealRestore'), src.indexOf('function ensureSignerVerified'))
  assert.match(demand, /forceLogoutWithMessage\('[^']+'\)/)
  assert.ok(!demand.includes('openLogin: false'))
})

await test('the built widget carries the at-rest copy', () => {
  const built = read('assets/widgets/login-widget.js')
  assert.ok(built.includes('lb_nostr_nip46_secret_v1'), 'blob key in the bundle')
  assert.ok(built.includes('lb_keys'), 'key database in the bundle')
  assert.ok(built.includes('Use Sign in at the top when you need it.'), 'the quiet sign-out toast')
  assert.ok(!built.includes('Saved session was invalid'), 'the old boot-path message is gone')
})

console.log(`\n${n} passed`)
