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

const SITE_ORIGIN = "https://onlyboosts.social";
const OG_FALLBACK = `${SITE_ORIGIN}/assets/onlyboosts_banner.png`;

// Guids are UUIDs at 36 chars; the cap leaves slack for the odd-but-real values
// in the index without letting a kilobyte string reach a bound query.
const GUID_MAX = 200;

// How many supporters paint above the fold. The rest render behind a toggle
// rather than being dropped — a supporters wall that hides supporters is worse
// than a long page.
const SUPPORTERS_VISIBLE = 24;
const PODIUM = 3;
const BOOSTS_SHOWN = 24;

export async function onRequestGet({ request, env, params }) {
  let guid = params.guid;
  if (Array.isArray(guid)) guid = guid[0];
  try { guid = decodeURIComponent(guid); } catch { /* keep the raw form */ }
  if (!guid || guid.length > GUID_MAX) return notFound(guid);

  const show = await env.DB.prepare(
    // No episode_count: it is deliberately never displayed (see the stats
    // block below), and selecting it invites someone to put the tile back.
    `SELECT podcast_guid, title, image, feed_url, medium, boost_count, total_sats,
            booster_count, latest_ts
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

  const [eps, sups, boosts] = await Promise.all([
    env.DB.prepare(
      // Newest episode first. `published` is null on a meaningful slice of
      // rows, and SQLite sorts NULL below every value, so DESC sinks the
      // undated ones without needing an explicit guard — a `0` fallback would
      // have floated them to the top instead.
      `SELECT item_guid, title, image, published, duration, episode_number,
              enclosure_url, boost_count, total_sats
       FROM episodes WHERE podcast_guid = ?
       ORDER BY published DESC, total_sats DESC, item_guid LIMIT 500`
    ).bind(guid).all(),
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
  ]);

  const html = renderShowPage({
    show,
    episodes: eps.results || [],
    supporters: sups.results || [],
    boosts: boosts.results || [],
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

// ── helpers ──────────────────────────────────────────────────────────────────

function htmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonForScript(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

// Matches assets/js/boosts-feed.js#isSafeUrl. Every image and link on this page
// originates in third-party RSS by way of Podcast Index, so none of it reaches
// href/src unchecked.
function isSafeUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

function num(n) {
  return Number(n || 0).toLocaleString("en-US");
}

// Compact sats for the stat tiles: 45,045,439 reads worse than 45.0M at a
// glance, and the exact figure is in the title attribute.
function compact(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1e4) return Math.round(v / 1e3) + "k";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function isoDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - Number(ts || 0);
  if (!Number.isFinite(sec) || sec < 0) return "";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`;
  return fmtDate(ts);
}

function fmtDuration(sec) {
  const s = Number(sec || 0);
  if (!s || s < 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

// A supporter with no kind-0 gets their npub, shortened. `booster.npub` is
// nullable where the pubkey is not, so fall back to hex.
function shortId(npub, pk) {
  const s = npub || pk || "";
  if (s.length < 16) return s;
  return s.slice(0, 10) + "…" + s.slice(-4);
}

function displayName(r) {
  return r.display_name || r.pr_dname || r.name || r.pr_name || null;
}

// ── the page ─────────────────────────────────────────────────────────────────

function renderShowPage({ show, episodes, supporters, boosts }) {
  const title = show.title;
  const pageUrl = `${SITE_ORIGIN}/show/${encodeURIComponent(show.podcast_guid)}`;
  const art = isSafeUrl(show.image) ? show.image : null;
  const ogTitle = `${title} — Boosts & Supporters | OnlyBoosts`;

  // The description is synthesized from the boost data rather than copied from
  // the show's own blurb. D1 doesn't carry the blurb (it lives only in the
  // per-show shard, too heavy to fetch per page), but more importantly this
  // page is about the boosts, not the podcast, so the stats are the honest
  // summary and they differentiate the preview from every podcast directory.
  const one = show.booster_count === 1;
  const ogDesc = show.booster_count
    ? `${num(show.booster_count)} supporter${one ? " has" : "s have"} sent ` +
      `${num(show.total_sats)} sats to ${title} across ${num(show.boost_count)} ` +
      `boost${show.boost_count === 1 ? "" : "s"}, indexed from Nostr by OnlyBoosts.`
    : `Boosts and supporters for ${title}, indexed from Nostr by OnlyBoosts.`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "PodcastSeries",
    name: title,
    url: pageUrl,
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
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="OnlyBoosts" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="${htmlEscape(pageUrl)}" />
  <meta property="og:title" content="${htmlEscape(ogTitle)}" />
  <meta property="og:description" content="${htmlEscape(ogDesc)}" />
  <meta property="og:site_name" content="OnlyBoosts" />
  <meta property="og:image" content="${htmlEscape(art || OG_FALLBACK)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${htmlEscape(ogTitle)}" />
  <meta name="twitter:description" content="${htmlEscape(ogDesc)}" />
  <meta name="twitter:image" content="${htmlEscape(art || OG_FALLBACK)}" />
  ${isSafeUrl(show.feed_url) ? `<link rel="alternate" type="application/rss+xml" title="${htmlEscape(title)}" href="${htmlEscape(show.feed_url)}" />` : ""}

  <script type="application/ld+json">
  ${jsonForScript(ld)}
  </script>

  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />

  <link rel="stylesheet" href="/assets/css/nav.css" />
  <link rel="stylesheet" href="/assets/css/footer.css" />
  <link rel="stylesheet" href="/assets/css/theme.css" />
  <link rel="stylesheet" href="/assets/css/page.css" />
  <link rel="stylesheet" href="/assets/css/show-page.css" />
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
                 exactly (Episodes / Shows / Boosts). The Global vs Follows
                 axis is deliberately absent — it's the second dropdown on the
                 page itself, and listing both scopes here made the nav a
                 six-item grid restating a control the page already has. -->
            <div class="nav-explore-group">
              <h4>Feeds</h4>
              <a href="/#episodes-global"><span aria-hidden="true">🎙</span> Episodes</a>
              <a href="/#shows"><span aria-hidden="true">📻</span> Shows</a>
              <a href="/#boosts-global"><span aria-hidden="true">⚡</span> Boosts</a>
            </div>
            <!-- Stats: the aggregate views over the same data. Both are
                 coming-soon pages for now (noindex, out of the sitemap). -->
            <div class="nav-explore-group">
              <h4>Stats</h4>
              <a href="/stats"><span aria-hidden="true">📊</span> Boost Stats</a>
              <a href="/boosters"><span aria-hidden="true">🧑‍🤝‍🧑</span> Boosters</a>
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

  ${renderHeader(show, art, title)}

  ${renderEpisodes(episodes, show)}

  ${renderSupporters(supporters, show)}

  ${renderBoosts(boosts)}

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
      <p>A Nostr client for only podcast boosts. Every Podcasting 2.0 boostagram published to Nostr, cached and indexed for stats by episode, show and supporter. Sort, filter, search, view all or just see boosts from your follows on Nostr.</p>
    </div>

    <!-- Same two groups as the nav's Explore menu, in the same order — the
         footer is the nav's site map repeated, so they're regrouped together
         or not at all. -->
    <div class="footer-col">
      <h3>Feeds</h3>
      <ul>
        <li><a href="/#episodes-global">🎙 Episodes</a></li>
        <li><a href="/#shows">📻 Shows</a></li>
        <li><a href="/#boosts-global">⚡ Boosts</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Stats</h3>
      <ul>
        <li><a href="/stats">📊 Boost Stats</a></li>
        <li><a href="/boosters">🧑‍🤝‍🧑 Boosters</a></li>
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

<script src="/assets/js/nav.js" defer></script>
<script src="/assets/js/show-page.js" type="module"></script>
<!-- Lazy widget bootstrap. Plain (non-defer) script at the end of body, as on
     every page — see CLAUDE.md. -->
<script src="/assets/js/nav-widget-boot.js"></script>
<script src="/assets/js/sw-register.js" defer></script>
</body>
</html>`;
}

function renderHeader(show, art, title) {
  // Three tiles, not four. There was an episode count here and it was removed
  // deliberately: sats, boosts and supporters are measures of boost activity
  // and have no meaning outside it, so "as published to Nostr" is the only
  // reading available. An episode count is a property of the PODCAST, with a
  // true value in the world, so printing one beside the show's name reads as a
  // claim about the show. Ours counted episodes carrying at least one boost we
  // indexed, which excludes keysend entirely and anything published before
  // NIP-73 tagging. Measured against RSS: 70 shown vs 415 real for Rabbit Hole
  // Recap, 64 vs 676 for LINUX Unplugged, and 22 vs 21 for Local Bitcoiners,
  // so not even reliably a subset. See docs/show-pages-spec.md.
  const stats = [
    { label: "sats", value: compact(show.total_sats), exact: num(show.total_sats) },
    { label: show.boost_count === 1 ? "boost" : "boosts", value: num(show.boost_count), exact: num(show.boost_count) },
    { label: show.booster_count === 1 ? "supporter" : "supporters", value: num(show.booster_count), exact: num(show.booster_count) },
  ];

  return `<header class="show-hero">
    <div class="show-hero-inner">
      <div class="show-art">${
        art
          ? `<img src="${htmlEscape(art)}" alt="" width="180" height="180" loading="eager" />`
          : `<div class="show-art-blank" aria-hidden="true">🎙️</div>`
      }</div>
      <div class="show-ident">
        <p class="show-eyebrow">Show</p>
        <h1>${htmlEscape(title)}</h1>
        <p class="show-sub">${
          show.latest_ts ? `Last boosted ${htmlEscape(relTime(show.latest_ts))}` : "No boosts recorded yet"
        }</p>
        <div class="show-actions">
          <button type="button" class="btn btn-boost" data-show-boost hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clip-rule="evenodd"/></svg>
            Boost this show
          </button>
          ${isSafeUrl(show.feed_url)
            ? `<a class="btn btn-quiet" href="${htmlEscape(show.feed_url)}" target="_blank" rel="noopener">RSS feed</a>`
            : ""}
          <button type="button" class="btn btn-quiet" data-share-page>Share</button>
        </div>
      </div>
    </div>
    <dl class="show-stats">
      ${stats.map((s) => `<div class="show-stat"><dt>${htmlEscape(s.label)}</dt><dd title="${htmlEscape(s.exact)}">${htmlEscape(s.value)}</dd></div>`).join("\n      ")}
    </dl>
    <!-- These pages are meant to be shared by the shows themselves, so the
         figures land in front of people with no idea what this site indexes.
         The caveat belongs next to the numbers that prompt the question, not
         buried in the footer: most boosting is keysend and never touches
         Nostr, so a show's real total is higher than what's shown here, and a
         supporter can be missing entirely. Both anchors are real sections of
         /about. -->
    <p class="show-datanote">
      These counts cover only boosts published to Nostr.
      <a href="/about#keysend">Most boosts are sent by keysend</a> and leave no
      public record, so the real totals are higher and some supporters won't
      appear. <a href="/about#limits">A boost note is a claim, not a receipt.</a>
    </p>
  </header>`;
}

// The supporters wall. LB's supporters.html is the visual ancestor (circular
// avatars, count badge, name beneath, click-to-copy npub), but its TIER system
// is deliberately not carried over: LB bucketed by absolute lifetime sats
// (100k / 69k / 21k), which works across one show's whole audience and
// collapses per show. The median show here has one booster and only 209 of
// 1,384 have five or more, so absolute thresholds would file nearly everyone in
// the bottom tier. Relative standing replaces it: a podium for the top three,
// then a ranked grid.
function renderSupporters(rows, show) {
  if (!rows.length) {
    return `<section class="show-section" id="supporters">
      <h2>Supporters</h2>
      <p class="show-empty">No supporters recorded for this show yet.</p>
    </section>`;
  }

  const podium = rows.slice(0, PODIUM);
  const rest = rows.slice(PODIUM);
  const hidden = Math.max(0, rest.length - (SUPPORTERS_VISIBLE - PODIUM));

  return `<section class="show-section" id="supporters">
    <div class="show-section-head">
      <h2>Supporters <span class="show-count">${num(rows.length)}</span></h2>
      <p class="show-section-sub">Ranked by sats sent to ${htmlEscape(show.title)}, all time.</p>
    </div>

    <ol class="sup-podium">
      ${podium.map((r, i) => supporterCard(r, i + 1, true)).join("\n      ")}
    </ol>

    ${rest.length ? `<ol class="sup-grid" data-supporter-grid>
      ${rest.map((r, i) => supporterCard(r, i + 1 + PODIUM, false, i >= SUPPORTERS_VISIBLE - PODIUM)).join("\n      ")}
    </ol>` : ""}

    ${hidden > 0 ? `<button type="button" class="btn btn-quiet show-more" data-show-more="supporter">
      Show ${num(hidden)} more supporter${hidden === 1 ? "" : "s"}
    </button>` : ""}
  </section>`;
}

function supporterCard(r, rank, isPodium, hidden = false) {
  const name = displayName(r);
  const label = name || shortId(r.booster_npub, r.booster_pubkey);
  const pic = isSafeUrl(r.picture) ? r.picture : null;
  // npub is nullable where the pubkey is not; the copy button falls back to hex
  // so the control is never dead.
  const copyVal = r.booster_npub || r.booster_pubkey;

  return `<li class="sup-card${isPodium ? " sup-card--podium" : ""}"${hidden ? " hidden data-overflow" : ""}>
        <span class="sup-rank">${rank}</span>
        <button type="button" class="sup-avatar${pic ? "" : " is-blank"}" data-copy-npub="${htmlEscape(copyVal)}" title="Copy npub" aria-label="Copy npub for ${htmlEscape(label)}">
          ${pic ? `<img src="${htmlEscape(pic)}" alt="" loading="lazy" />` : ""}
        </button>
        <span class="sup-name" title="${htmlEscape(label)}">${htmlEscape(label)}</span>
        <span class="sup-sats" title="${htmlEscape(num(r.sats))} sats across ${htmlEscape(num(r.boosts))} boosts">${htmlEscape(compact(r.sats))} sats</span>
      </li>`;
}

// Every boost to the show, newest first, labelled with what it targeted.
//
// NOT filtered to feed-level boosts, and that is the considered choice. Only 18%
// of qualifying shows have even one feed-level boost over six months and only 5%
// have three; UNGOVERNABLE, Citadel Dispatch and What Bitcoin Did would each
// show an empty section despite carrying 130+ boosts apiece. Whether a show
// accumulates them is an artifact of how listeners' apps build a boost, not a
// fact about the show. See the spec.
function renderBoosts(rows) {
  if (!rows.length) return "";

  return `<section class="show-section" id="boosts">
    <div class="show-section-head">
      <h2>Recent Boosts</h2>
      <p class="show-section-sub">The most recent boosts sent to this show, as published to Nostr.</p>
    </div>
    <ul class="boost-list">
      ${rows.map(boostRow).join("\n      ")}
    </ul>
  </section>`;
}

function boostRow(r) {
  const name = displayName(r) || shortId(r.booster_npub, r.booster_pubkey);
  const pic = isSafeUrl(r.pr_pic) ? r.pr_pic : null;
  const copyVal = r.booster_npub || r.booster_pubkey;
  const target = r.e_title
    ? (r.e_num ? `Ep. ${htmlEscape(r.e_num)} · ${htmlEscape(truncate(r.e_title, 70))}` : htmlEscape(truncate(r.e_title, 70)))
    : "the show";

  return `<li class="boost-row">
        <button type="button" class="sup-avatar sup-avatar--sm${pic ? "" : " is-blank"}" data-copy-npub="${htmlEscape(copyVal)}" title="Copy npub" aria-label="Copy npub for ${htmlEscape(name)}">
          ${pic ? `<img src="${htmlEscape(pic)}" alt="" loading="lazy" />` : ""}
        </button>
        <div class="boost-body">
          <p class="boost-meta">
            <span class="boost-who">${htmlEscape(name)}</span>
            <span class="boost-amt">${htmlEscape(num(r.sats))} sats</span>
            <span class="boost-when">${htmlEscape(relTime(r.created_at))}</span>
          </p>
          ${r.message ? `<p class="boost-msg">${htmlEscape(truncate(r.message, 420))}</p>` : ""}
          <p class="boost-target">→ ${target}</p>
        </div>
      </li>`;
}

function renderEpisodes(rows, show) {
  if (!rows.length) {
    return `<section class="show-section show-section--bare" id="episodes">
      <p class="show-empty">No episodes with recorded boosts yet.</p>
    </section>`;
  }

  // No heading or sub-line: the drawer's own summary already reads
  // "62 episodes", so a section title above it would only say it again.
  return `<section class="show-section show-section--bare" id="episodes">
    <details class="ep-drawer">
      <summary>Episodes with NIP-73 Boosts, newest first</summary>
      <ul class="ep-list">
        ${rows.map(episodeRow).join("\n        ")}
      </ul>
    </details>
  </section>`;
}

function episodeRow(e) {
  const bits = [fmtDate(e.published), fmtDuration(e.duration)].filter(Boolean);
  return `<li class="ep-row">
          <div class="ep-main">
            <p class="ep-title">${e.episode_number ? `<span class="ep-num">Ep. ${htmlEscape(e.episode_number)}</span> ` : ""}${htmlEscape(e.title || "Untitled episode")}</p>
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
  <link rel="stylesheet" href="/assets/css/nav.css" />
  <link rel="stylesheet" href="/assets/css/footer.css" />
  <link rel="stylesheet" href="/assets/css/theme.css" />
  <link rel="stylesheet" href="/assets/css/page.css" />
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
<script src="/assets/js/sw-register.js" defer></script>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
