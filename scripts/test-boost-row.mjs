#!/usr/bin/env node
/**
 * Render the boost row against fixture data and assert on the HTML.
 *
 * ⚠️ THE POINT IS THE TWO-SIDED CONTRACT. assets/js/boost-list.js is rendered by
 * the edge (three Pages Functions, over D1 rows) and by the browser
 * (assets/js/boost-section.js, over /api/v1 records) — and the two have to
 * produce the SAME BYTES, or a reader who re-sorts watches half the list change
 * shape under them. The rows come from different query shapes, so the assertion
 * that matters is the round trip: a D1 row, through boostRecord and back through
 * rowsFromRecords, must render character for character as the D1 row did.
 *
 * The rest is what test-episode-card.mjs checks for the other shared component:
 * every fact present, every verb emitted as an inert hook, and nothing
 * third-party reaching an attribute unescaped.
 *
 * Run: node scripts/test-boost-row.mjs
 */
import assert from 'node:assert/strict'
import {
  renderBoosts, boostRows, rowsFromRecords, sortBoostRows, filterBoostRows,
  BOOST_SORTERS, CONTROLS_MIN,
} from '../assets/js/boost-list.js'
import { boostRecord } from '../functions/api/v1/_common.js'

let passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// A REAL npub, not a plausible-looking one: renderMessage verifies the bech32
// checksum before it will link an identifier, so a made-up string degrades to
// plain text and the mention assertion below would silently test nothing. This
// is OnlyBoosts' own identity, from the site-identity table in CLAUDE.md.
const HEX_A = '9edbee5534cba129e9c1a89a50e2b29f5abdff9d9a6fb521e61906d477d9f18c'
const NPUB_A = 'npub1nmd7u4f5ewsjn6wp4zd9pc4jnadtmluanfhm2g0xryrdga7e7xxq0as4ck'
const HEX_B = 'b'.repeat(64)

/* Fixtures in the D1 row shape, as BOOST_SELECT returns it — every column the
 * three page queries can join, including the ones only one of them selects. */
const dbRows = [
  {
    event_id: 'a'.repeat(64), booster_pubkey: HEX_A, booster_npub: NPUB_A,
    created_at: 1_700_100_000, sats: 10_000, amount_source: 'tag',
    podcast_guid: 'show-guid-1', item_guid: 'item-guid-1', item_url: null, client: 'Fountain',
    message: 'Great one! see https://example.com/thing and hi nostr:' + NPUB_A,
    p_title: 'A Podcast & "Friends"', p_image: null, p_feed: null,
    e_title: 'The One About <Value>', e_image: null, e_pub: 1_700_000_000,
    e_num: 42, e_url: null,
    pr_name: 'alice', pr_dname: 'Alice <script>', pr_pic: 'https://example.com/a.png',
  },
  {
    // No npub, no name, no picture, no message, no episode — the degraded row
    // every one of these surfaces has to keep rendering.
    event_id: 'c'.repeat(64), booster_pubkey: HEX_B, booster_npub: null,
    created_at: 1_690_000_000, sats: 0, amount_source: null,
    podcast_guid: null, item_guid: null, item_url: null, client: null, message: null,
    p_title: null, p_image: null, p_feed: null,
    e_title: null, e_image: null, e_pub: null, e_num: null, e_url: null,
    pr_name: null, pr_dname: null, pr_pic: null,
  },
  {
    // A titleless episode's boost: the episode chip renders unlinked, and the
    // air date is missing, which is what the `episode` sort has to sink.
    event_id: 'd'.repeat(64), booster_pubkey: HEX_B, booster_npub: null,
    created_at: 1_695_000_000, sats: 210, amount_source: 'msats',
    podcast_guid: 'show-guid-2', item_guid: 'https://feed.example/ep/7', item_url: null,
    client: null, message: 'nice',
    p_title: 'Another Show', p_image: null, p_feed: null,
    e_title: 'A Track', e_image: null, e_pub: null, e_num: null, e_url: null,
    pr_name: 'bob', pr_dname: null, pr_pic: 'javascript:alert(1)',
  },
]

const names = new Map([[HEX_A, 'Alice']])

// The three call sites, exactly as the Functions pass them.
const SURFACES = {
  show: { itemAbbr: 'Ep.', noun: 'episode', showTarget: true, linkBooster: true, showShow: false },
  episode: { itemAbbr: 'Ep.', noun: 'episode', showTarget: false, linkBooster: true, showShow: false },
  booster: { itemAbbr: 'Ep.', noun: 'episode', showTarget: true, linkBooster: false, showShow: true },
}

// ── The two-sided contract ──────────────────────────────────────────────────

