/* Profile lookup fallback: Primal's cache.
 *
 * The collector embeds a booster's name and picture in every boost record, so
 * the feeds paint identities with no round-trip and first paint is normally
 * final. That covers boosters it resolved a kind-0 for. It does not cover:
 *
 *   - a booster who had no kind-0 when the collector last ran
 *   - an npub MENTIONED inside a boost message, who need never have boosted
 *     anything and so is not in the profiles table at all
 *
 * Rather than show those as `@npub1abc…`, every surface falls back to this
 * module before giving up. It queries Primal's caching service over one
 * WebSocket rather than fanning out across relays: a normal Nostr client would
 * ask the relays, but a cache answers a batch of pubkeys in a single round trip
 * and is the same thing localbitcoiners.com leans on.
 *
 * This is a FALLBACK, never the primary path. Indexed profiles are what make
 * the feeds paint instantly; this fills the holes afterwards and repaints.
 *
 * Extracted from boosts-thread.js so the show pages can use it without
 * importing that module — /show/<guid> is server-rendered and pulling in
 * boosts-thread.js plus nostr-tools (102KB) to resolve a handful of names
 * would defeat the point of rendering it on the server. boosts-thread.js now
 * imports from here, so there is one implementation and one timeout.
 * (calendar-events.js was the third file in that sum until 2026-08-23, when it
 * was deleted along with the LB thread fetch that was its only live caller.)
 */

const PRIMAL_WS_URL = 'wss://cache1.primal.net/v1'
const PRIMAL_TIMEOUT_MS = 6000

// Primal answers a batch in one round trip, but an unbounded pubkey list is a
// request nobody should send. Callers chunk through this.
export const PROFILE_CHUNK = 100

function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

// ── Primal cache: low-level query ────────────────────────────────────
export function primalQuery(op, params, timeoutMs = PRIMAL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const events = []
    const finish = (val, err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      if (err) reject(err); else resolve(val)
    }
    const ws = new WebSocket(PRIMAL_WS_URL)
    const subId = `lb_${op}_${Date.now()}`
    const timer = setTimeout(
      () => finish(null, new Error(`Primal "${op}" timed out`)),
      timeoutMs,
    )
    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', subId, { cache: [op, params] }]))
    }
    ws.onerror = () => finish(null, new Error(`Primal WS error (${op})`))
    // If close fires before EOSE, treat whatever we have as the result.
    ws.onclose = () => { if (!settled) finish(events) }
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      const [type, , payload] = msg
      if (type === 'EVENT' && payload) events.push(payload)
      else if (type === 'EOSE') finish(events)
    }
  })
}

export function parseProfileEvent(ev) {
  try {
    const meta = JSON.parse(ev.content)
    return {
      pubkey:  ev.pubkey,
      name:    meta.display_name || meta.name || '',
      picture: isSafeUrl(meta.picture) ? meta.picture : null,
      nip05:   meta.nip05 || '',
      lud16:   typeof meta.lud16 === 'string' ? meta.lud16.trim() : '',
      lud06:   typeof meta.lud06 === 'string' ? meta.lud06.trim() : '',
      // The three the booster page's header needs and no other caller reads.
      // ADDING A PROPERTY IS SAFE IN BOTH DIRECTIONS, which is why this is a
      // change here rather than a new module: a consumer holding a stale copy of
      // this file simply sees `undefined`, and every reader of these three
      // treats a falsy value as "not published" already. That is the same
      // reasoning the note in feed-controls.js gives for optional options —
      // it is a NAMED EXPORT that cannot be added, not a field.
      about:   typeof meta.about === 'string' ? meta.about.trim() : '',
      website: typeof meta.website === 'string' ? meta.website.trim() : '',
      banner:  isSafeUrl(meta.banner) ? meta.banner : null,
    }
  } catch {
    return { pubkey: ev.pubkey }
  }
}

// pubkey hex[] → Map(pubkey → profile). Never throws: an unreachable cache
// leaves the caller with what it already had, which is the truncated npub.
export async function fetchProfilesFromPrimal(pubkeys) {
  if (!pubkeys.length) return new Map()
  try {
    const evs = await primalQuery('user_infos', { pubkeys })
    const out = new Map()
    for (const ev of evs) if (ev.kind === 0) out.set(ev.pubkey, parseProfileEvent(ev))
    return out
  } catch { return new Map() }
}

// The batching wrapper every caller actually wants. Chunks, swallows a failed
// chunk rather than losing the whole set, and returns one merged Map.
export async function fetchProfiles(pubkeys) {
  const out = new Map()
  const list = [...new Set(pubkeys)].filter(Boolean)
  for (let i = 0; i < list.length; i += PROFILE_CHUNK) {
    const got = await fetchProfilesFromPrimal(list.slice(i, i + PROFILE_CHUNK))
    for (const [pk, prof] of got) out.set(pk, prof)
  }
  return out
}
