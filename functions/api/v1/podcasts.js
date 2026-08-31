// GET /api/v1/podcasts — per-show aggregates, behind the Shows and Albums feeds.
//
// WHY THIS GREW. The feeds used to read the collector's published per-show
// rollup (`podcasts/index.json`, ~440KB) for the All range and, for 1W and 1M,
// walk `latest.json` plus month archives and GROUP the boosts by show IN THE
// BROWSER. That was the last client-side aggregation on the site after the
// Episodes feeds moved server-side. It is the same class of defect: the windowed
// ranking was computed over whatever shards the walk happened to pull, and the
// All range downloaded a rollup of every show to paint thirty cards.
//
// ⚠️ `range` HERE MEANS BOOST TIME. /api/v1/episodes uses the same parameter
// name for AIR DATE, and the difference is deliberate on both sides: an episode
// boosted today is out of the Episodes 1W view because it aired years ago,
// whereas a show is in the Shows 1W view precisely because someone boosted it
// this week, and its figures are that week's figures. Do not "unify" these.
//
// TWO PATHS, and which one answers is decided by the range alone:
//   • all      — reads the precomputed `podcasts` aggregate columns, one
//                indexed read, kept correct by d1_sync.
//   • 1w / 1m  — GROUPs over `boosts` inside the window. The precomputed
//                columns are all-time totals and would be flatly wrong here;
//                the whole point of a windowed card is that its numbers are the
//                window's.
// Both project the same column names, so everything downstream of `base` — the
// ranking, the search join, the ordering, the record shape — is written once.
import { json, preflight, clampLimit, toHexPubkey, ftsMatch, readLang, langWhere } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// `col` is the all-time column; `agg` the windowed expression and `alias` the
// name it is projected under. Only the alias is usable downstream of the GROUP
// BY, which is what the ranking CTE reads — an aggregate function cannot be
// referenced from a query over already-grouped rows. A sort added without all
// three breaks the windowed ranges and q= while All keeps working, which is the
// half nobody checks first.
const SORTS = {
  boosts:   { col: "p.boost_count",   agg: "COUNT(*)",                         alias: "boost_count" },
  sats:     { col: "p.total_sats",    agg: "COALESCE(SUM(b.sats),0)",          alias: "total_sats" },
  boosters: { col: "p.booster_count", agg: "COUNT(DISTINCT b.booster_pubkey)", alias: "booster_count" },
  latest:   { col: "p.latest_ts",     agg: "MAX(b.created_at)",                alias: "latest_ts" },
  // ⚠️ THE ONLYBOOSTS CHARTS: rank in sats + rank in boosts + rank in
  // boosters, summed, lowest total first — see "The OnlyBoosts Charts" in
  // docs/feeds.md. Not a single-column ranking, so no col/agg/alias;
  // globalPodcasts branches on the key before either is read.
  chart:    { chart: true },
};
// The endpoint shipped as sort=recent|sats|boosts and those URLs are in the
// wild, so `recent` keeps working as the name for the same ordering the feed
// calls "Recently boosted". Never remove it.
const SORT_ALIASES = { recent: "latest", count: "boosters" };
const DEFAULT_SORT = "latest";   // unchanged from the original shipped default

// Boost-time windows, matching RANGE_OPTIONS in feed-controls.js. Adding a key
// here without adding it there (or the reverse) is what makes a range button
// answer 400, so the two lists move together.
const RANGE_DAYS = { "1w": 7, "1m": 30, "1y": 365, all: null };
const MEDIA = new Set(["podcast", "music", "video"]);
const MAX_FOLLOWS = 5000;

// A show guid is a UUID in almost every case, and the feed's search box matches
// one so a reader can paste the guid off a show page. FTS5 does not index it
// (podcasts_fts is title + author), so it is matched as an exact equality
// alongside the MATCH rather than being tokenized.
const GUIDISH = /^[0-9a-fA-F-]{8,64}$/;

