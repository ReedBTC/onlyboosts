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
 * Nothing on the list is dropped for being unresolvable: an entry nobody can
 * name renders its guid, since it is still somebody's favorite.
 */
import { fetchFavorites, widgetDeps } from '/assets/js/favorites-sync.js?v=ob-v207'
import { favoriteButtonHtml } from '/assets/js/favorite-button.js?v=ob-v207'
import { getSessionPubkey } from '/assets/js/follow-set.js?v=ob-v207'
import { isSafeUrl } from '/assets/js/nostr-text.js?v=ob-v207'
import { sortControl } from '/assets/js/feed-controls.js?v=ob-v207'

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
  { key: 'shows', title: 'Shows', kind: 'feed', music: false },
  { key: 'episodes', title: 'Episodes', kind: 'item', music: false },
  { key: 'albums', title: 'Albums', kind: 'feed', music: true },
  { key: 'songs', title: 'Songs', kind: 'item', music: true },
  { key: 'artists', title: 'Artists', kind: 'artist', music: true },
]

/**
 * The drawer's dropdown (Reed, 2026-09-09), on the sort pill's chrome: which
 * group to show. `all` is the default so a member whose favorites are all
 * songs does not open on an empty Shows view; the five groups follow, in the
 * order Reed listed them.
 */
export const GROUP_OPTIONS = [
  ['all', 'All'],
  ['shows', 'Shows'],
  ['episodes', 'Episodes'],
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

export function groupsHtml(groups, { owner = false } = {}) {
  return groups.map((g) =>
    `<h3 class="fav-group-title">${esc(g.title)}</h3>` +
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

export function initFavoritesSection({ pubkey, root }) {
  if (!root || !pubkey) return
  const groupsEl = root.querySelector('[data-fav-groups]')
  const emptyEl = root.querySelector('[data-fav-empty]')
  const ctrlEl = root.querySelector('[data-fav-controls]')
  if (!groupsEl || !emptyEl) return
  let run = 0
  let filter = 'all'
  let shown = { groups: [], owner: false }

  function render() {
    const visible = visibleGroups(shown.groups, filter)
    groupsEl.innerHTML = groupsHtml(visible, { owner: shown.owner })
    if (!visible.length && shown.groups.length) {
      const label = (GROUP_OPTIONS.find(([k]) => k === filter) || [])[1] || 'that'
      emptyEl.textContent = `No ${label.toLowerCase()} on this list.`
      emptyEl.hidden = false
    } else emptyEl.hidden = true
  }

  if (ctrlEl && !ctrlEl.childElementCount) {
    ctrlEl.append(sortControl(GROUP_OPTIONS, filter, (key) => { if (key !== filter) { filter = key; render() } }, {
      tag: 'Show: ',
      title: 'Which favorites to show',
    }))
  }

  async function paint() {
    const mine = ++run
    const viewer = getSessionPubkey()
    const owner = !!viewer && viewer === pubkey
    const deps = owner && window.LBLogin ? await widgetDeps(window.LBLogin) : {}
    let r
    try { r = await fetchFavorites(pubkey, { ...deps, pubkey }) } catch (err) {
      console.warn('[favorites] read failed', err)
      emptyEl.textContent = 'Couldn’t read favorites right now.'
      emptyEl.hidden = false
      return
    }
    if (mine !== run) return
    // The section is on screen from the first paint (the Function renders it
    // with a "loading" foot); every outcome below only changes the foot.
    if (!r.trusted) {
      // Could not read enough relays to say anything — never "empty".
      emptyEl.textContent = owner
        ? 'Couldn’t reach enough relays to read your favorites right now.'
        : 'Couldn’t reach enough relays to read this member’s favorites right now.'
      emptyEl.hidden = false
      return
    }
    const entries = r.entries ?? []
    if (!entries.length) {
      emptyEl.textContent = owner
        ? (r.parsedPrivate === null && r.read?.content
            ? 'Your favorites are private. Log in with a signer that can decrypt them to see them here.'
            : 'Nothing favorited yet. Press the heart on any show to start a list other Podcasting 2.0 apps can read too.')
        : (r.read?.content
            ? 'This member keeps their favorites private.'
            : 'No favorites yet.')
      emptyEl.hidden = false
      groupsEl.innerHTML = ''
      return
    }
    const resolved = await resolveAll(entries)
    if (mine !== run) return
    shown = { groups: groupEntries(entries, resolved), owner }
    render()
    if (ctrlEl) ctrlEl.hidden = false
  }

  paint()
  window.addEventListener('lb:session-change', () => paint())
  window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') paint() })
}
