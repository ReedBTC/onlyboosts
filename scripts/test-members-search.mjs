#!/usr/bin/env node
/**
 * Run the SHIPPED /api/v1/members handler against a real D1-shaped database.
 *
 * ⚠️ IT EXERCISES THE ENDPOINT, NOT A COPY OF ITS SQL. The handler is imported
 * and called with a `env.DB` shim over node:sqlite, so the query under test is
 * the one that deploys — including the escaping, the three-way branch on what
 * the reader typed, and the shape of the response. A test holding its own copy
 * of the SQL passes forever while the shipped one rots.
 *
 * The fixture is built from `bots/global-boost-scan/d1/schema.sql` — the same
 * file applied to the live D1 — and populated from a capture of the production
 * corpus, so the row shapes (nullable npubs, members with no profile, unicode
 * display names) are real rather than invented.
 *
 * Run: node scripts/test-members-search.mjs [captured-boosts.json]
 *      With no argument it fetches the corpus it needs from production.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { onRequestGet } from '../functions/api/v1/members.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ⚠️ THE SUMMARY REPORTS FAILURES, NOT ONLY PASSES. It printed "N checks
 * passed" and set a non-zero exit code, which is correct and unreadable: a
 * green-looking last line over a red run is exactly what gets skimmed. This
 * file was red for its first three revisions because of it. */
let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// ── The fixture ─────────────────────────────────────────────────────────────
const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(ROOT, 'bots/global-boost-scan/d1/schema.sql'), 'utf8'))

/* Real records where we have them, a hand-built set otherwise. The hand-built
 * rows are the cases a capture is unlikely to contain: LIKE metacharacters in a
 * display name, and a member with no profile row at all. */
const FIXED = [
  { pk: '1'.repeat(64), npub: 'npub1aaa', name: 'Piez',            sats: 900, n: 3 },
  { pk: '2'.repeat(64), npub: 'npub1bbb', name: '100% Bitcoin',    sats: 500, n: 2 },
  { pk: '3'.repeat(64), npub: 'npub1ccc', name: 'under_score',     sats: 400, n: 2 },
  /* ⚠️ THE DECOYS ARE THE WHOLE POINT OF THE ESCAPING TESTS. Without a member
   * that an unescaped wildcard would ALSO match, `q=100%` returns one row
   * either way and the assertion passes with the escaping deleted — which is
   * what it did until a mutation run exposed it. `underscore` is what `r_s`
   * catches when `_` is still "any character"; `100 Bitcoin` is what `100%`
   * catches when `%` is still "anything". */
  { pk: '7'.repeat(64), npub: 'npub1ggg', name: 'underscore',      sats: 350, n: 1 },
  { pk: '8'.repeat(64), npub: 'npub1hhh', name: '100 Bitcoin',     sats: 340, n: 1 },
  /* ⚠️ A NAME THAT LOOKS LIKE AN IDENTIFIER. Without it, "a query that is
   * plainly an npub is not also a name" is untestable — no fixture name
   * contains an npub, so searching both columns changes nothing and the
   * assertion passes with the split deleted. */
  { pk: '9'.repeat(64), npub: 'npub1iii', name: 'npub1ccc superfan', sats: 330, n: 1 },
  { pk: '4'.repeat(64), npub: 'npub1ddd', name: 'Bitcoin Audible', sats: 300, n: 1 },
  { pk: '6'.repeat(64), npub: 'npub1fff', name: 'Ünïcödé',          sats: 250, n: 1, sameCase: true },
  { pk: '5'.repeat(64), npub: 'npub1eee', name: null,              sats: 200, n: 1 }, // no profile
]
let ev = 0
const addBoost = (pk, npub, sats) =>
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,booster_npub,created_at,sats) VALUES(?,?,?,?,?)')
    /* ⚠️ PAD THE COUNTER, NOT THE WHOLE STRING. `\`e${n}\`.padEnd(64,'0')`
       makes e1 and e10 the same 64 characters, so the eleventh insert hits the
       primary key. Event ids are opaque here; only their uniqueness matters. */
    .run('e' + String(ev++).padStart(63, '0'), pk, npub, 1_700_000_000 + ev, sats)

for (const m of FIXED) {
  for (let i = 0; i < m.n; i++) addBoost(m.pk, m.npub, Math.round(m.sats / m.n))
  if (m.name !== null) {
    /* `name` is normally the lowercase handle and `display_name` the pretty
       form, which is what the collector stores. `sameCase` pins both columns to
       the same string — without it a lowercase query matches the `name` column
       by luck and says nothing about how LIKE folds. */
    const handle = m.sameCase ? m.name : m.name.toLowerCase().replace(/\s+/g, '')
    db.prepare('INSERT INTO profiles(pubkey,name,display_name,picture) VALUES(?,?,?,?)')
      .run(m.pk, handle, m.name, 'https://example.com/a.png')
  }
}

// Optional: fold in a production capture so the corpus is real-sized.
const capture = process.argv[2] || join(ROOT, '.members-capture.json')
let real = 0
if (existsSync(capture)) {
  const rows = JSON.parse(readFileSync(capture, 'utf8'))
  const seen = new Set()
  for (const b of rows) {
    const bo = b.booster || {}
    if (!bo.pk) continue
    addBoost(bo.pk, bo.npub || null, b.sats || 0)
    if (!seen.has(bo.pk) && (bo.name || bo.dname)) {
      seen.add(bo.pk)
      db.prepare('INSERT OR IGNORE INTO profiles(pubkey,name,display_name,picture) VALUES(?,?,?,?)')
        .run(bo.pk, bo.name || null, bo.dname || null, bo.pic || null)
    }
  }
  real = rows.length
}

