/* Feed language filter — the "Language: All ▾" dropdown beside the range and
 * sort controls on the four ranked feeds.
 *
 * `<language>` is an RSS CHANNEL element, so it is a property of the SHOW and an
 * episode inherits its feed's. The collector stores the primary subtag only
 * (`en`, never `en-US`): the corpus describes ~21 languages in 36 distinct raw
 * tags, and en / en-us / en-gb / en-au are one language and four menu entries.
 *
 * ⚠️ NULL IS NOT ENGLISH, AND THAT IS THE WHOLE DESIGN OF THIS CONTROL.
 * 594 of the index's 1,294 shows declare no language at all — 341 on the podcast
 * side and 253 on music, where a single host (Wavlake, 198 of the 251 misses)
 * publishes no `<language>` on release feeds. So an untagged show is a populous,
 * first-class state rather than a gap to default away, and folding it into
 * English would turn "filter by language" into "hide half the Albums feed" under
 * a claim those publishers never made.
 *
 * `lang=en` therefore EXCLUDES the untagged, and the bucket is asked for by name
 * with `lang=unknown`. It gets its own row in the menu for the same reason the
 * Shows feed labels a show Podcast Index cannot identify rather than dropping
 * it: once a reader has filtered, that row is the only way back to those shows.
 * This is the medium split's partition rule one axis over.
 *
 * ── Why the menu is fetched rather than declared ──────────────────────
 *
 * /api/v1/languages answers with the languages that are actually present, and
 * it is MEDIUM-AWARE, which is what makes one shared list wrong: German is 38
 * shows on the podcast side against 2 on the music side, and four of the music
 * side's languages are a single show each. A hardcoded table would offer Albums
 * options matching nothing on the feed being read, and would go stale silently
 * the first time somebody boosts a show in a new language.
 *
 * ⚠️ THE LIST IS LONGER THAN THE BOOST FIGURES SUGGEST, AND NO ROW IS DROPPED.
 * Measured live on 2026-08-17: 19 buckets on the podcast side and 6 on music,
 * with TEN of the podcast languages sitting at a single show each (ar, da, el,
 * fi, ja, nb, zh …). Boost-weighted the tail is nothing — English is 16,611 and
 * German 3,150, which is 82% of all non-English boosts, and everything below
 * Spanish is under 150 — so a floor is tempting and is not applied. Hiding the
 * one Japanese show's language makes that show unfindable by the axis the
 * control exists for, which is the same objection that keeps "Not tagged" in
 * the list. Ordering by show count already puts the useful rows on top.
 *
 * The consequence is a menu that can outgrow the viewport, so `.pcast-lang`
 * scrolls it (feed-cards.css). That is the real constraint; a floor would have
 * been a cap on the data to avoid solving it.
 */
import { sortControl } from '/assets/js/feed-controls.js?v=ob-v98'
import { getLanguages } from '/assets/js/ob-live.js?v=ob-v98'

/** No filter. The opening state of every feed, and never sent to the API. */
export const LANG_ALL = 'all'

/** The shows whose feed declares no `<language>` at all. */
export const LANG_UNKNOWN = 'unknown'

/* Subtag → English name. Deliberately English rather than the reader's locale
 * or the endonym ("Deutsch"), on two counts: the site's chrome is one language
 * the way its dates are one format, and this is a CONTENT filter rather than a
 * UI-language picker — an English-speaking reader narrowing the feed to German
 * podcasts wants the word "German", which is also the word the feed note has to
 * use in an English sentence below.
 *
 * Intl.DisplayNames returns the input unchanged for a subtag it doesn't know, so
 * that case falls through to the same uppercase fallback as a thrown one.
 */
let displayNames = null
function languageName(subtag) {
  if (displayNames === null) {
    try { displayNames = new Intl.DisplayNames(['en'], { type: 'language' }) } catch { displayNames = false }
  }
  if (displayNames) {
    try {
      const name = displayNames.of(subtag)
      if (name && name.toLowerCase() !== subtag.toLowerCase()) return name
    } catch { /* fall through */ }
  }
  return subtag.toUpperCase()
}

