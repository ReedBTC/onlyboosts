// POST /api/v1/recommend — RECOMMENDED FOR YOU, and BECAUSE YOU BOOSTED X.
//
//   body  { pubkey: <hex|npub>, favorites?: [feedGuid], limit?: n }
//   200   { seeds, podcasts: [row], music: [row], because: [{ seed, rows }] }  (up to five)
//
// The homepage's personal rails (2026-10-17). The collector computes, for
// every show with three or more distinct boosters, its twenty most similar
// shows by DISTINCT-booster overlap (cosine; bots/global-boost-scan/similar.py,
// the show_similar table, a full replace on the daily run). This endpoint
// sums those scores over a member's SEEDS — the shows they have boosted, plus
// the feeds on their PC 2.0 favorites list when the browser hands them over,
// since that list is a Nostr event only the browser reads — and ranks the
// candidates that are not already a seed. `because` is one rail per
// most-boosted seed (up to five, 2026-10-18). Partitioned by medium side, like
// the table itself: a podcast's neighbours are podcasts and an album's are
// albums, and the two scores are not comparable (music's median overlap is
// nearly three times a podcast's), so they are two lists, never one.
//
// ⚠️ THE FLOOR IS TWO. Half of all pairs in the table share exactly one
// booster (measured 2026-10-17), which is one person's taste rather than an
// audience's. A candidate ranks when it is reached from two or more seeds, or
// shares two or more boosters with one seed; `because` applies the second
// test alone, since it has one seed by construction.
//
// Nothing is stored per member. The seeds ride as one bound JSON array
// unrolled by json_each (the follows endpoint's pattern: 100 binds and 100KB
// of statement text are the two D1 limits an IN list hits). The booster's
// own boosts are read through idx_boosts_booster; show_similar is read by
// its primary key. Cached 60s per body at the edge is pointless for a POST,
// so it is not cached; it is one member's one request.
import { json, preflight, toHexPubkey, clampLimit, PUBLISHERS } from "./_common.js";

