/* Tests the inline controller in charts.html, the shell five pages share.
 *
 * ⚠️ IT RUNS THE REAL SOURCE. The controller is an inline <script> rather than a
 * module, so it cannot be imported; this extracts it from charts.html and
 * evaluates it against a stub DOM. That is deliberate and is the whole value: a
 * copy of normLang() in here would pass forever while the shipped one rotted.
 *
 * WHY IT EXISTS. The view in the address (`?lang=de` and later range, sort and
 * scope) is how a filtered list is shared, and two bugs shipped that no unit
 * test of the parsing could see, because both live in the BOOT SEQUENCE:
 *
 *   1. The language was put in the lb:feed-activate detail and nowhere else.
 *      That event fires from this inline script during parse; feeds.js is a
 *      module and therefore deferred, so on a cold load its listener does not
 *      exist yet, which is exactly why feeds.js re-reads body[data-active-feed]
 *      when it first runs. Every shared link opened UNFILTERED.
 *   2. The language was filed under the feed key the URL named rather than the
 *      one setFeed RESOLVED to. A signed-out follows link coerces to the global
 *      feed, so the language was recorded against a feed that was not on
 *      screen while the one that was opened unfiltered.
 *
 * Both are invisible unless you drive the whole boot. Hence the stub.
 *
 * THE ADDRESS IS A PATH SINCE 2026-10-21 (`/podcasts/shows?scope=follows&
 * range=1m`), where it was a hash (`#shows-follows?range=1m`) from 2026-08-17.
 * The file keeps its name: the tests are the same tests over the new shape.
 *
 * Run: node scripts/test-feed-hash.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(ROOT, 'charts.html'), 'utf8')

// ── Pull the controller out of charts.html ───────────────────────────
const marker = html.indexOf('FEED BAR CONTROLLER')
if (marker < 0) throw new Error('charts.html no longer contains the FEED BAR CONTROLLER block')
const open = html.indexOf('<script>', marker)
const close = html.indexOf('</script>', open)
if (open < 0 || close < 0) throw new Error('could not delimit the controller <script>')
const SRC = html.slice(open + '<script>'.length, close)

/* Individual functions, for the parsing tests. Balanced-brace scan rather than a
 * regex, because these bodies contain braces. */
function grab(name) {
  const i = SRC.indexOf(`function ${name}(`)
  if (i < 0) throw new Error(`the controller no longer defines ${name}()`)
  let depth = 0, started = false
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { depth++; started = true }
    else if (SRC[j] === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1) }
  }
  throw new Error(`unbalanced braces in ${name}()`)
}
const grabConst = (name) => {
  const i = SRC.indexOf(`const ${name} = {`)
  if (i < 0) throw new Error(`charts.html no longer declares ${name}`)
  let depth = 0
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(i, j + 2) }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

// ── The smallest DOM the controller touches ──────────────────────────
class El {
  constructor(tag) {
    this.tag = tag; this.attrs = {}; this.dataset = {}; this.hidden = false
    this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false } }
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v)
    const m = /^data-(.+)$/.exec(k)
    if (m) this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v)
  }
  removeAttribute(k) {
    delete this.attrs[k]
    const m = /^data-(.+)$/.exec(k)
    if (m) delete this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
  }
  getAttribute(k) { return this.attrs[k] ?? null }
  querySelector() { return null }
  querySelectorAll() { return [] }
  addEventListener() {} ; removeEventListener() {}
  contains() { return false }
  /* Enough of a tree for placeFeedBar: it reads `parentNode` and calls
     `appendChild`, which is the whole of how the feed bar relocates. */
  appendChild(child) { child.parentNode = this; return child }
}

const FEED_KEYS = ['shows-global', 'shows-follows', 'episodes-global', 'episodes-follows',
  'albums-global', 'albums-follows', 'songs-global', 'songs-follows',
  'artists-global', 'artists-follows', 'members-global', 'members-follows']
/* The five page heads as the shell ships them: which page, and which tab
   links each carries. Read off charts.html so a head added or a tab renamed
   there is a test failure here rather than a stub that still believes the
   old shape. */
const HEADS = [...html.matchAll(/<header class="page-head" data-page-head="([a-z]+)" hidden>([\s\S]*?)<\/header>/g)]
  .map((m) => ({ page: m[1], views: [...m[2].matchAll(/data-view="([a-z]+)"/g)].map((x) => x[1]) }))

