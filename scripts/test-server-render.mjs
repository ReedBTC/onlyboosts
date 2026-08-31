#!/usr/bin/env node
/**
 * Render the homepage's server-side opening feed against a REAL API response
 * and assert on it.
 *
 * The companion to test-show-card.mjs, one level up: that one checks the card
 * against fixtures, this one checks that functions/index.js assembles a page
 * out of it correctly — the injection into index.html, the state element the
 * client adopts through, and the size of what a reader actually downloads.
 *
 * ⚠️ IT IS WRITTEN AGAINST THE SHOW CARD SINCE PHASE D (2026-08-23). The front
 * door landed on Episodes until then and this file was written against the
 * episode card, capture `curl` and all. Both halves moved together, which is
 * the honest measure of how big that change was: the landing feed is not a
 * constant anything here can be parameterised by, because the two cards do not
 * share a renderer, a state element or a drawer. `git show 4c22017` has the
 * episode version if the front door ever moves back.
 *
 * ⚠️ IT NEEDS A CAPTURE, NOT A DATABASE. D1 is not reachable from here and
 * wrangler is unauthenticated, so the input is a saved response from production:
 *
 *   curl -s 'https://onlyboosts.social/api/v1/podcasts?not_medium=music\
 * &sort=chart&range=all&limit=25' > <file>
 *
 * ⚠️ UNTIL A DEPLOY THAT SERVES sort=chart IS LIVE, production coerces the
 * unknown key to its default and the curl above captures the wrong list —
 * build the capture through the SHIPPED handler instead: page every row out
 * of production, load them into a node:sqlite build of the real schema, and
 * save the local endpoint's own sort=chart answer. That is how the flip was
 * verified before it deployed.
 *
 * ⚠️ TAKE A FRESH ONE. It is the size measurement as well as the fixture, and a
 * stale capture measures a page nobody is being served.
 *
 * Run: node scripts/test-server-render.mjs <captured-podcasts.json>
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import {
  cardsFromPodcasts, renderShowCardPage, SHOW_CARDS_PER_PAGE,
} from '../functions/_shared/show-cards.js'
import { COPY, showRankValue } from '../assets/js/show-card.js'

const capture = process.argv[2]
if (!capture) {
  console.error('usage: node scripts/test-server-render.mjs <captured-podcasts.json>')
  process.exit(2)
}

let passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

const api = JSON.parse(readFileSync(capture, 'utf8'))
const records = api.podcasts || []
// ⚠️ NO RE-SORT. The endpoint answers in rank order and functions/index.js maps
// straight over it — see the order note in that file. Re-ordering here would
// test a page the Function does not produce.
const cards = cardsFromPodcasts(records)

// The same call functions/index.js makes.
const SORT = 'chart'
const block = renderShowCardPage(cards, {
  copy: COPY.other, sort: SORT, range: 'all', limit: SHOW_CARDS_PER_PAGE,
  state: { scope: 'global', medium: 'other', sort: SORT, range: 'all', nextOffset: api.next_offset },
})
const painted = Math.min(SHOW_CARDS_PER_PAGE, cards.length)

// ── The injection, run against the real index.html ──────────────────────────
const OPEN = '<!--OB:SSR-SHOWS-->'
const CLOSE = '<!--/OB:SSR-SHOWS-->'
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
  assert.doesNotMatch(page, /Shows feed coming online/)
})

check('the cards land inside the Shows panel', () => {
  const panel = page.slice(page.indexOf('id="panel-shows"'))
  const mine = panel.slice(0, panel.indexOf('id="panel-albums"'))
  assert.match(mine, /<div class="pcast-list" data-show-list>/)
  assert.match(mine, /data-show-card/)
})

/* ⚠️ THE LANDING FEED IS THREE DECISIONS THAT MOVE TOGETHER, and two of them
 * are in this file rather than in the Function. `is-active` on the panel is
 * what a reader with no JavaScript and a crawler on its first pass actually
 * see; DEFAULT_TYPE is what the controller resolves to; and FEED.sort in the
 * Function is what was rendered into it. Any one of them alone is a page that
 * contradicts itself. */
console.log('\nThe landing feed:')

check('the Shows panel is the one that ships active', () => {
  const m = shell.match(/<section class="feed-panel([^"]*)" id="panel-shows"[^>]*>/)
  assert.ok(m, 'the Shows panel is missing or its attribute order changed')
  assert.match(m[1], /\bis-active\b/, 'the Shows panel does not ship active')
  assert.doesNotMatch(m[0], /\shidden\b/, 'the Shows panel ships hidden')
})

check('no other panel ships active, so the markup names one opening feed', () => {
  const actives = [...shell.matchAll(/<section class="feed-panel[^"]*\bis-active\b[^"]*" id="(panel-[^"]+)"/g)]
  assert.deepEqual(actives.map((m) => m[1]), ['panel-shows'])
})

check('the controller lands on the same feed', () => {
  assert.match(shell, /const DEFAULT_TYPE = 'shows';/)
})

