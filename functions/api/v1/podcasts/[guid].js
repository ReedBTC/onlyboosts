// GET /api/v1/podcasts/:guid — one show: aggregate + episodes + supporters + recent boosts.
//
// Serves both the Shows feed's detail drawer and the /show/<guid> landing page
// (see docs/show-pages-spec.md).
//
// Two things here are load-bearing for the landing page:
//
//   1. `description` is NOT in the episode list. It was, and it was 54% of the
//      response by weight (67KB → ~31KB on Citadel Dispatch) for text no caller
//      renders until a drawer opens. Ask for one episode's shownotes with
//      ?shownotes=<item_guid>.
//   2. `supporters` ranks boosters by sats sent TO THIS SHOW, all time. Opt in
//      with ?supporters=1 — the Shows feed doesn't need it and it's a GROUP BY.
//   3. `?corpus=1` answers something else entirely: every boost sent to this
//      show, in one bounded response, and none of the above. See fetchShowCorpus.
import { json, preflight, BOOST_SELECT, boostRecord, clampLimit } from "../_common.js";
import { lookupMentionNames } from "../../../_shared/detail-page.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// The busiest show in the index has 210 boosters, so this is a guard against a
// pathological row rather than a page size — the landing page paints them all.
const SUPPORTER_CAP = 500;

/* ⚠️ NOT A PAGE SIZE, and generous on purpose. Measured against production on
 * 2026-08-15, the ten heaviest shows carry 1,404 / 1,010 / 910 / 861 / 643 /
 * 603 / 590 / 559 / 546 / 544 boosts, so this truncates nobody today and is a
 * guard against a future outlier rather than a window. If it ever bites,
 * `truncated` says so and the page passes that on rather than letting an order
 * over a prefix pose as an order over everything.
 *
 * The same number and the same reasoning as CORPUS_CAP in
 * functions/api/v1/boosters/[npub].js. */
const CORPUS_CAP = 2000;

