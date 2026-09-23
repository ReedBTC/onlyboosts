#!/usr/bin/env node
/**
 * `/api/value`, the value-block resolver every boost surface pays through:
 * the SHIPPED handler with `fetch` stubbed, so it never reads a feed or asks
 * Podcast Index.
 *
 * What it pins, and why:
 *   - ⚠️ THE SHOW'S OWN RSS IS THE SOURCE AND PODCAST INDEX IS THE FALLBACK
 *     (2026-09-23). PI's episode records keep the block each song was
 *     ingested with: on Jimmy V's collection, one channel block and no item
 *     blocks in the feed, PI answered ten of thirteen songs with a stale
 *     seven-leg block and every song boost from here paid it. So a song with
 *     no block of its own gets the CHANNEL's, and PI's record of that song is
 *     never asked; a song's own block wins; a valueTimeSplit's recipients
 *     and a liveItem's block are not the boost's; the namespace prefix is
 *     whatever the feed bound; a guid-only caller still reads the feed PI's
 *     record names.
 *   - PI answers when the feed is unreachable, is not RSS, declares no value
 *     block anywhere (Anchor), or is cut by the byte cap before the item.
 *   - ⚠️ THE STORED FEED URL RESOLVES BEFORE THE GUID on the PI side
 *     (2026-09-06). Podcast Index keeps one feed per podcastGuid for `byguid`,
 *     and after a show moves hosts that can be the dead record with a
 *     year-old value block (Stacker News Live: keysend 95/4/1 where the live
 *     feed declares 98/2). The collector stores the live feed's URL; this
 *     endpoint has to use it.
 *   - the guid is the fallback for a URL PI does not know, an unusable URL
 *     (credentials, a non-http scheme) is no lookup at all — and no feed
 *     fetch either — and a numeric feedId short-circuits the PI lookups;
 *   - a feed neither source has is a 200 `value: null`, never an error; no
 *     credentials is 503; a non-numeric feedId is 400; OPTIONS is 204;
 *     recipients are normalized identically from both sources (node/lnaddress
 *     only, positive splits, custom key/value carried together).
 *
 * Confirmed red on four mutations: PI consulted before the feed, the
 * valueTimeSplit strip dropped, the liveItem strip dropped, and the
 * PI-side lookup order flipped back.
 *
 * Run: node scripts/test-value.mjs
 */
import assert from 'node:assert/strict'
import { onRequest, readRssValue } from '../functions/api/value.js'

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

const env = { PODCAST_INDEX_KEY: 'k', PODCAST_INDEX_SECRET: 's' }
let calls = []
const piCalls = () => calls.filter((c) => c.includes('api.podcastindex.org'))
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
const xml = (s) => new Response(s, { status: 200, headers: { 'content-type': 'application/rss+xml' } })

const get = async (qs, e = env) => {
  const res = await onRequest({ request: new Request(`https://onlyboosts.social/api/value${qs}`, { headers: { Origin: 'https://onlyboosts.social' } }), env: e })
  let body = null
  try { body = await res.json() } catch {}
  return { res, body }
}

// --- Podcast Index, as it really holds Stacker News Live: the dead Anchor
// record the guid names, the live Fountain one the URL names.
const DEAD = { feed: { id: 4866432, url: 'https://anchor.fm/dead', value: { model: { type: 'lightning', method: 'keysend' }, destinations: [
  { name: 'host', type: 'node', address: '03b6', split: 95, customKey: '906608', customValue: 'x' },
  { name: 'Fountain', type: 'node', address: '03b6', split: 4 },
  { name: 'PI', type: 'node', address: '03ae', split: 1 },
] } } }
const LIVE = { feed: { id: 7475249, url: 'https://feeds.fountain.fm/abc', value: { model: { type: 'lightning', method: 'keysend' }, destinations: [
  { name: 'host', type: 'lnaddress', address: 'host@fountain.fm', split: 98 },
  { name: 'Fountain', type: 'lnaddress', address: 'boostbot@fountain.fm', split: 2 },
] } } }
// The stale seven-leg block PI holds for ten of Jimmy V's thirteen songs.
const STALE_EPISODE = { episode: { value: { model: { type: 'lightning', method: 'keysend' }, destinations: [
  { name: 'host', type: 'node', address: '03host', split: 85, customKey: '906608', customValue: 'abc' },
  { name: 'Kolomona', type: 'node', address: '03kol', split: 5, customKey: '906608', customValue: '912e' },
  { name: 'Fountain Boostbot', type: 'node', address: '03fountain', split: 1, customKey: '906608', customValue: '01ar' },
] } } }

