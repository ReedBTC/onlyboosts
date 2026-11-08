#!/usr/bin/env node
// OPML import and export (2026-11-07): the SHIPPED rules module (the reader,
// what may leave the device, the three-state sort, the writer), the shipped
// POST /api/v1/feeds/resolve over a node:sqlite build of the real schema with
// `fetch` stubbed (D1 by feed URL on its spellings, Podcast Index for the
// rest, a private address never bound or sent, absent ≠ not found), the
// shipped POST /api/v1/opml/link (refusals, 422 on a non-OPML body, the byte
// caps, no-store), and by text scan the wiring: the writer's batch, the
// controller's local list and three doors, the homepage's imported-list path.
//
// node scripts/test-opml.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let failures = 0
const check = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`) }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${String(e.stack ?? e.message).split('\n').slice(0, 3).join(' / ')}`) }
}

const opml = await import(pathToFileURL(join(ROOT, 'assets/js/opml.js')).href)

/* ── The rules ─────────────────────────────────────────────────────────── */

await check('opml.js imports nothing and is served to both sides', () => {
  const src = read('assets/js/opml.js')
  assert.ok(!/^import /m.test(src), 'no imports')
  assert.ok(!src.includes('Date.now('), 'no clock')
  assert.ok(opml.OPML_FILE_ACCEPT.includes('application/octet-stream') && opml.OPML_FILE_ACCEPT.includes('.opml'))
  assert.ok(read('functions/api/v1/opml/link.js').includes('from "../../../../assets/js/opml.js"'))
  assert.ok(read('functions/api/v1/feeds/resolve.js').includes('from "../../../../assets/js/opml.js"'))
})

await check('parseOpml: entities, nesting, single quotes, a > inside a title, folders skipped, not-OPML null', () => {
  const o = opml.parseOpml(`<?xml version="1.0"?><!-- <outline xmlUrl="https://commented.out/"/> -->
    <opml version="2.0"><head><title>x</title></head><body>
      <outline text="Folder &amp; Co">
        <outline type="rss" text="Show &gt; One" title="ignored" xmlUrl="https://a.com/f?x=1&amp;y=2" />
        <outline type='rss' text='Two' xmlUrl='http://b.com/feed'/>
      </outline>
      <outline type="rss" title="Three > still three" xmlUrl="https://c.com/&#x66;eed" htmlUrl="https://c.com"></outline>
      <outline text="no address"/>
    </body></opml>`)
  assert.deepEqual(o, [
    { xmlUrl: 'https://a.com/f?x=1&y=2', title: 'Show > One' },
    { xmlUrl: 'http://b.com/feed', title: 'Two' },
    { xmlUrl: 'https://c.com/feed', title: 'Three > still three' },
  ])
  assert.equal(opml.parseOpml('<html><body>Sign in</body></html>'), null, 'a web page is not OPML')
  assert.equal(opml.parseOpml('{"feeds":[]}'), null)
  assert.deepEqual(opml.parseOpml('<opml version="1.0"><body></body></opml>'), [], 'an empty OPML is an empty list, not "not OPML"')
  assert.equal(opml.parseOpml(null), null)
})

