/* Artist-level feed — the rollup behind Artists in the feed bar.
 *
 * The card is the ARTIST, one tier above the Albums feed's card: music has
 * three levels of ownership — publisher > album (show) > song (episode) — and
 * <podcast:publisher> is the top one. `GET /api/v1/publishers` aggregates the
 * boosts to every show declaring the publisher, so range and sort are queries
 * and changing either refetches, the shape every ranked feed has had since the
 * server-side move. Expanding a card lists the artist's own album catalogue.
 *
 * Both scopes since 2026-08-31, the same move Shows and Albums made: the
 * Follows scope POSTs the contact list and /api/v1/publishers aggregates the
 * follow set's boosts per request. There is no adoption path — only the
 * landing feed is server-rendered, and it is Shows — so this module is
 * shows-feed.js with the adoption machinery and the medium split removed. The
 * two stay parallel on purpose; a fix in one usually wants the other read.
 *
 * The surface says "artist" and the code says "publisher" — the same seam as
 * Podcasts → Episodes, drawn between the product and the module.
 */
import {
  getPublisherPage, searchPublishers, SEARCH_HITS, SEARCH_MIN_CHARS,
} from '/assets/js/ob-live.js?v=ob-v189'
import { resolveFollows } from '/assets/js/follow-set.js?v=ob-v189'
import {
  rangeDays, rangeCutoff, rangeControl, sortControl, mountFeedControls, RANGE_OPTIONS,
} from '/assets/js/feed-controls.js?v=ob-v189'
import { mountFeedNote, resetFeedNote, viewNote, CHART_INFO } from '/assets/js/feed-note.js?v=ob-v189'
import {
  LANG_ALL, languageOptions, langControl, langNote, langNoMatchText, langLabelFor,
} from '/assets/js/feed-lang.js?v=ob-v189'
import { mountFeedSearch, resetFeedSearch } from '/assets/js/feed-search.js?v=ob-v189'
import { competitionRanks, rankLabel, markSliceTies } from '/assets/js/rank.js?v=ob-v189'
import {
  COPY, toCard, publisherCardHtml, publisherRankValue,
  SORT_OPTIONS, RANKED_SORTS, PUBLISHER_CARDS_PER_PAGE,
  num, fmtSats, plural,
} from '/assets/js/publisher-card.js?v=ob-v189'
import { wirePublisherCards } from '/assets/js/publisher-card-actions.js?v=ob-v189'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v189'

/* The hash's language / view on an already-hydrated feed — the same two doors
 * every ranked renderer keeps; see the twin maps in shows-feed.js. */
const LANG_APPLY = new Map()
document.addEventListener('lb:set-feed-lang', (e) => {
  const detail = e && e.detail
  const apply = detail && detail.feed && LANG_APPLY.get(detail.feed)
  if (apply) apply(detail.lang || LANG_ALL)
})
const VIEW_APPLY = new Map()
document.addEventListener('lb:set-feed-view', (e) => {
  const detail = e && e.detail
  const apply = detail && detail.feed && VIEW_APPLY.get(detail.feed)
  if (apply) apply(detail)
})

const PAGE_SIZE = PUBLISHER_CARDS_PER_PAGE

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

/** One page of ranked artists, adapted into the card's shape. */
async function loadPublisherPage({ follows = null, sort, range, lang, offset, q = null, signal }) {
  const { records, nextOffset } = await getPublisherPage({
    follows, sort, range, lang, offset, q, signal })
  const items = records.map(toCard)
  // A `q=` page's rows carry the server's rank over the FULL ordering.
  for (const it of items) if (Number.isFinite(it.rank)) it._rank = it.rank
  // The chart sort ranks EVERY row server-side; its corpus-true tie flag
  // rides beside the rank (see toCard) rather than being re-derived here.
  for (const it of items) if (it.tied) it._tied = true
  return { items, nextOffset }
}

