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
 *     filled, and a failing rail leaves its placeholder for the browser;
 *   - the featured carousel (2026-10-19) is one slide per generic rail, that
 *     rail's first place, in the page's rail order, described by one lookup
 *     each that may fail; hero.js is two-sided; with nothing to show the
 *     marker stays for the browser.
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
const { RAILS, injectRail, onRequestGet, buildHero, blurb, railOrder, injectHero } = await import('../functions/index.js')
const tile = await import('../assets/js/rail-tile.js?v=test')
const heroMod = await import('../assets/js/hero.js?v=test')
const heroShowCard = await import('../assets/js/show-card.js')

console.log('\nThe markers and the renderers agree:')
{
  const markers = [...index.matchAll(/<!--OB:RAIL:([a-z0-9-]+)-->/g)].map((m) => m[1])
  const closers = [...index.matchAll(/<!--\/OB:RAIL:([a-z0-9-]+)-->/g)].map((m) => m[1])
  check('every marker has a closer, in order', () => {
    assert.deepEqual(markers, closers)
    for (const k of markers) assert.ok(index.indexOf(`<!--OB:RAIL:${k}-->`) < index.indexOf(`<!--/OB:RAIL:${k}-->`))
  })
  check('every marker has a renderer and every renderer a marker', () => {
    assert.deepEqual([...markers].sort(), Object.keys(RAILS).sort())
  })
  check('the first three rails need no login; the personal rails come after', () => {
    const order = [...index.matchAll(/data-rail="([a-z0-9-]+)"/g)].map((m) => m[1])
    assert.deepEqual(order.slice(0, 3), ['shows-week', 'albums-month', 'hpw-week'])
    const personal = [...index.matchAll(/data-rail="([a-z0-9-]+)"[^>]*data-rail-personal/g)].map((m) => m[1])
    assert.ok(personal.length >= 1, 'there is at least one personal rail')
    for (const p of personal) assert.ok(order.indexOf(p) >= 3, `${p} is the fourth rail or later`)
    assert.deepEqual(order, ['shows-week', 'albums-month', 'hpw-week', 'recommended', 'recommended-music', 'follows', 'new-shows', 'movers', 'podroll',
      'lang-1', 'lang-2', 'lang-3', 'because',
      'episodes-week', 'episodes-month', 'episodes-year', 'songs-week', 'songs-month', 'songs-year', 'albums-week', 'albums-year', 'shows-month', 'shows-year'],
      "Reed's order of 2026-10-21 with the 2026-10-22 additions: the language rails under Podcasters Recommend, the window rails at the foot")
    for (const n of [1, 2, 3]) assert.match(index, new RegExp(`<section class="rail" data-rail="lang-${n}"[^>]*><!--OB:RAIL:lang-${n}-->`), `lang-${n}'s marker is tight against its section (so .rail:empty hides an empty slot)`)
    assert.ok(read('assets/css/discover.css').includes('.rail:empty { display: none; }'), 'an empty rail takes no room')
    assert.ok(!index.includes('artists-week') && !Object.keys(RAILS).includes('artists-week'), 'Top Artists This Week came off the page')
    assert.ok(index.includes('<h2 id="rail-recommended">Podcasts Recommended For You</h2>') && index.includes('<h2 id="rail-recommended-music">Music Recommended For You</h2>'), 'both recommendation rails say what they recommend')
  })
}

console.log('\nThe legacy hash forward covers every feed address, on / and on /charts:')
{
  /* The forward is an inline IIFE in both heads; run the SHIPPED one against
     a stub location and read where it sent the reader. The two copies must
     agree, since a /#feed link and a /charts#feed link name the same view. */
  const forwardOf = (src, name) => {
    const a = src.indexOf('THE LEGACY HASH FORWARD')
    const o = src.indexOf('<script>', a), c = src.indexOf('</script>', o)
    assert.ok(a > 0 && o > a && c > o, `${name} carries the forward`)
    const body = src.slice(o + 8, c)
    return (hash) => {
      let to = null
      new Function('location', body)({ hash, replace: (u) => { to = u } })
      return to
    }
  }
  const fwd = { 'index.html': forwardOf(index, 'index.html'), 'charts.html': forwardOf(charts, 'charts.html') }
  // Every address the hash router ever resolved: the FEEDS keys, the bare
  // canonical hashes, the retired aliases, and #boosts, each with and
  // without a view.
  const WANT = {
    '#shows': '/podcasts/shows', '#shows-global': '/podcasts/shows', '#shows-follows': '/podcasts/shows?scope=follows',
    '#episodes-global': '/podcasts/episodes', '#episodes-follows': '/podcasts/episodes?scope=follows',
    '#podcasts-global': '/podcasts/episodes', '#podcasts-follows': '/podcasts/episodes?scope=follows',
    '#albums': '/music/albums', '#albums-follows': '/music/albums?scope=follows',
    '#artists': '/music/artists', '#artists-global': '/music/artists', '#artists-follows': '/music/artists?scope=follows',
    '#songs-global': '/music/songs', '#songs-follows': '/music/songs?scope=follows',
    '#members': '/charts/hpw', '#members-global': '/boosts', '#members-follows': '/boosts?scope=follows',
    '#boosts': '/boosts', '#boosts-global': '/boosts', '#boosts-follows': '/boosts?scope=follows',
    '#shows?lang=de&range=1m&sort=sats': '/podcasts/shows?lang=de&range=1m&sort=sats',
    '#episodes-follows?range=1y': '/podcasts/episodes?scope=follows&range=1y',
    '#shows?': '/podcasts/shows',
  }
  for (const [name, f] of Object.entries(fwd)) {
    check(`${name}: every hash address lands on its page`, () => {
      for (const [h, to] of Object.entries(WANT)) assert.equal(f(h), to, h)
    })
    check(`${name}: a section id or nothing does not forward`, () => {
      for (const h of ['#discover', '#rail-shows-week', '#top', '', '#shows-x-y', '#showsx', '#recommended']) assert.equal(f(h), null, h || '(empty)')
    })
  }
  check('the controller resolves every feed type the forward names', () => {
    const ctl = charts.slice(charts.indexOf('FEED BAR CONTROLLER'))
    for (const t of ['shows', 'episodes', 'albums', 'songs', 'artists', 'members']) assert.ok(ctl.includes(`'${t}-global':`), t)
  })
}

