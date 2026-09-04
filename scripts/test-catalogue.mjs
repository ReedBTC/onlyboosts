/* /api/catalogue — the /show episode drawer's catalogue, from Podcast Index.
 *
 * Runs the SHIPPED handlers with `globalThis.fetch` replaced, so nothing here
 * touches Podcast Index. What it pins:
 *
 *   - the projection: five fields a row, coerced, guid-less and duplicate
 *     items dropped, newest first with undated rows last, a total order;
 *   - the request contract: podcastGuid required (400), over-long guid (400),
 *     unconfigured keys (503), a PI miss answered 200 with an empty list and
 *     `no-store`, a good answer cacheable, HEAD carrying the GET's status and
 *     headers with no body, OPTIONS, and the CORS allowlist being exact-match;
 *   - the fallback route: an empty bypodcastguid answer resolves the feed id
 *     (by guid, then by feed URL) and asks episodes/byfeedid;
 *   - `truncated` at PI's ceiling;
 *   - the byte cap in _shared/podcast-index.js#piGet: a streamed body past
 *     `maxBytes` is abandoned and answers as a miss, and one under it parses;
 *   - the drawer markup, with renderEpisodes / episodeRow / COPY EXTRACTED
 *     FROM functions/show/[guid].js and executed (the test-feed-hash.mjs
 *     technique — a copy of the markup written into the test would pass
 *     forever while the shipped one rotted): the podcast drawer is the
 *     catalogue (data-catalogue, data-ep-sort="latest", a hidden empty band,
 *     no BMB link, rows in air-date order carrying data-guid and the outline
 *     class, the empty state and the status line inside the drawer), and the
 *     music drawer is not (chart order, the visible "See All Tracks" link, no
 *     guid, no outline, the one-line empty state).
 *
 * Confirmed red on three mutations while being written: the sort's undated
 * rule flipped, the duplicate guard removed, and the byte cap's comparison
 * made `>=` over a body exactly at the cap.
 *
 *   node scripts/test-catalogue.mjs
 */
import assert from 'node:assert/strict'
import {
  onRequestGet, onRequestHead, onRequestOptions, projectCatalogue, projectEpisode,
  PI_EPISODE_MAX, MAX_UPSTREAM_BYTES,
} from '../functions/api/catalogue.js'
import { piGet } from '../functions/_shared/podcast-index.js'

const env = { PODCAST_INDEX_KEY: 'k', PODCAST_INDEX_SECRET: 's' }
const req = (qs, extra = {}) => new Request(`https://onlyboosts.social/api/catalogue${qs}`, extra)

let calls = []
let routes = {}
const realFetch = globalThis.fetch
function stub(map) {
  routes = map
  calls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    for (const [prefix, answer] of Object.entries(routes)) {
      if (u.includes(prefix)) {
        if (answer instanceof Response) return answer
        if (typeof answer === 'function') return answer(u)
        return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    }
    return new Response('not found', { status: 404 })
  }
}

const item = (guid, datePublished, extra = {}) => ({ guid, title: `Ep ${guid}`, datePublished, duration: 3600, image: `https://img.example/${guid}.jpg`, description: 'x'.repeat(200), ...extra })

// ── projection ─────────────────────────────────────────────────────────
{
  const p = projectEpisode({ guid: ' g1 ', title: '  T  ', datePublished: '1700000000', duration: '61.9', image: 'https://a/b.jpg', enclosureUrl: 'https://x' })
  assert.deepEqual(p, { guid: 'g1', title: 'T', date: 1700000000, dur: 61, img: 'https://a/b.jpg' })
  assert.equal(projectEpisode({ title: 'no guid' }), null)
  assert.equal(projectEpisode({ guid: 'x'.repeat(401) }), null)
  assert.equal(projectEpisode({ guid: 'g', image: 'javascript:alert(1)' }).img, '', 'non-http image dropped')
  assert.equal(projectEpisode({ guid: 'g', datePublished: -5, duration: 'abc' }).date, 0)
  assert.equal(projectEpisode({ guid: 'g', datePublished: -5, duration: 'abc' }).dur, 0)
  assert.equal(projectEpisode(null), null)

  const rows = projectCatalogue([
    item('b', 100), item('a', 300), item('u1', 0), item('c', 300), item('a', 999), { title: 'no guid' }, item('u0', 0),
  ])
  assert.deepEqual(rows.map((r) => r.guid), ['a', 'c', 'b', 'u0', 'u1'], 'newest first, ties by guid, undated last, duplicate dropped')
  assert.equal(rows[0].date, 300, 'the first occurrence of a duplicated guid is the one kept')
  assert.deepEqual(projectCatalogue(null), [])
  assert.ok(!('description' in rows[0]), 'PI fields beyond the five are dropped')
}

