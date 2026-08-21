/**
 * External-episode boost orchestrator.
 *
 * DELIBERATELY SEPARATE from lib/payAllLegs.js (the LB boost path, the site's
 * #1 feature — untouched). This runs a Podcasting-2.0 V4V boost to another
 * podcast's value-block recipients:
 *   - lnaddress legs → LNURL-pay (reusing boostagram.js's stable leaf helpers)
 *   - node legs      → keysend (NWC pay_keysend / WebLN keysend) carrying the
 *                      boostagram as TLV 7629169 + the recipient's customKey/
 *                      customValue for shared-node routing.
 *
 * Same best-effort model as payAllLegs: legs run sequentially (NWC reliability),
 * each in its own try/catch, and one failing leg never aborts the others — so a
 * wallet that can't keysend still pays the lnaddress legs (exactly how Boost Me
 * Bitch behaves). Never throws on partial failure; returns per-leg results.
 *
 * Wallet access is READ-ONLY against the existing facade: wallet.js for
 * status/payInvoice, nwc.getClient() for keysend, window.webln for WebLN
 * keysend. No wallet file is modified.
 */

import {
  fetchLnurlMeta,
  fetchLnurlInvoice,
  bolt11PaymentHash,
  confirmInvoiceSettled,
} from './boostagram.js'
import { withTimeout, isCleanPaymentDecline } from './utils.js'
import * as wallet from './wallet.js'
import * as nwc from './nwc.js'
import {
  buildBoostagram,
  toTlvHex,
  toWeblnRecords,
  randomPreimageHex,
  MAX_MESSAGE_CHARS,
} from './externalBoostagram.js'

export const STATUS = {
  PENDING: 'pending',
  PAYING: 'paying',
  PAID: 'paid',
  FAILED: 'failed',
  SKIPPED: 'skipped',     // leg's proportional share rounded to 0 sats
  UNCERTAIN: 'uncertain', // paid attempt gave no clean preimage and we can't confirm
}

// Leave-page guard. LB boosts get this from boostQueue's beforeunload
// handler, but external boosts run outside that queue — without their own
// counter, navigating away mid-boost silently interrupts unpaid legs.
// Same standard incantation as boostQueue's.
let activeBoosts = 0
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (activeBoosts === 0) return
    e.preventDefault()
    e.returnValue = ''
    return ''
  })
}

/**
 * Per-leg phase timing.
 *
 * A boost that churns gives no account of itself: the modal shows one spinner
 * per leg and the console shows nothing, so a slow leg is indistinguishable
 * from a slow LNURL host, a slow wallet relay and a slow wallet. Splitting the
 * leg into its phases is the difference between reasoning about which one it
 * was and reading it. `pay` is the NWC round trip — the request event out to
 * the wallet's relay and the wallet's reply back — and the wallet does not
 * reply until the payment has settled, so a large number there is the wallet
 * or the route, never this file.
 *
 * Unconditional console.info rather than a debug flag: a boost is a handful of
 * lines, it only runs on an explicit click, and the one time anyone wants
 * these is a boost that already happened.
 */
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function legTimer() {
  const start = now()
  let last = start
  const phases = []
  return {
    mark(name) {
      const t = now()
      phases.push(`${name} ${Math.round(t - last)}ms`)
      last = t
    },
    summary() {
      return { totalMs: Math.round(now() - start), phases: phases.join(', ') }
    },
  }
}

/** UUID4 tying every leg of one boost together (boostagram `uuid`). */
function uuid4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * Distribute whole sats across recipients by weight. Floors each share to a
 * whole sat (LNURL endpoints reject sub-sat amounts), then hands the leftover
 * sats out one at a time to the largest-weight legs so rounding never starves
 * the biggest recipient.
 */
function distributeSats(totalSats, recipients, totalWeight) {
  const legs = recipients.map((r, index) => ({
    recipient: r,
    index,
    sats: Math.floor((totalSats * r.splitWeight) / totalWeight),
  }))
  let remainder = totalSats - legs.reduce((a, l) => a + l.sats, 0)
  const byWeight = [...legs].sort((a, b) => b.recipient.splitWeight - a.recipient.splitWeight)
  let i = 0
  while (remainder > 0 && byWeight.length) { byWeight[i % byWeight.length].sats += 1; remainder--; i++ }
  return legs
}

