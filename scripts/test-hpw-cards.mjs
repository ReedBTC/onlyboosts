#!/usr/bin/env node
/**
 * The 40 HPW share cards: the two-sided board module, the /hpw pages, and the
 * image proxy in front of the collector's screenshots.
 *
 * Three things that fail silently, each pinned here:
 *   - the board module drifting from two-sided rules (an absolute import, an
 *     unpinned locale, Date.now()) — a render check passes regardless, so the
 *     SOURCE is scanned, the way test-show-card.mjs does;
 *   - the page Function resolving a week differently from the endpoint the
 *     tab fetches — so the SHIPPED handler runs here over a node:sqlite build
 *     of the real schema, the way test-members-hours.mjs runs the endpoint;
 *   - the proxy passing through what relay.mynostr.app answers for a MISSING
 *     file (a 200 text/plain), or a file over the preview fetchers' cap —
 *     fetch is stubbed, so nothing here touches the VPS.
 *
 * Run: node scripts/test-hpw-cards.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as board from '../assets/js/hpw-board.js'
import { onRequestGet as pageGet, onRequestHead as pageHead, CARD_W, CARD_H } from '../functions/hpw/[[path]].js'
import { onRequestGet as ogGet, onRequestHead as ogHead, isPng, UPSTREAM_BASE } from '../functions/api/og/hpw/[name].js'
import { onRequestHead as boosterHead } from '../functions/api/og/booster/[npub].js'
import { pacificWeekStart, weekDateString, prevWeek, nextWeek } from '../assets/js/pacific-week.js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0, failed = 0
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log(`  ✓ ${name}`) },
    (err) => { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 },
  )
}

// ── the board module ─────────────────────────────────────────────────────────
console.log('\nhpw-board.js is two-sided:')
const src = readFileSync(join(ROOT, 'assets/js/hpw-board.js'), 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
await check('no absolute /assets/js import (esbuild cannot resolve one)', () => {
  assert.ok(!/from\s+['"]\/assets\//.test(code))
})
await check('every sibling import is a stamped relative one', () => {
  for (const m of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.\/[\w-]+\.js\?v=ob-v\d+$/, m[1])
})
await check('no Date.now(), no unpinned locale call', () => {
  assert.ok(!/Date\.now\(/.test(code), 'Date.now')
  assert.ok(!/toLocaleDateString\(\s*(undefined|\))/.test(code), 'unpinned toLocaleDateString')
  assert.ok(!/toLocaleString\(\s*\)/.test(code), 'unpinned toLocaleString')
})
const M = (o) => ({ pk: 'a'.repeat(64), npub: null, name: 'Alice', pic: null, seconds: 3600, episodes: 1, week_start: null, ...o })
await check('gold marks a cleared week and nothing else', () => {
  assert.match(board.rowHtml(M({ seconds: 40 * 3600 }), 0, 40), /hpw-row hpw-row--gold/)
  assert.doesNotMatch(board.rowHtml(M({ seconds: 40 * 3600 - 1 }), 0, 40), /gold/)
})
await check('a name is escaped; a javascript: picture is dropped; http:// is promoted', () => {
  const r = board.rowHtml(M({ name: 'A <b>&', pic: 'javascript:alert(1)' }), 0, 40)
  assert.match(r, /A &lt;b&gt;&amp;/)
  assert.match(r, /hpw-face--none/)
  assert.match(board.rowHtml(M({ pic: 'http://x.example/a.png' }), 0, 40), /src="https:\/\/x\.example\/a\.png"/)
})
await check('the week is a jump button on the tab and a link when weekHref is given', () => {
  const m = M({ week_start: 1755504000 })
  assert.match(board.rowHtml(m, 0, 40), /<button type="button" class="hpw-week hpw-week-jump" data-hpw-goweek="2025-08-18"/)
  assert.match(board.rowHtml(m, 0, 40, { weekHref: (d) => `/hpw/${d}` }), /<a class="hpw-week hpw-week-jump" href="\/hpw\/2025-08-18"/)
  assert.match(board.boardHtml({ title: 't', sub: 's', members: [m], goal: 40, empty: 'e', weekHref: (d) => `/x/${d}` }), /href="\/x\/2025-08-18"/)
})
await check('⚠️ an empty board is .hpw-empty with NO .hpw-list (the collector\'s clip guard returns early on that)', () => {
  const html = board.boardHtml({ title: 't', sub: 's', members: [], goal: 40, empty: 'Nothing recorded yet.' })
  assert.match(html, /<p class="hpw-empty">Nothing recorded yet\.<\/p>/)
  assert.doesNotMatch(html, /hpw-list/)
})
await check('dates are en-US in UTC', () => {
  assert.equal(board.weekLabel(1755504000), 'Aug 18, 2025')
  assert.equal(board.weekSpan(1755504000), 'Aug 18 to Aug 24, 2025')
})

// ── the share module's pure parts ───────────────────────────────────────────
/* hpw-share.js is browser-only and imports two siblings ABSOLUTELY (it is not
   two-sided), which node cannot resolve — so the shipped source is loaded with
   those two imports rewritten to stubs, the test-feed-lang.mjs technique. The
   module under test is still the shipped file. */
