// The songs an episode plays (/api/episode-songs, functions/_shared/
// time-splits.js) and the player's two lookups (assets/js/player.js).
//
//   - the parser reads every <podcast:valueTimeSplit> with a remoteItem, in
//     start order, the spec's 100% default included, and counts (never
//     returns) the windows that carry recipients and no song
//   - the endpoint names a song from the index first, Podcast Index second,
//     and still returns a song neither knows, untitled
//   - songAt is half-open and the latest start wins an overlap; chapterAt
//     takes the last chapter at or behind the playhead
//
//   node scripts/test-episode-songs.mjs
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findItem, readTimeSplits } from '../functions/_shared/time-splits.js'
import { onRequestGet, onRequestHead } from '../functions/api/episode-songs.js'
import { songAt, chapterAt, fmtTime, chaptersBesideSongs } from '../assets/js/player.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0, passed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name) }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message) }
}

const FEED = `<?xml version="1.0"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
<title>Host Show</title>
<podcast:value type="lightning" method="keysend"><podcast:valueRecipient name="Host" type="node" address="02ab" split="100"/></podcast:value>
<item><title>Other</title><guid isPermaLink="false">other-ep</guid></item>
<item>
  <title>Episode 7</title>
  <guid isPermaLink="false"><![CDATA[ep-7]]></guid>
  <podcast:value type="lightning" method="keysend">
    <podcast:valueRecipient name="Host" type="node" address="02ab" split="100"/>
    <podcast:valueTimeSplit startTime="600" duration="200" remotePercentage="95">
      <podcast:remoteItem feedGuid="album-b" itemGuid="song-b" medium="music"/>
    </podcast:valueTimeSplit>
    <podcast:valueTimeSplit startTime="30.5" duration="180">
      <podcast:remoteItem feedGuid="album-a" itemGuid="song-a" feedUrl="https://music.example/a.xml"/>
    </podcast:valueTimeSplit>
    <podcast:valueTimeSplit startTime="900" duration="60" remotePercentage="50">
      <podcast:valueRecipient name="Guest" type="node" address="03cd" split="100"/>
    </podcast:valueTimeSplit>
    <podcast:valueTimeSplit startTime="1000" duration="0" remotePercentage="90">
      <podcast:remoteItem feedGuid="album-z" itemGuid="song-z"/>
    </podcast:valueTimeSplit>
    <podcast:valueTimeSplit startTime="1200" duration="120" remotePercentage="99">
      <podcast:remoteItem feedGuid="album-c" itemGuid="song-c"/>
    </podcast:valueTimeSplit>
  </podcast:value>
</item>
</channel></rss>`

console.log('\nThe parser:')
{
  const item = findItem(FEED, 'ep-7')
  const { songs, inline } = readTimeSplits(item)
  await check('finds the item by its guid, CDATA and all', () => assert.ok(item && item.includes('Episode 7')))
  await check('reads the song windows in start order', () =>
    assert.deepEqual(songs.map((s) => s.itemGuid), ['song-a', 'song-b', 'song-c']))
  await check('a window with no remotePercentage gives the song 100', () => assert.equal(songs[0].pct, 100))
  await check('and the stated ones are kept as written', () => assert.deepEqual(songs.map((s) => s.pct), [100, 95, 99]))
  await check('fractional start times survive', () => assert.equal(songs[0].start, 30.5))
  await check('a window of no length is not a song', () => assert.ok(!songs.some((s) => s.itemGuid === 'song-z')))
  await check('⚠️ a window of recipients and no song is counted, never returned', () => assert.equal(inline, 1))
  await check('the feedUrl hint rides along only when it is http(s)', () => {
    assert.equal(songs[0].feedUrl, 'https://music.example/a.xml')
    assert.equal(songs[1].feedUrl, null)
  })
  await check('an item with no windows reads as none', () => assert.deepEqual(readTimeSplits(findItem(FEED, 'other-ep')).songs, []))
}

