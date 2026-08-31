#!/usr/bin/env node
/**
 * The OnlyBoosts Charts — `sort=chart` on all four ranked endpoints, plus the
 * chart position in feedRanks and the Charts line in renderStatTiles.
 *
 * ⚠️ IT EXERCISES THE SHIPPED HANDLERS, NOT A COPY OF THEIR SQL — the
 * test-members-search.mjs arrangement: handlers imported, `env.DB` shimmed
 * over node:sqlite, fixture built from the same schema.sql applied to the
 * live D1.
 *
 * ⚠️ EXPECTATIONS ARE BRUTE-FORCED, NOT HAND-WRITTEN. `chartOrder` below is an
 * independent JS implementation of the published rule — rank in sats + rank in
 * boosts + rank in the breadth key (boosters for content, shows boosted for a
 * member), summed, lowest total first; ties broken breadth → sats → boosts;
 * remaining ties shared (T#) — and every ordering assertion compares an
 * endpoint against it over the whole fixture, one source of truth (the boost
 * list) feeding both sides. The fixture is engineered so the interesting cases
 * exist, and the sanity checks near the end FAIL if a fixture edit ever loses
 * one: a chart order that differs from every single-axis order, a score tie
 * broken by the breadth key (s3/s4), and a full tie that shares a rank and
 * skips the next (s5/s6).
 *
 * Run: node scripts/test-charts.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { onRequestGet as podcastsGet, onRequestPost as podcastsPost } from '../functions/api/v1/podcasts.js'
import { onRequestGet as episodesGet, onRequestPost as episodesPost } from '../functions/api/v1/episodes.js'
import { onRequestGet as publishersGet, onRequestPost as publishersPost } from '../functions/api/v1/publishers.js'
import { onRequestGet as membersGet } from '../functions/api/v1/members.js'
import { PUBLISHERS } from '../functions/api/v1/_common.js'
import { feedRanks, renderStatTiles } from '../functions/_shared/feed-rank.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// ── The fixture ─────────────────────────────────────────────────────────────
const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))

const NOW = Math.floor(Date.now() / 1000)
const RECENT = NOW - 3600            // inside every window
const OLD = NOW - 30 * 86400         // outside 1w, inside 1y
const PUB_RECENT = NOW - 2 * 86400   // episode air dates: inside 1m
const PUB_OLD = NOW - 400 * 86400    // outside even 1y

const pkHex = (n) => n.toString(16).padStart(64, '0')
// A pool of distinct boosters for the show corpus. POOL[0] soaks up every
// boost past a show's distinct-booster quota, so `boosters` is exact.
const POOL = Array.from({ length: 24 }, (_, i) => pkHex(0x200 + i))
const M = [1, 2, 3, 4, 5].map((i) => pkHex(0x100 + i))
// BMB's site key — really in PUBLISHERS, so the members listing must drop it.
const PB = '3820f4ff8587747530c7feafe47c1e592e3ce0fd2929b4f907e40714bd26f408'

/* The show corpus, engineered (hand math in the design notes; every assertion
 * is brute-forced): chart order s2, s7, s3, s4, s8, s1, then s5/s6 tied —
 * differing from the sats order (s1 first), the boosts order (s2 then s7/s8
 * tied) and the boosters order (s7 first). s3/s4 tie on score and split on
 * boosters; s5/s6 tie on everything and share a T rank. s7's BOOSTS are old
 * (out of 1w) and its EPISODE aired long ago (out of every window). */
const SHOWS = [
  { guid: 's1', title: 'Alpha Show',   medium: 'podcast', sats: 1000, n: 10, k: 2 },
  { guid: 's2', title: 'Bravo Show',   medium: 'podcast', sats: 500,  n: 30, k: 8 },
  { guid: 's3', title: 'Charlie Show', medium: 'podcast', sats: 400,  n: 12, k: 12 },
  // Medium NULL: the partition files an unidentified show under Shows.
  { guid: 's4', title: 'Delta Show',   medium: null,      sats: 450,  n: 12, k: 9 },
  { guid: 's5', title: 'TieOne Show',  medium: 'podcast', sats: 100,  n: 5,  k: 5 },
  { guid: 's6', title: 'TieTwo Show',  medium: 'podcast', sats: 100,  n: 5,  k: 5 },
  { guid: 's7', title: 'Echo Show',    medium: 'podcast', sats: 300,  n: 20, k: 20, ts: OLD, pub: PUB_OLD },
  { guid: 's8', title: 'Foxtrot Show', medium: 'podcast', sats: 600,  n: 20, k: 1 },
  // The music side: three albums under two publishers (pu3 is the title-less
  // row the listing must drop). The engineered members below also boost a1/a2.
  { guid: 'a1', title: 'Xray Album',   medium: 'music', publisher: 'pu2', sats: 800, n: 6,  k: 3 },
  { guid: 'a2', title: 'Yankee Album', medium: 'music', publisher: 'pu1', sats: 300, n: 10, k: 2 },
  { guid: 'a3', title: 'Zulu Album',   medium: 'music', publisher: 'pu1', sats: 250, n: 6,  k: 6 },
]

/* The engineered members: m2/m3 tie in full (shared rank), and m1/m4/m5 are
 * designed toward a score tie resolved below the breadth level. All five
 * boost a1 and a2 alternately (shows = 2); m5's boosts are OLD. */
