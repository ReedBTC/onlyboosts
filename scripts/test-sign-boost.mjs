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
import { validateBoostTemplate, validateDonationTemplate, validateTemplate, secretKeyFrom, overRateLimit, onRequestPost } from '../functions/api/sign-boost.js'
import { verifyEvent, getPublicKey, nip19 } from '../functions/_shared/nostr-sign.js'
import { buildExternalNoteTemplate, buildDonationNoteTemplate, donationHeadline, sanitizeSenderName, MAX_SENDER_NAME_CHARS, resolveNoteFigure, FULL_CREDIT_NUM, FULL_CREDIT_DEN } from '../login-widget/src/lib/externalBoostagram.js'
import { SITE_SIGN_MAX_SATS } from '../login-widget/src/lib/siteSign.js'
import { BOOST_BANNER_URL, DONATION_BANNER_URL, DONATION_URL } from '../login-widget/src/lib/externalBoostagram.js'

let passed = 0
// ⚠️ AWAITS. It used to call fn() bare, so an async assertion that failed became
// an unhandled rejection AFTER the ✓ had already printed — a test that reports
// success and then crashes, which is worse than one that fails.
async function ok(label, fn) {
  await fn()
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
await ok('the shipped builder’s output validates unchanged', () => {
  const t = validateBoostTemplate(realTemplate())
  assert.equal(t.kind, 1)
  assert.equal(t.content, realTemplate().content)
})
await ok('every tag it emits is in the allowlist', () => {
  // The assertion above already proves it; this one names the failure so a
  // rejected new tag reads as "add it to ALLOWED_TAGS" rather than as a puzzle.
  const names = [...new Set(realTemplate().tags.map((t) => t[0]))].sort()
  assert.deepEqual(names, ['amount', 'client', 'i', 'k', 'r', 't'])
})
await ok('a boost with no message and no episode still validates', () => {
  validateBoostTemplate(realTemplate({ message: '', episodeTitle: '', itemGuid: '', bmbUrl: '' }))
})

// ─── The note says one number (Reed's calls, 2026-11-11) ───────────────────
// A partial boost with at least 90% of its sats landed may be posted at the
// amount the donor typed; then the text, the `amount` tag and the quoted
// receipt all carry that figure and the note says nothing about splits. Under
// the floor, or on the donor's choice, it carries what settled WITH the splits
// line. `resolveNoteFigure` is the rule and the modal reads nothing else, so
// its edges are held here, and each outcome is fed through the shipped
// builder to the oracle's validator.
console.log('\nThe note says one number:')
// The tag is millisats, as a string.
const amountOf = (t) => String(Number(t.tags.find((x) => x[0] === 'amount')?.[1]) / 1000)
function noteFor(args) {
  const fig = resolveNoteFigure(args)
  const t = realTemplate({
    paidSats: fig.sats,
    legsPaid: fig.short ? fig.landedLegs : args.legsTotal,
    legsTotal: args.legsTotal,
  })
  return { fig, t }
}
await ok('the floor is nine tenths, as two integers', () => {
  assert.equal(FULL_CREDIT_NUM, 9)
  assert.equal(FULL_CREDIT_DEN, 10)
})
await ok('7 of 8 splits with 3,302 of 3,333 landed: the note carries 3,333 and no splits line', () => {
  const { fig, t } = noteFor({ paidSats: 3302, intendedSats: 3333, legsPaid: 7, legsTotal: 8 })
  assert.deepEqual(fig, { eligible: true, full: true, sats: 3333, short: false, landedSats: 3302, landedLegs: 7 })
  assert.equal(amountOf(t), '3333')
  assert.match(t.content, /3,333 sats/)
  assert.equal(/splits paid/.test(t.content), false, 'a full figure beside a shortfall line is two claims')
  assert.equal(/3,302/.test(t.content), false)
  validateBoostTemplate(t)
})
await ok('the same boost on the donor\'s choice of "paid": 3,302 with the splits line', () => {
  const { fig, t } = noteFor({ paidSats: 3302, intendedSats: 3333, legsPaid: 7, legsTotal: 8, choice: 'paid' })
  assert.deepEqual(fig, { eligible: true, full: false, sats: 3302, short: true, landedSats: 3302, landedLegs: 7 })
  assert.equal(amountOf(t), '3302')
  assert.match(t.content, /7 of 8 splits paid/)
  validateBoostTemplate(t)
})
await ok('⚠️ under the floor there is no choice: 989 of 1,111 says 989 and 3 of 5', () => {
  for (const choice of ['intended', 'paid']) {
    const { fig, t } = noteFor({ paidSats: 989, intendedSats: 1111, legsPaid: 3, legsTotal: 5, choice })
    assert.deepEqual(fig, { eligible: false, full: false, sats: 989, short: true, landedSats: 989, landedLegs: 3 })
    assert.equal(amountOf(t), '989')
    assert.match(t.content, /3 of 5 splits paid/)
    validateBoostTemplate(t)
  }
})
await ok('the edge is exact: 900 of 1,000 qualifies, 899 does not', () => {
  assert.equal(resolveNoteFigure({ paidSats: 900, intendedSats: 1000, legsPaid: 1, legsTotal: 2 }).sats, 1000)
  assert.equal(resolveNoteFigure({ paidSats: 899, intendedSats: 1000, legsPaid: 1, legsTotal: 2 }).sats, 899)
  // No float is involved: 9 of 10 and 89 of 99 land on the right side.
  assert.equal(resolveNoteFigure({ paidSats: 9, intendedSats: 10, legsPaid: 1, legsTotal: 2 }).full, true)
  assert.equal(resolveNoteFigure({ paidSats: 89, intendedSats: 99, legsPaid: 1, legsTotal: 2 }).full, false)
})
await ok('a clean boost has one number and nothing to choose', () => {
  const { fig, t } = noteFor({ paidSats: 2100, intendedSats: 2100, legsPaid: 4, legsTotal: 4 })
  assert.deepEqual(fig, { eligible: false, full: false, sats: 2100, short: false, landedSats: 2100, landedLegs: 4 })
  assert.equal(/splits paid/.test(t.content), false)
})
await ok('⚠️ nothing settled is never full credit, and a donation never is', () => {
  assert.deepEqual(resolveNoteFigure({ paidSats: 0, intendedSats: 1000, legsPaid: 0, legsTotal: 3 }),
    { eligible: false, full: false, sats: 0, short: true, landedSats: 0, landedLegs: 0 })
  assert.equal(resolveNoteFigure({ paidSats: 950, intendedSats: 1000, legsPaid: 1, legsTotal: 2, donation: true }).sats, 950)
})
await ok('a paid total at or above the typed one is never a partial', () => {
  // A paid total at or above the intended one is not a partial at all.
  assert.equal(resolveNoteFigure({ paidSats: 1000, intendedSats: 1000, legsPaid: 2, legsTotal: 2 }).sats, 1000)
  assert.equal(resolveNoteFigure({ paidSats: 1200, intendedSats: 1000, legsPaid: 2, legsTotal: 2 }).sats, 1200)
  assert.equal(resolveNoteFigure({ paidSats: 1200, intendedSats: 1000, legsPaid: 2, legsTotal: 2 }).eligible, false)
})

// ⚠️ The Coordinator's sweep, 2026-11-12: split 1 failed and was paid from a
// phone wallet by QR, splits 2-5 were never answered for by the connected
// wallet. The QR payment is real, but it is not evidence the connected
// wallet sent anything, so the four unconfirmed splits must not count.
await ok('⚠️ a split paid from another wallet does not make unconfirmed splits count', () => {
  const qrOnly = resolveNoteFigure({ paidSats: 100, walletPaidSats: 0, intendedSats: 1000, legsPaid: 1, legsTotal: 5, unconfirmedSats: 900, legsUnconfirmed: 4 })
  assert.equal(qrOnly.landedSats, 100)
  assert.equal(qrOnly.landedLegs, 1)
  assert.equal(qrOnly.full, false)
  assert.equal(qrOnly.sats, 100)
  // One split the connected wallet itself confirmed is the evidence again.
  const alive = resolveNoteFigure({ paidSats: 300, walletPaidSats: 200, intendedSats: 1000, legsPaid: 2, legsTotal: 5, unconfirmedSats: 700, legsUnconfirmed: 3 })
  assert.equal(alive.landedSats, 1000)
  // A caller that passes no walletPaidSats keeps the old reading.
  assert.equal(resolveNoteFigure({ paidSats: 300, intendedSats: 1000, legsPaid: 2, legsTotal: 5, unconfirmedSats: 700, legsUnconfirmed: 3 }).landedSats, 1000)
})
await ok('⚠️ the modal hands the rule the connected wallet\'s own figure, and marks a QR payment', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../login-widget/src/components/ExternalBoostModal.jsx', import.meta.url), 'utf8')
  assert.match(src, /walletPaidSats, donation, choice: noteFigure/)
  assert.match(src, /status: STATUS\.PAID, viaQr: true/)
  assert.match(src, /!l\.viaQr/)
})

