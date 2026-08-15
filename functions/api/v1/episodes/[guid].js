// GET /api/v1/episodes/:guid — one episode: aggregate + its show + its boosts.
// GET /api/v1/episodes/:guid?community=1 — additionally, the boost corpus behind
//     "Other Episodes/Songs This Community Boosts" on /episode/<guid>.
//
// The episode-level counterpart of /api/v1/podcasts/:guid. Two things about it
// are worth knowing before touching either:
//
//   1. `item_guid` IS SOMETIMES A URL, not a UUID — 9% of the distinct guids in
//      the index contain a slash and 30 of them are full http(s) URLs. It is an
//      opaque key everywhere on this site and it is never parsed, only bound and
//      encoded. Cloudflare Pages keeps a %2F inside one path segment rather than
//      splitting on it, so `params.guid` arrives encoded and decodeURIComponent
//      recovers the original (verified against production).
//   2. THE COMMUNITY CORPUS IS THE EXPENSIVE HALF and is opt-in for that reason.
//      It is every boost sent by this episode's boosters to any OTHER episode,
//      which is what lets the client roll it up into the same episode cards the
//      homepage feed paints. Measured over all 22,366 indexed boosts, that
//      fan-out runs to a median of 248 rows, a p90 of 1,171 and a maximum of
//      3,368 — so the cap below bites on 1.6% of episodes, and the caller is
//      told when it did.
import { json, preflight, BOOST_SELECT, boostRecord, clampLimit } from "../_common.js";
import { lookupMentionNames } from "../../../_shared/detail-page.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// Every boost to this episode, not a page of them: the busiest episode in the
// index has 55 and the median has 2, so this is a guard against a pathological
// row rather than a page size.
const BOOSTS_CAP = 500;

// How many community boost rows the rollup may pull. The section is a ranked
// list of other episodes, so the corpus has to be big enough that the ranking
// means something, and small enough that a page nobody scrolls to doesn't cost
// a megabyte.
//
// Ordered newest-first, so a truncated corpus is a recent prefix of the
// community's history rather than an arbitrary slice — the same trade
// ob-live.js makes for the Follows feeds, and for the same reason. `truncated`
// says so; the client prints it under the list.
const COMMUNITY_ROWS = 2000;

