/* The boost note, as HTML, for the #boosts section on all three detail pages.
 *
 * ⚠️ THIS MODULE IS IMPORTED FROM BOTH SIDES. `functions/_shared/detail-page.js`
 * imports it by relative path, which esbuild resolves off the filesystem when
 * wrangler bundles the Pages Functions; assets/js/boost-section.js imports it as
 * `/assets/js/boost-list.js?v=<VERSION>` like any other module. That is the
 * whole reason it exists as a file of its own, and it is the same mechanism
 * assets/js/episode-card.js rests on. Two rules follow, both load-bearing:
 *
 *   1. NO DOM, NO `env`, NO `fetch`, NO `Intl` defaults. Everything here is a
 *      pure value→string function, so the same row produces the same bytes at
 *      the edge and in the browser. A row the server painted and the same row
 *      rebuilt after a re-sort are byte-identical BY CONSTRUCTION rather than by
 *      inspection.
 *   2. IMPORTS ARE RELATIVE AND STAMPED — `'./thing.js?v=<VERSION>'`. An ABSOLUTE
 *      `/assets/js/…` import resolves in the browser and fails to bundle, so it
 *      is the one form a two-sided module may not use. Everything imported here
 *      is itself two-sided.
 *
 * WHERE IT CAME FROM. `renderBoosts` and `boostRow` were
 * `functions/_shared/detail-page.js`'s and moved here unchanged, along with the
 * five small formatters they need. That file re-exports all of it, so nothing
 * that imported them from there had to change. The move is what lets the boost
 * list carry range and sort controls: the controls are VERBS and rebuild the
 * list in the browser, and the list they rebuild has to be the same list.
 *
 * WHAT IS NEW HERE rather than moved: the three comparators, the range filter,
 * the record→row adapter, and the two slots the client mounts into. See the
 * headings below.
 */
import {
  htmlEscape, isSafeUrl, truncate, renderMessage,
} from './nostr-text.js?v=ob-v190';
import { episodePageHref, showPageHref } from './show-link.js?v=ob-v190';
/* ⚠️ THE REAL MODULE, NOT A FOURTH COPY OF THE RULE. booster-link.js has been
 * dependency-free since it was written, so esbuild inlines it here exactly as it
 * does nostr-text.js, and the boost rows link a booster by the same test every
 * feed surface uses rather than by a transcription of it. This is the collapse
 * that functions/_shared/detail-page.js#boosterPageUrl said was available; that
 * name is now an alias for this function rather than a second copy of it. */
import { boosterPageHref } from './booster-link.js?v=ob-v190';
import { httpsUrl } from './cover-art.js?v=ob-v190';
import { clientLabel, hasClientLabel } from './client-label.js?v=ob-v190';

// ── The formatters the row needs ─────────────────────────────────────────────
//
// All five were functions/_shared/detail-page.js's and are re-exported from
// there, so the stat tiles and the page headers still reach them under the names
// they always had. They live on this side because the boost row is the one
// component that renders in both places, and a row rebuilt in the browser has to
// print a number and a date exactly as the edge did.
//
// `en-US` in UTC, never the reader's locale, for that reason — the same call the
// feeds make. The site has one date format rather than two.

export function num(n) {
  return Number(n || 0).toLocaleString("en-US");
}

export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/* ⚠️ THE ONE FUNCTION HERE THAT IS NOT PURE: it reads the clock, so the edge and
 * the browser disagree by however long the page has been open. That is correct
 * rather than a violation — "3h ago" is a statement about now, and a rebuilt row
 * showing the stale string the edge computed would be the bug. The `datetime`
 * and `title` attributes beside it are absolute and do not move. */
