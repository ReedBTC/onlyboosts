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
  /* `spread` is how many distinct shows the member's boosts land on. Piez tops
     sats; Broad tops shows on far fewer sats; Often tops boosts on fewer still.
     Without three different winners the sort parameter is untestable. */
  { pk: '1'.repeat(64), npub: 'npub1aaa', name: 'Piez',            sats: 900, n: 3, spread: 2 },
  { pk: 'a'.repeat(64), npub: 'npub1jjj', name: 'Broad',           sats: 150, n: 8, spread: 8 },
  { pk: 'b'.repeat(64), npub: 'npub1kkk', name: 'Often',           sats: 120, n: 20, spread: 1 },
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
  /* ⚠️ A PUBLISHER KEY. chadf-boostbot's real pubkey, so the fixture exercises
     the actual constant rather than a stand-in. It has the most sats of anyone
     here, so it would top the listing if it were not excluded. */
  { pk: 'f3bd42a91af5f3f1c40ca45ad2269464ab79996b32da78e8ed2ab91111b08e65',
    npub: 'npub1bot', name: 'chadf_boostbot', sats: 9000, n: 40, spread: 30 },
  /* ⚠️ A SECOND PUBLISHER, and it earns its place: with one, `publishers=1`
     returning a single row proves nothing about whether the mode asks for the
     whole list or happens to have found the loudest key. lnaddress-music's real
     pubkey, and deliberately SMALL, so it would never surface by accident. */
  { pk: 'd35ae076512c29b01a5b33aa764ed4db44a9d0bbd96009705f48101f6cfe76a2',
    npub: 'npub1lna', name: 'lnaddress music', sats: 5, n: 2, spread: 2 },
  { pk: '4'.repeat(64), npub: 'npub1ddd', name: 'Bitcoin Audible', sats: 300, n: 1 },
  { pk: '6'.repeat(64), npub: 'npub1fff', name: 'Ünïcödé',          sats: 250, n: 1, sameCase: true },
  { pk: '5'.repeat(64), npub: 'npub1eee', name: null,              sats: 200, n: 1 }, // no profile
]
let ev = 0
const addBoost = (pk, npub, sats, show = null) =>
  db.prepare('INSERT INTO boosts(event_id,booster_pubkey,booster_npub,created_at,sats,podcast_guid) VALUES(?,?,?,?,?,?)')
    /* ⚠️ PAD THE COUNTER, NOT THE WHOLE STRING. `\`e${n}\`.padEnd(64,'0')`
       makes e1 and e10 the same 64 characters, so the eleventh insert hits the
       primary key. Event ids are opaque here; only their uniqueness matters. */
    .run('e' + String(ev++).padStart(63, '0'), pk, npub, 1_700_000_000 + ev, sats, show)

