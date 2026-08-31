// GET /api/v1/publishers/:guid — one artist: the publisher row plus their
// INDEXED albums, ranked by sats. Serves the Artists feed's drawer.
//
// ⚠️ INDEX-ONLY, REED'S CALL 2026-08-30. Nothing without at least one Nostr
// boost appears anywhere on this site (the podroll is the one standing
// exception, and it is not a ranked feed). The first cut listed the publisher
// feed's own full catalogue on the podroll's argument and rendered ~270
// titleless off-index Wavlake albums linking to raw XML; if off-index content
// ever comes to this site it will come SITE-WIDE, not through this feed. So
// the album list is `podcasts WHERE publisher_guid = ?` — exactly the shows
// whose boosts built the card's figures — and `publisher_albums` (the
// artist's own catalogue file, still collected) is deliberately NOT read here.
//
// `?since=<unix>` windows the list to the boosts inside it and recomputes each
// album's figures over the window — the same contract, for the same reason, as
// /api/v1/podcasts/<guid>?since: the card above the drawer shows the range's
// numbers, and a drawer of all-time ones would contradict the card it opened
// from.
import { json, preflight } from "../_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env, params }) {
  const guid = params.guid;
  const u = new URL(request.url);

  const pub = await env.DB.prepare(
    `SELECT publisher_guid, feed_url, title, image, artwork, description, show_count
     FROM publishers WHERE publisher_guid = ?`
  ).bind(guid).first();
  if (!pub) return json(request, { error: "publisher not found" }, { status: 404 });

  const since = parseInt(u.searchParams.get("since"), 10);
  const windowed = Number.isFinite(since) && since > 0;
  const { results } = windowed
    ? await env.DB.prepare(
        `SELECT b.podcast_guid AS guid, pc.title, pc.image, pc.artwork,
                COUNT(*)                AS boost_count,
                COALESCE(SUM(b.sats),0) AS total_sats
         FROM boosts b
         JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
         WHERE pc.publisher_guid = ? AND b.created_at >= ?
         GROUP BY b.podcast_guid
         ORDER BY total_sats DESC LIMIT 200`
      ).bind(guid, since).all()
    : await env.DB.prepare(
        `SELECT podcast_guid AS guid, title, image, artwork,
                boost_count, total_sats
         FROM podcasts WHERE publisher_guid = ?
         ORDER BY total_sats DESC LIMIT 200`
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
      guid: a.guid,
      title: a.title,
      img: a.image,
      art2: a.artwork || null,
      boosts: a.boost_count,
      sats: a.total_sats,
    })),
    // A windowed answer is a live aggregate; the plain one is a precomputed read.
  }, { cache: windowed ? 120 : 300 });
}

// The GET's status and headers, no body — see the HEAD convention in CLAUDE.md.
export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
