/**
 * favorites-sync.js — the writer. One favorite toggled on this site becomes
 * one publish of the member's kind-10333 list, through the spec's cycle:
 * read → merge → publish → record the baseline only when a relay took it.
 *
 * The pieces, each of which lives elsewhere and is only ORCHESTRATED here:
 *
 *   favorites-read.js    the read, and whether it can be believed
 *   favorites-merge.js   `plan`: the spec's reference merge, unchanged
 *   the widget           the signer (`LBLogin.signEvent`) and NIP-44 through
 *                        `LBLogin.getNDK().signer`; never NIP-04
 *   localStorage         the baseline, per pubkey per half, and the member's
 *                        Public/Private choice
 *
 * ONLYBOOSTS IS THE "ADOPT THE LIST" KIND OF WRITER. It has no library of its
 * own: what it renders IS the shared list, so it claims what it renders
 * (rule 2: "you may claim an entry you have adopted and will keep asserting;
 * you may never claim one you are merely carrying"). That is what lets a
 * member unfavorite here something another app added. It also means every
 * cycle starts with a HYDRATE pass: read the list, adopt it, and let `plan`
 * record the claims when the bytes already agree. A removal on a first
 * contact would otherwise be read as "another app's, carry it" and silently
 * not stick.
 *
 * THE MIGRATION GATE (docs/favorites.md). Both shipped apps still write the
 * legacy two-element item and read an item's feed from the entry above. Until
 * both read the three-element form, a reader that does not know it turns an
 * episode favorite into a favorite of the whole show. So `itemsAllowed` is
 * false by default: an item favorite is refused, and so is a publish onto a
 * list holding legacy items, because the merge rewrites them on the way
 * through (vector 27), which is itself a three-element write. Feed and
 * artist favorites are safe now.
 *
 * Every dependency with a side effect is injectable, so the test drives the
 * shipped cycle against scripted relays, a stand-in codec and a real key.
 * Nothing here is reached signed out; the bot cannot hold favorites.
 */
import { readFavorites, readWriteRelays, relaySet, acceptsEvent } from '/assets/js/favorites-read.js?v=ob-v203'
import {
  KIND, plan, parse, parseTags, statedVisibility, decodePlaintext, kindOf, feedIdOf, feedGuidOf,
} from '/assets/js/favorites-merge.js?v=ob-v203'

/**
 * Where a list is published. The read set less relay.mostr.pub, which held a
 * three-day-stale copy on 2026-09-06 and mirrors rather than serves; the
 * member's own NIP-65 write relays are unioned in. Not relay.fountain.fm,
 * which refuses the kind.
 *
 * ⚠️ EVERY RELAY THE OTHER APPS READ AND THAT ACCEPTS THE KIND IS IN HERE.
 * BoostMeBitch reads damus, primal, nos.lol and fountain (and the member's
 * NIP-65 set) and believes the newest copy it hears within a short grace
 * period; a relay in that set we do not write to is a stale copy waiting to
 * win a race. Primal was missing until 2026-09-08 and a favorite made on
 * /show did not reach BMB until it was re-made (Reed's test). StableKraft
 * reads nos.lol, snort, primal, theforest and damus; snort and theforest
 * held nothing on 2026-09-06 and are not yet known to accept the kind.
 */
export const PUBLISH_RELAYS = Object.freeze([
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.ditto.pub',
])

export const PUBLISH_TIMEOUT_MS = 8000
const BASELINE_PREFIX = 'ob-fav-baseline:'
const MODE_PREFIX = 'ob-fav-mode:'
const EMPTY_BASELINE = Object.freeze({ public: [], private: [] })

// ---------------------------------------------------------------------------
// The device's own state: the baseline and the member's choice, per pubkey
// ---------------------------------------------------------------------------

/**
 * The baseline this device last agreed on for `pubkey`, per half. Losing it
 * is safe and guessing is not (rule 2), so anything malformed is empty.
 */