console.log('\nThe endpoint:')
{
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))
  db.prepare('INSERT INTO podcasts(podcast_guid,title,author,medium) VALUES(?,?,?,?)').run('album-a', 'Album A', 'Artist A', 'music')
  db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title) VALUES(?,?,?)').run('song-a', 'album-a', 'Song A')
  const stmt = (sql, args = null) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args || [])) }),
    first: async () => db.prepare(sql).get(...(args || [])) ?? null,
  })
  const env = { DB: { prepare: (sql) => stmt(sql) }, PODCAST_INDEX_KEY: 'k', PODCAST_INDEX_SECRET: 's' }
  const piAsked = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u === 'https://host.example/feed.xml') return new Response(FEED, { headers: { 'Content-Type': 'application/rss+xml' } })
    if (u.startsWith('https://api.podcastindex.org/')) {
      piAsked.push(u)
      if (u.includes('guid=song-b')) return Response.json({ episode: { title: 'Song B', feedTitle: 'Album B', image: 'https://img.example/b.jpg' } })
      return Response.json({ status: 'false', description: 'Episode not found' })
    }
    return new Response('no', { status: 404 })
  }
  const call = (qs) => onRequestGet({ request: new Request('https://onlyboosts.social/api/episode-songs?' + qs), env })
  const res = await call('guid=ep-7&feedUrl=' + encodeURIComponent('https://host.example/feed.xml'))
  const body = await res.json()
  const by = Object.fromEntries(body.songs.map((s) => [s.itemGuid, s]))
  await check('answers the three songs', () => assert.equal(body.songs.length, 3))
  await check('⚠️ the index names a song it knows, and says it has a page', () => {
    assert.deepEqual([by['song-a'].title, by['song-a'].album, by['song-a'].artist, by['song-a'].indexed], ['Song A', 'Album A', 'Artist A', true])
  })
  await check('Podcast Index names one the index does not, with no page', () => {
    assert.deepEqual([by['song-b'].title, by['song-b'].album, by['song-b'].indexed], ['Song B', 'Album B', false])
  })
  await check('a song nobody knows still comes back, untitled, with its window', () => {
    assert.equal(by['song-c'].title, null)
    assert.deepEqual([by['song-c'].start, by['song-c'].duration], [1200, 120])
  })
  await check('Podcast Index is asked only about the misses', () =>
    assert.ok(!piAsked.some((u) => u.includes('guid=song-a')) && piAsked.length === 2))
  await check('caches an hour when the feed answered', () => assert.match(res.headers.get('Cache-Control'), /max-age=3600/))
  await check('an unreadable feed answers 200 with nothing, cached briefly', async () => {
    const r = await call('guid=ep-7&feedUrl=' + encodeURIComponent('https://gone.example/feed.xml'))
    assert.equal(r.status, 200)
    assert.deepEqual((await r.json()).songs, [])
    assert.match(r.headers.get('Cache-Control'), /max-age=300\b/)
  })
  await check('missing parameters are a 400', async () => assert.equal((await call('guid=ep-7')).status, 400))
  await check('it answers HEAD', () => assert.equal(typeof onRequestHead, 'function'))
}

console.log('\nThe player’s lookups:')
{
  const songs = [{ start: 30, duration: 100, itemGuid: 'a' }, { start: 120, duration: 50, itemGuid: 'b' }]
  await check('a window is half-open: its end belongs to what follows', () => {
    assert.equal(songAt(songs, 30)?.itemGuid, 'a')
    assert.equal(songAt(songs, 170), null)
    assert.equal(songAt(songs, 29.9), null)
  })
  await check('an overlap goes to the song that began most recently', () => assert.equal(songAt(songs, 125)?.itemGuid, 'b'))
  const chs = [{ start: 0, title: 'Intro' }, { start: 60, title: 'Talk' }]
  await check('the chapter is the last one at or behind the playhead', () => {
    assert.equal(chapterAt(chs, 59)?.title, 'Intro')
    assert.equal(chapterAt(chs, 59.8)?.title, 'Talk')
  })
  await check('⚠️ a chapter starting with a song is that song named twice: the chapter goes', () => {
    const cs = [{ start: 0, title: 'Welcome' }, { start: 340, title: 'The Doerfels-Take Me Away' }, { start: 774, title: 'How the Charts Work' }]
    const ss = [{ start: 341.5, duration: 200, itemGuid: 'x' }]
    assert.deepEqual(chaptersBesideSongs(cs, ss).map((c) => c.title), ['Welcome', 'How the Charts Work'])
  })
  await check('a chapter further than the tolerance from every song stays', () =>
    assert.equal(chaptersBesideSongs([{ start: 300, title: 'Talk' }], [{ start: 303, duration: 10 }]).length, 1))
  await check('times read m:ss under an hour and h:mm:ss past it', () => {
    assert.equal(fmtTime(75), '1:15')
    assert.equal(fmtTime(3725), '1:02:05')
  })
}

console.log(failed ? `\n${passed} passed, ${failed} FAILED.` : `\n${passed} passed.`)
process.exit(failed ? 1 : 0)