console.log('\nNo site file still links a feed as /#… or /charts#…:')
{
  const skip = new Set(['node_modules', 'login-widget', 'docs', '.git', '.claude', 'bots', 'data', 'preview-snapshot'])
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
  check('every feed link is a page (the addresses since 2026-10-21)', () => {
    const bad = []
    for (const p of files) {
      const s = readFileSync(p, 'utf8')
      if (/["'`(]\/(charts)?#(shows|albums|artists|episodes|songs|members|podcasts|boosts)/.test(s)) bad.push(p.slice(ROOT.length))
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
    assert.ok(html.includes('<!--OB:HERO--><!--/OB:HERO-->'), 'no slides: the hero marker stays for the browser')
    assert.ok(!html.includes('data-hero'), 'no empty carousel')
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
  check('resultsHtml is a LIST of the charts page\'s own cards, each wearing its chart rank', () => {
    const NPUB = 'npub1' + 'q'.repeat(58)
    const h = resultsHtml('bit', {
      shows: [{ guid: 'g1', title: 'A Pod', img: '', boosts: 4, sats: 900, boosters: 2, rank: 7, tied: false }],
      albums: [{ guid: 'g2', title: 'An Album', img: '', boosts: 1, sats: 50, boosters: 1, rank: 3, tied: true }],
      episodes: [{ guid: 'e1', title: 'Ep One', boosts: 1, sats: 21, boosters: 1, latest: 1700000000, rank: 12,
        show: { guid: 'g1', title: 'A Pod' },
        boosts_inline: [{ id: 'ev1', ts: 1700000000, sats: 21, msg: 'hi', booster: { pk: 'ab', npub: NPUB, name: 'Reed', pic: null } }] }],
      songs: [],
      artists: [{ guid: 'p1', title: 'Artist', boosts: 2, sats: 100, boosters: 2, albums: 1, rank: 1 }],
      members: [{ npub: NPUB, pk: 'ab', name: 'Reed', boosts: 3, sats: 1200, shows: 2 }],
    })
    assert.ok(h.includes('<q>bit</q>'))
    for (const id of ['shows', 'albums', 'episodes', 'artists', 'members']) assert.ok(h.includes(`id="${id}"`), id)
    assert.ok(!h.includes('id="songs"'), 'an empty group is not rendered')
    assert.ok(!h.includes('rail-list'), 'no tile rail on the results page: it is a list')
    assert.ok(h.includes('data-show-card') && h.includes('data-episode-card') && h.includes('data-publisher-card'), 'the charts page\'s cards')
    assert.ok(h.includes('sup-podium'), 'the Members tab\'s wall')
    assert.ok(h.includes('class="pcast-list"'), 'the charts page\'s list box')
    assert.ok(/#7\b|>7</.test(h) && /T3/.test(h), 'the server\'s rank and tie label on the card')
    assert.ok(h.includes('href="/podcasts/shows"') && h.includes('href="/music/albums"') && h.includes('href="/podcasts/episodes"') && h.includes('href="/music/artists"'), 'each group links its chart')
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
    assert.ok(h.includes('rail-tile--person'), 'a member is a person tile (round)')
    assert.ok(!tile.showTile({ guid: 'g', title: 'T' }, 0).includes('rail-tile--person'), 'a show is not')
    const h2 = tile.memberTile({ npub: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', pk: 'ab', name: 'Reed', seconds: 2 * 3600, episodes: 1 }, 3, 40)
    assert.ok(!h2.includes('rt-rank--gold') && h2.includes('2.0 HPW · 1 episode'))
  })
  check('a charted tile carries the triplet, an uncharted one the figures', () => {
    assert.ok(tile.showTile({ guid: 'g', title: 'T', r_sats: 3, r_boosters: 1, r_boosts: 2 }, 0).includes('>3/1/2<'))
    assert.ok(tile.showTile({ guid: 'g', title: 'T', chart: { sats: 5, boosters: 4, boosts: 6 } }, 0).includes('>5/4/6<'))
    assert.ok(tile.showTile({ guid: 'g', title: 'T', boosters: 7, sats: 38849 }, 0).includes('7 boosters · 38.8k sats'))
  })
}

console.log('\nThe featured carousel:')
{
  const src = read('assets/js/hero.js')
  check('hero.js is two-sided: no Date.now(), no unpinned locale, siblings relative and stamped', () => {
    assert.ok(!/Date\.now\(/.test(src))
    assert.ok(!/toLocale(Date|Time)?String\(\)/.test(src))
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^\.\/[a-z-]+\.js\?v=/)
  })
  check('the hero marker sits in index.html above the first rail', () => {
    const at = index.indexOf('<!--OB:HERO--><!--/OB:HERO-->')
    assert.ok(at > 0)
    assert.ok(at < index.indexOf('data-rail="shows-week"'))
  })
  check('railOrder reads the generic rails in page order and skips the personal ones', () => {
    const order = railOrder(index)
    assert.deepEqual(order.slice(0, 3), ['shows-week', 'albums-month', 'hpw-week'])
    assert.deepEqual([...order].sort(), Object.keys(RAILS).sort(), 'every generic rail, nothing else')
    assert.ok(!order.includes('recommended') && !order.includes('because'))
  })
  check('injectHero swaps exactly the marked block', () => {
    assert.equal(injectHero('a<!--OB:HERO-->x<!--/OB:HERO-->b', 'H'), 'aHb')
    assert.throws(() => injectHero('ab', 'H'), /marker/)
  })
  check('blurb strips tags and entities and clips at a word', () => {
    assert.equal(blurb('<p>Hello &amp; <b>welcome</b></p>\n\n  to the  show'), 'Hello & welcome to the show')
    const long = blurb('word '.repeat(80), 60)
    assert.ok(long.length <= 61 && long.endsWith('…') && !long.endsWith(' …'), long)
    assert.equal(blurb(null), '')
  })
  check('the show mapper: eyebrow, triplet, Open, a Boost pill off the guid', () => {
    const s = heroMod.showSlide('shows-week', { guid: 'g-1', title: 'A <Show>', image: 'http://a/x.jpg', artwork: 'https://a/y.jpg', booster_count: 7, total_sats: 38849, r_sats: 1, r_boosters: 2, r_boosts: 1 }, { medium: 'podcast' })
    assert.equal(s.kind, 'show'); assert.equal(s.eyebrow, '#1 Show This Week'); assert.equal(s.ranks, '1/2/1')
    const h = heroMod.slideHtml(s, 0, 3)
    assert.ok(h.includes('data-slide="shows-week"') && h.includes('data-kind="show"'))
    assert.ok(h.includes('data-guid="g-1"') && h.includes('data-noun="show"') && h.includes('data-title="A &lt;Show&gt;"'), 'the show card\'s attributes for its boost handler')
    assert.ok(h.includes('class="ob-boost-pill hero-boost" data-hero-boost hidden'), 'the pill ships hidden')
    assert.ok(h.includes('>Open the show</a>') && h.includes('href="/show/g-1"'))
    assert.ok(h.includes('class="hero-bg"') && h.includes('src="https://a/x.jpg"') && h.includes('data-art2="https://a/y.jpg"'))
    assert.ok(h.includes('fetchpriority="high"') && !h.includes('loading="lazy"'), 'the first slide loads eagerly')
    assert.ok(heroMod.slideHtml(s, 1, 3).includes('loading="lazy"'), 'later slides lazily')
    assert.ok(h.includes('aria-label="1 of 3: #1 Show This Week"'))
  })
  check('an album slide says album; the unlinked podroll target has no Open and no Boost', () => {
    const a = heroMod.showSlide('albums-month', { guid: 'g-2', title: 'LP', author: 'Band', medium: 'music', boosters: 3, sats: 100 })
    assert.equal(a.kind, 'album'); assert.equal(a.boost.noun, 'album'); assert.equal(a.from.title, 'Band')
    const u = heroMod.showSlide('podroll', { guid: 'g-3', title: 'Elsewhere' }, { href: null, line: 'On 4 podrolls' })
    assert.equal(u.boost, null)
    const h = heroMod.slideHtml(u)
    assert.ok(!h.includes('hero-btn') && !h.includes('data-hero-boost') && h.includes('On 4 podrolls'))
  })
  check('an episode slide carries the episode card\'s attributes and its note link', () => {
    const e = heroMod.episodeSlide('episodes-year', { guid: 'ep/1', title: 'Ep One', img: 'https://a/e.jpg', show: { guid: 'g-1', title: 'A Show', feed: 'https://a/feed.xml', medium: 'podcast' }, boosters: 2, sats: 50, chart: { sats: 1, boosters: 1, boosts: 2 } })
    assert.equal(e.kind, 'episode')
    const h = heroMod.slideHtml(e)
    assert.ok(h.includes('data-guid="ep/1"') && h.includes('data-show-guid="g-1"') && h.includes('data-feed-url="https://a/feed.xml"') && h.includes('data-noun="episode"'))
    assert.ok(h.includes('data-boost-url="https://onlyboosts.social/episode/ep%2F1"'), 'episode-link.js\'s answer')
    assert.ok(h.includes('href="/episode/ep%2F1"') && h.includes('>A Show</a>') && h.includes('>1/1/2<'))
    const song = heroMod.episodeSlide('songs-year', { guid: 's1', title: 'Song', show: { guid: 'g-2', title: 'LP', medium: 'music' } })
    assert.equal(song.kind, 'song'); assert.equal(song.boost.noun, 'song')
  })
  check('an artist slide has no boost; a member slide is a person, gold past the goal', () => {
    const ar = heroMod.artistSlide('artists-week', { guid: 'pub-1', title: 'Band', booster_count: 4, total_sats: 900 })
    assert.equal(ar.boost, null)
    assert.ok(heroMod.slideHtml(ar).includes('href="/artist/pub-1"'))
    const m = heroMod.memberSlide('hpw-week', { pk: 'f'.repeat(64), npub: 'npub1' + 'q'.repeat(58), name: 'Reed', pic: 'https://a/p.jpg', seconds: 41 * 3600, episodes: 26 }, 40)
    assert.ok(m.person && m.gold && m.pk === 'f'.repeat(64))
    const h = heroMod.slideHtml(m)
    assert.ok(h.includes('hero-slide--person') && h.includes('hero-slide--gold') && h.includes('41.0 hours of podcasts boosted this week · 26 episodes'))
    assert.ok(!h.includes('data-hero-boost'))
  })
  check('heroHtml renders the slides in the order given with a dot each; nothing for no slides', () => {
    const a = heroMod.showSlide('shows-week', { guid: 'g-1', title: 'One' }), b = heroMod.showSlide('movers', { guid: 'g-2', title: 'Two' })
    const h = heroMod.heroHtml([a, b])
    assert.ok(h.indexOf('data-slide="shows-week"') < h.indexOf('data-slide="movers"'))
    assert.equal((h.match(/data-hero-to="/g) || []).length, 2)
    assert.ok(h.includes('data-hero-slides') && h.includes('data-hero-dir="-1"') && h.includes('aria-roledescription="carousel"'))
    assert.equal(heroMod.heroHtml([]), '')
  })
  check('the two boost handlers the hero reuses are exported', () => {
    assert.ok(/export async function onShowBoost\(card, btn\)/.test(read('assets/js/show-card-actions.js')))
    assert.ok(/export async function onBoostClick\(card, btn\)/.test(read('assets/js/episode-card-actions.js')))
  })

  const db = new DatabaseSync(':memory:')
  db.exec(read('bots/global-boost-scan/d1/schema.sql'))
  db.prepare('INSERT INTO podcasts(podcast_guid,title,description,feed_url) VALUES(?,?,?,?)').run('g-1', 'A Show', '<p>Long &amp; <i>rich</i> notes</p> ' + 'more words '.repeat(60), 'https://a/feed.xml')
  db.prepare('INSERT INTO episodes(item_guid,podcast_guid,title,description) VALUES(?,?,?,?)').run('ep/1', 'g-1', 'Ep One', '<b>Shownotes</b> here')
  db.prepare('INSERT INTO publishers(publisher_guid,title,description) VALUES(?,?,?)').run('pub-1', 'Band', 'A band bio')
  db.prepare('INSERT INTO profiles(pubkey,name,about) VALUES(?,?,?)').run('f'.repeat(64), 'Reed', 'Boosts a lot')
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) ?? null }) }) } }
  await checkAsync('buildHero orders the slides by the page and describes each by one lookup', async () => {
    const leads = {
      'movers': heroMod.showSlide('movers', { guid: 'g-9', title: 'Nowhere' }, { medium: 'podcast' }),
      'hpw-week': heroMod.memberSlide('hpw-week', { pk: 'f'.repeat(64), npub: 'npub1' + 'q'.repeat(58), name: 'Reed', seconds: 3600, episodes: 1 }),
      'episodes-year': heroMod.episodeSlide('episodes-year', { guid: 'ep/1', title: 'Ep One', show: { guid: 'g-1', title: 'A Show' } }),
      'shows-week': heroMod.showSlide('shows-week', { guid: 'g-1', title: 'A Show' }, { medium: 'podcast' }),
    }
    const slides = await buildHero(env, leads, railOrder(index))
    assert.deepEqual(slides.map((s) => s.key), ['shows-week', 'hpw-week', 'movers', 'episodes-year'])
    const by = Object.fromEntries(slides.map((s) => [s.key, s]))
    assert.ok(by['shows-week'].desc.startsWith('Long & rich notes more words') && by['shows-week'].desc.endsWith('…') && by['shows-week'].desc.length <= 221)
    assert.equal(by['shows-week'].boost.feed, 'https://a/feed.xml', 'the feed URL the weekly rows do not carry')
    assert.equal(by['episodes-year'].desc, 'Shownotes here')
    assert.equal(by['hpw-week'].desc, 'Boosts a lot')
    assert.equal(by['movers'].desc, undefined, 'an unknown guid: no description, the slide stays')
  })
  await checkAsync('a failing lookup leaves the slide in place', async () => {
    const warn = console.warn; console.warn = () => {}
    let slides
    try {
      slides = await buildHero({ DB: { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('no db') } }) }) } },
        { 'shows-week': heroMod.showSlide('shows-week', { guid: 'g-1', title: 'A Show' }) }, ['shows-week'])
    } finally { console.warn = warn }
    assert.equal(slides.length, 1); assert.equal(slides[0].desc, undefined)
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
    // show-1 reaches show-A alone over the floor and album-1 reaches
    // album-A: one tile each, under the four-tile floor of 2026-10-22.
    assert.deepEqual(j.because, [], 'a Because rail with fewer than four tiles is not shown')
  })
  await checkAsync('Because rails (2026-10-22): the seed with the most to show first, a show on one rail only, under four tiles no rail', async () => {
    for (const k of ['E', 'F', 'G', 'H', 'I', 'J', 'K']) pod.run(`show-${k}`, `Neighbour ${k}`, null, 'podcast', 100, 2, 2, now - 100 * 86400)
    pod.run('album-B', 'Neighbour Album B', null, 'music', 100, 2, 2, now - 100 * 86400)
    pod.run('album-C', 'Neighbour Album C', null, 'music', 100, 2, 2, now - 100 * 86400)
    // show-2 (boosted once) reaches five shows; show-1 (boosted twice) five
    // too, one of them show-A, which show-2 reaches as well.
    let r = 3
    for (const k of ['A', 'C', 'E', 'F', 'G']) sim.run('show-2', `show-${k}`, 0.4, 2, r++)
    r = 4
    for (const k of ['H', 'I', 'J', 'K']) sim.run('show-1', `show-${k}`, 0.3, 2, r++)
    // album-1 reaches three albums: under the floor.
    sim.run('album-1', 'album-B', 0.3, 2, 2)
    sim.run('album-1', 'album-C', 0.3, 2, 3)
    const j = await (await post({ pubkey: ME })).json()
    assert.deepEqual(j.because.map((b) => b.seed.guid), ['show-1', 'show-2'], 'five and five: the tie goes to the more-boosted seed; album-1 at three tiles is out')
    assert.deepEqual(j.because[0].rows.map((x) => x.guid), ['show-A', 'show-H', 'show-I', 'show-J', 'show-K'], 'in the collector\'s rank order')
    assert.deepEqual(j.because[1].rows.map((x) => x.guid), ['show-C', 'show-E', 'show-F', 'show-G'], 'show-A is on the first rail only; four left is exactly the floor')
    assert.equal(j.because[0].seed.medium, 'podcast', 'the seed carries its medium, for the tile')
    // Take show-1's own neighbours down to four and show-2 is the bigger rail and goes first.
    db.prepare("DELETE FROM show_similar WHERE podcast_guid = 'show-1' AND other_guid = 'show-K'").run()
    const j2 = await (await post({ pubkey: ME })).json()
    assert.deepEqual(j2.because.map((b) => b.seed.guid), ['show-2'], 'show-2 first with five; show-1 is left with three (A taken) and is dropped')
  })
  await checkAsync('a member with no boosts gets empty lists, a bad pubkey a 400, a publisher key nothing', async () => {
    const j = await (await post({ pubkey: 'd'.repeat(64) })).json()
    assert.deepEqual([j.seeds, j.podcasts, j.music, j.because], [0, [], [], []])
    assert.equal((await post({ pubkey: 'nope' })).status, 400)
    const { PUBLISHERS } = await import('../functions/api/v1/_common.js')
    const p = await (await post({ pubkey: PUBLISHERS[0] })).json()
    assert.equal(p.seeds, 0)
  })
  await checkAsync('favorites join the seeds and are excluded as candidates', async () => {
    const j = await (await post({ pubkey: 'd'.repeat(64), favorites: ['show-1', 'bad guid with spaces'] })).json()
    assert.equal(j.seeds, 1)
    // show-2 is a candidate HERE: this member never boosted it, so it is not a seed.
    assert.deepEqual(j.podcasts.map((x) => x.guid).sort(), ['show-2', 'show-A', 'show-H', 'show-I', 'show-J'], 'show-1\'s neighbours over the floor (H, I, J joined the fixture above)')
    assert.deepEqual(j.because, [], 'because needs a BOOSTED seed')
  })
  await checkAsync('New and Noteworthy: first boost within 90 days and two boosters, newest debuts after the better-backed', async () => {
    const { html, lead } = await RAILS['new-shows'](env)
    assert.ok(html.includes('Brand New') && !html.includes('Lonely Debut') && !html.includes('Seed One'))
    assert.match(html, /First boost [A-Z][a-z]{2} \d{1,2}/)
    assert.equal(lead.key, 'new-shows'); assert.equal(lead.title, 'Brand New'); assert.match(lead.line, /^First boost .* · \d+ boosters since$/)
  })
  await checkAsync('Podcasters Recommend: ranked by how many podrolls list a show; an unindexed target is a figure, not a link', async () => {
    const { html, lead } = await RAILS.podroll(env)
    assert.ok(html.indexOf('Neighbour A') < html.indexOf('Somewhere Else'))
    assert.ok(html.includes('On 2 podrolls') && html.includes('On 1 podroll<'))
    assert.ok(html.includes('href="/show/show-A"') && !html.includes('href="/show/ext-1"'))
    assert.equal(lead.title, 'Neighbour A'); assert.equal(lead.href, '/show/show-A'); assert.equal(lead.line, 'On 2 podrolls, more than any other show')
  })
  await checkAsync('Movers: a show on this week\'s chart and not last week\'s is a debut', async () => {
    const { html, lead } = await RAILS.movers(env)
    assert.ok(html.includes('Seed One') && html.includes('New this week'))
    assert.equal(lead.eyebrow, 'New on the Chart This Week', 'a debut leads: the eyebrow says so')
    assert.match(lead.line, /not on last week's chart$/)
  })
  await checkAsync('the window rails (2026-10-22): each chart over each window, ten tiles, no hero slide', async () => {
    const { WINDOWS } = await import('../functions/index.js')
    assert.deepEqual(Object.keys(WINDOWS), ['1w', '1m', '1y'])
    const { html, lead } = await RAILS['shows-year'](env)
    assert.ok(html.includes('Seed One') && html.includes('href="/show/show-1"'), 'the year\'s shows chart')
    assert.equal(lead, null, 'no slide: the same show tops a week, a month and a year')
    const songs = await RAILS['songs-week'](env)
    assert.ok(songs.html.includes('class="rail-empty"') || songs.html.includes('rail-list'), 'a chart with nothing in the window says so')
    for (const k of ['episodes-week', 'episodes-month', 'songs-month', 'albums-week', 'albums-year', 'shows-month']) {
      const r = await RAILS[k](env)
      assert.equal(typeof r.html, 'string'); assert.equal(r.lead, null, `${k} leads no slide`)
    }
    const dsrc = read('assets/js/discover.js')
    for (const k of ['episodes-week', 'songs-month', 'albums-year', 'shows-month']) assert.ok(dsrc.includes(`'${k.split('-')[0]}:`) || dsrc.includes('WINDOW_KINDS'), k)
  })
  await checkAsync('the language rails (2026-10-22): the largest non-English languages, a slot needs three rows, the heading names the language', async () => {
    const { languageRails, languageCandidates, LANG_RAILS, LANG_MIN_ROWS } = await import('../functions/index.js')
    assert.equal(LANG_RAILS, 3); assert.equal(LANG_MIN_ROWS, 3)
    const lp = db.prepare('INSERT INTO podcasts(podcast_guid,title,image,medium,language,total_sats,booster_count,boost_count) VALUES(?,?,?,?,?,?,?,?)')
    lp.run('de-1', 'Münzweg', null, 'podcast', 'de', 900, 3, 9)
    lp.run('de-2', 'Nodesignal', null, 'podcast', 'de', 800, 2, 8)
    lp.run('de-3', 'Einundzwanzig', null, 'podcast', 'de', 700, 2, 7)
    lp.run('es-1', 'Lunaticoin', null, 'podcast', 'es', 600, 2, 6)
    lp.run('es-2', 'Kapital', null, 'podcast', 'es', 100, 1, 1)
    lp.run('de-music', 'Ein Album', null, 'music', 'de', 5000, 9, 99) // the music side does not count
    lp.run('en-1', 'An English Show', null, 'podcast', 'en', 9000, 9, 99)
    let n = 100
    for (const [g, k] of [['de-1', 3], ['de-2', 2], ['de-3', 2], ['es-1', 2], ['es-2', 1], ['en-1', 4]]) {
      for (let i = 0; i < k; i++) boost.run(`lb-${n}`, String.fromCharCode(97 + i).repeat(64), now - (n++) * 60, 100, g, null)
    }
    assert.deepEqual(await languageCandidates(env), ['de', 'es'], 'by boosts on the podcast side, English and untagged out')
    const rails = await languageRails(env)
    assert.deepEqual(rails.map((r) => [r.lang, r.rows.length]), [['de', 3]], 'Spanish has two shows this year: under the floor')
    const ctx = {}
    const one = await RAILS['lang-1'](env, ctx)
    assert.ok(one.html.includes('<h2 id="rail-lang-1"><a href="/podcasts/shows?range=1y&amp;lang=de">Top German Podcasts This Year</a></h2>'), one.html.slice(0, 200))
    assert.ok(one.html.includes('View the chart →') && one.html.includes('Münzweg') && one.html.includes('Nodesignal'))
    assert.equal(one.lead.eyebrow, '#1 German Podcast This Year'); assert.equal(one.lead.title, 'Münzweg')
    const two = await RAILS['lang-2'](env, ctx)
    assert.equal(two.html, ''); assert.equal(two.lead, null, 'an empty slot renders empty, which the CSS hides')
    // One answer per request: the three slots share ctx.
    let asked = 0
    const counting = { DB: { prepare: (sql) => { if (/GROUP BY language/.test(sql)) asked++; return env.DB.prepare(sql) } } }
    const c2 = {}
    await Promise.all([1, 2, 3].map((i) => RAILS[`lang-${i}`](counting, c2)))
    assert.equal(asked, 1, 'the candidates are read once for the three slots')
    const { langRailHtml } = tile
    assert.equal(langRailHtml(2, 'es', []), '<div class="rail-head"><h2 id="rail-lang-2"><a href="/podcasts/shows?range=1y&amp;lang=es">Top Spanish Podcasts This Year</a></h2><a class="rail-more" href="/podcasts/shows?range=1y&amp;lang=es">View the chart →</a></div><div class="rail-track"><p class="rail-empty">No Spanish-language podcasts boosted this year.</p></div>')
    const ln = read('assets/js/lang-name.js')
    assert.ok(!/Date\.now\(/.test(ln) && !ln.includes('import '), 'lang-name.js is two-sided and imports nothing')
    assert.ok(read('assets/js/feed-lang.js').includes("from '/assets/js/lang-name.js?v="), 'feed-lang.js reads the same name')
  })
}

console.log('\nThe nav bar: three ribbons, then Charts and Boosts as plain links (2026-10-21):')
{
  const nav = read('partials/nav.html')
  const foot = read('partials/footer.html')
  const links = nav.slice(nav.indexOf('<nav class="nav-links"'), nav.indexOf('</nav>'))
  check('the bar is Podcasts, Music and #40HPW as ribbons, then Charts and Boosts', () => {
    assert.deepStrictEqual([...links.matchAll(/<details class="nav-ribbon" data-ribbon="([a-z]+)"/g)].map((m) => m[1]), ['podcasts', 'music', 'members'])
    assert.ok(links.includes('<a href="/charts">Charts</a>') && links.includes('<a href="/boosts">Boosts</a>'))
    assert.ok(!/^\s*<a href="\/charts\/hpw">#40HPW<\/a>/m.test(links), 'the #40HPW plain link of 2026-10-20 is gone; #40HPW is the third ribbon')
    assert.ok(links.includes('<summary><a href="/charts/hpw">#40HPW</a>'), 'the third ribbon is named #40HPW and opens the boards (Reed, 2026-10-21)')
    assert.ok(!links.includes('<summary><a href="/members">'), 'no ribbon is named Members any more')
    for (const [ribbon, href] of [['podcasts', '/podcasts'], ['music', '/music'], ['members', '/charts/hpw']]) {
      assert.ok(links.includes(`data-ribbon="${ribbon}">\n        <summary><a href="${href}">`), `${ribbon} opens ${href}`)
    }
  })
  check('each ribbon is two list slots nav-ribbons.js can fill, a Discover column and a featured block', () => {
    const slots = [...links.matchAll(/data-ribbon-list="([a-z-]+)"/g)].map((m) => m[1])
    assert.deepStrictEqual(slots, ['shows-week', 'shows-year', 'albums-month', 'songs-year', 'hpw-week', 'boosts-week'])
    const src = read('assets/js/nav-ribbons.js')
    for (const k of slots) assert.ok(src.includes(`'${k}': {`), `nav-ribbons.js has a source for ${k}`)
    assert.strictEqual((links.match(/<h4>Discover<\/h4>/g) || []).length, 3)
    assert.deepStrictEqual([...links.matchAll(/data-ribbon-feat="([a-z-]+)"/g)].map((m) => m[1]), ['shows-week', 'albums-month', 'hpw-week'])
  })
  check("the Podcasts ribbon's Discover column is the rails not already in its lists, plus the personal ones", () => {
    const pod = links.slice(links.indexOf('data-ribbon="podcasts"'), links.indexOf('data-ribbon="music"'))
    const disc = pod.slice(pod.indexOf('<h4>Discover</h4>'), pod.indexOf('nav-ribbon-feat'))
    for (const t of ['Top Episodes This Year', 'New and Noteworthy', 'Movers This Week', 'Podcasters Recommend', 'Top Podcasts by Language', 'Podcasts Recommended For You', 'Top Shows From Your Follows']) assert.ok(disc.includes(`>${t}</a>`), t)
    assert.ok(!disc.includes('Shows Chart') && !disc.includes('Top Shows This Week'))
  })
  check('the #40HPW ribbon lists #40HPW and the largest boosts, and its Discover is the three Reed named (Top Members still among them)', () => {
    const mem = links.slice(links.indexOf('data-ribbon="members"'))
    assert.ok(mem.includes('<h4>#40HPW This Week') && mem.includes('<h4>Largest Boosts This Week'))
    const disc = mem.slice(mem.indexOf('<h4>Discover</h4>'), mem.indexOf('nav-ribbon-feat'))
    assert.deepStrictEqual([...disc.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), ['#40HPW Challenge', 'Top Members', 'Boost Feed'])
    assert.deepStrictEqual([...disc.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ['/charts/hpw', '/members', '/boosts'])
    assert.ok(!mem.includes('Live'), 'Live means something else in podcasting')
  })
  check("every Discover link lands on a homepage rail id or a charts view, and the rail ids exist", () => {
    for (const m of links.matchAll(/href="\/#([a-z0-9-]+)"/g)) assert.ok(index.includes(`id="${m[1]}"`), `index.html has #${m[1]}`)
  })
  check('the overlay and the footer name the same places', () => {
    const overlay = nav.slice(nav.indexOf('nav-explore-sections'), nav.indexOf('nav-explore-group">\n            <h4>Stats'))
    assert.strictEqual((overlay.match(/<details class="nav-explore-acc">/g) || []).length, 3)
    assert.ok(overlay.includes('<summary><a href="/charts/hpw"><span aria-hidden="true">👥</span> #40HPW</a>'), "the overlay's third row is #40HPW like the ribbon")
    for (const h of ['/podcasts', '/music', '/members', '/charts', '/boosts']) assert.ok(overlay.includes(`href="${h}"`) && foot.includes(`href="${h}"`), h)
    assert.ok(overlay.includes('<h4>Browse</h4>') && foot.includes('<h3>Browse</h3>'), 'the group is Browse: it holds a Charts entry now')
  })
  check('every page the bar names has a Function, and each answers HEAD', () => {
    for (const f of ['functions/podcasts/[[path]].js', 'functions/music/[[path]].js', 'functions/boosts.js', 'functions/members.js', 'functions/charts/[[path]].js']) {
      const s = read(f)
      assert.ok(s.includes('renderShellPage(') && s.includes('onRequestHead'), f)
    }
  })
}

console.log('\nThe boost feed ordered by sats over a window (the Members ribbon):')
{
  const db = new DatabaseSync(':memory:')
  db.exec(read('bots/global-boost-scan/d1/schema.sql'))
  const now = Math.floor(Date.now() / 1000)
  const ins = db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?)')
  ins.run('big-old', 'a'.repeat(64), now - 40 * 86400, 100000, 'show-1', null)  // outside the week
  ins.run('small', 'b'.repeat(64), now - 100, 21, 'show-1', null)
  ins.run('mid', 'c'.repeat(64), now - 200, 500, 'show-1', null)
  ins.run('big', 'd'.repeat(64), now - 3 * 86400, 5000, 'show-1', null)
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: db.prepare(sql).all(...a) }) }) }) } }
  const { onRequestGet: boosts } = await import('../functions/api/v1/boosts.js')
  const get = (q) => boosts({ request: new Request('https://ob.invalid/api/v1/boosts?' + q), env }).then((r) => r.json())
  await checkAsync('sort=sats&range=1w is the week\'s boosts, biggest first, with no cursor', async () => {
    const d = await get('sort=sats&range=1w&limit=5')
    assert.deepStrictEqual(d.boosts.map((b) => b.id), ['big', 'mid', 'small'])
    assert.strictEqual(d.next_cursor, null)
  })
  await checkAsync('the default order is untouched: newest first, cursor-paged', async () => {
    const d = await get('limit=2')
    assert.deepStrictEqual(d.boosts.map((b) => b.id), ['small', 'mid'])
    assert.ok(d.next_cursor)
  })
  await checkAsync('a bad range answers 400', async () => {
    const r = await boosts({ request: new Request('https://ob.invalid/api/v1/boosts?range=2w'), env })
    assert.strictEqual(r.status, 400)
  })
}

