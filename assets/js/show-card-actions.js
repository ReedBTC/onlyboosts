/* The verbs on a show card, attached to whatever rendered the facts.
 *
 * ⚠️ THE OTHER HALF OF assets/js/show-card.js. That module emits the card as an
 * HTML string — at the edge for the homepage's opening feed, in the browser for
 * every re-sort, range change and search pick after that. Nothing in it needs a
 * signer, a gesture, or knowledge of who is looking. Everything that does is
 * here:
 *
 *   the boost pill        ships hidden; this reveals it and owns the
 *                         resolve-and-pay sequence
 *   the drawer's rows     the episode list is never in the document (see the
 *                         drawer note in show-card.js); this fetches it the
 *                         first time a drawer opens and renders it through the
 *                         card module's own row function
 *   artwork fallback      the error path, which needs a listener the server
 *                         cannot attach
 *   the last-boost line   the server rendered an absolute date; "3d ago" is a
 *                         reading of it that depends on when you look, so it is
 *                         attached rather than rendered
 *
 * This is the same seam episode-card-actions.js is for the episode card, and the
 * two are deliberately separate: a show card and an episode card are different
 * objects with different hooks, and merging them would put a switch inside the
 * seam.
 */
import { fromApiValue, applyExternalOverrides } from '/assets/js/value-block.js?v=ob-v174'
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v174'
import { showToast } from '/assets/js/copy-npub.js?v=ob-v174'
import { withBoostBusy } from '/assets/js/boost-button.js?v=ob-v174'
import { wireArt2 } from '/assets/js/detail-page.js?v=ob-v174'
import { episodeBoostLink } from '/assets/js/episode-link.js?v=ob-v174'
import { getShowEpisodes, getShowEpisodesFollows } from '/assets/js/ob-live.js?v=ob-v174'
// The row renderer, for a drawer that fills on open. THE SAME FUNCTION the card
// module would have run inline, so a fetched row is byte-identical to one the
// edge could have shipped. show-card.js is already in the graph on every surface
// this module runs on, so a static import costs nothing.
import {
  episodeRowsHtml, sortEpisodeRows, copyFor, num,
} from '/assets/js/show-card.js?v=ob-v174'

const VALUE_API = '/api/value'   // Podcast Index value-block proxy (splits)
const DRAWER_EPISODES = 50       // episodes listed per expanded show

// ── Entry point ──────────────────────────────────────────────────────
/**
 * Wire every show card under `root` that isn't wired already.
 *
 * Idempotent by a marker attribute rather than by the caller keeping track: the
 * feed appends a page of cards to a container that already holds twenty-five,
 * and the homepage adopts thirty it did not render. Calling this on the whole
 * container after either is the simple thing, so it has to be the correct thing.
 *
 * Safe on a root with no cards, which is why every caller can call it
 * unconditionally.
 */
export function wireShowCards(root) {
  const cards = Array.from(root?.querySelectorAll?.('[data-show-card]:not([data-wired])') || [])
  if (!cards.length) return
  for (const card of cards) {
    card.setAttribute('data-wired', '')
    try { wireCard(card) } catch (err) {
      // One malformed card must not cost the other twenty-four their verbs.
      console.warn('[show-card] wiring failed', err)
    }
  }
}

function wireCard(card) {
  wireArtwork(card)
  wireLatest(card)
  wireBoostPill(card)
  wireDrawer(card)
}

// ── Artwork ──────────────────────────────────────────────────────────
/* The card's own fallback chain, walked through the same helper the /show and
 * /episode heroes use. The server emitted `src` plus `data-art2` — the feed's
 * primary artwork, then its second-chance `<itunes:image>`. An exhausted chain
 * drops to the glyph tile the server would have rendered for a show with no
 * artwork at all.
 */
function wireArtwork(card) {
  const img = card.querySelector('.pcast-card-media img')
  if (!img) return
  const media = img.closest('.pcast-card-media')
  const glyph = card.getAttribute('data-noun') === 'album' ? '💿' : '🎙'
  wireArt2(img, () => {
    img.remove()
    media?.classList.add('pcast-card-media--none')
    media?.appendChild(document.createTextNode(glyph))
  })
}

