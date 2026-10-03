/* Tests the summary receipt: the ONE kind 9735 a boost note quotes so Fountain
 * draws the ⚡ figure (BMB's measurement, 2026-09-16/17; the design record is
 * *The Note Quotes One Receipt* in docs/money-paths.md).
 *
 * Three halves:
 *
 *   - `assets/js/zap-receipt.js`, the pure module both builds share: the 9734
 *     validator and what it refuses, the bot-authored spec path, the receipt
 *     template, the quote's two halves, and the hand-written `nevent` codec
 *     against nostr-tools' nip19 (the edge signer's copy, an independent
 *     implementation).
 *   - `/api/sign-receipt`, the oracle, end to end with a fake KV: the two
 *     bindings, the counter in its OWN window, a sender-signed request, a
 *     bot-authored spec, a tampered signature.
 *   - the note: the SHIPPED builder's output with a receipt, and the boost
 *     oracle's rule for the `q` tag it now admits — once, and (when the
 *     oracle is asked) only under the bot's own key.
 *
 * The rules worth protecting:
 *
 *   - THE ORACLE SIGNS NOTHING A CALLER WROTE. It takes a 9734 and derives the
 *     9735; a caller can attest a payment from their OWN key or an anonymous
 *     one from the bot's, and nothing else.
 *   - NO bolt11, NO prose, ONE `p` AND IT IS THE BOT. See the module header.
 *   - THE CAP IS THE BOOST ORACLE'S CAP. One number signs under this key.
 *   - A NOTE WITH NO RECEIPT IS BYTE-IDENTICAL TO THE NOTE BEFORE RECEIPTS.
 *
 * Run: node scripts/test-sign-receipt.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  nip73Tags, zapRequestTags, validateSummaryRequest, summaryRequestTemplateFromSpec,
  summaryReceiptTemplate, receiptQuote, neventEncode,
  SUMMARY_MAX_MSAT, SUMMARY_MAX_RELAYS, BOOSTBOT_PUBKEY_HEX,
} from '../assets/js/zap-receipt.js'
import { onRequestPost } from '../functions/api/sign-receipt.js'
import { validateBoostTemplate, MAX_AMOUNT_MSAT, onRequestPost as signBoostPost } from '../functions/api/sign-boost.js'
import { finalizeEvent, getPublicKey, verifyEvent, nip19 } from '../functions/_shared/nostr-sign.js'
import { buildExternalNoteTemplate } from '../login-widget/src/lib/externalBoostagram.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
function ok(label, fn) { fn(); passed++; console.log(`  ✓ ${label}`) }
async function okAsync(label, fn) { await fn(); passed++; console.log(`  ✓ ${label}`) }

const SK = new Uint8Array(32).fill(3)          // the bot
const SITE = getPublicKey(SK)
const DONOR_SK = new Uint8Array(32).fill(7)
const DONOR = getPublicKey(DONOR_SK)
const NOW = Math.floor(Date.now() / 1000)
const RELAYS = ['wss://nos.lol', 'wss://relay.ditto.pub', 'wss://relay.fountain.fm']
const REFS = {
  podcastGuid: '7c6f7875-2b73-491e-b32c-e2c8d6e91d53',
  episodeGuid: 'a1b2c3',
  podcastUrl: 'https://onlyboosts.social/show/7c6f7875-2b73-491e-b32c-e2c8d6e91d53',
  episodeUrl: 'https://onlyboosts.social/episode/a1b2c3',
}

function request(over = {}, { sk = DONOR_SK, tags } = {}) {
  return finalizeEvent({
    kind: 9734,
    created_at: NOW,
    content: '',
    tags: tags ?? zapRequestTags({ relays: RELAYS, amountMsat: 100_000, recipientPubkey: SITE, refs: REFS }),
    ...over,
  }, sk)
}
function refuses(label, input, expected) {
  const r = validateSummaryRequest(input, SITE, NOW)
  assert.equal(r.ok, false, `${label}: expected a refusal`)
  if (expected) assert.match(r.reason, expected, `${label}: wrong reason (${r.reason})`)
}

console.log('\nthe one cap:')
ok('the receipt cap is the boost oracle’s cap, one number under the bot key', () => {
  assert.equal(SUMMARY_MAX_MSAT, MAX_AMOUNT_MSAT)
})
ok('the restated bot pubkey is the site identity table’s', () => {
  const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
  assert.ok(claude.includes(`| Bot pubkey (hex) | \`${BOOSTBOT_PUBKEY_HEX}\` |`), 'CLAUDE.md names a different bot pubkey')
})

console.log('\nthe NIP-73 pairs:')
ok('item first, then show, k before i, hints only when http(s)', () => {
  assert.deepEqual(nip73Tags(REFS), [
    ['k', 'podcast:item:guid'], ['i', 'podcast:item:guid:a1b2c3', REFS.episodeUrl],
    ['k', 'podcast:guid'], ['i', 'podcast:guid:7c6f7875-2b73-491e-b32c-e2c8d6e91d53', REFS.podcastUrl],
  ])
  assert.deepEqual(nip73Tags({ podcastGuid: 'x', podcastUrl: 'javascript:alert(1)' }), [['k', 'podcast:guid'], ['i', 'podcast:guid:x']])
  assert.deepEqual(nip73Tags({}), [])
  assert.deepEqual(nip73Tags(null), [])
})
ok('a request carries relays, amount, one p, then the pairs — and nothing else', () => {
  const names = zapRequestTags({ relays: RELAYS, amountMsat: 1000, recipientPubkey: SITE, refs: REFS }).map((t) => t[0])
  assert.deepEqual(names, ['relays', 'amount', 'p', 'k', 'i', 'k', 'i'])
})

console.log('\nthe validator:')
ok('a sender-signed request passes and comes back as exactly its seven fields', () => {
  const req = request()
  const r = validateSummaryRequest({ ...req, extra: 'dropped', tags: req.tags }, SITE, NOW)
  assert.equal(r.ok, true, r.reason)
  assert.deepEqual(Object.keys(r.request).sort(), ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'])
  assert.deepEqual(r.request.tags, req.tags)
  assert.notEqual(r.request.tags, req.tags, 'tags are copied, not shared')
})
ok('every refusal the oracle relies on', () => {
  refuses('kind 1', request({ kind: 1 }), /not a zap request/)
  refuses('not an event', 'nope', /not an event/)
  refuses('prose', request({ content: 'hi' }), /content must be empty/)
  refuses('skew', request({ created_at: NOW - 301 }), /created_at out of range/)
  const t = (over) => request({}, { tags: zapRequestTags({ relays: RELAYS, amountMsat: 100_000, recipientPubkey: SITE, refs: REFS }).concat(over) })
  refuses('an e tag', t([['e', 'ab'.repeat(32)]]), /unsupported tag e/)
  refuses('a client tag', t([['client', 'evil']]), /unsupported tag client/)
  refuses('a second p', t([['p', DONOR]]), /p must be the site key, once/)
  const base = (over) => zapRequestTags({ relays: RELAYS, amountMsat: 100_000, recipientPubkey: SITE, refs: REFS, ...over })
  refuses('a foreign p', request({}, { tags: base({ recipientPubkey: DONOR }) }), /p must be the site key/)
  refuses('fractional sats', request({}, { tags: base({ amountMsat: 1500 }) }), /amount out of range/)
  refuses('over the cap', request({}, { tags: base({ amountMsat: SUMMARY_MAX_MSAT + 1000 }) }), /amount out of range/)
  refuses('zero', request({}, { tags: base({ amountMsat: 0 }) }), /amount missing/)
  refuses('a ws:// relay', request({}, { tags: base({ relays: ['ws://nos.lol'] }) }), /bad relays/)
  refuses('no relays', request({}, { tags: base({ relays: [] }) }), /bad relays/)
  refuses('nine relays', request({}, { tags: base({ relays: Array.from({ length: 9 }, (_, i) => `wss://r${i}.example`) }) }), /bad relays/)
  refuses('a ref outside the podcast namespace', request({}, { tags: [['relays', ...RELAYS], ['amount', '1000'], ['p', SITE], ['k', 'isbn'], ['i', 'isbn:123']] }), /bad k tag/)
  refuses('an i without its k', request({}, { tags: [['relays', ...RELAYS], ['amount', '1000'], ['p', SITE], ['i', 'podcast:guid:x']] }), /i without k/)
  refuses('an i hint that is not http', request({}, { tags: [['relays', ...RELAYS], ['amount', '1000'], ['p', SITE], ['k', 'podcast:guid'], ['i', 'podcast:guid:x', 'javascript:1']] }), /bad i hint/)
  refuses('a bare i', request({}, { tags: [['relays', ...RELAYS], ['amount', '1000'], ['p', SITE], ['k', 'podcast:guid'], ['i', 'podcast:guid:']] }), /bad i tag/)
})

console.log('\nthe spec path:')
ok('a spec becomes a request that the same validator accepts, addressed to the bot', () => {
  const t = summaryRequestTemplateFromSpec({ amountMsat: 100_000, relays: RELAYS, refs: REFS }, SITE, NOW)
  assert.ok(t)
  const signed = finalizeEvent(t, SK)
  const r = validateSummaryRequest(signed, SITE, NOW)
  assert.equal(r.ok, true, r.reason)
  assert.equal(signed.pubkey, SITE)
  assert.deepEqual(t.tags, zapRequestTags({ relays: RELAYS, amountMsat: 100_000, recipientPubkey: SITE, refs: REFS }))
})
ok('a spec is three bounded facts: no tag, no p, no prose can reach it', () => {
  const t = summaryRequestTemplateFromSpec({ amountMsat: 1000, relays: RELAYS, refs: REFS, tags: [['e', 'x']], content: 'hi', p: DONOR }, SITE, NOW)
  assert.equal(t.content, '')
  assert.deepEqual(t.tags.map((x) => x[0]), ['relays', 'amount', 'p', 'k', 'i', 'k', 'i'])
  assert.equal(t.tags.find((x) => x[0] === 'p')[1], SITE)
})
ok('a bad spec is null', () => {
  assert.equal(summaryRequestTemplateFromSpec({ amountMsat: 1500, relays: RELAYS }, SITE, NOW), null)
  assert.equal(summaryRequestTemplateFromSpec({ amountMsat: SUMMARY_MAX_MSAT + 1000, relays: RELAYS }, SITE, NOW), null)
  assert.equal(summaryRequestTemplateFromSpec({ amountMsat: 1000, relays: [] }, SITE, NOW), null)
  assert.equal(summaryRequestTemplateFromSpec({ amountMsat: 1000, relays: ['http://x'] }, SITE, NOW), null)
  assert.equal(summaryRequestTemplateFromSpec({ amountMsat: '1000', relays: RELAYS }, SITE, NOW), null)
  assert.equal(summaryRequestTemplateFromSpec(null, SITE, NOW), null)
  const many = summaryRequestTemplateFromSpec({ amountMsat: 1000, relays: Array.from({ length: 12 }, (_, i) => `wss://r${i}.example`) }, SITE, NOW)
  assert.equal(many.tags[0].length - 1, SUMMARY_MAX_RELAYS)
})

console.log('\nthe receipt template:')
ok('p the bot, P the sender, the request verbatim in description, amount and refs mirrored, no bolt11', () => {
  const req = validateSummaryRequest(request(), SITE, NOW).request
  const t = summaryReceiptTemplate(req, SITE, NOW)
  assert.equal(t.kind, 9735)
  assert.equal(t.content, '')
  assert.deepEqual(t.tags.slice(0, 2), [['p', SITE], ['P', DONOR]])
  assert.deepEqual(JSON.parse(t.tags[2][1]), req)
  assert.deepEqual(t.tags[3], ['amount', '100000'])
  assert.deepEqual(t.tags.slice(4), nip73Tags(REFS))
  assert.equal(t.tags.some((x) => x[0] === 'bolt11'), false)
})

console.log('\nthe quote:')
ok('the q tag is (id, first hint, author) and the body line is a nevent with at most three hints', () => {
  const id = 'ab'.repeat(32)
  const q = receiptQuote({ id, pubkey: SITE, relays: ['wss://a.example', 'ws://no', 'wss://b.example', 'wss://c.example', 'wss://d.example'] })
  assert.deepEqual(q.tag, ['q', id, 'wss://a.example', SITE])
  const d = nip19.decode(q.line.slice('nostr:'.length))
  assert.equal(d.type, 'nevent')
  assert.deepEqual(d.data, { id, relays: ['wss://a.example', 'wss://b.example', 'wss://c.example'], author: SITE, kind: 9735 })
  assert.deepEqual(receiptQuote({ id, pubkey: SITE, relays: [] }).tag, ['q', id, '', SITE])
})
ok('the nevent codec is byte-identical to nostr-tools on random input', () => {
  let n = 0
  for (let i = 0; i < 60; i++) {
    const bytes = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')
    const relays = Array.from({ length: i % 4 }, (_, k) => `wss://relay${k}-${i}.example/${'x'.repeat(i % 7)}`)
    const args = { id: bytes(), relays, author: i % 3 ? bytes() : undefined, kind: i % 2 ? 9735 : (i % 5 ? 1 : undefined) }
    assert.equal(neventEncode(args), nip19.neventEncode(args), JSON.stringify(args))
    n++
  }
  assert.equal(n, 60)
  assert.equal(neventEncode({ id: 'nothex' }), '')
})

// ─── The oracle ─────────────────────────────────────────────────────────────
function fakeKV(store = new Map()) {
  return { store, get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v) } }
}
function envWith(over = {}) {
  return { BOOSTBOT_NSEC: nip19.nsecEncode(SK), SIGN_RATELIMIT: fakeKV(), ...over }
}
function post(body, env = envWith()) {
  return onRequestPost({
    request: new Request('https://onlyboosts.social/api/sign-receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })
}

console.log('\nthe oracle:')
await okAsync('a sender-signed request becomes a receipt the bot signed, P naming the sender', async () => {
  const req = request()
  const res = await post({ request: req })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const { event } = await res.json()
  assert.equal(verifyEvent(event), true)
  assert.equal(event.kind, 9735)
  assert.equal(event.pubkey, SITE)
  assert.deepEqual(event.tags.slice(0, 2), [['p', SITE], ['P', DONOR]])
  assert.deepEqual(JSON.parse(event.tags[2][1]), { id: req.id, pubkey: req.pubkey, created_at: req.created_at, kind: 9734, tags: req.tags, content: '', sig: req.sig })
  assert.deepEqual(event.tags[3], ['amount', '100000'])
})
await okAsync('a spec becomes a receipt whose sender is the bot', async () => {
  const res = await post({ spec: { amountMsat: 21_000, relays: RELAYS, refs: REFS } })
  assert.equal(res.status, 200)
  const { event } = await res.json()
  assert.equal(verifyEvent(event), true)
  assert.deepEqual(event.tags.slice(0, 2), [['p', SITE], ['P', SITE]])
  assert.deepEqual(event.tags[3], ['amount', '21000'])
  assert.deepEqual(event.tags.slice(4), nip73Tags(REFS))
})
await okAsync('a tampered signature, a foreign p, a bad spec and bad JSON are 400s', async () => {
  const req = request()
  assert.equal((await post({ request: { ...req, sig: 'ab'.repeat(64) } })).status, 400)
  assert.equal((await post({ request: { ...req, content: 'x' } })).status, 400)
  assert.equal((await post({ request: request({}, { tags: zapRequestTags({ relays: RELAYS, amountMsat: 1000, recipientPubkey: DONOR }) }) })).status, 400)
  assert.equal((await post({ spec: { amountMsat: 1500, relays: RELAYS } })).status, 400)
  assert.equal((await post({})).status, 400)
  assert.equal((await post('{nope')).status, 400)
  assert.equal((await post('null')).status, 400)
})
await okAsync('a request signed by one key but claiming another is refused by the signature check', async () => {
  const req = request()
  const res = await post({ request: { ...req, pubkey: SITE } })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'bad signature')
})
await okAsync('no key and no counter are 503, and the counter runs in its own window', async () => {
  assert.equal((await post({ request: request() }, envWith({ BOOSTBOT_NSEC: '' }))).status, 503)
  assert.equal((await post({ request: request() }, envWith({ SIGN_RATELIMIT: undefined }))).status, 503)
  const kv = fakeKV()
  for (let i = 0; i < 5; i++) assert.equal((await post({ request: request() }, envWith({ SIGN_RATELIMIT: kv }))).status, 200, `request ${i + 1}`)
  assert.equal((await post({ request: request() }, envWith({ SIGN_RATELIMIT: kv }))).status, 429)
  assert.ok([...kv.store.keys()].every((k) => k.startsWith('sign-receipt:')), 'the receipt counter shares the boost counter’s window')
})

// ─── The note ───────────────────────────────────────────────────────────────
function note(over = {}) {
  return buildExternalNoteTemplate({
    paidSats: 1000, legsPaid: 2, legsTotal: 2, message: 'great episode',
    showTitle: 'Chad and Reeds Podcast', episodeTitle: '002. Idea Economy',
    podcastGuid: REFS.podcastGuid, itemGuid: REFS.episodeGuid, bmbUrl: REFS.episodeUrl,
    ...over,
  })
}
const RECEIPT_ID = 'cd'.repeat(32)
const QUOTE = { id: RECEIPT_ID, pubkey: SITE, relays: ['wss://nos.lol'] }

console.log('\nthe note:')
ok('with a receipt the note carries the q tag and ends with the nevent line', () => {
  const t = note({ receipt: QUOTE })
  assert.deepEqual(t.tags.find((x) => x[0] === 'q'), ['q', RECEIPT_ID, 'wss://nos.lol', SITE])
  const last = t.content.split('\n').at(-1)
  assert.ok(last.startsWith('nostr:nevent1'))
  assert.deepEqual(nip19.decode(last.slice(6)).data, { id: RECEIPT_ID, relays: ['wss://nos.lol'], author: SITE, kind: 9735 })
  assert.equal(t.tags.filter((x) => x[0] === 'q').length, 1)
})
ok('without one, the note is byte-identical to the note before receipts existed', () => {
  const a = note(), b = note({ receipt: null }), c = note({ receipt: {} })
  assert.equal(a.content, b.content); assert.deepEqual(a.tags, b.tags)
  assert.equal(a.content, c.content); assert.deepEqual(a.tags, c.tags)
  assert.equal(a.content.includes('nevent'), false)
  assert.equal(a.tags.some((x) => x[0] === 'q'), false)
})
ok('the boost oracle admits the quote under the bot’s key and refuses it under any other', () => {
  const t = note({ receipt: QUOTE })
  validateBoostTemplate(t)                                  // shape only: the ingest endpoint
  validateBoostTemplate(t, { sitePubkey: SITE })             // the oracle
  assert.throws(() => validateBoostTemplate(t, { sitePubkey: DONOR }), /unsupported quote/)
  assert.throws(() => validateBoostTemplate(note({ receipt: { ...QUOTE, pubkey: DONOR } }), { sitePubkey: SITE }), /unsupported quote/)
})
ok('a second q, a short q, a bad id and an http hint are refused by shape', () => {
  const t = note({ receipt: QUOTE })
  assert.throws(() => validateBoostTemplate({ ...t, tags: [...t.tags, ['q', 'ab'.repeat(32), '', SITE]] }), /invalid quote/)
  assert.throws(() => validateBoostTemplate({ ...t, tags: t.tags.map((x) => (x[0] === 'q' ? ['q', RECEIPT_ID] : x)) }), /invalid quote/)
  assert.throws(() => validateBoostTemplate({ ...t, tags: t.tags.map((x) => (x[0] === 'q' ? ['q', 'nothex', '', SITE] : x)) }), /invalid quote/)
  assert.throws(() => validateBoostTemplate({ ...t, tags: t.tags.map((x) => (x[0] === 'q' ? ['q', RECEIPT_ID, 'https://nos.lol', SITE] : x)) }), /invalid quote/)
  validateBoostTemplate({ ...t, tags: t.tags.map((x) => (x[0] === 'q' ? ['q', RECEIPT_ID, '', SITE] : x)) })   // an empty hint is the pre-signed shape
})
await okAsync('end to end: the boost oracle signs a note quoting the bot’s receipt and refuses one quoting a stranger’s', async () => {
  const sign = (body) => signBoostPost({
    request: new Request('https://onlyboosts.social/api/sign-boost', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify(body),
    }),
    env: envWith(),
  })
  const good = await sign(note({ receipt: QUOTE, senderName: 'Reed' }))
  assert.equal(good.status, 200)
  const { event } = await good.json()
  assert.equal(verifyEvent(event), true)
  assert.deepEqual(event.tags.find((x) => x[0] === 'q'), ['q', RECEIPT_ID, 'wss://nos.lol', SITE])
  const bad = await sign(note({ receipt: { ...QUOTE, pubkey: DONOR }, senderName: 'Reed' }))
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error, 'unsupported quote')
})

console.log('\nwiring, by text scan:')
const modal = readFileSync(join(ROOT, 'login-widget/src/components/ExternalBoostModal.jsx'), 'utf8')
const client = readFileSync(join(ROOT, 'login-widget/src/lib/summaryReceipt.js'), 'utf8')
ok('the modal mints on both publish paths and hands the quote to the builder', () => {
  assert.equal((modal.match(/await mintSummaryReceipt\(\{/g) || []).length, 2, 'handleShare and presignNote each mint')
  assert.ok(modal.includes("as: noteRoute === 'donor' ? 'self' : 'site', publish: true"), 'the post-payment mint follows the note’s route and publishes')
  assert.ok(modal.includes("as: 'self', publish: false"), 'the pre-sign mint holds the receipt unpublished')
  assert.equal((modal.match(/receipt: minted\?\.quote \|\| null/g) || []).length, 2)
  assert.ok(modal.includes('receipt: minted?.event || null'), 'the pre-signed record carries the held receipt')
})
ok('the pre-signed note’s receipt goes out before the note, and a receipt nobody took drops the pre-signed note', () => {
  const i = modal.indexOf('async function publishPresigned(pre)')
  const body = modal.slice(i, modal.indexOf('async function', i + 10))
  assert.ok(body.indexOf('await publishReceipt(pre.receipt)') < body.indexOf('publishSignedKindOne(event)'))
  assert.ok(body.includes('return handleShare()'))
})
ok('the client never throws and asks the bot’s own pubkey for the sender-signed 9734', () => {
  assert.ok(client.includes('recipientPubkey: BOOSTBOT_PUBKEY_HEX'))
  assert.ok(client.includes("import { zapRequestTags, receiptQuote, BOOSTBOT_PUBKEY_HEX, SUMMARY_MAX_RELAYS } from '../../../assets/js/zap-receipt.js'"))
  const fn = client.slice(client.indexOf('export async function mintSummaryReceipt'))
  assert.ok(/^\s*try \{/m.test(fn) && fn.includes('return null'))
})
ok('the shared module imports nothing', () => {
  const src = readFileSync(join(ROOT, 'assets/js/zap-receipt.js'), 'utf8')
  assert.equal(/^import /m.test(src), false)
  assert.equal(src.includes('Date.now()'), false, 'no clock: the oracle supplies the time')
})

console.log(`\n${passed} checks passed.`)
