#!/usr/bin/env node
// The Favorites section on /booster: the SHIPPED `/api/v1/favorites/resolve`
// handler over a node:sqlite build of the real schema.sql with `fetch`
// stubbed (so it never asks Podcast Index), and the shipped section module's
// pure parts — the resolve request, the grouping into Shows / Episodes /
// Albums / Songs / Artists on the RESOLVED medium, and the row markup.
//
// node scripts/test-favorites-section.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const check = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`) }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${String(e.stack ?? e.message).split('\n').slice(0, 2).join(' / ')}`) }
}

// ---- the database: the real schema, a few rows
const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))
db.prepare('INSERT INTO podcasts(podcast_guid,title,image,artwork,medium,author) VALUES(?,?,?,?,?,?)')
  .run('show-1', 'A Podcast', 'https://x/a.jpg', 'https://x/a2.jpg', 'podcast', 'Host')
db.prepare('INSERT INTO podcasts(podcast_guid,title,image,medium,author) VALUES(?,?,?,?,?)')
  .run('album-1', 'An Album', 'https://x/b.jpg', 'music', 'Artist')
db.prepare('INSERT INTO podcasts(podcast_guid,title,medium) VALUES(?,?,?)')
  .run('untitled-1', null, null)
db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title,image) VALUES(?,?,?,?)')
  .run('ep-1', 'show-1', 'Episode One', 'https://x/e.jpg')
db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title) VALUES(?,?,?)')
  .run('ep-2', 'show-OTHER', 'Someone else\'s episode')
db.prepare('INSERT INTO publishers(publisher_guid,title,image) VALUES(?,?,?)')
  .run('pub-1', 'The Artist', 'https://x/p.jpg')

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
  PODCAST_INDEX_KEY: 'k',
  PODCAST_INDEX_SECRET: 's',
}

// ---- fetch stubbed: Podcast Index answers for two guids and 404s the rest
const piCalls = []
globalThis.fetch = async (url) => {
  const u = String(url)
  piCalls.push(u)
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (u.includes('/podcasts/byguid?guid=pi-show')) return ok({ feed: { title: 'PI Show', image: 'https://pi/i.jpg', artwork: 'https://pi/a.jpg', medium: 'music', author: 'PI Artist' } })
  if (u.includes('/episodes/byguid?guid=pi-ep&podcastguid=pi-show')) return ok({ episode: { title: 'PI Episode', image: 'https://pi/e.jpg' } })
  if (u.includes('/podcasts/byguid?guid=dead')) return ok({ status: 'false', feed: [] })
  return new Response('nope', { status: 404 })
}

const { onRequestPost, onRequestOptions, PI_MAX, MAX_FEEDS } = await import(pathToFileURL(join(ROOT, 'functions/api/v1/favorites/resolve.js')).href)
const post = async (body, e = env) => {
  const req = new Request('https://ob.invalid/api/v1/favorites/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://onlyboosts.social' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await onRequestPost({ request: req, env: e })
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text(), headers: res.headers }
}

await check('indexed feed, item pair and publisher resolve from D1 with pages here', async () => {
  piCalls.length = 0
  const { status, body } = await post({ feeds: ['show-1', 'album-1'], items: [['show-1', 'ep-1']], publishers: ['pub-1'] })
  assert.equal(status, 200)
  assert.deepEqual(body.feeds['show-1'], { title: 'A Podcast', image: 'https://x/a.jpg', artwork: 'https://x/a2.jpg', medium: 'podcast', author: 'Host', href: '/show/show-1', indexed: true })
  assert.equal(body.feeds['album-1'].medium, 'music')
  assert.deepEqual(body.items['show-1|ep-1'], { title: 'Episode One', image: 'https://x/e.jpg', href: '/episode/ep-1', indexed: true })
  assert.deepEqual(body.publishers['pub-1'], { title: 'The Artist', image: 'https://x/p.jpg', artwork: null, medium: 'publisher', href: '/artist/pub-1', indexed: true })
  assert.equal(piCalls.length, 0, 'nothing asked of Podcast Index')
})