// --- A feed, on the shape Sovereign Feeds writes: a liveItem BEFORE the
// channel block, the channel block, a song with its own block (and a
// valueTimeSplit inside it), and a song with none. `pfx` is whatever the feed
// bound the namespace to.
function feedXml({ pfx = 'podcast', channel = true, live = true, items = true, pad = '' } = {}) {
  const v = (inner, attrs = 'type="lightning" method="keysend"') => `<${pfx}:value ${attrs}>${inner}</${pfx}:value>`
  const r = (attrs) => `<${pfx}:valueRecipient ${attrs}/>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:${pfx}="https://podcastindex.org/namespace/1.0"><channel>
<title>Jimmy V - Music</title>
${live ? `<${pfx}:liveItem status="live" start="2026-01-01T00:00:00Z">${v(r('type="node" address="03live" split="100"'))}</${pfx}:liveItem>` : ''}
${channel ? v(`
  ${r('name="Jimmy V &amp; Co" type="node" address="03host" customKey="906608" customValue="abc" split="85"')}
  ${r(`split="5" address="03sir" type="node" name='SirLibre Node'`)}
  ${r('type="lnaddress" address="steven@getalby.com" split="4" fee="true"')}
  ${r('type="hive" address="x" split="6"')}
`, 'type="lightning" method="keysend" suggested="0.00000005000"') : ''}
${pad}
${items ? `<item><title>Own</title><guid isPermaLink="false"><![CDATA[song-own]]></guid>
  ${v(`
    ${r('name="guest" type="lnaddress" address="guest@x" split="50"')}
    <${pfx}:valueTimeSplit startTime="60" duration="30" remotePercentage="90">
      <${pfx}:remoteItem feedGuid="f" itemGuid="i"/>
      ${v(r('type="node" address="03window" split="100"'))}
    </${pfx}:valueTimeSplit>
    ${r('name="host" type="lnaddress" address="host@x" split="50"')}
  `)}
</item>
<item><title>Plain</title><guid>song-plain</guid></item>` : ''}
</channel></rss>`
}
const CHANNEL_LEGS = [
  { name: 'Jimmy V & Co', type: 'node', address: '03host', split: 85, fee: false, customKey: '906608', customValue: 'abc' },
  { name: 'SirLibre Node', type: 'node', address: '03sir', split: 5, fee: false },
  { name: '', type: 'lnaddress', address: 'steven@getalby.com', split: 4, fee: true },
]

// fetch: the feed at `feeds[url]` (a string body, or a Response), PI as above.
function stub({ feeds = {}, episode = null } = {}) {
  calls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    if (u in feeds) return typeof feeds[u] === 'string' ? xml(feeds[u]) : feeds[u]
    if (u.includes('/podcasts/byfeedurl')) return json(u.includes('fountain') ? LIVE : { feed: {} })
    if (u.includes('/podcasts/byguid')) return json(DEAD)
    if (u.includes('/podcasts/byfeedid')) return json(u.includes('id=7475249') ? LIVE : DEAD)
    if (u.includes('/episodes/byguid')) return json(episode ?? { episode: {} })
    return new Response('not found', { status: 404 })
  }
}
const FEED = 'https://music.example/collection.xml'
const Q = `?podcastGuid=dbad52b9&feedUrl=${encodeURIComponent(FEED)}`

console.log('\n/api/value — the feed is the source')

