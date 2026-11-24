// A boost made during a song is counted on the song AND on the host episode,
// its sats divided by the window's remotePercentage (Reed, 2026-11-23). The
// collector writes the two sides to `boost_credits`; every query that counts
// by show, episode, song or artist reads them through
// functions/_shared/credited.js. This holds the edge to that rule, on a
// fixture whose expectations are written out by hand from the rule itself:
//
//   - the totals add each side's share, and the site-wide sats are conserved
//   - a boost counts once per side, even when both sides name one feed
//   - an unknown percentage gives the song everything and the host 0 sats,
//     while the boost and its booster still count on the host
//   - the boost is LISTED on both sides, at what the booster sent, with the
//     line naming the other side
//   - a query about a person never reads the credits
//
//   node scripts/test-split-credits.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { weeklyChart } from '../functions/_shared/week-charts.js'
import { readParams, globalPodcasts } from '../functions/api/v1/podcasts.js'
import { onRequestGet as podcastGet } from '../functions/api/v1/podcasts/[guid].js'
import { onRequestGet as episodeGet } from '../functions/api/v1/episodes/[guid].js'
import { rowsFromRecords, splitLineHtml } from '../assets/js/boost-list.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))

let failed = 0, passed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name) }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message) }
}

/* ── the fixture ──
 * H is a podcast whose episode h1 played the song s1 off the album S (artist
 * PUB). s2/s3 are two items of one album S2 listed under two feed ids that the
 * collector resolved to the same guid, the case that makes COUNT(*) wrong. */
const NOW = Math.floor(Date.now() / 1000)
const T = NOW - 3600
const X = 'a'.repeat(64), Y = 'b'.repeat(64), Z = 'c'.repeat(64)
for (const [g, title, medium, pub] of [
  ['H', 'Host Show', 'podcast', null], ['S', 'Song Album', 'music', 'PUB'], ['S2', 'Twin Album', 'music', 'PUB'],
]) db.prepare('INSERT INTO podcasts(podcast_guid,title,medium,publisher_guid) VALUES(?,?,?,?)').run(g, title, medium, pub)
db.prepare('INSERT INTO publishers(publisher_guid,title) VALUES(?,?)').run('PUB', 'The Artist')
for (const [i, p, title] of [['h1', 'H', 'Host Episode'], ['s1', 'S', 'Song One'], ['s2', 'S2', 'Twin A'], ['s3', 'S2', 'Twin B']])
  db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title) VALUES(?,?,?)').run(i, p, title)

const boost = (id, who, sats, pg, ig) =>
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,booster_npub,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?,?)')
    .run(id.padEnd(64, '0'), who, 'npub1' + who.slice(0, 10), T, sats, pg, ig)
const credit = (id, role, pg, ig, sats, pct) =>
  db.prepare('INSERT INTO boost_credits(event_id,role,podcast_guid,item_guid,sats,pct,method) VALUES(?,?,?,?,?,?,?)')
    .run(id.padEnd(64, '0'), role, pg, ig, sats, pct, pct == null ? 'medium' : 'rss')

// b1: 1,000 sats at 90%; the boosts row names the HOST (the host-primary case).
boost('b1', X, 1000, 'H', 'h1'); credit('b1', 'track', 'S', 's1', 900, 90); credit('b1', 'host', 'H', 'h1', 100, 90)
// b2: 500 sats, percentage unknown; the boosts row names the SONG.
boost('b2', Y, 500, 'S', 's1'); credit('b2', 'track', 'S', 's1', 500, null); credit('b2', 'host', 'H', 'h1', 0, null)
// b3, b4: ordinary boosts on each side.
boost('b3', X, 200, 'H', 'h1')
boost('b4', Z, 300, 'S', 's1')
// b5: both sides on one feed (S2), 400 + 600.
boost('b5', Z, 1000, 'S2', 's2'); credit('b5', 'track', 'S2', 's2', 400, 40); credit('b5', 'host', 'S2', 's3', 600, 40)

const stmt = (sql, args = null) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: db.prepare(sql).all(...(args || [])) }),
  first: async () => db.prepare(sql).get(...(args || [])) ?? null,
})
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (l) => Promise.all(l.map((s) => s.all())) } }
const row = (rows, guid) => rows.find((r) => r.guid === guid)
const figures = (r) => r && [r.total_sats, r.boost_count, r.booster_count]

