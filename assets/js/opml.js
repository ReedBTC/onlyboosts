/* opml.js — OPML import and export: the rules, with no I/O. Two-sided.
 *
 * OPML is the subscription list every podcast app writes and reads. A new
 * member brings one from their current app so they do not have to find every
 * show again; a member leaving takes one with them. Here a subscription is a
 * FOLLOWED podcast (or a favorited album, when the file lists a music feed),
 * so an import adds feed entries to the kind 10333 list and an export writes
 * the feed entries out. Episode and song favorites have no place in the
 * format. An import ADDS and never removes (Reed's rule, 2026-11-07).
 *
 * Lifted from BoostMeBitch's lib/opml.ts (ChadFarrow/boostmebitch #508 and
 * #518, Chad's rules), with the reader written in here (BMB keeps its scanner
 * in a second module) so one dependency-free file serves the browser, the
 * link-fetching Function and the test. This module decides:
 *
 *  - what a file says (`parseOpml`),
 *  - which addresses may LEAVE THE DEVICE to be looked up (`planOpmlImport`,
 *    `opmlLinkVerdict`),
 *  - what each lookup answer means (`sortOpmlAnswers`),
 *  - and the bytes an export writes (`buildOpml`).
 *
 * ⚠️ IMPORTS NOTHING, so functions/api/v1/opml/link.js can inline it by
 * relative path and scripts/test-opml.mjs can load it as shipped. It never
 * reads the clock: the export's date is the caller's. */

/** A bigger file is refused before it is read. Overcast's extended export
 *  nests every episode under its show, so a real library runs to megabytes. */
export const OPML_MAX_BYTES = 16 * 1024 * 1024

/** Feeds past this many in one file are counted and not planned at all. */
export const OPML_MAX_FEEDS = 2000

/** Feeds sent to /api/v1/feeds/resolve in one request. The endpoint answers
 *  the index's rows at once and Podcast Index for a bounded number of the
 *  rest; the browser asks again for what came back unasked. */
export const OPML_LOOKUP_PER_RUN = 100

/** A feed address over this is not planned (the resolve endpoint's own cap). */
export const OPML_URL_MAX = 2000

/**
 * The file input's `accept`, which on a phone decides what the picker OFFERS.
 * iOS shows the photo library and the camera beside "Choose File" when `accept`
 * is absent, greys out an `.opml` saved to Files when only XML types are
 * named, and `application/octet-stream` (which maps to `public.data`, every
 * file) is what answers both; the extensions and XML types are for a desktop
 * picker, which reads octet-stream as `.bin`. BMB's finding, kept whole.
 */
export const OPML_FILE_ACCEPT = 'application/octet-stream,text/x-opml,text/xml,application/xml,.opml,.xml'