await check('⚠️ the feed is read first: its channel block answers, and Podcast Index is never asked', async () => {
  stub({ feeds: { [FEED]: feedXml() } })
  const { res, body } = await get(Q)
  assert.equal(res.status, 200)
  assert.equal(body.level, 'feed'); assert.equal(body.source, 'rss')
  assert.deepEqual(body.value.recipients, CHANNEL_LEGS, 'normalized as PI\'s are: node/lnaddress only, custom pair together, fee read')
  assert.deepEqual(body.value.model, { type: 'lightning', method: 'keysend', suggested: '0.00000005000' })
  assert.equal(calls[0], FEED, 'the feed is the first fetch')
  assert.deepEqual(piCalls(), [], 'Podcast Index consulted although the feed answered')
})

await check('⚠️ a song with no block of its own gets the CHANNEL\'s, and PI\'s stale record of it is never asked (Jimmy V)', async () => {
  stub({ feeds: { [FEED]: feedXml() }, episode: STALE_EPISODE })
  const { body } = await get(`${Q}&guid=song-plain`)
  assert.equal(body.level, 'feed'); assert.equal(body.source, 'rss')
  assert.deepEqual(body.value.recipients.map((r) => r.address), ['03host', '03sir', 'steven@getalby.com'])
  assert.ok(!body.value.recipients.some((r) => r.address === '03fountain'), 'the stale Fountain Boostbot leg was paid')
  assert.deepEqual(piCalls(), [])
})

await check('a song\'s own block wins, and a valueTimeSplit\'s recipients are not the boost\'s', async () => {
  stub({ feeds: { [FEED]: feedXml() }, episode: STALE_EPISODE })
  const { body } = await get(`${Q}&guid=song-own`)
  assert.equal(body.level, 'episode'); assert.equal(body.source, 'rss')
  assert.deepEqual(body.value.recipients.map((r) => [r.address, r.split]), [['guest@x', 50], ['host@x', 50]])
  assert.deepEqual(piCalls(), [])
})

await check('a liveItem\'s block is not the channel\'s: with no channel block, the feed has nothing and PI answers', async () => {
  stub({ feeds: { [FEED]: feedXml({ channel: false }) } })
  const { body } = await get(Q)
  assert.equal(body.source, 'pi')
  assert.ok(!body.value.recipients.some((r) => r.address === '03live'), 'the live stream\'s recipient leaked into the channel block')
})

await check('the namespace prefix is whatever the feed bound', async () => {
  stub({ feeds: { [FEED]: feedXml({ pfx: 'pc' }) } })
  const { body } = await get(`${Q}&guid=song-own`)
  assert.equal(body.source, 'rss'); assert.equal(body.level, 'episode')
  assert.deepEqual(body.value.recipients.map((r) => r.address), ['guest@x', 'host@x'])
})

await check('an item absent from a complete feed is not published: the channel block, and no episode lookup', async () => {
  stub({ feeds: { [FEED]: feedXml() }, episode: STALE_EPISODE })
  const { body } = await get(`${Q}&guid=gone`)
  assert.equal(body.level, 'feed'); assert.equal(body.source, 'rss')
  assert.deepEqual(piCalls(), [])
})

await check('a channel block after the last item still counts', async () => {
  const head = feedXml({ channel: false, live: false })
  const tailBlock = `<podcast:value type="lightning" method="keysend"><podcast:valueRecipient type="node" address="03tail" split="100"/></podcast:value>`
  stub({ feeds: { [FEED]: head.replace('</channel>', `${tailBlock}</channel>`) } })
  const { body } = await get(`${Q}&guid=song-plain`)
  assert.equal(body.source, 'rss'); assert.equal(body.value.recipients[0].address, '03tail')
})

await check('a guid-only caller still reads the feed PI\'s record names', async () => {
  stub({ feeds: { 'https://anchor.fm/dead': feedXml() } })
  const { body } = await get('?podcastGuid=dbad52b9&guid=song-plain')
  assert.equal(body.source, 'rss'); assert.equal(body.value.recipients[0].address, '03host')
  assert.deepEqual(piCalls().map((c) => c.split('/api/1.0')[1].split('?')[0]), ['/podcasts/byguid'])
})

console.log('\n/api/value — Podcast Index is the fallback')

