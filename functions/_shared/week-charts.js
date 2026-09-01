// The OnlyBoosts Charts page's two query families, one per board shape:
//
//   weeklyChart(env, kind, ws, we)   the Top 10 for one Pacific calendar week —
//                                    the chart ladder (sort=chart's exact rule)
//                                    computed over the boosts in [ws, we).
//   weeksAtNumberOne(env, kind, before)
//                                    the companion board: which subjects have
//                                    finished #1 on that weekly chart the most
//                                    times, counted over COMPLETED weeks only.
//
// ⚠️ THE RANKING IS sort=chart AND NOTHING ELSE: rank in sats + rank in boosts
// + rank in boosters, lowest total first; ties break boosters → sats → boosts
// inside the RANK() window, the tuple standing (see "The OnlyBoosts Charts" in
// docs/feeds.md). The ladder here is the endpoints' ladder verbatim, applied to
// a bounded calendar-week window rather than a trailing range — the one shape
// the feed endpoints do not serve, which is why this module exists rather than
// the page fetching /api/v1/* with a range it cannot express.
//
// ⚠️ THE WEEK IS THE 40 HPW WEEK: Monday 00:00 US Pacific, from
// assets/js/pacific-week.js (JS side) and pacificOffsetSql out of the hours
// endpoint (SQL side). Nothing here restates the DST rule.
//
// ⚠️ WEEKS AT #1 COUNTS COMPLETED WEEKS ONLY (`b.created_at < before`, the live
// week's Monday). The live week's #1 can still change, so crediting it would
// hand out a week that might be taken back by Sunday; the weekly board above it
// is where the live race shows. A week whose #1 is a tie (rank 1, T#) credits
// every holder with the week — the standing genuinely is shared.
//
// The medium partition matches the feeds exactly: `music` to Albums/Songs,
// everything else (video and unidentified included) to Shows/Episodes, artists
// music-only server-side. Literal predicates rather than bound, the
// publishers.js precedent, so extracted-SQL tests keep their parameter shape.

import { WEEK, MONDAY_EPOCH, PST, pacificOffset } from "../../assets/js/pacific-week.js";
import { pacificOffsetSql } from "../api/v1/members/hours.js";
import { PUBLISHERS } from "../api/v1/_common.js";

export const KINDS = ["shows", "episodes", "artists", "albums", "songs"];

/* Back a SQL week bucket out to the real instant of its Monday 00:00 Pacific —
 * the JS twin of the expression the hours endpoint's all-time board uses. */
export function weekStartOfBucket(wk) {
  const wall = Number(wk) * WEEK + MONDAY_EPOCH;
  return wall - pacificOffset(wall - PST);
}

const MUSIC = (yes) => `COALESCE(pc.medium,'podcast') ${yes ? "=" : "<>"} 'music'`;

/* One shape per aggregation level. `select` are the display columns carried
 * through the ladder; `from`/`where` build the corpus; `key` is what a chart
 * row is. The GROUP BY key is `guid` in every level so the ladder above is one
 * string. `meta` re-joins display fields for the weeks-at-#1 outer SELECT,
 * where the inner grouping is (wk, guid) and carrying them through would work
 * but reads worse than one join at the end. */