/** Boot the real controller at `path` + `search` and report what it did. */
function boot(url, { signedIn = false } = {}) {
  const [path, search = ''] = url.split('?')
  const body = new El('body')
  const bar = new El('div')
  /* ⚠️ THE BAR STARTS IN THE SHOWS PANEL'S LID, as the markup ships it, and
     every panel carries a lid of its own (`[data-feed-bar-slot]`). `barHome`
     is captured from `bar.parentNode` at boot, so the stub has to give it
     one, and giving it the Shows lid rather than a stray wrapper is what
     makes "a /podcasts/shows load leaves it put" a real assertion. */
  const panelEls = FEED_KEYS.map((key) => {
    const panel = new El('section'); panel.setAttribute('data-feed', key)
    const lid = new El('div'); lid.setAttribute('data-feed-bar-slot', '')
    panel.lid = lid
    panel.querySelector = (s) => (s === '[data-feed-bar-slot]' ? lid : null)
    return panel
  })
  const lidOf = (key) => panelEls.find((p) => p.dataset.feed === key).lid
  lidOf('shows-global').appendChild(bar)
  const headEls = HEADS.map((h) => {
    const head = new El('header'); head.setAttribute('data-page-head', h.page); head.hidden = true
    head.tabs = h.views.map((v) => { const a = new El('a'); a.setAttribute('data-view', v); a.setAttribute('href', `/${h.page}/${v}`); return a })
    head.querySelectorAll = (s) => (s === '.page-tabs a[data-view]' ? head.tabs : [])
    return head
  })
  const listeners = {}
  const events = []
  const doc = {
    body,
    querySelector: (s) => (s === '.feed-bar' ? bar : null),
    querySelectorAll: (sel) => {
      if (sel === '.feed-panel[data-feed]') return panelEls
      if (sel === '.page-head[data-page-head]') return headEls
      return []
    },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: () => {},
    dispatchEvent: (e) => { events.push(e); (listeners[e.type] || []).forEach((f) => f(e)) },
  }
  const location = { pathname: path, search: search ? '?' + search : '', hash: '' }
  const history = {
    replaceState: (a, b, u) => { const [p, q = ''] = u.split('?'); location.pathname = p; location.search = q ? '?' + q : '' },
    // Scrolling and filtering are not navigation. A history entry per control
    // press would bury the page the reader arrived from.
    pushState: () => { throw new Error('the controller must not pushState') },
  }
  const isIn = typeof signedIn === 'function' ? signedIn : () => signedIn
  const storage = { getItem: () => (isIn() ? JSON.stringify({ pubkey: 'a'.repeat(64) }) : null) }
  class CE { constructor(type, init) { this.type = type; this.detail = init && init.detail } }
  const winListeners = {}
  const win = { addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn) }, removeEventListener: () => {} }
  new Function('document', 'window', 'location', 'history', 'localStorage', 'CustomEvent', 'console', SRC)(
    doc, win, location, history, storage, CE, console)
  return {
    body,
    location,
    events,
    url: () => location.pathname + location.search,
    head: () => headEls.filter((h) => !h.hidden).map((h) => h.dataset.pageHead),
    current: () => headEls.flatMap((h) => h.tabs).filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.dataset.view),
    tabHref: (view) => headEls.flatMap((h) => h.tabs).find((a) => a.dataset.view === view)?.getAttribute('href'),
    /* Which panel's lid holds the bar, by feed key; 'nowhere' if none does. */
    barParent: () => (panelEls.find((p) => p.lid === bar.parentNode) || {}).dataset?.feed ?? 'nowhere',
    activePanels: () => panelEls.filter((p) => !p.hidden).map((p) => p.dataset.feed),
    fire: (type) => (winListeners[type] || []).forEach((f) => f({ type })),
    // A renderer's report, arriving as a document event the way the real ones do.
    dispatch: (type, detail) => doc.dispatchEvent(new CE(type, { detail })),
  }
}

