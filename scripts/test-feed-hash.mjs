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
}

/** Boot the real controller at `hash` and report what it did. */
function boot(hash, { signedIn = false } = {}) {
  const body = new El('body')
  const bar = new El('div')
  const mk = (attrs) => { const e = new El('button'); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e }
  const tabEls = ['podcasts', 'music', 'members'].map((t) => mk({ 'data-tab': t }))
  const subEls = [
    ['podcasts', 'shows'], ['podcasts', 'episodes'],
    ['music', 'albums'], ['music', 'songs'],
    ['members', 'boosts'],
  ].map(([t, v]) => mk({ 'data-tab': t, 'data-value': v }))
  const listeners = {}
  const events = []
  const doc = {
    body,
    querySelector: (s) => (s === '.feed-bar' ? bar : null),
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
  new Function('document', 'window', 'location', 'history', 'localStorage', 'CustomEvent', 'console', SRC)(
    doc, { addEventListener: () => {} }, location, history, storage, CE, console)
  const selected = (els) => els.filter((e) => e.getAttribute('aria-selected') === 'true')
  return {
    body,
    location,
    events,
    tab: () => (selected(tabEls)[0] || {}).dataset?.tab ?? null,
    sub: () => (selected(subEls)[0] || {}).dataset?.value ?? null,
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
const { normLang, parseHash, hashFor } = new Function(
  'location', 'langByFeed',
  `${[grab('normLang'), grab('parseHash'), grab('hashFor')].join('\n')}
   return { normLang, parseHash, hashFor }`,
)(loc, langByFeed)
const at = (h) => { loc.hash = h; return parseHash() }

console.log('\nParsing the shared URL:')
eq('#shows?lang=de', at('#shows?lang=de'), { key: 'shows', lang: 'de' })
eq('a bare hash is unchanged', at('#shows'), { key: 'shows', lang: '' })
eq('no hash at all', at(''), { key: '', lang: '' })
eq('a retired hash still yields its key', at('#podcasts-global?lang=de').key, 'podcasts-global')
eq('an unknown param is ignored, not choked on', at('#shows?sort=sats').lang, '')
eq('lang alongside one', at('#shows?sort=sats&lang=de').lang, 'de')
eq('a bare ?', at('#shows?'), { key: 'shows', lang: '' })

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

console.log('\nWriting the hash back:')
eq('no filter writes the hash it always wrote', hashFor('shows'), '#shows')
langByFeed['shows'] = 'de'
eq('a filter appends it', hashFor('shows'), '#shows?lang=de')
eq('another feed is unaffected', hashFor('albums'), '#albums')
for (const [feed, lang] of [['shows', 'de'], ['albums', 'en'], ['songs-follows', 'unknown'], ['episodes-global', 'nb']]) {
  langByFeed[feed] = lang
  const h = hashFor(feed)
  const back = at(h)
  eq(`${h} survives a round trip`, [back.key, back.lang], [feed, lang])
}

// ── 2. The boot sequence, which is where both bugs lived ─────────────
console.log('\n⚠️ The cold load, which is what feeds.js reads when its listener attached too late:')
let r = boot('#shows?lang=de')
eq('body[data-active-feed]', r.body.dataset.activeFeed, 'shows')
eq('body[data-feed-lang] carries the language', r.body.dataset.feedLang, 'de')
eq('the hash is left as it was shared', r.location.hash, '#shows?lang=de')
r = boot('#episodes-global?lang=de')
eq('episodes too', [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-global', 'de'])
r = boot('#shows')
eq('no language means an empty attribute, not "all"', r.body.dataset.feedLang, '')

console.log('\nThe event detail agrees with the attribute:')
r = boot('#albums?lang=en')
const act = r.events.filter((e) => e.type === 'lb:feed-activate').pop()
eq('lb:feed-activate fires', !!act, true)
eq('and carries the same language', act.detail, { feed: 'albums', lang: 'en' })
eq('the attribute matches it', r.body.dataset.feedLang, 'en')

console.log('\nCoercion, with the hash rewritten to match what is on screen:')
r = boot('#boosts-global?lang=de')
eq('a feed with no language axis drops it', r.body.dataset.feedLang, '')
eq('and the URL stops claiming it', r.location.hash, '#boosts-global')
r = boot('#shows?lang=all')
eq('?lang=all is no filter', r.body.dataset.feedLang, '')
r = boot('#podcasts-global?lang=de')
eq('a retired hash upgrades AND keeps the language', r.location.hash, '#episodes-global?lang=de')
eq('and hydrates filtered', [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-global', 'de'])
// ⚠️ Bug 2: setFeed coerces the scope here, so the language must be filed under
// the key it RESOLVED to, not the one the hash named.
r = boot('#episodes-follows?lang=de', { signedIn: false })
eq('signed out, follows coerces to global and KEEPS the language',
  [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-global', 'de'])
r = boot('#episodes-follows?lang=de', { signedIn: true })
eq('signed in, follows survives with its language',
  [r.body.dataset.activeFeed, r.body.dataset.feedLang], ['episodes-follows', 'de'])
r = boot('#nonsense?lang=de')
eq('an unknown hash falls back and drops the language', r.location.hash, '#episodes-global')

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
  ['#boosts-global', 'members', 'boosts'],
  ['#podcasts-global', 'podcasts', 'episodes'],   // retired hash, still resolves
  ['', 'podcasts', 'episodes'],                   // no hash at all
  ['#nonsense', 'podcasts', 'episodes'],          // unknown falls back
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
for (const hash of ['#shows', '#episodes-follows', '#songs-follows', '#boosts-follows', '#albums']) {
  const b = boot(hash, { signedIn: true })
  const feed = b.body.getAttribute('data-active-feed')
  const type = feed.replace(/-(global|follows)$/, '')
  const want = { shows: 'podcasts', episodes: 'podcasts', albums: 'music', songs: 'music', boosts: 'members' }[type]
  eq(`${hash} → feed ${feed}, tab ${want}`, b.body.getAttribute('data-active-tab'), want)
}

console.log(`\n${pass} assertions passed${fail ? `, ${fail} FAILED` : ''}.`)
process.exit(fail ? 1 : 0)
