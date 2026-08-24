// GET /api/v1/members/hours?range=week|all — the 40 HPW boards.
//
// THE PREMISE, WHICH IS AN ASSUMPTION AND IS MEANT TO BE. If you boosted an
// episode, assume you listened to all of it, and add up the durations. It is
// not a measurement of listening and does not pretend to be; it is the most
// interesting thing this index can say about a person's week.
//
//   range=week  this week's board, Monday 00:00 Pacific to now. Resets weekly.
//   range=all   the best weeks ever recorded, one row per booster-week.
//
// ⚠️ NOBODY CLEARS 40 HOURS, AND THE NAME IS THE PROVOCATION RATHER THAN A
// THRESHOLD. Measured over all 9,977 booster-weeks since 2024-10: exactly ONE
// clears 40 (Piez, 51.8h, week of 2025-09-22) and seventeen have ever passed 30.
// ⚠️ It was two and eighteen until the week boundary moved to midnight Pacific
// on 2026-08-23: the second 40h week was 41.6h only because the UTC line ran
// through a Sunday evening, and re-cut it is 39.8h. These figures move with the
// boundary, so re-measure them if the rule changes again.
// A typical winning week in mid-2026 is 14 to 20 hours. That is why
// `range=all` exists beside `range=week` — an all-time board alone is one
// nobody currently reading can get onto.
import { json, preflight, clampLimit, PUBLISHERS } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

/* ⚠️ WEEKS START MONDAY 00:00 US PACIFIC, AND 345600 IS WHY THE ARITHMETIC
 * WORKS. Unix epoch 0 is a Thursday, so `ts / 604800` would bucket weeks
 * Thursday to Wednesday. 345600 is 1970-01-05, the first Monday after the
 * epoch; shifting by it puts every bucket boundary on a Monday midnight.
 * Integer division in SQLite floors for positive operands, which every boost
 * timestamp is.
 *
 * ⚠️ IT WAS UTC UNTIL 2026-08-23, AND UTC IS THE WRONG MIDNIGHT FOR THIS
 * BOARD. Monday 00:00 UTC is Sunday 5pm on the US west coast and Sunday 8pm on
 * the east — Reed watched This Week reset on a Sunday evening, which is the
 * middle of the weekend for most of the people racing on it. Pacific is the
 * choice because it is the last US zone into Monday: at Monday 00:00 Pacific
 * every part of the United States is already on Monday, so nobody's board
 * resets while their Sunday is still running. Reed's call. */
const WEEK = 604800;
const MONDAY_EPOCH = 345600;
const PST = -8 * 3600;
const PDT = -7 * 3600;

/* ⚠️ THE DST RULE IS IMPLEMENTED TWICE, ONCE HERE AND ONCE IN SQL BELOW, AND
 * THE TWO MUST AGREE. They cannot share code: the weekly board needs one cutoff
 * computed before the query runs, and the all-time board needs a per-row bucket
 * computed inside it, over ten thousand booster-weeks. `test-members-hours.mjs`
 * pins them against each other at both transitions.
 *
 * ⚠️ AND IT IS ARITHMETIC RATHER THAN `Intl`, DELIBERATELY. The obvious version
 * asks `Intl.DateTimeFormat` for `America/Los_Angeles`, which is exact and
 * needs no rule of our own — but it puts a runtime ICU dependency on the
 * critical path of an endpoint, and there is no ICU at all on the SQL side, so
 * the two halves would be derived from different sources and could drift with a
 * tzdata update on one of them. The US rule has been fixed since 2007 (Energy
 * Policy Act of 2005) and the corpus begins in 2024, so the tail of history
 * this would get wrong does not exist.
 *
 * Second Sunday in March at 02:00 PST (10:00 UTC) through first Sunday in
 * November at 02:00 PDT (09:00 UTC). */
function nthSundayUTC(year, month, firstDom) {
  const d = Date.UTC(year, month - 1, firstDom);
  const dow = new Date(d).getUTCDay();          // 0 = Sunday
  return (d + ((7 - dow) % 7) * 86400000) / 1000;
}

function pacificOffset(tsSec) {
  const year = new Date(tsSec * 1000).getUTCFullYear();
  const dstStart = nthSundayUTC(year, 3, 8) + 10 * 3600;
  const dstEnd = nthSundayUTC(year, 11, 1) + 9 * 3600;
  return (tsSec >= dstStart && tsSec < dstEnd) ? PDT : PST;
}

/* The UTC instant of the Monday 00:00 Pacific that `tsSec` falls inside.
 *
 * ⚠️ TWO OFFSETS, NOT ONE, AND THE SECOND IS THE ONE THAT IS EASY TO MISS. The
 * first shifts `now` onto the Pacific wall clock so the Monday boundary can be
 * floored; the second is the offset in force at THAT MONDAY, which is not
 * always the offset in force now — the transition falls on a Sunday, the last
 * day of a Monday-anchored week, so during the changeover week the two differ
 * by an hour and reusing the first would move the board's cutoff.
 *
 * The `+ 8h` inside the second call resolves a wall-clock reading back to an
 * instant well away from any transition: transitions happen on a Sunday
 * morning UTC, roughly a day earlier, so either candidate offset lands the
 * probe on the same side of the rule. */
export function pacificWeekStart(tsSec) {
  const local = tsSec + pacificOffset(tsSec);
  const localMonday = Math.floor((local - MONDAY_EPOCH) / WEEK) * WEEK + MONDAY_EPOCH;
  return localMonday - pacificOffset(localMonday - PST);
}

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
function pacificOffsetSql(ts) {
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
       ${range === "week" ? "AND b.created_at >= ?" : ""}`;

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

  const weekStart = pacificWeekStart(Math.floor(Date.now() / 1000));
  /* Bound in the order they appear in the compiled statement: the CTE's
     publisher list and its cutoff come before the outer LIMIT. `week_start` is
     no longer bound at all — it is a literal in the `all` branch and rides the
     response envelope in the `week` one, so there is no pair of identical
     values whose order happened not to matter. */
  const args = range === "all"
    ? [...PUBLISHERS, limit]
    : [...PUBLISHERS, weekStart, limit];

  try {
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return json(request, {
      range,
      goal_hours: GOAL_HOURS,
      week_start: range === "week" ? weekStart : null,
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
    }, { cache: range === "all" ? 300 : 60 });
  } catch (err) {
    console.error("[hours] query failed", err);
    return json(request, { error: "query failed" }, { status: 500, cache: 0 });
  }
}
