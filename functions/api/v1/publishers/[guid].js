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
import { json, preflight, BOOST_SELECT, boostRecord } from "../_common.js";
// Dependency-free on both sides, which is what keeps this module importable by
// node for scripts/test-publishers-api.mjs — _shared/detail-page.js re-exports
// through modules whose stamped sibling imports node cannot resolve, so the
// mention-name lookup below is a local copy instead (the booster page's
// toHexPubkey arrangement; the three-copies rule applies).
import { mentionedPubkeys } from "../../../../assets/js/nostr-text.js";

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env, params }) {
  const guid = params.guid;
  const u = new URL(request.url);

  const pub = await env.DB.prepare(
    `SELECT publisher_guid, feed_url, title, image, artwork, description, show_count
     FROM publishers WHERE publisher_guid = ?`
  ).bind(guid).first();
  if (!pub) return json(request, { error: "publisher not found" }, { status: 404 });

  // ?corpus=1 answers /artist's #boosts section and nothing else — no album
  // list. Same door, same reason, as /api/v1/podcasts/<guid>?corpus=1.
  if (u.searchParams.get("corpus") === "1") {
    return json(request, { corpus: await fetchPublisherCorpus(env, guid) });
  }

  const since = parseInt(u.searchParams.get("since"), 10);
  const windowed = Number.isFinite(since) && since > 0;
  const { results } = windowed
    ? await env.DB.prepare(
        `SELECT b.podcast_guid AS guid, pc.title, pc.image, pc.artwork, pc.medium,
                COUNT(*)                AS boost_count,
                COALESCE(SUM(b.sats),0) AS total_sats
         FROM boosts b
         JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
         WHERE pc.publisher_guid = ? AND b.created_at >= ?
         GROUP BY b.podcast_guid
         ORDER BY total_sats DESC LIMIT 200`
      ).bind(guid, since).all()
    : await env.DB.prepare(
        `SELECT podcast_guid AS guid, title, image, artwork, medium,
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
      // The medium partition's input: a declaring show can be a PODCAST (9 of
      // 395 are), and a drawer headed "Albums" listing one is the exact
      // widened-list-under-a-narrower-name failure the medium split exists to
      // prevent. Null means the collector could not identify the feed, which
      // partitions to the not-music side as everywhere else.
      medium: a.medium || null,
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

/* Every boost sent to this artist's albums, bounded and newest-first — the
 * publisher-tier twin of fetchShowCorpus, serving /artist's #boosts section
 * through ?corpus=1 and exported so the page Function could one day run it in
 * its own Promise.all. One row over the cap detects truncation; `names` rides
 * along for the same one-component-two-renders reason fetchShowCorpus
 * documents. Same cap, same reasoning: 2,000 against a heaviest artist well
 * under it. */
const CORPUS_CAP = 2000;

async function lookupNames(env, messages) {
  const names = {};
  const mentioned = mentionedPubkeys(messages).slice(0, 90);
  if (!mentioned.length) return names;
  const { results } = await env.DB.prepare(
    `SELECT pubkey, name, display_name FROM profiles
     WHERE pubkey IN (${mentioned.map(() => "?").join(",")})`
  ).bind(...mentioned).all();
  for (const p of results || []) {
    const n = p.display_name || p.name;
    if (n) names[p.pubkey] = n;
  }
  return names;
}

export async function fetchPublisherCorpus(env, guid) {
  const { results } = await env.DB.prepare(
    `${BOOST_SELECT}
     JOIN podcasts pub_pc ON pub_pc.podcast_guid = b.podcast_guid
     WHERE pub_pc.publisher_guid = ?
     ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
  ).bind(guid, CORPUS_CAP + 1).all();

  const rows = results || [];
  const truncated = rows.length > CORPUS_CAP;
  const kept = truncated ? rows.slice(0, CORPUS_CAP) : rows;
  const names = await lookupNames(env, kept.map((r) => r.message));
  return { boosts: kept.map(boostRecord), truncated, count: kept.length, names };
}
