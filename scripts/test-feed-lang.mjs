/* Tests assets/js/feed-lang.js: the language menu behind the four ranked feeds.
 *
 * It imports the real module and stubs only its two dependencies, so the menu
 * ordering, the withholding rule and the copy are all under test as shipped.
 *
 * The rules worth protecting here, all of which have a reason recorded in the
 * module's own header:
 *
 *   - NULL IS NOT ENGLISH. 594 of 1,294 shows declare no <language>, so the
 *     untagged bucket gets its own row ("Not tagged") rather than being folded
 *     into a language or dropped. Once a reader has filtered, that row is the
 *     only way back to those shows.
 *   - NO LANGUAGE IS FLOORED OUT. Ten of the podcast side's nineteen buckets are
 *     a single show; hiding one makes that show unfindable by the axis the
 *     control exists for. The menu scrolls instead.
 *   - A NULL MENU IS A WITHHELD CONTROL, not an error: endpoint down, or one
 *     bucket, which is a choice between a set and itself.
 *   - The phone shows the SUBTAG, which is what makes three controls fit.
 *
 * Run: node scripts/test-feed-lang.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* feed-lang.js imports its siblings by ABSOLUTE, version-stamped URL, which node
 * cannot resolve. Rewrite those two imports to local stubs and load the result.
 * Everything else in the file is the shipped source. */
const dir = mkdtempSync(join(tmpdir(), 'ob-lang-'))
const src = readFileSync(join(ROOT, 'assets/js/feed-lang.js'), 'utf8')
  .replace(/from '\/assets\/js\/feed-controls\.js[^']*'/, "from './feed-controls.js'")
  .replace(/from '\/assets\/js\/ob-live\.js[^']*'/, "from './ob-live.js'")

writeFileSync(join(dir, 'feed-controls.js'), `
/* Only what langControl uses: a wrap element carrying a button and a menu. */
export function sortControl(options, initialKey, onPick, opts = {}) {
  const labelFor = (k) => (options.find((o) => o[0] === k) || options[0])[1]
  const el = mk('div', 'pcast-sort')
  const btn = mk('button', 'pcast-sort-btn')
  btn.append(mk('span', 'pcast-sort-tag', opts.tag || 'Sort: '))
  const cur = mk('span', 'pcast-sort-cur', labelFor(initialKey))
  btn.append(cur, mk('span', 'pcast-sort-caret', '▾'))
  btn.setAttribute('title', opts.title || '')
  const menu = mk('div', 'pcast-sort-menu')
  for (const [k, label] of options) {
    const item = mk('button', 'pcast-sort-item', label)
    item.click = () => { cur.textContent = label; onPick(k) }
    menu.append(item)
  }
  el.append(btn, menu)
  el.pick = (k) => menu.children.find((c) => c.textContent === labelFor(k)).click()
  el.currentLabel = () => cur.textContent
  el.tagText = () => btn.children[0].textContent
  el.title = () => btn.getAttribute('title')
  el.shortText = () => (btn.children.find((c) => c.className === 'pcast-lang-short') || {}).textContent
  el.rows = () => menu.children.map((c) => c.textContent)
  return el
}
function mk(tag, cls, text = '') {
  const attrs = {}
  const el = {
    tag, className: cls, textContent: text, children: [], dataset: {},
    append: (...n) => el.children.push(...n),
    insertBefore: (n, ref) => { const i = el.children.indexOf(ref); el.children.splice(i < 0 ? el.children.length : i, 0, n) },
    setAttribute: (k, v) => { attrs[k] = String(v) },
    getAttribute: (k) => attrs[k] ?? null,
    querySelector: (s) => el.children.find((c) => '.' + c.className === s) || null,
    classList: { add: (c) => { el.className += ' ' + c }, remove() {}, toggle() {}, contains: (c) => el.className.split(/\\s+/).includes(c) },
  }
  return el
}
`)

let NEXT = null
writeFileSync(join(dir, 'ob-live.js'), `
export let __rows = null
export function __set(v) { __rows = v }
export async function getLanguages() {
  if (__rows instanceof Error) throw __rows
  return __rows
}
`)
writeFileSync(join(dir, 'feed-lang.js'), src)

// feed-lang.js calls document.createElement for the subtag span.
globalThis.document = {
  createElement: (tag) => ({
    tag, className: '', textContent: '', children: [], dataset: {},
    append() {}, setAttribute() {}, getAttribute: () => null,
  }),
}

const live = await import(pathToFileURL(join(dir, 'ob-live.js')).href)
const {
  languageOptions, langControl, langNote, langNoMatchText, langLabelFor, LANG_ALL, LANG_UNKNOWN,
} = await import(pathToFileURL(join(dir, 'feed-lang.js')).href)

let pass = 0, fail = 0
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w)
  if (a === b) { pass++; console.log(`  ✓ ${n}`) }
  else { fail++; console.log(`  ✗ ${n}\n      got  ${a}\n      want ${b}`) }
}
const row = (lang, shows) => ({ lang, shows, boosts: 0, sats: 0 })

