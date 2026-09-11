// A subject's rank on the all-time global feed it belongs to, rendered as the
// third line of each stat tile on /show and /episode. Server-side facts only;
// nothing here is a verb.
//
// ── THE SCHEME: STANDARD COMPETITION RANKING (1-2-2-4) ───────────────────────
//
// ⚠️ A RANK IS THE NUMBER OF ROWS STRICTLY AHEAD, PLUS ONE. Everything tied
// shares the better place and the next distinct value skips past the whole
// group, which is what golf ("T4"), the Olympics and the US News rankings all
// display. Two consequences, and both were the reason for choosing it:
//
//   • It cannot be set by a tiebreak the reader cannot see. The feeds order
//     ties by sats then guid so that paging is stable; that is a display order,
//     not a standing, and it must never decide which of two equal shows is 4th.
//   • It cannot inflate. Measured 2026-08-18: an episode with 2 boosts is
//     T#2274 because 2,273 episodes really are ahead of it.
//
// DENSE RANKING (1-2-2-3) WAS CONSIDERED AND REJECTED, which is worth recording
// because it is the intuitive choice and it is wrong here. There are only 31
// distinct boost counts across 6,422 episodes, so dense collapses the corpus
// into 31 places and that same 2-boost episode would print "#30" with 2,273
// episodes ahead of it. Dense is honest at the head and inflates the tail;
// ordinal is honest at the head and arbitrary within every tie.
//
// NO DENOMINATOR, EVER. Under any tie-aware scheme the count of places and the
// count of rows are different numbers, and neither is usable next to a rank:
// "of 811" reads as mid-table for a show with two boosts, since 51% of shows
// have two or fewer. The caption names the feed and links to it instead.
//
// ── WHICH LIST ───────────────────────────────────────────────────────────────
//
// "Rank" means the position the subject's card holds on the feed a reader can
// go and scroll, so the query restates that feed's definition rather than a
// plausible cousin of it:
//   • the FEED is chosen by the medium partition — a music show ranks among
//     Albums and every other show among Shows, an episode of a music feed among
//     Songs and every other among Episodes. The same
//     `COALESCE(medium,'podcast') <> 'music'` the API uses, so an unidentified
//     show ranks where its card actually is: on Shows.
//   • ALL TIME and ALL LANGUAGES: the precomputed aggregate columns, no window
//     and no `lang`. A rank on a filtered view would be true of a list most
//     readers of this page will never have on screen.
//   • Global, never Follows.
//
// COST. ⚠️ ZERO CHART ROWS FROM D1 ON A WARM CACHE, SINCE 2026-09-07. Each
// (kind, medium side, window) leaderboard is computed once, kept in KV for
// five minutes and looked up per subject — see THE CHART TABLE CACHE below
// for the numbers that forced it (an episode page was 590k rows read, four
// population-wide RANK() queries per view, and crawlers made D1 read 12
// billion rows in a day). The all-time component chips come out of the same
// table, so the COUNT(CASE …) scan that used to compute them is gone too.
//
// ⚠️ IT NEVER THROWS. A rank is decoration on a page about a show's boosts, so
// a failure costs the rank line and nothing else — the discipline the two
// podroll queries set. `feedRanks` resolves null on any error and the renderer
// prints tiles without a rank line, which is exactly what /booster renders.

// The three sorts, which are also the three stat tiles' keys.
//
// ⚠️ THE THIRD KEY DIFFERS BY SUBJECT AND THE TILES SAY WHY. A show or an
// episode's third figure is how many PEOPLE boosted it; a booster's is how many
// SHOWS they boosted. Both are the breadth axis of the list the subject is
// ranked on — `boosters` on Shows/Episodes, `shows` on the members wall — but
// they are different columns and different words, so one shared array would
// have quietly ranked a person by a column that does not exist for them.
const RANK_KEYS = ["sats", "boosts", "boosters"];
const BOOSTER_RANK_KEYS = ["sats", "boosts", "shows"];

/* The publisher aggregates in this file carry the artist tier's MUSIC-ONLY
 * filter (2026-08-31, Reed's call — see ../api/v1/publishers.js): a chip
 * claims a place on the Artists list, and that list counts only the declaring
 * music shows now, so the populations here must count the same corpus. */
/* ⚠️ RESTATED FROM functions/api/v1/_common.js, WHICH THIS FILE MAY NOT IMPORT
 * WITHOUT DRAGGING THE WHOLE API SURFACE IN. The members wall drops these five
 * keys from its listing, so a booster rank computed over a population that
 * INCLUDED them would be a rank on a list the reader cannot scroll: every
 * member below a publisher would be one place worse here than on the wall.
 * **The two copies must stay in step.** (chadf-boostbot came off both on
 * 2026-08-30, and Boostr_Bot joined both on 2026-09-10; see the note on
 * PUBLISHERS for why.) */
