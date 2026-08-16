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
import { json, preflight, clampLimit, ftsMatch, readLang, langWhere } from "./_common.js";

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

function readParams(u) {
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

  const days = RANGE_DAYS[range];
  // See _common.js#ftsMatch. A raw string is an FTS5 EXPRESSION, and a pasted
  // show guid is exactly the input that breaks it: every hyphen reads as an
  // operator. Null when nothing tokenizable survives, which takes the
  // unfiltered path rather than emitting an empty MATCH.
  const match = rawQ ? ftsMatch(rawQ) : null;
  return {
    sortKey, range, medium, notMedium, lang,
    q: match ? rawQ : null,
    match,
    // FTS5 does not index the guid (podcasts_fts is title + author), so a
    // pasted one is matched as an equality beside the MATCH rather than through
    // it. The feed's search box offers the guid for exactly this.
    guid: rawQ && GUIDISH.test(rawQ) ? rawQ : null,
    // Computed per request. The response is cached briefly, so a window can lag
    // its own edge by the cache TTL; invisible at 7-day granularity and it keeps
    // this a pure function of the URL.
    cutoff: days ? Math.floor(Date.now() / 1000) - days * 86400 : null,
    limit: clampLimit(u.searchParams.get("limit")),
    offset: Math.max(0, parseInt(u.searchParams.get("offset"), 10) || 0),
  };
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const p = readParams(u);
  if (p.error) return json(request, { error: p.error }, { status: 400 });

  const s = SORTS[p.sortKey];
  const args = [];
  let base;

  if (p.cutoff) {
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
    base = `
      SELECT p.podcast_guid AS guid, p.title, p.image, p.artwork, p.feed_url,
             p.medium, p.author, p.language, p.boost_count, p.total_sats, p.booster_count,
             p.episode_count, p.latest_ts
      FROM podcasts p
      ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
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
    sql = `
      WITH base AS (${base}),
           ranked AS (
             SELECT guid, ROW_NUMBER() OVER (${ORDER}) AS rank FROM base
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

  return json(request, {
    count: podcasts.length,
    sort: p.sortKey,
    range: p.range,
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.q ? { q: p.q } : {}),
    next_offset: podcasts.length === p.limit ? p.offset + p.limit : null,
    podcasts,
    // A windowed page is a live aggregate and a plain one is a precomputed read,
    // so they cache differently. Both are identical for every visitor.
  }, { cache: p.cutoff ? 120 : 300 });
}
