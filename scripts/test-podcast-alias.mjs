#!/usr/bin/env node
/**
 * A retired podcast guid redirects to the show it was merged into, on
 * /show/<guid> and on /api/v1/podcasts/<guid>, and only on a miss.
 *
 * ⚠️ WHY THIS FILE EXISTS. On 2026-11-27 Reed merged four shows' guids (three
 * moved feeds and declared new podcast:guids; Radio Detox folds the other way).
 * The old guid's `podcasts` row leaves D1 with the merge, so every /show/<old>
 * link already shared would 404 without the alias lookup. The failure is quiet
 * in both directions: lose the lookup and the old links 404 with a perfectly
 * good-looking "Show not found" page; put it ahead of the `podcasts` read and
 * every page view on the site pays a second query with nothing visibly wrong.
 * So this runs the SHIPPED handlers against a `node:sqlite` build of the real
 * schema.sql and counts what they ask.
 *
 * `podcast_aliases` is the collector's table (DDL rides with its push). It is
 * created here IF NOT EXISTS, so the test is right before and after the
 * collector's schema.sql gains it.
 *
 * Run: node scripts/test-podcast-alias.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as showPage from '../functions/show/[guid].js'
import * as podcastApi from '../functions/api/v1/podcasts/[guid].js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA = readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// Nothing here may reach Podcast Index or any other upstream; a hit's page
// render asks for the show's description, and a stub that answers nothing is
// the page's own no-description path.
globalThis.fetch = async () => new Response('', { status: 503 })

function makeDb({ aliases = true } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  if (aliases) {
    db.exec('CREATE TABLE IF NOT EXISTS podcast_aliases (from_guid TEXT PRIMARY KEY, to_guid TEXT NOT NULL)')
  }
  const show = (guid, title) =>
    db.prepare('INSERT INTO podcasts(podcast_guid,title,medium) VALUES(?,?,?)').run(guid, title, 'podcast')
  show('new-show', 'The New Feed')
  show('untitled', null)
  show('old-titleless', null)
  if (aliases) {
    const alias = (from, to) =>
      db.prepare('INSERT INTO podcast_aliases(from_guid,to_guid) VALUES(?,?)').run(from, to)
    alias('old-gone', 'new-show')            // the merge: old row gone, new row live
    alias('old-titleless', 'new-show')       // a titleless row still standing under the old guid
    alias('old gone/spaced', 'new-show')     // a from_guid that needs encoding in a path
    alias('to-untitled', 'untitled')         // target exists but has no page
    alias('to-missing', 'nowhere')           // target has no row at all
    alias('self', 'self')                    // a bad row that would loop
  }
  return db
}

function makeEnv(db) {
  const sql = []
  const env = {
    DB: {
      prepare: (q) => {
        sql.push(q)
        return {
          bind: (...a) => ({
            all: async () => ({ results: db.prepare(q).all(...a) }),
            first: async () => db.prepare(q).get(...a) ?? null,
            run: async () => db.prepare(q).run(...a),
          }),
        }
      },
    },
  }
  return { env, sql, aliasReads: () => sql.filter((q) => /podcast_aliases/.test(q)).length }
}

const ORIGIN = 'https://onlyboosts.social'
function ctx(env, path, guid, { method = 'GET', headers = {} } = {}) {
  return {
    request: new Request(ORIGIN + path, { method, headers }),
    env,
    params: { guid },
    waitUntil: () => {},
  }
}

// ── /show/<guid> ────────────────────────────────────────────────────────────

console.log('\n/show/<guid>')

await check('a retired guid answers 301 to the show it merged into', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/old-gone', 'old-gone'))
  assert.equal(r.status, 301)
  assert.equal(r.headers.get('Location'), '/show/new-show')
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=3600')
})

await check('the query string rides along', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/old-gone?ref=x', 'old-gone'))
  assert.equal(r.headers.get('Location'), '/show/new-show?ref=x')
})

await check('HEAD answers the same 301 (link checkers HEAD first)', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestHead(ctx(env, '/show/old-gone', 'old-gone', { method: 'HEAD' }))
  assert.equal(r.status, 301)
  assert.equal(r.headers.get('Location'), '/show/new-show')
})

await check('an encoded path guid is decoded before the lookup', async () => {
  const { env } = makeEnv(makeDb())
  const raw = encodeURIComponent('old gone/spaced')
  const r = await showPage.onRequestGet(ctx(env, '/show/' + raw, raw))
  assert.equal(r.status, 301)
  assert.equal(r.headers.get('Location'), '/show/new-show')
})

await check('a titleless row under an aliased guid redirects too (it has no page either)', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/old-titleless', 'old-titleless'))
  assert.equal(r.status, 301)
  assert.equal(r.headers.get('Location'), '/show/new-show')
})

await check('⚠️ an alias whose target has no title is a 404, never a hop to a second 404', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/to-untitled', 'to-untitled'))
  assert.equal(r.status, 404)
})

await check('an alias whose target has no row is a 404', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/to-missing', 'to-missing'))
  assert.equal(r.status, 404)
})

await check('⚠️ a self-alias is a 404, not a redirect loop', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/self', 'self'))
  assert.equal(r.status, 404)
})

await check('a guid with no row and no alias is the ordinary 404', async () => {
  const { env } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/never-seen', 'never-seen'))
  assert.equal(r.status, 404)
  assert.match(await r.text(), /Show not found/)
})

await check('before the collector creates the table, a miss is still a 404, not a 500', async () => {
  const { env } = makeEnv(makeDb({ aliases: false }))
  const r = await showPage.onRequestGet(ctx(env, '/show/old-gone', 'old-gone'))
  assert.equal(r.status, 404)
})

await check('⚠️ a show that exists renders and never reads podcast_aliases', async () => {
  const { env, aliasReads } = makeEnv(makeDb())
  const r = await showPage.onRequestGet(ctx(env, '/show/new-show', 'new-show'))
  assert.equal(r.status, 200)
  assert.match(await r.text(), /The New Feed/)
  assert.equal(aliasReads(), 0, 'a page view paid for the alias lookup')
})

// ── /api/v1/podcasts/<guid> ─────────────────────────────────────────────────

console.log('\n/api/v1/podcasts/<guid>')

await check('a retired guid answers 301 with its query string and CORS headers', async () => {
  const { env } = makeEnv(makeDb())
  const r = await podcastApi.onRequestGet(ctx(env, '/api/v1/podcasts/old-gone?corpus=1', 'old-gone', {
    headers: { Origin: ORIGIN },
  }))
  assert.equal(r.status, 301)
  assert.equal(r.headers.get('Location'), '/api/v1/podcasts/new-show?corpus=1')
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN)
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=3600')
})

await check('an alias whose target has a row (titled or not) redirects; the API has no title rule', async () => {
  const { env } = makeEnv(makeDb())
  const r = await podcastApi.onRequestGet(ctx(env, '/api/v1/podcasts/to-untitled', 'to-untitled'))
  assert.equal(r.status, 301)
  assert.equal(r.headers.get('Location'), '/api/v1/podcasts/untitled')
})

await check('no row, no alias, a dangling alias or a self-alias is the JSON 404', async () => {
  const { env } = makeEnv(makeDb())
  for (const g of ['never-seen', 'to-missing', 'self']) {
    const r = await podcastApi.onRequestGet(ctx(env, '/api/v1/podcasts/' + g, g))
    assert.equal(r.status, 404, g)
    assert.deepEqual(await r.json(), { error: 'podcast not found' })
  }
})

await check('before the collector creates the table, a miss is still the JSON 404', async () => {
  const { env } = makeEnv(makeDb({ aliases: false }))
  const r = await podcastApi.onRequestGet(ctx(env, '/api/v1/podcasts/old-gone', 'old-gone'))
  assert.equal(r.status, 404)
})

await check('⚠️ a show that exists answers 200 and never reads podcast_aliases', async () => {
  const { env, aliasReads } = makeEnv(makeDb())
  const r = await podcastApi.onRequestGet(ctx(env, '/api/v1/podcasts/new-show', 'new-show'))
  assert.equal(r.status, 200)
  assert.equal((await r.json()).show.title, 'The New Feed')
  assert.equal(aliasReads(), 0, 'an API hit paid for the alias lookup')
})

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