const RANK_PUBLISHERS = [
  "d35ae076512c29b01a5b33aa764ed4db44a9d0bbd96009705f48101f6cfe76a2",
  "c330881e28768381dd8bdfd274341dca0c5882c29b8642ea4bc82f7563264592",
  "3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9",
  "3820f4ff8587747530c7feafe47c1e592e3ce0fd2929b4f907e40714bd26f408",
  "adab4ccd313996520304a5b1ec6c4076bc271bc6a3236702321c5811009d0649",
];

/* ⚠️ THE ONLYBOOSTS CHARTS POSITION — rank in sats + rank in boosts + rank in
 * the subject's breadth key (boosters for content, shows boosted for a
 * member), summed, lowest total first; ties break breadth → sats → boosts and
 * a remaining tie is shared (T#). Reed's spec, 2026-08-31; the design record
 * is "The OnlyBoosts Charts" in docs/feeds.md.
 *
 * The population is the SAME list the three component chips are computed over
 * — the medium partition for a show or an episode, the wall's publisher
 * exclusion for a member, the title-less exclusion for a publisher — so the
 * chart place and the component ranks always describe one corpus. Global and
 * all languages always: the feedRanks doctrine at the top of this file.
 *
 * ⚠️ THE QUERY RANKS THE WHOLE POPULATION AND RETURNS ALL OF IT, SINCE
 * 2026-09-07. It used to end `WHERE id = ?` and run four times per page view
 * (all time + the three windows), which is the same work with one row kept:
 * D1 counted 286k rows read for the all-time episode chart and ~92k for a
 * windowed one, so an episode page cost ~590k rows and a booster page ~540k,
 * and 70% of those page views were SEO and AI crawlers walking the sitemap.
 * D1 read 12 BILLION rows on 2026-09-04 against 200M/day the week before the
 * strip shipped, and the month's included allowance ran out that day. The
 * leaderboard is identical for every subject; only the lookup differs. So
 * `chartTable` computes it once, keeps it in KV (see there), and every page
 * looks its subject up in the cached table. The three all-time component
 * chips come out of the same table (`r_*`/`t_*` are exactly the ahead+1 and
 * at counts the old COUNT(CASE …) queries produced), so a page render on a
 * warm cache reads NO chart rows from D1 at all.
 *
 * ⚠️ A `cutoff` (unix seconds) makes it one WINDOW's chart. The base becomes
 * the same boost-time GROUP BY the four endpoints run for a windowed
 * `sort=chart` (aggEpisodes in episodes.js, the `p.cutoff` branches of
 * podcasts.js and publishers.js, the members AGG join), so a cell on the
 * strip agrees with the windowed feed view it links to. No cutoff keeps the
 * precomputed all-time aggregates, which are cheaper and identical by
 * construction (d1_sync keeps them true).
 *
 * The booster population is the wall's, publisher exclusion and all: rank
 * means the place the subject holds on a list a reader can go and scroll, and
 * that list is `/api/v1/members` with no `q`. A publisher's own page gets no
 * chips and it falls out for free — the subject is not in the table, so the
 * lookup finds nothing, which is the honest answer: those keys are
 * deliberately not on the wall, so they hold no place on it. The publisher
 * population restates `/api/v1/publishers`' aggregate: boosts joined through
 * the declaring MUSIC shows, grouped by publisher, the title-less row
 * excluded. */
