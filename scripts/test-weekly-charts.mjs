#!/usr/bin/env node
/**
 * The OnlyBoosts Charts page (/charts/<week>): run the SHIPPED Function over a
 * real D1-shaped database and hold its boards to an INDEPENDENT implementation
 * of each ranking, the test-charts.mjs discipline — one fixture boost list
 * feeds both sides, so a hand-written expectation cannot be wrong together
 * with the query.
 *
 * What is pinned:
 *   - the routing contract: bare /charts, non-Monday dates, future dates and
 *     garbage all resolve to one URL per week or 404; HEAD mirrors GET;
 *   - the page carries Shows, Artists and Members ONLY (Reed, 2026-08-31) —
 *     the retired kinds stay covered at module level, since week-charts.js
 *     still serves them;
 *   - the weekly Top 10s against the brute-forced chart: order, T# on a
 *     genuinely shared place, and the per-row COMPONENT-RANK triplet under
 *     the sats/boosters/boosts column head, component ties computed over the
 *     whole week's corpus;
 *   - the medium partition (an album never on the Shows chart, video and
 *     unidentified shows on it);
 *   - Weeks at #1, content and members both: completed weeks only (the live
 *     week's boosts credit nobody), a tied #1 crediting every holder,
 *     ordering by weeks then recency, the last-week link addressing that
 *     week's page — and the members tally excluding publisher keys, whose
 *     hours would otherwise take a week from a real member;
 *   - the Members pair: the left board is the hours endpoint's own board
 *     (hoursBoard through hpw-board.js), held to brute-forced hours.
 *
 * Run: node scripts/test-weekly-charts.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { onRequestGet, onRequestHead } from '../functions/charts/[[path]].js'
import { weeklyChart, weeksAtNumberOne } from '../functions/_shared/week-charts.js'
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
/* BMB's site account — on PUBLISHERS in _common.js, so the member boards must
 * never show it however many hours it racks up. */
const BOT = '3820f4ff8587747530c7feafe47c1e592e3ce0fd2929b4f907e40714bd26f408'

/* ── the fixture, mirrored into JS ── every boost lands in the DB and in LOG,
 * and the expectations below are computed from LOG alone. */
const MEDIUM = { P1: null, P2: 'podcast', V1: 'video', A1: 'music', A2: 'music' }
const PUBLISHER = { A1: 'PUB1', A2: 'PUB2' }
const SHOW_OF = { e1: 'P1', e2: 'P1', e3: 'P2', s1: 'A1', s2: 'A2' }
const HOUR = 3600
const DUR = { e1: HOUR, e2: HOUR, e3: 2 * HOUR, s1: HOUR / 2, s2: HOUR / 2 }
const TITLE = {
  P1: 'Alpha Show', P2: 'Beta Show', V1: 'Video Show', A1: 'Gamma Album', A2: 'Delta Album',
  PUB1: 'Artist One', PUB2: 'Artist Two',
  e1: 'Ep One', e2: 'Ep Two', e3: 'Ep Three', s1: 'Song One', s2: 'Song Two',
}
const WHO = { [X]: 'Xavier', [Y]: 'Yara', [Z]: 'Zed', [BOT]: 'bmb_site' }

for (const [g, m] of Object.entries(MEDIUM)) {
  db.prepare('INSERT INTO podcasts(podcast_guid,title,medium,publisher_guid) VALUES(?,?,?,?)')
    .run(g, TITLE[g], m, PUBLISHER[g] ?? null)
}
db.prepare('INSERT INTO publishers(publisher_guid,title) VALUES(?,?)').run('PUB1', TITLE.PUB1)
db.prepare('INSERT INTO publishers(publisher_guid,title) VALUES(?,?)').run('PUB2', TITLE.PUB2)
db.prepare('INSERT INTO publishers(publisher_guid,title) VALUES(?,?)').run('PUBX', null) // title-less: never a row
for (const [g, p] of Object.entries(SHOW_OF)) {
  db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title,duration) VALUES(?,?,?,?)')
    .run(g, p, TITLE[g], DUR[g])
}
// 'ghost' is deliberately NOT in episodes: an unenriched boost must still
// chart on the content side, and contributes no hours on the member side.
for (const [pk, dname] of Object.entries(WHO)) {
  db.prepare('INSERT INTO profiles(pubkey,display_name) VALUES(?,?)').run(pk, dname)
}

