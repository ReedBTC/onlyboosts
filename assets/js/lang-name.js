/* A language subtag's English name — two-sided and dependency-free.
 *
 * `de` → "German", `es` → "Spanish". Deliberately English rather than the
 * reader's locale or the endonym ("Deutsch"): the site's chrome is one
 * language the way its dates are one format, and this names CONTENT (a
 * German-language podcast) inside an English sentence. The reasoning is
 * feed-lang.js's, which imported this on 2026-10-22 when the homepage's
 * language rails needed the same word at the edge.
 *
 * Intl.DisplayNames is pinned to 'en' on both sides (the Workers runtime
 * and every browser carry full ICU), so the edge and the browser print the
 * same word for the same subtag; an unknown subtag falls through to its
 * uppercase form rather than throwing.
 */
let displayNames = null
export function languageName(subtag) {
  const s = String(subtag || '')
  if (!s) return ''
  if (displayNames === null) {
    try { displayNames = new Intl.DisplayNames(['en'], { type: 'language' }) } catch { displayNames = false }
  }
  if (displayNames) {
    try {
      const name = displayNames.of(s)
      if (name && name.toLowerCase() !== s.toLowerCase()) return name
    } catch { /* fall through */ }
  }
  return s.toUpperCase()
}