function chartPopulationQuery(kind, music, cutoff = null) {
  let base = null;
  const args = [];
  if (kind === "booster") {
    const holes = RANK_PUBLISHERS.map(() => "?").join(",");
    args.push(...RANK_PUBLISHERS);
    base = `
      SELECT booster_pubkey AS id,
             COALESCE(SUM(sats), 0)       AS m_sats,
             COUNT(*)                     AS m_boosts,
             COUNT(DISTINCT podcast_guid) AS m_breadth
        FROM boosts
       WHERE booster_pubkey NOT IN (${holes})${cutoff ? `
         AND created_at >= ?` : ""}
       GROUP BY booster_pubkey`;
    /* ⚠️ THE WINDOWED BASE NAMES ITS INDEX. Left to itself the planner
     * serves the GROUP BY off idx_boosts_booster (or _item / _podcast below)
     * and filters the date afterwards, reading all ~40k boosts for a week
     * that holds 500 — measured 2026-09-07: 79k rows for the member week,
     * 37k for the episode week. A range scan of idx_boosts_created and a
     * sort is the cheap plan, and INDEXED BY is how SQLite is told so. The
     * all-time bases stay on their own plan (no date to range on). */
    if (cutoff) base = base.replace("FROM boosts", "FROM boosts INDEXED BY idx_boosts_created");
    if (cutoff) args.push(cutoff);
  } else if (kind === "publisher") {
    base = `
      SELECT pc.publisher_guid                AS id,
             COALESCE(SUM(b.sats), 0)         AS m_sats,
             COUNT(*)                         AS m_boosts,
             COUNT(DISTINCT b.booster_pubkey) AS m_breadth
        FROM boosts b
        JOIN podcasts pc    ON pc.podcast_guid    = b.podcast_guid
        JOIN publishers pub ON pub.publisher_guid = pc.publisher_guid
       WHERE pub.title IS NOT NULL
         AND COALESCE(pc.medium,'podcast') = 'music'${cutoff ? `
         AND b.created_at >= ?` : ""}
       GROUP BY pc.publisher_guid`;
    if (cutoff) args.push(cutoff);
  } else {
    const isEpisode = kind === "episode";
    // The medium partition, restated from the API: never `= 'podcast'`.
    const op = music ? "=" : "<>";
    if (cutoff) {
      /* Windowed: every figure is the window's own, recomputed over `boosts`
       * exactly as the endpoints' windowed GROUP BY recomputes it — the
       * precomputed columns are all-time totals and would rank the wrong
       * corpus. A subject with no boost in the window has no row, which is
       * the honest null the dash cell renders. */
      const col = isEpisode ? "item_guid" : "podcast_guid";
      args.push(cutoff);
      base = `
      SELECT b.${col}                          AS id,
             COALESCE(SUM(b.sats),0)           AS m_sats,
             COUNT(*)                          AS m_boosts,
             COUNT(DISTINCT b.booster_pubkey)  AS m_breadth
        FROM boosts b INDEXED BY idx_boosts_created
        LEFT JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
       WHERE b.${col} IS NOT NULL
         AND b.created_at >= ?
         AND COALESCE(pc.medium,'podcast') ${op} 'music'
       GROUP BY b.${col}`;
    } else base = isEpisode
      ? `
      SELECT e.item_guid                  AS id,
             COALESCE(e.total_sats,0)     AS m_sats,
             COALESCE(e.boost_count,0)    AS m_boosts,
             COALESCE(e.booster_count,0)  AS m_breadth
        FROM episodes e
        LEFT JOIN podcasts pc ON pc.podcast_guid = e.podcast_guid
       WHERE COALESCE(pc.medium,'podcast') ${op} 'music'`
      : `
      SELECT p.podcast_guid               AS id,
             COALESCE(p.total_sats,0)     AS m_sats,
             COALESCE(p.boost_count,0)    AS m_boosts,
             COALESCE(p.booster_count,0)  AS m_breadth
        FROM podcasts p
       WHERE COALESCE(p.medium,'podcast') ${op} 'music'`;
  }
  /* ⚠️ ONLY THE BASE ROWS COME BACK; THE RANKING IS DONE IN rankTable BELOW.
   * The SQL version of this ranking — three RANK() windows and four COUNT()
   * OVER (PARTITION BY …) windows on top of the base — re-scanned the
   * materialized rows once per window, so 12k episodes cost D1 286k rows
   * read. The base alone is one pass: ~24k for the all-time episode table
   * (the podcasts join for the medium), a few thousand for a windowed one.
   * That is what makes a two-minute refresh affordable. rankTable restates
   * the window functions' semantics exactly, and test-charts.mjs holds the
   * result to the same brute-forced expectations the API's SQL is held to. */
  return { sql: base, args };
}

/* Competition ranks (1-2-2-4) over one column, descending, plus each row's
 * tie-group size — RANK() OVER (ORDER BY v DESC) and COUNT(*) OVER
 * (PARTITION BY that rank), in one sort. O(n log n); rank.js#chartRanks does
 * the same job for a drawer's few dozen rows with a quadratic count that
 * would take seconds on 12k. */
function compRanks(vals) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[b] - vals[a]);
  const rank = new Array(vals.length), at = new Array(vals.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j < idx.length && vals[idx[j]] === vals[idx[i]]) j++;
    for (let k = i; k < j; k++) { rank[idx[k]] = i + 1; at[idx[k]] = j - i; }
    i = j;
  }
  return [rank, at];
}

/* The chart over the base rows: the three component ranks, the chart place
 * (rank in sats + rank in boosts + rank in breadth, lowest first; ties break
 * breadth → sats → boosts, a remaining tie shared) and every tie-group size,
 * as `id → TABLE_COLS`. Same standing rank.js#chartRanks computes for the
 * drawers and the API's SQL computes for sort=chart. */
