#!/usr/bin/env node
/**
 * Render the episode card against fixture data and assert on the HTML.
 *
 * ⚠️ THE POINT IS THE SHARED DEFINITION, not pixel review. The card is one
 * module now (assets/js/episode-card.js) rendered by four surfaces, two of them
 * at the edge where no browser is involved, so the thing worth checking
 * automatically is that the STRING is right: every fact present, every verb
 * emitted as an inert hook, and nothing third-party reaching an attribute
 * unescaped. Looking at it in a browser is a separate job and a human one.
 *
 * Run: node scripts/test-episode-card.mjs
 */
import assert from 'node:assert/strict'
import {
  buildEpisodes, episodeCardHtml, COPY, sortEpisodeItems, windowEpisodeItems, RANKED_SORTS,
  CARD_PARTS, HOME_CARD_PARTS, boostRowsHtml, namesFrom,
}
  from '../assets/js/episode-card.js'
import { renderMessage, renderBioText } from '../assets/js/nostr-text.js'
import { toEpisodeShape, normalizeBoosts, episodeApiToBoosts } from '../assets/js/ob-data.js'

let passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shaped as /api/v1/episodes returns them, so the test exercises the exact chain
// every surface runs: episodeApiToBoosts → normalizeBoosts → toEpisodeShape →
// buildEpisodes → episodeCardHtml.
// A REAL npub, not a plausible-looking one. renderMessage verifies the bech32
// checksum before it will link an identifier — a corrupted npub would otherwise
// resolve to somebody else's profile — so a made-up string degrades to plain
// text and the mention assertion below silently tests nothing. This is
// OnlyBoosts' own identity, from the site-identity table in CLAUDE.md.
const HEX_A = '9edbee5534cba129e9c1a89a50e2b29f5abdff9d9a6fb521e61906d477d9f18c'
const NPUB_A = 'npub1nmd7u4f5ewsjn6wp4zd9pc4jnadtmluanfhm2g0xryrdga7e7xxq0as4ck'
const HEX_B = 'b'.repeat(64)

const records = [{
  guid: 'item-guid-1',
  title: 'The One About Value 4 Value',
  img: 'https://example.com/ep.jpg',
  date: 1_700_000_000,
  num: 42,
  url: 'https://fountain.fm/episode/abc',
  show: {
    guid: 'show-guid-1',
    title: 'A Podcast & "Friends"',
    img: 'https://example.com/show.jpg',
    art2: 'https://example.com/show-itunes.jpg',
    feed: 'https://example.com/feed.xml',
  },
  boosts: 3, boosters: 2, sats: 12_345, latest: 1_700_100_000,
  boosts_inline: [
    {
      id: 'e'.repeat(64), ts: 1_700_100_000, sats: 10_000, src: 'tag', client: 'Fountain',
      msg: 'Great one! see https://example.com/thing. and hi nostr:' + NPUB_A,
      booster: { pk: HEX_A, npub: NPUB_A, name: 'Alice <script>', pic: 'https://example.com/a.png' },
    },
    {
      id: 'f'.repeat(64), ts: 1_700_050_000, sats: 2_000, src: 'tag', client: 'Fountain',
      msg: '', booster: { pk: HEX_B, npub: null, name: null, pic: null },
    },
    {
      id: '0'.repeat(64), ts: 1_700_010_000, sats: 345, src: 'tag', client: 'Fountain',
      msg: 'thanks', booster: { pk: HEX_A, npub: NPUB_A, name: 'Alice <script>', pic: 'https://example.com/a.png' },
    },
  ],
}, {
  // The degenerate half of the corpus: no title, no art, no show, no enclosure.
  guid: 'item-guid-2',
  title: null, img: null, date: null, num: null, url: null,
  show: { guid: null, title: null, img: null, art2: null, feed: null },
  boosts: 1, boosters: 1, sats: 0, latest: 1_699_000_000,
  boosts_inline: [{
    id: '1'.repeat(64), ts: 1_699_000_000, sats: null, src: null, client: null, msg: null,
    booster: { pk: HEX_B, npub: null, name: null, pic: null },
  }],
}]

function build() {
  const { boosts, totals } = episodeApiToBoosts(records)
  const shaped = toEpisodeShape(normalizeBoosts({ boosts }))
  const items = buildEpisodes(shaped)
  for (const it of items) it.totals = totals.get(it.guid) || null
  return { items, profiles: shaped.profiles }
}

