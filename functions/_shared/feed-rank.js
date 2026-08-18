// A subject's rank on the all-time global feed it belongs to, rendered as the
// third line of each stat tile on /show and /episode. Server-side facts only;
// nothing here is a verb.
//
// ── THE SCHEME: STANDARD COMPETITION RANKING (1-2-2-4) ───────────────────────
//
// ⚠️ A RANK IS THE NUMBER OF ROWS STRICTLY AHEAD, PLUS ONE. Everything tied
// shares the better place and the next distinct value skips past the whole
// group, which is what golf ("T4"), the Olympics and the US News rankings all
// display. Two consequences, and both were the reason for choosing it:
//
//   • It cannot be set by a tiebreak the reader cannot see. The feeds order
//     ties by sats then guid so that paging is stable; that is a display order,
//     not a standing, and it must never decide which of two equal shows is 4th.
//   • It cannot inflate. Measured 2026-08-18: an episode with 2 boosts is
//     T#2274 because 2,273 episodes really are ahead of it.
//
// DENSE RANKING (1-2-2-3) WAS CONSIDERED AND REJECTED, which is worth recording
// because it is the intuitive choice and it is wrong here. There are only 31
// distinct boost counts across 6,422 episodes, so dense collapses the corpus
// into 31 places and that same 2-boost episode would print "#30" with 2,273
// episodes ahead of it. Dense is honest at the head and inflates the tail;
// ordinal is honest at the head and arbitrary within every tie.
//
// NO DENOMINATOR, EVER. Under any tie-aware scheme the count of places and the
// count of rows are different numbers, and neither is usable next to a rank:
// "of 811" reads as mid-table for a show with two boosts, since 51% of shows
// have two or fewer. The caption names the feed and links to it instead.
//
// ── WHICH LIST ───────────────────────────────────────────────────────────────
//
// "Rank" means the position the subject's card holds on the feed a reader can
// go and scroll, so the query restates that feed's definition rather than a
// plausible cousin of it:
//   • the FEED is chosen by the medium partition — a music show ranks among
//     Albums and every other show among Shows, an episode of a music feed among
//     Songs and every other among Episodes. The same
//     `COALESCE(medium,'podcast') <> 'music'` the API uses, so an unidentified
//     show ranks where its card actually is: on Shows.
//   • ALL TIME and ALL LANGUAGES: the precomputed aggregate columns, no window
//     and no `lang`. A rank on a filtered view would be true of a list most
//     readers of this page will never have on screen.
//   • Global, never Follows.
//
// COST. One scan of `podcasts` (~1.3k rows) or `episodes` (~6.7k rows, joined
// to `podcasts` for the medium) per render, inside the page's existing
// Promise.all and behind its 300s edge cache. Cheaper than the community
// rollup beside it, and cheaper than the ordinal version this replaced, which
// had to restate the feed's whole tiebreak to place a row inside its own tie.
//
// ⚠️ IT NEVER THROWS. A rank is decoration on a page about a show's boosts, so
// a failure costs the rank line and nothing else — the discipline the two
// podroll queries set. `feedRanks` resolves null on any error and the renderer
// prints tiles without a rank line, which is exactly what /booster renders.

// The three sorts, which are also the three stat tiles' keys.
const RANK_KEYS = ["sats", "boosts", "boosters"];