export function loadBaseline(store, pubkey) {
  try {
    const raw = store?.getItem?.(BASELINE_PREFIX + pubkey)
    if (!raw) return { public: [], private: [] }
    const p = JSON.parse(raw)
    const half = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
    return { public: half(p?.public), private: half(p?.private) }
  } catch {
    return { public: [], private: [] }
  }
}

export function saveBaseline(store, pubkey, baseline) {
  try {
    store?.setItem?.(BASELINE_PREFIX + pubkey, JSON.stringify({
      public: baseline?.public ?? [],
      private: baseline?.private ?? [],
    }))
  } catch {}
}

/** 'public' | 'private' | null (never chosen here). Anything else is null. */
export function loadMode(store, pubkey) {
  try {
    const v = store?.getItem?.(MODE_PREFIX + pubkey)
    return v === 'public' || v === 'private' ? v : null
  } catch {
    return null
  }
}

export function saveMode(store, pubkey, mode) {
  try {
    if (mode === 'public' || mode === 'private') store?.setItem?.(MODE_PREFIX + pubkey, mode)
    else store?.removeItem?.(MODE_PREFIX + pubkey)
  } catch {}
}

// ---------------------------------------------------------------------------
// Adopting the list, and changing it
// ---------------------------------------------------------------------------

/**
 * Both halves of the list as `plan`'s local groups: every readable entry,
 * feeds and artists as their own groups, items under their feed's group. The
 * merge's `parse` reads the public tags only, so the private half is parsed
 * here with the same grouping rules (it is a tag array) and adopted beside
 * them: a private entry another app wrote has to be claimed too, or
 * unfavoriting it here never sticks. A legacy item whose feed nobody knows
 * is not adoptable (no group can hold it); `plan` carries it untouched
 * because nothing claims it.
 */
export function adoptLocal(parsed, parsedPrivate = null) {
  const groups = new Map()
  const group = (id, medium) => {
    let g = groups.get(id)
    if (!g) {
      g = { id, medium: medium ?? null, items: [], favorited: false }
      groups.set(id, g)
    }
    return g
  }
  const entries = [...(parsed?.entries ?? []), ...(parsedPrivate?.entries ?? [])]
  for (const e of entries) {
    if (e.kind === 'podcast:publisher:guid') {
      group(e.id, e.medium).favorited = true
    } else if (e.kind === 'podcast:guid') {
      group(e.id, e.medium).favorited = true
    } else if (e.kind === 'podcast:item:guid') {
      if (!e.feed) continue
      const g = group(feedIdOf(e.feed), e.medium)
      if (!g.items.includes(e.id)) g.items.push(e.id)
    }
  }
  return [...groups.values()]
}

/**
 * One change to the adopted list.
 *
 *   { op: 'add'|'remove', kind: 'feed'|'artist', id, medium }
 *   { op: 'add'|'remove', kind: 'item', feedId, itemId, medium }
 *
 * `id`/`feedId` are full NIP-73 identifiers (`podcast:guid:…`,
 * `podcast:publisher:guid:…`), `itemId` is `podcast:item:guid:…`. Returns a
 * new local array; the input is not mutated.
 */
export function applyChange(local, change) {
  const out = (local ?? []).map((g) => ({ ...g, items: [...(g.items ?? [])] }))
  const find = (id) => out.find((g) => g.id === id)
  if (change.kind === 'feed' || change.kind === 'artist') {
    let g = find(change.id)
    if (change.op === 'add') {
      if (!g) { g = { id: change.id, medium: change.medium ?? null, items: [], favorited: true }; out.push(g) }
      g.favorited = true
      if (change.medium && !g.medium) g.medium = change.medium
    } else if (g) {
      g.favorited = false
    }
  } else if (change.kind === 'item') {
    let g = find(change.feedId)
    if (change.op === 'add') {
      if (!g) { g = { id: change.feedId, medium: change.medium ?? null, items: [], favorited: false }; out.push(g) }
      if (!g.items.includes(change.itemId)) g.items.push(change.itemId)
      if (change.medium && !g.medium) g.medium = change.medium
    } else if (g) {
      g.items = g.items.filter((id) => id !== change.itemId)
    }
  }
  // A group holding nothing contributes nothing; drop it so the local set
  // says what it means.
  return out.filter((g) => g.favorited === true || g.items.length > 0)
}

