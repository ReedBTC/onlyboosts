// Boosting the song that's playing (Part 4 of the time-splits work).
//
// The /episode Boost button reads where the player is at the press, asks
// /api/value for the <podcast:valueTimeSplit> window covering that second,
// and pays the song's value block at the window's percentage and the show's at
// the rest, in one press. This pins:
//
//   - the edge's window lookup: half-open, latest start wins, the spec's 100
//     default, 0 or out-of-range is no window, recipients-only windows ignored
//   - the combined split: each block keeps its proportions, the song gets pct
//     of the amount to the sat, no leg of either block is dropped
//   - the boostagram: ts and bLIP-10's remote_* fields, absent when no song
//   - the note: host pair first, song pair last, never a third item; the song
//     only when the caller says a song split landed; the oracle signs it and the
//     ingest files it under the song, as the collector files Boost Me Bitch's
//
//   node scripts/test-song-boost.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { timeSplitAt, readRssValue } from '../functions/api/value.js'
import { combineTimeSplit } from '../assets/js/value-block.js'
import { distributeSats } from '../login-widget/src/lib/externalBoost.js'
import { buildBoostagram, buildExternalNoteTemplate } from '../login-widget/src/lib/externalBoostagram.js'
import { validateBoostTemplate } from '../functions/api/sign-boost.js'
import { boostRowFromEvent } from '../functions/api/v1/boosts/ingest.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0, passed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name) }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message) }
}

const ITEM = `<item><title>Ep</title><guid>host-item</guid>
<podcast:value type="lightning" method="keysend">
  <podcast:valueRecipient name="Host" type="node" address="02aa" split="90"/>
  <podcast:valueRecipient name="Cohost" type="lnaddress" address="co@host.example" split="10"/>
  <podcast:valueTimeSplit startTime="30" duration="100">
    <podcast:remoteItem feedGuid="album-a" itemGuid="song-a" feedUrl="https://music.example/a.xml"/>
  </podcast:valueTimeSplit>
  <podcast:valueTimeSplit startTime="120" duration="60" remotePercentage="95">
    <podcast:remoteItem feedGuid="album-b" itemGuid="song-b"/>
  </podcast:valueTimeSplit>
  <podcast:valueTimeSplit startTime="300" duration="60" remotePercentage="50">
    <podcast:valueRecipient name="Guest" type="node" address="03bb" split="100"/>
  </podcast:valueTimeSplit>
  <podcast:valueTimeSplit startTime="400" duration="60" remotePercentage="0">
    <podcast:remoteItem feedGuid="album-z" itemGuid="song-z"/>
  </podcast:valueTimeSplit>
</podcast:value></item>`

console.log('\nThe window at the press (/api/value?at=):')
await check('a second inside a window names its song, with the feed\'s percentage', () => {
  const w = timeSplitAt(ITEM, 125)
  assert.deepEqual([w.feedGuid, w.itemGuid, w.pct], ['album-b', 'song-b', 95])
})
await check('no remotePercentage is the spec\'s 100', () => assert.equal(timeSplitAt(ITEM, 31).pct, 100))
await check('⚠️ a window is half-open, and an overlap goes to the latest start', () => {
  assert.equal(timeSplitAt(ITEM, 29.9), null)
  assert.equal(timeSplitAt(ITEM, 125).itemGuid, 'song-b')     // inside both 30+100 and 120+60
  assert.equal(timeSplitAt(ITEM, 180), null)
})
await check('⚠️ position zero is not playing, so it is no window', () => assert.equal(timeSplitAt(ITEM, 0), null))
await check('a window of recipients and no song is not a song to pay', () => assert.equal(timeSplitAt(ITEM, 310), null))
await check('a window at 0% sends the song nothing, so it is no window', () => assert.equal(timeSplitAt(ITEM, 410), null))
await check('the feed reader carries the window beside the item\'s own block', () => {
  const r = readRssValue(`<rss><channel><title>S</title>${ITEM}</channel></rss>`, 'host-item', false, 125)
  assert.equal(r.item.recipients.length, 2)
  assert.equal(r.timeSplit.itemGuid, 'song-b')
  assert.equal(readRssValue(`<rss><channel><title>S</title>${ITEM}</channel></rss>`, 'host-item').timeSplit, null)
})
await check('the endpoint only reads `at` as plain seconds', () => {
  const src = readFileSync(join(ROOT, 'functions/api/value.js'), 'utf8')
  assert.match(src, /\/\^\\d\{1,6\}\(\\\.\\d\{1,3\}\)\?\$\/\.test\(atRaw\)/)
})

