#!/usr/bin/env node
/**
 * `/api/value`, the value-block resolver every boost surface pays through:
 * the SHIPPED handler with `fetch` stubbed, so it never asks Podcast Index.
 *
 * What it pins, and why:
 *   - ⚠️ THE STORED FEED URL RESOLVES BEFORE THE GUID (2026-09-06). Podcast
 *     Index keeps one feed per podcastGuid for `byguid`, and after a show moves
 *     hosts that can be the dead record with a year-old value block (Stacker
 *     News Live: keysend 95/4/1 where the live feed declares 98/2). The
 *     collector stores the live feed's URL; this endpoint has to use it.
 *   - the guid is the fallback for a URL PI does not know, an unusable URL
 *     (credentials, a non-http scheme) is no lookup at all, and a numeric
 *     feedId short-circuits both;
 *   - the episode's own value block wins over the feed's, and a feed-level
 *     block answers when the episode has none;
 *   - a feed PI does not have is a 200 `value: null`, never an error; no
 *     credentials is 503; a non-numeric feedId is 400; OPTIONS is 204;
 *     recipients are normalized (node/lnaddress only, positive splits,
 *     custom key/value carried together).
 *
 * Confirmed red on two mutations: the lookup order flipped back, and the
 * episode-level preference dropped.
 *
 * Run: node scripts/test-value.mjs
 */
import assert from 'node:assert/strict'
import { onRequest } from '../functions/api/value.js'

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

const env = { PODCAST_INDEX_KEY: 'k', PODCAST_INDEX_SECRET: 's' }
let calls = []
function stub(map) {
  calls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    for (const [prefix, answer] of Object.entries(map)) {
      if (u.includes(prefix)) return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  }
}
const get = async (qs, e = env) => {
  const res = await onRequest({ request: new Request(`https://onlyboosts.social/api/value${qs}`, { headers: { Origin: 'https://onlyboosts.social' } }), env: e })
  let body = null
  try { body = await res.json() } catch {}
  return { res, body }
}

// Two records for one guid, as Podcast Index really holds them for Stacker
// News Live: the dead Anchor one the guid names, the live Fountain one the URL names.
const DEAD = { feed: { id: 4866432, value: { model: { type: 'lightning', method: 'keysend' }, destinations: [
  { name: 'host', type: 'node', address: '03b6', split: 95, customKey: '906608', customValue: 'x' },
  { name: 'Fountain', type: 'node', address: '03b6', split: 4 },
  { name: 'PI', type: 'node', address: '03ae', split: 1 },
] } } }
const LIVE = { feed: { id: 7475249, value: { model: { type: 'lightning', method: 'keysend' }, destinations: [
  { name: 'host', type: 'lnaddress', address: 'host@fountain.fm', split: 98 },
  { name: 'Fountain', type: 'lnaddress', address: 'boostbot@fountain.fm', split: 2 },
] } } }
const BY_ID = (u) => u.includes('id=7475249') ? LIVE : DEAD
function stubBoth(extra = {}) {
  calls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.includes('/podcasts/byfeedurl')) return json(u.includes('fountain') ? LIVE : { feed: {} })
    if (u.includes('/podcasts/byguid')) return json(DEAD)
    if (u.includes('/podcasts/byfeedid')) return json(BY_ID(u))
    if (u.includes('/episodes/byguid')) return json(extra.episode ?? { episode: {} })
    return new Response('not found', { status: 404 })
  }
}

console.log('\n/api/value')

