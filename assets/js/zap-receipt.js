/* The summary receipt: the ONE kind 9735 a boost note quotes, and the pure
 * functions both halves of it share.
 *
 * ⚠️ ONE MODULE, TWO BUILDS, THE `mention-search.js` ARRANGEMENT. The signing
 * oracle (`functions/api/sign-receipt.js`) imports this by relative path and
 * esbuild inlines it; the login widget imports it the same way
 * (`../../../assets/js/zap-receipt.js`) and Vite inlines it. That is why it
 * imports NOTHING and why the bech32 codec below is written out rather than
 * taken from nostr-tools. Keep it dependency-free.
 *
 * WHY A RECEIPT FOR THE TOTAL EXISTS. Fountain draws a boost's ⚡ figure off
 * the first kind 9735 the note quotes, and off nothing else: not the note's
 * `amount` tag, not the sum of several receipts. BMB measured it on
 * 2026-09-16 (two 33-sat leg receipts quoted under a 100-sat note rendered
 * "⚡ 33"), asked Fountain, and was told Fountain signs one receipt for the
 * total under its own key, because Fountain IS the recipient and splits
 * server-side. A client-side split can never produce a provider receipt for
 * the whole — four recipients are four invoices from four providers, and the
 * keysend legs have no receipt at all — so the only receipt for the whole is
 * one this site signs. BMB's first boost through the same shape (note
 * 81802c0c…, receipt 470f0fa0…, 2026-09-17) rendered "⚡ 100" for a 100-sat
 * boost split four ways, with no bolt11 on the receipt.
 *
 * WHAT IT IS NOT. Not a provider's proof of payment. NIP-57 Appendix F has a
 * validating client check a receipt's signer against the recipient's LNURL
 * provider, and this receipt fails that test by construction: it renders
 * where Fountain renders it and may be refused by a client that validates.
 * NIP-57 itself says a receipt "is not a proof of payment ... you are trusting
 * the author". This one's author is the site's bot key, attesting that a
 * boost sent from this site settled — the same trust level as the bot-signed
 * boost notes `/api/sign-boost` already publishes, and no higher.
 *
 * WHY `bolt11` IS ABSENT. Appendix E makes it mandatory, and there is no
 * invoice for the total: each leg had its own. A minted invoice nobody can pay
 * would be a fabricated payment record, which is a different thing from an
 * attestation. The amount rides in the request's `amount` tag and in the
 * optional `amount` tag Appendix E allows on the receipt, which is the one
 * Fountain's reader takes (measured, above).
 *
 * WHAT BOUNDS THE ORACLE. It never signs a caller-supplied receipt. It takes a
 * kind 9734 the SENDER signed (`validateSummaryRequest`), or builds one itself
 * from three bounded facts (`summaryRequestTemplateFromSpec`) when the note is
 * bot-published, and derives the 9735 from that. So a stranger can make the
 * site attest a payment from their OWN key, `P`-tagged to them, or an
 * anonymous one from the site's — the same two claims a boost note already
 * lets them make — and nothing else: not a payment from someone else's key,
 * not a quote of any note, not a line of prose.
 */

/** ⚠️ RESTATED FROM `MAX_AMOUNT_MSAT` IN `functions/api/sign-boost.js`: the
 *  one cap on every figure the bot key will sign (5,000,000 sats), which is
 *  also the modal's `MAX_SATS`. `scripts/test-sign-receipt.mjs` holds the two
 *  equal. */
export const SUMMARY_MAX_MSAT = 5_000_000_000
/** The 9734's `relays` tag names where the receipt will be published, and
 *  every entry is a socket the browser opens; eight is the widget's own
 *  `PUBLISH_RELAYS` length. */
export const SUMMARY_MAX_RELAYS = 8
/** ±5 minutes, the boost oracle's skew. */
export const SUMMARY_SKEW_SECS = 300

