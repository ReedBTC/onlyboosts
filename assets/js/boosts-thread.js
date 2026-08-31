/* Shared boost-thread read renderer.
 *
 * Loads + renders the boost mega-thread (kind-1 root + descendants) for any
 * page that wants to display it: /boosts.html in full, or /ep### filtered to
 * a single episode's boosts. Only the boost notes (direct children of the
 * root) are rendered — replies to those boosts are never shown.
 *
 * This module is read-only on purpose. Mutation (reply, like, repost, zap) is
 * page-specific and stays in /boosts.html — it consumes this module's
 * `actionsBuilder` hook to inject per-card buttons.
 *
 * Vendored nostr-tools — same bundle the rest of the site uses. Module-level
 * caches (profile/embed/calendar/card) are intentionally process-global so a
 * follow-up reply on /boosts.html can rerender the tree without losing
 * already-fetched profile data, and so the same DOM nodes get reused across
 * mutating repaints.
 */
import { nip19 } from '/assets/widgets/nostr-tools.js?v=ob-v167'
// Primal profile lookup lives in its own module so /show pages can use it
// without importing this one. See primal-profiles.js.
import { fetchProfilesFromPrimal } from '/assets/js/primal-profiles.js?v=ob-v167'
/* ⚠️ THE TWO NIP-52 KINDS, INLINED, AND THAT IS THE WHOLE OF WHAT IS LEFT OF
 * THE CALENDAR PATH. This module used to import four things from
 * calendar-events.js and render a rich card for a calendar event quoted inside
 * a boost message. The card could never appear on this fork: the only writer of
 * the cache it read was `fetchBoostThread`, LB's own megathread fetch, which
 * has had no caller since the fork — so the branch fell through to the naddr
 * chip on every note, every time. Deleted 2026-08-23 along with that fetch, and
 * `assets/js/calendar-events.js` (24KB, precached) went with it.
 *
 * What is NOT lost is the chip's own reading of these two kinds: a quoted
 * calendar event still links out as "📅 Linked event on Nostr →" rather than as
 * an article. That is the behaviour readers actually had, and it needs two
 * integers rather than a module. */
const KIND_DATE_EVENT = 31922
const KIND_TIME_EVENT = 31923

// ── Config ───────────────────────────────────────────────────────────


// Two jobs, one list: kind-1 boost threads and (via the re-export below)
// kind-3 contact lists for the Follows feeds. It is their UNION rather than
// two constants, because four sockets are cheap and two exported sets are a
// seam someone eventually imports the wrong half of.
//
// Chosen by measurement, 2026-08-12, over the 61 distinct boosters behind the
// 100 most recent boosts — coverage per relay, kind 1 / kind 3:
//   relay.fountain.fm  98% / 4%     ← no general relay clears 44% on kind 1
//   nos.lol            44% / 75%
//   relay.mostr.pub    44% / 47%    ← the +1 that takes kind 1 to 100%
//   relay.ditto.pub    32% / 67%
// Dropped: relay.nostr.band answered 0% on every kind tested, and
// relay.primal.net 29% / 18% while adding nothing the others don't hold.
//
// ⚠️ relay.fountain.fm does not EOSE on an UNFILTERED kind-1 REQ. Every live
// consumer here filters by author, id or #e, which it answers normally; keep
// it that way, and note `fetchThreadNotesFromRelays` is unbounded (it is dead
// LB thread code, and would need a timeout before it were revived).
const STATIC_RELAYS = [
  'wss://relay.ditto.pub',
  'wss://nos.lol',
  'wss://relay.fountain.fm',
  'wss://relay.mostr.pub',
]
export { STATIC_RELAYS }


// ── Module state ─────────────────────────────────────────────────────
// Caches survive multiple `fetchBoostThread` calls so subsequent paints
// (e.g. after an optimistic reply insert) skip re-fetching profiles.
const profileCache  = new Map()  // pubkey hex → { pubkey, name, picture, nip05, lud16, lud06 }
const embedCache    = new Map()  // event id hex → kind-1 event (or null = not found)

// Page-supplied callback that returns a per-card action bar (Reply/Like/
// Repost/Zap on /boosts.html, null on /ep### read-only pages).
let actionsBuilder = null

