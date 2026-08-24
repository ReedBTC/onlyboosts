/* THE NOSTR COMMUNITY WALL. One definition, both sides of the wire.
 *
 * ⚠️ MOVED OUT OF functions/_shared/detail-page.js SO THE HOMEPAGE CAN RENDER IT
 * TOO, and moved rather than copied for the reason CLAUDE.md gives: a reader who
 * screenshots this component on /show and on the Members tab must not be able to
 * tell them apart. A second implementation agrees by inspection until the day it
 * does not. detail-page.js re-exports every name below, so the two Functions
 * that already call renderSupporters did not change.
 *
 * This is the same arrangement renderBoosts has — defined in assets/js, aliased
 * from the shared server module — and it was cheap for the same reason: every
 * dependency was already two-sided. `displayName`, `shortId` and `num` come
 * from boost-list.js, `boosterPageHref` from booster-link.js, `htmlEscape` and
 * `isSafeUrl` from nostr-text.js, and `compact` moved here beside its one
 * remaining caller in this file.
 *
 * ⚠️ IMPORTS ARE RELATIVE AND STAMPED, which is what makes a two-sided module
 * possible. An absolute `/assets/js/…` import resolves in the browser and
 * cannot be bundled by esbuild, so it is the one form this file may not use.
 *
 * The markup is unchanged from the day it moved, byte for byte — verified by
 * rendering the original against fixtures, moving, and diffing the output.
 */
import { num, shortId, displayName } from './boost-list.js?v=ob-v141'
import { boosterPageHref as boosterPageUrl } from './booster-link.js?v=ob-v141'
import { htmlEscape, isSafeUrl } from './nostr-text.js?v=ob-v141'

/* Compact sat figures — 1435000 → "1.4M". Lives here rather than in
 * detail-page.js because the wall is its heaviest caller and this module may
 * not import from the server side. detail-page.js re-exports it. */
export function compact(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1e4) return Math.round(v / 1e3) + "k";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
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
/* ⚠️ THE HEADING IS A PARAMETER AND THE TWO CALLERS PASS DIFFERENT WORDS, ON
 * PURPOSE. The detail pages say "Nostr Community"; the homepage's Members tab
 * says "Members". That is not an inconsistency to tidy up later — the protocol
 * is not the greeting, and a visitor who has drilled into one show's page has
 * chosen to go deeper than one who just landed. Reed's call, 2026-08-23.
 * Defaults keep the detail pages calling this exactly as they did. */
export function renderSupporters(rows, {
  sub, empty, heading = "Nostr Community", id = "community", sectionClass = "show-section",
  metric = "sats",
} = {}) {
  if (!rows.length) {
    return `<section class="${htmlEscape(sectionClass)}" id="${htmlEscape(id)}">
      <h2>${htmlEscape(heading)}</h2>
      <p class="show-empty">${htmlEscape(empty)}</p>
    </section>`;
  }

  const podium = rows.slice(0, PODIUM);
  const rest = rows.slice(PODIUM);
  const hidden = Math.max(0, rest.length - (SUPPORTERS_VISIBLE - PODIUM));

  return `<section class="${htmlEscape(sectionClass)}" id="${htmlEscape(id)}">
    <div class="show-section-head">
      <h2>${htmlEscape(heading)}</h2>
      <p class="show-section-sub">${sub}</p>
    </div>

    <ol class="sup-podium">
      ${podium.map((r) => supporterCard(r, true, false, metric)).join("\n      ")}
    </ol>

    ${rest.length ? `<ol class="sup-grid" data-supporter-grid>
      ${rest.map((r, i) => supporterCard(r, false, i >= SUPPORTERS_VISIBLE - PODIUM, metric)).join("\n      ")}
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
/* ⚠️ THE METRIC IS A PARAMETER AND `sats` IS THE DEFAULT, so /show and /episode
 * call this exactly as they did and their markup is byte-identical. The Members
 * tab ranks the same wall three ways — sats, boosts, shows — and the figure
 * under each face has to be the one the list was ordered by, or the wall shows
 * a descending column of sats under an order it did not compute. */
const METRICS = {
  sats:   { value: (r) => r.sats,   label: 'sats',
            title: (r) => `${num(r.sats)} sats across ${num(r.boosts)} boosts` },
  boosts: { value: (r) => r.boosts, label: (v) => (v === 1 ? 'boost' : 'boosts'),
            title: (r) => `${num(r.boosts)} boosts, ${num(r.sats)} sats` },
  shows:  { value: (r) => r.shows,  label: (v) => (v === 1 ? 'show' : 'shows'),
            title: (r) => `${num(r.shows)} shows boosted, ${num(r.sats)} sats` },
};

function supporterCard(r, isPodium, hidden = false, metric = 'sats') {
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
  const m = METRICS[metric] || METRICS.sats;

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
        <span class="sup-sats" title="${htmlEscape(m.title(r))}">${htmlEscape(compact(m.value(r)))} ${htmlEscape(typeof m.label === "function" ? m.label(m.value(r)) : m.label)}</span>
      </li>`;
}

// ── "Show N more" ────────────────────────────────────────────────────
/* Scoped to the button's own <section> rather than to a named grid, which is
 * what lets one handler serve all of them — the overflow items and the button
 * that reveals them are always in the same section, and the two podroll grids
 * are otherwise identical, so a selector naming one would fire on both. */
export function initShowMore() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-show-more]')
    if (!btn) return
    for (const li of btn.closest('section')?.querySelectorAll('[data-overflow]') || []) {
      li.hidden = false
      li.removeAttribute('data-overflow')
    }
    btn.remove()
  })
}