function rankTable(results) {
  const n = results.length;
  const S = new Array(n), B = new Array(n), K = new Array(n);
  for (let i = 0; i < n; i++) {
    S[i] = Number(results[i].m_sats) || 0;
    B[i] = Number(results[i].m_boosts) || 0;
    K[i] = Number(results[i].m_breadth) || 0;
  }
  const [rS, tS] = compRanks(S), [rB, tB] = compRanks(B), [rK, tK] = compRanks(K);
  const score = new Array(n);
  for (let i = 0; i < n; i++) score[i] = rS[i] + rB[i] + rK[i];
  const order = S.map((_, i) => i).sort((a, b) => score[a] - score[b] || K[b] - K[a] || S[b] - S[a] || B[b] - B[a]);
  const same = (a, b) => score[a] === score[b] && K[a] === K[b] && S[a] === S[b] && B[a] === B[b];
  const rows = {};
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && same(order[j], order[i])) j++;
    for (let k = i; k < j; k++) {
      const r = order[k];
      rows[results[r].id] = [i + 1, j - i, S[r], B[r], K[r], rS[r], rB[r], rK[r], tS[r], tB[r], tK[r]];
    }
    i = j;
  }
  return rows;
}

/* ⚠️ THE WINDOWS ARE THE FEED BAR'S RANGES and the keys are the hash's own
 * (`range=1w`), so a strip cell's link opens exactly the list it ranks on.
 * A new range in feed-controls.js RANGE_OPTIONS + the endpoints' RANGE_DAYS
 * wants a row here too, or the strip simply doesn't show it. */
const CHART_WINDOWS = [["1w", 7], ["1m", 30], ["1y", 365]];
const WINDOW_DAYS = Object.fromEntries(CHART_WINDOWS);

/* ── THE CHART TABLE CACHE ───────────────────────────────────────────────────
 *
 * One entry per (kind, medium side, window): `{ t, cutoff, rows }` where
 * `rows` maps a subject id to the eleven numbers the population query
 * returns, in TABLE_COLS order. The all-time episode table is the largest,
 * ~12k ids and ~1MB of JSON; KV's ceiling is 25MB.
 *
 * WHERE IT LIVES. `env.CHART_KV` if the project ever binds a namespace of its
 * own, else `env.SIGN_RATELIMIT` — the KV namespace the signing oracle's rate
 * limiter already has bound to the Pages project (its keys are `rl:`-prefixed,
 * these are `chart:`, and a namespace is a flat key space, so they share it
 * without meeting). Reusing it is what made this fix a push rather than a
 * dashboard change plus a redeploy; `chartCacheOf(context)` picks. With no KV
 * at all — the tests, a local `wrangler pages dev` without the binding — the
 * table is computed per call, which is exactly what every render did before.
 *
 * FRESHNESS. `CHART_TTL_SECS` is the logical age at which a table is stale;
 * the KV entry itself lives `CHART_KV_TTL_SECS` so a stale copy is still
 * there to serve. A stale hit is served AS IS and refreshed in the
 * background through `waitUntil` (or awaited, when the caller has none), so
 * a reader never waits on the population query except on a cold key. A
 * 60-second `:lock` key keeps a burst of crawler hits at expiry from all
 * refreshing the same table at once — best-effort, KV being eventually
 * consistent, and that is enough: the failure it bounds is a handful of
 * duplicate computations, not a wrong answer.
 *
 * ⚠️ TWO MINUTES IS THE COLLECTOR'S TICK — Reed's call, 2026-09-07: a boost
 * that is on the site is on the strip too, so a share-card screenshot
 * matches everything around it. It was five minutes for the first hour of
 * this cache's life, on the page's own `max-age=300`; what made two
 * affordable is rankTable — the SQL ranking cost 286k rows per all-time
 * episode table, the base-only query ~24k. Worst case, every table hot in
 * every window all day: 720 refreshes × the ~450k rows all 24 bases add up
 * to (measured 2026-09-07, INDEXED BY in place) ≈ 0.3B rows/day, against the
 * 25B/month D1 includes; a quiet population
 * is never refreshed at all, since a refresh only follows a request. The
 * windowed tiles' FIGURES come out of the same table, so a boost sent a
 * minute ago shows on the all-time row (the page's own live totals) before
 * it shows on the Week row, by at most one tick. (Cloudflare's edge does not
 * cache HTML or JSON on `max-age` alone — `cf-cache-status: DYNAMIC` on every
 * Function response until a Cache Rule says the paths are eligible — which
 * is why the pages' own header never absorbed a single crawler hit.)
 *
 * ⚠️ `cutoff` IS STORED WITH THE TABLE. A windowed table is "the last N days
 * as of `t`", and a lookup must not recompute the boundary — the figures in
 * it were counted against the stored cutoff. */
const CHART_TTL_SECS = 120;
const CHART_KV_TTL_SECS = 3600;
const CHART_LOCK_SECS = 60;
const CHART_CACHE_VERSION = 1;
const TABLE_COLS = ["rank", "peers", "m_sats", "m_boosts", "m_breadth",
  "r_sats", "r_boosts", "r_breadth", "t_sats", "t_boosts", "t_breadth"];

