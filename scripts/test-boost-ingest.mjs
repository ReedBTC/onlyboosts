#!/usr/bin/env node
/**
 * `/api/v1/boosts/ingest`: the SHIPPED handler over a `node:sqlite` build of
 * the real `schema.sql`, fed by the SHIPPED note builder and a real signature.
 *
 * What it pins, and why each matters:
 *   - a signed note from `buildExternalNoteTemplate` lands as a `boosts` row
 *     whose fields agree with the collector's reading (sats from the amount
 *     tag, `client_id = 'onlyboosts'`, the npub), plus its FTS row and its
 *     `boosts_edge` marker;
 *   - the touched show's five aggregates and the episode's four are recounted
 *     from D1, against a brute-force count — `booster_count` is DISTINCT, so
 *     the same member twice does not move it;
 *   - a stub episode row is created only when D1 has none, carries the hint's
 *     title, and is never written over a row the collector already filled;
 *     the collector's own `INSERT OR REPLACE` then overwrites the stub;
 *   - the same event posted twice is one row, one FTS row, one marker;
 *   - a tampered note, a note with another client tag, a donation note and a
 *     note outside the clock window are refused; and the window is the WIDER
 *     one — a note the oracle's own ±5 min would refuse is still indexed;
 *   - no D1 or no KV is 503, the limiter is 429, the response is `no-store`
 *     with the exact-match CORS origin.
 *
 * Confirmed red on three mutations: DISTINCT dropped from booster_count, the
 * existence pre-read removed (duplicated FTS row), verifyEvent bypassed.
 *
 * Run: node scripts/test-boost-ingest.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'
import { onRequestPost, onRequestOptions, overRateLimit, boostRowFromEvent, validateSubmission, INGEST_SKEW_SECS }
  from '../functions/api/v1/boosts/ingest.js'
import { validateBoostTemplate } from '../functions/api/sign-boost.js'
import { finalizeEvent, getPublicKey, nip19 } from '../functions/_shared/nostr-sign.js'
import { buildExternalNoteTemplate, buildDonationNoteTemplate } from '../login-widget/src/lib/externalBoostagram.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// ── The database and the D1 shim ────────────────────────────────────────────
const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))
// The endpoint provisions its own marker table; prove it by taking away the
// copy schema.sql carries.
db.exec('DROP TABLE boosts_edge')

/* Models prepare/bind/all/first/run AND batch, which this endpoint is the
 * first Function to use. A batch is the statements run in order; a read
 * returns `{ results }`, a write returns an empty one, which is D1's shape. */
const isRead = (sql) => /^\s*SELECT/i.test(sql)
const stmt = (sql, args) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: db.prepare(sql).all(...(args || [])) }),
  first: async () => db.prepare(sql).get(...(args || [])) ?? null,
  run: async () => { db.prepare(sql).run(...(args || [])); return { success: true } },
  _exec: () => isRead(sql)
    ? { results: db.prepare(sql).all(...(args || [])) }
    : (db.prepare(sql).run(...(args || [])), { results: [] }),
})
const DB = { prepare: (sql) => stmt(sql), batch: async (stmts) => stmts.map((s) => s._exec()) }
const kvStore = new Map()
const KV = { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v) } }
const env = { DB, SIGN_RATELIMIT: KV }

// ── The fixture: one indexed show with two boosts, one indexed episode ──────
const SHOW = 'show-guid-1'
const OLD_EP = 'old-episode-guid'
const NOW = Math.floor(Date.now() / 1000)
db.prepare(`INSERT INTO podcasts (podcast_guid, title, image, medium, boost_count, total_sats, booster_count, episode_count, latest_ts)
            VALUES (?, 'Fixture Show', 'https://x/art.png', 'podcast', 2, 300, 2, 1, ?)`).run(SHOW, NOW - 86400)
