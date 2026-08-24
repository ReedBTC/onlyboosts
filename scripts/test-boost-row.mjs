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
  searchBoostRows, filterBoostShow, BOOST_SORTERS, CONTROLS_MIN,
} from '../assets/js/boost-list.js'
import { boostRecord } from '../functions/api/v1/_common.js'
import { showFilterLabel } from '../functions/booster/[npub].js'

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
    // ⚠️ `client` AND `client_id` ARE DIFFERENT FACTS and both are on this row.
    // The first is the raw NIP-89 tag as signed (1.3% of the corpus); the
    // second is the collector's derivation, and it is the one the chip prints.
    client_id: 'fountain', client_via: null,
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
    // Unattributable: none of the collector's three signals fired. ~0.2% of the
    // corpus, and the row must render with no chip rather than guessing.
    client_id: null, client_via: null,
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
    // A relayed boost: published by the bot, originated in Castamatic. The chip
    // names the PUBLISHER (Reed's call, 2026-08-24), so `client_via` must not
    // reach it.
    client_id: 'chadf-boostbot', client_via: 'castamatic',
    pr_name: 'bob', pr_dname: null, pr_pic: 'javascript:alert(1)',
  },
]

const names = new Map([[HEX_A, 'Alice']])

// The three call sites, exactly as the Functions pass them.
const SURFACES = {
  show: { noun: 'episode', showTarget: true, linkBooster: true, showShow: false },
  episode: { noun: 'episode', showTarget: false, linkBooster: true, showShow: false },
  booster: { noun: 'episode', showTarget: true, linkBooster: false, showShow: true },
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
    /<a class="ob-boost-ep" href="\/episode\/item-guid-1">The One About &lt;Value&gt;<\/a>/)
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

check('the episode chip carries the title alone, never an episode number', () => {
  // ⚠️ THE GUARD ON A DELIBERATE REMOVAL, the same job the inline-image
  // assertion in test-episode-card.mjs does. The chip read "Ep. 42 · Title"
  // until 2026-08-24 and was dropped everywhere on Reed's call: publishers
  // already put the number in the title, so the site printed it twice and the
  // duplicate half was ours. `e_num` is 42 on this fixture and is still carried
  // through the record shape, so re-adding the prefix is a one-line change that
  // looks like an improvement — which is exactly why this asserts it stayed out.
  for (const surface of ['show', 'booster']) {
    const html = boostRows([dbRows[0]], names, SURFACES[surface])
    assert.match(html, /ob-boost-ep/, `${surface} still renders the chip`)
    assert.doesNotMatch(html, /Ep\. ?42|Track ?42|\b42 ?·/, `${surface} printed the episode number`)
  }
})

// ── The "via <app>" chip ────────────────────────────────────────────────────

check('the chip names the app that PUBLISHED the note', () => {
  const html = boostRows([dbRows[0]], names, SURFACES.show)
  assert.match(html, /<span class="ob-boost-via">via Fountain<\/span>/)
  // Beside the sats, inside the meta row — not a line of its own under it.
  assert.match(html, /ob-boost-sats[\s\S]{0,200}ob-boost-via/)
})

check('⚠️ a relayed boost names the publisher, never the origin app', () => {
  // Reed's call, 2026-08-24. The bot published this note and the booster
  // credited on the same card IS the bot, so "via Castamatic" beside a bot's
  // name and face would be two different claims in one row. The origin app is
  // still in the record and still nested under the bot on /api/v1/clients.
  const html = boostRows([dbRows[2]], names, SURFACES.show)
  assert.match(html, /via ChadF Boost Bot/)
  assert.doesNotMatch(html, /Castamatic/i, 'client_via reached the card')
})

check('an unattributable boost gets no chip rather than a guess', () => {
  const html = boostRows([dbRows[1]], names, SURFACES.show)
  assert.doesNotMatch(html, /ob-boost-via/)
  assert.doesNotMatch(html, /Unattributed/i)
  // And the row still renders — the chip is additive, never a gate.
  assert.match(html, /data-boost-note/)
})

check('an unknown slug renders as itself, so a new app is a missing label', () => {
  const row = { ...dbRows[0], client_id: 'some-new-app' }
  assert.match(boostRows([row], names, SURFACES.show), /via some-new-app/)
})