/**
 * The cache options `feedRanks` takes, off a Pages Function context:
 * `{ kv, waitUntil }`. Prefers a dedicated `CHART_KV` binding, falls back to
 * the oracle's `SIGN_RATELIMIT` namespace, and hands back `{}` when neither
 * is bound so the caller degrades to computing per render.
 */
export function chartCacheOf(context) {
  const env = context?.env || {};
  const kv = env.CHART_KV || env.SIGN_RATELIMIT || null;
  const usable = kv && typeof kv.get === "function" && typeof kv.put === "function";
  return {
    kv: usable ? kv : null,
    waitUntil: typeof context?.waitUntil === "function" ? context.waitUntil.bind(context) : null,
  };
}

function chartKey(kind, music, win) {
  const side = kind === "show" || kind === "episode" ? (music ? "music" : "other") : "all";
  return `chart:v${CHART_CACHE_VERSION}:${kind}:${side}:${win}`;
}

async function computeTable(db, kind, music, win) {
  const t = Math.floor(Date.now() / 1000);
  const cutoff = win === "all" ? null : t - WINDOW_DAYS[win] * 86400;
  const q = chartPopulationQuery(kind, music, cutoff);
  const { results } = await db.prepare(q.sql).bind(...q.args).all();
  return { t, cutoff, rows: rankTable(results || []) };
}

async function refreshTable(db, kv, key, kind, music, win, background) {
  if (background) {
    const lock = `${key}:lock`;
    if (await kv.get(lock).catch(() => null)) return null;
    await kv.put(lock, "1", { expirationTtl: CHART_LOCK_SECS }).catch(() => {});
  }
  const table = await computeTable(db, kind, music, win);
  await kv.put(key, JSON.stringify(table), { expirationTtl: CHART_KV_TTL_SECS }).catch((err) => {
    console.warn("[feed-rank] chart cache put failed", err);
  });
  return table;
}

/* The chart table for one population and window, from KV when there is one.
 * Resolves the `{ t, cutoff, rows }` record; throws only if the population
 * query itself fails, which chartPlace catches. */
async function chartTable(db, kind, music, win, cache) {
  const kv = cache?.kv;
  if (!kv) return computeTable(db, kind, music, win);
  const key = chartKey(kind, music, win);
  let hit = null;
  try {
    hit = await kv.get(key, { type: "json", cacheTtl: 60 });
  } catch (err) {
    console.warn("[feed-rank] chart cache get failed", err);
  }
  if (hit && hit.rows && typeof hit.rows === "object" && Number.isFinite(hit.t)) {
    if (Math.floor(Date.now() / 1000) - hit.t > CHART_TTL_SECS) {
      const refresh = refreshTable(db, kv, key, kind, music, win, true)
        .catch((err) => console.warn("[feed-rank] chart refresh failed", err));
      if (cache.waitUntil) cache.waitUntil(refresh); else await refresh;
    }
    return hit;
  }
  return refreshTable(db, kv, key, kind, music, win, false);
}

/* One subject's place in a table: { rank, tied, figures, ranks } or null when
 * the subject is not in the population — outside the window, the wrong
 * medium side, a publisher key on /booster. Same honest silence the old
 * per-subject query kept. */
function placeIn(table, id) {
  const v = table && table.rows ? table.rows[id] : null;
  if (!v) return null;
  const r = Object.fromEntries(TABLE_COLS.map((c, i) => [c, v[i]]));
  if (!Number.isFinite(r.rank) || r.rank < 1) return null;
  const comp = (k) => ({ rank: r[`r_${k}`], tied: r[`t_${k}`] > 1 });
  return {
    rank: r.rank, tied: r.peers > 1,
    figures: { sats: r.m_sats || 0, boosts: r.m_boosts || 0, breadth: r.m_breadth || 0 },
    ranks: { sats: comp("sats"), boosts: comp("boosts"), breadth: comp("breadth") },
  };
}

/* Resolves { rank, tied, figures, ranks } or null; its own catch, so a chart
 * failure costs the chart line and never the chips beside it.
 *
 * `figures` and `ranks` joined on 2026-09-03 (Reed's ask: the stat tiles
 * follow the window picked on the strip): the window's own sats, boosts and
 * breadth for the subject, and its competition rank on each — the same
 * `RANK()` the chart is summed from, so a windowed tile's chip and the chart
 * cell above it are one computation. `breadth` is the third key, whatever the
 * kind calls it; attachChart names it. */
async function chartPlace(db, kind, music, id, win, cache) {
  try {
    const table = await chartTable(db, kind, music, win, cache);
    return placeIn(table, id);
  } catch (err) {
    console.warn("[feed-rank] chart query failed", err);
    return null;
  }
}

