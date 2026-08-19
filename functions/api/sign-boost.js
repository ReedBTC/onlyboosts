/**
 * The signing oracle for the OnlyBoosts boost bot.
 *
 * A visitor who boosted without a Nostr account has paid a show and has no way
 * to put that boost in this index, because the index counts notes and they have
 * no key to sign one with. This endpoint signs a boost note for them under a
 * dedicated bot identity, and the browser publishes it. See `boost-login.md`
 * D1 (why a separate npub), D2 (the bot owns what it publishes) and D3 (both
 * paths classify as slug `onlyboosts`, told apart by `client_src`).
 *
 * ⚠️ THE PRIVATE KEY IS SERVER-ONLY AND NEVER REACHES THE BROWSER. It is a
 * Pages secret binding, set on BOTH Preview and Production. Unconfigured, this
 * endpoint answers 503 and the feature is simply off.
 *
 * Two bindings are needed and it refuses to run without either:
 *
 *   BOOSTBOT_NSEC   secret     the bot's key, nsec or 64-char hex
 *   SIGN_RATELIMIT  ratelimit  keyed on CF-Connecting-IP
 *
 * The signer is `functions/_shared/nostr-sign.js`, a vendored build rather than
 * an npm import, because this repo has no root package.json and the Functions
 * have no dependencies. **Proven under `wrangler pages dev`**: the bundle
 * imports, signs and self-verifies inside workerd, which was the one assumption
 * in D5 worth testing before anything was built on top of it.
 *
 * ⚠️ WHAT THIS ENDPOINT CANNOT DO IS VERIFY THAT ANYTHING WAS PAID, and no
 * cheap version of it can. Proof-of-payment was designed and rejected on
 * 2026-08-19: a preimage proves only that someone KNOWS the preimage, which is
 * the payer or whoever issued the invoice, so an attacker self-issues an
 * invoice for any amount and passes. A LUD-21 verify URL is worse, being
 * supplied by the same caller. Binding a note to a real payment would mean this
 * server issuing the invoices, which puts it in the middle of a money path.
 *
 * So the evidence standard here is the SAME as the donor-signed path's: the
 * browser's own observation of what settled. That is deliberate rather than a
 * shortfall. On the donor-signed path, possession of the key is what makes the
 * claim accountable; here there is no key to possess, so what stands in for it
 * is containment rather than proof:
 *
 *   - every note is published by ONE identifiable pubkey, so the bot's whole
 *     output is a single filterable set (`client_src = publisher-pubkey`);
 *   - `excludes.json` can remove all of it in one edit, reversibly;
 *   - the caps and the rate limit below bound what one caller can do with it.
 *
 * Worth keeping in proportion: the index already accepts unauthenticated writes
 * from the whole of Nostr, since anyone may publish a boost note from a burner
 * key and the collector will index it. What this endpoint removes is the
 * friction of generating a key, not the capability.
 *
 * ⚠️ WHAT IT MUST NEVER BECOME is a general-purpose signer. Everything below is
 * about one shape of one kind, and the validator is an ALLOWLIST so a new tag
 * in the template fails loudly here rather than being signed silently.
 */
import { finalizeEvent, nip19 } from '../_shared/nostr-sign.js'

// The exact opening `buildExternalNoteTemplate` emits. It constrains the first
// characters and nothing more: the rest is the donor's own typed message, which
// is the feature rather than a hole in it. What it does buy is that this
// endpoint cannot be repurposed to sign something that does not even look like
// a boost.
const CONTENT_PREFIX = '⚡Just boosted '
const MAX_CONTENT = 2000

// The complete tag vocabulary of `buildExternalNoteTemplate` in
// `login-widget/src/lib/externalBoostagram.js`. An allowlist, not a denylist.
// ⚠️ IF THAT BUILDER EMITS A NEW TAG, ADD IT HERE IN THE SAME CHANGE or every
// site-signed note starts failing.
const ALLOWED_TAGS = new Set(['i', 'k', 'r', 't', 'client', 'amount'])

// ⚠️ `e` AND `p` ARE REFUSED BY OMISSION, AND THAT IS THE POINT OF THE
// ALLOWLIST. Our template emits neither. With an `e` tag a note signed by this
// key appears to REPLY to any note in the world; with `p` tags it becomes a
// mention blast at strangers from an identity carrying our NIP-05. Both are far
// better vehicles for harassment than a standalone post nobody follows, and
// neither is a regression to refuse, because a boost note never has one.

const MAX_TAGS = 24
const MAX_TAG_ITEMS = 4
const MAX_TAG_ITEM_LEN = 512
const MAX_TAGS_TOTAL_LEN = 4096
const CREATED_AT_SKEW_SECS = 300

// One boost, capped. Nothing here can tell a real 500k-sat boost from an
// invented one, so the cap is about how large a single invented figure may be,
// not about what anyone is likely to send. Above it the donor still has the
// donor-signed path, where the claim is their own to make.
const MAX_AMOUNT_MSAT = 100_000_000   // 100k sats

// The attribution is OURS and is not caller-settable. A `client` tag naming
// something else would put a false publisher on a note we signed.
const CLIENT_TAG = 'onlyboosts.social'

function bad(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** http(s) only, and parseable. An `r` tag is a link published under our own
 *  identity, so the same rule the site applies to any third-party URL applies
 *  to one we are about to sign. */
function isSafeUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch { return false }
}

/**
 * Bound the oracle to one shape of one kind. Throws with a caller-facing
 * message; every message is safe to return, none of them echo the input back.
 */