console.log('\nThe totals (week-charts.js, the chart pages and /charts/2026):')
{
  const shows = await weeklyChart(env, 'shows', T - 10, NOW + 10, 50)
  const albums = await weeklyChart(env, 'albums', T - 10, NOW + 10, 50)
  const songs = await weeklyChart(env, 'songs', T - 10, NOW + 10, 50)
  const episodes = await weeklyChart(env, 'episodes', T - 10, NOW + 10, 50)
  const artists = await weeklyChart(env, 'artists', T - 10, NOW + 10, 50)
  await check('⚠️ the host counts its share: 100 + 0 + 200 sats, three boosts, two boosters', () =>
    assert.deepEqual(figures(row(shows, 'H')), [300, 3, 2]))
  await check('the host episode the same', () => assert.deepEqual(figures(row(episodes, 'h1')), [300, 3, 2]))
  await check('⚠️ the song counts its share and the whole of an unknown split: 900 + 500 + 300', () =>
    assert.deepEqual(figures(row(songs, 's1')), [1700, 3, 3]))
  await check('the album the same', () => assert.deepEqual(figures(row(albums, 'S')), [1700, 3, 3]))
  await check('⚠️ both sides on one feed count the boost ONCE, at the whole of it', () =>
    assert.deepEqual(figures(row(albums, 'S2')), [1000, 1, 1]))
  await check('the artist adds its albums: 1,700 + 1,000 sats, four boosts', () =>
    assert.deepEqual(figures(row(artists, 'PUB')), [2700, 4, 3]))
  await check('⚠️ the sats are conserved: the two media together hold exactly what was sent', () => {
    const sum = (rs) => rs.reduce((a, r) => a + r.total_sats, 0)
    assert.equal(sum(shows) + sum(albums), 3000)
  })
}

console.log('\nThe windowed list endpoint (/api/v1/podcasts?range=1w):')
{
  const res = await globalPodcasts(env, readParams(new URL('https://x/api/v1/podcasts?range=1w&limit=50')))
  const body = typeof res?.json === 'function' ? await res.json() : res
  const list = body.podcasts || body.rows || body
  const find = (g) => (Array.isArray(list) ? list : []).find((p) => p.guid === g)
  await check('the host and the album carry their credited figures', () => {
    assert.deepEqual([find('H')?.sats, find('H')?.boosts, find('H')?.boosters], [300, 3, 2])
    assert.deepEqual([find('S')?.sats, find('S')?.boosts, find('S')?.boosters], [1700, 3, 3])
    assert.deepEqual([find('S2')?.sats, find('S2')?.boosts], [1000, 1])
  })
}

console.log('\nThe boost lists (both sides list the boost, at what was sent):')
const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
const get = async (fn, path, guid) => (await fn({ request: new Request('https://onlyboosts.social' + path), env, params: { guid }, waitUntil() {} })).json()
{
  const show = await get(podcastGet, '/api/v1/podcasts/H', 'H')
  const recs = show.boosts || show.recent || []
  const b1 = recs.find((b) => b.id.startsWith('b1')), b2 = recs.find((b) => b.id.startsWith('b2'))
  await check('⚠️ the show lists the song boosts, at the figure the booster sent', () => {
    assert.ok(b1 && b2, 'a split boost is missing from the host show')
    assert.deepEqual([b1.sats, b2.sats], [1000, 500])
  })
  await check('and each names the song with the division, or the song alone when unknown', () => {
    assert.equal(plain(splitLineHtml(rowsFromRecords([b1])[0])), 'During Song One · 900 to the song · 100 to the show')
    assert.equal(plain(splitLineHtml(rowsFromRecords([b2])[0])), 'During Song One')
  })
  await check('an ordinary boost carries no credit and no line', () => {
    const b3 = recs.find((b) => b.id.startsWith('b3'))
    assert.equal(b3.credit, undefined)
    assert.equal(splitLineHtml(rowsFromRecords([b3])[0]), '')
  })

  const song = await get(episodeGet, '/api/v1/episodes/s1', 's1')
  const srecs = song.boosts || []
  const s1 = srecs.find((b) => b.id.startsWith('b1'))
  await check('⚠️ the song lists the host-primary boost too', () => assert.ok(s1, 'b1 is missing from the song'))
  await check('naming the episode and its show', () =>
    assert.equal(plain(splitLineHtml(rowsFromRecords([s1])[0])),
      'Heard on Host Episode (Host Show) · 900 to the song · 100 to the show'))
  await check('the episode-card drawer reads the record shape directly', () =>
    assert.equal(plain(splitLineHtml(s1)), plain(splitLineHtml(rowsFromRecords([s1])[0]))))
}

console.log('\nThe person side never reads the credits:')
for (const f of ['functions/api/v1/members.js', 'functions/api/v1/members/hours.js', 'functions/booster/[npub].js',
  'functions/api/v1/boosters/[npub].js', 'functions/api/v1/stats.js', 'functions/api/v1/clients.js',
  'functions/api/v1/boosts.js', 'functions/api/v1/boosts/follows.js']) {
  await check(`${f} counts each boost once`, () =>
    assert.ok(!/CREDITED/.test(readFileSync(join(ROOT, f), 'utf8')), 'a person query reads the credited rows'))
}
await check('⚠️ the edge ingest recounts through the credits, or it undoes the collector', () => {
  const src = readFileSync(join(ROOT, 'functions/api/v1/boosts/ingest.js'), 'utf8')
  const a = src.indexOf('const PODCAST_RECOUNT'), b = src.indexOf('const EDGE_TABLE')
  const blk = src.slice(a, b)
  assert.ok(!/FROM boosts\b/.test(blk), 'a recount reads plain boosts')
  assert.ok(!/COUNT\(\*\)/.test(blk), 'a recount counts rows, not boosts')
})

console.log(failed ? `\n${passed} passed, ${failed} FAILED.` : `\n${passed} passed.`)
process.exit(failed ? 1 : 0)
