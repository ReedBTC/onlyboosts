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
//
// ⚠️ THE THIRD KEY DIFFERS BY SUBJECT AND THE TILES SAY WHY. A show or an
// episode's third figure is how many PEOPLE boosted it; a booster's is how many
// SHOWS they boosted. Both are the breadth axis of the list the subject is
// ranked on — `boosters` on Shows/Episodes, `shows` on the members wall — but
// they are different columns and different words, so one shared array would
// have quietly ranked a person by a column that does not exist for them.
const RANK_KEYS = ["sats", "boosts", "boosters"];
const BOOSTER_RANK_KEYS = ["sats", "boosts", "shows"];

/* The publisher aggregates in this file carry the artist tier's MUSIC-ONLY
 * filter (2026-08-31, Reed's call — see ../api/v1/publishers.js): a chip
 * claims a place on the Artists list, and that list counts only the declaring
 * music shows now, so the populations here must count the same corpus. */
/* ⚠️ RESTATED FROM functions/api/v1/_common.js, WHICH THIS FILE MAY NOT IMPORT
 * WITHOUT DRAGGING THE WHOLE API SURFACE IN. The members wall drops these four
 * keys from its listing, so a booster rank computed over a population that
 * INCLUDED them would be a rank on a list the reader cannot scroll: every
 * member below a publisher would be one place worse here than on the wall.
 * **The two copies must stay in step.** (chadf-boostbot came off both on
 * 2026-08-30; see the note on PUBLISHERS for why.) */
const RANK_PUBLISHERS = [
  "d35ae076512c29b01a5b33aa764ed4db44a9d0bbd96009705f48101f6cfe76a2",
  "c330881e28768381dd8bdfd274341dca0c5882c29b8642ea4bc82f7563264592",
  "3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9",
  "3820f4ff8587747530c7feafe47c1e592e3ce0fd2929b4f907e40714bd26f408",
];

/**
 * A booster's three all-time ranks on the members wall.
 *
 * ⚠️ THE POPULATION IS THE WALL'S, PUBLISHER EXCLUSION AND ALL. Rank means the
 * place the subject holds on a list a reader can go and scroll, and that list is
 * `/api/v1/members` with no `q` — every member, publishers dropped, ordered by
 * one of these three columns. The aggregates are restated here rather than
 * imported for the same reason the pubkey list is.
 *
 * ⚠️ A PUBLISHER'S OWN PAGE GETS NO CHIPS, AND IT FALLS OUT FOR FREE. The
 * subject is not in the CTE, so `at` is 0 and the shared guard below returns
 * null — the same guard that catches a medium mismatch. That is the honest
 * answer: those four keys are deliberately not on the wall, so they hold no
 * place on it, and printing one would contradict the section that says so.
 *
 * COST: one scan of `boosts` (~23k rows) grouped to ~2k, against ~1.3k for a
 * show. Heavier than its siblings and still inside the page's existing
 * Promise.all behind a 300s edge cache; and it never throws, so the worst case
 * is the page rendering exactly as it did before this existed.
 */
function boosterRankQuery(row) {
  const val = {
    sats: Number(row.sats) || 0,
    boosts: Number(row.boosts) || 0,
    shows: Number(row.shows) || 0,
  };
  const holes = RANK_PUBLISHERS.map(() => "?").join(",");
  const args = [...RANK_PUBLISHERS];
  const parts = BOOSTER_RANK_KEYS.map((k) => {
    args.push(val[k], val[k]);
    return `COUNT(CASE WHEN m.${k} > ? THEN 1 END) AS a_${k},
            COUNT(CASE WHEN m.${k} = ? THEN 1 END) AS t_${k}`;
  }).join(",\n           ");

  /* The CTE restates `/api/v1/members`'s aggregate exactly: SUM(sats),
     COUNT(*), COUNT(DISTINCT podcast_guid) — the last ignoring NULLs, so a
     boost naming no show is still a boost and is not a show. Same three
     definitions the subject's own totals are computed with one file over, which
     is what makes comparing them meaningful. */
  const sql = `
    WITH m AS (
      SELECT booster_pubkey AS pk,
             COALESCE(SUM(sats), 0)        AS sats,
             COUNT(*)                      AS boosts,
             COUNT(DISTINCT podcast_guid)  AS shows
        FROM boosts
       WHERE booster_pubkey NOT IN (${holes})
       GROUP BY booster_pubkey
    )
    SELECT ${parts} FROM m`;
  return { sql, args };
}