const MEMBERS = [
  { pk: M[0], sats: 100, n: 4 },
  { pk: M[1], sats: 90,  n: 5 },
  { pk: M[2], sats: 90,  n: 5 },
  { pk: M[3], sats: 80,  n: 6 },
  { pk: M[4], sats: 85,  n: 5, ts: OLD },
]

function spread(total, n) {
  const base = Math.floor(total / n)
  const out = Array(n).fill(base)
  out[0] += total - base * n
  return out
}

// One boost list is the single source of truth for both sides of every check.
const BOOSTS = []
for (const s of SHOWS) {
  const sats = spread(s.sats, s.n)
  for (let i = 0; i < s.n; i++) {
    BOOSTS.push({ pk: POOL[i < s.k ? i : 0], sats: sats[i], show: s.guid, ep: 'ep-' + s.guid, ts: s.ts || RECENT })
  }
}
for (const m of MEMBERS) {
  const sats = spread(m.sats, m.n)
  for (let i = 0; i < m.n; i++) {
    const show = i % 2 === 0 ? 'a1' : 'a2'
    BOOSTS.push({ pk: m.pk, sats: sats[i], show, ep: 'ep-' + show, ts: m.ts || RECENT })
  }
}
// The publisher key: big sats, must never reach the members listing.
BOOSTS.push({ pk: PB, sats: 2500, show: 'a1', ep: 'ep-a1', ts: RECENT })
BOOSTS.push({ pk: PB, sats: 2500, show: 'a1', ep: 'ep-a1', ts: RECENT })

let ev = 0
const insBoost = db.prepare('INSERT INTO boosts(event_id,booster_pubkey,booster_npub,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?,?)')
for (const b of BOOSTS) insBoost.run('e' + String(ev++).padStart(63, '0'), b.pk, null, b.ts, b.sats, b.show, b.ep)

/* The podcasts/episodes aggregate columns are DERIVED from the boost list, the
 * way d1_sync keeps them true on the live D1 — so the precomputed all-time
 * path and the windowed GROUP BY describe one world by construction. */
function rollup(boosts, keyFn, breadthFn) {
  const m = new Map()
  for (const b of boosts) {
    const k = keyFn(b)
    if (!k) continue
    let e = m.get(k)
    if (!e) m.set(k, e = { id: k, sats: 0, boosts: 0, _b: new Set(), latest: 0 })
    e.sats += b.sats; e.boosts += 1; e._b.add(breadthFn(b))
    if (b.ts > e.latest) e.latest = b.ts
  }
  for (const e of m.values()) { e.breadth = e._b.size; delete e._b }
  return [...m.values()]
}

const SHOW_OF = new Map(SHOWS.map((s) => [s.guid, s]))
const showAgg = new Map(rollup(BOOSTS, (b) => b.show, (b) => b.pk).map((r) => [r.id, r]))
const insShow = db.prepare(`INSERT INTO podcasts(podcast_guid,title,image,artwork,feed_url,medium,author,language,publisher_guid,boost_count,total_sats,booster_count,episode_count,latest_ts)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)`)
const insShowFts = db.prepare('INSERT INTO podcasts_fts(podcast_guid,title,author) VALUES(?,?,?)')
for (const s of SHOWS) {
  const a = showAgg.get(s.guid)
  insShow.run(s.guid, s.title, `https://example.com/${s.guid}.png`, null, `https://example.com/${s.guid}.xml`,
    s.medium, null, null, s.publisher || null, a.boosts, a.sats, a.breadth, a.latest)
  insShowFts.run(s.guid, s.title, null)
}
const epAgg = new Map(rollup(BOOSTS, (b) => b.ep, (b) => b.pk).map((r) => [r.id, r]))
const insEp = db.prepare(`INSERT INTO episodes(item_guid,podcast_guid,title,image,published,boost_count,total_sats,booster_count,latest_ts)
                          VALUES(?,?,?,?,?,?,?,?,?)`)
const insEpFts = db.prepare('INSERT INTO episodes_fts(item_guid,title,show) VALUES(?,?,?)')
for (const s of SHOWS) {
  const a = epAgg.get('ep-' + s.guid)
  const title = s.title.replace(/ (Show|Album)$/, ' Episode')
  insEp.run('ep-' + s.guid, s.guid, title, null, s.pub || PUB_RECENT, a.boosts, a.sats, a.breadth, a.latest)
  insEpFts.run('ep-' + s.guid, title, s.title)
}
const insPub = db.prepare(`INSERT INTO publishers(publisher_guid,feed_url,title,image,artwork,description,show_count)
                           VALUES(?,?,?,?,?,?,?)`)
insPub.run('pu1', 'https://example.com/pu1', 'PubOne', null, null, null, 2)
insPub.run('pu2', 'https://example.com/pu2', 'PubTwo', null, null, null, 1)
insPub.run('pu3', 'https://example.com/pu3', null, null, null, null, 1)   // bare: never listed