// ─── Only a split that failed reduces the note (Reed's call, 2026-11-11) ───
// His own test boost: 333 sats to five splits, four confirmed, and the fifth
// (150 sats) timed out in the wallet and was on his node as paid. The note
// went out at 183 sats with "4 of 5 splits paid". A split the wallet was
// handed and did not answer for is unconfirmed, not unpaid; it counts toward
// the figure and the split count. The one guard: beside at least one
// confirmed split, since a boost with nothing confirmed is what an offline
// wallet looks like.
console.log('\nAn unconfirmed split is not a failed one:')
await ok('⚠️ Reed\'s boost: 183 confirmed and 150 unconfirmed of 333 says 333 and no splits line', () => {
  const { fig, t } = noteFor({ paidSats: 183, intendedSats: 333, legsPaid: 4, legsTotal: 5, unconfirmedSats: 150, legsUnconfirmed: 1 })
  // Not `eligible`: nothing failed, so there is no choice to offer.
  assert.deepEqual(fig, { eligible: false, full: false, sats: 333, short: false, landedSats: 333, landedLegs: 5 })
  assert.equal(amountOf(t), '333')
  assert.match(t.content, /333 sats/)
  assert.equal(/splits paid/.test(t.content), false)
  assert.equal(/183/.test(t.content), false)
  validateBoostTemplate(t)
})
await ok('the donor\'s choice cannot subtract it either: there is no lesser figure to pick', () => {
  const fig = resolveNoteFigure({ paidSats: 183, intendedSats: 333, legsPaid: 4, legsTotal: 5, unconfirmedSats: 150, legsUnconfirmed: 1, choice: 'paid' })
  assert.equal(fig.sats, 333)
  assert.equal(fig.short, false)
})
await ok('⚠️ with nothing confirmed, nothing counts: an offline wallet earns no figure', () => {
  assert.deepEqual(
    resolveNoteFigure({ paidSats: 0, intendedSats: 333, legsPaid: 0, legsTotal: 5, unconfirmedSats: 333, legsUnconfirmed: 5 }),
    { eligible: false, full: false, sats: 0, short: true, landedSats: 0, landedLegs: 0 })
})
await ok('a failed split beside an unconfirmed one, above the floor: full by default, the lesser figure counts the unconfirmed', () => {
  // 1,000 over four splits: 600 confirmed, 350 unconfirmed, 50 failed.
  const args = { paidSats: 600, intendedSats: 1000, legsPaid: 2, legsTotal: 4, unconfirmedSats: 350, legsUnconfirmed: 1 }
  const a = noteFor(args)
  assert.deepEqual(a.fig, { eligible: true, full: true, sats: 1000, short: false, landedSats: 950, landedLegs: 3 })
  assert.equal(/splits paid/.test(a.t.content), false)
  const b = noteFor({ ...args, choice: 'paid' })
  assert.equal(amountOf(b.t), '950')
  assert.match(b.t.content, /3 of 4 splits paid/)
  validateBoostTemplate(b.t)
})
await ok('and below it: the failed split is the only one the note counts against the boost', () => {
  // 1,000 over four splits: 400 confirmed, 300 unconfirmed, 300 failed.
  const { fig, t } = noteFor({ paidSats: 400, intendedSats: 1000, legsPaid: 2, legsTotal: 4, unconfirmedSats: 300, legsUnconfirmed: 1 })
  assert.deepEqual(fig, { eligible: false, full: false, sats: 700, short: true, landedSats: 700, landedLegs: 3 })
  assert.equal(amountOf(t), '700')
  assert.match(t.content, /3 of 4 splits paid/)
  validateBoostTemplate(t)
})
await ok('the floor is measured on what landed, unconfirmed included', () => {
  const at = (paid, unc) => resolveNoteFigure({ paidSats: paid, intendedSats: 1000, legsPaid: 1, legsTotal: 3, unconfirmedSats: unc, legsUnconfirmed: 1 })
  assert.equal(at(500, 400).sats, 1000)
  assert.equal(at(500, 399).sats, 899)
})
await ok('junk in the unconfirmed arguments is zero, not NaN', () => {
  const fig = resolveNoteFigure({ paidSats: 500, intendedSats: 1000, legsPaid: 1, legsTotal: 2, unconfirmedSats: 'x', legsUnconfirmed: -3 })
  assert.equal(fig.sats, 500)
  assert.equal(fig.landedLegs, 1)
})