check('a row survives the round trip through the published record shape', () => {
  const roundTripped = rowsFromRecords(dbRows.map(boostRecord))
  for (const [surface, opts] of Object.entries(SURFACES)) {
    const fromDb = boostRows(dbRows, names, opts)
    const fromApi = boostRows(roundTripped, names, opts)
    assert.equal(fromApi, fromDb, `${surface}: the edge and the browser disagree`)
  }
})

check('display_name survives the round trip, not just name', () => {
  const [rec] = dbRows.map(boostRecord)
  assert.equal(rec.booster.dname, 'Alice <script>', 'boostRecord dropped display_name')
  const [row] = rowsFromRecords([rec])
  assert.equal(row.pr_dname, 'Alice <script>')
  // The rendered label is display_name, not name — that is the whole reason
  // `dname` was added to the record.
  assert.match(boostRows([row], names, SURFACES.show), /Alice &lt;script&gt;/)
})

check('the air date survives, so the episode sort has something to order on', () => {
  const rows = rowsFromRecords(dbRows.map(boostRecord))
  assert.equal(rows[0].e_pub, 1_700_000_000)
  assert.equal(rows[2].e_pub, null)
})

// ── Facts ───────────────────────────────────────────────────────────────────

check('the message renders its links and its mention chip', () => {
  const html = boostRows([dbRows[0]], names, SURFACES.show)
  assert.match(html, /href="https:\/\/example\.com\/thing"/)
  assert.match(html, /class="nostr-mention"[^>]*>@Alice</)
})

check('an unresolved mention carries the hook the Primal backfill reads', () => {
  const html = boostRows([dbRows[0]], new Map(), SURFACES.show)
  assert.match(html, new RegExp(`data-pk="${HEX_A}" data-missing="name"`))
})

check('the episode links to its page, and does not when it has no title', () => {
  assert.match(boostRows([dbRows[0]], names, SURFACES.show),
    /<a class="ob-boost-ep" href="\/episode\/item-guid-1">Ep\. 42 · The One About &lt;Value&gt;<\/a>/)
  // No episode at all → no chip, not a chip reading "the episode".
  assert.doesNotMatch(boostRows([dbRows[1]], names, SURFACES.show), /ob-boost-ep/)
})

check('the show is named on /booster and nowhere else', () => {
  assert.match(boostRows([dbRows[0]], names, SURFACES.booster), /ob-boost-show/)
  assert.doesNotMatch(boostRows([dbRows[0]], names, SURFACES.show), /ob-boost-show/)
  assert.doesNotMatch(boostRows([dbRows[0]], names, SURFACES.episode), /ob-boost-show/)
})

check('the episode chip is suppressed on /episode, where it would repeat the h1', () => {
  assert.doesNotMatch(boostRows([dbRows[0]], names, SURFACES.episode), /ob-boost-ep/)
})

check('/booster does not link a row back to the page it is on', () => {
  const html = boostRows([dbRows[0]], names, SURFACES.booster)
  assert.doesNotMatch(html, /href="\/booster\//)
  assert.match(html, /<span class="author-name">/)
})

check('a booster with no npub still links, on their pubkey', () => {
  assert.match(boostRows([dbRows[1]], names, SURFACES.show), new RegExp(`href="/booster/${HEX_B}"`))
})

// ── Verbs, as inert hooks ───────────────────────────────────────────────────

check('every row is a [data-boost-note] carrying the projection contract', () => {
  const html = boostRows(dbRows, names, SURFACES.show)
  assert.equal((html.match(/data-boost-note/g) || []).length, 3)
  assert.match(html, new RegExp(`data-event-id="${'a'.repeat(64)}" data-pubkey="${HEX_A}" data-ts="1700100000"`))
  // buildActionBar appends the ⋮ into .note-author itself, so that class is
  // load-bearing rather than decorative.
  assert.equal((html.match(/class="note-author"/g) || []).length, 3)
})

check('the message is NOT duplicated into a data attribute', () => {
  assert.doesNotMatch(boostRows([dbRows[0]], names, SURFACES.show), /data-(msg|message|content)=/)
})

// ── Escaping ────────────────────────────────────────────────────────────────

check('a hostile display name cannot reach markup', () => {
  const html = boostRows([dbRows[0]], names, SURFACES.show)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /title="Boosts by Alice &lt;script&gt;"/)
})

check('a javascript: avatar is dropped for the site placeholder', () => {
  const html = boostRows([dbRows[2]], names, SURFACES.show)
  assert.doesNotMatch(html, /javascript:/)
  assert.match(html, /src="\/assets\/avatar-fallback\.svg"/)
  // …and the row is marked so the Primal backfill knows to try for a real one.
  assert.match(html, /data-missing="pic"/)
})

// ── Range and sort ──────────────────────────────────────────────────────────

check('sats sorts by size, then by recency', () => {
  const order = sortBoostRows(dbRows, 'sats').map((r) => r.sats)
  assert.deepEqual(order, [10_000, 210, 0])
})

