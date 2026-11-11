/* The wallet-side settlement check (paymentLookup.js and
 * externalBoost.js#confirmLegSettled), the second source of truth a leg with
 * no NWC reply went without until 2026-09-04.
 *
 * What it pins:
 *   - classifyLookup: `state` first, then settled_at / preimage for wallets
 *     that predate it; nothing but an explicit `state: "failed"` is `failed`;
 *   - classifyLookupError: NOT_IMPLEMENTED and a validation failure are
 *     `unsupported`, NOT_FOUND and everything else `unknown` — a payment the
 *     wallet cannot find is not one it proved it never made;
 *   - keysendPaymentHash against a known SHA-256 vector, and its refusal of
 *     anything that is not 32 hex bytes;
 *   - confirmViaWallet's loop: a definite answer ends it, `unsupported` ends
 *     it at once, a throwing lookup is one `unknown` poll, the deadline and
 *     the abort signal both end it with `unknown`;
 *   - confirmLegSettled with the wallet injected and `fetch` STUBBED for
 *     LUD-21: the wallet's settled answer wins with no verify URL, LUD-21's
 *     wins when the wallet is unsupported, the wallet's `failed` is returned
 *     as such and LUD-21 can never produce it, WebLN (no lookup) with no
 *     verify URL is `unknown` without a single call.
 *
 *   - requestLegInvoice (2026-11-11), the invoice the modal puts on screen as
 *     a QR code for a split the connected wallet could not pay, with `fetch`
 *     STUBBED for the recipient's LNURL endpoints and for /api/boostbox: the
 *     descriptor files the split under the BOOST's own id and total, never a
 *     one-split boost of its own; the comment the recipient is sent leads
 *     with that descriptor; a split that pays a node, and a split of nothing,
 *     are refused before any request; a recipient's refusal reaches the
 *     caller as its reason.
 *
 * Confirmed red on three mutations: `failed` inferred from a missing
 * settled_at, NOT_FOUND classified as `failed`, and the loop's deadline
 * check removed (the test then hangs, which is red enough). And on a fourth,
 * 2026-11-11: requestLegInvoice ignoring `boost`, which is the retried split
 * telling Helipad it was the whole boost.
 *
 *   - payExternalBoost's account of WHERE a split failed (2026-11-11), run
 *     against a stand-in browser-extension wallet (`window.webln` with no
 *     `keysend`, so the keysend upgrade is skipped) and the same stubbed
 *     provider: `noInvoice` on a split that failed before any invoice was
 *     issued, `unpayable` ('closed' | 'min' | 'max') when the recipient's
 *     own published limits exclude the amount, neither on an invoice the
 *     wallet was handed and declined. The modal offers Retry and the
 *     other-wallet invoice off those two fields. Confirmed red on: each
 *     clause of sendableLimit removed, the limit check skipped, the catch
 *     dropping either field, the per-run reset removed, and legErrorDetail
 *     passing a limit sentence through the 140-character clip.
 *
 *   node scripts/test-payment-lookup.mjs
 */
import assert from 'node:assert/strict'
import {
  classifyLookup, classifyLookupError, keysendPaymentHash, confirmViaWallet,
} from '../login-widget/src/lib/paymentLookup.js'
import { confirmLegSettled, legIsCheckable, requestLegInvoice, payExternalBoost } from '../login-widget/src/lib/externalBoost.js'
import * as wallet from '../login-widget/src/lib/wallet.js'

let passed = 0
async function ok(label, fn) { await fn(); passed++; console.log(`  ✓ ${label}`) }

const HASH = 'c'.repeat(64)

