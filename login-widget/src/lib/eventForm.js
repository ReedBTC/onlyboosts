/**
 * eventForm — composer state shape + form↔publish-shape lowering.
 *
 * Ported from mynostr's eventForm.js, slimmed for the LB write-only
 * use case: load-from-Nostr / draft-import / picked-location /
 * round-trip-export are all dropped because the LB composer is a
 * single-shot publisher, not a multi-draft tray.
 *
 * The form is a UI-friendly shape (separate startDate/startTime
 * fields, allDay flag, "tzid"). `formToPublishShape` lowers it to the
 * spec-shaped form publishCalendarEvent expects (kind 31922 vs 31923,
 * unix-second `start`, optional `start_tzid`, etc).
 */
import { nip19 } from 'nostr-tools'
import { getNDK, connectAndWait } from './ndk.js'
import { withTimeout } from './utils.js'
import {
  KIND_DATE_EVENT,
  KIND_TIME_EVENT,
  parseCalendarEvent,
} from './eventTypes.js'

export function getUserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Common IANA tzids hoisted to the top of the dropdown so users in
// the most common zones don't have to scroll. The user's own resolved
// tz is prepended at render time.
export const COMMON_TZIDS = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Athens',
  'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Sydney', 'UTC',
]

export function buildTzDropdownList(userTz = getUserTimezone()) {
  const out = []
  const seen = new Set()
  for (const tz of [userTz, ...COMMON_TZIDS]) {
    if (!tz || seen.has(tz)) continue
    seen.add(tz)
    out.push(tz)
  }
  return out
}

export function emptyEventForm() {
  return {
    // Preserving a dTag on the form lets Import / Load-from-Nostr
    // round-trip a draft and have a publish overwrite the original
    // (same kind+pubkey+d). Empty for fresh drafts → publishCalendarEvent
    // generates a random d-tag.
    dTag:        '',
    allDay:      false,
    title:       '',
    summary:     '',
    description: '',
    startDate:   '',
    startTime:   '19:00',
    endDate:     '',
    endTime:     '21:00',
    tzid:        getUserTimezone(),
    location:    '',
    image:       '',
    hashtags:    '',
  }
}

// ── Time helpers ──────────────────────────────────────────────────────

const SECONDS_PER_DAY = 86400

// Offset, in ms, of `tz` at the given UTC instant. Positive when tz is
// ahead of UTC.
function tzOffsetMs(utcMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map(p => [p.type, p.value]))
  const hour = parts.hour === '24' ? '00' : parts.hour
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second)
  return asUtc - utcMs
}

// "2026-04-28T19:30" (datetime-local) → unix seconds in the supplied
// IANA tz. Two-pass refines DST boundary correctness.
export function localDatetimeToUnixInTz(dtLocal, tz) {
  if (!dtLocal || !tz) return NaN
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(dtLocal)
  if (!m) return NaN
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0)
  let ms = Date.UTC(y, mo - 1, d, h, mi, s)
  ms = ms - tzOffsetMs(ms, tz)
  ms = Date.UTC(y, mo - 1, d, h, mi, s) - tzOffsetMs(ms, tz)
  return Math.floor(ms / 1000)
}

// Inverse: unix seconds + tzid → "YYYY-MM-DD" + "HH:MM" wall-clock in
// that tz. Used when seeding the form from a fetched event.
export function unixToLocalInTz(unixSec, tz) {
  if (!Number.isFinite(unixSec)) return { date: '', time: '' }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(unixSec * 1000)).map(p => [p.type, p.value]))
  const hour = parts.hour === '24' ? '00' : parts.hour
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  }
}

/**
 * Lower a composer form into the publish-ready shape that
 * `publishCalendarEvent` accepts. Throws on inputs that can't be
 * lowered (bad date, end-before-start, etc).
 */
export function formToPublishShape(form) {
  if (!form?.title?.trim()) throw new Error('Title is required')
  if (!form?.startDate) throw new Error('Start date is required')

  const hashtags = parseHashtags(form.hashtags)

  if (form.allDay) {
    const start = form.startDate
    const end   = form.endDate || ''
    if (end && end < start) throw new Error('End date must be on or after the start date.')
    return {
      kind: KIND_DATE_EVENT,
      // Pass through dTag so Import / Load-from-Nostr → edit → Publish
      // replaces the original event instead of forking a new one.
      dTag: form.dTag || '',
      title: form.title.trim(),
      summary: form.summary.trim(),
      content: form.description || '',
      start,
      end,
      image: form.image || '',
      location: form.location.trim(),
      hashtags,
    }
  }

  const tz = form.tzid || getUserTimezone()
  const startUnix = localDatetimeToUnixInTz(`${form.startDate}T${form.startTime || '00:00'}`, tz)
  if (!Number.isFinite(startUnix)) throw new Error('Could not parse the start date/time.')
  let endUnix = null
  if (form.endDate) {
    endUnix = localDatetimeToUnixInTz(`${form.endDate}T${form.endTime || form.startTime || '00:00'}`, tz)
    if (!Number.isFinite(endUnix)) throw new Error('Could not parse the end date/time.')
    if (endUnix <= startUnix) throw new Error('End must be after start.')
  }

  return {
    kind: KIND_TIME_EVENT,
    dTag: form.dTag || '',
    title: form.title.trim(),
    summary: form.summary.trim(),
    content: form.description || '',
    start: String(startUnix),
    end:   endUnix !== null ? String(endUnix) : '',
    startTzid: tz,
    endTzid:   tz,
    image: form.image || '',
    location: form.location.trim(),
    hashtags,
  }
}