await ok('⚠️ the modal builds its note from this function and nothing else', async () => {
  const { readFileSync } = await import('node:fs')
  const modal = readFileSync(new URL('../login-widget/src/components/ExternalBoostModal.jsx', import.meta.url), 'utf8')
  assert.match(modal, /const credit = resolveNoteFigure\(\{\s*paidSats, intendedSats, legsPaid: paidCount, legsTotal: activeCount,\s*unconfirmedSats, legsUnconfirmed: unconfirmedCount, walletPaidSats, donation, choice: noteFigure,\s*\}\)/)
  assert.match(modal, /const noteSats = credit\.sats\b/)
  assert.match(modal, /const noteShort = credit\.short\b/)
  assert.match(modal, /const landedSats = credit\.landedSats\b/)
  assert.match(modal, /const landedCount = credit\.landedLegs\b/)
  // The share handler: one figure into the receipt and the template alike,
  // and the real leg counts only beside the lesser figure.
  assert.match(modal, /const figure = \{ sats: noteSats, short: noteShort, paid: landedCount, total: activeCount \}/)
  assert.equal((modal.match(/paidSats: figure\.sats/g) || []).length, 2, 'the receipt and the note')
  assert.match(modal, /legsPaid: figure\.short \? figure\.paid : figure\.total/)
  assert.equal(/FULL_CREDIT/.test(modal), false, 'the floor lives in one file')
})
await ok('⚠️ the note publishes itself only after the watch, and never beside a failed split', async () => {
  const { readFileSync } = await import('node:fs')
  const modal = readFileSync(new URL('../login-widget/src/components/ExternalBoostModal.jsx', import.meta.url), 'utf8')
  // `stillChecking` alone is false on the first render of the done phase, a
  // commit before the watcher marks what it is about to check.
  assert.match(modal, /if \(!watchSettled \|\| stillChecking \|\| paidSats <= 0\) return\s*\n\s*if \(activeCount === 0 \|\| landedCount !== activeCount\) return/)
  assert.match(modal, /if \(pre && pre\.sats === landedSats && pre\.legs === activeCount\)/)
  assert.match(modal, /if \(targets\.length === 0\) \{ setWatchSettled\(true\); return \}/)
  // Retry and the other-wallet invoice stay on FAILED alone; an unconfirmed
  // split gains credit here, never a way to be paid twice.
  assert.match(modal, /return leg\?\.status === STATUS\.FAILED && !leg\?\.qr && !leg\?\.unpayable\n\}/)
  const repay = modal.slice(modal.indexOf('function canRepayLeg('), modal.indexOf('function canCheckLeg('))
  assert.ok(repay.length > 0 && repay.length < 2000, 'the retry guard was found')
  assert.equal(/STATUS\.UNCERTAIN/.test(repay.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), false)
})

