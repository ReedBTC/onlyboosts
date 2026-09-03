// GET /episode/:guid — one episode's landing page, server-rendered at the edge.
//
// The episode-level counterpart of functions/show/[guid].js, and deliberately
// the same page: the hero, the stat tiles, the Nostr Community wall and the
// boost list are the same components off functions/_shared/detail-page.js, and
// the client half shares detail-page.js on the other side too. What differs is
// the subject, three sections that do not apply, and one that only exists here.
//
// WHY SERVER-RENDERED, when every other page on this site is static HTML plus a
// client fetch: the Open Graph card. This page exists to be shared, and a
// crawler handed an empty shell produces a blank preview, which defeats the
// point. See the same note on the show page.
//
// ⚠️ THE URL KEY IS THE RSS `item_guid`, AND IT IS NOT ALWAYS A UUID. 9% of the
// distinct guids in the index contain a slash and 30 of them are full http(s)
// URLs, which is why it is only ever encoded and bound, never parsed or split.
// Cloudflare Pages keeps an encoded %2F inside a single path segment rather than
// splitting the route on it, so `params.guid` arrives encoded and
// decodeURIComponent recovers the original. Verified against production before
// this page was written.
//
// NAV/FOOTER markup between the marker comments is GENERATED — edit
// partials/nav.html or partials/footer.html and run scripts/sync-partials.js.
// Do not hand-edit it here.
import {
  htmlEscape, jsonForScript, isSafeUrl, num, compact, fmtDate, relTime,
  fmtDuration, truncate, lookupMentionNames,
  renderSupporters, renderBoosts,
} from "../_shared/detail-page.js";
import { itemsFromBoosts, renderCardPage, CARDS_PER_PAGE } from "../_shared/episode-cards.js";
// The stat tiles, each carrying its all-time global rank; /show shares it.
import { feedRanks, renderStatTiles } from "../_shared/feed-rank.js";
import { fetchCommunityBoosts } from "../api/v1/episodes/[guid].js";
import { COPY as CARD_COPY } from "../../assets/js/episode-card.js";

const SITE_ORIGIN = "https://onlyboosts.social";

// ⚠️ EVERY SECTION id ON THIS PAGE IS A PUBLIC URL, exactly as on /show/<guid>:
// `/episode/<guid>#community` is how someone shares one part of it. The three
// ids below are a contract with links in the wild and **must not be renamed**:
//
//   #community   #community-episodes   #boosts
//
// Two of them are the show page's ids, and that is on purpose — the same
// section keeps the same name on both pages, so a reader who has learned one
// URL has learned both. #community-episodes is this page's own; the show page's
// equivalent is #community-shows, and the two are different sections listing
// different things, so they do not share an id either.
//
// Three pieces of support live elsewhere and go with them: `scroll-margin-top`
// on .show-section in show-page.css (the nav is sticky, so a bare anchor puts
// the heading behind it), and initHashRouting() / initHashSpy() in
// detail-page.js, which open a collapsed drawer that is linked to and keep the
// address bar tracking the section being read.
//
// All three resolve with JavaScript off. #community-episodes was the exception
// until the episode card became one shared definition; see the note over
// renderCommunityEpisodes below.
const OG_FALLBACK = `${SITE_ORIGIN}/assets/onlyboosts_banner.png`;

// Episode guids are UUIDs at 36 characters and run to 101 in the live index
// (the longest is a `<pubkey>:<uuid>` pair). The cap leaves generous slack for
// the odd-but-real values without letting a kilobyte string reach a bound query.
const GUID_MAX = 400;

// Every boost to this episode, not a page of them: the user-facing promise of
// the section is that it lists all of them, and it can keep it — the busiest
// episode in the index has 55 boosts and the median has 2. This is a guard
// against a pathological row rather than a page size.
const BOOSTS_CAP = 500;

