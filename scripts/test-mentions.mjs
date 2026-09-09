/* Tests the @mention machinery: `assets/js/mention-search.js` (the pure half
 * shared by the site's composers and the login widget), the `p` tags the note
 * builders owe a mention, and the wiring rules a text scan can hold.
 *
 * The rules worth protecting, each with a reason in the module's own header:
 *
 *   - THE NOTE CARRIES `nostr:npub1…`, never `@npub1…` and never the label the
 *     editor shows. Reed's rule, 2026-09-09: it is the NIP-27 form, so Helipad
 *     and every client render it as a mention. `expand()` is the note.
 *   - MOST FOLLOWED FIRST. Primal's order is only the tiebreak.
 *   - AN EMAIL IS NOT A TRIGGER. `@` opens the menu only at the start of the
 *     text or after whitespace or an opening bracket/quote.
 *   - `@reed` MUST NOT EAT `@reedbtc`, and a label is matched whole.
 *   - THE BOT ROUTE CARRIES NO `p` TAG. The oracle refuses one, so the builders
 *     emit them only when asked, and the modal asks on the donor route alone.
 *   - THE BOOST MODAL READS THE EXPANDED MESSAGE EVERYWHERE — the TLV, the
 *     note, the counter — and never the raw field.
 *
 * The codec is checked against nostr-tools' nip19 (the edge signer's copy),
 * which is an independent implementation.
 *
 * Run: node scripts/test-mentions.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  npubEncode, pubkeyFromNpub, mentionQueryAt, insertMention, mentionLabel, createMentionMap,
  normaliseNpubs, mentionedPubkeys, rankSearchEvents, formatFollowers, SEARCH_LIMIT,
} from '../assets/js/mention-search.js'
import { nip19 } from '../functions/_shared/nostr-sign.js'
import { buildExternalNoteTemplate, buildDonationNoteTemplate, buildBoostagram, buildLnurlComment, clipMessage, utf8Bytes, MAX_MESSAGE_BYTES } from '../login-widget/src/lib/externalBoostagram.js'
import { validateBoostTemplate, validateDonationTemplate } from '../functions/api/sign-boost.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
function ok(label, fn) { fn(); passed++; console.log(`  ✓ ${label}`) }

const SITE_HEX = '9edbee5534cba129e9c1a89a50e2b29f5abdff9d9a6fb521e61906d477d9f18c'
const SITE_NPUB = 'npub1nmd7u4f5ewsjn6wp4zd9pc4jnadtmluanfhm2g0xryrdga7e7xxq0as4ck'
const BOT_HEX = '3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9'
const BOT_NPUB = npubEncode(BOT_HEX)

console.log('\nbech32, both ways:')
ok('the site npub round-trips, and agrees with nostr-tools', () => {
  assert.equal(npubEncode(SITE_HEX), SITE_NPUB)
  assert.equal(pubkeyFromNpub(SITE_NPUB), SITE_HEX)
  assert.equal(npubEncode(BOT_HEX), nip19.npubEncode(BOT_HEX))
  for (let i = 0; i < 20; i++) {
    const hex = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
    assert.equal(npubEncode(hex), nip19.npubEncode(hex), hex)
    assert.equal(pubkeyFromNpub(nip19.npubEncode(hex)), hex)
  }
})
ok('a bad checksum, a wrong length and a non-npub decode to null', () => {
  assert.equal(pubkeyFromNpub(SITE_NPUB.slice(0, -1) + 'q'), null)
  assert.equal(pubkeyFromNpub('npub1abc'), null)
  assert.equal(pubkeyFromNpub(nip19.noteEncode(SITE_HEX)), null)
  assert.equal(npubEncode('nothex'), '')
})
ok('an nprofile decodes to its pubkey', () => {
  const nprofile = nip19.nprofileEncode({ pubkey: SITE_HEX, relays: ['wss://relay.fountain.fm'] })
  assert.equal(pubkeyFromNpub(nprofile), SITE_HEX)
})

console.log('\nthe trigger:')
ok('`@` at the start, after a space, after a bracket or a quote opens the menu', () => {
  assert.deepEqual(mentionQueryAt('@re', 3), { query: 're', start: 0, end: 3 })
  assert.deepEqual(mentionQueryAt('hi @re', 6), { query: 're', start: 3, end: 6 })
  assert.deepEqual(mentionQueryAt('(@re', 4), { query: 're', start: 1, end: 4 })
  assert.deepEqual(mentionQueryAt('"@re', 4), { query: 're', start: 1, end: 4 })
  assert.deepEqual(mentionQueryAt('line\n@re', 8), { query: 're', start: 5, end: 8 })
})
ok('an email address is not a trigger, and neither is an `@` mid-word', () => {
  assert.equal(mentionQueryAt('reed@nostrplebs.com', 19), null)
  assert.equal(mentionQueryAt('foo@bar', 7), null)
})
ok('a bare `@` reports an empty query; the caller decides whether to search', () => {
  assert.deepEqual(mentionQueryAt('@', 1), { query: '', start: 0, end: 1 })
})
ok('whitespace after the `@` closes the lead-in, and so does a 41-character one', () => {
  assert.equal(mentionQueryAt('@reed btc', 9), null)
  assert.equal(mentionQueryAt('@' + 'x'.repeat(41), 42), null)
  assert.ok(mentionQueryAt('@' + 'x'.repeat(40), 41))
})
ok('the caret, not the end of the text, is what is examined', () => {
  assert.deepEqual(mentionQueryAt('@re and more', 3), { query: 're', start: 0, end: 3 })
  assert.equal(mentionQueryAt('@re and more', 12), null)
})

console.log('\nthe token:')
ok('a pick replaces the lead-in and leaves a space to type on', () => {
  assert.deepEqual(insertMention('hi @re', { start: 3, end: 6 }, 'reed'), { text: 'hi @reed ', caret: 9 })
  assert.deepEqual(insertMention('@re there', { start: 0, end: 3 }, 'reed'), { text: '@reed there', caret: 6 })
  assert.deepEqual(insertMention('@re, ok', { start: 0, end: 3 }, 'reed'), { text: '@reed , ok', caret: 6 })
})
ok('the label is the handle, then the display name, then twelve characters of npub', () => {
  assert.equal(mentionLabel({ name: 'reed', displayName: 'Reed L', npub: SITE_NPUB }), 'reed')
  assert.equal(mentionLabel({ name: '', displayName: 'Docta  Reed', npub: SITE_NPUB }), 'Docta Reed')
  assert.equal(mentionLabel({ name: '', displayName: '', npub: SITE_NPUB }), SITE_NPUB.slice(0, 12))
  assert.equal(mentionLabel({ pubkey: SITE_HEX }), SITE_NPUB.slice(0, 12))
})

console.log('\nthe map:')
ok('a registered label expands to nostr:npub1…, whole-token only', () => {
  const m = createMentionMap()
  assert.equal(m.label({ name: 'reed', pubkey: SITE_HEX }), 'reed')
  assert.equal(m.expand('hi @reed and @reedbtc, @reed!'), `hi nostr:${SITE_NPUB} and @reedbtc, nostr:${SITE_NPUB}!`)
  assert.equal(m.expand('email me@reed.com'), 'email me@reed.com')
})
ok('two people with one handle get distinct labels; one person always gets the same label', () => {
  const m = createMentionMap()
  const a = m.label({ name: 'reed', pubkey: SITE_HEX })
  const b = m.label({ name: 'reed', pubkey: BOT_HEX })
  assert.equal(a, 'reed')
  assert.equal(b, `reed_${BOT_NPUB.slice(5, 9)}`)
  assert.equal(m.label({ name: 'reed', pubkey: SITE_HEX }), 'reed')
  assert.equal(m.size, 2)
  assert.equal(m.expand(`@${b} @${a}`), `nostr:${BOT_NPUB} nostr:${SITE_NPUB}`)
})
ok('the longer label wins when one is a prefix of another', () => {
  const m = createMentionMap()
  m.label({ name: 'reed', pubkey: SITE_HEX })
  m.label({ name: 'reedbtc', pubkey: BOT_HEX })
  assert.equal(m.expand('@reedbtc @reed'), `nostr:${BOT_NPUB} nostr:${SITE_NPUB}`)
})
ok('a label with regex characters or a space is matched literally', () => {
  const m = createMentionMap()
  const l = m.label({ name: 'r.e+e(d)', pubkey: SITE_HEX })
  assert.equal(m.expand(`@${l} x`), `nostr:${SITE_NPUB} x`)
  const m2 = createMentionMap()
  const l2 = m2.label({ name: '', displayName: 'Docta Reed', pubkey: BOT_HEX })
  assert.equal(m2.expand(`yo @${l2} yo`), `yo nostr:${BOT_NPUB} yo`)
})

console.log('\npasted npubs:')
ok('`@npub1…` and a bare `npub1…` become `nostr:npub1…`; an existing URI is untouched', () => {
  assert.equal(normaliseNpubs(`see @${SITE_NPUB}`), `see nostr:${SITE_NPUB}`)
  assert.equal(normaliseNpubs(`see ${SITE_NPUB}`), `see nostr:${SITE_NPUB}`)
  assert.equal(normaliseNpubs(`see nostr:${SITE_NPUB}`), `see nostr:${SITE_NPUB}`)
  assert.equal(normaliseNpubs(`${SITE_NPUB}`), `nostr:${SITE_NPUB}`)
})
ok('an npub inside a URL, and one with a bad checksum, are left as typed', () => {
  const url = `https://njump.me/${SITE_NPUB}`
  assert.equal(normaliseNpubs(url), url)
  const bad = `@${SITE_NPUB.slice(0, -1)}q`
  assert.equal(normaliseNpubs(bad), bad)
})
ok('the map applies the same normalisation on its way out', () => {
  const m = createMentionMap()
  assert.equal(m.expand(`@${BOT_NPUB}`), `nostr:${BOT_NPUB}`)
})

console.log('\nthe p tags a text owes:')
ok('every valid nostr:npub / nostr:nprofile, once each, in order', () => {
  const nprofile = nip19.nprofileEncode({ pubkey: BOT_HEX, relays: [] })
  const text = `a nostr:${SITE_NPUB} b nostr:${nprofile} c nostr:${SITE_NPUB} d nostr:${SITE_NPUB.slice(0, -1)}q`
  assert.deepEqual(mentionedPubkeys(text), [SITE_HEX, BOT_HEX])
  assert.deepEqual(mentionedPubkeys(''), [])
  assert.deepEqual(mentionedPubkeys(`nostr:${nip19.noteEncode(SITE_HEX)}`), [])
})

console.log('\nranking:')
const k0 = (pk, meta) => ({ kind: 0, pubkey: pk, content: JSON.stringify(meta) })
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), D = 'd'.repeat(64)
ok('most followed first, Primal order among equals, no count last', () => {
  const rows = rankSearchEvents([
    k0(A, { name: 'a' }), k0(B, { name: 'b' }), k0(C, { name: 'c' }), k0(D, { name: 'd' }),
    { kind: 10000133, tags: [], content: JSON.stringify({ [A]: 5, [B]: 50, [C]: 50 }) },
  ])
  assert.deepEqual(rows.map((r) => `${r.name}:${r.followers}`), ['b:50', 'c:50', 'a:5', 'd:null'])
})
ok('the per-user count shape (a `p` tag) and the nested shape are read too', () => {
  const rows = rankSearchEvents([
    k0(A, { name: 'a' }), k0(B, { name: 'b' }),
    { kind: 10000133, tags: [['p', A]], content: JSON.stringify({ followers_count: 7 }) },
    { kind: 10000133, tags: [], content: JSON.stringify({ [B]: { followers_count: 70 } }) },
  ])
  assert.deepEqual(rows.map((r) => `${r.name}:${r.followers}`), ['b:70', 'a:7'])
})
ok('a duplicate pubkey, a malformed pubkey and an unsafe picture are dropped', () => {
  const rows = rankSearchEvents([
    k0(A, { name: 'a', picture: 'javascript:alert(1)' }), k0(A, { name: 'a2' }), k0('nope', { name: 'x' }),
    { kind: 10000133, tags: [], content: 'not json' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'a')
  assert.equal(rows[0].picture, null)
  assert.equal(rows[0].npub, npubEncode(A))
})
ok('follower counts are shortened the way a menu row wants', () => {
  assert.equal(formatFollowers(38), '38')
  assert.equal(formatFollowers(2233), '2.2k')
  assert.equal(formatFollowers(1000), '1k')
  assert.equal(formatFollowers(1_500_000), '1.5M')
  assert.equal(formatFollowers(null), '')
})
ok('the menu asks for a bounded page', () => { assert.ok(SEARCH_LIMIT >= 5 && SEARCH_LIMIT <= 10) })

console.log('\nthe note builders:')
const boostArgs = { paidSats: 100, legsPaid: 1, legsTotal: 1, message: `thanks nostr:${SITE_NPUB}`, showTitle: 'Show', podcastGuid: 'g' }
ok('by default a boost note carries no `p` tag, so the oracle still signs it', () => {
  const t = buildExternalNoteTemplate(boostArgs)
  assert.equal(t.tags.filter((x) => x[0] === 'p').length, 0)
  validateBoostTemplate(t)
})
ok('asked to, it tags each mentioned pubkey once, lowercased, dropping junk', () => {
  const t = buildExternalNoteTemplate({ ...boostArgs, mentionPubkeys: [SITE_HEX.toUpperCase(), SITE_HEX, BOT_HEX, 'junk', null] })
  assert.deepEqual(t.tags.filter((x) => x[0] === 'p'), [['p', SITE_HEX], ['p', BOT_HEX]])
  assert.ok(t.content.includes(`nostr:${SITE_NPUB}`))
})
ok('⚠️ and THAT note the oracle refuses: the bot route must never pass the list', () => {
  const t = buildExternalNoteTemplate({ ...boostArgs, mentionPubkeys: [SITE_HEX] })
  assert.throws(() => validateBoostTemplate(t), /unsupported tag/)
})
ok('the donation note behaves the same on both counts', () => {
  const plain = buildDonationNoteTemplate({ paidSats: 2100, message: 'ty' })
  assert.equal(plain.tags.filter((x) => x[0] === 'p').length, 0)
  validateDonationTemplate(plain)
  const tagged = buildDonationNoteTemplate({ paidSats: 2100, message: 'ty', mentionPubkeys: [BOT_HEX] })
  assert.deepEqual(tagged.tags.filter((x) => x[0] === 'p'), [['p', BOT_HEX]])
  assert.throws(() => validateDonationTemplate(tagged), /unsupported tag/)
})

const modal = readFileSync(join(ROOT, 'login-widget/src/components/ExternalBoostModal.jsx'), 'utf8')
console.log('\nthe message cap, in bytes:')
ok('the cap is 300 bytes (Reed, 2026-09-09, measured against the onion)', () => { assert.equal(MAX_MESSAGE_BYTES, 300) })
ok('clipMessage counts UTF-8 bytes and never cuts inside a character', () => {
  assert.equal(clipMessage('a'.repeat(300)), 'a'.repeat(300))
  assert.equal(clipMessage('a'.repeat(301)), 'a'.repeat(300))
  const emoji = '🚀'.repeat(80)                       // 320 bytes, 80 chars
  const cut = clipMessage(emoji)
  assert.equal(cut, '🚀'.repeat(75))                  // 300 bytes exactly, whole emoji
  assert.equal(utf8Bytes(cut), 300)
  assert.equal(clipMessage('a'.repeat(298) + '🚀'), 'a'.repeat(298), 'a 4-byte character that would straddle the edge is dropped whole')
  assert.equal(utf8Bytes('nostr:' + SITE_NPUB), 69)
})
ok('every builder clips the message by bytes, not characters', () => {
  const long = '🚀'.repeat(100)
  assert.equal(utf8Bytes(buildBoostagram({ legMsats: 1000, totalMsats: 1000, message: long }).message), 300)
  assert.ok(buildExternalNoteTemplate({ ...boostArgs, message: long }).content.includes('🚀'.repeat(75) + '"'))
  assert.ok(buildDonationNoteTemplate({ paidSats: 1, message: long }).content.includes('🚀'.repeat(75) + '"'))
  assert.equal(utf8Bytes(buildLnurlComment({ descriptorUrl: '', message: long, commentAllowed: 5000 })), 300)
})
ok('the boostagram carries the feed URL as `url` and the page as `boost_link`, and never one in both', () => {
  const b = buildBoostagram({ legMsats: 1000, totalMsats: 1000, feedUrl: 'https://feeds.example.com/rss', boostLink: 'https://onlyboosts.social/episode/abc' })
  assert.equal(b.url, 'https://feeds.example.com/rss')
  assert.equal(b.boost_link, 'https://onlyboosts.social/episode/abc')
  const none = buildBoostagram({ legMsats: 1000, totalMsats: 1000 })
  assert.equal('url' in none, false); assert.equal('boost_link' in none, false)
  const onlyLink = buildBoostagram({ legMsats: 1000, totalMsats: 1000, boostLink: 'https://boostmebitch.com/?x' })
  assert.equal('url' in onlyLink, false, 'a missing feed URL is not backfilled from the link')
})
ok('every boost surface hands the widget the feed URL', () => {
  for (const f of ['assets/js/episode-card-actions.js', 'assets/js/show-page.js', 'assets/js/episode-page.js', 'assets/js/show-card-actions.js']) {
    assert.ok(/feedUrl: .*\|\| ''/.test(readFileSync(join(ROOT, f), 'utf8')), `${f} passes feedUrl`)
  }
  assert.ok(modal.includes('feedUrl: episode?.feedUrl,') && modal.includes('boostLink: episode?.bmbUrl'))
})

console.log('\nthe share modal’s tags:')
/* hpw-share.js is browser-only; its three absolute imports become stubs, the
 * same trick test-hpw-cards.mjs uses. */
