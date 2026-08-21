/* Feed hydration for the homepage's feeds.
 *
 * Which feed is on screen is picked by the two dropdowns in the sticky feed
 * bar — what (Episodes / Shows / Songs / Albums / Boosts) x whose (Global /
 * Follows). Scoping: "Global" is unscoped; "Follows" is the signed-in user's
 * own kind-3 contact list, resolved by follow-set.js. Shows and Albums are
 * Global-only for now.
 *
 * Every feed has a loader (see LOADERS at the bottom); each lazy-imports its
 * renderer on first view. All of them read the collector's published feed
 * through ob-data.js (/api/data/*) — boosts-feed.js renders the boost notes
 * themselves, feeds-podcasts.js the per-episode rollup, shows-feed.js the
 * per-show one.
 *
 * Two renderers, five what-options: Episodes and Songs are the same
 * episode-level rollup, Shows and Albums the same show-level one, split on
 * <podcast:medium>. A "music" feed's items are tracks on an album; everything
 * else is episodes of a show. That's the `medium` argument threaded through
 * hydrate() below; it becomes a medium=music / not_medium=music query
 * parameter on /api/v1/episodes and /api/v1/podcasts, so the server answers
 * already split. The Boosts feeds take no medium: a boost note is a boost
 * note, so they stay the unsplit firehose.
 *
 * The Events / Marketplace / Articles feeds and their modules were removed on
 * fork. What's left of the Events path below — loadEvents, the supporter-set
 * import, the calendar machinery — is unreachable (LOADERS doesn't map it)
 * and retained only because boosts-thread.js still imports calendar-events.js
 * to render calendar-event quotes embedded in boost notes. That circular
 * import is what makes removing it fiddly; see CLAUDE.md.
 *
 * Feeds load lazily: a feed's fetch only fires the first time it becomes
 * active (driven by the `lb:feed-activate` event dispatched from the inline
 * feed-bar controller in index.html, plus a load of whichever feed is active
 * when this module first runs).
 */
import { STATIC_RELAYS, fetchProfilesFromPrimal } from '/assets/js/boosts-thread.js?v=ob-v96'
import {
  parseCalendarEvent,
  renderCalendarCard,
  fetchCalendarEventsFromRelays,
  eventStartMs,
  eventEndMs,
  readPendingPromote,
  clearPendingPromote,
  KIND_DATE_EVENT,
  KIND_TIME_EVENT,
} from '/assets/js/calendar-events.js?v=ob-v96'
import { SimplePool, verifyEvent, nip19 } from '/assets/widgets/nostr-tools.js?v=ob-v96'
// Supporter-set resolution lives in one shared module; re-exported below so
// home-feeds.js keeps importing resolveSupporters from feeds.js unchanged.
import { resolveSupporters } from '/assets/js/supporter-set.js?v=ob-v96'
// Identity, for keeping the Follows feeds in sync with who's signed in.
import { getSessionPubkey, clearFollowCache } from '/assets/js/follow-set.js?v=ob-v96'

// Hourly events snapshot (Cloudflare Pages Function proxying the file
// bots/community-feeds pushes to the VPS). It carries the same raw signed
// calendar events a live relay query would, but already scoped to the show's
// supporters with NIP-09 deletions + NIP-01 replacements resolved server-side
// — so a tab open is one cached GET instead of follow-pack resolution + a
// multi-relay subscription. The live path (resolveSupporters + streamEvents)
// stays as the fallback when the snapshot is unreachable.
const EVENTS_SNAPSHOT_URL = '/api/community-events'

// Chunk authors so a single relay filter never carries an unreasonable
// number of `authors`, which some relays cap or reject.
const AUTHOR_CHUNK = 50

// ── DOM state helpers ────────────────────────────────────────────────
function showSkeletons(list, n = 3) {
  list.className = 'feed-list'
  list.innerHTML = ''
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div')
    s.className = 'feed-skeleton'
    list.appendChild(s)
  }
}

function renderPlaceholder(list, title, body) {
  list.className = ''
  list.innerHTML = ''
  appendPlaceholder(list, title, body)
}

// Append a placeholder without clearing the list — used when a header (e.g.
// the always-present Featured Events header) has already been rendered.
function appendPlaceholder(list, title, body) {
  const ph = document.createElement('div')
  ph.className = 'feed-placeholder'
  const strong = document.createElement('strong')
  strong.textContent = title
  ph.appendChild(strong)
  ph.appendChild(document.createTextNode(body))
  list.appendChild(ph)
}

const KIND_DELETION = 5

function chunkAuthors(authors) {
  const chunks = []
  for (let i = 0; i < authors.length; i += AUTHOR_CHUNK) {
    chunks.push(authors.slice(i, i + AUTHOR_CHUNK))
  }
  return chunks
}

// Apply one NIP-09 deletion (kind 5) into the running state: collect the
// deleted event ids (`e` tags) and deleted addressable coordinates (`a`
// tags → the deletion's created_at, so a later re-publish isn't wrongly
// hidden). A coordinate deletion is only honoured for a coordinate the
// deleter owns; the `e`-tag case is implicit since we only match against
// events from these same authors.
function applyDeletion(state, ev) {
  const at = ev.created_at || 0
  for (const t of ev.tags || []) {
    if (!Array.isArray(t)) continue
    if (t[0] === 'e' && /^[0-9a-f]{64}$/i.test(t[1] || '')) {
      state.deletedIds.add(t[1].toLowerCase())
    } else if (t[0] === 'a' && typeof t[1] === 'string') {
      const coordPubkey = (t[1].split(':')[1] || '').toLowerCase()
      if (coordPubkey !== ev.pubkey.toLowerCase()) continue
      const prev = state.deletedCoords.get(t[1])
      if (prev == null || at > prev) state.deletedCoords.set(t[1], at)
    }
  }
}