export async function onRequestGet({ env, params }) {
  let guid = params.guid;
  if (Array.isArray(guid)) guid = guid[0];
  try { guid = decodeURIComponent(guid); } catch { /* keep the raw form */ }
  if (!guid || guid.length > GUID_MAX) return notFound(guid);

  const ep = await env.DB.prepare(
    // `description` is the one heavy column on `episodes` and the API endpoints
    // fetch it only on request (?shownotes=). Here it is always wanted — the
    // notes drawer is server-rendered, which is what lets it read with
    // JavaScript off — and it costs nothing extra: this is already the row.
    `SELECT e.item_guid, e.podcast_guid, e.title, e.image, e.published, e.duration,
            e.episode_number, e.enclosure_url, e.description, e.boost_count, e.total_sats,
            e.booster_count,
            p.title AS p_title, p.image AS p_image, p.artwork AS p_artwork,
            p.feed_url AS p_feed, p.medium AS p_medium, p.author AS p_author
     FROM episodes e
     LEFT JOIN podcasts p ON p.podcast_guid = e.podcast_guid
     WHERE e.item_guid = ?`
  ).bind(guid).first();

  // The qualifying rule, and the whole of it — the same one the show page
  // applies. 6,682 of the 7,182 episodes carrying an indexed boost have a
  // title; the other 500 are boosts tagged with an item guid Podcast Index
  // can't identify, so there is genuinely nothing to render. They keep their
  // boosts in every feed; they just have no page.
  //
  // A missing SHOW is not disqualifying. 23 titled episodes carry no podcast
  // guid, and the page degrades cleanly: no eyebrow link, no boost button, and
  // the community sections work unchanged because they are keyed on the
  // episode.
  if (!ep || !ep.title) return await noEpisodePage(env, guid);

  /* ⚠️ THE COMMUNITY CORPUS IS FETCHED HERE NOW, inside the same Promise.all as
   * everything else, because #community-episodes is SERVER-RENDERED. It used to
   * be the one section on either detail page that was not, on the reasoning that
   * its card was a JavaScript artifact — which it no longer is.
   *
   * It is the most expensive query on the page: every boost this episode's
   * boosters have sent anywhere else, a median of 248 rows and up to the 2,000
   * cap. Running it in parallel means the page pays max() rather than sum(), and
   * the 300s edge cache means one reader per colo pays it at all. Measured
   * against production before the change: the endpoint answers a heavy episode
   * (834 rows, 1.1MB) in ~190ms, against a page TTFB of ~170ms.
   *
   * ⚠️ IT NEVER REJECTS. A failure here must cost the section and nothing else —
   * the rest of the page is complete without it, and a reader who came for this
   * episode's own boosts must not get a 500 because a rollup below the fold
   * could not be built. Same discipline as the two podroll queries on /show. */
  const [sups, boosts, boosters, community, ranks] = await Promise.all([
    env.DB.prepare(
      // Ranked by sats sent to THIS EPISODE, all time. idx_boosts_item covers
      // the WHERE. The ORDER BY is a total order deliberately: this response is
      // edge-cached, and a tie on both sats and boosts would otherwise let two
      // boosters swap places between renders.
      `SELECT b.booster_pubkey, b.booster_npub,
              SUM(COALESCE(b.sats, 0)) AS sats,
              COUNT(*)                 AS boosts,
              pr.name, pr.display_name, pr.picture
       FROM boosts b
       LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
       WHERE b.item_guid = ?
       GROUP BY b.booster_pubkey
       ORDER BY sats DESC, boosts DESC, b.booster_pubkey
       LIMIT ?`
    ).bind(guid, BOOSTS_CAP).all(),
    env.DB.prepare(
      `SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
              b.message, b.client_id, pr.name AS pr_name, pr.display_name AS pr_dname,
              pr.picture AS pr_pic
       FROM boosts b
       LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
       WHERE b.item_guid = ?
       ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
    ).bind(guid, BOOSTS_CAP).all(),
    // booster_count is NOT a column on `episodes` — the collector stores boosts
    // and sats per episode but not distinct boosters — so the third stat tile
    // is derived. One indexed lookup through idx_boosts_item.
    env.DB.prepare(
      `SELECT COUNT(DISTINCT booster_pubkey) AS n, MAX(created_at) AS latest
       FROM boosts WHERE item_guid = ?`
    ).bind(guid).first(),
    fetchCommunityBoosts(env, guid, ep.podcast_guid, ep.p_medium).catch((err) => {
      console.warn("[episode] community corpus unavailable", err);
      return null;
    }),
    // The episode's all-time rank on Episodes or Songs, by boosts, sats and
    // boosters, compared on the same `episodes` aggregate columns the feed
    // sorts on. Never rejects; the header prints no row for null.
    feedRanks(env.DB, "episode", ep),
  ]);

  const boostRows = boosts.results || [];
  const names = await lookupMentionNames(env, boostRows.map((r) => r.message));

  const html = renderEpisodePage({
    ep,
    supporters: sups.results || [],
    boosts: boostRows,
    boosterCount: boosters?.n || 0,
    latestTs: boosters?.latest || null,
    names,
    community,
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

// ── Copy ─────────────────────────────────────────────────────────────────────
//
// Everything that differs between a podcast episode and a music track. Nothing
// structural does, which is the same arrangement as the COPY tables in
// functions/show/[guid].js, shows-feed.js and feeds-podcasts.js: the medium
// changes the words, never the layout, so a third medium is a third entry here
// rather than a second page.
//
// The medium comes from `<podcast:medium>` on the SHOW, projected onto the
// podcasts table by the collector — an episode carries no medium of its own,
// because the medium is a property of the feed it belongs to. copyFor() defaults
// to `podcast`, matching the namespace default and the partition rule in
// CLAUDE.md: an episode whose show we cannot identify is not called a track.
const COPY = {
  podcast: {
    eyebrow: "Episode",
    noun: "episode",
    glyph: "🎙",
    boostBtn: "Boost this Episode",
    boostsHeading: "Episode Boosts",
    // The community rollup's heading. Split on medium since 2026-08-24, and the
    // heading and the corpus query's medium filter are ONE decision — change
    // either alone and the section names something it isn't. See
    // fetchCommunityBoosts in ../api/v1/episodes/[guid].js.
    communityHeading: "Other Episodes This Community Boosts",
    // The sub-line under it. "Other shows'" rather than "Other show's": the
    // episodes belong to several other shows, not to one.
    communitySub: "Other shows' episodes",
    ldType: "PodcastEpisode",
    seriesType: "PodcastSeries",
    seriesProp: "partOfSeries",
    // Where the back link points for a visitor who has nowhere to go back TO
    // (a shared link, a search result). detail-page.js swaps it for
    // history.back() when the previous document was ours.
    backHref: "/#episodes-global",
    backLabel: "All Episodes",
    // The rank line in each stat tile, and the shared caption under the row,
    // both name this feed and link to backHref. See _shared/feed-rank.js.
    rankFeed: "Episodes",
    // Deliberately "By", never "Host" or "Creator". The source is
    // <itunes:author> on the show, whoever the publisher named there: usually
    // the host, sometimes a network ("Jupiter Broadcasting"), occasionally a
    // tagline. "By Jupiter Broadcasting" is true of all three; "Host:" is not.
    credit: "By",
    dated: "Aired",
    notes: "Show Notes",
    // The quiet button beside Boost. It used to read "All boosts to this show",
    // which described the destination's contents where the reader wants to know
    // where the link goes; the show page is a page about the show, and naming it
    // is the shorter and truer label.
    viewShow: "View Show",
  },
  music: {
    eyebrow: "Track",
    noun: "track",
    glyph: "💿",
    boostBtn: "Boost this Track",
    boostsHeading: "Track Boosts",
    // "Songs", matching the feed these cards belong to, where the noun for one
    // item on this page is "track". The heading names the LIST, and the list is
    // the Songs feed's rows.
    communityHeading: "Other Songs This Community Boosts",
    communitySub: "Other albums' tracks",
    ldType: "MusicRecording",
    seriesType: "MusicAlbum",
    seriesProp: "inAlbum",
    backHref: "/#songs-global",
    backLabel: "All Songs",
    rankFeed: "Songs",
    // On a music feed <itunes:author> IS the artist, and cleanly so: 97.4% of
    // album pages carry a usable one. The stronger label is earned here in a
    // way it is not on the podcast side.
    credit: "Artist",
    dated: "Released",
    viewShow: "View Album",
    // "Track Notes" rather than "Liner Notes": the source is the item's own
    // <description>, so the notes belong to this track, where liner notes are
    // an album-level form. Same literalism as "Track 3" over "Ep. 3".
    notes: "Track Notes",
  },
};

const copyFor = (medium) => (medium === "music" ? COPY.music : COPY.podcast);

// The show's credit line, or "" when there is nothing honest to print. Two
// rejections, both deliberate: an EMPTY author, and one that merely repeats the
// SHOW title (~7% of rows) after normalizing case, punctuation and a leading
// "The". Note it is compared against the show's title and not the episode's —
// "By Bowl After Bowl" under an episode heading is a real credit, where the same
// string on the show's own page is noise.
//
// Nothing else is filtered. A tagline like "Bitcoin is for Everyone" reads oddly
// and still ships, because any rule sharp enough to catch it also eats real
// names, and a wrongly suppressed credit is worse than an awkward one.
function usableAuthor(ep) {
  const author = String(ep.p_author || "").trim();
  if (!author) return "";
  const norm = (v) => String(v || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
  return norm(author) === norm(ep.p_title) ? "" : author;
}

// ── the page ─────────────────────────────────────────────────────────────────

function renderEpisodePage({ ep, supporters, boosts, boosterCount, latestTs, names, community, ranks }) {
  const copy = copyFor(ep.p_medium);
  const title = ep.title;
  const showTitle = ep.p_title || "";
  const pageUrl = `${SITE_ORIGIN}/episode/${encodeURIComponent(ep.item_guid)}`;
  const showUrl = ep.podcast_guid ? `/show/${encodeURIComponent(ep.podcast_guid)}` : null;

  // The art chain, which is one link longer than the show page's. An episode
  // with no art of its own falls back to the show's, and only then to the
  // show's second-chance <itunes:image> — the same order ob-data.js builds for
  // the feed cards, so the two surfaces recover from a dead URL identically.
  const chain = [ep.image, ep.p_image, ep.p_artwork]
    .filter((u) => isSafeUrl(u))
    .filter((u, i, a) => a.indexOf(u) === i);
  const [art, art2, art3] = chain;

  // A music release leads with its artist, the way every music service titles
  // one. 97.4% of music feeds carry a usable artist; the rest fall back to the
  // standard form rather than printing a dangling separator.
  //
  // og:image stays on the PRIMARY, deliberately: a crawler cannot run the error
  // handler, and art2's presence means the feed publishes two different URLs
  // rather than that the first is dead. Four of the five shows carrying one have
  // a perfectly good primary.
  const artist = copy.ldType === "MusicRecording" ? usableAuthor(ep) : "";
  const ogTitle = artist
    ? `${artist} — ${title} | OnlyBoosts`
    : showTitle
      ? `${title} — ${showTitle} | OnlyBoosts`
      : `${title} — Boosts on Nostr | OnlyBoosts`;

  // Synthesized from the boost data rather than copied from the episode's own
  // shownotes. THE SCOPE HAS TO BE INSIDE THE SENTENCE, not merely on the page:
  // this is the one string that travels without the page around it, into a Nostr
  // client's preview card or a group chat, where nothing else qualifies it. A
  // bare "3 boosters have sent…" reads as a verdict on the episode's whole
  // audience. Don't trim it.
  const one = boosterCount === 1;
  const ogDesc = boosterCount
    ? `${num(boosterCount)} Nostr booster${one ? " has" : "s have"} sent ` +
      `${num(ep.total_sats)} sats to ${title}${showTitle ? ` (${showTitle})` : ""} across ` +
      `${num(ep.boost_count)} boost${ep.boost_count === 1 ? "" : "s"}. Counts cover only ` +
      `boosts published to Nostr; most boosting is keysend and never appears.`
    : `Boosts published to Nostr for ${title}, indexed by OnlyBoosts.`;

  const ld = {
    "@context": "https://schema.org",
    "@type": copy.ldType,
    name: title,
    url: pageUrl,
    ...(ep.published ? { datePublished: new Date(Number(ep.published) * 1000).toISOString().slice(0, 10) } : {}),
    ...(ep.episode_number ? { episodeNumber: ep.episode_number } : {}),
    ...(art ? { image: art } : {}),
    ...(showTitle ? { [copy.seriesProp]: { "@type": copy.seriesType, name: showTitle, ...(showUrl ? { url: SITE_ORIGIN + showUrl } : {}) } } : {}),
    ...(artist ? { byArtist: { "@type": "MusicGroup", name: artist } } : {}),
  };

  // MONEY PATH INPUT. /api/value resolves this episode's own value block from
  // Podcast Index at click time, keyed on the show's guid and/or feed URL plus
  // the item guid. An episode with no block of its own falls back to the feed's
  // server-side, so an episode of a boostable show is boostable.
  const boostPayload = {
    guid: ep.podcast_guid || null,
    title: showTitle,
    feed: isSafeUrl(ep.p_feed) ? ep.p_feed : null,
    img: art || null,
    itemGuid: ep.item_guid,
    episodeTitle: title,
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
  ${isSafeUrl(ep.p_feed) ? `<link rel="alternate" type="application/rss+xml" title="${htmlEscape(showTitle || title)}" href="${htmlEscape(ep.p_feed)}" />` : ""}

  <script type="application/ld+json">
  ${jsonForScript(ld)}
  </script>

  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v183" />
  <!-- The hero, the community wall and the boost list are the show page's, so
       this page links its stylesheet and adds only the deltas. -->
  <link rel="stylesheet" href="/assets/css/show-page.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/supporter-wall.css?v=ob-v183" />
  <!-- The episode card, for the community-episodes section: the same chrome
       feeds-podcasts.js paints on the homepage. -->
  <link rel="stylesheet" href="/assets/css/feed-cards.css?v=ob-v183" />
  <!-- The boost thread inside a card's drawer, and its reply / like / repost /
       zap bar. Only this page's community section needs them; /show does not. -->
  <link rel="stylesheet" href="/assets/css/boosts-thread.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/boost-actions.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/episode-page.css?v=ob-v183" />
</head>
<body data-episode-guid="${htmlEscape(ep.item_guid)}"${ep.podcast_guid ? ` data-show-guid="${htmlEscape(ep.podcast_guid)}"` : ""}>

<!-- NAV:START (generated by scripts/sync-partials.js — edit the partial) -->
<!-- ══════════════════════════════ NAV ══════════════════════════════
     SHARED NAV — single source of truth. Do NOT edit the copies inside the
     page files; edit THIS file, then run scripts/sync-partials.js to
     push it into every page (between the NAV:START / NAV:END markers).
     Styles live in /assets/css/nav.css; behavior in /assets/js/nav.js. -->
<!-- Theme boot. Runs before the nav (the first visible element) is parsed,
     so a returning dark-mode visitor never sees a light flash. The choice is
     per-browser (localStorage key ob-theme); absence means light, which is what
     every visitor saw before the toggle existed. The toggle itself is wired
     in nav.js; this only replays the stored choice.
     ⚠️ No backticks or dollar-brace in this file — sync-partials.js injects
     it into the edge Functions inside a template literal and exits nonzero
     if either appears. -->
<script>
(function () {
  try {
    if (localStorage.getItem('ob-theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) { /* storage blocked — the light default stands */ }
})();
</script>
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
            <!-- ⚠️ FEEDS IS ONE ENTRY PER TAB, NOT PER FEED. Reed's call,
                 2026-08-23. It listed all five sub-feeds, which was right while
                 the homepage hid them behind a dropdown and wrong the moment
                 the tabs put them on screen: the nav then restated a control
                 the page carries, in a different order, using different words
                 for the same things. Each entry lands on that tab's DEFAULT
                 sub-feed — TAB_DEFAULT in the index.html controller — so
                 Podcasts opens Episodes, Music opens Albums and Members opens
                 Boosts. **Those three hrefs and TAB_DEFAULT move together.**

                 The Global vs Follows axis stays deliberately absent: it is the
                 second dropdown on the page itself, and listing both scopes
                 here made the nav a grid restating a control the page has. -->
            <div class="nav-explore-group">
              <h4>Feeds</h4>
              <a href="/#episodes-global"><span aria-hidden="true">🎙</span> Podcasts</a>
              <a href="/#artists"><span aria-hidden="true">🎵</span> Music</a>
              <a href="/#members"><span aria-hidden="true">👥</span> Members</a>
            </div>
            <!-- Stats: the aggregate view over the same data. A coming-soon
                 page for now (noindex, out of the sitemap).

                 ⚠️ /boosters (Community) WAS THE SECOND ENTRY AND THE PAGE IS
                 DELETED, not redirected. Reed's call, 2026-08-23: the Members
                 tab now answers what it promised — the member lookup, the
                 top-members wall and the #40HPW boards — so leaving a
                 placeholder here pointed a reader at a promise for content that
                 exists one tab over. It was never linked from anywhere but this
                 menu and the footer, was noindex and out of the sitemap, so it
                 has no inbound links to preserve and gets no redirect. -->
            <div class="nav-explore-group">
              <h4>Stats</h4>
              <a href="/stats"><span aria-hidden="true">📊</span> Boost Stats</a>
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
    <!-- Dark-mode toggle. Shows the theme you would SWITCH TO (moon in
         light, sun in dark); nav.js owns the click, the storage write and
         the aria-label, and keeps other open tabs in step via the storage event. -->
    <button type="button" class="nav-theme-toggle" aria-label="Switch to dark mode" title="Switch to dark mode">
      <span class="ntt-moon" aria-hidden="true">🌙</span>
      <span class="ntt-sun" aria-hidden="true">☀️</span>
    </button>
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

<main class="show-main show-main--episode">

  <!-- Ships as a real link to the feed, which is what a visitor who arrived on
       a shared link should get; detail-page.js relabels it "Back" and wires
       history.back() when the previous document was one of ours. The href stays
       either way, so a middle-click still opens the feed in a new tab. -->
  <a class="show-back" href="${copy.backHref}" data-show-back>
    <span class="show-back-arrow" aria-hidden="true">←</span><span data-back-label>${copy.backLabel}</span>
  </a>

  ${renderHeader(ep, { art, art2, art3, copy, showTitle, showUrl, boosterCount, latestTs, ranks })}

  ${renderSupporters(supporters, {
    sub: `Everyone who has boosted ${htmlEscape(truncate(title, 90))} on Nostr, ranked by sats sent, all time.`,
    empty: `No boosters recorded for this ${copy.noun} yet.`,
  })}

  <!-- Below the wall since 2026-09-03 (Reed's call), the same order /show
       takes: the wall names the community, this says what else it boosts. -->
  ${renderCommunityEpisodes(copy, community)}

  ${renderBoosts(boosts, names, {
    heading: copy.boostsHeading,
    // "Every", not "the most recent": this list is not truncated in practice.
    // The busiest episode in the index carries 55 boosts against a cap of 500.
    sub: `Every boost sent to this ${copy.noun}, as published to Nostr, newest first.`,
    noun: copy.noun,
    // The target line would name this same episode on every row.
    showTarget: false,
    /* ⚠️ EVERY ROW IS A PAGE HERE, where the other two pages open on 24. The
     * sub-line above promises every boost and the page keeps it — the busiest
     * episode in the index carries 55 against a cap of 500 — so a re-sort must
     * not silently cut the list to 24 and grow a "Load more" this page has never
     * had. The number is the server's to declare for exactly that reason. */
    state: { page: BOOSTS_CAP },
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
      <!-- ⚠️ ONE ENTRY PER TAB, and it mirrors the nav's Explore menu exactly.
           The two are the site map and are regrouped together or not at all;
           each lands on that tab's default sub-feed. See partials/nav.html. -->
      <h3>Feeds</h3>
      <ul>
        <li><a href="/#episodes-global">🎙 Podcasts</a></li>
        <li><a href="/#artists">🎵 Music</a></li>
        <li><a href="/#members">👥 Members</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Stats</h3>
      <ul>
        <li><a href="/stats">📊 Boost Stats</a></li>
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

<script type="application/json" id="episode-boost-payload">${jsonForScript(boostPayload)}</script>

<script src="/assets/js/nav.js?v=ob-v183" defer></script>
<script src="/assets/js/episode-page.js?v=ob-v183" type="module"></script>
<!-- Lazy widget bootstrap. Plain (non-defer) script at the end of body, as on
     every page — see CLAUDE.md. -->
<script src="/assets/js/nav-widget-boot.js?v=ob-v183"></script>
<script src="/assets/js/sw-register.js?v=ob-v183" defer></script>
</body>
</html>`;
}

function creditLine(ep, copy) {
  const author = usableAuthor(ep);
  if (!author) return "";
  return `<p class="show-credit"><span class="show-credit-label">${htmlEscape(copy.credit)}</span> ${htmlEscape(truncate(author, 120))}</p>`;
}

function renderHeader(ep, { art, art2, art3, copy, showTitle, showUrl, boosterCount, latestTs, ranks }) {
  // The same three tiles as the show page, scoped to this episode, under the
  // same heading. THE STAT HEADING IS THIS PAGE'S QUALIFIER: "Nostr Boost Stats"
  // with the link carrying what the numbers exclude, rather than a caveat
  // paragraph under them. See the vocabulary note in CLAUDE.md — the pattern
  // across every surface is a short label at the point of the numbers.
  const stats = [
    { key: "sats", label: "sats", value: compact(ep.total_sats), exact: num(ep.total_sats) },
    { key: "boosts", label: ep.boost_count === 1 ? "boost" : "boosts", value: num(ep.boost_count), exact: num(ep.boost_count) },
    { key: "boosters", label: boosterCount === 1 ? "booster" : "boosters", value: num(boosterCount), exact: num(boosterCount) },
  ];

  // The show's name is the eyebrow, where /show puts the bare word "Show". It
  // is the one thing on this page that says which feed the episode belongs to,
  // and it is a link when the show has a page of its own — 23 titled episodes
  // carry no podcast guid, and those print the eyebrow's default instead.
  const eyebrow = showTitle
    ? (showUrl
        ? `<a href="${htmlEscape(showUrl)}" title="Nostr boosts to ${htmlEscape(showTitle)}">${htmlEscape(truncate(showTitle, 80))}</a>`
        : htmlEscape(truncate(showTitle, 80)))
    : copy.eyebrow;

  // Air date and run time on one line, then how long ago it was last boosted.
  // The show page's sub-line carries only the boost recency; an episode has
  // facts of its own worth stating, and they are what identify it among a
  // show's other episodes.
  //
  // ⚠️ THE EPISODE NUMBER IS DELIBERATELY NOT AMONG THEM. It used to lead this
  // line as "Ep. 42", directly under an <h1> that in most cases already reads
  // "Episode 42: The Thing", because publishers put the number in the title
  // they wrote. Reed's call, 2026-08-24: the number is dropped everywhere it
  // was rendered, here and on the /show drawer rows and the boost rows, and the
  // titles are left to speak for themselves. `episodes.episode_number` is still
  // stored, still selected and still published on /api/v1; nothing renders it.
  const bits = [
    ep.published ? `${copy.dated} ${fmtDate(ep.published)}` : null,
    fmtDuration(ep.duration) || null,
    latestTs ? `Last boosted ${relTime(latestTs)}` : null,
  ].filter(Boolean);

  // Native controls, no preload until played, and no JavaScript involved — an
  // episode page that cannot play the episode is missing the obvious thing. It
  // sits under the hero rather than in it so a long title never squeezes it.
  const audio = isSafeUrl(ep.enclosure_url)
    ? `<div class="ep-player-row"><audio class="pcast-player" controls preload="none" src="${htmlEscape(ep.enclosure_url)}"></audio></div>`
    : "";

  // THE PLAYER CARD. One bordered surface carrying the artwork, the title, the
  // actions, the player and the two drawers, the way localbitcoiners' episode
  // pages do it: everything about the RECORDING is one object, and the stat
  // tiles below it — which are about its boosts — sit on the page as they do on
  // /show. The show page's hero has no card because it has nothing to enclose;
  // this one does, which is why .ep-card is a delta in episode-page.css rather
  // than a change to the shared .show-hero.
  return `<header class="show-hero">
    <div class="ep-card">
    <div class="show-hero-inner">
      <div class="show-art">${
        art
          ? `<img src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""}${art3 ? ` data-art3="${htmlEscape(art3)}"` : ""} alt="" width="180" height="180" loading="eager" />`
          : `<div class="show-art-blank" aria-hidden="true">${copy.glyph}</div>`
      }</div>
      <div class="show-ident">
        <p class="show-eyebrow">${eyebrow}</p>
        <h1>${htmlEscape(ep.title)}</h1>
        ${creditLine(ep, copy)}
        <p class="show-sub">${bits.map(htmlEscape).join(" · ") || "No boosts recorded yet"}</p>
        <div class="show-actions">
          <button type="button" class="btn btn-boost" data-episode-boost hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clip-rule="evenodd"/></svg>
            ${copy.boostBtn}
          </button>
          ${showUrl
            ? `<a class="btn btn-quiet" href="${htmlEscape(showUrl)}">${htmlEscape(copy.viewShow)}</a>`
            : ""}
          <button type="button" class="btn btn-quiet" data-share-page>Share</button>
        </div>
      </div>
    </div>
    ${audio}
    ${renderChaptersDrawer(ep)}
    ${renderNotesDrawer(ep, copy)}
    </div>
    <h2 class="show-stats-title">
      <a href="/about#keysend">Nostr Boost</a> Stats
    </h2>
    ${renderStatTiles(stats, ranks, copy)}
  </header>`;
}

// ── The two drawers under the player ─────────────────────────────────────────
//
// Both sit inside the hero, between the audio element and the stat tiles, which
// is where localbitcoiners' episode pages put them and for the same reason: they
// are about the recording, and everything below the tiles is about its boosts.
// Both ship COLLAPSED. LB opens its chapter list by default, but that page is
// one show's own episode page with nothing under it; here a forty-row list would
// push the stats, the community wall and the boosts off the first screen of a
// page whose subject is the boosts.
//
// They use .ep-drawer, the show page's drawer — the sunken band, the SHOW/HIDE
// word and the rotating chevron, unchanged. A reader who has opened the episode
// drawer on /show has already learned this control.
//
// NEITHER SUMMARY CARRIES A COUNT, which is now the rule on every drawer the
// site has. The chapters one shipped with a chapter count for a day and it came
// off: it is defensible on its own terms (a chapter count is a complete fact
// about the publisher's file, not a figure bounded by our coverage the way the
// show page's would be), but a lid that sometimes carries a number and sometimes
// does not is a worse rule than one that never does.

/* Show notes. Server-rendered from D1's `episodes.description`, so this drawer
 * works with JavaScript off.
 *
 * ⚠️ WHAT THIS TEXT IS, precisely: the episode description as Podcast Index
 * returns it, run through the collector's clean_html — tags stripped, entities
 * decoded, ALL whitespace collapsed to single spaces. Two consequences that are
 * not bugs and cannot be fixed here. The publisher's paragraph breaks are gone,
 * so this renders as one block rather than LB's paragraph list; and links
 * survive only as bare URLs, which is why they are linkified below. Measured
 * over 2,218 episodes in the live index: 99.5% carry notes, median 590
 * characters, and PI caps the field near 1,000, which clips 0.6% of them
 * mid-sentence.
 */
function renderNotesDrawer(ep, copy) {
  const text = typeof ep.description === "string" ? ep.description.trim() : "";
  // Emitted either way. With text it ships visible and readable; without, it
  // ships hidden and empty for episode-page.js to fill from /api/episode-meta,
  // which sometimes has notes for an episode whose D1 row does not.
  return `<details class="ep-drawer ep-notes" data-notes${text ? "" : " hidden"}>
      <summary>${htmlEscape(copy.notes)}<span class="drawer-hint" aria-hidden="true"></span></summary>
      <div class="ep-notes-body" data-notes-body>${text ? `<p>${linkifyNotes(text)}</p>` : ""}</div>
    </details>`;
}

// Bare URLs → links, everything else escaped. renderMessage() in
// _shared/detail-page.js does this and more for a boost message, but it
// truncates at 420 characters, which is under the median length of a show note.
// The mention half of that function is not wanted here either: an npub inside a
// publisher's description is not a boost mention and has no name to resolve.
const NOTES_URL_RE = /https?:\/\/[^\s<>"']+/g;
function linkifyNotes(text) {
  let out = "";
  let cursor = 0;
  for (const m of text.matchAll(NOTES_URL_RE)) {
    out += htmlEscape(text.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    // A trailing sentence period is punctuation, not part of the URL.
    const raw = m[0].replace(/[.,;:)\]]+$/, "");
    const tail = m[0].slice(raw.length);
    out += isSafeUrl(raw)
      ? `<a href="${htmlEscape(raw)}" target="_blank" rel="noopener noreferrer">${htmlEscape(truncate(raw, 60))}</a>`
      : htmlEscape(raw);
    out += htmlEscape(tail);
  }
  return out + htmlEscape(text.slice(cursor));
}

/* Chapters. THE ONE THING ON THIS PAGE THAT DOES NOT EXIST WITHOUT JAVASCRIPT,
 * alongside #community-episodes, and for a data reason rather than a rendering
 * one: nothing in D1 knows this episode's <podcast:chapters> URL.
 * /api/episode-meta resolves it through Podcast Index at request time and
 * episode-page.js reveals this drawer only if rows come back — so the server cannot know whether there
 * is a drawer to draw.
 *
 * It therefore ships EMPTY and HIDDEN, which is the opposite of the choice
 * #community-episodes makes and correct for the same reason. That section is
 * hydrated by an IntersectionObserver, and an observer never fires on a hidden
 * target, so it needs a zero-height sentinel with a position. This one is
 * fetched unconditionally on load — it sits above the fold — so nothing has to
 * observe it, and a visible-but-empty drawer would be a lid over nothing on the
 * ~55% of episodes that publish no chapters.
 *
 * Withheld entirely when there is no enclosure to seek. A chapter list is a
 * control for the player; without one it is a table of timestamps pointing at
 * audio the page cannot play.
 */
function renderChaptersDrawer(ep) {
  if (!isSafeUrl(ep.enclosure_url)) return "";
  return `<details class="ep-drawer ep-chapters" data-chapters hidden>
      <summary>Chapters<span class="drawer-hint" aria-hidden="true"></span></summary>
      <ol class="ep-chapters-list" data-chapters-list></ol>
    </details>`;
}

// ── Other episodes this community boosts ─────────────────────────────────────
//
// The episode-level counterpart of the show page's "Other Shows This
// Community Boosts", and the one section on this page that page has no version
// of. The community is the set of pubkeys that boosted THIS episode; the rollup
// is every other episode those pubkeys have boosted, ranked.
//
// IT IS THE SAME OBJECT AS ITS SHOW-PAGE COUNTERPART, down to the class list: an
// .ep-drawer with the heading as its <summary>, the sort band inside the lid,
// and the list beneath — the same box the show page's community drawer and its
// episode drawer both are. It shipped first as a plain <section> with an <h2>
// and a control row, which made one component look like two things depending on
// which page you were reading. The drawer is the site's established form for a
// ranked list under a heading, so this is it.
//
// EVERY FIGURE IS COMMUNITY-SCOPED BY CONSTRUCTION. The query behind it
// (functions/api/v1/episodes/[guid].js) joins through the community set, so a
// card's boosters, boosts and sats are what THESE people sent that episode,
// never its global totals — the same property the show page's version has, and
// the reason the sort tag reads "Community Sort:" rather than "Sort:".
//
// ⚠️ IT IS SERVER-RENDERED NOW, and closing that was the point of the whole
// change. It used to be the one section on either detail page that was not, on
// the reasoning that a row here is the full Episodes-feed card — artwork, an
// audio player, the ⋮ subscribe menu, a boost pill and a drawer of boost notes
// with a reaction bar on each — and that card was a JavaScript artifact whose
// second implementation would drift from the one the homepage paints. CLAUDE.md
// recorded that as the rendering rule's one standing exception, tolerated
// because the section is a derived list below the fold, with instructions to
// close it rather than add a second.
//
// The fix was the one named there: split the card along the facts/verbs line.
// assets/js/episode-card.js builds it as an HTML string with no DOM, so it runs
// here and in the browser and there is no second implementation to drift —
// literally the same module, imported by relative path at the edge and by
// stamped URL in the page. episode-card-actions.js attaches the pill, the menus
// and the reaction bars to whichever side rendered it.
//
// So the drawer ships OPEN with thirty ranked cards in it, and a reader with no
// JavaScript gets the list, the artwork, the figures and every boost note. What
// they don't get is the re-sort, the range and the reactions, which is exactly
// the line the rule draws.
//
// ⚠️ SPLIT ON MEDIUM SINCE 2026-08-24, and it was the one rollup here that
// deliberately wasn't. The heading read "Other Episodes/Songs This Community
// Boosts" on both mediums and the corpus carried both. Reed reversed it, the
// same call renderCommunityShows takes on the show page: the homepage separates
// podcasts from music and these pages now do too. The heading comes off the
// COPY table and the FILTER lives in fetchCommunityBoosts — they are one
// decision, so changing either alone leaves the section naming something it
// isn't.
function renderCommunityEpisodes(copy, community) {
  // A community that has boosted nothing else has no section, which is a truer
  // answer than a heading over an empty list. Measured over a 900-page sample,
  // 6.1% of episodes land here — mostly communities that have boosted only this
  // show, which is excluded wholesale by the query. A failed corpus fetch takes
  // the same exit: `community` is null and the page is complete without it.
  const { items, profiles } = itemsFromBoosts(community?.boosts, { sort: "boosts" });
  if (!items.length) return "";

  return `<section class="show-section show-section--bare" id="community-episodes" data-community-episodes${
      community?.truncated ? " data-truncated" : ""}>
    <details class="ep-drawer" open data-ce-body>
      <!-- The summary IS the heading, exactly as on the show page's community
           drawer, which is why the section is --bare and carries no <h2>. The
           sub-line sits under the title INSIDE the summary rather than in a band
           of its own: it qualifies what the list is, so it belongs against the
           name of the list, and putting it in the toolbar below would crowd the
           range buttons off a phone. The hint is aria-hidden — <details>
           announces its own expanded state. -->
      <summary>
        <span class="cs-head">
          <span class="cs-head-title">${htmlEscape(copy.communityHeading)}</span>
          <span class="cs-head-sub">${htmlEscape(copy.communitySub)} boosted by people who boosted this ${htmlEscape(copy.noun)}</span>
        </span>
        <span class="drawer-hint" aria-hidden="true"></span>
      </summary>
      <!-- The range buttons and the sort pill mount here, the same pair the
           Episodes feed carries and in the same order, on the same band the show
           page's two drawers use. Ships hidden because both are VERBS: the list
           beneath is already ranked, and a control that cannot act is worse than
           none. episode-page.js reveals them. -->
      <div class="cs-controls ce-controls" data-ce-controls hidden></div>
      <!-- The cards and their "Load N more" live inside ONE scroll container,
           the same shape the show page's community drawer uses (.ep-list caps at
           32rem and scrolls). The load-more is inside it rather than under it so
           the drawer is a single box: a button below a scrolling window reads
           as belonging to the page, not to the list. -->
      <div class="ce-scroll" data-ce-scroll tabindex="0" role="region"
           aria-label="Other episodes and songs this community boosts">
        <div class="pcast-list" data-ce-list>${renderCardPage(items, {
          // NOT split on medium, unlike every other rollup on this site, so the
          // copy is the podcast table on both — see the note above. The cards
          // themselves say "episode" and a track among them reads correctly,
          // which is the same call renderCommunityShows makes on /show.
          copy: CARD_COPY.other,
          profiles,
          sort: "boosts",
          range: "all",
          limit: CARDS_PER_PAGE,
          // The figures STAY: they are community-scoped by construction, so
          // "27 boosters" here is what these people sent that episode and is the
          // whole point of the section.
          // The figures STAY and the layout goes compact — see CARD_PARTS.
          parts: { stats: true, layout: "compact" },
          state: { surface: "community-episodes", truncated: !!community?.truncated },
        })}</div>
        <div data-ce-more></div>
      </div>
    </details>
  </section>`;
}

// A guid with no page. Deliberately a real 404 rather than a shell of empty
// fields: 500 of the 7,182 episodes carrying an indexed boost have no title,
// artwork or Podcast Index record, so there is genuinely nothing to show.
/* No page for this episode. Send the reader to its SHOW when we can name one.
 *
 * ⚠️ THIS EXISTS BECAUSE THE TWO HALVES OF THE PIPELINE CAN DISAGREE, and the
 * disagreement is invisible from here. A feed card links an episode when the
 * BOOST RECORD carries a title, which comes from the collector's static exports;
 * this page renders from D1's `episodes` table. Those are normally the same set
 * and are not guaranteed to be: measured 2026-08-01, the manifest reported 6,755
 * enriched episodes against 6,688 rows in D1, so ~1% of the links the site
 * renders resolved to nothing. The cause is upstream — `d1_sync.py`'s delta path
 * pushes an episode only in the tick where a boost for it arrives, and silently
 * skips it when enrichment has not yet written the local row, never revisiting
 * it — and the fix belongs there. This is the graceful failure while any such
 * skew exists, not a substitute for fixing it.
 *
 * It covers the other miss too, and that one is permanent: 434 episodes carry
 * boosts under an item guid Podcast Index cannot identify, so they have no
 * title, no page and nothing to enrich. Their show is usually known perfectly
 * well, and a reader who followed a link to one is better served by the show
 * than by a dead end.
 *
 * 302, NEVER 301. Both cases are expected to resolve — the first when the
 * collector catches up, the second if Podcast Index ever learns the episode —
 * and a permanent redirect is cached by browsers indefinitely, so it would keep
 * sending readers to the show long after the episode page started working.
 *
 * The target is the bare `/show/<guid>`, not `#episodes`. That anchor opens the
 * show's episode drawer, and the drawer is built from the same `episodes` table
 * that just missed, so it is precisely the list this episode is NOT in.
 */
async function noEpisodePage(env, guid) {
  // One indexed lookup through idx_boosts_item, and only on the miss path. The
  // join to `podcasts` is what makes this a redirect rather than a guess: it
  // confirms the show has a title, which is exactly the rule /show/<guid>
  // applies, so this can never hand the reader a second 404.
  let row = null;
  try {
    row = await env.DB.prepare(
      `SELECT b.podcast_guid AS guid
       FROM boosts b
       JOIN podcasts p ON p.podcast_guid = b.podcast_guid
       WHERE b.item_guid = ? AND b.podcast_guid IS NOT NULL
         AND p.title IS NOT NULL AND p.title <> ''
       LIMIT 1`
    ).bind(guid).first();
  } catch (err) {
    // A failed lookup is a 404, not a 500: the reader asked for a page that
    // does not exist either way, and this query only ever improves the answer.
    console.warn("[episode] show fallback lookup failed", err);
  }

  if (!row?.guid) return notFound(guid);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/show/${encodeURIComponent(row.guid)}`,
      // Short, and shorter than the page's own 300s for the same reason the
      // status is 302: this answer is expected to stop being the right one.
      "Cache-Control": "public, max-age=120",
    },
  });
}

function notFound(guid) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Episode not found — OnlyBoosts</title>
  <link rel="icon" type="image/png" href="/assets/onlyboosts_favicon.png" />
  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v183" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v183" />
</head>
<body>
<section class="page-header">
  <p class="page-eyebrow">404</p>
  <h1>Episode not found</h1>
  <p>No indexed episode matches <code>${htmlEscape(truncate(guid || "", 80))}</code>.</p>
</section>
<main class="page-main">
  <div class="page-inner">
    <div class="soon-card">
      <p>Some boosts in the index carry an episode identifier that Podcast Index
         doesn't recognise, so the episode has no title, artwork or air date and
         therefore no page of its own. Those boosts still appear in the feeds.</p>
      <p><a href="/#episodes-global">Browse all episodes →</a></p>
    </div>
  </div>
</main>
<script src="/assets/js/sw-register.js?v=ob-v183" defer></script>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