// ─── The typed "From" name (boost-login.md D15) ────────────────────────────
// The bot path is the ONLY one that carries a name, and the name is the one
// piece of donor-typed text that becomes a line of the bot's own prose. So it
// gets its own block: the validator has to keep accepting the note, and the
// line has to stay a line.
console.log('\nThe typed sender name rides in the body and nowhere else:')
await ok('a note carrying a From line still validates', () => {
  const t = validateBoostTemplate(realTemplate({ senderName: 'Reed' }))
  assert.match(t.content, /^👤 From Reed$/m)
})
await ok('it adds NO tag, so ALLOWED_TAGS is unaffected', () => {
  const withName = realTemplate({ senderName: 'Reed' }).tags
  const without = realTemplate({ senderName: '' }).tags
  assert.deepEqual(withName, without)
})
await ok('⚠️ it is never a p tag, an author claim or a proxy field', () => {
  // D2/D15: nothing can verify that the person named authorised a note signed
  // by a key they do not hold, so the name may not reach anything the index
  // credits. A `p` tag would also be refused by the oracle's allowlist, which
  // is the second line of defence rather than the first.
  const tags = realTemplate({ senderName: 'Reed' }).tags
  assert.equal(tags.some((t) => t[0] === 'p'), false)
  assert.equal(tags.some((t) => t.includes('Reed')), false)
})
await ok('⚠️ a newline in the name cannot add a line to the note', () => {
  // The body is read line by line by consumers including our own collector,
  // so a name carrying a newline could otherwise post a whole line of its own
  // under the bot's identity.
  const t = realTemplate({ senderName: 'Reed\n🎙️ Some Other Show\nhttps://evil.example' })
  const lines = t.content.split('\n').filter((l) => l.startsWith('👤 From '))
  assert.equal(lines.length, 1)
  // Flattened onto the one line it was given, and then cut by the cap — which
  // is why the URL cannot survive whole either.
  assert.equal(lines[0], '👤 From Reed 🎙️ Some Other Show https://evil.ex')
  validateBoostTemplate(t)
})
await ok('⚠️ a 📱 in the name cannot forge the attribution line', () => {
  // `clients.py#_VIA_RE` fills `client_via` from `📱 via <App>`. It `.search`es,
  // so line 1 wins today whatever the name says; stripping the emoji is what
  // keeps that true if the lines are ever reordered.
  const t = realTemplate({ senderName: '📱 via Fountain' })
  assert.equal(t.content.split('\n').filter((l) => l.includes('📱')).length, 1)
  // Line TWO since the banner landed; `_VIA_RE.search` still finds it first
  // because nothing above it carries the emoji.
  assert.match(t.content.split('\n')[1], /📱 via onlyboosts\.social$/)
})
await ok('the name is capped, and the cap is applied in the builder', () => {
  const long = 'x'.repeat(200)
  const t = realTemplate({ senderName: long })
  const line = t.content.split('\n').find((l) => l.startsWith('👤 From '))
  assert.equal(line.length, '👤 From '.length + MAX_SENDER_NAME_CHARS)
  validateBoostTemplate(t)
})
await ok('a blank or whitespace name emits no line at all', () => {
  for (const name of ['', '   ', '\n\n', undefined, null]) {
    assert.equal(realTemplate({ senderName: name }).content.includes('👤'), false)
  }
  assert.equal(sanitizeSenderName('  \n  '), '')
})

