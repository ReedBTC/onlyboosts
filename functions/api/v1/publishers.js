// GET /api/v1/publishers — per-artist aggregates, behind the Artists feed.
//
// THE TIER. Music has three levels of ownership — publisher > album (show) >
// song (episode) — and in practice the publisher is the ARTIST: Wavlake mints
// one publisher feed per artist, Fountain and RSS Blue for their uploaders.
// The collector resolves the linkage from raw RSS (Podcast Index carries no
// publisher field — see bots/global-boost-scan/publishers.py, the design
// record) and D1 holds it as `podcasts.publisher_guid` plus the `publishers`
// and `publisher_albums` tables. Coverage, measured on the full corpus
// 2026-08-30: 386 of 492 music shows (78%) declare a publisher; 182 publishers.
//
// ⚠️ `range` MEANS BOOST TIME, the same reading /api/v1/podcasts takes: an
// artist is in the 1W view because someone boosted their work this week. There
// is deliberately no third reading — see the range rule in CLAUDE.md.
//
// ONE PATH, ALWAYS A GROUP BY, where /api/v1/podcasts has two. That endpoint's
// All range reads precomputed aggregate columns; `publishers` carries none
// (only `show_count`), so every range aggregates the boosts through the
// declaring shows. Acceptable because the join fans out from 182 publishers
// through ~395 declaring shows over an indexed boost column — the same work the
// windowed show path already does on every 1W press.
//
// ⚠️ MUSIC ONLY, HARD-WIRED — no medium parameter because there is no choice
// to offer. Reed's call, 2026-08-31, REVERSING the launch decision (which
// counted everything a publisher declared, the tier being ownership): the
// surface says ARTIST and sits under the Music tab, so an artist's figures
// are their music's figures, full stop. The ~9 podcast-side declaring shows
// still aggregate into Shows/Episodes like any show; they simply no longer
// count toward the artist tier anywhere — this listing, the detail endpoint,
// /artist, and the feed-rank chips all carry the same filter, or a chip would
// claim a place on a list computed over a different corpus. The standing
// partition reading applies: COALESCE(medium,'podcast'), so an unidentified
// declaring feed is not music and does not count.
import { json, preflight, clampLimit, toHexPubkey, readLang, langWhere } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// Same shape as SORTS in podcasts.js: the alias is the projected aggregate the
// ranking CTE and the ORDER BY read. No `col` half here — there is no
// precomputed path to name a column on.
const SORTS = {
  boosts:   { agg: "COUNT(*)",                         alias: "boost_count" },
  sats:     { agg: "COALESCE(SUM(b.sats),0)",          alias: "total_sats" },
  boosters: { agg: "COUNT(DISTINCT b.booster_pubkey)", alias: "booster_count" },
  latest:   { agg: "MAX(b.created_at)",                alias: "latest_ts" },
  // ⚠️ THE ONLYBOOSTS CHARTS: rank in sats + rank in boosts + rank in
  // boosters, summed, lowest total first — see "The OnlyBoosts Charts" in
  // docs/feeds.md. Not a single-column ranking; globalPublishers branches on
  // the key before agg/alias is read.
  chart:    { chart: true },
};
// The OnlyBoosts Charts, matching the client's opening sort (every ranked
// feed opens on Chart rank since 2026-08-31). A new endpoint has no legacy
// URLs to honour, so unlike podcasts.js there are no sort aliases and the
// default stays the ranking the feed actually opens on — it was "boosters"
// while the feed was.
const DEFAULT_SORT = "chart";

// Boost-time windows, matching RANGE_OPTIONS in feed-controls.js and RANGE_DAYS
// in podcasts.js/episodes.js. The lists move together or a range button 400s.
const RANGE_DAYS = { "1w": 7, "1m": 30, "1y": 365, all: null };
const MAX_FOLLOWS = 5000;

// A publisher guid is pasteable the way a show guid is; FTS does not exist for
// this table at all, so the guid is matched as an equality beside the LIKE.
const GUIDISH = /^[0-9a-fA-F-]{8,64}$/;

/* ⚠️ LIKE'S OWN WILDCARDS HAVE TO BE ESCAPED OR THE READER CAN TYPE THEM — the
 * same rule, the same reason and the same shape as members.js#likeEscape. There
 * is no publishers FTS table and 182 rows do not earn one, so the search is a
 * LIKE over the title with the ESCAPE clause declared at the use site. ASCII
 * case-folding only, the documented SQLite LIKE limitation members.js carries. */
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