// The live shape of /api/v1/languages, measured 2026-08-17.
const PODCAST = [
  row('en', 384), row('unknown', 341), row('de', 38), row('es', 14), row('nl', 5),
  row('cs', 4), row('fr', 4), row('it', 3), row('sk', 3), row('hu', 2), row('no', 2),
  row('pt', 2), row('ar', 1), row('da', 1), row('el', 1), row('fi', 1), row('ja', 1),
  row('nb', 1), row('zh', 1),
]
const MUSIC = [row('unknown', 253), row('en', 227), row('de', 2), row('es', 1), row('ru', 1), row('sv', 1)]

console.log('\nThe menu, podcast half (19 buckets):')
live.__set(PODCAST)
const pod = await languageOptions({ medium: null })
eq('every bucket survives; nothing is floored away', pod.length, 20)
eq('All first, then languages by show count, Not tagged LAST',
  [pod[0][1], pod[1][1], pod[2][1], pod[3][1], pod.at(-1)[1]],
  ['All', 'English', 'German', 'Spanish', 'Not tagged'])
eq('the single-show languages are all present and named',
  ['Arabic', 'Danish', 'Greek', 'Finnish', 'Japanese', 'Chinese'].every((n) => pod.some((o) => o[1] === n)), true)
eq('no raw subtag leaks into a label', pod.filter((o) => /^[a-z]{2,3}$/.test(o[1])), [])

console.log('\nThe menu, music half (6 buckets, a different set):')
live.__set(MUSIC)
const mus = await languageOptions({ medium: 'music' })
eq('its own shorter menu', mus.map((o) => o[1]),
  ['All', 'English', 'German', 'Spanish', 'Russian', 'Swedish', 'Not tagged'])
eq('the untagged bucket is the LARGEST here and still sorts last', mus.at(-1)[0], LANG_UNKNOWN)

console.log('\nWithholding, which is a control that is simply not mounted:')
live.__set([]);                     eq('no rows', await languageOptions({}), null)
live.__set([row('en', 384)]);       eq('one language is a choice between a set and itself', await languageOptions({}), null)
live.__set([row('en', 384), row('unknown', 341)])
eq('one language plus the bucket IS a choice', (await languageOptions({})).length, 3)
live.__set(new Error('HTTP 404')); eq('an endpoint that is down', await languageOptions({}), null)
live.__set(null);                   eq('a malformed body', await languageOptions({}), null)
live.__set([row('en', 5), row('zz', 2), row('unknown', 9)])
eq('an unrecognised subtag falls back to uppercase',
  (await languageOptions({})).map((o) => o[1]), ['All', 'English', 'ZZ', 'Not tagged'])

console.log('\nThe feed note, composed as a SECOND sentence rather than a rewritten first:')
eq('unfiltered is the line the feed always carried',
  langNote('Ranks based on every boost in the index', LANG_ALL, 'All', 'show'),
  'Ranks based on every boost in the index')
eq('a language adds a sentence',
  langNote('Ranks based on every boost in the index', 'de', 'German', 'show'),
  'Ranks based on every boost in the index. German-language shows only.')
eq('the untagged bucket names an absence, not a language',
  langNote('Ranks based on every boost in the index', LANG_UNKNOWN, 'Not tagged', 'show'),
  'Ranks based on every boost in the index. Shows with no language tag only.')
eq('follows and the music noun compose with it',
  langNote('Ranks based on only boosts from the accounts you follow', 'de', 'German', 'album'),
  'Ranks based on only boosts from the accounts you follow. German-language albums only.')

console.log('\nThe no-match line:')
eq('a language miss', langNoMatchText('de', 'German', 'show'),
  'No match among German-language shows. Try All languages.')
eq('an untagged miss', langNoMatchText(LANG_UNKNOWN, 'Not tagged', 'album'),
  'No match among albums with no language tag. Try All languages.')

console.log('\nLabels without waiting for the menu (a URL names a language on first paint):')
eq('all', langLabelFor(LANG_ALL), 'All')
eq('a subtag', langLabelFor('de'), 'German')
eq('the bucket', langLabelFor(LANG_UNKNOWN), 'Not tagged')

console.log('\nThe control:')
live.__set(PODCAST)
const opts = await languageOptions({})
let picked = null
const ctl = langControl(opts, LANG_ALL, (k, l) => { picked = [k, l] })
eq('carries the .pcast-lang hook feed-cards.css scopes its scroll and phone rules to',
  ctl.classList.contains('pcast-lang'), true)
eq('unset: data-lang is "all", so the phone rule shows the AXIS', ctl.dataset.lang, 'all')
eq('unset: the tag names the axis, with the colon added in CSS', ctl.tagText(), 'Language')
eq('the desktop pill shows the value', ctl.currentLabel(), 'All')
eq('the menu holds every row', ctl.rows().length, 20)
ctl.pick('de')
eq('picking reports (key, label)', picked, ['de', 'German'])
eq('picked: data-lang carries the key, so the phone rule shows the VALUE', ctl.dataset.lang, 'de')
eq('picked: the full name survives in the tooltip', ctl.title(), 'Language: German')
ctl.pick(LANG_UNKNOWN)
eq('the untagged bucket has no subtag, so its tooltip says what the row said',
  ctl.title(), 'Language: Not tagged')

console.log(`\n${pass} assertions passed${fail ? `, ${fail} FAILED` : ''}.`)
process.exit(fail ? 1 : 0)
