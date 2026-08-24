#!/usr/bin/env node
/**
 * The two community rollups, and the medium partition they were split on.
 *
 * ⚠️ WHY THIS FILE EXISTS. Until 2026-08-24 these two sections deliberately
 * CROSSED the medium partition: a podcast page's "Other Shows/Albums This
 * Community Boosts" listed albums, and an album page's listed podcasts, on the
 * argument that the crossover was the interesting half of the finding. Reed
 * reversed it. The heading now names one kind of thing, and the QUERY has to
 * agree — a heading that says "Other Albums" over a list containing podcasts is
 * a worse state than either version of the old behaviour, and neither half of
 * the change is visible from the other.
 *
 * ⚠️ AND THE FAILURE IS INVISIBLE IN A RENDER. Drop the WHERE clause and the
 * page still renders, still ranks, still links: it just quietly contradicts its
 * own heading. Invert it and the page renders a full list of exactly the wrong
 * medium, which reads as a working section right up until someone recognises a
 * title. So this runs the SHIPPED SQL against a fixture with a known answer.
 *
 * Two halves, reached two different ways:
 *
 *   /episode  fetchCommunityBoosts() is exported, so it is called directly.
 *   /show     its query is inline in the page Function and cannot be imported,
 *             so it is EXTRACTED from the source and executed — the same
 *             technique test-feed-hash.mjs uses on the inline feed controller,
 *             and for the same reason: a second copy of the SQL written into
 *             this file would pass forever while the shipped one rotted.
 *
 * Run: node scripts/test-community-medium.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchCommunityBoosts } from '../functions/api/v1/episodes/[guid].js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))

/* ⚠️ FOUR SHOWS, AND THE UNTAGGED ONE IS THE POINT. The partition is `music`
 * one way and EVERYTHING else the other — podcasts, video, and every feed whose
 * medium the collector could not determine. A NULL medium must land with the
 * podcasts, because filing an unidentified feed under Albums asserts something
 * we cannot support. `COALESCE(medium,'podcast')` is what does it, and a test
 * with only tagged rows would pass with the COALESCE removed. */
const show = (guid, title, medium) =>
  db.prepare('INSERT INTO podcasts(podcast_guid,title,medium) VALUES(?,?,?)').run(guid, title, medium)
show('subj-pod', 'The Subject Podcast', 'podcast')
show('subj-mus', 'The Subject Album', 'music')
show('other-pod', 'Another Podcast', 'podcast')
show('other-mus', 'Another Album', 'music')
show('untagged', 'Untagged Show', null)
show('a-video', 'A Video Show', 'video')

const ep = (guid, showGuid, title) =>
  db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title) VALUES(?,?,?)').run(guid, showGuid, title)
ep('e-subj-pod', 'subj-pod', 'Subject Episode')
ep('e-subj-mus', 'subj-mus', 'Subject Track')
ep('e-other-pod', 'other-pod', 'Another Episode')
ep('e-other-mus', 'other-mus', 'Another Track')
ep('e-untagged', 'untagged', 'Untagged Episode')
ep('e-video', 'a-video', 'A Video Episode')
/* ⚠️ AN EPISODE WHOSE SHOW IS UNKNOWN ENTIRELY. `p` is LEFT JOINed by
 * BOOST_SELECT, so this row's medium is NULL for want of a joined row rather
 * than for want of a tag — a different route to the same value, and COALESCE
 * has to file it the same way. */
ep('e-orphan', null, 'Orphan Episode')

let n = 0
const boost = (pk, showGuid, itemGuid) =>
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?)')
    .run('e' + String(n++).padStart(63, '0'), pk, 1_700_000_000 + n, 100, showGuid, itemGuid)

/* One member boosts the subject of BOTH pages and then one of everything, so a
 * single fixture answers both directions of the partition. */
const PK = 'a'.repeat(64)
boost(PK, 'subj-pod', 'e-subj-pod')
boost(PK, 'subj-mus', 'e-subj-mus')
boost(PK, 'other-pod', 'e-other-pod')
boost(PK, 'other-mus', 'e-other-mus')
boost(PK, 'untagged', 'e-untagged')
boost(PK, 'a-video', 'e-video')
boost(PK, null, 'e-orphan')

const env = {
  DB: {
    prepare: (sql) => ({
      bind: (...a) => ({
        all: async () => ({ results: db.prepare(sql).all(...a) }),
        first: async () => db.prepare(sql).get(...a) ?? null,
      }),
    }),
  },
}

// ── /episode: "Other Episodes / Other Songs This Community Boosts" ──────────

console.log('\nThe episode-level rollup (fetchCommunityBoosts, imported)')

await check('a PODCAST episode sees episodes, never songs', async () => {
  const { boosts } = await fetchCommunityBoosts(env, 'e-subj-pod', 'subj-pod', 'podcast')
  const titles = boosts.map((b) => b.episode.title).sort()
  assert.deepEqual(titles, ['A Video Episode', 'Another Episode', 'Orphan Episode', 'Untagged Episode'])
})