/** ⚠️ THE BOT'S PUBLIC KEY, RESTATED FROM THE SITE IDENTITY TABLE IN
 *  `CLAUDE.md`. The widget needs it to address the sender-signed 9734 (`p` must
 *  be the key that will sign the receipt), and the oracle derives its own from
 *  `BOOSTBOT_NSEC` and refuses a request addressed anywhere else. So a rotated
 *  bot key that is not mirrored here makes every donor-route receipt fail
 *  quietly: the note still publishes, and quotes nothing. Rotate both. */
export const BOOSTBOT_PUBKEY_HEX = '3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9'

const HTTP_URL = /^https?:\/\/\S+$/i
const HEX64_RE = /^[0-9a-f]{64}$/
const HEX128_RE = /^[0-9a-f]{128}$/
const SUMMARY_TAG_NAMES = new Set(['relays', 'amount', 'p', 'k', 'i'])
const SUMMARY_K_VALUES = new Set(['podcast:guid', 'podcast:item:guid'])
const MAX_TAGS = 16
const MAX_TAG_ITEMS = 10
const MAX_TAG_ITEM_LEN = 512

function withHint(tag, url) {
  const u = typeof url === 'string' ? url.trim() : ''
  return u && HTTP_URL.test(u) ? [...tag, u] : tag
}

/**
 * The NIP-73 `k`/`i` pairs for `refs`, in the order Fountain writes them on a
 * zap request: the item first, then the show, `k` before its `i`. A missing
 * guid emits neither half of its pair; a missing URL emits the `i` tag with no
 * hint. (Fountain's own requests, read out of two receipts' `description`
 * tags on 2026-09-16, carry exactly these four tags after `relays`, `amount`
 * and `p`, and its server copies all four onto the receipt.)
 */
export function nip73Tags(refs) {
  if (!refs || typeof refs !== 'object') return []
  const out = []
  const item = typeof refs.episodeGuid === 'string' ? refs.episodeGuid.trim() : ''
  const show = typeof refs.podcastGuid === 'string' ? refs.podcastGuid.trim() : ''
  if (item) {
    out.push(['k', 'podcast:item:guid'])
    out.push(withHint(['i', `podcast:item:guid:${item}`], refs.episodeUrl))
  }
  if (show) {
    out.push(['k', 'podcast:guid'])
    out.push(withHint(['i', `podcast:guid:${show}`], refs.podcastUrl))
  }
  return out
}

/** Every tag a kind 9734 this site signs carries: NIP-57 Appendix D's
 *  `relays`, `amount` and one `p`, then the NIP-73 pairs. No `e`, no `a`, no
 *  `lnurl` (there is no invoice), and no `client` tag: that is an app-identity
 *  claim the money path would carry, and the note already names the client. */
export function zapRequestTags({ relays, amountMsat, recipientPubkey, refs }) {
  return [
    ['relays', ...relays],
    ['amount', String(amountMsat)],
    ['p', recipientPubkey],
    ...nip73Tags(refs),
  ]
}

/**
 * The shape a kind 9734 must have before the site derives a receipt from it.
 * Pure: the SIGNATURE is checked by the route with `verifyEvent`; this decides
 * everything else, so the test can pin it. Returns the request rebuilt from
 * exactly its seven fields, so nothing a caller appended can reach the
 * `description` tag.
 */
