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

import { weekStartFromDate, nextWeek, pacificOffset, WEEK, MONDAY_EPOCH } from "../../assets/js/pacific-week.js";
import { weeklyChart } from "./week-charts.js";
import { CREDITED } from "./credited.js";
import { PUBLISHERS } from "../api/v1/_common.js";
import { pacificOffsetSql, GOAL_HOURS } from "../api/v1/members/hours.js";

export const TOP_N = 33;

/** year → [first Monday, Monday after the last week), both "YYYY-MM-DD". */
const YEAR_WEEKS = { 2026: ["2025-12-29", "2026-12-28"] };

export const YEARS = Object.fromEntries(Object.entries(YEAR_WEEKS).map(([y, [a, b]]) =>
  [y, { start: weekStartFromDate(a), end: weekStartFromDate(b) }]));

/* ⚠️ A CLIENT IS A PLACE WITH AN INTERFACE A PERSON BOOSTS FROM (Reed's rule,
 * 2026-11-21): a website or an app. Local Bitcoiners, OnlyBoosts,
 * BoostMeBitch, BoostMeBuddy and Bullish Boosts count; a boost bot that
 * republishes someone else's boosts (ChadF Boost Bot, Boostr Bot, MSP Bot,
 * CandR Boost Bot, BoostAfterBoost, v4vmusic.com's relay bot) does not, and
 * neither does a boost nobody can attribute. Fountain is its own series. An
 * ALLOWLIST, so a slug nobody has classified yet stays out until it is
 * added here. lnaddress-music is out pending Reed's word: 31 boosts, all
 * zero sats, one key. Bowl After Bowl's own site counts; its bot is
 * BoostAfterBoost. */
export const APP_CLIENTS = [
  "localbitcoiners", "onlyboosts", "boostmebitch", "boostmebuddy", "bullishboosts",
  "bowlafterbowl", "stablekraft", "pv4v", "nostrwall", "helipad", "candr-space",
];

const WK = (col) => `((${col} + ${pacificOffsetSql(col)} - ${MONDAY_EPOCH}) / ${WEEK})`;
const bucketOf = (ws) => Math.floor((ws + pacificOffset(ws) - MONDAY_EPOCH) / WEEK);

/** The figures and series the year page draws, beyond the boards:
 *  - months: every Pacific calendar month of the index up to `ye` (the whole
 *    site's history, so the year is read against the one before it);
 *  - weeks: the year's chart weeks, boosts, other-app boosts and #40HPW
 *    finishers per week;
 *  - apps: the year's boosts by client, Fountain and the APP_CLIENTS;
 *  - facts: the stat cards' single figures. */
