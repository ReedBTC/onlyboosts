// The site search's queries, shared by /api/v1/search?type=all (the nav
// bar's typeahead) and the /search results page. Shows, episodes and artists,
// each a bounded list ordered by sats; members come from /api/v1/members?q=,
// which owns the publisher exclusion and the npub, and both callers ask it
// in the same breath.
//
// Title and author only (the column-scoped MATCH), deliberately: the FTS
// tables carry descriptions and show notes since 2026-10-17, and a show-notes
// hit outranking the title hit a typed query means is the wrong list. A
// deeper "search inside show notes" is a different control.
//
// The artists group reads publishers_fts, which the collector's
// --apply-schema creates; until that has run on the remote the group is
// empty rather than an error, which is what the per-query catch is for.
import { ftsMatch } from "../api/v1/_common.js";

export async function searchAll(env, q, each) {
  const match = ftsMatch(q);
  if (!match) return { shows: [], episodes: [], artists: [] };
  const matchEpisodes = ftsMatch(q, ["title", "show"]);
  const matchPodcasts = ftsMatch(q, ["title", "author"]);
  const rows = (stmt) => stmt.all().then((r) => r.results).catch((e) => { console.warn("[search all]", e?.message); return []; });
  const [shows, episodes, artists] = await Promise.all([
    rows(env.DB.prepare(
      `SELECT p.podcast_guid, p.title, p.image, p.artwork, p.author, p.medium, p.total_sats, p.booster_count
         FROM podcasts_fts f JOIN podcasts p ON p.podcast_guid = f.podcast_guid
        WHERE podcasts_fts MATCH ? ORDER BY p.total_sats DESC LIMIT ?`).bind(matchPodcasts, each)),
    rows(env.DB.prepare(
      `SELECT e.item_guid, e.title, e.image, e.podcast_guid, e.total_sats, e.booster_count,
              p.title AS p_title, p.image AS p_image, p.artwork AS p_artwork
         FROM episodes_fts f JOIN episodes e ON e.item_guid = f.item_guid
         LEFT JOIN podcasts p ON p.podcast_guid = e.podcast_guid
        WHERE episodes_fts MATCH ? ORDER BY e.total_sats DESC LIMIT ?`).bind(matchEpisodes, each)),
    rows(env.DB.prepare(
      `SELECT pub.publisher_guid, pub.title, pub.image, pub.artwork
         FROM publishers_fts f JOIN publishers pub ON pub.publisher_guid = f.publisher_guid
        WHERE publishers_fts MATCH ? LIMIT ?`).bind(match, each)),
  ]);
  return {
    shows: shows.map((r) => ({ guid: r.podcast_guid, title: r.title, img: r.image, art2: r.artwork || null, author: r.author, medium: r.medium, sats: r.total_sats, boosters: r.booster_count })),
    episodes: episodes.map((r) => ({ guid: r.item_guid, title: r.title, img: r.image || r.p_image, sats: r.total_sats, boosters: r.booster_count, show: { guid: r.podcast_guid, title: r.p_title, img: r.p_image, art2: r.p_artwork || null } })),
    artists: artists.map((r) => ({ guid: r.publisher_guid, title: r.title, img: r.image, art2: r.artwork || null })),
  };
}
