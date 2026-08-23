// GET /api/v1/members/hours?range=week|all — the 40 HPW boards.
//
// THE PREMISE, WHICH IS AN ASSUMPTION AND IS MEANT TO BE. If you boosted an
// episode, assume you listened to all of it, and add up the durations. It is
// not a measurement of listening and does not pretend to be; it is the most
// interesting thing this index can say about a person's week.
//
//   range=week  this week's board, Monday 00:00 UTC to now. Resets weekly.
//   range=all   the best weeks ever recorded, one row per booster-week.
//
// ⚠️ NOBODY CLEARS 40 HOURS, AND THE NAME IS THE PROVOCATION RATHER THAN A
// THRESHOLD. Measured over all 9,977 booster-weeks since 2024-10: exactly two
// cleared 40, both the same person, both in autumn 2025. Eighteen weeks ever
// passed 30. A typical winning week in mid-2026 is 14 to 20 hours. That is why
// `range=all` exists beside `range=week` — an all-time board alone is one
// nobody currently reading can get onto.
import { json, preflight, clampLimit } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

/* ⚠️ WEEKS START MONDAY 00:00 UTC, AND 345600 IS WHY THE ARITHMETIC WORKS.
 * Unix epoch 0 is a Thursday, so `ts / 604800` would bucket weeks Thursday to
 * Wednesday. 345600 is 1970-01-05, the first Monday after the epoch; shifting
 * by it puts every bucket boundary on a Monday midnight UTC. Integer division
 * in SQLite floors for positive operands, which every boost timestamp is. */
const WEEK = 604800;
const MONDAY_EPOCH = 345600;

/* ⚠️ A BOARD OF PEOPLE MUST NOT RANK A BOT, AND THESE FOUR ARE PUBLISHERS.
 * Each is a single key that signs boosts made by many different people:
 * chadf-boostbot alone carries 1,012 boosts from roughly 34 donors. The site's
 * standing rule is that the booster is the bot and never the donor — right for
 * attribution, and a category error on a leaderboard of listeners, where it
 * would sum thirty-four people's weeks into one row.
 *
 * ⚠️ IT IS A PUBKEY LIST AND NOT A `client_id` FILTER, deliberately. D1 does not
 * carry `client_src`, and `client_id = 'onlyboosts'` covers BOTH the bot-signed
 * path and every donor who boosted from this site — filtering on it would drop
 * real people. `localbitcoiners` is the same shape: its top three pubkeys are
 * three humans, not the show account. See "Who published a boost" in CLAUDE.md.
 * Verified against the live corpus: each of these is exactly one pubkey. */
const PUBLISHERS = [
  "f3bd42a91af5f3f1c40ca45ad2269464ab79996b32da78e8ed2ab91111b08e65", // chadf-boostbot
  "d35ae076512c29b01a5b33aa764ed4db44a9d0bbd96009705f48101f6cfe76a2", // lnaddress-music
  "c330881e28768381dd8bdfd274341dca0c5882c29b8642ea4bc82f7563264592", // Local Bitcoiners show account
  "3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9", // OnlyBoosts' own bot
];

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
           ${range === "all" ? `, (b.created_at - ${MONDAY_EPOCH}) / ${WEEK} AS wk` : ""}
      FROM boosts b
     WHERE b.item_guid IS NOT NULL
       AND b.booster_pubkey NOT IN (${holes})
       ${range === "week" ? "AND b.created_at >= ?" : ""}`;

  const group = range === "all" ? "d.pk, d.wk" : "d.pk";
  const sql = `
    WITH d AS (${base})
    SELECT d.pk                       AS pk,
           ${range === "all" ? `d.wk * ${WEEK} + ${MONDAY_EPOCH}` : "NULL"} AS week_start,
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

  const weekStart = Math.floor((Math.floor(Date.now() / 1000) - MONDAY_EPOCH) / WEEK) * WEEK + MONDAY_EPOCH;
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
