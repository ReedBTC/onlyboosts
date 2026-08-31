/* Follow-set resolution — the "whose" half of the four feeds.
 *
 * OnlyBoosts' Follows feeds are scoped to the signed-in user's own kind-3
 * contact list. This module is the direct replacement for localbitcoiners'
 * supporter-set.js, which resolved a fixed set (the union of p-tags across
 * the show's follow packs) that was the same for every visitor. Here the set
 * is per-user, so nothing can be resolved until someone signs in.
 *
 * Deliberately does NOT load the login widget. The widget is ~1MB and its job
 * is signing; all we need is the pubkey of whoever is already signed in, and
 * that's sitting in localStorage. Reading it directly means the Follows tabs
 * can resolve on a cold load without paying for the bundle.
 */
import { SimplePool, verifyEvent } from '/assets/widgets/nostr-tools.js?v=ob-v172'
import { STATIC_RELAYS } from '/assets/js/boosts-thread.js?v=ob-v172'

// Written by the login widget (login-widget/src/lib/sessionPersistence.js).
// If that key ever changes there, this breaks silently — the Follows tabs
// would just report "signed out" for a signed-in user.
const SESSION_KEY = 'lb_nostr_session'

const CACHE_KEY = 'ob_follows_v1'
const CACHE_MAX_AGE_MS = 30 * 60 * 1000   // 30 min
const FETCH_TIMEOUT_MS = 6000

const isHexPubkey = (pk) => typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk)

/**
 * Hex pubkey of the signed-in user, or null. Cheap and synchronous — safe to
 * call on every render to decide between the feed and the "sign in" state.
 *
 * Two sources, in order:
 *  1. the persisted session in localStorage — works on a cold load, before
 *     the login widget has been fetched;
 *  2. the widget's in-memory user, *if* the bundle happens to be loaded.
 *
 * (2) is not redundant: an nsec login is deliberately never persisted (the
 * key stays in memory for the tab's lifetime — see LoginScreen.jsx), so
 * localStorage is empty for a user who is very much signed in. Without this
 * fallback the Follows tabs tell them to sign in while their npub is right
 * there in the nav. Reading `window.LBLogin` is free; this must never *load*
 * the widget, which is the whole reason this module exists.
 */
export function getSessionPubkey() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) {
      const pk = JSON.parse(raw)?.pubkey
      if (isHexPubkey(pk)) return pk.toLowerCase()
    }
  } catch {}
  try {
    const pk = window.LBLogin?.getUser?.()?.pubkey
    if (isHexPubkey(pk)) return pk.toLowerCase()
  } catch {}
  return null
}

// Cache is keyed by pubkey so switching accounts can't serve the previous
// user's follow list. Same "never cache an empty result" rule as
// supporter-set.js: one relay hiccup returning nothing would otherwise poison
// the cache and show a signed-in user an empty feed for the next 30 minutes.
function readCache(pubkey) {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p?.pubkey !== pubkey) return null
    if (!Array.isArray(p?.follows) || !p.follows.length) return null
    if (!Number.isFinite(p.savedAt) || Date.now() - p.savedAt > CACHE_MAX_AGE_MS) return null
    return p.follows
  } catch { return null }
}

function writeCache(pubkey, follows) {
  if (!Array.isArray(follows) || !follows.length) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      pubkey, follows, savedAt: Date.now(),
    }))
  } catch {}
}

/** Drop the cached list — call on sign-out or account switch. */
export function clearFollowCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}

/**
 * Newest kind-3 for `pubkey` across the static relay set.
 *
 * Relays are queried together and the highest created_at wins: a stale replica
 * on one relay would otherwise silently truncate the user's follow list. The
 * whole thing is bounded by FETCH_TIMEOUT_MS — the feed degrades to "couldn't
 * load" rather than hanging on an unreachable relay.
 */
async function fetchContactList(pubkey) {
  const pool = new SimplePool()
  try {
    const events = await Promise.race([
      pool.querySync(STATIC_RELAYS, { kinds: [3], authors: [pubkey], limit: 8 }),
      new Promise((resolve) => setTimeout(() => resolve([]), FETCH_TIMEOUT_MS)),
    ])
    let newest = null
    for (const ev of (events || [])) {
      if (ev?.kind !== 3 || ev.pubkey !== pubkey) continue
      if (newest && ev.created_at <= newest.created_at) continue
      // Only verify the candidate we're about to accept — verifying every
      // replica is wasted signature math on identical events.
      if (!verifyEvent(ev)) continue
      newest = ev
    }
    return newest
  } finally {
    try { pool.close(STATIC_RELAYS) } catch {}
  }
}

/**
 * Resolve the signed-in user's follow set.
 *
 * @returns {Promise<{ status: string, pubkey: string|null, follows: string[] }>}
 *   status is one of:
 *     'signed-out'  — nobody signed in; caller should show the sign-in prompt
 *     'ok'          — follows[] is populated
 *     'empty'       — signed in, kind-3 found, but it follows nobody
 *     'unavailable' — signed in but no kind-3 could be fetched (relay trouble)
 *
 * The user's own pubkey is included in `follows`, so your own boosts appear in
 * your Follows feed. That matches what most Nostr clients do and avoids the
 * confusing case where you boost something and it doesn't show up.
 */
export async function resolveFollows() {
  const pubkey = getSessionPubkey()
  if (!pubkey) return { status: 'signed-out', pubkey: null, follows: [] }

  const cached = readCache(pubkey)
  if (cached) return { status: 'ok', pubkey, follows: cached }

  let ev = null
  try {
    ev = await fetchContactList(pubkey)
  } catch (e) {
    console.warn('[follows] contact-list fetch failed', e)
    return { status: 'unavailable', pubkey, follows: [] }
  }
  if (!ev) return { status: 'unavailable', pubkey, follows: [] }

  const set = new Set([pubkey])
  for (const t of (ev.tags || [])) {
    if (t?.[0] !== 'p') continue
    const hex = typeof t[1] === 'string' ? t[1].toLowerCase() : ''
    if (/^[0-9a-f]{64}$/.test(hex)) set.add(hex)
  }
  // size 1 == self only, i.e. the kind-3 carried no p-tags.
  if (set.size <= 1) return { status: 'empty', pubkey, follows: [...set] }

  const follows = [...set]
  writeCache(pubkey, follows)
  return { status: 'ok', pubkey, follows }
}