await check('an item is the PAIR: the same item guid under another feed is not this favorite', async () => {
  const { body } = await post({ items: [['show-1', 'ep-2']] })
  assert.equal(body.items['show-1|ep-2'], undefined)
})

await check('an untitled indexed show links to BMB, not to a page here', async () => {
  const { body } = await post({ feeds: ['untitled-1'] })
  assert.equal(body.feeds['untitled-1'].href, 'https://boostmebitch.com/?podcast=untitled-1')
  assert.equal(body.feeds['untitled-1'].indexed, true)
})

await check('an unknown feed and item pair go to Podcast Index, bounded, and link to BMB', async () => {
  piCalls.length = 0
  const { body } = await post({ feeds: ['pi-show', 'dead', 'nobody'], items: [['pi-show', 'pi-ep']] })
  assert.deepEqual(body.feeds['pi-show'], { title: 'PI Show', image: 'https://pi/i.jpg', artwork: 'https://pi/a.jpg', medium: 'music', author: 'PI Artist', href: 'https://boostmebitch.com/?podcast=pi-show', indexed: false })
  assert.equal(body.feeds['dead'], undefined, 'a PI miss is simply absent')
  assert.equal(body.feeds['nobody'], undefined)
  assert.deepEqual(body.items['pi-show|pi-ep'], { title: 'PI Episode', image: 'https://pi/e.jpg', href: 'https://boostmebitch.com/?podcast=pi-show&episode=pi-ep', indexed: false })
  assert.equal(piCalls.length, 4, 'three feed lookups and one episode lookup')
})

await check(`Podcast Index is asked at most ${PI_MAX} times per request`, async () => {
  piCalls.length = 0
  const feeds = Array.from({ length: 30 }, (_, i) => `unknown-${i}`)
  await post({ feeds })
  assert.equal(piCalls.length, PI_MAX)
})

await check('without PI credentials the index still answers and PI is never asked', async () => {
  piCalls.length = 0
  const { status, body } = await post({ feeds: ['show-1', 'pi-show'] }, { DB: env.DB })
  assert.equal(status, 200)
  assert.equal(body.feeds['show-1'].title, 'A Podcast')
  assert.equal(body.feeds['pi-show'], undefined)
  assert.equal(piCalls.length, 0)
})

await check('input hygiene: junk guids dropped, duplicates folded, caps applied, bad bodies 400, no DB 503', async () => {
  const { body } = await post({ feeds: ['show-1', 'show-1', 'has "quote"', 42, ''], items: [['show-1'], 'x', ['show-1', 'ep-1'], ['show-1', 'ep-1']] })
  assert.deepEqual(Object.keys(body.feeds), ['show-1'])
  assert.deepEqual(Object.keys(body.items), ['show-1|ep-1'])
  const many = await post({ feeds: Array.from({ length: MAX_FEEDS + 50 }, (_, i) => `f${i}`) }, { DB: env.DB })
  assert.equal(many.status, 200)
  assert.equal((await post('{not json')).status, 400)
  assert.equal((await post([])).status, 200, 'an array body is an empty request, not an error')
  assert.equal((await post({ feeds: ['show-1'] }, {})).status, 503)
  const opt = await onRequestOptions({ request: new Request('https://ob.invalid/x', { method: 'OPTIONS', headers: { Origin: 'https://onlyboosts.social' } }) })
  assert.ok(opt.status < 300)
})

await check('the answer is cacheable for five minutes and carries the exact-match origin', async () => {
  const { headers } = await post({ feeds: ['show-1'] })
  assert.equal(headers.get('Cache-Control'), 'public, max-age=300')
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://onlyboosts.social')
})

