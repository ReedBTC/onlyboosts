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
  const w = wordsFor(kind, medium)
  return `<button type="button" class="ob-fav-pill${w.follow ? ' ob-fav-pill--follow' : ''}${cls}" hidden data-fav="${kind}" data-fav-id="${esc(id)}"${item}${med}` +
    ` aria-pressed="false" title="${w.verbOff} ${esc(label)}" aria-label="${w.verbOff} ${esc(label)}">` +
    `<span class="ob-fav-icon" aria-hidden="true">${w.iconOff}</span><span class="ob-fav-word">${w.off}</span></button>`
}

/* ⚠️ THE WORD CHANGES WITH THE STATE, NOT ONLY THE GLYPH (Reed, 2026-10-29:
 * an outline heart against a filled one was not enough to tell whether a
 * show was already a favorite). Off reads "Favorite", on reads "Favorited"
 * on a tinted pill, and a click in flight reads "Saving…".
 *
 * ⚠️ A PODCAST SHOW IS FOLLOWED, EVERYTHING ELSE IS FAVORITED (Reed's call,
 * 2026-11-07): the show-level button on the podcast side reads Follow /
 * Following with a plus that becomes a check (Apple Podcasts' convention;
 * Pocket Casts is "+ Subscribe" → check), and podcast episodes, albums,
 * songs and artists keep Favorite / Favorited with the heart. Wording and
 * glyph only: the event underneath is Chad's kind 10333 either way, and
 * `changeFor` is untouched. A feed that declares no medium is on the podcast
 * side, the partition rule the Shows feed uses (CLAUDE.md, the medium
 * split). `isFollow(btn)` reads the same rule off the element so
 * favorites-ui.js's toasts agree. */
export const WORD_OFF = 'Favorite'
export const WORD_ON = 'Favorited'
export const FOLLOW_OFF = 'Follow'
export const FOLLOW_ON = 'Following'
export const WORD_BUSY = 'Saving…'
export const WORD_WAIT = 'Connecting…'
export const PLUS = '+'
export const CHECK = '✓'

export function wordsFor(kind, medium) {
  const follow = kind === 'show' && String(medium || '').trim() !== 'music'
  return follow
    ? { follow, off: FOLLOW_OFF, on: FOLLOW_ON, verbOff: 'Follow', verbOn: 'Unfollow', iconOff: PLUS, iconOn: CHECK }
    : { follow, off: WORD_OFF, on: WORD_ON, verbOff: 'Favorite', verbOn: 'Unfavorite', iconOff: HEART_OFF, iconOn: HEART_ON }
}

/** Whether a rendered button is a Follow button (a podcast show) or a heart. */
export function isFollow(btn) {
  return wordsFor(btn?.dataset?.fav, btn?.dataset?.favMedium).follow
}

/** Paint one button's state. `on` is true, false, or null for "not known". */
export function setFavoriteState(btn, on) {
  if (!btn) return
  const known = on === true || on === false
  const w = wordsFor(btn.dataset.fav, btn.dataset.favMedium)
  btn.setAttribute('aria-pressed', on === true ? 'true' : 'false')
  btn.classList.toggle('is-on', on === true)
  btn.classList.toggle('is-unknown', !known)
  const icon = btn.querySelector('.ob-fav-icon')
  if (icon) icon.textContent = on === true ? w.iconOn : w.iconOff
  const word = btn.querySelector('.ob-fav-word')
  if (word) word.textContent = on === true ? w.on : w.off
  const label = btn.getAttribute('aria-label') || ''
  const base = label.replace(/^(Favorite|Unfavorite|Follow|Unfollow) /, '')
  const verb = on === true ? w.verbOn : w.verbOff
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