export function configureBoostsThread({ actionsBuilder: builder = null } = {}) {
  actionsBuilder = typeof builder === 'function' ? builder : null
}

// ── Generic helpers ──────────────────────────────────────────────────
function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 60)      return `${sec}s ago`
  if (sec < 3600)    return `${Math.floor(sec/60)}m ago`
  if (sec < 86400)   return `${Math.floor(sec/3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec/86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

// ── Profile cache management ─────────────────────────────────────────
// Bidi-control chars get stripped from displayable text so a hostile profile
// can't visually impersonate another user via RLO/LRI tricks.
const PROFILE_BIDI = /[‪-‮⁦-⁩]/g
function cleanProfileText(s) {
  if (typeof s !== 'string' || !s) return s || ''
  return s.replace(PROFILE_BIDI, '')
}

export function setCachedProfile(pubkey, raw) {
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) return
  const safe = {
    pubkey,
    name:    cleanProfileText(raw?.name)    || null,
    picture: isSafeUrl(raw?.picture) ? raw.picture : null,
    nip05:   cleanProfileText(raw?.nip05)   || null,
    lud16:   typeof raw?.lud16 === 'string' ? raw.lud16 : null,
    lud06:   typeof raw?.lud06 === 'string' ? raw.lud06 : null,
  }
  profileCache.set(pubkey, safe)
}

export function getCachedProfile(pubkey) {
  return profileCache.get(pubkey) || null
}

// ── Event + card cache management ────────────────────────────────────
export function registerEvent(ev) {
  if (ev && typeof ev.id === 'string') embedCache.set(ev.id, ev)
}

// ── Content parsing ──────────────────────────────────────────────────
const NOSTR_URI_RE = /nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+)/gi
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

function parseSegments(content) {
  if (!content) return [{ type: 'text', value: '' }]
  const tokens = []

  // Nostr URIs first — npub/nprofile become 'mention', note/nevent/naddr
  // become 'note_embed'. Decoding failures degrade to a plain text token.
  for (const m of content.matchAll(NOSTR_URI_RE)) {
    const raw = m[1]
    const tok = { start: m.index, end: m.index + m[0].length, value: m[0], data: { bech32: raw } }
    try {
      const decoded = nip19.decode(raw)
      tok.data.decoded = decoded
      if (decoded.type === 'npub') {
        tok.type = 'mention'
        tok.data.pubkey = decoded.data
      } else if (decoded.type === 'nprofile') {
        tok.type = 'mention'
        tok.data.pubkey = decoded.data.pubkey
      } else if (decoded.type === 'note') {
        tok.type = 'note_embed'
        tok.data.eventId = decoded.data
      } else if (decoded.type === 'nevent') {
        tok.type = 'note_embed'
        tok.data.eventId = decoded.data.id
        tok.data.author  = decoded.data.author || null
      } else if (decoded.type === 'naddr') {
        tok.type = 'note_embed'
        tok.data.addressable = true
        tok.data.naddr = decoded.data
      } else {
        tok.type = 'text'
      }
    } catch {
      tok.type = 'text'
    }
    tokens.push(tok)
  }

  // URLs that don't overlap a nostr URI.
  for (const m of content.matchAll(URL_RE)) {
    if (tokens.some(t => m.index >= t.start && m.index < t.end)) continue
    tokens.push({
      type: 'link',
      start: m.index, end: m.index + m[0].length,
      value: m[0], data: { url: m[0] },
    })
  }

  tokens.sort((a, b) => a.start - b.start)

  const segments = []
  let cursor = 0
  for (const tok of tokens) {
    if (tok.start > cursor) segments.push({ type: 'text', value: content.slice(cursor, tok.start) })
    segments.push({ type: tok.type, value: tok.value, data: tok.data })
    cursor = tok.end
  }
  if (cursor < content.length) segments.push({ type: 'text', value: content.slice(cursor) })

  return segments.length ? segments : [{ type: 'text', value: content }]
}

function renderSegmentsInto(el, segments, opts = {}) {
  for (const seg of segments) {
    if (seg.type === 'text') {
      el.appendChild(document.createTextNode(seg.value))
    } else if (seg.type === 'link') {
      const url = seg.data?.url || seg.value
      if (isSafeUrl(url)) {
        const a = document.createElement('a')
        a.href = url
        a.textContent = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        el.appendChild(a)
      } else {
        el.appendChild(document.createTextNode(url))
      }
    } else if (seg.type === 'mention') {
      el.appendChild(buildMentionEl(seg))
    } else if (seg.type === 'note_embed') {
      if (opts.inEmbed) {
        // No nested embeds — degrade to a chip that links to njump.
        el.appendChild(buildEmbedChip(seg))
      } else {
        el.appendChild(buildEmbedNoteEl(seg))
      }
    } else {
      el.appendChild(document.createTextNode(seg.value || ''))
    }
  }
}

// Exposed for other read-only renderers (e.g. the Podcast Boosts feed) that
// want to show verbatim community text with the same safe, tokenized
// treatment used here — nostr: mentions become chips, URLs become links,
// and everything else is a plain text node (never innerHTML). Callers that
// don't render a full note tree should pass { inEmbed: true } so a quoted
// note degrades to a chip instead of triggering an embed fetch.
export { parseSegments, renderSegmentsInto }

function buildMentionEl(seg) {
  const profile = seg.data.pubkey ? profileCache.get(seg.data.pubkey) : null

  // Link by a clean npub whenever we have the pubkey: njump resolves an
  // npub reliably, whereas a bulky nprofile (relay hints baked in) — or an
  // empty identifier — opens a blank page. That blank tab was the bug.
  let ident = seg.data.bech32 || (seg.value || '').replace(/^nostr:/i, '')
  if (seg.data.pubkey) {
    try { ident = nip19.npubEncode(seg.data.pubkey) } catch {}
  }
  const label = profile?.name ? '@' + profile.name : '@' + (ident ? ident.slice(0, 14) + '…' : 'user')

  // Nothing usable to point at → render the name as plain text, not a dead
  // link that opens an empty tab.
  if (!ident) {
    const span = document.createElement('span')
    span.className = 'nostr-mention'
    span.textContent = label
    return span
  }

  const a = document.createElement('a')
  a.className = 'nostr-mention'
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.href = `https://njump.me/${ident}`
  a.textContent = label
  if (profile?.name && profile.nip05) a.title = profile.nip05
  return a
}

