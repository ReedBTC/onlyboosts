// GET  /api/v1/episodes — the per-episode rollup behind the Episodes and Songs feeds.
// POST /api/v1/episodes — same, scoped to a follow set (body: {"follows":[npub|hex,…]}).
//
// WHY THIS EXISTS. The feeds used to build this rollup client-side from the
// windowed boost feed (latest.json + three month archives), which meant the
// ranking was computed over ~11% of the corpus and was not merely sparse but
// WRONG: 7 of the true all-time top 10 episodes were absent, and one that ranked
// #7 all-time showed at #128 because only its last-three-months sats were
// counted. Ranking needs the whole corpus, so the aggregation belongs where the
// whole corpus is. The client gets the answer instead of the inputs.
//
// TWO PATHS, and the split is not an optimization — it's what can be
// precomputed at all:
//   • Global — reads the precomputed `episodes` aggregate columns, kept correct
//     by d1_sync (every delta recomputes the rows its new boosts touched).
//     Every ranked sort has an index, so this is a bounded read off the index
//     head rather than a scan-and-sort of all ~6.7k episodes.
//   • Follows — GROUPs over `boosts` filtered to the caller's follow set. A
//     per-user ranking can't be precomputed for every possible set of people,
//     so this one genuinely has to aggregate per request.
// Both return the same record shape; only the corpus differs.
import { json, preflight, clampLimit, toHexPubkey, ftsMatch, readLang, langWhere } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// Sort keys are the frontend's own (SORT_OPTIONS in feeds-podcasts.js) so the
// two can't drift. `episode` ranks by air date; every other key ranks by an
// aggregate over the episode's boosts.
// `agg` is the follows-path expression, computed inside the GROUP BY. `alias` is
// the name that expression is projected under — the only form usable OUTSIDE the
// aggregation, which is what the ranking CTE for q= selects from. An aggregate
// function cannot be referenced from a query reading already-grouped rows.
const SORTS = {
  recent:  { col: "e.latest_ts",     agg: "MAX(b.created_at)",               alias: "latest_ts" },
  episode: { col: "e.published",     agg: "e.published",                     alias: "published" },
  count:   { col: "e.booster_count", agg: "COUNT(DISTINCT b.booster_pubkey)", alias: "booster_count" },
  boosts:  { col: "e.boost_count",   agg: "COUNT(*)",                        alias: "boost_count" },
  sats:    { col: "e.total_sats",    agg: "COALESCE(SUM(b.sats),0)",         alias: "total_sats" },
  // ⚠️ THE ONLYBOOSTS CHARTS: rank in sats + rank in boosts + rank in
  // boosters, summed, lowest total first — see "The OnlyBoosts Charts" in
  // docs/feeds.md. Not a single-column ranking, so no col/agg/alias; both
  // query builders branch on the key before reading either.
  chart:   { chart: true },
};
const DEFAULT_SORT = "boosts";      // the API's default for callers passing none; the feed itself always passes its opening sort (`count`, see functions/index.js)

// Air-date windows, matching RANGE_OPTIONS in feed-controls.js. The range
// filters on when the episode AIRED, not when it was boosted — an old episode
// boosted today is outside 1W. Getting this backwards would silently redefine
// the feed, so it's spelled out here.
const RANGE_DAYS = { "1w": 7, "1m": 30, "1y": 365, all: null };

const MEDIA = new Set(["podcast", "music", "video"]);
const MAX_FOLLOWS = 5000;

