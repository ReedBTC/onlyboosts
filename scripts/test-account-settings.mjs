#!/usr/bin/env node
// The account settings that follow the account (`assets/js/account-settings.js`):
// the NIP-78 event's plaintext both ways, newest-wins, applying a remote copy
// through the nav's own toggle, and the pull/push cycle over SCRIPTED relays
// with a real key, a stand-in codec and a fake localStorage. The shipped
// module is imported with its absolute imports repointed. Nothing here
// touches the network or a real signer.
//
// node scripts/test-account-settings.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from '../login-widget/node_modules/nostr-tools/lib/esm/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const NT = pathToFileURL(path.join(root, 'login-widget/node_modules/nostr-tools/lib/esm/index.js')).href
const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64')
const READ_URL = dataUrl(readFileSync(path.join(root, 'assets/js/favorites-read.js'), 'utf8').replace(/from '\/assets\/widgets\/nostr-tools\.js[^']*'/, `from '${NT}'`))
const MERGE_URL = pathToFileURL(path.join(root, 'assets/js/favorites-merge.js')).href
const SYNC_URL = dataUrl(readFileSync(path.join(root, 'assets/js/favorites-sync.js'), 'utf8')
  .replace(/from '\/assets\/js\/favorites-read\.js[^']*'/, `from '${READ_URL}'`)
  .replace(/from '\/assets\/js\/favorites-merge\.js[^']*'/, `from '${MERGE_URL}'`))
const src = readFileSync(path.join(root, 'assets/js/account-settings.js'), 'utf8')
assert.match(src, /from '\/assets\/js\/favorites-read\.js\?v=ob-v\d+'/)
const A = await import(dataUrl(src
  .replace(/from '\/assets\/js\/favorites-read\.js[^']*'/, `from '${READ_URL}'`)
  .replace(/from '\/assets\/js\/favorites-sync\.js[^']*'/, `from '${SYNC_URL}'`)
  .replace(/from '\/assets\/js\/follow-set\.js[^']*'/, "from 'data:text/javascript,export const getSessionPubkey=()=>null'")))

let failures = 0
const check = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`) }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${String(e.stack ?? e.message).split('\n').slice(0, 2).join(' / ')}`) }
}

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const sign = async (t) => finalizeEvent({ ...t }, sk)
const encrypt = async (text) => 'T:' + Buffer.from(text, 'utf8').toString('base64')
const decrypt = async (ct) => { if (!ct.startsWith('T:')) throw new Error('not ours'); return Buffer.from(ct.slice(2), 'base64').toString('utf8') }
const makeStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }

class FakeRelay {
  constructor() { this.held = []; this.published = [] }
  hold(ev) { this.held.push(ev) }
  socket() {
    const relay = this; const h = {}
    const ws = {
      closed: false,
      addEventListener(k, fn) { (h[k] ??= []).push(fn) },
      emit(k, a) { for (const fn of h[k] ?? []) fn(a) },
      send(s) {
        const msg = JSON.parse(s)
        if (msg[0] === 'REQ') {
          const [, sub, f] = msg
          for (const ev of relay.held) {
            if (!(f.kinds ?? []).includes(ev.kind) || !(f.authors ?? []).includes(ev.pubkey)) continue
            if (f['#d'] && !ev.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1]))) continue
            q(() => ws.emit('message', { data: JSON.stringify(['EVENT', sub, ev]) }))
          }
          q(() => ws.emit('message', { data: JSON.stringify(['EOSE', sub]) }))
        } else if (msg[0] === 'EVENT') {
          relay.published.push(msg[1]); relay.held.push(msg[1])
          q(() => ws.emit('message', { data: JSON.stringify(['OK', msg[1].id, true, '']) }))
        }
      },
      close() { this.closed = true },
    }
    const q = (fn) => setTimeout(() => { if (!ws.closed) fn() }, 0)
    setTimeout(() => ws.emit('open', {}), 0)
    return ws
  }
}
const world = () => { const relays = { 'wss://a': new FakeRelay(), 'wss://b': new FakeRelay() }; return { relays, connect: (u) => relays[u].socket() } }
const deps = (w, store, extra = {}) => ({ pubkey: pk, sign, encrypt, decrypt, store, connect: w.connect, verify: verifyEvent, readRelays: ['wss://a', 'wss://b'], publishRelays: ['wss://a', 'wss://b'], readTimeoutMs: 80, publishTimeoutMs: 80, ...extra })