/**
 * A publisher's three all-time ranks on the Artists feed.
 *
 * The booster branch's shape one tier over: the CTE restates
 * `/api/v1/publishers`'s aggregate exactly — boosts joined through the
 * declaring shows, grouped by publisher, the title-less row excluded — so the
 * rank is a place on the list the reader can go and scroll. The third key is
 * `boosters`, the same breadth axis a show ranks by, because the Artists feed
 * offers exactly the show feeds' sorts.
 */
function publisherRankQuery(row) {
  const val = {
    sats: Number(row.sats) || 0,
    boosts: Number(row.boosts) || 0,
    boosters: Number(row.boosters) || 0,
  };
  const args = [];
  const parts = RANK_KEYS.map((k) => {
    args.push(val[k], val[k]);
    return `COUNT(CASE WHEN m.${k} > ? THEN 1 END) AS a_${k},
            COUNT(CASE WHEN m.${k} = ? THEN 1 END) AS t_${k}`;
  }).join(",\n           ");

  const sql = `
    WITH m AS (
      SELECT pc.publisher_guid,
             COALESCE(SUM(b.sats), 0)         AS sats,
             COUNT(*)                         AS boosts,
             COUNT(DISTINCT b.booster_pubkey) AS boosters
        FROM boosts b
        JOIN podcasts pc   ON pc.podcast_guid    = b.podcast_guid
        JOIN publishers pub ON pub.publisher_guid = pc.publisher_guid
       WHERE pub.title IS NOT NULL
         AND COALESCE(pc.medium,'podcast') = 'music'
       GROUP BY pc.publisher_guid
    )
    SELECT ${parts} FROM m`;
  return { sql, args };
}

/* ⚠️ THE ONLYBOOSTS CHARTS POSITION — rank in sats + rank in boosts + rank in
 * the subject's breadth key (boosters for content, shows boosted for a
 * member), summed, lowest total first; ties break breadth → sats → boosts and
 * a remaining tie is shared (T#). Reed's spec, 2026-08-31; the design record
 * is "The OnlyBoosts Charts" in docs/feeds.md.
 *
 * The population is the SAME list the three component chips are computed over
 * — the medium partition for a show or an episode, the wall's publisher
 * exclusion for a member, the title-less exclusion for a publisher — so the
 * chart place and the component ranks always describe one corpus. Global and
 * all languages always: the feedRanks doctrine at the top of this file.
 *
 * ⚠️ A `cutoff` (unix seconds) makes it one WINDOW's chart. The base becomes
 * the same boost-time GROUP BY the four endpoints run for a windowed
 * `sort=chart` (aggEpisodes in episodes.js, the `p.cutoff` branches of
 * podcasts.js and publishers.js, the members AGG join), so a cell on the
 * strip agrees with the windowed feed view it links to. No cutoff keeps the
 * precomputed all-time aggregates, which are cheaper and identical by
 * construction (d1_sync keeps them true). */