check('the sub-row ships with the landing feed selected', () => {
  // syncTabs rewrites this during parse, so it only shows through to a reader
  // with no JavaScript and to a crawler's first pass — the two who must not be
  // shown a selected sub-feed that is not the panel below it.
  const row = shell.slice(shell.indexOf('<div class="feed-sub-group" data-tab="podcasts">'))
  const group = row.slice(0, row.indexOf('</div>'))
  const on = [...group.matchAll(/data-value="([^"]+)"\s+aria-selected="true"/g)].map((m) => m[1])
  assert.deepEqual(on, ['shows'])
})

check('the Episodes panel carries no injection marker of its own', () => {
  // One feed is server-rendered and it is the one on screen. A second block
  // inside a hidden panel is bytes nobody reads and two rankings on one URL.
  assert.doesNotMatch(shell, /OB:SSR-EPISODES/)
})

check('nothing else in the shell was disturbed', () => {
  // The eight panels, the feed bar and the generated nav/footer all survive: the
  // Function does one string splice and must never reformat the file.
  for (const id of ['panel-episodes-global', 'panel-episodes-follows', 'panel-members-global', 'panel-albums']) {
    assert.ok(page.includes(id), `${id} missing`)
  }
  assert.ok(page.includes('NAV:START') || page.includes('id="top-nav"'), 'nav missing')
})

// ── The handover ────────────────────────────────────────────────────────────
console.log('\nThe state element shows-feed.js adopts through:')

check('it is present, is application/json, and is not executable', () => {
  assert.match(block, /<script type="application\/json" data-feed-state>/)
})

check('it carries the medium the client checks, and the opening controls', () => {
  const state = readState()
  assert.equal(state.scope, 'global')
  assert.equal(state.medium, 'other')
  assert.equal(state.sort, SORT)
  assert.equal(state.range, 'all')
  assert.equal(state.count, painted)
  assert.equal(state.nextOffset, api.next_offset)
})

check('⚠️ no boundary seed under chart — every row wears the server’s rank', () => {
  // The seed exists so the client can continue numbering across the adoption
  // boundary. Under chart the client never numbers: renumber() and
  // syncRankLabels() return early and every fetched row carries its own rank,
  // so a seed here would be dead weight claiming a live purpose.
  const state = readState()
  assert.equal(state.lastRank, undefined)
  assert.equal(state.lastValue, undefined)
})

check('it carries state and not content', () => {
  const raw = block.match(/data-feed-state>([^<]*)</)[1]
  // The whole point: the rows are the markup, not a second copy of themselves.
  assert.ok(raw.length < 260, `state element is ${raw.length} bytes — is it carrying rows?`)
})

check('no data-since on the All range', () => {
  // The drawer reads it at open time to scope its episode rows to the card's own
  // window. All is the opening range and has no cutoff, so the attribute is
  // absent rather than present and empty.
  assert.doesNotMatch(block, /data-since=/)
})

// ── The drawers ─────────────────────────────────────────────────────────────
console.log('\nThe drawers, filled on open:')

check('every drawer is a lazy <details>; no episode row is in the document', () => {
  // The show card's drawer is ALWAYS lazy: its rows come from
  // /api/v1/podcasts/<guid> scoped to the card's range, so they are never in
  // hand when the card is built — at the edge or in the browser.
  const withEpisodes = cards.slice(0, painted).filter((s) => s.episodes).length
  const drawers = (block.match(/<details class="pcast-card-details">/g) || []).length
  const lazy = (block.match(/<div class="pcast-details" data-lazy-episodes>/g) || []).length
  assert.equal(drawers, withEpisodes)
  assert.equal(lazy, drawers)
  assert.equal((block.match(/class="ob-ep-row"/g) || []).length, 0)
})

check('the boost pill ships hidden, because boosting is a verb', () => {
  assert.match(block, /class="ob-boost-pill" hidden data-boost-show/)
})

check('the last-boost date is a date, not a relative time', () => {
  // relTime() reads Date.now(), which at the edge is the moment the response was
  // CACHED — the same bytes go to everyone arriving inside the 300s window. The
  // timestamp is the fact; show-card-actions.js rewrites the reading of it.
  assert.doesNotMatch(block, /ago<\/div>/)
  assert.match(block, /data-latest-ts="\d+">last boost [A-Z][a-z]{2} \d{1,2}, \d{4}</)
})

// ── Ranking ─────────────────────────────────────────────────────────────────
console.log('\nRanking:')

check('the server ranking survives into the painted order', () => {
  const ranks = cards.slice(0, painted).map((c) => c.rank)
  assert.equal(ranks[0], 1, 'the first card is #1')
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(Number.isFinite(ranks[i]), `card ${i + 1} carries no server rank`)
    assert.ok(ranks[i] >= ranks[i - 1], `card ${i + 1} outranks card ${i} (${ranks[i]} < ${ranks[i - 1]})`)
  }
})