function friendlyError(msg) {
  const s = String(msg || '')
  if (/not_implemented|not implemented|unsupported|method not found/i.test(s)) {
    return 'Your wallet doesn\'t support keysend payments. Try connecting Alby or Mutiny.'
  }
  if (/rejected|denied|declined/i.test(s)) return 'Payment declined in your wallet.'
  if (/insufficient|not enough|no funds|balance too low/i.test(s)) return 'Not enough balance in your wallet.'
  if (/expired/i.test(s)) return 'The invoice expired before it could be paid.'
  if (/no route|route not found|unable to find route/i.test(s)) return 'No payment route to this recipient.'
  return s.length > 140 ? s.slice(0, 140) + '…' : (s || 'Payment failed.')
}

// A clean decline means the payment definitively never left the wallet → safe
// to FAIL without a settlement round-trip. Anything else is ambiguous. On top
// of the shared classifier: keysend-capability errors (wallet can't keysend at
// all), which also mean nothing was sent.
function isCleanDecline(msg) {
  return isCleanPaymentDecline(msg) ||
    /not_implemented|not implemented|unsupported|method not found/i.test(String(msg || ''))
}

async function payLnaddressLeg(leg, ctx, update, timer) {
  // Prefer the modal's prefetched metadata over a fresh fetch. The modal
  // resolves every lnaddress recipient in parallel on mount, so by boost time
  // most legs already have theirs. A cache miss — or a null, which is what the
  // modal stores when its own fetch failed — falls through to a live fetch, so
  // this is a saving and never a dependency. Same arrangement as payAllLegs.
  let meta = ctx.lnurlCache?.[leg.recipient.address] || null
  if (!meta) meta = await fetchLnurlMeta(leg.recipient.address)
  timer?.mark('meta')
  const msats = leg.sats * 1000
  if (typeof meta.minSendable === 'number' && msats < meta.minSendable) {
    throw new Error(`This leg needs at least ${Math.ceil(meta.minSendable / 1000).toLocaleString()} sats — bump the boost.`)
  }
  if (typeof meta.maxSendable === 'number' && msats > meta.maxSendable) {
    throw new Error(`This leg accepts at most ${Math.floor(meta.maxSendable / 1000).toLocaleString()} sats.`)
  }
  const allowed = meta.commentAllowed || 0
  const comment = allowed > 0 ? (ctx.message || '').slice(0, Math.min(allowed, MAX_MESSAGE_CHARS)) : ''
  const { pr, verify } = await fetchLnurlInvoice(meta.callback, msats, comment, leg.recipient.address)
  timer?.mark('invoice')
  const paymentHash = bolt11PaymentHash(pr)
  update({ verifyUrl: verify || null, paymentHash })

  // ⚠️ `startedAt` is stamped where the WAIT actually is: the moment the wallet
  // is handed the invoice. Measured on a real boost, 2026-08-19, one leg spent
  // **45.5 seconds inside `sendPayment`** while its two siblings took 2.3s and
  // 0.4s through the same extension. Nothing here can hurry that or observe
  // progress inside it, so the only honest thing to do is say how long it has
  // been going. See PAY_STAGES in ExternalBoostModal.
  update({ status: STATUS.PAYING, startedAt: Date.now() })
  let preimage = null
  let payError = null
  try {
    const res = await ctx.wal.payInvoice({ invoice: pr })
    preimage = res?.preimage || null
  } catch (e) { payError = e }
  timer?.mark('pay')

  if (preimage) return { status: STATUS.PAID }

  const msg = String(payError?.message || payError || '')
  if (isCleanDecline(msg)) return { status: STATUS.FAILED, error: friendlyError(msg) }

  // Ambiguous — never blind-fail an NWC leg (the reply can be lost while the
  // payment settles). Confirm via LUD-21 before deciding.
  //
  // ⚠️ A NON-SETTLEMENT IS NOT A FAILURE. Once the wallet has been handed this
  // invoice there is no observation that proves it did not pay, so the only
  // outcomes here are PAID and UNCERTAIN. The modal keeps polling this leg in
  // the background and flips it to PAID if it lands late; until then it offers
  // "Check again" and NOT a re-pay. See confirmInvoiceSettled.
  const settled = await confirmInvoiceSettled(verify, paymentHash)
  timer?.mark('verify')
  if (settled === 'settled') return { status: STATUS.PAID }
  // ⚠️ This is the leg's RESTING message, not its waiting message. The modal
  // starts a background watch on every checkable leg and suppresses this text
  // for as long as that runs (see CHECK_STAGES in ExternalBoostModal), so what
  // this string has to serve is the leg nothing is watching: a keysend, or a
  // provider that returned no verify URL. It must therefore not claim that
  // checking is under way, which the previous wording did.
  return { status: STATUS.UNCERTAIN, error: 'Not confirmed yet. Don’t re-send it — it may already be on its way.' }
}