export async function onRequestGet({ request, env, params }) {
  let guid = params.guid;
  if (Array.isArray(guid)) guid = guid[0];
  try { guid = decodeURIComponent(guid); } catch { /* keep the raw form */ }
  const u = new URL(request.url);

  const ep = await env.DB.prepare(
    // `booster_count` USED TO BE DERIVED HERE with a second COUNT(DISTINCT)
    // query, because the collector stored boosts and sats per episode but not
    // distinct boosters. It is a maintained column now, backfilled and written
    // on every sync, so the extra round trip is gone. Verified against the live
    // API before the change: the column and the live count agreed on all 12 of
    // the most-boosted episodes, boosts and sats included.
    `SELECT e.item_guid, e.podcast_guid, e.title, e.image, e.published, e.duration,
            e.episode_number, e.enclosure_url, e.boost_count, e.booster_count,
            e.total_sats,
            p.title AS p_title, p.image AS p_image, p.artwork AS p_artwork,
            p.feed_url AS p_feed, p.medium AS p_medium, p.author AS p_author
     FROM episodes e
     LEFT JOIN podcasts p ON p.podcast_guid = e.podcast_guid
     WHERE e.item_guid = ?`
  ).bind(guid).first();
  if (!ep) return json(request, { error: "episode not found" }, { status: 404 });

  const limit = clampLimit(u.searchParams.get("limit"), BOOSTS_CAP, BOOSTS_CAP);
  const boosts = await env.DB.prepare(
    `${BOOST_SELECT} WHERE b.item_guid = ? ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
  ).bind(guid, limit).all();

  const body = {
    episode: {
      guid: ep.item_guid,
      title: ep.title,
      img: ep.image || ep.p_image,
      date: ep.published,
      num: ep.episode_number,
      duration: ep.duration,
      url: ep.enclosure_url,
      boosts: ep.boost_count,
      sats: ep.total_sats,
      boosters: ep.booster_count || 0,
      show: {
        guid: ep.podcast_guid,
        title: ep.p_title,
        img: ep.p_image,
        art2: ep.p_artwork || null,
        feed: ep.p_feed,
        medium: ep.p_medium,
        author: ep.p_author,
      },
    },
    boosts: (boosts.results || []).map(boostRecord),
  };

  if (u.searchParams.get("community")) {
    body.community = await fetchCommunityBoosts(env, guid, ep.podcast_guid);
  }

  /* ?names=1 — display names for any npub MENTIONED inside these boost messages.
   *
   * ⚠️ NO `?corpus=1` HERE, unlike the other two boost endpoints, because
   * `boosts` above IS the corpus: it is every boost sent to this episode, capped
   * at 500 against a measured worst case of 55. A corpus mode would be the same
   * query run a second time under a second name.
   *
   * Opt-in rather than always-on, because the lookup is a query and the two
   * existing callers of this endpoint render no boost messages at all. The one
   * caller that needs it is /episode/<guid>#boosts, which rebuilds its rows in
   * the browser when the reader re-sorts and would otherwise degrade every
   * mention chip to a truncated npub while the rows the edge painted showed real
   * names. See the note over fetchShowCorpus in ../podcasts/[guid].js.
   */
  if (u.searchParams.get("names") === "1") {
    body.names = Object.fromEntries(
      await lookupMentionNames(env, (boosts.results || []).map((r) => r.message))
    );
  }

  // Shownotes on demand, matching the podcasts endpoint: `description` is the
  // one heavy column on `episodes` and no caller renders it until asked.
  if (u.searchParams.get("shownotes")) {
    const row = await env.DB.prepare(
      `SELECT description FROM episodes WHERE item_guid = ?`
    ).bind(guid).first();
    body.shownotes = row ? row.description : null;
  }

  return json(request, body);
}

/* Every boost this episode's boosters have sent to any OTHER episode.
 *
 * The community is the set of pubkeys that boosted THIS episode; the corpus is
 * their whole boost history minus this episode. The client groups it by
 * item_guid through ob-data.js#toEpisodeShape and paints the result as the same
 * episode cards the homepage feed uses, which is why this returns raw boost
 * records rather than a pre-rolled-up summary: the cards carry a drawer holding
 * the individual boosts, and the sort and range controls both operate over the
 * ungrouped rows.
 *
 * EVERY FIGURE IT PRODUCES IS COMMUNITY-SCOPED BY CONSTRUCTION, the same
 * property the show page's equivalent has: the join means only boosts sent by a
 * member are returned, so a card's boosters, boosts and sats are what THESE
 * people sent that episode and never its global totals.
 *
 * ⚠️ THE WHOLE OF THE SUBJECT'S SHOW IS EXCLUDED, not merely the subject
 * episode. The section answers "what ELSE does this audience listen to", and a
 * community that boosts one show heavily fills the list with more of that show —
 * which is the one thing the reader is already looking at and can reach from the
 * eyebrow link. Measured over a 900-page sample it removes a median of 7.8% of
 * the list (mean 15.3%), and takes the share of pages with nothing to show from
 * 3.3% to 6.1%: those are communities that have boosted nothing but this show,
 * where the honest answer is no section rather than a list of the same show
 * again. `IS NULL OR` keeps the episodes whose own show is unidentified — we
 * cannot know they belong to this one, and dropping them would be a claim.
 *
 * A subject episode with no show of its own falls back to excluding just itself,
 * which is all the data supports.
 *
 * idx_boosts_item covers the CTE, idx_boosts_booster the scan.
 *
 * ⚠️ EXPORTED, AND functions/episode/[guid].js CALLS IT DIRECTLY. That page
 * server-renders the first thirty cards of this section, so it needs the corpus
 * inside its own Promise.all rather than through a subrequest to this endpoint.
 * One query definition, two callers, no HTTP hop — and no chance of the page
 * ranking over a corpus assembled differently from the one the client later
 * fetches to re-sort with.
 */
export async function fetchCommunityBoosts(env, guid, showGuid) {
  const excludeShow = showGuid ? " AND (b.podcast_guid IS NULL OR b.podcast_guid <> ?)" : "";
  const binds = showGuid
    ? [guid, guid, showGuid, COMMUNITY_ROWS + 1]
    : [guid, guid, COMMUNITY_ROWS + 1];
  const { results } = await env.DB.prepare(
    `WITH community AS (
       SELECT DISTINCT booster_pubkey FROM boosts WHERE item_guid = ?
     )
     ${BOOST_SELECT}
     JOIN community c ON c.booster_pubkey = b.booster_pubkey
     WHERE b.item_guid IS NOT NULL AND b.item_guid <> ?${excludeShow}
     ORDER BY b.created_at DESC, b.event_id DESC
     LIMIT ?`
  ).bind(...binds).all();

  const rows = results || [];
  // One row over the cap is how truncation is detected without a second COUNT
  // over the same fan-out.
  const truncated = rows.length > COMMUNITY_ROWS;
  return {
    truncated,
    boosts: (truncated ? rows.slice(0, COMMUNITY_ROWS) : rows).map(boostRecord),
  };
}
