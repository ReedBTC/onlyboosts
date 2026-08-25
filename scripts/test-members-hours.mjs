#!/usr/bin/env node
/**
 * Run the SHIPPED /api/v1/members/hours handler against a real D1-shaped
 * database, and check the arithmetic the 40 HPW boards rest on.
 *
 * ⚠️ THE THINGS THAT CAN GO WRONG HERE ARE ARITHMETIC, AND ARITHMETIC LOOKS
 * FINE. A join that multiplies rows inflates hours and episode counts by the
 * same factor, so the board still reads as a plausible board; a week boundary
 * off by three days still produces weeks; a missing dedupe still produces
 * hours. None of it announces itself, which is why the fixture below is built
 * with known answers rather than sampled.
 *
 * Run: node scripts/test-members-hours.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { onRequestGet, pacificWeekStart } from '../functions/api/v1/members/hours.js'
import {
  prevWeek, nextWeek, weekSeries, weekDateString, weekStartFromDate,
} from '../assets/js/pacific-week.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))

const WEEK = 604800, MONDAY_EPOCH = 345600
const HOUR = 3600
/* ⚠️ THE FIXTURE ASKS THE SHIPPED FUNCTION WHERE MONDAY IS, rather than
 * computing it. Weeks start at midnight US PACIFIC (Reed's call, 2026-08-23),
 * so a fixture that floored to Monday 00:00 UTC would place "last Sunday" up to
 * eight hours on the wrong side of the boundary for part of every week — and it
 * would pass, because the endpoint and the fixture would then be wrong together
 * in the same direction. `pacificWeekStart` is exported for exactly this. */
const mondayOf = (ts) => pacificWeekStart(ts)
const thisMonday = mondayOf(Math.floor(Date.now() / 1000))

let ev = 0
const boost = (pk, itemGuid, ts, npub = null) =>
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,booster_npub,created_at,sats,item_guid) VALUES(?,?,?,?,?,?)')
    .run('e' + String(ev++).padStart(63, '0'), pk, npub, ts, 100, itemGuid)
const episode = (guid, secs) =>
  db.prepare('INSERT INTO episodes(item_guid,title,duration) VALUES(?,?,?)').run(guid, 'ep ' + guid, secs)
const profile = (pk, dname) =>
  db.prepare('INSERT INTO profiles(pubkey,display_name) VALUES(?,?)').run(pk, dname)

// Four one-hour episodes, one two-hour, one with NO duration, one with zero.
episode('ep1', HOUR); episode('ep2', HOUR); episode('ep3', HOUR); episode('ep4', HOUR)
episode('ep2h', 2 * HOUR)
episode('epnull', null)
episode('epzero', 0)

const ALICE = 'a'.repeat(64), BOB = 'b'.repeat(64), CARA = 'c'.repeat(64)
/* ⚠️ DAVE EXISTS TO SPAN TWO WEEKS, and nothing else tests what he tests. With
 * every fixture member boosting inside a single week, grouping the all-time
 * board by member instead of by member-week produces exactly the same rows, so
 * the merge is invisible. Verified by mutation: dropping `d.wk` from the GROUP
 * BY was caught by nothing until this member existed. */
const DAVE = 'd'.repeat(64)
const BOT = 'f3bd42a91af5f3f1c40ca45ad2269464ab79996b32da78e8ed2ab91111b08e65' // chadf-boostbot
profile(ALICE, 'Alice'); profile(BOB, 'Bob'); profile(CARA, 'Cara'); profile(DAVE, 'Dave')
profile(BOT, 'chadf_boostbot')

const mid = thisMonday + 2 * 86400          // Wednesday of this week
// Alice: three distinct hours, plus FOUR repeat boosts on one of them.
for (const g of ['ep1', 'ep2', 'ep3']) boost(ALICE, g, mid, 'npub1alice')
for (let i = 0; i < 4; i++) boost(ALICE, 'ep1', mid + i)
// Bob: one two-hour episode, plus rows that must contribute nothing.
boost(BOB, 'ep2h', mid)
boost(BOB, 'epnull', mid)                   // no duration
boost(BOB, 'epzero', mid)                   // zero duration
boost(BOB, null, mid)                       // show-level: names no episode
// Cara boosted LAST week only.
boost(CARA, 'ep1', thisMonday - 86400)
boost(CARA, 'ep2', thisMonday - 86400)
// Dave: one hour this week and one hour three weeks ago. Two rows on the
// all-time board, one hour each — never a single two-hour row.
boost(DAVE, 'ep1', mid)
boost(DAVE, 'ep2', mid - 3 * WEEK)
// The bot racked up four hours this week and must not appear.
for (const g of ['ep1', 'ep2', 'ep3', 'ep4']) boost(BOT, g, mid)