function publisherRecord(r) {
  return {
    guid: r.guid,
    title: r.title,
    img: r.image,
    // Second-chance art, cover-art-chain rules — matches the shards' `art2`.
    art2: r.artwork || null,
    feed: r.feed_url,
    // Indexed shows declaring this publisher, all-time and post-exclusion —
    // the collector's own count, NOT the window's. The windowed count of
    // boosted shows is a different number and nothing renders either; this one
    // rides along because the row carries it for free.
    albums: r.show_count,
    boosts: r.boost_count, sats: r.total_sats, boosters: r.booster_count,
    latest: r.latest_ts,
  };
}

/** Shared query params, or an {error} to return verbatim. Exported for the
 *  same reason podcasts.js#readParams is: a future server-rendered surface has
 *  to ask this endpoint's question without an HTTP request to it. */
export function readParams(u) {
  const rawSort = u.searchParams.get("sort");
  const sortKey = SORTS[rawSort] ? rawSort : DEFAULT_SORT;

  const range = u.searchParams.get("range") || "all";
  if (!(range in RANGE_DAYS)) return { error: "bad range (1w|1m|1y|all)" };

  // `lang` filters through the DECLARING SHOWS' language: "German artists" is
  // artists ranked by their German albums' boosts. An artist whose albums are
  // all untagged is reachable as lang=unknown, the same partition honesty the
  // show feeds keep — NULL is not English.
  const { lang, error: langError } = readLang(u);
  if (langError) return { error: langError };

  const rawQ = (u.searchParams.get("q") || "").trim();
  if (rawQ && rawQ.length < 2) return { error: "q must be >= 2 chars" };

  const days = RANGE_DAYS[range];
  return {
    sortKey, range, lang,
    q: rawQ || null,
    guid: rawQ && GUIDISH.test(rawQ) ? rawQ : null,
    cutoff: days ? Math.floor(Date.now() / 1000) - days * 86400 : null,
    limit: clampLimit(u.searchParams.get("limit")),
    offset: Math.max(0, parseInt(u.searchParams.get("offset"), 10) || 0),
  };
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const p = readParams(u);
  if (p.error) return json(request, { error: p.error }, { status: 400 });

  const { publishers, nextOffset } = await globalPublishers(env, p);

  return json(request, {
    count: publishers.length,
    sort: p.sortKey,
    range: p.range,
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.q ? { q: p.q } : {}),
    next_offset: nextOffset,
    publishers,
  }, { cache: p.cutoff ? 120 : 300 });
}

// The GET's status and headers, no body — link checkers and unfurlers HEAD
// first, and a HEAD with no handler falls through to the static lookup's 404.
export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}

/* Follows scope — Artists · Follows (2026-08-31). The podcasts POST one tier
 * up; see the notes there and on the episodes POST for the body, the limits
 * and the interpolation discipline. */
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
                           next_offset: null, publishers: [] }, { cache: 0 });
  }
  p.followsIn = hexes.map((h) => `'${h}'`).join(",");

  const { publishers, nextOffset } = await globalPublishers(env, p);
  return json(request, {
    count: publishers.length,
    scope: "follows",
    follows: hexes.length,
    sort: p.sortKey,
    range: p.range,
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.q ? { q: p.q } : {}),
    next_offset: nextOffset,
    publishers,
  }, { cache: 0 });
}

