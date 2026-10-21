/**
 * Every Pages Function that answers a GET also answers a HEAD.
 *
 * Pages routes by method, and a HEAD with no handler falls through to the
 * static lookup, which answers 404 for a URL whose GET is fine. CLAUDE.md
 * carried that rule since 2026-08-30; on 2026-09-07 eighteen Functions still
 * lacked the handler, including the three most-shared pages. This scan is the
 * guard the rule never had.
 *
 * Two halves: a SOURCE scan of functions/ for any module exporting
 * onRequestGet without onRequestHead (the two money endpoints are the
 * allowlist — a HEAD must not ask a third party for an invoice or a node
 * record on a link checker's behalf), and the shared helper itself: the GET's
 * status and headers, no body, through a stub GET.
 *
 * Run: node scripts/test-head-routes.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { headOf } from '../functions/_shared/head.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS = join(ROOT, 'functions')

/* ⚠️ THE ALLOWLIST IS THE MONEY ENDPOINTS AND NOTHING ELSE. Adding a path here
 * is a decision that a HEAD on it would do harm; write the reason in
 * _shared/head.js beside the other two. */
const NO_HEAD_ON_PURPOSE = new Set(['api/lnurl.js', 'api/keysend.js'])

let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

console.log('Every Function with a GET has a HEAD:')
const getters = walk(FUNCTIONS).filter((p) => /export (async )?(function|const) onRequestGet\b/.test(readFileSync(p, 'utf8')))
check('the scan finds the Functions at all (a regex that matches nothing passes vacuously)', () => {
  assert.ok(getters.length >= 25, `found ${getters.length}`)
})
const missing = getters.filter((p) => !/export (async )?(function|const) onRequestHead\b/.test(readFileSync(p, 'utf8')))
  .map((p) => relative(FUNCTIONS, p))
check('⚠️ no Function exports onRequestGet without onRequestHead, the two money endpoints excepted', () => {
  const offenders = missing.filter((p) => !NO_HEAD_ON_PURPOSE.has(p))
  assert.deepEqual(offenders, [])
})
check('the two money endpoints really do lack one (the allowlist is not stale)', () => {
  for (const p of NO_HEAD_ON_PURPOSE) assert.ok(missing.includes(p), `${p} now has a HEAD handler; drop it from the allowlist or explain`)
})
const importErrors = []
for (const p of getters) { try { await import(p) } catch (e) { importErrors.push(`${relative(FUNCTIONS, p)}: ${e.message}`) } }
check('every Function that exports onRequestGet is reachable as a module (a broken import would 500 every method)', () => {
  assert.deepEqual(importErrors, [])
})

console.log('\nThe shared helper:')
{
  const seen = []
  const get = async (ctx) => { seen.push(ctx); return new Response('<html>body</html>', { status: 203, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=120', 'X-Test': 'yes' } }) }
  const head = headOf(get)
  const ctx = { request: new Request('https://ob.invalid/x', { method: 'HEAD' }), env: {}, params: {} }
  const r = await head(ctx)
  check('the GET\'s status and every header, no body', () => {
    assert.equal(r.status, 203)
    assert.equal(r.headers.get('cache-control'), 'public, max-age=120')
    assert.equal(r.headers.get('x-test'), 'yes')
    assert.equal(r.body, null)
  })
  check('the GET ran once, with the same context', () => {
    assert.equal(seen.length, 1)
    assert.equal(seen[0], ctx)
  })
  const redirect = headOf(async () => Response.redirect('https://ob.invalid/elsewhere', 302))
  const rr = await redirect(ctx)
  check('a redirecting GET is a redirecting HEAD', () => {
    assert.equal(rr.status, 302)
    assert.equal(rr.headers.get('location'), 'https://ob.invalid/elsewhere')
  })
}

/* ⚠️ A SHELL FETCHED WITH THE INCOMING REQUEST AS INIT IS A HEAD ON A HEAD,
 * and an empty shell makes the fill throw: thirteen routes answered 500 to
 * curl -I on 2026-10-21 while every GET was 200, and the scan above was
 * green because it only checks the handler exists. Two guards: the source
 * must go through assetGet, and the real renderer must answer a HEAD. */
console.log('\nA shell is fetched with GET whatever the incoming method:')
check('no Function passes the incoming request as the init of an ASSETS fetch', () => {
  const bad = []
  for (const f of walk(FUNCTIONS)) {
    const src = readFileSync(f, 'utf8')
    if (/ASSETS\.fetch\(new Request\([^)]*\),\s*request\)/.test(src) || /ASSETS\.fetch\(request\)/.test(src)) bad.push(relative(FUNCTIONS, f))
  }
  assert.deepEqual(bad, [])
})
{
  const { renderShellPage, resolveRoute, notFoundPage } = await import('../functions/_shared/charts-page.js')
  const shell = readFileSync(join(ROOT, 'charts.html'), 'utf8')
  const asked = []
  // Method-faithful, as Pages' asset server is: a HEAD gets no body.
  const ASSETS = { fetch: async (req) => { asked.push(req.method); return new Response(req.method === 'HEAD' ? null : (req.url.endsWith('/404') ? '<html>404</html>' : shell), { status: req.url.endsWith('/404') ? 404 : 200 }) } }
  const env = { ASSETS }
  const ctx = (path, method) => ({ request: new Request(`https://ob.invalid${path}`, { method }), env, params: {} })
  const head = headOf((c) => renderShellPage(c, resolveRoute('podcasts', 'shows')))
  const r = await head(ctx('/podcasts/shows', 'HEAD'))
  check('HEAD /podcasts/shows answers the GET\'s 200 through the real renderer', () => {
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(r.body, null)
  })
  check('and the shell was fetched with GET', () => { assert.deepEqual([...new Set(asked)], ['GET']) })
  asked.length = 0
  const r404 = await headOf(notFoundPage)(ctx('/podcasts/videos', 'HEAD'))
  check('HEAD on an unknown view is the 404 page\'s 404, its shell fetched with GET', () => {
    assert.equal(r404.status, 404)
    assert.deepEqual([...new Set(asked)], ['GET'])
  })
}

console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} passed`)