/* ⚠️ THE SHIM MODELS `.first()` AS WELL AS `.all()`, AND `.first()` OFF AN
 * UNBOUND STATEMENT. D1 offers both, `first_week` is fetched with the second
 * shape, and a shim that models less than the thing it stands in for turns a
 * hard failure into a quiet one — `test-members-search.mjs` learned that when a
 * missing `.first()` made every rank call take its documented null path and
 * pass for entirely the wrong reason. */
const stmt = (sql, args = null) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: db.prepare(sql).all(...(args || [])) }),
  first: async () => db.prepare(sql).get(...(args || [])) ?? null,
})
const env = { DB: { prepare: (sql) => stmt(sql) } }
const call = async (qs) => (await (await onRequestGet({
  request: new Request('https://ob.invalid/api/v1/members/hours' + qs), env,
})).json())
const hours = (m) => m.seconds / HOUR
const byName = (b) => Object.fromEntries(b.members.map((m) => [m.name, m]))

console.log('\nThis week:')
const wk = await call('?range=week')
const w = byName(wk)

check('a repeat boost on the same episode counts once', () => {
  // Alice boosted ep1 five times in the week. Three distinct hours, not seven.
  assert.equal(hours(w.Alice), 3, `got ${hours(w.Alice)}h`)
  assert.equal(w.Alice.episodes, 3)
})
check('duration is summed, not episodes counted', () => {
  // Bob has ONE episode worth TWO hours; a board counting episodes ranks him
  // below Alice, a board summing duration puts him within an hour of her.
  assert.equal(hours(w.Bob), 2)
  assert.equal(w.Bob.episodes, 1)
})
check('an episode with no duration contributes nothing', () => {
  assert.equal(w.Bob.episodes, 1, 'epnull or epzero leaked into the count')
})
check('a show-level boost names no episode and is skipped', () => {
  assert.equal(hours(w.Bob), 2)
})
check('⚠️ a publisher pubkey is not a member and does not rank', () => {
  assert.ok(!('chadf_boostbot' in w), `bot ranked: ${JSON.stringify(Object.keys(w))}`)
})
check('last week does not appear on this week\'s board', () => {
  assert.ok(!('Cara' in w), 'a boost from last Sunday counted as this week')
})
check('most hours first', () => {
  const s = wk.members.map((m) => m.seconds)
  assert.ok(s.length >= 2, 'not enough rows to have an order')
  assert.deepEqual(s, [...s].sort((a, b) => b - a))
})
check('the envelope names the week and the goal', () => {
  assert.equal(wk.week_start, thisMonday)
  assert.equal(wk.goal_hours, 40)
})
check('the npub rides along without multiplying the row', () => {
  // The bug this guards: LEFT JOIN boosts for the npub inflates every figure
  // by that member's boost count. Alice has 7 boosts; 3h would have read 21h.
  assert.equal(w.Alice.npub, 'npub1alice')
  assert.equal(hours(w.Alice), 3)
})