export function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - Number(ts || 0);
  if (!Number.isFinite(sec) || sec < 0) return "";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`;
  return fmtDate(ts);
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

// ── The row shape ────────────────────────────────────────────────────────────
//
// A "row" here is the boost as the three page queries SELECT it — event_id,
// booster_pubkey, booster_npub, created_at, sats, message, and whichever of
// item_guid / podcast_guid / e_title / e_num / e_pub / p_title / pr_name /
// pr_dname / pr_pic that surface joined for. Every one beyond the first four is
// optional, and a surface that suppresses a line does not select the column
// behind it.
//
// ⚠️ THE API RETURNS A DIFFERENT SHAPE, and this is the one place the two meet.
// /api/v1 answers in the collector's published record shape (`boostRecord` in
// functions/api/v1/_common.js), because every other consumer on the site reads
// that. Rather than teach the row renderer two shapes — which is how one
// component starts rendering two ways — the client adapts the records into rows
// once, here, and everything downstream sees the row the server saw.

/**
 * Published boost records → the row shape `boostRow` renders.
 *
 * @param {Array} records  as returned by any /api/v1 boost endpoint
 * @returns {Array} rows
 */
export function rowsFromRecords(records) {
  return (Array.isArray(records) ? records : []).map((b) => ({
    event_id: b.id ?? null,
    booster_pubkey: b.booster?.pk ?? null,
    booster_npub: b.booster?.npub ?? null,
    created_at: b.ts ?? 0,
    sats: b.sats ?? 0,
    message: b.msg ?? null,
    item_guid: b.episode?.guid ?? null,
    podcast_guid: b.podcast?.guid ?? null,
    e_title: b.episode?.title ?? null,
    e_num: b.episode?.num ?? null,
    // Which app PUBLISHED this note, for the "via" chip. `client_app.via` — the
    // app a relayed boost originated in — is deliberately not carried: see the
    // note over hasClientLabel in client-label.js.
    client_id: b.client_app?.id ?? null,
    // Not selected by any of the three PAGE queries — none of them prints an
    // air date on a boost row — but it is what the `episode` sort orders on, and
    // sorting only ever happens over a corpus fetched from the API. See
    // BOOST_SORTERS below.
    e_pub: b.episode?.date ?? null,
    p_title: b.podcast?.title ?? null,
    // ⚠️ `dname` IS A DELIBERATE ADDITION TO THE RECORD SHAPE, not an accident of
    // this adapter. The pages print `display_name` in preference to `name`; the
    // published record carried only the latter, so a rebuilt row would have
    // renamed every booster whose kind-0 sets both. See BOOST_SELECT.
    pr_dname: b.booster?.dname ?? null,
    pr_name: b.booster?.name ?? null,
    pr_pic: b.booster?.pic ?? null,
  }));
}

// ── Range and sort ───────────────────────────────────────────────────────────
//
// ⚠️ THE RANGE MEANS WHEN THE BOOST WAS SENT, on all three pages, matching
// /#members and /api/v1/podcasts. It does NOT mean when the episode aired;
// that axis belongs to the Episodes feeds and to /api/v1/episodes. Two readings
// of that parameter name already exist on this site deliberately, and there must
// not be a third.
//
// The comparators are boosts-feed.js#SORTERS over the row shape rather than the
// record shape, function for function, so a boost ordered on the homepage and
// the same boost ordered on a detail page land in the same place. No tie-break
// on the id: the corpus arrives ordered `created_at DESC, event_id DESC` and
// Array#sort is stable, so ties keep the server's total order for free.

// `e_pub` is null on ~12% of records (and on every record with no episode
// metadata at all), so undated boosts sink to the bottom of the episode order
// rather than floating to the top, where a 0 would put them.
function epTime(r) {
  const t = Number(r.e_pub);
  return Number.isFinite(t) && t > 0 ? t : -Infinity;
}

export const BOOST_SORTERS = {
  recent: (a, b) => b.created_at - a.created_at,
  // Compared before subtracting: two undated rows would otherwise be
  // -Infinity - -Infinity, i.e. NaN, in the comparator.
  episode: (a, b) => {
    const ea = epTime(a);
    const eb = epTime(b);
    return ea === eb ? b.created_at - a.created_at : eb - ea;
  },
  sats: (a, b) => ((b.sats || 0) - (a.sats || 0)) || (b.created_at - a.created_at),
};

/** Rows in the selected order. Always a new array; the caller's is untouched. */
export function sortBoostRows(rows, key) {
  const cmp = BOOST_SORTERS[key] || BOOST_SORTERS.recent;
  return [...rows].sort(cmp);
}

/** Rows sent at or after `cutoff` (epoch seconds). A null cutoff is unbounded. */
export function filterBoostRows(rows, cutoff) {
  return cutoff ? rows.filter((r) => Number(r.created_at) >= cutoff) : rows;
}

/* Rows sent to one show.
 *
 * ⚠️ AN EQUALITY ON podcast_guid, NEVER ON THE TITLE. 33% of the shows in the
 * index have no title and titles are not unique in any case, so the guid is a
 * row's only real handle. A row carrying no guid — ~2% of records — therefore
 * matches no picked show, which is right: we cannot say which show it belongs
 * to, and putting it under one would be a claim the data does not support.
 *
 * A null `guid` is "every show", the state every page but /booster is
 * permanently in. See boost-section.js#setShow. */
export function filterBoostShow(rows, guid) {
  return guid ? rows.filter((r) => r.podcast_guid === guid) : rows;
}

/* Rows whose MESSAGE contains every term in `query`, in any order.
 *
 * ⚠️ THE MESSAGE AND NOTHING ELSE, which is worth being strict about. Matching
 * the show or episode title beside it sounds friendlier and is not: on /show
 * every row belongs to the same show, so a query naming it returns everything,
 * and on any page a search for "bitcoin" would surface every boost sent to a
 * show with Bitcoin in its title rather than every boost that SAYS bitcoin. The
 * Shows feed learned the same lesson from its sub-line; see the `label` /
 * `extra` split in feed-search.js.
 *
 * ⚠️ SUBSTRING, NOT FTS5, AND DELIBERATELY SO. `boosts_fts` exists and
 * /api/v1/search?type=boosts already reads it, but MATCH is token-based with a
 * prefix wildcard — "rabbit" does not find "rabbithole" — and it is a GLOBAL
 * index with no way to scope to one show, episode or booster without new
 * plumbing. The section already holds its subject's whole corpus in memory the
 * moment any control is touched, so this is both cheaper and a closer match to
 * what someone typing into a box over their own boost inbox means.
 *
 * A row with no message can never match. That is not a bug and is worth knowing:
 * only ~16% of indexed boosts carry one, which is why the empty state says so.
 */
export function searchBoostRows(rows, query) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((r) => {
    const hay = String(r.message || "").toLowerCase();
    return hay ? terms.every((t) => hay.includes(t)) : false;
  });
}

// ── The section ──────────────────────────────────────────────────────────────
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
//
// `showShow` names the SHOW beside the episode, and is true on exactly one page
// for that same reason. See the meta-row note in boostRow.

/* Below how many boosts the section ships no controls at all.
 *
 * ⚠️ A RANGE CONTROL NEEDS SOMETHING TO RANGE OVER. The median episode carries
 * two boosts and the median show a handful, so a 1W/1M/1Y/All band over a
 * two-item list is chrome whose only possible effect is to empty the list it
 * sits above. Three is the smallest count at which an order is a question with
 * more than one answer.
 *
 * It gates the BAND, not the section: the list, the messages and the links are
 * facts and ship on every page regardless. */
export const CONTROLS_MIN = 3;

/**
 * The #boosts section: the list itself, plus the slots the client fills.
 *
 * @param {Array}  rows    boost rows, ordered newest-first by the query
 * @param {Map}    names   hex pubkey → display name, for the mention chips
 * @param {object} opts
 * @param {number} [opts.total]  how many boosts the subject has in ALL, which is
 *   what makes the load-more control correct before anything has been fetched.
 *   Defaults to the number of rows painted, which is right on a surface that
 *   ships every one of them.
 * @param {object} [opts.state]  extra keys for the state element. `page` is the
 *   one every caller sets: how many rows a client-side page holds, declared by
 *   the Function so a repaint cannot show fewer rows than the edge did.
 */
export function renderBoosts(rows, names, {
  heading, sub, noun, showTarget = true, linkBooster = true, showShow = false,
  total = null, state = null,
}) {
  if (!rows.length) return "";

  const count = rows.length;
  // Never below what is actually painted. `total` comes from an aggregate column
  // the collector maintains, and a stale one that undercounts would otherwise
  // print "Showing 24 of 19".
  const all = Math.max(Number(total) || 0, count);

  /* ⚠️ THE BAND, THE LIST SLOT, THE MORE SLOT AND THE STATE ELEMENT ARE THE WHOLE
   * CONTRACT with assets/js/boost-section.js.
   *
   * The band ships EMPTY and `hidden` because search, range and sort are VERBS:
   * a control that cannot act is worse than no control, and a reader with no
   * JavaScript gets the list with nothing missing but three controls. Same
   * discipline, and the same `.cs-controls` band, as the drawers on these pages.
   *
   * ⚠️ `.bs-shell` IS WHAT MAKES THE CONTROLS BELONG TO THE LIST. Without it the
   * band was a floating toolbar with a run of separate cards under it, and
   * nothing said the two were one thing — a reader could take the range buttons
   * for page-level chrome. Bordered, with the band as its lid, it is the same
   * box-with-a-lid idiom `.ep-drawer` uses everywhere else on these pages, and
   * the "Load more" is INSIDE it for the same reason it is inside `.ce-scroll`
   * on the episode drawers: a button below a panel reads as belonging to the
   * page rather than to the list.
   *
   * `ob-boost-list` alongside `boost-list` is what makes these cards the same
   * object as the homepage Boosts feed's: the container override that gives a
   * .note-card its white background and 12px radius is keyed on it. Both classes
   * are carried because the section spacing is still show-page.css's. */
  return `<section class="show-section" id="boosts" data-boost-section>
    <div class="show-section-head">
      <h2>${htmlEscape(heading)}</h2>
      <p class="show-section-sub">${htmlEscape(sub)}</p>
    </div>
    <div class="bs-shell">
      ${all >= CONTROLS_MIN ? `<div class="cs-controls bs-controls" data-bs-controls hidden></div>` : ""}
      <ul class="boost-list ob-boost-list" data-bs-list>
        ${boostRows(rows, names, { noun, showTarget, linkBooster, showShow })}
      </ul>
      <div class="bs-more" data-bs-more></div>
    </div>
    ${stateScript({
      count, total: all, sort: "recent", range: "all",
      /* ⚠️ THE ROW VARIANT RIDES THE STATE, exactly as `card` does in
       * functions/_shared/episode-cards.js, and for the same reason. Each surface
       * suppresses a different line — the episode on /episode, the booster link on
       * /booster, the show everywhere but /booster — and boost-section.js rebuilds
       * these rows on a re-sort. Declaring the variant in the client module as
       * well would be two declarations that agree only until one is edited, and
       * the failure would be a re-sorted /episode growing an episode chip naming
       * the page it is on. It is written from the arguments this call already
       * received, so a caller cannot set one and forget the other. */
      row: { noun, showTarget, linkBooster, showShow },
      ...(state || {}),
    })}
  </section>`;
}

/**
 * Just the `<li>` rows, joined — what a client repaint replaces the list with.
 *
 * Exported separately from `renderBoosts` because a rebuild replaces the list's
 * CONTENTS and not the section around it: the band, the state and the more slot
 * are the client's own and have to survive a re-sort.
 */
export function boostRows(rows, names, opts) {
  return rows.map((r) => boostRow(r, names, opts)).join("\n      ");
}

/* The handover, as one <script type="application/json">.
 *
 * ⚠️ IT CARRIES STATE, NEVER CONTENT — the same rule and the same reason as
 * functions/_shared/episode-cards.js#stateScript. The temptation is to embed the
 * rows so the client can re-sort without a request, and that is the whole
 * payload again, in JSON, beside the HTML it already produced. The client gets
 * the numbers it cannot derive from the DOM and fetches the corpus only if the
 * reader touches a control.
 *
 * `type="application/json"` is not executable and needs no CSP allowance; the
 * `<` escape is what keeps a `</script>` inside a value from closing the element
 * early. Written out here rather than imported from detail-page.js#jsonForScript
 * because that module is one-sided and this one may not depend on it.
 */
function stateScript(state) {
  return `<script type="application/json" data-boost-state>${
    JSON.stringify(state).replace(/</g, "\\u003c")}</script>`;
}

function boostRow(r, names, { noun, showTarget, linkBooster = true, showShow = false }) {
  const realName = displayName(r);
  const name = realName || shortId(r.booster_npub, r.booster_pubkey);
  // https-promoted before the guard; see httpsUrl in cover-art.js.
  const picUrl = httpsUrl(r.pr_pic);
  const pic = isSafeUrl(picUrl) ? picUrl : null;
  const href = linkBooster ? boosterPageHref(r.booster_npub, r.booster_pubkey) : null;
  const missing = [realName ? null : "name", pic ? null : "pic"].filter(Boolean).join(" ");
  // ⚠️ NO "the episode" FALLBACK ANY MORE. The old compact row printed
  // "→ the episode" when the boost carried no episode title, which read fine as
  // a sentence fragment after an arrow. In the meta row it is a chip in the
  // position a title occupies, so it reads as though the episode were CALLED
  // "the episode". The feed card omits the chip outright in this case
  // (`if (b.episode.title)`), and these two surfaces are now one component, so
  // this does the same. `noun` is consequently unused here and kept in the
  // signature for the callers that still pass it.
  // ⚠️ NO EPISODE NUMBER EITHER, and it is the same objection one step further
  // on. The chip used to read "Ep. 42 · Title", from `episodes.episode_number`.
  // Most publishers already put the number in the title they wrote, so the chip
  // printed it twice — "Ep. 42 · Episode 42: The Thing" — and the half we added
  // was the redundant one. The title is the publisher's own name for the
  // episode and is left to speak for itself. Reed's call, 2026-08-24; the
  // column is still selected and still published on /api/v1, it is simply not
  // rendered anywhere.
  const target = r.e_title ? htmlEscape(truncate(r.e_title, 70)) : null;

  // ⚠️ TWO LINKS TO ONE DESTINATION, unlike the community card, and it is
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

  /* The meta row: the sats, then what was boosted.
   *
   * ⚠️ THE EPISODE IS A LINK, AND THE SHOW APPEARS BESIDE IT. The homepage
   * Boosts feed had rendered both as links since /episode/<guid> landed —
   * `a.ob-boost-ep` and `a.ob-boost-show` are styled in boosts-thread.css and
   * were sitting there unused on this side — while these three pages emitted a
   * plain span and no show at all. That is exactly the failure the rendering
   * rule's own test names: a reader could screenshot a boost note from the
   * homepage and one from /show and tell them apart.
   *
   * The link is withheld from the 500 titleless episodes by the same rule every
   * other surface applies, through the same module rather than a copy of it.
   *
   * ⚠️ `showShow` IS TRUE ON /booster ONLY, and that is not an oversight. On
   * /show and /episode the show is the page's own subject — the <h1> on one and
   * the eyebrow link on the other — so naming it on every one of 24 rows
   * restates what the reader is already looking at. Same reasoning as
   * `showTarget`, which suppresses the EPISODE on /episode for the same reason.
   * A booster's page is the one where a row's show is new information.
   */
  const epHref = episodePageHref(r.item_guid, r.e_title);
  const epEl = target
    ? (epHref
        ? `<a class="ob-boost-ep" href="${htmlEscape(epHref)}">${target}</a>`
        : `<span class="ob-boost-ep">${target}</span>`)
    : null;

  const showHref = showPageHref(r.podcast_guid);
  const showEl = (showShow && r.p_title)
    ? (showHref
        ? `<a class="ob-boost-show ob-boost-show-link" href="${htmlEscape(showHref)}">${htmlEscape(truncate(r.p_title, 60))}</a>`
        : `<span class="ob-boost-show">${htmlEscape(truncate(r.p_title, 60))}</span>`)
    : null;

  /* WHICH APP PUBLISHED THIS NOTE. It rides the meta row beside the sats
   * because that row is already the "what this boost was" line, and the client
   * is a fact about the boost rather than about the episode or the show.
   *
   * ⚠️ IT IS A DERIVED CLASSIFICATION, NOT A FIELD ANYONE SIGNED. The NIP-89
   * `client` tag is on 1.3% of the corpus; the collector infers the rest from
   * the NIP-73 i-tag's host and from known publisher pubkeys, and leaves
   * `client_id` null when nothing fired. So the chip is absent on ~0.2% of rows
   * rather than guessing, and absent is the correct rendering of "we do not
   * know" — see hasClientLabel.
   *
   * ⚠️ NOT A LINK. There is no per-client page to point at; /api/v1/clients has
   * no surface yet and /stats is still a placeholder. A chip that looked
   * clickable and was not would be worse than a plain one, and this is the row
   * where two links already compete for the reader.
   */
  const via = hasClientLabel(r.client_id)
    ? `<span class="ob-boost-via">via ${htmlEscape(clientLabel(r.client_id))}</span>`
    : null;

  const meta = [
    Number(r.sats) > 0
      ? `<span class="ob-boost-sats">${htmlEscape(num(r.sats))}<span class="ob-bolt" aria-hidden="true">⚡</span></span>`
      : null,
    via,
    showTarget ? epEl : null,
    showTarget ? showEl : null,
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
