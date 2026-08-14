/* Where a booster's name and avatar point: /booster/<npub>.
 *
 * ⚠️ A NEW MODULE RATHER THAN A NEW EXPORT ON show-link.js, which is where
 * showPageHref and episodePageHref live and would be the obvious home. Assets
 * ship max-age=14400, so a reader can hold a stale show-link.js against a fresh
 * feed renderer for hours, and an unresolved named import is a LINK-TIME error —
 * the renderer never executes at all, so every feed on the site fails rather
 * than the one link that was added. That is exactly how ob-v53 took all eight
 * feeds down. A URL with no cached old version can only resolve or 404. See the
 * rule in CLAUDE.md; assets/js/feed-note.js is the other worked example.
 *
 * ⚠️ THE QUALIFYING RULE IS NOT THE EPISODE RULE, and the difference is what
 * makes this sweep simple. /episode/<item-guid> is withheld from the 500 of
 * 7,182 episodes with no title, so every surface that links one needs a
 * fallback. A booster page qualifies on HAVING BOOSTED — and every booster
 * rendered on any of these surfaces is there because they boosted. So the link
 * is unconditional, there is no fallback anywhere, and there is no set of
 * surfaces to enumerate the way episode-link.js has to.
 *
 * The one thing that can be missing is the identifier itself: `booster.npub` is
 * nullable where `booster.pk` is not. /booster/<npub> accepts hex as well as
 * bech32, so a record with no npub links on its pubkey instead.
 *
 * WHO IS DELIBERATELY NOT LINKED HERE: an npub MENTIONED inside a boost message.
 * Those are the `.nostr-mention` chips, they keep pointing at njump.me, and the
 * reason is that a mentioned npub need never have boosted anything — most of
 * them have not, so /booster/<npub> would 404 for the common case. njump
 * resolves any npub, which is what that chip needs and this page cannot promise.
 */

const HEX64 = /^[0-9a-f]{64}$/i;

const NPUB = /^npub1[023456789acdefghjklmnpqrstuvwxyz]+$/i;

/**
 * The page for one booster, or null when there is no usable identifier.
 *
 * ⚠️ TWO ARGUMENTS TRIED IN TURN, never `npub || pk` collapsed by the caller
 * into one. A malformed npub would otherwise win over a perfectly good pubkey
 * and the surface would render unlinked; bech32 excludes `1`, `b`, `i` and `o`,
 * so a value that merely looks npub-shaped can still fail the test. The pubkey
 * is non-null on every record the feeds carry, so this always resolves for real
 * data. functions/_shared/detail-page.js#boosterPageUrl is the server copy and
 * does the same thing in the same order.
 *
 * Absolute-path, never absolute-URL: every caller renders inside this site.
 * (The boost NOTE's episode link is absolute because that string is read
 * wherever the event is rendered — nothing here is published to a relay.)
 *
 * @param {string|null} npub  bech32 npub, preferred
 * @param {string|null} [pk]  64-char hex pubkey, the fallback
 * @returns {string|null}
 */
export function boosterPageHref(npub, pk) {
  for (const cand of [npub, pk]) {
    const s = String(cand || '').trim();
    if (!s) continue;
    if (NPUB.test(s) || HEX64.test(s)) return `/booster/${encodeURIComponent(s)}`;
  }
  return null;
}

/**
 * Label an anchor that already points at a booster page. Returns it, so it can
 * be used inline in a builder.
 *
 * ⚠️ THIS DOES NOT SET THE href. Every caller has already resolved one through
 * boosterPageHref and branched on it — a surface with no usable identifier
 * renders a span rather than an anchor — so re-deriving it here would mean
 * running that two-candidate ladder twice and, worse, inviting a caller to pass
 * the collapsed `npub || pk` form the ladder exists to avoid.
 *
 * `secondary` marks a DUPLICATE link to the same person inside one row. A boost
 * row links both the avatar and the name, which is two anchors to one
 * destination: a screen reader announces it twice and a keyboard user tabs
 * through it twice. The duplicate keeps working with a mouse and drops out of
 * both, which is the ordinary fix for this shape. The NAME is always the primary
 * one, because it carries the text; an avatar is decorative.
 */
export function markBoosterLink(el, { label = '', secondary = false } = {}) {
  if (!el) return el;
  for (const [k, v] of Object.entries(boosterLinkAttrMap({ label, secondary }))) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * The same marking, as attributes rather than as a mutation.
 *
 * ⚠️ ONE RULE, TWO SHAPES, AND THEY SHARE THE TABLE BELOW. markBoosterLink is
 * for a builder holding an element; this is for one building an HTML string,
 * which the episode card now is on both sides of the wire. Neither reimplements
 * the decision — both read boosterLinkAttrMap — so a change to what a secondary
 * link means cannot reach one surface and miss the other.
 *
 * Returns a string with a leading space, or '', so it drops straight into a
 * template literal after the href.
 */
export function boosterLinkAttrs({ label = '', secondary = false } = {}) {
  return Object.entries(boosterLinkAttrMap({ label, secondary }))
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
}

/* `secondary` marks a DUPLICATE link to the same person inside one row — see
 * the note on markBoosterLink above. */
function boosterLinkAttrMap({ label, secondary }) {
  if (secondary) return { tabindex: '-1', 'aria-hidden': 'true' };
  return { title: label ? `Boosts by ${label}` : 'See this booster’s boosts' };
}

// Local rather than imported from nostr-text.js: this module is imported by
// every feed renderer and has been dependency-free since it was written, and
// one attribute value is not worth changing that.
function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
