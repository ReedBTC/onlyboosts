#!/usr/bin/env node
// The favorites writer (`assets/js/favorites-sync.js`): the whole cycle —
// read, adopt, merge, encrypt, sign, publish, record — driven end to end
// against SCRIPTED relays that answer REQs and OK (or refuse) EVENTs, with a
// real key signing real events, a stand-in codec for the private half, and a
// fake localStorage. The shipped module is imported with its two absolute
// imports repointed (and the reader's bundle import under it). Nothing here
// touches the network.
//
// node scripts/test-favorites-sync.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from '../login-widget/node_modules/nostr-tools/lib/esm/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const NT = pathToFileURL(path.join(root, 'login-widget/node_modules/nostr-tools/lib/esm/index.js')).href
const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64')

const readSrc = readFileSync(path.join(root, 'assets/js/favorites-read.js'), 'utf8')
  .replace(/from '\/assets\/widgets\/nostr-tools\.js[^']*'/, `from '${NT}'`)
const READ_URL = dataUrl(readSrc)
const MERGE_URL = pathToFileURL(path.join(root, 'assets/js/favorites-merge.js')).href
const syncSrc = readFileSync(path.join(root, 'assets/js/favorites-sync.js'), 'utf8')
assert.match(syncSrc, /from '\/assets\/js\/favorites-read\.js\?v=ob-v\d+'/, 'the reader import is stamped')
assert.match(syncSrc, /from '\/assets\/js\/favorites-merge\.js\?v=ob-v\d+'/, 'the merge import is stamped')
const S = await import(dataUrl(
  syncSrc
    .replace(/from '\/assets\/js\/favorites-read\.js[^']*'/, `from '${READ_URL}'`)
    .replace(/from '\/assets\/js\/favorites-merge\.js[^']*'/, `from '${MERGE_URL}'`),
))
const M = await import(MERGE_URL)

let failures = 0
const check = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`) }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${String(e.stack ?? e.message).split('\n').slice(0, 2).join(' / ')}`) }
}

// ---- a real member
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const sign = async (template) => finalizeEvent({ ...template }, sk)

// ---- the stand-in codec (TEST ONLY): reversible, not encryption
const encrypt = async (text) => 'T:' + Buffer.from(text, 'utf8').toString('base64')
const decrypt = async (ct) => {
  if (!ct.startsWith('T:')) throw new Error('not ours')
  return Buffer.from(ct.slice(2), 'base64').toString('utf8')
}

// ---- a fake localStorage
const makeStore = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) }
}

// ---- scripted relays. Each holds events by kind, answers REQs, and OKs
// EVENTs (or refuses, or hangs, per its mode).
class FakeRelay {
  constructor(opts = {}) { this.held = new Map(); this.published = []; this.mode = opts.mode ?? 'ok'; this.reject = opts.reject ?? null }
  hold(ev) { this.held.set(ev.kind, ev) }
  socket() {
    const relay = this
    const h = {}
    const ws = {
      closed: false,
      addEventListener(k, fn) { (h[k] ??= []).push(fn) },
      emit(k, arg) { for (const fn of h[k] ?? []) fn(arg) },
      send(s) {
        const msg = JSON.parse(s)
        if (msg[0] === 'REQ') {
          if (relay.mode === 'hang') return
          const sub = msg[1]; const filter = msg[2]
          for (const kind of filter.kinds ?? []) {
            const ev = relay.held.get(kind)
            if (ev && (filter.authors ?? []).includes(ev.pubkey)) queue(() => ws.emit('message', { data: JSON.stringify(['EVENT', sub, ev]) }))
          }
          queue(() => ws.emit('message', { data: JSON.stringify(['EOSE', sub]) }))
        } else if (msg[0] === 'EVENT') {
          const ev = msg[1]
          if (relay.mode === 'hang-publish') return
          if (relay.reject) { queue(() => ws.emit('message', { data: JSON.stringify(['OK', ev.id, false, relay.reject]) })); return }
          relay.published.push(ev)
          const cur = relay.held.get(ev.kind)
          if (!cur || ev.created_at >= cur.created_at) relay.held.set(ev.kind, ev)
          queue(() => ws.emit('message', { data: JSON.stringify(['OK', ev.id, true, '']) }))
        }
      },
      close() { this.closed = true },
    }
    const queue = (fn) => setTimeout(() => { if (!ws.closed) fn() }, 0)
    if (this.mode === 'unreachable') setTimeout(() => { ws.emit('error', {}); ws.emit('close', {}) }, 0)
    else setTimeout(() => ws.emit('open', {}), 0)
    return ws
  }
}
const world = (relays) => ({
  relays,
  connect: (url) => { const r = relays[url]; if (!r) throw new Error('no relay ' + url); return r.socket() },
})

