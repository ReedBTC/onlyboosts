// GET /api/v1/members/hours?range=week|all — the 40 HPW boards.
//
// THE PREMISE, WHICH IS AN ASSUMPTION AND IS MEANT TO BE. If you boosted an
// episode, assume you listened to all of it, and add up the durations. It is
// not a measurement of listening and does not pretend to be; it is the most
// interesting thing this index can say about a person's week.
//
//   range=week            this week's board, Monday 00:00 Pacific to now.
//   range=week&week=DATE  the board for the week containing that calendar day.
//   range=all             the best weeks ever recorded, one row per booster-week.
//
// ⚠️ `week=` MADE THE WEEKLY QUERY A BOUNDED WINDOW, WHICH IT HAD NEVER BEEN.
// Until the picker shipped on 2026-08-24 the live week needed only a floor —
// nothing has a timestamp in the future — so there was no upper bound to get
// wrong. A past week needs both, and a missing ceiling is the failure that
// looks like nothing: every week would return the whole board since that
// Monday, ranked plausibly, with the requested Monday printed above it.
//
// ⚠️ ALMOST NOBODY CLEARS 40 HOURS, AND THE NAME IS THE PROVOCATION RATHER
// THAN A THRESHOLD. Re-measured against production 2026-08-24: TWO booster-weeks
// clear 40 (Piez, 54.7h week of 2025-09-22, and Piez again, 40.2h week of
// 2026-03-02) and nineteen have ever passed 30. Six of the top ten are from 2025.
// ⚠️ THESE FIGURES ONLY EVER GO UP, AND NOT BECAUSE OF ANYTHING IN THIS FILE.
// They were 51.8h / one / seventeen the day before, and the second 40h week
// arrived with the collector's DERIVED durations: every duration-less episode
// that gains one adds hours to some PAST week, with no line of board code
// touched. Re-measure after any change to the week rule AND after any change to
// duration coverage. If a third week ever clears 40 the board's framing wants
// revisiting rather than the number.
// A typical winning week in mid-2026 is 14 to 20 hours. That is why
// `range=all` exists beside `range=week` — an all-time board alone is one
// nobody currently reading can get onto.
import { json, preflight, clampLimit, PUBLISHERS } from "../_common.js";
/* ⚠️ THE WEEK RULE IS A TWO-SIDED MODULE NOW, imported here by relative path
 * (esbuild inlines it off the filesystem) and by the browser as
 * `/assets/js/pacific-week.js?v=<VERSION>`. It lived in this file until the
 * week picker shipped on 2026-08-24 and needed to step and enumerate weeks in
 * the client; the alternative was a second copy of the DST rule over there,
 * which is exactly the drift `pacificOffsetSql` below is already tested
 * against. `pacificWeekStart` is re-exported because the test imports it from
 * here and because this endpoint is still where the rule is USED. */
import {
  WEEK, MONDAY_EPOCH, PST, PDT, pacificWeekStart, weekStartFromDate, nextWeek,
} from "../../../../assets/js/pacific-week.js";

export { pacificWeekStart };

export async function onRequestOptions({ request }) { return preflight(request); }

/* The JS half of the week rule (`pacificWeekStart`, the DST offsets, and the
 * `345600` Monday epoch) is in `assets/js/pacific-week.js`, imported above. Its
 * SQL twin is immediately below, and `scripts/test-members-hours.mjs` is what
 * holds the two against each other at every transition. */

/* The same rule as a SQL expression, for the all-time board's per-row buckets.
 *
 * `date('YYYY-03-08','weekday 0')` is the second Sunday in March: March 8 is
 * the earliest that Sunday can fall, and `weekday 0` advances to the next
 * Sunday (staying put if it already is one). `date('YYYY-11-01','weekday 0')`
 * is the first Sunday in November on the same reasoning.
 *
 * ⚠️ `strftime('%s', …)` RETURNS TEXT, AND SQLITE COMPARES TEXT AS GREATER THAN
 * ANY INTEGER. Without the CAST every comparison below is false, every row
 * takes the PST branch, and the board is quietly an hour out for eight months
 * of every year — which looks like nothing at all. */
/* Exported since the OnlyBoosts Charts page (functions/charts/[[path]].js):
 * its weeks-at-#1 boards bucket boosts by the same Pacific week in SQL, and a
 * third copy of the DST rule is exactly the drift the note above warns about.
 * `functions/_shared/week-charts.js` is the importer. */