/**
 * The label for a key, without waiting for the menu.
 *
 * The menu is fetched, but a language arriving in the URL has to name itself in
 * the feed note on the FIRST paint, before that request has landed. Deriving it
 * from the subtag is what makes `#shows?lang=de` say "German-language shows
 * only" immediately rather than a beat later.
 */
export function langLabelFor(key) {
  if (!key || key === LANG_ALL) return 'All'
  if (key === LANG_UNKNOWN) return 'Not tagged'
  return languageName(key)
}

/**
 * Build this feed's menu rows from the index.
 *
 * @param {object} opts
 * @param {'music'|null} [opts.medium]  'music' selects the Songs/Albums half.
 *   Everything else is sent as not_medium=music, the same partition the rest of
 *   the site draws — video and the shows Podcast Index cannot identify belong to
 *   the Episodes/Shows side.
 * @returns {Promise<Array<[string,string]>|null>} [key, label] pairs for
 *   sortControl, or null when there is nothing to choose between.
 *
 * ⚠️ NULL IS A WITHHELD CONTROL, NOT AN ERROR, and there are three ways to get
 * it: the endpoint failed, it 404'd (the API half of this feature ships on its
 * own deploy, and this module predates nothing), or the feed genuinely holds one
 * bucket. A single bucket means "All" and that bucket are the same set, so the
 * menu could only ever be a no-op — the same call the booster page's show filter
 * makes in withholding itself below two shows. A feed with no language control
 * is exactly the feed that shipped before this existed.
 */
export async function languageOptions({ medium = null, signal } = {}) {
  let rows
  try {
    rows = await getLanguages({ medium, signal })
  } catch (e) {
    console.warn('[lang] languages unavailable', e)
    return null
  }
  if (!Array.isArray(rows) || rows.length < 2) return null

  // The endpoint orders by show count and returns `unknown` as a peer row, which
  // would put it second on the podcast side (341 shows against English's 384).
  // Real languages keep that ordering; the bucket is pinned last, because it
  // names an absence rather than a language and reads as the menu's floor.
  const named = []
  let hasUnknown = false
  for (const row of rows) {
    const key = typeof row?.lang === 'string' ? row.lang.trim().toLowerCase() : ''
    if (!key) continue
    if (key === LANG_UNKNOWN) { hasUnknown = true; continue }
    named.push([key, languageName(key)])
  }
  if (!named.length && !hasUnknown) return null

  const options = [[LANG_ALL, 'All'], ...named]
  if (hasUnknown) options.push([LANG_UNKNOWN, 'Not tagged'])
  return options.length > 2 ? options : null
}

/**
 * The dropdown itself — the sort pill's chrome with a different tag, because a
 * second control in the same bar that behaved or looked differently would be
 * two controls to learn rather than one.
 *
 * @param {Array<[string,string]>} options  from languageOptions
 * @param {string}   initialKey
 * @param {Function} onPick  called with (key, label); the label is passed
 *   because the feed note and the no-match line both have to name the language
 *   in prose and neither should re-derive it.
 */