// ── ?include=boosts ──────────────────────────────────────────────────────────
// The feed card isn't a row of figures: it opens a drawer of the actual boost
// notes with a reply/like/repost/zap bar each, and its collapsed state shows
// booster avatars. Aggregates can't produce either, so the notes ride along
// with the page that needs them instead of costing a second round trip.
//
// Capped PER EPISODE, not per page: one 300-boost episode must not starve the
// other 29 cards. 50 matches what the drawer already lives with, and the card's
// `boosts` total is the full count — so `boosts_inline.length < boosts` is how a
// client knows it was truncated and should link out to /episode/<guid>.
const BOOSTS_PER_EPISODE = 50;
// D1 hard-caps bound parameters at exactly 100 per statement (verified: 100 OK,
// 101 → "too many SQL variables"). A page can carry up to `limit` = 200
// episodes, so the guid list is chunked rather than bound in one go. The guids
// are NOT interpolated: 9% of them contain a slash and some are full URLs, so
// they stay opaque bound values.
const GUID_CHUNK = 90;

function inlineBoostRecord(r) {
  return {
    id: r.event_id,
    ts: r.created_at,
    sats: r.sats,
    src: r.amount_source,
    msg: r.message,
    client: r.client,
    booster: { pk: r.booster_pubkey, npub: r.booster_npub, name: r.pr_name, pic: r.pr_pic },
  };
}

/**
 * Attach each episode's boost notes in place. `followsIn` is a pre-validated,
 * already-escaped SQL fragment (or null) — when the page is follows-scoped the
 * notes are scoped the same way, so the drawer can't show boosts the card's own
 * numbers didn't count.
 */
async function attachBoosts(env, episodes, followsIn) {
  if (!episodes.length) return;
  const byGuid = new Map(episodes.map((e) => [e.guid, e]));
  for (const e of episodes) e.boosts_inline = [];

  const guids = [...byGuid.keys()];
  const chunks = [];
  for (let i = 0; i < guids.length; i += GUID_CHUNK) chunks.push(guids.slice(i, i + GUID_CHUNK));

  // ROW_NUMBER partitioned by episode is what makes the per-episode cap one
  // query instead of one per card (verified supported on D1).
  const results = await Promise.all(chunks.map((chunk) => {
    const ph = chunk.map(() => "?").join(",");
    return env.DB.prepare(`
      SELECT item_guid, event_id, booster_pubkey, booster_npub, created_at, sats,
             amount_source, client, message, pr_name, pr_pic
      FROM (
        SELECT b.item_guid, b.event_id, b.booster_pubkey, b.booster_npub, b.created_at,
               b.sats, b.amount_source, b.client, b.message,
               pr.name AS pr_name, pr.picture AS pr_pic,
               ROW_NUMBER() OVER (PARTITION BY b.item_guid
                                  ORDER BY b.created_at DESC, b.event_id DESC) AS rn
        FROM boosts b
        LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
        WHERE b.item_guid IN (${ph})
          ${followsIn ? `AND b.booster_pubkey IN (${followsIn})` : ""}
      )
      WHERE rn <= ?
      ORDER BY item_guid, created_at DESC`).bind(...chunk, BOOSTS_PER_EPISODE).all();
  }));

  for (const { results: rows } of results) {
    for (const r of rows) byGuid.get(r.item_guid)?.boosts_inline.push(inlineBoostRecord(r));
  }
}

function episodeRecord(r) {
  return {
    guid: r.item_guid,
    title: r.title,
    // Episode art falls back to the show's, same as the shards.
    img: r.image || r.p_image,
    date: r.published,
    num: r.episode_number,
    url: r.enclosure_url,
    show: {
      // `feed` is not cosmetic: the card's boost button resolves splits through
      // /api/value, which prefers ?feedUrl= and only falls back to
      // ?podcastGuid=. Matches the show object /api/v1/episodes/<guid> emits.
      guid: r.podcast_guid, title: r.p_title, img: r.p_image,
      art2: r.p_artwork || null, feed: r.p_feed,
      medium: r.p_medium || "podcast", author: r.p_author,
      // The show's RSS <language>; null means its feed declares none, NOT English.
      language: r.p_language || null,
    },
    boosts: r.boost_count,
    sats: r.total_sats,
    boosters: r.booster_count,
    latest: r.latest_ts,
  };
}