export function validateSummaryRequest(input, sitePubkey, nowSecs) {
  const no = (reason) => ({ ok: false, reason })
  if (!input || typeof input !== 'object' || Array.isArray(input)) return no('not an event')
  const e = input
  if (e.kind !== 9734) return no('not a zap request')
  if (typeof e.id !== 'string' || !HEX64_RE.test(e.id)) return no('bad id')
  if (typeof e.pubkey !== 'string' || !HEX64_RE.test(e.pubkey)) return no('bad pubkey')
  if (typeof e.sig !== 'string' || !HEX128_RE.test(e.sig)) return no('bad sig')
  if (typeof e.created_at !== 'number' || !Number.isInteger(e.created_at)) return no('bad created_at')
  if (Math.abs(e.created_at - nowSecs) > SUMMARY_SKEW_SECS) return no('created_at out of range')
  // Fountain's requests carry no prose and neither do ours: the note has the
  // message. Signing text under the bot key is the boost oracle's problem,
  // with its pinned opening line; this one does not take it on.
  if (e.content !== '') return no('content must be empty')
  if (!Array.isArray(e.tags) || e.tags.length > MAX_TAGS) return no('bad tags')
  for (const t of e.tags) {
    if (!Array.isArray(t) || t.length === 0 || t.length > MAX_TAG_ITEMS) return no('bad tag')
    if (!t.every((x) => typeof x === 'string' && x.length <= MAX_TAG_ITEM_LEN)) return no('bad tag')
    if (!SUMMARY_TAG_NAMES.has(t[0])) return no(`unsupported tag ${t[0]}`)
  }
  const tags = e.tags
  const named = (n) => tags.filter((t) => t[0] === n)
  const p = named('p')
  if (p.length !== 1 || p[0][1] !== sitePubkey) return no('p must be the site key, once')
  const amount = named('amount')
  if (amount.length !== 1 || !/^[1-9][0-9]*$/.test(amount[0][1] ?? '')) return no('amount missing')
  const msat = Number(amount[0][1])
  if (!Number.isSafeInteger(msat) || msat % 1000 !== 0 || msat > SUMMARY_MAX_MSAT) return no('amount out of range')
  const relays = named('relays')
  if (relays.length !== 1) return no('relays missing')
  const urls = relays[0].slice(1)
  if (urls.length === 0 || urls.length > SUMMARY_MAX_RELAYS || !urls.every((u) => u.startsWith('wss://'))) {
    return no('bad relays')
  }
  const ks = named('k')
  const is = named('i')
  if (ks.length > 2 || is.length > 2) return no('too many refs')
  if (!ks.every((t) => t.length === 2 && SUMMARY_K_VALUES.has(t[1]))) return no('bad k tag')
  for (const t of is) {
    const kind = t[1]?.startsWith('podcast:item:guid:') ? 'podcast:item:guid'
      : t[1]?.startsWith('podcast:guid:') ? 'podcast:guid' : null
    if (!kind || t[1].length <= kind.length + 1) return no('bad i tag')
    if (t.length > 3 || (t.length === 3 && !HTTP_URL.test(t[2]))) return no('bad i hint')
    if (!ks.some((k) => k[1] === kind)) return no('i without k')
  }
  return {
    ok: true,
    request: {
      id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: 9734,
      tags: tags.map((t) => [...t]), content: '', sig: e.sig,
    },
  }
}

/**
 * What the widget sends when the SITE must author the request too: a boost
 * whose note is bot-published (signed out, or Anonymous) has no sender key
 * that may sign a 9734 — the request's `pubkey` becomes the receipt's `P`,
 * and naming the person is exactly what Anonymous refuses. The bot then signs
 * both halves, and the receipt's sender is the bot, as its note's author is.
 *
 * Bounded to the three facts a request carries and nothing else: the oracle
 * builds the template itself through `zapRequestTags`, signs it, and runs the
 * result through `validateSummaryRequest` like any other. A caller cannot put
 * a tag, a `p`, or a character of prose into it.
 */
export function summaryRequestTemplateFromSpec(input, sitePubkey, nowSecs) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const spec = input
  const amountMsat = spec.amountMsat
  if (typeof amountMsat !== 'number' || !Number.isSafeInteger(amountMsat)) return null
  if (amountMsat <= 0 || amountMsat % 1000 !== 0 || amountMsat > SUMMARY_MAX_MSAT) return null
  if (!Array.isArray(spec.relays)) return null
  const relays = [...new Set(
    spec.relays.filter((r) => typeof r === 'string' && r.startsWith('wss://') && r.length <= 256),
  )].slice(0, SUMMARY_MAX_RELAYS)
  if (relays.length === 0) return null
  const rawRefs = spec.refs && typeof spec.refs === 'object' && !Array.isArray(spec.refs) ? spec.refs : {}
  const str = (v) => (typeof v === 'string' && v.length <= 512 ? v : undefined)
  const refs = {
    podcastGuid: str(rawRefs.podcastGuid),
    episodeGuid: str(rawRefs.episodeGuid),
    podcastUrl: str(rawRefs.podcastUrl),
    episodeUrl: str(rawRefs.episodeUrl),
  }
  return {
    kind: 9734,
    created_at: nowSecs,
    content: '',
    tags: zapRequestTags({ relays, amountMsat, recipientPubkey: sitePubkey, refs }),
  }
}