db.prepare(`INSERT INTO podcasts_fts (podcast_guid, title, author) VALUES (?, 'Fixture Show', NULL)`).run(SHOW)
db.prepare(`INSERT INTO episodes (item_guid, podcast_guid, title, published, duration, boost_count, total_sats, booster_count, latest_ts)
            VALUES (?, ?, 'Collector Title', 1700000000, 3600, 2, 300, 2, ?)`).run(OLD_EP, SHOW, NOW - 86400)
db.prepare(`INSERT INTO episodes_fts (item_guid, title, show) VALUES (?, 'Collector Title', 'Fixture Show')`).run(OLD_EP)
for (const [n, pk] of [[1, 'a'.repeat(64)], [2, 'b'.repeat(64)]]) {
  db.prepare(`INSERT INTO boosts (event_id, booster_pubkey, created_at, sats, podcast_guid, item_guid)
              VALUES (?, ?, ?, 150, ?, ?)`).run(`f${n}`.padEnd(64, '0'), pk, NOW - 86400 - n, SHOW, OLD_EP)
}

// ── Signing ─────────────────────────────────────────────────────────────────
const sk = webcrypto.getRandomValues(new Uint8Array(32))
const pk = getPublicKey(sk)
const sk2 = webcrypto.getRandomValues(new Uint8Array(32))

function template(over = {}) {
  return buildExternalNoteTemplate({
    paidSats: 2100, legsPaid: 2, legsTotal: 2, message: 'great episode',
    showTitle: 'Fixture Show', episodeTitle: 'Brand New Episode',
    podcastGuid: SHOW, itemGuid: 'new-episode-guid', bmbUrl: 'https://boostmebitch.com/x',
    ...over,
  })
}
const signed = (t = template(), key = sk) => finalizeEvent(t, key)