/** Shared query params, or an {error} to return verbatim.
 *
 * ⚠️ EXPORTED, because functions/index.js server-renders the homepage's opening
 * feed and has to ask this endpoint's question without making an HTTP request to
 * it. It builds a URL, reads it through here, and runs globalEpisodes below — so
 * the front door's list is produced by the same parameter parsing, the same SQL
 * and the same record shape as the one the browser fetches on the next page.
 */
export function readParams(u) {
  const sortKey = SORTS[u.searchParams.get("sort")] ? u.searchParams.get("sort") : DEFAULT_SORT;
  const range = u.searchParams.get("range") || "all";
  if (!(range in RANGE_DAYS)) return { error: "bad range (1w|1m|1y|all)" };
  // The medium split is a PARTITION: `music` goes to Songs/Albums, everything
  // else — podcast, video, and feeds Podcast Index can't identify — goes to
  // Episodes/Shows. So the Episodes half is `not_medium=music`, not
  // `medium=podcast`: an exact match would strand the video and unknown-medium
  // shows in neither feed. Same rule as boosts/music.json; see DATA-API.md.
  const medium = u.searchParams.get("medium");
  if (medium && !MEDIA.has(medium)) return { error: "bad medium (podcast|music|video)" };
  const notMedium = u.searchParams.get("not_medium");
  if (notMedium && !MEDIA.has(notMedium)) return { error: "bad not_medium (podcast|music|video)" };
  // Language is a property of the SHOW, so an episode inherits its feed's — the
  // same join `medium` rides. An episode of an untagged show is untagged.
  const { lang, error: langError } = readLang(u);
  if (langError) return { error: langError };
  const podcast = u.searchParams.get("podcast") || null;
  /* `since` is an explicit BOOST-TIME cutoff (unix seconds), applied only on
   * the follows POST — the show drawer's follows path asks for one show's
   * episodes counted over exactly the window the card's own figures were
   * (data-since, the /api/v1/podcasts/<guid>?since= contract). It is not a
   * third reading of `range`, which stays air date here; it filters
   * b.created_at the way every `#boosts` section does. The GET path ignores
   * it: the precomputed columns cannot answer an arbitrary cutoff. */
  const since = parseInt(u.searchParams.get("since"), 10) || 0;
  const days = RANGE_DAYS[range];
  const include = new Set((u.searchParams.get("include") || "").split(",").filter(Boolean));
  // Free-text over episode title + show name. See _common.js#ftsMatch: a raw
  // user string is an EXPRESSION to MATCH, not a literal, so `-`, `:` and `(`
  // used to raise SQLITE_ERROR here — `q=rabbit-hole` 500'd in production while
  // `q=bitcoin` answered 200.
  const rawQ = (u.searchParams.get("q") || "").trim();
  if (rawQ && rawQ.length < 2) return { error: "q must be >= 2 chars" };
  // A query that tokenizes to nothing takes the unfiltered path rather than an
  // empty MATCH, which is a syntax error.
  const match = rawQ ? ftsMatch(rawQ) : null;
  return {
    q: match ? rawQ : null,
    match,
    sortKey, range, medium, notMedium, lang, podcast,
    since: since > 0 ? since : null,
    withBoosts: include.has("boosts"),
    // Cutoff is computed per request; the response is cached briefly, so a
    // window can lag its own edge by the cache TTL. That's invisible at 7-day
    // granularity and keeps this a pure function of the URL.
    cutoff: days ? Math.floor(Date.now() / 1000) - days * 86400 : null,
    limit: clampLimit(u.searchParams.get("limit")),
    offset: Math.max(0, parseInt(u.searchParams.get("offset"), 10) || 0),
  };
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const p = readParams(u);
  if (p.error) return json(request, { error: p.error }, { status: 400 });

  const { episodes, nextOffset } = await globalEpisodes(env, p);
  return json(request, {
    count: episodes.length,
    scope: "global",
    sort: p.sortKey,
    range: p.range,
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.q ? { q: p.q } : {}),
    next_offset: nextOffset,
    episodes,
  }, { cache: 300 });
}

