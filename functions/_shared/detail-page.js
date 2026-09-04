// Server-side pieces shared by the two edge-rendered detail pages,
// functions/show/[guid].js and functions/episode/[guid].js.
//
// Underscore-prefixed → not routed, only imported. Same arrangement as
// functions/api/v1/_common.js.
//
// The show page was written first and every one of these came out of it
// unchanged; this is a move, not a rewrite. What lives here is what a page about
// a SHOW and a page about an EPISODE do identically: the number and date formats
// on the stat tiles, the two mention lookups, the wall of booster avatars, and
// the list of boosts at the foot.
//
// The escaping and the bech32 tokenizer moved on to assets/js/nostr-text.js, and
// are re-exported below — see the note over that re-export.
//
// What deliberately does NOT live here is the nav and footer markup. Those are
// generated into each page file between NAV:START / NAV:END markers by
// scripts/sync-partials.js, which carries an EDGE_PAGES list — a shared module
// would put the markup one indirection away from the script that owns it.

/* ⚠️ THE TEXT RENDERER MOVED, AND THIS RE-EXPORTS IT.
 *
 * htmlEscape, isSafeUrl, truncate, renderMessage, renderBioText and
 * mentionedPubkeys were all defined here until the episode card became one
 * definition. The card renders boost messages, and it renders them at the edge
 * AND in the browser, so the tokenizer had to be reachable from both — which a
 * module under `functions/` never can be. It lives in
 * `assets/js/nostr-text.js` now, imported by relative path here (esbuild reads
 * it off the filesystem when wrangler bundles the Functions) and by stamped URL
 * in the browser.
 *
 * They are re-exported rather than relocated in the callers' imports because
 * this file is where four Functions already look for them; moving the import
 * sites would be churn with nothing behind it. `htmlEscape` alone has ~200 uses
 * across the pages.
 */
export {
  htmlEscape, isSafeUrl, truncate,
  renderMessage, renderBioText, mentionedPubkeys,
} from "../../assets/js/nostr-text.js";
import { htmlEscape, isSafeUrl, mentionedPubkeys } from "../../assets/js/nostr-text.js";
/* ⚠️ THE BOOST LIST MOVED, AND THIS RE-EXPORTS IT.
 *
 * renderBoosts and boostRow were defined here until the #boosts sections gained
 * range and sort. Those controls rebuild the list in the browser, and a row the
 * edge painted and the same row rebuilt after a re-sort have to be the same
 * string — which a module under `functions/` can never be, since the browser
 * cannot import one. It lives in `assets/js/boost-list.js` now, imported by
 * relative path here (esbuild reads it off the filesystem when wrangler bundles
 * the Functions) and by stamped URL in the browser.
 *
 * The five formatters below travelled with it because the row prints numbers and
 * dates and so needs them on that side. They are re-exported rather than
 * relocated in the callers' imports for the same reason nostr-text.js's are:
 * this file is where four Functions already look for them.
 */
export {
  renderBoosts, num, fmtDate, relTime, shortId, displayName,
} from "../../assets/js/boost-list.js";
import { num, shortId, displayName } from "../../assets/js/boost-list.js";
/* ⚠️ boosterPageUrl IS NOW AN ALIAS, NOT A SECOND COPY. It was a transcription of
 * assets/js/booster-link.js#boosterPageHref, written when the rule was believed
 * to be "a Pages Function cannot import a client module" — false in general, and
 * the boost row's move to boost-list.js is what forced the point: that module
 * imports booster-link.js directly, so keeping a copy here would have been two
 * definitions of one URL rule running side by side on the same page. The name is
 * kept because renderSupporters and functions/show/[guid].js use it.
 *
 * The rule is simply "there is an identifier", which is why this needs no
 * fallbacks: a booster page qualifies on HAVING BOOSTED, and every booster
 * rendered by this file is there because they boosted. Contrast episodePageUrl in
 * functions/show/[guid].js, which is withheld from the 500 titleless episodes and
 * forces every calling surface to carry a fallback destination.
 */
export { boosterPageHref as boosterPageUrl } from "../../assets/js/booster-link.js";
import { boosterPageHref as boosterPageUrl } from "../../assets/js/booster-link.js";

export function jsonForScript(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export function isoDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// fmtDuration moved to assets/js/boost-list.js on 2026-09-04, where fmtDate
// already was: the episode catalogue (assets/js/episode-catalogue.js) builds
// drawer rows in the browser that must match the edge's byte for byte.
export { fmtDuration } from "../../assets/js/boost-list.js";

/* Display names for any npub mentioned inside a boost message.
 *
 * One extra query, and only when a message actually carries a mention — most
 * don't. A mentioned npub need not be a booster, so a miss here is normal and
 * the chip falls back to a truncated identifier.
 *
 * Placeholders rather than json_each: both callers show a couple of dozen
 * boosts, so this list is tiny and always far inside D1's 100-bound-parameter
 * ceiling. The follows endpoint needs json_each because its author list runs to
 * thousands; here it would only add a dependency on a table-valued function
 * Cloudflare does not document. Sliced anyway, so a pathological message can't
 * blow the limit.
 */
export async function lookupMentionNames(env, messages) {
  const names = new Map();
  const mentioned = mentionedPubkeys(messages).slice(0, 90);
  if (!mentioned.length) return names;
  const rows = await env.DB.prepare(
    `SELECT pubkey, name, display_name FROM profiles
     WHERE pubkey IN (${mentioned.map(() => "?").join(",")})`
  ).bind(...mentioned).all();
  for (const p of rows.results || []) {
    const n = p.display_name || p.name;
    if (n) names.set(p.pubkey, n);
  }
  return names;
}

/* Profiles, not just names, for every npub mentioned across a set of texts.
 *
 * The sibling of lookupMentionNames above, and separate from it rather than a
 * widening of it: that function's Map holds STRINGS and renderMessage does
 * `names.get(pk)` expecting one, so changing its value type would have to
 * change both boost surfaces at once for the benefit of a third. This returns
 * `{ name, picture }` because a bio mention renders as a face and a name where
 * a boost-message mention renders as a text chip.
 */
export async function lookupMentionProfiles(env, texts) {
  const out = new Map();
  const mentioned = mentionedPubkeys(texts).slice(0, 90);
  if (!mentioned.length) return out;
  const rows = await env.DB.prepare(
    `SELECT pubkey, name, display_name, picture FROM profiles
     WHERE pubkey IN (${mentioned.map(() => "?").join(",")})`
  ).bind(...mentioned).all();
  for (const p of rows.results || []) {
    out.set(p.pubkey, {
      name: p.display_name || p.name || null,
      picture: isSafeUrl(p.picture) ? p.picture : null,
    });
  }
  return out;
}

/* ── The Nostr Community wall ──
 * ⚠️ MOVED TO assets/js/supporter-wall.js AND RE-EXPORTED, NOT COPIED. The
 * homepage's Members tab renders the same wall in the browser, and a component
 * a reader can screenshot from two pages has to be one definition. These are
 * aliases; the markup, the podium rule and the counts all live there.
 * Same arrangement renderBoosts has, three imports up. */
export {
  renderSupporters, SUPPORTERS_VISIBLE, PODIUM, compact,
} from "../../assets/js/supporter-wall.js";