await check('a feed with no value block anywhere (Anchor) falls to PI, the episode\'s record first', async () => {
  stub({ feeds: { [FEED]: feedXml({ channel: false, live: false }) }, episode: STALE_EPISODE })
  const { body } = await get(`${Q}&guid=song-plain`)
  assert.equal(body.source, 'pi'); assert.equal(body.level, 'episode')
  assert.equal(body.value.recipients.length, 3)
})

await check('an unreachable feed and a 200 that is not RSS both fall to PI', async () => {
  for (const bad of [new Response('gone', { status: 404 }), xml('<html><body>Suspended</body></html>'), new Response('{"not":"rss"}')]) {
    stub({ feeds: { [FEED]: bad } })
    const { body } = await get(Q)
    assert.equal(body.source, 'pi'); assert.equal(body.level, 'feed')
  }
})

await check('the byte cap: an item past it is unread, not absent — PI\'s record, then the channel block', async () => {
  // Enough padding to push the items past RSS_MAX_BYTES (4MB).
  const padded = feedXml({ pad: `<!-- ${'x'.repeat(4 * 1024 * 1024 + 64)} -->` })
  stub({ feeds: { [FEED]: padded }, episode: STALE_EPISODE })
  let { body } = await get(`${Q}&guid=song-plain`)
  assert.equal(body.source, 'pi'); assert.equal(body.level, 'episode', 'PI\'s episode record is the next best reading')
  assert.ok(piCalls().some((c) => c.includes('/episodes/byguid?guid=song-plain')))
  stub({ feeds: { [FEED]: padded } })
  ;({ body } = await get(`${Q}&guid=song-plain`))
  assert.equal(body.source, 'rss'); assert.equal(body.level, 'feed', 'with no PI record, the channel block read from the head')
  assert.deepEqual(body.value.recipients.map((r) => r.address), ['03host', '03sir', 'steven@getalby.com'])
})

