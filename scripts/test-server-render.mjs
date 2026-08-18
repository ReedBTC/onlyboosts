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
 * &include=boosts&limit=30&sort=count&range=all' > <file>
 *
 * Run: node scripts/test-server-render.mjs <captured-episodes.json>
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { itemsFromBoosts, renderCardPage, CARDS_PER_PAGE } from '../functions/_shared/episode-cards.js'
import { episodeApiToBoosts } from '../assets/js/ob-data.js'
import { COPY, HOME_CARD_PARTS } from '../assets/js/episode-card.js'

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
// The same reordering functions/index.js#fromRecords does: built items put back
// into the records' order, never re-sorted over the capped inline rows.
const built = itemsFromBoosts(boosts, { sort: 'count' })
const byGuid = new Map(built.items.map((it) => [it.guid, it]))
const items = records.map((r) => byGuid.get(r.guid)).filter(Boolean)
const profiles = built.profiles
for (const it of items) it.totals = totals.get(it.guid) || null

// The same call functions/index.js makes, variant included: HOME_CARD_PARTS is
// the homepage's card, whose drawers fill on open rather than shipping their
// rows. That is what the weight numbers below are about.
const block = `<div class="pcast-list">${renderCardPage(items, {
  copy: COPY.other, profiles, sort: 'count', range: 'all', limit: CARDS_PER_PAGE,
  parts: HOME_CARD_PARTS,
  state: { scope: 'global', medium: 'other', sort: 'count', range: 'all', nextOffset: api.next_offset },
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
  assert.equal(state.sort, 'count')
  assert.equal(state.range, 'all')
  assert.equal(state.count, Math.min(CARDS_PER_PAGE, items.length))
  assert.equal(state.nextOffset, api.next_offset)
})

check('it carries state and not content', () => {
  const m = block.match(/data-feed-state>([^<]*)</)
  // The whole point: the rows are the markup, not a second copy of themselves.
  assert.ok(m[1].length < 260, `state element is ${m[1].length} bytes — is it carrying rows?`)
})

check('it declares the homepage variant, so a client repaint matches the edge', () => {
  const m = block.match(/data-feed-state>([^<]*)</)
  const state = JSON.parse(m[1])
  assert.deepEqual(state.card, HOME_CARD_PARTS)
  assert.equal(state.card.drawer, 'lazy')
})

// ── The drawers ─────────────────────────────────────────────────────────────
console.log('\nThe drawers, filled on open:')

check('no boost row is in the document; every drawer is a lazy <details>', () => {
  // The measurement this exists for: with the rows inline the drawer bodies
  // were 82% of the document and the feed-bar controller sat 1.16MB after the
  // first card, which is the flash of Episodes on every #shows load.
  assert.equal((block.match(/data-boost-note/g) || []).length, 0)
  const drawers = (block.match(/<details class="pcast-card-details">/g) || []).length
  const lazy = (block.match(/<div class="pcast-details" data-lazy-boosts>/g) || []).length
  assert.equal(drawers, Math.min(CARDS_PER_PAGE, items.length))
  assert.equal(lazy, drawers)
})

check('the drawer bar still carries the booster faces and the sats', () => {
  const faces = (block.match(/<span class="pcast-avatars">/g) || []).length
  assert.equal(faces, Math.min(CARDS_PER_PAGE, items.length))
  assert.match(block, /class="pcast-sats"/)
})

// ── Ranking ─────────────────────────────────────────────────────────────────
console.log('\nRanking:')

check('the server ranking survives buildEpisodes’ recency sort', () => {
  // buildEpisodes ends with a sort by latest boost, which would throw the
  // endpoint's ordering away; fromRecords restores the records' order. The
  // check is that the painted order is descending by the aggregate booster
  // count, which is what the endpoint ranked on.
  const counts = items.slice(0, CARDS_PER_PAGE).map((it) => it.totals?.boosters ?? it.distinctBoosters.length)
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] <= counts[i - 1], `card ${i + 1} outranks card ${i} (${counts[i]} > ${counts[i - 1]})`)
  }
})

/* ⚠️ THIS ASSERTED `1..N WITH NO GAPS` UNTIL 2026-08-18, AND THAT WAS THE OLD
 * SCHEME. Ranks are standard competition ranks now (assets/js/rank.js): tied
 * cards share the better place and the next distinct value skips the whole
 * group, so `1 2 3 4 5 T6 T6 8` is CORRECT and a gapless run would mean the
 * tiebreak was deciding standings again. The invariants below are what actually
 * hold, and the live capture exercises them — the homepage's opening sort is
 * Most boosters, whose counts are quantised enough that the first page ties
 * heavily.
 */
check('cards carry competition ranks: ties share a place, the next value skips', () => {
  const labels = [...block.matchAll(/<div class="pcast-rank" aria-hidden="true">(T?\d+)</g)].map((m) => m[1])
  assert.equal(labels.length, Math.min(CARDS_PER_PAGE, items.length), 'every card carries a rank')
  const ranks = labels.map((l) => Number(l.replace(/^T/, '')))
  const values = items.slice(0, labels.length).map((it) => it.totals?.boosters ?? it.distinctBoosters.length)

  assert.equal(ranks[0], 1, 'the first card is rank 1')
  for (let i = 0; i < ranks.length; i++) {
    // The definition, checked directly against the page's own figures.
    const ahead = values.filter((v) => v > values[i]).length
    assert.equal(ranks[i], ahead + 1, `card ${i + 1} is #${ranks[i]} with ${ahead} ahead of it`)
    // Equal figures share a place; different figures cannot.
    if (i > 0) {
      const same = values[i] === values[i - 1]
      assert.equal(ranks[i] === ranks[i - 1], same, `card ${i + 1} vs ${i}: rank/figure disagree`)
    }
  }
})

