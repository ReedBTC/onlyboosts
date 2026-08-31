#!/usr/bin/env node
/**
 * Run the SHIPPED /api/v1/publishers handlers against a real D1-shaped
 * database — the listing and the per-artist detail.
 *
 * ⚠️ IT EXERCISES THE ENDPOINTS, NOT A COPY OF THEIR SQL — the
 * test-members-search.mjs arrangement: handlers imported, `env.DB` shimmed
 * over node:sqlite, fixture built from the same schema.sql applied to the
 * live D1. A test holding its own copy of the SQL passes forever while the
 * shipped one rots.
 *
 * The fixture is hand-built to KNOWN ANSWERS: three sorts with three different
 * winners, a LIKE-wildcard decoy pair, a bare (title-less) publisher that must
 * never list, a back-dated artist for the windowed ranges, and an album list
 * whose display fields disagree between the live `podcasts` row and the
 * denormalized edge copy.
 *
 * Run: node scripts/test-publishers-api.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { onRequestGet, onRequestHead } from '../functions/api/v1/publishers.js'
import {
  onRequestGet as detailGet, onRequestHead as detailHead,
} from '../functions/api/v1/publishers/[guid].js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// ── The fixture ─────────────────────────────────────────────────────────────
const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))

const G = {
  haleen: 'aaaaaaaa-1111-4111-8111-000000000001',
  zed: 'bbbbbbbb-2222-4222-8222-000000000002',
  bare: 'cccccccc-3333-4333-8333-000000000003',
  pct: 'dddddddd-4444-4444-8444-000000000004',
  decoy: 'eeeeeeee-5555-4555-8555-000000000005',
  gone: 'ffffffff-6666-4666-8666-000000000006',
}

const addPub = (guid, title, show_count) =>
  db.prepare(`INSERT INTO publishers(publisher_guid, feed_url, title, image, artwork, description, show_count)
              VALUES(?,?,?,?,?,?,?)`)
    .run(guid, `https://example.com/pub/${guid}`, title, title ? `https://example.com/${guid}.jpg` : null, null, null, show_count)

/* ⚠️ THE BARE ROW IS THE POINT OF ONE ASSERTION BELOW: the collector stores one
 * publisher whose feed resolved to a non-publisher channel, so its title is
 * NULL, and the listing must drop it. Without the row the filter could be
 * deleted and everything would still pass. */
addPub(G.haleen, 'Haleen', 2)
addPub(G.zed, 'Zed Artist', 1)
addPub(G.bare, null, 1)
addPub(G.pct, '100% Wave', 1)
addPub(G.decoy, '100 Wave', 1)   // what an unescaped '100%' ALSO matches
addPub(G.gone, 'Long Gone Artist', 1)

/* ⚠️ THE AGGREGATE COLUMNS ARE REAL, matching the boosts inserted below. On
 * the live D1 d1_sync keeps them true, and the detail endpoint's all-time
 * path READS them (the documented precomputed-columns pattern) — a fixture of
 * zeros makes every all-time drawer row 0/0 and the assertions meaningless. */
const addShow = (guid, pub, lang, title, boosts = 0, sats = 0, boosters = 0) =>
  db.prepare(`INSERT INTO podcasts(podcast_guid, title, image, feed_url, medium, language, publisher_guid,
              boost_count, total_sats, booster_count, episode_count, latest_ts)
              VALUES(?,?,?,?,?,?,?,?,?,?,0,0)`)
    .run(guid, title, `https://example.com/${guid}.png`, `https://example.com/${guid}.xml`, 'music', lang, pub, boosts, sats, boosters)

/* Haleen declares two shows, one English and one untagged — so lang=en and
 * lang=unknown must each recount her over ONLY the matching half. */
addShow('al-a1', G.haleen, 'en', 'Album A1', 3, 300, 3)
addShow('al-a2', G.haleen, null, 'Album A2', 1, 1000, 1)
addShow('al-b1', G.zed, 'de', 'Album B1', 2, 5000, 1)
addShow('al-c1', G.bare, null, 'Album C1', 1, 50, 1)
addShow('al-d1', G.pct, null, 'Album D1', 1, 10, 1)
addShow('al-e1', G.decoy, null, 'Album E1', 1, 10, 1)
addShow('al-f1', G.gone, null, 'Album F1', 1, 999, 1)