const LEVELS = {
  show: (music) => ({
    key: "b.podcast_guid",
    select: `pc.title AS title, pc.image AS image, pc.artwork AS artwork, pc.author AS author,
             NULL AS p_title`,
    from: `FROM boosts b
           LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid`,
    where: [`b.podcast_guid IS NOT NULL`, MUSIC(music)],
    meta: {
      select: `pc.title AS title, pc.image AS image, pc.artwork AS artwork, pc.author AS author,
               NULL AS p_title`,
      join: `LEFT JOIN podcasts pc ON pc.podcast_guid = c.guid`,
    },
  }),
  episode: (music) => ({
    key: "b.item_guid",
    select: `e.title AS title, e.image AS image, pc.image AS p_image, pc.artwork AS artwork,
             NULL AS author, pc.title AS p_title`,
    from: `FROM boosts b
           LEFT JOIN episodes e  ON e.item_guid     = b.item_guid
           LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid`,
    where: [`b.item_guid IS NOT NULL`, MUSIC(music)],
    meta: {
      select: `e.title AS title, e.image AS image, pc.image AS p_image, pc.artwork AS artwork,
               NULL AS author, pc.title AS p_title`,
      join: `LEFT JOIN episodes e  ON e.item_guid     = c.guid
             LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid`,
    },
  }),
  /* The artist tier is music-only server-side (Reed's call, 2026-08-31) and a
   * card needs a title — both rules restated from /api/v1/publishers. */
  publisher: () => ({
    key: "pub.publisher_guid",
    select: `pub.title AS title, pub.image AS image, pub.artwork AS artwork,
             NULL AS author, NULL AS p_title`,
    from: `FROM publishers pub
           JOIN podcasts pc ON pc.publisher_guid = pub.publisher_guid
           JOIN boosts b    ON b.podcast_guid    = pc.podcast_guid`,
    where: [`pub.title IS NOT NULL`, MUSIC(true)],
    meta: {
      select: `pub.title AS title, pub.image AS image, pub.artwork AS artwork,
               NULL AS author, NULL AS p_title`,
      join: `JOIN publishers pub ON pub.publisher_guid = c.guid`,
    },
  }),
};

const KIND_LEVEL = {
  shows: () => LEVELS.show(false),
  albums: () => LEVELS.show(true),
  episodes: () => LEVELS.episode(false),
  songs: () => LEVELS.episode(true),
  artists: () => LEVELS.publisher(),
};

/* The sort=chart ladder, verbatim from the four endpoints. `part` is empty for
 * one week's chart and `PARTITION BY wk ` for the every-week form — the only
 * difference between the two. These aggregates are never NULL (COUNT /
 * COALESCE(SUM)), so no COALESCE, the publishers.js reading. */
function ladder(part) {
  return `
    scored AS (
      SELECT base.*,
             RANK() OVER (${part}ORDER BY total_sats DESC)    AS r_sats,
             RANK() OVER (${part}ORDER BY boost_count DESC)   AS r_boosts,
             RANK() OVER (${part}ORDER BY booster_count DESC) AS r_boosters
      FROM base
    ),
    chart AS (
      SELECT scored.*,
             (r_sats + r_boosts + r_boosters) AS score,
             RANK() OVER (${part}ORDER BY (r_sats + r_boosts + r_boosters),
                          booster_count DESC, total_sats DESC, boost_count DESC) AS rank
      FROM scored
    )`;
}

/** The Top `limit` of one calendar week's chart. `ws`/`we` are the week's
 *  bounds as unix seconds — [inclusive, exclusive), both required: a missing
 *  ceiling is the failure that looks like nothing (see the hours endpoint). */
