#!/usr/bin/env node
/**
 * The OnlyBoosts Charts page (/charts/<week>): run the SHIPPED Function over a
 * real D1-shaped database and hold its boards to an INDEPENDENT implementation
 * of the chart rule, the test-charts.mjs discipline — one fixture boost list
 * feeds both sides, so a hand-written expectation cannot be wrong together
 * with the query.
 *
 * What is pinned:
 *   - the routing contract: bare /charts, non-Monday dates, future dates and
 *     garbage all resolve to one URL per week or 404; HEAD mirrors GET;
 *   - the weekly Top 10s against the brute-forced chart (rank sums, tuple
 *     tiebreak, competition ranks, T# on shared places);
 *   - the medium partition (an album never on the Shows chart, video and
 *     unidentified shows on it);
 *   - Weeks at #1: completed weeks only (the live week's boosts credit
 *     nobody), a tied #1 crediting every holder, ordering by weeks then
 *     recency, and the last-week link addressing that week's page.
 *
 * Run: node scripts/test-weekly-charts.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { onRequestGet, onRequestHead } from '../functions/charts/[[path]].js'
import { pacificWeekStart, prevWeek, weekDateString } from '../assets/js/pacific-week.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))

/* ── the weeks ── anchored on the shipped week rule, never on flat arithmetic:
 * a fixture that floored Mondays itself could be wrong together with the page. */
const W0 = pacificWeekStart(Math.floor(Date.now() / 1000)) // live
const W1 = prevWeek(W0)
const W2 = prevWeek(W1)
const W3 = prevWeek(W2)                                    // deliberately empty
const W4 = prevWeek(W3)                                    // the index's first week

const X = 'a'.repeat(64), Y = 'b'.repeat(64), Z = 'c'.repeat(64)

/* ── the fixture, mirrored into JS ── every boost lands in the DB and in LOG,
 * and the expectations below are computed from LOG alone. */
const MEDIUM = { P1: null, P2: 'podcast', V1: 'video', A1: 'music', A2: 'music' }
const PUBLISHER = { A1: 'PUB1', A2: 'PUB2' }
const SHOW_OF = { e1: 'P1', e2: 'P1', e3: 'P2', s1: 'A1', s2: 'A2' }
const TITLE = {
  P1: 'Alpha Show', P2: 'Beta Show', V1: 'Video Show', A1: 'Gamma Album', A2: 'Delta Album',
  PUB1: 'Artist One', PUB2: 'Artist Two',
  e1: 'Ep One', e2: 'Ep Two', e3: 'Ep Three', s1: 'Song One', s2: 'Song Two',
}

for (const [g, m] of Object.entries(MEDIUM)) {
  db.prepare('INSERT INTO podcasts(podcast_guid,title,medium,publisher_guid) VALUES(?,?,?,?)')
    .run(g, TITLE[g], m, PUBLISHER[g] ?? null)
}
db.prepare('INSERT INTO publishers(publisher_guid,title) VALUES(?,?)').run('PUB1', TITLE.PUB1)
db.prepare('INSERT INTO publishers(publisher_guid,title) VALUES(?,?)').run('PUB2', TITLE.PUB2)
db.prepare('INSERT INTO publishers(publisher_guid,title) VALUES(?,?)').run('PUBX', null) // title-less: never a row
for (const [g, p] of Object.entries(SHOW_OF)) {
  db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title) VALUES(?,?,?)').run(g, p, TITLE[g])
}
// 'ghost' is deliberately NOT in episodes: an unenriched boost must still chart.

const LOG = []
let ev = 0
function boost(booster, sats, podcast, item, ts) {
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?)')
    .run('e' + String(ev++).padStart(63, '0'), booster, ts, sats, podcast, item)
  LOG.push({ booster, sats, podcast, item, ts })
}

const at = (w, n) => w + 2 * 86400 + n // Wednesday of the week, plus a step

// W4 — the first week: one lone boost, so P1/e1 take a #1 week each.
boost(X, 10, 'P1', 'e1', at(W4, 0))
// W2: P2 the clear #1 show; A1 the only album.
boost(X, 1000, 'P2', 'e3', at(W2, 0))
boost(Y, 500, 'P2', 'e3', at(W2, 1))
boost(X, 100, 'P1', 'e1', at(W2, 2))
/* The W2 albums race exists to make the TIEBREAK CHAIN decide a #1: equal
 * scores (4 = 4), boosters 2 v 1, sats 200 v 300 — boosters-first hands A1
 * the week, a sats-first chain would hand it to A2. A mutation that flips
 * the chain flips this week's credit and goes red in the ones tally. */