// ── The independent implementation of the rule ──────────────────────────────
function competition(rows, val) {
  const ranks = new Map()
  for (const r of rows) ranks.set(r.id, rows.filter((x) => val(x) > val(r)).length + 1)
  return ranks
}
/** rows: [{id, sats, boosts, breadth}] → sorted with .score/.rank/.tied. */
function chartOrder(rows) {
  const rs = competition(rows, (r) => r.sats)
  const rb = competition(rows, (r) => r.boosts)
  const rk = competition(rows, (r) => r.breadth)
  const scored = rows.map((r) => ({ ...r, score: rs.get(r.id) + rb.get(r.id) + rk.get(r.id) }))
  const cmp = (a, b) => a.score - b.score || b.breadth - a.breadth || b.sats - a.sats || b.boosts - a.boosts
  scored.sort((a, b) => cmp(a, b) || (a.id < b.id ? -1 : 1))
  for (const r of scored) {
    r.rank = scored.filter((x) => cmp(x, r) < 0).length + 1
    r.tied = scored.filter((x) => cmp(x, r) === 0).length > 1
  }
  return scored
}
const notMusic = (b) => (SHOW_OF.get(b.show)?.medium ?? 'podcast') !== 'music'
const isMusic = (b) => SHOW_OF.get(b.show)?.medium === 'music'

// ── The handler shim ────────────────────────────────────────────────────────
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
async function call(handler, url, init) {
  const res = await handler({ request: new Request('https://ob.invalid' + url, init), env })
  return { status: res.status, body: await res.json() }
}

// ── /api/v1/podcasts — the Shows and Albums charts ─────────────────────────
{
  const expected = chartOrder(rollup(BOOSTS.filter(notMusic), (b) => b.show, (b) => b.pk))
  const { status, body } = await call(podcastsGet, '/api/v1/podcasts?not_medium=music&sort=chart&limit=200')
  console.log('\npodcasts — sort=chart (Shows)')
  check('answers 200 with sort echoed', () => { assert.equal(status, 200); assert.equal(body.sort, 'chart') })
  check('⚠️ the order matches the independent implementation of the rule', () => {
    assert.deepEqual(body.podcasts.map((p) => p.guid), expected.map((e) => e.id))
  })
  check('⚠️ every row carries the rank and tie flag the rule assigns', () => {
    for (let i = 0; i < expected.length; i++) {
      assert.equal(body.podcasts[i].rank, expected[i].rank, `${expected[i].id} rank`)
      assert.equal(body.podcasts[i].tied, expected[i].tied, `${expected[i].id} tied`)
    }
  })
  check('⚠️ the score and its three components are in the open on every row', () => {
    for (let i = 0; i < expected.length; i++) {
      const c = body.podcasts[i].chart
      assert.equal(c.score, expected[i].score, `${expected[i].id} score`)
      assert.equal(c.sats + c.boosts + c.boosters, c.score, `${expected[i].id} components sum`)
    }
  })
  const bySort = (key) => [...expected].sort((a, b) => b[key] - a[key] || b.sats - a.sats || (a.id < b.id ? -1 : 1)).map((e) => e.id)
  check('fixture sanity: the chart order differs from every single-axis order', () => {
    const chart = expected.map((e) => e.id).join(',')
    assert.notEqual(chart, bySort('sats').join(','), 'vs sats')
    assert.notEqual(chart, bySort('boosts').join(','), 'vs boosts')
    assert.notEqual(chart, bySort('breadth').join(','), 'vs boosters')
  })
  check('fixture sanity: a score tie is resolved by the breadth key (s3/s4)', () => {
    const s3 = expected.find((e) => e.id === 's3'), s4 = expected.find((e) => e.id === 's4')
    assert.equal(s3.score, s4.score, 'engineered score tie lost — re-derive the fixture')
    assert.notEqual(s3.rank, s4.rank)
    assert.ok(s3.rank < s4.rank, 'more boosters wins the tie')
    assert.equal(s3.tied, false); assert.equal(s4.tied, false)
  })
  check('⚠️ a full tie shares its rank, wears the flag, and the next rank skips', () => {
    const r5 = body.podcasts.find((p) => p.guid === 's5'), r6 = body.podcasts.find((p) => p.guid === 's6')
    assert.equal(r5.rank, r6.rank)
    assert.equal(r5.tied, true); assert.equal(r6.tied, true)
    const after = body.podcasts.filter((p) => p.rank > r5.rank)
    for (const p of after) assert.ok(p.rank >= r5.rank + 2, 'competition ranking must skip past the tie group')
  })

  // The windowed path: s7's boosts are old, so the 1w chart re-ranks without it.
  const cutoff = NOW - 7 * 86400
  const expected1w = chartOrder(rollup(BOOSTS.filter((b) => notMusic(b) && b.ts >= cutoff), (b) => b.show, (b) => b.pk))
  const w = await call(podcastsGet, '/api/v1/podcasts?not_medium=music&sort=chart&range=1w&limit=200')
  check('⚠️ range=1w recomputes the chart over the window (s7 drops out)', () => {
    assert.ok(!w.body.podcasts.some((p) => p.guid === 's7'))
    assert.deepEqual(w.body.podcasts.map((p) => p.guid), expected1w.map((e) => e.id))
    for (let i = 0; i < expected1w.length; i++) assert.equal(w.body.podcasts[i].rank, expected1w[i].rank)
  })

  // Albums: the music half of the partition, members' boosts included.
  const expectedAlbums = chartOrder(rollup(BOOSTS.filter(isMusic), (b) => b.show, (b) => b.pk))
  const alb = await call(podcastsGet, '/api/v1/podcasts?medium=music&sort=chart&limit=200')
  check('the Albums chart ranks the music partition by the same rule', () => {
    assert.deepEqual(alb.body.podcasts.map((p) => p.guid), expectedAlbums.map((e) => e.id))
  })

  // Rank retention under q=: s5's tie partner is filtered out, the flag survives.
  const q = await call(podcastsGet, '/api/v1/podcasts?not_medium=music&sort=chart&q=TieOne&limit=200')
  check('⚠️ q= keeps the unfiltered rank AND the tie flag (peers counted pre-filter)', () => {
    assert.equal(q.body.podcasts.length, 1)
    const hit = q.body.podcasts[0]
    const exp = expected.find((e) => e.id === 's5')
    assert.equal(hit.guid, 's5')
    assert.equal(hit.rank, exp.rank)
    assert.equal(hit.tied, true, 'the tie flag must survive its partner being filtered out')
  })
}