for (const m of FIXED) {
  // Each member's boosts land on `spread` distinct shows, cycling — so sats,
  // boosts and shows genuinely order the fixture differently.
  for (let i = 0; i < m.n; i++) addBoost(m.pk, m.npub, Math.round(m.sats / m.n), 'show' + (i % (m.spread || 1)))
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
console.log('\n⚠️ No query is the LISTING, not a miss:')
{
  const { body } = await call('')
  check('an empty query returns the top members', () => {
    assert.equal(body.listing, true)
    assert.ok(body.count > 0, 'the listing came back empty')
  })
  /* ⚠️ AT A LIMIT THAT REACHES THEM. The profileless fixture member has the
     lowest sats, so the default limit of 8 excludes them and the assertion
     would be testing the limit rather than the LEFT JOIN. */
  const wide = await call('?limit=50')
  check('the listing includes a member with no profile', () => {
    // The wall is a list of MEMBERS, and 61 of the 2,011 have no kind-0. A
    // listing built from `profiles` would silently be a different set from the
    // one /booster/<npub> serves pages for.
    assert.ok(wide.body.members.some((m) => m.pk === '5'.repeat(64)),
      'a member with no profile row is missing from the listing')
  })
  check('the listing is ordered by sats', () => {
    const sats = body.members.map((m) => m.sats)
    assert.ok(sats.length >= 3)
    assert.deepEqual(sats, [...sats].sort((a, b) => b - a))
  })
  const capped = await call('?limit=2')
  check('the listing honours limit', () => assert.equal(capped.body.members.length, 2))
}
{
  const { body } = await call('?q=zzzznobodyhasthisname')
  check('⚠️ a search that MISSES does not fall through to the listing', () => {
    // The listing branch is guarded by its own bind rather than by `like = ''`.
    // Without that guard a query matching nothing returns every member, which
    // reads as a broken search rather than as an empty one.
    assert.equal(body.listing, false)
    assert.equal(body.count, 0)
  })
}
{
  const { body } = await call('?q=p')
  check('a one-character query is still refused, not treated as a listing', () => {
    assert.equal(body.count, 0)
  })
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

console.log('\n⚠️ Three orderings, three different top members:')
{
  const tops = {}
  for (const sort of ['sats', 'boosts', 'shows']) {
    const { body } = await call(`?sort=${sort}&limit=50`)
    check(`sort=${sort} is echoed back`, () => assert.equal(body.sort, sort))
    check(`sort=${sort} is ordered by ${sort}`, () => {
      const v = body.members.map((m) => m[sort])
      assert.ok(v.length >= 3, 'not enough rows to have an order')
      assert.deepEqual(v, [...v].sort((a, b) => b - a))
    })
    tops[sort] = body.members[0].name
  }
  check('the three leaders are three different people', () => {
    assert.equal(tops.sats, 'Piez')
    assert.equal(tops.boosts, 'Often')
    assert.equal(tops.shows, 'Broad')
  })
}
{
  const { body } = await call('?limit=3')
  check('every row carries all three figures, whichever was ranked', () => {
    for (const m of body.members) {
      for (const k of ['sats', 'boosts', 'shows']) {
        assert.equal(typeof m[k], 'number', `${m.name} has no ${k}`)
      }
    }
  })
}
{
  const { body } = await call('?sort=nonsense&limit=3')
  check('an unknown sort falls back to sats rather than erroring', () => {
    assert.equal(body.sort, 'sats')
  })
}

console.log('\n⚠️ Publisher keys: out of the LISTING, still in the SEARCH:')
{
  const BOT = 'f3bd42a91af5f3f1c40ca45ad2269464ab79996b32da78e8ed2ab91111b08e65'
  for (const sort of ['sats', 'boosts', 'shows']) {
    const { body } = await call(`?sort=${sort}&limit=50`)
    check(`the bot does not rank on sort=${sort}`, () => {
      assert.ok(!body.members.some((m) => m.pk === BOT),
        `chadf_boostbot ranked #${body.members.findIndex((m) => m.pk === BOT) + 1} by ${sort}`)
    })
  }
  {
    const { body } = await call('?q=chadf')
    check('⚠️ but searching for it by name still finds it', () => {
      assert.ok(body.members.some((m) => m.pk === BOT),
        'a real account became unreachable, not just unranked')
    })
  }
  {
    const { body } = await call('?q=' + BOT)
    check('and so does its pubkey', () => assert.equal(body.count, 1))
  }
}

console.log('\n⚠️ publishers=1 is the exact complement of the listing:')
{
  const BOT = 'f3bd42a91af5f3f1c40ca45ad2269464ab79996b32da78e8ed2ab91111b08e65'
  const LNA = 'd35ae076512c29b01a5b33aa764ed4db44a9d0bbd96009705f48101f6cfe76a2'
  const { body } = await call('?publishers=1&sort=boosts&limit=50')
  check('the mode is echoed back', () => assert.equal(body.publishers, true))
  check('it is not also the listing', () => assert.equal(body.listing, false))
  check('it returns EVERY publisher present, not just the loudest', () => {
    const got = new Set(body.members.map((m) => m.pk))
    assert.ok(got.has(BOT), 'chadf_boostbot missing')
    assert.ok(got.has(LNA), 'lnaddress-music missing — the mode found one key, not the list')
  })
  check('and nobody else', () => {
    /* The complement claim: every row is a publisher. A leak here is the wall's
       own exclusion inverted, so it would put a person in the bots section. */
    for (const m of body.members) {
      assert.ok(m.pk === BOT || m.pk === LNA, `${m.name || m.pk} is not a publisher`)
    }
  })
  check('rows carry all three figures, as every other mode does', () => {
    for (const m of body.members) {
      for (const k of ['sats', 'boosts', 'shows']) assert.equal(typeof m[k], 'number', k)
    }
  })
  check('sort is honoured', () => {
    const v = body.members.map((m) => m.boosts)
    assert.deepEqual(v, [...v].sort((a, b) => b - a))
  })
  {
    /* ⚠️ THE FLAG MUST NOT WIDEN A SEARCH. `publishers=1` beats an empty q, and a
       q alongside it must still be a search rather than the union of both. */
    const { body: b2 } = await call('?publishers=1&q=Piez')
    check('⚠️ a q alongside it does not union in the search', () => {
      assert.ok(!b2.members.some((m) => m.name === 'Piez'),
        'the bots mode leaked a searched member into the bots section')
    })
  }
  {
    const { body: b3 } = await call('?publishers=0')
    check('publishers=0 is the ordinary listing', () => {
      assert.equal(b3.listing, true)
      assert.ok(!b3.members.some((m) => m.pk === BOT), 'the exclusion stopped applying')
    })
  }
}

console.log(failed
  ? `\n${failed} FAILED, ${passed} passed`
  : `\n${passed} checks passed`)