export function parseHashtags(input) {
  const out = []
  const seen = new Set()
  for (const raw of String(input || '').split(/[\s,]+/)) {
    const t = raw.replace(/^#/, '').trim().toLowerCase()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

// ── Form ↔ event round-trip (for Import / Export / Load-from-Nostr) ──

/**
 * Decode an NDK event (kind 31922 or 31923) into the composer form
 * shape. Returns null if the event isn't a calendar event.
 */
export function eventToForm(ev) {
  const parsed = parseCalendarEvent(ev)
  if (!parsed) return null
  const tz = parsed.startTzid || getUserTimezone()
  const base = emptyEventForm()
  if (parsed.isDateBased) {
    base.allDay     = true
    base.startDate  = parsed.start || ''
    base.endDate    = parsed.end   || ''
    base.startTime  = '19:00'
    base.endTime    = '21:00'
    base.tzid       = getUserTimezone()
  } else {
    base.allDay     = false
    base.tzid       = tz
    const startWall = unixToLocalInTz(parsed.startUnix, tz)
    base.startDate  = startWall.date
    base.startTime  = startWall.time || '19:00'
    if (parsed.endUnix) {
      const endWall = unixToLocalInTz(parsed.endUnix, tz)
      base.endDate  = endWall.date
      base.endTime  = endWall.time || '21:00'
    }
  }
  base.dTag        = parsed.dTag || ''
  base.title       = parsed.title || ''
  base.summary     = parsed.summary || ''
  base.description = parsed.content || ''
  base.location    = parsed.location || ''
  base.image       = parsed.image || ''
  base.hashtags    = (parsed.hashtags || []).join(' ')
  return base
}

function randomDTag() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(8)
    crypto.getRandomValues(buf)
    return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
  }
  return Math.random().toString(16).slice(2, 18).padEnd(16, '0')
}

/**
 * Round-trip a form through publish-shape → unsigned event template,
 * used for Export. Returns the JSON-serializable object the user will
 * save to disk and re-import later.
 */
export function formToEventTemplate(form, { pubkey = '' } = {}) {
  const lowered = formToPublishShape(form)
  const tags = []
  const dTag = form.dTag || lowered.dTag || randomDTag()
  tags.push(['d', dTag])
  tags.push(['title', lowered.title])
  tags.push(['start', String(lowered.start)])
  if (lowered.end) tags.push(['end', String(lowered.end)])
  if (lowered.kind === KIND_TIME_EVENT) {
    if (lowered.startTzid) tags.push(['start_tzid', lowered.startTzid])
    if (lowered.endTzid && lowered.endTzid !== lowered.startTzid) {
      tags.push(['end_tzid', lowered.endTzid])
    }
    const startSec = parseInt(lowered.start, 10)
    if (Number.isFinite(startSec)) {
      tags.push(['D', String(Math.floor(startSec / SECONDS_PER_DAY))])
    }
  }
  if (lowered.summary)  tags.push(['summary', lowered.summary])
  if (lowered.image)    tags.push(['image', lowered.image])
  if (lowered.location) tags.push(['location', lowered.location])
  for (const h of lowered.hashtags) tags.push(['t', h])
  tags.push(['client', 'onlyboosts.social'])
  return {
    kind: lowered.kind,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: lowered.content,
    tags,
  }
}

/**
 * Fetch a calendar event by naddr / nevent / hex id, decode it, and
 * return a form snapshot ready to seed the composer.
 *
 * Returns { ok, snapshot, error, importedFromPubkey? }.
 */
export async function fetchEventForLoader(input) {
  if (!input) return { ok: false, error: 'Paste an naddr or nevent.' }
  const trimmed = String(input).trim().replace(/^nostr:/i, '')
  let decoded = null
  try { decoded = nip19.decode(trimmed) } catch {}

  let filter
  if (decoded?.type === 'naddr') {
    if (decoded.data.kind !== KIND_DATE_EVENT && decoded.data.kind !== KIND_TIME_EVENT) {
      return { ok: false, error: 'naddr must point to a kind 31922 or 31923 event.' }
    }
    filter = {
      kinds:     [decoded.data.kind],
      authors:   [decoded.data.pubkey],
      '#d':      [decoded.data.identifier],
    }
  } else if (decoded?.type === 'nevent') {
    filter = { ids: [decoded.data.id] }
  } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    filter = { ids: [trimmed.toLowerCase()] }
  } else {
    return { ok: false, error: 'Paste an naddr1…, nevent1…, or 64-char event id.' }
  }

  try {
    const ndk = getNDK()
    await connectAndWait(ndk, 3000).catch(() => {})
    const events = await withTimeout(ndk.fetchEvents(filter), 8000, 'fetch-timeout')
    const ev = Array.from(events)[0]
    if (!ev) return { ok: false, error: 'Event not found on relays.' }
    if (ev.kind !== KIND_DATE_EVENT && ev.kind !== KIND_TIME_EVENT) {
      return { ok: false, error: `Wrong kind ${ev.kind} — expected 31922 or 31923.` }
    }
    const snapshot = eventToForm(ev)
    if (!snapshot) return { ok: false, error: 'Could not decode that event.' }
    return { ok: true, snapshot, importedFromPubkey: ev.pubkey }
  } catch (err) {
    return {
      ok: false,
      error: err?.message === 'fetch-timeout'
        ? 'Relays timed out.'
        : (err?.message || 'Load failed.'),
    }
  }
}