// ── /api/v1/episodes — the Episodes and Songs charts ───────────────────────
{
  const epNotMusic = (b) => notMusic(b)
  const expected = chartOrder(rollup(BOOSTS.filter(epNotMusic), (b) => b.ep, (b) => b.pk))
  const { body } = await call(episodesGet, '/api/v1/episodes?not_medium=music&sort=chart&limit=200')
  console.log('\nepisodes — sort=chart (GET)')
  check('⚠️ the order, ranks and tie flags match the rule', () => {
    assert.deepEqual(body.episodes.map((e) => e.guid), expected.map((e) => e.id))
    for (let i = 0; i < expected.length; i++) {
      assert.equal(body.episodes[i].rank, expected[i].rank, `${expected[i].id} rank`)
      assert.equal(body.episodes[i].tied, expected[i].tied, `${expected[i].id} tied`)
      assert.equal(body.episodes[i].chart.score, expected[i].score, `${expected[i].id} score`)
    }
  })
  // ⚠️ range means BOOST TIME since 2026-08-31 — the one reading everywhere.
  // s7's boosts are OLD, so ep-s7 drops out of 1w however recently it aired,
  // and every surviving row's FIGURES are the window's own recomputed
  // aggregates, not the precomputed all-time columns.
  const cutoff1w = NOW - 7 * 86400
  const expected1w = chartOrder(rollup(
    BOOSTS.filter((b) => epNotMusic(b) && b.ts >= cutoff1w), (b) => b.ep, (b) => b.pk))
  const w = await call(episodesGet, '/api/v1/episodes?not_medium=music&sort=chart&range=1w&limit=200')
  check('⚠️ range=1w windows on boost time and re-ranks (ep-s7 drops out)', () => {
    assert.ok(!w.body.episodes.some((e) => e.guid === 'ep-s7'))
    assert.deepEqual(w.body.episodes.map((e) => e.guid), expected1w.map((e) => e.id))
    for (let i = 0; i < expected1w.length; i++) {
      assert.equal(w.body.episodes[i].rank, expected1w[i].rank, `${expected1w[i].id} rank`)
      assert.equal(w.body.episodes[i].sats, expected1w[i].sats, `${expected1w[i].id}: figures must be the window’s own`)
      assert.equal(w.body.episodes[i].boosters, expected1w[i].breadth, `${expected1w[i].id} boosters`)
    }
  })
  const wSats = await call(episodesGet, '/api/v1/episodes?not_medium=music&sort=sats&range=1w&limit=200')
  check('the single-column sorts ride the same windowed aggregate', () => {
    const exp = rollup(BOOSTS.filter((b) => epNotMusic(b) && b.ts >= cutoff1w), (b) => b.ep, (b) => b.pk)
      .sort((a, b) => b.sats - a.sats || (a.id < b.id ? -1 : 1))
    assert.deepEqual(wSats.body.episodes.map((e) => e.guid), exp.map((e) => e.id))
    assert.equal(wSats.body.episodes[0].sats, exp[0].sats)
  })
  const q = await call(episodesGet, '/api/v1/episodes?not_medium=music&sort=chart&q=TieOne&limit=200')
  check('q= keeps the unfiltered rank and tie flag', () => {
    const exp = expected.find((e) => e.id === 'ep-s5')
    assert.equal(q.body.episodes.length, 1)
    assert.equal(q.body.episodes[0].guid, 'ep-s5')
    assert.equal(q.body.episodes[0].rank, exp.rank)
    assert.equal(q.body.episodes[0].tied, true)
  })
}

// ── POST /api/v1/episodes — the follows-scoped chart ───────────────────────
{
  const follows = [M[0], M[1]]
  const mine = BOOSTS.filter((b) => follows.includes(b.pk))
  const expected = chartOrder(rollup(mine, (b) => b.ep, (b) => b.pk))
  const { body } = await call(episodesPost, '/api/v1/episodes?medium=music&sort=chart&limit=200', {
    method: 'POST', body: JSON.stringify({ follows }), headers: { 'content-type': 'application/json' },
  })
  console.log('\nepisodes — sort=chart (POST follows)')
  check('⚠️ the chart is computed over the follow corpus alone', () => {
    assert.equal(body.scope, 'follows')
    assert.deepEqual(body.episodes.map((e) => e.guid), expected.map((e) => e.id))
    for (let i = 0; i < expected.length; i++) assert.equal(body.episodes[i].rank, expected[i].rank)
  })
}