export async function onRequestGet({ request, env, params }) {
  const guid = params.guid;
  const u = new URL(request.url);

  const show = await env.DB.prepare(
    `SELECT podcast_guid, title, image, artwork, feed_url, medium, author, language, boost_count, total_sats,
            booster_count, episode_count, latest_ts FROM podcasts WHERE podcast_guid = ?`
  ).bind(guid).first();
  if (!show) return json(request, { error: "podcast not found" }, { status: 404 });

  /* ── every boost to this show, one response ────────────────────────────────
   *
   * Returned BEFORE the episode list, the recent-boosts page and the supporter
   * GROUP BY are built: a caller asking for the corpus wants the boosts and
   * nothing else, and running the other three would triple the cost of the one
   * request /show/<guid>#boosts makes in its life.
   *
   * GET /api/v1/boosts?podcast=<guid> is deliberately NOT the answer to this. It
   * is cursor-paged at 200 a page, so the heaviest show would take seven round
   * trips before the reader's chosen order could be applied to all of it. */
  if (u.searchParams.get("corpus") === "1") {
    return json(request, { corpus: await fetchShowCorpus(env, guid) });
  }

  // ?since=<unix> windows the EPISODE LIST to the boosts inside it, recomputing
  // each row's boosts and sats over that window. It exists for the Shows feed's
  // drawer on 1W and 1M: the card above it is showing the window's figures, so a
  // drawer listing all-time ones would contradict the card it opened from. It
  // deliberately does NOT window `show` — the caller already has the windowed
  // aggregate from /api/v1/podcasts, and recomputing it here would be a second
  // GROUP BY for a number nothing reads.
  const since = parseInt(u.searchParams.get("since"), 10);
  const windowed = Number.isFinite(since) && since > 0;
  const eps = windowed
    ? await env.DB.prepare(
        `SELECT b.item_guid, e.title, e.image, e.published, e.duration, e.episode_number,
                e.enclosure_url,
                COUNT(*)                AS boost_count,
                COALESCE(SUM(b.sats),0) AS total_sats
         FROM boosts b
         LEFT JOIN episodes e ON e.item_guid = b.item_guid
         WHERE b.podcast_guid = ? AND b.created_at >= ? AND b.item_guid IS NOT NULL
         GROUP BY b.item_guid
         ORDER BY total_sats DESC LIMIT 500`
      ).bind(guid, since).all()
    : await env.DB.prepare(
        `SELECT item_guid, title, image, published, duration, episode_number,
                enclosure_url, boost_count, total_sats
         FROM episodes WHERE podcast_guid = ? ORDER BY total_sats DESC LIMIT 500`
      ).bind(guid).all();

  // The drawer wants episodes and nothing else; the landing page wants the
  // boost notes too. Skipping them is ~50 records of the heaviest rows here.
  const wantBoosts = u.searchParams.get("boosts") !== "0";
  const limit = clampLimit(u.searchParams.get("limit"), 50, 200);
  const recent = wantBoosts
    ? await env.DB.prepare(
        `${BOOST_SELECT} WHERE b.podcast_guid = ? ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
      ).bind(guid, limit).all()
    : { results: [] };

  const body = {
    show: {
      guid: show.podcast_guid, title: show.title, img: show.image,
      // Second-chance art: <itunes:image> where it differs from <image>. Null
      // for most shows. Matches the shards' `art2`; see DATA-API.md.
      art2: show.artwork || null,
      feed: show.feed_url,
      medium: show.medium, author: show.author,
      // RSS <language>, primary subtag; null = the feed declares none, NOT English.
      language: show.language || null,
      boosts: show.boost_count, sats: show.total_sats,
      boosters: show.booster_count, episodes: show.episode_count, latest: show.latest_ts,
    },
    episodes: eps.results.map((e) => ({
      guid: e.item_guid, title: e.title, img: e.image || show.image, date: e.published,
      num: e.episode_number, duration: e.duration, url: e.enclosure_url,
      boosts: e.boost_count, sats: e.total_sats,
    })),
    boosts: recent.results.map(boostRecord),
  };

  if (u.searchParams.get("supporters")) {
    body.supporters = await fetchSupporters(env, guid);
  }

  // Shownotes for one episode, on demand. Scoped to this show so the parameter
  // can't be used to read an arbitrary episode row.
  const wantNotes = u.searchParams.get("shownotes");
  if (wantNotes) {
    const row = await env.DB.prepare(
      `SELECT description FROM episodes WHERE item_guid = ? AND podcast_guid = ?`
    ).bind(wantNotes, guid).first();
    body.shownotes = row ? row.description : null;
  }

  return json(request, body);
}

/* Every boost sent to one show, bounded and newest-first.
 *
 * ⚠️ EXPORTED, so a future caller can run it inside a page's own Promise.all
 * rather than through a subrequest — which is what functions/show/[guid].js
 * would want if it ever server-rendered more of #boosts than its opening 24.
 * The same arrangement, for the same reason, as fetchBoosterCorpus and
 * fetchCommunityBoosts.
 *
 * One row over the cap is fetched purely to detect the truncation, then dropped.
 * Asking for exactly the cap cannot tell "there are precisely this many" from
 * "there are more".
 *
 * ⚠️ `names` IS WHY THIS IS NOT JUST A WIDER LIMIT ON THE PAGED QUERY. A boost
 * message renders `nostr:npub1…` as an `@Name` chip, and the name comes from a
 * `profiles` lookup the edge runs when it renders the page. A row rebuilt in the
 * browser from a response without it would degrade its chips to truncated npubs
 * while the rows beside it, painted by the edge, showed real names — one
 * component rendering two ways, on one screen. The Primal backfill in
 * detail-page.js#hydrateProfiles still catches what this misses; it is the
 * second line of defence rather than the first.
 */
export async function fetchShowCorpus(env, guid) {
  const { results } = await env.DB.prepare(
    `${BOOST_SELECT} WHERE b.podcast_guid = ?
     ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
  ).bind(guid, CORPUS_CAP + 1).all();

  const rows = results || [];
  const truncated = rows.length > CORPUS_CAP;
  const kept = truncated ? rows.slice(0, CORPUS_CAP) : rows;
  // A plain object rather than the Map lookupMentionNames returns: this crosses
  // the wire as JSON, and the client turns it back into a Map for renderMessage.
  const names = Object.fromEntries(
    await lookupMentionNames(env, kept.map((r) => r.message))
  );
  return { boosts: kept.map(boostRecord), truncated, count: kept.length, names };
}

// Boosters ranked by sats sent to this show, all time.
//
// idx_boosts_podcast(podcast_guid, created_at DESC) already covers the WHERE,
// so this needs no new index. The ORDER BY is a TOTAL order on purpose: the
// response is edge-cached, and two supporters tied on both sats and boost count
// would otherwise swap places between renders.
async function fetchSupporters(env, guid) {
  const { results } = await env.DB.prepare(
    `SELECT b.booster_pubkey, b.booster_npub,
            SUM(COALESCE(b.sats, 0)) AS sats,
            COUNT(*)                 AS boosts,
            MAX(b.created_at)        AS latest,
            pr.name, pr.display_name, pr.picture
     FROM boosts b
     LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
     WHERE b.podcast_guid = ?
     GROUP BY b.booster_pubkey
     ORDER BY sats DESC, boosts DESC, b.booster_pubkey
     LIMIT ?`
  ).bind(guid, SUPPORTER_CAP).all();

  return results.map((r, i) => ({
    rank: i + 1,
    pk: r.booster_pubkey,
    npub: r.booster_npub,
    // display_name is the richer field where both exist; the boost records use
    // `name`, so fall through to it rather than showing a bare npub.
    name: r.display_name || r.name || null,
    pic: r.picture || null,
    sats: r.sats || 0,
    boosts: r.boosts || 0,
    latest: r.latest || null,
  }));
}