// ── "last boost 3d ago" ──────────────────────────────────────────────
/* ⚠️ THE DATE IS A FACT AND THE RELATIVE TIME IS A READING OF IT, which is the
 * whole reason this is here and not in show-card.js. Date.now() at the edge is
 * the moment the response was CACHED — up to five minutes before the reader saw
 * it, and the same bytes are served to everyone who arrives during that window —
 * so a server-rendered "3m ago" is wrong for almost every reader of it. The
 * timestamp does not have that problem, so the server renders the date and this
 * rewrites it for anyone who can watch a clock.
 *
 * Idempotent: a card rebuilt in the browser ships the absolute date again, and
 * running over it again produces the same result. `data-latest-ts` is left in
 * place deliberately, so a later pass has the fact rather than the reading.
 */
function wireLatest(card) {
  const el = card.querySelector('.ob-show-latest[data-latest-ts]')
  if (!el) return
  const ts = num(el.getAttribute('data-latest-ts'))
  if (!ts) return
  const rel = relTime(ts)
  if (rel) el.textContent = `last boost ${rel}`
}

function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - ts
  // A clock skew or a boost stamped in the future must not print "-3m ago".
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  // Past a month the relative form stops being informative, so the absolute
  // date the server already rendered is the better answer. Returning '' leaves
  // it exactly as it shipped.
  return ''
}

// ── The drawer ───────────────────────────────────────────────────────
/* Fill on first open.
 *
 * ⚠️ THE WINDOW IS READ AT OPEN TIME, NOT AT WIRE TIME. The drawer's rows are
 * scoped to the same range the card's own figures were computed over, or a
 * drawer showing all-time figures under a card showing the week's would
 * contradict the card it opened from. The feed writes the active cutoff onto the
 * list container as `data-since` and changes it in place, so reading it here is
 * what keeps the two in step even if a card outlives a range change.
 *
 * A failure resets the marker, so collapsing and reopening retries.
 */
function wireDrawer(card) {
  const details = card.querySelector('details.pcast-card-details')
  const body = details?.querySelector('[data-lazy-episodes]')
  if (!details || !body) return

  let loaded = false
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return
    loaded = true

    const guid = card.getAttribute('data-guid')
    const copy = copyFor(card.getAttribute('data-noun') === 'album' ? 'music' : 'other')
    const status = body.querySelector('[data-drawer-status]')
    const listEl = card.closest('[data-show-list]')
    const since = num(listEl?.getAttribute('data-since')) || null
    /* ⚠️ THE FOLLOWS SET RIDES THE LIST CONTAINER AS A JS PROPERTY — the feed
     * sets `obFollows` when its scope is Follows (shows-feed.js). An attribute
     * cannot carry thousands of hex keys, and the drawer must count over
     * exactly the corpus the card's own figures were counted over, or it
     * contradicts the card it opened from. Global lists never set it, so this
     * path is byte-identical to what always shipped. */
    const follows = Array.isArray(listEl?.obFollows) && listEl.obFollows.length ? listEl.obFollows : null

    try {
      const rows = follows
        ? await getShowEpisodesFollows({ guid, follows, since })
        : await getShowEpisodes({ guid, since })
      const eps = rows.map((e) => ({
        guid: e.guid, title: e.title || '', img: e.img || '',
        date: num(e.date), num: num(e.num), url: e.url || '',
        boosts: num(e.boosts), sats: num(e.sats),
      }))
      const shown = sortEpisodeRows(eps).slice(0, DRAWER_EPISODES)
      // Inserted BEFORE the footer, so a filled drawer and the shipped one are
      // the same markup with a list in it. The status line is what it replaces.
      status?.remove()
      body.insertAdjacentHTML('afterbegin', episodeRowsHtml(shown, copy, { truncatedFrom: eps.length }))
    } catch (err) {
      console.warn('[show-card] episode load failed', guid, err)
      loaded = false   // collapsing and reopening retries
      if (status) status.textContent = copy.drawerFail
    }
  })
}