function chartQuery(kind, row, cutoff = null) {
  let base = null;
  let id = null;
  const args = [];
  if (kind === "booster") {
    if (!row?.pk) return null;
    id = row.pk;
    const holes = RANK_PUBLISHERS.map(() => "?").join(",");
    args.push(...RANK_PUBLISHERS);
    base = `
      SELECT booster_pubkey AS id,
             COALESCE(SUM(sats), 0)       AS m_sats,
             COUNT(*)                     AS m_boosts,
             COUNT(DISTINCT podcast_guid) AS m_breadth
        FROM boosts
       WHERE booster_pubkey NOT IN (${holes})${cutoff ? `
         AND created_at >= ?` : ""}
       GROUP BY booster_pubkey`;
    if (cutoff) args.push(cutoff);
  } else if (kind === "publisher") {
    if (!row?.guid) return null;
    id = row.guid;
    base = `
      SELECT pc.publisher_guid                AS id,
             COALESCE(SUM(b.sats), 0)         AS m_sats,
             COUNT(*)                         AS m_boosts,
             COUNT(DISTINCT b.booster_pubkey) AS m_breadth
        FROM boosts b
        JOIN podcasts pc    ON pc.podcast_guid    = b.podcast_guid
        JOIN publishers pub ON pub.publisher_guid = pc.publisher_guid
       WHERE pub.title IS NOT NULL
         AND COALESCE(pc.medium,'podcast') = 'music'${cutoff ? `
         AND b.created_at >= ?` : ""}
       GROUP BY pc.publisher_guid`;
    if (cutoff) args.push(cutoff);
  } else {
    const isEpisode = kind === "episode";
    id = isEpisode ? row.item_guid : row.podcast_guid;
    if (!id) return null;
    const music = (isEpisode ? row.p_medium : row.medium) === "music";
    // The medium partition, restated from the API: never `= 'podcast'`.
    const op = music ? "=" : "<>";
    if (cutoff) {
      /* Windowed: every figure is the window's own, recomputed over `boosts`
       * exactly as the endpoints' windowed GROUP BY recomputes it — the
       * precomputed columns are all-time totals and would rank the wrong
       * corpus. A subject with no boost in the window finds no row, which is
       * the honest null the dash cell renders. */
      const col = isEpisode ? "item_guid" : "podcast_guid";
      args.push(cutoff);
      base = `
      SELECT b.${col}                          AS id,
             COALESCE(SUM(b.sats),0)           AS m_sats,
             COUNT(*)                          AS m_boosts,
             COUNT(DISTINCT b.booster_pubkey)  AS m_breadth
        FROM boosts b
        LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
       WHERE b.${col} IS NOT NULL
         AND b.created_at >= ?
         AND COALESCE(pc.medium,'podcast') ${op} 'music'
       GROUP BY b.${col}`;
    } else base = isEpisode
      ? `
      SELECT e.item_guid                  AS id,
             COALESCE(e.total_sats,0)     AS m_sats,
             COALESCE(e.boost_count,0)    AS m_boosts,
             COALESCE(e.booster_count,0)  AS m_breadth
        FROM episodes e
        LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
       WHERE COALESCE(pc.medium,'podcast') ${op} 'music'`
      : `
      SELECT p.podcast_guid               AS id,
             COALESCE(p.total_sats,0)     AS m_sats,
             COALESCE(p.boost_count,0)    AS m_boosts,
             COALESCE(p.booster_count,0)  AS m_breadth
        FROM podcasts p
       WHERE COALESCE(p.medium,'podcast') ${op} 'music'`;
  }
  const sql = `
    WITH base AS (${base}),
         scored AS (
           SELECT base.*,
                  RANK() OVER (ORDER BY m_sats DESC)    AS r_sats,
                  RANK() OVER (ORDER BY m_boosts DESC)  AS r_boosts,
                  RANK() OVER (ORDER BY m_breadth DESC) AS r_breadth
           FROM base
         ),
         chart AS (
           SELECT id,
                  RANK() OVER (ORDER BY (r_sats + r_boosts + r_breadth),
                               m_breadth DESC, m_sats DESC, m_boosts DESC) AS rank
           FROM scored
         ),
         tied AS (
           SELECT chart.*, COUNT(*) OVER (PARTITION BY rank) AS peers FROM chart
         )
    SELECT rank, peers FROM tied WHERE id = ?`;
  args.push(id);
  return { sql, args };
}

/* Resolves { rank, tied } or null; its own catch, so a chart failure costs the
 * chart line and never the three component chips beside it. A subject outside
 * the population (a publisher key on /booster, a medium mismatch) simply finds
 * no row, which is the same honest silence ranksFrom keeps. */
async function chartPlace(db, kind, row, cutoff = null) {
  try {
    const q = chartQuery(kind, row, cutoff);
    if (!q) return null;
    const r = await db.prepare(q.sql).bind(...q.args).first();
    const rank = Number(r?.rank);
    if (!Number.isFinite(rank) || rank < 1) return null;
    return { rank, tied: Number(r.peers) > 1 };
  } catch (err) {
    console.warn("[feed-rank] chart query failed", err);
    return null;
  }
}

/* ⚠️ THE WINDOWS ARE THE FEED BAR'S RANGES and the keys are the hash's own
 * (`range=1w`), so a strip cell's link opens exactly the list it ranks on.
 * A new range in feed-controls.js RANGE_OPTIONS + the endpoints' RANGE_DAYS
 * wants a row here too, or the strip simply doesn't show it. */
const CHART_WINDOWS = [["1w", 7], ["1m", 30], ["1y", 365]];