let ev = 0
const NOW = Math.floor(Date.now() / 1000)
// Stamped relative to NOW — the endpoint computes its cutoff from Date.now(),
// so a fixed epoch would put the corpus outside every window.
const addBoost = (show, booster, sats, ageDays = 0) =>
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid) VALUES(?,?,?,?,?)')
    .run('e' + String(ev++).padStart(63, '0'), booster.repeat(64), NOW - 60 - ageDays * 86400, sats, show)

/* Known answers. Haleen: 4 boosts, 1300 sats, 3 distinct boosters.
 * Zed: 2 boosts, 5000 sats, 1 booster. So boosters puts Haleen first and sats
 * puts Zed first — without two winners the sort parameter is untestable. */
addBoost('al-a1', '1', 100); addBoost('al-a1', '2', 100); addBoost('al-a1', '3', 100)
addBoost('al-a2', '1', 1000)
addBoost('al-b1', '9', 2500); addBoost('al-b1', '9', 2500)
addBoost('al-c1', '4', 50)
addBoost('al-d1', '5', 10)
addBoost('al-e1', '6', 10)
addBoost('al-f1', '7', 999, 400)   // Long Gone: All only, outside 1w/1m/1y

/* Haleen's catalogue file. ⚠️ INDEX-ONLY (Reed's call, 2026-08-30): the detail
 * endpoint must NOT read this table — the drawer lists the declaring shows.
 * These rows exist so the assertion that they never leak is a real one. */
const addAlbum = (pub, pos, guid, url, title, linked) =>
  db.prepare(`INSERT INTO publisher_albums(publisher_guid, position, album_guid, album_url,
              album_title, album_image, album_artwork, album_medium, album_author, album_linked)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(pub, pos, guid, url, title, null, null, 'music', 'Haleen', linked)
addAlbum(G.haleen, 1, 'al-a1', 'https://example.com/al-a1.xml', 'stale hint A1', 1)
addAlbum(G.haleen, 2, 'al-x', 'https://example.com/al-x.xml', 'Hint Only', 0)
addAlbum(G.haleen, 3, 'al-a2', 'https://example.com/al-a2.xml', 'stale hint A2', 1)

// ── The D1 shim — prepare().bind().all()/first(), as members' test models ──
const env = {
  DB: {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            all: async () => ({ results: db.prepare(sql).all(...args) }),
            first: async () => db.prepare(sql).get(...args) ?? null,
          }
        },
      }
    },
  },
}

const call = async (qs) => {
  const req = new Request(`https://ob.invalid/api/v1/publishers${qs}`)
  const res = await onRequestGet({ request: req, env })
  return { status: res.status, body: await res.json() }
}
const detail = async (guid) => {
  const req = new Request(`https://ob.invalid/api/v1/publishers/${guid}`)
  const res = await detailGet({ request: req, env, params: { guid } })
  return { status: res.status, body: await res.json() }
}
const detailSince = async (guid, since) => {
  const req = new Request(`https://ob.invalid/api/v1/publishers/${guid}?since=${since}`)
  const res = await detailGet({ request: req, env, params: { guid } })
  return { status: res.status, body: await res.json() }
}
const titles = (b) => b.publishers.map((p) => p.title)

console.log('\nThe ranked listing:')
{
  const { body } = await call('')
  check('default sort is boosters and Haleen leads it', () => {
    assert.equal(body.sort, 'boosters')
    assert.equal(titles(body)[0], 'Haleen')
  })
  check('⚠️ the bare (title-less) publisher never lists', () => {
    assert.ok(!body.publishers.some((p) => p.guid === G.bare))
  })
  check('figures aggregate across the declaring shows', () => {
    const h = body.publishers.find((p) => p.guid === G.haleen)
    assert.deepEqual(
      [h.boosts, h.sats, h.boosters, h.albums],
      [4, 1300, 3, 2])
  })
}
{
  const { body } = await call('?sort=sats')
  check('sats crowns a different winner', () => assert.equal(titles(body)[0], 'Zed Artist'))
}
{
  const { body } = await call('?sort=nonsense')
  check('an unknown sort coerces to the default rather than 400', () =>
    assert.equal(body.sort, 'boosters'))
}
{
  const { status } = await call('?range=2y')
  check('a bad range answers 400', () => assert.equal(status, 400))
}

console.log('\nThe windowed ranges recount, boost-time reading:')
{
  const all = await call('')
  const week = await call('?range=1w')
  check('Long Gone Artist is in All', () =>
    assert.ok(titles(all.body).includes('Long Gone Artist')))
  check('and out of 1W', () =>
    assert.ok(!titles(week.body).includes('Long Gone Artist')))
}