const shareSrc = readFileSync(join(ROOT, 'assets/js/hpw-share.js'), 'utf8')
  .replace(/from '\/assets\/js\/copy-npub\.js\?v=[^']+'/, "from 'data:text/javascript,export const showToast = () => {}'")
  .replace(/from '\/assets\/js\/follow-set\.js\?v=[^']+'/, "from 'data:text/javascript,export const getSessionPubkey = () => null'")
  .replace(/from '\/assets\/js\/mention-picker\.js\?v=[^']+'/, "from 'data:text/javascript,export const attachMentionPicker = () => null'")
const shareDir = mkdtempSync(join(tmpdir(), 'ob-mentions-'))
writeFileSync(join(shareDir, 'hpw-share.mjs'), shareSrc)
const { buildShareTags } = await import(pathToFileURL(join(shareDir, 'hpw-share.mjs')).href)
ok('a mentioned pubkey becomes a `p` tag after the imeta; none by default', () => {
  const base = { link: 'https://onlyboosts.social/#members', imageUrl: 'https://x/y.png', sha256: 'ab', title: 'T' }
  assert.equal(buildShareTags(base).filter((t) => t[0] === 'p').length, 0)
  const tags = buildShareTags({ ...base, mentionPubkeys: [SITE_HEX.toUpperCase(), 'junk'] })
  assert.deepEqual(tags.filter((t) => t[0] === 'p'), [['p', SITE_HEX]])
  assert.equal(tags.at(-1)[0], 'p')
})