/* ── Reading a file ──────────────────────────────────────────────────────── */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** The attributes of one start tag's text (what sits between `<outline` and `>`). */
function attributesOf(tagBody) {
  const out = {}
  const re = /([^\s=\/'"<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(tagBody))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '')
  return out
}

/**
 * Every `<outline>` carrying a feed address, in document order, as
 * `{ xmlUrl, title }`; null when the text is not an OPML document at all
 * (no `<opml` element and no feed outline), which is the caller's cue to say
 * "not OPML" rather than "no feeds". Folders (outlines with no `xmlUrl`) are
 * walked through and not returned; nesting does not matter to a flat list.
 *
 * A small scanner rather than DOMParser: the same code runs at the edge (the
 * link route) and in node (the test), and a document a strict XML parser
 * rejects over one stray `&` in a title is still a list a person wants read.
 * Quotes are honoured inside a tag, so a `>` in a title does not end it.
 */
export function parseOpml(text) {
  if (typeof text !== 'string') return null
  const src = text.replace(/<!--[\s\S]*?-->/g, '')
  const outlines = []
  const re = /<outline\b/gi
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length
    let quote = null
    while (i < src.length) {
      const c = src[i]
      if (quote) { if (c === quote) quote = null }
      else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      i++
    }
    const body = src.slice(m.index + m[0].length, i)
    re.lastIndex = i
    const a = attributesOf(body)
    const xmlUrl = (a.xmlurl ?? '').trim()
    if (!xmlUrl) continue
    const title = (a.text ?? a.title ?? '').replace(/\s+/g, ' ').trim()
    outlines.push({ xmlUrl, title })
  }
  if (!outlines.length && !/<opml[\s>]/i.test(src)) return null
  return outlines
}

/* ── What may leave the device ───────────────────────────────────────────── */

/** The normalized http(s) address, or null. */
export function opmlFeedUrl(raw) {
  let u
  try { u = new URL(String(raw ?? '').trim()) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return u.href.length <= OPML_URL_MAX ? u.href : null
}

// Hosts that serve paid or members-only feeds, where the address IS the key.
const PRIVATE_FEED_HOSTS = ['patreon.com', 'supercast.com', 'supportingcast.fm', 'memberful.com', 'glow.fm']
// Query parameters that carry a credential. `auth` and `key` exactly, because
// as substrings they match `author` and `monkey`; the rest anywhere in the name.
const SECRET_PARAMS = new Set(['auth', 'key', 'apikey', 'sid', 'pass', 'pwd', 'sig'])
const SECRET_PARAM_PARTS = ['token', 'secret', 'passw', 'signature', 'session', 'api_key']

/**
 * True when an address looks like a paid or members-only feed.
 *
 * ⚠️ A PRIVATE FEED ADDRESS IS A CREDENTIAL, SO IT NEVER LEAVES THE DEVICE.
 * Paid feeds put the subscriber's key in the URL (Patreon's `?auth=`,
 * Supercast and Supporting Cast in the path), and an export from the member's
 * current app lists them beside the public shows. A lookup would send each
 * address to this site's Function, to D1's query log and to Podcast Index,
 * none of which could make it a follow anyway: PI does not list a private
 * feed, and a follow needs the `podcast:guid` it would answer with. Keeping
 * one back costs nothing; sending one puts a paid feed's key in databases
 * nobody here controls the retention of.
 *
 * A heuristic that leans towards keeping back. A public feed that trips it is
 * named on screen ("kept on this device") and can be followed from its page;
 * the opposite mistake cannot be taken back.
 */
export function looksPrivate(href) {
  let u
  try { u = new URL(href) } catch { return false }
  if (u.username || u.password) return true
  const host = u.hostname.toLowerCase()
  if (PRIVATE_FEED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true
  if (u.pathname.toLowerCase().split('/').includes('private')) return true
  for (const name of u.searchParams.keys()) {
    const n = name.toLowerCase()
    if (SECRET_PARAMS.has(n) || SECRET_PARAM_PARTS.some((p) => n.includes(p))) return true
  }
  return false
}

/**
 * Which of the file's feeds may be looked up, in file order:
 * `{ feeds: [{ url, title }], skipped: [{ url, title, reason }], overCap }`,
 * `reason` being `not-web` (not an http(s) address), `private` (carries a
 * credential; never sent) or `repeat` (the same address earlier in the file).
 * Validation, the private test and the repeat test all run BEFORE anything is
 * sent, which is the point of doing them here: the server is one of the
 * places a private address must not reach.
 */
export function planOpmlImport(outlines) {
  const feeds = []
  const skipped = []
  const seen = new Set()
  let overCap = 0
  for (const o of outlines ?? []) {
    const url = opmlFeedUrl(o.xmlUrl)
    if (!url) skipped.push({ url: o.xmlUrl, title: o.title, reason: 'not-web' })
    else if (looksPrivate(url)) skipped.push({ url: o.xmlUrl, title: o.title, reason: 'private' })
    else if (seen.has(url)) skipped.push({ url: o.xmlUrl, title: o.title, reason: 'repeat' })
    else if (feeds.length >= OPML_MAX_FEEDS) overCap += 1
    else { seen.add(url); feeds.push({ url, title: o.title }) }
  }
  return { feeds, skipped, overCap }
}

/**
 * Whether a pasted link may leave the device to be read by the link route:
 * `{ url }` or `{ refused: 'not-web' | 'private' }`. The same two tests a
 * feed address gets, for the same reason: a link with `?token=` in it IS the
 * key to whoever's list it opens. No `https://` is guessed for an address
 * without one, because a pasted Nostr secret key is not a web address and a
 * guess would turn it into a hostname.
 */
export function opmlLinkVerdict(raw) {
  const url = opmlFeedUrl(raw)
  if (!url) return { refused: 'not-web' }
  return looksPrivate(url) ? { refused: 'private' } : { url }
}

/** What the review calls a list read from a link: its file name, or its host. */
export function opmlLinkName(url) {
  const u = new URL(url)
  const last = u.pathname.split('/').filter(Boolean).at(-1)
  if (!last) return u.host
  try { return decodeURIComponent(last) } catch { return last }
}

/* ── What a lookup answer means ──────────────────────────────────────────── */

/**
 * Sort the planned feeds by what `/api/v1/feeds/resolve` said, `answers`
 * being keyed by `feed.url`:
 *
 *   add       will be followed, one per show: `{ feed, row }`
 *   already   on the list already, or the same show under an earlier address
 *   notFound  the index and Podcast Index both answered: no such feed
 *   noGuid    Podcast Index holds it with no `podcast:guid`, so it cannot be followed
 *   unasked   no answer yet (not asked, or asking failed); NEVER a "not found"
 *
 * ⚠️ AN ABSENT KEY IS "COULD NOT ASK", AND IT IS NEVER "NOT FOUND". That is
 * the endpoint's three-state contract, and collapsing it here would tell a
 * member whose lookup met a rate limit that nobody has heard of half their
 * library, with no way to try again. The `podcast:guid` is what a follow is
 * keyed by, so two addresses for one show add ONE entry, and a show already
 * on the list is left exactly as it is.
 */
export function sortOpmlAnswers(feeds, answers, isFollowed) {
  const out = { add: [], already: [], notFound: [], noGuid: [], unasked: [] }
  const taking = new Set()
  for (const feed of feeds ?? []) {
    if (!Object.prototype.hasOwnProperty.call(answers ?? {}, feed.url)) { out.unasked.push(feed); continue }
    const row = answers[feed.url]
    if (!row) { out.notFound.push(feed); continue }
    const guid = row.guid
    if (!guid) out.noGuid.push(feed)
    else if (isFollowed(guid) || taking.has(guid)) out.already.push(feed)
    else { taking.add(guid); out.add.push({ feed, row }) }
  }
  return out
}

/* ── Writing a file ──────────────────────────────────────────────────────── */

/**
 * A value made safe inside a double-quoted XML attribute or a text node. The
 * characters XML 1.0 forbids outright are removed rather than escaped (a
 * numeric reference to one is still an error to a conforming parser), a lone
 * surrogate becomes U+FFFD for the same reason, and tab, CR and LF are
 * written as the spaces an attribute normalizer would fold them to.
 */
function xmlAttr(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�')
    .replace(/[\t\n\r]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The OPML 2.0 document an export writes, and how many shows went into it:
 * `{ xml, written }`. `shows` are `{ url, title }`; one with no usable `url`
 * is left out, and the same address is written once. Every value is escaped
 * for an attribute, which is what keeps the file importable at all: a feed
 * address routinely carries `&` in its query string and a title `&` and
 * quotes, and one unescaped is a document the next app's parser rejects whole.
 */
export function buildOpml(shows, { title, created }) {
  const lines = []
  const seen = new Set()
  for (const show of shows ?? []) {
    const url = show?.url ? opmlFeedUrl(show.url) : null
    if (!url || seen.has(url)) continue
    seen.add(url)
    const t = xmlAttr(String(show.title ?? '').replace(/\s+/g, ' ').trim() || url)
    lines.push(`    <outline type="rss" text="${t}" title="${t}" xmlUrl="${xmlAttr(url)}"/>`)
  }
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${xmlAttr(title)}</title>`,
    `    <dateCreated>${created.toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...lines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n')
  return { xml, written: lines.length }
}

/** `onlyboosts-podcasts-<YYYY-MM-DD>.opml`, the date in the caller's zone. */
export function opmlFilename(created) {
  const pad = (n) => String(n).padStart(2, '0')
  return `onlyboosts-podcasts-${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}.opml`
}
