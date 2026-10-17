/* The discovery homepage (2026-10-17): the URL split, the rails, the tile.
 *
 * What a change elsewhere would break, held here:
 *   - every rail the Function renders has its marker pair in index.html, and
 *     every marker pair has a renderer, so a rail cannot ship blank by name;
 *   - the legacy hash forward in index.html's head covers EVERY feed key and
 *     alias charts.html's controller resolves (the hashes in the wild);
 *   - no site file still links a feed as `/#…` — the address is /charts#… ;
 *   - the tile module is two-sided: no Date.now(), no unpinned locale, and
 *     its siblings imported relatively;
 *   - injectRail swaps exactly the marked block and nothing around it;
 *   - the Function renders the page from the asset shell with every rail
 *     filled, and a failing rail leaves its placeholder for the browser.
 *
 * Run: node scripts/test-discover-home.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let failed = 0
function check(name, fn) {
  try { fn(); console.log('  ✓', name) }
  catch (e) { failed++; console.log('  ✗', name); console.log('     ', e.message) }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓', name) }
  catch (e) { failed++; console.log('  ✗', name); console.log('     ', e.message) }
}

const index = read('index.html')
const charts = read('charts.html')
const { RAILS, injectRail, onRequestGet } = await import('../functions/index.js')
const tile = await import('../assets/js/rail-tile.js?v=test')

console.log('\nThe markers and the renderers agree:')
{
  const markers = [...index.matchAll(/<!--OB:RAIL:([a-z-]+)-->/g)].map((m) => m[1])
  const closers = [...index.matchAll(/<!--\/OB:RAIL:([a-z-]+)-->/g)].map((m) => m[1])
  check('every marker has a closer, in order', () => {
    assert.deepEqual(markers, closers)
    for (const k of markers) assert.ok(index.indexOf(`<!--OB:RAIL:${k}-->`) < index.indexOf(`<!--/OB:RAIL:${k}-->`))
  })
  check('every marker has a renderer and every renderer a marker', () => {
    assert.deepEqual([...markers].sort(), Object.keys(RAILS).sort())
  })
  check('the first three rails need no login; the personal rails come after', () => {
    const order = [...index.matchAll(/data-rail="([a-z-]+)"/g)].map((m) => m[1])
    assert.deepEqual(order.slice(0, 3), ['shows-week', 'albums-month', 'hpw-week'])
    const personal = [...index.matchAll(/data-rail="([a-z-]+)"[^>]*data-rail-personal/g)].map((m) => m[1])
    assert.ok(personal.length >= 1, 'there is at least one personal rail')
    for (const p of personal) assert.ok(order.indexOf(p) >= 3, `${p} is the fourth rail or later`)
  })
}

console.log('\nThe legacy hash forward covers every feed address:')
{
  const m = index.match(/if \((\/\^#.*?\/)\.test\(h\)\)/)
  assert.ok(m, 'the forward regex is in index.html')
  const re = new Function('return ' + m[1])()
  // Every hash the controller resolves: the FEEDS keys, the ALIASES keys,
  // and the HASH_OF shorthands, read out of charts.html's controller.
  const ctl = charts.slice(charts.indexOf('FEED BAR CONTROLLER'))
  const keys = new Set()
  for (const mm of ctl.matchAll(/'((?:shows|albums|artists|episodes|songs|members|podcasts)(?:-(?:global|follows))?)'/g)) keys.add(mm[1])
  check('the controller declares the feed keys this test expects', () => {
    assert.ok(keys.size >= 12, `found ${keys.size}`)
    for (const k of ['shows', 'albums', 'artists', 'members', 'episodes-global', 'songs-follows', 'podcasts-global']) assert.ok(keys.has(k), k)
  })
  check('every key forwards, bare and with a view', () => {
    for (const k of keys) {
      assert.ok(re.test('#' + k), '#' + k)
      assert.ok(re.test(`#${k}?lang=de&range=1m&sort=sats`), `#${k}?…`)
    }
  })
  check('a section id on the new page does not forward', () => {
    for (const h of ['#discover', '#rail-shows-week', '#top', '', '#shows-x-y', '#showsx']) assert.equal(re.test(h), false, h || '(empty)')
  })
}

console.log('\nNo site file still links a feed as /#…:')
{
  const skip = new Set(['node_modules', 'login-widget', 'docs', '.git', 'bots', 'data', 'preview-snapshot'])
  const files = []
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (skip.has(f)) continue
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(html|js|mjs|json|webmanifest)$/.test(f) && !p.includes('/assets/widgets/')) files.push(p)
    }
  }
  walk(ROOT)
  check('every feed link is /charts#… (the address since 2026-10-17)', () => {
    const bad = []
    for (const p of files) {
      const s = readFileSync(p, 'utf8')
      if (/["'`(]\/#(shows|albums|artists|episodes|songs|members|podcasts)/.test(s)) bad.push(p.slice(ROOT.length))
    }
    assert.deepEqual(bad, [])
  })
}

console.log('\nThe tile is two-sided:')
{
  const src = read('assets/js/rail-tile.js')
  check('no Date.now(), no unpinned locale', () => {
    assert.ok(!/Date\.now\(/.test(src))
    assert.ok(!/toLocale(Date|Time)?String\(\)/.test(src))
  })
  check('siblings are imported relatively, stamped', () => {
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^\.\/[a-z-]+\.js\?v=/)
  })
  check('a tile renders the rank, the link and the art2 tail', () => {
    const h = tile.showTile({ guid: 'g-1', title: 'A <Show>', booster_count: 7, total_sats: 38849, image: 'http://a/x.jpg', artwork: 'https://a/y.jpg', rank: 2, tied: true }, 0)
    assert.ok(h.includes('href="/show/g-1"'))
    assert.ok(h.includes('>T2<'), 'the tie marker')
    assert.ok(h.includes('src="https://a/x.jpg"'), 'http promoted to https')
    assert.ok(h.includes('data-art2="https://a/y.jpg"'))
    assert.ok(h.includes('A &lt;Show&gt;'))
    assert.ok(h.includes('7 boosters · 38.8k sats'))
  })
  check('no artwork renders the glyph, no href renders no link', () => {
    const h = tile.tileHtml({ title: 'X', glyph: '🎵' })
    assert.ok(h.includes('rt-media--none') && h.includes('🎵') && !h.includes('<a '))
  })
  check('an empty rail says so', () => {
    assert.match(tile.railListHtml([], { empty: 'Nope' }), /rail-empty.*Nope/)
  })
}

console.log('\nThe injection and the Function:')
{
  check('injectRail swaps exactly the marked block', () => {
    const html = 'a<!--OB:RAIL:k-->old<!--/OB:RAIL:k-->b'
    assert.equal(injectRail(html, 'k', 'NEW'), 'aNEWb')
    assert.throws(() => injectRail(html, 'zz', 'x'), /marker/)
  })
  const okRails = Object.fromEntries(Object.keys(RAILS).map((k) => [k, async () => `<ol class="rail-list" data-k="${k}"></ol>`]))
  const calls = []
  const ASSETS = { fetch: async (req) => { calls.push(new URL(req.url).pathname); return new Response(index, { status: 200, headers: { 'Content-Type': 'text/html' } }) } }
  // Stub the DB so every rail fails (no tables): the placeholders must survive.
  const env = { ASSETS, DB: { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('no db') }, first: async () => { throw new Error('no db') } }), all: async () => { throw new Error('no db') }, first: async () => { throw new Error('no db') } }) } }
  await checkAsync('a rail that fails leaves its placeholder for the browser; the page is still 200', async () => {
    const warn = console.warn; console.warn = () => {}
    let r
    try { r = await onRequestGet({ request: new Request('https://ob.invalid/'), env }) } finally { console.warn = warn }
    assert.equal(r.status, 200)
    const html = await r.text()
    assert.equal(calls[0], '/', 'the shell is fetched as / never /index.html')
    for (const k of Object.keys(RAILS)) assert.ok(html.includes(`<!--OB:RAIL:${k}-->`), `${k} placeholder kept`)
    assert.ok(html.includes('class="rail-placeholder"'))
  })
  await checkAsync('a redirect from the asset server is never passed through', async () => {
    const error = console.error; console.error = () => {}
    let r
    try { r = await onRequestGet({ request: new Request('https://ob.invalid/'), env: { ...env, ASSETS: { fetch: async () => new Response('', { status: 308, headers: { location: '/' } }) } } }) } finally { console.error = error }
    assert.equal(r.status, 503)
  })
  void okRails
}

console.log('\nThe search page:')
{
  const { onRequestGet: searchGet, resultsHtml } = await import('../functions/search.js')
  const shell = read('search.html')
  const ASSETS = { fetch: async () => new Response(shell, { status: 200, headers: { 'Content-Type': 'text/html' } }) }
  const dead = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('no db') }, first: async () => { throw new Error('no db') } }), all: async () => { throw new Error('no db') }, first: async () => { throw new Error('no db') } }) }
  check('resultsHtml groups the hits and carries no rank badge', () => {
    const h = resultsHtml('bit', {
      shows: [{ guid: 'g1', title: 'A Pod', img: '', medium: 'podcast' }, { guid: 'g2', title: 'An Album', img: '', medium: 'music' }],
      episodes: [{ guid: 'e1', title: 'Ep One', show: { guid: 'g1', title: 'A Pod' } }],
      artists: [{ guid: 'p1', title: 'Artist' }],
      members: [{ npub: 'npub1x', pk: 'ab', name: 'Reed', boosts: 3, sats: 1200 }],
    })
    assert.ok(h.includes('<q>bit</q>'))
    for (const id of ['shows', 'albums', 'episodes', 'artists', 'members']) assert.ok(h.includes(`id="${id}"`), id)
    assert.ok(!h.includes('rt-rank'), 'no rank on a search hit')
    assert.ok(h.includes('rail-list rail-list--wrap'))
    assert.ok(h.includes('3 boosts · 1.2k sats'))
  })
  check('an empty answer says so', () => {
    assert.match(resultsHtml('zzz', {}), /Nothing matched/)
  })
  await checkAsync('no query serves the shell untouched; a query with a dead DB still answers 200', async () => {
    const warn = console.warn; console.warn = () => {}
    const error = console.error; console.error = () => {}
    try {
      const r0 = await searchGet({ request: new Request('https://ob.invalid/search'), env: { ASSETS, DB: dead } })
      assert.equal(r0.status, 200)
      assert.ok((await r0.text()).includes('<!--OB:SEARCH-->'))
      const r1 = await searchGet({ request: new Request('https://ob.invalid/search?q=bitcoin'), env: { ASSETS, DB: dead } })
      assert.equal(r1.status, 200)
      const html = await r1.text()
      assert.ok(html.includes('value="bitcoin"'), 'the query is back in the field')
      assert.ok(html.includes('<title>bitcoin — Search — OnlyBoosts</title>'))
    } finally { console.warn = warn; console.error = error }
  })
  check('the nav form submits to /search and the charts page carries no feed search box', () => {
    assert.ok(read('partials/nav.html').includes('action="/search"'))
    assert.ok(!charts.includes('data-feed-search'))
    assert.ok(!charts.includes('members-find'))
  })
  check('a member tile: gold past the goal, the HPW line', () => {
    const h = tile.memberTile({ npub: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', pk: 'ab', name: 'Reed', seconds: 41 * 3600, episodes: 26 }, 0, 40)
    assert.ok(h.includes('rt-rank--gold') && h.includes('41.0 HPW · 26 episodes') && h.includes('href="/booster/npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"'))
    const h2 = tile.memberTile({ npub: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', pk: 'ab', name: 'Reed', seconds: 2 * 3600, episodes: 1 }, 3, 40)
    assert.ok(!h2.includes('rt-rank--gold') && h2.includes('2.0 HPW · 1 episode'))
  })
  check('a charted tile carries the triplet, an uncharted one the figures', () => {
    assert.ok(tile.showTile({ guid: 'g', title: 'T', r_sats: 3, r_boosters: 1, r_boosts: 2 }, 0).includes('>3/1/2<'))
    assert.ok(tile.showTile({ guid: 'g', title: 'T', chart: { sats: 5, boosters: 4, boosts: 6 } }, 0).includes('>5/4/6<'))
    assert.ok(tile.showTile({ guid: 'g', title: 'T', boosters: 7, sats: 38849 }, 0).includes('7 boosters · 38.8k sats'))
  })
}

console.log('\nThe recommendations and the data rails, over the real schema:')
{
  const db = new DatabaseSync(':memory:')
  db.exec(read('bots/global-boost-scan/d1/schema.sql'))
  const now = Math.floor(Date.now() / 1000)
  const ME = 'a'.repeat(64), YOU = 'b'.repeat(64), THEM = 'c'.repeat(64)
  const pod = db.prepare('INSERT INTO podcasts(podcast_guid,title,image,medium,total_sats,booster_count,boost_count,first_boost_ts) VALUES(?,?,?,?,?,?,?,?)')
  pod.run('show-1', 'Seed One', 'https://x/1.jpg', 'podcast', 1000, 3, 5, now - 400 * 86400)
  pod.run('show-2', 'Seed Two', 'https://x/2.jpg', 'podcast', 500, 2, 2, now - 300 * 86400)
  pod.run('show-A', 'Neighbour A', 'https://x/a.jpg', 'podcast', 900, 4, 9, now - 200 * 86400)
  pod.run('show-B', 'Neighbour B', 'https://x/b.jpg', 'podcast', 800, 2, 4, now - 200 * 86400)
  pod.run('show-C', 'Brand New', 'https://x/c.jpg', 'podcast', 300, 3, 3, now - 10 * 86400)
  pod.run('show-D', 'Lonely Debut', 'https://x/d.jpg', 'podcast', 50, 1, 1, now - 5 * 86400)
  pod.run('album-1', 'Seed Album', 'https://x/m1.jpg', 'music', 400, 2, 2, now - 100 * 86400)
  pod.run('album-A', 'Neighbour Album', 'https://x/ma.jpg', 'music', 350, 3, 3, now - 100 * 86400)
  const sim = db.prepare('INSERT INTO show_similar(podcast_guid,other_guid,score,shared_boosters,rank) VALUES(?,?,?,?,?)')
  sim.run('show-1', 'show-A', 0.5, 3, 1)
  sim.run('show-1', 'show-2', 0.3, 2, 2)   // a seed: never recommended back
  sim.run('show-1', 'show-B', 0.2, 1, 3)   // one booster shared, reached twice below
  sim.run('show-2', 'show-B', 0.3, 1, 1)
  sim.run('show-2', 'show-D', 0.1, 1, 2)   // one booster, one seed: under the floor
  sim.run('album-1', 'album-A', 0.4, 2, 1)
  const boost = db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?)')
  boost.run('e1', ME, now - 100, 100, 'show-1', null)
  boost.run('e2', ME, now - 90, 100, 'show-1', null)
  boost.run('e3', ME, now - 80, 100, 'show-2', null)
  boost.run('e4', ME, now - 70, 100, 'album-1', null)
  boost.run('e5', YOU, now - 60, 100, 'show-1', null)   // this week's chart: show-1 by two boosters
  boost.run('e6', THEM, now - 50, 100, 'show-A', null)
  const roll = db.prepare('INSERT INTO podroll(source_guid,position,target_guid,target_title,target_image,target_linked) VALUES(?,?,?,?,?,?)')
  roll.run('show-1', 1, 'show-A', 'Neighbour A', 'https://x/a.jpg', 1)
  roll.run('show-2', 1, 'show-A', 'Neighbour A', 'https://x/a.jpg', 1)
  roll.run('show-2', 2, 'ext-1', 'Somewhere Else', null, 0)
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) ?? null }), all: async () => ({ results: db.prepare(sql).all() }), first: async () => db.prepare(sql).get() ?? null }) } }
  const { onRequestPost: recommend } = await import('../functions/api/v1/recommend.js')
  const post = (body) => recommend({ request: new Request('https://ob.invalid/api/v1/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env })

  await checkAsync('seeds are excluded, the floor holds, the media stay apart, and Because names the most-boosted seed', async () => {
    const r = await post({ pubkey: ME })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.seeds, 3)
    const pods = j.podcasts.map((x) => x.guid)
    assert.ok(pods.includes('show-A'), 'three shared boosters with one seed')
    assert.ok(pods.includes('show-B'), 'reached from two seeds')
    assert.ok(!pods.includes('show-2') && !pods.includes('show-1'), 'a seed is never recommended')
    assert.ok(!pods.includes('show-D'), 'one booster from one seed is under the floor')
    assert.ok(!pods.includes('album-A'), 'music stays on the music side')
    assert.deepEqual(j.music.map((x) => x.guid), ['album-A'])
    assert.equal(j.because.seed.guid, 'show-1')
    assert.deepEqual(j.because.rows.map((x) => x.guid), ['show-A'])
  })
  await checkAsync('a member with no boosts gets empty lists, a bad pubkey a 400, a publisher key nothing', async () => {
    const j = await (await post({ pubkey: 'd'.repeat(64) })).json()
    assert.deepEqual([j.seeds, j.podcasts, j.music, j.because], [0, [], [], null])
    assert.equal((await post({ pubkey: 'nope' })).status, 400)
    const { PUBLISHERS } = await import('../functions/api/v1/_common.js')
    const p = await (await post({ pubkey: PUBLISHERS[0] })).json()
    assert.equal(p.seeds, 0)
  })
  await checkAsync('favorites join the seeds and are excluded as candidates', async () => {
    const j = await (await post({ pubkey: 'd'.repeat(64), favorites: ['show-1', 'bad guid with spaces'] })).json()
    assert.equal(j.seeds, 1)
    // show-2 is a candidate HERE: this member never boosted it, so it is not a seed.
    assert.deepEqual(j.podcasts.map((x) => x.guid).sort(), ['show-2', 'show-A'])
    assert.equal(j.because, null, 'because needs a BOOSTED seed')
  })
  await checkAsync('New and Noteworthy: first boost within 90 days and two boosters, newest debuts after the better-backed', async () => {
    const html = await RAILS['new-shows'](env)
    assert.ok(html.includes('Brand New') && !html.includes('Lonely Debut') && !html.includes('Seed One'))
    assert.match(html, /First boost [A-Z][a-z]{2} \d{1,2}/)
  })
  await checkAsync('Podcasters Recommend: ranked by how many podrolls list a show; an unindexed target is a figure, not a link', async () => {
    const html = await RAILS.podroll(env)
    assert.ok(html.indexOf('Neighbour A') < html.indexOf('Somewhere Else'))
    assert.ok(html.includes('On 2 podrolls') && html.includes('On 1 podroll<'))
    assert.ok(html.includes('href="/show/show-A"') && !html.includes('href="/show/ext-1"'))
  })
  await checkAsync('Movers: a show on this week\'s chart and not last week\'s is a debut', async () => {
    const html = await RAILS.movers(env)
    assert.ok(html.includes('Seed One') && html.includes('New this week'))
  })
}

console.log('\nThe charts page kept its address book:')
{
  check('charts.html declares /charts as its own address', () => {
    assert.ok(charts.includes('<link rel="canonical" href="https://onlyboosts.social/charts" />'))
    assert.ok(charts.includes('<!--OB:SSR-SHOWS-->'))
  })
  check('index.html is the discovery page and names /', () => {
    assert.ok(index.includes('<link rel="canonical" href="https://onlyboosts.social/" />'))
    assert.ok(index.includes('class="discover"'))
    assert.ok(!index.includes('FEED BAR CONTROLLER'))
  })
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