export async function yearStats(env, ys, ye) {
  const apps = APP_CLIENTS.map(() => "?").join(",");
  const holes = PUBLISHERS.map(() => "?").join(",");
  const monthsQ = env.DB.prepare(
    `SELECT strftime('%Y-%m', created_at + ${pacificOffsetSql("created_at")}, 'unixepoch') AS m,
            COUNT(*) AS boosts, COALESCE(SUM(sats),0) AS sats,
            COUNT(DISTINCT booster_pubkey) AS boosters,
            SUM(CASE WHEN client_id = 'fountain' THEN 1 ELSE 0 END) AS fountain,
            SUM(CASE WHEN client_id IN (${apps}) THEN 1 ELSE 0 END) AS apps
       FROM boosts WHERE created_at < ?
      GROUP BY m ORDER BY m`).bind(...APP_CLIENTS, ye).all();
  const weeksQ = env.DB.prepare(
    `SELECT ${WK("created_at")} AS wk, COUNT(*) AS boosts, COALESCE(SUM(sats),0) AS sats,
            SUM(CASE WHEN client_id IN (${apps}) THEN 1 ELSE 0 END) AS apps
       FROM boosts WHERE created_at >= ? AND created_at < ? GROUP BY wk`).bind(...APP_CLIENTS, ys, ye).all();
  const clientsQ = env.DB.prepare(
    `SELECT COALESCE(client_id,'') AS slug, COUNT(*) AS boosts, COALESCE(SUM(sats),0) AS sats,
            COUNT(DISTINCT booster_pubkey) AS boosters
       FROM boosts WHERE created_at >= ? AND created_at < ? GROUP BY slug`).bind(ys, ye).all();
  /* The #40HPW finishers per week: hours.js's own rules (dedupe a member's
   * episode inside the week, a usable duration only, publisher keys out) and
   * its entry test, >= GOAL_HOURS. */
  const hpwQ = env.DB.prepare(
    `WITH d AS (
       SELECT DISTINCT b.booster_pubkey AS pk, b.item_guid AS ig, ${WK("b.created_at")} AS wk
         FROM boosts b
        WHERE b.item_guid IS NOT NULL AND b.booster_pubkey NOT IN (${holes})
          AND b.created_at >= ? AND b.created_at < ?)
     SELECT d.pk AS pk, d.wk AS wk
       FROM d JOIN episodes e ON e.item_guid = d.ig
      WHERE e.duration IS NOT NULL AND e.duration > 0
      GROUP BY d.pk, d.wk
     HAVING SUM(e.duration) >= ?`).bind(...PUBLISHERS, ys, ye, GOAL_HOURS * 3600).all();
  /* The medium split is a partition: music to songs, everything else
   * (unidentified included) to podcasts. */
  const reachQ = env.DB.prepare(
    `SELECT COUNT(DISTINCT CASE WHEN COALESCE(pc.medium,'podcast') <> 'music' THEN b.podcast_guid END) AS podcasts,
            COUNT(DISTINCT CASE WHEN COALESCE(pc.medium,'podcast') = 'music' THEN b.item_guid END) AS songs,
            COUNT(DISTINCT CASE WHEN COALESCE(pc.medium,'podcast') = 'music' THEN pc.publisher_guid END) AS artists
       FROM ${CREDITED} b LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
      WHERE b.created_at >= ? AND b.created_at < ?`).bind(ys, ye).first();
  const newQ = env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT booster_pubkey, MIN(created_at) AS f FROM boosts GROUP BY booster_pubkey)
      WHERE f >= ? AND f < ?`).bind(ys, ye).first();

  const [months, weeks, clients, hpw, reach, fresh] = await Promise.all([monthsQ, weeksQ, clientsQ, hpwQ, reachQ, newQ]);

  const byWk = new Map(weeks.results.map((r) => [Number(r.wk), r]));
  const hpwByWk = new Map();
  const finishers = new Set();
  for (const r of hpw.results) {
    hpwByWk.set(Number(r.wk), (hpwByWk.get(Number(r.wk)) || 0) + 1);
    finishers.add(r.pk);
  }
  const series = [];
  const slotOf = new Map();
  for (let w = ys; w < ye; w = nextWeek(w)) {
    const k = bucketOf(w), r = byWk.get(k);
    slotOf.set(k, series.length);
    series.push({ start: w, boosts: Number(r?.boosts || 0), sats: Number(r?.sats || 0), apps: Number(r?.apps || 0), hpw: hpwByWk.get(k) || 0 });
  }

  /* Who finished, and which weeks (Reed, 2026-11-22): one row per member,
   * most forty-hour weeks first, then the most recent finish. The names and
   * faces are one more read, bound to at most 90 keys (D1's 100-parameter
   * ceiling); a failure costs the faces, never the list. */
  const byPk = new Map();
  for (const r of hpw.results) {
    const slot = slotOf.get(Number(r.wk));
    if (slot === undefined) continue;
    if (!byPk.has(r.pk)) byPk.set(r.pk, { pk: r.pk, weeks: [] });
    byPk.get(r.pk).weeks.push(slot);
  }
  const finisherRows = [...byPk.values()]
    .map((m) => ({ ...m, weeks: m.weeks.sort((a, b) => a - b) }))
    .sort((a, b) => b.weeks.length - a.weeks.length || b.weeks[b.weeks.length - 1] - a.weeks[a.weeks.length - 1] || a.pk.localeCompare(b.pk))
    .slice(0, 90);
  if (finisherRows.length) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT b.booster_pubkey AS pk, MAX(b.booster_npub) AS npub,
                MAX(p.name) AS name, MAX(p.display_name) AS dname, MAX(p.picture) AS pic
           FROM boosts b LEFT JOIN profiles p ON p.pubkey = b.booster_pubkey
          WHERE b.booster_pubkey IN (${finisherRows.map(() => "?").join(",")})
            AND b.created_at >= ? AND b.created_at < ?
          GROUP BY b.booster_pubkey`).bind(...finisherRows.map((m) => m.pk), ys, ye).all();
      const prof = new Map(results.map((r) => [r.pk, r]));
      for (const m of finisherRows) Object.assign(m, prof.get(m.pk) || {});
    } catch (err) {
      console.warn("[year-charts] finisher profiles failed", err);
    }
  }

  const appSet = new Set(APP_CLIENTS);
  let fountain = 0, appBoosts = 0, total = 0;
  const appRows = [];
  for (const c of clients.results) {
    const n = Number(c.boosts || 0);
    total += n;
    if (c.slug === "fountain") fountain = n;
    else if (appSet.has(c.slug)) { appBoosts += n; appRows.push({ slug: c.slug, boosts: n, sats: Number(c.sats || 0), boosters: Number(c.boosters || 0) }); }
  }
  appRows.sort((a, b) => b.boosts - a.boosts || b.sats - a.sats || a.slug.localeCompare(b.slug));

  return {
    months: months.results.map((r) => ({
      month: r.m, boosts: Number(r.boosts), sats: Number(r.sats), boosters: Number(r.boosters),
      fountain: Number(r.fountain || 0), apps: Number(r.apps || 0),
    })),
    weeks: series,
    apps: { total, fountain, other: appBoosts, rows: appRows },
    hpw: { members: finishers.size, weeks: hpw.results.length, finishers: finisherRows },
    reach: { podcasts: Number(reach?.podcasts || 0), songs: Number(reach?.songs || 0), artists: Number(reach?.artists || 0) },
    newBoosters: Number(fresh?.n || 0),
  };
}

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
  const [numbers, songs, artists, shows, boosters, stats] = await Promise.all([
    yearNumbers(env, y.start, ye),
    weeklyChart(env, "songs", y.start, ye, TOP_N),
    weeklyChart(env, "artists", y.start, ye, TOP_N),
    weeklyChart(env, "shows", y.start, ye, TOP_N),
    yearBoosters(env, y.start, ye, TOP_N),
    /* The figures and graphs fail alone: a page with its boards and no
       graphs is better than no page. */
    yearStats(env, y.start, ye).catch((err) => { console.error("[year] stats failed", err); return null; }),
  ]);
  return { year: Number(year), start: y.start, end: y.end, through: ye, open: ye < y.end, numbers, songs, artists, shows, boosters, stats };
}