// Merge one calendar event into state, keeping only the newest version
// per coordinate (NIP-01 replacement). Returns true if state changed.
function mergeCalendarEvent(state, ev) {
  const parsed = parseCalendarEvent(ev)
  if (!parsed) return false
  const coord = `${parsed.kind}:${parsed.pubkey}:${parsed.dTag}`
  const prev = state.eventsByCoord.get(coord)
  if (prev && (ev.created_at || 0) <= (prev.createdAt || -1)) return false
  parsed.createdAt = ev.created_at || 0
  parsed.id = ev.id || ''
  state.eventsByCoord.set(coord, parsed)
  return true
}

// ── Progressive fetch — stream events + deletions, calling onUpdate as
// state changes so the view can repaint incrementally. Resolves once all
// relays have sent EOSE (or a safety timeout fires). Untrusted source —
// verify every event. ──
function streamEvents(authors, relays, state, onUpdate) {
  return new Promise((resolve) => {
    if (!authors.length) return resolve()
    const pool = new SimplePool()
    // NOTE: this vendored nostr-tools' subscribeMany takes a SINGLE filter
    // object (not an array), so we open one subscription per author chunk,
    // each combining the calendar + deletion kinds into one filter.
    const filters = chunkAuthors(authors).map((chunk) => ({
      kinds: [KIND_DATE_EVENT, KIND_TIME_EVENT, KIND_DELETION],
      authors: chunk,
      limit: 500,
    }))

    const subs = []
    let done = false
    let eosed = 0
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(safety)
      for (const s of subs) { try { s.close() } catch {} }
      try { pool.close(relays) } catch {}
      resolve()
    }
    const safety = setTimeout(finish, 8000)

    const handlers = {
      onevent(ev) {
        if (!ev || !verifyEvent(ev)) return
        let changed = false
        if (ev.kind === KIND_DELETION) { applyDeletion(state, ev); changed = true }
        else changed = mergeCalendarEvent(state, ev)
        if (changed) onUpdate()
      },
      oneose() { if (++eosed >= filters.length) finish() },
    }

    for (const filter of filters) {
      subs.push(pool.subscribeMany(relays, filter, handlers))
    }
  })
}

// Pull the hourly events snapshot. Returns raw signed events (verified here —
// the transport is untrusted even if the source is our own bot); throws if the
// endpoint is unreachable or returns a non-array, so the caller can fall back
// to the live relay path.
async function fetchEventsSnapshot() {
  const res = await fetch(EVENTS_SNAPSHOT_URL, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`community-events ${res.status}`)
  const data = await res.json()
  const events = Array.isArray(data?.events) ? data.events : null
  if (!events) throw new Error('community-events: unexpected shape')
  return events.filter((ev) => ev && verifyEvent(ev))
}

// Fold a batch of raw events into state using the exact same merge + deletion
// rules streamEvents applies to live events. On a clean snapshot the deletion
// pass is a no-op (the bot strips deleted/superseded events), but running it
// keeps this path behaviourally identical to the relay fallback.
function ingestEvents(state, events) {
  for (const ev of events) {
    if (ev.kind === KIND_DELETION) applyDeletion(state, ev)
    else mergeCalendarEvent(state, ev)
  }
}

// Build the render-ready item list from the current state, honouring
// deletions and dropping events with no readable start.
function computeItems(state) {
  const items = []
  for (const parsed of state.eventsByCoord.values()) {
    if (parsed.id && state.deletedIds.has(parsed.id.toLowerCase())) continue
    const coord = `${parsed.kind}:${parsed.pubkey}:${parsed.dTag}`
    const delAt = state.deletedCoords.get(coord)
    if (delAt != null && delAt >= (parsed.createdAt || 0)) continue
    const startMs = eventStartMs(parsed)
    if (!Number.isFinite(startMs)) continue
    items.push({
      parsed,
      startMs,
      endMs: eventEndMs(parsed),
      naddr: naddrFor(parsed, state.relays),
      profile: state.profiles.get(parsed.pubkey) || null,
    })
  }
  return items
}

// ── localStorage cache (stale-while-revalidate) ──────────────────────
const CACHE_KEY = 'lb_feeds_events_v2'
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000  // ignore cache older than a day

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    // Require a non-empty snapshot — an empty one is never worth painting.
    if (!data || !Array.isArray(data.events) || !data.events.length) return null
    if (Date.now() - (data.ts || 0) > CACHE_MAX_AGE) return null
    return data
  } catch { return null }
}

function hydrateStateFromCache(state, cached) {
  for (const parsed of cached.events) {
    if (!parsed || !parsed.kind || !parsed.pubkey || !parsed.dTag) continue
    state.eventsByCoord.set(`${parsed.kind}:${parsed.pubkey}:${parsed.dTag}`, parsed)
  }
  for (const id of cached.deletedIds || []) state.deletedIds.add(id)
  for (const pair of cached.deletedCoords || []) {
    if (Array.isArray(pair)) state.deletedCoords.set(pair[0], pair[1])
  }
  for (const pair of cached.profiles || []) {
    if (Array.isArray(pair)) state.profiles.set(pair[0], pair[1])
  }
  // Restore last session's boosted set so cached events render straight into
  // the Featured section instead of appearing as normal cards that jump up once
  // meetups.json reloads. Unioned (never removes) — the refresh reconciles.
  for (const c of cached.featured || []) state.featuredCoords.add(c)
  // Restore the "Featured by …" credits so they paint from cache too.
  for (const pair of cached.featuredBy || []) {
    if (Array.isArray(pair) && pair[1]) state.featuredBy.set(pair[0], pair[1])
  }
}

