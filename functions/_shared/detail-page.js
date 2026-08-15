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

// Compact sats for the stat tiles: 45,045,439 reads worse than 45.0M at a
// glance, and the exact figure is in the title attribute.
export function compact(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1e4) return Math.round(v / 1e3) + "k";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
}

export function isoDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function fmtDuration(sec) {
  const s = Number(sec || 0);
  if (!s || s < 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

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

// ── The Nostr Community wall ─────────────────────────────────────────────────
//
// LB's supporters.html is the visual ancestor (circular avatars, name beneath,
// click-to-copy npub), but its TIER system is deliberately not carried over: LB
// bucketed by absolute lifetime sats (100k / 69k / 21k), which works across one
// show's whole audience and collapses per show. The median show here has one
// booster and only 209 of 1,384 have five or more, so absolute thresholds would
// file nearly everyone in the bottom tier. Relative standing replaces it: a
// podium for the top five, then a ranked grid.
//
// "Nostr Community" rather than "Supporters", and the distinction is the point.
// "Supporters" is a claim about who supports the show, and the wall cannot make
// it: a show with two hundred keysend supporters and three Nostr boosters would
// read as having three supporters. "Community" names the group this page can
// actually see, and the qualifier says which group that is. The count noun
// elsewhere stays "booster", because a person is a booster and only the set of
// them is a community. See the site-wide vocabulary note in CLAUDE.md.
//
// NO COUNT BADGE on the heading. It read as a size claim about the subject's
// community where it is a count of who published a boost to Nostr, and the
// sub-line under it already names the set precisely.

// How many boosters paint above the fold. The rest render behind a toggle
// rather than being dropped — a community wall that hides people is worse than
// a long page.
//
// PODIUM is the top row of larger cards. Five rather than three: the wall sits
// in a 60rem column, which fits five 9rem cards across with room to spare, so
// three left the row looking sparse against the grid beneath it. VISIBLE counts
// the podium, so the grid under it holds SUPPORTERS_VISIBLE - PODIUM.
export const SUPPORTERS_VISIBLE = 21;
export const PODIUM = 5;

// The class name, the data attribute and every `.sup-*` selector keep the
// "supporter" spelling on purpose. The rename to "community" was a SURFACE
// rename — the same seam as Podcasts → Episodes. See CLAUDE.md.
export function renderSupporters(rows, { sub, empty }) {
  if (!rows.length) {
    return `<section class="show-section" id="community">
      <h2>Nostr Community</h2>
      <p class="show-empty">${htmlEscape(empty)}</p>
    </section>`;
  }

  const podium = rows.slice(0, PODIUM);
  const rest = rows.slice(PODIUM);
  const hidden = Math.max(0, rest.length - (SUPPORTERS_VISIBLE - PODIUM));

  return `<section class="show-section" id="community">
    <div class="show-section-head">
      <h2>Nostr Community</h2>
      <p class="show-section-sub">${sub}</p>
    </div>

    <ol class="sup-podium">
      ${podium.map((r) => supporterCard(r, true)).join("\n      ")}
    </ol>

    ${rest.length ? `<ol class="sup-grid" data-supporter-grid>
      ${rest.map((r, i) => supporterCard(r, false, i >= SUPPORTERS_VISIBLE - PODIUM)).join("\n      ")}
    </ol>` : ""}

    ${hidden > 0 ? `<button type="button" class="btn btn-quiet show-more" data-show-more="supporter">
      Show ${num(hidden)} more booster${hidden === 1 ? "" : "s"}
    </button>` : ""}
  </section>`;
}

// No rank number. The wall is ordered by sats, so position already says
// standing, and a numeral on every avatar turned a community into a scoreboard.
// The podium's larger avatars are what mark the top of the order now.
//
// ⚠️ THE AVATAR WAS A COPY-NPUB BUTTON AND IS NOW A LINK TO THAT BOOSTER'S PAGE.
// The gesture is not lost, it MOVED: /booster/<npub> leads with a "Copy npub"
// button, on a page that also says whose npub it is. That trade is the whole
// point of the page existing — a face on a wall that copies a string is a dead
// end, where a face that opens the person's history is the same navigation the
// show name and the episode title already do.
//
// ONE anchor wrapping the avatar AND the name, not two. Two links to one
// destination inside one card is announced twice and tabbed through twice; the
// sats stay outside it, being a figure rather than a way in. `.sup-link`
// restates the card's own column layout so the wrapper costs nothing visually —
// see show-page.css.
function supporterCard(r, isPodium, hidden = false) {
  const name = displayName(r);
  const label = name || shortId(r.booster_npub, r.booster_pubkey);
  const pic = isSafeUrl(r.picture) ? r.picture : null;
  const href = boosterPageUrl(r.booster_npub, r.booster_pubkey);

  // What the index couldn't supply is declared for the client to fill from
  // Primal (detail-page.js#hydrateProfiles). Nothing here waits on that: the
  // card is complete and readable as rendered, and a visitor with no JavaScript
  // keeps the shortened npub and the blank circle.
  //
  // hydrateProfiles reaches `.sup-name` and `.sup-avatar` by class from this
  // <li>, so wrapping them in the anchor below leaves it working untouched.
  const missing = [name ? null : "name", pic ? null : "pic"].filter(Boolean).join(" ");

  const inner = `<span class="sup-avatar${pic ? "" : " is-blank"}">
            ${pic ? `<img src="${htmlEscape(pic)}" alt="" loading="lazy" />` : ""}
          </span>
          <span class="sup-name" title="${htmlEscape(label)}">${htmlEscape(label)}</span>`;

  // A booster with neither an npub nor a pubkey cannot happen — the pubkey is
  // the row's own key — but the card renders unlinked rather than emitting a
  // dead href if one ever does.
  const body = href
    ? `<a class="sup-link" href="${htmlEscape(href)}" title="Boosts by ${htmlEscape(label)}">
          ${inner}
        </a>`
    : `<span class="sup-link">${inner}</span>`;

  return `<li class="sup-card${isPodium ? " sup-card--podium" : ""}"${hidden ? " hidden data-overflow" : ""}${
        missing ? ` data-pk="${htmlEscape(r.booster_pubkey)}" data-missing="${missing}"` : ""}>
        ${body}
        <span class="sup-sats" title="${htmlEscape(num(r.sats))} sats across ${htmlEscape(num(r.boosts))} boosts">${htmlEscape(compact(r.sats))} sats</span>
      </li>`;
}