/**
 * The kind 9735 the site signs for a validated request: Fountain's receipt
 * shape minus the invoice that does not exist. `p` the site, `P` the sender,
 * `description` the request verbatim, `amount`, and the NIP-73 pairs mirrored
 * the way Fountain's server mirrors them.
 */
export function summaryReceiptTemplate(request, sitePubkey, createdAt) {
  const amount = request.tags.find((t) => t[0] === 'amount')?.[1] ?? '0'
  const refs = request.tags.filter((t) => t[0] === 'k' || t[0] === 'i').map((t) => [...t])
  return {
    kind: 9735,
    created_at: createdAt,
    content: '',
    tags: [
      ['p', sitePubkey],
      ['P', request.pubkey],
      ['description', JSON.stringify(request)],
      ['amount', amount],
      ...refs,
    ],
  }
}

// ── the quote ───────────────────────────────────────────────────────────────

/**
 * Both halves of the quote a note carries for its receipt. The `q` tag is
 * NIP-18's (id, relay hint, author); the body line is the `nostr:nevent1…`
 * form. ⚠️ BOTH ARE NEEDED: Fountain lists a note off the `q` tag and draws
 * the ⚡ figure off the body (BMB's measurement across two production notes,
 * 2026-09-17). The hints are relays that hold the receipt, at most three; a
 * hint naming a relay that never took it sends every reader to an empty
 * answer, so the caller passes the relays that ACCEPTED where it knows them.
 */
export function receiptQuote({ id, pubkey, relays }) {
  const hints = (Array.isArray(relays) ? relays : []).filter((r) => typeof r === 'string' && r.startsWith('wss://')).slice(0, 3)
  return {
    tag: ['q', id, hints[0] ?? '', pubkey],
    line: `nostr:${neventEncode({ id, relays: hints, author: pubkey, kind: 9735 })}`,
  }
}

// ── nevent, written out (NIP-19 TLV over bech32) ────────────────────────────

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

function bech32Encode(hrp, bytes) {
  const words = toWords(bytes)
  const values = [...hrpExpand(hrp), ...words]
  const mod = polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1
  let s = `${hrp}1`
  for (const w of words) s += CHARSET[w]
  for (let i = 0; i < 6; i++) s += CHARSET[(mod >>> (5 * (5 - i))) & 31]
  return s
}

function hexBytes(hex) {
  const out = []
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  return out
}

function tlv(type, bytes) {
  return [type, bytes.length, ...bytes]
}

/** `nevent1…` for an event: TLV 3 the kind (four bytes, big-endian), 2 the
 *  author, 1 each relay hint, 0 the id — nostr-tools' order, so the string is
 *  byte-identical to what any client would build (held by the test). Returns
 *  '' for an id that is not 32 bytes of hex. */
export function neventEncode({ id, relays = [], author, kind }) {
  const h = String(id || '').toLowerCase()
  if (!HEX64_RE.test(h)) return ''
  const enc = new TextEncoder()
  const data = []
  if (Number.isInteger(kind) && kind >= 0) {
    data.push(...tlv(3, [(kind >>> 24) & 255, (kind >>> 16) & 255, (kind >>> 8) & 255, kind & 255]))
  }
  const a = String(author || '').toLowerCase()
  if (HEX64_RE.test(a)) data.push(...tlv(2, hexBytes(a)))
  for (const r of relays) {
    const bytes = [...enc.encode(String(r))]
    if (bytes.length > 255) continue
    data.push(...tlv(1, bytes))
  }
  data.push(...tlv(0, hexBytes(h)))
  return bech32Encode('nevent', data)
}
