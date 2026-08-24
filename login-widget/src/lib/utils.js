// Race a promise against a timeout. Rejects with the given label if the
// inner promise hasn't settled in `ms` milliseconds. Used for relay fetches
// and signer round-trips that can otherwise hang indefinitely.
export function withTimeout(promise, ms, label = 'timeout') {
  let timer
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(label)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

// Checks if a URL uses a safe protocol (http/https only).
// Blocks javascript:, data:, vbscript:, etc. — used as a guard before
// rendering user-supplied URLs as <img src> or <a href>.
export function isSafeUrl(url) {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * ⚠️ THE WALLET'S OWN NIP-47 FAILURE CODES, WHICH THE PROSE PATTERNS BELOW MISS
 * ON A TECHNICALITY: THEY LOOK FOR `no route` AND NIP-47 SAYS `NO_ROUTE`.
 *
 * Observed on a real boost, 2026-08-22: an upgraded keysend leg to
 * `podcastindex@getalby.com` came back `Nip47WalletError:
 * FAILURE_REASON_NO_ROUTE` — the node that address names has no public channel
 * record. One underscore, and a provably-clean refusal read as ambiguous.
 *
 * ⚠️ IT LIVES HERE RATHER THAN IN ONE CALLER, AND THAT IS THE FIX. It was a
 * local constant in `externalBoost.js` from 2026-08-22 to 2026-08-24, on the
 * reasoning that the other two readers of this classifier were dead or safe.
 * Half of that was wrong: `payAllLegs.js` is genuinely unreachable, but
 * `payInvoiceVerified` in index.jsx is the live zap path, and there the miss
 * cost a user the manual-invoice fallback after a payment that provably never
 * happened. A shared classifier with one caller's knowledge bolted onto that
 * caller is the drift this comment block already warned about.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT IN THIS LIST IS THE WHOLE OF ITS SAFETY.
 * `FAILURE_REASON_TIMEOUT` means the attempt ran out of time, and an HTLC in
 * flight when the clock expired can still settle; `FAILURE_REASON_ERROR` is a
 * catch-all and says nothing about settlement. Both stay ambiguous, and so does
 * anything not named here. **Only add a code whose meaning is that no HTLC
 * survived** — every caller of this function treats a true answer as licence to
 * offer the money path again.
 */
const WALLET_CLEAN_FAILURE_RE =
  /FAILURE_REASON_(NO_ROUTE|INSUFFICIENT_BALANCE|INCORRECT_PAYMENT_DETAILS)/i

// True when a wallet error message means the payment definitively never
// left the wallet — the user hit Reject in their extension, no balance,
// expired invoice, no route. Safe to report as failed/unsettled without a
// settlement round-trip. Anything else (timeout, lost reply, generic
// error) is ambiguous and must go through LUD-21 verification instead.
// Shared by payAllLegs, payInvoiceVerified, and the external boost path
// so the three classifiers can't drift.
//
// Deliberately does NOT match bare "cancel"/"cancelled": some wallets use
// it for requests that may already be in flight, which is exactly the
// ambiguous case the verify path exists for.
export function isCleanPaymentDecline(msg) {
  const s = String(msg || '')
  return /rejected|denied|declined|insufficient|not enough|no funds|balance too low|expired|no route|unable to find route|route not found/i.test(s) ||
    WALLET_CLEAN_FAILURE_RE.test(s)
}

// Strip NWC connection strings (and any bare `secret=...` query
// values) from a string before logging it. @getalby/sdk and other
// wallet libs occasionally embed the offending input verbatim in
// `Error.message`, which then lands in the browser console — visible
// to any extension with `tabs` permission and included in user-pasted
// bug reports. The NWC URI is a bearer credential; one leak is enough.
//
// Intentionally aggressive: matches `nostr+walletconnect://...` and
// any standalone `secret=<hex>` substring, even outside a full URI.
export function scrubSecrets(s) {
  if (typeof s !== 'string' || !s) return s
  return s
    .replace(/nostr\+walletconnect:\/\/[^\s"'`]+/gi, 'nostr+walletconnect://[REDACTED]')
    .replace(/secret=[A-Za-z0-9+/=_-]+/gi, 'secret=[REDACTED]')
}
