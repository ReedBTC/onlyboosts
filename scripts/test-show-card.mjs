#!/usr/bin/env node
/**
 * Render the show card against fixture data and assert on the HTML.
 *
 * ⚠️ THE POINT IS THE SHARED DEFINITION, not pixel review. The card is one
 * module (assets/js/show-card.js) rendered on both sides of the wire — at the
 * edge by functions/index.js, in the browser by shows-feed.js after every
 * re-sort — so the thing worth checking automatically is that the STRING is
 * right: every fact present, every verb emitted as an inert hook, nothing
 * third-party reaching an attribute unescaped, and no formatter that could
 * produce a different answer at the edge than in the browser.
 *
 * That last class is why this file exists at all. `renderShowCard` was a DOM
 * builder and could afford `Date.now()` and `toLocaleDateString(undefined, …)`;
 * a two-sided module cannot, and neither failure looks like anything — the card
 * renders, the date is simply wrong for the reader or different from the one the
 * edge shipped. See the header of show-card.js.
 *
 * Run: node scripts/test-show-card.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  COPY, copyFor, toCard, showCardHtml, renderShowCards, showRankValue,
  SORT_OPTIONS, RANKED_SORTS, SHOW_CARDS_PER_PAGE, episodeRowsHtml,
  sortEpisodeRows, shortDate, fmtSats,
} from '../assets/js/show-card.js'
import { competitionRanks, rankLabel } from '../assets/js/rank.js'

let passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1 }
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shaped as /api/v1/podcasts returns them, so the test exercises the exact chain
// both sides run: toCard → showCardHtml.
const RECORD = {
  guid: 'show-guid-1',
  title: 'A Podcast & "Friends"',
  img: 'https://example.com/show.jpg',
  art2: 'https://example.com/show-itunes.jpg',
  feed: 'https://example.com/feed.xml',
  author: 'Someone <script>',
  boosts: 1234, sats: 1_234_567, boosters: 1, episodes: 12,
  latest: 1_700_000_000,
}
// The 33% of shows Podcast Index cannot identify: a guid, some boosts, no title
// and no art. They are real boosts to real shows and are kept rather than
// filtered, so the card has to have an honest shape for them.
const UNNAMED = {
  guid: 'ffffffff-0000-0000-0000-000000000000',
  title: '', img: '', art2: '', feed: '',
  boosts: 1, sats: 100, boosters: 1, episodes: 0, latest: 0,
}

const card = showCardHtml(toCard(RECORD), { rank: '4', copy: COPY.other })
const unnamed = showCardHtml(toCard(UNNAMED), { rank: null, copy: COPY.other })
const album = showCardHtml(toCard({ ...RECORD, guid: 'album-1' }), { copy: COPY.music })

console.log('\nshow card — facts')

check('the title links to the show page', () => {
  assert.match(card, /href="\/show\/show-guid-1"/)
})

check('third-party text is escaped in text and in attributes', () => {
  // The title carries an ampersand and double quotes. If either reached an
  // attribute raw it would end the attribute early and the rest of the card
  // with it, which is the failure this whole class of test exists for.
  assert.ok(!card.includes('A Podcast & "Friends"'), 'raw title leaked into the markup')
  assert.match(card, /A Podcast &amp; &quot;Friends&quot;/)
  assert.match(card, /data-title="A Podcast &amp; &quot;Friends&quot;"/)
})

check('the artwork chain ships as src plus data-art2', () => {
  assert.match(card, /src="https:\/\/example\.com\/show\.jpg"/)
  assert.match(card, /data-art2="https:\/\/example\.com\/show-itunes\.jpg"/)
})

check('an unidentified show is labelled and shows its guid, and does not link', () => {
  assert.match(unnamed, /Unidentified show/)
  assert.match(unnamed, /ob-show-guid">ffffffff-0000-0000-0000-000000000000/)
  assert.ok(!unnamed.includes('href="/show/'), 'an unidentified show must not link to a page it has not got')
})

check('an unidentified show gets no boost pill', () => {
  // Podcast Index does not know the feed, so there is no value block to resolve
  // and the button could only ever fail.
  assert.ok(!unnamed.includes('data-boost-show'))
  assert.match(card, /data-boost-show/)
})

check('the boost pill ships hidden', () => {
  // It is a VERB. Present and inert is worse than arriving with the module.
  assert.match(card, /class="ob-boost-pill" hidden data-boost-show/)
})

check('a show with no episodes gets no drawer', () => {
  assert.ok(!unnamed.includes('pcast-card-details'))
  assert.match(card, /<details class="pcast-card-details">/)
})

check('the drawer is a <details>, not a button beside a hidden div', () => {
  // <details> opens with no JavaScript, so the reader always gets something —
  // and what they get with no JavaScript is the footer link to the show's page.
  assert.match(card, /<summary class="pcast-drawer">/)
  assert.ok(!card.includes('aria-expanded'), 'the button-and-aria-expanded form is what this replaced')
  assert.match(card, /class="pcast-seeall" href="\/show\/show-guid-1"/)
})

check('the drawer body is the lazy hook and a status line', () => {
  assert.match(card, /data-lazy-episodes/)
  assert.match(card, /data-drawer-status>Loading episodes…/)
})

check('the figures carry the Nostr Stats: qualifier', () => {
  assert.match(card, /class="ob-stats-label">Nostr Stats:/)
  assert.match(card, />1,234 boosts</)
  assert.match(card, />1 booster</)     // singular, not "1 boosters"
  assert.match(card, /1\.2M/)
})

check('no episode count is printed', () => {
  // Sats, boosts and boosters are measures of boost activity. An episode count
  // is a claim about the show, and ours is not that claim. See show-card.js.
  assert.ok(!/\b12 episodes?\b/.test(card), 'the episode count must not reach the card')
})

console.log('\nshow card — the two-sided contract')

check('no relative time is rendered; the timestamp rides as data', () => {
  /* ⚠️ THE REGRESSION THIS FILE WAS WRITTEN FOR. `relTime()` read Date.now(),
   * so the edge — behind a 300s cache, serving the same bytes to everyone who
   * arrives in that window — would have shipped a "3m ago" that was wrong for
   * almost every reader, and different from what the browser rebuilt. */
  assert.match(card, /data-latest-ts="1700000000"/)
  assert.ok(!/\d+[mhd] ago/.test(card), 'a relative time reached the server-rendered card')
  assert.match(card, /last boost Nov 14, 2023/)
})