export function validateBoostTemplate(body) {
  if (!body || typeof body !== 'object') throw new Error('bad template')
  if (body.kind !== 1) throw new Error('only kind 1 boost notes may be signed')

  if (typeof body.content !== 'string' || body.content.length > MAX_CONTENT) {
    throw new Error('invalid content')
  }
  if (!body.content.startsWith(CONTENT_PREFIX)) throw new Error('not a boost note')

  if (!Array.isArray(body.tags) || body.tags.length > MAX_TAGS) throw new Error('invalid tags')
  const shaped = body.tags.every((tag) =>
    Array.isArray(tag) &&
    tag.length > 0 &&
    tag.length <= MAX_TAG_ITEMS &&
    tag.every((x) => typeof x === 'string' && x.length <= MAX_TAG_ITEM_LEN))
  if (!shaped) throw new Error('invalid tags')

  const tags = body.tags
  const totalLen = tags.reduce((n, tag) => n + tag.reduce((m, x) => m + x.length, 0), 0)
  if (totalLen > MAX_TAGS_TOTAL_LEN) throw new Error('invalid tags')
  if (!tags.every((tag) => ALLOWED_TAGS.has(tag[0]))) throw new Error('unsupported tag')

  // The two markers every NIP-73 boost consumer keys on. Their presence is what
  // makes this a boost note rather than a kind 1 that merely opens like one.
  const hasTopic = (v) => tags.some((tag) => tag[0] === 't' && tag[1] === v)
  if (!hasTopic('boostagram') || !hasTopic('value4value')) throw new Error('not a boost note')

  for (const tag of tags) {
    if (tag[0] === 'r' && !isSafeUrl(tag[1] || '')) throw new Error('unsupported url')
    if (tag[0] === 'client' && tag[1] !== CLIENT_TAG) throw new Error('unsupported client')
  }

  // ⚠️ Exactly one `amount`, and it is the figure this index will read off the
  // published note. Two of them would let a caller decide which one the
  // collector picked up.
  const amounts = tags.filter((tag) => tag[0] === 'amount')
  if (amounts.length !== 1) throw new Error('invalid amount')
  // ⚠️ PLAIN DIGITS, NOT MERELY SOMETHING `Number()` LIKES. `Number('1.5e6')` is
  // an integer, so a shape check on the parsed value alone would sign the
  // string `1.5e6` into the tag — which reads as 1,500,000 to a JavaScript
  // consumer and raises in the collector's `int()`. The same note would then
  // mean different amounts to different indexers, which is the one thing this
  // tag cannot be allowed to do. Caught by scripts/test-sign-boost.mjs.
  const raw = amounts[0][1]
  if (typeof raw !== 'string' || !/^[0-9]{1,15}$/.test(raw)) throw new Error('invalid amount')
  const msat = Number(raw)
  if (!Number.isInteger(msat) || msat <= 0 || msat > MAX_AMOUNT_MSAT) {
    throw new Error('invalid amount')
  }

  // A note dated outside this window is either a clock problem or an attempt to
  // place a boost somewhere else in the timeline.
  const now = Math.floor(Date.now() / 1000)
  const createdAt = Number.isFinite(body.created_at) ? Math.floor(body.created_at) : now
  if (Math.abs(createdAt - now) > CREATED_AT_SKEW_SECS) throw new Error('created_at out of range')

  return { kind: 1, created_at: createdAt, tags, content: body.content }
}

/** nsec or 64-char hex, to a 32-byte key. Returns null on anything else, which
 *  the caller treats as unconfigured rather than as an error to report. */
export function secretKeyFrom(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  try {
    if (raw.startsWith('nsec1')) {
      const { type, data } = nip19.decode(raw)
      return type === 'nsec' ? data : null
    }
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      const bytes = new Uint8Array(32)
      for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16)
      return bytes
    }
  } catch {}
  return null
}

export async function onRequestPost({ request, env }) {
  const sk = secretKeyFrom(env.BOOSTBOT_NSEC)
  if (!sk) return bad('site signing identity not configured', 503)

  // ⚠️ FAIL CLOSED WITHOUT A RATE LIMITER. An in-memory counter is per-isolate
  // on Cloudflare and is therefore no limit at all — the plan calls that out
  // and it is the reason this refuses to run rather than running unrated. Bind
  // a Rate Limiting binding named SIGN_RATELIMIT on Preview and Production.
  if (!env.SIGN_RATELIMIT || typeof env.SIGN_RATELIMIT.limit !== 'function') {
    return bad('site signing identity not configured', 503)
  }
  // Keyed on the caller's address. CF-Connecting-IP is set by the edge and
  // cannot be spoofed by a client header, unlike X-Forwarded-For.
  const key = request.headers.get('CF-Connecting-IP') || 'unknown'
  try {
    const { success } = await env.SIGN_RATELIMIT.limit({ key })
    if (!success) return bad('too many requests', 429)
  } catch {
    return bad('site signing identity not configured', 503)
  }

  let body
  try { body = await request.json() } catch { return bad('invalid JSON') }

  let template
  try { template = validateBoostTemplate(body) } catch (e) {
    return bad(e instanceof Error ? e.message : 'invalid template')
  }

  const event = finalizeEvent(template, sk)
  // ⚠️ THE BROWSER PUBLISHES IT. This endpoint never touches a relay: an
  // outbound socket per request is a second thing to abuse, and the client
  // already holds the relay set and the publish path.
  return new Response(JSON.stringify({ event }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

// Only POST is exported deliberately. A GET then falls through to the asset
// handler and answers 404, measured under `wrangler pages dev` — NOT the 405
// this comment first claimed. An `onRequest` catch-all returning 405 for other
// methods was written and removed: beside a method-specific handler its
// precedence is easy to get wrong, and 404 on a path that only exists for POST
// is an honest answer.