const FEED = 'podcast:guid:aaaaaaaa-0000-0000-0000-000000000001'
const FEED2 = 'podcast:guid:bbbbbbbb-0000-0000-0000-000000000002'
const ITEM = 'podcast:item:guid:aaaaaaaa-1111-0000-0000-000000000001'
const ARTIST = 'podcast:publisher:guid:cccccccc-0000-0000-0000-000000000003'
const addFeed = (id = FEED) => ({ op: 'add', kind: 'feed', id, medium: 'podcast' })
const removeFeed = (id = FEED) => ({ op: 'remove', kind: 'feed', id })
const iTags = (ev) => ev.tags.filter((t) => t[0] === 'i')
const list = (tags, content = '', created_at = 1000) => finalizeEvent({ kind: 10333, created_at, tags, content }, sk)

let clock = 5000
const now = () => clock * 1000
const deps = (w, store, extra = {}) => ({
  pubkey: pk, sign, canDecrypt: true, decrypt, encrypt, store,
  connect: w.connect, verify: verifyEvent, now,
  readRelays: ['wss://a', 'wss://b'], publishRelays: ['wss://a', 'wss://b'],
  readTimeoutMs: 80, publishTimeoutMs: 80,
  ...extra,
})
const twoRelays = () => world({ 'wss://a': new FakeRelay(), 'wss://b': new FakeRelay() })

// ---- refusals that need no relay
await check('signed out publishes nothing', async () => {
  assert.equal((await S.syncFavorites(addFeed(), { pubkey: null })).status, 'signed-out')
})
await check('a change naming the wrong kind of identifier is refused', async () => {
  const w = twoRelays()
  assert.equal((await S.syncFavorites({ op: 'add', kind: 'feed', id: ITEM }, deps(w, makeStore()))).status, 'bad-change')
  assert.equal((await S.syncFavorites({ op: 'add', kind: 'item', feedId: FEED, itemId: FEED }, deps(w, makeStore()))).status, 'bad-change')
  assert.equal((await S.syncFavorites({ op: 'nope', kind: 'feed', id: FEED }, deps(w, makeStore()))).status, 'bad-change')
})
await check('an item favorite is gated until both apps read the three-element form', async () => {
  const w = twoRelays()
  const r = await S.syncFavorites({ op: 'add', kind: 'item', feedId: FEED, itemId: ITEM, medium: 'podcast' }, deps(w, makeStore()))
  assert.equal(r.status, 'items-gated')
  assert.equal(w.relays['wss://a'].published.length, 0)
})

// ---- the read gate
await check('a degraded read publishes nothing and records nothing', async () => {
  const w = world({ 'wss://a': new FakeRelay(), 'wss://b': new FakeRelay({ mode: 'hang' }) })
  const store = makeStore()
  const r = await S.syncFavorites(addFeed(), deps(w, store))
  assert.equal(r.status, 'degraded')
  assert.equal(w.relays['wss://a'].published.length, 0)
  assert.deepEqual(store.dump(), {})
})

// ---- the first favorite
await check('first favorite on an empty untagged list with no stored choice: asks, publishes nothing', async () => {
  const w = twoRelays()
  const r = await S.syncFavorites(addFeed(), deps(w, makeStore()))
  assert.equal(r.status, 'needs-mode')
  assert.equal(w.relays['wss://a'].published.length, 0)
})

await check('first favorite, Public chosen: one feed tag, the visibility tag, a k tag, landed on both relays, baseline recorded', async () => {
  const w = twoRelays()
  const store = makeStore()
  const r = await S.syncFavorites(addFeed(), deps(w, store, { mode: 'public', userChose: true }))
  assert.equal(r.status, 'published')
  const ev = r.event
  assert.equal(verifyEvent(ev), true)
  assert.equal(ev.pubkey, pk)
  assert.equal(ev.kind, 10333)
  assert.deepEqual(ev.tags[0], ['alt', 'PC 2.0 Favorites'])
  assert.ok(ev.tags.some((t) => t[0] === 'visibility' && t[1] === 'public'))
  assert.deepEqual(iTags(ev), [['i', FEED]])
  assert.ok(ev.tags.some((t) => t[0] === 'k' && t[1] === 'podcast:guid'))
  assert.equal(ev.content, '')
  assert.equal(w.relays['wss://a'].published.length, 1)
  assert.equal(w.relays['wss://b'].published.length, 1)
  assert.deepEqual(S.loadBaseline(store, pk), { public: [FEED], private: [] })
  assert.deepEqual(r.relays.map((x) => x.status), ['ok', 'ok'])
})