export function pacificOffsetSql(ts) {
  const dst = (fmt, hour) =>
    `CAST(strftime('%s', date(strftime('${fmt}', ${ts}, 'unixepoch'), 'weekday 0')` +
    ` || ' ${hour}:00:00') AS INTEGER)`;
  return `(CASE WHEN ${ts} >= ${dst('%Y-03-08', '10')}` +
         ` AND ${ts} < ${dst('%Y-11-01', '09')} THEN ${PDT} ELSE ${PST} END)`;
}

// PUBLISHERS moved to ../_common.js — the member listing needs the same list.


// The line a row has to cross to be marked. It is not a filter — a board that
// showed only rows above it would be empty most weeks.
export const GOAL_HOURS = 40;

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const range = u.searchParams.get("range") === "all" ? "all" : "week";
  const limit = clampLimit(u.searchParams.get("limit"), 10, 50);
  const week = u.searchParams.get("week");
  try {
    const { body, cache } = await hoursBoard(env, { range, week, limit });
    return json(request, body, { cache });
  } catch (err) {
    console.error("[hours] query failed", err);
    return json(request, { error: "query failed" }, { status: 500, cache: 0 });
  }
}

/* The board itself, apart from the HTTP around it. Exported so the
 * edge-rendered `/hpw/<week>` pages (functions/hpw/[[path]].js) can render the
 * same envelope the tab fetches, from the same query, rather than fetching
 * this endpoint over the network from inside another Function or carrying a
 * second copy of the SQL. `range` is "week" | "all"; `week` is the raw
 * `week=` string or null; `limit` is already clamped. Resolves to
 * `{ body, cache }` — the JSON envelope and the max-age it should carry — and
 * REJECTS on a query failure, which the handler above turns into a 500.
 *
 * `scripts/test-members-hours.mjs` runs the handler, so everything in here is
 * still under it. */
