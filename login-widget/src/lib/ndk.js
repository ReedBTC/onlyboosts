import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { withTimeout } from './utils.js'

// ⚠️ READING AND PUBLISHING ARE DIFFERENT JOBS AND WANT DIFFERENT RELAYS.
// This file held one list doing both, and the two questions have opposite
// shapes: a read set is asking "who HAS this event", which is measurable and
// where a useless relay costs latency on every query; a publish set is asking
// "who will SEE this event", where an extra relay costs one socket on an
// infrequent action and the cost of omitting one is invisible. So the read sets
// below are cut to what measurement supports and the publish set is generous.
//
// NDK's explicit pool. Its job here is IDENTITY READS ONLY — the signed-in
// user's kind 0 and their kind 10002. Measured 2026-08-12 over the 61 boosters
// behind the 100 most recent boosts: ditto answers 80% of kind 0, nos.lol 78%
// and 59% of kind 10002, and the two together cover 88% of profiles; mostr adds
// depth on both. relay.primal.net is out at 6% / 4% — that is the RELAY, not
// cache1.primal.net, which primal-profiles.js queries and which is unaffected.
//
// relay.fountain.fm is deliberately NOT here despite being the best relay on
// this site's audience for kind 1: it answered 0% for both kinds this pool
// reads. It is in PUBLISH_RELAYS instead, which is the whole point of the split.
export const FALLBACK_RELAYS = [
  'wss://relay.ditto.pub',
  'wss://nos.lol',
  'wss://relay.mostr.pub',
]

// Where a kind-1 boost share note goes. Reach, not coverage — see the header.
//
// Three groups. The well-connected generals (ditto, nos.lol, mostr) are how a
// note enters the network at large; measured 2026-08-12, a note published to
// them was retrievable from all three AND had been ingested into Primal's cache
// at cache1.primal.net, which is what Primal users actually read. The podcast
// relays (fountain, chadf, podtards, wavlake) are this note's actual audience,
// and the collector already reads boosts from them.
//
// ⚠️ relay.primal.net is here on judgement, NOT on measurement, and the
// distinction is worth keeping straight. The same note was ABSENT from it, and
// it held 0 of that author's kind-1s on a limit-200 query, so it is not how
// Primal users see anything — the cache ingests from the network regardless.
// It is one socket on an explicit action against a reach story nobody can
// measure from outside, which is the asymmetry above. Don't cite it as
// evidence that a low-scoring relay belongs in a READ set; it does not.
export const PUBLISH_RELAYS = [
  'wss://nos.lol',
  'wss://relay.ditto.pub',
  'wss://relay.mostr.pub',
  'wss://relay.primal.net',
  'wss://relay.fountain.fm',
  'wss://chadf.nostr1.com',
  'wss://podtards.com',
  'wss://relay.wavlake.com',
]

// NDK's outbox pool — the sockets it opens on its own to resolve a user's
// kind-10002 before publishing to their write relays. It is a SECOND pool,
// separate from explicitRelayUrls, and left unset it falls back to NDK's own
// hardcoded `DEFAULT_OUTBOX_RELAYS = ["wss://purplepag.es/", "wss://nos.lol/"]`.
//
// ⚠️ That default is why removing a relay from the lists in this repo is not
// enough to stop the browser dialing it: purplepag.es survived the 2026-08-11
// sweep in the built bundle, inside the library rather than in our source, and
// the outbox model is ON unless `enableOutboxModel: false` is passed. Naming
// the pair here is what actually retires it. Keep this a profile / relay-list
// set rather than a general one; resolving a kind-10002 is its only job.
//
// These two are the measured cover for that kind (2026-08-12): nos.lol answers
// 59% of our boosters' kind 10002 and ditto takes it to 63%, after which every
// other relay tested adds zero. 36% of boosters publish no kind 10002 anywhere,
// which is a fact about them rather than a gap this list can close.
const OUTBOX_RELAYS = [
  'wss://nos.lol',
  'wss://relay.ditto.pub',
]