check('the slug is escaped, being a value out of the database', () => {
  const row = { ...dbRows[0], client_id: '<img src=x onerror=alert(1)>' }
  const html = boostRows([row], names, SURFACES.show)
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /&lt;img src=x/)
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

// ── The show-filter button's label ──────────────────────────────────────────

check('the button names the booster, in the phrase the site already uses', () => {
  const { label, full } = showFilterLabel('ChadF', 'Bitcoin And')
  // "Boosts by X", not "X's Boosts": the former is already on every boost row's
  // author link and every community-wall card, and it has no possessive to get
  // wrong on a name ending in s.
  assert.equal(label, 'Boosts by ChadF')
  assert.equal(full, 'Boosts by ChadF to Bitcoin And')
  assert.equal(showFilterLabel('Silas Thornbrook', 'X').label, 'Boosts by Silas Thornbrook')
})

check('a long display name is capped, and the full one survives in the tooltip', () => {
  // A real value from the index. Display names carry campaign text, so the cap
  // is about strangeness as much as width.
  const { label, full } = showFilterLabel('btconboard #LNHANCE or #CTV', 'Bitcoin And')
  assert.equal(label, 'Boosts by btconboard #LNH…')
  assert.ok(label.length <= 26, 'the visible label is bounded')
  assert.equal(full, 'Boosts by btconboard #LNHANCE or #CTV to Bitcoin And')
})

check('a booster with no kind-0 gets a name-free label, not a hex fragment', () => {
  // 51 boosters in the index have no profile on any relay tested. Their page
  // label is a truncated identifier, and "dbd1ba83b0…ecbd Boosts" is worse than
  // saying nothing about whose.
  for (const none of [null, undefined, '', '   ']) {
    assert.equal(showFilterLabel(none, 'Bitcoin And').label, 'Read these')
  }
  assert.equal(showFilterLabel(null, 'Bitcoin And').full,
    "Read this booster's boosts to Bitcoin And")
})

check('the show filter is an equality on the guid, never on the title', () => {
  assert.deepEqual(filterBoostShow(dbRows, 'show-guid-1').map((r) => r.event_id[0]), ['a'])
  assert.deepEqual(filterBoostShow(dbRows, 'show-guid-2').map((r) => r.event_id[0]), ['d'])
  // The title is not a handle: 33% of shows in the index have none, and titles
  // are not unique in any case.
  assert.deepEqual(filterBoostShow(dbRows, 'Another Show'), [])
})

check('a boost with no show guid belongs to no picked show', () => {
  // dbRows[1] carries a null podcast_guid — ~2% of records do. Filing it under
  // whichever show was picked would be a claim the data cannot support.
  assert.equal(filterBoostShow(dbRows, 'show-guid-1').some((r) => r.podcast_guid == null), false)
  assert.equal(filterBoostShow(dbRows, 'show-guid-2').some((r) => r.podcast_guid == null), false)
})

check('a null show is every show, which is where the other two pages live', () => {
  assert.equal(filterBoostShow(dbRows, null).length, 3)
  assert.equal(filterBoostShow(dbRows, ''), dbRows, 'and costs no copy')
})

check('the three filters compose, narrowest scope outward', () => {
  // One show, then a window that keeps it, then a term its message carries.
  const chain = (guid, cutoff, q) =>
    searchBoostRows(filterBoostRows(filterBoostShow(dbRows, guid), cutoff), q)
  assert.deepEqual(chain('show-guid-1', null, 'great').map((r) => r.event_id[0]), ['a'])
  assert.deepEqual(chain('show-guid-1', 1_700_050_000, 'great').map((r) => r.event_id[0]), ['a'])
  // The same term against the other show finds nothing: the show filter wins.
  assert.deepEqual(chain('show-guid-2', null, 'great'), [])
})

check('search matches the message, and every term of it, in any order', () => {
  const hits = (q) => searchBoostRows(dbRows, q).map((r) => r.event_id[0])
  assert.deepEqual(hits('great'), ['a'], 'case-insensitive')
  assert.deepEqual(hits('GREAT one'), ['a'], 'terms are ANDed, in any order')
  assert.deepEqual(hits('one great'), ['a'])
  assert.deepEqual(hits('great missing'), [], 'every term has to appear')
  assert.deepEqual(hits('nice'), ['d'])
})

check('search is a substring match, which is the point of not using FTS5', () => {
  // FTS5 matches whole tokens with a prefix wildcard, so it would find "thing"
  // from "thin" but never from "hing". A boost message is short prose someone
  // wants to grep.
  assert.deepEqual(searchBoostRows(dbRows, 'hing').map((r) => r.event_id[0]), ['a'])
})

check('search never matches a row that has no message', () => {
  // dbRows[1] carries none, and ~84% of indexed boosts are like it.
  assert.equal(searchBoostRows(dbRows, 'c').some((r) => r.message == null), false)
})

check('search matches the message only, never the show or episode title', () => {
  // "A Track" is dbRows[2]'s episode title and "Another Show" its show; neither
  // may make it a hit, or a query naming the page's own subject returns
  // everything.
  assert.deepEqual(searchBoostRows(dbRows, 'track'), [])
  assert.deepEqual(searchBoostRows(dbRows, 'another show'), [])
})

check('an empty or whitespace query is not a filter', () => {
  assert.equal(searchBoostRows(dbRows, '').length, 3)
  assert.equal(searchBoostRows(dbRows, '   ').length, 3)
  assert.equal(searchBoostRows(dbRows, null).length, 3)
})

check('every sort key in the menu has a comparator', () => {
  for (const key of ['recent', 'episode', 'sats']) {
    assert.equal(typeof BOOST_SORTERS[key], 'function', `${key} has no comparator`)
  }
})

// ── The section, and what the client adopts it through ──────────────────────

check('the section ships the slots boost-section.js contracts on', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Show Boosts', sub: 'Every boost.', noun: 'episode',
    total: 1404, state: { page: 24 },
  })
  assert.match(html, /id="boosts" data-boost-section/)
  assert.match(html, /data-bs-controls hidden/)
  assert.match(html, /data-bs-list/)
  assert.match(html, /data-bs-more/)
  // The band, the list and the load-more are one panel; see .bs-shell.
  const shell = html.slice(html.indexOf('<div class="bs-shell">'))
  for (const slot of ['data-bs-controls', 'data-bs-list', 'data-bs-more']) {
    assert.ok(shell.includes(slot), `${slot} must live inside the shell`)
  }
  const state = JSON.parse(html.match(/data-boost-state>(.*?)<\/script>/s)[1])
  assert.equal(state.count, 3)
  assert.equal(state.total, 1404)
  assert.equal(state.page, 24)
  assert.equal(state.sort, 'recent')
  assert.equal(state.range, 'all')
})

