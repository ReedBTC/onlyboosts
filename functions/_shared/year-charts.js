// The year boards behind /charts/<year> (2026-11-21, Reed's decisions of
// 2026-11-17/18): the Top 33 Songs, Artists, Podcasts and Boosters of the
// year, and the "<year> in Numbers" line above them.
//
// ⚠️ A CHART YEAR IS 52 PACIFIC CHART WEEKS, NOT A CALENDAR YEAR. 2026 runs
// from Monday 2025-12-29 00:00 to Monday 2026-12-28 00:00 US Pacific, the
// #40HPW week's boundaries (pacific-week.js), so the year's lists and its
// weekly boards cut the same boosts. A year is listed in YEARS or it has no
// page.
//
// ⚠️ THE RANKING IS sort=chart: songs, artists and podcasts are
// week-charts.js's weeklyChart over the year's bounds (the function takes any
// [ws, we) and was always generic); boosters are the Members wall's chart rule
// (rank in sats + boosts + shows, ties broken shows → sats → boosts), with
// the publisher keys excluded, the wall's own exclusion.
//
// ⚠️ THE LISTS ARE LIVE UNTIL THE YEAR CLOSES AND ARE NOT YET FROZEN. Rank
// sums are corpus-relative, so a published year list must be a snapshot
// (docs/feeds.md, the Charts section). Freezing the 2026 lists after the
// 2026-12-27 close is open work; until then this page recomputes, cached.

import { weekStartFromDate } from "../../assets/js/pacific-week.js";
import { weeklyChart } from "./week-charts.js";
import { PUBLISHERS } from "../api/v1/_common.js";

export const TOP_N = 33;

/** year → [first Monday, Monday after the last week), both "YYYY-MM-DD". */
const YEAR_WEEKS = { 2026: ["2025-12-29", "2026-12-28"] };

export const YEARS = Object.fromEntries(Object.entries(YEAR_WEEKS).map(([y, [a, b]]) =>
  [y, { start: weekStartFromDate(a), end: weekStartFromDate(b) }]));

/** The three figures for the year so far, in the site's order. */
async function yearNumbers(env, ys, ye) {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(sats),0) AS sats, COUNT(*) AS boosts, COUNT(DISTINCT booster_pubkey) AS boosters
       FROM boosts WHERE created_at >= ? AND created_at < ?`).bind(ys, ye).first();
  return { sats: Number(r?.sats || 0), boosts: Number(r?.boosts || 0), boosters: Number(r?.boosters || 0) };
}

/** The Top `limit` boosters over [ys, ye) on the Members chart rule. */
export async function yearBoosters(env, ys, ye, limit = TOP_N) {
  const holes = PUBLISHERS.map(() => "?").join(",");
  const sql = `
    WITH agg AS (
      SELECT b.booster_pubkey AS pk,
             MAX(b.booster_npub)            AS npub,
             COUNT(*)                       AS boosts,
             COALESCE(SUM(b.sats),0)        AS sats,
             COUNT(DISTINCT b.podcast_guid) AS shows,
             MAX(p.name) AS name, MAX(p.display_name) AS dname, MAX(p.picture) AS pic
      FROM boosts b
      LEFT JOIN profiles p ON p.pubkey = b.booster_pubkey
      WHERE b.created_at >= ? AND b.created_at < ?
        AND b.booster_pubkey NOT IN (${holes})
      GROUP BY b.booster_pubkey
    ),
    scored AS (
      SELECT agg.*,
             RANK() OVER (ORDER BY sats DESC)   AS r_sats,
             RANK() OVER (ORDER BY boosts DESC) AS r_boosts,
             RANK() OVER (ORDER BY shows DESC)  AS r_shows
      FROM agg
    ),
    chart AS (
      SELECT scored.*,
             (r_sats + r_boosts + r_shows) AS score,
             RANK() OVER (ORDER BY (r_sats + r_boosts + r_shows),
                          shows DESC, sats DESC, boosts DESC) AS rank
      FROM scored
    ),
    tied AS (
      SELECT chart.*,
             COUNT(*) OVER (PARTITION BY rank)     AS peers,
             COUNT(*) OVER (PARTITION BY r_sats)   AS peers_sats,
             COUNT(*) OVER (PARTITION BY r_boosts) AS peers_boosts,
             COUNT(*) OVER (PARTITION BY r_shows)  AS peers_shows
      FROM chart
    )
    SELECT * FROM tied ORDER BY rank, pk LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(ys, ye, ...PUBLISHERS, limit).all();
  return results.map((r) => ({ ...r, tied: r.peers > 1 }));
}

/** Everything the year page renders. `now` (unix seconds) clamps the window
 *  while the year is open; `through` is the instant the figures run to. */
export async function yearBoards(env, year, now) {
  const y = YEARS[year];
  if (!y) return null;
  const ye = Math.min(y.end, now);
  const [numbers, songs, artists, shows, boosters] = await Promise.all([
    yearNumbers(env, y.start, ye),
    weeklyChart(env, "songs", y.start, ye, TOP_N),
    weeklyChart(env, "artists", y.start, ye, TOP_N),
    weeklyChart(env, "shows", y.start, ye, TOP_N),
    yearBoosters(env, y.start, ye, TOP_N),
  ]);
  return { year: Number(year), start: y.start, end: y.end, through: ye, open: ye < y.end, numbers, songs, artists, shows, boosters };
}