// ---- the section's pure parts
globalThis.location = { origin: 'https://onlyboosts.social' }
const src = readFileSync(join(ROOT, 'assets/js/favorites-section.js'), 'utf8')
  .replace(/from '\/assets\/js\/favorites-sync\.js[^']*'/, "from 'data:text/javascript,export const fetchFavorites=null;export const widgetDeps=null'")
  .replace(/from '\/assets\/js\/follow-set\.js[^']*'/, "from 'data:text/javascript,export const getSessionPubkey=()=>null'")
  .replace(/from '\/assets\/js\/favorite-button\.js[^']*'/, `from '${pathToFileURL(join(ROOT, 'assets/js/favorite-button.js')).href}'`)
  .replace(/from '\/assets\/js\/nostr-text\.js[^']*'/, `from '${pathToFileURL(join(ROOT, 'assets/js/nostr-text.js')).href}'`)
  .replace(/from '\/assets\/js\/feed-controls\.js[^']*'/, "from 'data:text/javascript,export const sortControl=()=>null'")
const S = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'))

const entries = [
  { kind: 'podcast:guid', id: 'podcast:guid:show-1', medium: 'podcast', feed: null, half: 'public' },
  { kind: 'podcast:guid', id: 'podcast:guid:album-1', medium: null, feed: null, half: 'public' },
  { kind: 'podcast:guid', id: 'podcast:guid:hinted-music', medium: 'music', feed: null, half: 'public' },
  { kind: 'podcast:guid', id: 'podcast:guid:unknown-x', medium: null, feed: null, half: 'private' },
  { kind: 'podcast:item:guid', id: 'podcast:item:guid:ep-1', medium: 'podcast', feed: 'show-1', half: 'public' },
  { kind: 'podcast:item:guid', id: 'podcast:item:guid:track-9', medium: 'podcast', feed: 'album-1', half: 'public' },
  { kind: 'podcast:item:guid', id: 'podcast:item:guid:orphan', medium: null, feed: null, half: 'public' },
  { kind: 'podcast:publisher:guid', id: 'podcast:publisher:guid:pub-1', medium: 'music', feed: null, half: 'public' },
]
const resolved = {
  feeds: {
    'show-1': { title: 'A Podcast', image: 'https://x/a.jpg', artwork: null, medium: 'podcast', author: 'Host', href: '/show/show-1', indexed: true },
    'album-1': { title: 'An Album', image: 'https://x/b.jpg', artwork: null, medium: 'music', author: 'Artist', href: '/show/album-1', indexed: true },
  },
  items: { 'show-1|ep-1': { title: 'Episode One', image: 'https://x/e.jpg', href: '/episode/ep-1', indexed: true } },
  publishers: { 'pub-1': { title: 'The Artist', image: null, artwork: null, medium: 'publisher', href: '/artist/pub-1', indexed: true } },
}

await check('resolveRequest asks for every feed (items\' feeds included), every pair, every publisher, once each', () => {
  const r = S.resolveRequest(entries)
  assert.deepEqual(r.feeds.sort(), ['album-1', 'hinted-music', 'show-1', 'unknown-x'].sort())
  assert.deepEqual(r.items, [['show-1', 'ep-1'], ['album-1', 'track-9']])
  assert.deepEqual(r.publishers, ['pub-1'])
})

await check('grouping: the resolved medium wins, the hint fills in, unknown files on the podcast side', () => {
  const groups = S.groupEntries(entries, resolved)
  const by = Object.fromEntries(groups.map((g) => [g.key, g.rows.map((r) => r.key)]))
  assert.deepEqual(by.shows, ['podcast:guid:show-1', 'podcast:guid:unknown-x'], 'unknown medium → Shows, the Shows feed\'s rule')
  assert.deepEqual(by.albums, ['podcast:guid:album-1', 'podcast:guid:hinted-music'], 'resolved music, and hinted music with no lookup')
  assert.deepEqual(by.episodes, ['podcast:item:guid:ep-1 @ show-1', 'podcast:item:guid:orphan'])
  assert.deepEqual(by.songs, ['podcast:item:guid:track-9 @ album-1'], 'the LOOKUP (album-1 is music) beats the hint (podcast)')
  assert.deepEqual(by.artists, ['podcast:publisher:guid:pub-1'])
  assert.deepEqual(groups.map((g) => g.key), ['shows', 'episodes', 'albums', 'songs', 'artists'], 'GROUPS order, empty groups omitted')
  assert.deepEqual(S.groupEntries([], resolved), [])
})