const { items, profiles } = build()
const byGuid = Object.fromEntries(items.map((it) => [it.guid, it]))
const html = episodeCardHtml(byGuid['item-guid-1'], { rank: 1, copy: COPY.other, profiles })
const bare = episodeCardHtml(byGuid['item-guid-2'], { rank: null, copy: COPY.other, profiles })

// ── The facts ───────────────────────────────────────────────────────────────
console.log('\nFacts the server must render:')

check('the episode title, linked to its own page', () => {
  assert.match(html, /<a class="pcast-title pcast-title-link" href="\/episode\/item-guid-1"/)
  assert.match(html, />The One About Value 4 Value</)
})

check('the show name, linked to its show page', () => {
  assert.match(html, /<a class="pcast-show pcast-show-link" href="\/show\/show-guid-1"/)
})

check('the air date, formatted en-US in UTC', () => {
  // 1_700_000_000 is 2023-11-14 22:13:20 UTC. A card rendered at the edge and
  // the same card rebuilt in the browser have to agree, so the locale is pinned.
  assert.match(html, /<div class="pcast-card-aired" title="Episode aired">Nov 14, 2023<\/div>/)
})

check('the artwork chain, as src + data-art2 + data-art3', () => {
  assert.match(html, /src="https:\/\/example\.com\/ep\.jpg"/)
  assert.match(html, /data-art2="https:\/\/example\.com\/show\.jpg"/)
  assert.match(html, /data-art3="https:\/\/example\.com\/show-itunes\.jpg"/)
})

check('the Nostr Stats line, from the server totals and not the rows', () => {
  assert.match(html, /<span class="ob-stats-label">Nostr Stats:<\/span>/)
  assert.match(html, /2 boosters/)
  assert.match(html, /3 boosts/)
})

check('the rank badge only when a rank was passed', () => {
  assert.match(html, /<div class="pcast-rank" aria-hidden="true">1<\/div>/)
  assert.doesNotMatch(bare, /pcast-rank/)
})

check('every boost note is in the document, not built on open', () => {
  assert.equal((html.match(/data-boost-note/g) || []).length, 3)
  assert.match(html, /data-event-id="e{64}"/)
  assert.match(html, new RegExp(`data-pubkey="${HEX_A}"`))
})

