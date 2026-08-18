// A subject's rank on the all-time global feed it belongs to — three ranks, one
// per quantitative sort, rendered as a row above the stat tiles on /show and
// /episode. Server-side facts only; nothing here is a verb.
//
// WHICH LIST. "Rank" here means the position the subject's card holds on the
// homepage feed a reader could scroll to, so the query restates that feed's
// definition exactly rather than a plausible cousin of it:
//   • the FEED is chosen by the medium partition — a music show ranks among
//     Albums and every other show ranks among Shows, an episode of a music
//     feed ranks among Songs and every other episode among Episodes. Same
//     `COALESCE(medium,'podcast') <> 'music'` the two API endpoints use, so an
//     unidentified show ranks where its card is: on Shows.
//   • ALL TIME, and ALL LANGUAGES: the precomputed aggregate columns, no
//     window, no `lang`. A rank on a windowed or filtered list would be true
//     of a view most readers of this page will never have on screen.
//   • Global, never Follows.
//
// ⚠️ THE TIEBREAK IS THE FEED'S TIEBREAK, or the number is wrong. A rank is
// 1 + the count of rows the feed orders BEFORE this one, and the feed's order
// is `<sort col> DESC, total_sats DESC, guid` (`total_sats DESC, guid` when the
// sort is sats itself) — see the ORDER BY in functions/api/v1/podcasts.js and
// globalEpisodes() in functions/api/v1/episodes.js. Counting rows with a
// strictly greater sort value alone would hand every member of a tie the same
// rank, and the card on the feed carries the position, not the tie. Change one
// of those ORDER BYs and this must follow.
//
// COST. One scan of `podcasts` (~1.3k rows) or `episodes` (~6.7k rows, joined
// to `podcasts` for the medium) per page render, in the page's Promise.all and
// behind its 300s edge cache. Cheaper than the community rollup beside it.
//
// ⚠️ IT NEVER THROWS. A rank row is decoration on a page about a show's
// boosts; a failure here costs the row and nothing else, the discipline the
// podroll queries set. `feedRanks` resolves null on any error and the renderer
// prints nothing for null.

// The three sorts, in the order of the stat tiles beneath (sats, boosts,
// boosters), so the rank row and the figure row line up column for column:
// "#8 most sats" over "1.2M sats", "#12 most boosts" over "506 boosts".
const RANK_KEYS = ["sats", "boosts", "boosters"];

const RANK_LABELS = { boosts: "most boosts", sats: "most sats", boosters: "most boosters" };

/**
 * `1 + COUNT(rows ordered before the subject)` for one sort, as a CASE inside a
 * COUNT so the three ranks and the list size come off one scan. `sortCol` is
 * the SQL column of the sort key, `sortVal` the subject's value of it; `sats`
 * and `id` are the subject's total_sats and guid, `satsCol` / `idCol` theirs.
 * The sats sort has no separate sats tiebreak, so it drops the middle clause.
 */
function rankExpr({ sortCol, satsCol, idCol }, isSats, args, sortVal, sats, id) {
  const beforeOnSats = `(COALESCE(${satsCol},0) > ? OR (COALESCE(${satsCol},0) = ? AND ${idCol} < ?))`;
  if (isSats) {
    args.push(sats, sats, id);
    return `1 + COUNT(CASE WHEN ${beforeOnSats} THEN 1 END)`;
  }
  args.push(sortVal, sortVal, sats, sats, id);
  return `1 + COUNT(CASE WHEN COALESCE(${sortCol},0) > ? OR (COALESCE(${sortCol},0) = ? AND ${beforeOnSats}) THEN 1 END)`;
}

/**
 * The three all-time global ranks for a show or an episode, and the size of
 * the list they are ranks on. Resolves `{ boosts, sats, boosters, of }` or
 * null; never rejects.
 *
 * @param {D1Database} db
 * @param {"show"|"episode"} kind
 * @param {object} row  the subject's own D1 row: `podcast_guid` or `item_guid`,
 *   `boost_count`, `total_sats`, `booster_count`, and for a show its `medium`,
 *   for an episode the show's medium as `p_medium`.
 */
