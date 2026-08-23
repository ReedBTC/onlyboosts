/* Show-level feed — the rollup behind both Shows and Albums in the feed bar.
 *
 * The card is the SHOW, where the Episodes feeds' card is one EPISODE. Same
 * boosts underneath, rolled up a level: how much a show has taken, how many
 * people sent it, across how many episodes. Expanding a card lists that show's
 * episodes with their own boost totals.
 *
 * ── Shows vs Albums ──────────────────────────────────────────────────
 *
 * One renderer serves both, split on <podcast:medium>: a "music" feed is an
 * album whose items are tracks, everything else is a show whose items are
 * episodes. The rollup, the ranking and the card are identical, so the two
 * differ only in the copy table below and in which half of the corpus they
 * keep. Measured against the live index: 818 podcast, 465 music, 2 video.
 *
 * The split is a QUERY PARAMETER, not a client-side join: /api/v1/podcasts
 * takes medium=music or not_medium=music and answers already split, so the
 * browser never reconciles two datasets. This used to read podcasts/index.json
 * to join guid -> medium in memory, which cost the windowed ranges a request
 * the All range got for free; that whole path is gone with the rest of
 * ob-data.js's fetching half. The medium is still a property of the SHOW
 * rather than of a boost, which is why it is not on the boost record.
 *
 * An earlier pass at this replaced the episode feed with it and was reverted
 * (1f24c77) — correctly, since the two views answer different questions and the
 * episode one was never up for replacement. Shows now has its own slot in the
 * feed bar, so nothing is displaced.
 *
 * ── Two sources, one card shape ──────────────────────────────────────
 *
 * The range filter is what decides where a card's numbers come from, because
 * only one of the two sources can answer each range honestly:
 *
 *   All      podcasts/index.json — the collector's own per-show rollup, 1,384
 *            shows with genuinely all-time counts, in one ~440KB request.
 *            Nothing is aggregated in the browser.
 *   1W / 1M  the boost corpus, grouped by podcast.guid here. The published
 *            index has no per-window breakdown, so a windowed view can only be
 *            built from the boosts themselves — and it must be, or a "last 7
 *            days" card would be showing all-time sat totals.
 *
 * That split is also why the windowed ranges are cheap: they read the same
 * latest.json + month archives the Episodes feeds already pull, and ob-data.js
 * caches them for the page's lifetime. Opening Episodes first makes this free.
 *
 * Scope: Global only on both, deliberately. podcasts/index.json is computed
 * over everyone, so it cannot serve a Follows audience — its counts would be
 * wrong for a filtered one. A Shows · Follows would have to roll the D1 corpus
 * up by show (ob-live.js#getFollowsBoosts, the way feeds-podcasts.js does by
 * episode); it just isn't built yet, which is why the scope menu stays hidden
 * on both of these feeds. The two Songs feeds have the axis because they are
 * episode-level and go through feeds-podcasts.js, which never reads this file.
 */
import {
  getShowPage, searchShows, getShowEpisodes, SEARCH_HITS, SEARCH_MIN_CHARS,
} from '/assets/js/ob-live.js?v=ob-v119'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls,
} from '/assets/js/feed-controls.js?v=ob-v119'
// Its own module, not two more exports of feed-controls.js — see the ⚠️ note
// at the top of that file for the four-hour window that shape opens.
import { mountFeedNote, resetFeedNote } from '/assets/js/feed-note.js?v=ob-v119'
import {
  LANG_ALL, languageOptions, langControl, langNote, langNoMatchText, langLabelFor,
} from '/assets/js/feed-lang.js?v=ob-v119'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v119'
import { competitionRanks, rankLabel } from '/assets/js/rank.js?v=ob-v119'
/* ⚠️ THE CARD ITSELF IS NOT IN THIS FILE ANY MORE. show-card.js emits it as an
 * HTML string and show-card-actions.js attaches its verbs, which is what lets
 * functions/index.js render the opening page of this feed at the edge — a
 * Function can splice a string into index.html and cannot run a DOM builder.
 * The copy table, the sort options, the rank value and the episode rows moved
 * with it, so both sides read one definition. See CLAUDE.md, "One Module,
 * Imported From Both Sides".
 *
 * Nothing is re-exported: feeds.js reaches this module for `renderShows` and
 * nothing else, so there is no importer of COPY or SORT_OPTIONS to keep whole.
 * feeds-podcasts.js does re-export episode-card.js's copy table, because it has
 * one. */