// Each post comes from its own address unless a test says otherwise, so the
// limiter (tested on its own below) does not shadow every other assertion.
let ipN = 0
async function post(body, headers = {}) {
  const request = new Request('https://onlyboosts.social/api/v1/boosts/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'https://onlyboosts.social', 'CF-Connecting-IP': `203.0.113.${++ipN}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await onRequestPost({ request, env })
  let data = null
  try { data = await res.json() } catch {}
  return { res, data }
}

const count = (sql, ...a) => db.prepare(sql).get(...a).n
const row = (sql, ...a) => { const r = db.prepare(sql).get(...a); return r ? { ...r } : r }

// Brute-force the aggregates the way the collector defines them.
function expectShow(guid) {
  return row(`SELECT COUNT(*) AS boost_count, COALESCE(SUM(sats),0) AS total_sats,
                     COUNT(DISTINCT booster_pubkey) AS booster_count,
                     COUNT(DISTINCT item_guid) AS episode_count, MAX(created_at) AS latest_ts
              FROM boosts WHERE podcast_guid = ?`, guid)
}
function expectEpisode(guid) {
  return row(`SELECT COUNT(*) AS boost_count, COALESCE(SUM(sats),0) AS total_sats,
                     COUNT(DISTINCT booster_pubkey) AS booster_count, MAX(created_at) AS latest_ts
              FROM boosts WHERE item_guid = ?`, guid)
}
const showAgg = (g) => row('SELECT boost_count,total_sats,booster_count,episode_count,latest_ts FROM podcasts WHERE podcast_guid=?', g)
const epAgg = (g) => row('SELECT boost_count,total_sats,booster_count,latest_ts FROM episodes WHERE item_guid=?', g)

console.log('\n/api/v1/boosts/ingest')

// ── Configuration ───────────────────────────────────────────────────────────
await check('no D1 binding is 503', async () => {
  const request = new Request('https://onlyboosts.social/api/v1/boosts/ingest', { method: 'POST', body: '{}' })
  const res = await onRequestPost({ request, env: { SIGN_RATELIMIT: KV } })
  assert.equal(res.status, 503)
})
await check('no KV binding is 503 (fail closed, like the oracle)', async () => {
  const request = new Request('https://onlyboosts.social/api/v1/boosts/ingest', { method: 'POST', body: '{}' })
  const res = await onRequestPost({ request, env: { DB } })
  assert.equal(res.status, 503)
})
await check('OPTIONS answers the preflight', async () => {
  const request = new Request('https://onlyboosts.social/api/v1/boosts/ingest', { method: 'OPTIONS', headers: { Origin: 'https://onlyboosts.social' } })
  const res = await onRequestOptions({ request })
  assert.equal(res.status, 204)
})
await check('invalid JSON is 400', async () => {
  const { res, data } = await post('{not json')
  assert.equal(res.status, 400); assert.equal(data.error, 'invalid JSON')
})

// ── The happy path ──────────────────────────────────────────────────────────
const ev1 = signed()
await check('a signed note from the shipped builder is indexed, with an episode stub', async () => {
  assert.equal(count('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?', 'boosts_edge'), 0, 'precondition: the marker table is absent')
  const { res, data } = await post({ event: ev1, episode: { title: 'Brand New Episode', showTitle: 'Fixture Show' } })
  assert.equal(res.status, 200, JSON.stringify(data))
  assert.equal(data.ok, true); assert.equal(data.ingested, true)
  assert.deepEqual(data.stubs, { podcast: false, episode: true })
  assert.equal(data.event_id, ev1.id); assert.equal(data.item_guid, 'new-episode-guid')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://onlyboosts.social')
})
await check('the boosts row reads as the collector would read the note', () => {
  const b = row('SELECT * FROM boosts WHERE event_id=?', ev1.id)
  assert.ok(b, 'row missing')
  assert.equal(b.booster_pubkey, pk)
  assert.equal(b.booster_npub, nip19.npubEncode(pk))
  assert.equal(b.sats, 2100)
  assert.equal(b.amount_source, 'amount_tag')
  assert.equal(b.podcast_guid, SHOW); assert.equal(b.item_guid, 'new-episode-guid')
  assert.equal(b.client, 'onlyboosts.social'); assert.equal(b.client_id, 'onlyboosts'); assert.equal(b.client_via, null)
  assert.equal(b.message, ev1.content)
  assert.equal(b.created_at, ev1.created_at)
})
await check('the FTS row and the edge marker are written, and the marker table was self-provisioned', () => {
  assert.equal(count('SELECT COUNT(*) AS n FROM boosts_fts WHERE event_id=?', ev1.id), 1)
  const m = row('SELECT * FROM boosts_edge WHERE event_id=?', ev1.id)
  assert.ok(m, 'marker missing')
  assert.equal(m.podcast_guid, SHOW); assert.equal(m.item_guid, 'new-episode-guid')
  assert.ok(Math.abs(m.ingested_at - NOW) < 60)
})
await check('the show is recounted from D1: five aggregates, brute-forced', () => {
  assert.deepEqual(showAgg(SHOW), expectShow(SHOW))
  assert.equal(showAgg(SHOW).boost_count, 3)
  assert.equal(showAgg(SHOW).episode_count, 2)
  assert.equal(showAgg(SHOW).latest_ts, ev1.created_at)
})
await check('the stub episode carries the hint title and the show guid; its FTS row names the show by ITS D1 title', () => {
  const e = row('SELECT * FROM episodes WHERE item_guid=?', 'new-episode-guid')
  assert.ok(e, 'stub missing')
  assert.equal(e.title, 'Brand New Episode'); assert.equal(e.podcast_guid, SHOW)
  assert.equal(e.published, null); assert.equal(e.duration, null)
  assert.deepEqual(epAgg('new-episode-guid'), expectEpisode('new-episode-guid'))
  assert.equal(e.boost_count, 1); assert.equal(e.total_sats, 2100); assert.equal(e.booster_count, 1)
  const f = row('SELECT * FROM episodes_fts WHERE item_guid=?', 'new-episode-guid')
  assert.equal(f.title, 'Brand New Episode'); assert.equal(f.show, 'Fixture Show')
})
await check('the show row was not touched beyond its aggregates', () => {
  const p = row('SELECT title, image, medium FROM podcasts WHERE podcast_guid=?', SHOW)
  assert.deepEqual(p, { title: 'Fixture Show', image: 'https://x/art.png', medium: 'podcast' })
  assert.equal(count('SELECT COUNT(*) AS n FROM podcasts_fts WHERE podcast_guid=?', SHOW), 1)
})

// ── Idempotence ─────────────────────────────────────────────────────────────
await check('the same event posted again is one row, one FTS row, one marker, unchanged counts', async () => {
  const before = showAgg(SHOW)
  const { res, data } = await post({ event: ev1, episode: { title: 'Renamed By A Second Post' } })
  assert.equal(res.status, 200); assert.equal(data.ingested, false); assert.equal(data.reason, 'exists')
  assert.equal(count('SELECT COUNT(*) AS n FROM boosts WHERE event_id=?', ev1.id), 1)
  assert.equal(count('SELECT COUNT(*) AS n FROM boosts_fts WHERE event_id=?', ev1.id), 1)
  assert.equal(count('SELECT COUNT(*) AS n FROM boosts_edge WHERE event_id=?', ev1.id), 1)
  assert.deepEqual(showAgg(SHOW), before)
  assert.equal(row('SELECT title FROM episodes WHERE item_guid=?', 'new-episode-guid').title, 'Brand New Episode')
})

// ── DISTINCT boosters ───────────────────────────────────────────────────────
await check('the same member boosting the same episode again moves boost_count and not booster_count', async () => {
  const ev = signed(template({ paidSats: 500, message: 'again' }))
  const { res } = await post({ event: ev, episode: { title: 'Brand New Episode' } })
  assert.equal(res.status, 200)
  const e = epAgg('new-episode-guid')
  assert.deepEqual(e, expectEpisode('new-episode-guid'))
  assert.equal(e.boost_count, 2); assert.equal(e.booster_count, 1); assert.equal(e.total_sats, 2600)
  const s = showAgg(SHOW)
  assert.deepEqual(s, expectShow(SHOW))
  assert.equal(s.boost_count, 4); assert.equal(s.booster_count, 3)
})

// ── An episode the collector already filled ─────────────────────────────────
await check('a boost on an indexed episode recounts it and leaves the collector\'s metadata alone', async () => {
  const ev = signed(template({ itemGuid: OLD_EP, episodeTitle: 'A Title The Widget Had' }), sk2)
  const { res, data } = await post({ event: ev, episode: { title: 'A Title The Widget Had' } })
  assert.equal(res.status, 200)
  assert.deepEqual(data.stubs, { podcast: false, episode: false })
  const e = row('SELECT * FROM episodes WHERE item_guid=?', OLD_EP)
  assert.equal(e.title, 'Collector Title'); assert.equal(e.published, 1700000000); assert.equal(e.duration, 3600)
  assert.deepEqual(epAgg(OLD_EP), expectEpisode(OLD_EP))
  assert.equal(e.boost_count, 3); assert.equal(e.booster_count, 3)
  assert.equal(count('SELECT COUNT(*) AS n FROM episodes_fts WHERE item_guid=?', OLD_EP), 1, 'a second FTS row for an existing episode')
})

// ── A show-level note ───────────────────────────────────────────────────────
await check('a show-level note (no item guid) recounts the show and writes no episode', async () => {
  const eps = count('SELECT COUNT(*) AS n FROM episodes')
  const ev = signed(template({ itemGuid: '', episodeTitle: '' }), sk2)
  const { res, data } = await post({ event: ev })
  assert.equal(res.status, 200); assert.equal(data.item_guid, null)
  assert.equal(count('SELECT COUNT(*) AS n FROM episodes'), eps)
  assert.deepEqual(showAgg(SHOW), expectShow(SHOW))
})

// ── A show the index has never seen ─────────────────────────────────────────
await check('an unknown show gets a title-only stub and an FTS row; a long hint is truncated', async () => {
  const long = 'L'.repeat(400)
  const ev = signed(template({ podcastGuid: 'never-seen-show', itemGuid: 'never-seen-ep', showTitle: 'Never Seen' }))
  const { res, data } = await post({ event: ev, episode: { title: 'Ep', showTitle: long } })
  assert.equal(res.status, 200)
  assert.deepEqual(data.stubs, { podcast: true, episode: true })
  const p = row('SELECT * FROM podcasts WHERE podcast_guid=?', 'never-seen-show')
  assert.equal(p.title.length, 300); assert.equal(p.image, null); assert.equal(p.medium, null)
  assert.deepEqual(showAgg('never-seen-show'), expectShow('never-seen-show'))
  assert.equal(count('SELECT COUNT(*) AS n FROM podcasts_fts WHERE podcast_guid=?', 'never-seen-show'), 1)
  assert.equal(row('SELECT show FROM episodes_fts WHERE item_guid=?', 'never-seen-ep').show.length, 300)
})

// ── The collector's replace wins ────────────────────────────────────────────
await check('the collector\'s INSERT OR REPLACE overwrites the stub wholesale', () => {
  db.prepare(`INSERT OR REPLACE INTO episodes (item_guid,podcast_guid,title,image,published,duration,episode_number,
              enclosure_url,description,boost_count,total_sats,booster_count,latest_ts)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('new-episode-guid', SHOW, 'Podcast Index Title', 'https://x/ep.png', 1755000000, 2400, null, 'https://x/ep.mp3', 'notes', 2, 2600, 1, NOW)
  const e = row('SELECT title, image, published, duration FROM episodes WHERE item_guid=?', 'new-episode-guid')
  assert.deepEqual(e, { title: 'Podcast Index Title', image: 'https://x/ep.png', published: 1755000000, duration: 2400 })
  assert.equal(count('SELECT COUNT(*) AS n FROM episodes WHERE item_guid=?', 'new-episode-guid'), 1)
})

// ── Refusals ────────────────────────────────────────────────────────────────
await check('a tampered note is refused: the signature no longer verifies', async () => {
  const ev = { ...signed(template({ message: 'tamper me' })), content: 'edited after signing' }
  const { res, data } = await post({ event: ev })
  assert.equal(res.status, 400); assert.match(data.error, /signature/)
  assert.equal(count('SELECT COUNT(*) AS n FROM boosts WHERE event_id=?', ev.id), 0)
})
await check('a note whose id does not match its content is refused', async () => {
  const a = signed(), b = signed(template({ message: 'other' }))
  const ev = { ...a, id: b.id }
  const { res } = await post({ event: ev })
  assert.equal(res.status, 400)
})
await check('a note with another client tag is refused', async () => {
  const t = template(); t.tags = t.tags.map((x) => x[0] === 'client' ? ['client', 'someone-else'] : x)
  const { res } = await post({ event: signed(t) })
  assert.equal(res.status, 400)
})
await check('a note with no client tag is refused (it is not this site\'s note)', async () => {
  const t = template(); t.tags = t.tags.filter((x) => x[0] !== 'client')
  const { res, data } = await post({ event: signed(t) })
  assert.equal(res.status, 400); assert.match(data.error, /not this site/)
})
await check('a note naming no show is refused', async () => {
  const { res, data } = await post({ event: signed(template({ podcastGuid: '', itemGuid: 'only-an-item' })) })
  assert.equal(res.status, 400); assert.match(data.error, /podcast guid/)
})
await check('a donation note is refused by shape', async () => {
  const t = buildDonationNoteTemplate({ paidSats: 1000, message: 'thanks', senderName: '' })
  const { res } = await post({ event: signed(t), episode: { title: 'x' } })
  assert.equal(res.status, 400)
})
await check('a kind that is not 1, a bad id shape, a bad sig shape', async () => {
  const ev = signed()
  for (const bad of [{ ...ev, kind: 7 }, { ...ev, id: 'zz' }, { ...ev, sig: 'ab' }, { ...ev, created_at: 1.5 }]) {
    const { res } = await post({ event: bad })
    assert.equal(res.status, 400)
  }
  const { res } = await post({ nothing: true })
  assert.equal(res.status, 400)
})

// ── The clock window ────────────────────────────────────────────────────────
await check('a note 10 minutes old is indexed here though the oracle\'s own window would refuse it', async () => {
  const t = template({ message: 'slow settle' }); t.created_at = NOW - 600
  const ev = signed(t)
  assert.throws(() => validateBoostTemplate(ev), /created_at/, 'the oracle default should refuse this')
  const { res } = await post({ event: ev })
  assert.equal(res.status, 200)
})
await check(`a note older than ${INGEST_SKEW_SECS / 60} minutes is refused and left to the collector`, async () => {
  const t = template({ message: 'ancient' }); t.created_at = NOW - INGEST_SKEW_SECS - 60
  const { res, data } = await post({ event: signed(t) })
  assert.equal(res.status, 400); assert.match(data.error, /created_at/)
})

// ── Pure parts ──────────────────────────────────────────────────────────────
await check('boostRowFromEvent reads the item URL off the i tag\'s third element', () => {
  const t = template(); t.tags.push(['i', 'podcast:item:guid:with-url', 'https://x/episode'])
  t.tags = t.tags.filter((x) => x[1] !== 'podcast:item:guid:new-episode-guid')
  const r = boostRowFromEvent(signed(t))
  assert.equal(r.item_guid, 'with-url'); assert.equal(r.item_url, 'https://x/episode')
})
await check('validateSubmission returns trimmed hints and nulls for junk', () => {
  const s = validateSubmission({ event: signed(), episode: { title: '  padded  ', showTitle: 42 } })
  assert.equal(s.episodeTitle, 'padded'); assert.equal(s.showTitle, null)
})

// ── The limiter ─────────────────────────────────────────────────────────────
await check('the limiter admits ten in a window and refuses the eleventh; a new window resets', async () => {
  const store = new Map()
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v) } }
  const t0 = 1_800_000_000_000
  for (let i = 0; i < 10; i++) assert.equal(await overRateLimit(kv, '1.2.3.4', t0), false, `call ${i + 1}`)
  assert.equal(await overRateLimit(kv, '1.2.3.4', t0), true)
  assert.equal(await overRateLimit(kv, '5.6.7.8', t0), false, 'another address is its own counter')
  assert.equal(await overRateLimit(kv, '1.2.3.4', t0 + 61_000), false)
  assert.ok([...store.keys()].every((k) => k.startsWith('ingest:')), 'its own key prefix, not the oracle\'s')
})
await check('the handler answers 429 past the limit', async () => {
  const ip = '198.51.100.7'
  let last
  for (let i = 0; i < 11; i++) last = await post({ event: signed(template({ message: `n${i}` })) }, { 'CF-Connecting-IP': ip })
  assert.equal(last.res.status, 429)
})
await check('a limiter that cannot be read is 503, not an open door', async () => {
  const broken = { get: async () => { throw new Error('kv down') }, put: async () => {} }
  const request = new Request('https://onlyboosts.social/api/v1/boosts/ingest', { method: 'POST', body: '{}' })
  const res = await onRequestPost({ request, env: { DB, SIGN_RATELIMIT: broken } })
  assert.equal(res.status, 503)
})

console.log(`\n${passed} passed, ${failed} failed`)
