/**
 * favorites-section.js — the Favorites section on /booster/<npub>.
 *
 * A written exception to the rendering rule (docs/favorites.md): the member's
 * kind-10333 list lives on relays, not in D1, and its private half is
 * ciphertext only their own signer can open, so the edge renders the shell
 * (`[data-booster-favorites]`, hidden) and this module fills it:
 *
 *   1. read the list (favorites-sync.js#fetchFavorites): the public half for
 *      anyone, the private half too when the viewer IS the member and the
 *      widget is loaded to open it;
 *   2. resolve every guid through POST /api/v1/favorites/resolve — the index
 *      first, Podcast Index for the rest, bounded server-side;
 *   3. group by the RESOLVED medium into the site's own words: Shows,
 *      Episodes, Albums, Songs, and Artists when the list carries any. The
 *      lookup wins over the list's medium hint (the spec's rule); a feed with
 *      no known medium files on the podcast side, the Shows feed's rule;
 *   4. render rows on the community-row vocabulary, each linking to its page
 *      here or to BoostMeBitch when there is none, and, for the owner, carrying
 *      the Favorite heart that favorites-ui.js paints and handles.
 *
 * ⚠️ THREE DRAWERS, NOT ONE, SINCE 2026-11-08 (Reed's call: "I don't want to
 * see my favorite podcast episodes in the same list as my favorite songs"):
 * Podcasts You Follow (the Import OPML / Export OPML band, since an OPML is
 * podcast subscriptions and nothing else), Favorite Podcast Episodes, and
 * Favorite Music, which keeps the grouped shape (Artists, Albums, Songs under
 * their headings) and the Show menu. `DRAWERS` is the table; the Function
 * ships one `<details data-fav-drawer>` per row and this module fills each.
 *
 * Nothing on the list is dropped for being unresolvable: an entry nobody can
 * name renders its guid, since it is still somebody's favorite.
 */
import { fetchFavorites, widgetDeps } from '/assets/js/favorites-sync.js?v=ob-v273'
import { favoriteButtonHtml } from '/assets/js/favorite-button.js?v=ob-v273'
import { getSessionPubkey } from '/assets/js/follow-set.js?v=ob-v273'
import { isSafeUrl } from '/assets/js/nostr-text.js?v=ob-v273'
import { sortControl } from '/assets/js/feed-controls.js?v=ob-v273'

const RESOLVE_URL = '/api/v1/favorites/resolve'

const FEED_PREFIX = 'podcast:guid:'
const ARTIST_PREFIX = 'podcast:publisher:guid:'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const bare = (id, prefix) => (typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : null)

/* ------------------------------------------------------------------------ */
/* Grouping — pure, so the test can hold it                                  */

export const GROUPS = [
  { key: 'shows', title: 'Following', kind: 'feed', music: false },   // podcast shows are FOLLOWED (Reed, 2026-11-07); the key keeps its name
  { key: 'episodes', title: 'Episodes', kind: 'item', music: false },
  { key: 'artists', title: 'Artists', kind: 'artist', music: true },
  { key: 'albums', title: 'Albums', kind: 'feed', music: true },
  { key: 'songs', title: 'Songs', kind: 'item', music: true },
]

/** The three drawers (2026-11-08) and which groups each holds. `titles`
 *  prints the group headings (one drawer, one group needs none); `menu` is
 *  the Show dropdown; `opml` the owner's Import / Export band. The empty
 *  lines name what fills the drawer, for the owner and for a visitor. */
export const DRAWERS = [
  { key: 'follows', title: 'Podcasts You Follow', groups: ['shows'], titles: false, menu: false, opml: true,
    empty: { owner: 'You don’t follow any podcasts yet. Press Follow on a podcast, or import your podcast app’s OPML, to start a list other Podcasting 2.0 apps can read too.', visitor: 'No podcasts followed yet.' } },
  { key: 'episodes', title: 'Favorite Podcast Episodes', groups: ['episodes'], titles: false, menu: false, opml: false,
    empty: { owner: 'No favorite episodes yet. Press the heart on an episode to keep it here.', visitor: 'No favorite episodes yet.' } },
  { key: 'music', title: 'Favorite Music', groups: ['artists', 'albums', 'songs'], titles: true, menu: true, opml: false,
    empty: { owner: 'No favorite music yet. Press the heart on an artist, an album or a song to keep it here.', visitor: 'No favorite music yet.' } },
]

/**
 * The Favorite Music drawer's dropdown (Reed, 2026-09-09; the music drawer's
 * alone since 2026-11-08), on the sort pill's chrome: which group to show.
 * `all` is the default so a member whose favorites are all songs does not
 * open on an empty Artists view.
 */
