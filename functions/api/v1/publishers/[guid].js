// GET /api/v1/publishers/:guid — one artist: the publisher row plus their
// album list, in the publisher's own order. Serves the Artists feed's drawer.
//
// ⚠️ THE ALBUM LIST IS THE PUBLISHER'S OWN, UNFILTERED — the podroll rule, one
// tier up. `publisher_albums` is the channel-level remoteItem list the artist's
// own feed publishes, so filtering it (by medium, by boosts, by anything) would
// misreport what they wrote. Most of a catalogue has no boosts; the rows are
// denormalized onto the edge for exactly that reason (a join to `podcasts`
// could only title the boosted ones — see the schema note).
//
// `linked` is the collector's album_linked: the album has a /show page here
// (boosts AND a title). A 0 renders the row pointed at the feed, not at us.
import { json, preflight } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env, params }) {
  const guid = params.guid;

  const pub = await env.DB.prepare(
    `SELECT publisher_guid, feed_url, title, image, artwork, description, show_count
     FROM publishers WHERE publisher_guid = ?`
  ).bind(guid).first();
  if (!pub) return json(request, { error: "publisher not found" }, { status: 404 });

  // Display fields prefer the live `podcasts` row where the album is indexed:
  // the collector keeps that row current on its checked_at gate, where the
  // denormalized edge copy refreshes on the publisher sweep. Same preference
  // the podroll rendering makes.
  const { results } = await env.DB.prepare(
    `SELECT pa.position, pa.album_guid, pa.album_url, pa.album_linked,
            COALESCE(pc.title,  pa.album_title)   AS title,
            COALESCE(pc.image,  pa.album_image)   AS image,
            COALESCE(pc.artwork, pa.album_artwork) AS artwork,
            COALESCE(pc.medium, pa.album_medium)  AS medium,
            pc.boost_count, pc.total_sats, pc.booster_count
     FROM publisher_albums pa
     LEFT JOIN podcasts pc ON pc.podcast_guid = pa.album_guid
     WHERE pa.publisher_guid = ?
     ORDER BY pa.position`
  ).bind(guid).all();

  return json(request, {
    publisher: {
      guid: pub.publisher_guid,
      title: pub.title,
      img: pub.image,
      art2: pub.artwork || null,
      feed: pub.feed_url,
      description: pub.description || null,
      albums: pub.show_count,
    },
    albums: results.map((a) => ({
      guid: a.album_guid,
      url: a.album_url,
      title: a.title,
      img: a.image,
      art2: a.artwork || null,
      medium: a.medium,
      linked: !!a.album_linked,
      // Null (not 0) when the album is not indexed: "no boosts recorded" and
      // "we do not index this feed" are different states and the drawer only
      // prints figures for the first.
      boosts: a.boost_count ?? null,
      sats: a.total_sats ?? null,
      boosters: a.booster_count ?? null,
    })),
  }, { cache: 300 });
}

// The GET's status and headers, no body — see the HEAD convention in CLAUDE.md.
export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