console.log('\nwiring, by text scan:')
const actions = readFileSync(join(ROOT, 'assets/js/boost-actions.js'), 'utf8')
const share = readFileSync(join(ROOT, 'assets/js/hpw-share.js'), 'utf8')
const picker = readFileSync(join(ROOT, 'assets/js/mention-picker.js'), 'utf8')
const component = readFileSync(join(ROOT, 'login-widget/src/components/MentionAutocomplete.jsx'), 'utf8')
ok('the boost modal reads the EXPANDED message everywhere, and never the raw field', () => {
  assert.equal((modal.match(/message: expandedMessage/g) || []).length, 4, 'the TLV, the note, the presign and the retry')
  assert.equal(modal.includes('message: message.trim()'), false)
  assert.equal(modal.includes('message.trim()'), false)
  assert.ok(modal.includes('{messageBytes}/{MAX_MESSAGE_BYTES}'), 'the counter is the wire length, in bytes')
  assert.equal(/maxLength=\{MAX_MESSAGE_/.test(modal), false, 'the cap is on the expansion, not the field')
  assert.equal(modal.includes('MAX_MESSAGE_CHARS'), false, 'the cap is bytes; the character constant is gone')
})
ok('the modal passes mention `p` tags on the donor route only', () => {
  assert.ok(modal.includes("mentionPubkeys: noteRoute === 'donor' ? mentionPubkeys : []"))
})
ok('the reply and the zap read the picker, not the textarea', () => {
  assert.ok(actions.includes('sendReply(parent, mentions.expand(), send, composer, mentions.pubkeys())'))
  assert.ok(actions.includes('message: mentions.expand() || \'\''))
  assert.equal(actions.includes('sendReply(parent, ta.value'), false)
  assert.equal(actions.includes('message: msgInput.value'), false)
})
ok('the zap request gains no `p` tag from a mention (NIP-57 reads one `p` as the recipient)', () => {
  const zap = actions.slice(actions.indexOf('kind: 9734'), actions.indexOf('kind: 9734') + 400)
  assert.equal((zap.match(/\['p',/g) || []).length, 1)
})
ok('the share modal publishes the expansion and its `p` tags', () => {
  assert.ok(share.includes('const text = mentions ? mentions.expand() : q(\'[data-text]\').value'))
  assert.ok(share.includes('mentionPubkeys: mentions ? mentions.pubkeys() : []'))
})
ok('the shared module is imported by both builds from the one file', () => {
  assert.ok(/from '\/assets\/js\/mention-search\.js\?v=ob-v\d+'/.test(picker))
  assert.ok(component.includes("from '../../../assets/js/mention-search.js'"))
  assert.ok(modal.includes("from '../../../assets/js/mention-search.js'"))
  const shared = readFileSync(join(ROOT, 'assets/js/mention-search.js'), 'utf8')
  assert.equal(/^\s*import\s/m.test(shared), false, 'mention-search.js imports nothing (Vite and the stamper would each read a sibling import differently)')
})
ok('the built widget carries the search', () => {
  const bundle = readFileSync(join(ROOT, 'assets/widgets/login-widget.js'), 'utf8')
  assert.ok(bundle.includes('user_search'), 'rebuild the widget: cd login-widget && npm run build')
})

console.log(`\n${passed} checks passed`)