await check('the same favorite again is unchanged: no publish, baseline kept', async () => {
  const w = twoRelays()
  const store = makeStore()
  await S.syncFavorites(addFeed(), deps(w, store, { mode: 'public', userChose: true }))
  clock += 10
  const r = await S.syncFavorites(addFeed(), deps(w, store, { mode: 'public' }))
  assert.equal(r.status, 'unchanged')
  assert.equal(w.relays['wss://a'].published.length, 1)
  assert.deepEqual(S.loadBaseline(store, pk), { public: [FEED], private: [] })
})

await check('toggle off: the feed leaves the list and the baseline', async () => {
  const w = twoRelays()
  const store = makeStore()
  await S.syncFavorites(addFeed(), deps(w, store, { mode: 'public', userChose: true }))
  clock += 10
  const r = await S.syncFavorites(removeFeed(), deps(w, store, { mode: 'public' }))
  assert.equal(r.status, 'published')
  assert.deepEqual(iTags(r.event), [])
  assert.deepEqual(S.loadBaseline(store, pk), { public: [], private: [] })
})

// ---- adopting another app's list
await check('unfavoriting an entry another app wrote sticks on FIRST contact (hydrate records the claim)', async () => {
  const w = twoRelays()
  const foreign = list([['alt', 'PC 2.0 Favorites'], ['visibility', 'public'], ['medium', 'podcast'], ['i', FEED], ['i', FEED2], ['k', 'podcast:guid']])
  w.relays['wss://a'].hold(foreign); w.relays['wss://b'].hold(foreign)
  const store = makeStore()
  const r = await S.syncFavorites(removeFeed(FEED2), deps(w, store))
  assert.equal(r.status, 'published')
  assert.deepEqual(iTags(r.event), [['i', FEED]], 'FEED2 gone, FEED carried')
  assert.deepEqual(S.loadBaseline(store, pk), { public: [FEED], private: [] })
  assert.equal(r.mode, 'public', 'the list said which half; no choice was needed')
})

await check('adding to another app\'s list keeps everything it holds, artists included, in band order', async () => {
  const w = twoRelays()
  const foreign = list([
    ['alt', 'PC 2.0 Favorites'], ['visibility', 'public'],
    ['medium', 'music'], ['i', ARTIST], ['i', FEED2],
    ['k', 'podcast:guid'], ['k', 'podcast:publisher:guid'],
  ])
  w.relays['wss://a'].hold(foreign); w.relays['wss://b'].hold(foreign)
  const r = await S.syncFavorites({ op: 'add', kind: 'feed', id: FEED, medium: 'music' }, deps(w, makeStore()))
  assert.equal(r.status, 'published')
  assert.deepEqual(iTags(r.event), [['i', ARTIST], ['i', FEED2], ['i', FEED]])
  assert.ok(r.event.tags.some((t) => t[0] === 'k' && t[1] === 'podcast:publisher:guid'), 'the artist kind survives in k')
})

await check('a list holding a legacy two-element item is not published onto, until the gate lifts', async () => {
  const w = twoRelays()
  const legacy = list([['alt', 'PC 2.0 Favorites'], ['visibility', 'public'], ['medium', 'podcast'], ['i', FEED2], ['i', ITEM], ['k', 'podcast:guid'], ['k', 'podcast:item:guid']])
  w.relays['wss://a'].hold(legacy); w.relays['wss://b'].hold(legacy)
  const r1 = await S.syncFavorites(addFeed(), deps(w, makeStore()))
  assert.equal(r1.status, 'items-gated')
  assert.equal(r1.reason, 'legacy-on-list')
  assert.equal(w.relays['wss://a'].published.length, 0)
  const r2 = await S.syncFavorites(addFeed(), deps(w, makeStore(), { itemsAllowed: true }))
  assert.equal(r2.status, 'published')
  assert.deepEqual(iTags(r2.event), [['i', FEED2], ['i', FEED], ['i', FEED2, ITEM]], 'the legacy item is rewritten with its feed, in band 3')
})