/** One page of the global ranking, as records. See readParams above for why
 *  this is separate from the handler that serves it over HTTP. */
export async function globalEpisodes(env, p) {
  // No `boost_count > 0` guard: every episodes row is derived from a boost, so
  // it matches everything — and its presence steered the planner onto the
  // boost_count index and away from the one matching the ORDER BY.
  const where = [];
  const args = [];
  if (p.cutoff) { where.push("e.published >= ?"); args.push(p.cutoff); }
  if (p.medium) { where.push("COALESCE(pc.medium,'podcast') = ?"); args.push(p.medium); }
  if (p.notMedium) { where.push("COALESCE(pc.medium,'podcast') <> ?"); args.push(p.notMedium); }
  // No COALESCE: NULL is its own state, reachable only as lang=unknown.
  { const w = langWhere(p.lang, "pc.language", args); if (w) where.push(w); }
  if (p.podcast) { where.push("e.podcast_guid = ?"); args.push(p.podcast); }

  const col = SORTS[p.sortKey].col;
  // Ties break on total_sats then item_guid: without a total order, two rows of
  // equal rank can swap between pages and the same episode appears twice.
  //
  // The sort column is NOT repeated in the tiebreakers — naming it twice stops
  // SQLite matching the covering index and it falls back to a temp B-tree over
  // every episode (measured: 19,499 rows read vs 202). Each idx_episodes_* is
  // (sort col, total_sats, item_guid) precisely so this ORDER BY is an index
  // walk; changing one without the other silently reintroduces the scan.
  const tiebreak = col === "e.total_sats" ? "e.item_guid" : "e.total_sats DESC, e.item_guid";
  const SELECT_COLS = `
           e.item_guid, e.podcast_guid, e.title, e.image, e.published,
           e.episode_number, e.enclosure_url,
           e.boost_count, e.total_sats, e.booster_count, e.latest_ts,
           pc.title AS p_title, pc.image AS p_image, pc.artwork AS p_artwork,
           pc.feed_url AS p_feed, pc.medium AS p_medium, pc.author AS p_author,
           pc.language AS p_language`;
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  let sql;
  /* ⚠️ THE ONLYBOOSTS CHARTS SORT — see the chart note in podcasts.js; the
   * ladder is identical. The narrow base CTE keeps the window scan to the
   * three aggregates; display columns join back on afterwards, the q= CTE's
   * own shape. Rank and tie flag ride EVERY row (a tuple standing the client
   * cannot re-derive from one figure), and `peers` is counted before the q=
   * filter so a tie flag survives its partner being filtered out. */
  if (p.sortKey === "chart") {
    sql = `
      WITH base AS (
        SELECT e.item_guid,
               COALESCE(e.total_sats,0)    AS c_sats,
               COALESCE(e.boost_count,0)   AS c_boosts,
               COALESCE(e.booster_count,0) AS c_boosters
        FROM episodes e
        LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
        ${whereSql}
      ),
      scored AS (
        SELECT base.*,
               RANK() OVER (ORDER BY c_sats DESC)     AS r_sats,
               RANK() OVER (ORDER BY c_boosts DESC)   AS r_boosts,
               RANK() OVER (ORDER BY c_boosters DESC) AS r_boosters
        FROM base
      ),
      chart AS (
        SELECT scored.*,
               (r_sats + r_boosts + r_boosters) AS score,
               RANK() OVER (ORDER BY (r_sats + r_boosts + r_boosters),
                            c_boosters DESC, c_sats DESC, c_boosts DESC) AS rank
        FROM scored
      ),
      tied AS (
        SELECT chart.*, COUNT(*) OVER (PARTITION BY rank) AS peers FROM chart
      )
      SELECT ${SELECT_COLS}, t.rank, t.peers, t.score, t.r_sats, t.r_boosts, t.r_boosters
      FROM tied t
      JOIN episodes e ON e.item_guid = t.item_guid
      LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
      ${p.match ? "WHERE e.item_guid IN (SELECT item_guid FROM episodes_fts WHERE episodes_fts MATCH ?)" : ""}
      ORDER BY t.rank, e.item_guid
      LIMIT ? OFFSET ?`;
    if (p.match) args.push(p.match);
    args.push(p.limit, p.offset);
  } else if (p.match) {
    // Search answers "where does my show stand", so a hit is useless without its
    // position in the FULL ordering — the client is holding a filtered list and
    // can no longer count rows itself. `rank` is computed over every episode the
    // non-q filters admit, then the matches are picked out of it.
    //
    // This is deliberately the expensive path: ROW_NUMBER() over the whole
    // filtered set reads every one of those rows, where the unfiltered feed
    // walks an index and reads only its page. Measured ~31k rows read for
    // q=bitcoin against ~200 for the same page unfiltered. Acceptable because
    // search is user-initiated and rare next to feed loads — but do not reuse
    // this shape for the default listing. (Dropping the podcasts join from the
    // CTE when no medium filter needs it was measured and changes nothing.)
    //
    // Results stay in the ACTIVE SORT, not relevance order: the feed reads as
    // the same leaderboard with non-matches removed, which is what makes the
    // rank numbers legible.
    // ⚠️ RANK(), NOT ROW_NUMBER(), AND NO TIEBREAK INSIDE THE WINDOW. SQLite's
    // RANK() is standard competition ranking, which is the site's one
    // definition (see assets/js/rank.js): ties share the better place and the
    // next distinct value skips the group. The tiebreak stays on the OUTER
    // ORDER BY, where it exists to make paging a total order — putting it in
    // the window would hand every member of a tie a distinct rank again, which
    // is exactly the bug this replaced. A searched card must agree with the
    // number the same card carries on the unfiltered feed.
    sql = `
      WITH ranked AS (
        SELECT e.item_guid,
               RANK() OVER (ORDER BY ${col} DESC) AS rank
        FROM episodes e
        LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
        ${whereSql}
      )
      SELECT ${SELECT_COLS}, r.rank
      FROM episodes_fts f
      JOIN episodes e ON e.item_guid = f.item_guid
      JOIN ranked r ON r.item_guid = e.item_guid
      LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
      WHERE episodes_fts MATCH ?
      ORDER BY ${col} DESC, ${tiebreak}
      LIMIT ? OFFSET ?`;
    // The filters are bound once, for the CTE; the outer query re-applies none of
    // them because JOIN ranked already restricts to exactly those rows.
    args.push(p.match, p.limit, p.offset);
  } else {
    sql = `
      SELECT ${SELECT_COLS}
      FROM episodes e
      LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
      ${whereSql}
      ORDER BY ${col} DESC, ${tiebreak}
      LIMIT ? OFFSET ?`;
    args.push(p.limit, p.offset);
  }

  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const episodes = results.map((r) => {
    const rec = episodeRecord(r);
    if (p.sortKey === "chart") {
      rec.rank = r.rank;
      rec.tied = r.peers > 1;
      // The formula in the open: the three component ranks and their sum.
      rec.chart = { score: r.score, sats: r.r_sats, boosts: r.r_boosts, boosters: r.r_boosters };
    } else if (p.match) rec.rank = r.rank;   // position in the unfiltered ordering
    return rec;
  });
  if (p.withBoosts) await attachBoosts(env, episodes, null);
  return {
    episodes,
    nextOffset: episodes.length === p.limit ? p.offset + p.limit : null,
  };
}

