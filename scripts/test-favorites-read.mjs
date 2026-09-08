#!/usr/bin/env node
// The favorites relay reader (`assets/js/favorites-read.js`), driven against
// SCRIPTED relays: a fake socket per URL that answers, hangs, refuses, never
// connects, drops, forges or disagrees. The shipped module is imported with
// its one absolute import (the nostr-tools bundle) rewritten to the same
// library out of login-widget/node_modules, so the signature check is real
// and the events are really signed. Nothing here touches the network.
//
// node scripts/test-favorites-read.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from '../login-widget/node_modules/nostr-tools/lib/esm/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const NT = pathToFileURL(path.join(root, 'login-widget/node_modules/nostr-tools/lib/esm/index.js')).href

// Import the SHIPPED source with its bundle import repointed.
const src = readFileSync(path.join(root, 'assets/js/favorites-read.js'), 'utf8')
assert.match(src, /from '\/assets\/widgets\/nostr-tools\.js\?v=ob-v\d+'/, 'the bundle import is stamped')
// A data: URL rather than a temp file: the module's only import is absolute,
// so nothing inside it needs a directory to resolve against.
const rewritten = src.replace(/from '\/assets\/widgets\/nostr-tools\.js[^']*'/, `from '${NT}'`)
const R = await import('data:text/javascript;base64,' + Buffer.from(rewritten, 'utf8').toString('base64'))

let failures = 0
const check = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`) }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n')[0]}`) }
}

// ---- fixtures: real keys, real signatures
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const other = getPublicKey(generateSecretKey())
const list = (created_at, tags = [['alt', 'PC 2.0 Favorites'], ['i', 'podcast:guid:f1']]) =>
  finalizeEvent({ kind: 10333, created_at, tags, content: '' }, sk)
const NEW = list(2000)
const OLD = list(1000)

// ---- a scripted socket. Each URL maps to a script: a list of steps run after
// 'open', or a mode that never opens. Steps: ['event', ev] ['eose'] ['closed', reason]
// ['notice', text] ['drop'] ['hang']
class FakeSocket {
  constructor(script) {
    this.h = {}
    this.sent = []
    this.closed = false
    this.script = script
    setTimeout(() => this.run(), 0)
  }
  addEventListener(k, fn) { (this.h[k] ??= []).push(fn) }
  emit(k, arg) { for (const fn of this.h[k] ?? []) fn(arg) }
  send(s) { this.sent.push(JSON.parse(s)) }
  close() { this.closed = true }
  run() {
    const { mode, steps = [] } = this.script
    if (mode === 'unreachable') { this.emit('error', {}); this.emit('close', {}); return }
    if (mode === 'throw') return
    this.emit('open', {})
    const sub = this.sent[0]?.[1]
    for (const step of steps) {
      if (this.closed) return
      const [op, a] = step
      if (op === 'event') this.emit('message', { data: JSON.stringify(['EVENT', sub, a]) })
      else if (op === 'eose') this.emit('message', { data: JSON.stringify(['EOSE', sub]) })
      else if (op === 'closed') this.emit('message', { data: JSON.stringify(['CLOSED', sub, a]) })
      else if (op === 'notice') this.emit('message', { data: JSON.stringify(['NOTICE', a]) })
      else if (op === 'drop') { this.emit('close', {}); return }
      else if (op === 'hang') return
      else if (op === 'foreign-sub') this.emit('message', { data: JSON.stringify(['EVENT', 'someone-else', a]) })
    }
  }
}
const connectWith = (scripts) => (url) => {
  const s = scripts[url]
  if (!s) throw new Error('no script for ' + url)
  if (s.mode === 'throw') throw new Error('synchronous connect failure')
  return new FakeSocket(s)
}
const read = (scripts, opts = {}) =>
  R.readFavorites(pk, { relays: Object.keys(scripts), timeoutMs: 60, connect: connectWith(scripts), verify: verifyEvent, ...opts })
const status = (r) => Object.fromEntries(r.relays.map((x) => [x.url, x.status]))