function buildEmbedChip(seg) {
  const a = document.createElement('a')
  a.className = 'nostr-mention'
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.href = `https://njump.me/${seg.data.bech32 || seg.value.replace(/^nostr:/i, '')}`
  a.textContent = '@' + (seg.data.bech32 || seg.value).slice(0, 14) + '…'
  return a
}

function buildEmbedNoteEl(seg) {
  const card = document.createElement('div')
  card.className = 'embed-note'

  // naddr (long-form, calendar event, etc.) — NIP-52 calendar events
  // get a rich inline card; every other addressable kind falls back to
  // a chip linking out.
  if (seg.data.addressable) {
    const naddrKind = seg.data.naddr?.kind
    const isCalendar = naddrKind === KIND_DATE_EVENT || naddrKind === KIND_TIME_EVENT
    card.classList.add('is-naddr')
    const link = document.createElement('a')
    if (isCalendar) {
      link.href = `https://mynostr.app/${seg.data.bech32}`
      link.textContent = '📅 Linked event on Nostr →'
    } else {
      link.href = `https://njump.me/${seg.data.bech32}`
      link.textContent = '📄 Linked article on Nostr →'
    }
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    card.appendChild(link)
    return card
  }

  const ev = seg.data.eventId ? embedCache.get(seg.data.eventId) : null
  if (!ev) {
    card.classList.add('is-missing')
    card.appendChild(document.createTextNode('Quoted note not available'))
    const link = document.createElement('a')
    link.href = `https://njump.me/${seg.data.bech32}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'View on Nostr →'
    card.appendChild(link)
    return card
  }

  const authorRow = document.createElement('div')
  authorRow.className = 'embed-author'
  const profile = profileCache.get(ev.pubkey)

  const img = document.createElement('img')
  img.src = profile?.picture || '/assets/avatar-fallback.svg'
  img.alt = ''
  img.referrerPolicy = 'no-referrer'
  img.onerror = () => { img.src = '/assets/avatar-fallback.svg' }
  authorRow.appendChild(img)

  const nameEl = document.createElement('span')
  nameEl.className = 'author-name'
  nameEl.textContent = profile?.name || (ev.pubkey.slice(0, 8) + '…')
  authorRow.appendChild(nameEl)

  const time = document.createElement('time')
  time.dateTime = new Date(ev.created_at * 1000).toISOString()
  time.textContent = relTime(ev.created_at)
  time.title = new Date(ev.created_at * 1000).toLocaleString()
  authorRow.appendChild(time)

  card.appendChild(authorRow)

  const body = document.createElement('div')
  body.className = 'embed-body'
  const text = ev.content || ''
  const snippet = text.length > 600 ? text.slice(0, 600) + '…' : text
  renderSegmentsInto(body, parseSegments(snippet), { inEmbed: true })
  card.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'embed-footer'
  let nevent = ''
  try { nevent = nip19.neventEncode({ id: ev.id, author: ev.pubkey }) } catch {}
  if (nevent) {
    const link = document.createElement('a')
    link.href = `https://njump.me/${nevent}`
    link.textContent = 'View on Nostr →'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    footer.appendChild(link)
  }
  card.appendChild(footer)

  return card
}