// ── the request contract ───────────────────────────────────────────────
{
  stub({})
  let r = await onRequestGet({ request: req(''), env })
  assert.equal(r.status, 400)
  assert.deepEqual((await r.json()).episodes, [])
  r = await onRequestGet({ request: req(`?podcastGuid=${'x'.repeat(401)}`), env })
  assert.equal(r.status, 400)
  r = await onRequestGet({ request: req('?podcastGuid=abc'), env: {} })
  assert.equal(r.status, 503)
  assert.equal(calls.length, 0, 'nothing is fetched before the request is validated')
}

// a PI miss (404 / network) → 200, empty, not cached
{
  stub({})
  const r = await onRequestGet({ request: req('?podcastGuid=abc'), env })
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.deepEqual(body.episodes, [])
  assert.equal(body.truncated, false)
  assert.ok(body.reason)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://onlyboosts.social')
}

// the usual path: bypodcastguid answers, and nothing else is asked
{
  stub({ '/episodes/bypodcastguid': { items: [item('old', 100), item('new', 200)] } })
  const r = await onRequestGet({ request: req('?podcastGuid=abc&feedUrl=https://f.example/rss'), env })
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.deepEqual(body.episodes.map((e) => e.guid), ['new', 'old'])
  assert.deepEqual(body.episodes[0], { guid: 'new', title: 'Ep new', date: 200, dur: 3600, img: 'https://img.example/new.jpg' })
  assert.equal(body.truncated, false)
  assert.equal(r.headers.get('cache-control'), 'public, max-age=600')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes(`max=${PI_EPISODE_MAX}`))
  assert.ok(calls[0].includes('guid=abc'))
  assert.ok(!calls[0].includes('fulltext'), 'no fulltext: descriptions are dropped anyway and the body would be 8x')
}

// the fallback: empty bypodcastguid → byguid → byfeedid
{
  stub({
    '/episodes/bypodcastguid': { items: [] },
    '/podcasts/byguid': { feed: { id: 4242 } },
    '/episodes/byfeedid': { items: [item('f1', 10)] },
  })
  const r = await onRequestGet({ request: req('?podcastGuid=abc'), env })
  const body = await r.json()
  assert.deepEqual(body.episodes.map((e) => e.guid), ['f1'])
  assert.equal(calls.length, 3)
  assert.ok(calls[2].includes('/episodes/byfeedid?id=4242&'))
}

// the fallback's fallback: no id by guid, the feed URL resolves it
{
  stub({
    '/episodes/bypodcastguid': { items: [] },
    '/podcasts/byguid': { feed: {} },
    '/podcasts/byfeedurl': { feed: { id: 7 } },
    '/episodes/byfeedid': { items: [item('f2', 10)] },
  })
  let r = await onRequestGet({ request: req('?podcastGuid=abc&feedUrl=https://f.example/rss'), env })
  assert.deepEqual((await r.json()).episodes.map((e) => e.guid), ['f2'])
  assert.ok(calls.some((c) => c.includes('/podcasts/byfeedurl?url=https%3A%2F%2Ff.example%2Frss')))

  // No feed URL to fall back on: the empty answer stands, and it is a 200
  // empty rather than a miss (PI answered; the show has nothing there).
  calls.length = 0
  r = await onRequestGet({ request: req('?podcastGuid=abc'), env })
  assert.equal(r.status, 200)
  assert.deepEqual((await r.json()).episodes, [])
  assert.ok(!calls.some((c) => c.includes('byfeedurl')), 'no feed URL, no byfeedurl call')

  // An unusable feed URL (credentials, a non-http scheme) is simply no fallback.
  calls.length = 0
  r = await onRequestGet({ request: req('?podcastGuid=abc&feedUrl=https://user:pw@f.example/rss'), env })
  assert.ok(!calls.some((c) => c.includes('byfeedurl')))
  calls.length = 0
  r = await onRequestGet({ request: req('?podcastGuid=abc&feedUrl=ftp://f.example/rss'), env })
  assert.ok(!calls.some((c) => c.includes('byfeedurl')))
}