function showRecord(r) {
  return {
    guid: r.guid,
    title: r.title,
    img: r.image,
    // Second-chance art: <itunes:image> where it differs from <image>. Null for
    // most shows. Matches the shards' `art2`; see DATA-API.md.
    art2: r.artwork || null,
    feed: r.feed_url,
    medium: r.medium, author: r.author,
    // RSS <language>, primary subtag. Null means the feed declares none, which is
    // NOT English — see readLang in _common.js.
    language: r.language || null,
    boosts: r.boost_count, sats: r.total_sats, boosters: r.booster_count,
    episodes: r.episode_count, latest: r.latest_ts,
  };
}

/** Shared query params, or an {error} to return verbatim.
 *
 * ⚠️ EXPORTED, because functions/index.js server-renders the homepage's opening
 * feed and has to ask this endpoint's question without making an HTTP request
 * to it. It builds a URL, reads it through here, and runs globalPodcasts below
 * — so the front door's list is produced by the same parameter parsing, the
 * same SQL and the same record shape as the one the browser fetches on the next
 * page. The twin of the same pair in episodes.js, and there for the same
 * reason.
 */
export function readParams(u) {
  const rawSort = u.searchParams.get("sort");
  const mapped = SORT_ALIASES[rawSort] || rawSort;
  const sortKey = SORTS[mapped] ? mapped : DEFAULT_SORT;

  const range = u.searchParams.get("range") || "all";
  if (!(range in RANGE_DAYS)) return { error: "bad range (1w|1m|1y|all)" };

  // The medium split is a PARTITION: `music` goes to Albums, everything else —
  // podcast, video, and the 33% of shows Podcast Index cannot identify — goes to
  // Shows. So the Shows half is `not_medium=music`, never `medium=podcast`; an
  // exact match would strand the unidentified shows in neither feed. Same rule
  // as /api/v1/episodes and boosts/music.json.
  const medium = u.searchParams.get("medium");
  if (medium && !MEDIA.has(medium)) return { error: "bad medium (podcast|music|video)" };
  const notMedium = u.searchParams.get("not_medium");
  if (notMedium && !MEDIA.has(notMedium)) return { error: "bad not_medium (podcast|music|video)" };

  // `lang` is an independent axis from `medium`: a filter can be music+de. Unlike
  // medium there is no `not_lang` — the partition medium needs exists because the
  // unidentified shows must land in exactly one of Shows/Albums, whereas an
  // untagged show is asked for by name with lang=unknown.
  const { lang, error: langError } = readLang(u);
  if (langError) return { error: langError };

  const rawQ = (u.searchParams.get("q") || "").trim();
  if (rawQ && rawQ.length < 2) return { error: "q must be >= 2 chars" };

  // The publisher filter: one artist's declaring shows. It exists for the
  // artist drawer's follows path (publisher-card-actions.js), which needs this
  // list scoped the way the card's numbers are. Opaque and bound, never parsed
  // — same rule as a show guid.
  const publisher = u.searchParams.get("publisher") || null;

  /* `since` is an EXPLICIT boost-time cutoff (unix seconds) overriding the
   * range bucket — the contract /api/v1/podcasts/<guid>?since= already keeps,
   * and the show drawer's data-since is exactly this number. It forces the
   * windowed aggregate: the precomputed columns cannot answer an arbitrary
   * cutoff. Still BOOST TIME — not a third reading of range. */
  const since = parseInt(u.searchParams.get("since"), 10) || 0;

  const days = RANGE_DAYS[range];
  // See _common.js#ftsMatch. A raw string is an FTS5 EXPRESSION, and a pasted
  // show guid is exactly the input that breaks it: every hyphen reads as an
  // operator. Null when nothing tokenizable survives, which takes the
  // unfiltered path rather than emitting an empty MATCH.
  const match = rawQ ? ftsMatch(rawQ) : null;
  return {
    sortKey, range, medium, notMedium, lang, publisher,
    q: match ? rawQ : null,
    match,
    // FTS5 does not index the guid (podcasts_fts is title + author), so a
    // pasted one is matched as an equality beside the MATCH rather than through
    // it. The feed's search box offers the guid for exactly this.
    guid: rawQ && GUIDISH.test(rawQ) ? rawQ : null,
    // Computed per request. The response is cached briefly, so a window can lag
    // its own edge by the cache TTL; invisible at 7-day granularity and it keeps
    // this a pure function of the URL.
    cutoff: since > 0 ? since : (days ? Math.floor(Date.now() / 1000) - days * 86400 : null),
    limit: clampLimit(u.searchParams.get("limit")),
    offset: Math.max(0, parseInt(u.searchParams.get("offset"), 10) || 0),
  };
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const p = readParams(u);
  if (p.error) return json(request, { error: p.error }, { status: 400 });

  const { podcasts, nextOffset } = await globalPodcasts(env, p);

  return json(request, {
    count: podcasts.length,
    sort: p.sortKey,
    range: p.range,
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.q ? { q: p.q } : {}),
    next_offset: nextOffset,
    podcasts,
    // A windowed page is a live aggregate and a plain one is a precomputed read,
    // so they cache differently. Both are identical for every visitor.
  }, { cache: p.cutoff ? 120 : 300 });
}