const LOG = []
let ev = 0
function boost(booster, sats, podcast, item, ts) {
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?)')
    .run('e' + String(ev++).padStart(63, '0'), booster, ts, sats, podcast, item)
  LOG.push({ booster, sats, podcast, item, ts })
}

const at = (w, n) => w + 2 * 86400 + n // Wednesday of the week, plus a step

// W4 — the first week: one lone boost. Yara takes the members #1; Alpha Show
// and Ep One take the content weeks.
boost(Y, 10, 'P1', 'e1', at(W4, 0))
// W2: P2 the clear #1 show, and an albums/artists race whose #1 is decided by
// the TIEBREAK CHAIN: equal scores (4 = 4), boosters 2 v 1, sats 200 v 300 —
// boosters-first hands A1/PUB1 the week, a sats-first chain would hand it the
// other way. A mutation that flips the chain flips this credit and goes red.
boost(X, 1000, 'P2', 'e3', at(W2, 0))
boost(Y, 500, 'P2', 'e3', at(W2, 1))
boost(X, 100, 'P1', 'e1', at(W2, 2))
boost(X, 100, 'A1', 's1', at(W2, 3))
boost(Y, 100, 'A1', 's1', at(W2, 4))
boost(Z, 150, 'A2', 's2', at(W2, 5))
boost(Z, 150, 'A2', 's2', at(W2, 6))
// W1: a mixed shows race, a video boost, an unenriched episode, a COMPLETE tie
// between the two albums (both on T1, both credited a week), and the BOT
// racking up four hours that must be excluded from every member board while
// its boosts still count on the content charts.
boost(X, 100, 'P1', 'e1', at(W1, 0))
boost(Y, 100, 'P1', 'e2', at(W1, 1))
boost(X, 100, 'P1', 'e1', at(W1, 2))
boost(X, 250, 'P2', 'e3', at(W1, 3))
boost(X, 250, 'P2', 'e3', at(W1, 4))
boost(Z, 50, 'V1', null, at(W1, 5))
boost(Z, 75, null, 'ghost', at(W1, 6))
boost(X, 300, 'A1', 's1', at(W1, 7))
boost(Y, 300, 'A2', 's2', at(W1, 8))
boost(BOT, 10, 'P1', 'e1', at(W1, 9))
boost(BOT, 10, 'P1', 'e2', at(W1, 10))
boost(BOT, 10, 'P2', 'e3', at(W1, 11))
// W0 — the LIVE week: a mega boost that must top the live weekly board (and
// Xavier's live hours) while crediting NOBODY a week at #1.
boost(X, 999999, 'P2', 'e3', W0 + 3600)

/* ── the independent chart implementation ── rank sums over a corpus, tuple
 * tiebreak (score, boosters DESC, sats DESC, boosts DESC), competition ranks
 * shared only by rows equal on the whole tuple. Each row also carries its
 * component ranks and component-tie flags, for the triplet. */
function bruteChart(rows) {
  const rk = (vals, v) => 1 + vals.filter((x) => x > v).length
  const shared = (vals, v) => vals.filter((x) => x === v).length > 1
  const S = rows.map((r) => r.sats), B = rows.map((r) => r.boosts), K = rows.map((r) => r.boosters)
  const scored = rows.map((r) => ({
    ...r,
    rSats: rk(S, r.sats), tSats: shared(S, r.sats),
    rBoosts: rk(B, r.boosts), tBoosts: shared(B, r.boosts),
    rBoosters: rk(K, r.boosters), tBoosters: shared(K, r.boosters),
  })).map((r) => ({ ...r, score: r.rSats + r.rBoosts + r.rBoosters }))
  scored.sort((a, b) => a.score - b.score || b.boosters - a.boosters
    || b.sats - a.sats || b.boosts - a.boosts || (a.guid < b.guid ? -1 : 1))
  const tup = (r) => [r.score, r.boosters, r.sats, r.boosts].join('|')
  return scored.map((r, i) => {
    const firstIdx = scored.findIndex((x) => tup(x) === tup(r))
    return {
      ...r,
      rank: firstIdx === i ? i + 1 : firstIdx + 1,
      tied: scored.filter((x) => tup(x) === tup(r)).length > 1,
    }
  })
}
const lbl = (rank, tied) => `${tied ? 'T' : ''}${rank}`
// The component form wears the # — the detail tiles' chip notation, because
// these standings are not positions in the visible list.
const hlbl = (rank, tied) => `${tied ? 'T' : ''}#${rank}`
const triplet = (r) => `${hlbl(r.rSats, r.tSats)}/${hlbl(r.rBoosters, r.tBoosters)}/${hlbl(r.rBoosts, r.tBoosts)}`