await check('planOpmlImport: a private address never leaves (hosts, auth/key/token, userinfo, /private/), repeats and non-web skipped, the cap counted', () => {
  const plan = opml.planOpmlImport([
    { xmlUrl: 'https://a.com/feed', title: 'A' },
    { xmlUrl: 'https://www.patreon.com/rss/x?auth=abc', title: 'Paid' },
    { xmlUrl: 'https://feeds.supercast.com/abc123', title: 'Paid 2' },
    { xmlUrl: 'https://x.com/feed?token=1', title: 'Token' },
    { xmlUrl: 'https://x.com/feed?api_key=1', title: 'Key' },
    { xmlUrl: 'https://user:pw@x.com/feed', title: 'Userinfo' },
    { xmlUrl: 'https://x.com/private/feed', title: 'Path' },
    { xmlUrl: 'https://x.com/feed?author=bob&monkey=1', title: 'Not private' },
    { xmlUrl: 'https://a.com/feed', title: 'A again' },
    { xmlUrl: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', title: 'oops' },
    { xmlUrl: 'ftp://a.com/feed', title: 'ftp' },
    { xmlUrl: '  https://b.com/feed  ', title: 'B' },
  ])
  assert.deepEqual(plan.feeds.map((f) => f.url), ['https://a.com/feed', 'https://x.com/feed?author=bob&monkey=1', 'https://b.com/feed'])
  assert.deepEqual(plan.skipped.map((s) => s.reason), ['private', 'private', 'private', 'private', 'private', 'private', 'repeat', 'not-web', 'not-web'])
  assert.equal(plan.overCap, 0)
  const many = Array.from({ length: opml.OPML_MAX_FEEDS + 3 }, (_, i) => ({ xmlUrl: `https://h.com/${i}`, title: String(i) }))
  const big = opml.planOpmlImport(many)
  assert.equal(big.feeds.length, opml.OPML_MAX_FEEDS)
  assert.equal(big.overCap, 3)
  assert.ok(opml.looksPrivate('https://x.com/feed?sig=1') && opml.looksPrivate('https://x.com/feed?SESSIONID=1') && !opml.looksPrivate('https://x.com/feed?keyword=1'))
})

await check('opmlLinkVerdict refuses a non-web paste (a secret key is not a hostname) and a link carrying a key', () => {
  assert.deepEqual(opml.opmlLinkVerdict('nsec1abc'), { refused: 'not-web' })
  assert.deepEqual(opml.opmlLinkVerdict('example.com/x.opml'), { refused: 'not-web' }, 'no https:// is guessed')
  assert.deepEqual(opml.opmlLinkVerdict('https://share.app/list?token=abc'), { refused: 'private' })
  assert.deepEqual(opml.opmlLinkVerdict(' https://share.app/me/subs.opml '), { url: 'https://share.app/me/subs.opml' })
  assert.equal(opml.opmlLinkName('https://share.app/me/subs.opml'), 'subs.opml')
  assert.equal(opml.opmlLinkName('https://share.app/'), 'share.app')
})

await check('sortOpmlAnswers: three states, one entry per guid, the followed left alone, absent is NEVER not found', () => {
  const feeds = [{ url: 'u1', title: 'One' }, { url: 'u2', title: 'Two' }, { url: 'u3', title: 'Three' }, { url: 'u4', title: 'Four' }, { url: 'u5', title: 'Five' }, { url: 'u6', title: 'Six' }]
  const answers = {
    u1: { guid: 'g1', title: 'One' },
    u2: { guid: 'g1', title: 'One, other address' },
    u3: null,
    u4: { guid: null, title: 'No guid' },
    u5: { guid: 'g-followed', title: 'Already' },
    // u6 absent
  }
  const s = opml.sortOpmlAnswers(feeds, answers, (g) => g === 'g-followed')
  assert.deepEqual(s.add.map((a) => a.feed.url), ['u1'])
  assert.deepEqual(s.already.map((f) => f.url), ['u2', 'u5'])
  assert.deepEqual(s.notFound.map((f) => f.url), ['u3'])
  assert.deepEqual(s.noGuid.map((f) => f.url), ['u4'])
  assert.deepEqual(s.unasked.map((f) => f.url), ['u6'])
})

await check('buildOpml round-trips through parseOpml with & and quotes escaped, duplicates and bad addresses dropped', () => {
  const created = new Date(Date.UTC(2026, 10, 7, 12, 0, 0))
  const { xml, written } = opml.buildOpml([
    { url: 'https://a.com/f?x=1&y=2', title: 'Tom & "Jerry" <live>' },
    { url: 'https://a.com/f?x=1&y=2', title: 'dup' },
    { url: 'not a url', title: 'x' },
    { url: 'https://b.com/', title: '  spaced   out \n title ' },
    { url: 'https://c.com/', title: '' },
  ], { title: 'OnlyBoosts podcasts', created })
  assert.equal(written, 3)
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">'))
  assert.ok(xml.includes('<dateCreated>Sat, 07 Nov 2026 12:00:00 GMT</dateCreated>'))
  assert.ok(xml.includes('xmlUrl="https://a.com/f?x=1&amp;y=2"') && xml.includes('text="Tom &amp; &quot;Jerry&quot; &lt;live&gt;"'))
  assert.deepEqual(opml.parseOpml(xml), [
    { xmlUrl: 'https://a.com/f?x=1&y=2', title: 'Tom & "Jerry" <live>' },
    { xmlUrl: 'https://b.com/', title: 'spaced out title' },
    { xmlUrl: 'https://c.com/', title: 'https://c.com/' },
  ])
  assert.equal(opml.opmlFilename(new Date(2026, 0, 5)), 'onlyboosts-podcasts-2026-01-05.opml')
})

/* ── POST /api/v1/feeds/resolve ───────────────────────────────────────── */

const db = new DatabaseSync(':memory:')
db.exec(read('bots/global-boost-scan/d1/schema.sql'))
const ins = db.prepare('INSERT INTO podcasts(podcast_guid,title,image,artwork,medium,feed_url) VALUES(?,?,?,?,?,?)')
ins.run('g-exact', 'Exact', 'https://x/1.jpg', null, 'podcast', 'https://a.com/feed')
ins.run('g-scheme', 'Scheme', 'https://x/2.jpg', 'https://x/2b.jpg', 'music', 'http://b.com/feed/')
ins.run('g-private', 'Should never be asked', null, null, 'podcast', 'https://www.patreon.com/rss/x?auth=1')

const bound = []
const env = {
  DB: {
    prepare(sql) {
      return {
        bind(...args) {
          bound.push(args)
          return { all: async () => ({ results: db.prepare(sql).all(...args) }) }
        },
      }
    },
  },
  PODCAST_INDEX_KEY: 'k',
  PODCAST_INDEX_SECRET: 's',
}

const fetched = []
let upstream = null // for the link route
globalThis.fetch = async (url) => {
  const u = String(url)
  fetched.push(u)
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (u.includes('/podcasts/byfeedurl?url=')) {
    const feed = decodeURIComponent(u.split('url=')[1])
    if (feed === 'https://pi.com/found') return ok({ status: 'true', feed: { id: 5, podcastGuid: 'g-pi', title: 'PI Found', image: 'https://pi/i.jpg', artwork: 'https://pi/a.jpg', medium: 'podcast', url: 'https://pi.com/found' } })
    if (feed === 'https://pi.com/noguid') return ok({ status: 'true', feed: { id: 6, title: 'No Guid', url: 'https://pi.com/noguid' } })
    if (feed === 'https://pi.com/missing') return ok({ status: 'true', feed: [], description: 'No feeds match this url.' })
    if (feed === 'https://pi.com/down') return new Response('nope', { status: 500 })
    return ok({ status: 'true', feed: [] })
  }
  if (typeof upstream === 'function') return upstream(u)
  return new Response('nope', { status: 404 })
}

const resolve = await import(pathToFileURL(join(ROOT, 'functions/api/v1/feeds/resolve.js')).href)
const post = async (handler, path, body, e = env) => {
  const req = new Request('https://ob.invalid' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://onlyboosts.social' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await handler({ request: req, env: e })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}

await check('resolve: D1 by feed URL on its spellings, PI for the rest, three states, no-store', async () => {
  fetched.length = 0; bound.length = 0
  const { status, body, headers } = await post(resolve.onRequestPost, '/api/v1/feeds/resolve', {
    urls: ['https://a.com/feed', 'https://b.com/feed', 'https://pi.com/found', 'https://pi.com/noguid', 'https://pi.com/missing', 'https://pi.com/down', 'https://a.com/feed'],
  })
  assert.equal(status, 200)
  assert.equal(headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(body.feeds['https://a.com/feed'], { guid: 'g-exact', title: 'Exact', image: 'https://x/1.jpg', artwork: null, medium: 'podcast', feed: 'https://a.com/feed', indexed: true })
  assert.equal(body.feeds['https://b.com/feed'].guid, 'g-scheme', 'http and a trailing slash are the same feed')
  assert.deepEqual(body.feeds['https://pi.com/found'], { guid: 'g-pi', title: 'PI Found', image: 'https://pi/i.jpg', artwork: 'https://pi/a.jpg', medium: 'podcast', feed: 'https://pi.com/found', indexed: false })
  assert.equal(body.feeds['https://pi.com/noguid'].guid, null, 'held by PI with no guid: a row with guid null')
  assert.equal(body.feeds['https://pi.com/missing'], null, 'both sides answered: not found')
  assert.ok(!Object.prototype.hasOwnProperty.call(body.feeds, 'https://pi.com/down'), 'a failed ask is ABSENT, never null')
  assert.equal(fetched.filter((u) => u.includes('byfeedurl')).length, 4, 'PI asked only for what D1 lacked')
  assert.ok(!fetched.some((u) => u.includes('a.com%2Ffeed') || u.includes('b.com')), 'an indexed feed never reaches PI')
})

await check('resolve: a private-looking or non-web address is never bound, never sent, and absent from the answer', async () => {
  fetched.length = 0; bound.length = 0
  const { body } = await post(resolve.onRequestPost, '/api/v1/feeds/resolve', {
    urls: ['https://www.patreon.com/rss/x?auth=1', 'https://pi.com/found?token=abc', 'nsec1abc', 'https://a.com/feed'],
  })
  assert.deepEqual(Object.keys(body.feeds), ['https://a.com/feed'])
  const boundText = JSON.stringify(bound)
  assert.ok(!boundText.includes('patreon') && !boundText.includes('token=abc') && !boundText.includes('nsec1'), 'never bound into a statement')
  assert.ok(!fetched.some((u) => u.includes('patreon') || u.includes('token')), 'never sent to PI')
})

await check('resolve: input hygiene, the cap, 400/503', async () => {
  assert.equal((await post(resolve.onRequestPost, '/api/v1/feeds/resolve', 'not json')).status, 400)
  assert.equal((await post(resolve.onRequestPost, '/api/v1/feeds/resolve', { urls: 'x' })).status, 400)
  assert.equal((await post(resolve.onRequestPost, '/api/v1/feeds/resolve', { urls: [] }, { ...env, DB: null })).status, 503)
  fetched.length = 0
  const urls = Array.from({ length: resolve.MAX_URLS + 50 }, (_, i) => `https://many.com/${i}`)
  const { body } = await post(resolve.onRequestPost, '/api/v1/feeds/resolve', { urls })
  assert.ok(fetched.filter((u) => u.includes('byfeedurl')).length <= resolve.PI_MAX, 'at most PI_MAX lookups a request')
  assert.ok(Object.keys(body.feeds).length <= resolve.PI_MAX)
  assert.ok(!Object.prototype.hasOwnProperty.call(body.feeds, urls[urls.length - 1]), 'past the cap: absent, to be asked again')
  assert.deepEqual(resolve.spellings('https://a.com/f'), ['https://a.com/f', 'http://a.com/f', 'https://a.com/f/', 'http://a.com/f/'])
})

/* ── POST /api/v1/opml/link ───────────────────────────────────────────── */

const link = await import(pathToFileURL(join(ROOT, 'functions/api/v1/opml/link.js')).href)

await check('link: refuses a non-web paste, a link with a key, an IP literal and a local name, before any fetch', async () => {
  fetched.length = 0
  for (const url of ['nsec1abc', 'example.com/x.opml', 'https://x.com/l?token=1', 'https://10.0.0.1/x.opml', 'https://[::1]/x', 'https://localhost/x', 'https://box/x', 'https://nas.local/x']) {
    const r = await post(link.onRequestPost, '/api/v1/opml/link', { url })
    assert.equal(r.status, 400, url)
    assert.equal(r.headers.get('Cache-Control'), 'no-store')
  }
  assert.equal((await post(link.onRequestPost, '/api/v1/opml/link', 'nope')).status, 400)
  assert.equal(fetched.length, 0, 'nothing fetched')
})

await check('link: outlines come back and never the body; a page is 422, a failing host 502, a huge file 502', async () => {
  upstream = (u) => {
    if (u === 'https://share.app/me/subs.opml') return new Response('<opml version="2.0"><body><outline type="rss" text="A &amp; B" xmlUrl="https://a.com/feed"/></body></opml>', { status: 200, headers: { 'Content-Type': 'text/x-opml' } })
    if (u === 'https://share.app/page') return new Response('<!doctype html><html><body>hello</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
    if (u === 'https://share.app/down') return new Response('x', { status: 503 })
    if (u === 'https://share.app/huge') return new Response(new ReadableStream({
      start(c) { const chunk = new Uint8Array(1024 * 1024).fill(32); for (let i = 0; i < 17; i++) c.enqueue(chunk); c.close() },
    }), { status: 200 })
    return new Response('nope', { status: 404 })
  }
  const ok = await post(link.onRequestPost, '/api/v1/opml/link', { url: 'https://share.app/me/subs.opml' })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { outlines: [{ xmlUrl: 'https://a.com/feed', title: 'A & B' }], name: 'subs.opml' })
  assert.equal(ok.headers.get('Cache-Control'), 'no-store')
  const page = await post(link.onRequestPost, '/api/v1/opml/link', { url: 'https://share.app/page' })
  assert.equal(page.status, 422)
  assert.ok(!JSON.stringify(page.body).includes('hello'), 'nothing of the page comes back')
  assert.equal((await post(link.onRequestPost, '/api/v1/opml/link', { url: 'https://share.app/down' })).status, 502)
  assert.equal((await post(link.onRequestPost, '/api/v1/opml/link', { url: 'https://share.app/huge' })).status, 502)
  const big = await post(link.onRequestPost, '/api/v1/opml/link', { url: 'https://share.app/x', pad: 'x'.repeat(5000) })
  assert.equal(big.status, 413)
  upstream = null
})

/* ── The wiring ───────────────────────────────────────────────────────── */

await check('the writer publishes a batch once; the controller keeps a local list, offers it on login, and opens the panel from three doors', async () => {
  const sync = read('assets/js/favorites-sync.js')
  assert.ok(sync.includes('const changes = Array.isArray(change) ? change : change ? [change] : []') && sync.includes('changes.reduce((acc, c) => applyChange(acc, c), adopted)'))
  const ui = read('assets/js/favorites-ui.js')
  assert.ok(ui.includes("const LOCAL_KEY = 'ob_local_follows'") && ui.includes('function offerLocalMerge(') && ui.includes('importOpml: () => openOpml(\'import\')') && ui.includes('exportOpml,') && ui.includes('localFollows: () => loadLocal()'))
  assert.ok(ui.includes('local: state.local, feeds: state.trusted || state.local ? state.feeds.slice() : []'), 'the event says when the feeds are the local list')
  assert.ok(ui.includes("import('/assets/js/opml-import.js?v="), 'the panel loads on first use')
  assert.ok(ui.includes("a.href = 'data:text/x-opml;charset=utf-8,'"), 'the export is a data: URL, never a blob: one (the CSP)')
  assert.ok(ui.includes('if (state.trusted && state.pubkey === pubkey && loadLocal().length) offerLocalMerge(pubkey)'))
  const panel = read('assets/js/opml-import.js')
  assert.ok(panel.indexOf('opmlLinkVerdict(raw)') < panel.indexOf("fetch(LINK_URL"), 'a pasted link is judged before it is sent')
  assert.ok(panel.includes('planOpmlImport(outlines)') && panel.includes('sortOpmlAnswers(plan.feeds, answers, ctx.isFollowed)'))
  assert.ok(panel.includes("import {") && /from '\/assets\/js\/opml\.js\?v=/.test(panel))
  // The three doors.
  const home = read('index.html')
  assert.equal((home.match(/data-opml-import/g) || []).length, 1, 'the one carrot rail carries the import door (2026-11-08: four locked rails became one)')
  assert.ok(home.includes('<h3>Log in or import your OPML for personalized recommendations</h3>'))
  for (const k of ['recommended', 'recommended-music', 'follows', 'follows-songs']) assert.ok(home.includes(`data-rail="${k}" data-rail-personal aria-labelledby="rail-${k}" hidden>`), `${k} ships hidden`)
  assert.ok(home.includes('data-rail="personal" data-rail-personal aria-labelledby="rail-personal">'), 'the carrot ships shown')
  const sec = read('assets/js/favorites-section.js')
  assert.ok(sec.includes('function mountOpml(owner)') && sec.includes('data-opml="import"') && sec.includes('data-opml="export"'))
  const widget = read('assets/widgets/login-widget.js')
  assert.ok(widget.includes('Podcast list (OPML)'), 'the account menu row is in the built bundle')
  assert.ok(read('login-widget/src/components/IdentityDropdown.jsx').includes("typeof api.importOpml === 'function'"))
  // The homepage: an imported list seeds the rails without a key.
  const disc = read('assets/js/discover.js')
  assert.ok(disc.includes('async function favoritesApi()') && disc.includes("closest('[data-opml-import], [data-opml-manage]')"))
  assert.ok(disc.includes('if (local.length) { paintRecommended(sections, null, local); paintLatest(sections, local, { local: true }) }'))
  assert.ok(disc.includes("...(pubkey ? { pubkey } : {}), limit: TILES"), 'the endpoint is asked with favorites alone')
  assert.ok(disc.includes("(d.local && !d.pubkey)"), 'the listener accepts the local list')
  assert.ok(disc.includes("const PERSONAL = ['follows-latest', 'recommended', 'recommended-music', 'follows', 'follows-songs']") && disc.includes('function setCarrot(') && disc.includes("if (!j.seeds && !pods && !albums) { conceal(rec); conceal(music)"), 'a personal rail is hidden until it has something to show; no seeds, no Recommended rails')
  const rr = read('assets/js/recommend-rails.js')
  for (const k of ['loading', 'signed-out', 'imported', 'no-seeds', 'no-list', 'no-podcasts', 'no-music']) assert.ok(rr.includes(`'${k}': {`), `the carrot has a ${k} state`)
  assert.ok(disc.includes("import { CARROT, carrotState, HOOKS } from '/assets/js/recommend-rails.js?v=") && disc.includes('HOOKS.musicNone') && disc.includes('HOOKS.podcastsNone'), 'an empty Recommended rail is a hook with a button, the copy shared with /booster')
  assert.ok(rr.includes('export function recommendRailsHtml(recs, { owner = false, feeds = [] } = {})') && rr.includes('if (owner) out.push(carrotRailHtml(carrotState({ signedIn: true') && read('assets/js/booster-page.js').includes('recommendRailsHtml(await resp.json(), { owner, feeds: favorites })'), "the owner's /booster carries the hooks and the carrot")
  assert.ok(read('assets/js/opml-import.js').includes("${r.status === 'local' ? 'Later' : 'Done'}"), 'the local import closes with Later')
  assert.ok(disc.includes("setCarrot(sections, 'loading')") && disc.includes('FAVORITES_WAIT_MS'), 'signed in, the carrot says the lists are loading and the first paint waits (bounded) for the favorites read')
  const favui = read('assets/js/favorites-ui.js')
  assert.ok(favui.includes("if (btn.classList.contains('is-busy')) return"), 'a read in flight never paints over a busy button')
  assert.ok(disc.includes("setCarrot(sections, carrotState({ signedIn: !!pubkey, imported: true, sides: j.sides, pods: pods?.length || 0, albums: albums?.length || 0, listEmpty: !favorites.length }))"), 'the carrot stays up until the member has a seed on both sides and a list')
  const { carrotState } = await import('../assets/js/recommend-rails.js')
  assert.equal(carrotState({ signedIn: false }), 'signed-out')
  assert.equal(carrotState({ signedIn: false, imported: true }), 'imported')
  assert.equal(carrotState({ signedIn: true, sides: { podcast: 0, music: 0 } }), 'no-seeds')
  assert.equal(carrotState({ signedIn: true, sides: { podcast: 1, music: 0 }, listEmpty: true }), 'no-list', "Reed's boosted-once account")
  assert.equal(carrotState({ signedIn: true, sides: { podcast: 1, music: 0 }, listEmpty: false }), 'no-music')
  assert.equal(carrotState({ signedIn: true, sides: { podcast: 0, music: 1 }, listEmpty: false }), 'no-podcasts')
  assert.equal(carrotState({ signedIn: true, sides: { podcast: 1, music: 1 }, listEmpty: false }), null)
  assert.ok(home.includes("<p>The newest episodes of the podcasts you follow, podcasts and music recommended from what you boost, and the top podcasts and songs from the accounts you follow on Nostr. No account? Import your podcast app's subscription list instead.</p>"), 'the shipped card is the signed-out state\'s copy')
  assert.ok(disc.includes("b.textContent = 'Manage'") && disc.includes("headExtra(head, document.createTextNode('From your imported OPML · '), b)"), 'the imported note rides the rail-sub line')
  // The favorites resolver carries the feed URL now, for the export.
  assert.ok(read('functions/api/v1/favorites/resolve.js').includes('feed: r.feed_url || null'))
})

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