/** What the change wants, for the gate and the UI. */
export function validateChange(change) {
  if (!change || (change.op !== 'add' && change.op !== 'remove')) return 'bad-op'
  if (change.kind === 'feed') return kindOf(change.id) === 'podcast:guid' ? null : 'bad-id'
  if (change.kind === 'artist') return kindOf(change.id) === 'podcast:publisher:guid' ? null : 'bad-id'
  if (change.kind === 'item') {
    if (kindOf(change.feedId) !== 'podcast:guid') return 'bad-id'
    if (kindOf(change.itemId) !== 'podcast:item:guid') return 'bad-id'
    return null
  }
  return 'bad-kind'
}

/** Does either half still hold a legacy two-element item? A publish would rewrite it. */
export function holdsLegacyItems(parsed, parsedPrivate = null) {
  const legacy = (e) => e.kind === 'podcast:item:guid' && e.legacy === true
  return (parsed?.entries ?? []).some(legacy) || (parsedPrivate?.entries ?? []).some(legacy)
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Send one signed event to each relay and wait for its OK. Resolves (never
 * rejects) to `{ landed, relays }`: `landed` is at least one `OK true`, which
 * is what allows the baseline to be recorded (rule 2). A relay that answers
 * `OK false` reports its reason; one that never answers is `timeout`.
 */
export function publishEvent(signed, relays, {
  connect = (url) => new WebSocket(url),
  timeoutMs = PUBLISH_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const one = (url) => new Promise((resolve) => {
    const t0 = now()
    let settled = false
    let opened = false
    let ws
    const finish = (status, reason) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws?.close?.() } catch {}
      resolve({ url, status, ms: now() - t0, ...(reason ? { reason } : {}) })
    }
    const timer = setTimeout(() => finish(opened ? 'timeout' : 'unreachable'), timeoutMs)
    try { ws = connect(url) } catch { finish('unreachable'); return }
    ws.addEventListener('open', () => {
      opened = true
      try { ws.send(JSON.stringify(['EVENT', signed])) } catch { finish('timeout') }
    })
    ws.addEventListener('message', (m) => {
      let msg
      try { msg = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data)) } catch { return }
      if (!Array.isArray(msg) || msg[0] !== 'OK' || msg[1] !== signed.id) return
      if (msg[2] === true) finish('ok')
      else finish('rejected', String(msg[3] ?? ''))
    })
    ws.addEventListener('error', () => finish(opened ? 'timeout' : 'unreachable'))
    ws.addEventListener('close', () => finish(opened ? 'timeout' : 'unreachable'))
  })
  return Promise.all(relays.map(one)).then((rows) => ({
    landed: rows.some((r) => r.status === 'ok'),
    relays: rows,
  }))
}

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

/**
 * The signer-side dependencies, as production wires them off the widget. A
 * signer without NIP-44 gets `canDecrypt: false` and `encrypt: null`: it
 * carries the private half and cannot write into it, and says so on screen.
 * NIP-04 is never used here; the spec's private half is NIP-44 and a NIP-04
 * ciphertext would read as opaque to every other app.
 */
export async function widgetDeps(LBLogin) {
  const user = LBLogin?.getUser?.()
  const pubkey = user?.pubkey ?? null
  if (!pubkey) return { pubkey: null }
  const ndk = LBLogin.getNDK?.()
  const signer = ndk?.signer ?? null
  const me = ndk?.getUser?.({ pubkey }) ?? null
  let nip44 = false
  try {
    if (signer && typeof signer.encrypt === 'function') {
      if (typeof signer.encryptionEnabled === 'function') {
        const list = await signer.encryptionEnabled('nip44')
        nip44 = Array.isArray(list) ? list.includes('nip44') : true
      } else nip44 = true
    }
  } catch { nip44 = false }
  return {
    pubkey,
    sign: (template) => LBLogin.signEvent(template),
    canDecrypt: nip44,
    decrypt: nip44 ? (content) => signer.decrypt(me, content, 'nip44') : null,
    encrypt: nip44 ? (text) => signer.encrypt(me, text, 'nip44') : null,
  }
}