/* One content category's corpus for [ws, we) out of LOG — the query's WHERE
 * clauses, re-derived rather than copied. */
function corpus(kind, ws, we) {
  const inWin = LOG.filter((b) => b.ts >= ws && b.ts < we)
  const isMusic = (b) => (b.podcast ? MEDIUM[b.podcast] === 'music' : false)
  let keyed
  if (kind === 'shows') keyed = inWin.filter((b) => b.podcast && !isMusic(b)).map((b) => [b.podcast, b])
  else if (kind === 'albums') keyed = inWin.filter((b) => b.podcast && isMusic(b)).map((b) => [b.podcast, b])
  else if (kind === 'episodes') keyed = inWin.filter((b) => b.item && !isMusic(b)).map((b) => [b.item, b])
  else if (kind === 'songs') keyed = inWin.filter((b) => b.item && isMusic(b)).map((b) => [b.item, b])
  else keyed = inWin.filter((b) => b.podcast && PUBLISHER[b.podcast]).map((b) => [PUBLISHER[b.podcast], b])
  const agg = new Map()
  for (const [g, b] of keyed) {
    const a = agg.get(g) || { guid: g, sats: 0, boosts: 0, set: new Set() }
    a.sats += b.sats; a.boosts += 1; a.set.add(b.booster)
    agg.set(g, a)
  }
  return [...agg.values()].map((a) => ({ guid: a.guid, sats: a.sats, boosts: a.boosts, boosters: a.set.size }))
}

const COMPLETED = [[W4, W3], [W3, W2], [W2, W1], [W1, W0]]

/* Brute-force a content Weeks at #1 tally: chart every completed week, tally
 * the rank-1 holders, order by weeks then recency then key. */
function onesTally(kind) {
  const tally = new Map()
  for (const [a, b] of COMPLETED) {
    for (const r of bruteChart(corpus(kind, a, b))) if (r.rank === 1) {
      const t = tally.get(r.guid) || { weeks: 0, last: 0 }
      t.weeks += 1; t.last = a
      tally.set(r.guid, t)
    }
  }
  return [...tally.entries()].sort((a, b) => b[1].weeks - a[1].weeks || b[1].last - a[1].last || (a[0] < b[0] ? -1 : 1))
}

/* Brute-force one week's member hours: distinct (booster, episode) with a
 * usable duration, publishers out — the hours endpoint's corpus rules. */
function memberHours(ws, we) {
  const per = new Map()
  for (const b of LOG) {
    if (b.ts < ws || b.ts >= we || !b.item || b.booster === BOT || !DUR[b.item]) continue
    const s = per.get(b.booster) || new Set()
    s.add(b.item); per.set(b.booster, s)
  }
  return [...per.entries()]
    .map(([pk, items]) => ({ pk, secs: [...items].reduce((n, g) => n + DUR[g], 0), eps: items.size }))
    .sort((a, b) => b.secs - a.secs || a.eps - b.eps || (a.pk < b.pk ? -1 : 1))
}