console.log('\nhpw-share.js: the note, the link, the tags:')
const shareSrc = readFileSync(join(ROOT, 'assets/js/hpw-share.js'), 'utf8')
  .replace(/from '\/assets\/js\/copy-npub\.js\?v=[^']+'/, "from 'data:text/javascript,export const showToast = () => {}'")
  .replace(/from '\/assets\/js\/follow-set\.js\?v=[^']+'/, "from 'data:text/javascript,export const getSessionPubkey = () => null'")
const shareDir = mkdtempSync(join(tmpdir(), 'hpw-share-'))
writeFileSync(join(shareDir, 'hpw-share.mjs'), shareSrc)
const share = await import(join(shareDir, 'hpw-share.mjs'))
await check('the live week links /#members; a past week and High Scores link their own page', () => {
  assert.equal(share.shareLink('2026-08-24', true), 'https://onlyboosts.social/#members')
  assert.equal(share.shareLink('2026-08-17', false), 'https://onlyboosts.social/hpw/2026-08-17')
  assert.equal(share.shareLink('high-scores', false), 'https://onlyboosts.social/hpw/high-scores')
})
await check('the image is fetched from THIS origin, never the absolute site URL', () => {
  assert.equal(share.imageHere('2026-08-24'), '/api/og/hpw/2026-08-24.png')
})
await check('⚠️ the note is message, blank line, image, blank line, link — and the image is a Blossom URL, never the proxy', () => {
  const img = 'https://blossom.primal.net/abc.png'
  assert.equal(share.noteContent('  hi there ', img, 'https://onlyboosts.social/#members'), 'hi there\n\nhttps://blossom.primal.net/abc.png\n\nhttps://onlyboosts.social/#members')
  assert.equal(share.noteContent('', img, 'L'), `${img}\n\nL`, 'an empty message is allowed')
  assert.ok(!shareSrc.includes('imageUrl: s.blob') && !/noteContent\([^)]*imageHere/.test(shareSrc), 'the proxy URL never reaches the note')
})
await check('the tags: t, r, imeta with the sha, client; no e, no p', () => {
  const tags = share.buildShareTags({ link: 'L', imageUrl: 'U', sha256: 'ab', title: 'Week of Aug 24, 2026' })
  assert.deepEqual(tags.map((t) => t[0]), ['t', 'r', 'imeta', 'client'])
  assert.deepEqual(tags[0], ['t', '40hpw']); assert.deepEqual(tags[1], ['r', 'L'])
  assert.deepEqual(tags[2], ['imeta', 'url U', 'm image/png', 'x ab', 'alt Nostr Gang #40HPW leaderboard, Week of Aug 24, 2026'])
  assert.deepEqual(tags[3], ['client', 'onlyboosts.social'])
  assert.deepEqual(share.buildShareTags({ link: 'L', imageUrl: 'U', sha256: null, title: 't' })[2], ['imeta', 'url U', 'm image/png', 'alt Nostr Gang #40HPW leaderboard, t'])
})
await check('a chart board overrides the tag and the alt; the defaults are still the 40 HPW board\'s', () => {
  const tags = share.buildShareTags({ link: 'L', imageUrl: 'U', sha256: 'ab', title: 'Week of Aug 24, 2026', tag: 'onlyboosts', alt: 'OnlyBoosts Charts: Shows, Week of Aug 24, 2026' })
  assert.deepEqual(tags[0], ['t', 'onlyboosts'])
  assert.deepEqual(tags[2], ['imeta', 'url U', 'm image/png', 'x ab', 'alt OnlyBoosts Charts: Shows, Week of Aug 24, 2026'])
  // mountShare's option surface, so a caller passing an image or a link does not fall back to the hpw proxy
  assert.match(shareSrc, /export function mountShare\(boardEl, \{ key, title, isLive = false, image = null, link = null, alt = null, tag = '40hpw', filename = null, placeholder = null \}\)/)
  assert.match(shareSrc, /fetch\(s\.image,/)
})
await check('⚠️ lb:session-change is listened for on window, where the widget dispatches it', () => {
  assert.match(shareSrc, /window\.addEventListener\('lb:session-change'/)
  assert.doesNotMatch(shareSrc, /document\.addEventListener\('lb:session-change'/)
})
await check('⚠️ nothing here signs with a site key: the upload and the publish go through the widget', () => {
  assert.ok(!/sign-boost|siteSign|SITE_SIGN/.test(shareSrc))
  assert.match(shareSrc, /window\.LBLogin\.uploadToBlossom\(/)
  assert.match(shareSrc, /window\.LBLogin\.signAndPublish\(/)
})

// ── the pages, over the real schema ──────────────────────────────────────────
console.log('\n/hpw pages, over the shipped hoursBoard query:')
const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))
const stmt = (sql, args) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => ({ results: db.prepare(sql).all(...(args || [])) }),
  first: async () => db.prepare(sql).get(...(args || [])) ?? null,
})
const env = { DB: { prepare: (sql) => stmt(sql) } }
const live = pacificWeekStart(Math.floor(Date.now() / 1000))
const last = prevWeek(live)
let ev = 0
const boost = (pk, ig, ts) => db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,item_guid) VALUES(?,?,?,?,?)')
  .run('e' + String(ev++).padStart(63, '0'), pk, ts, 100, ig)
