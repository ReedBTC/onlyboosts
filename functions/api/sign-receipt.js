/**
 * The second signing oracle for the bot identity, beside `/api/sign-boost`.
 *
 * It signs ONE shape: a kind 9735 "summary receipt" for the sats a boost
 * actually paid, derived here from a kind 9734. Two ways in, one set of rules:
 *
 *   { request }  the SENDER signed the 9734 — a note the donor's key publishes.
 *                The receipt's `P` names them, as the note's author does.
 *   { spec }     the note is bot-published (signed out, or Anonymous), so the
 *                bot authors the 9734 too, from three bounded facts: amount,
 *                relays, refs. The receipt's sender is then the bot, as the
 *                note's author is; a user-signed request would name the user,
 *                which is exactly what Anonymous refuses.
 *
 * The client never hands over receipt tags. That is what bounds this oracle:
 * a caller can make the bot attest a payment from their OWN key, or an
 * anonymous one from the bot's — the same claims a boost note already lets
 * them make through `/api/sign-boost` — and nothing else: not a payment from
 * someone else's key, not a quote of any note, not a line of prose. Both ways
 * pass the same `validateSummaryRequest` before anything is signed as a
 * receipt. The reasoning, and why the receipt carries no bolt11, is at the
 * top of `assets/js/zap-receipt.js` and in *The Note Quotes One Receipt* in
 * docs/money-paths.md.
 *
 * ⚠️ IT CANNOT VERIFY THAT ANYTHING WAS PAID, for the reasons written at
 * `/api/sign-boost`, and it does not try. NIP-57 says a receipt "is not a
 * proof of payment ... you are trusting the author"; this receipt's author is
 * the same bot key that already signs boost notes on the browser's word, and
 * it attests nothing a note from that key does not already attest.
 *
 * Same protections as sign-boost, in the same order: the two bindings or 503,
 * the per-IP KV counter (its own window, `sign-receipt:`, because a bot-route
 * boost now makes one call to each oracle), JSON, validation, then the
 * signature check. The browser publishes the result; this never touches a
 * relay.
 */
import { finalizeEvent, getPublicKey, verifyEvent } from '../_shared/nostr-sign.js'
import { secretKeyFrom, overRateLimit } from './sign-boost.js'
import {
  validateSummaryRequest, summaryRequestTemplateFromSpec, summaryReceiptTemplate,
} from '../../assets/js/zap-receipt.js'

function bad(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export async function onRequestPost({ request, env }) {
  const sk = secretKeyFrom(env.BOOSTBOT_NSEC)
  if (!sk) return bad('site signing identity not configured', 503)
  const kv = env.SIGN_RATELIMIT
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return bad('site signing identity not configured', 503)
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  try {
    if (await overRateLimit(kv, ip, Date.now(), 'sign-receipt')) return bad('too many requests', 429)
  } catch {
    return bad('site signing identity not configured', 503)
  }

  let body
  try { body = await request.json() } catch { return bad('invalid JSON') }
  if (!body || typeof body !== 'object') return bad('bad request')

  const site = getPublicKey(sk)
  const now = Math.floor(Date.now() / 1000)
  let input = body.request
  if (input === undefined && body.spec !== undefined) {
    // The bot authors the request. Built by the shared module, signed here,
    // and then validated below exactly as a sender-signed one is — one gate.
    const template = summaryRequestTemplateFromSpec(body.spec, site, now)
    if (!template) return bad('bad spec')
    input = finalizeEvent(template, sk)
  }
  const checked = validateSummaryRequest(input, site, now)
  if (!checked.ok) return bad(checked.reason)
  // The shape is right; now the signature. `verifyEvent` recomputes the id
  // from the seven fields and checks the sig against `pubkey`, so a request
  // whose `P` will name the sender is one that sender really signed — and a
  // bot-authored one is one this process just signed.
  let verified = false
  try { verified = verifyEvent(checked.request) } catch { verified = false }
  if (!verified) return bad('bad signature')

  const event = finalizeEvent(summaryReceiptTemplate(checked.request, site, now), sk)
  return new Response(JSON.stringify({ event }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

// Only POST, as with sign-boost: a GET falls through to the asset handler and
// answers 404, which is an honest answer for a path that only exists for POST.
