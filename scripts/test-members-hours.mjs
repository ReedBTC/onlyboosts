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
import { onRequestGet } from '../functions/api/v1/members/hours.js'

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
// The Monday of the week `ts` falls in.
const mondayOf = (ts) => Math.floor((ts - MONDAY_EPOCH) / WEEK) * WEEK + MONDAY_EPOCH
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

const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: db.prepare(sql).all(...a) }) }) }) } }
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
    assert.equal((m.week_start - MONDAY_EPOCH) % WEEK, 0,
      `${m.name}'s week starts at ${new Date(m.week_start * 1000).toUTCString()}, not a Monday`)
    assert.equal(new Date(m.week_start * 1000).getUTCDay(), 1, 'not a Monday')
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
check('⚠️ a week starts MONDAY 00:00 UTC, not on the epoch\'s Thursday', () => {
  // ts/604800 without the 345600 shift buckets Thursday-to-Wednesday, which
  // still yields weeks and is wrong by three days on every row.
  assert.equal(new Date(thisMonday * 1000).getUTCDay(), 1)
  assert.equal(new Date(thisMonday * 1000).getUTCHours(), 0)
})
check('a boost one second before Monday is the previous week', () => {
  const a = mondayOf(thisMonday - 1), b = mondayOf(thisMonday)
  assert.equal(b - a, WEEK)
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