console.log('\nclassifyLookup')
await ok('state wins', () => {
  assert.equal(classifyLookup({ state: 'settled' }), 'settled')
  assert.equal(classifyLookup({ state: 'SETTLED', settled_at: 0 }), 'settled')
  assert.equal(classifyLookup({ state: 'failed', settled_at: 1 }), 'failed', 'an explicit failed outranks a stray settled_at')
  assert.equal(classifyLookup({ state: 'pending' }), 'pending')
  assert.equal(classifyLookup({ state: 'accepted' }), 'pending')
})
await ok('a wallet without `state` settles on settled_at or a preimage', () => {
  assert.equal(classifyLookup({ settled_at: 1788527946 }), 'settled')
  assert.equal(classifyLookup({ preimage: 'a'.repeat(64) }), 'settled')
  assert.equal(classifyLookup({ preimage: '' }), 'pending')
  assert.equal(classifyLookup({ settled_at: 0, preimage: null }), 'pending')
})
await ok('⚠️ failed is never inferred', () => {
  assert.equal(classifyLookup({ settled_at: null }), 'pending')
  assert.equal(classifyLookup({ type: 'outgoing' }), 'pending')
  assert.equal(classifyLookup({ state: 'expired' }), 'pending', 'an unknown state keeps the leg where it is')
  assert.equal(classifyLookup(null), 'unknown')
  assert.equal(classifyLookup('settled'), 'unknown')
})

console.log('\nclassifyLookupError')
await ok('no such method is unsupported', () => {
  assert.equal(classifyLookupError({ code: 'NOT_IMPLEMENTED', message: 'x' }), 'unsupported')
  assert.equal(classifyLookupError({ name: 'Nip47ResponseValidationError', message: 'response from NWC failed validation: …' }), 'unsupported')
  assert.equal(classifyLookupError({ code: 'RESTRICTED' }), 'unsupported')
})
await ok('⚠️ NOT_FOUND is unknown, not failed', () => {
  assert.equal(classifyLookupError({ code: 'NOT_FOUND', message: 'transaction not found' }), 'unknown')
  assert.equal(classifyLookupError({ name: 'Nip47ReplyTimeoutError', message: 'reply timeout: event abc' }), 'unknown')
  assert.equal(classifyLookupError(new Error('boom')), 'unknown')
  assert.equal(classifyLookupError(null), 'unknown')
})

console.log('\nkeysendPaymentHash')
await ok('SHA-256 of the preimage bytes, hex', async () => {
  assert.equal(await keysendPaymentHash('00'.repeat(32)), '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925')
  assert.equal(await keysendPaymentHash('FF'.repeat(32)), await keysendPaymentHash('ff'.repeat(32)))
})
await ok('anything but 32 hex bytes is null', async () => {
  assert.equal(await keysendPaymentHash(''), null)
  assert.equal(await keysendPaymentHash('00'.repeat(31)), null)
  assert.equal(await keysendPaymentHash('zz'.repeat(32)), null)
})

console.log('\nconfirmViaWallet')
await ok('a definite answer ends the loop', async () => {
  const answers = ['pending', 'unknown', 'settled', 'settled']
  let calls = 0
  const lookup = async () => answers[calls++]
  assert.equal(await confirmViaWallet({ lookup, paymentHash: HASH, deadlineMs: 5000, intervalMs: 5 }), 'settled')
  assert.equal(calls, 3)
})
await ok('failed is returned as the wallet said it', async () => {
  assert.equal(await confirmViaWallet({ lookup: async () => 'failed', paymentHash: HASH, deadlineMs: 5000, intervalMs: 5 }), 'failed')
})
await ok('unsupported ends it at once', async () => {
  let calls = 0
  assert.equal(await confirmViaWallet({ lookup: async () => { calls++; return 'unsupported' }, paymentHash: HASH, deadlineMs: 5000, intervalMs: 5 }), 'unsupported')
  assert.equal(calls, 1)
})
await ok('a throwing lookup is one unknown poll, and the deadline ends it', async () => {
  let calls = 0
  const lookup = async () => { calls++; throw new Error('relay down') }
  const t0 = Date.now()
  assert.equal(await confirmViaWallet({ lookup, paymentHash: HASH, deadlineMs: 40, intervalMs: 10 }), 'unknown')
  assert.ok(calls >= 2 && calls <= 6, `polled ${calls} times`)
  assert.ok(Date.now() - t0 < 500)
})
await ok('deadline 0 asks exactly once', async () => {
  let calls = 0
  assert.equal(await confirmViaWallet({ lookup: async () => { calls++; return 'pending' }, paymentHash: HASH, deadlineMs: 0 }), 'unknown')
  assert.equal(calls, 1)
})
await ok('an abort ends it', async () => {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 15)
  const t0 = Date.now()
  assert.equal(await confirmViaWallet({ lookup: async () => 'pending', paymentHash: HASH, deadlineMs: 5000, intervalMs: 10, signal: ctrl.signal }), 'unknown')
  assert.ok(Date.now() - t0 < 1000)
})
await ok('no lookup or no hash is unknown without a call', async () => {
  assert.equal(await confirmViaWallet({ lookup: null, paymentHash: HASH }), 'unknown')
  assert.equal(await confirmViaWallet({ lookup: async () => 'settled', paymentHash: '' }), 'unknown')
})