db.prepare('INSERT INTO episodes(item_guid,title,duration) VALUES(?,?,?)').run('ep', 'ep', 41 * 3600)
db.prepare('INSERT INTO episodes(item_guid,title,duration) VALUES(?,?,?)').run('ep2', 'ep2', 3600)
db.prepare('INSERT INTO profiles(pubkey,display_name,picture) VALUES(?,?,?)').run('a'.repeat(64), 'Alice 🐱 <x>', 'https://x.example/a.png')
boost('a'.repeat(64), 'ep', last + 86400)      // Alice: a 41h week LAST week (gold)
boost('b'.repeat(64), 'ep2', live + 3600)      // Bob: one hour this week

const get = (path) => pageGet({
  request: new Request('https://ob.invalid' + path), env,
  params: { path: path.replace(/^\/hpw\/?/, '').split('/').filter(Boolean) },
})
const lastKey = weekDateString(last), liveKey = weekDateString(live)

await check('/hpw redirects to the live week', async () => {
  const r = await get('/hpw')
  assert.equal(r.status, 302); assert.equal(new URL(r.headers.get('location')).pathname, `/hpw/${liveKey}`)
})
await check('a non-Monday date 302s to its Monday, keeping /card', async () => {
  const wed = new Date((last + 2 * 86400) * 1000).toISOString().slice(0, 10)
  const r = await get(`/hpw/${wed}/card`)
  assert.equal(r.status, 302); assert.equal(new URL(r.headers.get('location')).pathname, `/hpw/${lastKey}/card`)
})
await check('a future week 302s to the live one', async () => {
  const r = await get(`/hpw/${weekDateString(nextWeek(live))}`)
  assert.equal(r.status, 302); assert.equal(new URL(r.headers.get('location')).pathname, `/hpw/${liveKey}`)
})
await check('garbage, a third segment, and a non-card second segment are 404', async () => {
  for (const p of ['/hpw/2025-13-40', '/hpw/nope', `/hpw/${lastKey}/card/x`, `/hpw/${lastKey}/print`]) {
    assert.equal((await get(p)).status, 404, p)
  }
})
await check('a week before the index began is 404, not an empty page', async () => {
  assert.equal((await get(`/hpw/${weekDateString(prevWeek(prevWeek(last)))}`)).status, 404)
})
let pageHtml, cardHtml
await check('last week renders the same row the tab would, gold and all', async () => {
  const r = await get(`/hpw/${lastKey}`)
  assert.equal(r.status, 200)
  pageHtml = await r.text()
  const expect = board.rowHtml({ pk: 'a'.repeat(64), npub: null, name: 'Alice 🐱 <x>', pic: 'https://x.example/a.png', seconds: 41 * 3600, episodes: 1, week_start: null }, 0, 40)
  assert.ok(pageHtml.includes(expect), 'the page carries rowHtml byte for byte')
  assert.match(pageHtml, /hpw-row--gold/)
  assert.match(pageHtml, /Alice 🐱 &lt;x&gt;/)
})
await check('the page carries canonical, og:image on the proxy, and the square card (the image is portrait)', async () => {
  assert.match(pageHtml, new RegExp(`<link rel="canonical" href="https://onlyboosts.social/hpw/${lastKey}" />`))
  assert.match(pageHtml, new RegExp(`<meta property="og:image" content="https://onlyboosts.social/api/og/hpw/${lastKey}.png" />`))
  assert.match(pageHtml, /twitter:card" content="summary"/)
  assert.match(pageHtml, /og:description" content="Boost an episode on Nostr and the board assumes you listened to all of it\. Alice 🐱 &lt;x&gt; leads for the week of/)
  assert.match(pageHtml, /NAV:START[\s\S]*NAV:END/)
  assert.doesNotMatch(pageHtml, /X-Robots-Tag/)
})
await check('a past week takes the endpoint cache life; the live week the shorter one', async () => {
  assert.equal((await get(`/hpw/${lastKey}`)).headers.get('cache-control'), 'public, max-age=300')
  assert.equal((await get(`/hpw/${liveKey}`)).headers.get('cache-control'), 'public, max-age=60')
})
await check('the page arrows: ‹ links to the previous week, › is off on the live week; only the live week is data-hpw-live', async () => {
  const html = await (await get(`/hpw/${liveKey}`)).text()
  assert.match(html, /data-hpw-live="1"/)
  assert.doesNotMatch(pageHtml, /data-hpw-live/)
  assert.match(html, new RegExp(`<a class="hpw-arrow" href="/hpw/${lastKey}"`))
  assert.match(html, /<span class="hpw-arrow" aria-disabled="true" aria-label="Next week">/)
  // and on the first week ‹ is off
  const first = await (await get(`/hpw/${lastKey}`)).text()
  assert.match(first, /<span class="hpw-arrow" aria-disabled="true" aria-label="Previous week">/)
})
/* ⚠️ THE PATH IS `high-scores` AND THE BOARD IS "Proof of #40HPW". It was
   renamed on 2026-09-01 and the URL deliberately did not move with it: this
   path is in the wild, the collector's card bot screenshots the literal, and
   functions/api/og/hpw/[name].js allowlists it. A change that "tidies" the two
   into agreement breaks all three. */
await check('/hpw/high-scores is Proof of #40HPW: one row per member, its best week linked, 300s', async () => {
  const r = await get('/hpw/high-scores')
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.match(html, /Proof of #40HPW/)
  assert.doesNotMatch(html, /High Scores/)
  // Alice's 41h week is the only qualifying one in the fixture; Bob's hour is
  // on the weekly board and must not reach this one.
  assert.match(html, new RegExp(`<a class="hpw-week hpw-week-jump" href="/hpw/${lastKey}"`))
  assert.match(html, /<span class="hpw-hours">1<span class="hpw-unit"> wk<\/span><\/span>/)
  assert.match(html, /<span class="hpw-eps hpw-best"[^>]*>best 41\.0 hpw<\/span>/)
  assert.doesNotMatch(html, /Bob/)
  // Every row on this board cleared the goal, so every row is gold.
  assert.equal((html.match(/hpw-row--gold/g) || []).length, (html.match(/<li class="hpw-row/g) || []).length)
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300')
})
await check('the Proof board names the count in its og:description, not the hours', async () => {
  const html = await (await get('/hpw/high-scores')).text()
  assert.match(html, /og:description" content="[^"]*1 member has cleared 40 hours in a week\. Alice[^"]*leads with 1 such week, the best of them 41\.0 hours\."/)
  assert.match(html, /<meta property="og:title" content="Nostr Gang: Proof of #40HPW" \/>/)
})
await check('the card: a portrait frame, no nav, noindex, the ready signal, the same row', async () => {
  assert.ok(CARD_H > CARD_W, 'portrait')
  const r = await get(`/hpw/${lastKey}/card`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-robots-tag'), 'noindex')
  cardHtml = await r.text()
  assert.match(cardHtml, /<html lang="en" data-card>/)
  assert.match(cardHtml, new RegExp(`width: ${CARD_W}px; height: ${CARD_H}px; overflow: hidden`))
  assert.doesNotMatch(cardHtml, /NAV:START|nav-widget-boot|sw-register|data-theme/)
  assert.match(cardHtml, /<meta name="robots" content="noindex" \/>/)
  assert.match(cardHtml, /setAttribute\('data-card-ready', '1'\)/)
  const expect = board.rowHtml({ pk: 'a'.repeat(64), npub: null, name: 'Alice 🐱 <x>', pic: 'https://x.example/a.png', seconds: 41 * 3600, episodes: 1, week_start: null }, 0, 40)
  assert.ok(cardHtml.includes(expect))
  assert.match(cardHtml, /<footer class="card-foot">onlyboosts\.social\/#members<\/footer>/)
  // The list the collector's clip guard measures, since the chart cards joined (2026-09-03).
  assert.match(cardHtml, /<ol class="hpw-list" data-card-list>/)
  assert.doesNotMatch(pageHtml, /data-card-list/)
})
await check('the card names the week, never "This Week"', async () => {
  const html = await (await get(`/hpw/${liveKey}/card`)).text()
  assert.doesNotMatch(html, /This Week/)
  assert.match(html, /In progress\./)
})
await check('⚠️ HEAD on the page is routed: the GET\'s status and headers, no body', async () => {
  const r = await pageHead({ request: new Request(`https://ob.invalid/hpw/${lastKey}`, { method: 'HEAD' }), env, params: { path: [lastKey] } })
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'public, max-age=300'); assert.equal(r.body, null)
  assert.equal((await pageHead({ request: new Request('https://ob.invalid/hpw/nope', { method: 'HEAD' }), env, params: { path: ['nope'] } })).status, 404)
})
await check('a query failure is a 503 with no-store, not a blank 200', async () => {
  const err = console.error; console.error = () => {}   // the handler logs it, as it should
  try {
  const broken = { DB: { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('boom') }, first: async () => null }), all: async () => { throw new Error('boom') }, first: async () => null }) } }
  const r = await pageGet({ request: new Request(`https://ob.invalid/hpw/${lastKey}`), env: broken, params: { path: [lastKey] } })
  assert.equal(r.status, 503); assert.equal(r.headers.get('cache-control'), 'no-store')
  } finally { console.error = err }
})

// ── the proxy ────────────────────────────────────────────────────────────────
console.log('\n/api/og/hpw/<name>.png, fetch stubbed:')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
let calls = []
let upstream = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
globalThis.fetch = async (url) => { calls.push(String(url)); return upstream() }
globalThis.caches = { default: { match: async () => null, put: async () => {} } }
const assets = { fetch: async () => new Response(new Uint8Array([9, 9, 9]), { status: 200 }) }
const og = (name) => ogGet({ request: new Request(`https://ob.invalid/api/og/hpw/${name}`), env: { ASSETS: assets }, params: { name } })

await check('the allowlist: only <date>.png and high-scores.png; nothing is fetched otherwise', async () => {
  calls = []
  for (const n of ['x.png', '2025-08-18.jpg', '../x.png', 'high-scores', 'high-scores.png.png', '2025-13-40.png']) {
    assert.equal((await og(n)).status, 404, n)
  }
  assert.equal(calls.length, 0)
})
await check('a non-Monday name 302s to the Monday file', async () => {
  const r = await og('2025-08-20.png')
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /\/api\/og\/hpw\/2025-08-18\.png$/)
})
await check('a real PNG passes through, marked card, from the collector\'s tree', async () => {
  calls = []
  const r = await og('2025-08-18.png')
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-ob-image'), 'card')
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.equal(calls[0], `${UPSTREAM_BASE}2025-08-18.png`)
  assert.equal(new Uint8Array(await r.arrayBuffer()).length, PNG.length)
})
await check('⚠️ the upstream\'s 200 text/plain for a missing file is the banner, not the text', async () => {
  upstream = () => new Response('Please use a Nostr client to connect.', { status: 200, headers: { 'content-type': 'text/plain' } })
  assert.equal((await og('high-scores.png')).headers.get('x-ob-image'), 'fallback')
})
await check('a 200 image/png whose bytes are not a PNG is the banner too', async () => {
  upstream = () => new Response('<html>not a png</html>', { status: 200, headers: { 'content-type': 'image/png' } })
  assert.equal((await og('high-scores.png')).headers.get('x-ob-image'), 'fallback')
  assert.equal(isPng(PNG.buffer), true); assert.equal(isPng(new Uint8Array([1, 2]).buffer), false)
})
await check('over 900KB is the banner, by Content-Length and by the stream', async () => {
  const big = new Uint8Array(901 * 1024); big.set(PNG)
  upstream = () => new Response(big, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(big.length) } })
  assert.equal((await og('high-scores.png')).headers.get('x-ob-image'), 'fallback')
  upstream = () => new Response(big, { status: 200, headers: { 'content-type': 'image/png' } })
  assert.equal((await og('high-scores.png')).headers.get('x-ob-image'), 'fallback')
})
await check('⚠️ HEAD is routed and answers the GET\'s status and headers with no body', async () => {
  upstream = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  const r = await ogHead({ request: new Request('https://ob.invalid/api/og/hpw/high-scores.png', { method: 'HEAD' }), env: { ASSETS: assets }, params: { name: 'high-scores.png' } })
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-ob-image'), 'card')
  assert.equal(r.headers.get('content-type'), 'image/png'); assert.equal(r.body, null)
  assert.equal((await ogHead({ request: new Request('https://ob.invalid/api/og/hpw/x.png', { method: 'HEAD' }), env: {}, params: { name: 'x.png' } })).status, 404)
  // and the booster route, which had the same gap
  assert.equal(typeof boosterHead, 'function')
})
await check('a 404 upstream, and a thrown fetch, are the banner', async () => {
  upstream = () => new Response('nope', { status: 404 })
  assert.equal((await og('high-scores.png')).headers.get('x-ob-image'), 'fallback')
  upstream = () => { throw new Error('down') }
  assert.equal((await og('high-scores.png')).headers.get('x-ob-image'), 'fallback')
})

console.log(`\n${passed} checks passed${failed ? `, ${failed} FAILED` : ''}`)