export async function hoursBoard(env, { range = "week", week = null, limit = 10 } = {}) {

  const holes = PUBLISHERS.map(() => "?").join(",");

  /* ⚠️ DEDUPE (booster, episode) INSIDE THE WEEK, WHICH IS WHAT `DISTINCT` IS
   * DOING HERE. Boosting the same episode five times is one listen, not five,
   * and it is common: deduping removes 8.9% of qualifying rows and one pair
   * carried fifteen boosts. Without it the board measures generosity, which is
   * what the sats totals already measure.
   *
   * `item_guid IS NOT NULL` drops show-level boosts, which name no episode and
   * so have no duration — 8% of the corpus. `duration > 0` drops the 2.5% of
   * episodes Podcast Index has no duration for. Together they mean about 14% of
   * boosts contribute nothing, which is stated on the page rather than hidden. */
  const base = `
    SELECT DISTINCT b.booster_pubkey AS pk, b.item_guid AS ig
           ${range === "all"
             ? `, (b.created_at + ${pacificOffsetSql("b.created_at")} - ${MONDAY_EPOCH}) / ${WEEK} AS wk`
             : ""}
      FROM boosts b
     WHERE b.item_guid IS NOT NULL
       AND b.booster_pubkey NOT IN (${holes})
       ${range === "week" ? "AND b.created_at >= ? AND b.created_at < ?" : ""}`;

  const group = range === "all" ? "d.pk, d.wk" : "d.pk";
  const sql = `
    WITH d AS (${base})
    SELECT d.pk                       AS pk,
           /* Back out to a real instant: the bucket is Pacific wall-clock
              seconds, so subtract the offset in force at that Monday. Probed
              8h later for the reason given over pacificWeekStart. Pacific is
              behind UTC, so Monday 00:00 Pacific is always still Monday in UTC
              and the client's UTC date formatter prints the right day. */
           ${range === "all"
             ? `(d.wk * ${WEEK} + ${MONDAY_EPOCH}) - ${pacificOffsetSql(`(d.wk * ${WEEK} + ${MONDAY_EPOCH} - ${PST})`)}`
             : "NULL"} AS week_start,
           SUM(e.duration)            AS secs,
           COUNT(*)                   AS episodes,
           MAX(p.display_name)        AS dname,
           MAX(p.name)                AS name,
           MAX(p.picture)             AS pic,
           /* ⚠️ A CORRELATED SUBQUERY, NOT A JOIN. Joining boosts a second
              time on booster_pubkey reads correctly and multiplies every row by
              that member's entire boost count -- so COUNT(*) stops being
              episodes and SUM(e.duration) stops being hours, both inflated by
              the same factor and both still plausible-looking. This returns one
              value per output row and rides idx_boosts_booster.
              No backticks in here: the whole statement is a template literal,
              and CLAUDE.md records that node --check does not catch one. */
           (SELECT b2.booster_npub FROM boosts b2
             WHERE b2.booster_pubkey = d.pk AND b2.booster_npub IS NOT NULL
             LIMIT 1)                 AS npub
      FROM d
      JOIN episodes e ON e.item_guid = d.ig
      LEFT JOIN profiles p ON p.pubkey = d.pk
     WHERE e.duration IS NOT NULL AND e.duration > 0
     GROUP BY ${group}
     ORDER BY secs DESC, episodes ASC, d.pk
     LIMIT ?`;

  const liveWeek = pacificWeekStart(Math.floor(Date.now() / 1000));
  /* ⚠️ AN UNPARSEABLE OR FUTURE `week=` RESOLVES TO THE LIVE WEEK RATHER THAN
     400ing, AND THE ENVELOPE IS WHAT KEEPS THAT HONEST. These weeks travel in
     links, so the caller is often a reader rather than code, and a board that
     answers with the current week while SAYING it is the current week is a
     better failure than an error page. The client renders `week_start` off the
     response and never off what it asked for, so the two cannot disagree.

     There is deliberately NO floor. A week before the index begins returns an
     empty board, which is the true answer; `first_week` below is what lets the
     picker stop offering them rather than a clamp pretending they are this
     week. */
  const asked = weekStartFromDate(week);
  const weekStart = (asked === null || asked > liveWeek) ? liveWeek : asked;
  const isCurrent = weekStart === liveWeek;
  /* The exclusive ceiling, stepped by the week rule rather than by `+ WEEK`: a
     Pacific week containing a DST transition is 167 or 169 hours of real time,
     so a flat 604800 leaks or drops an hour of boosts twice a year. */
  const weekEnd = nextWeek(weekStart);

  /* Bound in the order they appear in the compiled statement: the CTE's
     publisher list and its window come before the outer LIMIT. */
  const args = range === "all"
    ? [...PUBLISHERS, limit]
    : [...PUBLISHERS, weekStart, weekEnd, limit];

  /* The oldest boost in the index, so the picker knows where to stop stepping
     back. One seek to the end of idx_boosts_created, run alongside the board
     rather than before it, and ALLOWED TO FAIL QUIETLY: it bounds a control,
     where the board is the thing the reader came for. A null answer costs the
     picker its menu and its disabled arrow, not the board. */
  const firstWeekQuery = range === "week"
    ? env.DB.prepare("SELECT MIN(created_at) AS t FROM boosts").first()
        .then((r) => (r && r.t ? pacificWeekStart(r.t) : null))
        .catch(() => null)
    : Promise.resolve(null);

  const [{ results }, firstWeek] = await Promise.all([
    env.DB.prepare(sql).bind(...args).all(),
    firstWeekQuery,
  ]);
  return {
    cache: range === "week" && isCurrent ? 60 : 300,
    body: {
      range,
      goal_hours: GOAL_HOURS,
      week_start: range === "week" ? weekStart : null,
      // The exclusive end, and the live week, so a client can label a board
      // "This Week" without having to re-derive the boundary it is standing on.
      week_end: range === "week" ? weekEnd : null,
      is_current: range === "week" ? isCurrent : null,
      current_week: range === "week" ? liveWeek : null,
      first_week: firstWeek,
      count: results.length,
      members: results.map((r) => ({
        pk: r.pk,
        npub: r.npub || null,
        name: r.dname || r.name || null,
        pic: r.pic || null,
        // Seconds, not hours: the caller formats. A rounded hour figure here
        // would make two rows an hour apart look identical.
        seconds: r.secs,
        episodes: r.episodes,
        // Null on the weekly board, where the envelope carries the one week.
        week_start: r.week_start ?? null,
      })),
    },
  };
}
/* ⚠️ A PAST WEEK IS NOT THE LIVE ONE AND MUST NOT SHARE ITS 60s CACHE (the
   `cache` above). The live board changes as boosts land, which is what the
   short life buys; a closed week only moves when the collector fills in a
   missing episode duration, so it takes the all-time board's 300s. */