export function langControl(options, initialKey, onPick, opts = {}) {
  const labelFor = (key) => (options.find((o) => o[0] === key) || options[0])[1]
  const el = sortControl(options, initialKey, (key) => {
    const label = labelFor(key)
    paint(key, label)
    onPick(key, label)
  }, {
    // No colon: `.pcast-lang` adds one, so that under 640px, where the unset
    // pill shows the tag alone, it can be dropped and leave "Language" rather
    // than a dangling "Language:".
    tag: 'Language',
    // Names the SHOW deliberately, on every feed. On Episodes and Songs the
    // cards are episodes and tracks, but the tag they are being filtered by is
    // their feed's, and a tooltip saying "episode language" would describe a
    // field that does not exist.
    title: opts.title || 'Filter by the show’s language',
  })
  // The sort pill's chrome with one addition: this menu's LENGTH IS DATA rather
  // than design — 19 rows today and one more the first time somebody boosts a
  // show in a new language — so it is the one dropdown on the site that has to
  // scroll. The class is the only hook feed-cards.css needs for that.
  el.classList.add('pcast-lang')

  /* ⚠️ THE PHONE SHOWS THE SUBTAG, NOT THE NAME, AND IT IS THE ONLY THING THAT
   * MAKES THREE CONTROLS FIT. Measured over every sort x language combination
   * at 375px: with the full name in the pill, 58 of 120 fit on one line, because
   * "Norwegian Bokmål" and "Recently boosted" are 141px each against the 335px
   * inside the bar. "DE" is 48px, which takes every picked state under the line.
   *
   * The full name is never lost: it is the menu row the reader picks from, and
   * it is the button's own tooltip. This span is empty and `display:none` above
   * 640px, so the desktop pill is exactly the "Language: German ▾" it was.
   */
  const btn = el.querySelector('.pcast-sort-btn')
  const short = document.createElement('span')
  short.className = 'pcast-lang-short'
  btn.insertBefore(short, btn.querySelector('.pcast-sort-caret'))

  // ⚠️ `data-lang` is what the narrow-viewport CSS reads to decide whether this
  // pill shows its AXIS or its VALUE, so it has to move with the key or the
  // pill goes on naming a filter it no longer applies.
  function paint(key, label) {
    el.dataset.lang = key
    short.textContent = key === LANG_ALL ? ''
      // 'unknown' is not a subtag and uppercasing it reads as one. The menu row
      // says "Not tagged"; this is the same claim with no room to make it.
      : key === LANG_UNKNOWN ? 'None'
      : key.toUpperCase()
    // setAttribute rather than `.title =`, matching the h() helper every control
    // here is built with. The tooltip is where the language's NAME survives once
    // the phone rule has swapped the pill down to its subtag.
    btn.setAttribute('title', key === LANG_ALL
      ? (opts.title || 'Filter by the show’s language')
      : `Language: ${label}`)
  }
  paint(initialKey, labelFor(initialKey))
  return el
}

/**
 * "German-language shows" / "shows with no language tag" — the phrase the feed
 * note and the search's no-match line both need.
 *
 * `-language` rather than a bare "German shows" because the bare form is
 * ambiguous for exactly the languages that dominate the index: "English shows"
 * reads as shows from England, where the filter means shows in English.
 *
 * @param {string} noun  the medium's SHOW-level word — 'show' or 'album'. Not
 *   'episode' or 'track' even on the Episodes and Songs feeds: the language is
 *   the feed's, and the filter selects shows whose episodes then appear.
 */
export function langPhrase(key, label, noun = 'show') {
  if (key === LANG_UNKNOWN) return `${noun}s with no language tag`
  return `${label}-language ${noun}s`
}

/**
 * The feed note under a language filter.
 *
 * Composed as a SECOND SENTENCE rather than by rewriting the first, so the line
 * that has always named the ranking corpus ("Ranks based on every boost in the
 * index") is untouched and the filter reads as what it is — a narrowing applied
 * to it. That also makes one rule cover both scopes and both media instead of
 * four rewritten strings per renderer.
 */
export function langNote(base, key, label, noun = 'show') {
  if (!key || key === LANG_ALL) return base
  const phrase = langPhrase(key, label, noun)
  return `${base}. ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} only.`
}

/**
 * The search typeahead's no-match line when a language filter is active.
 *
 * ⚠️ THIS OUTRANKS THE RANGE AND SCOPE LINES, and the ordering is the point. A
 * miss under two filters has two possible causes, and the one worth naming is
 * the narrowest and most recently chosen — the language, which is also the only
 * one whose fix is a single press. "Try All languages" rather than the range
 * control's bare "Try All", since two controls now offer an All.
 */
export function langNoMatchText(key, label, noun = 'show') {
  return `No match among ${langPhrase(key, label, noun)}. Try All languages.`
}