/* The all-time place plus the three windowed ones, in parallel — each
 * chartPlace carries its own catch, so one failed window costs one dash and
 * never the strip. `chart` keeps its historical meaning (the all-time place)
 * because test-charts.mjs and this file's own callers read it. */
async function attachChart(db, kind, row, out) {
  const now = Math.floor(Date.now() / 1000);
  const [all, ...wins] = await Promise.all([
    chartPlace(db, kind, row),
    ...CHART_WINDOWS.map(([, days]) => chartPlace(db, kind, row, now - days * 86400)),
  ]);
  out.chart = all;
  out.chartWindows = { all };
  CHART_WINDOWS.forEach(([key], i) => { out.chartWindows[key] = wins[i]; });
}

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
    /* ⚠️ THE BOOSTER BRANCH SHARES THE TAIL DELIBERATELY. The ahead/at → rank
       conversion, the `at < 1` guard and the catch below are the parts that are
       easy to get subtly wrong; only the query and the key list differ. */
    if (kind === "booster") {
      if (!row || !row.pk) return null;
      const { sql, args } = boosterRankQuery(row);
      const r = await db.prepare(sql).bind(...args).first();
      const out = ranksFrom(r, BOOSTER_RANK_KEYS);
      if (out) await attachChart(db, kind, row, out);
      return out;
    }
    if (kind === "publisher") {
      if (!row || !row.guid) return null;
      const { sql, args } = publisherRankQuery(row);
      const r = await db.prepare(sql).bind(...args).first();
      const out = ranksFrom(r, RANK_KEYS);
      if (out) await attachChart(db, kind, row, out);
      return out;
    }
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
    const out = ranksFrom(r, RANK_KEYS);
    if (out) await attachChart(db, kind, row, out);
    return out;
  } catch (err) {
    console.warn("[feed-rank] rank query failed", err);
    return null;
  }
}

/* The two counts per stat → `{rank, tied}`, shared by every kind.
 *
 * ⚠️ `at` COUNTS THE SUBJECT, so 0 means the subject was not in the set the
 * query admits and the whole result is withheld. Three ways that happens, and
 * all three want silence rather than a number: a medium mismatch between this
 * query and the row we were handed, a booster whose key is one of the five the
 * wall excludes, and a subject with no rows at all. Printing a rank on a list
 * the subject is not on is worse than printing none. */