boost(X, 100, 'A1', 's1', at(W2, 3))
boost(Y, 100, 'A1', 's1', at(W2, 4))
boost(Z, 150, 'A2', 's2', at(W2, 5))
boost(Z, 150, 'A2', 's2', at(W2, 6))
// W1: a mixed shows race, a video boost, an unenriched episode, and a COMPLETE
// tie between the two albums (same sats, boosts and boosters) that must land
// both on T1 and credit both with a week at #1.
boost(X, 100, 'P1', 'e1', at(W1, 0))
boost(Y, 100, 'P1', 'e2', at(W1, 1))
boost(X, 100, 'P1', 'e1', at(W1, 2))
boost(X, 250, 'P2', 'e3', at(W1, 3))
boost(X, 250, 'P2', 'e3', at(W1, 4))
boost(Z, 50, 'V1', null, at(W1, 5))
boost(Z, 75, null, 'ghost', at(W1, 6))
boost(X, 300, 'A1', 's1', at(W1, 7))
boost(Y, 300, 'A2', 's2', at(W1, 8))
// W0 — the LIVE week: a mega boost that must top the live weekly board and
// credit NOBODY a week at #1.
boost(X, 999999, 'P2', 'e3', W0 + 3600)

/* ── the independent chart implementation ── rank sums over a corpus, tuple
 * tiebreak (score, boosters DESC, sats DESC, boosts DESC), competition ranks
 * shared only by rows equal on the whole tuple. */
function bruteChart(rows) {
  const rk = (vals, v) => 1 + vals.filter((x) => x > v).length
  const S = rows.map((r) => r.sats), B = rows.map((r) => r.boosts), K = rows.map((r) => r.boosters)
  const scored = rows.map((r) => ({ ...r, score: rk(S, r.sats) + rk(B, r.boosts) + rk(K, r.boosters) }))
  scored.sort((a, b) => a.score - b.score || b.boosters - a.boosters
    || b.sats - a.sats || b.boosts - a.boosts || (a.guid < b.guid ? -1 : 1))
  const tup = (r) => [r.score, r.boosters, r.sats, r.boosts].join('|')
  return scored.map((r, i) => {
    // Competition rank over the WHOLE tuple: the first index holding an equal
    // tuple names the shared place; a lone tuple ranks by position.
    const first = scored.findIndex((x) => tup(x) === tup(r))
    return {
      ...r,
      rank: first === i ? i + 1 : first + 1,
      tied: scored.filter((x) => tup(x) === tup(r)).length > 1,
    }
  })
}

/* One category's corpus for [ws, we) out of LOG — the query's WHERE clauses,
 * re-derived rather than copied. */
function corpus(kind, ws, we) {
  const inWin = LOG.filter((b) => b.ts >= ws && b.ts < we)
  const isMusic = (g) => MEDIUM[g] === 'music'
  const mediumOf = (b) => (b.podcast ? isMusic(b.podcast) : false)
  let keyed
  if (kind === 'shows') keyed = inWin.filter((b) => b.podcast && !mediumOf(b)).map((b) => [b.podcast, b])
  else if (kind === 'albums') keyed = inWin.filter((b) => b.podcast && mediumOf(b)).map((b) => [b.podcast, b])
  else if (kind === 'episodes') keyed = inWin.filter((b) => b.item && !mediumOf(b)).map((b) => [b.item, b])
  else if (kind === 'songs') keyed = inWin.filter((b) => b.item && mediumOf(b)).map((b) => [b.item, b])
  else keyed = inWin.filter((b) => b.podcast && PUBLISHER[b.podcast]).map((b) => [PUBLISHER[b.podcast], b])
  const agg = new Map()
  for (const [g, b] of keyed) {
    const a = agg.get(g) || { guid: g, sats: 0, boosts: 0, set: new Set() }
    a.sats += b.sats; a.boosts += 1; a.set.add(b.booster)
    agg.set(g, a)
  }
  return [...agg.values()].map((a) => ({ guid: a.guid, sats: a.sats, boosts: a.boosts, boosters: a.set.size }))
}