console.log('\nThe language filter runs through the declaring shows:')
{
  const { body } = await call('?lang=de')
  check('lang=de finds only Zed', () => assert.deepEqual(titles(body), ['Zed Artist']))
}
{
  const { body } = await call('?lang=en')
  check('lang=en recounts Haleen over only her English album', () => {
    const h = body.publishers.find((p) => p.guid === G.haleen)
    assert.ok(h, 'Haleen missing')
    assert.deepEqual([h.boosts, h.sats, h.boosters], [3, 300, 3])
  })
}
{
  const { body } = await call('?lang=unknown')
  check('⚠️ lang=unknown is the untagged bucket, not English', () => {
    const h = body.publishers.find((p) => p.guid === G.haleen)
    assert.ok(h, 'Haleen missing')
    // Only the untagged album's boost.
    assert.deepEqual([h.boosts, h.sats], [1, 1000])
  })
}

console.log('\n⚠️ Search: LIKE metacharacters are literal, and rank is retained:')
{
  const { body } = await call('?q=' + encodeURIComponent('100%'))
  check('a percent sign is not a wildcard', () => {
    // '100 Wave' is in the fixture and must NOT come back.
    assert.deepEqual(titles(body), ['100% Wave'])
  })
}
{
  // The hit's rank must be its position on the UNFILTERED feed under the same
  // sort — rank retention, the same contract podcasts.js?q= keeps.
  const all = await call('?sort=sats')
  const want = titles(all.body).indexOf('Zed Artist') + 1
  const { body } = await call('?sort=sats&q=zed')
  check('a searched artist wears its unfiltered rank', () => {
    assert.equal(body.publishers[0]?.title, 'Zed Artist')
    assert.equal(body.publishers[0]?.rank, want)
  })
}
{
  const { body } = await call('?q=' + encodeURIComponent(G.haleen))
  check('a pasted publisher guid matches as an equality', () =>
    assert.deepEqual(titles(body), ['Haleen']))
}
{
  const { status } = await call('?q=z')
  check('a one-character query is refused', () => assert.equal(status, 400))
}

console.log('\nHEAD answers with the GET’s status and no body:')
{
  const req = new Request('https://ob.invalid/api/v1/publishers')
  const res = await onRequestHead({ request: req, env })
  check('listing HEAD', () => assert.equal(res.status, 200))
  check('and carries no body', async () => assert.equal(await res.text(), ''))
  const dres = await detailHead({ request: new Request('https://ob.invalid/x'), env, params: { guid: G.haleen } })
  check('detail HEAD', () => assert.equal(dres.status, 200))
}

console.log('\nThe per-artist detail (index-only, Reed 2026-08-30):')
{
  const { body } = await detail(G.haleen)
  check('the publisher row comes back', () => {
    assert.equal(body.publisher.title, 'Haleen')
    assert.equal(body.publisher.albums, 2)
  })
  check('⚠️ the albums are the INDEXED declaring shows, ranked by sats', () =>
    assert.deepEqual(body.albums.map((a) => a.guid), ['al-a2', 'al-a1']))
  check('and carry the index’s own figures', () =>
    assert.deepEqual([body.albums[0].sats, body.albums[0].boosts], [1000, 1]))
  check('⚠️ the catalogue file never leaks — no off-index row, no feed URL', () => {
    assert.ok(!body.albums.some((a) => a.guid === 'al-x' || a.title === 'Hint Only'))
    assert.ok(!body.albums.some((a) => 'url' in a))
  })
}
{
  // ?since windows the rows and recounts, the show-drawer contract. Every live
  // boost is stamped NOW-60, so a day-wide window holds them and a minute-wide
  // one holds nothing.
  const wide = await detailSince(G.haleen, NOW - 86400)
  check('?since keeps the in-window albums, recounted', () =>
    assert.deepEqual(wide.body.albums.map((a) => a.guid), ['al-a2', 'al-a1']))
  const narrow = await detailSince(G.haleen, NOW - 10)
  check('and an out-of-window artist answers an empty list, not an error', () => {
    assert.equal(narrow.status, 200)
    assert.deepEqual(narrow.body.albums, [])
  })
}
{
  const { status } = await detail('no-such-publisher')
  check('an unknown guid answers 404', () => assert.equal(status, 404))
}

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}.`)