check('the row variant travels in the state, so a repaint cannot diverge', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Episode Boosts', sub: 'Every boost.', noun: 'episode',
    showTarget: false, state: { page: 500 },
  })
  const state = JSON.parse(html.match(/data-boost-state>(.*?)<\/script>/s)[1])
  assert.deepEqual(state.row, {
    noun: 'episode', showTarget: false, linkBooster: true, showShow: false,
  })
  // And the variant in the state is the one the rows were actually rendered with.
  assert.equal(html.includes(boostRows(dbRows, names, state.row)), true)
})

check('the control band is withheld below CONTROLS_MIN', () => {
  const one = renderBoosts(dbRows.slice(0, 1), names, {
    heading: 'Episode Boosts', sub: 'Every boost.', noun: 'episode',
  })
  assert.doesNotMatch(one, /data-bs-controls/, 'a one-row list has nothing to range over')
  assert.match(one, /data-bs-list/, 'the list itself is a fact and ships regardless')
  const three = renderBoosts(dbRows, names, {
    heading: 'Episode Boosts', sub: 'Every boost.', noun: 'episode',
  })
  assert.equal(dbRows.length, CONTROLS_MIN)
  assert.match(three, /data-bs-controls/)
})

check('a stale total that undercounts cannot print "showing 24 of 19"', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Show Boosts', sub: 'Every boost.', noun: 'episode', total: 1,
  })
  const state = JSON.parse(html.match(/data-boost-state>(.*?)<\/script>/s)[1])
  assert.equal(state.total, 3)
})

check('a section with no rows renders nothing at all', () => {
  assert.equal(renderBoosts([], names, {
    heading: 'Show Boosts', sub: 'Every boost.', noun: 'episode',
  }), '')
})

check('a </script> inside the state cannot close the element early', () => {
  const html = renderBoosts(dbRows, names, {
    heading: 'Show Boosts', sub: 'x', noun: '</script><img src=x>',
  })
  const body = html.match(/data-boost-state>(.*?)<\/script>/s)[1]
  assert.doesNotMatch(body, /<\/script>/)
  assert.match(body, /\\u003c\/script>/)
})

console.log(`\n${passed} assertions passed.`)
