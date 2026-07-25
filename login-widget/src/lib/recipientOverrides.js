import { nip19 } from 'nostr-tools'
import { getNDK } from './ndk.js'

/**
 * Per-host substitutions applied to RSS-derived split recipients before
 * any LNURL fetch, payment, or kind 30078 publish.
 *
 * ⚠️  EMPTY ON ONLYBOOSTS, DELIBERATELY — think hard before adding one.
 *
 * An override silently reroutes sats away from the address a show's own
 * RSS value block names, at the donor's client, without telling either
 * party. On localbitcoiners that was defensible: it was Reed's own show,
 * rerouting his own feed's 2% Fountain-tooling leg to his own address.
 *
 * OnlyBoosts boosts *other people's* podcasts. An entry here would divert
 * money from third-party shows that never agreed to it — so the LB entry
 * (`boostbot@fountain.fm` → `aquafox30@primal.net`) was removed on fork
 * rather than carried over. Only add an override for a feed OnlyBoosts
 * itself owns.
 *
 * Keyed by source lud16; values replace the matching recipient's
 * `name` and `address` while preserving the original split weight.
 *
 * Merge semantics:
 *   When the override target address is *already* a recipient in the
 *   current splits, the two legs are merged into one with combined
 *   weight. Avoids paying the same address twice in one boost (extra LN
 *   fees, two kind 30078 events for the same recipient).
 *
 * Audit note: any address listed here is a *redirect at the donor's
 * client*. The kind 30078 `recipient` tag will reflect the redirected
 * address, so a recipient bot watching the override target sees a
 * normal leg with no special signaling. The original RSS recipient
 * never sees the payment.
 */
export const LNADDRESS_OVERRIDES = {}

/**
 * Lightning addresses whose recipients run a boost bot that cares about
 * kind 30078 metadata events. For every other recipient — Fountain,
 * Albyhub end users, third-party show addresses — the kind 30078 publish
 * is skipped: they don't subscribe to our boost relays for it, so it
 * would just be relay noise.
 *
 * Boosts to addresses in this set:
 *   - Always publish a kind 30078 (so the bot has a record).
 *   - When the donor is signed in and attributed, the event is signed
 *     with their real Nostr key for cryptographic provenance the bot
 *     can verify; if the signer rejects or times out, the modal falls
 *     back to a single-use burner key so the boost still goes through.
 *   - In anonymous mode, the event is burner-signed.
 *
 * Address comparison is case-insensitive — lud16 is technically
 * case-sensitive but in practice every Lightning wallet treats it as
 * insensitive, and a stray uppercase from RSS shouldn't cause us to
 * miss the metadata publish.
 */
export const META_PUBLISH_ALLOWLIST = new Set([
  'onlyboosts@getalby.com',
])

export function shouldPublishMetadata(address) {
  if (typeof address !== 'string' || !address) return false
  return META_PUBLISH_ALLOWLIST.has(address.toLowerCase())
}

/**
 * Apply the override map to a recipient list. Pure — returns a new
 * array; original is unmodified.
 *
 * Two passes implicit in one loop:
 *   1. Apply the address/name override (or pass through if none).
 *   2. If the post-override address is already in `out`, merge weights
 *      into the existing entry rather than appending a duplicate.
 */
export function applyRecipientOverrides(recipients) {
  if (!Array.isArray(recipients)) return recipients
  const out = []
  const indexByAddress = new Map()  // post-override address → index in `out`

  for (const r of recipients) {
    if (!r || !r.address) {
      out.push(r)
      continue
    }
    const override = LNADDRESS_OVERRIDES[r.address] || null
    const next = override ? { ...r, ...override } : r

    const existingIdx = indexByAddress.get(next.address)
    if (existingIdx !== undefined) {
      // Merge into the existing entry. Preserve its name/address so
      // display doesn't flip to whatever-came-second's name. Sum the
      // weights — total stays correct, recipient gets one combined leg.
      const existing = out[existingIdx]
      out[existingIdx] = {
        ...existing,
        splitWeight: existing.splitWeight + (next.splitWeight || 0),
      }
      continue
    }

    indexByAddress.set(next.address, out.length)
    out.push(next)
  }
  return out
}