await check('rows: page links here, BMB links out, a nameless entry shows its guid and is never dropped', () => {
  const groups = S.groupEntries(entries, resolved)
  const shows = groups.find((g) => g.key === 'shows')
  const known = S.rowHtml(shows.rows[0], shows)
  assert.match(known, /<a class="cs-link" href="\/show\/show-1">/)
  assert.match(known, /<span class="cs-title">A Podcast<\/span><span class="cs-meta">Host<\/span>/)
  assert.doesNotMatch(known, /data-fav=/, 'a visitor sees no heart')
  const unknown = S.rowHtml(shows.rows[1], shows)
  assert.match(unknown, /class="cs-link cs-link--external" href="https:\/\/boostmebitch.com\/\?podcast=unknown-x" target="_blank" rel="noopener noreferrer"/)
  assert.match(unknown, /<span class="fav-guid">unknown-x<\/span>/)
  assert.match(unknown, /Not in the index yet/)
  const owned = S.rowHtml(shows.rows[0], shows, { owner: true })
  assert.match(owned, /<button type="button" class="ob-fav-pill" hidden data-fav="show" data-fav-id="podcast:guid:show-1" data-fav-medium="podcast"/, 'the owner\'s row carries the heart, a sibling of the link')
  assert.match(owned, /<\/a><button/, 'never inside the anchor')
  const episodes = groups.find((g) => g.key === 'episodes')
  const ep = S.rowHtml(episodes.rows[0], episodes, { owner: true })
  assert.match(ep, /href="\/episode\/ep-1"/)
  assert.match(ep, /<span class="cs-meta">A Podcast<\/span>/, 'an item row names its show')
  assert.match(ep, /data-fav="episode" data-fav-id="podcast:guid:show-1" data-fav-item="podcast:item:guid:ep-1"/)
  const orphan = S.rowHtml(episodes.rows[1], episodes)
  assert.match(orphan, /<span class="cs-link">/, 'no feed, no link, still a row')
  const xss = S.rowHtml({ ...shows.rows[0], title: '<b>x</b>', href: 'javascript:alert(1)' }, shows)
  assert.match(xss, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.doesNotMatch(xss, /javascript:/)
})

await check('the dropdown: All by default, then the five groups in Reed\'s order; a pick filters, an unknown key shows everything', () => {
  assert.deepEqual(S.GROUP_OPTIONS.map(([k]) => k), ['all', 'shows', 'episodes', 'artists', 'albums', 'songs'])
  assert.deepEqual(S.GROUP_OPTIONS.map(([, l]) => l), ['All', 'Shows', 'Episodes', 'Artists', 'Albums', 'Songs'])
  const groups = S.groupEntries(entries, resolved)
  assert.equal(S.visibleGroups(groups, 'all').length, groups.length)
  assert.deepEqual(S.visibleGroups(groups, 'songs').map((g) => g.key), ['songs'])
  assert.deepEqual(S.visibleGroups(groups, 'playlists').map((g) => g.key), groups.map((g) => g.key))
  const src = readFileSync(join(ROOT, 'assets/js/favorites-section.js'), 'utf8')
  assert.match(src, /sortControl\(GROUP_OPTIONS, filter/, 'built on the sort pill\'s chrome')
  assert.match(readFileSync(join(ROOT, 'functions/booster/[npub].js'), 'utf8'), /<div class="cs-controls" data-fav-controls hidden><\/div>/, 'the shell carries the controls band')
})

await check('the booster page ships the hidden shell with the frozen id, and imports the module', () => {
  const fn = readFileSync(join(ROOT, 'functions/booster/[npub].js'), 'utf8')
  assert.match(fn, /<section class="show-section show-section--bare" id="favorites" hidden data-booster-favorites>/)
  assert.match(fn, /\$\{renderFavorites\(\)\}/)
  const page = readFileSync(join(ROOT, 'assets/js/booster-page.js'), 'utf8')
  assert.match(page, /import \{ initFavoritesSection \} from '\/assets\/js\/favorites-section\.js\?v=ob-v\d+'/)
  assert.match(page, /initFavoritesSection\(\{ pubkey: PK, root: document\.querySelector\('\[data-booster-favorites\]'\) \}\)/)
})

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