// ── /api/v1/publishers — the Artists chart ─────────────────────────────────
{
  const pubOf = (b) => { const s = SHOW_OF.get(b.show); return s?.publisher || null }
  const expected = chartOrder(rollup(BOOSTS.filter((b) => pubOf(b)), pubOf, (b) => b.pk))
  const { body } = await call(publishersGet, '/api/v1/publishers?sort=chart&limit=200')
  console.log('\npublishers — sort=chart')
  check('⚠️ the order, ranks and tie flags match the rule (bare row dropped)', () => {
    assert.deepEqual(body.publishers.map((p) => p.guid), expected.map((e) => e.id))
    for (let i = 0; i < expected.length; i++) {
      assert.equal(body.publishers[i].rank, expected[i].rank)
      assert.equal(body.publishers[i].tied, expected[i].tied)
    }
  })
  const q = await call(publishersGet, '/api/v1/publishers?sort=chart&q=PubOne&limit=200')
  check('q= keeps the unfiltered rank', () => {
    const exp = expected.find((e) => e.id === 'pu1')
    assert.equal(q.body.publishers.length, 1)
    assert.equal(q.body.publishers[0].guid, 'pu1')
    assert.equal(q.body.publishers[0].rank, exp.rank)
  })
}

// ── /api/v1/members — the members chart (breadth = shows boosted) ──────────
{
  const isMember = (b) => !PUBLISHERS.includes(b.pk)
  const expected = chartOrder(rollup(BOOSTS.filter(isMember), (b) => b.pk, (b) => b.show))
  const { body } = await call(membersGet, '/api/v1/members?sort=chart&limit=200')
  console.log('\nmembers — sort=chart')
  check('⚠️ the order matches the rule with breadth = SHOWS BOOSTED', () => {
    assert.deepEqual(body.members.map((m) => m.pk), expected.map((e) => e.id))
  })
  check('⚠️ every listing row carries rank, tie flag and the open formula', () => {
    for (let i = 0; i < expected.length; i++) {
      assert.equal(body.members[i].rank, expected[i].rank, `${expected[i].id.slice(0, 8)} rank`)
      assert.equal(body.members[i].tied, expected[i].tied, `${expected[i].id.slice(0, 8)} tied`)
      assert.equal(body.members[i].chart.score, expected[i].score, `${expected[i].id.slice(0, 8)} score`)
    }
  })
  check('⚠️ the publisher key never reaches the chart', () => {
    assert.ok(!body.members.some((m) => m.pk === PB))
  })
  check('fixture sanity: m2/m3 tie in full and share a T rank', () => {
    const a = body.members.find((m) => m.pk === M[1]), b = body.members.find((m) => m.pk === M[2])
    assert.equal(a.rank, b.rank)
    assert.equal(a.tied, true); assert.equal(b.tied, true)
  })
  check('fixture sanity: somewhere a score tie is resolved below the breadth level', () => {
    const hit = expected.some((e, i) => i > 0 && expected[i - 1].score === e.score
      && expected[i - 1].breadth === e.breadth && !e.tied && !expected[i - 1].tied)
    assert.ok(hit, 'engineered sats-tiebreak case lost — re-derive the fixture')
  })
  // The window drops m5 (old boosts) and recomputes everyone else.
  const cutoff = NOW - 7 * 86400
  const expected1w = chartOrder(rollup(BOOSTS.filter((b) => isMember(b) && b.ts >= cutoff), (b) => b.pk, (b) => b.show))
  const w = await call(membersGet, '/api/v1/members?sort=chart&range=1w&limit=200')
  check('range=1w recomputes the chart over the window (m5 drops out)', () => {
    assert.ok(!w.body.members.some((m) => m.pk === M[4]))
    assert.deepEqual(w.body.members.map((m) => m.pk), expected1w.map((e) => e.id))
  })
  // A search is not a population: rows carry no rank even under sort=chart.
  db.prepare('INSERT INTO profiles(pubkey,name,display_name,picture) VALUES(?,?,?,?)')
    .run(M[0], 'memberone', 'Member One', null)
  const s = await call(membersGet, '/api/v1/members?q=Member%20One&sort=chart')
  check('⚠️ a search row carries NO chart standing', () => {
    assert.equal(s.body.members.length, 1)
    assert.equal(s.body.members[0].rank, undefined)
    assert.equal(s.body.members[0].chart, undefined)
  })
  // The bots mode is its own tiny population and does rank.
  const bots = await call(membersGet, '/api/v1/members?publishers=1&sort=chart')
  check('the bots mode ranks the publisher keys among themselves', () => {
    assert.equal(bots.body.members.length, 1)
    assert.equal(bots.body.members[0].pk, PB)
    assert.equal(bots.body.members[0].rank, 1)
  })
}