check('dates are en-US in UTC regardless of the host locale', () => {
  assert.equal(shortDate(1_700_000_000), 'Nov 14, 2023')
  assert.equal(shortDate(0), '')
  assert.equal(shortDate(null), '')
})

check('counts are pinned to en-US grouping', () => {
  // n.toLocaleString() unpinned prints "1.234" in a de-DE process.
  assert.match(card, />1,234 boosts</)
})

check('the source carries no unpinned locale or clock call', () => {
  /* A source scan rather than a render, because the failure is invisible in the
   * output when the test process happens to be en-US in UTC — which is exactly
   * the machine this will be run on. The two-sided half of the module may not
   * read a clock or a default locale at all. */
  const src = readFileSync(new URL('../assets/js/show-card.js', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/Date\.now\(/.test(code), 'show-card.js reads the clock')
  assert.ok(!/toLocaleDateString\(\s*(undefined|\))/.test(code), 'unpinned toLocaleDateString')
  assert.ok(!/toLocaleString\(\s*\)/.test(code), 'unpinned toLocaleString')
})

check('every import is relative and stamped, never absolute', () => {
  /* ⚠️ THE RULE THAT MAKES A TWO-SIDED MODULE POSSIBLE. An absolute
   * `/assets/js/…` import resolves in the browser and cannot be bundled by
   * esbuild, so it would break the edge render and nothing else. See CLAUDE.md,
   * "One Module, Imported From Both Sides". */
  const src = readFileSync(new URL('../assets/js/show-card.js', import.meta.url), 'utf8')
  const bad = [...src.matchAll(/from\s+'(\/[^']+)'/g)].map((m) => m[1])
  assert.deepEqual(bad, [], `absolute imports in a two-sided module: ${bad.join(', ')}`)
  const rel = [...src.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1])
  assert.ok(rel.length > 0, 'expected relative imports')
  for (const r of rel) assert.match(r, /\?v=ob-v\d+$/, `unstamped relative import: ${r}`)
})

console.log('\nshow card — Shows vs Albums')

check('the copy table is the only difference', () => {
  assert.match(album, /Tracks with Nostr Boosts/)
  assert.match(card, /Episodes with Nostr Boosts/)
  assert.equal(copyFor('music'), COPY.music)
  assert.equal(copyFor('podcast'), COPY.other)
  // ⚠️ A PARTITION, NOT A NARROWING: video and the shows Podcast Index cannot
  // identify are not music, so they come here. See CLAUDE.md.
  assert.equal(copyFor(null), COPY.other)
  assert.equal(copyFor('video'), COPY.other)
})

check('an unidentified release is labelled with the music noun', () => {
  const u = showCardHtml(toCard(UNNAMED), { copy: COPY.music })
  assert.match(u, /Unidentified release/)
})

console.log('\nshow card — ranking')

check('ties share the better place and the next value skips the group', () => {
  // 1-2-2-4, the site's one scheme. The sats tiebreak makes paging stable and
  // must never decide a standing.
  const rows = [{ boosters: 9 }, { boosters: 7 }, { boosters: 7 }, { boosters: 5 }]
  const ranks = competitionRanks(rows, showRankValue('boosters'))
  assert.deepEqual(ranks.map((r) => rankLabel(r.rank, r.tied)), ['1', 'T2', 'T2', '4'])
})

check('showRankValue reads the field the sort key names', () => {
  const row = { boosts: 3, sats: 4, boosters: 5, latest: 6 }
  for (const [key] of SORT_OPTIONS) {
    /* ⚠️ `chart` IS THE ONE EXEMPTION: a chart standing is a tuple, so every
     * chart row wears a SERVER rank and the renderers never consult
     * showRankValue for it (the rebuild guards in shows-feed.js). There is no
     * row.chart field to read, and inventing one here would assert a contract
     * nothing ships. */
    if (key === 'chart') continue
    assert.equal(showRankValue(key)(row), row[key], `${key} must read row.${key}`)
  }
})

check('every ranked sort is a real sort option, and latest is not ranked', () => {
  const keys = new Set(SORT_OPTIONS.map(([k]) => k))
  for (const k of RANKED_SORTS) assert.ok(keys.has(k), `${k} ranks but is not offered`)
  assert.ok(!RANKED_SORTS.has('latest'), 'chronology is not a standing')
})

check('a chronological sort paints no numeral', () => {
  const plain = showCardHtml(toCard(RECORD), { rank: null, copy: COPY.other })
  assert.ok(!plain.includes('pcast-rank'))
})

console.log('\nshow card — the drawer rows')

/* ⚠️ THE UNSAFE-URL ROW MUST BE UNTITLED OR THE GUARD IS NEVER REACHED. An
 * episode with a title links to its own page here and `url` is not consulted at
 * all, so a titled fixture would assert on a branch that cannot run — a test
 * that passes for the wrong reason and would keep passing with the guard
 * deleted. Verified by removing isSafeUrl: this fixture fails, a titled one
 * does not. */
const EPS = [
  { guid: 'a', title: 'Later', date: 200, boosts: 2, sats: 50, url: '' },
  { guid: 'b', title: '', date: 100, boosts: 0, sats: 0, url: 'https://example.com/x.mp3' },
  { guid: 'c', title: '', date: 150, boosts: 1, sats: 0, url: 'javascript:alert(1)' },
]

check('rows are newest first', () => {
  assert.deepEqual(sortEpisodeRows(EPS).map((e) => e.guid), ['a', 'c', 'b'])
})

check('an untitled episode falls back to its audio URL, and only that branch opens a tab', () => {
  const html = episodeRowsHtml(sortEpisodeRows(EPS), COPY.other)
  assert.match(html, /Untitled episode/)
  assert.match(html, /href="https:\/\/example\.com\/x\.mp3" target="_blank" rel="noopener noreferrer"/)
  assert.equal((html.match(/target="_blank"/g) || []).length, 1)
})

check('an unsafe URL is never emitted as an href', () => {
  const html = episodeRowsHtml(sortEpisodeRows(EPS), COPY.other)
  assert.ok(!html.includes('javascript:'), 'a javascript: URL reached the markup')
  // It degrades to plain text rather than vanishing: the row still names the
  // episode, it just does not offer a link to a scheme we will not emit.
  assert.match(html, /<span class="ob-ep-title">Untitled episode<\/span>/)
})

check('an empty list says so rather than rendering an empty <ul>', () => {
  assert.match(episodeRowsHtml([], COPY.other), /No episodes recorded/)
  assert.match(episodeRowsHtml([], COPY.music), /No tracks recorded/)
})

check('a truncated list says how many it is showing', () => {
  const html = episodeRowsHtml(EPS.slice(0, 2), COPY.other, { truncatedFrom: 90 })
  assert.match(html, /Showing the 2 most recent of 90 episodes/)
})

console.log('\nshow card — a page of cards')

check('renderShowCards stamps the rank the caller computed', () => {
  const rows = [toCard(RECORD), toCard({ ...RECORD, guid: 'g2' })]
  const html = renderShowCards(rows, { copy: COPY.other, rankOf: (_s, i) => `T${i + 1}` })
  assert.equal((html.match(/data-show-card/g) || []).length, 2)
  assert.match(html, />T1</)
  assert.match(html, />T2</)
})

check('the page size is one number', () => {
  assert.equal(typeof SHOW_CARDS_PER_PAGE, 'number')
  assert.ok(SHOW_CARDS_PER_PAGE > 0)
})

check('fmtSats compacts without lying about zero', () => {
  assert.equal(fmtSats(0), '0')
  assert.equal(fmtSats(-5), '0')
  assert.equal(fmtSats(999), '999')
  assert.equal(fmtSats(1500), '1.5k')
  assert.equal(fmtSats(2000), '2k')
  assert.equal(fmtSats(1_234_567), '1.2M')
})

console.log(`\n${passed} checks passed`)