await check('a MUSIC episode sees songs, never episodes', async () => {
  const { boosts } = await fetchCommunityBoosts(env, 'e-subj-mus', 'subj-mus', 'music')
  assert.deepEqual(boosts.map((b) => b.episode.title), ['Another Track'])
})

await check('⚠️ an untagged show is NOT music, and neither is a video one', async () => {
  // The partition rule. Both land on the podcast side; if either drifted to the
  // music side, Albums would start claiming shows nobody has identified.
  const { boosts } = await fetchCommunityBoosts(env, 'e-subj-mus', 'subj-mus', 'music')
  const titles = boosts.map((b) => b.episode.title)
  assert.ok(!titles.includes('Untagged Episode'), 'an untagged show reached the music side')
  assert.ok(!titles.includes('A Video Episode'), 'a video show reached the music side')
})

await check('⚠️ a boost naming no show at all counts as not-music', async () => {
  // It has no joined `podcasts` row, so its medium is NULL by a different route
  // than an untagged show's. COALESCE must treat the two the same.
  const pod = await fetchCommunityBoosts(env, 'e-subj-pod', 'subj-pod', 'podcast')
  const mus = await fetchCommunityBoosts(env, 'e-subj-mus', 'subj-mus', 'music')
  assert.ok(pod.boosts.some((b) => b.episode.title === 'Orphan Episode'))
  assert.ok(!mus.boosts.some((b) => b.episode.title === 'Orphan Episode'))
})

await check('⚠️ a caller that passes no medium gets the podcast half, not everything', async () => {
  // The safe direction of that mistake: a missing argument narrows the section
  // rather than silently restoring the unsplit behaviour the split replaced.
  const { boosts } = await fetchCommunityBoosts(env, 'e-subj-pod', 'subj-pod', undefined)
  assert.ok(!boosts.some((b) => b.episode.title === 'Another Track'))
})

await check('the subject episode and its whole show are still excluded', async () => {
  const { boosts } = await fetchCommunityBoosts(env, 'e-subj-pod', 'subj-pod', 'podcast')
  assert.ok(!boosts.some((b) => b.episode.title === 'Subject Episode'))
})

// ── /show: "Other Shows / Other Albums This Community Boosts" ───────────────
//
// ⚠️ EXTRACTED FROM THE SOURCE AND EXECUTED. The query is inline in the page
// Function, so a copy written here would drift silently. Anchored on the CTE it
// opens with; the one interpolation in it is the medium comparator, which is
// exactly what this file is here to pin, so it is substituted rather than
// evaluated.

console.log('\nThe show-level rollup (SQL extracted from functions/show/[guid].js)')

const pageSrc = readFileSync(join(ROOT, 'functions/show/[guid].js'), 'utf8')
const m = pageSrc.match(/`(WITH community AS \([\s\S]*?LIMIT \?)`/)
assert.ok(m, 'could not find the community query in functions/show/[guid].js — has it been renamed?')
const rawSql = m[1]

await check('the extracted query still carries a medium clause at all', () => {
  assert.match(rawSql, /COALESCE\(p\.medium, 'podcast'\) \$\{isMusic \? "=" : "<>"\} 'music'/,
    'the medium filter is gone, or its polarity is no longer driven by isMusic')
})

const runShow = (guid, isMusic) => {
  const sql = rawSql.replace(/\$\{isMusic \? "=" : "<>"\}/, isMusic ? '=' : '<>')
  assert.ok(!sql.includes('${'), 'an unsubstituted interpolation reached sqlite')
  return db.prepare(sql).all(guid, guid, 150).map((r) => r.title)
}

await check('a PODCAST show sees shows, never albums', () => {
  assert.deepEqual(runShow('subj-pod', false).sort(),
    ['A Video Show', 'Another Podcast', 'Untagged Show'])
})

await check('an ALBUM sees albums, never shows', () => {
  assert.deepEqual(runShow('subj-mus', true), ['Another Album'])
})

await check('⚠️ the two halves are a PARTITION, not two narrowings', () => {
  // Every other show the community boosted lands in exactly one of the two
  // lists. A row in neither is a show the site can no longer reach from here;
  // a row in both is the crossover the split was made to remove.
  const pod = new Set(runShow('subj-pod', false))
  const mus = new Set(runShow('subj-mus', true))
  const all = db.prepare(
    `SELECT DISTINCT p.title FROM boosts b JOIN podcasts p ON p.podcast_guid = b.podcast_guid
      WHERE b.podcast_guid NOT IN ('subj-pod','subj-mus')`).all().map((r) => r.title)
  for (const t of all) {
    const inPod = pod.has(t), inMus = mus.has(t)
    assert.ok(inPod || inMus, `${t} is in neither list`)
    assert.ok(!(inPod && inMus), `${t} is in both lists`)
  }
})

await check('the subject show is still excluded from its own rollup', () => {
  assert.ok(!runShow('subj-pod', false).includes('The Subject Podcast'))
})

console.log(`\n${passed} checks passed.`)