// ---- a stub document for applySettings
const doc = () => {
  const html = { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null }, setAttribute(k, v) { this.attrs[k] = v }, removeAttribute(k) { delete this.attrs[k] } }
  const toggle = { clicks: 0, click() { this.clicks++; if (html.attrs['data-theme'] === 'dark') delete html.attrs['data-theme']; else html.attrs['data-theme'] = 'dark' } }
  return { documentElement: html, querySelector: (sel) => (sel === '.nav-theme-toggle' ? toggle : null), toggle }
}

await check('the plaintext carries only known fields with valid values, both ways', () => {
  assert.equal(A.serializeSettings({ theme: 'dark', favoritesMode: 'private', updatedAt: 1700000000.7 }), '{"theme":"dark","favoritesMode":"private","updatedAt":1700000000}')
  assert.equal(A.serializeSettings({ theme: 'blue', favoritesMode: 'off', updatedAt: NaN }), '{"updatedAt":0}')
  assert.deepEqual(A.parseSettings('{"theme":"light","favoritesMode":"public","updatedAt":5,"railPref":"x"}'), { theme: 'light', favoritesMode: 'public', updatedAt: 5 })
  assert.deepEqual(A.parseSettings('{"theme":"neon"}'), { theme: null, favoritesMode: null, updatedAt: 0 })
  assert.equal(A.parseSettings('[1]'), null)
  assert.equal(A.parseSettings('not json'), null)
})

await check('newest wins; a tie keeps the device\'s own; nothing remote applies nothing', () => {
  assert.equal(A.remoteWins({ updatedAt: 10 }, { updatedAt: 11 }), true)
  assert.equal(A.remoteWins({ updatedAt: 10 }, { updatedAt: 10 }), false)
  assert.equal(A.remoteWins({ updatedAt: 10 }, { updatedAt: 9 }), false)
  assert.equal(A.remoteWins({ updatedAt: 0 }, null), false)
})

await check('applySettings presses the nav toggle only when the theme differs, and stores the favorites choice', () => {
  const d = doc(); const store = makeStore()
  const c1 = A.applySettings({ theme: 'dark', favoritesMode: 'private', updatedAt: 7 }, { store, pubkey: pk, doc: d })
  assert.deepEqual(c1, { theme: 'dark', favoritesMode: 'private' })
  assert.equal(d.toggle.clicks, 1)
  assert.equal(d.documentElement.getAttribute('data-theme'), 'dark')
  assert.equal(store.getItem('ob-fav-mode:' + pk), 'private')
  assert.equal(store.getItem('ob-settings-ts:' + pk), '7')
  const c2 = A.applySettings({ theme: 'dark', favoritesMode: 'private', updatedAt: 8 }, { store, pubkey: pk, doc: d })
  assert.deepEqual(c2, {}, 'already there: no press, no write')
  assert.equal(d.toggle.clicks, 1)
})

await check('push: an encrypted kind-30078 under d=onlyboosts:settings lands on the relays, signed by the member', async () => {
  const w = world(); const store = makeStore()
  store.setItem('ob-theme', 'dark'); store.setItem('ob-fav-mode:' + pk, 'public'); store.setItem('ob-settings-ts:' + pk, '1234')
  const r = await A.pushSettings(deps(w, store))
  assert.equal(r.landed, true)
  const ev = w.relays['wss://a'].published[0]
  assert.equal(verifyEvent(ev), true)
  assert.equal(ev.kind, 30078)
  assert.deepEqual(ev.tags, [['d', 'onlyboosts:settings']])
  assert.ok(ev.content.startsWith('T:'), 'sealed by the codec, never plaintext')
  assert.deepEqual(JSON.parse(await decrypt(ev.content)), { theme: 'dark', favoritesMode: 'public', updatedAt: 1234 })
})