// ---- the private half
await check('Private chosen: the entry goes into content through the codec, the public half stays empty', async () => {
  const w = twoRelays()
  const store = makeStore()
  const r = await S.syncFavorites(addFeed(), deps(w, store, { mode: 'private', userChose: true }))
  assert.equal(r.status, 'published')
  assert.deepEqual(iTags(r.event), [])
  assert.ok(r.event.tags.some((t) => t[0] === 'visibility' && t[1] === 'private'))
  assert.ok(r.event.content.startsWith('T:'), 'sealed by the codec')
  assert.equal('privatePlaintext' in r.event, false, 'nothing of the plan leaks onto the event')
  const inside = M.decodePlaintext(await decrypt(r.event.content))
  assert.deepEqual(inside.filter((t) => t[0] === 'i'), [['i', FEED]])
  assert.deepEqual(S.loadBaseline(store, pk), { public: [], private: [FEED] })
  // and it reads back for the owner, and stays opaque to everyone else
  const own = await S.fetchFavorites(pk, deps(w, store))
  assert.equal(own.trusted, true)
  assert.deepEqual(own.entries.map((e) => [e.id, e.half]), [[FEED, 'private']])
  const other = await S.fetchFavorites(pk, deps(w, store, { decrypt: null, canDecrypt: false }))
  assert.equal(other.readPrivate, null)
  assert.deepEqual(other.entries, [])
  assert.equal(other.parsedPrivate, null)
})

await check('unfavoriting a PRIVATE entry another app wrote sticks on first contact too', async () => {
  const w = twoRelays()
  const inside = M.encodePlaintext([['medium', 'podcast'], ['i', FEED], ['i', FEED2]])
  const foreign = list([['alt', 'PC 2.0 Favorites'], ['visibility', 'private'], ['k', 'podcast:guid']], await encrypt(inside))
  w.relays['wss://a'].hold(foreign); w.relays['wss://b'].hold(foreign)
  const store = makeStore()
  const r = await S.syncFavorites(removeFeed(FEED2), deps(w, store))
  assert.equal(r.status, 'published', JSON.stringify(r))
  assert.deepEqual(iTags(r.event), [], 'nothing disclosed into the public half')
  const after = M.decodePlaintext(await decrypt(r.event.content)).filter((t) => t[0] === 'i')
  assert.deepEqual(after, [['i', FEED]])
  assert.deepEqual(S.loadBaseline(store, pk), { public: [], private: [FEED] })
})

await check('a signer without NIP-44 cannot write the private half, and says so', async () => {
  const w = twoRelays()
  const r = await S.syncFavorites(addFeed(), deps(w, makeStore(), { mode: 'private', userChose: true, encrypt: null, decrypt: null, canDecrypt: false }))
  assert.equal(r.status, 'no-nip44')
  assert.equal(w.relays['wss://a'].published.length, 0)
})

await check('an opaque private half is carried byte for byte by a signer that cannot open it', async () => {
  const w = twoRelays()
  const OPAQUE = 'AkQBsomeone-elses-nip44-bytes'
  const foreign = list([['alt', 'PC 2.0 Favorites'], ['visibility', 'public'], ['medium', 'podcast'], ['i', FEED2], ['k', 'podcast:guid']], OPAQUE)
  w.relays['wss://a'].hold(foreign); w.relays['wss://b'].hold(foreign)
  const r = await S.syncFavorites(addFeed(), deps(w, makeStore(), { encrypt: null, decrypt: null, canDecrypt: false }))
  assert.equal(r.status, 'published')
  assert.equal(r.event.content, OPAQUE)
  assert.deepEqual(iTags(r.event), [['i', FEED2], ['i', FEED]])
})

// ---- landing
await check('no relay accepts: not-landed, and the baseline is NOT recorded', async () => {
  const w = world({ 'wss://a': new FakeRelay({ reject: 'blocked: no' }), 'wss://b': new FakeRelay({ mode: 'hang-publish' }) })
  const store = makeStore()
  const r = await S.syncFavorites(addFeed(), deps(w, store, { mode: 'public', userChose: true }))
  assert.equal(r.status, 'not-landed')
  assert.deepEqual(r.relays.map((x) => x.status).sort(), ['rejected', 'timeout'])
  assert.equal(r.relays.find((x) => x.status === 'rejected').reason, 'blocked: no')
  assert.deepEqual(S.loadBaseline(store, pk), { public: [], private: [] })
})

await check('one relay accepting is enough to land, and the refusal is reported beside it', async () => {
  const w = world({ 'wss://a': new FakeRelay(), 'wss://b': new FakeRelay({ reject: 'kinds not supported' }) })
  const store = makeStore()
  const r = await S.syncFavorites(addFeed(), deps(w, store, { mode: 'public', userChose: true }))
  assert.equal(r.status, 'published')
  assert.deepEqual(S.loadBaseline(store, pk), { public: [FEED], private: [] })
})