// ─── The banner, and the opening it is allowed to be ──────────────────────
// ⚠️ THE ORACLE HARDCODES THIS URL because a Function cannot import it. These
// three assertions are the whole of what keeps the two copies honest: change
// the banner in the builder alone and the first one fails here rather than
// every site-signed note failing in production.
console.log('\nThe banner leads the note, and the oracle knows exactly which one:')
await ok('the note opens with the banner on its own line', () => {
  const lines = realTemplate().content.split('\n')
  assert.equal(lines[0], BOOST_BANNER_URL)
  assert.match(lines[1], /^⚡Just boosted /)
})
await ok('⚠️ the oracle accepts the banner the shipped builder actually emits', () => {
  validateBoostTemplate(realTemplate())
})
rejects('⚠️ any OTHER text before the boost line', {
  ...realTemplate(),
  content: 'vote for me\n' + realTemplate().content,
}, /not a boost note/)
rejects('a lookalike banner from another host', {
  ...realTemplate(),
  content: realTemplate().content.replace(BOOST_BANNER_URL, 'https://evil.example/x.png'),
}, /not a boost note/)
await ok('a bare boost line with no banner still validates', () => {
  // The un-bannered opening stays legal so a note built before this shipped,
  // or by anything that omits it, is not refused.
  validateBoostTemplate({
    ...realTemplate(),
    content: realTemplate().content.split('\n').slice(1).join('\n'),
  })
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
  tags: realTemplate().tags.map((t) => (t[0] === 'amount' ? ['amount', String(SITE_SIGN_MAX_SATS * 1000 + 1)] : t)),
}, /invalid amount/)
// ⚠️ THE ONE THING PINNING THE TWO COPIES OF THE CAP TOGETHER. The endpoint's
// `MAX_AMOUNT_MSAT` and the widget's `SITE_SIGN_MAX_SATS` live in files that
// cannot import each other, so this pair of assertions is the enforcement. If
// it fails, the modal is either promising a note it cannot get signed or
// refusing one it could.
await ok('the widget\u2019s declared cap is exactly the endpoint\u2019s', () => {
  validateBoostTemplate({
    ...realTemplate(),
    tags: realTemplate().tags.map((t) => (t[0] === 'amount' ? ['amount', String(SITE_SIGN_MAX_SATS * 1000)] : t)),
  })
})

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
await ok('an nsec is accepted', () => {
  const bytes = new Uint8Array(32).fill(9)
  assert.deepEqual(secretKeyFrom(nip19.nsecEncode(bytes)), bytes)
})
await ok('64-char hex is accepted', () => {
  assert.deepEqual(secretKeyFrom('0a'.repeat(32)), new Uint8Array(32).fill(10))
})
await ok('anything else reads as unconfigured, not as an error', () => {
  for (const v of ['', '   ', 'hunter2', 'npub1xxx', undefined, null, 42]) {
    assert.equal(secretKeyFrom(v), null)
  }
})

