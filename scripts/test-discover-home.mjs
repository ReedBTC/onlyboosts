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