/* The all-time place plus the three windowed ones, in parallel — each
 * chartPlace carries its own catch, so one failed window costs one dash and
 * never the strip. `chart` keeps its historical meaning (the all-time place)
 * because test-charts.mjs and this file's own callers read it.
 *
 * `windows` (2026-09-03) is the tiles' half of the same answers: per window,
 * the subject's figures under the page's own stat keys and its component
 * ranks under the same keys, or null where the subject has no boost in the
 * window — which the renderer prints as three zeros with no chips, the
 * honest figure rather than a missing row. The breadth key is renamed here
 * to what the kind's tiles call it (`shows` on /booster, `boosters`
 * elsewhere), so renderStatTiles can look figures up by `stat.key`. */
async function attachChart(db, kind, music, id, all, out, cache) {
  const wins = await Promise.all(CHART_WINDOWS.map(([key]) => chartPlace(db, kind, music, id, key, cache)));
  out.chart = all;
  out.chartWindows = { all };
  CHART_WINDOWS.forEach(([key], i) => { out.chartWindows[key] = wins[i]; });
  const breadthKey = kind === "booster" ? "shows" : "boosters";
  const windowOf = (c) => c && {
    sats: c.figures.sats, boosts: c.figures.boosts, [breadthKey]: c.figures.breadth,
    ranks: { sats: c.ranks.sats, boosts: c.ranks.boosts, [breadthKey]: c.ranks.breadth },
  };
  out.windows = {};
  for (const key of Object.keys(out.chartWindows)) out.windows[key] = windowOf(out.chartWindows[key]) || null;
}

/**
 * The three all-time global ranks for a subject, plus its chart places.
 *
 * Resolves `{ sats:{rank,tied}, boosts:{…}, boosters:{…} }` (`shows` in place
 * of `boosters` for a booster) with `chart`, `chartWindows` and `windows`
 * attached, or null; never rejects. `tied` is true when at least one other
 * row holds the same place.
 *
 * ⚠️ NULL MEANS THE SUBJECT IS NOT ON THE LIST. Three ways that happens, and
 * all three want silence rather than a number: a medium mismatch between the
 * population and the row we were handed, a booster whose key is one of the
 * four the wall excludes, and a subject with no rows at all. Printing a rank
 * on a list the subject is not on is worse than printing none.
 *
 * @param {D1Database} db
 * @param {"show"|"episode"|"booster"|"publisher"} kind
 * @param {object} row  the subject's own D1 row: `podcast_guid` or `item_guid`
 *   (and for a show its `medium`, for an episode the show's medium as
 *   `p_medium`); `pk` for a booster; `guid` for a publisher.
 * @param {{kv?:object, waitUntil?:function}} [cache]  from chartCacheOf; omit
 *   to compute per call.
 */
export async function feedRanks(db, kind, row, cache = null) {
  try {
    let id = null, music = false;
    if (kind === "booster") id = row?.pk || null;
    else if (kind === "publisher") id = row?.guid || null;
    else if (kind === "episode") { id = row?.item_guid || null; music = row?.p_medium === "music"; }
    else { id = row?.podcast_guid || null; music = row?.medium === "music"; }
    if (!id) return null;

    const all = await chartPlace(db, kind, music, id, "all", cache);
    if (!all) return null;
    const keys = kind === "booster" ? BOOSTER_RANK_KEYS : RANK_KEYS;
    const out = {};
    keys.forEach((k, i) => { out[k] = all.ranks[["sats", "boosts", "breadth"][i]]; });
    await attachChart(db, kind, music, id, all, out, cache);
    return out;
  } catch (err) {
    console.warn("[feed-rank] rank query failed", err);
    return null;
  }
}

// The pages' own two formatters, so a windowed tile prints its figure exactly
// as the all-time tile the page built prints its own: compact sats ("163.5k"),
// plain thousands for the counts. Both modules are two-sided and dependency-
// light; the Functions already import them through _shared/detail-page.js.
import { compact } from "../../assets/js/supporter-wall.js";
import { num } from "../../assets/js/boost-list.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const numFmt = (n) => Number(n).toLocaleString("en-US");

/** `#4`, or `T#118` when the place is shared. The T is golf's notation and is
 *  the most widely recognised tie marker there is; the caption defines it. */
function chip(r) {
  return `${r.tied ? "T" : ""}#${numFmt(r.rank)}`;
}

/**
 * ⚠️ THE CHIP IS DRAWN ONLY INSIDE THE TOP 100. Reed's call, 2026-08-21,
 * reversing the "no cutoff" decision of 2026-08-18 — and the reasoning that
 * decision rested on still holds, which is why this is a display rule rather
 * than a change to `feedRanks`. **A competition rank is never false**, however
 * large; `T#2,274` is an honest statement about an episode with two boosts.
 *
 * What changed is what it is FOR. The chip sits in a stat tile's corner, which
 * is the sports-card idiom for a standing worth knowing — and 51% of shows have
 * two boosts or fewer, so on most pages it was labelling the long tail with a
 * number nobody would quote. A distinction printed on every page is not a
 * distinction; it is a row count wearing a medal.
 *
 * ⚠️ IT IS A BOUNDARY ON THE RANK, NOT ON THE TIE GROUP. A rank of exactly 100
 * prints even when it is `T#100` shared by fifty rows, because the rank is what
 * the reader is being told and it is correct. Nothing here re-derives standing.
 *
 * The rest falls out for free: `anyRank` stays false when nothing qualifies, so
 * the caption and the reserved chip line disappear with it and the page renders
 * exactly as `/booster` already does.
 */