import {
  COPY, copyFor, toCard, showCardHtml, showRankValue,
  SORT_OPTIONS, RANKED_SORTS, SHOW_CARDS_PER_PAGE,
  num, fmtSats, plural,
} from '/assets/js/show-card.js?v=ob-v119'
import { wireShowCards } from '/assets/js/show-card-actions.js?v=ob-v119'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v119'

/* ── The hash's language, on an already-hydrated feed ──
 * The twin of the map in feeds-podcasts.js, and there for the same reason: a
 * feed hydrates once and then owns its control, so a URL pasted into an open tab
 * needs a way in that is not the loader. One listener, keyed by feed, so Shows
 * and Albums share it and a re-render replaces its entry rather than stacking a
 * second listener that requeries twice.
 */
const LANG_APPLY = new Map()
document.addEventListener('lb:set-feed-lang', (e) => {
  const detail = e && e.detail
  const apply = detail && detail.feed && LANG_APPLY.get(detail.feed)
  if (apply) apply(detail.lang || LANG_ALL)
})

// One number, declared in show-card.js and read by the edge too. See the note
// over SHOW_CARDS_PER_PAGE there.
const PAGE_SIZE = SHOW_CARDS_PER_PAGE

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) {
    if (kid == null) continue
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid)
  }
  return el
}

function renderPlaceholder(list, title, body) {
  list.className = ''
  list.replaceChildren(h('div', { class: 'feed-placeholder' }, [
    h('strong', { text: title }), document.createTextNode(body || ''),
  ]))
}

/* ⚠️ THE COMPARATORS ARE GONE, AND THAT WAS A CORRECTNESS FIX RATHER THAN A
 * SPEEDUP — the same move the Episodes feeds made, and this was the last
 * client-side aggregation on the site.
 *
 * All time read the collector's published per-show rollup WHOLE: ~440KB
 * describing every show in the index, downloaded to paint thirty cards. The
 * windowed ranges were worse in kind rather than in size — they walked
 * latest.json plus month archives and GROUPed the boosts by show in the
 * browser, so "the last 30 days" ranked over whatever those shards happened to
 * hold rather than over the window.
 *
 * `/api/v1/podcasts` aggregates over the whole boosts table inside the window,
 * so range and sort are QUERIES now and changing either refetches. SORT_OPTIONS
 * survives because its keys are the endpoint's own sort values, and RANKED_SORTS
 * because it still decides when a position is worth printing.
 */

// ── Source ────────────────────────────────────────────────────────────
/**
 * One page of ranked shows, adapted into the shape the card already reads.
 *
 * The endpoint returns the same record whichever range asked for it: on All it
 * reads the precomputed aggregate columns, on 1W/1M it GROUPs the boosts inside
 * the window. So the card does not know or care which one answered, and neither
 * does anything below this function.
 *
 * `eps` is no longer carried. The windowed rollup used to arrive with every
 * boost in memory, so the drawer's episode list came free; now BOTH ranges fetch
 * it on expand, through one endpoint that windows the rows the same way the card
 * was windowed. That is a request the windowed drawer did not previously make,
 * and in exchange the All drawer stops fetching the per-show shard, which ran to
 * 1.95MB on the most-boosted show.
 */
async function loadShowPage({ medium, sort, range, lang, offset, signal }) {
  const { records, nextOffset } = await getShowPage({
    medium: medium === 'music' ? 'music' : null,
    sort, range, lang, offset, signal,
  })
  return { items: records.map(toCard), nextOffset }
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} [opts.panel]  the feed's panel, for its feed key
 * @param {Element} opts.list     the [data-feed-list] container to fill
 * @param {string}  opts.medium   'other' (Shows) | 'music' (Albums)
 * @param {string}  [opts.lang]   the feed's OPENING language, off the hash
 *                                (`#shows?lang=de`). Must reach the first query.
 */