// Follows scope. POST because a kind-3 contact list runs to thousands of
// pubkeys — too long for a query string, and it's caller state rather than a
// resource identifier.
export async function onRequestPost({ request, env }) {
  const u = new URL(request.url);
  const p = readParams(u);
  if (p.error) return json(request, { error: p.error }, { status: 400 });

  let body;
  try { body = await request.json(); }
  catch { return json(request, { error: "body must be JSON" }, { status: 400 }); }

  const raw = Array.isArray(body?.follows) ? body.follows : null;
  if (!raw) return json(request, { error: "follows must be an array" }, { status: 400 });
  if (raw.length > MAX_FOLLOWS) {
    return json(request, { error: `too many follows (max ${MAX_FOLLOWS})` }, { status: 400 });
  }
  // Normalize npub→hex and drop anything that isn't a pubkey. Deduped because a
  // contact list can repeat one.
  const hexes = [...new Set(raw.map(toHexPubkey).filter(Boolean))];
  if (!hexes.length) {
    return json(request, { count: 0, scope: "follows", sort: p.sortKey, range: p.range,
                           ...(p.q ? { q: p.q } : {}),
                           next_offset: null, episodes: [] }, { cache: 0 });
  }

  // The pubkeys are interpolated, not bound: D1 caps bound parameters per
  // statement well below a realistic follow set. That is only safe because
  // toHexPubkey has already reduced every element to /^[0-9a-f]{64}$/ — the
  // regex is the sanitizer, so do not relax it or accept these from anywhere
  // that skips it.
  const inList = hexes.map((h) => `'${h}'`).join(",");

  const where = [`b.booster_pubkey IN (${inList})`, "b.item_guid IS NOT NULL"];
  const args = [];
  if (p.cutoff) { where.push("e.published >= ?"); args.push(p.cutoff); }
  // Boost-time, beside the air-date range — see `since` in readParams.
  if (p.since) { where.push("b.created_at >= ?"); args.push(p.since); }
  if (p.medium) { where.push("COALESCE(pc.medium,'podcast') = ?"); args.push(p.medium); }
  if (p.notMedium) { where.push("COALESCE(pc.medium,'podcast') <> ?"); args.push(p.notMedium); }
  { const w = langWhere(p.lang, "pc.language", args); if (w) where.push(w); }
  if (p.podcast) { where.push("b.podcast_guid = ?"); args.push(p.podcast); }

  // Aggregates are recomputed over the filtered boosts — the precomputed
  // columns are global totals and would be wrong here, so they're shadowed by
  // the GROUP BY rather than selected.
  // Same tiebreak discipline as the GET path (a total order, sort key not
  // repeated). No index can serve this one — it aggregates — so here it's for
  // stable paging rather than speed.
  const agg = SORTS[p.sortKey].agg;
  const aggTiebreak = p.sortKey === "sats" ? "b.item_guid" : "total_sats DESC, b.item_guid";
  const AGG_SELECT = `
    SELECT b.item_guid, e.podcast_guid, e.title, e.image, e.published,
           e.episode_number, e.enclosure_url,
           COUNT(*)                            AS boost_count,
           COALESCE(SUM(b.sats),0)             AS total_sats,
           COUNT(DISTINCT b.booster_pubkey)    AS booster_count,
           MAX(b.created_at)                   AS latest_ts,
           pc.title AS p_title, pc.image AS p_image, pc.artwork AS p_artwork,
           pc.feed_url AS p_feed, pc.medium AS p_medium, pc.author AS p_author,
           pc.language AS p_language
    FROM boosts b
    LEFT JOIN episodes e  ON e.item_guid    = b.item_guid
    LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
    WHERE ${where.join(" AND ")}
    GROUP BY b.item_guid`;

  let sql;
  /* The charts ladder over the follow set's aggregate — see the chart notes in
   * podcasts.js and on the GET path above. Rank means standing within the
   * follow corpus; the renderer orders by it and deliberately prints no
   * numbers on Follows (`showRanks` in feeds-podcasts.js). */
  if (p.sortKey === "chart") {
    const ladder = `
      WITH agg AS (${AGG_SELECT}),
      scored AS (
        SELECT agg.*,
               RANK() OVER (ORDER BY total_sats DESC)    AS r_sats,
               RANK() OVER (ORDER BY boost_count DESC)   AS r_boosts,
               RANK() OVER (ORDER BY booster_count DESC) AS r_boosters
        FROM agg
      ),
      chart AS (
        SELECT scored.*,
               (r_sats + r_boosts + r_boosters) AS score,
               RANK() OVER (ORDER BY (r_sats + r_boosts + r_boosters),
                            booster_count DESC, total_sats DESC, boost_count DESC) AS rank
        FROM scored
      ),
      tied AS (
        SELECT chart.*, COUNT(*) OVER (PARTITION BY rank) AS peers FROM chart
      )`;
    sql = p.match
      ? `${ladder}
      SELECT t.* FROM tied t
      JOIN episodes_fts f ON f.item_guid = t.item_guid
      WHERE episodes_fts MATCH ?
      ORDER BY t.rank, t.item_guid
      LIMIT ? OFFSET ?`
      : `${ladder}
      SELECT * FROM tied
      ORDER BY rank, item_guid
      LIMIT ? OFFSET ?`;
    if (p.match) args.push(p.match);
    args.push(p.limit, p.offset);
  } else if (p.match) {
    // Same contract as the GET path: `rank` is the position in the follow set's
    // FULL ordering, so a hit still answers "where does this stand among the
    // people I follow". The aggregate is already a full scan over the follow
    // set's boosts, so wrapping it in a CTE and numbering the rows costs
    // essentially nothing beyond what this endpoint always pays.
    // Outside the GROUP BY the sort key exists only under its projected alias.
    const a = SORTS[p.sortKey].alias;
    // ⚠️ RANK(), NOT ROW_NUMBER(), AND NO TIEBREAK INSIDE THE WINDOW. SQLite's
    // RANK() is standard competition ranking, which is the site's one
    // definition (see assets/js/rank.js): ties share the better place and the
    // next distinct value skips the group. The tiebreak stays on the OUTER
    // ORDER BY, where it exists to make paging a total order — putting it in
    // the window would hand every member of a tie a distinct rank again, which
    // is exactly the bug this replaced. A searched card must agree with the
    // number the same card carries on the unfiltered feed.
    sql = `
      WITH agg AS (${AGG_SELECT}),
      ranked AS (
        SELECT agg.*, RANK() OVER (ORDER BY ${a} DESC) AS rank
        FROM agg
      )
      SELECT r.* FROM ranked r
      JOIN episodes_fts f ON f.item_guid = r.item_guid
      WHERE episodes_fts MATCH ?
      ORDER BY r.${a} DESC, ${a === "total_sats" ? "" : "r.total_sats DESC, "}r.item_guid
      LIMIT ? OFFSET ?`;
    args.push(p.match, p.limit, p.offset);
  } else {
    sql = `${AGG_SELECT}
    ORDER BY ${agg} DESC, total_sats DESC, b.item_guid
    LIMIT ? OFFSET ?`;
    args.push(p.limit, p.offset);
  }

  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const episodes = results.map((r) => {
    const rec = episodeRecord({ ...r, item_guid: r.item_guid });
    if (p.sortKey === "chart") {
      rec.rank = r.rank;
      rec.tied = r.peers > 1;
      rec.chart = { score: r.score, sats: r.r_sats, boosts: r.r_boosts, boosters: r.r_boosters };
    } else if (p.match) rec.rank = r.rank;
    return rec;
  });
  // Notes scoped to the same follow set as the aggregates above — a drawer
  // showing boosts the card's own numbers didn't count would read as a bug.
  if (p.withBoosts) await attachBoosts(env, episodes, inList);
  return json(request, {
    count: episodes.length,
    scope: "follows",
    follows: hexes.length,
    sort: p.sortKey,
    range: p.range,
    ...(p.lang ? { lang: p.lang } : {}),
    // Echoed for the same reason as the GET path: a caller that asked to filter
    // must be able to see, from the response alone, that filtering happened.
    ...(p.q ? { q: p.q } : {}),
    next_offset: episodes.length === p.limit ? p.offset + p.limit : null,
    episodes,
  // Per-user and POSTed: not shared-cacheable.
  }, { cache: 0 });
}