const RANK_CUTOFF = 100;

/* The strip's four cells: window key (the hash's own `range` spelling), the
 * label on the cell, and the phrase its tooltips speak. The first three rows
 * restate CHART_WINDOWS above — the keys must match or a computed window
 * simply never renders. */
const CHART_CELLS = [
  ["1w", "Week", "this week"],
  ["1m", "Month", "this month"],
  ["1y", "Year", "this year"],
  ["all", "All time", "all time"],
];

/**
 * The stat tiles with the rank folded into each: value, label, then the rank as
 * a corner chip. One tile per stat, in the order given; the rank is drawn only
 * where `ranks` resolved and the stat carries a `key` the ranks know, so a
 * failed query costs the chip and nothing else and /booster can pass null.
 *
 * ⚠️ ONLY A TOP-100 RANK IS DRAWN — see RANK_CUTOFF. A page whose every stat
 * falls outside it renders bare tiles, which is the same output /booster
 * produced before it had ranks.
 *
 * ⚠️ THE TILES FOLLOW THE WINDOW PICKED ON THE STRIP (2026-09-03, Reed's ask).
 * The Charts strip used to be four chart places over ONE row of all-time
 * figures, with a caption under the row saying "Rank on the all-time Shows
 * feed". Now every window the strip names has a row of tiles of its own —
 * that window's sats, boosts and breadth for the subject, each with its chip
 * on that window's own list — and the strip cell is the selector. Four <dl>s
 * ship in the document, all but All time `hidden`; the verb (which one is on
 * screen) is initStatWindows in assets/js/detail-page.js, and a reader with
 * no JavaScript sees exactly the all-time row this always rendered. The
 * caption is gone with the change: the figures ARE the period selected, so a
 * line saying which period would restate the highlighted cell. What the
 * caption also said — that T marks a tie — is in every chip's tooltip.
 *
 * The all-time row is built from the `stats` the page passed, verbatim — the
 * page's own labels, values and exact tooltips — so that row renders as it
 * always did. The three windowed rows are built from `ranks.windows`, through
 * the same two formatters the pages use and the same singular/plural rule the
 * pages apply (sats never singularizes). A window in which the subject has no
 * boost is three zeros and no chips: `windows[key]` is null there, and zero is
 * the true figure.
 *
 * @param {{key?:string,label:string,value:string,exact:string}[]} stats
 * @param {object|null} ranks  from feedRanks
 * @param {{rankFeed:string, backHref:string, chartHref?:string, chartBreadth?:string}} copy
 */
