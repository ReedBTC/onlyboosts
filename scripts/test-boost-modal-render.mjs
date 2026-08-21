#!/usr/bin/env node
/**
 * The boost modal's component body, checked for bindings read before they are
 * declared.
 *
 * ⚠️ IT EXISTS BECAUSE ONE OF THESE REACHED PRODUCTION AND WAS INVISIBLE UNTIL
 * A REAL PAYMENT WAS IN FLIGHT. `paySeconds` read `payTick` about thirty lines
 * above its `useState`, which is a temporal dead zone — but the read sits
 * inside a ternary, `payingLeg?.startedAt ? (… payTick …) : 0`, so the branch
 * is only evaluated once a leg is actually paying. The form rendered, the done
 * screen rendered, every test passed, and then a live boost threw
 * `Cannot access 'payTick' before initialization` **during render**, about a
 * second in.
 *
 * What that costs is out of proportion to the typo, which is why this is worth
 * a script of its own. A render error with no boundary above it **unmounts the
 * React root**: the modal vanishes mid-payment, the payment completes anyway
 * because its promise is detached, no note is ever published because `phase`
 * never reaches 'done', and the page's Boost button is dead until a reload
 * because the host root no longer exists. Four unrelated-looking symptoms, one
 * missing line-order.
 *
 * ⚠️ THIS REPO HAS NO LINTER. `no-use-before-define` would catch this class in
 * one rule, and adding eslint to `login-widget/` is the better fix if anyone
 * ever wants it. Until then this scan is the whole defence, so **keep it
 * pointed at every component that renders during a payment**.
 *
 * ⚠️ IT IS A TEXT SCAN, NOT AN EXECUTION. A real render test would need jsdom
 * (state has to advance past 'form' before the crashing branch is reachable,
 * and `renderToString` runs no effects), which is a dependency this repo does
 * not have. The scan cannot see everything a renderer would; what it does see
 * is the exact failure that got us here, cheaply, with no new dependency.
 *
 * Run: node scripts/test-boost-modal-render.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Every component that renders while a leg is in flight. A crash in any of
// these takes the widget root down mid-payment.
const TARGETS = [
  ['login-widget/src/components/ExternalBoostModal.jsx', 'export default function ExternalBoostModal'],
]

let passed = 0
function ok(label) { passed++; console.log(`  ✓ ${label}`) }

/**
 * Top-level `const`/`let` bindings of one function body, in source order.
 * Anchored to two-space indentation, which is the component body's own level:
 * a binding nested inside a callback or a block has its own scope and cannot
 * be the subject of this check.
 */
function topLevelBindings(body) {
  const decl = /^ {2}(?:const|let) (?:\[\s*([A-Za-z0-9_]+)\s*,\s*[A-Za-z0-9_$]+\s*\]|([A-Za-z0-9_]+))\s*=/gm
  const out = []
  let m
  while ((m = decl.exec(body))) out.push({ name: m[1] || m[2], at: m.index })
  return out
}

/** Reads of `name` in `text`, ignoring comment lines and property accesses. */
function readsOf(name, text) {
  const re = new RegExp(`(?<![A-Za-z0-9_.$])${name}(?![A-Za-z0-9_])`, 'g')
  return [...text.matchAll(re)].filter((hit) => {
    const lineStart = text.lastIndexOf('\n', hit.index) + 1
    const lineEnd = text.indexOf('\n', hit.index)
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    // JSDoc and `//` lines name these bindings constantly and mean nothing by
    // it. This is the one heuristic in here; a binding named only in prose
    // above its declaration is not a use.
    return !/^\s*(\*|\/\/|\/\*)/.test(line)
  })
}

console.log('\nNo binding is read before it is declared:')
for (const [file, anchor] of TARGETS) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const start = src.indexOf(anchor)
  assert.notEqual(start, -1, `${file}: could not find "${anchor}" — was the component renamed?`)
  const body = src.slice(start)

  const offenders = []
  for (const { name, at } of topLevelBindings(body)) {
    const hits = readsOf(name, body.slice(0, at))
    if (hits.length) {
      const line = body.slice(0, hits[0].index).split('\n').length
      const declLine = body.slice(0, at).split('\n').length
      offenders.push(`${name} — read at body line ${line}, declared at ${declLine}`)
    }
  }
  assert.deepEqual(offenders, [], `${file}: temporal dead zone(s)\n  ${offenders.join('\n  ')}`)
  ok(`${file.split('/').pop()} (${topLevelBindings(body).length} bindings checked)`)
}

// ⚠️ THE SCAN IS ONLY WORTH ANYTHING IF IT STILL DETECTS THE ORIGINAL BUG.
// A regex that quietly stops matching passes forever, which is the failure
// mode of every text-based check. So it is fed the shape it was written for.
console.log('\nThe scan still catches the bug it was written for:')
const REGRESSION = `export default function Thing() {
  const legs = []
  const paying = legs[0]
  const seconds = paying?.startedAt
    ? Math.floor(((payTick || Date.now()) - paying.startedAt) / 1000)
    : 0
  const [payTick, setPayTick] = useState(0)
  return seconds
}`
{
  const body = REGRESSION.slice(REGRESSION.indexOf('export default function Thing'))
  const caught = topLevelBindings(body)
    .filter(({ name, at }) => readsOf(name, body.slice(0, at)).length)
    .map((b) => b.name)
  assert.deepEqual(caught, ['payTick'], 'the scan no longer detects the shipped bug')
  ok('the payTick shape is still detected')
}
{
  // And the other direction: a binding merely NAMED in a comment above its
  // declaration is not a use, or every documented constant would fail.
  const body = `export default function Thing() {
  // \`later\` is explained here, above where it lives.
  const first = 1
  const later = 2
  return first + later
}`.slice(0)
  const caught = topLevelBindings(body)
    .filter(({ name, at }) => readsOf(name, body.slice(0, at)).length)
  assert.deepEqual(caught, [], 'a comment mentioning a binding must not count as a read')
  ok('a binding named in a comment above itself is not a use')
}

console.log(`\n${passed} assertions passed.\n`)