/* ⚠️ THE CHART STANDING IS THE SERVER'S TUPLE (score, then boosters, sats,
 * boosts) and each card wears the endpoint's own rank and tie flag verbatim —
 * see The OnlyBoosts Charts in docs/feeds.md. The label is verifiable here
 * against the record, and the ARITHMETIC is verifiable against the page's own
 * open formula: within a rank-ordered prefix, every row strictly ahead of row
 * i is also on the page, so the competition rank recomputes exactly. */
check('every card wears the record’s own chart rank and tie flag', () => {
  const labels = rankLabels()
  assert.equal(labels.length, painted, 'every card carries a rank')
  labels.forEach((label, i) => {
    const c = cards[i]
    assert.equal(label, `${c.tied ? 'T' : ''}${c.rank}`, `card ${i + 1}`)
  })
})

check('⚠️ the rank arithmetic holds against the page’s own open formula', () => {
  const rows = records.slice(0, painted)
  const key = (r) => [r.chart.score, -r.boosters, -r.sats, -r.boosts]
  const lt = (a, b) => { for (let k = 0; k < 4; k++) { if (a[k] !== b[k]) return a[k] < b[k] } return false }
  rows.forEach((r, i) => {
    assert.equal(r.chart.score, r.chart.sats + r.chart.boosts + r.chart.boosters,
      `row ${i + 1}: the score is not the sum of its own components`)
    const ahead = rows.filter((x) => lt(key(x), key(r))).length
    assert.equal(r.rank, ahead + 1, `row ${i + 1} is #${r.rank} with ${ahead} ahead of it`)
  })
})

check('a rank shared ON the page always wears the T; a lone T may reach off it', () => {
  // The server’s tie flag is corpus-true, so a T with no on-page partner is a
  // tie straddling the page boundary — legitimate in that direction only.
  const rows = records.slice(0, painted)
  rows.forEach((r, i) => {
    const partners = rows.filter((x, j) => j !== i && x.rank === r.rank).length
    if (partners > 0) assert.equal(r.tied, true, `row ${i + 1} shares rank ${r.rank} but carries no T`)
  })
})

check('a chronological sort paints no numeral at all', () => {
  // A rank under "Recently boosted" reads as a score when it is only order.
  const chrono = renderShowCardPage(cards, { copy: COPY.other, sort: 'latest', range: 'all' })
  assert.equal((chrono.match(/class="pcast-rank"/g) || []).length, 0)
  const state = JSON.parse(chrono.match(/data-feed-state>([^<]*)</)[1])
  assert.equal(state.lastRank, undefined, 'an unranked page carries a boundary seed')
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

// The modules the homepage must have before a client-rendered feed can paint.
// Read from disk so the number moves when the graph does.
const graphBr = moduleGraphBytes('assets/js/feeds.js')

const beforeTotal = shellBr + apiBr + graphBr
const afterTotal = brNew + graphBr

console.log(`  cards           ${painted} shows`)
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
 * needs before anything can paint. It is a number a reader on a slow connection
 * can be reasoned about, and blowing it means a real conversation rather than a
 * nudge. ⚠️ IT WAS NOT LOWERED WHEN THE FRONT DOOR MOVED TO THE SHOW CARD, which
 * lands far under it: a budget re-cut to whatever today's page happens to weigh
 * is a tripwire against nothing. The comparison against the old two-round-trip
 * page is still PRINTED above, because it is the interesting number even though
 * it is the wrong thing to gate on.
 */
const BUDGET_BR = 256 * 1024

check(`the first view fits the ${kb(BUDGET_BR)} brotli budget`, () => {
  assert.ok(afterTotal < BUDGET_BR,
    `first view is ${kb(afterTotal)} br against a ${kb(BUDGET_BR)} budget`)
})

check('the raw document stays small enough that the hash is read before the paint', () => {
  // The parse cost is the one that does not compress away. With every boost
  // note inline the document was 1.19MB raw and the feed-bar controller sat
  // 1.16MB after the first card, so the browser painted the whole opening feed
  // before any script could read which feed the hash named. 400KB is headroom,
  // not a target; the number to notice if the page or the card grows.
  assert.ok(raw < 409_600, `${kb(raw)} raw`)
})

check('the feed-bar controller is close behind the first card', () => {
  const first = page.indexOf('data-show-card')
  const ctrl = page.indexOf('FEED BAR CONTROLLER')
  assert.ok(first > 0 && ctrl > first, 'controller or first card missing')
  console.log(`  controller      ${kb(ctrl - first)} after the first card`)
  assert.ok(ctrl - first < 307_200, `${kb(ctrl - first)} between the first card and the controller`)
})

function readState() {
  return JSON.parse(block.match(/data-feed-state>([^<]*)</)[1])
}

function rankLabels() {
  return [...block.matchAll(/<div class="pcast-rank" aria-hidden="true">(T?\d+)</g)].map((m) => m[1])
}

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