/* Follows scope — Shows · Follows and Albums · Follows (2026-08-31, with the
 * OnlyBoosts Charts branch). POST for the same reason the episodes endpoint's
 * is: a kind-3 contact list runs to thousands of pubkeys, too long for a query
 * string and caller state rather than a resource identifier. The body, the
 * limits, the npub→hex normalization and the interpolation discipline are the
 * episodes POST's, verbatim in spirit — see the notes there. */
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
  const hexes = [...new Set(raw.map(toHexPubkey).filter(Boolean))];
  if (!hexes.length) {
    return json(request, { count: 0, scope: "follows", sort: p.sortKey, range: p.range,
                           ...(p.q ? { q: p.q } : {}),
                           next_offset: null, podcasts: [] }, { cache: 0 });
  }
  // Interpolated, not bound — D1 caps bound parameters far below a realistic
  // follow set, and toHexPubkey has already reduced every element to
  // /^[0-9a-f]{64}$/. The regex is the sanitizer; do not relax it.
  p.followsIn = hexes.map((h) => `'${h}'`).join(",");

  const { podcasts, nextOffset } = await globalPodcasts(env, p);
  return json(request, {
    count: podcasts.length,
    scope: "follows",
    follows: hexes.length,
    sort: p.sortKey,
    range: p.range,
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.q ? { q: p.q } : {}),
    next_offset: nextOffset,
    podcasts,
  // Per-user and POSTed: not shared-cacheable.
  }, { cache: 0 });
}

/** One page of the ranked show list, as records. See readParams above for why
 *  this is separate from the handler that serves it over HTTP. */
