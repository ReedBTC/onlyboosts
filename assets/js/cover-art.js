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
 * ⚠️ `art2` is in the STATIC SHARDS ONLY. The D1 `podcasts` table has no
 * artwork column yet, so `/api/v1/*` and the server-rendered /show pages get
 * nothing here until that migration and backfill land. Don't assume it exists
 * on that side.
 */

function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

/**
 * Ordered, deduped, http(s)-only. Every URL in a chain reaches an `img.src`, so
 * they go through the same guard any single one would — a chain is not a reason
 * to relax it.
 *
 * Deduping matters: `art2` is meant to be null when it equals `img`, but the
 * shards are third-party data and a repeat would otherwise cost a second
 * request for the URL that just failed.
 */
export function coverChain(...urls) {
  const out = []
  for (const u of urls.flat()) {
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
