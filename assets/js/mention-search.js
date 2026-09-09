/* The @mention lookup: Primal's cache, ranked by followers, and the pure
 * functions every composer on the site shares.
 *
 * ⚠️ ONE MODULE, TWO BUILDS. The site's own composers import this from
 * `/assets/js/` like any other module; the login widget imports it by relative
 * path (`../../assets/js/mention-search.js`) and Vite inlines it into the
 * bundle. That is why it imports NOTHING — a `./sibling.js?v=…` specifier is
 * what the site's stamper expects and what Vite would have to guess at — and
 * why the bech32 codec is written out here rather than taken from nostr-tools,
 * which the site loads as a separate 100KB asset and the widget bundles on its
 * own. Keep it dependency-free; the widget's Tailwind never sees this file, so
 * no class names belong in it either.
 *
 * The lookup is `user_search` on cache1.primal.net, the same cache
 * primal-profiles.js resolves missing names against. One round trip answers
 * both halves: the kind-0 profiles, and a synthetic kind 10000133 whose
 * content is `{ pubkey: followerCount }` for every result (measured 2026-09-09:
 * 10 profiles + the counts in ~780ms). No second `user_infos` call.
 *
 * ⚠️ THE ORDER IS FOLLOWERS, DESCENDING. Reed's ask: the names most people
 * follow first, because a typeahead's job is to guess who was meant and the
 * account with 2,000 followers is the one the typist has heard of. Primal's own
 * order is close to that but is not documented, so it is only the tiebreak.
 *
 * ⚠️ THE NOTE CARRIES `nostr:npub1…`, NEVER `@npub1…` AND NEVER THE LABEL.
 * Reed's rule, 2026-09-09: that is the form NIP-27 specifies, so Helipad and
 * every Nostr client render it as a mention. The editor shows `@name` because a
 * 63-character bech32 string in a 300-byte message is unreadable; the map
 * built here is what turns the label back into the URI at publish. The label
 * is chrome; `expand()` is the note.
 *
 * The socket is a singleton with an idle close, because a typeahead fires a
 * query every few hundred milliseconds and a handshake per keystroke is the
 * whole latency budget (mynostr's `primal.js` is the design this follows).
 * Identical in-flight queries share one promise: Primal answers a duplicate
 * REQ on the same socket with an empty EOSE.
 */

const PRIMAL_WS_URL = 'wss://cache1.primal.net/v1'
const KIND_FOLLOWER_COUNTS = 10000133
const CONNECT_TIMEOUT_MS = 8000
const QUERY_TIMEOUT_MS = 6000
const IDLE_CLOSE_MS = 30_000
export const SEARCH_LIMIT = 8
/** The longest label the trigger will search for. Nobody's handle is longer,
 *  and it bounds what gets sent to a third party on every keystroke. */
const MAX_QUERY_CHARS = 40

// ── the socket ──────────────────────────────────────────────────────────────

let ws = null
let opening = null
let seq = 0
let idleTimer = null
const pending = new Map()   // subId → { events, resolve, reject, timer }
const inflight = new Map()  // op+params → Promise

function armIdleClose() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (pending.size) { armIdleClose(); return }
    try { ws?.close() } catch {}
  }, IDLE_CLOSE_MS)
}

function failAll(err) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    p.reject(err)
    pending.delete(id)
  }
}

function ensureSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws)
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    let sock
    try { sock = new WebSocket(PRIMAL_WS_URL) } catch (e) { opening = null; reject(e); return }
    // A socket stuck in CONNECTING fires neither onopen nor onerror for
    // minutes; without this every query would hang before its own timeout.
    const t = setTimeout(() => {
      if (sock.readyState !== WebSocket.OPEN) { try { sock.close() } catch {}; opening = null; reject(new Error('Primal connect timed out')) }
    }, CONNECT_TIMEOUT_MS)
    sock.onopen = () => { clearTimeout(t); ws = sock; opening = null; armIdleClose(); resolve(sock) }
    sock.onerror = () => { clearTimeout(t); if (ws !== sock) { opening = null; reject(new Error('Primal socket error')) } }
    sock.onclose = () => {
      clearTimeout(t)
      if (ws === sock) ws = null
      opening = null
      failAll(new Error('Primal socket closed'))
    }
    sock.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      const [type, id, payload] = msg
      const p = pending.get(id)
      if (!p) return
      if (type === 'EVENT' && payload) p.events.push(payload)
      else if (type === 'EOSE' || type === 'NOTICE' || type === 'CLOSED') {
        clearTimeout(p.timer)
        pending.delete(id)
        p.resolve(p.events)
        armIdleClose()
      }
    }
  })
  return opening
}