// ── type=node recipient resolution ──────────────────────────────────────────
//
// Podcast 2.0 value blocks can list a recipient as `type="node"` (a Lightning
// node pubkey paid via keysend) instead of `type="lnaddress"` (paid via LNURL).
// The browser boost flow only speaks LNURL — it has no keysend path, and many
// donor wallets can't keysend anyway — so a node recipient can't be paid
// directly. Rather than silently DROP it (which used to renormalize its split
// onto the other legs, so the node guest got nothing and the donor overpaid the
// rest), we try to redirect it to a Lightning address and otherwise mark it
// unpayable so the leg fails honestly without sending or crediting those sats.
//
// A Lightning node pubkey is NOT a Nostr pubkey, so we can't derive an npub
// from it. We can only look it up in the curated map below. From the npub we
// resolve that person's current lud16 off their kind-0 profile (so a profile
// address change is picked up automatically), then pay it as an ordinary
// lnaddress leg. Unmapped node recipients are marked unpayable.
//
// The `guestNpubs` sole-guest auto-match below is inherited from LB, where
// every non-host recipient was a guest named in the episode's
// `[guests: npub1...]` marker. OnlyBoosts boosts arbitrary third-party feeds
// that carry no such marker, so callers pass nothing and that path is inert.
// Don't guess an identity from an unrelated feed's metadata — a wrong guess
// sends someone else's sats to the wrong person.

// Curated Lightning-node-pubkey → npub map. Add an entry when a known
// person's node pubkey shows up as a type=node recipient.
export const NODE_RECIPIENT_NPUBS = {
  // Sir Spencer — Wolf of KC (BowlAfterBowl). node pubkey → his npub.
  '03ecb3ee55ba6324d40bea174de096dc9134cb35d990235723b37ae9b5c49f4f53':
    'npub1yvscx9vrmpcmwcmydrm8lauqdpngum4ne8xmkgc2d4rcaxrx7tkswdwzdu',
}

export const UNPAYABLE_NODE_REASON =
  "Browser boosts can only pay Lightning addresses, and this recipient is " +
  "listed as a keysend node. This leg was skipped — those sats weren't sent."

/** Resolve an npub (or nprofile) to its kind-0 lud16, or null. Never throws. */
async function resolveLud16ForNpub(npub) {
  try {
    const decoded = nip19.decode(npub)
    const hex = decoded.type === 'npub' ? decoded.data
              : decoded.type === 'nprofile' ? decoded.data.pubkey
              : null
    if (!hex) return null
    const profile = await getNDK().getUser({ pubkey: hex }).fetchProfile()
    const addr = profile?.lud16 || profile?.lightningAddress || null
    return (typeof addr === 'string' && addr.includes('@')) ? addr.trim() : null
  } catch {
    return null
  }
}

/**
 * Resolve every `type:'node'` recipient to a payable lnaddress leg, or flag it
 * unpayable. Async (it may fetch kind-0 profiles). Pure w.r.t. the input array
 * — returns a new list; lnaddress recipients pass through untouched.
 *
 * @param {Array} recipients   split recipients ({ name, address, splitWeight, type })
 * @param {string[]} guestNpubs  episode `[guests:]` npubs (for sole-guest auto-match)
 * @returns {Promise<Array>} recipients with nodes rewritten to lnaddress or
 *   marked `{ unpayable: true, unpayableReason }`.
 */
export async function resolveNodeRecipients(recipients, guestNpubs = []) {
  if (!Array.isArray(recipients)) return recipients
  const guests = (Array.isArray(guestNpubs) ? guestNpubs : []).filter(Boolean)
  const out = []
  for (const r of recipients) {
    if (!r || r.type !== 'node') { out.push(r); continue }
    // Curated map first; else auto-match only when the episode has exactly
    // one guest (unambiguous). Multi-guest + unmapped → unpayable.
    const npub = NODE_RECIPIENT_NPUBS[r.address] || (guests.length === 1 ? guests[0] : null)
    const lud16 = npub ? await resolveLud16ForNpub(npub) : null
    if (lud16) {
      out.push({ ...r, type: 'lnaddress', address: lud16, name: r.name || lud16,
                 resolvedFromNode: r.address })
    } else {
      out.push({ ...r, unpayable: true, unpayableReason: UNPAYABLE_NODE_REASON })
    }
  }
  return out
}