function renderContentInto(el, text) {
  renderSegmentsInto(el, parseSegments(text))
}

// ── Profile parsing ──────────────────────────────────────────────────

// ── Primal cache: thread + event lookups ─────────────────────────────
// The profile half of this moved to primal-profiles.js (the show pages need it
// without the rest of this module). These two stay here: they are thread
// machinery, and nothing outside this file asks for them.
// Re-exported so existing importers (feeds-podcasts.js) keep working; the
// implementation now lives in primal-profiles.js.
export { fetchProfilesFromPrimal }

// ── Direct-relay fetch (untrusted source — verify everything) ────────
// Runs alongside Primal, not just as a fallback: relays are the
// completeness backstop for the note set (see fetchBoostThread).
// Author profiles normally come from Primal's thread_view response; this
// only runs when Primal was unreachable, so cards still get display
// names + avatars instead of bare npubs.
// ── Card renderer ────────────────────────────────────────────────────
export function renderNoteCard(ev, { isRoot = false } = {}) {
  const profile = profileCache.get(ev.pubkey)
  const card = document.createElement('article')
  card.className = 'note-card' + (isRoot ? ' is-root' : '')

  const authorRow = document.createElement('div')
  authorRow.className = 'note-author'

  const img = document.createElement('img')
  img.src = profile?.picture || '/assets/avatar-fallback.svg'
  img.alt = ''
  img.referrerPolicy = 'no-referrer'
  img.onerror = () => { img.src = '/assets/avatar-fallback.svg' }
  authorRow.appendChild(img)

  const nameWrap = document.createElement('div')
  nameWrap.style.display = 'flex'
  nameWrap.style.flexDirection = 'column'
  nameWrap.style.minWidth = '0'

  const nameEl = document.createElement('span')
  nameEl.className = 'author-name'
  nameEl.textContent = profile?.name || (ev.pubkey.slice(0, 8) + '…')
  nameWrap.appendChild(nameEl)

  if (profile?.nip05) {
    const handle = document.createElement('span')
    handle.className = 'author-handle'
    handle.textContent = profile.nip05
    nameWrap.appendChild(handle)
  }
  authorRow.appendChild(nameWrap)

  const time = document.createElement('time')
  time.dateTime = new Date(ev.created_at * 1000).toISOString()
  time.textContent = relTime(ev.created_at)
  time.title = new Date(ev.created_at * 1000).toLocaleString()
  authorRow.appendChild(time)

  card.appendChild(authorRow)

  const body = document.createElement('div')
  body.className = 'note-body'
  renderContentInto(body, ev.content)
  card.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'note-footer'
  let nevent = ''
  try { nevent = nip19.neventEncode({ id: ev.id, author: ev.pubkey }) } catch {}
  if (nevent) {
    const link = document.createElement('a')
    link.href = `https://njump.me/${nevent}`
    link.textContent = 'View on Nostr →'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    footer.appendChild(link)
  }
  card.appendChild(footer)

  // Per-card actions (Reply/Like/Repost/Zap) injected by the host page.
  // Skipped on the root card and skipped entirely on read-only pages.
  if (!isRoot && typeof actionsBuilder === 'function') {
    const bar = actionsBuilder(ev, card)
    if (bar) card.appendChild(bar)
  }

  return card
}