console.log('\nEnd to end, through the handler:')
const SK = new Uint8Array(32).fill(3)

// A KV namespace, near enough: get/put over a Map. The real one is eventually
// consistent, which this cannot model and which the endpoint's comment is
// honest about — the limiter is friction rather than a boundary.
function fakeKV(store = new Map()) {
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v) },
  }
}
function envWith(over = {}) {
  return {
    BOOSTBOT_NSEC: nip19.nsecEncode(SK),
    SIGN_RATELIMIT: fakeKV(),
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
await ok('the signed event verifies', () => assert.equal(verifyEvent(event), true))
await ok('it is signed by the configured key and nothing else', () => {
  assert.equal(event.pubkey, getPublicKey(SK))
})
await ok('the amount tag survives signing unchanged', () => {
  assert.equal(event.tags.find((t) => t[0] === 'amount')[1], '1000000')
})
await ok('the response is never cached', () => {
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

const noKey = await post(realTemplate(), envWith({ BOOSTBOT_NSEC: '' }))
await ok('no key configured answers 503, so the feature is simply off', () => {
  assert.equal(noKey.status, 503)
})

// ⚠️ The one that would otherwise ship silently. An in-memory counter is
// per-isolate on Cloudflare and is no limit at all, so a missing binding must
// not degrade to "unlimited".
const noLimiter = await post(realTemplate(), envWith({ SIGN_RATELIMIT: undefined }))
await ok('no counter bound answers 503 rather than running unrated', () => {
  assert.equal(noLimiter.status, 503)
})

const brokenLimiter = await post(realTemplate(), envWith({
  SIGN_RATELIMIT: { get: async () => { throw new Error('kv down') }, put: async () => {} },
}))
await ok('a counter that throws answers 503, not an unrated 200', () => {
  assert.equal(brokenLimiter.status, 503)
})

const notAKV = await post(realTemplate(), envWith({ SIGN_RATELIMIT: 'true' }))
await ok('a plain text variable is not mistaken for a namespace', () => {
  assert.equal(notAKV.status, 503)
})

// The counter, exercised directly so the window boundary doesn't cost a minute.
console.log('\nThe rate limiter:')
const kv = fakeKV()
const T0 = 1_800_000_000_000
await ok('the first five requests in a window pass', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(await overRateLimit(kv, '203.0.113.7', T0), false, `request ${i + 1}`)
  }
})
await ok('the sixth is refused', async () => {
  assert.equal(await overRateLimit(kv, '203.0.113.7', T0), true)
})
await ok('a different address has its own count', async () => {
  assert.equal(await overRateLimit(kv, '198.51.100.4', T0), false)
})
await ok('the next window starts clean', async () => {
  assert.equal(await overRateLimit(kv, '203.0.113.7', T0 + 60_000), false)
})
await ok('the key expires on its own, so nothing accumulates', async () => {
  const seen = fakeKV()
  await overRateLimit(seen, '203.0.113.7', T0)
  // put() is called with a TTL that outlives the window; KV's floor is 60s.
  assert.equal([...seen.store.keys()][0], `sign-boost:203.0.113.7:${Math.floor(T0 / 1000 / 60)}`)
})

// ⚠️ Filled at the CURRENT window, not at T0. The handler reads its own clock,
// so a counter spent in some other minute is a counter it never looks at — the
// first version of this test asserted 429 and got a clean 200.
const spent = fakeKV()
for (let i = 0; i < 5; i++) await overRateLimit(spent, '203.0.113.7', Date.now())
const limited = await post(realTemplate(), envWith({ SIGN_RATELIMIT: spent }))
await ok('over the limit the handler answers 429 and signs nothing', () => {
  assert.equal(limited.status, 429)
})

const badJson = await post('{not json')
await ok('malformed JSON answers 400, not 500', () => assert.equal(badJson.status, 400))

const rejected = await post({ ...realTemplate(), kind: 0 })
await ok('a refused template answers 400 and signs nothing', async () => {
  assert.equal(rejected.status, 400)
})


// ─── The donation family ───────────────────────────────────────────────────
//
// ⚠️ THE POINT OF THESE IS THAT THE TWO FAMILIES ARE DISJOINT. A donation note
// is not a boost note with fields left out: it must be refused by the boost
// validator and a boost note must be refused by the donation one, or the looser
// looking shape becomes a way around the stricter one. Every template below is
// built by the SHIPPED builder, so a drift between the widget's constants and
// the Function's restatements fails here rather than in production.

function donation(over = {}) {
  return buildDonationNoteTemplate({ paidSats: 2100, message: 'thanks', ...over })
}

await ok('the shipped donation builder validates', () => {
  const t = validateTemplate(donation())
  assert.equal(t.kind, 1)
  assert.equal(t.content, donation().content)
})

await ok('the banner and headline the Function pins are the ones shipped', () => {
  const lines = donation({ paidSats: 2100 }).content.split('\n')
  assert.equal(lines[0], DONATION_BANNER_URL)
  assert.equal(lines[1], donationHeadline(2100))
})

await ok('the dispatcher routes by opening line, with no fallback', () => {
  // A donation reaching the boost validator, and a boost reaching the donation
  // one, must BOTH be refused. If either passed, `validateTemplate` picking the
  // wrong family would be silent.
  assert.throws(() => validateBoostTemplate(donation()))
  assert.throws(() => validateDonationTemplate(realTemplate()))
})

await ok('a donation carries none of the three markers that make it a boost', () => {
  const names = donation().tags.map((t) => t[0])
  for (const forbidden of ['amount', 'i', 'k']) {
    assert.equal(names.includes(forbidden), false, `donation note carries ${forbidden}`)
  }
  const topics = donation().tags.filter((t) => t[0] === 't').map((t) => t[1])
  for (const forbidden of ['boost', 'boostagram', 'value4value']) {
    assert.equal(topics.includes(forbidden), false, `donation note carries t=${forbidden}`)
  }
})

await ok('a boost topic tag smuggled onto a donation is refused', () => {
  // `t` IS an allowed tag name here, so the allowlist alone does not stop this.
  // Without the explicit refusal a caller could put a fabricated boost into
  // this index under the bot identity.
  for (const topic of ['boost', 'boostagram', 'value4value']) {
    const t = donation()
    t.tags = [...t.tags, ['t', topic]]
    assert.throws(() => validateTemplate(t), /unsupported topic/)
  }
})

await ok('an amount tag on a donation is refused by the allowlist', () => {
  const t = donation()
  t.tags = [...t.tags, ['amount', '2100000']]
  assert.throws(() => validateTemplate(t), /unsupported tag/)
})

await ok('a donation may point only at the site itself', () => {
  const t = donation()
  t.tags = t.tags.map((tag) => (tag[0] === 'r' ? ['r', 'https://evil.example/'] : tag))
  assert.throws(() => validateTemplate(t), /unsupported url/)
  assert.equal(donation().tags.find((tag) => tag[0] === 'r')[1], DONATION_URL)
})

await ok('the headline is matched whole, so nothing may precede or follow it', () => {
  const t = donation()
  t.content = t.content.replace(donationHeadline(2100), donationHeadline(2100) + ' and also')
  assert.throws(() => validateTemplate(t), /not a donation note/)
  // ⚠️ Prepending text does not merely break the donation match, it routes the
  // template to the BOOST validator (the dispatcher keys on the first line), so
  // the refusal arrives under that family's wording. Either way nothing signs,
  // which is the property being asserted; pinning the message here would be
  // pinning which validator happened to answer.
  const t2 = donation()
  t2.content = 'free text\n' + t2.content
  assert.throws(() => validateTemplate(t2))
  assert.throws(() => validateDonationTemplate(t2), /not a donation note/)
})

await ok('the donation cap is the boost cap, read out of the headline', () => {
  // ⚠️ The figure has no tag to live in, so the cap is only as good as the
  // headline match. Same number as SITE_SIGN_MAX_SATS, one sat apart.
  validateTemplate(donation({ paidSats: SITE_SIGN_MAX_SATS }))
  assert.throws(() => validateTemplate(donation({ paidSats: SITE_SIGN_MAX_SATS + 1 })), /invalid amount/)
  assert.throws(() => validateTemplate(donation({ paidSats: 0 })), /invalid amount/)
})

await ok('a donation carries the typed name as prose and never as a tag', () => {
  const t = donation({ senderName: 'Reed' })
  validateTemplate(t)
  assert.match(t.content, /^👤 From Reed$/m)
  assert.equal(t.tags.some((tag) => tag[0] === 'p'), false)
  assert.equal(t.tags.some((tag) => tag.includes('Reed')), false)
})

console.log(`\n${passed} assertions passed.\n`)