// truncated at PI's ceiling
{
  const items = Array.from({ length: PI_EPISODE_MAX }, (_, i) => item(`g${i}`, 1_000_000 - i))
  stub({ '/episodes/bypodcastguid': { items } })
  const body = await (await onRequestGet({ request: req('?podcastGuid=abc'), env })).json()
  assert.equal(body.truncated, true)
  assert.equal(body.episodes.length, PI_EPISODE_MAX)
  assert.equal(body.episodes[0].guid, 'g0')
}

// HEAD: the GET's status and headers, no body. OPTIONS: the preflight.
{
  stub({ '/episodes/bypodcastguid': { items: [item('h', 1)] } })
  const h = await onRequestHead({ request: req('?podcastGuid=abc', { method: 'HEAD' }), env })
  assert.equal(h.status, 200)
  assert.equal(h.headers.get('cache-control'), 'public, max-age=600')
  assert.equal(await h.text(), '')
  const h400 = await onRequestHead({ request: req('', { method: 'HEAD' }), env })
  assert.equal(h400.status, 400)

  const o = await onRequestOptions({ request: req('', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8788' } }) })
  assert.equal(o.status, 204)
  assert.equal(o.headers.get('access-control-allow-origin'), 'http://localhost:8788')
  const o2 = await onRequestOptions({ request: req('', { method: 'OPTIONS', headers: { Origin: 'https://onlyboosts.social.evil.example' } }) })
  assert.equal(o2.headers.get('access-control-allow-origin'), 'https://onlyboosts.social', 'exact match, never a prefix')
}

// ── the byte cap ───────────────────────────────────────────────────────
{
  const streamed = (text) => () => new Response(new ReadableStream({
    start(c) {
      const bytes = new TextEncoder().encode(text)
      for (let i = 0; i < bytes.length; i += 1024) c.enqueue(bytes.slice(i, i + 1024))
      c.close()
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  const small = JSON.stringify({ items: [item('s', 1)] })
  stub({ '/x': streamed(small) })
  const ok = await piGet('/x', {}, { maxBytes: small.length })
  assert.equal(ok?.items?.[0]?.guid, 's', 'a body exactly at the cap parses')

  const big = JSON.stringify({ items: [item('b', 1, { description: 'y'.repeat(50_000) })] })
  stub({ '/x': streamed(big) })
  assert.equal(await piGet('/x', {}, { maxBytes: 10_000 }), null, 'a body past the cap is a miss')
  assert.equal((await piGet('/x', {}, {}))?.items?.[0]?.guid, 'b', 'no cap, no limit — the two older callers are unchanged')

  // And through the handler: the catalogue's own cap makes an oversized
  // answer a 200-empty miss rather than a 500.
  assert.ok(MAX_UPSTREAM_BYTES >= 4 * 1024 * 1024)
  const huge = JSON.stringify({ items: [item('z', 1, { description: 'z'.repeat(MAX_UPSTREAM_BYTES + 10) })] })
  stub({ '/episodes/bypodcastguid': streamed(huge), '/podcasts/byguid': { feed: {} } })
  const r = await onRequestGet({ request: req('?podcastGuid=abc'), env })
  assert.equal(r.status, 200)
  assert.deepEqual((await r.json()).episodes, [])
}

globalThis.fetch = realFetch

// ── the drawer markup, extracted from the shipped show Function ─────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { htmlEscape, isSafeUrl, num, fmtDate, fmtDuration } from '../functions/_shared/detail-page.js'
import { chartRanks } from '../assets/js/rank.js'

{
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../functions/show/[guid].js'), 'utf8')
  // A balanced-brace walk from a declaration's opening brace. Template
  // literals inside the bodies carry braces of their own (`${...}`), which is
  // why the walk tracks backticks too.
  function extract(decl) {
    const at = src.indexOf(decl)
    assert.ok(at >= 0, `found ${decl}`)
    let i = src.indexOf('{', at)
    let depth = 0, tpl = false
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === '`' && src[i - 1] !== '\\') tpl = !tpl
      if (tpl && ch === '$' && src[i + 1] === '{') { depth++; i++; continue }
      if (tpl && ch !== '}') continue
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, i + 1) }
    }
    throw new Error(`unbalanced ${decl}`)
  }
  const body = [
    extract('const COPY = '),
    extract('function bmbShowUrl('),
    extract('function episodePageUrl('),
    extract('function renderEpisodes('),
    extract('function episodeRow('),
  ].join('\n')
  const { renderEpisodes, COPY } = new Function(
    'htmlEscape', 'isSafeUrl', 'num', 'fmtDate', 'fmtDuration', 'chartRanks',
    `${body}; return { renderEpisodes, COPY }`,
  )(htmlEscape, isSafeUrl, num, fmtDate, fmtDuration, chartRanks)

  const show = { podcast_guid: 'show-1', image: 'https://art.example/s.jpg' }
  // Three rows built so chart order and air-date order DIFFER: `old` leads
  // every figure and airs first.
  const rows = [
    { item_guid: 'old', title: 'Old', image: null, published: 100, duration: 60, boost_count: 9, total_sats: 9000, booster_count: 5 },
    { item_guid: 'mid', title: 'Mid', image: 'https://art.example/m.jpg', published: 200, duration: 3660, boost_count: 1, total_sats: 10, booster_count: 1 },
    { item_guid: 'new', title: 'New', image: null, published: 300, duration: 0, boost_count: 2, total_sats: 500, booster_count: 2 },
  ]

  // The podcast drawer: the catalogue.
  assert.equal(COPY.podcast.catalogue, true)
  assert.equal(COPY.podcast.drawer, 'Episodes')
  assert.equal(COPY.podcast.allItems, null)
  let html = renderEpisodes(rows, show, COPY.podcast)
  assert.ok(html.includes('<details class="ep-drawer" data-episode-drawer data-catalogue data-ep-sort="latest" data-glyph="🎙">'))
  assert.ok(html.includes('<div class="cs-controls" data-ep-controls hidden></div>'), 'band ships hidden and empty')
  assert.ok(!html.includes('boostmebitch.com'), 'no BMB link on the podcast drawer')
  assert.ok(html.includes('<p class="ep-status" data-ep-status hidden></p>'))
  assert.ok(!html.includes('data-ep-empty'), 'no empty state when there are rows')
  const guids = [...html.matchAll(/data-guid="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(guids, rows.map((r) => r.item_guid), 'every indexed row carries its guid, in air-date order')
  assert.equal((html.match(/ep-row ep-row--indexed/g) || []).length, 3, 'every indexed row wears the outline')
  assert.ok(html.includes('data-ep="5,9,9000,100"'))
  assert.ok(html.includes('href="/episode/old"'))
  assert.ok(html.includes('Jan 1, 1970 · 1h 1m · 10 sats · 1 boost'), 'the meta line the catalogue restates')
  assert.ok(html.includes('src="https://art.example/s.jpg"'), 'a row with no art takes the show art')

  // Empty: the drawer still renders, with the empty line INSIDE it.
  html = renderEpisodes([], show, COPY.podcast)
  assert.ok(html.includes('data-episode-drawer data-catalogue'))
  assert.ok(html.includes('<p class="show-empty ep-empty" data-ep-empty>No episodes with Nostr boosts yet.</p>'))
  assert.ok(html.includes('<ul class="ep-list">'))

  // The music drawer: still the boosted list, chart-ordered, with its way out.
  assert.equal(COPY.music.catalogue, false)
  html = renderEpisodes(rows, show, COPY.music)
  assert.ok(html.includes('<details class="ep-drawer" data-episode-drawer>'), 'no catalogue attributes')
  assert.ok(html.includes('href="https://boostmebitch.com/?podcast=show-1"'))
  assert.ok(html.includes('See All Tracks'))
  assert.ok(!html.includes('data-ep-controls hidden'), 'band ships visible, carrying the link')
  assert.ok(!html.includes('data-guid='))
  assert.ok(!html.includes('ep-row--indexed'))
  assert.ok(!html.includes('data-ep-status'))
  const order = [...html.matchAll(/data-ep="([^"]+)"/g)].map((m) => m[1])
  assert.equal(order[0], '5,9,9000,100', 'chart order leads with the row that wins every figure')
  html = renderEpisodes([], show, COPY.music)
  assert.ok(!html.includes('<details'), 'the music empty state is the one-line section it always was')
  assert.ok(html.includes('No tracks with Nostr boosts yet.'))
}

console.log('test-catalogue: all assertions passed')