await check('the member\'s NIP-65 write relays are read and published to as well', async () => {
  const mine = new FakeRelay()
  const w = world({ 'wss://a': new FakeRelay(), 'wss://b': new FakeRelay(), 'wss://mine': mine })
  const relayList = finalizeEvent({ kind: 10002, created_at: 1, tags: [['r', 'wss://mine'], ['r', 'wss://read-only.example', 'read']], content: '' }, sk)
  w.relays['wss://a'].hold(relayList); w.relays['wss://b'].hold(relayList)
  const r = await S.syncFavorites(addFeed(), deps(w, makeStore(), { mode: 'public', userChose: true }))
  assert.equal(r.status, 'published')
  assert.equal(mine.published.length, 1, 'published to the member\'s own write relay')
  assert.ok(!r.relays.some((x) => x.url === 'wss://read-only.example'), 'a read-only relay is not a publish target')
})

await check('an event the signer returns under another key is refused before it is sent', async () => {
  const w = twoRelays()
  const otherSk = generateSecretKey()
  const r = await S.syncFavorites(addFeed(), deps(w, makeStore(), { mode: 'public', userChose: true, sign: async (t) => finalizeEvent({ ...t }, otherSk) }))
  assert.equal(r.status, 'sign-failed')
  assert.equal(w.relays['wss://a'].published.length, 0)
})

// ---- the pure parts
await check('adoptLocal: feeds, artists and items become groups; a legacy item with no feed is left to be carried', () => {
  const parsed = M.parseTags([['medium', 'music'], ['i', ARTIST], ['i', FEED2], ['i', FEED2, ITEM], ['medium', 'podcast'], ['i', ITEM]])
  const local = S.adoptLocal(parsed)
  assert.deepEqual(local, [
    { id: ARTIST, medium: 'music', items: [], favorited: true },
    { id: FEED2, medium: 'music', items: [ITEM], favorited: true },
  ])
  const both = S.adoptLocal(parsed, M.parseTags([['medium', 'podcast'], ['i', FEED]]))
  assert.deepEqual(both.map((g) => g.id), [ARTIST, FEED2, FEED], 'the private half is adopted beside the public one')
})
await check('applyChange: add and remove, feeds and items, never mutating the input', () => {
  const base = [{ id: FEED, medium: 'podcast', items: [ITEM], favorited: true }]
  const a = S.applyChange(base, removeFeed(FEED))
  assert.deepEqual(a, [{ id: FEED, medium: 'podcast', items: [ITEM], favorited: false }], 'the feed favorite goes, its item stays')
  const b = S.applyChange(a, { op: 'remove', kind: 'item', feedId: FEED, itemId: ITEM })
  assert.deepEqual(b, [], 'nothing left to say')
  const c = S.applyChange([], { op: 'add', kind: 'item', feedId: FEED, itemId: ITEM, medium: 'music' })
  assert.deepEqual(c, [{ id: FEED, medium: 'music', items: [ITEM], favorited: false }], 'an item favorite does not favorite its feed')
  assert.deepEqual(base, [{ id: FEED, medium: 'podcast', items: [ITEM], favorited: true }], 'input untouched')
})
await check('the baseline store: malformed is empty, the mode is only ever public/private/null', () => {
  const store = makeStore()
  store.setItem('ob-fav-baseline:' + pk, '{not json')
  assert.deepEqual(S.loadBaseline(store, pk), { public: [], private: [] })
  store.setItem('ob-fav-baseline:' + pk, JSON.stringify({ public: ['x', 5], private: 'no' }))
  assert.deepEqual(S.loadBaseline(store, pk), { public: ['x'], private: [] })
  S.saveMode(store, pk, 'private'); assert.equal(S.loadMode(store, pk), 'private')
  S.saveMode(store, pk, 'whatever'); assert.equal(S.loadMode(store, pk), null)
  assert.equal(S.loadMode(null, pk), null)
})
await check('the publish set covers every relay BMB reads that accepts the kind, and nothing that refuses or mirrors', () => {
  assert.deepEqual([...S.PUBLISH_RELAYS], ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://relay.ditto.pub'])
  // BMB's DEFAULT_RELAYS less fountain, which refuses kind 10333. A relay in
  // BMB's read set that we never write is a stale copy waiting to win a race.
  for (const url of ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol']) assert.ok(S.PUBLISH_RELAYS.includes(url), url)
  assert.ok(!S.PUBLISH_RELAYS.includes('wss://relay.fountain.fm'))
  assert.ok(!S.PUBLISH_RELAYS.includes('wss://relay.mostr.pub'))
})

// ---- source scan
const src = syncSrc.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
await check('no NIP-04 anywhere in the writer', () => assert.doesNotMatch(src, /nip04|nip-04/i))
await check('no stand-in codec in the shipped writer', () => assert.doesNotMatch(src, /'T:'|base64/))

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