function memberOnesTally() {
  const tally = new Map()
  for (const [a, b] of COMPLETED) {
    const rows = memberHours(a, b)
    if (!rows.length) continue
    const top = rows[0].secs
    for (const r of rows) if (r.secs === top) {
      const t = tally.get(r.pk) || { weeks: 0, last: 0 }
      t.weeks += 1; t.last = a
      tally.set(r.pk, t)
    }
  }
  return [...tally.entries()].sort((a, b) => b[1].weeks - a[1].weeks || b[1].last - a[1].last || (a[0] < b[0] ? -1 : 1))
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
  let m = html.indexOf(`data-cb-board="${key}"`)
  if (m < 0) m = html.indexOf(`data-hpw-board="${key}"`)
  assert.ok(m >= 0, `board ${key} present`)
  const end = html.indexOf('</section>', m)
  return html.slice(m, end)
}
const names = (frag) => [...frag.matchAll(/class="cb-name"[^>]*>([^<]*)</g)].map((x) => x[1])
const hpwNames = (frag) => [...frag.matchAll(/class="hpw-name"[^>]*>([^<]*)</g)].map((x) => x[1])
const positions = (frag) => [...frag.matchAll(/class="cb-pos">([^<]*)</g)].map((x) => x[1])
const figs = (frag) => [...frag.matchAll(/class="cb-fig">([^<]*)</g)].map((x) => x[1])
const triplets = (frag) => [...frag.matchAll(/class="cb-ranks"[^>]*>([^<]*)</g)].map((x) => x[1])
const hpwFigs = (frag) => [...frag.matchAll(/class="hpw-hours">([^<]*)</g)].map((x) => x[1])

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
check('exactly Shows, Artists and Members render — the retired kinds do not', () => {
  for (const k of ['shows-week', 'shows-ones', 'artists-week', 'artists-ones', 'members-week', 'members-ones']) boardOf(html, k)
  for (const k of ['episodes', 'albums', 'songs']) {
    assert.ok(!html.includes(`data-cb-board="${k}-week"`), `${k} absent`)
  }
})
check('the stepper ships the picker data and the static label', () => {
  assert.ok(html.includes('data-charts-first="'))
  assert.ok(html.includes('data-charts-livews="'))
  assert.ok(html.includes('hpw-pick--static'))
  assert.ok(html.includes('/assets/js/charts-page.js'))
})

for (const kind of ['shows', 'artists']) {
  check(`${kind} weekly Top 10 matches the brute-forced chart, triplet included`, () => {
    const expect = bruteChart(corpus(kind, W1, W0))
    const frag = boardOf(html, `${kind}-week`)
    assert.deepEqual(names(frag), expect.map((r) => TITLE[r.guid]))
    assert.deepEqual(positions(frag), expect.map((r) => lbl(r.rank, r.tied)))
    assert.deepEqual(triplets(frag), expect.map(triplet))
  })
}
check('the column head says these are ranks, and links the formula', () => {
  const frag = boardOf(html, 'shows-week')
  assert.ok(frag.includes('rank in sats/boosters/boosts'))
  const head = frag.slice(frag.indexOf('cb-colhead'), frag.indexOf('<ol'))
  assert.ok(head.includes('href="/about#charts"'))
})
check('the medium partition holds: no album on Shows, video counts as a show', () => {
  const shows = boardOf(html, 'shows-week')
  assert.ok(!shows.includes(TITLE.A1) && !shows.includes(TITLE.A2))
  assert.ok(shows.includes(TITLE.V1))
})

console.log('\nWeeks at #1 (content):')
for (const kind of ['shows', 'artists']) {
  check(`${kind} Weeks at #1 matches the brute-forced tally`, () => {
    const expect = onesTally(kind)
    const frag = boardOf(html, `${kind}-ones`)
    assert.deepEqual(names(frag), expect.map(([g]) => TITLE[g]))
    assert.deepEqual(figs(frag), expect.map(([, t]) => String(t.weeks)))
  })
}
check('the chain-decided W2 albums week credits Artist One at module level', () => {
  // The W2 race is score-tied and settled boosters-first; the artists tally
  // (on the page) and the albums tally (module level, below) both carry it.
  const expect = onesTally('artists')
  assert.equal(expect[0][0], 'PUB1')
})
check('the live week credits nobody', () => {
  const expect = onesTally('shows')
  const p2 = expect.find(([g]) => g === 'P2')
  assert.equal(p2[1].weeks, 1) // W2 only — the W0 mega boost buys nothing yet
  assert.deepEqual(names(boardOf(html, 'shows-ones')), expect.map(([g]) => TITLE[g]))
})
check('a last-week link addresses that week page', () => {
  assert.ok(boardOf(html, 'shows-ones').includes(`/charts/${weekDateString(W1)}`))
})
check('the title-less publisher never appears', () => {
  assert.ok(!html.includes('PUBX'))
})