export function renderStatTiles(stats, ranks, copy) {
  /* One row of tiles. `figures` is null for the all-time row (the page's own
   * strings are used); for a window it is that window's record, whose `ranks`
   * carry the chips. `phrase` is the tooltip's window ("this week"). */
  const tilesFor = (windowKey, rowRanks, figures, phrase) => {
    const tiles = stats.map((s) => {
      let label = s.label, value = s.value, exact = s.exact;
      if (figures) {
        const n = Number(figures[s.key]) || 0;
        // The page's rule: "1 boost", "2 boosts"; sats is never singular.
        const plural = /s$/.test(s.label) ? s.label : s.label + "s";
        label = n === 1 && s.key !== "sats" ? plural.replace(/s$/, "") : plural;
        value = s.key === "sats" ? compact(n) : num(n);
        exact = num(n);
      }
      const r = rowRanks && s.key ? rowRanks[s.key] : null;
      let rankEl = "";
      if (r && r.rank <= RANK_CUTOFF) {
        const tip = r.tied
          ? `Tied for ${chip(r).slice(1)} by ${s.key} on the ${copy.rankFeed} feed ${phrase}`
          : `${chip(r)} by ${s.key} on the ${copy.rankFeed} feed ${phrase}`;
        rankEl = `<dd class="show-stat-rank" title="${esc(tip)}">${esc(chip(r))}</dd>`;
      }
      // ⚠️ THE MODIFIER IS WHAT RESERVES THE CHIP'S LINE. The rank is pinned to
      // the tile's top corner, so the tile has to open a gap for it — but only a
      // tile that HAS one, or rankless tiles would carry dead space above the
      // figure. A `:has()` rule would do it without the class and is silently a
      // no-op wherever :has() is unsupported, which is the one failure mode
      // here that shows as an overlapping number rather than a spacing nit.
      const cls = rankEl ? "show-stat show-stat--ranked" : "show-stat";
      return `<div class="${cls}"><dt>${esc(label)}</dt><dd title="${esc(exact)}">${esc(value)}</dd>${rankEl}</div>`;
    });
    const hidden = windowKey === "all" ? "" : " hidden";
    return `<dl class="show-stats" data-window="${windowKey}"${hidden}>
      ${tiles.join("\n      ")}
    </dl>`;
  };

  const breadth = copy.chartBreadth || "boosters";
  const cw = ranks && (ranks.chartWindows || (ranks.chart ? { all: ranks.chart } : null));

  /* No chart data at all (a failed query, or a caller from before the strip):
   * the all-time row alone, with whatever chips the component ranks give it,
   * and no strip — there is nothing to select between. */
  if (!cw) return tilesFor("all", ranks, null, "all time");

  /* ⚠️ THE CHARTS STRIP — the subject's OnlyBoosts Charts position in each of
   * the four boost-time windows (Week · Month · Year · All time), above the
   * tiles, and since 2026-09-03 ALSO THE TILES' WINDOW SELECTOR. It replaced
   * the single all-time line on 2026-08-31 (Reed's pick, option A of the
   * windows design pass — the Billboard idiom: the current window is the news,
   * the all-time standing is the record). The tint that used to mark the
   * all-time cell now marks the SELECTED cell, which opens on All time, so a
   * page with no JavaScript looks as it did.
   *
   * Each charted cell is a link to that window's chart view — the hash already
   * addresses it (`?sort=chart&range=1w`; the all-time cell elides the default
   * range) — and initStatWindows takes over a plain click to select the window
   * in place; a modifier-click or middle-click still follows the link.
   * /booster overrides every target via `copy.chartHref`, its chart living on
   * the members wall rather than behind a sort key the Members hash would
   * drop. The label links to /about#charts, where the formula is stated in
   * full, and carries it as a tooltip too.
   *
   * The same top-100 gate as the chips applies PER WINDOW. A window past the
   * gate is an em-dash whose tooltip says which of two things the dash means
   * — outside the top 100, or no boosts in the window at all (chartPlace
   * resolves null when the subject has no row in the windowed corpus) — and
   * a dash cell is a <button>, not a link: sending a reader to a list the
   * subject is not on answers a question nobody asked, but the cell still has
   * to select its window. THE STRIP IS NO LONGER WITHHELD when nothing charts:
   * a row of four dashes is still the way to the other three rows of tiles. */
  const labelTip = `Rank in sats + rank in boosts + rank in ${breadth}, summed — lowest total first, within each time window. Ties break by ${breadth}, then sats, then boosts; T marks a remaining tie.`;
  const cells = CHART_CELLS.map(([key, win, phrase]) => {
    const c = cw[key];
    const sel = key === "all" ? ` aria-current="true"` : "";
    const winEl = `<span class="show-chart-win">${win}</span>`;
    if (c && c.rank <= RANK_CUTOFF) {
      const href = copy.chartHref || `${copy.backHref}?sort=chart${key === "all" ? "" : `&range=${key}`}`;
      return `<a class="show-chart-cell" data-window="${key}"${sel} href="${esc(href)}" title="${esc(`${chip(c)} on the OnlyBoosts Charts ${phrase}`)}">${winEl}<span class="show-chart-rank">${esc(chip(c))}</span></a>`;
    }
    /* One wording for both nulls (no boosts in the window, or ranked past
     * the gate): the chart's claim is the top 100, and "outside the top
     * 100" is true either way — Reed's call, 2026-08-31, replacing a
     * "No boosts" variant that answered a question the chart isn't asking. */
    return `<button type="button" class="show-chart-cell show-chart-cell--none" data-window="${key}"${sel} title="${esc(`Outside the top 100 ${phrase}`)}">${winEl}<span class="show-chart-rank">—</span></button>`;
  });
  const chartStrip = `<nav class="show-chart" aria-label="OnlyBoosts Chart Positions by time window">
      <a class="show-chart-label" href="/about#charts" title="${esc(labelTip)}">OnlyBoosts Chart Positions</a>
      <div class="show-chart-strip" data-stat-window-picker>${cells.join("")}</div>
    </nav>`;

  /* The rows: all time from the page's strings, each other window from its
   * record. A caller with no `windows` (test fixtures from before this, or a
   * failed attach) gets the all-time row alone under the strip. */
  const rows = [tilesFor("all", ranks, null, "all time")];
  if (ranks.windows) {
    for (const [key, , phrase] of CHART_CELLS) {
      if (key === "all") continue;
      const w = ranks.windows[key];
      rows.push(tilesFor(key, w ? w.ranks : null, w || {}, phrase));
    }
  }
  return `${chartStrip}
    <div class="show-stats-windows" data-stat-windows>
    ${rows.join("\n    ")}
    </div>`;
}