// ── POST /api/v1/podcasts and /api/v1/publishers — the follows scope ───────
//
// Phase 2 of the branch: Shows/Albums/Artists · Follows. The follows corpus
// can only be aggregated per request, so both endpoints gained the episodes
// POST's shape; the charts ladder and the single-column sorts ride the same
// scoped aggregate. `publisher=` and `since=` exist for the drawers' follows
// paths — one artist's declaring shows with NO medium filter, and an explicit
// boost-time cutoff matching the card's own window.
{
  console.log('\npodcasts & publishers — POST follows')
  const post = (handler, url, follows) => call(handler, url, {
    method: 'POST', body: JSON.stringify({ follows }), headers: { 'content-type': 'application/json' },
  })
  const follows = [POOL[1], POOL[2]]
  const mine = BOOSTS.filter((b) => follows.includes(b.pk))

  const expected = chartOrder(rollup(mine.filter(notMusic), (b) => b.show, (b) => b.pk))
  const { body } = await post(podcastsPost, '/api/v1/podcasts?not_medium=music&sort=chart&limit=200', follows)
  check('⚠️ the shows chart is computed over the follow corpus alone', () => {
    assert.equal(body.scope, 'follows')
    assert.deepEqual(body.podcasts.map((p) => p.guid), expected.map((e) => e.id))
    for (let i = 0; i < expected.length; i++) assert.equal(body.podcasts[i].rank, expected[i].rank)
  })

  const sats = await post(podcastsPost, '/api/v1/podcasts?not_medium=music&sort=sats&limit=200', follows)
  check('⚠️ a single-column sort rides the same scoped aggregate, figures included', () => {
    const exp = rollup(mine.filter(notMusic), (b) => b.show, (b) => b.pk)
      .sort((a, b) => b.sats - a.sats || (a.id < b.id ? -1 : 1))
    assert.deepEqual(sats.body.podcasts.map((p) => p.guid), exp.map((e) => e.id))
    assert.equal(sats.body.podcasts[0].sats, exp[0].sats, 'the figures are the follow corpus’s own')
  })

  // pu1 declares a2 and a3; m1/m2 boost a1 and a2 — so their pu1 list is a2
  // alone, with THEIR figures, and the medium filter must not narrow it.
  const drawer = await post(podcastsPost, '/api/v1/podcasts?publisher=pu1&sort=sats&limit=200', [M[0], M[1]])
  check('⚠️ publisher= scopes to one artist’s declaring shows', () => {
    assert.deepEqual(drawer.body.podcasts.map((p) => p.guid), ['a2'])
    const exp = rollup(BOOSTS.filter((b) => [M[0], M[1]].includes(b.pk) && b.show === 'a2'), (b) => b.show, (b) => b.pk)[0]
    assert.equal(drawer.body.podcasts[0].sats, exp.sats)
    assert.equal(drawer.body.podcasts[0].boosts, exp.boosts)
  })

  // m5's boosts are OLD; an explicit boost-time cutoff drops them all.
  const win = await post(podcastsPost, `/api/v1/podcasts?medium=music&sort=sats&since=${NOW - 7 * 86400}&limit=200`, [M[4]])
  check('⚠️ since= is an explicit boost-time cutoff', () => {
    assert.equal(win.body.podcasts.length, 0)
  })

  const pubOf2 = (b) => SHOW_OF.get(b.show)?.publisher || null
  const pexp = chartOrder(rollup(mine.filter((b) => pubOf2(b)), pubOf2, (b) => b.pk))
  const pres = await post(publishersPost, '/api/v1/publishers?sort=chart&limit=200', follows)
  check('⚠️ the artists chart over the follow corpus alone', () => {
    assert.equal(pres.body.scope, 'follows')
    assert.deepEqual(pres.body.publishers.map((p) => p.guid), pexp.map((e) => e.id))
    for (let i = 0; i < pexp.length; i++) assert.equal(pres.body.publishers[i].rank, pexp[i].rank)
  })

  /* The show drawer's follows path end to end: one show, follows-scoped,
     boost-time windowed. m1 sends two RECENT boosts to a1 (25 sats each);
     m5's a1 boosts are OLD and must not count. */
  const dres = await post(episodesPost, `/api/v1/episodes?podcast=a1&sort=sats&since=${NOW - 7 * 86400}&limit=200`, [M[0], M[4]])
  check('⚠️ the drawer path: podcast= + since= over follows', () => {
    assert.equal(dres.body.episodes.length, 1)
    const row = dres.body.episodes[0]
    assert.equal(row.guid, 'ep-a1')
    assert.equal(row.boosts, 2)
    assert.equal(row.sats, 50)
  })
}

// ── The tiebreak CHAIN, on a corpus built to invert under a flip ───────────
//
// ⚠️ THE MAIN FIXTURE CANNOT CATCH A shows↔sats CHAIN FLIP for members — its
// engineered score ties resolve on pairs where the two keys agree (proved by a
// mutation run: flipping the chain in members.js stayed green). This corpus is
// three members tied on score whose breadth and sats orders are perfect
// OPPOSITES: equal boosts everywhere, so shows-first reads A,B,C and
// sats-first reads C,B,A. Hand-computed and pollution-free — sats ranks 3/2/1,
// boosts ranks all 1, shows ranks 1/2/3, so every score is 5.
{
  console.log('\nmembers — the tiebreak chain (micro-corpus)')
  const db2 = new DatabaseSync(':memory:')
  db2.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))
  const A = pkHex(0x301), B = pkHex(0x302), C = pkHex(0x303)
  const rows = [
    { pk: A, per: 10, shows: ['g1', 'g2', 'g3'] },   // 60 sats, 6 boosts, 3 shows
    { pk: B, per: 15, shows: ['g1', 'g2'] },         // 90 sats, 6 boosts, 2 shows
    { pk: C, per: 20, shows: ['g1'] },               // 120 sats, 6 boosts, 1 show
  ]
  let ev2 = 0
  const ins2 = db2.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid) VALUES(?,?,?,?,?)')
  for (const r of rows) for (let i = 0; i < 6; i++) ins2.run('m' + String(ev2++).padStart(63, '0'), r.pk, RECENT, r.per, r.shows[i % r.shows.length])
  const env2 = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              all: async () => ({ results: db2.prepare(sql).all(...args) }),
              first: async () => db2.prepare(sql).get(...args) ?? null,
            }
          },
        }
      },
    },
  }
  const res = await membersGet({ request: new Request('https://ob.invalid/api/v1/members?sort=chart&limit=10'), env: env2 })
  const body = await res.json()
  check('⚠️ a three-way score tie resolves shows → sats → boosts, in that order', () => {
    assert.deepEqual(body.members.map((m) => m.pk), [A, B, C])
    assert.deepEqual(body.members.map((m) => m.rank), [1, 2, 3])
    assert.deepEqual(body.members.map((m) => m.tied), [false, false, false])
  })
  const chainRanks = await feedRanks(env2.DB, 'booster', { pk: A, sats: 60, boosts: 6, shows: 3 })
  check('⚠️ feedRanks applies the same chain (the breadth leader is #1)', () => {
    assert.equal(chainRanks.chart.rank, 1)
    assert.equal(chainRanks.chart.tied, false)
  })
}

