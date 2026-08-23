/* Cover art with a second chance.
 *
 * Some feeds publish two different artwork URLs — RSS `<image><url>` and
 * `<itunes:image>` — and the first one is sometimes dead while the second still
 * resolves. Homegrown Hits is the case that prompted this: its
 * bowlafterbowl.com art 404s, and feed.homegrownhits.xyz serves fine. Podcast
 * Index exposes both; the collector was collapsing them to one and throwing the
 * live URL away. It now publishes the second as `art2` (null when identical),
 * so the browser can advance through the chain on error.
 *
 * See docs/HANDOFF-art2-fallback.md. BMB's components/podcast-cover.tsx is the
 * reference implementation, and its comment names the same show.
 *
 * `art2` is on BOTH sides now. It has always been in the static shards; the D1
 * `podcasts.artwork` column was added and backfilled out-of-band and `d1_sync.py`
 * un-gated the projection in 6be0eb5, so `/api/v1/*` and the server-rendered
 * /show pages carry it too. Anything reading a show's artwork from either source
 * should walk the chain — see the table in CLAUDE.md for which surface takes
 * which route.
 */

function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

/**
 * An `http://` image URL, promoted to https.
 *
 * ⚠️ IT IS NOT A CHOICE WE ARE MAKING; IT IS THE ONE THE BROWSER ALREADY MADE.
 * Every page here is https, so an http image is mixed content and Chrome
 * auto-upgrades it and then **blocks it outright if https fails** — it never
 * falls back to the insecure copy. So the http URL was already unreachable as
 * written; all this does is stop the console filling with upgrade warnings and
 * stop the chain holding two entries for one picture.
 *
 * Measured over 200 boosts, 2026-08-22: 7 `episode.img`, 5 `podcast.img` and 1
 * `booster.pic` are http. `folkhour.com`, the commonest, serves the identical
 * PNG over https with a 200.
 *
 * ⚠️ A HOST WITH NO HTTPS AT ALL IS THEREFORE NOT MADE WORSE, and the chain is
 * why: an upgraded URL that fails advances to the next source exactly as a dead
 * https URL always has. That is the whole reason this is safe to do to a third
 * party's URL without asking them.
 */
export function httpsUrl(u) {
  return typeof u === 'string' && u.startsWith('http://')
    ? 'https://' + u.slice(7)
    : u
}

/**
 * Ordered, deduped, http(s)-only. Every URL in a chain reaches an `img.src`, so
 * they go through the same guard any single one would — a chain is not a reason
 * to relax it.
 *
 * Deduping matters: `art2` is meant to be null when it equals `img`, but the
 * shards are third-party data and a repeat would otherwise cost a second
 * request for the URL that just failed. **The https promotion happens before
 * the dedupe**, so a feed publishing the same picture as http and https is one
 * entry rather than two attempts at the same bytes.
 */
export function coverChain(...urls) {
  const out = []
  for (const raw of urls.flat()) {
    const u = httpsUrl(raw)
    if (!isSafeUrl(u) && !(typeof u === 'string' && u.startsWith('/'))) continue
    if (!out.includes(u)) out.push(u)
  }
  return out
}

/**
 * Point `img` at the first URL in `chain` and advance on each error.
 *
 * `onExhausted` runs when nothing is left — that's where a caller swaps in its
 * own placeholder (the feeds replace the image with a glyph, which is not
 * something another URL can express). Without one the image is simply left on
 * its last attempt.
 *
 * The handler clears itself at the end of the chain, so a placeholder that is
 * itself unreachable can't loop.
 *
 * @returns {boolean} whether anything was set — false for an empty chain, which
 *   is the caller's cue to render its no-art state instead of an empty <img>.
 */
export function wireCoverFallback(img, chain, onExhausted) {
  if (!img || !chain.length) return false
  let i = 0
  img.onerror = () => {
    if (++i < chain.length) { img.src = chain[i]; return }
    img.onerror = null
    if (typeof onExhausted === 'function') onExhausted()
  }
  img.src = chain[0]
  return true
}