/* ── the shim and the calls ── */
const stmt = (sql, args = null) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: db.prepare(sql).all(...(args || [])) }),
  first: async () => db.prepare(sql).get(...(args || [])) ?? null,
})
const env = { DB: { prepare: (sql) => stmt(sql) } }
const get = (path) => onRequestGet({
  request: new Request('https://ob.invalid' + path),
  env,
  params: { path: path.split('/').filter(Boolean).slice(1) },
})
const head = (path) => onRequestHead({
  request: new Request('https://ob.invalid' + path, { method: 'HEAD' }),
  env,
  params: { path: path.split('/').filter(Boolean).slice(1) },
})

function boardOf(html, key) {
  const m = html.indexOf(`data-cb-board="${key}"`)
  assert.ok(m >= 0, `board ${key} present`)
  const end = html.indexOf('</section>', m)
  return html.slice(m, end)
}
const names = (frag) => [...frag.matchAll(/class="cb-name"[^>]*>([^<]*)</g)].map((x) => x[1])
const positions = (frag) => [...frag.matchAll(/class="cb-pos">([^<]*)</g)].map((x) => x[1])
const figs = (frag) => [...frag.matchAll(/class="cb-fig">([^<]*)</g)].map((x) => x[1])

const loc = (resp) => new URL(resp.headers.get('location')).pathname

console.log('\nRouting:')
{
  const r = await get('/charts')
  check('bare /charts 302s to the live week', () => {
    assert.equal(r.status, 302)
    assert.equal(loc(r), `/charts/${weekDateString(W0)}`)
  })
  const wed = await get(`/charts/${weekDateString(W1 + 2 * 86400)}`)
  check('a mid-week date 302s to its Monday', () => {
    assert.equal(wed.status, 302)
    assert.equal(loc(wed), `/charts/${weekDateString(W1)}`)
  })
  const fut = await get('/charts/2099-01-04')
  check('a future date 302s to the live week', () => {
    assert.equal(fut.status, 302)
    assert.equal(loc(fut), `/charts/${weekDateString(W0)}`)
  })
  const early = await get('/charts/1999-01-04')
  check('pre-index week is 404', () => assert.equal(early.status, 404))
  const junk = await get('/charts/not-a-date')
  check('garbage is 404', () => assert.equal(junk.status, 404))
  const imp = await get('/charts/2026-02-30')
  check('an impossible calendar date is 404', () => assert.equal(imp.status, 404))
  const extra = await get(`/charts/${weekDateString(W1)}/card`)
  check('extra path segments are 404', () => assert.equal(extra.status, 404))
  const h = await head(`/charts/${weekDateString(W1)}`)
  check('HEAD mirrors GET status with no body', async () => {
    assert.equal(h.status, 200)
    assert.equal(await h.text(), '')
  })
}

console.log('\nThe W1 page:')
const resp = await get(`/charts/${weekDateString(W1)}`)
const html = await resp.text()
check('answers 200, cached as a past week', () => {
  assert.equal(resp.status, 200)
  assert.match(resp.headers.get('cache-control'), /max-age=300/)
})
check('canonical and og name the week URL', () => {
  assert.ok(html.includes(`https://onlyboosts.social/charts/${weekDateString(W1)}`))
  assert.ok(html.includes('OnlyBoosts Charts'))
})
check('all ten boards render', () => {
  for (const k of ['shows', 'episodes', 'artists', 'albums', 'songs']) {
    boardOf(html, `${k}-week`); boardOf(html, `${k}-ones`)
  }
})

for (const kind of ['shows', 'episodes', 'artists', 'albums', 'songs']) {
  check(`${kind} weekly Top 10 matches the brute-forced chart`, () => {
    const expect = bruteChart(corpus(kind, W1, W0))
    const frag = boardOf(html, `${kind}-week`)
    const got = names(frag)
    const want = expect.map((r) => TITLE[r.guid] ?? 'Untitled episode')
    assert.deepEqual(got, want)
    const gotPos = positions(frag)
    const wantPos = expect.map((r) => `${r.tied ? 'T' : ''}${r.rank}`)
    assert.deepEqual(gotPos, wantPos)
  })
}