console.log('\nAll time, one row per booster-week:')
const all = await call('?range=all')
check('⚠️ a member who boosted in two weeks gets two rows, not one merged one', () => {
  const dave = all.members.filter((m) => m.name === 'Dave')
  assert.equal(dave.length, 2, `Dave has ${dave.length} row(s); weeks were merged`)
  assert.deepEqual(dave.map(hours), [1, 1])
  assert.notDeepEqual([...new Set(dave.map((m) => m.week_start))].length, 1)
})
check('a member who boosted in one week gets one row', () => {
  const cara = all.members.filter((m) => m.name === 'Cara')
  assert.equal(cara.length, 1)
  assert.equal(hours(cara[0]), 2)
})
check('each row carries the Monday its week started', () => {
  for (const m of all.members) {
    assert.ok(m.week_start, `${m.name} has no week_start`)
    // ⚠️ NOT `% WEEK`, WHICH IS WHAT THIS WAS WHILE WEEKS WERE UTC. A Pacific
    // Monday midnight is 07:00 or 08:00 UTC and the two differ by an hour, so
    // week starts are no longer congruent modulo a week. What must hold is that
    // it IS the Monday of its own week, which is the same claim stated in terms
    // of the rule rather than of the arithmetic.
    assert.equal(m.week_start, pacificWeekStart(m.week_start),
      `${m.name}'s week_start is not the start of its own week`)
    assert.equal(new Date(m.week_start * 1000).getUTCDay(), 1,
      `${m.name}'s week starts ${new Date(m.week_start * 1000).toUTCString()}, not a Monday`)
  }
})

/* ⚠️ THE RULE IS IMPLEMENTED TWICE — once in JS for the weekly cutoff, once as
 * a SQL expression for the all-time buckets — and nothing else makes them agree.
 * These probes run the real `pacificOffsetSql` against this file's own sqlite
 * and compare it to the shipped `pacificWeekStart`, at both 2025/2026
 * transitions and either side of each. Verified to go red when the CAST is
 * dropped from the SQL (TEXT compares greater than any INTEGER, so every row
 * silently takes the PST branch for eight months of the year). */
check('⚠️ the SQL half and the JS half agree, DST transitions included', () => {
  const src = readFileSync(join(ROOT, 'functions/api/v1/members/hours.js'), 'utf8')
  const m = /function pacificOffsetSql\(ts\) \{[\s\S]*?\n\}/.exec(src)
  assert.ok(m, 'pacificOffsetSql not found — was it renamed?')
  const PST = -8 * 3600, PDT = -7 * 3600
  const body = m[0].replace(/^function pacificOffsetSql\(ts\) \{/, '').replace(/\}$/, '')
  const offSql = (t) => new Function('ts', 'PST', 'PDT', body)(t, PST, PDT)

  for (const iso of [
    '2025-03-09T09:59:00Z', '2025-03-09T10:01:00Z',   // spring forward
    '2025-11-02T08:59:00Z', '2025-11-02T09:01:00Z',   // fall back
    '2026-03-08T09:59:00Z', '2026-03-08T10:01:00Z',
    '2026-11-01T08:59:00Z', '2026-11-01T09:01:00Z',
    '2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z',   // deep winter, deep summer
  ]) {
    const ts = Math.floor(Date.parse(iso) / 1000)
    const wk = db.prepare(
      `SELECT (${ts} + ${offSql(String(ts))} - ${MONDAY_EPOCH}) / ${WEEK} AS wk`).get().wk
    const local = `(${wk} * ${WEEK} + ${MONDAY_EPOCH} - ${PST})`
    const ws = db.prepare(
      `SELECT (${wk} * ${WEEK} + ${MONDAY_EPOCH}) - ${offSql(local)} AS ws`).get().ws
    assert.equal(ws, pacificWeekStart(ts), `${iso}: SQL says ${ws}, JS says ${pacificWeekStart(ts)}`)
    assert.equal(new Date(ws * 1000).getUTCDay(), 1, `${iso}: not a Monday`)
  }
})
check('⚠️ weeks are split, not merged: Cara and Alice are separate rows', () => {
  const names = all.members.map((m) => m.name)
  assert.ok(names.includes('Cara') && names.includes('Alice'))
})
check('the bot is excluded here too', () => {
  assert.ok(!all.members.some((m) => m.name === 'chadf_boostbot'))
})

console.log('\nWeek boundaries:')
/* ⚠️ THE ARITHMETIC RULE, CHECKED AGAINST REAL TZDATA. The endpoint deliberately
 * does NOT use Intl — it would put an ICU dependency on the request path and
 * there is no ICU on the SQL side, so the two halves would come from different
 * sources. The test is where ICU belongs: Node has full tzdata, so this is the
 * one place the hand-rolled rule can be held against the real thing. It is what
 * would catch the US changing its DST dates. */