console.log('\nconfirmLegSettled (fetch stubbed for LUD-21)')
const realFetch = globalThis.fetch
let verifyCalls = 0
let verifyAnswer = { settled: false }
globalThis.fetch = async (url) => {
  verifyCalls++
  assert.ok(String(url).startsWith('https://verify.example/'), `only the verify URL is fetched, got ${url}`)
  return new Response(JSON.stringify(verifyAnswer), { status: 200, headers: { 'content-type': 'application/json' } })
}
try {
  await ok('the wallet settles a keysend leg with no verify URL', async () => {
    verifyCalls = 0
    const res = await confirmLegSettled({ paymentHash: HASH }, { deadlineMs: 500, intervalMs: 5, lookup: async () => 'settled' })
    assert.equal(res, 'settled')
    assert.equal(verifyCalls, 0)
  })
  await ok('LUD-21 settles the leg when the wallet cannot look up', async () => {
    verifyCalls = 0
    verifyAnswer = { settled: true }
    const res = await confirmLegSettled({ paymentHash: HASH, verifyUrl: 'https://verify.example/x' }, { deadlineMs: 500, intervalMs: 5, lookup: async () => 'unsupported' })
    assert.equal(res, 'settled')
    assert.ok(verifyCalls >= 1)
  })
  await ok('⚠️ the wallet\'s failed is returned, and LUD-21 cannot produce one', async () => {
    verifyAnswer = { settled: false }
    assert.equal(await confirmLegSettled({ paymentHash: HASH, verifyUrl: 'https://verify.example/x' }, { deadlineMs: 300, intervalMs: 5, lookup: async () => 'failed' }), 'failed')
    assert.equal(await confirmLegSettled({ paymentHash: HASH, verifyUrl: 'https://verify.example/x' }, { deadlineMs: 60, intervalMs: 5, lookup: async () => 'pending' }), 'unknown')
    assert.equal(await confirmLegSettled({ paymentHash: HASH, verifyUrl: 'https://verify.example/x' }, { deadlineMs: 60, intervalMs: 5, lookup: null }), 'unknown')
  })
  await ok('WebLN (no lookup) with no verify URL is unknown without a call', async () => {
    verifyCalls = 0
    assert.equal(await confirmLegSettled({ paymentHash: HASH }, { deadlineMs: 500, lookup: null }), 'unknown')
    assert.equal(verifyCalls, 0)
  })
  await ok('a leg with no payment hash is unknown', async () => {
    assert.equal(await confirmLegSettled({ verifyUrl: 'https://verify.example/x' }, { lookup: async () => 'settled' }), 'unknown')
  })
  await ok('the caller\'s abort ends both sides', async () => {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 15)
    const t0 = Date.now()
    assert.equal(await confirmLegSettled({ paymentHash: HASH, verifyUrl: 'https://verify.example/x' }, { deadlineMs: 5000, intervalMs: 10, signal: ctrl.signal, lookup: async () => 'pending' }), 'unknown')
    assert.ok(Date.now() - t0 < 1000)
  })
  await ok('legIsCheckable: a verify URL suffices; otherwise it is the wallet\'s call (none in Node)', () => {
    assert.equal(legIsCheckable({ paymentHash: HASH, verifyUrl: 'https://verify.example/x' }), true)
    assert.equal(legIsCheckable({ paymentHash: HASH, verifyUrl: 'http://verify.example/x' }), false)
    assert.equal(legIsCheckable({ verifyUrl: 'https://verify.example/x' }), false)
    assert.equal(legIsCheckable({ paymentHash: HASH }), false)
  })
} finally {
  globalThis.fetch = realFetch
}