const MAX_FAVORITES = 500;
const GUID = /^[^\s"'<>]{1,512}$/;
const TILE_COLS = `p.podcast_guid AS guid, p.title, p.image, p.artwork, p.author, p.medium,
                   p.total_sats, p.booster_count, p.boost_count`;

export async function onRequestOptions({ request }) { return preflight(request); }

function record(r) {
  return {
    guid: r.guid, title: r.title, img: r.image, art2: r.artwork || null, author: r.author,
    medium: r.medium || null, sats: r.total_sats, boosters: r.booster_count, boosts: r.boost_count,
    score: r.score != null ? Number(Number(r.score).toFixed(4)) : undefined,
    shared: r.shared ?? undefined, via: r.via ?? undefined,
  };
}

/** The member's seeds: every show they have boosted, plus the favorites the
 *  browser handed over. Publisher keys (relay bots) have no taste of their own
 *  and get nothing, which the member wall already decided. */
async function seedsOf(env, hex, favorites) {
  const { results } = await env.DB.prepare(
    `SELECT podcast_guid AS guid, COUNT(*) AS n FROM boosts
      WHERE booster_pubkey = ? AND podcast_guid IS NOT NULL
      GROUP BY podcast_guid ORDER BY n DESC, MAX(created_at) DESC`
  ).bind(hex).all();
  const boosted = (results || []).map((r) => r.guid);
  const set = new Set(boosted);
  for (const g of favorites) set.add(g);
  return { seeds: [...set], boosted };
}

async function recommendFor(env, seedsJson, music, limit) {
  const side = music ? "= 'music'" : "<> 'music'";
  const { results } = await env.DB.prepare(
    `WITH seeds AS (SELECT value AS guid FROM json_each(?1))
     SELECT ${TILE_COLS},
            SUM(s.score) AS score, MAX(s.shared_boosters) AS shared, COUNT(*) AS via
       FROM show_similar s
       JOIN seeds ON seeds.guid = s.podcast_guid
       JOIN podcasts p ON p.podcast_guid = s.other_guid
      WHERE s.other_guid NOT IN (SELECT guid FROM seeds)
        AND COALESCE(p.medium, 'podcast') ${side}
        AND COALESCE(p.title, '') <> ''
      GROUP BY s.other_guid
     HAVING COUNT(*) >= 2 OR MAX(s.shared_boosters) >= 2
      ORDER BY score DESC, via DESC, p.total_sats DESC
      LIMIT ?2`
  ).bind(seedsJson, limit).all();
  return (results || []).map(record);
}

/** Because you boosted X: up to BECAUSE_MAX of the member's most-boosted
 *  shows that have neighbours, each with its neighbours sharing two or more
 *  boosters, minus the seeds. Reed's call, 2026-10-18: five of these rails,
 *  one per show, in place of the boost rows the homepage's foot carried.
 *
 *  ⚠️ A SHOW APPEARS ON ONE RAIL ONLY. The member's top shows share an
 *  audience, so their neighbour lists overlap heavily; a neighbour is shown
 *  under the first (most-boosted) seed that reaches it and dropped from the
 *  rest, and a seed left with nothing after that is skipped for the next
 *  candidate. BECAUSE_POOL seeds are read so the skips still fill five. */
const BECAUSE_MAX = 5;
const BECAUSE_POOL = 8;
async function becauseOf(env, hex, seedsJson, boosted, limit) {
  if (!boosted.length) return [];
  const { results: seeded } = await env.DB.prepare(
    `WITH mine AS (SELECT value AS guid, key AS ord FROM json_each(?1))
     SELECT mine.guid, mine.ord FROM mine
      WHERE EXISTS (SELECT 1 FROM show_similar s WHERE s.podcast_guid = mine.guid AND s.shared_boosters >= 2)
      ORDER BY mine.ord LIMIT ?2`
  ).bind(JSON.stringify(boosted.slice(0, 50)), BECAUSE_POOL).all();
  const seedGuids = (seeded || []).map((r) => r.guid);
  if (!seedGuids.length) return [];
  const perSeed = await Promise.all(seedGuids.map((seed) => Promise.all([
    env.DB.prepare(
      `WITH seeds AS (SELECT value AS guid FROM json_each(?1))
       SELECT ${TILE_COLS}, s.score AS score, s.shared_boosters AS shared
         FROM show_similar s JOIN podcasts p ON p.podcast_guid = s.other_guid
        WHERE s.podcast_guid = ?2 AND s.shared_boosters >= 2
          AND s.other_guid NOT IN (SELECT guid FROM seeds)
          AND COALESCE(p.title, '') <> ''
        ORDER BY s.rank LIMIT ?3`
    ).bind(seedsJson, seed, limit).all(),
    env.DB.prepare(`SELECT ${TILE_COLS} FROM podcasts p WHERE p.podcast_guid = ?`).bind(seed).all(),
  ])));
  const shown = new Set();
  const out = [];
  for (const [{ results: rows }, { results: seedRow }] of perSeed) {
    if (out.length >= BECAUSE_MAX) break;
    if (!seedRow?.length) continue;
    const fresh = (rows || []).filter((r) => !shown.has(r.guid));
    if (!fresh.length) continue;
    for (const r of fresh) shown.add(r.guid);
    out.push({ seed: record(seedRow[0]), rows: fresh.map(record) });
  }
  return out;
}

/** The whole answer for one member, the shape the endpoint returns. Also
 *  what /booster/<npub> renders as its #recommended section (2026-10-20,
 *  Reed's ask: a member with recommendations has a page here already, so
 *  the recommendations belong on it). `favorites` is empty there: the list
 *  is a Nostr event only the browser reads. */
export async function recommendationsFor(env, hex, favorites = [], limit = 10) {
  const empty = { seeds: 0, podcasts: [], music: [], because: [] };
  if (PUBLISHERS.includes(hex)) return empty;
  const { seeds, boosted } = await seedsOf(env, hex, favorites);
  if (!seeds.length) return empty;
  const seedsJson = JSON.stringify(seeds);
  const [podcasts, music, because] = await Promise.all([
    recommendFor(env, seedsJson, false, limit),
    recommendFor(env, seedsJson, true, limit),
    becauseOf(env, hex, seedsJson, boosted, limit).catch((e) => { console.warn("[recommend] because", e?.message); return []; }),
  ]);
  return { seeds: seeds.length, podcasts, music, because };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json(request, { error: "body must be JSON" }, { status: 400, cache: 0 }); }
  const hex = toHexPubkey(typeof body?.pubkey === "string" ? body.pubkey : "");
  if (!hex) return json(request, { error: "pubkey must be a hex pubkey or npub" }, { status: 400, cache: 0 });
  const limit = clampLimit(body?.limit, 10, 50);
  const favorites = Array.isArray(body?.favorites)
    ? body.favorites.filter((g) => typeof g === "string" && GUID.test(g)).slice(0, MAX_FAVORITES)
    : [];
  return json(request, await recommendationsFor(env, hex, favorites, limit), { cache: 0 });
}