async function payKeysendLeg(leg, ctx, update, timer) {
  const boostagram = buildBoostagram({
    legMsats: leg.sats * 1000,
    totalMsats: ctx.totalSats * 1000,
    message: ctx.message,
    senderName: ctx.senderName,
    senderPubkey: ctx.senderPubkey,
    recipientName: leg.recipient.name,
    boostUuid: ctx.boostUuid,
    ...ctx.meta,
  })

  update({ status: STATUS.PAYING, startedAt: Date.now() })
  try {
    if (ctx.kind === 'nwc') {
      const client = nwc.getClient()
      const res = await client.payKeysend({
        amount: leg.sats * 1000,           // msats
        pubkey: leg.recipient.address,     // node pubkey
        preimage: randomPreimageHex(),
        tlv_records: toTlvHex(boostagram, leg.recipient),
      })
      if (res?.preimage) return { status: STATUS.PAID }
      // No preimage but no throw — we supplied one, so it likely settled, but
      // there's no verify URL for keysend. Don't claim success we can't prove.
      return { status: STATUS.UNCERTAIN, error: 'Couldn’t confirm this keysend — check your wallet.' }
    }
    // WebLN keysend — amount in SATS, plain-string custom records.
    // Bounded like webln.payInvoice: a wedged extension (broken worker,
    // unrendered approval popup) otherwise hangs this promise forever and
    // the external boost modal spins on "paying" with no exit. Generous
    // 90s because keysend can legitimately block on a human approving a
    // popup. On timeout we land in the catch below, where a non-clean-
    // decline message maps to UNCERTAIN — never a "wasn't charged" claim.
    if (!window.webln) throw new Error('No WebLN provider')
    const res = await withTimeout(
      Promise.resolve(window.webln.keysend({
        destination: leg.recipient.address,
        amount: leg.sats,
        customRecords: toWeblnRecords(boostagram, leg.recipient),
      })),
      90000,
      'Your wallet extension didn\'t respond to the keysend in time. It may still be going through — check your wallet before retrying.',
    )
    if (res?.preimage) return { status: STATUS.PAID }
    return { status: STATUS.UNCERTAIN, error: 'Couldn’t confirm this keysend — check your wallet.' }
  } catch (e) {
    const msg = String(e?.message || e)
    if (isCleanDecline(msg)) return { status: STATUS.FAILED, error: friendlyError(msg) }
    return { status: STATUS.UNCERTAIN, error: friendlyError(msg) }
  } finally {
    // finally, not a mark per return: the try/catch has six of them, and a
    // keysend has no phase before the payment to separate out anyway.
    timer?.mark('pay')
  }
}

/**
 * Run an external boost.
 *
 * @param {object} p
 * @param {Array}  p.recipients   - [{ name, type:'node'|'lnaddress', address, splitWeight, customKey?, customValue? }]
 * @param {number} p.totalWeight
 * @param {number} p.totalSats
 * @param {string} [p.message]
 * @param {string} [p.senderName]
 * @param {string} [p.senderPubkey] - hex pubkey when signed in
 * @param {object} p.meta          - { showTitle, episodeTitle, podcastGuid, itemGuid, url }
 * @param {object} [p.lnurlCache]  - { [lnaddress]: lnurlMeta|null } prefetched by
 *                                   the modal on mount. Optional in both
 *                                   directions: a missing entry, a null entry
 *                                   and no cache at all all fall through to a
 *                                   live fetch inside the leg.
 * @param {(index:number, patch:object)=>void} [p.onLeg]
 * @returns {Promise<{legs:Array, anyPaid:boolean, paidSats:number}>}
 */