/**
 * The three all-time global ranks for a show or an episode.
 *
 * Resolves `{ sats:{rank,tied}, boosts:{…}, boosters:{…} }` or null; never
 * rejects. `tied` is true when at least one other row holds the same place.
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

    // ⚠️ Every subject value is COALESCEd to 0 exactly as the SQL side is. The
    // aggregate columns are nullable in principle, and a NULL on either side of
    // a comparison is NULL rather than false, which would silently drop the row
    // from both counts and report the subject as rank 1, untied.
    const val = {
      sats: Number(row.total_sats) || 0,
      boosts: Number(row.boost_count) || 0,
      boosters: Number(row.booster_count) || 0,
    };

    const cols = isEpisode
      ? { sats: "e.total_sats", boosts: "e.boost_count", boosters: "e.booster_count" }
      : { sats: "p.total_sats", boosts: "p.boost_count", boosters: "p.booster_count" };
    const from = isEpisode
      ? "FROM episodes e LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid"
      : "FROM podcasts p";
    const mediumCol = isEpisode ? "pc.medium" : "p.medium";

    // Two counts per stat off one scan: how many are strictly ahead, and how
    // many share the value (including the subject itself, so `at > 1` is the
    // tie test).
    const args = [];
    const parts = RANK_KEYS.map((k) => {
      args.push(val[k], val[k]);
      return `COUNT(CASE WHEN COALESCE(${cols[k]},0) > ? THEN 1 END) AS a_${k},
              COUNT(CASE WHEN COALESCE(${cols[k]},0) = ? THEN 1 END) AS t_${k}`;
    }).join(",\n             ");

    // The medium partition, restated from the API: `music` is Albums/Songs and
    // EVERYTHING else — podcasts, video, and shows the collector cannot
    // identify — is Shows/Episodes. Never `= 'podcast'`.
    const where = music
      ? `COALESCE(${mediumCol},'podcast') = 'music'`
      : `COALESCE(${mediumCol},'podcast') <> 'music'`;

    const r = await db.prepare(`SELECT ${parts} ${from} WHERE ${where}`).bind(...args).first();
    if (!r) return null;

    const out = {};
    for (const k of RANK_KEYS) {
      const ahead = Number(r[`a_${k}`]);
      const at = Number(r[`t_${k}`]);
      // `at` counts the subject, so 0 means the subject was not in the set the
      // WHERE admits — a medium mismatch between this query and the row we were
      // handed. Print nothing rather than a rank on a list it is not on.
      if (!Number.isFinite(ahead) || !Number.isFinite(at) || at < 1) return null;
      out[k] = { rank: ahead + 1, tied: at > 1 };
    }
    return out;
  } catch (err) {
    console.warn("[feed-rank] rank query failed", err);
    return null;
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const numFmt = (n) => Number(n).toLocaleString("en-US");

/** `#4`, or `T#118` when the place is shared. The T is golf's notation and is
 *  the most widely recognised tie marker there is; the caption defines it. */
function chip(r) {
  return `${r.tied ? "T" : ""}#${numFmt(r.rank)}`;
}

/**
 * The stat tiles with the rank folded into each: value, label, then the rank as
 * a third line. One tile per stat, in the order given; the rank is drawn only
 * where `ranks` resolved and the stat carries a `key` the ranks know, so a
 * failed query costs the third line and nothing else and /booster can pass null.
 *
 * ⚠️ THE CAPTION IS SHARED AND THE TILES ARE BARE. Three tiles cannot each
 * carry "rank on the Shows feed" without saying it three times, and a tooltip
 * cannot say it at all on a phone. One line under the row names the list once,
 * links to it, and — only when a T is actually on screen — defines the T.
 *
 * @param {{key?:string,label:string,value:string,exact:string}[]} stats
 * @param {object|null} ranks  from feedRanks
 * @param {{rankFeed:string, backHref:string}} copy
 */
export function renderStatTiles(stats, ranks, copy) {
  let anyRank = false;
  let anyTie = false;

  const tiles = stats.map((s) => {
    const r = ranks && s.key ? ranks[s.key] : null;
    let rankEl = "";
    if (r) {
      anyRank = true;
      if (r.tied) anyTie = true;
      const tip = r.tied
        ? `Tied for ${chip(r).slice(1)} by ${s.key} on the all-time ${copy.rankFeed} feed`
        : `${chip(r)} by ${s.key} on the all-time ${copy.rankFeed} feed`;
      rankEl = `<dd class="show-stat-rank" title="${esc(tip)}">${esc(chip(r))}</dd>`;
    }
    // ⚠️ THE MODIFIER IS WHAT RESERVES THE CHIP'S LINE. The rank is pinned to
    // the tile's top corner, so the tile has to open a gap for it — but only a
    // tile that HAS one, or /booster's rankless tiles would carry dead space
    // above the figure. A `:has()` rule would do it without the class and is
    // silently a no-op wherever :has() is unsupported, which is the one failure
    // mode here that shows as an overlapping number rather than a spacing nit.
    const cls = rankEl ? "show-stat show-stat--ranked" : "show-stat";
    return `<div class="${cls}"><dt>${esc(s.label)}</dt><dd title="${esc(s.exact)}">${esc(s.value)}</dd>${rankEl}</div>`;
  });

  const caption = anyRank
    ? `<p class="show-stats-cap">Rank on the all-time <a href="${esc(copy.backHref)}">${esc(copy.rankFeed)} feed</a>${anyTie ? "; T marks a tie" : ""}</p>`
    : "";

  return `<dl class="show-stats">
      ${tiles.join("\n      ")}
    </dl>${caption ? "\n    " + caption : ""}`;
}
