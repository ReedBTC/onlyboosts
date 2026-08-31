// GET /artist/:guid — one artist (publisher), server-rendered at the edge.
//
// The fourth detail page, and deliberately the same page as the other three:
// the back link, the stat tiles, the drawer chrome and the hash machinery come
// out of the shared modules unchanged. The subject is the PUBLISHER tier —
// <podcast:publisher>, the level above an album, which in practice is the
// ARTIST. The surface says "artist" and the data says "publisher", the same
// product/module seam as Podcasts → Episodes.
//
//   /show/<guid>      a show, and the episodes / audience under it
//   /episode/<guid>   one episode, and the audience under that
//   /booster/<npub>   one person, and everything they have boosted
//   /artist/<guid>    one ARTIST, and the albums / audience under them
//
// FOUR SECTIONS, the show page's set one tier up (Reed's spec plus his
// follow-up the same day): "Albums with Nostr Boosts", "Other Artists This
// Community Boosts", the Nostr Community wall, and #boosts — every boost to
// the artist's albums, with the shared range/sort machinery.
//
// ⚠️ INDEX-ONLY, like the Artists feed's drawer (Reed's call, 2026-08-30): the
// album list is `podcasts WHERE publisher_guid` — the shows whose boosts are
// this page's own figures — and never `publisher_albums`, the artist's
// catalogue file, which stays collected and unrendered.
//
// ⚠️ NO BOOST BUTTON, deliberately. /api/value resolves through Podcast Index,
// which cannot see most publisher feeds (measured: empty object for Wavlake
// artist guids, the majority of the corpus). A button that fails for most
// artists is worse than none; every album row below leads to a page that
// carries one.
//
// NAV/FOOTER markup between the marker comments is GENERATED — edit
// partials/nav.html or partials/footer.html and run scripts/sync-partials.js.
// Do not hand-edit it here.
import {
  htmlEscape, isSafeUrl, truncate, num, compact, relTime, jsonForScript,
  renderSupporters, renderBoosts, lookupMentionNames,
} from "../_shared/detail-page.js";
import { feedRanks, renderStatTiles } from "../_shared/feed-rank.js";

const SITE_ORIGIN = "https://onlyboosts.social";
const OG_FALLBACK = `${SITE_ORIGIN}/assets/onlyboosts_banner.png`;

// ⚠️ EVERY SECTION id ON THIS PAGE IS A PUBLIC URL, exactly as on the other
// three, and frozen from the day it ships:
//
//   #albums   #community-artists
//
// `#albums` is this page's own (no other page lists albums under a heading);
// `#community-artists` follows `#community-shows` / `#community-episodes` on
// the other pages — the same KIND of section takes the same-shaped id.

// A publisher guid is a UUID everywhere observed; the cap is a guard against a
// kilobyte string reaching a bound query, not a real length.
const GUID_MAX = 200;

// Distinct declaring shows per publisher tops out at 12 today (Haleen's 49 is
// catalogue, not indexed shows); 400 matches the booster page's SHOWS_CAP as a
// guard against a future outlier rather than a window.
const ALBUMS_CAP = 400;

// The community rollup's length. The show page caps at 40; an artist's
// audience is usually smaller and the list is one level more aggregated, so
// this is generous already.
const COMMUNITY_LIMIT = 40;

// The wall's guard against a pathological artist, not a page size — the same
// number and reasoning as SUPPORTER_CAP on /api/v1/podcasts/<guid>.
const SUPPORTER_CAP = 500;

// The boost list at the foot opens on the newest 24, the number every other
// detail page opens on; boost-section.js pages the rest through ?corpus=1.
const BOOSTS_SHOWN = 24;

