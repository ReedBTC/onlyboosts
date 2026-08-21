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

// ─── The theme actually reaches the page ───────────────────────────────────
/**
 * ⚠️ A TAILWIND ARBITRARY VALUE THAT TAILWIND CANNOT CLASSIFY EMITS THE WRONG
 * PROPERTY, SILENTLY, AND THE BUILD SAYS NOTHING. Caught while shipping the
 * light theme: `font-[var(--font-display)]` compiled to
 * `font-weight: var(--font-display)` — Tailwind cannot tell a family from a
 * weight in a bare `font-[…]`, guessed weight, and produced a declaration the
 * browser then ignored. Every heading was in the default sans and every class
 * name in the markup looked correct. `font-[family-name:var(--font-display)]`
 * is the fix, and the same trap sits on `ring-`, `text-` and `bg-` wherever a
 * value could be read as a length or a colour.
 *
 * So the check is on the OUTPUT, not the source: for each token the modals
 * depend on, assert the built bundle carries a rule that actually sets it.
 * The CSS is injected as a JS string, so its selector escapes are doubled;
 * matching on the declaration side avoids that entirely.
 */
console.log('\nThe themed classes emit real CSS:')
{
  const bundle = readFileSync(new URL('../assets/widgets/login-widget.js', import.meta.url), 'utf8')
  const REQUIRED = [
    'background-color:var(--modal-bg)',
    'background-color:var(--modal-field)',
    'background-color:var(--modal-inset)',
    'background-color:var(--brand)',
    'background-color:var(--brand-tint)',
    'background-color:var(--scrim)',
    'color:var(--ink)',
    'color:var(--muted)',
    'color:var(--ok)',
    'color:var(--warn)',
    'color:var(--danger)',
    'border-color:var(--border)',
    'accent-color:var(--brand)',
    // The two that were wrong. Family, not weight; ring COLOUR, not width.
    'font-family:var(--font-display)',
    '--tw-ring-color: var(--brand-ring)',
  ]
  const missing = REQUIRED.filter((d) => !bundle.includes(d))
  assert.deepEqual(missing, [], `the built widget emits no rule for:\n  ${missing.join('\n  ')}`)
  ok(`${REQUIRED.length} declarations present in the built bundle`)

  // And the wrong-property version must not come back.
  assert.equal(bundle.includes('font-weight:var(--font-display)'), false,
    'font-[var(--font-display)] is compiling to font-weight again — it needs the family-name hint')
  ok('no token is being applied as the wrong property')

  /**
   * ⚠️ THE SECOND SILENT-FAILURE SHAPE, FOUND THE SAME WAY: Tailwind cannot
   * apply an opacity modifier to an arbitrary `var()` colour. `border-[var(--
   * brand)]/40` emits **nothing at all** — not a wrong property this time, just
   * no rule — so the element falls back to `currentColor` and the build says
   * nothing. Five of these had crept in across the modals.
   *
   * There is no way to express it in the token, so the rule is: an alpha on a
   * var is a literal `rgba()` or a different token. This scan is what enforces
   * it, since neither Tailwind nor the bundler will.
   */
  const ALPHA_ON_VAR = /(?:bg|text|border|ring|divide|from|to|via)-\[var\(--[a-z-]+\)\]\/\d/
  const styled = [
    'ExternalBoostModal', 'WalletConnectModal', 'LoginModal', 'LoginScreen', 'BoostModal',
    'MultiLegBoostForm', 'BugReportModal', 'ConfirmLeaveOverlay', 'ModalErrorBoundary',
    'IdentityDropdown', 'BoostProgressView', 'BoostExpectations', 'ToastHost', 'LoginButton',
  ]
  const offenders = []
  for (const name of styled) {
    const text = readFileSync(new URL(`../login-widget/src/components/${name}.jsx`, import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const hit = line.match(ALPHA_ON_VAR)
      if (hit) offenders.push(`${name}: ${hit[0]}`)
    }
  }
  assert.deepEqual(offenders, [], `an opacity modifier on a var() colour emits no CSS:\n  ${offenders.join('\n  ')}`)
  ok('no class applies an alpha to a var() colour')

  // ⚠️ The bundle is a build artifact. If it is stale the two assertions above
  // pass against yesterday's CSS, so the source is checked to agree with it.
  const src = readFileSync(new URL('../login-widget/src/components/ExternalBoostModal.jsx', import.meta.url), 'utf8')
  assert.equal(/\bbg-neutral-|\btext-neutral-|\bbg-orange-|\btext-amber-400\b/.test(src), false,
    'ExternalBoostModal still carries dark-theme classes — was the widget rebuilt?')
  ok('the boost modal carries no dark-theme classes')
}

console.log(`\n${passed} assertions passed.\n`)
