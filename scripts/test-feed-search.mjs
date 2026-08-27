/* Tests the feed search box's two outcomes, against the SHIPPED module.
 *
 * feed-search.js gained a second outcome on 2026-08-27 (Reed's ask): where a
 * feed supplies `onSubmit`, Enter with no suggestion highlighted hands the
 * whole query to the feed, which becomes the full result list. That flag also
 * turns off suggestion auto-highlight — Enter must mean "search what I typed"
 * until the reader arrows into the menu — while the member lookup, which
 * supplies no `onSubmit`, keeps the original contract where Enter takes the
 * top hit. Both halves live in event-handler wiring that no unit test of a
 * copied function could see, so this drives mountFeedSearch itself against a
 * stub DOM, the test-feed-hash.mjs technique.
 *
 * The module has no imports of its own, which is what makes the stub cheap:
 * `document` is the only global it touches.
 *
 * Run: node scripts/test-feed-search.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── The smallest DOM the box touches ─────────────────────────────────
class ClassList {
  constructor() { this.set = new Set() }
  add(c) { this.set.add(c) }
  remove(c) { this.set.delete(c) }
  toggle(c, on) { on ? this.set.add(c) : this.set.delete(c) }
  contains(c) { return this.set.has(c) }
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []; this.attrs = {}; this.listeners = {}
    this.hidden = false; this.value = ''; this._text = ''
    this.classList = new ClassList()
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)) }
  get className() { return [...this.classList.set].join(' ') }
  set textContent(v) { this._text = String(v); this.children = [] }
  get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join('') }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  removeAttribute(k) { delete this.attrs[k] }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn) }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn) }
  fire(t, ev = {}) { for (const f of [...(this.listeners[t] || [])]) f({ preventDefault() {}, ...ev }) }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c }
  append(...cs) { cs.forEach((c) => this.appendChild(c)) }
  replaceChildren(...cs) { this.children = []; this.append(...cs) }
  contains() { return false }
  focus() {}
  scrollIntoView() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  querySelectorAll(sel) {
    // Two selector shapes reach here: '.class' and '[data-attr]'.
    const byAttr = sel.startsWith('[') ? sel.slice(1, -1) : null
    const cls = byAttr ? null : sel.replace(/^\./, '')
    const out = []
    const walk = (el) => {
      for (const c of el.children || []) {
        if (byAttr ? (c.attrs && byAttr in c.attrs) : c.classList?.contains?.(cls)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
}
const documentStub = {
  createElement: (t) => new El(t),
  createElementNS: (_ns, t) => new El(t),
  createTextNode: (v) => ({ textContent: String(v) }),
  addEventListener() {}, removeEventListener() {},
}

// ── Load the shipped module with `document` injected ─────────────────
// Stripped of `export ` and run as a script, because a data-URL import could
// not see the stub: `document` has to be the module's global.
const src = readFileSync(join(ROOT, 'assets/js/feed-search.js'), 'utf8')
  .replace(/^export /gm, '')
const mountFeedSearch = new Function('document', `${src}\nreturn mountFeedSearch`)(documentStub)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`) }
}
// Past the 220ms remote debounce, plus the microtask that resolves the hits.
const settle = () => new Promise((r) => setTimeout(r, 300))

function panelWithSlot() {
  const panel = new El('section')
  const slot = new El('div')
  slot.setAttribute('data-feed-search', '')
  panel.appendChild(slot)
  return panel
}
const HITS = [
  { key: 'a', label: 'Alpha Show', sub: '', img: null, query: '' },
  { key: 'b', label: 'Beta Show', sub: '', img: null, query: '' },
]

async function drive({ withSubmit }) {
  const calls = { picks: [], submits: [] }
  const panel = panelWithSlot()
  mountFeedSearch(panel, {
    placeholder: 'p', label: 'l', minChars: 2,
    searchRemote: async () => HITS,
    onPick: (e) => calls.picks.push(e ? e.key : null),
    ...(withSubmit ? { onSubmit: (q) => calls.submits.push(q) } : {}),
  })
  return { calls, panel, input: panel.querySelector('.feed-search-input') }
}

console.log('\nWith onSubmit — the four ranked feeds:')
{
  const { calls, input } = await drive({ withSubmit: true })
  input.value = 'bitcoin'
  input.fire('input')
  await settle()
  input.fire('keydown', { key: 'Enter' })
  eq('Enter with nothing highlighted submits the query', calls.submits, ['bitcoin'])
  eq('and picks nothing', calls.picks, [])
}
{
  const { calls, input } = await drive({ withSubmit: true })
  input.value = 'bit'
  input.fire('input')
  await settle()
  input.fire('keydown', { key: 'ArrowDown' })
  input.fire('keydown', { key: 'Enter' })
  eq('arrow + Enter still picks the suggestion', calls.picks, ['a'])
  eq('and submits nothing', calls.submits, [])
}
{
  const { calls, input } = await drive({ withSubmit: true })
  input.value = 'b'
  input.fire('input')
  input.fire('keydown', { key: 'Enter' })
  eq('a query under minChars does not submit', calls.submits, [])
}
{
  // ⚠️ Emptying the box must drop the filter: the × vanishes with the text,
  // so a submitted query left active would strand the reader in results mode
  // with nothing on screen naming it and no visible way out.
  const { calls, input } = await drive({ withSubmit: true })
  input.value = 'bitcoin'
  input.fire('input')
  await settle()
  input.fire('keydown', { key: 'Enter' })
  input.value = ''
  input.fire('input')
  eq('emptying the box after a submit clears via onPick(null)', calls.picks, [null])
}
{
  const { calls, input } = await drive({ withSubmit: true })
  input.value = 'bitcoin'
  input.fire('input')
  await settle()
  input.fire('keydown', { key: 'Enter' })
  input.fire('keydown', { key: 'Escape' })
  eq('Escape after a submit clears via onPick(null)', calls.picks, [null])
}
{
  // The mouse's road into the feature: a reader who never presses Enter has
  // to be shown that the whole query is an option.
  const { input, panel } = await drive({ withSubmit: true })
  input.value = 'bitcoin'
  input.fire('input')
  await settle()
  const rows = panel.querySelectorAll('.feed-search-all')
  eq('the "See all results" footer row renders', rows.length, 1)
  eq('naming the query', rows[0].textContent.includes('bitcoin'), true)
}

console.log('\n⚠️ Without onSubmit — the member lookup, deliberately unchanged:')
{
  const { calls, input, panel } = await drive({ withSubmit: false })
  input.value = 'bit'
  input.fire('input')
  await settle()
  input.fire('keydown', { key: 'Enter' })
  eq('Enter takes the auto-highlighted top suggestion', calls.picks, ['a'])
  eq('and no footer row renders', panel.querySelectorAll('.feed-search-all').length, 0)
}

console.log(`\n${pass} assertions passed${fail ? `, ${fail} FAILED` : ''}.`)
process.exit(fail ? 1 : 0)
