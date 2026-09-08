/**
 * favorites-read.js — read a member's PC 2.0 Favorites list (kind 10333) from
 * the relays, and say whether the answer can be believed.
 *
 * The merge (`favorites-merge.js`) never publishes on a read it does not
 * trust: rule 1 of the spec, because publishing over "the relay never
 * answered" republishes a whole library as empty, and publishing over a STALE
 * copy overwrites every favorite another app added since. Both were measured
 * on 2026-09-06 against Chad's own list: relay.fountain.fm refuses the kind
 * outright, and relay.mostr.pub held a three-day-old private-mode copy with
 * zero public tags, which read alone is an empty list. So this module does
 * the counting itself, per relay, on raw sockets — never a pool's aggregate
 * EOSE, which fires vacuously when nothing connected and cannot tell a relay
 * that answered from one that hung (BMB's `read-trust.ts` is the record).
 *
 * THE RULE. A relay is REACHED when its socket opened. It has ANSWERED when
 * it sent EOSE inside the window. The read is trustworthy when every reached
 * relay answered AND at least `minAnswers` did (two, where the set allows).
 * A relay that never connected is out of both counts, so one dead entry in
 * the default list does not degrade every read forever; a relay that
 * connected and then went silent is a genuine unknown, and degrades it. A
 * relay that CLOSED the subscription (fountain's "kinds not supported") is a
 * refusal, not an answer: it will never hold the event, so it is excluded the
 * way a dead entry is rather than counted as evidence of an empty list.
 *
 * THE EVENT. Only an event of the right kind, signed by the pubkey asked for,
 * whose signature verifies, counts at all — a relay serving another user's
 * list, or a tampered one, is ignored (the relay still answered). Among what
 * survives, newest `created_at` wins and a tie goes to the lowest id, NIP-01's
 * rule for a replaceable event.
 *
 * `connect` and `verify` are injectable so the test can script relays that
 * hang, refuse, forge and disagree; production takes the defaults.
 */
import { verifyEvent } from '/assets/widgets/nostr-tools.js?v=ob-v204'

export const FAVORITES_KIND = 10333
export const RELAY_LIST_KIND = 10002

/**
 * The relays read by default: the four that held any copy of a real list on
 * 2026-09-06, plus `relay.primal.net`, which held nothing that day and the
 * CURRENT copy on 2026-09-08 (it accepts the kind; it had simply not been
 * written to yet). Primal matters for a second reason: it is in BoostMeBitch's
 * read set, and BMB takes the newest copy it hears within a short grace
 * period after the first event, so a relay it reads that we never write is a
 * stale copy that can win a race (Reed's test, 2026-09-08: a favorite made on
 * /show did not reach BMB until re-made). The writer unions the member's own
 * NIP-65 write relays through `extraRelays`. Not `relay.fountain.fm`, which
 * refuses the kind.
 */
export const READ_RELAYS = Object.freeze([
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.ditto.pub',
  'wss://relay.mostr.pub',
])

export const DEFAULT_TIMEOUT_MS = 6000
export const MIN_ANSWERS = 2

/** `wss://Relay.Example/` → `wss://relay.example`; anything not ws(s) is dropped. */
export function normalizeRelayUrl(url) {
  if (typeof url !== 'string') return null
  let u
  try { u = new URL(url.trim()) } catch { return null }
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return null
  u.hash = ''
  let s = u.toString()
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s.toLowerCase()
}