await check('⚠️ on the PI side the stored feed URL resolves first: the live record\'s splits, and the guid is never asked', async () => {
  stub()
  const { res, body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Ffeeds.fountain.fm%2Fabc')
  assert.equal(res.status, 200)
  assert.equal(body.level, 'feed'); assert.equal(body.source, 'pi')
  assert.deepEqual(body.value.recipients.map((r) => [r.address, r.split]), [['host@fountain.fm', 98], ['boostbot@fountain.fm', 2]])
  assert.equal(calls[0], 'https://feeds.fountain.fm/abc', 'the feed itself is tried first')
  assert.ok(piCalls()[0].includes('/podcasts/byfeedurl?url=https%3A%2F%2Ffeeds.fountain.fm%2Fabc'))
  assert.ok(!calls.some((c) => c.includes('/podcasts/byguid')), 'byguid consulted although the URL answered')
})

await check('a feed URL PI does not know falls back to the guid', async () => {
  stub()
  const { body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Fanchor.fm%2Fdead')
  assert.equal(body.value.recipients[0].split, 95)
  assert.ok(piCalls()[0].includes('byfeedurl')); assert.ok(piCalls()[1].includes('/podcasts/byguid?guid=afbaa6da'))
})

await check('no feed URL: the guid alone, as before', async () => {
  stub()
  const { body } = await get('?podcastGuid=afbaa6da')
  assert.equal(body.value.recipients[0].split, 95)
  assert.ok(piCalls()[0].includes('/podcasts/byguid'))
  assert.ok(!calls.some((c) => c.includes('byfeedurl')))
})

await check('an unusable feed URL is no lookup at all — no feed fetch, no byfeedurl (credentials, ftp)', async () => {
  for (const bad of ['https%3A%2F%2Fu%3Apw%40f.example%2Frss', 'ftp%3A%2F%2Ff.example%2Frss']) {
    stub()
    const { body } = await get(`?podcastGuid=afbaa6da&feedUrl=${bad}`)
    assert.equal(body.value.recipients[0].split, 95)
    assert.ok(!calls.some((c) => c.includes('byfeedurl')), `byfeedurl called for ${bad}`)
    assert.ok(!calls.some((c) => c.includes('f.example')), `the feed was fetched for ${bad}`)
  }
})

await check('a numeric feedId short-circuits both PI lookups', async () => {
  stub()
  const { body } = await get('?feedId=7475249&podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Fanchor.fm%2Fdead')
  assert.equal(body.value.recipients[0].split, 98)
  assert.ok(!calls.some((c) => c.includes('byfeedurl') || c.includes('/podcasts/byguid')))
})

await check('PI\'s episode block wins over its feed\'s, resolved under the same record', async () => {
  stub({ episode: { episode: { value: { model: { type: 'lightning', method: 'keysend' }, destinations: [
    { name: 'guest', type: 'lnaddress', address: 'guest@x', split: 50 }, { name: 'host', type: 'lnaddress', address: 'host@x', split: 50 },
  ] } } } })
  const { body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Ffeeds.fountain.fm%2Fabc&guid=ep-240')
  assert.equal(body.level, 'episode'); assert.equal(body.source, 'pi')
  assert.deepEqual(body.value.recipients.map((r) => r.address), ['guest@x', 'host@x'])
  assert.ok(calls.some((c) => c.includes('/episodes/byguid?guid=ep-240&feedid=7475249')), 'the episode is looked up under the live feed id')
})

await check('an episode PI has no block for answers with the feed\'s', async () => {
  stub()
  const { body } = await get('?podcastGuid=afbaa6da&feedUrl=https%3A%2F%2Ffeeds.fountain.fm%2Fabc&guid=ep-240')
  assert.equal(body.level, 'feed'); assert.equal(body.value.recipients[0].split, 98)
})

await check('PI recipients are normalized: node/lnaddress only, positive splits, custom key and value together', async () => {
  calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/podcasts/byfeedid')) return json({ feed: { value: { model: { type: 'lightning' }, destinations: [
      { type: 'node', address: '03aa', split: 90, customKey: '1', customValue: 'v' },
      { type: 'node', address: '03bb', split: 5, customKey: '1' },
      { type: 'lnaddress', address: 'a@b', split: 0 },
      { type: 'hive', address: 'x', split: 5 },
      { type: 'lnaddress', address: '', split: 5 },
    ] } } })
    return new Response('not found', { status: 404 })
  }
  const { body } = await get('?feedId=1')
  assert.deepEqual(body.value.recipients, [
    { name: '', type: 'node', address: '03aa', split: 90, fee: false, customKey: '1', customValue: 'v' },
    { name: '', type: 'node', address: '03bb', split: 5, fee: false },
  ])
})

await check('a feed neither source has is 200 value:null, cached', async () => {
  calls = []
  globalThis.fetch = async () => new Response('not found', { status: 404 })
  const { res, body } = await get('?podcastGuid=nobody&feedUrl=https%3A%2F%2Fnowhere%2Frss')
  assert.equal(res.status, 200); assert.equal(body.value, null); assert.ok(body.reason)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=600')
})

await check('the request contract: no params 400, bad feedId 400, no credentials 503, OPTIONS 204', async () => {
  stub()
  assert.equal((await get('')).res.status, 400)
  assert.equal((await get('?feedId=abc')).res.status, 400)
  assert.equal((await get('?feedId=1', {})).res.status, 503)
  const res = await onRequest({ request: new Request('https://onlyboosts.social/api/value', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://onlyboosts.social', 'a foreign origin is not reflected')
})

console.log('\nreadRssValue')

await check('a self-closing <podcast:value/> declares nothing, and a guid with entities compares decoded', async () => {
  const r = readRssValue(`<rss><channel><podcast:value/><item><guid>a&amp;b</guid><podcast:value type="lightning" method="keysend"><podcast:valueRecipient type="node" address="03x" split="1"/></podcast:value></item></channel></rss>`, 'a&b')
  assert.equal(r.channel, null); assert.ok(r.itemFound); assert.equal(r.item.recipients[0].address, '03x')
  assert.equal(readRssValue('not xml', 'x'), null)
})

console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} passed`)
