// GET /show/:guid — a show's landing page, server-rendered at the edge.
//
// Design of record: docs/show-pages-spec.md.
//
// WHY SERVER-RENDERED, when every other page on this site is static HTML plus a
// client fetch: the Open Graph card. This page exists to be shared by the
// podcaster whose supporters it lists, and a crawler handed an empty shell
// produces a blank preview, which defeats the point. Search indexing of the
// ~930 qualifying shows is a second and lesser reason. BMB reached the same
// conclusion for its own show view (see the spec).
//
// The URL key is the bare `podcast:guid` — the show's own RSS-declared
// identifier, which is what boosts carry via NIP-73 and what D1 is keyed on. It
// survives a rename, a change of host and a change of feed URL. Slugs are
// deliberately deferred; the canonical link below is what makes adding them
// later a redirect rather than a rewrite.
//
// NAV/FOOTER markup between the marker comments is GENERATED — edit
// partials/nav.html or partials/footer.html and run scripts/sync-partials.js.
// Do not hand-edit it here.

import {
  htmlEscape, jsonForScript, isSafeUrl, num, compact, fmtDate, relTime,
  fmtDuration, truncate, displayName,
  lookupMentionNames, renderMessage,
  renderSupporters, renderBoosts,
} from "../_shared/detail-page.js";
// The show's own description, which is the one thing on this page that comes
// from neither D1 nor the collector. See fetchShowDescription below.
import { piHeaders, piGet } from "../_shared/podcast-index.js";
import { parseNotes } from "../_shared/rich-text.js";
// The stat tiles, each carrying its all-time global rank; /episode shares it.
import { feedRanks, renderStatTiles } from "../_shared/feed-rank.js";

const SITE_ORIGIN = "https://onlyboosts.social";

// ⚠️ EVERY SECTION id ON THIS PAGE IS A PUBLIC URL. `/show/<guid>#podroll` is
// how a podcaster shares one section of their own page, so the six ids below are
// a contract with links already in the wild and **must not be renamed**:
//
//   #episodes  #community-shows  #community  #podroll  #reverse-podroll  #boosts
//
// Same rule as ALIASES in index.html, and it was written here as the stricter
// one: a feed hash is read by a JS controller that can alias an old form to a
// new key, where these resolve in the browser's own anchor handling and have
// nowhere to put a redirect. That is now only true with JavaScript off —
// HASH_ALIASES in show-page.js rewrites a retired id and scrolls, which is what
// carried #inverse-podroll to #reverse-podroll. It is a repair, not a licence:
// the alias needs the module to have run, so a rename still breaks the anchor
// for a no-JS reader and for anything that resolves the URL without a browser.
//
// Three pieces of support live elsewhere and go with them: `scroll-margin-top`
// on .show-section in show-page.css (the nav is sticky, so a bare anchor puts
// the heading behind it), revealHashTarget() in show-page.js (a collapsed drawer
// has to open when it is the thing being linked to), and initHashSpy() beside it
// — the address bar tracks the section being read, so a reader who never knew
// the ids existed can still copy a link to one. That last is why the ids are now
// visible to people rather than only to whoever was told them, and it is also
// why every one of them has to keep reading as a name for its section.
const OG_FALLBACK = `${SITE_ORIGIN}/assets/onlyboosts_banner.png`;

// Guids are UUIDs at 36 chars; the cap leaves slack for the odd-but-real values
// in the index without letting a kilobyte string reach a bound query.
const GUID_MAX = 200;

const BOOSTS_SHOWN = 24;

// How many rows the "Other Shows/Albums This Community Boosts" drawer carries.
// Measured over the live corpus, the number of distinct other shows a show's
// booster set has boosted runs to a median of 45, a p90 of 191 and a maximum of
// 608 — so this cap only bites on the head of the distribution, and only in the
// tail of a list nobody scrolls to. It is what keeps the biggest page's markup
// around 50KB rather than 200KB.
const COMMUNITY_SHOWS_LIMIT = 150;

// How many podroll tiles paint before the toggle: two desktop rows of five.
// Measured over the 371 live edges, the median podroll is 4 and the reverse
// direction's biggest fan-in is 15, so this only bites on the head of the
// distribution — one page (Before The Sch3m3s, 63 entries) and two of the
// reverse lists. Nothing is dropped; the rest ship hidden behind the same
// .show-more button the community wall uses.
const PODROLL_VISIBLE = 10;

