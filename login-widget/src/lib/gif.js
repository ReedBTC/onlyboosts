/**
 * A GIF in a boost message (2026-11-12).
 *
 * The picker in `components/GifPicker.jsx` searches gifs.nostr.build, and the
 * GIF a booster picks travels as ONE LINK ON ITS OWN LINE AFTER THE MESSAGE:
 *
 *     great episode
 *     https://gifs.nostr.build/<sha256>.gif
 *
 * That one string is the boostagram's message, the LNURL comment and what the
 * note is built from, so the show's app and Nostr cannot disagree about what
 * was sent. It is the shape BoostMeBitch ships (its `withGif`), which is why
 * a boost from either app reads the same in Helipad and in every relay bot.
 *
 * ⚠️ THE LINK SPENDS THE MESSAGE'S 300 BYTES. Measured over 1,200 search
 * results (six searches, 2026-11-12): 93 bytes for 87% of them, 105 for 12%,
 * 106 at most. The modal counts the link like any other text and declines a
 * pick that would not fit; nothing is ever shortened to make room.
 *
 * ⚠️ ONLY A LINK THIS FILE RECOGNISES IS TREATED AS A GIF, and the pattern is
 * the whole of what the API hands out as an item's `url`: the host, one path
 * segment, `.gif` or `.webp`. All 1,200 sampled items fit it. A preview or
 * video URL (`/anim/…`, `/mp4/…`) has a second segment and does not, on
 * purpose: those are for picking, never for posting. `functions/api/sign-boost.js`
 * holds its own copy of the pattern (a Function imports nothing from the
 * widget) and `scripts/test-sign-boost.mjs` feeds it from this file.
 */
export const GIF_HOST = 'https://gifs.nostr.build'
export const GIF_URL_RE = /^https:\/\/gifs\.nostr\.build\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:gif|webp)$/

export function isGifUrl(url) {
  return typeof url === 'string' && GIF_URL_RE.test(url)
}

/** The message with the GIF's link on a line of its own after it; the bare
 *  link when there are no words, and the words alone when there is no GIF. */
export function withGif(text, url) {
  const t = String(text || '').trim()
  if (!isGifUrl(url)) return t
  return t ? `${t}\n${url}` : url
}

/** `withGif` undone: the words, and the GIF link when the message ends on one.
 *  The note builders use it to put the link outside the quotation marks, where
 *  a Nostr client's link parser reads it clean. A link typed by hand as the
 *  last line is the same string and gets the same treatment. */
export function splitGif(message) {
  const m = String(message || '').trim()
  const at = m.lastIndexOf('\n')
  const last = at < 0 ? m : m.slice(at + 1)
  if (!isGifUrl(last)) return { text: m, gifUrl: '' }
  return { text: at < 0 ? '' : m.slice(0, at).trimEnd(), gifUrl: last }
}

const onHost = (u) => (typeof u === 'string' && u.startsWith(`${GIF_HOST}/`) && !u.includes('#') ? u : '')

/** What the modal keeps of a picked search result: the link it posts, the
 *  three facts the `imeta` tag states, and the preview it shows beside the
 *  field. Null for anything that is not one of the API's own items. */
export function pickedGif(item) {
  if (!item || !isGifUrl(item.url)) return null
  const dim = (n) => { const v = Math.round(Number(n)); return v > 0 && v <= 99999 ? v : 0 }
  const preview = item.previews?.w240 || item.previews?.medium || null
  return {
    url: item.url,
    width: dim(item.width),
    height: dim(item.height),
    format: item.format === 'webp' || (item.format !== 'gif' && /\.webp$/.test(item.url)) ? 'webp' : 'gif',
    title: String(item.title || '').trim().slice(0, 120),
    animated: onHost(preview?.animated),
    still: onHost(preview?.still),
  }
}

/**
 * The NIP-92 `imeta` tag for the note's GIF, which gifs.nostr.build asks its
 * clients to write so a reader's app can lay the picture out before it loads.
 *
 * ⚠️ FOUR ITEMS AND NO MORE: the link, the type, the size. The bot signs the
 * note for a booster with no key, its validator caps every tag at four items,
 * and the same tag rides both routes so the two notes differ in nothing but
 * the signer. `alt` and `size` are optional in NIP-92 and are left out rather
 * than loosening that cap. No tag at all unless `gif` describes exactly the
 * link the note carries.
 */
export function gifImetaTag(gif, url) {
  if (!gif || !isGifUrl(url) || gif.url !== url) return null
  const w = Math.round(Number(gif.width))
  const h = Math.round(Number(gif.height))
  if (!(w > 0 && w <= 99999 && h > 0 && h <= 99999)) return null
  return ['imeta', `url ${url}`, `m image/${gif.format === 'webp' ? 'webp' : 'gif'}`, `dim ${w}x${h}`]
}

/**
 * The first `max` characters of a message, with a link WHOLE OR ABSENT.
 *
 * The LNURL comment is cut to the recipient's `commentAllowed`, and a cut that
 * lands inside a link leaves the podcaster a dead one: the same harm
 * `buildLnurlComment` already refuses for the BoostBox descriptor. So a link
 * the cut would land in is dropped from its first character, with whatever
 * followed it.
 */
export function sliceWholeUrls(text, max) {
  const s = String(text || '')
  const n = Math.floor(Number(max) || 0)
  if (n <= 0) return ''
  if (s.length <= n) return s
  const re = /https?:\/\/\S+/g
  let m
  while ((m = re.exec(s)) && m.index < n) {
    if (m.index + m[0].length > n) return s.slice(0, m.index).trimEnd()
  }
  return s.slice(0, n)
}