// ── feedRanks — the chart position on the four detail pages ────────────────
{
  console.log('\nfeedRanks — the chart position')
  const showsChart = chartOrder(rollup(BOOSTS.filter(notMusic), (b) => b.show, (b) => b.pk))
  const epChart = chartOrder(rollup(BOOSTS.filter(notMusic), (b) => b.ep, (b) => b.pk))
  const memChart = chartOrder(rollup(BOOSTS.filter((b) => !PUBLISHERS.includes(b.pk)), (b) => b.pk, (b) => b.show))
  const pubOf = (b) => SHOW_OF.get(b.show)?.publisher || null
  const pubChart = chartOrder(rollup(BOOSTS.filter((b) => pubOf(b)), pubOf, (b) => b.pk))

  const showRow = db.prepare('SELECT * FROM podcasts WHERE podcast_guid = ?').get('s2')
  const showRanks = await feedRanks(env.DB, 'show', showRow)
  check('a show carries its chart place beside the three component ranks', () => {
    const exp = showsChart.find((e) => e.id === 's2')
    assert.equal(showRanks.chart.rank, exp.rank)
    assert.equal(showRanks.chart.tied, exp.tied)
  })
  const epRow = db.prepare(`SELECT e.*, pc.medium AS p_medium FROM episodes e
                            LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
                            WHERE e.item_guid = ?`).get('ep-s5')
  const epRanks = await feedRanks(env.DB, 'episode', epRow)
  check('a tied episode reports the shared place with the flag', () => {
    const exp = epChart.find((e) => e.id === 'ep-s5')
    assert.equal(epRanks.chart.rank, exp.rank)
    assert.equal(epRanks.chart.tied, true)
  })
  const m1agg = memChart.find((e) => e.id === M[0])
  const boosterRanks = await feedRanks(env.DB, 'booster', { pk: M[0], sats: m1agg.sats, boosts: m1agg.boosts, shows: m1agg.breadth })
  check('a member’s chart place uses the members population and breadth key', () => {
    assert.equal(boosterRanks.chart.rank, m1agg.rank)
    assert.equal(boosterRanks.chart.tied, m1agg.tied)
  })
  const pu1agg = pubChart.find((e) => e.id === 'pu1')
  const pubRanks = await feedRanks(env.DB, 'publisher', { guid: 'pu1', sats: pu1agg.sats, boosts: pu1agg.boosts, boosters: pu1agg.breadth })
  check('an artist’s chart place matches the publishers chart', () => {
    assert.equal(pubRanks.chart.rank, pu1agg.rank)
  })
  const pbRanks = await feedRanks(env.DB, 'booster', { pk: PB, sats: 5000, boosts: 2, shows: 1 })
  check('⚠️ a publisher key gets no ranks and no chart place', () => {
    assert.equal(pbRanks, null)
  })

  /* ── The windows (the Charts strip, 2026-08-31) ──────────────────────────
   * Brute-forced the same way: the independent implementation over the boost
   * list filtered to the window. Only the 1w and 1y windows are asserted —
   * OLD sits exactly on the 1m boundary, and the fixture's clock and the
   * handler's Date.now() drift by however long the test has been running, so
   * a 1m expectation would flake on the boundary row. 1w (30d >> 7d) and 1y
   * (30d << 365d) are safely inside/outside on both clocks. */
  const inWeek = (b) => b.ts >= NOW - 7 * 86400
  const weekShows = chartOrder(rollup(BOOSTS.filter((b) => notMusic(b) && inWeek(b)), (b) => b.show, (b) => b.pk))
  check('a show carries its place in the WEEK window, ranked over that week alone', () => {
    const exp = weekShows.find((e) => e.id === 's2')
    assert.equal(showRanks.chartWindows['1w'].rank, exp.rank)
    assert.equal(showRanks.chartWindows['1w'].tied, exp.tied)
  })
  check('the 1y window covers the whole fixture, so it matches the all-time place', () => {
    assert.equal(showRanks.chartWindows['1y'].rank, showRanks.chart.rank)
    assert.equal(showRanks.chartWindows.all.rank, showRanks.chart.rank)
  })
  const s7Row = db.prepare('SELECT * FROM podcasts WHERE podcast_guid = ?').get('s7')
  const s7Ranks = await feedRanks(env.DB, 'show', s7Row)
  check('⚠️ a show with no boost in the window resolves null there, not a rank', () => {
    assert.equal(s7Ranks.chartWindows['1w'], null)
    assert.ok(s7Ranks.chartWindows['1y'].rank >= 1)
  })
  const weekMems = chartOrder(rollup(BOOSTS.filter((b) => !PUBLISHERS.includes(b.pk) && inWeek(b)), (b) => b.pk, (b) => b.show))
  check('a member’s week place uses the wall’s windowed population', () => {
    const exp = weekMems.find((e) => e.id === M[0])
    assert.equal(boosterRanks.chartWindows['1w'].rank, exp.rank)
  })
  const m5agg = memChart.find((e) => e.id === M[4])
  const m5Ranks = await feedRanks(env.DB, 'booster', { pk: M[4], sats: m5agg.sats, boosts: m5agg.boosts, shows: m5agg.breadth })
  check('⚠️ a member whose boosts are all old resolves null for the week', () => {
    assert.equal(m5Ranks.chartWindows['1w'], null)
    assert.equal(m5Ranks.chartWindows.all.rank, m5agg.rank)
  })
  const weekPubs = chartOrder(rollup(BOOSTS.filter((b) => pubOf(b) && isMusic(b) && inWeek(b)), pubOf, (b) => b.pk))
  check('an artist’s week place matches the windowed publishers chart', () => {
    const exp = weekPubs.find((e) => e.id === 'pu1')
    assert.equal(pubRanks.chartWindows['1w'].rank, exp.rank)
  })
}