export async function payExternalBoost({
  recipients, totalWeight, totalSats, message, senderName, senderPubkey, meta, lnurlCache, onLeg,
}) {
  if (!wallet.isReady()) throw new Error('Connect a wallet first')
  if (!Array.isArray(recipients) || recipients.length === 0) throw new Error('No recipients to pay')
  if (!(totalSats > 0)) throw new Error('Enter a boost amount')

  const kind = wallet.getStatus().kind
  const wal = wallet.getActiveWallet()
  const boostUuid = uuid4()
  const ctx = { kind, wal, message, senderName, senderPubkey, totalSats, boostUuid, meta, lnurlCache }

  const legs = distributeSats(totalSats, recipients, totalWeight).map((l) => ({
    ...l, status: STATUS.PENDING, error: null, paymentHash: null, verifyUrl: null,
  }))

  activeBoosts++
  const startedAt = now()
  try {
    for (const leg of legs) {
      const update = (patch) => { Object.assign(leg, patch); onLeg?.(leg.index, { ...leg }) }

      if (leg.sats <= 0) {
        update({ status: STATUS.SKIPPED })
        // Logged despite having nothing to time, so the console carries one
        // line per leg and a missing number never has to be accounted for.
        console.info(`[lb-boost] leg ${leg.index + 1}/${legs.length} ${leg.recipient.address} → skipped (0 sats)`)
        continue
      }

      const timer = legTimer()
      try {
        const result = leg.recipient.type === 'lnaddress'
          ? await payLnaddressLeg(leg, ctx, update, timer)
          : await payKeysendLeg(leg, ctx, update, timer)
        update(result)
      } catch (e) {
        // Pre-payment failures (LNURL resolve, below-min, invoice fetch) are
        // definitively not-paid, and today that is everything that reaches
        // here — nothing throws out of the leg helpers once they have asked a
        // wallet to pay.
        //
        // ⚠️ BUT THAT IS AN ARGUMENT ABOUT TODAY'S CALL GRAPH, AND THE COST OF
        // IT BECOMING UNTRUE IS A RECIPIENT PAID TWICE. `paymentHash` is set
        // the moment an invoice exists, so it is the structural test for
        // "something may be in flight": past that point an exception is
        // ignorance, not evidence, and the leg is UNCERTAIN — which carries no
        // re-pay button. Same rule as confirmInvoiceSettled.
        // ⚠️ A REASON FROM THE RECIPIENT'S OWN SERVER IS USED VERBATIM AND
        // ATTRIBUTED, never run through friendlyError. That function rewrites
        // on keywords — a provider whose message happens to contain "declined"
        // or "expired" would be reported to the donor as *their wallet*
        // declining, which is a lie about whose fault it is and sends them to
        // check the wrong thing.
        const detail = e?.lnurlReason
          ? `Their Lightning provider said: ${e.lnurlReason}`
          : friendlyError(e?.message || e)
        update(leg.paymentHash
          ? { status: STATUS.UNCERTAIN, error: detail }
          : { status: STATUS.FAILED, error: detail })
      }
      const { totalMs, phases } = timer.summary()
      // Address rather than name: `name` is empty on most value blocks (the
      // show's own leg usually carries none), and the address is public data
      // straight out of the feed either way.
      console.info(
        `[lb-boost] leg ${leg.index + 1}/${legs.length} ${leg.recipient.type} ` +
        `${leg.recipient.address} ${leg.sats} sats → ${leg.status} in ${totalMs}ms` +
        (phases ? ` (${phases})` : ''),
      )
    }
  } finally {
    activeBoosts--
  }

  const paidLegs = legs.filter((l) => l.status === STATUS.PAID)
  console.info(
    `[lb-boost] ${legs.length} legs via ${kind} in ${Math.round(now() - startedAt)}ms: ` +
    `${paidLegs.length} paid, ${paidLegs.reduce((a, l) => a + l.sats, 0)} of ${totalSats} sats`,
  )
  return {
    legs,
    anyPaid: paidLegs.length > 0,
    paidSats: paidLegs.reduce((a, l) => a + l.sats, 0),
  }
}