function ranksFrom(r, keys) {
  if (!r) return null;
  const out = {};
  for (const k of keys) {
    const ahead = Number(r[`a_${k}`]);
    const at = Number(r[`t_${k}`]);
    if (!Number.isFinite(ahead) || !Number.isFinite(at) || at < 1) return null;
    out[k] = { rank: ahead + 1, tied: at > 1 };
  }
  return out;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const numFmt = (n) => Number(n).toLocaleString("en-US");

/** `#4`, or `T#118` when the place is shared. The T is golf's notation and is
 *  the most widely recognised tie marker there is; the caption defines it. */
function chip(r) {
  return `${r.tied ? "T" : ""}#${numFmt(r.rank)}`;
}

/**
 * ⚠️ THE CHIP IS DRAWN ONLY INSIDE THE TOP 100. Reed's call, 2026-08-21,
 * reversing the "no cutoff" decision of 2026-08-18 — and the reasoning that
 * decision rested on still holds, which is why this is a display rule rather
 * than a change to `feedRanks`. **A competition rank is never false**, however
 * large; `T#2,274` is an honest statement about an episode with two boosts.
 *
 * What changed is what it is FOR. The chip sits in a stat tile's corner, which
 * is the sports-card idiom for a standing worth knowing — and 51% of shows have
 * two boosts or fewer, so on most pages it was labelling the long tail with a
 * number nobody would quote. A distinction printed on every page is not a
 * distinction; it is a row count wearing a medal.
 *
 * ⚠️ IT IS A BOUNDARY ON THE RANK, NOT ON THE TIE GROUP. A rank of exactly 100
 * prints even when it is `T#100` shared by fifty rows, because the rank is what
 * the reader is being told and it is correct. Nothing here re-derives standing.
 *
 * The rest falls out for free: `anyRank` stays false when nothing qualifies, so
 * the caption and the reserved chip line disappear with it and the page renders
 * exactly as `/booster` already does.
 */
const RANK_CUTOFF = 100;

/* The strip's four cells: window key (the hash's own `range` spelling), the
 * label on the cell, and the phrase its tooltips speak. The first three rows
 * restate CHART_WINDOWS above — the keys must match or a computed window
 * simply never renders. */
const CHART_CELLS = [
  ["1w", "Week", "this week"],
  ["1m", "Month", "this month"],
  ["1y", "Year", "this year"],
  ["all", "All time", "all time"],
];

/**
 * The stat tiles with the rank folded into each: value, label, then the rank as
 * a third line. One tile per stat, in the order given; the rank is drawn only
 * where `ranks` resolved and the stat carries a `key` the ranks know, so a
 * failed query costs the third line and nothing else and /booster can pass null.
 *
 * ⚠️ ONLY A TOP-100 RANK IS DRAWN — see RANK_CUTOFF. A page whose every stat
 * falls outside it renders bare tiles and no caption, which is the same output
 * /booster has always produced.
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
    if (r && r.rank <= RANK_CUTOFF) {
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

  /* ⚠️ THE CHARTS STRIP — the subject's OnlyBoosts Charts position in each of
   * the four boost-time windows (Week · Month · Year · All time), above the
   * tiles because the standing is the headline and the three tile ranks are
   * the all-time score's components. It replaced the single all-time line on
   * 2026-08-31 (Reed's pick, option A of the windows design pass — the
   * Billboard idiom: the current window is the news, the all-time standing is
   * the record, and the all-time cell wears the tint to say which is which).
   *
   * Each charted cell links to that window's chart view — the hash already
   * addresses it (`?sort=chart&range=1w`; the all-time cell elides the
   * default range). /booster overrides every target via `copy.chartHref`,
   * its chart living on the members wall rather than behind a sort key the
   * Members hash would drop. The label links to /about#charts, where the
   * formula is stated in full, and carries it as a tooltip too.
   *
   * The same top-100 gate as the chips applies PER WINDOW. A window past the
   * gate is an em-dash whose tooltip says which of two things the dash means
   * — outside the top 100, or no boosts in the window at all (chartPlace
   * resolves null when the subject has no row in the windowed corpus) — and
   * a dash cell is a <span>, not a link: sending a reader to a list the
   * subject is not on answers a question nobody asked. The whole strip is
   * withheld when no window charts, so most pages render exactly as before
   * the Charts existed. */
  const breadth = copy.chartBreadth || "boosters";
  const cw = ranks && (ranks.chartWindows || (ranks.chart ? { all: ranks.chart } : null));
  let chartStrip = "";
  if (cw && CHART_CELLS.some(([key]) => cw[key] && cw[key].rank <= RANK_CUTOFF)) {
    const labelTip = `Rank in sats + rank in boosts + rank in ${breadth}, summed — lowest total first, within each time window. Ties break by ${breadth}, then sats, then boosts; T marks a remaining tie.`;
    const cells = CHART_CELLS.map(([key, win, phrase]) => {
      const c = cw[key];
      const all = key === "all" ? " show-chart-cell--all" : "";
      const winEl = `<span class="show-chart-win">${win}</span>`;
      if (c && c.rank <= RANK_CUTOFF) {
        const href = copy.chartHref || `${copy.backHref}?sort=chart${key === "all" ? "" : `&range=${key}`}`;
        return `<a class="show-chart-cell${all}" href="${esc(href)}" title="${esc(`${chip(c)} on the OnlyBoosts Charts ${phrase}`)}">${winEl}<span class="show-chart-rank">${esc(chip(c))}</span></a>`;
      }
      const tip = c ? `Outside the top 100 ${phrase}` : `No boosts ${phrase}`;
      return `<span class="show-chart-cell show-chart-cell--none${all}" title="${esc(tip)}">${winEl}<span class="show-chart-rank">—</span></span>`;
    });
    chartStrip = `<nav class="show-chart" aria-label="OnlyBoosts Charts rank by time window">
      <a class="show-chart-label" href="/about#charts" title="${esc(labelTip)}">OnlyBoosts Charts</a>
      <div class="show-chart-strip">${cells.join("")}</div>
    </nav>`;
  }

  return `${chartStrip}${chartStrip ? "\n    " : ""}<dl class="show-stats">
      ${tiles.join("\n      ")}
    </dl>${caption ? "\n    " + caption : ""}`;
}