/** One page of the ranked artist list, as records. */
export async function globalPublishers(env, p) {
  const s = SORTS[p.sortKey];
  const args = [];

  // `title IS NOT NULL` drops the one bare row a stale headstarts.uk link
  // resolves to a non-publisher feed for — a card with no name, no art and no
  // page is not a card. The collector's parse refuses to store a non-publisher
  // channel's metadata, which is the right refusal; this is its display half.
  // Music only — see the header. Literal rather than bound, so the artist
  // page's extracted-SQL tests keep their parameter shape.
  const where = ["pub.title IS NOT NULL", "COALESCE(pc.medium,'podcast') = 'music'"];
  // The follows filter rides the same aggregate: this endpoint always GROUPs,
  // so the scope is one more WHERE clause rather than a second path.
  // `p.followsIn` is pre-validated hex, interpolated — see onRequestPost.
  if (p.followsIn) where.push(`b.booster_pubkey IN (${p.followsIn})`);
  if (p.cutoff) { where.push("b.created_at >= ?"); args.push(p.cutoff); }
  { const w = langWhere(p.lang, "pc.language", args); if (w) where.push(w); }

  const base = `
    SELECT pub.publisher_guid                  AS guid,
           pub.title, pub.image, pub.artwork, pub.feed_url, pub.show_count,
           COUNT(*)                            AS boost_count,
           COALESCE(SUM(b.sats),0)             AS total_sats,
           COUNT(DISTINCT b.booster_pubkey)    AS booster_count,
           MAX(b.created_at)                   AS latest_ts
    FROM publishers pub
    JOIN podcasts pc ON pc.publisher_guid = pub.publisher_guid
    JOIN boosts b    ON b.podcast_guid    = pc.podcast_guid
    WHERE ${where.join(" AND ")}
    GROUP BY pub.publisher_guid`;

  /* ⚠️ THE ONLYBOOSTS CHARTS SORT — the podcasts.js ladder, one tier up; see
   * the chart note there for the tuple standing and the rank-retention rule.
   * These aggregates are never NULL (COUNT / COALESCE(SUM)), so no COALESCE. */
  if (p.sortKey === "chart") {
    const qFilter = p.q
      ? `WHERE tied.title LIKE ? ESCAPE '\\'
         ${p.guid ? "OR tied.guid = ?" : ""}`
      : "";
    const sql = `
      WITH base AS (${base}),
           scored AS (
             SELECT base.*,
                    RANK() OVER (ORDER BY total_sats DESC)    AS r_sats,
                    RANK() OVER (ORDER BY boost_count DESC)   AS r_boosts,
                    RANK() OVER (ORDER BY booster_count DESC) AS r_boosters
             FROM base
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
           )
      SELECT * FROM tied
      ${qFilter}
      ORDER BY rank, guid
      LIMIT ? OFFSET ?`;
    if (p.q) {
      args.push(`%${likeEscape(p.q)}%`);
      if (p.guid) args.push(p.guid);
    }
    args.push(p.limit, p.offset);
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const publishers = results.map((r) => {
      const rec = publisherRecord(r);
      rec.rank = r.rank;
      rec.tied = r.peers > 1;
      rec.chart = { score: r.score, sats: r.r_sats, boosts: r.r_boosts, boosters: r.r_boosters };
      return rec;
    });
    return { publishers, nextOffset: publishers.length === p.limit ? p.offset + p.limit : null };
  }

  // Ties break on sats then guid; the sort column is not repeated. Same total
  // order rule as podcasts.js, so two artists of equal rank cannot swap
  // between pages.
  const orderCol = s.alias;
  const tiebreak = orderCol === "total_sats" ? "guid" : "total_sats DESC, guid";
  const ORDER = `ORDER BY ${orderCol} DESC, ${tiebreak}`;

  let sql;
  if (p.q) {
    /* ⚠️ RANK() OVER THE WHOLE FILTERED SET, NEVER ROW_NUMBER(), AND NO
     * TIEBREAK INSIDE THE WINDOW — a searched card must agree with the number
     * the same card carries on the unfiltered feed. The identical shape, and
     * the identical warning, as the q= path in podcasts.js; at 182 rows the
     * "expensive path" caveat there does not even apply. */
    sql = `
      WITH base AS (${base}),
           ranked AS (
             SELECT guid, RANK() OVER (ORDER BY ${orderCol} DESC) AS rank FROM base
           )
      SELECT base.*, ranked.rank
      FROM base
      JOIN ranked ON ranked.guid = base.guid
      WHERE base.title LIKE ? ESCAPE '\\'
         ${p.guid ? "OR base.guid = ?" : ""}
      ${ORDER}
      LIMIT ? OFFSET ?`;
    args.push(`%${likeEscape(p.q)}%`);
    if (p.guid) args.push(p.guid);
  } else {
    sql = `WITH base AS (${base}) SELECT * FROM base ${ORDER} LIMIT ? OFFSET ?`;
  }
  args.push(p.limit, p.offset);

  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const publishers = results.map((r) => {
    const rec = publisherRecord(r);
    if (p.q) rec.rank = r.rank;   // position in the unfiltered ordering
    return rec;
  });

  return {
    publishers,
    nextOffset: publishers.length === p.limit ? p.offset + p.limit : null,
  };
}
