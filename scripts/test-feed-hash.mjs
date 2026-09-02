/* Tests the inline feed-bar controller in index.html.
 *
 * ⚠️ IT RUNS THE REAL SOURCE. The controller is an inline <script> rather than a
 * module, so it cannot be imported; this extracts it from index.html and
 * evaluates it against a stub DOM. That is deliberate and is the whole value: a
 * copy of normLang() in here would pass forever while the shipped one rotted.
 *
 * WHY IT EXISTS. The hash gained a language (`#shows?lang=de`) so a filtered
 * view could be shared, and two bugs shipped that no unit test of the parsing
 * could see, because both live in the BOOT SEQUENCE:
 *
 *   1. The language was put in the lb:feed-activate detail and nowhere else.
 *      That event fires from this inline script during parse; feeds.js is a
 *      module and therefore deferred, so on a cold load its listener does not
 *      exist yet, which is exactly why feeds.js re-reads body[data-active-feed]
 *      when it first runs. Every shared link opened UNFILTERED.
 *   2. The language was filed under the feed key the HASH named rather than the
 *      one setFeed RESOLVED to. A signed-out `#episodes-follows?lang=de` coerces
 *      to episodes-global, so the language was recorded against a feed that was
 *      not on screen while the one that was opened unfiltered.
 *
 * Both are invisible unless you drive the whole boot. Hence the stub.
 *
 * Run: node scripts/test-feed-hash.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(ROOT, 'index.html'), 'utf8')

// ── Pull the controller out of index.html ────────────────────────────
const marker = html.indexOf('FEED BAR CONTROLLER')
if (marker < 0) throw new Error('index.html no longer contains the FEED BAR CONTROLLER block')
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
  getAttribute(k) { return this.attrs[k] ?? null }
  querySelector() { return null }
  querySelectorAll() { return [] }
  addEventListener() {} ; removeEventListener() {}
  contains() { return false }
  /* Enough of a tree for placeFeedBar: it reads `parentNode` and calls
     `appendChild`, which is the whole of how the feed bar relocates. */
  appendChild(child) { child.parentNode = this; return child }
}