/** One cache op, one array of events. Rejects on timeout or a dead socket. */
export async function primalSearchQuery(op, params, timeoutMs = QUERY_TIMEOUT_MS) {
  const key = `${op}:${JSON.stringify(params)}`
  if (inflight.has(key)) return inflight.get(key)
  const run = (async () => {
    const sock = await ensureSocket()
    const subId = `ob_${op}_${++seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(subId)
        try { sock.send(JSON.stringify(['CLOSE', subId])) } catch {}
        reject(new Error(`Primal "${op}" timed out`))
      }, timeoutMs)
      pending.set(subId, { events: [], resolve, reject, timer })
      try { sock.send(JSON.stringify(['REQ', subId, { cache: [op, params] }])) }
      catch (e) { clearTimeout(timer); pending.delete(subId); reject(e) }
    })
  })()
  inflight.set(key, run)
  try { return await run } finally { inflight.delete(key) }
}

// ── ranking ─────────────────────────────────────────────────────────────────

export function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

/** Follower counts out of a `user_search` / `user_infos` response. Two shapes
 *  exist: the dict `{ pubkey: n }` (what user_search answers) and a per-user
 *  `{ followers_count: n }` under a `p` tag. Both are read. */
function followerCounts(events) {
  const out = new Map()
  for (const ev of events) {
    if (ev.kind !== KIND_FOLLOWER_COUNTS) continue
    let data; try { data = JSON.parse(ev.content) } catch { continue }
    if (!data || typeof data !== 'object') continue
    const tagged = ev.tags?.find((t) => t[0] === 'p')?.[1]
    if (tagged) { if (typeof data.followers_count === 'number') out.set(tagged, data.followers_count); continue }
    for (const [pk, v] of Object.entries(data)) {
      const n = typeof v === 'number' ? v : (typeof v?.followers_count === 'number' ? v.followers_count : null)
      if (n != null) out.set(pk, n)
    }
  }
  return out
}

function parseKind0(ev) {
  let meta = {}
  try { meta = JSON.parse(ev.content) || {} } catch {}
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const display = typeof meta.display_name === 'string' ? meta.display_name.trim() : ''
  return {
    pubkey: ev.pubkey,
    npub: npubEncode(ev.pubkey),
    name,
    displayName: display,
    picture: isSafeUrl(meta.picture) ? meta.picture : null,
    nip05: typeof meta.nip05 === 'string' ? meta.nip05.trim() : '',
    followers: null,
  }
}

/** The pure half of the search, exported for the test: a raw event list to the
 *  ranked result list. Profiles keep Primal's order among equal counts. */
export function rankSearchEvents(events) {
  const counts = followerCounts(events)
  const seen = new Set()
  const rows = []
  for (const ev of events) {
    if (ev.kind !== 0 || !/^[0-9a-f]{64}$/i.test(ev.pubkey || '') || seen.has(ev.pubkey)) continue
    seen.add(ev.pubkey)
    const row = parseKind0(ev)
    row.followers = counts.has(ev.pubkey) ? counts.get(ev.pubkey) : null
    rows.push(row)
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.followers ?? -1) - (a.r.followers ?? -1) || a.i - b.i)
    .map(({ r }) => r)
}

/** `@quer` → the people it might mean, most-followed first. Never throws:
 *  a dead cache is an empty menu, not a broken composer. */
export async function searchUsers(query, limit = SEARCH_LIMIT) {
  const q = String(query || '').trim().slice(0, MAX_QUERY_CHARS)
  if (!q) return []
  try {
    const events = await primalSearchQuery('user_search', { query: q, limit })
    return rankSearchEvents(events).slice(0, limit)
  } catch { return [] }
}

export function formatFollowers(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

// ── the trigger and the token ───────────────────────────────────────────────

/** The `@` lead-in the caret is sitting in, or null. An `@` counts only at the
 *  start of the text or after whitespace or an opening bracket/quote, so
 *  `reed@nostrplebs.com` never opens the menu. `start` is the `@`; `end` is the
 *  caret; `query` is what was typed after the `@`, which may be empty. */
export function mentionQueryAt(text, caret) {
  const before = String(text || '').slice(0, Math.max(0, caret | 0))
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const query = before.slice(at + 1)
  if (query.length > MAX_QUERY_CHARS || /[\s@]/.test(query)) return null
  if (at > 0 && !/[\s(\["'“‘]/.test(before[at - 1])) return null
  return { query, start: at, end: before.length }
}

/** Replace the `@query` range with `@label`, and keep a space after it so the
 *  typist carries on. Returns the new text and where the caret goes. */
export function insertMention(text, range, label) {
  const src = String(text || '')
  const token = `@${label}`
  const after = src.slice(range.end)
  const space = /^\s/.test(after) ? '' : ' '
  const out = src.slice(0, range.start) + token + space + after
  // The caret lands past the space, added or already there, so typing goes on.
  const skip = space ? 1 : (after.startsWith(' ') ? 1 : 0)
  return { text: out, caret: range.start + token.length + skip }
}

/** The label a picked profile is shown under. The handle (`name`) first, since
 *  that is what `@` means everywhere else on Nostr; the display name when there
 *  is no handle; the npub's first twelve characters when there is neither.
 *  Whitespace inside is kept — the map matches the whole token. */
export function mentionLabel(profile) {
  const handle = (profile?.name || '').replace(/\s+/g, ' ').trim()
  if (handle) return handle.slice(0, MAX_QUERY_CHARS)
  const display = (profile?.displayName || '').replace(/\s+/g, ' ').trim()
  if (display) return display.slice(0, MAX_QUERY_CHARS)
  return (profile?.npub || npubEncode(profile?.pubkey || '') || 'npub').slice(0, 12)
}

/** One composer's labels and the pubkeys behind them.
 *
 *  `label(profile)` registers a pick and answers the token to insert, made
 *  unique with `_` + four npub characters when two different people share a
 *  handle. `expand(text)` is the published form: every registered `@label`
 *  becomes `nostr:npub1…`, then any `@npub1…` or bare `npub1…` the typist
 *  pasted is normalised to the same URI. Longest label first, and a label only
 *  matches when nothing word-like follows it, so `@reed` cannot eat `@reedbtc`. */
export function createMentionMap() {
  const byLabel = new Map()   // label → hex pubkey
  return {
    label(profile) {
      const pubkey = String(profile?.pubkey || '').toLowerCase()
      const npub = profile?.npub || npubEncode(pubkey)
      for (const [l, pk] of byLabel) if (pk === pubkey) return l
      let label = mentionLabel({ ...profile, npub })
      if (byLabel.has(label) && byLabel.get(label) !== pubkey) label = `${label}_${npub.slice(5, 9)}`
      byLabel.set(label, pubkey)
      return label
    },
    has(label) { return byLabel.has(label) },
    get size() { return byLabel.size },
    expand(text) {
      let out = String(text || '')
      const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length)
      for (const label of labels) {
        const npub = npubEncode(byLabel.get(label))
        const re = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapeRe(label)}(?![\\p{L}\\p{N}_])`, 'gu')
        out = out.replace(re, (m, lead) => `${lead}nostr:${npub}`)
      }
      return normaliseNpubs(out)
    },
  }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