export async function globalPodcasts(env, p) {
  const s = SORTS[p.sortKey];
  const args = [];
  let base;

  if (p.followsIn) {
    /* ⚠️ FOLLOWS ALWAYS AGGREGATES, whatever the range: the precomputed
     * columns are computed over everyone, so a follows corpus has no
     * precomputed path to read. Same shape as the windowed branch below with
     * the author filter added. `p.followsIn` is a pre-validated,
     * already-escaped SQL fragment built in onRequestPost from pubkeys that
     * each passed toHexPubkey — never caller input, same discipline as the
     * episodes POST. */
    const where = [`b.booster_pubkey IN (${p.followsIn})`, "b.podcast_guid IS NOT NULL"];
    if (p.cutoff) { where.push("b.created_at >= ?"); args.push(p.cutoff); }
    if (p.medium) { where.push("COALESCE(pc.medium,'podcast') = ?"); args.push(p.medium); }
    if (p.notMedium) { where.push("COALESCE(pc.medium,'podcast') <> ?"); args.push(p.notMedium); }
    { const w = langWhere(p.lang, "pc.language", args); if (w) where.push(w); }
    if (p.publisher) { where.push("pc.publisher_guid = ?"); args.push(p.publisher); }
    base = `
      SELECT b.podcast_guid                     AS guid,
             pc.title, pc.image, pc.artwork, pc.feed_url, pc.medium, pc.author,
             pc.language,
             COUNT(*)                           AS boost_count,
             COALESCE(SUM(b.sats),0)            AS total_sats,
             COUNT(DISTINCT b.booster_pubkey)   AS booster_count,
             COUNT(DISTINCT b.item_guid)        AS episode_count,
             MAX(b.created_at)                  AS latest_ts
      FROM boosts b
      LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
      WHERE ${where.join(" AND ")}
      GROUP BY b.podcast_guid`;
  } else if (p.cutoff) {
    // ⚠️ WINDOWED: every figure is recomputed over the boosts inside the window.
    // `episode_count` is DISTINCT item_guid among those boosts, which is what the
    // drawer's list length agrees with — it is not the show's catalogue size and
    // never was; see "No Episode Counts, Anywhere" in docs/show-pages-spec.md.
    // Rows with no podcast_guid (~2% of boosts) are dropped because there is no
    // show to be a card for; they still appear in the Boosts feed.
    const where = ["b.created_at >= ?", "b.podcast_guid IS NOT NULL"];
    args.push(p.cutoff);
    if (p.medium) { where.push("COALESCE(pc.medium,'podcast') = ?"); args.push(p.medium); }
    if (p.notMedium) { where.push("COALESCE(pc.medium,'podcast') <> ?"); args.push(p.notMedium); }
    // No COALESCE: a NULL language is its own state, reachable only as lang=unknown.
    { const w = langWhere(p.lang, "pc.language", args); if (w) where.push(w); }
    if (p.publisher) { where.push("pc.publisher_guid = ?"); args.push(p.publisher); }
    base = `
      SELECT b.podcast_guid                     AS guid,
             pc.title, pc.image, pc.artwork, pc.feed_url, pc.medium, pc.author,
             pc.language,
             COUNT(*)                           AS boost_count,
             COALESCE(SUM(b.sats),0)            AS total_sats,
             COUNT(DISTINCT b.booster_pubkey)   AS booster_count,
             COUNT(DISTINCT b.item_guid)        AS episode_count,
             MAX(b.created_at)                  AS latest_ts
      FROM boosts b
      LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
      WHERE ${where.join(" AND ")}
      GROUP BY b.podcast_guid`;
  } else {
    const where = [];
    if (p.medium) { where.push("COALESCE(p.medium,'podcast') = ?"); args.push(p.medium); }
    if (p.notMedium) { where.push("COALESCE(p.medium,'podcast') <> ?"); args.push(p.notMedium); }
    { const w = langWhere(p.lang, "p.language", args); if (w) where.push(w); }
    if (p.publisher) { where.push("p.publisher_guid = ?"); args.push(p.publisher); }
    base = `
      SELECT p.podcast_guid AS guid, p.title, p.image, p.artwork, p.feed_url,
             p.medium, p.author, p.language, p.boost_count, p.total_sats, p.booster_count,
             p.episode_count, p.latest_ts
      FROM podcasts p
      ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  }

  /* ⚠️ THE ONLYBOOSTS CHARTS SORT. Three competition ranks over the same
   * corpus — sats, boosts, boosters — summed into a score, lowest first. The
   * STANDING is the full tuple (score, then boosters, sats, boosts as
   * tiebreakers — Reed's spec, 2026-08-31), so RANK() takes the whole tuple:
   * only rows equal on all four share a place and print T#. That deliberately
   * differs from the single-column sorts, where the tiebreak is a paging order
   * and must stay OUT of the window; here the tiebreak IS part of the
   * published standing. Every row carries its rank and tie flag, because a
   * client cannot re-derive a tuple standing from any one figure — the
   * renderers use their server-rank path (the q= path) for this sort.
   *
   * The q= path filters AFTER ranking, the same rank-retention rule as the
   * single-column sorts; `peers` is counted before the filter so a tie flag
   * survives its partner being filtered out. COALESCE mirrors feed-rank.js:
   * the all-time aggregate columns are nullable in principle, and a NULL
   * would sort as its own value rather than as zero. */
  if (p.sortKey === "chart") {
    const qFilter = p.match
      ? `WHERE tied.guid IN (
              SELECT podcast_guid FROM podcasts_fts WHERE podcasts_fts MATCH ?
            )
         ${p.guid ? "OR tied.guid = ?" : ""}`
      : "";
    const sql = `
      WITH base AS (${base}),
           scored AS (
             SELECT base.*,
                    RANK() OVER (ORDER BY COALESCE(total_sats,0) DESC)    AS r_sats,
                    RANK() OVER (ORDER BY COALESCE(boost_count,0) DESC)   AS r_boosts,
                    RANK() OVER (ORDER BY COALESCE(booster_count,0) DESC) AS r_boosters
             FROM base
           ),
           chart AS (
             SELECT scored.*,
                    (r_sats + r_boosts + r_boosters) AS score,
                    RANK() OVER (ORDER BY (r_sats + r_boosts + r_boosters),
                                 COALESCE(booster_count,0) DESC,
                                 COALESCE(total_sats,0) DESC,
                                 COALESCE(boost_count,0) DESC) AS rank
             FROM scored
           ),
           tied AS (
             SELECT chart.*, COUNT(*) OVER (PARTITION BY rank) AS peers FROM chart
           )
      SELECT * FROM tied
      ${qFilter}
      ORDER BY rank, guid
      LIMIT ? OFFSET ?`;
    if (p.match) {
      args.push(p.match);
      if (p.guid) args.push(p.guid);
    }
    args.push(p.limit, p.offset);
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const podcasts = results.map((r) => {
      const rec = showRecord(r);
      rec.rank = r.rank;
      rec.tied = r.peers > 1;
      // The formula in the open: the three component ranks and their sum.
      rec.chart = { score: r.score, sats: r.r_sats, boosts: r.r_boosts, boosters: r.r_boosters };
      return rec;
    });
    return { podcasts, nextOffset: podcasts.length === p.limit ? p.offset + p.limit : null };
  }

  // Ties break on sats then guid, and the sort column is NOT repeated: naming it
  // twice is what stops SQLite matching an index and drops it onto a temp
  // B-tree. Without a total order two shows of equal rank can swap between
  // pages and the same card appears twice.
  const orderCol = s.alias;
  const tiebreak = orderCol === "total_sats" ? "guid" : "total_sats DESC, guid";
  const ORDER = `ORDER BY ${orderCol} DESC, ${tiebreak}`;

  let sql;
  if (p.match) {
    // Search answers "where does my show stand", so a hit without its position
    // in the FULL ordering is useless — the client holds one card and cannot
    // count rows it never received. `rank` is computed over every show the
    // non-q filters admit, and the matches are then picked out of it.
    //
    // Deliberately the expensive path: ROW_NUMBER() over the whole filtered set
    // reads all of it, where the plain listing walks an index and reads its
    // page. Acceptable because search is user-initiated and rare next to feed
    // loads, and because this table is 1,295 rows rather than the boosts
    // table's 22k. Do not reuse the shape for the default listing.
    //
    // Results stay in the ACTIVE SORT, not relevance order: the feed reads as
    // the same leaderboard with non-matches removed, which is what keeps the
    // rank numbers legible. Same call /api/v1/episodes?q= makes.
    // ⚠️ RANK(), NOT ROW_NUMBER(), AND NO TIEBREAK INSIDE THE WINDOW. SQLite's
    // RANK() is standard competition ranking, which is the site's one
    // definition (see assets/js/rank.js): ties share the better place and the
    // next distinct value skips the group. The tiebreak stays on the OUTER
    // ORDER BY, where it exists to make paging a total order — putting it in
    // the window would hand every member of a tie a distinct rank again, which
    // is exactly the bug this replaced. A searched card must agree with the
    // number the same card carries on the unfiltered feed.
    sql = `
      WITH base AS (${base}),
           ranked AS (
             SELECT guid, RANK() OVER (ORDER BY ${orderCol} DESC) AS rank FROM base
           )
      SELECT base.*, ranked.rank
      FROM base
      JOIN ranked ON ranked.guid = base.guid
      WHERE base.guid IN (
              SELECT podcast_guid FROM podcasts_fts WHERE podcasts_fts MATCH ?
            )
         ${p.guid ? "OR base.guid = ?" : ""}
      ${ORDER}
      LIMIT ? OFFSET ?`;
    args.push(p.match);
    if (p.guid) args.push(p.guid);
  } else {
    sql = `WITH base AS (${base}) SELECT * FROM base ${ORDER} LIMIT ? OFFSET ?`;
  }
  args.push(p.limit, p.offset);

  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const podcasts = results.map((r) => {
    const rec = showRecord(r);
    if (p.match) rec.rank = r.rank;   // position in the unfiltered ordering
    return rec;
  });

  return {
    podcasts,
    nextOffset: podcasts.length === p.limit ? p.offset + p.limit : null,
  };
}