export async function weeklyChart(env, kind, ws, we, limit = 10) {
  const L = KIND_LEVEL[kind]();
  const sql = `
    WITH base AS (
      SELECT ${L.key} AS guid,
             ${L.select},
             COUNT(*)                         AS boost_count,
             COALESCE(SUM(b.sats),0)          AS total_sats,
             COUNT(DISTINCT b.booster_pubkey) AS booster_count
      ${L.from}
      WHERE ${L.where.join(" AND ")}
        AND b.created_at >= ? AND b.created_at < ?
      GROUP BY ${L.key}
    ),${ladder("")},
    tied AS (SELECT chart.*,
                    COUNT(*) OVER (PARTITION BY rank)       AS peers,
                    /* Per-COMPONENT tie flags for the row's rank triplet.
                       RANK() hands equal ranks to equal values only, so
                       partitioning on the component rank counts exactly the
                       rows sharing that component's value — including ones
                       past the LIMIT, which is what makes a lone T honest. */
                    COUNT(*) OVER (PARTITION BY r_sats)     AS peers_sats,
                    COUNT(*) OVER (PARTITION BY r_boosts)   AS peers_boosts,
                    COUNT(*) OVER (PARTITION BY r_boosters) AS peers_boosters
             FROM chart)
    SELECT * FROM tied
    ORDER BY rank, guid
    LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(ws, we, limit).all();
  return results.map((r) => ({ ...r, tied: r.peers > 1 }));
}

/** Who has finished #1 the most weeks, over every completed week before
 *  `before` (the live week's Monday). One row per subject: `weeks`, and
 *  `last_week_start` — the real instant of the most recent #1 week's Monday,
 *  for the row's link to that week's page. */
export async function weeksAtNumberOne(env, kind, before, limit = 10) {
  const L = KIND_LEVEL[kind]();
  const wk = `(b.created_at + ${pacificOffsetSql("b.created_at")} - ${MONDAY_EPOCH}) / ${WEEK}`;
  const sql = `
    WITH base AS (
      SELECT ${L.key} AS guid,
             ${wk} AS wk,
             COUNT(*)                         AS boost_count,
             COALESCE(SUM(b.sats),0)          AS total_sats,
             COUNT(DISTINCT b.booster_pubkey) AS booster_count
      ${L.from}
      WHERE ${L.where.join(" AND ")}
        AND b.created_at < ?
      GROUP BY wk, ${L.key}
    ),${ladder("PARTITION BY wk ")},
    counts AS (
      SELECT guid, COUNT(*) AS weeks, MAX(wk) AS last_wk
      FROM chart WHERE rank = 1
      GROUP BY guid
    )
    SELECT c.guid, c.weeks, c.last_wk, ${L.meta.select}
    FROM counts c
    ${L.meta.join}
    ORDER BY c.weeks DESC, c.last_wk DESC, c.guid
    LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(before, limit).all();
  return results.map((r) => ({ ...r, last_week_start: weekStartOfBucket(r.last_wk) }));
}

/** The members companion: who has finished #1 on the weekly 40 HPW board the
 *  most completed weeks. NOT the chart ladder — the 40 HPW board ranks by
 *  HOURS, so its #1 is the hours leader, and this restates the hours
 *  endpoint's own corpus rules: dedupe (booster, episode) inside the week,
 *  episodes with a usable duration only, publisher keys excluded. A week
 *  whose hours lead is shared credits every holder, the content boards'
 *  reading. */
export async function hpwWeeksAtNumberOne(env, before, limit = 10) {
  const holes = PUBLISHERS.map(() => "?").join(",");
  const wk = `(b.created_at + ${pacificOffsetSql("b.created_at")} - ${MONDAY_EPOCH}) / ${WEEK}`;
  const sql = `
    WITH d AS (
      SELECT DISTINCT b.booster_pubkey AS pk, b.item_guid AS ig, ${wk} AS wk
      FROM boosts b
      WHERE b.item_guid IS NOT NULL
        AND b.booster_pubkey NOT IN (${holes})
        AND b.created_at < ?
    ),
    w AS (
      SELECT d.pk, d.wk, SUM(e.duration) AS secs
      FROM d
      JOIN episodes e ON e.item_guid = d.ig
      WHERE e.duration IS NOT NULL AND e.duration > 0
      GROUP BY d.pk, d.wk
    ),
    r AS (SELECT w.*, RANK() OVER (PARTITION BY wk ORDER BY secs DESC) AS rank FROM w),
    counts AS (
      SELECT pk, COUNT(*) AS weeks, MAX(wk) AS last_wk
      FROM r WHERE rank = 1
      GROUP BY pk
    )
    SELECT c.pk, c.weeks, c.last_wk,
           p.display_name AS dname, p.name AS name, p.picture AS pic,
           (SELECT b2.booster_npub FROM boosts b2
             WHERE b2.booster_pubkey = c.pk AND b2.booster_npub IS NOT NULL
             LIMIT 1) AS npub
    FROM counts c
    LEFT JOIN profiles p ON p.pubkey = c.pk
    ORDER BY c.weeks DESC, c.last_wk DESC, c.pk
    LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(...PUBLISHERS, before, limit).all();
  return results.map((r) => ({
    pk: r.pk,
    npub: r.npub || null,
    name: r.dname || r.name || null,
    pic: r.pic || null,
    weeks: r.weeks,
    last_week_start: weekStartOfBucket(r.last_wk),
  }));
}