// ── renderStatTiles — the Charts line ──────────────────────────────────────
{
  console.log('\nrenderStatTiles — the Charts line')
  const stats = [
    { key: 'sats', label: 'sats', value: '1,000', exact: '1000 sats' },
    { key: 'boosts', label: 'boosts', value: '10', exact: '10 boosts' },
    { key: 'boosters', label: 'boosters', value: '2', exact: '2 boosters' },
  ]
  const win = (rank, tied = false) => (rank == null ? null : { rank, tied })
  const ranks = {
    sats: { rank: 2, tied: false }, boosts: { rank: 3, tied: false }, boosters: { rank: 1, tied: false },
    chart: { rank: 4, tied: false },
    chartWindows: { '1w': win(3, true), '1m': win(2), '1y': win(4), all: win(4) },
  }
  const html = renderStatTiles(stats, ranks, { rankFeed: 'Shows', backHref: '/#shows' })
  check('the strip renders all four windows, each cell linked to its chart view', () => {
    assert.ok(html.includes('OnlyBoosts Charts'))
    // &amp; — the renderer escapes attribute values, so the test expects HTML.
    assert.ok(html.includes('href="/#shows?sort=chart&amp;range=1w"'))
    assert.ok(html.includes('href="/#shows?sort=chart&amp;range=1m"'))
    assert.ok(html.includes('href="/#shows?sort=chart&amp;range=1y"'))
    assert.ok(html.includes('href="/#shows?sort=chart"'))
  })
  check('a shared place wears the T, and the label links to /about#charts', () => {
    assert.ok(html.includes('T#3'))
    assert.ok(html.includes('href="/about#charts"'))
  })
  const deepHtml = renderStatTiles(stats, { ...ranks, chartWindows: { ...ranks.chartWindows, '1m': win(101) } }, { rankFeed: 'Shows', backHref: '/#shows' })
  check('⚠️ a window past 100 is a dash <span>, not a link — outside wording', () => {
    assert.ok(deepHtml.includes('Outside the top 100 this month'))
    assert.ok(!deepHtml.includes('href="/#shows?sort=chart&amp;range=1m"'))
  })
  const quietHtml = renderStatTiles(stats, { ...ranks, chartWindows: { ...ranks.chartWindows, '1w': null } }, { rankFeed: 'Shows', backHref: '/#shows' })
  check('⚠️ a window with no boosts is a dash with its own honest wording', () => {
    assert.ok(quietHtml.includes('No boosts this week'))
    assert.ok(!quietHtml.includes('href="/#shows?sort=chart&amp;range=1w"'))
  })
  const overrideHtml = renderStatTiles(stats, ranks, { rankFeed: 'Members', backHref: '/#members', chartHref: '/#members', chartBreadth: 'shows boosted' })
  check('/booster’s overrides reach the strip: wall href on every cell, breadth wording', () => {
    assert.ok(overrideHtml.includes('href="/#members"'))
    assert.ok(overrideHtml.includes('shows boosted'))
    assert.ok(!overrideHtml.includes('?sort=chart'))
  })
  const allDeep = { '1w': win(101), '1m': null, '1y': win(200), all: win(101) }
  const noneHtml = renderStatTiles(stats, { ...ranks, chart: { rank: 101, tied: false }, chartWindows: allDeep }, { rankFeed: 'Shows', backHref: '/#shows' })
  check('⚠️ no window inside the top 100 renders NO strip at all', () => {
    assert.ok(!noneHtml.includes('OnlyBoosts Charts'))
    assert.ok(noneHtml.includes('show-stats'))
  })
  const bareHtml = renderStatTiles(stats, { sats: { rank: 2, tied: false }, boosts: { rank: 3, tied: false }, boosters: { rank: 1, tied: false } }, { rankFeed: 'Shows', backHref: '/#shows' })
  check('no chart data at all, no strip — the tiles render exactly as before', () => {
    assert.ok(!bareHtml.includes('OnlyBoosts Charts'))
    assert.ok(bareHtml.includes('show-stats'))
  })
}

console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} passed`)