/**
 * Read the list for rendering. Decrypts the private half when `deps.decrypt`
 * is given (the viewer's own list); a foreign list's private half stays
 * opaque. Resolves to `{ trusted, event, entries, parsed, parsedPrivate,
 * readPrivate, relays }`: `entries` is both halves in one array, each entry
 * carrying `half: 'public' | 'private'`; `parsed` is null on an untrusted
 * read, `parsedPrivate` null when the half could not be opened.
 */
export async function fetchFavorites(pubkey, deps = {}) {
  const extra = await safeWriteRelays(pubkey, deps)
  const r = await readFavorites(pubkey, readOptions(deps, extra))
  if (!r.trusted) return { trusted: false, event: r.event, entries: [], parsed: null, parsedPrivate: null, readPrivate: null, relays: r.relays }
  const readPrivate = await openPrivateHalf(r.read.content, deps)
  const parsed = parse(r.read, readPrivate)
  const parsedPrivate = readPrivate ? parseTags(readPrivate) : null
  const entries = [
    ...parsed.entries.map((e) => ({ ...e, half: 'public' })),
    ...(parsedPrivate?.entries ?? []).map((e) => ({ ...e, half: 'private' })),
  ]
  return { trusted: true, event: r.event, entries, parsed, parsedPrivate, readPrivate, relays: r.relays, read: r.read }
}

/**
 * One toggle, start to finish. Resolves (never rejects) to `{ status, … }`:
 *
 *   signed-out     no pubkey
 *   bad-change     the change does not name valid identifiers
 *   items-gated    an item favorite, or a list holding legacy items, before
 *                  both shipped apps read the three-element form
 *   degraded       the read cannot be trusted; nothing published
 *   needs-mode     the list has no visibility tag and cannot say which half
 *                  it lives in, and this member has not chosen: ask them,
 *                  then call again with `userChose: true`
 *   no-nip44       the publish needs the private half and this signer cannot
 *                  encrypt it
 *   unchanged      the bytes already say this; baseline recorded
 *   not-landed     signed, sent, no relay accepted it; baseline NOT recorded
 *   published      landed; baseline recorded
 *
 * `deps`: { pubkey, sign, canDecrypt, decrypt, encrypt } from `widgetDeps`,
 * plus `store` (localStorage), and optionally `connect`, `verify`, `now`,
 * `readRelays`, `publishRelays`, `itemsAllowed`, `mode`, `userChose`.
 */