/** Boot the real controller at `hash` and report what it did. */
function boot(hash, { signedIn = false } = {}) {
  const body = new El('body')
  const bar = new El('div')
  /* ⚠️ THE BAR STARTS IN ITS STICKY WRAPPER, which is what makes "moved back"
     a real assertion rather than "never moved". `barHome` is captured from
     `bar.parentNode` at boot, so the stub has to give it one. */
  const barWrap = new El('div')
  barWrap.appendChild(bar)
  const barSlot = new El('div')
  const mk = (attrs) => { const e = new El('button'); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e }
  const tabEls = ['podcasts', 'music', 'members'].map((t) => mk({ 'data-tab': t }))
  /* `data-value` only: `data-tab` moved to the wrapping .feed-sub-group when
     the sub-feeds became blocks aligned under their tab, and the controller has
     never read it off a button. Mirroring the real shape here is what keeps
     this a test of the shipped selector. */
  const subEls = ['shows', 'episodes', 'albums', 'songs', 'artists', 'members'].map((v) => mk({ 'data-value': v }))
  const listeners = {}
  const events = []
  const doc = {
    body,
    querySelector: (s) => {
      if (s === '.feed-bar') return bar
      if (s === '[data-feed-bar-slot]') return barSlot
      return null
    },
    /* The tabs and the sub-row live OUTSIDE .feed-bar, so the controller queries
       them off the document. Returning real elements here is what makes the
       aria-selected assertions below test the shipped syncTabs() rather than a
       no-op over an empty list. */
    querySelectorAll: (sel) => {
      if (sel === '.feed-tab[data-tab]') return tabEls
      if (sel === '.feed-sub[data-value]') return subEls
      return []
    },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: () => {},
    dispatchEvent: (e) => { events.push(e); (listeners[e.type] || []).forEach((f) => f(e)) },
  }
  const location = { hash }
  const history = {
    replaceState: (a, b, h) => { location.hash = h },
    // Scrolling and filtering are not navigation. A history entry per control
    // press would bury the page the reader arrived from.
    pushState: () => { throw new Error('the controller must not pushState') },
  }
  const storage = { getItem: () => (signedIn ? JSON.stringify({ pubkey: 'a'.repeat(64) }) : null) }
  class CE { constructor(type, init) { this.type = type; this.detail = init && init.detail } }
  /* ⚠️ THE WINDOW KEEPS ITS LISTENERS NOW. It was `{ addEventListener(){} }`,
     which silently dropped the controller's `hashchange` handler — so every
     test here could only ever exercise a COLD load, and anything that happens
     when a reader moves between tabs was untestable. The feed bar moving back
     out of the Members tab is exactly that kind of thing, and it is the half
     that breaks: `.members-block` is display:none off the tab, so a bar left
     behind would vanish from every other feed. */
  const winListeners = {}
  const win = { addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn) }, removeEventListener: () => {} }
  new Function('document', 'window', 'location', 'history', 'localStorage', 'CustomEvent', 'console', SRC)(
    doc, win, location, history, storage, CE, console)
  const selected = (els) => els.filter((e) => e.getAttribute('aria-selected') === 'true')
  return {
    body,
    location,
    events,
    tab: () => (selected(tabEls)[0] || {}).dataset?.tab ?? null,
    sub: () => (selected(subEls)[0] || {}).dataset?.value ?? null,
    barParent: () => (bar.parentNode === barSlot ? 'slot' : bar.parentNode === barWrap ? 'wrap' : 'nowhere'),
    fire: (type) => (winListeners[type] || []).forEach((f) => f({ type })),
    // A renderer's report, arriving as a document event the way the real ones do.
    dispatch: (type, detail) => doc.dispatchEvent(new CE(type, { detail })),
    tabsSelected: () => selected(tabEls).length,
    subsSelected: () => selected(subEls).length,
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
const loc = { hash: '' }
const langByFeed = Object.create(null)
const rangeByFeed = Object.create(null)
const sortByFeed = Object.create(null)
/* ⚠️ THE HASH↔KEY MAPS ARE EXTRACTED, NOT STUBBED. `hashFor` reads HASH_OF and
   `fromHash` reads KEY_OF, so a copy here would let the shipped table say
   `#members` while this file still believed `#members-global` and every
   assertion below would pass. Grabbing the declarations is what makes the round
   trip a test of the shipped mapping. */
const grabConst = (name) => {
  const m = new RegExp(`^\\s*const ${name} = [^;]+;`, 'm').exec(SRC)
  if (!m) throw new Error(`index.html no longer declares ${name}`)
  return m[0]
}
const HASH_MAPS = [
  grabConst('HASH_OF'),
  grabConst('KEY_OF'),
  /* KEY_OF is derived from HASH_OF by a loop rather than written out, so the
     loop has to come across too or the inverse is empty. */
  /* Matched to the end of its line, not to the first `;` — the callback body
     contains one, so a `[^;]+` stops inside it and hands back half a call. */
  /^\s*Object\.keys\(HASH_OF\)\.forEach\(.*$/m.exec(SRC)?.[0] || (() => {
    throw new Error('the KEY_OF derivation is gone — is the inverse hand-written now?')
  })(),
].join('\n')

const { normLang, parseHash, hashFor, HASH_OF, KEY_OF } = new Function(
  'location', 'langByFeed', 'rangeByFeed', 'sortByFeed',
  `${HASH_MAPS}
   ${[grab('normLang'), grab('normRange'), grab('normSort'), grab('parseHash'), grab('hashFor')].join('\n')}
   return { normLang, parseHash, hashFor, HASH_OF, KEY_OF }`,
)(loc, langByFeed, rangeByFeed, sortByFeed)
const at = (h) => { loc.hash = h; return parseHash() }
// The full parse shape, defaults empty — the deep-equals below stay legible.
const P = (key, lang = '', range = '', sort = '') => ({ key, lang, range, sort })

console.log('\nParsing the shared URL:')
eq('#shows?lang=de', at('#shows?lang=de'), P('shows', 'de'))
eq('a bare hash is unchanged', at('#shows'), P('shows'))
eq('no hash at all', at(''), P(''))
eq('a retired hash still yields its key', at('#podcasts-global?lang=de').key, 'podcasts-global')
eq('an unknown param is ignored, not choked on', at('#shows?foo=bar'), P('shows'))
eq('lang alongside one', at('#shows?foo=bar&lang=de').lang, 'de')
eq('a bare ?', at('#shows?'), P('shows'))
eq('the whole view', at('#shows?lang=de&range=1m&sort=sats'), P('shows', 'de', '1m', 'sats'))
eq('range alone', at('#albums?range=1w'), P('albums', '', '1w'))
eq('sort alone', at('#episodes-global?sort=count'), P('episodes-global', '', '', 'count'))

console.log('\nNormalizing what a human might type or paste:')
eq('uppercase', at('#shows?lang=DE').lang, 'de')
eq('regioned, as an RSS feed writes it', at('#shows?lang=en-US').lang, 'en')
eq('underscored', at('#shows?lang=de_DE').lang, 'de')
eq('the untagged bucket', at('#shows?lang=unknown').lang, 'unknown')
// ⚠️ The API validates `lang` by SHAPE, so 'all' is a well-formed three-letter
// subtag that matches nothing and answers zero rows. Folding it to no filter
// here is what stops a hand-written hash painting an empty feed.
eq('lang=all is NO FILTER, not a 0-row query', at('#shows?lang=all').lang, '')
eq('a word is not a subtag', at('#shows?lang=english').lang, '')
eq('a digit is not a subtag', at('#shows?lang=1').lang, '')
eq('empty', at('#shows?lang=').lang, '')
eq('a subtag we hold nothing for still parses', at('#shows?lang=ko').lang, 'ko')

console.log('\nNormalizing the range and the sort:')
// ⚠️ 'all' is every ranked feed's default, so it folds to no parameter — the
// same move lang=all makes: the bare hash IS the default view's address.
eq('range=all is the default, not a filter', at('#shows?range=all').range, '')
eq('range is case-folded', at('#shows?range=1M').range, '1m')
eq('an unknown range is dropped', at('#shows?range=2y').range, '')
eq('a garbage range is dropped', at('#shows?range=7days').range, '')
// A sort is validated by SHAPE only: the keys are the renderers' own and
// differ per feed, so the renderer coerces an unknown one and reports back.
eq('a sort passes through by shape', at('#shows?sort=boosters').sort, 'boosters')
eq('and is case-folded', at('#shows?sort=SATS').sort, 'sats')
eq('a non-word sort is dropped', at('#shows?sort=sats;drop').sort, '')
eq('a one-letter sort is dropped', at('#shows?sort=x').sort, '')

console.log('\nWriting the hash back:')
// ⚠️ The key is scoped since 2026-08-31 and the HASH is not: `shows-global`
// still writes the `#shows` every link in the wild carries, through HASH_OF.
eq('no filter writes the hash it always wrote', hashFor('shows-global'), '#shows')
langByFeed['shows-global'] = 'de'
eq('a filter appends it', hashFor('shows-global'), '#shows?lang=de')
rangeByFeed['shows-global'] = '1m'
sortByFeed['shows-global'] = 'sats'
eq('the whole view rides together', hashFor('shows-global'), '#shows?lang=de&range=1m&sort=sats')
langByFeed['shows-global'] = ''
eq('each param is independent', hashFor('shows-global'), '#shows?range=1m&sort=sats')
rangeByFeed['shows-global'] = ''
sortByFeed['shows-global'] = ''
eq('another feed is unaffected', hashFor('albums-global'), '#albums')
/* ⚠️ THE ROUND TRIP RESOLVES THROUGH KEY_OF, the way fromHash does. Comparing
   `back.key` to the feed directly would fail for any feed whose hash is not its
   key, and "fix" it by dropping that feed from the list — which is how a
   mapping stops being tested. */
const keyOf = (raw) => KEY_OF[raw] || raw
for (const [feed, lang, range, sort] of [
  ['shows-global', 'de', '1m', 'sats'], ['albums-global', 'en', '', ''], ['songs-follows', 'unknown', '1y', ''],
  ['episodes-global', 'nb', '', 'count'], ['members-global', '', '', ''], ['members-follows', '', '', ''],
  ['artists-global', '', '1w', 'sats'], ['shows-follows', '', '', 'chart'],
]) {
  langByFeed[feed] = lang
  rangeByFeed[feed] = range
  sortByFeed[feed] = sort
  const h = hashFor(feed)
  const back = at(h)
  eq(`${h} survives a round trip`,
    [keyOf(back.key), back.lang, back.range, back.sort], [feed, lang, range, sort])
}

console.log('\n⚠️ The Members feed is addressed as #members, not #members-global:')
{
  /* Reed's call, 2026-08-23: the tab is Members, the sections above the list
     are about members, and `#boosts-global` named the smallest part of the
     page. Only the GLOBAL scope elides — a bare `#members` meaning "whichever
     scope you were last on" would be an address that does not name a view. */
  eq('the global feed writes the bare hash', hashFor('members-global'), '#members')
  eq('#members resolves back to it', keyOf(at('#members').key), 'members-global')
  eq('⚠️ follows keeps its suffix', hashFor('members-follows'), '#members-follows')
  eq('and resolves to itself', keyOf(at('#members-follows').key), 'members-follows')
  /* Compared without the query string: the round-trip loop above leaves a
     language on several feeds, and this is an assertion about the KEY half of
     the hash, not about the language riding it. */
  const bare = (feed) => hashFor(feed).split('?')[0]
  /* ⚠️ Since 2026-08-31 the three ex-scopeless feeds elide the same way:
     their bare hash is every link in the wild, so it stays the GLOBAL scope's
     canonical address. Follows keeps its suffix everywhere, and the
     episode-level feeds never elide. */
  eq('⚠️ shows-global still writes #shows', bare('shows-global'), '#shows')
  eq('  albums-global writes #albums', bare('albums-global'), '#albums')
  eq('  artists-global writes #artists', bare('artists-global'), '#artists')
  eq('⚠️ their follows keep the suffix', bare('shows-follows'), '#shows-follows')
  eq('  episodes never elides', bare('episodes-global'), '#episodes-global')
  eq('  nor songs', bare('songs-follows'), '#songs-follows')
  eq('the map has exactly four entries', Object.keys(HASH_OF),
     ['members-global', 'shows-global', 'albums-global', 'artists-global'])
  eq('and the derived inverse matches', [KEY_OF.members, KEY_OF.shows, KEY_OF.albums, KEY_OF.artists],
     ['members-global', 'shows-global', 'albums-global', 'artists-global'])

  /* ⚠️ AND THE RETIRED HASHES STILL RESOLVE. `#boosts-global` and
     `#boosts-follows` were the shipped addresses of this feed on production
     until the rename, so they are in the wild and ALIASES may never lose them.
     Without the entries they fall through to DEFAULT_TYPE — measured landing on
     Shows, with the hash rewritten to `#shows`, which is a dead link reporting
     itself as a working one. An aliased hash always forces the rewrite, so an
     old link upgrades itself the way a 301 would; the global one upgrades twice
     over, through the alias and then through HASH_OF's elision. */
  let old = boot('#boosts-global', { signedIn: true })
  eq('⚠️ #boosts-global still lands on the members feed', old.body.dataset.activeFeed, 'members-global')
  eq('  and the hash upgrades to #members', old.location.hash, '#members')
  old = boot('#boosts-follows', { signedIn: true })
  eq('⚠️ #boosts-follows too', old.body.dataset.activeFeed, 'members-follows')
  eq('  and upgrades to #members-follows', old.location.hash, '#members-follows')
}

// ── 2. The boot sequence, which is where both bugs lived ─────────────
console.log('\n⚠️ The cold load, which is what feeds.js reads when its listener attached too late:')
let r = boot('#shows?lang=de')
eq('body[data-active-feed]', r.body.dataset.activeFeed, 'shows-global')
eq('body[data-feed-lang] carries the language', r.body.dataset.feedLang, 'de')
eq('the hash is left as it was shared', r.location.hash, '#shows?lang=de')
r = boot('#episodes-global?lang=de')
eq('episodes too', [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-global', 'de'])
r = boot('#shows')
eq('no language means an empty attribute, not "all"', r.body.dataset.feedLang, '')
r = boot('#shows?range=1m&sort=sats')
eq('the range and sort ride the attributes too',
  [r.body.dataset.feedRange, r.body.dataset.feedSort], ['1m', 'sats'])
eq('and the hash is left as shared', r.location.hash, '#shows?range=1m&sort=sats')
r = boot('#shows')
eq('a bare hash means empty view attributes',
  [r.body.dataset.feedRange, r.body.dataset.feedSort], ['', ''])

console.log('\nThe event detail agrees with the attribute:')
r = boot('#albums?lang=en')
const act = r.events.filter((e) => e.type === 'lb:feed-activate').pop()
eq('lb:feed-activate fires', !!act, true)
eq('and carries the same language', act.detail, { feed: 'albums-global', lang: 'en', range: '', sort: '' })
eq('the attribute matches it', r.body.dataset.feedLang, 'en')
r = boot('#albums?range=1w&sort=boosts')
const act2 = r.events.filter((e) => e.type === 'lb:feed-activate').pop()
eq('and carries the view', act2.detail, { feed: 'albums-global', lang: 'all', range: '1w', sort: 'boosts' })

console.log('\nCoercion, with the hash rewritten to match what is on screen:')
r = boot('#members?lang=de')
eq('a feed with no language axis drops it', r.body.dataset.feedLang, '')
eq('and the URL stops claiming it', r.location.hash, '#members')
// ⚠️ The Members feeds have range and sort CONTROLS but their view is
// deliberately not shareable (Reed scoped this to the four ranked feeds), so
// the parameters are stripped the way an inapplicable language is.
r = boot('#members?range=1w&sort=largest')
eq('a members view drops its range and sort',
  [r.body.dataset.feedRange, r.body.dataset.feedSort], ['', ''])
eq('and the URL stops claiming them', r.location.hash, '#members')
r = boot('#shows?lang=all')
eq('?lang=all is no filter', r.body.dataset.feedLang, '')
// Like ?lang=all above, the URL itself is left alone: it resolves to the same
// view either way, and the rewrite machinery only fires when a feed had to
// DROP something it was asked for.
r = boot('#shows?range=all')
eq('?range=all opens the default view', r.body.dataset.feedRange, '')
r = boot('#podcasts-global?lang=de')
eq('a retired hash upgrades AND keeps the language', r.location.hash, '#episodes-global?lang=de')
eq('and hydrates filtered', [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-global', 'de'])
r = boot('#podcasts-global?range=1y&sort=count')
eq('a retired hash keeps the view too', r.location.hash, '#episodes-global?range=1y&sort=count')
// ⚠️ Bug 2: setFeed coerces the scope here, so the language must be filed under
// the key it RESOLVED to, not the one the hash named.
r = boot('#episodes-follows?lang=de', { signedIn: false })
eq('signed out, follows coerces to global and KEEPS the language',
  [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-global', 'de'])
r = boot('#episodes-follows?range=1m', { signedIn: false })
eq('and keeps the view, filed under the resolved key',
  [r.body.dataset.activeFeed, r.body.dataset.feedRange], ['episodes-global', '1m'])
r = boot('#episodes-follows?lang=de', { signedIn: true })
eq('signed in, follows survives with its language',
  [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-follows', 'de'])
/* ⚠️ The show-level feeds joined the axis on 2026-08-31, so the coercions
   above apply to them now too — and the rewritten hash is the CANONICAL bare
   one, so a signed-out deep link lands on the address every link already has. */
r = boot('#shows-follows?lang=de', { signedIn: false })
eq('signed out, shows-follows coerces to global, hash and language kept',
  [r.body.dataset.activeFeed, r.location.hash], ['shows-global', '#shows?lang=de'])
r = boot('#shows-follows', { signedIn: true })
eq('signed in, Shows · Follows is a real feed now', r.body.dataset.activeFeed, 'shows-follows')
r = boot('#albums-follows', { signedIn: true })
eq('Albums · Follows too', r.body.dataset.activeFeed, 'albums-follows')
r = boot('#artists-follows', { signedIn: true })
eq('Artists · Follows too', r.body.dataset.activeFeed, 'artists-follows')
// ⚠️ THE FALLBACK IS DEFAULT_TYPE, WHICH IS SHOWS SINCE PHASE D. The bare
// `#shows` is the global scope's canonical hash (HASH_OF), so the rewrite is
// still `#shows` — and the language is dropped because the hash was never
// understood, not because the feed refused it.
r = boot('#nonsense?lang=de')
eq('an unknown hash falls back and drops the language', r.location.hash, '#shows')
r = boot('#nonsense?range=1m&sort=sats')
eq('and drops the view with it', r.location.hash, '#shows')

/* ── The live tab, both directions ─────────────────────────────────────
 * The renderers report control presses through lb:feed-view and the controller
 * writes the hash; a URL pasted into an open tab travels the other way, as one
 * lb:set-feed-view event so the pair costs one requery. Both are boot-sequence
 * behaviour, so they are driven here rather than unit-tested in a copy. */
console.log('\nA control press writes the hash, and a pasted URL commands the feed:')
{
  const b = boot('#shows')
  b.dispatch('lb:feed-view', { feed: 'shows-global', range: '1m', sort: 'sats' })
  eq('a reported view lands in the hash', b.location.hash, '#shows?range=1m&sort=sats')
  b.dispatch('lb:feed-view', { feed: 'shows-global', range: '', sort: '' })
  eq('reporting the default strips it back out', b.location.hash, '#shows')
  // A report from a feed that is not on screen is remembered, not written.
  b.dispatch('lb:feed-view', { feed: 'albums-global', range: '1w', sort: '' })
  eq('an inactive feed\'s report leaves the hash alone', b.location.hash, '#shows')
  // The members feeds have the controls but not the shareable view.
  b.dispatch('lb:feed-view', { feed: 'members-global', range: '1w', sort: 'largest' })
  eq('a members report is refused outright', b.location.hash, '#shows')
}
{
  const b = boot('#shows')
  b.location.hash = '#shows?range=1m&sort=sats'
  b.fire('hashchange')
  const set = b.events.filter((e) => e.type === 'lb:set-feed-view').pop()
  eq('a pasted URL dispatches lb:set-feed-view', !!set, true)
  eq('with the whole view', set.detail, { feed: 'shows-global', range: '1m', sort: 'sats' })
  eq('and the attributes move with it',
    [b.body.dataset.feedRange, b.body.dataset.feedSort], ['1m', 'sats'])
  // Pasting the bare hash asks for the default view, not "leave it alone".
  b.location.hash = '#shows'
  b.fire('hashchange')
  const back = b.events.filter((e) => e.type === 'lb:set-feed-view').pop()
  eq('a bare hash commands the default view', back.detail, { feed: 'shows-global', range: '', sort: '' })
}

/* ── Tabs ──────────────────────────────────────────────────────────────
 * ⚠️ THE TAB IS DERIVED FROM THE FEED KEY AND IS NOT IN THE HASH. Every URL in
 * the wild names a feed; which tab is on screen is computed from it. These
 * assertions are what stop somebody "simplifying" that into a tab stored in the
 * hash, which would quietly need an alias for all eight keys and the two
 * retired ones. */
console.log('\nThe tab a hash lands on:')
for (const [hash, tab, sub] of [
  ['#shows', 'podcasts', 'shows'],
  ['#episodes-global', 'podcasts', 'episodes'],
  ['#albums', 'music', 'albums'],
  ['#songs-global', 'music', 'songs'],
  ['#artists', 'music', 'artists'],
  ['#members', 'members', 'members'],
  ['#podcasts-global', 'podcasts', 'episodes'],   // retired hash, still resolves
  // ⚠️ THE FRONT DOOR LANDS ON SHOWS (Phase D). Both of these read DEFAULT_TYPE,
  // which is the landing feed — NOT TAB_DEFAULT.podcasts, which is still
  // 'episodes' and is what pressing the Podcasts tab opens. Two questions, two
  // constants; a change that makes these two rows agree with the row above has
  // almost certainly merged them.
  ['', 'podcasts', 'shows'],                      // no hash at all
  ['#nonsense', 'podcasts', 'shows'],             // unknown falls back
]) {
  const b = boot(hash)
  eq(`${hash || '(no hash)'} → ${tab} / ${sub}`,
    [b.body.getAttribute('data-active-tab'), b.tab(), b.sub()], [tab, tab, sub])
}

console.log('\nExactly one tab and one sub-feed are ever marked selected:')
{
  const b = boot('#albums')
  eq('one tab, one sub', [b.tabsSelected(), b.subsSelected()], [1, 1])
}

console.log('\nThe tab attribute can never disagree with the feed:')
for (const hash of ['#shows', '#episodes-follows', '#songs-follows', '#members-follows', '#albums', '#artists']) {
  const b = boot(hash, { signedIn: true })
  const feed = b.body.getAttribute('data-active-feed')
  const type = feed.replace(/-(global|follows)$/, '')
  const want = { shows: 'podcasts', episodes: 'podcasts', albums: 'music', songs: 'music', artists: 'music', members: 'members' }[type]
  eq(`${hash} → feed ${feed}, tab ${want}`, b.body.getAttribute('data-active-tab'), want)
}

/* ── The two grids' boxes ──────────────────────────────────────────────
 * ⚠️ `.feed-subs` PUTS ITS BLOCKS UNDER THE TAB THEY BELONG TO ONLY WHILE IT
 * SHARES `.feed-tabs`' CONTENT BOX. Both are three-column grids; if one takes a
 * horizontal padding or a gap the other does not, every sub-block narrows and
 * the pair slides out from under its tab. It is a few pixels at a time and it
 * looks like nothing, which is why it is asserted rather than eyeballed.
 *
 * A declaration scan, not a render: the rule bodies are read out of index.html
 * and the properties that decide column geometry are compared per scope. */
console.log('\nThe tab grid and the sub grid line up:')
{
  /* All declarations for `sel` in `scope`, later ones winning — an indexOf
     walk rather than a regex, because a selector is a literal string here and
     an escaped-dot pattern is one backslash away from silently matching
     nothing, which is a check that passes by asserting zero times. */
  const decls = (sel, scope) => {
    const out = {}
    let found = false
    let i = 0
    for (;;) {
      i = scope.indexOf(sel + ' {', i)
      if (i < 0) break
      // Only a rule that STARTS with this selector; skip `.x .feed-tabs {`.
      const before = scope[i - 1]
      if (before !== '\n' && before !== ' ') { i += sel.length; continue }
      const open = i + sel.length + 2
      const close = scope.indexOf('}', open)
      if (close < 0) break
      found = true
      /* ⚠️ STRIP COMMENTS FIRST. A `/* … *\/` inside the rule body otherwise
         becomes part of the next property's NAME, so `padding` reads as
         undefined — and since the other selector may not declare padding
         either, the comparison then matches two undefineds and passes while
         the rule it is guarding is broken. Found by mutation: inserting a
         1.25rem inset on one grid did not fail this test until this line
         existed. */
      const body = scope.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const d of body.split(';')) {
        const c = d.indexOf(':')
        if (c < 0) continue
        out[d.slice(0, c).trim()] = d.slice(c + 1).trim()
      }
      i = close
    }
    return found ? out : null
  }
  // Everything before the 640px block is the base scope; inside it is the phone.
  const cut = html.indexOf('@media (max-width: 640px) {', html.indexOf('.feed-bar-wrap'))
  const scopes = { desktop: html.slice(0, cut), phone: html.slice(cut) }
  const xpad = (v) => {
    if (!v) return '0'
    const parts = v.split(/\s+/)
    return parts.length === 1 ? parts[0] : parts[1]   // shorthand: y x [y x]
  }
  for (const [name, scope] of Object.entries(scopes)) {
    const t = decls('.feed-tabs', scope)
    const u = decls('.feed-subs', scope)
    if (!t || !u) continue
    eq(`${name}: same horizontal padding`, xpad(u.padding), xpad(t.padding))
    eq(`${name}: same column gap`, u.gap ?? '0', t.gap ?? '0')
    if (name === 'desktop') {
      eq('desktop: same track width', u['max-width'], t['max-width'])
      eq('desktop: both are 3 columns', u['grid-template-columns'], t['grid-template-columns'])
    }
  }

  /* ⚠️ THE FOUR ELEMENTS OF THE PAGE TRACK MOVE TOGETHER. The tabs, the
   * sub-row, the control bar and the panels are one column; widening three of
   * them leaves the fourth as a visible step down the page. They read a single
   * custom property so this cannot drift, and this asserts the property is what
   * they read rather than a number that happens to match today.
   *
   * The track is 60rem because `.show-main` is — the homepage was 240px
   * narrower than /show, /episode and /booster, so the column changed width
   * when a reader clicked through. That is a decision, not an accident, which
   * is why the value is checked and not just the agreement. */
  {
    const base = html.slice(0, cut)
    for (const sel of ['.feed-tabs', '.feed-subs', '.feed-bar', '.feed-panels-inner']) {
      eq(`${sel} reads the shared track`, decls(sel, base)?.['max-width'], 'var(--feed-track)')
    }
    const root = /--feed-track:\s*([^;]+);/.exec(html)
    eq('the track is the detail pages\' own width', root && root[1].trim(), '60rem')
    const showMain = readFileSync(join(ROOT, 'assets/css/show-page.css'), 'utf8')
    const sm = /\.show-main\s*\{[^}]*max-width:\s*([^;]+);/.exec(showMain)
    eq('and .show-main still is too', sm && sm[1].trim(), '60rem')
  }
}

/* ── The two ways a feed gets hydrated ─────────────────────────────────
 * ⚠️ THE COLD LOAD DOES NOT GO THROUGH lb:feed-activate. The inline controller
 * dispatches that during parse, before feeds.js — a deferred module — exists,
 * which is why feeds.js re-reads body[data-active-feed] at the end and calls
 * loadFeed itself. Anything hooked to the event ALONE therefore runs when a
 * reader clicks to a feed and never on a reload, a shared link, or a back
 * navigation onto it.
 *
 * That shipped once: the 40 HPW boards were wired to the listener only, so the
 * Members tab rendered its heading and its caveat with an empty gap between
 * them on every cold load. A source scan rather than a render, because the bug
 * is which call sites exist, not what any of them does. */
console.log('\nBoth hydration entry points are wired:')
{
  const feeds = readFileSync(join(ROOT, 'assets/js/feeds.js'), 'utf8')
  const listenerAt = feeds.indexOf("document.addEventListener('lb:feed-activate'")
  eq('feeds.js still has the activate listener', listenerAt > -1, true)
  // The listener block ends at the first `})` at the start of a line after it.
  const listenerEnd = feeds.indexOf('\n})', listenerAt)
  const inListener = feeds.slice(listenerAt, listenerEnd)
  const afterListener = feeds.slice(listenerEnd)
  for (const [what, call] of [['the feed itself', 'loadFeed('], ['the members boards', 'loadMemberBoards()']]) {
    eq(`${what}: hydrated from the event`, inListener.includes(call), true)
    eq(`${what}: AND on the cold load`, afterListener.includes(call), true)
  }
}

/* ── Every feed key reaches the CSS that dresses and reveals it ────────
 * ⚠️ TWO INLINE CSS BLOCKS ENUMERATE FEED KEYS BY HAND, and the controller
 * cannot see either: the accent mapping (body[data-active-feed="…"] supplies
 * --accent/--tint, and an unmatched key leaves them UNDEFINED, invalidating
 * every declaration that reads them) and the controls-visibility rule (the
 * matching [data-controls-for] group is the only one displayed, so an
 * unmatched key is a feed with no range, no sort and no language control —
 * they mount and are never shown). The 2026-08-31 key rename shipped exactly
 * that: shows/albums/artists became shows-global etc. in FEEDS and in the
 * panels while both CSS blocks kept the bare names, and every test here
 * stayed green because none of them read the CSS. Reed found it in the
 * browser. This closes the class: every key the controller declares must
 * appear in BOTH blocks. */
console.log('\nEvery FEEDS key has its accent row and its controls rule:')
{
  const keys = [...SRC.matchAll(/'([a-z]+-[a-z]+)':\s*\{ type:/g)].map((m) => m[1])
  eq('the FEEDS keys were extracted at all', keys.length >= 12, true)
  const escRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
  for (const key of keys) {
    const sel = escRe(`body[data-active-feed="${key}"]`)
    eq(`${key}: accent row`, new RegExp(`${sel}\\s*\\{ --accent:`).test(html), true)
    eq(`${key}: controls rule`,
       new RegExp(`${sel}\\s+\\.feed-bar-controls > \\[data-controls-for="${key}"\\]`).test(html), true)
  }
}

console.log('\n⚠️ The feed bar is MOVED into the Members tab, and moved back:')
{
  /* The Members tab puts three sections above the boost list, so the scope menu
     and the range/sort belong with the list rather than a screen and a half
     above it. Moving one live element is what keeps the eight mounted
     [data-controls-for] groups and their listeners intact; a second bar
     rendered into the tab would be two sets of controls over one feed, which is
     the failure the declarative body[data-active-feed] rule exists to prevent. */
  eq('a cold load on #members puts the bar in the slot', boot('#members').barParent(), 'slot')
  eq('#episodes-global leaves it in the sticky wrap', boot('#episodes-global').barParent(), 'wrap')
  eq('#shows too', boot('#shows').barParent(), 'wrap')
  eq('#albums too', boot('#albums').barParent(), 'wrap')
  eq('#artists too', boot('#artists').barParent(), 'wrap')
  eq('a signed-in #members-follows also lands in the slot',
     boot('#members-follows', { signedIn: true }).barParent(), 'slot')
  {
    /* ⚠️ THE MOVE BACK IS THE HALF THAT BREAKS. `.members-block` is
       display:none off the Members tab, so a bar left in the slot disappears
       from every other feed entirely — no scope menu, no range, no sort, and
       nothing on screen saying why. */
    const b = boot('#members')
    eq('  (starts in the slot)', b.barParent(), 'slot')
    b.location.hash = '#shows'
    b.fire('hashchange')
    eq('⚠️ switching away from Members moves it back to the wrap', b.barParent(), 'wrap')
    b.location.hash = '#members'
    b.fire('hashchange')
    eq('and switching back returns it to the slot', b.barParent(), 'slot')
  }
  eq('the bar is never left parentless', boot('#episodes-global').barParent() !== 'nowhere', true)
}

console.log(`\n${pass} assertions passed${fail ? `, ${fail} FAILED` : ''}.`)
process.exit(fail ? 1 : 0)
