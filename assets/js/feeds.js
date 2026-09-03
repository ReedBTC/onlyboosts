/* Feed hydration for the homepage's feeds.
 *
 * Which feed is on screen is picked by the sticky tabs and the scope menu on
 * the active panel's lid — Podcasts / Music / Members across the top, each with its
 * own sub-feeds, and Global / Follows on the second axis. Scoping: "Global" is
 * unscoped; "Follows" is the signed-in user's own kind-3 contact list,
 * resolved by follow-set.js. Every feed has both scopes since 2026-08-31.
 *
 * Every feed has a loader (see LOADERS at the bottom); each lazy-imports its
 * renderer on first view. All of them read D1 through /api/v1 —
 * boosts-feed.js renders the boost notes themselves, feeds-podcasts.js the
 * per-episode rollup, shows-feed.js the per-show one.
 *
 * Two renderers, five sub-feeds: Episodes and Songs are the same
 * episode-level rollup, Shows and Albums the same show-level one, split on
 * <podcast:medium>. A "music" feed's items are tracks on an album; everything
 * else is episodes of a show. That's the `medium` argument threaded through
 * hydrate() below; it becomes a medium=music / not_medium=music query
 * parameter on /api/v1/episodes and /api/v1/podcasts, so the server answers
 * already split. The Members feeds take no medium: a boost note is a boost
 * note, so they stay the unsplit firehose.
 *
 * ⚠️ THE EVENTS PATH IS GONE (2026-08-23), and it was the last of LB's own
 * feeds in this file. `loadEvents`, the NIP-52 calendar machinery, the
 * supporter-set resolution and the streaming relay subscription were all
 * unreachable from the day the Events tab was dropped on fork — LOADERS never
 * mapped them — and two of the endpoints they read, `/api/community-events`
 * and `/api/meetups`, do not exist on this fork at all. That was ~970 lines of
 * this module, shipped to every visitor of the homepage, and the note here
 * used to call the cleanup fiddly because of a supposed circular import.
 * There was none: `calendar-events.js` had two importers, this file and
 * boosts-thread.js, which still renders a calendar event QUOTED inside a boost
 * message and is now its only consumer. `assets/js/supporter-set.js` went with
 * this, having had no other importer either. `git show 75f88ef` has all of it.
 *
 * Feeds load lazily: a feed's fetch only fires the first time it becomes
 * active (driven by the `lb:feed-activate` event dispatched from the inline
 * feed-bar controller in index.html, plus a load of whichever feed is active
 * when this module first runs).
 */
// Identity, for keeping the Follows feeds in sync with who's signed in.
import { getSessionPubkey, clearFollowCache } from '/assets/js/follow-set.js?v=ob-v186'

// ── DOM state helpers ────────────────────────────────────────────────

function showSkeletons(list, n = 3) {
  list.className = 'feed-list'
  list.innerHTML = ''
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div')
    s.className = 'feed-skeleton'
    list.appendChild(s)
  }
}

function renderPlaceholder(list, title, body) {
  list.className = ''
  list.innerHTML = ''
  const ph = document.createElement('div')
  ph.className = 'feed-placeholder'
  const strong = document.createElement('strong')
  strong.textContent = title
  ph.appendChild(strong)
  ph.appendChild(document.createTextNode(body))
  list.appendChild(ph)
}

// ── Feed loaders ─────────────────────────────────────────────────────
// Every renderer reads the collector's published feed through ob-data.js
// (Follows also through ob-live.js). Lazy-imported on first view so a visitor
// who only opens one feed doesn't pay for the others' modules.
async function hydrate(panelId, mod, scope, medium, view) {
  const panel = document.getElementById(panelId)
  if (!panel) return
  const list = panel.querySelector('[data-feed-list]')
  if (!list) return
  /* ⚠️ NO SKELETONS OVER A SERVER-RENDERED FEED, and this guard is load-bearing.
   * showSkeletons() clears the list, and the panel the front door opens on
   * arrives from functions/index.js with a full page of finished cards in it —
   * wiping them would destroy the page the reader is already looking at and
   * force the renderer to fetch and repaint exactly what was thrown away, which
   * is the whole cost the server render exists to remove. That panel was
   * Episodes · Global from ob-v61 and is Shows from Phase D; this guard did not
   * have to change, because it asks whether a panel was server-rendered rather
   * than which panel it is.
   *
   * The state element is the marker because it is the same one the renderer
   * adopts through, so the two cannot disagree about whether a panel was
   * server-rendered. Every other feed still gets its skeletons. */
  if (!list.querySelector('[data-feed-state]')) showSkeletons(list)
  try {
    const m = await import(mod)
    const fn = m[RENDERERS[mod]]
    if (typeof fn !== 'function') throw new Error(`no renderer export for ${mod}`)
    // Every renderer takes the panel: it carries the feed key their range/sort
    // controls are tagged with in the feed bar. `medium` is undefined for
    // the Boosts feeds, which don't split, and so is `view` — their hash
    // carries no parameters, and the inline controller strips any it is handed.
    await fn({ panel, list, scope, medium, lang: view?.lang, range: view?.range, sort: view?.sort })
  } catch (e) {
    console.error('[feeds] load failed', mod, scope, medium, e)
    renderPlaceholder(list, 'Couldn\u2019t load this feed', 'Something went wrong reaching the boosts data \u2014 please try again later.')
  }
}