// ---- the pure parts
await check('readIsTrustworthy: every reached relay answered, and enough of them', () => {
  assert.equal(R.readIsTrustworthy({ reached: 2, answered: 2, relayCount: 4 }), true)
  assert.equal(R.readIsTrustworthy({ reached: 2, answered: 1, relayCount: 4 }), false, 'a hung relay degrades')
  assert.equal(R.readIsTrustworthy({ reached: 1, answered: 1, relayCount: 4 }), false, 'one answer is not enough in a four-relay set')
  assert.equal(R.readIsTrustworthy({ reached: 1, answered: 1, relayCount: 1 }), true, 'a one-relay set is not untrustworthy by construction')
  assert.equal(R.readIsTrustworthy({ reached: 0, answered: 0, relayCount: 4 }), false, 'offline is not an empty library')
})

await check('relaySet normalizes, dedupes and drops non-ws URLs', () => {
  assert.deepEqual(
    R.relaySet(['wss://nos.lol/', 'WSS://NOS.LOL', 'https://example.com', 'wss://relay.damus.io'], ['wss://relay.damus.io/', 'wss://mine.example/']),
    ['wss://nos.lol', 'wss://relay.damus.io', 'wss://mine.example'],
  )
})

await check('newest: created_at wins, a tie goes to the lowest id', () => {
  const a = { created_at: 5, id: 'b' }, b = { created_at: 5, id: 'a' }, c = { created_at: 4, id: '0' }
  assert.equal(R.newest([a, b, c]), b)
  assert.equal(R.newest([c, a]), a)
  assert.equal(R.newest([]), null)
})

await check('acceptsEvent: kind, author and a real signature', () => {
  assert.equal(R.acceptsEvent(pk, NEW, verifyEvent), true)
  assert.equal(R.acceptsEvent(pk, { ...NEW, kind: 1 }, verifyEvent), false)
  assert.equal(R.acceptsEvent(other, NEW, verifyEvent), false, 'someone else\'s pubkey')
  // Through JSON, the way a relay message arrives: nostr-tools caches a
  // verification on the object under a symbol, and a spread copy carries it.
  const forged = { ...JSON.parse(JSON.stringify(NEW)), content: 'x' }
  assert.equal(R.acceptsEvent(pk, forged, verifyEvent), false, 'tampered content fails the signature')
  const foreign = finalizeEvent({ kind: 10333, created_at: 9000, tags: [], content: '' }, generateSecretKey())
  assert.equal(R.acceptsEvent(pk, foreign, verifyEvent), false, 'another user\'s list, validly signed')
})

// ---- the read, against scripted relays
await check('two relays answer, one holds a newer copy: trusted, newest wins, stale relay reported', async () => {
  const r = await read({
    'wss://a': { steps: [['event', OLD], ['eose']] },
    'wss://b': { steps: [['event', NEW], ['eose']] },
  })
  assert.equal(r.trusted, true)
  assert.equal(r.event.id, NEW.id)
  assert.deepEqual(r.read, { tags: NEW.tags, content: NEW.content })
  assert.deepEqual(r.holding, ['wss://b'])
  assert.equal(r.relays.find((x) => x.url === 'wss://a').createdAt, 1000)
  assert.equal(r.relays.find((x) => x.url === 'wss://a').current, false)
})

await check('a relay that connects and hangs degrades the read: read is NULL, not an empty list', async () => {
  const r = await read({
    'wss://a': { steps: [['event', NEW], ['eose']] },
    'wss://b': { steps: [['hang']] },
  })
  assert.equal(r.trusted, false)
  assert.equal(r.read, null)
  assert.equal(r.event.id, NEW.id, 'the event is still reported, for the UI')
  assert.deepEqual(status(r), { 'wss://a': 'answered', 'wss://b': 'hung' })
})

await check('enough answers do not excuse a hung relay: three relays, two answer, one hangs', async () => {
  const r = await read({
    'wss://a': { steps: [['event', NEW], ['eose']] },
    'wss://b': { steps: [['eose']] },
    'wss://c': { steps: [['hang']] },
  })
  assert.equal(r.trusted, false, 'the hung relay may hold a newer copy')
  assert.equal(r.reached, 3)
  assert.equal(r.answered, 2)
})

await check('nothing reachable is not an empty library', async () => {
  const r = await read({ 'wss://a': { mode: 'unreachable' }, 'wss://b': { mode: 'throw' } })
  assert.equal(r.trusted, false)
  assert.equal(r.read, null)
  assert.deepEqual(status(r), { 'wss://a': 'unreachable', 'wss://b': 'unreachable' })
})

await check('every relay answers with nothing: trusted, and the read IS an empty list', async () => {
  const r = await read({ 'wss://a': { steps: [['eose']] }, 'wss://b': { steps: [['eose']] } })
  assert.equal(r.trusted, true)
  assert.equal(r.event, null)
  assert.deepEqual(r.read, { tags: [], content: '' })
})