/**
 * @param {Element} [opts.panel]  the feed's panel, for its feed key
 * @param {Element} opts.list     the [data-feed-list] container to fill
 * @param {string}  [opts.lang]   the OPENING language, off the hash
 * @param {string}  [opts.range]  the OPENING range, off the hash
 * @param {string}  [opts.sort]   the OPENING sort, off the hash
 */
export async function renderArtists({ panel, list, scope = 'global', lang = null, range = null, sort = null } = {}) {
  if (!list) return
  const copy = COPY
  // Numerals are withheld on Follows — the shows-feed.js rule, same reason.
  const showRanks = scope !== 'follows'
  resetFeedSearch(panel)
  resetFeedNote(panel)

  // The follows resolution, mirrored from shows-feed.js / feeds-podcasts.js.
  let follows = null
  if (scope === 'follows') {
    const res = await resolveFollows()
    if (res.status === 'signed-out') {
      renderPlaceholder(list, 'Sign in to see this feed', 'Follows feeds read your kind-3 contact list, so they need a signed-in npub.')
      return
    }
    if (res.status === 'unavailable') {
      renderPlaceholder(list, 'Couldn’t load your follow list', 'We couldn’t reach a relay holding your kind-3 contact list — please try again later.')
      return
    }
    if (res.status === 'empty') {
      renderPlaceholder(list, ...copy.noFollows)
      return
    }
    follows = res.follows
  }

  /* ⚠️ CHART RANK, matching every ranked feed since 2026-08-31 (Reed's
   * call) — also the endpoint's own default, and what the hash elides. It
   * was 'boosters' from this feed's first day. */
  const DEFAULT_SORT = 'chart'
  const urlRange = (typeof range === 'string' && RANGE_OPTIONS.some((o) => o[0] === range)) ? range : ''
  const urlSort = (typeof sort === 'string' && SORT_OPTIONS.some((o) => o[0] === sort)) ? sort : ''
  let rangeKey = urlRange || 'all'
  let sortKey = urlSort || DEFAULT_SORT
  const feedKey = panel?.dataset.feed || `artists-${scope}`

  function reportView() {
    document.dispatchEvent(new CustomEvent('lb:feed-view', {
      detail: {
        feed: feedKey,
        range: rangeKey === 'all' ? '' : rangeKey,
        sort: sortKey === DEFAULT_SORT ? '' : sortKey,
      },
    }))
  }
  // A URL-supplied key the tables refused: rewrite the hash to what renders.
  if ((range && range !== urlRange) || (sort && sort !== urlSort)) reportView()

  let langKey = (typeof lang === 'string' && lang) ? lang : LANG_ALL
  let langLabel = langLabelFor(langKey)
  let langOptions = null
  let langCtl = null
  /* The music menu, because the publisher tag is a music-host feature: 386 of
   * the 395 declaring shows are music, so the music facet IS this feed's facet
   * to within nine shows. The filter itself runs over the declaring shows'
   * languages server-side, whichever side of the medium they sit. */
  const langOptionsP = languageOptions({ medium: 'music' })

  let artists = []
  let nextOffset = 0
  let loading = false
  let view = []
  let shown = 0
  let seq = 0
  let search = null
  let picked = null
  let pickedItem = null
  let pickLoading = false
  let pickSeq = 0
  let query = ''

  /* `data-artist-list` is what a card's drawer walks up to for the active
   * window, and `data-since` carries it — read at OPEN time, so a range change
   * moves every drawer with it. The same pair the show cards use. */
  const cards = h('div', { class: 'pcast-list', 'data-artist-list': '' })
  // The drawer's corpus rides the container — see show-card-actions.js.
  if (follows) cards.obFollows = follows
  const moreWrap = h('div', { class: 'pcast-more-wrap' })

  const cutoff = () => rangeCutoff(rangeKey)

  function paintMore() {
    const slice = view.slice(shown, shown + PAGE_SIZE)
    if (slice.length) {
      const since = cutoff()
      if (since) cards.setAttribute('data-since', String(since))
      else cards.removeAttribute('data-since')
      cards.insertAdjacentHTML('beforeend', slice.map((p) => publisherCardHtml(p, {
        rank: (showRanks && RANKED_SORTS.has(sortKey)) ? rankLabel(p._rank, p._tied) : null,
        copy,
      })).join(''))
      wirePublisherCards(cards)
    }
    shown += slice.length
    moreWrap.replaceChildren()

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
          const next = await loadPublisherPage({ follows, sort: sortKey, range: rangeKey, lang: langKey, q: query || null, offset: nextOffset })
          artists = artists.concat(next.items)
          nextOffset = next.nextOffset
          rebuild({ keepShown: true })
        } catch (e) {
          console.warn('[artists] load more failed', e)
          btn.disabled = false
          btn.textContent = copy.moreLabel(batch)
        } finally {
          loading = false
        }
      },
    }, copy.moreLabel(batch))
    moreWrap.appendChild(h('div', { class: 'pcast-more-group' }, [
      btn,
      h('div', { class: 'pcast-more-count', text: copy.countLine(shown) }),
    ]))
  }

  function rebuild({ keepShown = false } = {}) {
    /* Rank first, filter second — competition ranks on the unfiltered list,
     * server ranks kept verbatim on a query's rows. See shows-feed.js. */
    /* Chart rows wear the server's rank and tie flag on every row — a tuple
     * standing the client cannot re-derive — so neither branch below runs. */
    if (sortKey !== 'chart' && query && !picked) markSliceTies(artists)
    if (sortKey !== 'chart' && !picked && !query) {
      const ranks = competitionRanks(artists, publisherRankValue(sortKey))
      artists.forEach((p, i) => { p._rank = ranks[i].rank; p._tied = ranks[i].tied })
    }
    search?.refresh()
    view = picked ? (pickedItem ? [pickedItem] : []) : artists
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
          : query
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
  }

  /* Fetch the picked artist under the CURRENT range and sort — re-issuing the
   * query the suggestion came from, so the row is inside the same hits. */
  async function resolvePick() {
    const mine = ++pickSeq
    if (!picked) { pickedItem = null; pickLoading = false; await refetchUnfiltered(); return }
    pickLoading = true
    pickedItem = null
    rebuild()
    try {
      const records = await searchPublishers({
        follows,
        q: picked.query, sort: sortKey, range: rangeKey, lang: langKey, limit: SEARCH_HITS,
      })
      if (mine !== pickSeq) return
      const hit = records.find((r) => r.guid === picked.key)
      pickedItem = hit ? toCard(hit) : null
      if (pickedItem) { pickedItem._rank = pickedItem.rank; if (pickedItem.tied) pickedItem._tied = true }
    } catch (e) {
      if (mine !== pickSeq) return
      console.warn('[artists] search pick failed', e)
      showToast('Couldn’t open that search result — please try again.', true)
    } finally {
      if (mine === pickSeq) { pickLoading = false; rebuild() }
    }
  }

  async function refetchUnfiltered() {
    if (artists.length) { rebuild(); return }
    try {
      const page = await loadPublisherPage({ follows, sort: sortKey, range: rangeKey, lang: langKey, q: query || null, offset: 0 })
      artists = page.items
      nextOffset = page.nextOffset
    } catch (e) {
      console.warn('[artists] reload failed', e)
      showToast(copy.rangeFail[0], true)
    }
    rebuild()
  }

  /* A range or sort change is a new QUERY. Not guarded by `loading`; the
   * sequence guard makes the last press win — see the note in shows-feed.js. */
  async function requery() {
    const mine = ++seq
    loading = true
    try {
      const page = await loadPublisherPage({ follows, sort: sortKey, range: rangeKey, lang: langKey, q: query || null, offset: 0 })
      if (mine !== seq) return
      artists = page.items
      nextOffset = page.nextOffset
      rebuild()
      if (picked) resolvePick()
    } catch (e) {
      if (mine !== seq) return
      console.error('[artists] requery failed', e)
      showToast(copy.rangeFail[0], true)
    } finally {
      if (mine === seq) loading = false
    }
  }

  // No adoption path: this feed is never server-rendered, so the first page
  // always fetches and is the one that can render a placeholder.
  let first
  try {
    first = await loadPublisherPage({ follows, sort: sortKey, range: rangeKey, lang: langKey, offset: 0 })
  } catch (e) {
    console.error('[artists] index fetch failed', e)
    renderPlaceholder(list, ...copy.loadFail)
    return
  }
  artists = first.items
  nextOffset = first.nextOffset

  list.className = ''
  list.replaceChildren(cards, moreWrap)

  /* The note under the controls, recomposed from the live view — sort,
   * range, scope — on every change; see viewNote in feed-note.js. The chart
   * sort carries the ⓘ link to /about#charts. */
  function paintNote() {
    mountFeedNote(panel,
      langNote(viewNote({ sort: sortKey, days: rangeDays(rangeKey), follows, noun: copy.noun }),
        langKey, langLabel, copy.noun),
      sortKey === 'chart' ? { info: CHART_INFO } : undefined)
  }
  paintNote()

  function applyRange(key) {
    if (key === rangeKey) return
    rangeKey = key
    reportView()
    paintNote()
    requery()
  }
  function applySort(key) {
    if (key === sortKey) return
    sortKey = key
    reportView()
    paintNote()
    requery()
  }
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

  function applyLang(key, label) {
    if (key === langKey) return
    langKey = key
    langLabel = label || langLabelFor(key)
    // The note names the language filter, so it repaints with it.
    paintNote()
    document.dispatchEvent(new CustomEvent('lb:feed-lang', {
      detail: { feed: feedKey, lang: langKey === LANG_ALL ? '' : langKey },
    }))
    requery()
  }

  function mountLangControl() {
    if (!langOptions || !controls) return
    const next = langControl(langOptions, langKey, applyLang)
    if (langCtl && langCtl.parentNode === controls) controls.replaceChild(next, langCtl)
    else controls.insertBefore(next, controls.lastElementChild)
    langCtl = next
  }

  LANG_APPLY.set(feedKey, (key) => {
    const want = (key && key !== LANG_ALL && langOptions
      && !langOptions.some((o) => o[0] === key)) ? LANG_ALL : (key || LANG_ALL)
    if (want === langKey) return
    applyLang(want, langLabelFor(want))
    mountLangControl()
  })

  VIEW_APPLY.set(feedKey, (detail) => {
    const wantRange = (detail.range && RANGE_OPTIONS.some((o) => o[0] === detail.range))
      ? detail.range : 'all'
    const wantSort = (detail.sort && SORT_OPTIONS.some((o) => o[0] === detail.sort))
      ? detail.sort : DEFAULT_SORT
    if (wantRange === rangeKey && wantSort === sortKey) return
    rangeKey = wantRange
    sortKey = wantSort
    mountViewControls()
    reportView()
    paintNote()
    requery()
  })

  langOptionsP.then((opts) => {
    if (!opts || !controls) return
    langOptions = opts
    if (langKey !== LANG_ALL && !opts.some((o) => o[0] === langKey)) {
      applyLang(LANG_ALL, 'All')
    }
    mountLangControl()
  })

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
      if (query) { query = ''; artists = []; nextOffset = 0 }
      picked = entry
      resolvePick()
    },
    onSubmit: (q) => {
      query = q
      pickSeq++
      picked = null
      pickedItem = null
      pickLoading = false
      requery()
    },
    searchRemote: async (qText, { signal }) => {
      const records = await searchPublishers({
        follows,
        q: qText, sort: sortKey, range: rangeKey, lang: langKey, signal,
      })
      return records.map((r) => ({
        key: r.guid,
        label: r.title || copy.unidentified,
        sub: `${plural(num(r.boosts), 'boost', 'boosts')} · ${fmtSats(num(r.sats))} sats`,
        img: r.img,
        query: qText,
      }))
    },
    noMatchText: noMatch,
  })

  rebuild()
}