const BECH32_BODY = '[023456789acdefghjklmnpqrstuvwxyz]+'
const LOOSE_NPUB_RE = new RegExp(`(^|[^\\p{L}\\p{N}_:/@])@?(npub1${BECH32_BODY})(?![\\p{L}\\p{N}_])`, 'giu')

/** `@npub1…` and bare `npub1…` → `nostr:npub1…`, when the checksum holds. A
 *  string that merely begins `npub1` is left as typed. An existing `nostr:`
 *  URI is untouched, as is an npub inside a URL path. */
export function normaliseNpubs(text) {
  return String(text || '').replace(LOOSE_NPUB_RE, (m, lead, npub) =>
    pubkeyFromNpub(npub) ? `${lead}nostr:${npub}` : m)
}

const NOSTR_PERSON_RE = new RegExp(`nostr:((?:npub|nprofile)1${BECH32_BODY})`, 'gi')

/** Every person a published text mentions, as hex pubkeys, in order of first
 *  appearance: the `p` tags a signed note owes them (NIP-27). Only valid
 *  bech32; a corrupted URI names nobody rather than somebody else. */
export function mentionedPubkeys(text) {
  const out = []
  for (const m of String(text || '').matchAll(NOSTR_PERSON_RE)) {
    const pk = pubkeyFromNpub(m[1])
    if (pk && !out.includes(pk)) out.push(pk)
  }
  return out
}

// ── bech32, both ways, for npub and nprofile ────────────────────────────────

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values) {
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]
  }
  return chk
}

function hrpExpand(hrp) {
  const out = []
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5)
  out.push(0)
  for (const c of hrp) out.push(c.charCodeAt(0) & 31)
  return out
}

function toWords(bytes) {
  const out = []
  let acc = 0, bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31) }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31)
  return out
}

function fromWords(words) {
  const out = []
  let acc = 0, bits = 0
  for (const v of words) {
    acc = (acc << 5) | v
    bits += 5
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff) }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) return null
  return out
}

function bech32Encode(hrp, bytes) {
  const words = toWords(bytes)
  const values = [...hrpExpand(hrp), ...words]
  const mod = polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1
  let s = `${hrp}1`
  for (const w of words) s += CHARSET[w]
  for (let i = 0; i < 6; i++) s += CHARSET[(mod >>> (5 * (5 - i))) & 31]
  return s
}

function bech32Decode(str) {
  const s = String(str || '').toLowerCase()
  const pos = s.lastIndexOf('1')
  if (pos < 1 || pos + 7 > s.length || s.length > 1023) return null
  const hrp = s.slice(0, pos)
  const words = []
  for (const c of s.slice(pos + 1)) {
    const v = CHARSET.indexOf(c)
    if (v < 0) return null
    words.push(v)
  }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) return null
  return { hrp, bytes: fromWords(words.slice(0, -6)) }
}

const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('')

/** hex pubkey → `npub1…`, or '' for anything that is not 32 bytes of hex. */
export function npubEncode(hex) {
  const h = String(hex || '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(h)) return ''
  const bytes = []
  for (let i = 0; i < 64; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16))
  return bech32Encode('npub', bytes)
}

/** `npub1…` or `nprofile1…` → the hex pubkey, or null when the checksum or the
 *  shape fails. */
export function pubkeyFromNpub(id) {
  const d = bech32Decode(id)
  if (!d || !d.bytes) return null
  if (d.hrp === 'npub') return d.bytes.length === 32 ? toHex(d.bytes) : null
  if (d.hrp === 'nprofile') {
    const b = d.bytes
    for (let i = 0; i + 2 <= b.length;) {
      const type = b[i], len = b[i + 1]
      if (i + 2 + len > b.length) return null
      if (type === 0) return len === 32 ? toHex(b.slice(i + 2, i + 34)) : null
      i += 2 + len
    }
  }
  return null
}
