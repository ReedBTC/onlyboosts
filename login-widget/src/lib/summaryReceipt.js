/**
 * Mint the summary receipt for a boost: the ONE kind 9735 the note quotes.
 *
 * The sender signs a kind 9734 for the sats the boost actually paid, addressed
 * to the bot's key; `/api/sign-receipt` derives and signs the 9735; this
 * publishes it and hands back the quote the note builder writes. Why a receipt
 * for the total exists at all, and what it does and does not claim, is at the
 * top of `assets/js/zap-receipt.js` (shared with the oracle, which is why it
 * is imported from the site tree the way `mention-search.js` is).
 *
 * ⚠️ NEVER THROWS AND NEVER HOLDS UP THE BOOST. Every failure — no signer, a
 * signer that declined, the oracle unconfigured (503), the counter spent
 * (429), no relay accepting — is `null`, and the note then quotes nothing. The
 * sats have already moved by the time this runs; a missing quote costs
 * Fountain's ⚡ figure and nothing else.
 *
 * FOR EVERY BOOST THAT POSTS TO NOSTR, on the same rule that picks the note's
 * signer. `as: 'self'` when the donor's key publishes the note: the donor signs
 * the 9734 (one more signer prompt) and the receipt's `P` names them. `as:
 * 'site'` when the note is bot-published (signed out, or Anonymous): the bot
 * authors the 9734 from a bounded spec, so the receipt's sender is the bot, as
 * the note's author is, and nothing names the person. A donation mints
 * nothing: it is not a boost and quotes nothing.
 *
 * `publish: false` is the pre-sign path. The modal signs the note BEFORE the
 * payment runs (two prompts back to back, `presignNote`), so the receipt has
 * to exist then too — but a receipt on the relays for sats that may never
 * settle is a fabricated record, so it is signed and HELD, and
 * `publishReceipt` puts it on the relays only when the pre-signed note is
 * about to publish, which is only when every leg paid the figure it names.
 */
import { PUBLISH_RELAYS } from './ndk.js'
import { signKindOneShareWithUser, publishSignedEvent } from './boostagram.js'
import { zapRequestTags, receiptQuote, BOOSTBOT_PUBKEY_HEX, SUMMARY_MAX_RELAYS } from '../../../assets/js/zap-receipt.js'

export const SIGN_RECEIPT_ENDPOINT = '/api/sign-receipt'
const TIMEOUT_MS = 12_000

/** The relays the receipt is bound for: the widget's publish set, wss only,
 *  at most the oracle's eight. Named in the 9734 so a reader of the receipt
 *  knows where its author expected it to be. */
export function receiptRelays() {
  return [...new Set(PUBLISH_RELAYS.filter((r) => typeof r === 'string' && r.startsWith('wss://')))].slice(0, SUMMARY_MAX_RELAYS)
}

async function askOracle(payload) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(SIGN_RECEIPT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      credentials: 'omit',
    })
    if (!resp.ok) return null
    const body = await resp.json().catch(() => null)
    const event = body?.event
    if (!event?.id || !event?.sig || event.kind !== 9735) return null
    return event
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @returns {Promise<null | { event, quote: { id, pubkey, relays }, relays }>}
 *   `event` is the signed receipt; `quote` is what the note builder takes;
 *   `relays` are the ones that ACCEPTED it (the targets when `publish` is
 *   false, since nothing has been sent yet).
 */
export async function mintSummaryReceipt({ paidSats, refs, as, publish = true }) {
  try {
    const sats = Math.floor(Number(paidSats))
    if (!Number.isFinite(sats) || sats <= 0) return null
    const relays = receiptRelays()
    if (relays.length === 0) return null
    const amountMsat = sats * 1000
    let payload
    if (as === 'self') {
      const request = await signKindOneShareWithUser({
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: zapRequestTags({ relays, amountMsat, recipientPubkey: BOOSTBOT_PUBKEY_HEX, refs }),
      })
      if (!request?.id || !request?.sig) return null
      payload = { request }
    } else {
      payload = { spec: { amountMsat, relays, refs: refs || {} } }
    }
    const event = await askOracle(payload)
    if (!event) return null
    if (!publish) {
      return { event, quote: { id: event.id, pubkey: event.pubkey, relays }, relays }
    }
    const landed = await publishReceipt(event)
    return landed ? { event, quote: landed, relays: landed.relays } : null
  } catch (e) {
    console.warn('[lb] summary receipt skipped', e?.message || e)
    return null
  }
}

/**
 * Put a signed receipt on the relays. Returns the quote with the relays that
 * accepted it, or null when none did: a receipt nobody holds is not worth
 * quoting, since the quote would point every reader at an empty answer.
 */
export async function publishReceipt(event) {
  try {
    const r = await publishSignedEvent(event)
    if (!r.published) return null
    return { id: event.id, pubkey: event.pubkey, relays: r.relays.slice(0, 3) }
  } catch {
    return null
  }
}

/** The quote's two halves, for a caller that already holds the quote. */
export { receiptQuote }
