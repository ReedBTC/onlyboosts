/* The Favorite button, and nothing else.
 *
 * Chrome, on the boost-button.js pattern: this module builds the markup and
 * knows how to paint its state; the click, the read of the member's list and
 * the publish live in favorites-ui.js. Two-sided and dependency-free on
 * purpose, because the two cards (episode-card.js, show-card.js) and the
 * /show and /episode Functions all render it at the edge, and a card rebuilt
 * in the browser after a re-sort must be byte-identical to the edge's.
 *
 * ⚠️ IT SHIPS `hidden`, AND ONLY favorites-ui.js REVEALS IT. Favoriting needs a
 * signer, so it is a VERB; and Reed's call is that signed out gets nothing at
 * all, so the reveal waits for a session pubkey rather than for JavaScript.
 * Episode hearts (`data-fav="episode"`) stay hidden a while longer, behind
 * the migration gate in favorites-ui.js.
 *
 * The word is Favorite and the glyph is a heart (Reed, 2026-09-07), matching
 * BoostMeBitch and StableKraft. The boost note's reaction bar also uses a
 * heart, for Like, one level down; the two never share a row and the word
 * carries the difference.
 *
 * Identifiers are full NIP-73 identifiers on the element, so the click
 * handler never rebuilds one from a bare guid:
 *
 *   data-fav="show"      data-fav-id="podcast:guid:<feedGuid>"
 *   data-fav="episode"   data-fav-id="podcast:guid:<feedGuid>" data-fav-item="podcast:item:guid:<itemGuid>"
 *   data-fav="artist"    data-fav-id="podcast:publisher:guid:<guid>"
 *
 * `data-fav-medium` is the feed's own <podcast:medium> when the surface knows
 * it, and absent otherwise: the spec says publish the medium only from what
 * the feed declared, never from a default.
 */

const FEED_PREFIX = 'podcast:guid:'
const ITEM_PREFIX = 'podcast:item:guid:'
const ARTIST_PREFIX = 'podcast:publisher:guid:'

export const HEART_OFF = '♡'
export const HEART_ON = '♥'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const okGuid = (g) => typeof g === 'string' && g.trim() !== '' && !/[\s"'<>]/.test(g)

/**
 * The button's HTML, or '' when the surface cannot name what it would favorite.
 *
 *   kind     'show' | 'episode' | 'artist'
 *   guid     the feed guid (show/episode) or the publisher guid (artist)
 *   itemGuid the episode's item guid; episode only
 *   medium   the feed's declared medium, or null
 *   label    the title, for the tooltip and the accessible name
 *   extraClass  an additional class for the surface (the hero uses `btn`)
 */
export function favoriteButtonHtml({ kind, guid, itemGuid = null, medium = null, label = '', extraClass = '' }) {
  if (!okGuid(guid)) return ''
  if (kind === 'episode' && !okGuid(itemGuid)) return ''
  if (kind !== 'show' && kind !== 'episode' && kind !== 'artist') return ''
  const id = kind === 'artist' ? ARTIST_PREFIX + guid : FEED_PREFIX + guid
  const item = kind === 'episode' ? ` data-fav-item="${esc(ITEM_PREFIX + itemGuid)}"` : ''
  const med = typeof medium === 'string' && medium.trim() ? ` data-fav-medium="${esc(medium.trim())}"` : ''
  const cls = extraClass ? ` ${esc(extraClass)}` : ''
  return `<button type="button" class="ob-fav-pill${cls}" hidden data-fav="${kind}" data-fav-id="${esc(id)}"${item}${med}` +
    ` aria-pressed="false" title="Favorite ${esc(label)}" aria-label="Favorite ${esc(label)}">` +
    `<span class="ob-fav-icon" aria-hidden="true">${HEART_OFF}</span><span class="ob-fav-word">Favorite</span></button>`
}

/** Paint one button's state. `on` is true, false, or null for "not known". */
export function setFavoriteState(btn, on) {
  if (!btn) return
  const known = on === true || on === false
  btn.setAttribute('aria-pressed', on === true ? 'true' : 'false')
  btn.classList.toggle('is-on', on === true)
  btn.classList.toggle('is-unknown', !known)
  const icon = btn.querySelector('.ob-fav-icon')
  if (icon) icon.textContent = on === true ? HEART_ON : HEART_OFF
  const label = btn.getAttribute('aria-label') || ''
  const base = label.replace(/^(Favorite|Unfavorite) /, '')
  const verb = on === true ? 'Unfavorite' : 'Favorite'
  btn.setAttribute('aria-label', `${verb} ${base}`)
  btn.title = `${verb} ${base}`
}

/** The change this button asks for when pressed, off its own attributes. */
export function changeFor(btn, on) {
  const kind = btn.dataset.fav
  const op = on ? 'remove' : 'add'
  const medium = btn.dataset.favMedium || null
  if (kind === 'show') return { op, kind: 'feed', id: btn.dataset.favId, medium }
  if (kind === 'artist') return { op, kind: 'artist', id: btn.dataset.favId, medium }
  if (kind === 'episode') return { op, kind: 'item', feedId: btn.dataset.favId, itemId: btn.dataset.favItem, medium }
  return null
}

/** The key a button's favorite has in the member's list: the feed/artist id, or `item @ feedGuid`. */
export function keyFor(btn) {
  const kind = btn.dataset.fav
  if (kind === 'episode') return `${btn.dataset.favItem} @ ${String(btn.dataset.favId || '').slice(FEED_PREFIX.length)}`
  return btn.dataset.favId || null
}