export async function onRequestGet({ env, params }) {
  let guid = params.guid;
  if (Array.isArray(guid)) guid = guid[0];
  try { guid = decodeURIComponent(guid); } catch { /* keep the raw form */ }
  if (!guid || guid.length > GUID_MAX) return notFound(guid);

  const [pub, albums, totals, community, supporters, boosts] = await Promise.all([
    env.DB.prepare(
      `SELECT publisher_guid, feed_url, title, image, artwork, description, show_count
       FROM publishers WHERE publisher_guid = ?`
    ).bind(guid).first(),

    // The indexed albums, ranked by what they took — the same list, in the
    // same order, as /api/v1/publishers/<guid> serves the feed card's drawer.
    env.DB.prepare(
      `SELECT podcast_guid, title, image, artwork, medium,
              boost_count, total_sats, booster_count, latest_ts
       FROM podcasts WHERE publisher_guid = ?
       ORDER BY total_sats DESC, podcast_guid LIMIT ?`
    ).bind(guid, ALBUMS_CAP).all(),

    // The stat tiles: aggregated live rather than summed from the precomputed
    // columns, so the figures and the community rollup are computed over the
    // same rows in the same render.
    env.DB.prepare(
      `SELECT COUNT(*) AS boosts, COALESCE(SUM(b.sats), 0) AS sats,
              COUNT(DISTINCT b.booster_pubkey) AS boosters,
              MAX(b.created_at) AS latest_ts
       FROM boosts b
       JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
       WHERE pc.publisher_guid = ?`
    ).bind(guid).first(),

    // What else this artist's community boosts — the show page's community
    // rollup, one tier up. The community is everyone who boosted any of this
    // artist's albums; the rollup is every OTHER artist those people boost.
    //
    // ALL TIME ONLY, the show page's reasoning verbatim: audience overlap is a
    // standing fact, not a recent one.
    //
    // ⚠️ NOT SPLIT ON MEDIUM, and unlike the /show rollup's history this is
    // not a decision waiting to be reversed: every row here is a PUBLISHER,
    // one pool with no partition to cross — the 9 podcast-side declaring
    // shows aggregate into their artists like everything else. The medium
    // split separates kinds of SHOW; this list holds none.
    //
    // Every row is titled by the WHERE (the qualifying rule /artist itself
    // applies), so every row links. Fails quietly: a rollup below the fold
    // must never cost a reader the page they came for.
    env.DB.prepare(
      `WITH community AS (
         SELECT DISTINCT b.booster_pubkey
         FROM boosts b
         JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
         WHERE pc.publisher_guid = ?
       )
       SELECT pc.publisher_guid, pub.title, pub.image, pub.artwork,
              COUNT(*)                         AS cs_boosts,
              SUM(COALESCE(b.sats, 0))         AS cs_sats,
              COUNT(DISTINCT b.booster_pubkey) AS cs_members
       FROM boosts b
       JOIN community c    ON c.booster_pubkey   = b.booster_pubkey
       JOIN podcasts pc    ON pc.podcast_guid    = b.podcast_guid
       JOIN publishers pub ON pub.publisher_guid = pc.publisher_guid
       WHERE pc.publisher_guid <> ?
         AND pub.title IS NOT NULL
       GROUP BY pc.publisher_guid
       ORDER BY cs_members DESC, cs_boosts DESC, cs_sats DESC, pc.publisher_guid
       LIMIT ?`
    ).bind(guid, guid, COMMUNITY_LIMIT).all().catch((err) => {
      console.warn("[artist] community rollup failed", err);
      return { results: [] };
    }),

    // The Nostr Community wall: boosters ranked by sats sent to this artist's
    // albums, all time — fetchSupporters on /api/v1/podcasts/<guid>, one tier
    // up, with the same total order so an edge-cached render cannot swap ties.
    env.DB.prepare(
      `SELECT b.booster_pubkey, b.booster_npub,
              SUM(COALESCE(b.sats, 0)) AS sats,
              COUNT(*)                 AS boosts,
              MAX(b.created_at)        AS latest,
              pr.name, pr.display_name, pr.picture
       FROM boosts b
       JOIN podcasts pc ON pc.podcast_guid = b.podcast_guid
       LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
       WHERE pc.publisher_guid = ?
       GROUP BY b.booster_pubkey
       ORDER BY sats DESC, boosts DESC, b.booster_pubkey
       LIMIT ?`
    ).bind(guid, SUPPORTER_CAP).all(),

    // The newest 24 boosts to any of the artist's albums. The show is SELECTed
    // (p_title) because each row's album is new information here, the same
    // reasoning as /booster's list; the whole corpus is behind ?corpus=1.
    env.DB.prepare(
      `SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
              b.item_guid, b.podcast_guid, b.message, b.client_id,
              e.title AS e_title, e.episode_number AS e_num,
              p.title AS p_title,
              pr.name AS pr_name, pr.display_name AS pr_dname, pr.picture AS pr_pic
       FROM boosts b
       JOIN podcasts p ON p.podcast_guid = b.podcast_guid
       LEFT JOIN episodes e ON e.item_guid = b.item_guid
       LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
       WHERE p.publisher_guid = ?
       ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
    ).bind(guid, BOOSTS_SHOWN).all(),
  ]);

  // The qualifying rule: a publisher row WITH a title. The one bare row (a
  // stale link resolving to a non-publisher feed) 404s, matching the listing
  // endpoint's `title IS NOT NULL` — a page with no name, no art and no
  // description is not a page. And no boosts means no figures to be a page
  // about, same as /booster.
  if (!pub || !pub.title) return notFound(guid);
  if (!totals || !Number(totals.boosts)) return notFound(guid);

  const boostRows = boosts.results || [];
  // The second batch, needing the first's results — the booster page's shape.
  // feedRanks never throws; null renders tiles with no rank line.
  const [names, ranks] = await Promise.all([
    lookupMentionNames(env, boostRows.map((r) => r.message)),
    feedRanks(env.DB, "publisher", {
      guid,
      sats: totals.sats,
      boosts: totals.boosts,
      boosters: totals.boosters,
    }),
  ]);

  const html = renderArtistPage({
    pub,
    albums: albums.results || [],
    totals,
    community: community.results || [],
    supporters: (supporters.results || []).map((r, i) => ({
      rank: i + 1,
      pk: r.booster_pubkey,
      npub: r.booster_npub,
      name: r.display_name || r.name || null,
      pic: r.picture || null,
      sats: r.sats || 0,
      boosts: r.boosts || 0,
      latest: r.latest || null,
    })),
    boosts: boostRows,
    names,
    ranks,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The collector's five-minute cycle bounds freshness; same as /show.
      "Cache-Control": "public, max-age=300",
    },
  });
}

// The GET's status and headers, no body — see the HEAD convention in CLAUDE.md.
export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}

// ── the page ─────────────────────────────────────────────────────────────────

function renderArtistPage({ pub, albums, totals, community, supporters, boosts, names, ranks }) {
  const title = pub.title;
  const pageUrl = `${SITE_ORIGIN}/artist/${encodeURIComponent(pub.publisher_guid)}`;
  const art = isSafeUrl(pub.image) ? pub.image : null;
  const art2 = isSafeUrl(pub.artwork) && pub.artwork !== art ? pub.artwork : null;

  const ogTitle = `${title} — Boosts on Nostr | OnlyBoosts`;
  // The one string that travels without the page around it — full scope
  // sentence, never trimmed. Same rule as every other detail page.
  const albumCount = albums.length;
  const one = totals.boosters === 1;
  const ogDesc =
    `${num(totals.boosters)} Nostr booster${one ? " has" : "s have"} sent ` +
    `${num(totals.sats)} sats to ${title}’s albums across ` +
    `${num(totals.boosts)} boost${totals.boosts === 1 ? "" : "s"}. Counts cover ` +
    `only boosts published to Nostr; most boosting is keysend and never appears.`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: title,
    url: pageUrl,
    ...(art ? { image: art } : {}),
    ...(isSafeUrl(pub.feed_url) ? { mainEntityOfPage: pageUrl } : {}),
  };

  const stats = [
    { key: "sats", label: "sats", value: compact(totals.sats), exact: num(totals.sats) },
    { key: "boosts", label: totals.boosts === 1 ? "boost" : "boosts", value: num(totals.boosts), exact: num(totals.boosts) },
    { key: "boosters", label: totals.boosters === 1 ? "booster" : "boosters", value: num(totals.boosters), exact: num(totals.boosters) },
  ];

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
  <!-- The card type follows the image: artist artwork is square (it is podcast
       artwork one tier up), so a large card would slice it into a band. Same
       rule, same reasoning, as the other three pages. -->
  <meta name="twitter:card" content="${art ? "summary" : "summary_large_image"}" />
  <meta name="twitter:title" content="${htmlEscape(ogTitle)}" />
  <meta name="twitter:description" content="${htmlEscape(ogDesc)}" />
  <meta name="twitter:image" content="${htmlEscape(art || OG_FALLBACK)}" />
  <meta name="twitter:image:alt" content="${htmlEscape(art ? `Artwork for ${title}` : "OnlyBoosts")}" />
  ${isSafeUrl(pub.feed_url) ? `<link rel="alternate" type="application/rss+xml" title="${htmlEscape(title)}" href="${htmlEscape(pub.feed_url)}" />` : ""}

  <script type="application/ld+json">
  ${jsonForScript(ld)}
  </script>

  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/show-page.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/supporter-wall.css?v=ob-v165" />
  <!-- The boost note card and its reaction bar, for #boosts — the same
       .note-card every other detail page's list paints. -->
  <link rel="stylesheet" href="/assets/css/boosts-thread.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/boost-actions.css?v=ob-v165" />
</head>
<body data-artist-guid="${htmlEscape(pub.publisher_guid)}">

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
              <a href="/#albums"><span aria-hidden="true">🎵</span> Music</a>
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

<main class="show-main">

  <a class="show-back" href="/#artists" data-show-back>
    <span class="show-back-arrow" aria-hidden="true">←</span><span data-back-label>All Artists</span>
  </a>

  ${renderHeader(pub, art, art2, title, albumCount, totals, stats, ranks)}

  ${renderAlbums(albums)}

  ${renderCommunityArtists(community)}

  ${renderSupporters(supporters, {
    sub: `Everyone who has boosted ${htmlEscape(title)}’s albums on Nostr, ranked by sats sent, all time.`,
    empty: `No boosters recorded for this artist yet.`,
  })}

  ${renderBoosts(boosts, names, {
    heading: "Boosts",
    sub: `Every boost sent to ${htmlEscape(title)}’s albums, as published to Nostr.`,
    noun: "album",
    // TRUE twice: every row here targets a different track and a different
    // album, so both halves are the row's content rather than a repeat of the
    // <h1> — the /booster arrangement, minus its linkBooster exception.
    showTarget: true,
    showShow: true,
    total: totals.boosts,
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
      <!-- ⚠️ ONE ENTRY PER TAB, and it mirrors the nav's Explore menu exactly.
           The two are the site map and are regrouped together or not at all;
           each lands on that tab's default sub-feed. See partials/nav.html. -->
      <h3>Feeds</h3>
      <ul>
        <li><a href="/#episodes-global">🎙 Podcasts</a></li>
        <li><a href="/#albums">🎵 Music</a></li>
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

<script src="/assets/js/nav.js?v=ob-v165" defer></script>
<script src="/assets/js/artist-page.js?v=ob-v165" type="module"></script>
<!-- Lazy widget bootstrap. Plain (non-defer) script at the end of body, as on
     every page — see CLAUDE.md. -->
<script src="/assets/js/nav-widget-boot.js?v=ob-v165"></script>
<script src="/assets/js/sw-register.js?v=ob-v165" defer></script>
</body>
</html>`;
}

// ── The header ───────────────────────────────────────────────────────────────
//
// The show hero's shape with the artist as subject. The sub-line counts the
// INDEXED albums — every one has a boost, so the number is a claim about this
// index and not about the artist's catalogue, which is the same honesty rule
// that keeps episode counts off every surface.
function renderHeader(pub, art, art2, title, albumCount, totals, stats, ranks) {
  return `<header class="show-hero">
    <div class="show-hero-inner">
      <div class="show-art">${
        art
          ? `<img src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""} alt="" width="180" height="180" loading="eager" />`
          : `<div class="show-art-blank" aria-hidden="true">🎤</div>`
      }</div>
      <div class="show-ident">
        <p class="show-eyebrow">Artist</p>
        <h1>${htmlEscape(title)}</h1>
        <p class="show-sub">${
          [
            `${num(albumCount)} album${albumCount === 1 ? "" : "s"} with Nostr Boosts`,
            totals.latest_ts ? `Last boosted ${htmlEscape(relTime(totals.latest_ts))}` : null,
          ].filter(Boolean).join(" · ")
        }</p>
        <div class="show-actions">
          ${isSafeUrl(pub.feed_url)
            ? `<a class="btn btn-quiet" href="${htmlEscape(pub.feed_url)}" target="_blank" rel="noopener">RSS feed</a>`
            : ""}
          <button type="button" class="btn btn-quiet" data-share-page>Share</button>
        </div>
      </div>
    </div>
    ${renderDescription(pub.description)}
    <h2 class="show-stats-title">
      <a href="/about#keysend">Nostr Boost</a> Stats
    </h2>
    ${renderStatTiles(stats, ranks, { rankFeed: "Artists", backHref: "/#artists" })}
  </header>`;
}

/* The artist's own bio, off their publisher feed — plain text (the collector
 * strips markup on the way in), paragraphs on blank lines. The same clamp
 * machinery as the show description: show-desc.js adds the More control only
 * when the text overflows, and with no JavaScript it renders in full. */
function renderDescription(description) {
  const text = String(description || "").trim();
  if (!text) return "";
  const body = text.split(/\n\s*\n/).map((p) => {
    const t = p.trim();
    return t ? `<p>${htmlEscape(t)}</p>` : "";
  }).filter(Boolean).join("");
  if (!body) return "";
  return `<div class="show-desc" data-show-desc>
      <div class="show-desc-body" data-show-desc-body>${body}</div>
    </div>`;
}

// ── Albums with Nostr Boosts ─────────────────────────────────────────────────
//
// The show page's episode drawer, one tier up: each row is an ALBUM (a show),
// ranked by sats, linking to its /show page. Every row is indexed by
// construction. No "See All Albums" band link — the catalogue file is
// deliberately unrendered (index-only), so there is nothing off-site to point
// at that this page's rule would allow.
function renderAlbums(rows) {
  if (!rows.length) {
    return `<section class="show-section show-section--bare" id="albums">
      <p class="show-empty">No album boosts recorded for this artist yet.</p>
    </section>`;
  }

  return `<section class="show-section show-section--bare" id="albums">
    <details class="ep-drawer" open data-artist-albums>
      <summary>Albums with Nostr Boosts<span class="drawer-hint" aria-hidden="true"></span></summary>
      <!-- Ships hidden: a sort control that cannot sort is worse than none.
           artist-page.js reveals it when there are at least two rows. -->
      <div class="cs-controls" data-al-controls hidden></div>
      <ul class="ep-list" data-al-list>
        ${rows.map((a) => albumRow(a)).join("\n        ")}
      </ul>
    </details>
  </section>`;
}

function albumRow(a) {
  const art = isSafeUrl(a.image) ? a.image : null;
  const art2 = isSafeUrl(a.artwork) && a.artwork !== art ? a.artwork : null;
  const titled = Boolean(String(a.title || "").trim());
  const title = titled ? truncate(a.title, 120) : "Untitled release";
  const boosts = Number(a.boost_count || 0);
  const sats = Number(a.total_sats || 0);
  const boosters = Number(a.booster_count || 0);

  // boosters,boosts,sats,latest — the axes the drawer's sort reorders on,
  // packed the way the show page's episode rows pack theirs.
  const pack = [boosters, boosts, sats, Number(a.latest_ts || 0)].join(",");

  const meta = `${num(sats)} sats · ${num(boosts)} boost${boosts === 1 ? "" : "s"} · ` +
    `${num(boosters)} booster${boosters === 1 ? "" : "s"}`;

  // A declaring show without a title has no /show page (the qualifying rule is
  // the title) and renders as plain text — indexed, so it is still a row.
  return `<li class="ep-row" data-al="${pack}">
          ${art
            ? `<img class="ep-art" src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />`
            : `<span class="ep-art ep-art--blank" aria-hidden="true">💿</span>`}
          <div class="ep-main">
            <p class="ep-title">${
              titled
                ? `<a class="ep-title-link" href="/show/${encodeURIComponent(a.podcast_guid)}" title="Nostr boosts to ${htmlEscape(title)}">${htmlEscape(title)}</a>`
                : htmlEscape(title)
            }</p>
            <p class="ep-meta">${htmlEscape(meta)}</p>
          </div>
        </li>`;
}

// ── Other artists this community boosts ──────────────────────────────────────
//
// The show page's community rollup, one tier up, on the same chrome
// (.cs-drawer / .cs-row) so a reader who screenshots the two cannot tell the
// component apart — only the subject differs. Every figure is scoped to this
// artist's community by the query's join.
function communityMeta(members, boosts, sats) {
  return `${num(members)} community booster${members === 1 ? "" : "s"} · ` +
    `${num(boosts)} boost${boosts === 1 ? "" : "s"} · ${compact(sats)} sats`;
}

function communityArtistRow(r, rank) {
  const art = isSafeUrl(r.image) ? r.image : null;
  const art2 = isSafeUrl(r.artwork) && r.artwork !== art ? r.artwork : null;
  const title = truncate(r.title, 120);
  const members = Number(r.cs_members || 0);
  const boosts = Number(r.cs_boosts || 0);
  const sats = Number(r.cs_sats || 0);

  // No boost pill — the page-wide decision; the artist's own page is one
  // click away and its album rows lead to pages that carry one.
  return `<li class="cs-row" data-cs="${boosts},${sats},${members}">
    <a class="cs-link" href="/artist/${encodeURIComponent(r.publisher_guid)}">
      <span class="cs-rank" aria-hidden="true">${rank}</span>
      ${art
        ? `<img class="cs-art" src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />`
        : `<span class="cs-art cs-art--blank" aria-hidden="true">🎤</span>`}
      <span class="cs-main">
        <span class="cs-title">${htmlEscape(title)}</span>
        <span class="cs-meta">${htmlEscape(communityMeta(members, boosts, sats))}</span>
      </span>
    </a>
  </li>`;
}

function renderCommunityArtists(rows) {
  if (!rows.length) return "";

  return `<section class="show-section show-section--bare" id="community-artists">
    <details class="ep-drawer cs-drawer" open data-community-artists>
      <summary>Other Artists This Community Boosts<span class="drawer-hint" aria-hidden="true"></span></summary>
      <div class="cs-controls" data-cs-controls hidden></div>
      <ul class="ep-list cs-list" data-cs-list>
        ${rows.map((r, i) => communityArtistRow(r, i + 1)).join("\n        ")}
      </ul>
    </details>
  </section>`;
}

// A guid with no titled publisher behind it. A real 404: the one bare row and
// every unknown guid have nothing to render.
function notFound(guid) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Artist not found — OnlyBoosts</title>
  <link rel="icon" type="image/png" href="/assets/onlyboosts_favicon.png" />
  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v165" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v165" />
</head>
<body>
<section class="page-header">
  <p class="page-eyebrow">404</p>
  <h1>Artist not found</h1>
  <p>No indexed artist matches <code>${htmlEscape(truncate(String(guid || ""), 80))}</code>.</p>
</section>
<main class="page-main">
  <div class="page-inner">
    <div class="soon-card">
      <p>This page exists for artists whose albums carry at least one Nostr
         boost, linked through the feed's own <code>podcast:publisher</code>
         tag. An artist nobody has boosted has nothing to show here.</p>
      <p><a href="/#artists">Browse all artists →</a></p>
    </div>
  </div>
</main>
<script src="/assets/js/sw-register.js?v=ob-v165" defer></script>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
