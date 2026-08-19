#!/usr/bin/env node
/**
 * The signing oracle's validator, exercised against the real note template.
 *
 * ⚠️ THE INPUT IS THE SHIPPED BUILDER, NOT A FIXTURE. `buildExternalNoteTemplate`
 * lives in the widget source and this test imports it, so a tag added there
 * without being added to the endpoint's allowlist fails HERE rather than in
 * production, where the symptom is every site-signed note silently refused.
 * That coupling is the whole point of the test.
 *
 * Run: node scripts/test-sign-boost.mjs
 */
import assert from 'node:assert/strict'
import { validateBoostTemplate, secretKeyFrom, onRequestPost } from '../functions/api/sign-boost.js'
import { verifyEvent, getPublicKey, nip19 } from '../functions/_shared/nostr-sign.js'
import { buildExternalNoteTemplate } from '../login-widget/src/lib/externalBoostagram.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed++
  console.log(`  ✓ ${label}`)
}
function rejects(label, template, expected) {
  let message = null
  try { validateBoostTemplate(template) } catch (e) { message = e.message }
  assert.notEqual(message, null, `${label}: expected a rejection, got none`)
  if (expected) assert.match(message, expected, `${label}: wrong reason (${message})`)
  passed++
  console.log(`  ✓ ${label} — ${message}`)
}

// A real template, exactly as the modal builds one.
function realTemplate(over = {}) {
  return buildExternalNoteTemplate({
    paidSats: 1000,
    legsPaid: 2,
    legsTotal: 3,
    message: 'great episode',
    showTitle: 'Chad and Reeds Podcast',
    episodeTitle: '002. Idea Economy',
    podcastGuid: '7c6f7875-2b73-491e-b32c-e2c8d6e91d53',
    itemGuid: 'a1b2c3',
    bmbUrl: 'https://onlyboosts.social/episode/a1b2c3',
    ...over,
  })
}

console.log('\nThe real template passes:')
ok('the shipped builder’s output validates unchanged', () => {
  const t = validateBoostTemplate(realTemplate())
  assert.equal(t.kind, 1)
  assert.equal(t.content, realTemplate().content)
})
ok('every tag it emits is in the allowlist', () => {
  // The assertion above already proves it; this one names the failure so a
  // rejected new tag reads as "add it to ALLOWED_TAGS" rather than as a puzzle.
  const names = [...new Set(realTemplate().tags.map((t) => t[0]))].sort()
  assert.deepEqual(names, ['amount', 'client', 'i', 'k', 'r', 't'])
})
ok('a boost with no message and no episode still validates', () => {
  validateBoostTemplate(realTemplate({ message: '', episodeTitle: '', itemGuid: '', bmbUrl: '' }))
})

console.log('\nThe oracle refuses to be a general-purpose signer:')
rejects('kind 0 (profile hijack)', { ...realTemplate(), kind: 0 }, /kind 1/)
rejects('kind 4 (a DM)', { ...realTemplate(), kind: 4 }, /kind 1/)
rejects('free text that is not a boost', { ...realTemplate(), content: 'vote for me' }, /not a boost note/)
rejects('the topic markers stripped', {
  ...realTemplate(),
  tags: realTemplate().tags.filter((t) => t[1] !== 'boostagram'),
}, /not a boost note/)

console.log('\nThe two tags that make it worth attacking:')
rejects('an e tag, which would make this REPLY to any note', {
  ...realTemplate(),
  tags: [...realTemplate().tags, ['e', 'f'.repeat(64)]],
}, /unsupported tag/)
rejects('a p tag, which would make this a mention blast', {
  ...realTemplate(),
  tags: [...realTemplate().tags, ['p', 'f'.repeat(64)]],
}, /unsupported tag/)

console.log('\nThe figure this index will read off the note:')
rejects('two amount tags', {
  ...realTemplate(),
  tags: [...realTemplate().tags, ['amount', '1']],
}, /invalid amount/)
rejects('an amount above the cap', {
  ...realTemplate(),
  tags: realTemplate().tags.map((t) => (t[0] === 'amount' ? ['amount', '999000000'] : t)),
}, /invalid amount/)
rejects('a non-integer amount', {
  ...realTemplate(),
  tags: realTemplate().tags.map((t) => (t[0] === 'amount' ? ['amount', '1.5e6'] : t)),
}, /invalid amount/)
rejects('a negative amount', {
  ...realTemplate(),
  tags: realTemplate().tags.map((t) => (t[0] === 'amount' ? ['amount', '-1000'] : t)),
}, /invalid amount/)