export async function onRequestGet({ request, env, params }) {
  let guid = params.guid;
  if (Array.isArray(guid)) guid = guid[0];
  try { guid = decodeURIComponent(guid); } catch { /* keep the raw form */ }
  if (!guid || guid.length > GUID_MAX) return notFound(guid);

  const show = await env.DB.prepare(
    // No episode_count: it is deliberately never displayed (see the stats
    // block below), and selecting it invites someone to put the tile back.
    `SELECT podcast_guid, title, image, artwork, feed_url, medium, author,
            boost_count, total_sats, booster_count, latest_ts
     FROM podcasts WHERE podcast_guid = ?`
  ).bind(guid).first();

  // The qualifying rule, and the whole of it: a show with no title has no
  // artwork, no feed URL and no Podcast Index record either, so there is
  // nothing to render. They stay visible in the Shows feed as unlinked
  // "Unidentified show" cards; they just have no page.
  //
  // The split moves as the collector repairs malformed show identifiers (927
  // of 1,285 qualified after its 2026-07-26 pass, up from 922 of 1,384), which
  // is why nothing here is counted or capped — the rule does the work.
  if (!show || !show.title) return notFound(guid);

  const [eps, sups, boosts, community, podroll, podrolledBy, description, ranks] = await Promise.all([
    env.DB.prepare(
      // Newest episode first. `published` is null on a meaningful slice of
      // rows, and SQLite sorts NULL below every value, so DESC sinks the
      // undated ones without needing an explicit guard — a `0` fallback would
      // have floated them to the top instead.
      // booster_count is NOT a column on `episodes` — the collector stores
      // boosts and sats per episode but not distinct boosters, so the drawer's
      // "Most Boosters" sort has to derive it. A grouped subquery over this
      // show's boosts is one indexed scan (idx_boosts_podcast) rather than a
      // correlated lookup per episode; measured at 2.9ms over 290 episodes.
      `SELECT e.item_guid, e.title, e.image, e.published, e.duration,
              e.episode_number, e.enclosure_url, e.boost_count, e.total_sats,
              COALESCE(x.boosters, 0) AS booster_count
       FROM episodes e
       LEFT JOIN (
         SELECT item_guid, COUNT(DISTINCT booster_pubkey) AS boosters
         FROM boosts WHERE podcast_guid = ? GROUP BY item_guid
       ) x ON x.item_guid = e.item_guid
       WHERE e.podcast_guid = ?
       ORDER BY e.published DESC, e.total_sats DESC, e.item_guid LIMIT 500`
    ).bind(guid, guid).all(),
    env.DB.prepare(
      // Ranked by sats sent to THIS show, all time. idx_boosts_podcast covers
      // the WHERE. The ORDER BY is a total order deliberately: this response is
      // edge-cached, and a tie on both sats and boosts would otherwise let two
      // supporters swap places between renders.
      `SELECT b.booster_pubkey, b.booster_npub,
              SUM(COALESCE(b.sats, 0)) AS sats,
              COUNT(*)                 AS boosts,
              pr.name, pr.display_name, pr.picture
       FROM boosts b
       LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
       WHERE b.podcast_guid = ?
       GROUP BY b.booster_pubkey
       ORDER BY sats DESC, boosts DESC, b.booster_pubkey
       LIMIT 500`
    ).bind(guid).all(),
    env.DB.prepare(
      `SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
              b.item_guid, b.message, e.title AS e_title, e.episode_number AS e_num,
              pr.name AS pr_name, pr.display_name AS pr_dname, pr.picture AS pr_pic
       FROM boosts b
       LEFT JOIN episodes e ON e.item_guid = b.item_guid
       LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
       WHERE b.podcast_guid = ?
       ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
    ).bind(guid, BOOSTS_SHOWN).all(),
    // What else this show's community boosts.
    //
    // The community is the set of pubkeys that have boosted THIS show; the
    // rollup is every other show those pubkeys have boosted. It answers a
    // question the homepage Shows feed structurally cannot: not "which shows
    // are big" but "which shows does this audience overlap with". Measured
    // across nine sampled shows from rank #1 to #400, the top ten here shares
    // between 0 and 6 entries with the global top ten, so it is a genuinely
    // different list rather than the site-wide ranking repeated.
    //
    // ALL TIME ONLY, and deliberately so. A 1W/1M/All range shipped here first
    // and was removed: a time window is an episode-level question ("what is
    // this show doing lately"), where this is a show-level one ("who does this
    // audience overlap with"), and the answer to that is a standing fact rather
    // than a recent one. The data agreed — the median community had boosted
    // exactly one other show in the last 7 days and 47% had boosted none, so
    // two of the three ranges were empty on half the site.
    //
    // Every figure is scoped to the community by construction: the join means
    // only boosts sent BY a member are counted, so a row's boosts, sats and
    // members are this audience's, never the show's global totals.
    //
    // idx_boosts_podcast covers the CTE, idx_boosts_booster the scan. The join
    // to `podcasts` is also the filter: a show with no title has no /show page
    // to link to (see the qualifying rule above), and an unlinkable card in a
    // discovery list is dead weight. That is a deliberate divergence from the
    // Shows feed, which keeps them as "Unidentified show".
    env.DB.prepare(
      `WITH community AS (
         SELECT DISTINCT booster_pubkey FROM boosts WHERE podcast_guid = ?
       )
       SELECT b.podcast_guid, p.title, p.image, p.artwork, p.feed_url,
              COUNT(*)                         AS cs_boosts,
              SUM(COALESCE(b.sats, 0))         AS cs_sats,
              COUNT(DISTINCT b.booster_pubkey) AS cs_members
       FROM boosts b
       JOIN community c ON c.booster_pubkey = b.booster_pubkey
       JOIN podcasts p  ON p.podcast_guid   = b.podcast_guid
       WHERE b.podcast_guid IS NOT NULL
         AND b.podcast_guid <> ?
         AND p.title IS NOT NULL AND p.title <> ''
       GROUP BY b.podcast_guid
       ORDER BY cs_members DESC, cs_boosts DESC, cs_sats DESC, b.podcast_guid
       LIMIT ?`
    ).bind(guid, guid, COMMUNITY_SHOWS_LIMIT).all(),
    // Both directions of <podcast:podroll>. See the note over podrollQuery for
    // why these two (and the rank query below) may fail quietly.
    podrollQuery(env, guid, "forward"),
    podrollQuery(env, guid, "reverse"),
    // ⚠️ THE ONE OUTBOUND THIRD-PARTY FETCH IN THIS RENDER. It sits inside the
    // batch rather than after it so the page pays max(D1, PI) instead of the
    // sum; see fetchShowDescription for the rest of the bargain.
    fetchShowDescription(env, show),
    // The show's all-time rank on Shows or Albums, by boosts, sats and
    // boosters. One scan of `podcasts`; never rejects, resolves null instead,
    // and the header prints no row for null. See functions/_shared/feed-rank.js.
    feedRanks(env.DB, "show", show),
  ]);

  const boostRows = boosts.results || [];
  const names = await lookupMentionNames(env, boostRows.map((r) => r.message));

  const html = renderShowPage({
    show,
    episodes: eps.results || [],
    supporters: sups.results || [],
    boosts: boostRows,
    community: community.results || [],
    podroll: podroll.results || [],
    podrolledBy: podrolledBy.results || [],
    description,
    names,
    ranks,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The collector runs a five-minute cycle, so anything tighter buys
      // nothing but origin load.
      "Cache-Control": "public, max-age=300",
    },
  });
}

// ── The podroll queries ──────────────────────────────────────────────────────
//
// `podroll` holds one row per recommendation with BOTH endpoints' display fields
// denormalized onto the edge, so either direction is one indexed read that
// renders every tile. That denormalization is the point: `podcasts` holds only
// shows that have boosts, and only 56% of podroll targets do, so a join would
// silently drop nearly half the cards.
//
// ⚠️ THESE TWO ARE THE ONLY QUERIES ON THIS PAGE THAT MAY FAIL QUIETLY, and the
// reason is the write path rather than the read. Every other table here rides
// the collector's hourly boost delta; `podroll` is replaced wholesale by a
// separate WEEKLY pass (`d1_sync.py --remote-podroll`), because a podroll changes
// when a publisher edits their feed and never when a boost arrives. So a remote
// that carries every other table but not yet this one is a normal intermediate
// state of a deploy, not a bug — and it must not turn 930 show pages into 500s
// to report a section that 93% of them do not render anyway. A failure here
// degrades to no section, which is exactly what a show with no podroll gets.
function podrollQuery(env, guid, direction) {
  // Only the display fields, and deliberately not the *_url columns: all 371
  // live edges carry a guid at both ends, so a tile's link never needs a feed
  // URL to fall back to. `linked` is the collector's flag and is not re-derived
  // here — see the podroll section in CLAUDE.md.
  const sql = direction === "forward"
    // The publisher's own order. `position` IS the ranking they published, so it
    // is preserved rather than re-sorted; putting the linkable ones first would
    // be us editorializing someone else's recommendation list.
    ? `SELECT target_guid AS guid, target_title AS title, target_image AS image,
              target_artwork AS artwork, target_linked AS linked
       FROM podroll WHERE source_guid = ? ORDER BY position`
    // The reverse edge has no order of its own — nobody ranked it — so
    // alphabetical. NOCASE because a binary sort files every lower-case title
    // after every upper-case one, which looks like no sort at all.
    : `SELECT source_guid AS guid, source_title AS title, source_image AS image,
              source_artwork AS artwork, source_linked AS linked
       FROM podroll WHERE target_guid = ?
       ORDER BY source_title COLLATE NOCASE, source_guid`;
  return env.DB.prepare(sql).bind(guid).all().catch(() => ({ results: [] }));
}

// ── helpers ──────────────────────────────────────────────────────────────────
//
// Escaping, formatting, the bech32 decoder behind the @Name chips in a boost
// message, the Nostr Community wall and the boost list all moved to
// functions/_shared/detail-page.js when /episode/<guid> needed the same ones.
// See that file's header for what each one is and why it exists.

// ── Copy ─────────────────────────────────────────────────────────────────────
//
// Everything that differs between a podcast page and a music page. Nothing
// structural does, which is the same arrangement as the COPY tables in
// shows-feed.js and feeds-podcasts.js: the medium changes the words, never the
// layout, so a third medium is a third entry here rather than a second page.
//
// The medium comes from `<podcast:medium>` in the show's own RSS, projected
// onto the podcasts table by the collector. The namespace default is `podcast`,
// and so is ours: a feed that declares nothing is not called an album, because
// filing an unidentified feed under Albums asserts something we can't support.
const COPY = {
  podcast: {
    eyebrow: "Show",
    noun: "show",
    // Stand-in for an episode row with no artwork, matching shows-feed.js.
    glyph: "🎙",
    boostBtn: "Boost this Show",
    itemsPlural: "Episodes",
    itemAbbr: "Ep.",
    untitledItem: "Untitled episode",
    drawer: "Episodes with Nostr Boosts",
    // The way out of the drawer to a real catalogue. The drawer holds only
    // episodes carrying an indexed boost, which is a fraction of any show's
    // output — see "No Episode Counts, Anywhere" in the spec for how small a
    // fraction — so it needs to say where the rest of them are.
    allItems: "See All Episodes",
    noItems: "No episodes with Nostr boosts yet.",
    ldType: "PodcastSeries",
    // The #boosts heading. "Show Boosts" rather than "Recent Boosts": the
    // section holds the show's whole boost corpus once the reader touches a
    // control, so "Recent" would stop being true the moment they did.
    boostsHeading: "Show Boosts",
    // Where the back link points for a visitor who has nowhere to go back TO
    // (a shared link, a search result). show-page.js swaps it for history.back()
    // when the previous document was ours; see the note over .show-back.
    backHref: "/#shows",
    backLabel: "All Shows",
    // The rank line in each stat tile, and the shared caption under the row,
    // both name this feed and link to backHref. See _shared/feed-rank.js.
    rankFeed: "Shows",
    // Deliberately "By", never "Host" or "Creator". The source is
    // <itunes:author>, whoever the publisher named there: usually the host,
    // sometimes a network ("Jupiter Broadcasting"), occasionally a tagline.
    // "By Jupiter Broadcasting" is true of all three; "Host:" is true of one.
    credit: "By",
  },
  music: {
    eyebrow: "Album",
    noun: "album",
    glyph: "💿",
    boostBtn: "Boost this Album",
    itemsPlural: "Tracks",
    itemAbbr: "Track",
    untitledItem: "Untitled track",
    drawer: "Tracks with Nostr Boosts",
    allItems: "See All Tracks",
    noItems: "No tracks with Nostr boosts yet.",
    ldType: "MusicAlbum",
    boostsHeading: "Album Boosts",
    backHref: "/#albums",
    backLabel: "All Albums",
    rankFeed: "Albums",
    // On a music feed <itunes:author> IS the artist, and cleanly so: 97.4% of
    // album pages carry a usable one. The stronger label is earned here in a
    // way it is not on the podcast side.
    credit: "Artist",
  },
};

const copyFor = (medium) => (medium === "music" ? COPY.music : COPY.podcast);

// ── the page ─────────────────────────────────────────────────────────────────

function renderShowPage({ show, episodes, supporters, boosts, community, podroll, podrolledBy, description, names, ranks }) {
  const copy = copyFor(show.medium);
  const title = show.title;
  const pageUrl = `${SITE_ORIGIN}/show/${encodeURIComponent(show.podcast_guid)}`;
  const art = isSafeUrl(show.image) ? show.image : null;
  // The second-chance URL: <itunes:image> where it differs from <image>. Only a
  // FALLBACK — its presence means the feed publishes two different URLs, not
  // that the primary is dead. Measured over the five shows that carry one, four
  // primaries return 200 and one (Homegrown Hits) 404s, which is why og:image
  // below stays on `art`: preferring art2 there would swap the share card of
  // four working shows to fix one, and a crawler can't run the error handler
  // either way.
  const art2 = isSafeUrl(show.artwork) && show.artwork !== art ? show.artwork : null;
  // A music release leads with its artist, the way every music service titles
  // one: "Haleen — Midnight Signal" is what a listener recognises in a shared
  // link, where "Midnight Signal — Boosts on Nostr" buries the name that
  // identifies it. 97.4% of album pages carry a usable artist; the rest fall
  // back to the standard form rather than printing a dangling separator.
  //
  // Dropping "Boosts on Nostr" from those titles costs no honesty: og:description
  // still opens with the booster count and closes with the coverage caveat, so
  // the preview card says what the page is either side of this line.
  const artist = copy.ldType === "MusicAlbum" ? usableAuthor(show) : "";
  const ogTitle = artist
    ? `${artist} — ${title} | OnlyBoosts`
    : `${title} — Boosts on Nostr | OnlyBoosts`;

  // The description is synthesized from the boost data rather than copied from
  // the show's own blurb. D1 doesn't carry the blurb (it lives only in the
  // per-show shard, too heavy to fetch per page), but more importantly this
  // page is about the boosts, not the podcast, so the stats are the honest
  // summary and they differentiate the preview from every podcast directory.
  // The scope has to be inside the sentence, not merely on the page. This is
  // the one string that travels without the page around it, into a Nostr
  // client's preview card or a group chat, where neither the stat heading's
  // link nor anything else on the page is there to qualify it. A bare "3
  // supporters have sent…" reads as a verdict on the show's whole audience.
  // It is now the ONLY place the full sentence survives — the paragraph that
  // used to sit under the stat tiles is gone — so don't trim it.
  const one = show.booster_count === 1;
  const ogDesc = show.booster_count
    ? `${num(show.booster_count)} Nostr booster${one ? " has" : "s have"} sent ` +
      `${num(show.total_sats)} sats to ${title} across ${num(show.boost_count)} ` +
      `boost${show.boost_count === 1 ? "" : "s"}. Counts cover only boosts ` +
      `published to Nostr; most boosting is keysend and never appears.`
    : `Boosts published to Nostr for ${title}, indexed by OnlyBoosts.`;

  const ld = {
    "@context": "https://schema.org",
    "@type": copy.ldType,
    name: title,
    url: pageUrl,
    // byArtist is MusicAlbum-only in schema.org; PodcastSeries has no
    // equivalent that <itunes:author> can honestly fill, so podcasts get none.
    ...(artist ? { byArtist: { "@type": "MusicGroup", name: artist } } : {}),
    ...(art ? { image: art } : {}),
    ...(isSafeUrl(show.feed_url) ? { webFeed: show.feed_url } : {}),
  };

  // Boosting needs a payable value block, which /api/value resolves from
  // Podcast Index at click time. Every qualifying show has a feed URL and a
  // guid, so the client always has something to ask with; the button hides
  // itself if the lookup comes back with no block.
  const boostPayload = {
    guid: show.podcast_guid,
    title,
    feed: isSafeUrl(show.feed_url) ? show.feed_url : null,
    img: art,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <!-- Shared CSP. Every page carries the same policy so tightening happens in
       lockstep; see CLAUDE.md. -->
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    font-src 'self' data:;
    connect-src 'self' https: wss:;
    media-src 'self' https:;
    base-uri 'self';
    form-action 'self';
    object-src 'none';
  " />

  <title>${htmlEscape(ogTitle)}</title>
  <meta name="description" content="${htmlEscape(ogDesc)}" />
  <link rel="canonical" href="${htmlEscape(pageUrl)}" />
  <link rel="icon" type="image/png" href="/assets/onlyboosts_favicon.png" />

  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#00aff0" />
  <link rel="apple-touch-icon" href="/assets/onlyboosts_pfp.png" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="OnlyBoosts" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="${htmlEscape(pageUrl)}" />
  <meta property="og:title" content="${htmlEscape(ogTitle)}" />
  <meta property="og:description" content="${htmlEscape(ogDesc)}" />
  <meta property="og:site_name" content="OnlyBoosts" />
  <meta property="og:image" content="${htmlEscape(art || OG_FALLBACK)}" />
  <meta property="og:image:alt" content="${htmlEscape(art ? `Artwork for ${title}` : "OnlyBoosts")}" />
  <!-- ⚠️ THE CARD TYPE FOLLOWS THE IMAGE. A large-image card crops to roughly
       1.91:1, and podcast artwork is SQUARE by specification — Apple requires
       1400x1400 to 3000x3000, and 12 of 12 sampled from the live index are
       exactly 1.00. So the large card was slicing a horizontal band out of the
       middle of every cover, which reads as a broken image rather than a missing
       one. The summary card is the square thumbnail this artwork actually is.

       The fallback keeps the large card: OG_FALLBACK is the 1800x600 site
       banner, the one image here that belongs in a wide frame. Same rule, and
       the same reasoning, as on functions/booster/[npub].js. -->
  <meta name="twitter:card" content="${art ? "summary" : "summary_large_image"}" />
  <meta name="twitter:title" content="${htmlEscape(ogTitle)}" />
  <meta name="twitter:description" content="${htmlEscape(ogDesc)}" />
  <meta name="twitter:image" content="${htmlEscape(art || OG_FALLBACK)}" />
  <meta name="twitter:image:alt" content="${htmlEscape(art ? `Artwork for ${title}` : "OnlyBoosts")}" />
  ${isSafeUrl(show.feed_url) ? `<link rel="alternate" type="application/rss+xml" title="${htmlEscape(title)}" href="${htmlEscape(show.feed_url)}" />` : ""}

  <script type="application/ld+json">
  ${jsonForScript(ld)}
  </script>

  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/show-page.css?v=ob-v119" />
  <!-- The boost note card and its reaction bar. Added when the boost list at
       the foot of this page became the same .note-card the homepage Boosts
       feed paints; this page linked neither before, which is why show-page.css
       restates .nostr-mention. That restatement is now redundant rather than
       load-bearing, and is left in place rather than removed in the same pass. -->
  <link rel="stylesheet" href="/assets/css/boosts-thread.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/boost-actions.css?v=ob-v119" />
</head>
<body data-show-guid="${htmlEscape(show.podcast_guid)}">

<!-- NAV:START (generated by scripts/sync-partials.js — edit the partial) -->
<!-- ══════════════════════════════ NAV ══════════════════════════════
     SHARED NAV — single source of truth. Do NOT edit the copies inside the
     page files; edit THIS file, then run scripts/sync-partials.js to
     push it into every page (between the NAV:START / NAV:END markers).
     Styles live in /assets/css/nav.css; behavior in /assets/js/nav.js. -->
<header id="top-nav">
  <div class="nav-inner">
    <a class="nav-logo" href="/" aria-label="OnlyBoosts home">
      <img src="/assets/onlyboosts_pfp.png" alt="" />
    </a>
    <a class="nav-site-name" href="/">OnlyBoosts</a>
    <nav aria-label="Main navigation">
      <!-- Single "Explore" menu = the whole site map. Grouped dropdown on
           desktop, full-screen overlay on mobile. -->
      <details class="nav-explore">
        <summary aria-label="Explore the site">
          <span class="nav-explore-glyph" aria-hidden="true">🧭</span>
          <span class="nav-explore-text">Explore</span>
          <span class="caret" aria-hidden="true">▾</span>
        </summary>
        <div class="nav-explore-panel">
          <div class="nav-explore-head">
            <span>Explore</span>
            <button type="button" class="nav-explore-close" aria-label="Close menu">✕</button>
          </div>
          <a class="nav-explore-home" href="/"><span aria-hidden="true">🏠</span> Home</a>
          <div class="nav-explore-groups">
            <!-- Feeds: one entry per feed, matching the homepage's what-menu
                 exactly (Episodes / Shows / Songs / Albums / Boosts). The
                 Global vs Follows axis is deliberately absent — it's the
                 second dropdown on the page itself, and listing both scopes
                 here made the nav a grid restating a control the page already
                 has. Songs and Albums are the music half of Episodes and
                 Shows, split on <podcast:medium>; they sit next to the feeds
                 they mirror rather than in a group of their own. -->
            <div class="nav-explore-group">
              <h4>Feeds</h4>
              <a href="/#episodes-global"><span aria-hidden="true">🎙</span> Episodes</a>
              <a href="/#shows"><span aria-hidden="true">📻</span> Shows</a>
              <a href="/#songs-global"><span aria-hidden="true">🎵</span> Songs</a>
              <a href="/#albums"><span aria-hidden="true">💿</span> Albums</a>
              <a href="/#boosts-global"><span aria-hidden="true">⚡</span> Boosts</a>
            </div>
            <!-- Stats: the aggregate views over the same data. Both are
                 coming-soon pages for now (noindex, out of the sitemap). -->
            <div class="nav-explore-group">
              <h4>Stats</h4>
              <a href="/stats"><span aria-hidden="true">📊</span> Boost Stats</a>
              <a href="/boosters"><span aria-hidden="true">🧑‍🤝‍🧑</span> Community</a>
            </div>
            <div class="nav-explore-group">
              <h4>More</h4>
              <a href="/about"><span aria-hidden="true">ℹ️</span> About</a>
              <a href="https://github.com/ReedBTC/onlyboosts" target="_blank" rel="noopener"><span aria-hidden="true">💻</span> Source</a>
              <a href="#" data-lb-bug-trigger><span aria-hidden="true">🐞</span> Report a bug</a>
            </div>
          </div>
        </div>
      </details>
    </nav>
    <div id="lb-boost-slot" aria-label="Donate">
      <button
        type="button"
        class="lb-boost-placeholder"
        data-lb-boost-trigger="show"
        aria-label="Donate to OnlyBoosts"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clip-rule="evenodd"/>
        </svg>
        <span class="lb-label-long">Donate</span>
        <span class="lb-label-short">Donate</span>
      </button>
    </div>
    <div id="lb-identity-slot" aria-label="Account">
      <!-- Static placeholder swapped out by IdentityWidget once the
           bundle loads. Picks shimmer vs sign-in based on whether a
           saved session exists; populated by inline script below. -->
    </div>
  </div>
</header>
<!-- NAV:END -->

<main class="show-main">

  <!-- Ships as a real link to the feed, which is what a visitor who arrived on
       a shared link should get; show-page.js relabels it "Back" and wires
       history.back() when the previous document was one of ours. The href stays
       either way, so a middle-click still opens the feed in a new tab. -->
  <a class="show-back" href="${copy.backHref}" data-show-back>
    <span class="show-back-arrow" aria-hidden="true">←</span><span data-back-label>${copy.backLabel}</span>
  </a>

  ${renderHeader(show, art, title, copy, art2, description, ranks)}

  ${renderEpisodes(episodes, show, copy)}

  ${renderCommunityShows(community)}

  ${renderSupporters(supporters, {
    sub: `Everyone who has boosted ${htmlEscape(show.title)} on Nostr, ranked by sats sent, all time.`,
    empty: `No boosters recorded for this ${copy.noun} yet.`,
  })}

  ${renderPodroll(podroll, "forward", copy, show)}

  ${renderPodroll(podrolledBy, "reverse", copy, show)}

  ${renderBoosts(boosts, names, {
    // ⚠️ NOT "Recent Boosts" ANY MORE, and the heading is the smaller half of the
    // change. With a range and an order over the show's whole corpus this section
    // stops being a sample of the last few days and becomes the show's BOOST
    // INBOX — which is how a podcaster reads boosts, across the catalogue rather
    // than one episode at a time. A heading saying "Recent" would be false the
    // moment the reader sorted by size.
    heading: copy.boostsHeading,
    sub: `Every boost sent to this ${copy.noun}, as published to Nostr.`,
    itemAbbr: copy.itemAbbr,
    noun: copy.noun,
    // The show's own aggregate, so the load-more control is correct before the
    // client has fetched anything. The list itself is still the newest 24: the
    // heaviest show carries 1,404 boosts, and the homepage already measured what
    // server-rendering that many notes costs (737 rows, 1.15MB of raw markup).
    total: show.boost_count,
    state: { page: BOOSTS_SHOWN },
  })}

</main>

<!-- FOOTER:START (generated by scripts/sync-partials.js — edit the partial) -->
<!-- ══════════════════════════════ FOOTER ══════════════════════════════
     SHARED FOOTER — single source of truth. Do NOT edit the copies inside
     the page files; edit THIS file, then run scripts/sync-partials.js
     to push it into every page (between FOOTER:START / FOOTER:END markers).
     Styles live in /assets/css/footer.css. -->
<footer id="site-footer">
  <div class="footer-top">

    <div class="footer-col footer-about">
      <h3>OnlyBoosts</h3>
      <p>A Nostr client for only podcast boosts. Every Podcasting 2.0 boostagram published to Nostr, cached and indexed for stats by episode, show and booster. Sort, filter, search, view all or just see boosts from your follows on Nostr.</p>
    </div>

    <!-- Same two groups as the nav's Explore menu, in the same order — the
         footer is the nav's site map repeated, so they're regrouped together
         or not at all. -->
    <div class="footer-col">
      <h3>Feeds</h3>
      <ul>
        <li><a href="/#episodes-global">🎙 Episodes</a></li>
        <li><a href="/#shows">📻 Shows</a></li>
        <li><a href="/#songs-global">🎵 Songs</a></li>
        <li><a href="/#albums">💿 Albums</a></li>
        <li><a href="/#boosts-global">⚡ Boosts</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Stats</h3>
      <ul>
        <li><a href="/stats">📊 Boost Stats</a></li>
        <li><a href="/boosters">🧑‍🤝‍🧑 Community</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Connect</h3>
      <ul>
        <li><a href="/about">ℹ️ About</a></li>
        <li><a href="https://github.com/ReedBTC/onlyboosts" target="_blank" rel="noopener">💻 Site Source</a></li>
        <li><a href="#" data-lb-bug-trigger">🐞 Report a bug</a></li>
      </ul>
    </div>

  </div>
  <div class="footer-bottom">
    <p class="footer-made">
      Made with <span role="img" aria-label="love">💜</span> by
      <a class="footer-maker" href="https://njump.me/npub1xgyjasdztryl9sg6nfdm2wcj0j3qjs03sq7a0an32pg0lr5l6yaqxhgu7s" target="_blank" rel="noopener">
        <img src="/assets/reed_pfp.png" alt="" width="24" height="24" loading="lazy" />
        Reed
      </a>
    </p>
  </div>
</footer>
<!-- FOOTER:END -->

<script type="application/json" id="show-boost-payload">${jsonForScript(boostPayload)}</script>

<script src="/assets/js/nav.js?v=ob-v119" defer></script>
<script src="/assets/js/show-page.js?v=ob-v119" type="module"></script>
<!-- Lazy widget bootstrap. Plain (non-defer) script at the end of body, as on
     every page — see CLAUDE.md. -->
<script src="/assets/js/nav-widget-boot.js?v=ob-v119"></script>
<script src="/assets/js/sw-register.js?v=ob-v119" defer></script>
</body>
</html>`;
}


// The show's credit line, or "" when there is nothing honest to print.
//
// Two rejections, both deliberate. An EMPTY author prints nothing rather than a
// placeholder. An author that merely REPEATS the show title prints nothing
// either: "Artist: Stay Awhile" under a heading already reading "Stay Awhile"
// is noise, and ~7% of rows are exactly that. Normalizing case, punctuation and
// a leading "The" before comparing catches the near-misses too.
//
// Nothing else is filtered. A tagline like "Bitcoin is for Everyone" reads
// oddly and still ships, because any rule sharp enough to catch it also eats
// real names, and a wrongly suppressed credit is worse than an awkward one.
// The author, or "" when there is nothing honest to print. Shared by the
// on-page credit and the share-card title so the two can never disagree — if
// they drifted, a music page could title itself "Midnight Signal — Midnight
// Signal" while the body correctly showed no credit at all.
function usableAuthor(show) {
  const author = String(show.author || "").trim();
  if (!author) return "";
  const norm = (v) => String(v || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
  return norm(author) === norm(show.title) ? "" : author;
}

/* ── The show's description ──────────────────────────────────────────────────
 *
 * The publisher's own summary of the show, above the stat tiles. It is the only
 * thing on this page that comes from neither D1 nor the collector's exports:
 * `podcasts` carries title, image, artwork, feed_url, medium, author and the
 * three boost aggregates, and the per-show shards are no richer.
 *
 * ⚠️ IT IS FETCHED PER REQUEST RATHER THAN STORED, AND THAT IS THE POINT. The
 * alternative was a `description` column, which means a schema migration, a
 * backfill over ~930 shows, and a field on every enrichment tick that has to be
 * re-fetched to stay current — all to cache a string Podcast Index already
 * serves and already caches for us. `enrich.py` calls this exact endpoint for
 * every show it identifies; this reads the same object one field further
 * across.
 *
 * `fulltext` is what makes it whole. Without it PI cuts every text field to 100
 * words, which is the same truncation the collector inherited for episode notes
 * — so a stored copy would have been the clipped version anyway unless the
 * collector changed too.
 *
 * Three properties hold this up:
 *
 *   THE TIMEOUT IS SHORT, and much shorter than /api/episode-meta's. That
 *   endpoint fills a drawer after paint and can afford ten seconds; this is on
 *   a reader's TTFB, so a slow upstream has to cost a missing paragraph rather
 *   than a hung page.
 *
 *   IT RUNS INSIDE THE Promise.all with the six D1 queries, so the page pays
 *   max(D1, PI) rather than the sum. In the common case PI answers from the
 *   colo's cache — piGet sets cacheEverything with an hour's TTL, and a show
 *   page is the same request for every reader — and the batch is unchanged.
 *
 *   IT NEVER REJECTS AND NEVER THROWS. A show with no description, a show PI
 *   has never seen, a timeout and an outage all produce the same empty array,
 *   and the page renders exactly as it did before this existed. A description
 *   is additive; nothing below it depends on it.
 *
 * og:description is deliberately NOT sourced from here. That string is
 * synthesized from the boost data and is the one place the full scope sentence
 * survives — see the note over ogDesc.
 */
const SHOW_DESC_TIMEOUT_MS = 2_500;

async function fetchShowDescription(env, show) {
  const key = env.PODCAST_INDEX_KEY;
  const secret = env.PODCAST_INDEX_SECRET;
  // Unconfigured keys are a deployment fact rather than an answer about this
  // show. /api/episode-meta answers 503 for it because a client can log that;
  // here there is no one to tell, so it degrades like every other miss.
  if (!key || !secret || !show?.podcast_guid) return [];

  try {
    const headers = await piHeaders(key, secret, "OnlyBoosts-ShowPage/1.0");
    const r = await piGet(
      `/podcasts/byguid?fulltext&guid=${encodeURIComponent(show.podcast_guid)}`,
      headers,
      { timeoutMs: SHOW_DESC_TIMEOUT_MS }
    );
    return parseNotes(r?.feed?.description);
  } catch {
    return [];
  }
}

/* The token tree → HTML. The client-side twin of this is paintNotes() in
 * episode-page.js, which builds text nodes and anchors; here every field is
 * escaped individually instead, which is the same guarantee by the other route.
 *
 * ⚠️ NOTHING IN A TOKEN IS TRUSTED. `v` is publisher-authored text and `href`
 * is a publisher-authored URL, so the first is escaped and the second is put
 * through isSafeUrl before it can reach an attribute — a link that fails it
 * renders as its own label in plain text rather than being dropped, because the
 * sentence around it was written expecting the words to be there.
 *
 * The clamp is CSS and the "More" control is added by show-desc.js only when
 * the text actually overflows. With JavaScript off the description simply
 * renders in full, which is the same trade the "Show N more" toggles make.
 */
function renderDescription(paragraphs) {
  if (!Array.isArray(paragraphs) || !paragraphs.length) return "";
  const body = paragraphs.map((para) => {
    const inner = para.map((tok) => {
      const v = htmlEscape(String(tok?.v ?? ""));
      if (!v) return "";
      return tok.t === "link" && isSafeUrl(tok.href)
        ? `<a href="${htmlEscape(tok.href)}" target="_blank" rel="noopener noreferrer">${v}</a>`
        : v;
    }).join("");
    return inner ? `<p>${inner}</p>` : "";
  }).filter(Boolean).join("");
  if (!body) return "";
  return `<div class="show-desc" data-show-desc>
      <div class="show-desc-body" data-show-desc-body>${body}</div>
    </div>`;
}

function creditLine(show, copy) {
  const author = usableAuthor(show);
  if (!author) return "";
  return `<p class="show-credit"><span class="show-credit-label">${htmlEscape(copy.credit)}</span> ${htmlEscape(truncate(author, 120))}</p>`;
}

function renderHeader(show, art, title, copy, art2, description, ranks) {
  // Three tiles, not four. There was an episode count here and it was removed
  // deliberately: sats, boosts and boosters are measures of boost activity
  // and have no meaning outside it, so "as published to Nostr" is the only
  // reading available. An episode count is a property of the PODCAST, with a
  // true value in the world, so printing one beside the show's name reads as a
  // claim about the show. Ours counted episodes carrying at least one boost we
  // indexed, which excludes keysend entirely and anything published before
  // NIP-73 tagging. Measured against RSS: 70 shown vs 415 real for Rabbit Hole
  // Recap, 64 vs 676 for LINUX Unplugged, and 22 vs 21 for Local Bitcoiners,
  // so not even reliably a subset. See docs/show-pages-spec.md.
  // THE STAT HEADING IS THIS PAGE'S QUALIFIER, and it replaced a paragraph.
  // A caveat sentence used to sit under these tiles (.ob-scopenote, now unused
  // site-wide) saying the counts cover only boosts published to Nostr. It said
  // more than two words can, but it said it after the numbers and ran three
  // lines on a phone, on a page whose whole design is to fit one screen.
  // "Nostr Boost Stats" above them, with the link carrying the rest, is the
  // same trade the feeds already make with their "Nostr Stats:" label. The
  // link goes to /about#keysend — "What Is Not Indexed" — because what these
  // numbers exclude is the substance the paragraph carried.
  //
  // og:description still states the scope inside the sentence and is now the
  // ONLY place the full wording survives. See the note above ogDesc.
  const stats = [
    { key: "sats", label: "sats", value: compact(show.total_sats), exact: num(show.total_sats) },
    { key: "boosts", label: show.boost_count === 1 ? "boost" : "boosts", value: num(show.boost_count), exact: num(show.boost_count) },
    { key: "boosters", label: show.booster_count === 1 ? "booster" : "boosters", value: num(show.booster_count), exact: num(show.booster_count) },
  ];

  return `<header class="show-hero">
    <div class="show-hero-inner">
      <div class="show-art">${
        art
          ? `<img src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""} alt="" width="180" height="180" loading="eager" />`
          : `<div class="show-art-blank" aria-hidden="true">🎙️</div>`
      }</div>
      <div class="show-ident">
        <p class="show-eyebrow">${copy.eyebrow}</p>
        <h1>${htmlEscape(title)}</h1>
        ${creditLine(show, copy)}
        <p class="show-sub">${
          show.latest_ts ? `Last boosted ${htmlEscape(relTime(show.latest_ts))}` : "No boosts recorded yet"
        }</p>
        <div class="show-actions">
          <button type="button" class="btn btn-boost" data-show-boost hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clip-rule="evenodd"/></svg>
            ${copy.boostBtn}
          </button>
          ${isSafeUrl(show.feed_url)
            ? `<a class="btn btn-quiet" href="${htmlEscape(show.feed_url)}" target="_blank" rel="noopener">RSS feed</a>`
            : ""}
          <button type="button" class="btn btn-quiet" data-share-page>Share</button>
        </div>
      </div>
    </div>
    ${renderDescription(description)}
    <h2 class="show-stats-title">
      <a href="/about#keysend">Nostr Boost</a> Stats
    </h2>
    ${renderStatTiles(stats, ranks, copy)}
  </header>`;
}

// ── Other shows this community boosts ────────────────────────────────────────
//
// Deliberately NOT split on medium, which every other rollup on this site is.
// A music community also boosting podcasts is the interesting half of the
// finding, and filing an album page's crossover under a heading that says
// "Shows" would either hide it or misname it — hence the "Shows/Albums" wording
// and no COPY entry, since the label is the same on both mediums.
//
// Every row's three figures are in the DOM from first paint, packed into one
// attribute. Sorting is therefore a re-order and a renumber, never a fetch and
// never a re-label — with no range, a row's text is fixed once and the client
// only moves nodes. The section renders ranked and complete with no JavaScript.
//
// It ships OPEN, unlike the episode drawer above it. The episode list is a
// catalogue you consult; this is a recommendation you browse, and a closed
// drawer is a recommendation nobody sees.

// One row's figures: "18 community boosters · 34 boosts · 12k sats". All three
// are scoped to this community by the query's join — the boosts and sats are
// what THESE boosters sent that show, not its global totals.
//
// This read "18 of 115 boosters" and the fraction was a puzzle: the denominator
// is this show's own booster count, which is on the page but not next to it, so
// the reader had to go find what they were 18 of. Naming the set says the same
// thing in one number.
function communityMeta(members, boosts, sats) {
  return `${num(members)} community booster${members === 1 ? "" : "s"} · ` +
    `${num(boosts)} boost${boosts === 1 ? "" : "s"} · ${compact(sats)} sats`;
}

function communityRow(r, rank) {
  const art = isSafeUrl(r.image) ? r.image : null;
  // Same second-chance URL the hero carries, on the same terms: an attribute
  // rather than an inline onerror, wired through cover-art.js by show-page.js.
  // A row here is another show's artwork, so it hits exactly the case the whole
  // art2 chain exists for — Homegrown Hits appears in these drawers across the
  // site, and its <image> 404s everywhere its <itunes:image> would have worked.
  const art2 = isSafeUrl(r.artwork) && r.artwork !== art ? r.artwork : null;
  const title = truncate(r.title, 120);
  const members = Number(r.cs_members || 0);
  const boosts = Number(r.cs_boosts || 0);
  const sats = Number(r.cs_sats || 0);

  // The boost button is a SIBLING of the link, not a child: a button inside an
  // anchor is invalid, and nesting one would also make the whole row swallow
  // its clicks. MONEY PATH — the guid and feed here are what /api/value
  // resolves that show's own splits from, and nothing rewrites them.
  return `<li class="cs-row" data-cs="${boosts},${sats},${members}">
    <a class="cs-link" href="/show/${encodeURIComponent(r.podcast_guid)}">
      <span class="cs-rank" aria-hidden="true">${rank}</span>
      ${art
        ? `<img class="cs-art" src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />`
        : `<span class="cs-art cs-art--blank" aria-hidden="true">🎙️</span>`}
      <span class="cs-main">
        <span class="cs-title">${htmlEscape(title)}</span>
        <span class="cs-meta">${htmlEscape(communityMeta(members, boosts, sats))}</span>
      </span>
    </a>
    <button type="button" class="ob-boost-pill" hidden
      data-cs-boost="${htmlEscape(r.podcast_guid)}"
      data-cs-feed="${htmlEscape(isSafeUrl(r.feed_url) ? r.feed_url : "")}"
      data-cs-title="${htmlEscape(title)}"
      aria-label="Boost ${htmlEscape(title)}" title="Boost ${htmlEscape(title)}">Boost</button>
  </li>`;
}

function renderCommunityShows(rows) {
  if (!rows.length) return "";

  // The bolt symbol sheet that used to sit here went with the icon button: the
  // pill is the word alone, so there is no glyph to define once and reference
  // 150 times.
  return `<section class="show-section show-section--bare" id="community-shows">
    <details class="ep-drawer cs-drawer" open data-community-shows>
      <!-- The hint is aria-hidden: <details> announces its own expanded state,
           so a screen reader reading "Hide" as well is noise. It is empty here
           and filled from CSS off [open] — see .drawer-hint in show-page.css. -->
      <summary>Other Shows/Albums This Community Boosts<span class="drawer-hint" aria-hidden="true"></span></summary>
      <!-- Ships hidden and stays hidden without JavaScript: a sort control that
           cannot sort is worse than none. Same rule as the feed-search slot on
           the homepage panels. -->
      <div class="cs-controls" data-cs-controls hidden></div>
      <ul class="ep-list cs-list" data-cs-list>
        ${rows.map((r, i) => communityRow(r, i + 1)).join("\n        ")}
      </ul>
    </details>
  </section>`;
}

// ── Podroll ──────────────────────────────────────────────────────────────────
//
// <podcast:podroll> is the publisher's OWN list of other shows worth hearing,
// parsed from the show's raw RSS (Podcast Index carries no podroll). It is the
// only section on this page that is not derived from boost data at all, and the
// look says so: square artwork tiles in a grid, five across on desktop and two
// on a phone, carrying the show's art and its name and nothing else. Every other
// section here is a ranked list with figures beside each row; a recommendation
// has no figure, and inventing one would misrepresent what a podroll is.
//
// BOTH DIRECTIONS SHIP, as two sections with two headings. Forward-only would
// be a section on 65 pages; the reverse edge — the same rows read the other way —
// reaches 109, because plenty of shows are recommended by someone without
// publishing a podroll themselves (Local Bitcoiners is one). They are never
// merged into one grid: "I recommend them" and "they recommend me" are opposite
// claims, and a tile carrying only art and a title cannot tell them apart.
//
// NOT split on medium, which is the same call renderCommunityShows makes and for
// the same reason: a music feed recommending podcasts is the interesting half of
// the finding, so the heading says "Shows/Albums" on both and there is no COPY
// entry. Only the page's own noun comes off the table.
//
// A tile ships with no boost button, deliberately. Every other list of other
// shows on this site carries one, but a podroll target is barely half likely to
// have a Podcast Index record we could resolve splits from, and the section's
// whole job is to send a reader onward rather than to take a payment here.

// The show's page on Boost Me Bitch.
//
// ⚠️ THE LAST TWO SURFACES ON THIS SITE POINTING AT BMB, and both are in this
// file: "See All Episodes" on the episode drawer's band, and a podroll tile for
// a show we have no page of our own for. Every EPISODE link moved to
// /episode/<item-guid>; these two stay because neither has an equivalent here.
// The drawer lists only the episodes carrying an indexed boost, so "See All
// Episodes" reaches the one thing this site does not hold — the show's full
// catalogue — and 44% of podroll targets have no boosts and so no page.
// assets/js/episode-link.js documents the whole set. Show-level, so
// `?podcast=<guid>` alone: a /show page carries no Podcast Index numeric id to
// prefer `?feed=` with.
function bmbShowUrl(guid) {
  return `https://boostmebitch.com/?podcast=${encodeURIComponent(guid)}`;
}

// An episode's landing page here, or null when it has none.
//
// ⚠️ RESTATES assets/js/show-link.js#episodePageHref, and the two must agree. A
// Pages Function cannot import a client module — nothing in functions/ reaches
// outside functions/ — which is the same arrangement bmbShowUrl() is in. The
// qualifying test is the TITLE, not the guid: the page is keyed on the item guid
// alone and renders for an episode whose show we cannot identify, where an
// episode Podcast Index could not name has nothing to render at all.
//
// The guid is only ever encoded, never parsed: 9% of them contain a slash and 30
// are full http(s) URLs, and Cloudflare Pages keeps an encoded %2F inside one
// path segment rather than routing on it.
function episodePageUrl(itemGuid, title) {
  if (!itemGuid || !title || !String(title).trim()) return null;
  return `/episode/${encodeURIComponent(itemGuid)}`;
}

// One tile. `linked` is the collector's flag — boosts AND a title, the same rule
// notFound() applies above — and it is read, never re-derived: it already
// accounts for the titleless case and it is the collector's rule to own.
//
// A card that is not `linked` still gets a link, just not one of ours. All 371
// live edges carry a guid at both ends, so BMB can always resolve the show even
// where we have nothing indexed for it, and an unlinked tile in a section whose
// entire purpose is discovery would be dead weight.
function podrollTile(c, hidden) {
  const title = truncate(c.title, 120);
  const art = isSafeUrl(c.image) ? c.image : null;
  // Same second-chance URL as the hero and the community rows, on the same
  // terms: an attribute, wired through cover-art.js by show-page.js, never an
  // inline onerror. 8 of the 371 live edges carry one.
  const art2 = isSafeUrl(c.artwork) && c.artwork !== art ? c.artwork : null;
  const ours = Number(c.linked) === 1;
  const href = ours ? `/show/${encodeURIComponent(c.guid)}` : bmbShowUrl(c.guid);
  // Off-site tiles open in a new tab; ours navigate in place, the way every
  // other internal link on the page does.
  const away = ours ? "" : ` target="_blank" rel="noopener"`;

  return `<li class="pr-tile"${hidden ? " hidden data-overflow" : ""}>
        <a class="pr-link" href="${htmlEscape(href)}"${away} title="${htmlEscape(title)}">
          ${art
            ? `<img class="pr-art" src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""} alt="" loading="lazy" referrerpolicy="no-referrer" />`
            : `<span class="pr-art pr-art--blank" aria-hidden="true">🎙️</span>`}
          <span class="pr-title">${htmlEscape(title)}</span>
        </a>
      </li>`;
}

// NEITHER HEADING CARRIES A COUNT, and neither may gain one. Both figures are
// bounded by which feeds the collector has read, so a badge would state a fact
// about our coverage as though it were one about the show — the same reason the
// two drawers above carry no count either. Each sub-line says what bounds it,
// which is what a badge cannot do.
//
// "Podroll" is used as the term of art rather than explained, and it is the one
// place on the site where a spec name is the label. It differs from the NIP-73
// case (deliberately never the qualifier, see CLAUDE.md) because a podroll is
// the SUBJECT here, not the mechanism behind a number: a reader who does not
// know the word learns it from the tiles under it, and a publisher who does know
// it is looking for exactly this word.
//
// Neither heading is split on medium. "Show Authors" reads flat on an album page
// on purpose, the same call renderCommunityShows makes: a music feed
// recommending podcasts is the interesting half of the finding.
const PODROLL_COPY = {
  forward: {
    id: "podroll",
    heading: () => "Podroll - Recommended by Show Authors",
    sub: (copy) =>
      `Taken from this ${copy.noun}'s own RSS feed, in the order its publisher lists ` +
      `them; these are their recommendations, not ours.`,
  },
  reverse: {
    id: "reverse-podroll",
    // Names the show, because "Recommended By" alone reads as though it modifies
    // the section above rather than starting a new claim. Truncated hard: show
    // titles run past 90 characters in this index, and this one sits inside a
    // Playfair heading that already wraps on a phone.
    heading: (copy, show) => `Reverse Podroll - ${truncate(show.title, 52)} is Recommended By:`,
    sub: (copy) =>
      `Publishers who list this ${copy.noun} among the recommendations in their own ` +
      `feed, as far as the feeds OnlyBoosts has read.`,
  },
};

function renderPodroll(rows, direction, copy, show) {
  const meta = PODROLL_COPY[direction];

  // Two filters, and both are absence rather than policy.
  //
  // A titleless card is dropped outright: there is nothing to label a tile whose
  // only other content is artwork, and all four such edges in the live corpus
  // have no artwork either, so the tile would be empty. This is the one place
  // the page does NOT fall back to "Unidentified show" the way the Shows feed
  // does — that label works in a list of names and figures, and reads as a bug
  // in a grid whose entire content is names.
  //
  // The dedupe is defensive: the table's key is (source_guid, position), so a
  // publisher listing the same show at two positions is representable. None do
  // today, and one tile is the honest render if one ever does.
  const seen = new Set();
  const cards = [];
  for (const r of rows) {
    if (!r.guid || !String(r.title || "").trim()) continue;
    if (seen.has(r.guid)) continue;
    seen.add(r.guid);
    cards.push(r);
  }
  if (!cards.length) return "";

  const hidden = Math.max(0, cards.length - PODROLL_VISIBLE);

  return `<section class="show-section" id="${meta.id}">
    <div class="show-section-head">
      <h2>${htmlEscape(meta.heading(copy, show))}</h2>
      <p class="show-section-sub">${htmlEscape(meta.sub(copy))}</p>
    </div>
    <ul class="pr-grid">
      ${cards.map((c, i) => podrollTile(c, i >= PODROLL_VISIBLE)).join("\n      ")}
    </ul>
    ${hidden > 0 ? `<button type="button" class="btn btn-quiet show-more" data-show-more="${meta.id}">
      Show ${num(hidden)} more
    </button>` : ""}
  </section>`;
}

function renderEpisodes(rows, show, copy) {
  if (!rows.length) {
    return `<section class="show-section show-section--bare" id="episodes">
      <p class="show-empty">${copy.noItems}</p>
    </section>`;
  }

  // Where the rest of the catalogue is. This drawer lists only episodes with an
  // indexed boost, which is a small slice of most shows' output, and until now
  // the page said nothing about where the others were.
  //
  // ⚠️ Boost Me Bitch is the same TEMPORARY target assets/js/episode-link.js
  // documents. Built by bmbShowUrl() below, which the podroll tiles also use —
  // this file emits two BMB links and they resolve through one function so they
  // cannot drift apart.
  const bmb = bmbShowUrl(show.podcast_guid);

  // No heading or sub-line of its own: the summary IS this section's heading,
  // and show-page.css styles it as one (Playfair, the .show-stats-title size).
  // An <h2> above it would only say the same words a second time.
  return `<section class="show-section show-section--bare" id="episodes">
    <details class="ep-drawer" data-episode-drawer>
      <summary>${copy.drawer}<span class="drawer-hint" aria-hidden="true"></span></summary>
      <!-- Unlike the community drawer's row, this one ships VISIBLE: it carries
           a plain link that works with no JavaScript, so hiding the band until
           the sort mounts would cost the link to save a control that isn't
           there. The sort still appends into it, and still only when there are
           at least two rows to order. -->
      <div class="cs-controls" data-ep-controls>
        <a class="cs-allitems" href="${bmb}" target="_blank" rel="noopener">${copy.allItems}<span class="cs-allitems-arrow" aria-hidden="true">↗</span></a>
      </div>
      <ul class="ep-list">
        ${rows.map((e) => episodeRow(e, copy, isSafeUrl(show.image) ? show.image : null)).join("\n        ")}
      </ul>
    </details>
  </section>`;
}

// `fallbackArt` is the show's own artwork. Episode art is near-universal in the
// index (100% on every show sampled), but where a row has none the show's art
// is a truer stand-in than a glyph — it is what that episode's art would almost
// certainly have been. The show's art2 is deliberately NOT a third link here:
// it is a fallback for a dead show image, and these rows already fall back to
// the show image only when the episode has none of its own.
function episodeRow(e, copy, fallbackArt) {
  const bits = [fmtDate(e.published), fmtDuration(e.duration)].filter(Boolean);
  const art = (isSafeUrl(e.image) && e.image) || fallbackArt || null;
  // The row's TITLE links to that episode's page, the same move the show name
  // makes on every feed card: the name of a thing points at the page for that
  // thing. The artwork beside it deliberately does not — a 44px thumbnail in a
  // list row is not a target anyone aims for, and the row already carries a
  // Boost button at its other end, so a third hit area would be three things to
  // hit in 44 pixels. An untitled episode has no page and stays plain text.
  const epUrl = episodePageUrl(e.item_guid, e.title);
  // boosters,boosts,sats,published — the four axes the drawer's sort offers,
  // packed one attribute per row the way the community drawer does it.
  const pack = [e.booster_count, e.boost_count, e.total_sats, e.published]
    .map((v) => Number(v || 0)).join(",");
  return `<li class="ep-row" data-ep="${pack}">
          ${art
            ? `<img class="ep-art" src="${htmlEscape(art)}" alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />`
            : `<span class="ep-art ep-art--blank" aria-hidden="true">${copy.glyph}</span>`}
          <div class="ep-main">
            <p class="ep-title">${e.episode_number ? `<span class="ep-num">${copy.itemAbbr} ${htmlEscape(e.episode_number)}</span> ` : ""}${
              epUrl
                ? `<a class="ep-title-link" href="${htmlEscape(epUrl)}" title="Nostr boosts to ${htmlEscape(e.title)}">${htmlEscape(e.title)}</a>`
                : htmlEscape(e.title || copy.untitledItem)
            }</p>
            <p class="ep-meta">${bits.map(htmlEscape).join(" · ")}${bits.length ? " · " : ""}${htmlEscape(num(e.total_sats))} sats · ${htmlEscape(num(e.boost_count))} boost${e.boost_count === 1 ? "" : "s"}</p>
          </div>
          <button type="button" class="btn btn-boost btn-sm" data-ep-boost="${htmlEscape(e.item_guid || "")}" data-ep-title="${htmlEscape(e.title || "")}" hidden>Boost</button>
        </li>`;
}

// A guid with no page. Deliberately a real 404 rather than a shell of empty
// fields: 462 rows in the index have no title, no artwork and no feed, so there
// is genuinely nothing to show.
function notFound(guid) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Show not found — OnlyBoosts</title>
  <link rel="icon" type="image/png" href="/assets/onlyboosts_favicon.png" />
  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v119" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v119" />
</head>
<body>
<section class="page-header">
  <p class="page-eyebrow">404</p>
  <h1>Show not found</h1>
  <p>No indexed show matches <code>${htmlEscape(truncate(guid || "", 80))}</code>.</p>
</section>
<main class="page-main">
  <div class="page-inner">
    <div class="soon-card">
      <p>Some boosts in the index carry a show identifier that Podcast Index
         doesn't recognise, so the show has no title, artwork or feed and
         therefore no page of its own. Those shows still appear in the Shows
         feed.</p>
      <p><a href="/#shows">Browse all shows →</a></p>
    </div>
  </div>
</main>
<script src="/assets/js/sw-register.js?v=ob-v119" defer></script>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