check('the medium partition holds: no album on Shows, video counts as a show', () => {
  const shows = boardOf(html, 'shows-week')
  assert.ok(!shows.includes(TITLE.A1) && !shows.includes(TITLE.A2))
  assert.ok(shows.includes(TITLE.V1))
})
check('an unenriched episode charts untitled and unlinked', () => {
  const eps = boardOf(html, 'episodes-week')
  assert.ok(eps.includes('Untitled episode'))
  assert.ok(!eps.includes('/episode/ghost'))
})
check('the tied albums share T1 and print the tie', () => {
  const albums = boardOf(html, 'albums-week')
  assert.deepEqual(positions(albums), ['T1', 'T1'])
})
check('weekly sats figures are the window sums', () => {
  const shows = boardOf(html, 'shows-week')
  const byName = Object.fromEntries(names(shows).map((n, i) => [n, figs(shows)[i]]))
  assert.equal(byName[TITLE.P1], '300')
  assert.equal(byName[TITLE.P2], '500')
})

console.log('\nWeeks at #1:')
/* Brute-force the companions from LOG: chart every completed week, tally the
 * rank-1 holders. */
function onesTally(kind) {
  const tally = new Map()
  for (const w of [[W4, W3], [W3, W2], [W2, W1], [W1, W0]]) {
    const c = bruteChart(corpus(kind, w[0], w[1]))
    for (const r of c) if (r.rank === 1) {
      const t = tally.get(r.guid) || { weeks: 0, last: 0 }
      t.weeks += 1; t.last = w[0]
      tally.set(r.guid, t)
    }
  }
  return [...tally.entries()].sort((a, b) => b[1].weeks - a[1].weeks || b[1].last - a[1].last || (a[0] < b[0] ? -1 : 1))
}
for (const kind of ['shows', 'episodes', 'artists', 'albums', 'songs']) {
  check(`${kind} Weeks at #1 matches the brute-forced tally`, () => {
    const expect = onesTally(kind)
    const frag = boardOf(html, `${kind}-ones`)
    assert.deepEqual(names(frag), expect.map(([g]) => TITLE[g] ?? 'Untitled episode'))
    const wantFigs = expect.map(([, t]) => String(t.weeks))
    assert.deepEqual(figs(frag), wantFigs)
  })
}
check('a tied #1 week credits every holder', () => {
  const frag = boardOf(html, 'albums-ones')
  assert.ok(names(frag).includes(TITLE.A1) && names(frag).includes(TITLE.A2))
})
check('the live week credits nobody', () => {
  // P2's W0 mega boost: its shows tally must count only W2 (P1 holds W4, W1).
  const expect = onesTally('shows')
  const p2 = expect.find(([g]) => g === 'P2')
  assert.equal(p2[1].weeks, 1)
  const frag = boardOf(html, 'shows-ones')
  assert.deepEqual(names(frag), [TITLE.P1, TITLE.P2])
})
check('a last-week link addresses that week page', () => {
  const frag = boardOf(html, 'shows-ones')
  assert.ok(frag.includes(`/charts/${weekDateString(W1)}`)) // P1 last led in W1
})
check('the title-less publisher never appears', () => {
  assert.ok(!html.includes('PUBX'))
})

console.log('\nThe live page and the empty week:')
{
  const r = await get(`/charts/${weekDateString(W0)}`)
  const liveHtml = await r.text()
  check('the live week caches short and leads with the mega boost', () => {
    assert.match(r.headers.get('cache-control'), /max-age=60/)
    const shows = boardOf(liveHtml, 'shows-week')
    assert.equal(names(shows)[0], TITLE.P2)
    assert.ok(!r.headers.get('x-robots-tag'))
  })
  check('the live page and W1 page carry identical Weeks at #1 boards', () => {
    assert.equal(boardOf(liveHtml, 'shows-ones'), boardOf(html, 'shows-ones'))
  })
  const e = await get(`/charts/${weekDateString(W3)}`)
  const eHtml = await e.text()
  check('an empty in-range week renders empties and is noindex', () => {
    assert.equal(e.status, 200)
    assert.equal(e.headers.get('x-robots-tag'), 'noindex')
    assert.ok(eHtml.includes('No Nostr boosts that week.'))
  })
}

console.log(`\n${passed} passed, ${failed} failed`)