// ── Harness ──────────────────────────────────────────────────────────
let pass = 0, fail = 0
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${a}\n      want ${b}`) }
}

// ── 1. Parsing, against the real functions ───────────────────────────
/* ⚠️ PAGES IS EXTRACTED, NOT STUBBED: parsePath reads it, so a copy here would
   let the shipped table open /music on Albums while this file still believed
   Artists and every assertion below would pass. */
const { normLang, parsePath, parseQuery, queryFor, PAGES, FEEDS, langByFeed, rangeByFeed, sortByFeed } = new Function(
  `${grabConst('FEEDS')}
   ${grabConst('PAGES')}
   const DEFAULT_PAGE = 'podcasts';
   const langByFeed = Object.create(null), rangeByFeed = Object.create(null), sortByFeed = Object.create(null);
   ${[grab('normLang'), grab('normRange'), grab('normSort'), grab('normScope'), grab('parsePath'), grab('parseQuery'), grab('queryFor')].join('\n')}
   return { normLang, parsePath, parseQuery, queryFor, PAGES, FEEDS, langByFeed, rangeByFeed, sortByFeed }`,
)()
const Q = (scope = 'global', lang = '', range = '', sort = '') => ({ scope, lang, range, sort })

console.log('\nThe path names the page and the view:')
eq('/podcasts/shows', parsePath('/podcasts/shows'), { page: 'podcasts', view: 'shows' })
eq('/podcasts/episodes', parsePath('/podcasts/episodes'), { page: 'podcasts', view: 'episodes' })
eq('the bare /podcasts opens on Shows (Reed, 2026-09-03)', parsePath('/podcasts'), { page: 'podcasts', view: 'shows' })
eq('the bare /music opens on Artists (2026-08-31)', parsePath('/music'), { page: 'music', view: 'artists' })
eq('/music/songs', parsePath('/music/songs'), { page: 'music', view: 'songs' })
eq('/boosts is the members feed', parsePath('/boosts'), { page: 'boosts', view: 'members' })
eq('/members has no view', parsePath('/members'), { page: 'members', view: '' })
eq('the bare /charts opens on the Podcasts boards', parsePath('/charts'), { page: 'charts', view: 'podcasts' })
eq('/charts/hpw', parsePath('/charts/hpw'), { page: 'charts', view: 'hpw' })
eq('an unknown view is the page\'s first', parsePath('/music/videos'), { page: 'music', view: 'artists' })
eq('a trailing slash is nothing', parsePath('/podcasts/episodes/'), { page: 'podcasts', view: 'episodes' })
eq('an unknown page is the default page', parsePath('/elsewhere'), { page: 'podcasts', view: 'shows' })
eq('every page\'s first view is what its nav href opens', Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, v.views[0] || ''])),
  { podcasts: 'shows', music: 'artists', boosts: 'members', members: '', charts: 'podcasts' })
eq('every feed type is a view of exactly one page', Object.values(FEEDS).map((f) => f.type).filter((t, i, a) => a.indexOf(t) === i).sort(),
  Object.values(PAGES).filter((p) => p.feed).flatMap((p) => p.views).sort())

console.log('\nParsing the view in the query:')
eq('?lang=de', parseQuery('?lang=de'), Q('global', 'de'))
eq('no query at all', parseQuery(''), Q())
eq('an unknown param is ignored, not choked on', parseQuery('?foo=bar'), Q())
eq('lang alongside one', parseQuery('?foo=bar&lang=de').lang, 'de')
eq('a bare ?', parseQuery('?'), Q())
eq('the whole view', parseQuery('?scope=follows&lang=de&range=1m&sort=sats'), Q('follows', 'de', '1m', 'sats'))
eq('range alone', parseQuery('?range=1w'), Q('global', '', '1w'))
eq('sort alone', parseQuery('?sort=count'), Q('global', '', '', 'count'))
eq('scope=follows', parseQuery('?scope=follows').scope, 'follows')
eq('scope=global is the default', parseQuery('?scope=global').scope, 'global')
eq('an unknown scope is global', parseQuery('?scope=mine').scope, 'global')
eq('uppercase', parseQuery('?lang=DE').lang, 'de')
eq('regioned, as an RSS feed writes it', parseQuery('?lang=en-US').lang, 'en')
eq('underscored', parseQuery('?lang=de_DE').lang, 'de')
eq('the untagged bucket', parseQuery('?lang=unknown').lang, 'unknown')
eq('lang=all is NO FILTER, not a 0-row query', parseQuery('?lang=all').lang, '')
eq('a word is not a subtag', parseQuery('?lang=english').lang, '')
eq('a digit is not a subtag', parseQuery('?lang=1').lang, '')
eq('empty', parseQuery('?lang=').lang, '')
eq('a subtag we hold nothing for still parses', parseQuery('?lang=ko').lang, 'ko')
eq('range=all is the default, not a filter', parseQuery('?range=all').range, '')
eq('range is case-folded', parseQuery('?range=1M').range, '1m')
eq('an unknown range is dropped', parseQuery('?range=2y').range, '')
eq('a garbage range is dropped', parseQuery('?range=7days').range, '')
eq('a sort passes through by shape', parseQuery('?sort=boosters').sort, 'boosters')
eq('and is case-folded', parseQuery('?sort=SATS').sort, 'sats')
eq('a non-word sort is dropped', parseQuery('?sort=sats;drop').sort, '')
eq('a one-letter sort is dropped', parseQuery('?sort=x').sort, '')

console.log('\nWriting the view back:')
eq('no filter writes nothing: the bare path is the default view\'s address', queryFor('shows-global'), '')
langByFeed['shows-global'] = 'de'
eq('a filter appends it', queryFor('shows-global'), '?lang=de')
rangeByFeed['shows-global'] = '1m'; sortByFeed['shows-global'] = 'sats'
eq('the whole view rides together', queryFor('shows-global'), '?lang=de&range=1m&sort=sats')
langByFeed['shows-global'] = ''
eq('each param is independent', queryFor('shows-global'), '?range=1m&sort=sats')
eq('another feed is unaffected', queryFor('albums-global'), '')
eq('⚠️ a follows feed carries its scope first', queryFor('shows-follows'), '?scope=follows')
rangeByFeed['shows-follows'] = '1y'
eq('  and the view after it', queryFor('shows-follows'), '?scope=follows&range=1y')
for (const [feed, q] of [['shows-global', '?range=1m&sort=sats'], ['shows-follows', '?scope=follows&range=1y']]) {
  const back = parseQuery(q)
  eq(`${q} survives a round trip`, [FEEDS[feed].scope, back.range, back.sort], [back.scope, rangeByFeed[feed] || '', sortByFeed[feed] || ''])
}

// ── 2. The boot sequence, which is where both bugs lived ─────────────
console.log('\n⚠️ The cold load, which is what feeds.js reads when its listener attached too late:')
let r = boot('/podcasts/shows?lang=de')
eq('body[data-page] and body[data-view]', [r.body.dataset.page, r.body.dataset.view], ['podcasts', 'shows'])
eq('body[data-active-feed]', r.body.dataset.activeFeed, 'shows-global')
eq('body[data-feed-lang] carries the language', r.body.dataset.feedLang, 'de')
eq('the address is left as it was shared', r.url(), '/podcasts/shows?lang=de')
eq('the Podcasts head is the one shown', r.head(), ['podcasts'])
eq('and its Shows tab is current', r.current(), ['shows'])
eq('⚠️ the sibling tab carries the view across', r.tabHref('episodes'), '/podcasts/episodes?lang=de')
r = boot('/podcasts/episodes?lang=de')
eq('episodes too', [r.body.dataset.activeFeed, r.body.dataset.feedLang, r.current()], ['episodes-global', 'de', ['episodes']])
r = boot('/podcasts/shows')
eq('no language means an empty attribute, not "all"', r.body.dataset.feedLang, '')
r = boot('/podcasts/shows?range=1m&sort=sats')
eq('the range and sort ride the attributes too', [r.body.dataset.feedRange, r.body.dataset.feedSort], ['1m', 'sats'])
eq('and the address is left as shared', r.url(), '/podcasts/shows?range=1m&sort=sats')
r = boot('/music/albums')
eq('a bare path means empty view attributes', [r.body.dataset.feedLang, r.body.dataset.feedRange, r.body.dataset.feedSort], ['', '', ''])
eq('the bare /podcasts is Shows, the bare /music is Artists, the bare /charts is the Podcasts boards',
  [boot('/podcasts').body.dataset.activeFeed, boot('/music').body.dataset.activeFeed, boot('/charts').body.dataset.view],
  ['shows-global', 'artists-global', 'podcasts'])
{
  const b = boot('/music/albums?lang=en')
  const act = b.events.find((e) => e.type === 'lb:feed-activate')
  eq('lb:feed-activate fires', !!act, true)
  eq('and carries the same language', act.detail, { feed: 'albums-global', lang: 'en', range: '', sort: '' })
  const b2 = boot('/music/albums?range=1w&sort=boosts')
  const act2 = b2.events.find((e) => e.type === 'lb:feed-activate')
  eq('and carries the view', act2.detail, { feed: 'albums-global', lang: 'all', range: '1w', sort: 'boosts' })
}
r = boot('/boosts?lang=de')
eq('a feed with no language axis drops it', r.body.dataset.feedLang, '')
eq('and the URL stops claiming it', r.url(), '/boosts')
r = boot('/boosts?range=1w&sort=sats')
eq('a members view drops its range and sort', [r.body.dataset.feedRange, r.body.dataset.feedSort], ['', ''])
eq('and the URL stops claiming them', r.url(), '/boosts')
eq('/boosts shows the Boosts head and activates the members feed', [r.head(), r.body.dataset.activeFeed], [['boosts'], 'members-global'])
r = boot('/podcasts/shows?lang=all')
eq('?lang=all is no filter', r.body.dataset.feedLang, '')
eq('  and comes off the address', r.url(), '/podcasts/shows')
r = boot('/podcasts/shows?range=all')
eq('?range=all opens the default view', r.body.dataset.feedRange, '')

console.log('\n⚠️ The scope: a follows link signed out, and signed in:')
r = boot('/podcasts/episodes?scope=follows&lang=de')
eq('signed out, follows coerces to global and KEEPS the language',
  [r.body.dataset.activeFeed, r.body.dataset.feedLang, r.url()], ['episodes-global', 'de', '/podcasts/episodes?lang=de'])
r = boot('/podcasts/episodes?scope=follows&range=1y&sort=count')
eq('and keeps the view, filed under the resolved key',
  [r.body.dataset.feedRange, r.body.dataset.feedSort, r.url()], ['1y', 'count', '/podcasts/episodes?range=1y&sort=count'])
r = boot('/podcasts/episodes?scope=follows&lang=de', { signedIn: true })
eq('signed in, follows survives with its language',
  [r.body.dataset.activeFeed, r.body.dataset.feedLang, r.url()], ['episodes-follows', 'de', '/podcasts/episodes?scope=follows&lang=de'])
eq('  and the sibling tab keeps the scope', r.tabHref('shows'), '/podcasts/shows?scope=follows&lang=de')
for (const [path, feed] of [['/podcasts/shows', 'shows-follows'], ['/music/albums', 'albums-follows'], ['/music/artists', 'artists-follows'], ['/boosts', 'members-follows']]) {
  r = boot(path + '?scope=follows', { signedIn: true })
  eq(`signed in, ${path}?scope=follows is ${feed}`, r.body.dataset.activeFeed, feed)
}
r = boot('/boosts?scope=follows')
eq('signed out, /boosts?scope=follows is the global feed and says so', [r.body.dataset.activeFeed, r.url()], ['members-global', '/boosts'])

console.log('\nThe pages with no feed:')
r = boot('/members')
eq('/members shows its head, activates no feed and takes data-active-feed OFF the body',
  [r.head(), 'activeFeed' in r.body.dataset, r.body.dataset.page], [['members'], false, 'members'])
eq('  and dispatches no activation', r.events.filter((e) => e.type === 'lb:feed-activate').length, 0)
eq('  and hides every panel', r.activePanels(), [])
r = boot('/charts/music')
eq('/charts/music shows the Charts head with Music current', [r.head(), r.current(), r.body.dataset.view], [['charts'], ['music'], 'music'])
eq('  and no feed', 'activeFeed' in r.body.dataset, false)
r = boot('/charts/hpw?range=1y')
eq('a query on a board page is left alone', r.url(), '/charts/hpw?range=1y')

console.log('\nA control press writes the query:')
{
  const b = boot('/podcasts/shows')
  b.dispatch('lb:feed-view', { feed: 'shows-global', range: '1m', sort: 'sats' })
  eq('a reported view lands in the address', b.url(), '/podcasts/shows?range=1m&sort=sats')
  eq('  and the sibling tab follows it', b.tabHref('episodes'), '/podcasts/episodes?range=1m&sort=sats')
  b.dispatch('lb:feed-view', { feed: 'shows-global', range: '', sort: '' })
  eq('reporting the default strips it back out', b.url(), '/podcasts/shows')
  // A report from a feed that is not on screen is remembered, not written.
  b.dispatch('lb:feed-view', { feed: 'albums-global', range: '1w', sort: 'sats' })
  eq('an inactive feed\'s report leaves the address alone', b.url(), '/podcasts/shows')
  // The members feeds have the controls but not the shareable view.
  b.dispatch('lb:feed-view', { feed: 'members-global', range: '1w', sort: 'sats' })
  eq('a members report is refused outright', b.url(), '/podcasts/shows')
  b.dispatch('lb:feed-lang', { feed: 'shows-global', lang: 'de' })
  eq('a language report lands too', b.url(), '/podcasts/shows?lang=de')
  b.dispatch('lb:feed-lang', { feed: 'shows-global', lang: 'all' })
  eq('and "all" strips it', b.url(), '/podcasts/shows')
}

console.log('\nThe session: signing out while on Follows drops to Global:')
{
  let signed = true
  const b = boot('/podcasts/shows?scope=follows&range=1y', { signedIn: () => signed })
  eq('on Follows, the bar in its lid', [b.body.dataset.activeFeed, b.barParent()], ['shows-follows', 'shows-follows'])
  b.fire('lb:session-change')
  eq('still on Follows while the session stands', b.body.dataset.activeFeed, 'shows-follows')
  signed = false
  b.fire('lb:session-change')
  eq('signed out: the global feed, and the address stops claiming the scope', [b.body.dataset.activeFeed, b.url()], ['shows-global', '/podcasts/shows'])
  eq('  and the bar moved with it', b.barParent(), 'shows-global')
  const m = boot('/members', { signedIn: () => signed })
  m.fire('lb:session-change')
  eq('a page with no feed takes a session change without activating one', m.events.filter((e) => e.type === 'lb:feed-activate').length, 0)
}

/* ── Every feed key reaches the CSS that dresses and reveals it ──────── */
console.log('\nEvery FEEDS key has its accent row and its controls rule:')
{
  const keys = [...SRC.matchAll(/'([a-z]+-[a-z]+)':\s*\{ type:/g)].map((m) => m[1])
  eq('the FEEDS keys were extracted at all', keys.length >= 12, true)
  const escRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
  for (const key of keys) {
    eq(`${key} has an accent row`, new RegExp(`body\\[data-active-feed="${escRe(key)}"\\]\\s*\\{ --accent:`).test(html), true)
    eq(`${key} has a controls rule`, html.includes(`body[data-active-feed="${key}"]`) && html.includes(`[data-controls-for="${key}"]`), true)
    eq(`${key} has a panel`, html.includes(`data-feed="${key}"`), true)
  }
}

/* ── The page heads and the panels the shell ships ──────────────────── */
console.log('\nThe shell ships one head per page and the Shows panel active:')
{
  eq('five heads, one per page, every one hidden until routed', HEADS.map((h) => h.page), ['podcasts', 'music', 'boosts', 'members', 'charts'])
  eq('each head\'s tabs are its page\'s views, in order', Object.fromEntries(HEADS.map((h) => [h.page, h.views])),
    Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, v.views.length > 1 ? v.views : []])))
  eq('the body ships routed to /podcasts/shows', /<body data-page="podcasts" data-view="shows" data-active-feed="shows-global">/.test(html), true)
  eq('the Shows panel ships active and the others hidden',
    [...html.matchAll(/<section class="feed-panel( is-active)?" id="(panel-[^"]+)"[^>]*?( hidden)?>/g)].map((m) => [m[2], !!m[1], !!m[3]]).filter(([, a, h]) => a || !h),
    [['panel-shows', true, false]])
  eq('no tab banner and no sub-row survive in the shell', /feed-tabs|feed-subs|feed-chrome|feed-bar-wrap/.test(html), false)
  /* ⚠️ The three board pairs are hidden by `.charts-page > …` rules, so a
     pair that sits OUTSIDE the wrapper is on every page. The Music boards
     shipped that way on 2026-10-21 and read "OnlyBoosts Music Charts" under
     the Podcast Charts head. */
  {
    const wrap = html.slice(html.indexOf('<div class="charts-page" data-charts-page>'), html.indexOf('<div class="members-page" data-members-page>'))
    const inside = (re) => [...wrap.matchAll(re)].length
    eq('both board blocks sit INSIDE the Charts page wrapper', [inside(/data-charts-block="shows"/g), inside(/data-charts-block="artists"/g), inside(/<section[^>]*data-hpw>/g)], [1, 1, 1])
    eq('and nowhere else in the shell', [...html.matchAll(/<section[^>]*data-charts-block="/g)].length, 2)
    const wall = html.slice(html.indexOf('<div class="members-page" data-members-page>'))
    eq('the wall and the bots sit inside the Members page wrapper', [/data-members-wall/.test(wall), /data-members-bots/.test(wall)], [true, true])
  }
  eq('the hash router is gone: no hashchange listener, no ALIASES table', /hashchange|ALIASES|HASH_OF|parseHash/.test(SRC), false)
}

/* ── The two ways a feed gets hydrated ─────────────────────────────── */
console.log('\nBoth hydration entry points are wired:')
{
  const feeds = readFileSync(join(ROOT, 'assets/js/feeds.js'), 'utf8')
  const listenerAt = feeds.indexOf("document.addEventListener('lb:feed-activate'")
  eq('feeds.js still has the activate listener', listenerAt > -1, true)
  const listenerEnd = feeds.indexOf('\n})', listenerAt)
  const inListener = feeds.slice(listenerAt, listenerEnd)
  const afterListener = feeds.slice(listenerEnd)
  eq('the listener loads the feed', inListener.includes('loadFeed('), true)
  eq('the cold load reads the feed off the body', afterListener.includes("document.body.dataset.activeFeed || ''"), true)
  eq('⚠️ and no longer falls back to episodes: a page with no feed must hydrate nothing', afterListener.includes("|| 'episodes-global'"), false)
  eq('the cold load paints the Charts and Members pages off the body', afterListener.includes('loadPageSections(document.body.dataset.page, document.body.dataset.view)'), true)
  for (const [what, call] of [['the Podcasts boards', "loadChartsBlock(CHART_VIEWS[view])"], ['the #40HPW boards', 'loadMemberBoards()'], ['the wall', 'loadMembersWall()']]) {
    eq(`loadPageSections reaches ${what}`, feeds.slice(feeds.indexOf('function loadPageSections')).includes(call), true)
  }
  const board = readFileSync(join(ROOT, 'assets/js/members-board.js'), 'utf8')
  eq('members-board.js exports the wall on its own', board.includes('export async function renderMembersWall()'), true)
  eq('and the boards no longer paint the wall on their way out', board.slice(board.indexOf('export async function renderMembersBoards'), board.indexOf('export async function renderMembersWall')).includes('paintWall('), false)
}

console.log('\n⚠️ The feed bar is MOVED into the ACTIVE panel\'s lid, every feed:')
{
  eq('a cold load on /podcasts/shows leaves the bar where the markup ships it', boot('/podcasts/shows').barParent(), 'shows-global')
  eq('/boosts puts it in the members panel\'s lid', boot('/boosts').barParent(), 'members-global')
  eq('/podcasts/episodes', boot('/podcasts/episodes').barParent(), 'episodes-global')
  eq('/music/albums', boot('/music/albums').barParent(), 'albums-global')
  eq('/music/artists', boot('/music/artists').barParent(), 'artists-global')
  eq('a signed-in /boosts?scope=follows lands in that panel\'s lid', boot('/boosts?scope=follows', { signedIn: true }).barParent(), 'members-follows')
  eq('⚠️ a signed-out follows link follows the COERCED feed, not the URL', boot('/podcasts/episodes?scope=follows').barParent(), 'episodes-global')
  eq('a page with no feed leaves the bar where it was', boot('/members').barParent(), 'shows-global')
  eq('the bar is never left parentless', boot('/podcasts/episodes').barParent() !== 'nowhere', true)
}

console.log(`\n${pass} assertions passed${fail ? `, ${fail} FAILED` : ''}.`)
if (fail) process.exit(1)