export const GROUP_OPTIONS = [
  ['all', 'All'],
  ['artists', 'Artists'],
  ['albums', 'Albums'],
  ['songs', 'Songs'],
]

/** The groups a pick leaves on screen. An unknown key shows everything. */
export function visibleGroups(groups, key) {
  if (!key || key === 'all') return groups
  if (!GROUP_OPTIONS.some(([k]) => k === key)) return groups
  return groups.filter((g) => g.key === key)
}

/** The resolved medium, the hint, or the podcast side. Never a guess dressed as a fact: this only decides which heading a row sits under. */
export function mediumOf(resolvedFeed, hint) {
  const m = resolvedFeed?.medium ?? hint ?? null
  return typeof m === 'string' && m.trim() ? m.trim().toLowerCase() : null
}

/**
 * Entries (from fetchFavorites) + the resolve answer → the groups to render,
 * in GROUPS order, empty groups omitted. Each row is
 * { key, title, href, image, artwork, sub, guid, itemGuid, feedGuid, medium, external, half }.
 */
export function groupEntries(entries, resolved) {
  const feeds = resolved?.feeds ?? {}
  const items = resolved?.items ?? {}
  const pubs = resolved?.publishers ?? {}
  const buckets = new Map(GROUPS.map((g) => [g.key, []]))

  for (const e of entries ?? []) {
    if (e.kind === 'podcast:guid') {
      const guid = bare(e.id, FEED_PREFIX)
      if (!guid) continue
      const r = feeds[guid] ?? null
      const medium = mediumOf(r, e.medium)
      buckets.get(medium === 'music' ? 'albums' : 'shows').push({
        key: e.id,
        title: r?.title ?? null,
        href: r?.href ?? `https://boostmebitch.com/?podcast=${encodeURIComponent(guid)}`,
        image: r?.image ?? null,
        artwork: r?.artwork ?? null,
        sub: r?.author ?? null,
        guid, itemGuid: null, feedGuid: guid, medium,
        external: !(r?.indexed && r?.title),
        half: e.half ?? 'public',
      })
    } else if (e.kind === 'podcast:item:guid') {
      const itemGuid = bare(e.id, 'podcast:item:guid:')
      const feedGuid = e.feed ?? null
      if (!itemGuid) continue
      const rf = feedGuid ? feeds[feedGuid] ?? null : null
      const ri = feedGuid ? items[feedGuid + '|' + itemGuid] ?? null : null
      const medium = mediumOf(rf, e.medium)
      buckets.get(medium === 'music' ? 'songs' : 'episodes').push({
        key: feedGuid ? `${e.id} @ ${feedGuid}` : e.id,
        title: ri?.title ?? null,
        href: ri?.href ?? (feedGuid
          ? `https://boostmebitch.com/?podcast=${encodeURIComponent(feedGuid)}&episode=${encodeURIComponent(itemGuid)}`
          : null),
        image: ri?.image ?? rf?.image ?? null,
        artwork: rf?.artwork ?? null,
        sub: rf?.title ?? null,
        guid: feedGuid, itemGuid, feedGuid, medium,
        external: !(ri?.indexed && ri?.title),
        half: e.half ?? 'public',
      })
    } else if (e.kind === 'podcast:publisher:guid') {
      const guid = bare(e.id, ARTIST_PREFIX)
      if (!guid) continue
      const r = pubs[guid] ?? null
      buckets.get('artists').push({
        key: e.id,
        title: r?.title ?? null,
        href: r?.href ?? null,
        image: r?.image ?? null,
        artwork: r?.artwork ?? null,
        sub: null,
        guid, itemGuid: null, feedGuid: null, medium: 'publisher',
        external: !(r?.indexed && r?.title),
        half: e.half ?? 'public',
      })
    }
  }

  return GROUPS.map((g) => ({ ...g, rows: buckets.get(g.key) })).filter((g) => g.rows.length > 0)
}

/** What to ask the resolver for, off the entries. */
export function resolveRequest(entries) {
  const feeds = new Set()
  const items = new Set()
  const publishers = new Set()
  for (const e of entries ?? []) {
    if (e.kind === 'podcast:guid') { const g = bare(e.id, FEED_PREFIX); if (g) feeds.add(g) }
    else if (e.kind === 'podcast:item:guid') {
      const i = bare(e.id, 'podcast:item:guid:')
      if (i && e.feed) { items.add(e.feed + '|' + i); feeds.add(e.feed) }
    } else if (e.kind === 'podcast:publisher:guid') { const g = bare(e.id, ARTIST_PREFIX); if (g) publishers.add(g) }
  }
  return {
    feeds: [...feeds],
    items: [...items].map((k) => { const at = k.indexOf('|'); return [k.slice(0, at), k.slice(at + 1)] }),
    publishers: [...publishers],
  }
}

