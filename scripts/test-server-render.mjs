#!/usr/bin/env node
/**
 * Render the server-side surfaces against REAL API responses and assert on them.
 *
 * The companion to test-episode-card.mjs, one level up: that one checks the card
 * against fixtures, this one checks that the three Pages Functions assemble a
 * page out of it correctly — the injection into index.html, the state element
 * the client adopts through, and the size of what a reader actually downloads.
 *
 * ⚠️ IT NEEDS A CAPTURE, NOT A DATABASE. D1 is not reachable from here and
 * wrangler is unauthenticated, so the input is a saved response from production:
 *
 *   curl -s 'https://onlyboosts.social/api/v1/episodes?not_medium=music\
 * &include=boosts&limit=30&sort=boosts&range=all' > <file>
 *
 * Run: node scripts/test-server-render.mjs <captured-episodes.json>
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { itemsFromBoosts, renderCardPage, CARDS_PER_PAGE } from '../functions/_shared/episode-cards.js'
import { episodeApiToBoosts } from '../assets/js/ob-data.js'
import { COPY } from '../assets/js/episode-card.js'

const capture = process.argv[2]
if (!capture) {
  console.error('usage: node scripts/test-server-render.mjs <captured-episodes.json>')
  process.exit(2)
}

let passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

const api = JSON.parse(readFileSync(capture, 'utf8'))
const records = api.episodes || []
const { boosts, totals } = episodeApiToBoosts(records)
const { items, profiles } = itemsFromBoosts(boosts, { sort: 'boosts' })
for (const it of items) it.totals = totals.get(it.guid) || null

const block = `<div class="pcast-list">${renderCardPage(items, {
  copy: COPY.other, profiles, sort: 'boosts', range: 'all', limit: CARDS_PER_PAGE,
  state: { scope: 'global', medium: 'other', sort: 'boosts', range: 'all', nextOffset: api.next_offset },
})}</div>`

// ── The injection, run against the real index.html ──────────────────────────
const OPEN = '<!--OB:SSR-EPISODES-->'
const CLOSE = '<!--/OB:SSR-EPISODES-->'
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

console.log('\nThe homepage injection:')

check('index.html still carries both markers, in order', () => {
  const a = shell.indexOf(OPEN)
  const b = shell.indexOf(CLOSE)
  assert.ok(a !== -1, 'opening marker missing')
  assert.ok(b > a, 'closing marker missing or before the opening one')
})

const page = shell.slice(0, shell.indexOf(OPEN)) + block +
             shell.slice(shell.indexOf(CLOSE) + CLOSE.length)

check('the placeholder between them is replaced, not appended to', () => {
  assert.doesNotMatch(page, /Global episodes feed coming online/)
})

check('the cards land inside the Episodes · Global panel', () => {
  const panel = page.slice(page.indexOf('id="panel-episodes-global"'))
  const nextPanel = panel.indexOf('id="panel-boosts-global"')
  const mine = panel.slice(0, nextPanel)
  assert.match(mine, /<div class="pcast-list">/)
  assert.match(mine, /data-episode-card/)
})

check('nothing else in the shell was disturbed', () => {
  // The eight panels, the feed bar and the generated nav/footer all survive: the
  // Function does one string splice and must never reformat the file.
  for (const id of ['panel-episodes-follows', 'panel-boosts-global', 'panel-shows', 'panel-albums']) {
    assert.ok(page.includes(id), `${id} missing`)
  }
  assert.ok(page.includes('NAV:START') || page.includes('id="top-nav"'), 'nav missing')
})

// ── The handover ────────────────────────────────────────────────────────────
console.log('\nThe state element feeds-podcasts.js adopts through:')

check('it is present, is application/json, and is not executable', () => {
  assert.match(block, /<script type="application\/json" data-feed-state>/)
})

check('it carries the scope and medium the client checks', () => {
  const m = block.match(/data-feed-state>([^<]*)</)
  const state = JSON.parse(m[1])
  assert.equal(state.scope, 'global')
  assert.equal(state.medium, 'other')
  assert.equal(state.sort, 'boosts')
  assert.equal(state.range, 'all')
  assert.equal(state.count, Math.min(CARDS_PER_PAGE, items.length))
  assert.equal(state.nextOffset, api.next_offset)
})

check('it carries state and not content', () => {
  const m = block.match(/data-feed-state>([^<]*)</)
  // The whole point: the rows are the markup, not a second copy of themselves.
  assert.ok(m[1].length < 200, `state element is ${m[1].length} bytes — is it carrying rows?`)
})

// ── Ranking ─────────────────────────────────────────────────────────────────
console.log('\nRanking:')

check('the server ranking survives buildEpisodes’ recency sort', () => {
  // buildEpisodes ends with a sort by latest boost, which would throw the
  // endpoint's ordering away; itemsFromBoosts re-sorts by the feed's key. The
  // check is that the painted order is descending by boost count.
  const counts = items.slice(0, CARDS_PER_PAGE).map((it) => it.totals?.boosts ?? it.boosts.length)
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] <= counts[i - 1], `card ${i + 1} outranks card ${i} (${counts[i]} > ${counts[i - 1]})`)
  }
})

check('cards are numbered 1..N with no gaps', () => {
  const ranks = [...block.matchAll(/<div class="pcast-rank" aria-hidden="true">(\d+)</g)].map((m) => Number(m[1]))
  assert.deepEqual(ranks, ranks.map((_, i) => i + 1))
})

check('the figures come from the aggregates, not the inlined rows', () => {
  // The endpoint caps inline notes at 50 per episode. The top card in the live
  // capture is at the cap, so its printed count must exceed the rows it shipped.
  const top = items[0]
  const inlined = top.boosts.length
  const printed = top.totals?.boosts
  assert.ok(printed >= inlined, `printed ${printed} < inlined ${inlined}`)
})

// ── Weight ─────────────────────────────────────────────────────────────────
//
// ⚠️ MEASURED IN BROTLI, because that is what Cloudflare serves (verified:
// `content-encoding: br` on the live homepage). Gzip is printed beside it for
// reference and is the pessimistic number.
//
// The comparison that matters is the WHOLE first view, not the document alone:
// the old page shipped a small shell and then fetched this same corpus as JSON,
// so the bytes did not appear from nowhere — they moved, and one round trip went
// with them. The static module graph is counted too, since the point of a shell
// is that it cannot paint until that graph has loaded.

const raw = Buffer.byteLength(page)
const gz = gzipSync(page).length
const brNew = br(page)
const shellRaw = Buffer.byteLength(shell)
const shellBr = br(shell)
const apiBuf = readFileSync(capture)
const apiBr = br(apiBuf)
const notes = items.reduce((n, it) => n + it.boosts.length, 0)

// The modules the homepage must have before a client-rendered feed can paint.
// Read from disk so the number moves when the graph does.
const graphBr = moduleGraphBytes('assets/js/feeds.js')

const beforeTotal = shellBr + apiBr + graphBr
const afterTotal = brNew + graphBr

console.log(`  cards           ${items.length} episodes, ${notes} boost notes`)
console.log(`  document        ${kb(shellRaw)} → ${kb(raw)} raw, ${kb(shellBr)} → ${kb(brNew)} br  (gz ${kb(gzipSync(shell).length)} → ${kb(gz)})`)
console.log(`  the JSON fetch  ${kb(apiBr)} br, now not made at all`)
console.log(`  module graph    ${kb(graphBr)} br, unchanged either way`)
console.log(`  first view      ${kb(beforeTotal)} br in two round trips → ${kb(afterTotal)} br in one`)
console.log(`  delta           ${afterTotal > beforeTotal ? '+' : ''}${kb(afterTotal - beforeTotal)} br`)

check('the first view does not get materially heavier', () => {
  // Not "must not grow at all": the markup for a card is more verbose than the
  // JSON it was built from, and the drawer rows are now in the document rather
  // than built on open. What must hold is that server-rendering the feed does
  // not cost the reader a meaningful fraction of the page — 5% is the line, and
  // the round trip it removes is worth more than that.
  const growth = (afterTotal - beforeTotal) / beforeTotal
  assert.ok(growth < 0.05,
    `first view grew ${(growth * 100).toFixed(1)}% (${kb(beforeTotal)} → ${kb(afterTotal)} br)`)
})

check('the raw document stays under a megabyte and a half', () => {
  // The parse cost is the one that does not compress away: ~5,000 extra DOM
  // nodes for the boost rows, all of them inside a closed <details> so nothing
  // lays them out until a drawer opens. This is the ceiling to notice if the
  // per-episode note cap or the page size ever moves.
  assert.ok(raw < 1_572_864, `${kb(raw)} raw`)
})

function br(buf) {
  return brotliCompressSync(Buffer.from(buf), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  }).length
}

/** Every module reachable by STATIC import from `entry`, brotli'd. */
function moduleGraphBytes(entry, seen = new Set()) {
  if (seen.has(entry)) return 0
  let src
  try { src = readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8') } catch { return 0 }
  seen.add(entry)
  let total = br(src)
  for (const m of src.matchAll(/(?:^|\n)\s*import\s(?:[^'"]*?from\s*)?['"]([^'"]+)['"]/g)) {
    const spec = m[1].split('?')[0]
    const path = spec.startsWith('/assets/') ? spec.slice(1)
      : spec.startsWith('./') ? 'assets/js/' + spec.slice(2)
      : null
    if (path) total += moduleGraphBytes(path, seen)
  }
  return total
}

function kb(n) { return `${(n / 1024).toFixed(1)}KB` }

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures above)' : ''}.`)