export async function renderShows({ panel, list, medium = 'other', lang = null }) {
  if (!list) return
  const copy = copyFor(medium)
  const wantMusic = medium === 'music'
  // Neither of these re-renders today (Global only, so no account switch
  // reaches them), but the reset is what makes that a fact about the feed
  // rather than an assumption baked into this one.
  resetFeedSearch(panel)
  resetFeedNote(panel)

  // All time is the opening view: the all-time leaderboard is the question a
  // show-level feed is for. The windowed ranges narrow it.
  let rangeKey = 'all'
  // Raw boost volume, matching the episode rollup's default — the ranking the
  // feed is *for*. 'boosters' ranks by distinct people instead, which differs
  // wherever someone boosts the same show repeatedly (most of them).
  let sortKey = 'boosts'
  // No language filter, which is NOT the same as English: 341 shows on this
  // side of the medium split and 253 on the music side declare no <language>
  // at all, so All is the only key that holds every card. See feed-lang.js.
  const feedKey = panel?.dataset.feed || (medium === 'music' ? 'albums' : 'shows')
  // The hash's language is the opening state. langLabelFor names it from the
  // subtag so the feed note reads correctly on the first paint, before the menu
  // request has landed.
  let langKey = (typeof lang === 'string' && lang) ? lang : LANG_ALL
  let langLabel = langLabelFor(langKey)
  let langOptions = null
  let langCtl = null
  // Fired here rather than where the control is mounted, so this small GROUP BY
  // overlaps the first page's much heavier one instead of following it. It is
  // never awaited on the render path — see the insert below. `languageOptions`
  // never rejects; it resolves null when the endpoint is unavailable or the feed
  // holds one bucket, and a null menu is a control that is simply not mounted.
  const langOptionsP = languageOptions({ medium: wantMusic ? 'music' : null })

  let shows = []          // the pages pulled so far, in the server's order
  let nextOffset = 0
  let loading = false
  let view = []           // what's painted: `shows`, or the one searched show
  let shown = 0
  let seq = 0
  let search = null
  // A pick is a fetch now, the same shape feeds-podcasts.js uses: `picked` is
  // the chosen suggestion, `pickedItem` the card built for it.
  let picked = null
  let pickedItem = null
  let pickLoading = false
  let pickSeq = 0

  /* `data-show-list` is what a card's drawer walks up to for the active window,
   * and `data-since` carries it. Read at OPEN time rather than baked into the
   * card, so a range change moves every drawer with it — see wireDrawer in
   * show-card-actions.js. The edge emits the same pair. */
  const cards = h('div', { class: 'pcast-list', 'data-show-list': '' })
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  const cutoff = () => rangeCutoff(rangeKey)

  function paintMore() {
    const slice = view.slice(shown, shown + PAGE_SIZE)
    /* ⚠️ ONE insertAdjacentHTML FOR THE WHOLE SLICE, then one wiring pass. The
     * cards are a string now, so appending them one at a time would reparse the
     * container per card; and the verbs must be attached AFTER the markup is in
     * the document, because wireShowCards queries for it. wireShowCards is
     * idempotent by a marker attribute, so running it over a container that
     * already holds wired cards costs a querySelectorAll and nothing else. */
    if (slice.length) {
      const since = cutoff()
      if (since) cards.setAttribute('data-since', String(since))
      else cards.removeAttribute('data-since')
      cards.insertAdjacentHTML('beforeend', slice.map((s) => showCardHtml(s, {
        rank: RANKED_SORTS.has(sortKey) ? rankLabel(s._rank, s._tied) : null,
        copy,
      })).join(''))
      wireShowCards(cards)
    }
    shown += slice.length
    moreWrap.replaceChildren()

    // Two different "more" buttons behind one control. Inside the pages already
    // held it is a slice, and past them it is a REQUEST — so the label stays
    // the same and the work does not.
    const local = view.length - shown
    const canFetch = !picked && nextOffset != null
    if (local <= 0 && !canFetch) return
    const batch = local > 0 ? Math.min(PAGE_SIZE, local) : PAGE_SIZE
    const btn = h('button', {
      class: 'pcast-showmore', type: 'button',
      onclick: async () => {
        if (local > 0) { paintMore(); return }
        if (loading) return
        loading = true
        btn.disabled = true
        btn.textContent = 'Loading…'
        try {
          const next = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, offset: nextOffset })
          shows = shows.concat(next.items)
          nextOffset = next.nextOffset
          rebuild({ keepShown: true })
        } catch (e) {
          console.warn('[shows] load more failed', e)
          btn.disabled = false
          btn.textContent = copy.moreLabel(batch)
        } finally {
          loading = false
        }
      },
    }, copy.moreLabel(batch))
    moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
      btn,
      // No total to count against: the endpoint pages rather than reporting how
      // many shows the whole range holds, so this says what is on screen.
      h('div', { class: 'pcast-more-count', text: copy.countLine(shown) }),
    ]))
  }

  /* ⚠️ RANK FIRST, FILTER SECOND, and the two halves now come from different
   * places. An unfiltered page is numbered by POSITION, because the server
   * returned it in rank order from offset 0 and numbering continues across
   * pages. A searched card cannot be numbered that way at all: it is one row out
   * of a filtered query and its standing is a fact about the whole index, so it
   * carries the `rank` the server computed and is never renumbered here.
   * Ranking the filtered list would tell a searched show it is #1 of 1, which
   * answers a different question.
   */
  /* ⚠️ THE LAST PAINTED CARD'S "T" IS THE ONE THING AN APPEND CAN CHANGE.
   * `keepShown` paints from `shown` onward and never re-renders what is already
   * on screen, but a card at the end of the loaded run could not see a tie
   * continuing into rows it had not fetched, so it painted a bare rank. Once
   * those rows arrive this writes the corrected label back. Idempotent, and on
   * a full repaint every label already matches, so it is a no-op. */
  function syncRankLabels() {
    if (picked) return
    const els = cards.querySelectorAll('.pcast-card')
    view.forEach((s, i) => {
      const node = els[i]?.querySelector('.pcast-rank')
      if (!node) return
      const label = RANKED_SORTS.has(sortKey) ? rankLabel(s._rank, s._tied) : null
      if (label != null && node.textContent !== label) node.textContent = label
    })
  }

  function rebuild({ keepShown = false } = {}) {
    /* ⚠️ COMPETITION RANKS, NOT POSITIONS: ties share the better place and the
     * next distinct value skips the group, so two shows with the same boost
     * count are not separated by the sats tiebreak the endpoint pages by. This
     * feed is never server-adopted, so `shows` is always a prefix from offset 0
     * and needs no seed. See assets/js/rank.js. */
    if (!picked) {
      const ranks = competitionRanks(shows, showRankValue(sortKey))
      shows.forEach((s, i) => { s._rank = ranks[i].rank; s._tied = ranks[i].tied })
    }
    search?.refresh()
    view = picked ? (pickedItem ? [pickedItem] : []) : shows
    const from = keepShown ? shown : 0
    shown = from
    if (!keepShown) cards.replaceChildren()
    moreWrap.replaceChildren()
    if (!view.length) {
      const empty = rangeKey === 'all' ? copy.emptyAll : copy.emptyWindow
      cards.appendChild(pickLoading
        ? h('div', { class: 'feed-placeholder' }, [
            h('strong', { text: 'Loading…' }),
            `Fetching ${picked?.label || 'that one'}.`,
          ])
        : picked
          ? h('div', { class: 'feed-placeholder' }, [
              h('strong', { text: 'Not in this range' }),
              copy.outOfRange(picked.label),
            ])
          : h('div', { class: 'feed-placeholder' }, [
              h('strong', { text: empty[0] }), empty[1],
            ]))
      return
    }
    paintMore()
    syncRankLabels()
  }

  /* Fetch the picked show under the feed's CURRENT range and sort.
   *
   * Re-issuing the query the suggestion came from is what makes the row
   * findable: same q, same filters, same ordering, so the pick is inside the
   * same handful of hits it was chosen from. It runs again on every range or
   * sort change, because both move the ranking the card is reporting and either
   * can push the show out of the window entirely.
   */
  async function resolvePick() {
    const mine = ++pickSeq
    // Dropping the filter comes through here too, and it has to repaint:
    // bumping pickSeq has already retired any resolve still in flight.
    if (!picked) { pickedItem = null; pickLoading = false; rebuild(); return }
    pickLoading = true
    pickedItem = null
    rebuild()
    try {
      const records = await searchShows({
        q: picked.query, medium: wantMusic ? 'music' : null,
        sort: sortKey, range: rangeKey, lang: langKey, limit: SEARCH_HITS,
      })
      if (mine !== pickSeq) return
      const hit = records.find((r) => r.guid === picked.key)
      pickedItem = hit ? toCard(hit) : null
      if (pickedItem) pickedItem._rank = pickedItem.rank
    } catch (e) {
      if (mine !== pickSeq) return
      console.warn('[shows] search pick failed', e)
      showToast('Couldn’t open that search result — please try again.', true)
    } finally {
      if (mine === pickSeq) { pickLoading = false; rebuild() }
    }
  }

  /* A range or sort change is a new QUERY, so it refetches from offset 0.
   *
   * The previous cards stay on screen while it is in flight rather than being
   * cleared to a spinner: a feed that blanks on every control press reads as
   * broken, and the answer usually arrives in well under a second.
   */
  /* ⚠️ NOT GUARDED BY `loading`, and that is the point. Dropping a second press
   * while the first is in flight would leave the control showing one range and
   * the cards showing another, since the key is already set by the time this
   * runs. Overlapping queries are allowed and the sequence guard makes the last
   * one win. `loading` is still SET, so the load-more button stays disabled
   * while a fresh first page is on its way to replacing it.
   */
  async function requery() {
    const mine = ++seq
    loading = true
    try {
      const page = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, offset: 0 })
      if (mine !== seq) return
      shows = page.items
      nextOffset = page.nextOffset
      rebuild()
      // The unfiltered list is still fetched under a live search filter, since
      // clearing the box has to reveal the new range rather than fetch again.
      if (picked) resolvePick()
    } catch (e) {
      if (mine !== seq) return
      console.error('[shows] requery failed', e)
      showToast(copy.rangeFail[0], true)
    } finally {
      if (mine === seq) loading = false
    }
  }

  let first
  try {
    first = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, offset: 0 })
  } catch (e) {
    console.error('[shows] index fetch failed', e)
    renderPlaceholder(list, ...copy.loadFail)
    return
  }
  shows = first.items
  nextOffset = first.nextOffset

  // The same line the Episodes and Songs feeds carry. There is no Follows scope
  // here yet, so it has one form; when Shows · Follows lands it gains the second
  // and this becomes the scope-dependent pick the other renderer already makes.
  // Through langNote even though the filter is provably All here, so this line
  // and the language control's cannot drift into two versions of one sentence.
  mountFeedNote(panel, langNote(copy.noteGlobal, langKey, langLabel, copy.noun))

  const controls = mountFeedControls(panel?.dataset.feed || (wantMusic ? 'albums' : 'shows'), [
    rangeControl(rangeKey, (key) => {
      if (key === rangeKey) return
      rangeKey = key
      requery()
    }, {
      label: copy.rangeLabel, titleFor: (key) => copy.rangeTitle(rangeDays(key)),
    }),
    sortControl(SORT_OPTIONS, sortKey, (key) => {
      if (key === sortKey) return
      sortKey = key
      requery()
    }, { title: copy.sortTitle }),
  ])

  /* A language change is a QUERY, exactly like the range and the sort, because
   * the ranking is computed over the filtered corpus server-side. Filtering the
   * loaded pages instead would rank a German show against the English ones it
   * was ranked beside, and could only ever find the languages inside the prefix
   * the reader had already paged in.
   *
   * The menu is fetched, so it is INSERTED into the bar when it lands rather
   * than awaited: re-mounting the group would throw away a control the reader
   * may already have open, and blocking would hold the whole bar for a menu
   * nobody has reached for. A null menu never inserts, which leaves exactly the
   * control bar that shipped before this existed.
   */
  function applyLang(key, label) {
    if (key === langKey) return
    langKey = key
    langLabel = label || langLabelFor(key)
    // "Ranks based on every boost in the index" stops being true the moment
    // this is anything but All.
    mountFeedNote(panel, langNote(copy.noteGlobal, langKey, langLabel, copy.noun))
    // The controller writes the hash from this, so a shareable URL falls out of
    // using the control. Reported on a COERCION too, which is what takes an
    // unshowable language back out of the address bar.
    document.dispatchEvent(new CustomEvent('lb:feed-lang', {
      detail: { feed: feedKey, lang: langKey === LANG_ALL ? '' : langKey },
    }))
    requery()
  }

  // Rebuilt rather than mutated: sortControl owns its own label and checkmark,
  // and an externally-set language has to move both.
  function mountLangControl() {
    if (!langOptions || !controls) return
    const next = langControl(langOptions, langKey, applyLang)
    if (langCtl && langCtl.parentNode === controls) controls.replaceChild(next, langCtl)
    // Before the sort pill: filters together, the ordering at the end.
    else controls.insertBefore(next, controls.lastElementChild)
    langCtl = next
  }

  /* The hash, on a feed already on screen. Registered even when the menu never
   * arrives: the QUERY works without it, so a URL can still filter a feed whose
   * control was withheld. */
  LANG_APPLY.set(feedKey, (key) => {
    // ⚠️ A URL can name a language THIS feed has none of — the music half holds
    // six buckets against the podcast half's nineteen. Coerce rather than paint
    // an empty feed under a filter the menu cannot display as selected.
    const want = (key && key !== LANG_ALL && langOptions
      && !langOptions.some((o) => o[0] === key)) ? LANG_ALL : (key || LANG_ALL)
    if (want === langKey) return
    applyLang(want, langLabelFor(want))
    mountLangControl()
  })

  langOptionsP.then((opts) => {
    if (!opts || !controls) return
    langOptions = opts
    // ⚠️ The opening language came from a URL and nothing has checked it against
    // what this feed holds. A stale or hand-written `?lang=` with no menu row is
    // dropped here, which reports and rewrites the hash.
    if (langKey !== LANG_ALL && !opts.some((o) => o[0] === langKey)) {
      applyLang(LANG_ALL, 'All')
    }
    mountLangControl()
  })

  search = mountFeedSearch(panel, {
    placeholder: copy.searchPlaceholder,
    label: copy.searchLabel,
    noun: copy.searchNoun,
    minChars: SEARCH_MIN_CHARS,
    onPick: (entry) => { picked = entry; resolvePick() },
    /* ⚠️ SEARCHES THE WHOLE INDEX, not the pages loaded. The in-memory index
     * this replaces read the full range, which was true only while the browser
     * downloaded every show; now the feed pages a ranked list and those pages
     * are a prefix of it.
     *
     * The guid and the author are still matched: the guid is the only handle on
     * the 33% of shows with no title, and an author lets a host or artist find
     * their own work. Both happen server-side now — the author through
     * `podcasts_fts`, which indexes it beside the title, and the guid as an
     * equality, since FTS5 does not index it and a pasted one is all hyphens.
     */
    searchRemote: async (query, { signal }) => {
      const records = await searchShows({
        q: query, medium: wantMusic ? 'music' : null,
        // ⚠️ THE LANGUAGE HAS TO TRAVEL WITH THE SEARCH, like the medium: a
        // suggestion the feed would then filter away to nothing is the
        // documented failure that keeps /api/v1/search off these feeds.
        sort: sortKey, range: rangeKey, lang: langKey, signal,
      })
      return records.map((r) => ({
        key: r.guid,
        label: r.title || copy.unidentified,
        // The show's own numbers, so two similarly-named feeds are told apart
        // by their size rather than by a guid nobody recognises — except on the
        // untitled ones, where the guid is the only handle there is.
        sub: r.title
          ? `${plural(num(r.boosts), 'boost', 'boosts')} · ${fmtSats(num(r.sats))} sats`
          : r.guid,
        img: r.img,
        query,
      }))
    },
    // The language is tested FIRST because it is the narrowest of the two
    // filters and the only one whose fix is a single press. It also outranks
    // the All case, where the line would otherwise call a coverage boundary on
    // a show that is in the index and merely in another language.
    noMatchText: () => (langKey !== LANG_ALL ? langNoMatchText(langKey, langLabel, copy.noun)
      : rangeKey === 'all' ? copy.searchNoneAll
      : copy.searchNoneRange),
  })

  list.className = ''
  list.replaceChildren(cards, moreWrap)
  rebuild()
}