console.log('\nThe Members pair:')
{
  const frag = boardOf(html, 'members-week')
  check('the left board is the hours board: brute-forced order and hours', () => {
    const expect = memberHours(W1, W0)
    assert.deepEqual(hpwNames(frag), expect.map((r) => WHO[r.pk]))
    const hrs = hpwFigs(frag).map((s) => s.replace(/<.*$/, ''))
    assert.deepEqual(hrs, expect.map((r) => (r.secs / HOUR).toFixed(1)))
  })
  check('the BOT is excluded from both member boards, hours notwithstanding', () => {
    assert.ok(!frag.includes(WHO[BOT]))
    assert.ok(!boardOf(html, 'members-ones').includes(WHO[BOT]))
  })
  check('members Weeks at #1 matches the brute-forced tally', () => {
    const expect = memberOnesTally()
    const ones = boardOf(html, 'members-ones')
    assert.deepEqual(hpwNames(ones), expect.map(([pk]) => WHO[pk]))
    const wks = hpwFigs(ones).map((s) => s.replace(/<.*$/, ''))
    assert.deepEqual(wks, expect.map(([, t]) => String(t.weeks)))
  })
  check('the live week credits no member — Xavier holds two weeks, not three', () => {
    const x = memberOnesTally().find(([pk]) => pk === X)
    assert.equal(x[1].weeks, 2) // W2 and W1; the W0 mega listen buys nothing yet
    assert.ok(boardOf(html, 'members-ones').includes(`/charts/${weekDateString(W1)}`))
  })
}

console.log('\nModule level — the retired kinds still serve:')
{
  const w1 = W1, w0 = W0
  for (const kind of ['episodes', 'albums', 'songs']) {
    const rows = await weeklyChart(env, kind, w1, w0, 10)
    check(`${kind} weeklyChart matches brute force for W1`, () => {
      const expect = bruteChart(corpus(kind, w1, w0))
      assert.deepEqual(rows.map((r) => r.guid), expect.map((r) => r.guid))
      assert.deepEqual(rows.map((r) => lbl(r.rank, r.tied)), expect.map((r) => lbl(r.rank, r.tied)))
    })
  }
  const songsOnes = await weeksAtNumberOne(env, 'songs', W0, 10)
  check('songs weeksAtNumberOne matches the brute-forced tally', () => {
    const expect = onesTally('songs')
    assert.deepEqual(songsOnes.map((r) => r.guid), expect.map(([g]) => g))
    assert.deepEqual(songsOnes.map((r) => r.weeks), expect.map(([, t]) => t.weeks))
  })
  const albumsOnes = await weeksAtNumberOne(env, 'albums', W0, 10)
  check('the tied W1 albums week credits both holders', () => {
    const a1 = albumsOnes.find((r) => r.guid === 'A1')
    const a2 = albumsOnes.find((r) => r.guid === 'A2')
    assert.ok(a1 && a2)
    assert.deepEqual(onesTally('albums').map(([g]) => g).sort(), ['A1', 'A2'])
  })
}

console.log('\nThe live page and the empty week:')
{
  const r = await get(`/charts/${weekDateString(W0)}`)
  const liveHtml = await r.text()
  check('the live week caches short and leads with the mega boost', () => {
    assert.match(r.headers.get('cache-control'), /max-age=60/)
    assert.equal(names(boardOf(liveHtml, 'shows-week'))[0], TITLE.P2)
    assert.ok(!r.headers.get('x-robots-tag'))
  })
  check('the live page and W1 page carry identical Weeks at #1 boards', () => {
    assert.equal(boardOf(liveHtml, 'shows-ones'), boardOf(html, 'shows-ones'))
    assert.equal(boardOf(liveHtml, 'members-ones'), boardOf(html, 'members-ones'))
  })
  const e = await get(`/charts/${weekDateString(W3)}`)
  const eHtml = await e.text()
  check('an empty in-range week renders empties and is noindex', () => {
    assert.equal(e.status, 200)
    assert.equal(e.headers.get('x-robots-tag'), 'noindex')
    assert.ok(eHtml.includes('No Nostr boosts that week.'))
    assert.ok(eHtml.includes('Nobody boosted an episode with a known length that week.'))
  })
}

console.log(`\n${passed} passed, ${failed} failed`)