export async function feedRanks(db, kind, row) {
  try {
    const isEpisode = kind === "episode";
    const id = isEpisode ? row.item_guid : row.podcast_guid;
    if (!id) return null;
    const music = (isEpisode ? row.p_medium : row.medium) === "music";
    // ⚠️ Every subject value is COALESCEd to 0 exactly as the SQL side is: the
    // aggregate columns are nullable in principle, and a null on either side of
    // the comparison would silently drop the row from the count.
    const boosts = Number(row.boost_count) || 0;
    const sats = Number(row.total_sats) || 0;
    const boosters = Number(row.booster_count) || 0;

    // Same alias on both tables so the CASE expressions read the same.
    const cols = isEpisode
      ? { boosts: "e.boost_count", sats: "e.total_sats", boosters: "e.booster_count", id: "e.item_guid" }
      : { boosts: "p.boost_count", sats: "p.total_sats", boosters: "p.booster_count", id: "p.podcast_guid" };
    const from = isEpisode
      ? "FROM episodes e LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid"
      : "FROM podcasts p";
    const mediumCol = isEpisode ? "pc.medium" : "p.medium";

    const args = [];
    const parts = {
      boosts:   rankExpr({ sortCol: cols.boosts,   satsCol: cols.sats, idCol: cols.id }, false, args, boosts,   sats, id),
      sats:     rankExpr({ sortCol: cols.sats,     satsCol: cols.sats, idCol: cols.id }, true,  args, sats,     sats, id),
      boosters: rankExpr({ sortCol: cols.boosters, satsCol: cols.sats, idCol: cols.id }, false, args, boosters, sats, id),
    };
    // The medium partition, restated from the API: `music` is Albums/Songs and
    // EVERYTHING ELSE — podcasts, video, and shows the collector cannot
    // identify — is Shows/Episodes. Never `= 'podcast'`.
    const where = music
      ? `COALESCE(${mediumCol},'podcast') = 'music'`
      : `COALESCE(${mediumCol},'podcast') <> 'music'`;
    const sql = `SELECT ${parts.boosts} AS r_boosts, ${parts.sats} AS r_sats,
                        ${parts.boosters} AS r_boosters, COUNT(*) AS n
                 ${from} WHERE ${where}`;
    const r = await db.prepare(sql).bind(...args).first();
    if (!r) return null;
    const out = { boosts: r.r_boosts, sats: r.r_sats, boosters: r.r_boosters, of: r.n };
    // A rank past the list's end means the subject is not on the list this
    // query describes (a row the feed filters that this does not, or a value
    // that changed between two reads). Print nothing rather than a wrong number.
    for (const k of RANK_KEYS) {
      if (!Number.isFinite(out[k]) || out[k] < 1 || out[k] > out.of) return null;
    }
    return out;
  } catch (err) {
    console.warn("[feed-rank] rank query failed", err);
    return null;
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const numFmt = (n) => Number(n).toLocaleString("en-US");

/**
 * The rank row: a caption naming the list, then three tiles. Sits under the
 * "Nostr Boost Stats" heading and above the stat tiles, so it inherits the
 * heading's qualifier — these are ranks among boosts published to Nostr, and
 * the link in the heading is what says so.
 *
 * `copy.rankFeed` is the feed's name ("Shows", "Albums", "Episodes", "Songs")
 * and `copy.backHref` where it lives; the caption links there. The tiles link
 * nowhere: a hash cannot carry a sort, so three links would open one list
 * three times.
 *
 * @param {{boosts:number,sats:number,boosters:number,of:number}|null} ranks
 * @param {{rankFeed:string, backHref:string, rankNoun:string}} copy
 */
export function renderRankRow(ranks, copy) {
  if (!ranks) return "";
  const noun = copy.rankNoun || copy.rankFeed.toLowerCase();
  const tiles = RANK_KEYS.map((k) => {
    const label = RANK_LABELS[k];
    const tip = `#${numFmt(ranks[k])} of ${numFmt(ranks.of)} ${noun} by ${label.replace(/^most /, "")}, all time`;
    return `<div class="show-rank" title="${esc(tip)}"><dt>${esc(label)}</dt><dd>#${esc(numFmt(ranks[k]))}</dd></div>`;
  }).join("\n      ");
  return `<p class="show-ranks-cap">All-time rank among
      <a href="${esc(copy.backHref)}" title="The ${esc(copy.rankFeed)} feed">${esc(numFmt(ranks.of))} ${esc(noun)}</a></p>
    <dl class="show-ranks">
      ${tiles}
    </dl>`;
}
