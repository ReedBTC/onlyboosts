/* The boosts, counted the way a show, an episode and a song are counted.
 *
 * A boost made while a song played inside a show (a <podcast:valueTimeSplit>
 * window) is credited to BOTH: the song for its share, the host episode for
 * the rest. The collector writes those two credits to `boost_credits`, one row
 * per side, and leaves the `boosts` row itself untouched (so `/api/v1/boosts`,
 * and Local Bitcoiners' bot reading it, see exactly what they saw before).
 * Reed's rule, 2026-11-23: the sats divide by the window's `remotePercentage`;
 * the boost and its booster count on both sides. An unknown percentage gives
 * the song the whole boost and the host 0 sats. The reasoning and the
 * measurements are in docs/data-pipeline.md, "Songs Played Inside An Episode"
 * and its "Reading The Credits At The Edge".
 *
 * `CREDITED` is a drop-in for `boosts` in any query that COUNTS BY SUBJECT
 * (a show, an episode, a song, an artist): `FROM ${CREDITED} b` yields one
 * row per counted side, carrying every `boosts` column under its own name,
 * with `podcast_guid`, `item_guid` and `sats` replaced by the credit's on a
 * credited boost. It is the collector's `db.credited_rows()`, so the edge's
 * windowed figures and the collector's precomputed all-time columns are one
 * definition.
 *
 * ⚠️ A QUERY ABOUT A PERSON STAYS ON `boosts`. A booster's own totals, the
 * member wall, the hours board, /stats and the app breakdown count each boost
 * once, at what the booster sent; reading this there would count a song boost
 * twice for the person who made it.
 *
 * ⚠️ COUNT A BOOST AS `COUNT(DISTINCT b.event_id)`, NEVER `COUNT(*)`. Both
 * sides of one boost can land on the same feed (a single listed under two
 * feed ids credits the side its `boosts` row already counted it under), and
 * a group over that feed would see the boost twice.
 *
 * Extra columns on every row:
 *   credit_role  'track' | 'host' | NULL (an ordinary boost)
 *   credit_pct   the song's share, 0-100, as the feed wrote it; NULL when
 *                unknown or when the boost is not split
 *   boost_sats   what the booster sent, whichever side this row is. A boost
 *                row on the page shows this figure; the totals add `sats`.
 *
 * Index use was checked with EXPLAIN QUERY PLAN against the D1 schema: an
 * outer `b.podcast_guid = ?`, `b.item_guid = ?` or `b.created_at >= ?` is
 * pushed into both arms of the UNION ALL, so the first arm keeps its boosts
 * index and the second reads idx_credits_* (or the whole credits table,
 * which is a few hundred rows). `CREDITED_BY_TIME` is the same thing with
 * the first arm pinned to idx_boosts_created, for the windowed GROUP BYs that
 * already name that index (see feed-rank.js for why they do). */

const COLS = (pg, ig, sats, role, pct) => `
    b.event_id, b.booster_pubkey, b.booster_npub, b.created_at,
    ${sats} AS sats, b.amount_source, ${pg} AS podcast_guid, ${ig} AS item_guid,
    b.item_url, b.client, b.client_id, b.client_via, b.message,
    ${role} AS credit_role, ${pct} AS credit_pct, b.sats AS boost_sats`;

function credited(indexed) {
  return `(
  SELECT ${COLS("b.podcast_guid", "b.item_guid", "b.sats", "NULL", "NULL")}
    FROM boosts b${indexed ? ` INDEXED BY ${indexed}` : ""}
   WHERE NOT EXISTS (SELECT 1 FROM boost_credits bc WHERE bc.event_id = b.event_id)
  UNION ALL
  SELECT ${COLS("c.podcast_guid", "c.item_guid", "c.sats", "c.role", "c.pct")}
    FROM boost_credits c
    JOIN boosts b ON b.event_id = c.event_id
)`;
}

export const CREDITED = credited(null);
export const CREDITED_BY_TIME = credited("idx_boosts_created");

/* A boost ROW on a page about a show, an episode or a song, read off
 * `${CREDITED} b`. `sats` is what the booster sent (the figure the row
 * prints and sorts on); `credit_sats` is this side's share; the `other_*`
 * columns name the other side, so the row can say where the rest went:
 * "During <song>" on the show's page, "Heard on <episode>" on the song's.
 * An ordinary boost has NULL in every one of them. Use with
 * CREDIT_ROW_JOINS after `FROM ${CREDITED} b`. */
export const CREDIT_ROW_COLS = `b.boost_sats AS sats, b.sats AS credit_sats,
         b.credit_role, b.credit_pct,
         oc.sats AS other_sats, oc.item_guid AS other_item, oc.podcast_guid AS other_guid,
         oe.title AS other_title, op.title AS other_show`;
export const CREDIT_ROW_JOINS = `
  LEFT JOIN boost_credits oc ON oc.event_id = b.event_id AND oc.role <> b.credit_role
  LEFT JOIN episodes oe ON oe.item_guid = oc.item_guid
  LEFT JOIN podcasts op ON op.podcast_guid = oc.podcast_guid`;