await check('push: nothing to say, no NIP-44, or a signer under another key publishes nothing', async () => {
  const w = world()
  assert.equal(await A.pushSettings(deps(w, makeStore())), null, 'no settings at all')
  const store = makeStore(); store.setItem('ob-theme', 'dark')
  assert.equal(await A.pushSettings(deps(w, store, { encrypt: null })), null)
  assert.equal(await A.pushSettings(deps(w, store, { sign: async (t) => finalizeEvent({ ...t }, generateSecretKey()) })), null)
  assert.equal(w.relays['wss://a'].published.length, 0)
})

await check('pull: the newest copy is decrypted and parsed; another d, another author or no NIP-44 is null', async () => {
  const w = world()
  const mine = finalizeEvent({ kind: 30078, created_at: 100, tags: [['d', 'onlyboosts:settings']], content: await encrypt('{"theme":"light","updatedAt":50}') }, sk)
  const newer = finalizeEvent({ kind: 30078, created_at: 200, tags: [['d', 'onlyboosts:settings']], content: await encrypt('{"theme":"dark","favoritesMode":"private","updatedAt":60}') }, sk)
  const other = finalizeEvent({ kind: 30078, created_at: 300, tags: [['d', 'boostmebitch:settings']], content: await encrypt('{"theme":"light","updatedAt":999}') }, sk)
  const foreign = finalizeEvent({ kind: 30078, created_at: 400, tags: [['d', 'onlyboosts:settings']], content: await encrypt('{"theme":"light","updatedAt":999}') }, generateSecretKey())
  for (const ev of [mine, newer, other, foreign]) { w.relays['wss://a'].hold(ev); w.relays['wss://b'].hold(ev) }
  const r = await A.pullSettings(deps(w, makeStore()))
  assert.deepEqual(r, { theme: 'dark', favoritesMode: 'private', updatedAt: 60 })
  assert.equal(await A.pullSettings(deps(w, makeStore(), { decrypt: null })), null)
})

await check('round trip: what one device pushes, another device pulls and applies', async () => {
  const w = world()
  const laptop = makeStore(); laptop.setItem('ob-theme', 'dark'); laptop.setItem('ob-fav-mode:' + pk, 'private'); laptop.setItem('ob-settings-ts:' + pk, '5000')
  await A.pushSettings(deps(w, laptop))
  const phone = makeStore(); const d = doc()
  const remote = await A.pullSettings(deps(w, phone))
  assert.equal(A.remoteWins(A.localSettings(phone, pk), remote), true)
  const changed = A.applySettings(remote, { store: phone, pubkey: pk, doc: d })
  assert.deepEqual(changed, { theme: 'dark', favoritesMode: 'private' })
  assert.equal(d.documentElement.getAttribute('data-theme'), 'dark')
  // and a phone that flipped LATER is not undone by the laptop's older copy
  const phone2 = makeStore(); phone2.setItem('ob-theme', 'light'); phone2.setItem('ob-settings-ts:' + pk, '6000')
  assert.equal(A.remoteWins(A.localSettings(phone2, pk), remote), false)
})

await check('the controller wires it: restore on login, push on the theme toggle and on a mode choice', () => {
  const ui = readFileSync(path.join(root, 'assets/js/favorites-ui.js'), 'utf8')
  assert.match(ui, /initAccountSettings\(\)/)
  assert.equal((ui.match(/noteSettingsChange\(\)/g) || []).length, 2, 'the first-favorite choice and setMode both note a change')
  assert.match(src, /window\.addEventListener\('lb:session-change', \(\) => \{ restoreSettings\(\) \}\)/)
  assert.match(src, /closest\?\.\('\.nav-theme-toggle'\)\) noteSettingsChange\(\)/)
  assert.doesNotMatch(src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n'), /nip04/i)
})

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