// ── Lazy per-feed dispatch ───────────────────────────────────────────
const BOOSTS = '/assets/js/boosts-feed.js?v=ob-v186'
const PODCASTS = '/assets/js/feeds-podcasts.js?v=ob-v186'
const SHOWS = '/assets/js/shows-feed.js?v=ob-v186'
const ARTISTS = '/assets/js/artists-feed.js?v=ob-v186'
// Each module's entry point, by module. Named rather than sniffed out of the
// path, so adding a feed is one line here instead of another branch.
const RENDERERS = {
  [BOOSTS]: 'renderBoosts',
  [PODCASTS]: 'renderPodcasts',
  [SHOWS]: 'renderShows',
  [ARTISTS]: 'renderArtists',
}
// `view` is the feed's OPENING state — {lang, range, sort}, off the hash
// (`#shows?lang=de&range=1m&sort=sats`) and carried in the lb:feed-activate
// detail. It has to reach the renderer's first query rather than being applied
// afterwards, or a shared link paints the default feed and then corrects
// itself. The Boosts loaders take none: their hash carries no parameters.
const LOADERS = {
  'members-global':   () => hydrate('panel-members-global', BOOSTS, 'global'),
  'members-follows':  () => hydrate('panel-members-follows', BOOSTS, 'follows'),
  'episodes-global':  (view) => hydrate('panel-episodes-global', PODCASTS, 'global', 'other', view),
  'episodes-follows': (view) => hydrate('panel-episodes-follows', PODCASTS, 'follows', 'other', view),
  'songs-global':     (view) => hydrate('panel-songs-global', PODCASTS, 'global', 'music', view),
  'songs-follows':    (view) => hydrate('panel-songs-follows', PODCASTS, 'follows', 'music', view),
  // Both scopes since 2026-08-31 — see the scope note at the top of
  // shows-feed.js for what retired the old Global-only constraint.
  'shows-global':     (view) => hydrate('panel-shows', SHOWS, 'global', 'other', view),
  'shows-follows':    (view) => hydrate('panel-shows-follows', SHOWS, 'follows', 'other', view),
  'albums-global':    (view) => hydrate('panel-albums', SHOWS, 'global', 'music', view),
  'albums-follows':   (view) => hydrate('panel-albums-follows', SHOWS, 'follows', 'music', view),
  /* The publisher tier above Albums — <podcast:publisher>, one card per
   * artist. No medium argument because there is no choice: the tier is
   * MUSIC-ONLY server-side since 2026-08-31 (see /api/v1/publishers). */
  'artists-global':   (view) => hydrate('panel-artists', ARTISTS, 'global', undefined, view),
  'artists-follows':  (view) => hydrate('panel-artists-follows', ARTISTS, 'follows', undefined, view),
}
const loaded = new Set()

function loadFeed(feed, view) {
  const loader = LOADERS[feed]
  if (!loader || loaded.has(feed)) return
  loaded.add(feed)
  loader(view)
}

// The three body attributes the controller writes for exactly this reader —
// the cold load and the account-switch re-render, both of which run after the
// activate event has already fired.
function viewFromBody() {
  const ds = document.body.dataset
  return { lang: ds.feedLang || '', range: ds.feedRange || '', sort: ds.feedSort || '' }
}

/* The Members tab's own sections, which belong to the TAB rather than to either
 * of the two boosts panels under it. Hydrated off the same activate event, on
 * whichever boosts feed the reader arrives at; renderMembersBoards is
 * idempotent, so the second arrival costs a marker check.
 *
 * ⚠️ IT IS NEVER AWAITED AND NEVER ALLOWED TO THROW. The bottom half of that
 * tab is a working feed, and a board that cannot load must not delay or break
 * it — the same discipline the podroll queries have on /show. */
const MEMBER_TABS = new Set(['members-global', 'members-follows'])
let boardsWired = false
function loadMemberBoards() {
  if (boardsWired) return
  const root = document.querySelector('[data-hpw-boards]')
  if (!root) return
  boardsWired = true
  import('/assets/js/members-board.js?v=ob-v186')
    .then((m) => m.renderMembersBoards(root))
    .catch((err) => {
      console.warn('[feeds] member boards failed to load', err)
      boardsWired = false
    })
}