/**
 * Relay set for publishing a kind-1 share note: PUBLISH_RELAYS unioned with
 * whatever is already in NDK's explicit pool.
 *
 * ⚠️ THE UNION IS THE POINT. A bare `ev.publish()` goes to the pool, and
 * `ensureUserWriteRelays` has already seeded that pool with the signed-in
 * user's NIP-65 write relays — so handing `publish()` a relay set built from
 * PUBLISH_RELAYS alone would REPLACE the pool and silently stop publishing to
 * the user's own relays. That is a regression no error surfaces: the note still
 * publishes, to the wrong audience, and the donor's followers never see it.
 * Reading the pool back is what keeps outbox publishing alive, and it is read
 * at call time because login happens after the module loads.
 *
 * `connect: true` so a relay named here but not yet dialled is opened rather
 * than skipped — several of these are in no read set and so are in no pool.
 */
export function publishRelaySet(ndk) {
  const urls = new Set(PUBLISH_RELAYS)
  for (const url of ndk?.pool?.relays?.keys() || []) {
    if (typeof url === 'string' && /^wss:\/\//i.test(url)) urls.add(url)
  }
  return NDKRelaySet.fromRelayUrls([...urls], ndk, true)
}

let ndkInstance = null

export function getNDK() {
  if (!ndkInstance) {
    ndkInstance = new NDK({
      explicitRelayUrls: FALLBACK_RELAYS,
      outboxRelayUrls: OUTBOX_RELAYS,
    })
  }
  return ndkInstance
}

// Kick off NDK's relay connections and wait for at least one to be ready.
// Prevents races where login completes before any relay handshake finishes —
// the next fetchEvent/publish would otherwise fail silently on mobile where
// WSS handshakes can take 1–3s each.
export async function connectAndWait(ndk, timeoutMs = 5000) {
  ndk.connect().catch(() => {})
  const start = Date.now()
  while (!ndk.pool.connectedRelays().length && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 100))
  }
}

export const SIGN_TIMEOUT_MS = 20000

// Remote signers (NIP-46 / bunker) round-trip the sign request through a
// relay, and the promise can hang indefinitely if the signer app is
// backgrounded or the connection died. Bound every sign call so the UI
// always reaches a terminal state — caller surfaces the message to the user.
export async function signWithTimeout(event, timeoutMs = SIGN_TIMEOUT_MS) {
  let timer
  try {
    await Promise.race([
      event.sign(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          'Signer timed out after 20s. If you\'re using a remote signer (bunker), check the signer app — the request may be waiting for approval, or the connection may have dropped.'
        )), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// Add the signed-in user's kind-10002 write relays to NDK's explicit pool.
// This is the outbox model (NIP-65): future kind 1 boost messages should
// publish to relays the user's followers actually read from.
//
// Safe to call multiple times; addExplicitRelay dedupes by URL. No-op if
// the user has no 10002 or the lookup times out.
export async function ensureUserWriteRelays(ndk, pubkey, { timeoutMs = 4000 } = {}) {
  if (!ndk || !pubkey) return []
  try {
    const relayListEvent = await withTimeout(
      ndk.fetchEvent({ kinds: [10002], authors: [pubkey] }),
      timeoutMs,
    )
    if (!relayListEvent) return []
    const writeRelays = (relayListEvent.tags || [])
      .filter(t => t[0] === 'r' && (!t[2] || t[2] === 'write'))
      .map(t => t[1])
      .filter(u => typeof u === 'string' && /^wss:\/\//i.test(u))
      // Cap at 16 to bound pool size. A user's 10002 with hundreds of
      // entries (poisoned or pathological) would otherwise flood the
      // pool with sockets we never close. NIP-65 reference implementations
      // typically cap around this number too.
      .slice(0, 16)
      // Reject userinfo-bearing URLs — same hygiene as
      // sessionPersistence.sanitizeRelayUrls.
      .filter(u => {
        try {
          const parsed = new URL(u)
          return !parsed.username && !parsed.password
        } catch { return false }
      })
    for (const url of writeRelays) {
      try { ndk.addExplicitRelay(url) } catch {}
    }
    return writeRelays
  } catch {
    return []
  }
}

// Tear down relays + signer and force a fresh NDK on next login.
export function resetNDK() {
  if (ndkInstance) {
    try {
      if (ndkInstance.signer?.stop) ndkInstance.signer.stop()
      ndkInstance.signer = undefined
      for (const relay of ndkInstance.pool?.relays?.values() || []) {
        relay.disconnect()
      }
    } catch {}
  }
  ndkInstance = null
}