await check('⚠️ the stored feed URL resolves first: the live record\'s splits, and the guid is never asked', async () => {
  stubBoth()
  const { res, body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Ffeeds.fountain.fm%2Fabc')
  assert.equal(res.status, 200)
  assert.equal(body.level, 'feed')
  assert.deepEqual(body.value.recipients.map((r) => [r.address, r.split]), [['host@fountain.fm', 98], ['boostbot@fountain.fm', 2]])
  assert.ok(calls[0].includes('/podcasts/byfeedurl?url=https%3A%2F%2Ffeeds.fountain.fm%2Fabc'))
  assert.ok(!calls.some((c) => c.includes('/podcasts/byguid')), 'byguid consulted although the URL answered')
})

await check('a feed URL PI does not know falls back to the guid', async () => {
  stubBoth()
  const { body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Fanchor.fm%2Fdead')
  assert.equal(body.value.recipients[0].split, 95)
  assert.ok(calls[0].includes('byfeedurl')); assert.ok(calls[1].includes('/podcasts/byguid?guid=afbaa6da'))
})

await check('no feed URL: the guid alone, as before', async () => {
  stubBoth()
  const { body } = await get('?podcastGuid=afbaa6da')
  assert.equal(body.value.recipients[0].split, 95)
  assert.ok(calls[0].includes('/podcasts/byguid'))
  assert.ok(!calls.some((c) => c.includes('byfeedurl')))
})

await check('an unusable feed URL is no lookup at all (credentials, ftp)', async () => {
  for (const bad of ['https%3A%2F%2Fu%3Apw%40f.example%2Frss', 'ftp%3A%2F%2Ff.example%2Frss']) {
    stubBoth()
    const { body } = await get(`?podcastGuid=afbaa6da&feedUrl=${bad}`)
    assert.equal(body.value.recipients[0].split, 95)
    assert.ok(!calls.some((c) => c.includes('byfeedurl')), `byfeedurl called for ${bad}`)
  }
})

await check('a numeric feedId short-circuits both lookups', async () => {
  stubBoth()
  const { body } = await get('?feedId=7475249&podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Fanchor.fm%2Fdead')
  assert.equal(body.value.recipients[0].split, 98)
  assert.ok(!calls.some((c) => c.includes('byfeedurl') || c.includes('/podcasts/byguid')))
})

await check('the episode\'s own value block wins over the feed\'s, resolved under the same record', async () => {
  stubBoth({ episode: { episode: { value: { model: { type: 'lightning', method: 'keysend' }, destinations: [
    { name: 'guest', type: 'lnaddress', address: 'guest@x', split: 50 }, { name: 'host', type: 'lnaddress', address: 'host@x', split: 50 },
  ] } } } })
  const { body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Ffeeds.fountain.fm%2Fabc&guid=ep-240')
  assert.equal(body.level, 'episode')
  assert.deepEqual(body.value.recipients.map((r) => r.address), ['guest@x', 'host@x'])
  assert.ok(calls.some((c) => c.includes('/episodes/byguid?guid=ep-240&feedid=7475249')), 'the episode is looked up under the live feed id')
})

await check('an episode with no block of its own answers with the feed\'s', async () => {
  stubBoth()
  const { body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Ffeeds.fountain.fm%2Fabc&guid=ep-240')
  assert.equal(body.level, 'feed'); assert.equal(body.value.recipients[0].split, 98)
})

await check('recipients are normalized: node/lnaddress only, positive splits, custom key and value together', async () => {
  stub({ '/podcasts/byfeedid': { feed: { value: { model: { type: 'lightning' }, destinations: [
    { type: 'node', address: '03aa', split: 90, customKey: '1', customValue: 'v' },
    { type: 'node', address: '03bb', split: 5, customKey: '1' },
    { type: 'lnaddress', address: 'a@b', split: 0 },
    { type: 'hive', address: 'x', split: 5 },
    { type: 'lnaddress', address: '', split: 5 },
  ] } } } })
  const { body } = await get('?feedId=1')
  assert.deepEqual(body.value.recipients, [
    { name: '', type: 'node', address: '03aa', split: 90, fee: false, customKey: '1', customValue: 'v' },
    { name: '', type: 'node', address: '03bb', split: 5, fee: false },
  ])
})

await check('a feed PI does not have is 200 value:null, cached', async () => {
  stub({})
  const { res, body } = await get('?podcastGuid=nobody&feedUrl=https%3A%2F%2Fnowhere%2Frss')
  assert.equal(res.status, 200); assert.equal(body.value, null); assert.ok(body.reason)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=600')
})

await check('the request contract: no params 400, bad feedId 400, no credentials 503, OPTIONS 204', async () => {
  stub({})
  assert.equal((await get('')).res.status, 400)
  assert.equal((await get('?feedId=abc')).res.status, 400)
  assert.equal((await get('?feedId=1', {})).res.status, 503)
  const res = await onRequest({ request: new Request('https://onlyboosts.social/api/value', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://onlyboosts.social', 'a foreign origin is not reflected')
})

console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} passed`)