// ── The boost pill ───────────────────────────────────────────────────
/* MONEY PATH. A show-level boost: it resolves the FEED-level value block (no
 * `guid` parameter) and pays exactly the split that feed published. The episode
 * feed's equivalent is episode-card-actions.js#onBoostClick, which this
 * deliberately mirrors rather than imports — the two share fromApiValue /
 * applyExternalOverrides, which is where the split logic lives.
 *
 * applyExternalOverrides is a documented passthrough and must stay one. No leg
 * of a third party's value block is ever rewritten, renamed, merged or dropped;
 * see the money-paths section of CLAUDE.md.
 *
 * ⚠️ THE SHOW IS IDENTIFIED OFF THE CARD'S OWN ATTRIBUTES, which is the contract
 * with show-card.js. There is no show object to close over here — the card may
 * have been rendered at the edge — so a change to those attribute names is a
 * change to this file too.
 */
function wireBoostPill(card) {
  const btn = card.querySelector('[data-boost-show]')
  if (!btn) return
  btn.hidden = false
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onShowBoost(card, btn)
  })
}

async function onShowBoost(card, btn) {
  const guid = card.getAttribute('data-guid') || ''
  const feed = card.getAttribute('data-feed-url') || ''
  const title = card.getAttribute('data-title') || ''
  const noun = card.getAttribute('data-noun') || 'show'

  // The rollup carries no Podcast Index numeric id, so the show is identified by
  // guid and/or feed URL and /api/value resolves the id server-side.
  if (!guid && !feed) { showToast(`Can’t identify this ${noun}’s feed`, true); return }

  await withBoostBusy(btn, async () => {
    try {
      const qs = new URLSearchParams()
      if (guid) qs.set('podcastGuid', guid)
      if (feed) qs.set('feedUrl', feed)

      let data = null
      try {
        const resp = await fetch(`${VALUE_API}?${qs}`, { headers: { Accept: 'application/json' } })
        // A server/config failure and "this show has no value block" are
        // different outcomes and must not be conflated — otherwise an outage
        // reads as every show being un-boostable.
        if (!resp.ok) { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
        data = await resp.json()
      } catch { showToast('Couldn’t load boost splits — please try again in a moment.', true); return }
      if (data && data.error) { showToast('Boost splits are unavailable right now.', true); return }

      const parsed = fromApiValue(data)
      if (!parsed) { showToast(`This ${noun} has no value block to boost.`, true); return }

      const recipients = applyExternalOverrides(parsed.recipients)
      const totalWeight = recipients.reduce((a, r) => a + (r.splitWeight || 0), 0)
      if (!recipients.length || totalWeight <= 0) { showToast(`This ${noun} has no payable recipients.`, true); return }

      await ensureLoginWidget()
      if (!window.LBLogin?.openExternalBoost) { showToast('Boost is unavailable right now.', true); return }
      window.LBLogin.openExternalBoost({
        episode: {
          showTitle: title,
          // No episode: this is the show itself. The note template drops the
          // link line and the `r` tag when there's no item to point at.
          episodeTitle: '',
          podcastGuid: guid,
          itemGuid: '',
          bmbUrl: episodeBoostLink({ itemGuid: '', podcastGuid: guid || null, feedId: null }) || '',
        },
        recipientsBundle: { recipients, totalWeight },
      })
      await waitForModal()
    } catch (e) {
      console.warn('[show-card] boost failed', e)
      showToast('Couldn’t start the boost — try again.', true)
    }
  })
}

// Hold the loading state until the widget actually shows something: its gate
// chain (session restore, wallet unlock) can run for seconds on a cold bundle,
// and a button that reverts before then reads as a click that did nothing.
function waitForModal(timeoutMs = 40000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const tick = () => {
      if (document.querySelector('[role="dialog"]')) return resolve('modal')
      if (Date.now() - t0 > timeoutMs) return resolve('timeout')
      setTimeout(tick, 200)
    }
    tick()
  })
}