check('a boost message renders mentions and links', () => {
  assert.match(html, /<a class="nostr-mention" href="https:\/\/njump\.me\/npub1/)
  assert.match(html, /<a href="https:\/\/example\.com\/thing"/)
  // The trailing full stop is not part of the href.
  assert.doesNotMatch(html, /href="https:\/\/example\.com\/thing\."/)
})

check('the drawer is a <details>, so it opens with no JavaScript', () => {
  assert.match(html, /<details class="pcast-card-details"><summary class="pcast-drawer">/)
  assert.match(html, /Nostr Boosts:/)
})

check('"See all boosts" points at the episode page and is not hidden', () => {
  assert.match(html, /<a class="pcast-seeall" href="\/episode\/item-guid-1"/)
})

check('an untitled episode falls back rather than emitting a dead link', () => {
  assert.doesNotMatch(bare, /href="\/episode\//)
  assert.match(bare, /Untitled episode/)
  assert.match(bare, /pcast-card-media--none/)   // no art at all → the glyph
})

check('a booster with no kind-0 carries the Primal backfill hook', () => {
  assert.match(html, /data-pk="b{64}" data-missing="name pic"/)
  // …and one we do have is not marked.
  assert.doesNotMatch(html, new RegExp(`data-pk="${HEX_A}"`))
})

// ── The verbs ───────────────────────────────────────────────────────────────
console.log('\nVerbs the server must NOT activate:')

check('the boost pill is present, hidden, and carries no handler', () => {
  assert.match(html, /<button type="button" class="ob-boost-pill" hidden data-boost-episode/)
  assert.doesNotMatch(html, /onclick/)
})

check('the subscribe menu ships hidden with its links already rendered', () => {
  assert.match(html, /<div class="pcast-cardmenu" hidden data-subscribe-menu>/)
  assert.match(html, /href="https:\/\/castamatic\.com\/guid\/show-guid-1"/)
})

check('the per-boost menu and the hide control ship hidden and empty', () => {
  assert.match(html, /<div class="pcast-more" hidden data-boost-menu><\/div>/)
  assert.match(html, /class="pcast-drawer-close" type="button" hidden data-drawer-hide/)
})

check('the boost path gets primitives, not a serialized item', () => {
  assert.match(html, /data-show-guid="show-guid-1"/)
  assert.match(html, /data-feed-url="https:\/\/example\.com\/feed\.xml"/)
  assert.match(html, /data-boost-url="https:\/\/onlyboosts\.social\/episode\/item-guid-1"/)
  assert.match(html, /data-noun="episode"/)
})

check('no inline event handler anywhere in either card', () => {
  for (const s of [html, bare]) {
    assert.doesNotMatch(s, /\son[a-z]+=/)
  }
})

check('the markup is balanced — every open tag is closed', () => {
  // A string builder cannot be trusted to nest by inspection, and a card is
  // eleven levels deep. Counting is crude and catches the one failure that
  // matters: a row that closes one <div> too few swallows the rest of the feed.
  for (const s of [html, bare]) {
    const opens = (s.match(/<(div|span|details|summary|a|button|p)\b[^>]*>/g) || [])
      .filter((t) => !t.endsWith('/>')).length
    const closes = (s.match(/<\/(div|span|details|summary|a|button|p)>/g) || []).length
    assert.equal(opens, closes, `${opens} opened, ${closes} closed`)
  }
})

// ── Escaping ────────────────────────────────────────────────────────────────
console.log('\nEscaping:')

check('a show title carrying markup is escaped in text and in attributes', () => {
  assert.match(html, /A Podcast &amp; &quot;Friends&quot;/)
  assert.doesNotMatch(html, /<script>/)
})

check('a display name carrying markup is escaped', () => {
  assert.match(html, /Alice &lt;script&gt;/)
})

// ── Ranking ─────────────────────────────────────────────────────────────────
console.log('\nRanking, shared by the three surfaces that hold their whole corpus:')

check('sortEpisodeItems orders by the requested key', () => {
  const sorted = sortEpisodeItems(items, 'sats')
  assert.equal(sorted[0].guid, 'item-guid-1')
  assert.equal(sortEpisodeItems(items, 'recent')[0].guid, 'item-guid-1')
})

check('⚠️ windowEpisodeItems windows on BOOST time and recomputes the figures', () => {
  // The one range reading, everywhere, since 2026-08-31. Its own micro-corpus,
  // so the expectations are exact: one item with boosts either side of the
  // cutoff (figures must shrink to the window's own), one with none inside it
  // (must drop out entirely).
  const mk = (guid, list) => ({
    boosts: list.map(([ts, sats, pk]) => ({ item_guid: guid, created_at: ts, sats, booster_pubkey: pk })),
    episodes: { [guid]: { item_guid: guid, podcast_guid: 'sh', title: guid, published: 1_000 } },
    shows: { sh: { podcast_guid: 'sh', title: 'Show' } },
  })
  const built = buildEpisodes({
    boosts: [
      ...mk('in-and-out', [[2_000, 50, 'a'], [2_100, 25, 'a'], [500, 999, 'b']]).boosts,
      ...mk('all-before', [[400, 10, 'c'], [450, 10, 'c']]).boosts,
    ],
    episodes: { ...mk('in-and-out', []).episodes, ...mk('all-before', []).episodes },
    shows: mk('x', []).shows,
  })
  assert.equal(windowEpisodeItems(built, 0).length, 2, 'no cutoff → untouched')

  const windowed = windowEpisodeItems(built, 1_000)
  assert.equal(windowed.length, 1, 'an item with no boost in the window drops out')
  const it = windowed[0]
  assert.equal(it.guid, 'in-and-out')
  assert.equal(it.boosts.length, 2, 'the out-of-window boost is gone from the drawer corpus')
  assert.equal(it.totalSats, 75, 'sats are the window’s own, not all-time')
  assert.equal(it.distinctBoosters.length, 1, 'boosters recount over the window')
  assert.equal(it.latest, 2_100)
  assert.equal(it.totals, null, 'the all-time API aggregates are dropped')
  // The original is untouched: windowing copies, never mutates.
  const original = built.find((b) => b.guid === 'in-and-out')
  assert.equal(original.boosts.length, 3)
  assert.equal(original.totalSats, 1_074)
})

check('RANKED_SORTS covers exactly the quantitative sorts', () => {
  // `chart` joined on 2026-08-31: a composite standing is quantitative, so a
  // chart card prints its position. scripts/test-charts.mjs owns the rest.
  assert.deepEqual([...RANKED_SORTS].sort(), ['boosts', 'chart', 'count', 'sats'])
})

// ── Card variants ───────────────────────────────────────────────────────────
//
// Two surfaces show less of the card, and both are cases CLAUDE.md's rendering
// rule names as legitimately different: "which figures are meaningful" and
// "which sections exist". These assert that the parts really do drop out AND
// that nothing else moves with them.
console.log('\nCard variants:')

// The two live variants: /episode's community drawer and /booster's episode list.
const community = episodeCardHtml(byGuid['item-guid-1'], {
  rank: 1, copy: COPY.other, profiles, parts: { stats: true, layout: 'compact' },
})
const booster = episodeCardHtml(byGuid['item-guid-1'], {
  rank: 1, copy: COPY.other, profiles, parts: { stats: false, layout: 'compact' },
})

check('compact drops the player and the ⋮ menu, and rails the pill', () => {
  assert.doesNotMatch(community, /<audio/)
  assert.doesNotMatch(community, /pcast-cardmenu/)
  assert.match(community, /<div class="pcast-card-rail"><button type="button" class="ob-boost-pill"/)
  // The rail is a child of the head, so it can stretch to the head's height —
  // which is what centres the pill vertically.
  assert.match(community, /pcast-card-head[\s\S]*pcast-card-rail/)
})

check('compact keeps everything that is not a verb or a duplicate', () => {
  assert.match(community, /pcast-card-head/)
  assert.match(community, /<details class="pcast-card-details">/)
  assert.match(community, /Nostr Stats:/)          // community-scoped, so meaningful
  assert.match(community, /data-boost-note/)       // the notes still ship
  assert.match(community, /pcast-seeall/)
})

check('stats:false drops the figures without leaving an empty row', () => {
  assert.doesNotMatch(booster, /Nostr Stats:/)
  assert.doesNotMatch(booster, /2 boosters/)
  // .pcast-meta carries a top margin, so an empty one is a gap that reads as a
  // mistake. The pill has moved to the rail, so there is nothing left to hold.
  assert.doesNotMatch(booster, /<div class="pcast-meta pcast-nstats">/)
  assert.match(booster, /class="ob-boost-pill"/)
})

check('the feed layout — pill on the stats line, ⋮ present, no player', () => {
  assert.match(html, /Nostr Stats:/)
  // ⚠️ NO <audio> ON ANY LAYOUT since 2026-09-03; the episode page has it.
  assert.doesNotMatch(html, /<audio/)
  assert.match(html, /pcast-cardmenu/)
  assert.doesNotMatch(html, /pcast-card-rail/)
  // The pill closes the stats row rather than standing alone.
  assert.match(html, /3 boosts<\/span><button type="button" class="ob-boost-pill"/)
})

// The homepage's variant: the whole card, the drawer's rows fetched on open.
const home = episodeCardHtml(byGuid['item-guid-1'], {
  rank: 1, copy: COPY.other, profiles, parts: HOME_CARD_PARTS,
})

check('the default drawer is inline, and the homepage declares lazy off the same table', () => {
  assert.equal(CARD_PARTS.drawer, 'inline')
  assert.equal(HOME_CARD_PARTS.drawer, 'lazy')
  assert.equal(HOME_CARD_PARTS.layout, CARD_PARTS.layout)
  assert.equal(HOME_CARD_PARTS.stats, CARD_PARTS.stats)
})

check('a lazy drawer ships no rows, keeps the <details>, the faces and the footer', () => {
  assert.equal((home.match(/data-boost-note/g) || []).length, 0)
  assert.match(home, /<details class="pcast-card-details"><summary class="pcast-drawer">/)
  assert.match(home, /Nostr Boosts:/)
  assert.match(home, /pcast-avatars/)
  assert.match(home, /<div class="pcast-details" data-lazy-boosts>/)
  assert.match(home, /<a class="pcast-seeall" href="\/episode\/item-guid-1"/)
  assert.match(home, /data-drawer-hide/)
})

check('a lazy drawer changes nothing outside the drawer body', () => {
  const outside = (s) => s.replace(/<div class="pcast-details"[\s\S]*?<\/details>/, '')
  assert.equal(outside(home), outside(html))
})

check('the rows a lazy drawer fetches render through the same function, byte for byte', () => {
  // What episode-card-actions.js#fillLazyDrawer does with the endpoint's answer:
  // rows newest-first, the profile names, then boostRowsHtml. The result has to
  // be exactly the rows the inline card carried, or the two variants have forked.
  const item = byGuid['item-guid-1']
  const rows = [...item.boosts].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  const fetched = boostRowsHtml(rows, profiles, namesFrom(profiles))
  const inline = html.match(/<div class="pcast-details">([\s\S]*?)<div class="pcast-details-foot">/)[1]
  assert.equal(fetched, inline)
  assert.equal((fetched.match(/data-boost-note/g) || []).length, 3)
})

// ── Message truncation ──────────────────────────────────────────────────────
console.log('\nMessage length:')

check('a long boost message is not cut at 420', () => {
  // 420 clipped 6.9% of real messages, measured over the 2,000 most recent
  // boosts. That was the server renderer's number and it reached the feeds when
  // the card became one definition, where nothing had truncated before.
  const long = 'x'.repeat(1200)
  const out = renderMessage(long, new Map())
  assert.ok(out.length >= 1200, `rendered ${out.length} characters of 1200`)
  assert.doesNotMatch(out, /…/)
})

check('a pathological message is still bounded', () => {
  const huge = 'y'.repeat(9000)
  const out = renderMessage(huge, new Map())
  assert.ok(out.length < 2100, `rendered ${out.length} characters — the cap is not holding`)
  assert.match(out, /…$/)
})

// ── Line structure and URLs in a boost message ──────────────────────────────
// ⚠️ ADDED 2026-08-21 BECAUSE THIS SITE'S OWN NOTES RENDERED WORST OF ALL. A
// boost note is multi-line and opens with an image URL; `renderMessage` ran the
// text through `truncate`, which collapses ALL whitespace, so every line
// arrived as one run-on paragraph — with `white-space: pre-wrap` already set on
// all three message classes, so the CSS had been ready the whole time.
console.log('\nLine structure and URLs:')

const NOTE = [
  'https://i.nostr.build/iQ4vHJ88xTrGZ36eey9lWJ.png',
  '⚡Just boosted 100 sats 📱 via onlyboosts.social',
  '💬 "still testing"',
  '',
  '🎙️ Chad and Reeds Podcast • 003. Dimly LIT',
  'https://onlyboosts.social/episode/2c0b0505',
].join('\n')

check('the author\u2019s line breaks survive', () => {
  const out = renderMessage(NOTE, new Map())
  assert.equal((out.match(/\n/g) || []).length, 5, 'newlines were collapsed')
})

check('⚠️ an image URL is a LINK, never an <img>', () => {
  // Tried the other way on 2026-08-21 and reverted the same day: an inline
  // picture turns a dense list row into a post. See the note above `linkOut`.
  // This asserts the revert stayed, because re-adding it is a two-line change
  // that looks like an improvement.
  const out = renderMessage(NOTE, new Map())
  assert.doesNotMatch(out, /<img/)
  assert.match(out, /<a href="https:\/\/i\.nostr\.build\/[^"]+"[^>]*>https/)
})

check('every URL is a link, image-shaped or not', () => {
  const out = renderMessage(NOTE, new Map())
  assert.match(out, /<a href="https:\/\/onlyboosts\.social\/episode\/2c0b0505"[^>]*>https/)
})

check('⚠️ a javascript: or data: URL still reaches no href', () => {
  const out = renderMessage('javascript:alert(1).png and data:image/png;base64,AAAA.png', new Map())
  assert.doesNotMatch(out, /<img/)
  assert.doesNotMatch(out, /href="javascript:/)
  assert.doesNotMatch(out, /href="data:/)
})

check('blank-line runs collapse so a padded note cannot push the card apart', () => {
  const out = renderMessage('top' + '\n'.repeat(9) + 'bottom', new Map())
  assert.equal(out, 'top\n\nbottom')
})

check('spaces and tabs still collapse; only the newline survives', () => {
  assert.equal(renderMessage('a   \t  b', new Map()), 'a b')
})

// ── Bio mentions ────────────────────────────────────────────────────────────
console.log('\nBio mentions:')

check('a mention is an njump link, not a bare span', () => {
  const out = renderBioText(`hi ${NPUB_A} and bye`, new Map())
  assert.match(out, /<a class="bs-mention" href="https:\/\/njump\.me\/npub1/)
  assert.match(out, /<span class="bs-mention-name">/)
  // The hooks booster-page.js#fillMention patches through must survive.
  assert.match(out, new RegExp(`data-pk="${HEX_A}"`))
  assert.match(out, /class="bs-mention-pic is-blank"/)
})

check('a bare npub with a bad checksum stays text', () => {
  const out = renderBioText('hi npub1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzsg7hg4y', new Map())
  assert.doesNotMatch(out, /bs-mention/)
})

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures above)' : ''}.`)