export async function syncFavorites(change, deps) {
  const { pubkey, store } = deps ?? {}
  if (!pubkey) return { status: 'signed-out' }
  if (change) {
    const why = validateChange(change)
    if (why) return { status: 'bad-change', reason: why }
    if (change.kind === 'item' && change.op === 'add' && !deps.itemsAllowed) return { status: 'items-gated' }
  }

  const extra = await safeWriteRelays(pubkey, deps)
  const r = await readFavorites(pubkey, readOptions(deps, extra))
  if (!r.trusted) return { status: 'degraded', relays: r.relays }

  const canReadPrivate = !!deps.canDecrypt
  const readPrivate = await openPrivateHalf(r.read.content, deps)
  const parsed = parse(r.read, readPrivate)
  const parsedPrivate = readPrivate ? parseTags(readPrivate) : null
  const adopted = adoptLocal(parsed, parsedPrivate)

  if (!deps.itemsAllowed && holdsLegacyItems(parsed, parsedPrivate)) return { status: 'items-gated', reason: 'legacy-on-list' }

  const mode = deps.mode !== undefined ? deps.mode : loadMode(store, pubkey)
  const userChose = !!deps.userChose
  const stated = statedVisibility(r.read.tags)
  const hasPublic = r.read.tags.some((t) => t[0] === 'i')
  const hasPrivate = (readPrivate ?? []).some((t) => t[0] === 'i')
  const listMode = stated ?? (hasPublic && !hasPrivate ? 'public' : hasPrivate && !hasPublic ? 'private' : null)
  if (mode === null && listMode === null) return { status: 'needs-mode' }

  const common = { read: r.read, mode, canReadPrivate, userChose, readPrivate }

  // HYDRATE: adopt what is there and record the claims when the bytes agree.
  let baseline = loadBaseline(store, pubkey)
  const hydrate = plan({ ...common, local: adopted, baseline })
  if (hydrate.publish === null) {
    baseline = hydrate.baselineIfLanded
    saveBaseline(store, pubkey, baseline)
  }
  if (!change) {
    if (hydrate.publish === null) return { status: 'unchanged', event: r.event }
    // The list itself wants a rewrite (a legacy tag, a migration). Publish it.
  }

  const local = change ? applyChange(adopted, change) : adopted
  const result = plan({ ...common, local, baseline })
  if (result.publish === null) {
    saveBaseline(store, pubkey, result.baselineIfLanded)
    return { status: 'unchanged', event: r.event }
  }

  let content = result.publish.content
  if (content === null) {
    if (typeof deps.encrypt !== 'function') return { status: 'no-nip44' }
    try { content = await deps.encrypt(result.publish.privatePlaintext) } catch (e) { return { status: 'no-nip44', reason: String(e?.message ?? e) } }
    if (typeof content !== 'string' || !content) return { status: 'no-nip44' }
  }

  const template = {
    kind: KIND,
    tags: result.publish.tags,
    content,
    created_at: Math.floor((deps.now?.() ?? Date.now()) / 1000),
  }
  let signed
  try { signed = await deps.sign(template) } catch (e) { return { status: 'sign-failed', reason: String(e?.message ?? e) } }
  if (!acceptsEvent(pubkey, signed, deps.verify ?? defaultVerify)) return { status: 'sign-failed', reason: 'signer returned an event this member did not sign' }

  const relays = relaySet(deps.publishRelays ?? PUBLISH_RELAYS, extra)
  const sent = await publishEvent(signed, relays, { connect: deps.connect, now: deps.now, timeoutMs: deps.publishTimeoutMs })
  if (!sent.landed) return { status: 'not-landed', event: signed, relays: sent.relays }

  saveBaseline(store, pubkey, result.baselineIfLanded)
  return { status: 'published', event: signed, relays: sent.relays, mode: mode ?? listMode }
}

// ---------------------------------------------------------------------------

const defaultVerify = (ev) => !!ev && typeof ev.sig === 'string' && typeof ev.id === 'string'

function readOptions(deps, extra) {
  const o = { extraRelays: extra }
  if (deps.readRelays) o.relays = deps.readRelays
  if (deps.connect) o.connect = deps.connect
  if (deps.verify) o.verify = deps.verify
  if (deps.now) o.now = deps.now
  if (deps.readTimeoutMs) o.timeoutMs = deps.readTimeoutMs
  return o
}

async function safeWriteRelays(pubkey, deps) {
  if (deps.writeRelays === false) return []
  try { return await readWriteRelays(pubkey, readOptions(deps, [])) } catch { return [] }
}

/**
 * The private half as `plan` wants it: `[]` for no content, a tag array when
 * this signer opened it, NULL when it could not (no NIP-44, a foreign list,
 * a signer error, or bytes that are not a tag array), which `plan` carries.
 */
async function openPrivateHalf(content, deps) {
  if (!content) return []
  if (typeof deps.decrypt !== 'function') return null
  try {
    const text = await deps.decrypt(content)
    if (typeof text !== 'string') return null
    return decodePlaintext(text)
  } catch {
    return null
  }
}

export { feedGuidOf }