check('undated episodes sink under the episode sort rather than floating', () => {
  const order = sortBoostRows(dbRows, 'episode').map((r) => r.event_id[0])
  assert.equal(order[0], 'a', 'the only dated row should lead')
  // Two undated rows compare by boost time, and must not produce NaN.
  assert.deepEqual(order.slice(1), ['d', 'c'])
})

check('an unknown sort key falls back to newest-first rather than throwing', () => {
  assert.deepEqual(sortBoostRows(dbRows, 'nonsense').map((r) => r.created_at),
    [1_700_100_000, 1_695_000_000, 1_690_000_000])
})

check('sorting never mutates the caller’s array', () => {
  const before = dbRows.map((r) => r.event_id)
  sortBoostRows(dbRows, 'sats')
  assert.deepEqual(dbRows.map((r) => r.event_id), before)
})

check('the range filters on when the boost was SENT, not when the episode aired', () => {
  // dbRows[0] aired at 1_700_000_000 and was boosted at 1_700_100_000. A cutoff
  // between the two must keep it: the axis is the boost.
  const kept = filterBoostRows(dbRows, 1_700_050_000)
  assert.deepEqual(kept.map((r) => r.event_id[0]), ['a'])
  assert.equal(filterBoostRows(dbRows, null).length, 3, 'a null cutoff is unbounded')
})

check('every sort key in the menu has a comparator', () => {
  for (const key of ['recent', 'episode', 'sats']) {
    assert.equal(typeof BOOST_SORTERS[key], 'function', `${key} has no comparator`)
  }
})

// ── The section, and what the client adopts it through ──────────────────────

check('the section ships the slots boost-section.js contracts on', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Show Boosts', sub: 'Every boost.', itemAbbr: 'Ep.', noun: 'episode',
    total: 1404, state: { page: 24 },
  })
  assert.match(html, /id="boosts" data-boost-section/)
  assert.match(html, /data-bs-controls hidden/)
  assert.match(html, /data-bs-list/)
  assert.match(html, /data-bs-more/)
  const state = JSON.parse(html.match(/data-boost-state>(.*?)<\/script>/s)[1])
  assert.equal(state.count, 3)
  assert.equal(state.total, 1404)
  assert.equal(state.page, 24)
  assert.equal(state.sort, 'recent')
  assert.equal(state.range, 'all')
})

check('the row variant travels in the state, so a repaint cannot diverge', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Episode Boosts', sub: 'Every boost.', itemAbbr: 'Ep.', noun: 'episode',
    showTarget: false, state: { page: 500 },
  })
  const state = JSON.parse(html.match(/data-boost-state>(.*?)<\/script>/s)[1])
  assert.deepEqual(state.row, {
    itemAbbr: 'Ep.', noun: 'episode', showTarget: false, linkBooster: true, showShow: false,
  })
  // And the variant in the state is the one the rows were actually rendered with.
  assert.equal(html.includes(boostRows(dbRows, names, state.row)), true)
})

check('the control band is withheld below CONTROLS_MIN', () => {
  const one = renderBoosts(dbRows.slice(0, 1), names, {
    heading: 'Episode Boosts', sub: 'Every boost.', itemAbbr: 'Ep.', noun: 'episode',
  })
  assert.doesNotMatch(one, /data-bs-controls/, 'a one-row list has nothing to range over')
  assert.match(one, /data-bs-list/, 'the list itself is a fact and ships regardless')
  const three = renderBoosts(dbRows, names, {
    heading: 'Episode Boosts', sub: 'Every boost.', itemAbbr: 'Ep.', noun: 'episode',
  })
  assert.equal(dbRows.length, CONTROLS_MIN)
  assert.match(three, /data-bs-controls/)
})

check('a stale total that undercounts cannot print "showing 24 of 19"', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Show Boosts', sub: 'Every boost.', itemAbbr: 'Ep.', noun: 'episode', total: 1,
  })
  const state = JSON.parse(html.match(/data-boost-state>(.*?)<\/script>/s)[1])
  assert.equal(state.total, 3)
})

check('a section with no rows renders nothing at all', () => {
  assert.equal(renderBoosts([], names, {
    heading: 'Show Boosts', sub: 'Every boost.', itemAbbr: 'Ep.', noun: 'episode',
  }), '')
})

check('a </script> inside the state cannot close the element early', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Show Boosts', sub: 'x', itemAbbr: '</script><img src=x>', noun: 'episode',
  })
  const body = html.match(/data-boost-state>(.*?)<\/script>/s)[1]
  assert.doesNotMatch(body, /<\/script>/)
  assert.match(body, /\\u003c\/script>/)
})

console.log(`\n${passed} assertions passed.`)