console.log('\nThe combined split:')
const host = { recipients: [
  { name: 'Host', type: 'node', address: '02aa', splitWeight: 90 },
  { name: 'Cohost', type: 'lnaddress', address: 'co@host.example', splitWeight: 10 },
], totalWeight: 100 }
const song = { recipients: [
  { name: 'Artist', type: 'lnaddress', address: 'artist@x.example', splitWeight: 95 },
  { name: 'Producer', type: 'node', address: '03cc', splitWeight: 4 },
  { name: 'App', type: 'node', address: '03dd', splitWeight: 1 },
], totalWeight: 100 }
await check('⚠️ the song gets its percentage of the boost and the show the rest, to the sat', () => {
  const c = combineTimeSplit(host, song, 99)
  const legs = distributeSats(1000, c.recipients, c.totalWeight)
  const bySide = (g) => legs.filter((l) => l.recipient.group === g).reduce((a, l) => a + l.sats, 0)
  assert.equal(legs.reduce((a, l) => a + l.sats, 0), 1000)
  assert.equal(bySide('track'), 990)
  assert.equal(bySide('host'), 10)
})
await check('each block keeps its own proportions', () => {
  const c = combineTimeSplit(host, song, 50)
  const legs = distributeSats(10000, c.recipients, c.totalWeight)
  const s = Object.fromEntries(legs.map((l) => [l.recipient.name, l.sats]))
  assert.deepEqual([s.Artist, s.Producer, s.App, s.Host, s.Cohost], [4750, 200, 50, 4500, 500])
})
await check('⚠️ no leg of either block is dropped or rewritten; at 100% the show\'s legs pay nothing', () => {
  const c = combineTimeSplit(host, song, 100)
  assert.equal(c.recipients.length, 5)
  for (const r of [...host.recipients, ...song.recipients]) {
    assert.ok(c.recipients.some((x) => x.address === r.address && x.name === r.name && x.type === r.type))
  }
  const legs = distributeSats(777, c.recipients, c.totalWeight)
  assert.equal(legs.filter((l) => l.recipient.group === 'host').reduce((a, l) => a + l.sats, 0), 0)
})
await check('a missing block or an unusable percentage is no combined split', () => {
  assert.equal(combineTimeSplit(host, null, 90), null)
  assert.equal(combineTimeSplit(host, song, 0), null)
  assert.equal(combineTimeSplit(host, song, 101), null)
  assert.equal(combineTimeSplit(null, song, 90), null)
})

console.log('\nThe boostagram:')
await check('a boost during a song carries ts and the song\'s guids on every split', () => {
  const b = buildBoostagram({ legMsats: 1000, totalMsats: 100000, podcastGuid: 'host-feed', itemGuid: 'host-item',
    ts: 125.7, remoteFeedGuid: 'album-b', remoteItemGuid: 'song-b' })
  assert.deepEqual([b.ts, b.guid, b.episode_guid, b.remote_feed_guid, b.remote_item_guid],
    [125, 'host-feed', 'host-item', 'album-b', 'song-b'])
})
await check('without a song or a position it is the boostagram it always was', () => {
  const b = buildBoostagram({ legMsats: 1000, totalMsats: 1000, podcastGuid: 'f', itemGuid: 'i' })
  assert.equal(b.ts, 0)
  assert.ok(!('remote_feed_guid' in b) && !('remote_item_guid' in b))
})

console.log('\nThe note:')
const SONG = { feedGuid: 'album-b', itemGuid: 'song-b', title: 'Song B', artist: 'Artist B', pct: 95 }
const base = { paidSats: 1000, legsPaid: 4, legsTotal: 4, message: 'nice', showTitle: 'Show', episodeTitle: 'Ep',
  podcastGuid: 'host-feed', itemGuid: 'host-item', bmbUrl: 'https://onlyboosts.social/episode/host-item' }
const iTags = (t) => t.tags.filter((x) => x[0] === 'i').map((x) => x[1])
await check('⚠️ the host pair comes first and the song pair last, two items and no more', () => {
  const t = buildExternalNoteTemplate({ ...base, song: SONG })
  assert.deepEqual(iTags(t), ['podcast:guid:host-feed', 'podcast:item:guid:host-item', 'podcast:guid:album-b', 'podcast:item:guid:song-b'])
  assert.equal(iTags(t).filter((v) => v.startsWith('podcast:item:guid:')).length, 2)
})
await check('the note names the song in its text', () =>
  assert.match(buildExternalNoteTemplate({ ...base, song: SONG }).content, /\n🎵 Song B - Artist B\n/))
await check('⚠️ with no song (none playing, or its splits failed) the note is the show\'s alone', () => {
  const t = buildExternalNoteTemplate({ ...base, song: null })
  assert.deepEqual(iTags(t), ['podcast:guid:host-feed', 'podcast:item:guid:host-item'])
  assert.ok(!t.content.includes('🎵'))
})
await check('the amount is the whole boost, in millisats', () =>
  assert.deepEqual(buildExternalNoteTemplate({ ...base, song: SONG }).tags.filter((x) => x[0] === 'amount'), [['amount', '1000000']]))
await check('the oracle signs the song note', () => {
  const out = validateBoostTemplate(buildExternalNoteTemplate({ ...base, song: SONG }), { skewSecs: 600 })
  assert.equal(out.kind, 1)
})
await check('⚠️ the edge ingest files it under the song, as the collector files Boost Me Bitch\'s', () => {
  const t = buildExternalNoteTemplate({ ...base, song: SONG })
  const row = boostRowFromEvent({ ...t, id: 'e'.repeat(64), pubkey: 'a'.repeat(64) })
  assert.deepEqual([row.podcast_guid, row.item_guid, row.sats], ['album-b', 'song-b', 1000])
})

console.log('\nThe /episode button:')
await check('⚠️ the song is read once, at the press, and only once the episode is playing', () => {
  const src = readFileSync(join(ROOT, 'assets/js/episode-page.js'), 'utf8')
  const fn = src.slice(src.indexOf('async function resolveBoostAtPress'), src.indexOf('async function openBoost'))
  assert.match(fn, /st\?\.started && st\.itemGuid === EPISODE\.itemGuid/)
  assert.match(fn, /resolveValue\(EPISODE, EPISODE\.itemGuid, \{ at: ts \}\)/)
  // and the click handler calls it, not the bare episode resolve
  assert.match(src, /const \{ bundle, song, ts \} = await resolveBoostAtPress\(\)/)
})

console.log(failed ? `\n${passed} passed, ${failed} FAILED.` : `\n${passed} passed.`)
process.exit(failed ? 1 : 0)
