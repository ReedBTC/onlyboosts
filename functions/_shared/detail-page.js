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
import {
  htmlEscape, isSafeUrl, truncate, mentionedPubkeys, renderMessage,
} from "../../assets/js/nostr-text.js";

export function jsonForScript(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export function num(n) {
  return Number(n || 0).toLocaleString("en-US");
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

export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function isoDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - Number(ts || 0);
  if (!Number.isFinite(sec) || sec < 0) return "";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`;
  return fmtDate(ts);
}

export function fmtDuration(sec) {
  const s = Number(sec || 0);
  if (!s || s < 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// A booster with no kind-0 gets their npub, shortened. `booster.npub` is
// nullable where the pubkey is not, so fall back to hex.
export function shortId(npub, pk) {
  const s = npub || pk || "";
  if (s.length < 16) return s;
  return s.slice(0, 10) + "…" + s.slice(-4);
}

export function displayName(r) {
  return r.display_name || r.pr_dname || r.name || r.pr_name || null;
}

/* One booster's page.
 *
 * ⚠️ A SECOND COPY OF assets/js/booster-link.js#boosterPageHref, and THE TWO MUST
 * AGREE. Both are marked, as is the third copy, episodePageUrl in
 * functions/show/[guid].js.
 *
 * All three were written when the rule was believed to be "a Pages Function
 * cannot import a client module". That is FALSE in general — esbuild inlines a
 * relative import off the filesystem when wrangler bundles the Functions, which
 * is exactly how assets/js/episode-card.js reaches this side and is what let the
 * episode card become one definition. What a two-sided module cannot use is an
 * ABSOLUTE `/assets/js/…` specifier, and booster-link.js has none. So these
 * copies are collapsible now; they are left alone because collapsing them is a
 * separate change with its own risk, not because it is impossible. See "The
 * Exception Is Closed" in CLAUDE.md.
 *
 * The rule is simply "there is an identifier", which is the whole reason this
 * sweep needed no fallbacks: a booster page qualifies on HAVING BOOSTED, and
 * every booster rendered by this file is there because they boosted. Contrast
 * episodePageUrl, which is withheld from the 500 titleless episodes and forces
 * every calling surface to carry a fallback destination.
 *
 * `booster.npub` is nullable where the pubkey is not, so the hex form is the
 * fallback; /booster/<npub> accepts both.
 */
export function boosterPageUrl(npub, pk) {
  // ⚠️ EACH CANDIDATE IS TRIED IN TURN, never `npub || pk` collapsed into one
  // string. A malformed npub would otherwise win over a perfectly good pubkey
  // and the row would render unlinked — bech32 excludes `1`, `b`, `i` and `o`,
  // so a value that merely looks npub-shaped can still fail. The pubkey is the
  // row's own primary key, so this always resolves for a real record.
  for (const cand of [npub, pk]) {
    const s = String(cand || "").trim();
    if (!s) continue;
    if (/^npub1[023456789acdefghjklmnpqrstuvwxyz]+$/i.test(s) || /^[0-9a-f]{64}$/i.test(s)) {
      return `/booster/${encodeURIComponent(s)}`;
    }
  }
  return null;
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

// ── The boost list ───────────────────────────────────────────────────────────
//
// NOT filtered to feed-level boosts on the show page, and that is the considered
// choice. Only 18% of qualifying shows have even one feed-level boost over six
// months and only 5% have three; UNGOVERNABLE, Citadel Dispatch and What Bitcoin
// Did would each show an empty section despite carrying 130+ boosts apiece.
// Whether a show accumulates them is an artifact of how listeners' apps build a
// boost, not a fact about the show. See docs/show-pages-spec.md.
//
// `target` is the "→ Ep. 3 · Title" line naming what a boost was sent to. It is
// the show page's: on an episode page every boost in the list targets the same
// episode the reader is already on, so the line would repeat the <h1> once per
// row. Pass `showTarget: false` there.
//
// `linkBooster` is false on ONE page: /booster/<npub>, where every row belongs
// to the booster whose page it is, so linking each one would point the page at
// itself once per row. The same reasoning as `showTarget` above, one column
// over — a row must not repeat what the <h1> already said.
export function renderBoosts(rows, names, { heading, sub, itemAbbr, noun, showTarget = true, linkBooster = true }) {
  if (!rows.length) return "";

  // `ob-boost-list` alongside `boost-list` is what makes these cards the same
  // object as the homepage Boosts feed's: the container override that gives a
  // .note-card its white background and 12px radius is keyed on it. Both classes
  // are carried because the section spacing is still show-page.css's.
  return `<section class="show-section" id="boosts">
    <div class="show-section-head">
      <h2>${htmlEscape(heading)}</h2>
      <p class="show-section-sub">${htmlEscape(sub)}</p>
    </div>
    <ul class="boost-list ob-boost-list">
      ${rows.map((r) => boostRow(r, names, { itemAbbr, noun, showTarget, linkBooster })).join("\n      ")}
    </ul>
  </section>`;
}

function boostRow(r, names, { itemAbbr, noun, showTarget, linkBooster = true }) {
  const realName = displayName(r);
  const name = realName || shortId(r.booster_npub, r.booster_pubkey);
  const pic = isSafeUrl(r.pr_pic) ? r.pr_pic : null;
  const href = linkBooster ? boosterPageUrl(r.booster_npub, r.booster_pubkey) : null;
  const missing = [realName ? null : "name", pic ? null : "pic"].filter(Boolean).join(" ");
  // ⚠️ NO "the episode" FALLBACK ANY MORE. The old compact row printed
  // "→ the episode" when the boost carried no episode title, which read fine as
  // a sentence fragment after an arrow. In the meta row it is a chip in the
  // position a title occupies, so it reads as though the episode were CALLED
  // "the episode". The feed card omits the chip outright in this case
  // (`if (b.episode.title)`), and these two surfaces are now one component, so
  // this does the same. `noun` is consequently unused here and kept in the
  // signature for the callers that still pass it.
  const target = r.e_title
    ? (r.e_num ? `${itemAbbr} ${htmlEscape(r.e_num)} · ${htmlEscape(truncate(r.e_title, 70))}` : htmlEscape(truncate(r.e_title, 70)))
    : null;

  // ⚠️ TWO LINKS TO ONE DESTINATION, unlike the community card above, and it is
  // unavoidable here: the avatar sits at the card's top-left and the name beside
  // it, but the ⋮ menu and the timestamp come between them in the author row.
  // The AVATAR is the duplicate and takes aria-hidden and tabindex="-1" — it
  // stays clickable with a mouse and drops out of the tab order and the
  // accessibility tree, so the card announces one link, on the name.
  //
  // The avatar is ALWAYS an <img>, falling back to the site placeholder rather
  // than to an empty circle. That is what the Boosts feed does (its cover chain
  // ends there and so always resolves), and it is what lets hydrateProfiles fill
  // a late-arriving picture by setting one src rather than by constructing an
  // element into a blank.
  const avatarSrc = pic || "/assets/avatar-fallback.svg";
  const avatar = `<img src="${htmlEscape(avatarSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  const avatarEl = href
    ? `<a class="note-avatar-link" href="${htmlEscape(href)}" tabindex="-1" aria-hidden="true">${avatar}</a>`
    : avatar;
  const whoEl = href
    ? `<a class="author-name" href="${htmlEscape(href)}" title="Boosts by ${htmlEscape(name)}">${htmlEscape(name)}</a>`
    : `<span class="author-name">${htmlEscape(name)}</span>`;

  // The meta row, same classes and same order as the feed card's: the sats, then
  // what was boosted. The feed also names the SHOW here; none of the three
  // detail-page queries select a show title, and on /show and /episode it would
  // be the page's own subject repeated on every row anyway.
  const meta = [
    Number(r.sats) > 0
      ? `<span class="ob-boost-sats">${htmlEscape(num(r.sats))}<span class="ob-bolt" aria-hidden="true">⚡</span></span>`
      : null,
    showTarget && target ? `<span class="ob-boost-ep">${target}</span>` : null,
  ].filter(Boolean).join("\n            ");

  const ts = Number(r.created_at) || 0;
  const iso = ts ? new Date(ts * 1000).toISOString() : "";

  /* ⚠️ THE CARD IS THE `[data-boost-note]` ELEMENT, and the three attributes on
   * it are the entire contract with assets/js/boost-note-actions.js. That module
   * finds these, builds the `{id, pubkey, kind, content, created_at, tags}`
   * projection buildActionBar needs, and appends the reply/like/repost/zap bar
   * plus the ⋮ menu — which buildActionBar puts into `.note-author` itself, so
   * that class is load-bearing rather than decorative.
   *
   * This is the rendering rule from CLAUDE.md in one element: the note is a
   * FACT and is server-rendered complete, the reactions are VERBS and arrive
   * with JavaScript. Nothing here waits on that, and a reader who never loads
   * the module reads the same boost.
   *
   * The message is deliberately NOT carried in a data attribute. A reply quotes
   * it, and the projection reads it back out of `.note-body` at attach time —
   * one copy of a string that can be 420 characters, on up to 500 cards. */
  return `<li${missing ? ` data-pk="${htmlEscape(r.booster_pubkey)}" data-missing="${missing}"` : ""}>
        <article class="note-card" data-boost-note data-event-id="${htmlEscape(r.event_id || "")}" data-pubkey="${htmlEscape(r.booster_pubkey || "")}" data-ts="${ts}">
          <div class="note-author">
            ${avatarEl}
            <div class="note-author-name-wrap">${whoEl}</div>
            <time datetime="${htmlEscape(iso)}" title="${htmlEscape(fmtDate(ts))}">${htmlEscape(relTime(ts))}</time>
          </div>
          ${meta ? `<div class="ob-boost-meta">
            ${meta}
          </div>` : ""}
          ${r.message ? `<div class="note-body">${renderMessage(r.message, names)}</div>` : ""}
        </article>
      </li>`;
}