/* The D1 shim. `prepare().bind().all()` is the whole surface this handler uses,
 * and D1 returns `{ results }`. */
const env = {
  DB: {
    prepare(sql) {
      return {
        bind(...args) {
          return { all: async () => ({ results: db.prepare(sql).all(...args) }) }
        },
      }
    },
  },
}

const call = async (qs) => {
  const req = new Request(`https://ob.invalid/api/v1/members${qs}`)
  const res = await onRequestGet({ request: req, env })
  return { status: res.status, body: await res.json() }
}
const names = (b) => b.members.map((m) => m.name || m.pk.slice(0, 8))

console.log(`\nfixture: ${FIXED.length} hand-built members` + (real ? ` + ${real} captured boosts` : ''))

console.log('\nFinding a member by name:')
{
  const { body } = await call('?q=piez')
  check('an exact name, in the wrong case', () => {
    assert.ok(names(body).includes('Piez'), `got ${JSON.stringify(names(body))}`)
  })
}
{
  const { body } = await call('?q=udib')
  check('a substring matches mid-word', () => assert.deepEqual(names(body), ['Bitcoin Audible']))
}
{
  const { body } = await call('?q=' + encodeURIComponent('Ünïcödé'))
  check('a non-ASCII name matches at its own case', () => assert.deepEqual(names(body), ['Ünïcödé']))
}
{
  const { body } = await call('?q=' + encodeURIComponent('ünïcödé'))
  check('⚠️ and does NOT match at another case — SQLite LIKE folds ASCII only', () => {
    /* Documented in members.js rather than worked around: a NOCASE collation is
       ASCII-only too, so nothing cheap fixes it. Asserted so the limitation is
       a known quantity rather than a surprise, and so that a future fix
       (ICU, or a normalized search column written by the collector) fails this
       line loudly and gets the comment updated with it. */
    assert.equal(body.count, 0)
  })
}

console.log('\n⚠️ LIKE metacharacters are what the reader typed, not wildcards:')
{
  const { body } = await call('?q=' + encodeURIComponent('100%'))
  check('a percent sign matches literally, not as a wildcard', () => {
    // '100 Bitcoin' is in the fixture and must NOT come back.
    assert.deepEqual(names(body), ['100% Bitcoin'])
  })
}
{
  const { body } = await call('?q=' + encodeURIComponent('%'))
  check('a bare percent is not "everyone"', () => {
    // Below MIN_CHARS, so it is refused outright — and even at length it would
    // be escaped. Either way the whole membership must not come back.
    assert.equal(body.count, 0)
  })
}
{
  const { body } = await call('?q=' + encodeURIComponent('r_s'))
  check('an underscore is not "any character"', () => {
    // 'underscore' is in the fixture and matches '%r_s%' only while `_` is
    // still a wildcard, so its absence is what proves the escape ran.
    assert.deepEqual(names(body), ['under_score'])
  })
}

console.log('\nFinding a member by identifier:')
{
  const { body } = await call('?q=' + '5'.repeat(64))
  check('⚠️ a member with NO profile is still findable by pubkey', () => {
    assert.equal(body.count, 1)
    assert.equal(body.members[0].pk, '5'.repeat(64))
    assert.equal(body.members[0].name, null)
  })
}
{
  const { body } = await call('?q=npub1ccc')
  check('⚠️ an identifier is not also searched as a name', () => {
    // 'npub1ccc superfan' is in the fixture. Matching names too would return
    // both and hand the reader a stranger alongside the person they pasted.
    assert.deepEqual(names(body), ['under_score'])
  })
}
{
  const { body } = await call('?q=npub1cc')
  check('a partial npub matches as a prefix', () => assert.deepEqual(names(body), ['under_score']))
}
{
  const { body } = await call('?q=NPUB1CCC')
  check('an npub pasted in caps', () => assert.deepEqual(names(body), ['under_score']))
}

console.log('\nWhat it refuses, and what it aggregates:')
{
  const { body } = await call('?q=p')
  check('one character is below the minimum and returns nothing', () => assert.equal(body.count, 0))
}
{
  const { body } = await call('')
  check('no query at all is not an error', () => assert.equal(body.count, 0))
}
{
  const { body } = await call('?q=zzzznobodyhasthisname')
  check('a genuine miss is an empty list, not a 500', () => assert.equal(body.count, 0))
}
{
  const { body } = await call('?q=piez')
  const m = body.members.find((x) => x.name === 'Piez')
  check('the figures are that member\'s own totals', () => {
    assert.equal(m.boosts, 3)
    assert.equal(m.sats, 900)
  })
}
{
  const { body } = await call('?q=e&limit=3')
  check('limit is honoured', () => assert.ok(body.members.length <= 3))
}
{
  const { body } = await call('?q=' + encodeURIComponent('n'.repeat(500)))
  check('an overlong query is truncated rather than refused', () => assert.equal(body.count, 0))
}

console.log('\nOrdering:')
{
  // ⚠️ 'in' matches three fixture members with three different totals. This
  // read `q=e` at first — ONE character, below MIN_CHARS, so it returned an
  // empty list and `[].sort()` equalled `[]`: an ordering test that passed
  // with the ORDER BY reversed. The length guard below is what stops that
  // class of pass returning.
  const { body } = await call('?q=in&limit=50')
  const sats = body.members.map((m) => m.sats)
  check('the query actually returns enough rows to have an order', () => {
    assert.ok(sats.length >= 3, `only ${sats.length} row(s) — this cannot test ordering`)
  })
  check('most sats first', () => {
    assert.deepEqual(sats, [...sats].sort((a, b) => b - a))
  })
}

console.log(failed
  ? `\n${failed} FAILED, ${passed} passed`
  : `\n${passed} checks passed`)
