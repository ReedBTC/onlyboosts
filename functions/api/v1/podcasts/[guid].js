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
import { json, preflight, BOOST_SELECT, boostRecord, clampLimit } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// The busiest show in the index has 210 boosters, so this is a guard against a
// pathological row rather than a page size — the landing page paints them all.
const SUPPORTER_CAP = 500;

export async function onRequestGet({ request, env, params }) {
  const guid = params.guid;
  const u = new URL(request.url);

  const show = await env.DB.prepare(
    `SELECT podcast_guid, title, image, artwork, feed_url, medium, author, boost_count, total_sats,
            booster_count, episode_count, latest_ts FROM podcasts WHERE podcast_guid = ?`
  ).bind(guid).first();
  if (!show) return json(request, { error: "podcast not found" }, { status: 404 });

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