function writeCache(state) {
  // Never persist an empty snapshot — a failed/empty fetch shouldn't
  // overwrite a good cache or seed a useless one.
  if (!state.eventsByCoord.size) return
  try {
    const data = {
      ts: Date.now(),
      events: [...state.eventsByCoord.values()],
      deletedIds: [...state.deletedIds],
      deletedCoords: [...state.deletedCoords.entries()],
      profiles: [...state.profiles.entries()].map(([pk, p]) => [pk, { name: p?.name || '', picture: p?.picture || '' }]),
      featured: [...state.featuredCoords],
      featuredBy: [...state.featuredBy.entries()],
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {}
}

// ── Featured (boosted) events ────────────────────────────────────────
// An event is "featured" once someone boosts it. The boost bot logs every
// boosted NIP-52 event's coordinate into /data/meetups.json (the same file
// /meetups reads), so that file IS the boosted set — no bot change needed.
// Featured events float into their own section above the normal feed and
// wear a gold glow. Scope is "any boosted meetup" (not just supporters), so
// boosted coordinates missing from the supporter snapshot get backfilled
// straight from relays, exactly like meetups.js does.
const MEETUPS_JSON = '/api/meetups'

function coordOf(parsed) {
  return `${parsed.kind}:${parsed.pubkey}:${parsed.dTag}`
}

function isWsUrl(u) {
  return typeof u === 'string' && (u.startsWith('wss://') || u.startsWith('ws://'))
}

// naddr strings carry relay hints — include them so a boosted event published
// only to relays outside the static set is still reachable in the backfill.
function relayHintsFromNaddr(naddr) {
  try {
    const d = nip19.decode(naddr)
    if (d.type === 'naddr' && Array.isArray(d.data.relays)) {
      return d.data.relays.filter(isWsUrl)
    }
  } catch {}
  return []
}

function npubToHex(npub) {
  try {
    const d = nip19.decode(npub)
    return d.type === 'npub' ? d.data : ''
  } catch { return '' }
}

// Read the boosted-event log. Returns the set of boosted coordinates, any relay
// hints from their naddrs, and a coord→booster map (who paid to feature it, for
// the "Featured by …" credit). Rows are newest-first, so the first booster seen
// per coordinate is the most recent one. Best-effort: a missing/unreachable file
// just means "nothing featured", never a hard error on the Events tab.
async function fetchBoostedSet() {
  const coords = new Set()
  const hints = new Set()
  const by = new Map()  // coord -> { pubkey, name, picture }
  try {
    const res = await fetch(MEETUPS_JSON, { cache: 'no-cache' })
    if (!res.ok) throw new Error('meetups.json ' + res.status)
    const data = await res.json()
    const rows = Array.isArray(data?.rows) ? data.rows : []
    for (const r of rows) {
      if (!r || typeof r.coordinate !== 'string') continue
      coords.add(r.coordinate)
      if (typeof r.naddr === 'string') {
        for (const h of relayHintsFromNaddr(r.naddr)) hints.add(h)
      }
      if (!by.has(r.coordinate)) {
        const pubkey = npubToHex(r.sender_npub)
        if (pubkey) by.set(r.coordinate, { pubkey, name: r.sender_name || '', picture: '' })
      }
    }
  } catch (e) {
    console.warn('[feeds] boosted-set load failed', e)
  }
  return { coords, hints, by }
}

// Pull any boosted coordinates not already in state (i.e. boosted events whose
// organizer isn't in the supporter snapshot) straight from relays and merge
// them in, so "any boosted meetup" can surface as featured. Organizer profiles
// for the newly added authors are picked up by the caller's profile fetch,
// which runs over the full author set right after this.
async function backfillFeatured(state, boosted) {
  const missing = [...boosted.coords].filter((c) => !state.eventsByCoord.has(c))
  if (!missing.length) return
  try {
    const relays = [...new Set([...state.relays, ...boosted.hints])]
    const found = await fetchCalendarEventsFromRelays(missing, relays)
    for (const parsed of found.values()) {
      const coord = coordOf(parsed)
      const prev = state.eventsByCoord.get(coord)
      if (prev && (parsed.createdAt || 0) <= (prev.createdAt || -1)) continue
      state.eventsByCoord.set(coord, parsed)
    }
  } catch (e) {
    console.warn('[feeds] featured backfill failed', e)
  }
}

// Optimistic featured set: a just-boosted coordinate lights up immediately,
// before the daily meetups.json refresh records it. Persisted (with a TTL so
// it self-heals once the log catches up) and merged into state.featuredCoords.
const CONFIRMED_FEATURED_KEY = 'lb_featured_confirmed'
const CONFIRMED_FEATURED_TTL = 48 * 60 * 60 * 1000

function readConfirmedFeatured() {
  const out = new Set()
  try {
    const map = JSON.parse(localStorage.getItem(CONFIRMED_FEATURED_KEY) || '{}')
    const now = Date.now()
    for (const [coord, ts] of Object.entries(map)) {
      if (now - (ts || 0) <= CONFIRMED_FEATURED_TTL) out.add(coord)
    }
  } catch {}
  return out
}

function addConfirmedFeatured(coord) {
  try {
    const map = JSON.parse(localStorage.getItem(CONFIRMED_FEATURED_KEY) || '{}')
    const now = Date.now()
    for (const [c, ts] of Object.entries(map)) {
      if (now - (ts || 0) > CONFIRMED_FEATURED_TTL) delete map[c]
    }
    map[coord] = now
    localStorage.setItem(CONFIRMED_FEATURED_KEY, JSON.stringify(map))
  } catch {}
}

function naddrFor(parsed, relays) {
  try {
    return nip19.naddrEncode({
      identifier: parsed.dTag,
      pubkey: parsed.pubkey,
      kind: parsed.kind,
      relays: relays.slice(0, 2),
    })
  } catch {
    return ''
  }
}

function renderCard(item, featured = false, featuredBy = null) {
  return renderCalendarCard(item.parsed, {
    bech32: item.naddr,
    profile: item.profile,
    actions: true,
    featured,
    featuredBy: featured ? (featuredBy && featuredBy.get(coordOf(item.parsed))) || null : null,
  })
}

// A group renders as its primary card. When it has duplicates, a "See
// other versions" toggle sits at the left of the card's action row
// (Repost + Zap pushed right), and an in-card panel below the action bar
// holds the other versions as full cards.
function renderGroup(group, featured = false, featuredBy = null) {
  if (!group.versions || !group.versions.length) return renderCard(group, featured, featuredBy)

  const n = group.versions.length
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'versions-toggle'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.innerHTML =
    '<span class="versions-caret" aria-hidden="true">▸</span>' +
    `<span>Other Versions (${n})</span>`

  const card = renderCalendarCard(group.parsed, {
    bech32: group.naddr,
    profile: group.profile,
    actions: true,
    actionsLeft: toggle,
    featured,
    featuredBy: featured ? featuredByFor(group, featuredBy) : null,
  })

  const panel = document.createElement('div')
  panel.className = 'event-versions-panel'
  panel.hidden = true
  for (const v of group.versions) panel.appendChild(renderCard(v, featured, featuredBy))

  // Drop the panel in right after the action bar (both live in the card's
  // content column, thumbnail or not).
  const bar = card.querySelector('.note-actions')
  if (bar && bar.parentNode) bar.parentNode.insertBefore(panel, bar.nextSibling)
  else card.appendChild(panel)

  toggle.addEventListener('click', () => {
    const opening = panel.hidden
    panel.hidden = !opening
    toggle.classList.toggle('is-open', opening)
    toggle.setAttribute('aria-expanded', opening ? 'true' : 'false')
  })

  return card
}

function buildGrid(groups, featured = false, featuredBy = null) {
  const grid = document.createElement('div')
  grid.className = 'feed-list'
  for (const g of groups) grid.appendChild(renderGroup(g, featured, featuredBy))
  return grid
}

// A group is featured if the primary or any collapsed version's coordinate is
// in the boosted set (they're the same logical event, so the whole group glows).
function groupIsFeatured(group, featuredCoords) {
  if (!featuredCoords || !featuredCoords.size) return false
  if (featuredCoords.has(coordOf(group.parsed))) return true
  for (const v of group.versions || []) {
    if (featuredCoords.has(coordOf(v.parsed))) return true
  }
  return false
}

// The booster credit for a group — the boosted coordinate may be the primary or
// any collapsed version, so check them in order (primary first).
function featuredByFor(group, map) {
  if (!map || !map.size) return null
  const hit = map.get(coordOf(group.parsed))
  if (hit) return hit
  for (const v of group.versions || []) {
    const h = map.get(coordOf(v.parsed))
    if (h) return h
  }
  return null
}

// ── Forward date-range + event-type filters ──────────────────────────
// The events feed is scoped by a forward-looking range (mirroring the
// podcast feed's 1W/1M/All, but future rather than past — there are future
// events to browse) and an event-type dropdown. 1W/1M are pure forward
// windows (no past section); All widens to every upcoming event and surfaces
// a collapsed Past Events drawer.
const EVENT_RANGE_OPTIONS = [
  ['1w', '1W', 7],
  ['1m', '1M', 30],
  ['all', 'All', null],
]
function rangeDays(key) {
  const o = EVENT_RANGE_OPTIONS.find((x) => x[0] === key)
  return o ? o[2] : null
}
function rangeEmptyTitle(range) {
  if (range === '1w') return 'No events in the next week'
  if (range === '1m') return 'No events in the next month'
  return 'No upcoming events'
}

// In-Person (has a location) is the default; Virtual is the location-less
// online meetups; All Types shows both.
const EVENT_TYPE_OPTIONS = [
  ['inperson', 'In-Person'],
  ['virtual', 'Virtual'],
  ['all', 'All Types'],
]
function matchesType(item, type) {
  if (type === 'all') return true
  const loc = hasLocation(item)
  return type === 'virtual' ? !loc : loc
}

// Content key for collapsing re-posted duplicates: same author + same
// (normalized) title + exact same start value. The raw `start` is used so
// the match is exact — an all-day event's YYYY-MM-DD or a timed event's
// epoch second; the two formats never collide across event types.
function versionKey(item) {
  const p = item.parsed
  const title = (p.title || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return `${p.pubkey}|${title}|${p.start}`
}

// Collapse duplicate events into groups. Each group's primary is the
// version with the highest created_at; the rest ride along as `versions`
// (newest-first). The primary's fields are spread onto the group so it can
// be treated like an item for month bucketing / sorting.
function groupItems(items) {
  const groups = new Map()
  for (const item of items) {
    const key = versionKey(item)
    const arr = groups.get(key)
    if (arr) arr.push(item)
    else groups.set(key, [item])
  }
  const out = []
  for (const arr of groups.values()) {
    arr.sort((a, b) => (b.parsed.createdAt || 0) - (a.parsed.createdAt || 0))
    out.push({ ...arr[0], versions: arr.slice(1) })
  }
  return out
}

// A calendar event counts as "in-person" when its `location` tag is populated.
// Events with no location are "virtual". The event-type dropdown filters on
// this (In-Person is the default).
function hasLocation(item) {
  const loc = item?.parsed?.location
  return typeof loc === 'string' && loc.trim() !== ''
}

// A non-collapsible section header (mirrors the panel's own "Events" title);
// used to label the Featured + Events grids. Title only — no count.
function sectionHead(label, { featured = false } = {}) {
  const head = document.createElement('div')
  head.className = 'feed-section-head' + (featured ? ' feed-section-head--featured' : '')
  if (featured) {
    const star = document.createElement('span')
    star.className = 'feed-section-star'
    star.setAttribute('aria-hidden', 'true')
    star.textContent = '⭐'
    head.appendChild(star)
  }
  const text = document.createElement('span')
  text.className = 'feed-section-label'
  text.textContent = label
  head.appendChild(text)
  return head
}

// The "Find Event to Feature" action lives at the right of the Featured Events
// header row (moved out of the panel head). It carries no listener of its own —
// the inline Find-modal controller in feeds.html opens the modal via a
// delegated click on `.feed-find-btn`, so it survives every repaint.
function findEventsButton() {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'event-composer-btn feed-find-btn'
  btn.setAttribute('aria-haspopup', 'dialog')
  btn.setAttribute('aria-controls', 'event-find-modal')
  btn.innerHTML =
    '<span class="ecb-icon" aria-hidden="true">🔍</span>' +
    '<span>Find Event to Feature</span>'
  return btn
}

// The Featured Events header is always on screen — it hosts the Find action, so
// it renders even for empty/no-featured months.
function featuredHead() {
  const head = sectionHead('Featured Events', { featured: true })
  head.appendChild(findEventsButton())
  return head
}

function skeletonCard() {
  const sk = document.createElement('div')
  sk.className = 'feed-skeleton'
  return sk
}

// A muted line under the Featured header for a month that has events but none
// featured yet — teaches the feature and keeps the header from butting straight
// into the "Events" header with nothing between them.
function featuredEmptyHint() {
  const hint = document.createElement('p')
  hint.className = 'feed-featured-hint'
  hint.textContent = 'No featured events yet — boost a meetup to feature it here.'
  return hint
}

// Single collapsible "Past Events" drawer holding featured past events (gold
// glow) first, then normal past events. Replaces the old two-drawer layout.
function pastDrawer(featPast, normPast, featuredBy = null) {
  const details = document.createElement('details')
  details.className = 'feed-past'
  const summary = document.createElement('summary')
  summary.textContent = 'Past Events'
  details.appendChild(summary)
  const body = document.createElement('div')
  body.className = 'feed-list'
  for (const g of featPast) body.appendChild(renderGroup(g, true, featuredBy))
  for (const g of normPast) body.appendChild(renderGroup(g, false))
  details.appendChild(body)
  return details
}

function renderEvents(panel, allItems, range = '1m', type = 'inperson', featuredCoords = null, featuredLoading = false, featuredBy = null) {
  const list = panel.querySelector('[data-feed-list]')
  list.className = ''
  list.innerHTML = ''

  // Featured Events header is always first — it hosts the "Find Event to
  // Feature" action, so it renders even for empty or no-featured views.
  list.appendChild(featuredHead())

  const groups = groupItems(allItems.filter((it) => matchesType(it, type)))

  // Forward window: upcoming = not-yet-over events starting within the range.
  // Past events only surface in the All view (the windowed views are purely
  // forward-looking, so they carry no Past drawer).
  const now = Date.now()
  const days = rangeDays(range)
  const upperBound = days ? now + days * 86400000 : Infinity
  const upcoming = groups
    .filter((g) => g.endMs >= now && g.startMs <= upperBound)
    .sort((a, b) => a.startMs - b.startMs)
  const past = days ? [] : groups.filter((g) => g.endMs < now).sort((a, b) => b.startMs - a.startMs)

  if (!upcoming.length && !past.length) {
    // Boosted set still resolving — a backfilled featured event may land in
    // range, so show a trailing skeleton rather than a premature "no events".
    if (featuredLoading) {
      const grid = document.createElement('div')
      grid.className = 'feed-list'
      grid.appendChild(skeletonCard())
      list.appendChild(grid)
      return
    }
    appendPlaceholder(
      list,
      rangeEmptyTitle(range),
      'Try a wider range or event type — or check back as supporters post new events.'
    )
    return
  }

  // Each bucket is split into featured (boosted) vs normal — featured events
  // float up into their own section and are removed from the normal list (they
  // "moved up", shown once).
  const isFeat = (g) => groupIsFeatured(g, featuredCoords)
  const featUpcoming = upcoming.filter(isFeat)
  const normUpcoming = upcoming.filter((g) => !isFeat(g))
  const featPast = past.filter(isFeat)
  const normPast = past.filter((g) => !isFeat(g))

  // 1. Featured Events — gold glow, under the always-present header. While the
  // boosted set is still resolving, a pulsing skeleton trails the real featured
  // cards (same grid, same gap) so it reads as "another one loading in". When
  // nothing is featured yet, a muted hint fills the gap.
  if (featUpcoming.length) {
    const grid = buildGrid(featUpcoming, true, featuredBy)
    if (featuredLoading) grid.appendChild(skeletonCard())
    list.appendChild(grid)
  } else if (featuredLoading) {
    const grid = document.createElement('div')
    grid.className = 'feed-list'
    grid.appendChild(skeletonCard())
    list.appendChild(grid)
  } else {
    list.appendChild(featuredEmptyHint())
  }

  // 2. Events — non-collapsible, always labelled with its own header (the panel
  // title is gone, so this header is the only "Events" label).
  if (normUpcoming.length) {
    list.appendChild(sectionHead('Events'))
    list.appendChild(buildGrid(normUpcoming))
  } else if (!featUpcoming.length && !featuredLoading && past.length) {
    const ph = document.createElement('div')
    ph.className = 'feed-placeholder'
    const strong = document.createElement('strong')
    strong.textContent = 'No upcoming events'
    ph.appendChild(strong)
    ph.appendChild(document.createTextNode('These have already happened — see Past Events below.'))
    list.appendChild(ph)
  }

  // 3. Past Events — one collapsible drawer, featured (gold) past events first.
  if (featPast.length || normPast.length) {
    list.appendChild(pastDrawer(featPast, normPast, featuredBy))
  }
}

// Forward 1W/1M/All segmented control — mirrors the podcast feed's range
// buttons (same `.pcast-range` chrome, themed by the active feed's accent).
function rangeControl(initialKey, onPick) {
  const wrap = document.createElement('div')
  wrap.className = 'pcast-range'
  wrap.setAttribute('role', 'group')
  wrap.setAttribute('aria-label', 'Filter events by date range')
  const btns = EVENT_RANGE_OPTIONS.map(([key, label]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'pcast-range-btn'
    b.textContent = label
    b.title = label === 'All'
      ? 'All upcoming events'
      : `Events in the next ${label === '1W' ? '7 days' : '30 days'}`
    b.addEventListener('click', () => { setActive(key); onPick(key) })
    return b
  })
  function setActive(key) {
    btns.forEach((el, i) => {
      const on = EVENT_RANGE_OPTIONS[i][0] === key
      el.classList.toggle('is-active', on)
      el.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
  }
  setActive(initialKey)
  wrap.append(...btns)
  return wrap
}

// "In-Person ▾" event-type dropdown for the panel head — same `.pcast-sort`
// chrome as the podcast feed's sort menu (outside-click / Escape to close).
function typeControl(initialKey, onPick) {
  const labelFor = (k) => (EVENT_TYPE_OPTIONS.find((o) => o[0] === k) || EVENT_TYPE_OPTIONS[0])[1]
  const wrap = document.createElement('div')
  // feed-type-sort squares the corners (vs the podcast sort menu's pill).
  wrap.className = 'pcast-sort feed-type-sort'
  const curEl = document.createElement('span')
  curEl.className = 'pcast-sort-cur'
  curEl.textContent = labelFor(initialKey)
  const caret = document.createElement('span')
  caret.className = 'pcast-sort-caret'
  caret.setAttribute('aria-hidden', 'true')
  caret.textContent = '▾'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'pcast-sort-btn'
  btn.setAttribute('aria-haspopup', 'true')
  btn.setAttribute('aria-expanded', 'false')
  btn.setAttribute('aria-label', 'Filter events by type')
  btn.append(curEl, caret)

  let activeKey = initialKey
  const items = EVENT_TYPE_OPTIONS.map(([k, label]) => {
    const it = document.createElement('button')
    it.type = 'button'
    it.className = 'pcast-sort-item'
    it.textContent = label
    it.addEventListener('click', () => { activeKey = k; curEl.textContent = label; close(); onPick(k) })
    return it
  })
  const menu = document.createElement('div')
  menu.className = 'pcast-sort-menu'
  menu.hidden = true
  menu.append(...items)
  wrap.append(btn, menu)

  function refreshActive() {
    items.forEach((el, i) => el.classList.toggle('is-active', EVENT_TYPE_OPTIONS[i][0] === activeKey))
  }
  function onDoc(e) { if (!wrap.contains(e.target)) close() }
  function onKey(e) { if (e.key === 'Escape') close() }
  function open() {
    refreshActive()
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true')
    document.addEventListener('click', onDoc, true); document.addEventListener('keydown', onKey)
  }
  function close() {
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', onDoc, true); document.removeEventListener('keydown', onKey)
  }
  btn.addEventListener('click', () => { menu.hidden ? open() : close() })
  return wrap
}

// Mount the range buttons + type dropdown into the Events panel head, as one
// right-aligned group (matching the podcast feed's controls layout).
function buildEventControls(panel, { range, type, onRange, onType }) {
  const mount = panel.querySelector('[data-events-controls]')
  if (!mount) return
  mount.innerHTML = ''
  const group = document.createElement('div')
  group.className = 'pcast-controls'
  group.append(rangeControl(range, onRange), typeControl(type, onType))
  mount.appendChild(group)
}

// ── Shared supporter resolution ──────────────────────────────────────
// resolveSupporters now lives in supporter-set.js (the one source shared
// with community-status.js). Re-exported here so home-feeds.js — which
// imports it from feeds.js — keeps working unchanged.
export { resolveSupporters }

// One-shot fetch of the soonest upcoming events from the supporter set,
// grouped (duplicates collapsed) and sorted soonest-first, with organizer
// profiles attached to the returned slice. Powers the homepage teaser; the
// full Events tab (loadEvents) keeps its own streaming/month-browser path.
export async function fetchUpcomingEvents(supporters, { limit = 12 } = {}) {
  const { relays, members } = supporters || {}
  if (!members || !members.length) return []
  const state = {
    eventsByCoord: new Map(),
    deletedIds: new Set(),
    deletedCoords: new Map(),
    profiles: new Map(),
    relays,
  }
  await streamEvents(members, relays, state, () => {})

  const now = Date.now()
  const upcoming = groupItems(computeItems(state))
    .filter((g) => g.endMs >= now)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, limit)

  try {
    const pubkeys = [...new Set(upcoming.map((g) => g.parsed.pubkey).filter(Boolean))]
    if (pubkeys.length) {
      const profiles = await fetchProfilesFromPrimal(pubkeys)
      for (const g of upcoming) g.profile = profiles.get(g.parsed.pubkey) || g.profile
    }
  } catch (e) {
    console.warn('[feeds] upcoming-events profile fetch failed', e)
  }
  return upcoming
}

// ── Events tab loader ────────────────────────────────────────────────
// Cache-first: paint instantly from localStorage if we have a recent
// snapshot, then refresh from the hourly /api/community-events snapshot (one
// cached GET). If that endpoint is unreachable, fall back to the live path —
// resolve supporters and stream events in from relays, repainting (debounced)
// as they arrive. Switching range/type never re-fetches — it re-filters the
// in-memory state.
async function loadEvents() {
  const panel = document.getElementById('panel-events')
  if (!panel) return
  const list = panel.querySelector('[data-feed-list]')
  if (!list) return

  const state = {
    eventsByCoord: new Map(),
    deletedIds: new Set(),
    deletedCoords: new Map(),
    profiles: new Map(),
    relays: STATIC_RELAYS,
    range: '1m',            // forward window: 1W / 1M / All (default 1M)
    typeFilter: 'inperson', // In-Person / Virtual / All Types (default In-Person)
    // Boosted events that render in the Featured section. Seeded with the
    // optimistic "just promoted" coords so a fresh boost glows immediately;
    // the authoritative boosted set (meetups.json) unions in during refresh.
    featuredCoords: readConfirmedFeatured(),
    // coord -> { pubkey, name, picture } for whoever boosted each featured
    // event (the "Featured by …" credit).
    featuredBy: new Map(),
    // True until the boosted set (+ backfill) resolves — drives the pulsing
    // "Featured" loading ghost so the section doesn't read as empty first.
    featuredLoading: true,
  }

  const paint = () => renderEvents(panel, computeItems(state), state.range, state.typeFilter, state.featuredCoords, state.featuredLoading, state.featuredBy)

  // Debounced repaint so a burst of streamed events doesn't thrash the DOM.
  let paintTimer = null
  const schedulePaint = () => {
    clearTimeout(paintTimer)
    paintTimer = setTimeout(paint, 200)
  }

  // Optimistic featured glow: when a show-boost settles successfully and a
  // Promote click is pending, light that coordinate up immediately (before the
  // daily meetups.json refresh records it) and remember it across reloads.
  window.addEventListener('lb:show-boost-settled', (ev) => {
    const d = ev && ev.detail
    if (!d || !(d.anySucceeded || d.anyUncertain)) return
    const pending = readPendingPromote()
    if (!pending || !pending.coord) return
    clearPendingPromote()
    addConfirmedFeatured(pending.coord)
    state.featuredCoords.add(pending.coord)
    paint()
  })

  // Range buttons + type dropdown render immediately; changing either repaints
  // from the in-memory state (no re-fetch).
  buildEventControls(panel, {
    range: state.range,
    type: state.typeFilter,
    onRange: (key) => { state.range = key; paint() },
    onType: (key) => { state.typeFilter = key; paint() },
  })

  // 1. Instant paint from cache (stale-while-revalidate).
  const cached = readCache()
  if (cached) {
    hydrateStateFromCache(state, cached)
    paint()
  } else {
    showSkeletons(list)
  }

  // 2. Refresh — prefer the hourly snapshot, fall back to a live relay query.
  try {
    let snapshot = null
    try {
      snapshot = await fetchEventsSnapshot()
      state.relays = STATIC_RELAYS
    } catch (snapErr) {
      console.warn('[feeds] events snapshot unavailable — querying relays', snapErr)
    }

    if (snapshot) {
      ingestEvents(state, snapshot)
    } else {
      // Fallback: resolve supporters, then stream events + deletions from
      // relays, repainting as they land.
      const { relays, members: memberList } = await resolveSupporters()
      state.relays = relays
      if (!memberList.length) {
        if (!state.eventsByCoord.size) {
          renderPlaceholder(list, 'No supporters found', 'Couldn’t reach the follow packs right now — please try again later.')
        }
        return
      }
      await streamEvents(memberList, state.relays, state, schedulePaint)
    }

    // Featured (boosted) events: pull the boosted set from meetups.json, mark
    // those coordinates, and backfill any boosted event missing from the
    // supporter snapshot straight from relays (scope = "any boosted meetup").
    const boosted = await fetchBoostedSet()
    await backfillFeatured(state, boosted)
    for (const c of boosted.coords) state.featuredCoords.add(c)
    for (const [c, info] of boosted.by) state.featuredBy.set(c, info)
    state.featuredLoading = false

    // Organizer + booster profiles (avatar + name) once the author set is
    // known — boosters need resolving for the "Featured by …" credit too.
    try {
      const pubkeys = [...new Set([
        ...[...state.eventsByCoord.values()].map((p) => p.pubkey),
        ...[...state.featuredBy.values()].map((b) => b.pubkey),
      ].filter(Boolean))]
      if (pubkeys.length) {
        const profiles = await fetchProfilesFromPrimal(pubkeys)
        profiles.forEach((prof, pk) => state.profiles.set(pk, prof))
        // Fill the booster credits from the resolved profiles (prefer the
        // profile's display name over meetups.json's often-null sender_name).
        for (const info of state.featuredBy.values()) {
          const prof = state.profiles.get(info.pubkey)
          if (prof) {
            info.name = prof.name || info.name || ''
            info.picture = prof.picture || info.picture || ''
          }
        }
      }
    } catch (e) {
      console.warn('[feeds] event profile fetch failed', e)
    }

    clearTimeout(paintTimer)
    paint()
    writeCache(state)
  } catch (e) {
    console.error('[feeds] events load failed', e)
    if (!state.eventsByCoord.size) {
      renderPlaceholder(list, 'Couldn’t load events', 'Something went wrong reaching the relays — please try again later.')
    }
  } finally {
    // Any path that didn't reach the normal clear (early return, error) still
    // needs the loading ghost gone — clear the flag and repaint over it when
    // there's content to show.
    if (state.featuredLoading) {
      state.featuredLoading = false
      if (state.eventsByCoord.size) paint()
    }
  }
}

// ── Feed loaders ─────────────────────────────────────────────────────
// Every renderer reads the collector's published feed through ob-data.js
// (Follows also through ob-live.js). Lazy-imported on first view so a visitor
// who only opens one feed doesn't pay for the others' modules.
async function hydrate(panelId, mod, scope, medium, lang) {
  const panel = document.getElementById(panelId)
  if (!panel) return
  const list = panel.querySelector('[data-feed-list]')
  if (!list) return
  /* ⚠️ NO SKELETONS OVER A SERVER-RENDERED FEED, and this guard is load-bearing.
   * showSkeletons() clears the list, and since ob-v61 the Episodes · Global panel
   * arrives from functions/index.js with thirty finished cards in it — wiping
   * them would destroy the page the reader is already looking at and force
   * feeds-podcasts.js to fetch and repaint exactly what was thrown away, which is
   * the whole cost the server render exists to remove.
   *
   * The state element is the marker because it is the same one the renderer
   * adopts through, so the two cannot disagree about whether a panel was
   * server-rendered. Every other feed still gets its skeletons. */
  if (!list.querySelector('[data-feed-state]')) showSkeletons(list)
  try {
    const m = await import(mod)
    const fn = m[RENDERERS[mod]]
    if (typeof fn !== 'function') throw new Error(`no renderer export for ${mod}`)
    // Every renderer takes the panel: it carries the feed key their range/sort
    // controls are tagged with in the sticky bar. `medium` is undefined for
    // the Boosts feeds, which don't split, and so is `lang` — they have no
    // language axis, and the inline controller never puts one in their hash.
    await fn({ panel, list, scope, medium, lang })
  } catch (e) {
    console.error('[feeds] load failed', mod, scope, medium, e)
    renderPlaceholder(list, 'Couldn\u2019t load this feed', 'Something went wrong reaching the boosts data \u2014 please try again later.')
  }
}

// ── Lazy per-feed dispatch ───────────────────────────────────────────
const BOOSTS = '/assets/js/boosts-feed.js?v=ob-v96'
const PODCASTS = '/assets/js/feeds-podcasts.js?v=ob-v96'
const SHOWS = '/assets/js/shows-feed.js?v=ob-v96'
// Each module's entry point, by module. Named rather than sniffed out of the
// path, so adding a feed is one line here instead of another branch.
const RENDERERS = {
  [BOOSTS]: 'renderBoosts',
  [PODCASTS]: 'renderPodcasts',
  [SHOWS]: 'renderShows',
}
// `lang` is the feed's OPENING language, off the hash (`#shows?lang=de`) and
// carried in the lb:feed-activate detail. It has to reach the renderer's first
// query rather than being applied afterwards, or a shared link paints the
// unfiltered feed and then corrects itself. The Boosts loaders take none: those
// endpoints have no language axis.
const LOADERS = {
  'boosts-global':    () => hydrate('panel-boosts-global', BOOSTS, 'global'),
  'boosts-follows':   () => hydrate('panel-boosts-follows', BOOSTS, 'follows'),
  'episodes-global':  (lang) => hydrate('panel-episodes-global', PODCASTS, 'global', 'other', lang),
  'episodes-follows': (lang) => hydrate('panel-episodes-follows', PODCASTS, 'follows', 'other', lang),
  'songs-global':     (lang) => hydrate('panel-songs-global', PODCASTS, 'global', 'music', lang),
  'songs-follows':    (lang) => hydrate('panel-songs-follows', PODCASTS, 'follows', 'music', lang),
  // Both Global only — see the scope note at the top of shows-feed.js.
  'shows':            (lang) => hydrate('panel-shows', SHOWS, 'global', 'other', lang),
  'albums':           (lang) => hydrate('panel-albums', SHOWS, 'global', 'music', lang),
}
const loaded = new Set()

function loadFeed(feed, lang) {
  const loader = LOADERS[feed]
  if (!loader || loaded.has(feed)) return
  loaded.add(feed)
  loader(lang)
}

document.addEventListener('lb:feed-activate', (e) => {
  const feed = e?.detail?.feed
  // Only read on the FIRST activation of a feed; afterwards the mounted control
  // owns the language and the controller talks to it through lb:set-feed-lang.
  if (feed) loadFeed(feed, e?.detail?.lang)
})

// ── Session-driven refresh ───────────────────────────────────────────
// The two Follows feeds are scoped to the signed-in npub, so signing in,
// signing out, or switching accounts invalidates whatever they last
// rendered. `loaded` makes every feed load exactly once, which is right
// for the Global feeds and wrong for these: without this, signing in from
// the nav while looking at "Sign in to see this feed" leaves that
// placeholder on screen until a manual reload.
//
// Dropping them from `loaded` re-arms both — the visible one reloads now,
// the other on its next activation, so an account switch can't leave a
// stale list behind the tab you aren't looking at.
const FOLLOWS_FEEDS = ['boosts-follows', 'episodes-follows', 'songs-follows']
let lastSessionPubkey = getSessionPubkey()

function onSessionChange() {
  const pubkey = getSessionPubkey()
  if (pubkey === lastSessionPubkey) return
  lastSessionPubkey = pubkey
  // On sign-out, drop the cached follow list outright. (An account switch
  // needs no clearing — the cache is keyed by pubkey and simply misses.)
  if (!pubkey) clearFollowCache()
  for (const feed of FOLLOWS_FEEDS) loaded.delete(feed)
  const active = document.body.dataset.activeFeed
  // The language comes off the same attribute for the same reason as the cold
  // load below: an account switch re-hydrates the feed from scratch, and it must
  // come back filtered the way the reader left it.
  if (FOLLOWS_FEEDS.includes(active)) loadFeed(active, document.body.dataset.feedLang || '')
}

// Same-tab: the login widget announces every identity change (index.jsx).
window.addEventListener('lb:session-change', onSessionChange)
// Other tabs: `storage` only fires on *other* documents, so this is purely
// the "signed in on another tab" case. A null key means the whole store was
// cleared, which counts.
window.addEventListener('storage', (e) => {
  if (!e || e.key === null || e.key === 'lb_nostr_session') onSessionChange()
})

/* Load whichever feed is active when this module first runs (the inline
 * feed-bar controller has already set body[data-active-feed] and may have
 * dispatched its activation event before this listener attached).
 *
 * ⚠️ READ THE LANGUAGE FROM THE ATTRIBUTE, NOT FROM THE EVENT. This is the cold
 * load, which is the path every shared `#shows?lang=de` link takes, and the
 * lb:feed-activate that carried the language fired before this module existed.
 * Taking only the feed here is what made a shared link paint the unfiltered
 * feed while the URL claimed otherwise. */
loadFeed(
  document.body.dataset.activeFeed || 'episodes-global',
  document.body.dataset.feedLang || '',
)
