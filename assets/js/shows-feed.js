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
} from '/assets/js/ob-live.js?v=ob-v153'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls,
  RANGE_OPTIONS,
} from '/assets/js/feed-controls.js?v=ob-v153'
// Its own module, not two more exports of feed-controls.js — see the ⚠️ note
// at the top of that file for the four-hour window that shape opens.
import { mountFeedNote, resetFeedNote } from '/assets/js/feed-note.js?v=ob-v153'
import {
  LANG_ALL, languageOptions, langControl, langNote, langNoMatchText, langLabelFor,
} from '/assets/js/feed-lang.js?v=ob-v153'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v153'
import { competitionRanks, rankLabel, markSliceTies } from '/assets/js/rank.js?v=ob-v153'
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
} from '/assets/js/show-card.js?v=ob-v153'
import { wireShowCards } from '/assets/js/show-card-actions.js?v=ob-v153'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v153'

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

/* The hash's range and sort, on an already-hydrated feed — the same way in the
 * language has, as one event because a pasted URL states a whole view and its
 * two halves belong in one requery. '' in the detail means the feed's own
 * default, which this module resolves; the controller cannot, the defaults
 * being the renderers' to own. */
const VIEW_APPLY = new Map()
document.addEventListener('lb:set-feed-view', (e) => {
  const detail = e && e.detail
  const apply = detail && detail.feed && VIEW_APPLY.get(detail.feed)
  if (apply) apply(detail)
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
async function loadShowPage({ medium, sort, range, lang, offset, q = null, signal }) {
  const { records, nextOffset } = await getShowPage({
    medium: medium === 'music' ? 'music' : null,
    sort, range, lang, offset, q, signal,
  })
  const items = records.map(toCard)
  // A `q=` page's records carry the server's rank — each row's standing in the
  // FULL ordering — and the painter reads `_rank`. An unfiltered page carries
  // none and is numbered by position in rebuild() instead.
  for (const it of items) if (Number.isFinite(it.rank)) it._rank = it.rank
  return { items, nextOffset }
}

// ── entry point ───────────────────────────────────────────────────────
/**
 * @param {Element} [opts.panel]  the feed's panel, for its feed key
 * @param {Element} opts.list     the [data-feed-list] container to fill
 * @param {string}  opts.medium   'other' (Shows) | 'music' (Albums)
 * @param {string}  [opts.lang]   the feed's OPENING language, off the hash
 *                                (`#shows?lang=de`). Must reach the first query.
 * @param {string}  [opts.range]  the OPENING range, off the hash. '' or absent
 *                                means the default (all time).
 * @param {string}  [opts.sort]   the OPENING sort, off the hash. Same rule.
 */
export async function renderShows({ panel, list, medium = 'other', lang = null, range = null, sort = null }) {
  if (!list) return
  const copy = copyFor(medium)
  const wantMusic = medium === 'music'
  // Neither of these re-renders today (Global only, so no account switch
  // reaches them), but the reset is what makes that a fact about the feed
  // rather than an assumption baked into this one.
  resetFeedSearch(panel)
  resetFeedNote(panel)

  /* Distinct people is the default sort, matching the episode rollup's: one
   * listener boosting a show forty times is one vote, not forty. It was
   * 'boosts' (raw volume) until Phase D put the front door on this feed.
   * ⚠️ Must match FEED.sort in functions/index.js, or the reader watches the
   * server's list get replaced by a different one. It is also what the hash
   * elides: a default view's address is the bare feed key. */
  const DEFAULT_SORT = 'boosters'
  /* The hash's range and sort are the opening state, like the language, and a
   * key the tables don't hold — a typo, or the other renderer's spelling
   * ('count' is the episodes endpoint's word for boosters) — coerces to the
   * default and is reported below, which takes it back out of the address bar. */
  const urlRange = (typeof range === 'string' && RANGE_OPTIONS.some((o) => o[0] === range)) ? range : ''
  const urlSort = (typeof sort === 'string' && SORT_OPTIONS.some((o) => o[0] === sort)) ? sort : ''
  // All time is the opening view: the all-time leaderboard is the question a
  // show-level feed is for. The windowed ranges narrow it.
  let rangeKey = urlRange || 'all'
  let sortKey = urlSort || DEFAULT_SORT
  // No language filter, which is NOT the same as English: 341 shows on this
  // side of the medium split and 253 on the music side declare no <language>
  // at all, so All is the only key that holds every card. See feed-lang.js.
  const feedKey = panel?.dataset.feed || (medium === 'music' ? 'albums' : 'shows')
  /* What the reader is looking at, reported so the controller can write the
   * hash from it — the shareable URL is a side effect of using the controls.
   * '' is the default, which keeps the bare hash bare. */
  function reportView() {
    document.dispatchEvent(new CustomEvent('lb:feed-view', {
      detail: {
        feed: feedKey,
        range: rangeKey === 'all' ? '' : rangeKey,
        sort: sortKey === DEFAULT_SORT ? '' : sortKey,
      },
    }))
  }
  // A URL-supplied key the tables refused: say so now, so the hash stops
  // claiming a view that is not going to be rendered.
  if ((range && range !== urlRange) || (sort && sort !== urlSort)) reportView()
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
  /* ⚠️ CARDS ON SCREEN THAT `shows` DOES NOT DESCRIBE.
   *
   * The server-rendered opening page is HTML with no card objects behind it,
   * and building them would mean shipping the same rows twice — once as markup
   * and once as JSON — which is the cost the server render exists to remove. So
   * `shows` holds only what THIS module fetched, the count is what every rank
   * is offset by, and the last painted card's rank and figure are the seed that
   * carries a tie across the one gap in the run. Every path that replaces those
   * cards clears all three. The twin of the same block in feeds-podcasts.js. */
  let adoptedCount = 0
  let adoptedLastRank = null
  let adoptedLastValue = null
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
  /* The submitted whole-query filter (Reed's ask, 2026-08-27): Enter in the
   * search box turns the feed into the full result list. While set, every page
   * this feed loads carries `q=` and `shows` holds RESULTS — a filtered slice
   * of the ranked view, each row wearing the server's own rank — so the
   * positional numbering and the tie-sync are both skipped. Cleared by a pick,
   * by the box's ×, and by anything that resets the corpus. */
  let query = ''

  /* `data-show-list` is what a card's drawer walks up to for the active window,
   * and `data-since` carries it. Read at OPEN time rather than baked into the
   * card, so a range change moves every drawer with it — see wireDrawer in
   * show-card-actions.js. The edge emits the same pair. */
  // `let`, because adoption REUSES the container the server painted rather than
  // copying its markup into this one. Copying would mean serialising and
  // re-parsing the whole opening page to end up with the same nodes.
  let cards = h('div', { class: 'pcast-list', 'data-show-list': '' })
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
          const next = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, q: query || null, offset: nextOffset })
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
      // many shows the whole range holds, so this says what is on screen — the
      // server's adopted cards included, since a reader counts what they can see.
      h('div', { class: 'pcast-more-count', text: copy.countLine(adoptedCount + shown) }),
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
    // Query results wear server ranks, which a later page cannot change.
    if (picked || query) return
    // The CARD elements, not the rank nodes: an unranked sort renders no rank
    // node at all and indexing those would slide by one. The server's adopted
    // block sits ahead of `view` in the DOM, hence the offset.
    const els = cards.querySelectorAll('[data-show-card]')
    view.forEach((s, i) => {
      const node = els[adoptedCount + i]?.querySelector('.pcast-rank')
      if (!node) return
      const label = RANKED_SORTS.has(sortKey) ? rankLabel(s._rank, s._tied) : null
      if (label != null && node.textContent !== label) node.textContent = label
    })
    // The seam itself: the server painted its last card without knowing what
    // followed it, and that card is not in `view` to be re-labelled above.
    if (adoptedCount && view.length && adoptedLastRank != null
        && showRankValue(sortKey)(view[0]) === adoptedLastValue) {
      const seam = els[adoptedCount - 1]?.querySelector('.pcast-rank')
      const label = rankLabel(adoptedLastRank, true)
      if (seam && seam.textContent !== label) seam.textContent = label
    }
  }

  function rebuild({ keepShown = false } = {}) {
    /* ⚠️ COMPETITION RANKS, NOT POSITIONS: ties share the better place and the
     * next distinct value skips the group, so two shows with the same boost
     * count are not separated by the sats tiebreak the endpoint pages by. See
     * assets/js/rank.js. */
    /* Query results are never renumbered: each row already wears the rank the
     * server computed over the whole ordering, and numbering the filtered list
     * by position would tell a searched show it is #1 of 1. Same rule the
     * single-pick path has always had. What IS stamped is the tie flag, from
     * ranks repeated inside the slice. */
    if (query && !picked) markSliceTies(shows)
    if (!picked && !query) {
      /* The seed carries the adopted block's last card across the one gap in
       * the run: `shows` is a contiguous prefix of the ranked view starting at
       * `adoptedCount`, not at 0, whenever the server painted the opening page.
       * Without it the first fetched row would restart the numbering and every
       * card below a straddling tie would be off by the size of that tie. */
      const ranks = competitionRanks(shows, showRankValue(sortKey), {
        startIndex: adoptedCount,
        prevValue: adoptedLastValue,
        prevRank: adoptedLastRank,
      })
      shows.forEach((s, i) => { s._rank = ranks[i].rank; s._tied = ranks[i].tied })
    }
    search?.refresh()
    view = picked ? (pickedItem ? [pickedItem] : []) : shows
    const from = keepShown ? shown : 0
    shown = from
    /* ⚠️ THE ADOPTED CARDS ARE NEVER CLEARED HERE. They are the container's own
     * contents and there is nothing to rebuild them from, so every path that
     * genuinely replaces the list — a requery, a search pick — drops adoption
     * explicitly BEFORE calling this. What reaches here with a count still set
     * is the opening paint and an append, neither of which may wipe them. */
    if (!keepShown && !adoptedCount) cards.replaceChildren()
    moreWrap.replaceChildren()
    // Same reasoning one line on: with the server's cards on screen, an empty
    // `shows` means nothing has been FETCHED yet, not that the feed is empty.
    if (!view.length && !adoptedCount) {
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
          : query
            // The menu's own no-hit line, so the two cannot drift into two
            // versions of what a miss means here.
            ? h('div', { class: 'feed-placeholder' }, [
                h('strong', { text: `No matches for “${query}”` }),
                noMatch(),
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
    // A pick paints one card in place of the list, so the server's cards are
    // gone the moment one resolves — and their count must stop offsetting ranks.
    // The boundary seed goes with the count: it describes a card that is no
    // longer on screen, and left behind it would tie the first fetched row to it.
    dropAdoption()
    // Dropping the filter comes through here too, and it has to repaint:
    // bumping pickSeq has already retired any resolve still in flight.
    if (!picked) { pickedItem = null; pickLoading = false; await refetchUnfiltered(); return }
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

  /* The server's opening page stops describing what is on screen.
   *
   * Called by every path that replaces the list wholesale rather than appending
   * to it. The count and the seed go together: the seed describes a card that
   * is no longer painted, and left behind it would tie the first fetched row to
   * a figure nothing on the page carries.
   */
  function dropAdoption() {
    adoptedCount = 0
    adoptedLastRank = null
    adoptedLastValue = null
  }

  /* Clearing a search has to reveal the full list again.
   *
   * On a feed that fetched its own first page `shows` still holds it and this
   * is a repaint. On the ADOPTED feed it does not — those cards were the
   * server's and a pick replaced them — so the page has to be fetched once,
   * which is the one request adoption defers rather than avoids. It is paid by
   * the reader who searched and then cleared, which is the right person to
   * charge for it.
   */
  async function refetchUnfiltered() {
    if (shows.length) { rebuild(); return }
    try {
      const page = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, q: query || null, offset: 0 })
      shows = page.items
      nextOffset = page.nextOffset
    } catch (e) {
      console.warn('[shows] reload failed', e)
      showToast(copy.rangeFail[0], true)
    }
    rebuild()
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
      const page = await loadShowPage({ medium, sort: sortKey, range: rangeKey, lang: langKey, q: query || null, offset: 0 })
      if (mine !== seq) return
      shows = page.items
      nextOffset = page.nextOffset
      // The answer arrived, so the server's opening page is about to be
      // replaced wholesale and stops offsetting anything, boundary seed
      // included. Done here rather than at the press, because a failed requery
      // leaves the old view on screen and those cards are still what it is.
      dropAdoption()
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

  /* The opening page, already rendered.
   *
   * functions/index.js server-renders Shows · All into the static shell, so on
   * that one feed the cards are on the page before this module is even fetched.
   * Adopting them rather than fetching the same rows again is the whole point
   * of having rendered them: it saves a request and a full repaint, and it
   * means the first thing the reader sees is the last thing they see.
   *
   * The state element is the contract, and it is deliberately tiny — the sort
   * and range the server used (so the controls open on the right values), how
   * many cards it painted, where the next page starts, and the last card's rank
   * and figure. It is REMOVED on adoption so a later re-render takes the
   * fetching path.
   *
   * ⚠️ THE MEDIUM IS CHECKED because one module serves two feeds. A shell
   * rendered for Shows must never be adopted by Albums, which is a different
   * half of the same partition and would paint podcasts under an Albums
   * heading. There is no scope to check: both of these feeds are Global only.
   *
   * ⚠️ THE SERVER'S CARDS ARE UNFILTERED, AND THE SERVER CANNOT KNOW OTHERWISE.
   * functions/index.js renders the opening page with no language, and a hash is
   * never sent to the server, so it could not honour one if it wanted to. A
   * `#shows?lang=de` load therefore has to FETCH rather than adopt — adopting
   * would paint thirty English shows under a German filter, with a note beneath
   * them saying otherwise.
   */
  function adoptServerCards() {
    const stateEl = list.querySelector('[data-feed-state]')
    if (!stateEl) return null
    let state = null
    try { state = JSON.parse(stateEl.textContent || '{}') } catch { return null }
    const painted = list.querySelector('.pcast-list')
    if (!state || !painted || !painted.querySelector('[data-show-card]')) return null
    if (state.medium !== medium) return null
    if (langKey !== LANG_ALL) return null
    /* Same argument one axis over: the server rendered its own opening range
     * and sort, and the state element declares which. A hash naming a different
     * view has to fetch — adopting would paint the all-time boosters board
     * under a URL and controls claiming this month by sats. An explicit
     * `?sort=boosters` that matches the server's is adopted as before. */
    if (urlRange && state.range !== urlRange) return null
    if (urlSort && state.sort !== urlSort) return null
    stateEl.remove()
    return { state, painted }
  }

  const adopted = adoptServerCards()

  if (adopted) {
    sortKey = adopted.state.sort || sortKey
    rangeKey = adopted.state.range || rangeKey
    adoptedCount = Number(adopted.state.count) || 0
    nextOffset = adopted.state.nextOffset ?? null
    /* The last server-painted card's rank and figure. The adopted cards are
     * markup with no data behind them, so without these the first fetched page
     * cannot tell whether its opening row continues the tie the last painted
     * one was part of. See the boundary note in _shared/show-cards.js. */
    adoptedLastRank = Number.isFinite(adopted.state.lastRank) ? adopted.state.lastRank : null
    adoptedLastValue = adopted.state.lastValue ?? null
    // The container the server painted IS the one this module appends to, so a
    // "load more" adds to the list already on screen instead of starting a
    // second one beside it — and no node is rebuilt.
    cards = adopted.painted
    list.appendChild(moreWrap)
  } else {
    // The first page decides whether there is a feed at all, so it is the one
    // fetch that can render a placeholder instead of cards.
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

    list.className = ''
    list.replaceChildren(cards, moreWrap)
  }

  // The same line the Episodes and Songs feeds carry. There is no Follows scope
  // here yet, so it has one form; when Shows · Follows lands it gains the second
  // and this becomes the scope-dependent pick the other renderer already makes.
  // Through langNote even though the filter is provably All here, so this line
  // and the language control's cannot drift into two versions of one sentence.
  mountFeedNote(panel, langNote(copy.noteGlobal, langKey, langLabel, copy.noun))

  function applyRange(key) {
    if (key === rangeKey) return
    rangeKey = key
    reportView()
    requery()
  }
  function applySort(key) {
    if (key === sortKey) return
    sortKey = key
    reportView()
    requery()
  }
  /* Rebuilt rather than mutated when the view is set from outside, the same
   * call mountLangControl makes and for the same reason: each control owns its
   * own pressed/label state, and an externally-set view has to move both.
   * mountFeedControls replaces the feed's previous group wholesale, so the
   * language pill is re-inserted after every mount. */
  let controls = null
  function mountViewControls() {
    controls = mountFeedControls(feedKey, [
      rangeControl(rangeKey, applyRange, {
        label: copy.rangeLabel, titleFor: (key) => copy.rangeTitle(rangeDays(key)),
      }),
      sortControl(SORT_OPTIONS, sortKey, applySort, { title: copy.sortTitle }),
    ])
    mountLangControl()
  }
  mountViewControls()

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

  /* The hash's range and sort, on a feed already on screen — same door as the
   * language's, one event for the pair so a pasted URL costs one requery. */
  VIEW_APPLY.set(feedKey, (detail) => {
    // Coerce rather than trust: the controller validates a sort by shape only,
    // so the other renderer's spelling (or a typo) can arrive here.
    const wantRange = (detail.range && RANGE_OPTIONS.some((o) => o[0] === detail.range))
      ? detail.range : 'all'
    const wantSort = (detail.sort && SORT_OPTIONS.some((o) => o[0] === detail.sort))
      ? detail.sort : DEFAULT_SORT
    if (wantRange === rangeKey && wantSort === sortKey) return
    rangeKey = wantRange
    sortKey = wantSort
    mountViewControls()
    // Reported back, which is what strips a coerced key out of the address bar.
    reportView()
    requery()
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

  // One definition of what a miss means, read by the menu's no-hit line and by
  // the feed placeholder a submitted query paints.
  function noMatch() {
    return langKey !== LANG_ALL ? langNoMatchText(langKey, langLabel, copy.noun)
      : rangeKey === 'all' ? copy.searchNoneAll
      : copy.searchNoneRange
  }

  search = mountFeedSearch(panel, {
    placeholder: copy.searchPlaceholder,
    label: copy.searchLabel,
    noun: copy.searchNoun,
    minChars: SEARCH_MIN_CHARS,
    onPick: (entry) => {
      /* Leaving query mode by any route resets the corpus: `shows` holds the
       * RESULTS while a query is active, and refetchUnfiltered's "still in
       * hand" shortcut would otherwise repaint them as the feed. */
      if (query) { query = ''; shows = []; nextOffset = 0 }
      picked = entry
      resolvePick()
    },
    /* Enter (or the menu's footer row): the feed becomes the full result list.
     * A query is a filter over the same ranked view the feed pages, so it runs
     * the ordinary pipeline with `q=` attached — the server applies the active
     * medium, range, sort and language, pages as usual, and stamps each row's
     * rank over the WHOLE ordering, which is what rank retention means here. */
    onSubmit: (q) => {
      // No same-query no-op guard: a requery can be dropped or fail, and Enter
      // again is the reader's retry. The worst repeat costs one coalesced fetch.
      query = q
      // Retire any pick resolve still in flight, the way resolvePick itself
      // would, so a late reply cannot repaint over the results.
      pickSeq++
      picked = null
      pickedItem = null
      pickLoading = false
      requery()
    },
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
    // `qText`, not `query` — that name is the renderer's own submitted-filter
    // state now, and shadowing it here invites reading one as the other.
    searchRemote: async (qText, { signal }) => {
      const records = await searchShows({
        q: qText, medium: wantMusic ? 'music' : null,
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
        query: qText,
      }))
    },
    // The language is tested FIRST because it is the narrowest of the two
    // filters and the only one whose fix is a single press. It also outranks
    // the All case, where the line would otherwise call a coverage boundary on
    // a show that is in the index and merely in another language.
    noMatchText: noMatch,
  })

  // The server's cards are complete markup and still need their verbs: the
  // boost pill, the drawer, and the relative time over each "last boost" date.
  // wireShowCards is idempotent by a marker attribute, so the paint below can
  // run over them again for nothing.
  if (adopted) wireShowCards(cards)
  rebuild()
}