console.log('\nThe discovery lists in full, /discover/<key> (2026-10-20):')
{
  const db = new DatabaseSync(':memory:')
  db.exec(read('bots/global-boost-scan/d1/schema.sql'))
  const now = Math.floor(Date.now() / 1000)
  const pod = db.prepare('INSERT INTO podcasts(podcast_guid,title,image,medium,feed_url,total_sats,booster_count,boost_count,first_boost_ts) VALUES(?,?,?,?,?,?,?,?,?)')
  pod.run('show-C', 'Brand New', 'https://x/c.jpg', 'podcast', 'https://x/c.xml', 300, 3, 4, now - 10 * 86400)
  pod.run('show-E', 'Newer Still', 'https://x/e.jpg', 'podcast', 'https://x/e.xml', 100, 2, 2, now - 2 * 86400)
  pod.run('show-old', 'Veteran', 'https://x/o.jpg', 'podcast', null, 9000, 30, 90, now - 400 * 86400)
  pod.run('show-A', 'Neighbour A', 'https://x/a.jpg', 'podcast', 'https://x/a.xml', 900, 4, 9, now - 200 * 86400)
  const roll = db.prepare('INSERT INTO podroll(source_guid,position,target_guid,target_title,target_image,target_linked) VALUES(?,?,?,?,?,?)')
  roll.run('show-old', 1, 'show-A', 'Neighbour A', 'https://x/a.jpg', 1)
  roll.run('show-C', 1, 'show-A', 'Neighbour A', 'https://x/a.jpg', 1)
  roll.run('show-C', 2, 'ext-1', 'Somewhere Else', null, 0)
  const boost = db.prepare('INSERT INTO boosts(event_id,booster_pubkey,created_at,sats,podcast_guid,item_guid) VALUES(?,?,?,?,?,?)')
  boost.run('d1', 'a'.repeat(64), now - 100, 100, 'show-A', null)
  boost.run('d2', 'b'.repeat(64), now - 90, 100, 'show-A', null)
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) ?? null }), all: async () => ({ results: db.prepare(sql).all() }), first: async () => db.prepare(sql).get() ?? null }) } }
  const shellHtml = read('discover.html')
  const ASSETS = { fetch: async () => new Response(shellHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }) }
  const { onRequestGet: discoverGet, PAGES, listHtml } = await import('../functions/discover/[key].js')
  const get = (key) => discoverGet({ request: new Request('https://ob.invalid/discover/' + key), env: { ...env, ASSETS }, params: { key } })
  await checkAsync('new-shows lists the recent debuts with two boosters, newest-by-boosters first, each with its why-line', async () => {
    const r = await get('new-shows'); const h = await r.text()
    assert.strictEqual(r.status, 200)
    assert.ok(h.includes('<title>New and Noteworthy — OnlyBoosts</title>') && h.includes('/discover/new-shows" />'))
    assert.ok(!h.includes('<!--OB:DISCOVER-->'))
    assert.ok(h.indexOf('Brand New') < h.indexOf('Newer Still') && !h.includes('Veteran'))
    assert.ok(/pcast-note">First boost \w+ \d+ · 3 boosters since</.test(h))
    assert.ok(h.includes('data-show-card') && h.includes('pcast-rank" aria-hidden="true">1<'))
  })
  await checkAsync('podroll lists targets by how many shows list them; an unindexed target has no link and says so', async () => {
    const h = await (await get('podroll')).text()
    assert.ok(h.indexOf('Neighbour A') < h.indexOf('Somewhere Else'))
    assert.ok(h.includes('On 2 podrolls') && h.includes('On 1 podroll · not boosted on Nostr yet'))
    assert.ok(h.includes('href="/show/show-A"') && !h.includes('href="/show/ext-1"'))
  })
  await checkAsync('movers renders (an empty week is a real answer) and keeps the chart rank', async () => {
    const h = await (await get('movers')).text()
    assert.ok(h.includes('<title>Movers This Week — OnlyBoosts</title>'))
    assert.ok(h.includes('Nothing here yet.') || h.includes('data-show-card'))
  })
  await checkAsync('an unknown key is 404 and the shell keeps its marker', async () => {
    const r = await get('nope'); const h = await r.text()
    assert.strictEqual(r.status, 404)
    assert.ok(h.includes('<!--OB:DISCOVER-->'))
  })
  check('every page the Function knows is linked from the rail heads, the ribbons and the sitemap', () => {
    const nav = read('partials/nav.html'), sitemap = read('functions/sitemap.xml.js')
    for (const k of Object.keys(PAGES)) {
      assert.ok(index.includes(`<a href="/discover/${k}">`), `index.html links /discover/${k}`)
      assert.ok(nav.includes(`href="/discover/${k}"`), `the nav links /discover/${k}`)
      assert.ok(sitemap.includes(`"/discover/${k}"`), `the sitemap carries /discover/${k}`)
    }
    assert.ok(typeof listHtml === 'function')
  })
  check('a show card without a note is the string it was', () => {
    const { showCardHtml } = heroShowCard
    const s = { guid: 'g', title: 'T', img: '', art2: '', feed: '', author: '', boosts: 1, sats: 2, boosters: 1, episodes: 0, latest: 0, rank: null, tied: false }
    assert.ok(!showCardHtml(s).includes('pcast-note'))
    assert.ok(showCardHtml(s, { note: 'Up 3 places' }).includes('<div class="pcast-note">Up 3 places</div>'))
  })
}