/* The chart block over the Shows and Artists feeds (charts-block.js), the
 * members boards' twin: the tab's section rather than a panel's, hydrated off
 * the same two entry points, never awaited, never allowed to throw. Keyed by
 * the feed's TYPE, so both scopes fill the same block once. */
const CHART_FEEDS = {
  'shows-global': 'shows', 'shows-follows': 'shows',
  'artists-global': 'artists', 'artists-follows': 'artists',
}
const chartsWired = new Set()
function loadChartsBlock(feed) {
  const kind = CHART_FEEDS[feed]
  if (!kind || chartsWired.has(kind)) return
  const root = document.querySelector(`[data-charts-block="${kind}"]`)
  if (!root) return
  chartsWired.add(kind)
  import('/assets/js/charts-block.js?v=ob-v186')
    .then((m) => m.renderChartsBlock(root, kind))
    .catch((err) => {
      console.warn('[feeds] chart block failed to load', err)
      chartsWired.delete(kind)
    })
}

document.addEventListener('lb:feed-activate', (e) => {
  const feed = e?.detail?.feed
  // Only read on the FIRST activation of a feed; afterwards the mounted
  // controls own the view and the controller talks to them through
  // lb:set-feed-lang and lb:set-feed-view.
  if (feed) loadFeed(feed, { lang: e?.detail?.lang, range: e?.detail?.range, sort: e?.detail?.sort })
  if (feed && MEMBER_TABS.has(feed)) loadMemberBoards()
  if (feed) loadChartsBlock(feed)
})

// ── Session-driven refresh ───────────────────────────────────────────
// The two Follows feeds are scoped to the signed-in npub, so signing in,
// signing out, or switching accounts invalidates whatever they last
// rendered. `loaded` makes every feed load exactly once, which is right
// for the Global feeds and wrong for these: without this, signing in from
// the nav while looking at "Sign in to see this feed" leaves that
// placeholder on screen until a manual reload.
//
// Dropping them from `loaded` re-arms both — the visible one reloads now,
// the other on its next activation, so an account switch can't leave a
// stale list behind the tab you aren't looking at.
const FOLLOWS_FEEDS = ['members-follows', 'episodes-follows', 'songs-follows', 'shows-follows', 'albums-follows', 'artists-follows']
let lastSessionPubkey = getSessionPubkey()

function onSessionChange() {
  const pubkey = getSessionPubkey()
  if (pubkey === lastSessionPubkey) return
  lastSessionPubkey = pubkey
  // On sign-out, drop the cached follow list outright. (An account switch
  // needs no clearing — the cache is keyed by pubkey and simply misses.)
  if (!pubkey) clearFollowCache()
  for (const feed of FOLLOWS_FEEDS) loaded.delete(feed)
  const active = document.body.dataset.activeFeed
  // The view comes off the same attributes for the same reason as the cold
  // load below: an account switch re-hydrates the feed from scratch, and it must
  // come back showing the view the reader left it on.
  if (FOLLOWS_FEEDS.includes(active)) loadFeed(active, viewFromBody())
}

// Same-tab: the login widget announces every identity change (index.jsx).
window.addEventListener('lb:session-change', onSessionChange)
// Other tabs: `storage` only fires on *other* documents, so this is purely
// the "signed in on another tab" case. A null key means the whole store was
// cleared, which counts.
window.addEventListener('storage', (e) => {
  if (!e || e.key === null || e.key === 'lb_nostr_session') onSessionChange()
})

/* Load whichever feed is active when this module first runs (the inline
 * feed-bar controller has already set body[data-active-feed] and may have
 * dispatched its activation event before this listener attached).
 *
 * ⚠️ READ THE VIEW FROM THE ATTRIBUTES, NOT FROM THE EVENT. This is the cold
 * load, which is the path every shared `#shows?lang=de&range=1m` link takes,
 * and the lb:feed-activate that carried the view fired before this module
 * existed. Taking only the feed here is what made a shared link paint the
 * unfiltered feed while the URL claimed otherwise. */
const bootFeed = document.body.dataset.activeFeed || 'episodes-global'
loadFeed(bootFeed, viewFromBody())
/* ⚠️ AND THE MEMBERS BOARDS TOO, ON THIS PATH AS WELL AS ON THE EVENT. The cold
 * load does not go through the lb:feed-activate listener — the controller fired
 * that during parse, before this module existed, which is the whole reason the
 * line above re-reads the attribute. Hooking only the listener meant the boards
 * rendered when a reader CLICKED to Members and stayed empty on every reload,
 * every shared `#members` link, and every back-navigation onto the tab.
 * Two entry points, one guard: loadMemberBoards is idempotent. */
if (MEMBER_TABS.has(bootFeed)) loadMemberBoards()
// And the chart block, on the same two paths for the same reason.
loadChartsBlock(bootFeed)