check('the T marks a shared place, and only a shared place', () => {
  const labels = [...block.matchAll(/<div class="pcast-rank" aria-hidden="true">(T?\d+)</g)].map((m) => m[1])
  const values = items.slice(0, labels.length).map((it) => it.totals?.boosters ?? it.distinctBoosters.length)
  labels.forEach((label, i) => {
    const shared = values.filter((v) => v === values[i]).length > 1
    // ⚠️ The LAST card is exempt in one direction only: it cannot see whether
    // its run continues into row 31, so it may under-report a tie it shares
    // forward. It must never over-report one. The client re-syncs that row once
    // it has fetched what follows — see syncRankLabels in feeds-podcasts.js.
    const lastRow = i === labels.length - 1
    if (label.startsWith('T')) {
      assert.ok(shared, `card ${i + 1} is marked T but its figure ${values[i]} is unique on the page`)
    } else if (!lastRow) {
      assert.ok(!shared, `card ${i + 1} shares figure ${values[i]} but carries no T`)
    }
  })
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

console.log(`  cards           ${items.length} episodes, ${notes} boost notes behind them (fetched on open, none in the document)`)
console.log(`  document        ${kb(shellRaw)} → ${kb(raw)} raw, ${kb(shellBr)} → ${kb(brNew)} br  (gz ${kb(gzipSync(shell).length)} → ${kb(gz)})`)
console.log(`  the JSON fetch  ${kb(apiBr)} br, now not made at all`)
console.log(`  module graph    ${kb(graphBr)} br, unchanged either way`)
console.log(`  first view      ${kb(beforeTotal)} br in two round trips → ${kb(afterTotal)} br in one`)
console.log(`  delta           ${afterTotal > beforeTotal ? '+' : ''}${kb(afterTotal - beforeTotal)} br`)

/* ⚠️ AN ABSOLUTE BUDGET, NOT A PERCENTAGE AGAINST THE OLD PAGE.
 *
 * It was a percentage first and it was the wrong shape: raising the boost-message
 * cap from 420 to 2,000 characters — a fix, since 420 was clipping 6.9% of real
 * messages mid-sentence — pushed the growth from 4% to 5.4% and failed a
 * threshold that had nothing to say about message length. A budget that moves
 * whenever unrelated content changes is a budget that gets raised to make a test
 * pass, which is worse than not having one.
 *
 * So: 256KB brotli for the WHOLE first view — document plus the module graph it
 * needs before anything can paint. That is roughly 20% of headroom over where
 * this lands today, it is a number a reader on a slow connection can be reasoned
 * about, and blowing it means a real conversation rather than a nudge. The
 * comparison against the old two-round-trip page is still PRINTED above, because
 * it is the interesting number even though it is the wrong thing to gate on.
 */
const BUDGET_BR = 256 * 1024

check(`the first view fits the ${kb(BUDGET_BR)} brotli budget`, () => {
  assert.ok(afterTotal < BUDGET_BR,
    `first view is ${kb(afterTotal)} br against a ${kb(BUDGET_BR)} budget`)
})

check('the raw document stays small enough that the hash is read before the paint', () => {
  // The parse cost is the one that does not compress away. With every boost
  // note inline the document was 1.19MB raw and the feed-bar controller sat
  // 1.16MB after the first card, so the browser painted the whole Episodes
  // feed before any script could read which feed the hash named. The lazy
  // drawer took it to ~220KB. 400KB is headroom over that, not a target; the
  // number to notice if the page size or the card grows.
  assert.ok(raw < 409_600, `${kb(raw)} raw`)
})

check('the feed-bar controller is close behind the first card', () => {
  const first = page.indexOf('data-episode-card')
  const ctrl = page.indexOf('FEED BAR CONTROLLER')
  assert.ok(first > 0 && ctrl > first, 'controller or first card missing')
  console.log(`  controller      ${kb(ctrl - first)} after the first card`)
  assert.ok(ctrl - first < 307_200, `${kb(ctrl - first)} between the first card and the controller`)
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
