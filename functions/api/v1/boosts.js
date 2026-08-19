// GET /api/v1/boosts — the boost feed, filterable + cursor-paginated (newest first).
// Query params: id=<event id> podcast=<guid> item=<guid> booster=<npub|hex>
//               since= until= cursor= limit=
import { json, preflight, BOOST_SELECT, boostRecord, toHexPubkey,
         encodeCursor, decodeCursor, clampLimit } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const limit = clampLimit(u.searchParams.get("limit"));
  const where = [];
  const args = [];

  /* `id` is an exact lookup on the note's event id, and it exists to answer one
   * question for another publisher: IS THIS NOTE ALREADY INDEXED? Local
   * Bitcoiners' bot publishes a boost note on the show's behalf only when the
   * donor's app published none, and it asks here first. Its previous check was a
   * fuzzy amount-and-identity match over a `podcast=…&since=…` page; an event id
   * makes it exact, so a note the index already holds cannot be published twice.
   *
   * ⚠️ A MISS IS `200` WITH AN EMPTY LIST, NOT A `404`. "Not indexed" is the
   * answer the caller acts on, so it has to arrive as data rather than as an
   * error a client might retry or treat as an outage.
   *
   * Validated as 64 hex on shape alone — a nostr event id is a sha256 and
   * nothing else, and `event_id` is the table's primary key, so a well-formed
   * id that is not ours costs one index probe.
   */
  const id = (u.searchParams.get("id") || "").trim().toLowerCase();
  if (id) {
    if (!/^[0-9a-f]{64}$/.test(id)) {
      return json(request, { error: "bad id (64-char hex event id)" }, { status: 400 });
    }
    where.push("b.event_id = ?"); args.push(id);
  }
  const podcast = u.searchParams.get("podcast");
  if (podcast) { where.push("b.podcast_guid = ?"); args.push(podcast); }
  const item = u.searchParams.get("item");
  if (item) { where.push("b.item_guid = ?"); args.push(item); }
  const booster = u.searchParams.get("booster");
  if (booster) {
    const hex = toHexPubkey(booster);
    if (!hex) return json(request, { error: "bad booster (npub or hex)" }, { status: 400 });
    where.push("b.booster_pubkey = ?"); args.push(hex);
  }
  const since = parseInt(u.searchParams.get("since"), 10);
  if (Number.isFinite(since)) { where.push("b.created_at >= ?"); args.push(since); }
  const until = parseInt(u.searchParams.get("until"), 10);
  if (Number.isFinite(until)) { where.push("b.created_at <= ?"); args.push(until); }

  const cur = decodeCursor(u.searchParams.get("cursor"));
  if (cur) { where.push("(b.created_at < ? OR (b.created_at = ? AND b.event_id < ?))");
             args.push(cur.ts, cur.ts, cur.id); }

  const sql = `${BOOST_SELECT}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`;
  args.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const boosts = results.map(boostRecord);
  return json(request, {
    count: boosts.length,
    next_cursor: boosts.length === limit ? encodeCursor(results[results.length - 1]) : null,
    boosts,
  });
}