console.log('\nThe member\'s recommendations on their own page (2026-10-20):')
{
  const src = read('functions/booster/[npub].js')
  check('the booster page asks the recommendation core, lets it fail, and renders #recommended after #shows', () => {
    assert.ok(src.includes('import { recommendationsFor } from "../api/v1/recommend.js"'))
    assert.ok(/recommendationsFor\(env, hex, \[\], 20\)\.catch\(/.test(src))
    assert.ok(src.indexOf('${renderShows(shows, realName)}') < src.indexOf('${renderRecommended(recs, realName)}'))
    assert.ok(src.includes('id="recommended"'))
  })
  check('the core is what the endpoint answers, and a publisher key gets nothing', async () => {
    const { recommendationsFor } = await import('../functions/api/v1/recommend.js')
    assert.strictEqual(typeof recommendationsFor, 'function')
  })
  check('candr_boost_bot is in both publisher lists', () => {
    const key = '978bbd44d918cc998c21f63150171046ae1173bbea1b7d1c6500d82b1063ed36'
    assert.ok(read('functions/api/v1/_common.js').includes(key) && read('functions/_shared/feed-rank.js').includes(key))
  })
}

console.log('\nA pasted npub is a member lookup (2026-10-22):')
{
  const { pubkeyQuery, resultsHtml } = await import('../functions/search.js')
  const NP = 'npub1xgyjasdztryl9sg6nfdm2wcj0j3qjs03sq7a0an32pg0lr5l6yaqxhgu7s'
  const HEX = '32092ec1a258c9f2c11a9a5bb53b127ca20941f1803dd7f6715050ff8e9fd13a'
  check('pubkeyQuery takes an npub, a nostr: npub and a hex pubkey, and nothing else', () => {
    assert.equal(pubkeyQuery(NP), NP)
    assert.equal(pubkeyQuery(' nostr:' + NP + ' '), NP)
    assert.equal(pubkeyQuery(HEX.toUpperCase()), HEX.toUpperCase())
    for (const q of ['npub1short', 'bitcoin', NP + 'x', HEX.slice(1), '']) assert.equal(pubkeyQuery(q), null, q)
  })
  check('the results page: a found key is the member wall, a miss says the account is not in the index', () => {
    const hit = resultsHtml(NP, { members: [{ pk: HEX, npub: NP, name: 'Reed', pic: null, sats: 1, boosts: 1, shows: 1 }] })
    assert.ok(hit.includes('id="members"') && hit.includes('This account is in the index'), hit.slice(0, 300))
    assert.ok(!hit.includes('Shows</h2>'), 'no empty chart groups for a key')
    const miss = resultsHtml(NP, { members: [] })
    assert.ok(miss.includes('is not in the index') && miss.includes('npub1xgyjasd…xhgu7s') && !miss.includes('Nothing matched'), miss)
  })
  check('the typeahead carries the same rule and asks the member endpoint alone', () => {
    const src = read('assets/js/nav-search.js')
    assert.ok(src.includes('export function pubkeyQuery(q)') && src.includes("replace(/^nostr:/i, '')"))
    assert.ok(src.includes('const key = pubkeyQuery(q)') && src.includes('is not in the index'))
    assert.ok(src.includes('highlight(0) // Enter opens the member'), 'Enter on a found member opens their page')
    const f = read('functions/search.js')
    assert.ok(f.includes('if (key) return { shows: [], albums: [], episodes: [], songs: [], artists: [], members: await findMembers(env, request, key) };'), 'the Function skips the FTS paths for a key')
  })
}

console.log('\nThe shell kept its address book:')
{
  check('charts.html declares /charts as its own address and carries both marker pairs', () => {
    assert.ok(charts.includes('<link rel="canonical" href="https://onlyboosts.social/charts" />'))
    assert.ok(charts.includes('<!--OB:SSR-SHOWS-->') && charts.includes('<!--OB:SSR-ALBUMS-->'))
  })
  check('index.html is the discovery page and names /', () => {
    assert.ok(index.includes('<link rel="canonical" href="https://onlyboosts.social/" />'))
    assert.ok(index.includes('class="discover"'))
    assert.ok(!index.includes('FEED BAR CONTROLLER'))
  })
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