/* ------------------------------------------------------------------------ */
/* Rendering                                                                 */

const GLYPH = { shows: '🎙️', episodes: '🎙️', albums: '💿', songs: '🎵', artists: '🎤' }

export function rowHtml(row, group, { owner = false } = {}) {
  const art = isSafeUrl(row.image) ? row.image : null
  const art2 = isSafeUrl(row.artwork) && row.artwork !== art ? row.artwork : null
  const titled = !!(row.title && String(row.title).trim())
  const title = titled ? String(row.title).trim() : null
  // A page here is a site-relative path (/show/…, /episode/…, /artist/…),
  // which isSafeUrl does not admit; an outside link (BMB) goes through it.
  const internal = typeof row.href === 'string' && /^\/(?!\/)/.test(row.href)
  const href = internal ? row.href : (isSafeUrl(row.href) ? row.href : null)
  const external = !!href && !internal
  const inner =
    (art
      ? `<img class="cs-art" src="${esc(art)}"${art2 ? ` data-art2="${esc(art2)}"` : ''} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />`
      : `<span class="cs-art cs-art--blank" aria-hidden="true">${GLYPH[group.key] || '🎙️'}</span>`) +
    `<span class="cs-main">` +
      (title
        ? `<span class="cs-title">${esc(title)}</span>`
        : `<span class="cs-title"><span class="fav-guid">${esc(row.itemGuid || row.guid || row.key)}</span></span>`) +
      (row.sub ? `<span class="cs-meta">${esc(row.sub)}</span>` : (title ? '' : `<span class="cs-meta">Not in the index yet</span>`)) +
    `</span>`
  const link = href
    ? `<a class="cs-link${external ? ' cs-link--external' : ''}" href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
    : `<span class="cs-link">${inner}</span>`
  let heart = ''
  if (owner) {
    if (group.kind === 'feed') heart = favoriteButtonHtml({ kind: 'show', guid: row.guid, medium: row.medium === 'publisher' ? null : row.medium, label: title || row.guid })
    else if (group.kind === 'item' && row.feedGuid) heart = favoriteButtonHtml({ kind: 'episode', guid: row.feedGuid, itemGuid: row.itemGuid, medium: row.medium, label: title || row.itemGuid })
    else if (group.kind === 'artist') heart = favoriteButtonHtml({ kind: 'artist', guid: row.guid, label: title || row.guid })
  }
  return `<li class="cs-row" data-fav-row="${esc(row.key)}">${link}${heart}</li>`
}

export function groupsHtml(groups, { owner = false, titles = true } = {}) {
  return groups.map((g) =>
    (titles ? `<h3 class="fav-group-title">${esc(g.title)}</h3>` : '') +
    `<ul class="ep-list cs-list">${g.rows.map((r) => rowHtml(r, g, { owner })).join('')}</ul>`,
  ).join('')
}

/* ------------------------------------------------------------------------ */
/* Boot                                                                      */

async function resolveAll(entries) {
  const req = resolveRequest(entries)
  if (!req.feeds.length && !req.items.length && !req.publishers.length) return { feeds: {}, items: {}, publishers: {} }
  try {
    const resp = await fetch(RESOLVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (!resp.ok) return { feeds: {}, items: {}, publishers: {} }
    return await resp.json()
  } catch {
    return { feeds: {}, items: {}, publishers: {} }
  }
}

/* `onStart({ owner })` fires as each read begins and `onFail({ owner })` when
 * it ends without a trusted list, so the page can hold a loading state over
 * what the list will replace and let go of it on failure (the owner's
 * /booster, 2026-11-08). `onEntries` fires on a trusted read only. */
export function initFavoritesSection({ pubkey, root, onEntries = null, onStart = null, onFail = null }) {
  if (!root || !pubkey) return
  const drawers = DRAWERS.map((d) => {
    const el = root.querySelector(`[data-fav-drawer="${d.key}"]`)
    if (!el) return null
    const groupsEl = el.querySelector('[data-fav-groups]')
    const emptyEl = el.querySelector('[data-fav-empty]')
    if (!groupsEl || !emptyEl) return null
    return { ...d, el, groupsEl, emptyEl, ctrlEl: el.querySelector('[data-fav-controls]'), filter: 'all' }
  }).filter(Boolean)
  if (!drawers.length) return
  let run = 0
  let shown = { groups: [], owner: false }

  /* One line under every drawer (loading, a failed read, a private list). */
  function foot(text) {
    for (const d of drawers) { d.emptyEl.textContent = text; d.emptyEl.hidden = false; d.groupsEl.innerHTML = '' }
  }

  function render() {
    for (const d of drawers) {
      const mine = shown.groups.filter((g) => d.groups.includes(g.key))
      const visible = d.menu ? visibleGroups(mine, d.filter) : mine
      d.groupsEl.innerHTML = groupsHtml(visible, { owner: shown.owner, titles: d.titles })
      if (!visible.length) {
        const label = (GROUP_OPTIONS.find(([k]) => k === d.filter) || [])[1] || 'that'
        d.emptyEl.textContent = mine.length ? `No ${label.toLowerCase()} on this list.` : d.empty[shown.owner ? 'owner' : 'visitor']
        d.emptyEl.hidden = false
      } else d.emptyEl.hidden = true
      if (d.menu && d.ctrlEl) {
        if (!d.ctrlEl.querySelector('.pcast-sort')) {
          d.ctrlEl.append(sortControl(GROUP_OPTIONS, d.filter, (key) => { if (key !== d.filter) { d.filter = key; render() } }, {
            tag: 'Show: ',
            title: 'Which favorites to show',
          }))
        }
        d.ctrlEl.hidden = !mine.length
      }
    }
  }

  async function paint() {
    const mine = ++run
    const viewer = getSessionPubkey()
    const owner = !!viewer && viewer === pubkey
    mountOpml(owner)
    try { onStart?.({ owner }) } catch (err) { console.warn('[favorites] onStart', err) }
    const deps = owner && window.LBLogin ? await widgetDeps(window.LBLogin) : {}
    let r
    try { r = await fetchFavorites(pubkey, { ...deps, pubkey }) } catch (err) {
      console.warn('[favorites] read failed', err)
      foot('Couldn’t read follows and favorites right now.')
      try { onFail?.({ owner }) } catch (e2) { console.warn('[favorites] onFail', e2) }
      return
    }
    if (mine !== run) return
    // The drawers are on screen from the first paint (the Function renders
    // them with a "loading" foot); every outcome below only changes the feet.
    if (!r.trusted) {
      // Could not read enough relays to say anything — never "empty".
      foot(owner
        ? 'Couldn’t reach enough relays to read your follows and favorites right now.'
        : 'Couldn’t reach enough relays to read this member’s follows and favorites right now.')
      try { onFail?.({ owner }) } catch (e2) { console.warn('[favorites] onFail', e2) }
      return
    }
    const entries = r.entries ?? []
    // The page's other readers of this list (the recommendation rails hand
    // the feeds to /api/v1/recommend, 2026-11-07). A trusted read only, so an
    // unreachable relay set never tells the caller the list is empty.
    try { onEntries?.(entries, { owner }) } catch (err) { console.warn('[favorites] onEntries', err) }
    // A list nobody here can open says so under every drawer; an empty one
    // lets each drawer say what fills it.
    if (!entries.length && r.read?.content && (owner ? r.parsedPrivate === null : true)) {
      foot(owner
        ? 'Your follows and favorites are private. Log in with a signer that can decrypt them to see them here.'
        : 'This member keeps their follows and favorites private.')
      return
    }
    const resolved = entries.length ? await resolveAll(entries) : { feeds: {}, items: {}, publishers: {} }
    if (mine !== run) return
    shown = { groups: groupEntries(entries, resolved), owner }
    render()
  }

  /* The owner's Import OPML / Export OPML, on the Podcasts You Follow
   * drawer's controls band (2026-11-07, one of the import's three doors; the
   * others are the homepage's locked card and the account menu; the follows
   * drawer's alone since 2026-11-08, an OPML being podcast subscriptions).
   * Shown to the owner even over an empty list, since importing is how an
   * empty list fills. */
  function mountOpml(owner) {
    const ctrlEl = drawers.find((d) => d.opml)?.ctrlEl
    if (!ctrlEl) return
    let box = ctrlEl.querySelector('[data-fav-opml]')
    if (!owner) { if (box) box.remove(); return }
    if (!box) {
      box = document.createElement('span')
      box.className = 'fav-opml'
      box.setAttribute('data-fav-opml', '')
      box.innerHTML = '<button type="button" class="btn btn-quiet btn-sm" data-opml="import">Import OPML</button><button type="button" class="btn btn-quiet btn-sm" data-opml="export">Export OPML</button>'
      box.addEventListener('click', (e) => {
        const b = e.target.closest?.('[data-opml]')
        if (!b) return
        if (b.dataset.opml === 'import') window.OBFavorites?.importOpml?.()
        else window.OBFavorites?.exportOpml?.()
      })
      ctrlEl.appendChild(box)
    }
    ctrlEl.hidden = false
  }

  paint()
  window.addEventListener('lb:session-change', () => paint())
  window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') paint() })
}