await check('one answer against an unreachable partner is not enough in a two-relay set', async () => {
  const r = await read({ 'wss://a': { steps: [['event', NEW], ['eose']] }, 'wss://b': { mode: 'unreachable' } })
  assert.equal(r.trusted, false, 'minAnswers is 2 and only one relay is alive')
  assert.equal(r.reached, 1)
})

await check('a dead entry does not degrade a read the rest of the set answered', async () => {
  const r = await read({
    'wss://a': { steps: [['event', NEW], ['eose']] },
    'wss://b': { steps: [['eose']] },
    'wss://dead': { mode: 'unreachable' },
  })
  assert.equal(r.trusted, true)
  assert.equal(r.reached, 2)
})

await check('a refusal (CLOSED "kinds not supported") is excluded, not counted as an answer', async () => {
  const r1 = await read({
    'wss://fountain': { steps: [['closed', 'kinds not supported']] },
    'wss://a': { steps: [['event', NEW], ['eose']] },
    'wss://b': { steps: [['eose']] },
  })
  assert.equal(r1.trusted, true)
  assert.equal(status(r1)['wss://fountain'], 'refused')
  assert.equal(r1.relays.find((x) => x.url === 'wss://fountain').reason, 'kinds not supported')
  const r2 = await read({
    'wss://fountain': { steps: [['closed', 'kinds not supported']] },
    'wss://a': { steps: [['eose']] },
  })
  assert.equal(r2.trusted, false, 'two refusals and one answer is one answer')
})

await check('a relay that drops after opening is reached and unanswered', async () => {
  const r = await read({ 'wss://a': { steps: [['event', NEW], ['drop']] }, 'wss://b': { steps: [['eose']] } })
  assert.equal(r.trusted, false)
  assert.equal(status(r)['wss://a'], 'closed')
})

await check('a forged, foreign or wrong-kind event is ignored; the relay still answered', async () => {
  const foreign = finalizeEvent({ kind: 10333, created_at: 9000, tags: [], content: '' }, generateSecretKey())
  const wrongKind = finalizeEvent({ kind: 30078, created_at: 9000, tags: [], content: '' }, sk)
  const tampered = { ...NEW, created_at: 9000 }
  const r = await read({
    'wss://a': { steps: [['event', foreign], ['event', wrongKind], ['event', tampered], ['event', OLD], ['eose']] },
    'wss://b': { steps: [['foreign-sub', NEW], ['eose']] },
  })
  assert.equal(r.trusted, true)
  assert.equal(r.event.id, OLD.id, 'only the genuinely signed, right-author, right-kind event survives')
})

await check('a tie on created_at goes to the lowest id on both relays', async () => {
  const x = list(3000, [['i', 'podcast:guid:x']])
  const y = list(3000, [['i', 'podcast:guid:y']])
  const lower = x.id < y.id ? x : y
  const r = await read({ 'wss://a': { steps: [['event', x], ['eose']] }, 'wss://b': { steps: [['event', y], ['eose']] } })
  assert.equal(r.event.id, lower.id)
})

await check('the REQ asks for exactly this kind and this author', async () => {
  const seen = []
  const connect = (url) => { const s = new FakeSocket({ steps: [['eose']] }); seen.push(s); return s }
  await R.readFavorites(pk, { relays: ['wss://a', 'wss://b'], timeoutMs: 60, connect, verify: verifyEvent })
  for (const s of seen) {
    assert.equal(s.sent[0][0], 'REQ')
    assert.deepEqual(s.sent[0][2], { kinds: [10333], authors: [pk] })
    assert.equal(s.closed, true, 'the socket is closed after the answer')
  }
})

await check('the timeout bounds a hung relay', async () => {
  const t0 = Date.now()
  await read({ 'wss://a': { steps: [['hang']] }, 'wss://b': { steps: [['hang']] } }, { timeoutMs: 80 })
  const took = Date.now() - t0
  assert.ok(took < 1000, `resolved in ${took}ms`)
})

await check('the default set is the four measured relays and none that refuse', () => {
  assert.deepEqual([...R.READ_RELAYS], ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.ditto.pub', 'wss://relay.mostr.pub'])
  assert.ok(!R.READ_RELAYS.includes('wss://relay.fountain.fm'))
})

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