// ─── The other-wallet invoice (requestLegInvoice) ──────────────────────────
// The recipient's two LNURL endpoints and the site's descriptor endpoint are
// stubbed; everything between them is the shipped code. 21 sats is
// `lnbc210n`, which fetchLnurlInvoice checks against the amount it asked for.
console.log('\nrequestLegInvoice (the invoice behind the QR code)')
const INVOICE = 'lnbc210n1p' + 'q'.repeat(60)
const realDebug = console.debug
console.debug = () => {}
const seen = { descriptor: null, callback: null, urls: [] }
let callbackAnswer = { pr: INVOICE, verify: 'https://pay.example/verify/x' }
let metaAnswer = { callback: 'https://pay.example/cb', minSendable: 1000, maxSendable: 100000000000, commentAllowed: 300, tag: 'payRequest', metadata: '[]' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, init) => {
  const u = String(url)
  seen.urls.push(u)
  if (u === '/api/boostbox') {
    seen.descriptor = JSON.parse(init.body)
    return json({ url: 'https://boostbox.example/d/1' })
  }
  if (u === 'https://pay.example/.well-known/lnurlp/alice') return json(metaAnswer)
  if (u.startsWith('https://pay.example/cb')) {
    seen.callback = new URL(u).searchParams
    return json(callbackAnswer)
  }
  throw new Error(`unexpected fetch: ${u}`)
}
const ALICE = { type: 'lnaddress', address: 'alice@pay.example', name: 'Alice', splitWeight: 2 }
const BOOST = { uuid: '11111111-2222-4333-8444-555555555555', totalSats: 1000, totalWeight: 100 }
const ask = (over = {}) => requestLegInvoice({
  recipient: ALICE, sats: 21, message: 'great episode', senderName: 'Reed', senderPubkey: null,
  meta: { showTitle: 'A Show', episodeTitle: 'An Episode', podcastGuid: 'feed-guid', itemGuid: 'item-guid' },
  donation: false, lnurlCache: {}, boost: BOOST, ...over,
})
try {
  await ok('it answers the invoice, its verify URL and (when readable) its payment hash', async () => {
    const got = await ask()
    assert.equal(got.invoice, INVOICE)
    assert.equal(got.verifyUrl, 'https://pay.example/verify/x')
    assert.ok(got.paymentHash === null || /^[0-9a-f]{64}$/.test(got.paymentHash))
    assert.equal(seen.callback.get('amount'), '21000')
  })
  await ok('⚠️ the descriptor files the split under the BOOST, not as a 21-sat boost of its own', async () => {
    seen.descriptor = null
    await ask()
    assert.equal(seen.descriptor.value_msat, 21000)
    assert.equal(seen.descriptor.value_msat_total, 1000000, 'the total the donor typed')
    assert.equal(seen.descriptor.group, BOOST.uuid, 'the id every other split of this boost carried')
    assert.equal(seen.descriptor.split, 2, 'the declared share of 100, not 100%')
    assert.equal(seen.descriptor.recipient_address, 'alice@pay.example')
    assert.equal(seen.descriptor.message, 'great episode')
    assert.equal(seen.descriptor.feed_title, 'A Show')
    assert.equal(seen.descriptor.remote_item_guid, 'item-guid')
  })
  await ok('the comment the recipient is sent leads with that descriptor, then the message', async () => {
    await ask()
    assert.equal(seen.callback.get('comment'), 'rss::payment::boost https://boostbox.example/d/1 great episode')
  })
  await ok('with no boost handed in it stands alone, which is the old behaviour and no crash', async () => {
    seen.descriptor = null
    await ask({ boost: null })
    assert.equal(seen.descriptor.value_msat_total, 21000)
    assert.match(seen.descriptor.group, /^[0-9a-f-]{36}$/)
    assert.notEqual(seen.descriptor.group, BOOST.uuid)
  })
  await ok('a provider with no verify URL answers null, which the modal reads as unwatchable', async () => {
    callbackAnswer = { pr: INVOICE }
    assert.equal((await ask()).verifyUrl, null)
    callbackAnswer = { pr: INVOICE, verify: 'https://pay.example/verify/x' }
  })
  await ok('a donation carries no descriptor', async () => {
    seen.descriptor = null
    await ask({ donation: true })
    assert.equal(seen.descriptor, null)
    assert.equal(seen.callback.get('comment'), 'great episode')
  })
  await ok('⚠️ a split that pays a node has no invoice, and nothing is requested', async () => {
    seen.urls.length = 0
    await assert.rejects(ask({ recipient: { type: 'node', address: '02' + 'a'.repeat(64), name: 'Node' } }), /no Lightning address/)
    assert.equal(seen.urls.length, 0)
  })
  await ok('a split of nothing is refused before any request', async () => {
    seen.urls.length = 0
    await assert.rejects(ask({ sats: 0 }), /Nothing to pay/)
    assert.equal(seen.urls.length, 0)
  })
  await ok('⚠️ an invoice for a different amount is refused, not put on screen', async () => {
    callbackAnswer = { pr: 'lnbc2100n1p' + 'q'.repeat(60) }
    await assert.rejects(ask())
    callbackAnswer = { pr: INVOICE, verify: 'https://pay.example/verify/x' }
  })
  await ok('a split under the recipient\'s minimum says so', async () => {
    metaAnswer = { ...metaAnswer, minSendable: 100000 }
    await assert.rejects(ask({ lnurlCache: {} }), /only takes payments of 100 sats or more, and this split came to 21\./)
    metaAnswer = { ...metaAnswer, minSendable: 1000 }
  })

  // ─── Where a split failed, and whether anything can change it ────────────
  // 2026-11-11, Reed's report: a 16-sat split to an address publishing
  // `maxSendable: 0` carried a Retry and a "Pay this split from another
  // wallet" button, and neither did anything he could see, because both hit
  // the same refusal off the same metadata. The modal reads two fields off
  // the failed leg to decide what to offer; this runs the shipped
  // payExternalBoost against a stand-in browser-extension wallet to pin what
  // sets them. The modal's half is a text scan in test-boost-modal-render.
  console.log('\npayExternalBoost: a split that failed before any invoice')
  const realInfo = console.info
  console.info = () => {}
  const paid = []
  let walletAnswer = async () => ({ preimage: 'a'.repeat(64) })
  globalThis.window = {
    webln: {
      enable: async () => {},
      getInfo: async () => ({ node: { alias: 'stub' } }),
      sendPayment: async (invoice) => { paid.push(invoice); return walletAnswer(invoice) },
    },
  }
  await wallet.connectWebln(null)
  const run = async () => {
    paid.length = 0
    let last = null
    await payExternalBoost({
      recipients: [ALICE], totalWeight: 2, totalSats: 21, message: 'm', senderName: 'Reed', senderPubkey: null,
      meta: { showTitle: 'A Show', episodeTitle: 'An Episode', podcastGuid: 'feed-guid', itemGuid: 'item-guid' },
      donation: false, lnurlCache: {}, boost: BOOST,
      onLeg: (_i, leg) => { last = leg },
    })
    return last
  }
  const WORKING = { ...metaAnswer }
  try {
    await ok('a split that pays is neither', async () => {
      const leg = await run()
      assert.equal(leg.status, 'paid')
      assert.equal(leg.noInvoice, false)
      assert.equal(leg.unpayable, null)
      assert.equal(paid.length, 1)
    })
    await ok('⚠️ Reed\'s case: a maximum of zero is a closed address, and the wallet is never asked', async () => {
      metaAnswer = { ...WORKING, minSendable: 1000, maxSendable: 0 }
      seen.callback = null
      const leg = await run()
      assert.equal(leg.status, 'failed')
      assert.equal(leg.unpayable, 'closed')
      assert.equal(leg.noInvoice, true)
      assert.match(leg.error, /not accepting payments right now/)
      assert.match(leg.error, /your wallet was never asked to pay it\.$/, 'whole, not clipped at 140 characters')
      assert.equal(/at most 0 sats/.test(leg.error), false, 'the sentence he was shown')
      assert.equal(paid.length, 0)
      assert.equal(seen.callback, null, 'no invoice is asked for either')
    })
    await ok('a maximum of zero is closed on its own, whatever the minimum says', async () => {
      metaAnswer = { ...WORKING, minSendable: 0, maxSendable: 0 }
      assert.equal((await run()).unpayable, 'closed')
    })
    await ok('a maximum under the minimum is the same closed address', async () => {
      metaAnswer = { ...WORKING, minSendable: 5000, maxSendable: 1000 }
      assert.equal((await run()).unpayable, 'closed')
    })
    await ok('an amount under a working range is `min`, over it `max`, and both name the figures', async () => {
      metaAnswer = { ...WORKING, minSendable: 100000 }
      let leg = await run()
      assert.equal(leg.unpayable, 'min')
      assert.match(leg.error, /100 sats or more, and this split came to 21\./)
      metaAnswer = { ...WORKING, maxSendable: 10000 }
      leg = await run()
      assert.equal(leg.unpayable, 'max')
      assert.match(leg.error, /at most 10 sats in one payment, and this split came to 21\./)
      assert.equal(leg.noInvoice, true)
      assert.equal(paid.length, 0)
    })
    await ok('a provider that refuses the invoice is `noInvoice` and NOT unpayable: a Retry may get one', async () => {
      metaAnswer = { ...WORKING }
      callbackAnswer = { status: 'ERROR', reason: 'Try again later' }
      const leg = await run()
      assert.equal(leg.status, 'failed')
      assert.equal(leg.noInvoice, true)
      assert.equal(leg.unpayable, null)
      assert.equal(paid.length, 0)
      callbackAnswer = { pr: INVOICE, verify: 'https://pay.example/verify/x' }
    })
    await ok('⚠️ a wallet that declines an invoice it was handed is neither: that is the split another wallet can pay', async () => {
      walletAnswer = async () => { throw new Error('User rejected') }
      const leg = await run()
      assert.equal(leg.status, 'failed')
      assert.equal(leg.noInvoice, false)
      assert.equal(leg.unpayable, null)
      assert.equal(paid.length, 1)
      walletAnswer = async () => ({ preimage: 'a'.repeat(64) })
    })
    await ok('the marks describe one attempt: the next run that gets its invoice sheds them', async () => {
      metaAnswer = { ...WORKING, maxSendable: 0 }
      assert.equal((await run()).unpayable, 'closed')
      metaAnswer = { ...WORKING }
      const leg = await run()
      assert.equal(leg.status, 'paid')
      assert.equal(leg.noInvoice, false)
      assert.equal(leg.unpayable, null)
    })
  } finally {
    console.info = realInfo
    metaAnswer = { ...WORKING }
    delete globalThis.window
  }
} finally {
  globalThis.fetch = realFetch
  console.debug = realDebug
}

console.log(`\ntest-payment-lookup: ${passed} passed`)