console.log('\nWhat gets published under our own name:')
rejects('a javascript: url in an r tag', {
  ...realTemplate(),
  tags: realTemplate().tags.map((t) => (t[0] === 'r' ? ['r', 'javascript:alert(1)'] : t)),
}, /unsupported url/)
rejects('someone else’s client attribution', {
  ...realTemplate(),
  tags: realTemplate().tags.map((t) => (t[0] === 'client' ? ['client', 'evil.example'] : t)),
}, /unsupported client/)

console.log('\nSize and time:')
rejects('content past the cap', { ...realTemplate(), content: '⚡Just boosted ' + 'x'.repeat(3000) }, /invalid content/)
rejects('a tag item past the cap', {
  ...realTemplate(),
  tags: [...realTemplate().tags, ['t', 'x'.repeat(600)]],
}, /invalid tags/)
rejects('a back-dated note', { ...realTemplate(), created_at: Math.floor(Date.now() / 1000) - 4000 }, /created_at/)
rejects('a post-dated note', { ...realTemplate(), created_at: Math.floor(Date.now() / 1000) + 4000 }, /created_at/)

console.log('\nThe key:')
ok('an nsec is accepted', () => {
  const bytes = new Uint8Array(32).fill(9)
  assert.deepEqual(secretKeyFrom(nip19.nsecEncode(bytes)), bytes)
})
ok('64-char hex is accepted', () => {
  assert.deepEqual(secretKeyFrom('0a'.repeat(32)), new Uint8Array(32).fill(10))
})
ok('anything else reads as unconfigured, not as an error', () => {
  for (const v of ['', '   ', 'hunter2', 'npub1xxx', undefined, null, 42]) {
    assert.equal(secretKeyFrom(v), null)
  }
})

console.log('\nEnd to end, through the handler:')
const SK = new Uint8Array(32).fill(3)
function envWith(over = {}) {
  return {
    BOOSTBOT_NSEC: nip19.nsecEncode(SK),
    SIGN_RATELIMIT: { limit: async () => ({ success: true }) },
    ...over,
  }
}
function post(body, env = envWith()) {
  return onRequestPost({
    request: new Request('https://onlyboosts.social/api/sign-boost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })
}

const res = await post(realTemplate())
assert.equal(res.status, 200)
const { event } = await res.json()
ok('the signed event verifies', () => assert.equal(verifyEvent(event), true))
ok('it is signed by the configured key and nothing else', () => {
  assert.equal(event.pubkey, getPublicKey(SK))
})
ok('the amount tag survives signing unchanged', () => {
  assert.equal(event.tags.find((t) => t[0] === 'amount')[1], '1000000')
})
ok('the response is never cached', () => {
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

const noKey = await post(realTemplate(), envWith({ BOOSTBOT_NSEC: '' }))
ok('no key configured answers 503, so the feature is simply off', () => {
  assert.equal(noKey.status, 503)
})

// ⚠️ The one that would otherwise ship silently. An in-memory counter is
// per-isolate on Cloudflare and is no limit at all, so a missing binding must
// not degrade to "unlimited".
const noLimiter = await post(realTemplate(), envWith({ SIGN_RATELIMIT: undefined }))
ok('no rate limiter answers 503 rather than running unrated', () => {
  assert.equal(noLimiter.status, 503)
})

const limited = await post(realTemplate(), envWith({
  SIGN_RATELIMIT: { limit: async () => ({ success: false }) },
}))
ok('over the limit answers 429', () => assert.equal(limited.status, 429))

const badJson = await post('{not json')
ok('malformed JSON answers 400, not 500', () => assert.equal(badJson.status, 400))

const rejected = await post({ ...realTemplate(), kind: 0 })
ok('a refused template answers 400 and signs nothing', async () => {
  assert.equal(rejected.status, 400)
})

console.log(`\n${passed} assertions passed.\n`)