const PT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hour12: false, weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})
const inPT = (ts) => {
  const p = Object.fromEntries(PT.formatToParts(new Date(ts * 1000))
    .filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
  // hour12:false reports midnight as '24' in some ICU builds.
  return { dow: p.weekday, hms: `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}:${p.second}` }
}

check('⚠️ a week starts MONDAY 00:00 PACIFIC, not Monday 00:00 UTC', () => {
  // It was UTC until 2026-08-23, which put the reset at Sunday 5pm on the US
  // west coast — Reed watched This Week reset on a Sunday evening. Pacific is
  // the last US zone into Monday, so nobody's board resets on their Sunday.
  const { dow, hms } = inPT(thisMonday)
  assert.equal(dow, 'Mon', `week starts ${dow} Pacific`)
  assert.equal(hms, '00:00:00', `week starts ${hms} Pacific`)
  // And it is NOT the old boundary, which is what a silent revert would be.
  assert.notEqual(new Date(thisMonday * 1000).getUTCHours(), 0,
    'the week starts at 00:00 UTC — the Pacific offset was lost')
})

check('every week over the next four years starts Monday 00:00 Pacific', () => {
  // Hourly would be 35,000 sqlite-free probes and takes a moment; six-hourly
  // still crosses every transition in the window.
  for (let ts = Date.UTC(2025, 0, 1) / 1000; ts < Date.UTC(2029, 0, 1) / 1000; ts += 6 * HOUR) {
    const ws = mondayOf(ts)
    const { dow, hms } = inPT(ws)
    if (dow !== 'Mon' || hms !== '00:00:00') {
      assert.fail(`${new Date(ts * 1000).toISOString()} -> week start ${dow} ${hms} PT`)
    }
    assert.ok(ws <= ts && ts < ws + WEEK + HOUR, `${ts} falls outside the week it names`)
  }
})

check('a boost one second before Monday is the previous week', () => {
  const a = mondayOf(thisMonday - 1), b = mondayOf(thisMonday)
  // ⚠️ NOT `=== WEEK`. A Pacific week containing a DST transition is 167 or 169
  // hours of real time, so an exact-week assertion here is wrong twice a year.
  assert.ok(b > a, 'the second before Monday is not an earlier week')
  assert.ok(Math.abs(b - a - WEEK) <= HOUR, `weeks are ${b - a}s apart`)
})

console.log('\nThe week picker:')
/* ⚠️ WHAT IS BEING TESTED HERE IS THE CEILING, AND IT NEVER EXISTED BEFORE.
 * The weekly query had only a floor until 2026-08-24, because nothing has a
 * timestamp in the future and the live week needs no upper bound. A past week
 * needs both, and a missing ceiling is the failure that looks like nothing:
 * every week would return the whole board since that Monday, ranked
 * plausibly, under the requested Monday's heading. Alice is the probe — she
 * boosted THIS week, so she must be absent from last week's board. */
const lastMonday = prevWeek(thisMonday)
const lastWk = await call(`?range=week&week=${weekDateString(lastMonday)}`)
const lw = byName(lastWk)

check('⚠️ a past week excludes boosts made AFTER it', () => {
  assert.ok(!('Alice' in lw),
    `Alice boosted this week and appears on last week's board: ${JSON.stringify(Object.keys(lw))}`)
})
check('a past week includes the boosts made inside it', () => {
  assert.ok(lw.Cara, `Cara boosted last week and is missing: ${JSON.stringify(Object.keys(lw))}`)
  assert.equal(hours(lw.Cara), 2)
})
check('a past week excludes boosts made BEFORE it', () => {
  // Dave's other row is three weeks back.
  assert.ok(!('Dave' in lw), 'a boost from three weeks ago counted as last week')
})
check('the envelope resolves the week and says it is not the live one', () => {
  assert.equal(lastWk.week_start, lastMonday)
  assert.equal(lastWk.week_end, thisMonday, 'the exclusive ceiling is not the next Monday')
  assert.equal(lastWk.is_current, false)
  assert.equal(lastWk.current_week, thisMonday)
})
check('the live board still says it is the live one', () => {
  assert.equal(wk.is_current, true)
  assert.equal(wk.current_week, thisMonday)
  assert.equal(wk.week_end, nextWeek(thisMonday))
})
check('first_week is the week of the oldest boost, for the ◀ floor', () => {
  const oldest = db.prepare('SELECT MIN(created_at) AS t FROM boosts').get().t
  assert.equal(wk.first_week, pacificWeekStart(oldest))
})

/* ⚠️ A BAD OR FUTURE `week=` RESOLVES TO THE LIVE WEEK RATHER THAN 400ing, and
 * the envelope is what keeps that honest — the client renders `week_start` off
 * the response and never off what it asked for. These weeks travel in links, so
 * the caller is often a reader rather than code. */
for (const [name, qs] of [
  ['a future week', `?range=week&week=${weekDateString(nextWeek(nextWeek(thisMonday)))}`],
  ['a malformed week', '?range=week&week=next-tuesday'],
  ['an impossible date', '?range=week&week=2026-02-30'],
]) {
  const r = await call(qs)
  check(`${name} resolves to the live week and says so`, () => {
    assert.equal(r.week_start, thisMonday, `${name} resolved to ${r.week_start}`)
    assert.equal(r.is_current, true)
  })
}

check('a week before the index is empty, not an error', () => {
  // Not a clamp: an empty board is the true answer, and `first_week` is what
  // lets the picker stop offering these rather than a floor pretending they
  // are this week.
  return call('?range=week&week=2019-01-07').then((r) => {
    assert.equal(r.week_start, weekStartFromDate('2019-01-07'))
    assert.equal(r.count, 0)
  })
})

console.log('\nThe week rule, as the client walks it:')
/* ⚠️ THE PICKER STEPS AND ENUMERATES WEEKS IN THE BROWSER, so the rule moved
 * into a two-sided module and these guard the half the endpoint does not use.
 * Held against real tzdata, which is the whole reason this file exists. */
check('⚠️ a YYYY-MM-DD Monday is ITS OWN week, not the one before', () => {
  /* The trap: `Date.UTC(y,m,d)` is midnight UTC, which is 4pm or 5pm PACIFIC on
     the day BEFORE — so a Monday handed in naively resolves to the previous
     week, every time, while the board looks entirely correct. */
  for (let w = pacificWeekStart(Date.UTC(2024, 0, 15) / 1000);
       w < Date.UTC(2029, 0, 1) / 1000; w = nextWeek(w)) {
    assert.equal(weekStartFromDate(weekDateString(w)), w,
      `${weekDateString(w)} resolved to a different week`)
  }
})

check('⚠️ stepping is not ± 604800, and DST is why', () => {
  // A Pacific week containing a transition is 167 or 169 hours of real time, so
  // a flat week drifts an hour each March and November while still producing
  // Mondays — which is why every step goes through pacificWeekStart.
  let flat = 0
  for (let w = pacificWeekStart(Date.UTC(2024, 0, 15) / 1000);
       w < Date.UTC(2029, 0, 1) / 1000; w = nextWeek(w)) {
    assert.equal(prevWeek(nextWeek(w)), w, `stepping off ${weekDateString(w)} does not return`)
    const { dow, hms } = inPT(w)
    assert.equal(dow, 'Mon', `${weekDateString(w)} is a ${dow} Pacific`)
    assert.equal(hms, '00:00:00')
    if (nextWeek(w) - w !== WEEK) flat++
  }
  assert.ok(flat >= 8, `no DST week found in five years (${flat}); the rule is not being exercised`)
})

check('weekSeries runs newest first and stops at the first week', () => {
  const series = weekSeries(lastMonday - 5 * WEEK, thisMonday)
  assert.equal(series[0], thisMonday, 'the series does not open on the newest week')
  assert.deepEqual(series, [...series].sort((a, b) => b - a), 'the series is not newest-first')
  assert.equal(new Set(series).size, series.length, 'the series repeats a week')
  assert.ok(series.at(-1) <= lastMonday - 5 * WEEK + WEEK,
    'the series stops short of the week it was given')
})

console.log('\nLimits:')
{
  const one = await call('?range=all&limit=1')
  check('limit=1 returns one row', () => assert.equal(one.members.length, 1))
}
{
  const bad = await call('?range=nonsense')
  check('an unknown range falls back to the week rather than erroring', () => {
    assert.equal(bad.range, 'week')
  })
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\n${passed} checks passed`)