/** Union, normalized, deduped, order kept. */
export function relaySet(base, extra = []) {
  const out = []
  const seen = new Set()
  for (const url of [...(base ?? []), ...(extra ?? [])]) {
    const n = normalizeRelayUrl(url)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * Whether the ABSENCE of a newer event can be believed.
 *
 *   reached   relays whose socket opened and were not refusals
 *   answered  of those, the ones that sent EOSE inside the window
 *
 * Every reached relay answered, and enough of them did. `>=` on the second
 * clause so a miscount fails open on the arithmetic rather than wedging every
 * read at degraded; `minAnswers` is clamped to the set size so a one-relay
 * set (a test, a private relay) is not untrustworthy by construction.
 */
export function readIsTrustworthy({ reached, answered, minAnswers = MIN_ANSWERS, relayCount }) {
  const need = Math.max(1, Math.min(minAnswers, relayCount ?? minAnswers))
  return reached > 0 && answered >= reached && answered >= need
}

/** The one event this read is allowed to believe: right kind, right author, real signature. */
export function acceptsEvent(pubkey, ev, verify, kind = FAVORITES_KIND) {
  if (!ev || typeof ev !== 'object') return false
  if (ev.kind !== kind) return false
  if (ev.pubkey !== pubkey) return false
  if (!Array.isArray(ev.tags) || typeof ev.content !== 'string') return false
  try { return verify(ev) === true } catch { return false }
}

/** NIP-01: for a replaceable event the newest `created_at` wins, ties to the lowest id. */
export function newest(events) {
  let best = null
  for (const ev of events) {
    if (!best) { best = ev; continue }
    if (ev.created_at > best.created_at) best = ev
    else if (ev.created_at === best.created_at && ev.id < best.id) best = ev
  }
  return best
}

/** One relay, one REQ, one verdict. Never throws. */
function readOne(url, pubkey, kind, { connect, verify, timeoutMs, now }) {
  return new Promise((resolve) => {
    const t0 = now()
    const subId = 'fav-' + Math.random().toString(36).slice(2, 10)
    const events = []
    let opened = false
    let settled = false
    let ws
    const finish = (status, extra = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws?.close?.() } catch {}
      resolve({ url, status, events, ms: now() - t0, ...extra })
    }
    // 'hung' is a relay that opened and never said EOSE: reached, not answered.
    // 'unreachable' is one that never opened: out of both counts.
    const timer = setTimeout(() => finish(opened ? 'hung' : 'unreachable'), timeoutMs)
    try {
      ws = connect(url)
    } catch {
      finish('unreachable')
      return
    }
    ws.addEventListener('open', () => {
      opened = true
      try {
        ws.send(JSON.stringify(['REQ', subId, { kinds: [kind], authors: [pubkey] }]))
      } catch {
        finish('hung')
      }
    })
    ws.addEventListener('message', (m) => {
      let msg
      try { msg = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data)) } catch { return }
      if (!Array.isArray(msg)) return
      const [type, id, payload] = msg
      if (type === 'EVENT' && id === subId) {
        if (acceptsEvent(pubkey, payload, verify, kind)) events.push(payload)
        return
      }
      if (type === 'EOSE' && id === subId) { finish('answered'); return }
      if (type === 'CLOSED' && id === subId) { finish('refused', { reason: String(msg[2] ?? '') }); return }
      if (type === 'NOTICE' && typeof id === 'string' && /not supported|blocked|restricted/i.test(id)) {
        finish('refused', { reason: id })
      }
    })
    ws.addEventListener('error', () => finish(opened ? 'closed' : 'unreachable'))
    ws.addEventListener('close', () => finish(opened ? 'closed' : 'unreachable'))
  })
}

/**
 * Read `pubkey`'s favorites list.
 *
 * Resolves (never rejects) to:
 *   trusted   whether the merge may act on this read
 *   event     the newest verified kind-10333 event seen, or null
 *   read      what `plan()` takes: `{tags, content}` when trusted (an empty
 *             list when nobody holds one), NULL when not — and null is the
 *             point: it is not an empty list
 *   relays    one row per relay: url, status, ms, createdAt of what it held
 *   holding   relays that hold the winning event; stale ones are in `relays`
 */
export async function readFavorites(pubkey, options = {}) {
  return readNewestEvent(pubkey, FAVORITES_KIND, options)
}

/**
 * The member's NIP-65 write relays, off their newest kind 10002 on the read
 * set. Best-effort: no list, or no trustworthy read, is `[]`, and the caller
 * unions the answer with the defaults either way. Capped at 16 the way the
 * widget caps its own read of the same event.
 */
export async function readWriteRelays(pubkey, options = {}) {
  const r = await readNewestEvent(pubkey, RELAY_LIST_KIND, options)
  if (!r.event) return []
  return relaySet(
    r.event.tags
      .filter((t) => t[0] === 'r' && typeof t[1] === 'string' && (!t[2] || t[2] === 'write'))
      .map((t) => t[1])
      .filter((u) => { try { const x = new URL(u); return !x.username && !x.password } catch { return false } }),
  ).slice(0, 16)
}

/** The read itself, for any replaceable kind; `readFavorites` is this with kind 10333. */
export async function readNewestEvent(pubkey, kind, {
  relays = READ_RELAYS,
  extraRelays = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minAnswers = MIN_ANSWERS,
  connect = (url) => new WebSocket(url),
  verify = verifyEvent,
  now = () => Date.now(),
} = {}) {
  const urls = relaySet(relays, extraRelays)
  const opts = { connect, verify, timeoutMs, now }
  const rows = await Promise.all(urls.map((url) => readOne(url, pubkey, kind, opts)))

  const candidates = rows.flatMap((r) => r.events)
  const event = newest(candidates)
  const reached = rows.filter((r) => r.status === 'answered' || r.status === 'hung' || r.status === 'closed').length
  const answered = rows.filter((r) => r.status === 'answered').length
  const trusted = readIsTrustworthy({ reached, answered, minAnswers, relayCount: urls.length })

  const relaysOut = rows.map((r) => {
    const held = newest(r.events)
    return {
      url: r.url,
      status: r.status,
      ms: r.ms,
      createdAt: held ? held.created_at : null,
      current: !!(held && event && held.id === event.id),
      ...(r.reason ? { reason: r.reason } : {}),
    }
  })
  const holding = relaysOut.filter((r) => r.current).map((r) => r.url)

  return {
    trusted,
    event,
    read: trusted ? (event ? { tags: event.tags, content: event.content } : { tags: [], content: '' }) : null,
    reached,
    answered,
    relays: relaysOut,
    holding,
  }
}
