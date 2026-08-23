// GET /booster/:npub — one booster's landing page, server-rendered at the edge.
//
// The third of the three detail pages, and deliberately the same page as the
// other two: the back link, the stat tiles, the drawers, the boost list and the
// whole client chrome come out of functions/_shared/detail-page.js and
// assets/js/detail-page.js unchanged. What differs is the subject.
//
//   /show/<guid>      a show, and the episodes / audience under it
//   /episode/<guid>   one episode, and the audience under that
//   /booster/<npub>   one PERSON, and everything they have boosted
//
// WHY SERVER-RENDERED, the same answer as the other two: the Open Graph card.
// This page exists to be shared, and a crawler handed an empty shell produces a
// blank preview.
//
// ⚠️ THE QUALIFYING RULE IS A BOOST, NOT A PROFILE. Every other page here
// qualifies on a title; this one cannot, because a booster with no kind-0 is a
// real and interesting page rather than a degraded one. Measured across the 51
// boosters the collector could not resolve a kind-0 for on any of the five
// profile relays: the median has one boost, eleven have five or more, and the
// heaviest has 374 boosts and 97,300 sats. So the header falls back to the npub
// and everything below it is unaffected. A pubkey with no boosts at all has
// nothing to render and 404s.
//
// ⚠️ NOT SPLIT ON MEDIUM, which every rollup on the feeds is. This is the same
// call renderCommunityShows and renderCommunityEpisodes make on the other two
// pages, and for the same reason: what one person listens to ACROSS podcasts and
// music is the interesting half of the finding, and splitting it would file the
// same person under two half-histories. So the headings read "Shows and Albums"
// and "Episodes and Songs" and there is no COPY table on this page at all.
//
// NAV/FOOTER markup between the marker comments is GENERATED — edit
// partials/nav.html or partials/footer.html and run scripts/sync-partials.js.
// Do not hand-edit it here.
import {
  htmlEscape, jsonForScript, isSafeUrl, num, compact, fmtDate, relTime,
  truncate, shortId, lookupMentionNames, lookupMentionProfiles, renderBioText,
  renderBoosts,
} from "../_shared/detail-page.js";
import { itemsFromBoosts, renderCardPage, CARDS_PER_PAGE } from "../_shared/episode-cards.js";
import { fetchBoosterCorpus } from "../api/v1/boosters/[npub].js";
import { COPY as CARD_COPY } from "../../assets/js/episode-card.js";

const SITE_ORIGIN = "https://onlyboosts.social";
const OG_FALLBACK = `${SITE_ORIGIN}/assets/onlyboosts_banner.png`;

// ⚠️ EVERY SECTION id ON THIS PAGE IS A PUBLIC URL, exactly as on the other two.
// The three ids below are a contract with links in the wild and must not be
// renamed:
//
//   #shows   #episodes   #boosts
//
// Two of them are reused deliberately. `#episodes` is what /show/<guid> calls
// its episode drawer and `#boosts` is what both other pages call their boost
// list, so a reader who has learned one URL has learned all three. `#shows` is
// this page's own; no other page has a section listing shows under a heading.
//
// scroll-margin-top on .show-section in show-page.css and initHashRouting() /
// initHashSpy() in detail-page.js are what make them land correctly; see the
// note in functions/show/[guid].js.
//
// ⚠️ ONE HONEST GAP, and it is the same one /episode has: #episodes here is
// CLIENT-RENDERED, so with JavaScript off there is nothing for that anchor to
// resolve to. #shows and #boosts are server-rendered and resolve either way.

// An npub is 63 characters. The cap is slack for the hex form and nothing more —
// this is a guard against a kilobyte string reaching a bound query, not a real
// length. Unlike the episode page's key, an npub has no slashes and no URL-shaped
// values, so it needs none of that page's decoding care.
const NPUB_MAX = 200;

// Distinct shows per booster runs to a measured maximum of 185, so this never
// bites today. It is the same kind of guard as the episode page's BOOSTS_CAP.
const SHOWS_CAP = 400;

// The boost list at the foot. 24 is what /show/<guid> shows, and the same
// reasoning applies: this is the "recent" list, and the whole history is what
// the two rollups above it are for.
const BOOSTS_SHOWN = 24;

export async function onRequestGet({ env, params }) {
  let raw = params.npub;
  if (Array.isArray(raw)) raw = raw[0];
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw form */ }
  if (!raw || raw.length > NPUB_MAX) return notFound(raw);

  const hex = toHexPubkey(raw);
  if (!hex) return notFound(raw);

  // The four queries in one round of parallelism, the same shape both other
  // pages use. Every one of them is served by idx_boosts_booster.
  const now = Math.floor(Date.now() / 1000);
  const cut1w = now - 7 * 86400;
  const cut1m = now - 30 * 86400;
  const cut1y = now - 365 * 86400;

  /* ⚠️ THE CORPUS IS FETCHED HERE NOW, because #episodes is SERVER-RENDERED.
   * It was the second of the rendering rule's two exceptions and closed with the
   * first — the card is one shared definition (assets/js/episode-card.js) that
   * runs at the edge and in the browser, so there is no second implementation to
   * drift. See the note over renderCommunityEpisodes in functions/episode/[guid].js.
   *
   * It never rejects: a failure costs this one section and the rest of the page
   * renders exactly as it did. The measured heaviest booster has 975 boosts
   * against a 2,000 cap, so this is one indexed scan through idx_boosts_booster
   * rather than the fan-out /episode pays. */
  const [prof, totals, shows, boosts, corpus] = await Promise.all([
    // ⚠️ COLUMNS NAMED, never SELECT *. The five beyond the original set landed
    // on 2026-08-13 and are nullable at very different rates: about 54%,
    // lud16 65%, lud06 4.4%, website 19%, banner 43%. Every one of them is
    // therefore a conditional in the header rather than a field with a
    // placeholder.
    env.DB.prepare(
      `SELECT pubkey, name, display_name, picture, nip05,
              about, lud16, lud06, website, banner
       FROM profiles WHERE pubkey = ?`
    ).bind(hex).first(),

    // The stat tiles, plus the npub for a caller who arrived on the hex form.
    // COUNT(DISTINCT ...) ignores NULLs, which is what we want: a boost with no
    // podcast guid is still a boost and is not a show.
    env.DB.prepare(
      `SELECT COUNT(*) AS boosts, COALESCE(SUM(sats), 0) AS sats,
              COUNT(DISTINCT podcast_guid) AS shows,
              COUNT(DISTINCT item_guid)    AS eps,
              MIN(created_at) AS first_ts, MAX(created_at) AS latest_ts,
              MAX(booster_npub) AS npub
       FROM boosts WHERE booster_pubkey = ?`
    ).bind(hex).first(),

    // ── The shows rollup, with all four range windows precomputed ────────────
    //
    // ⚠️ THE FOUR WINDOWS ARE WHY THIS SECTION NEEDS NO FETCH AND NO SECOND
    // QUERY. The range control on the feeds is a query parameter because those
    // feeds page a ranked list off the server; here the whole corpus is one
    // person's history — a measured maximum of 185 distinct shows — so every
    // window can be aggregated in the SAME pass and shipped on the row. Sorting
    // and range-filtering then cost nothing at all, and the section still
    // renders ranked, at All, with JavaScript off.
    //
    // Conditional aggregates rather than four queries: SQLite evaluates all
    // twelve in the one GROUP BY, and the scan is the same rows either way.
    //
    // ⚠️ PLAIN `?` PLACEHOLDERS, REPEATED, never `?1`-style numbered ones. Each
    // cutoff is bound three times because it appears three times, and the bind
    // list below is in the order the placeholders appear in the TEXT — the nine
    // window cutoffs, then the pubkey in the WHERE, then the limit. Numbered
    // parameters would express this more tidily and are not what any other query
    // in this repo uses; see the repeated `.bind(guid, guid)` in
    // functions/show/[guid].js. Ordinal binding is the one form D1 documents
    // without qualification, and a query this shape is a bad place to find out.
    env.DB.prepare(
      `SELECT b.podcast_guid, p.title, p.image, p.artwork, p.medium,
              COUNT(*)                                  AS boosts,
              COALESCE(SUM(b.sats), 0)                  AS sats,
              COUNT(DISTINCT b.item_guid)               AS eps,
              MAX(b.created_at)                         AS latest,
              SUM(CASE WHEN b.created_at >= ? THEN 1 ELSE 0 END)                AS b1w,
              COALESCE(SUM(CASE WHEN b.created_at >= ? THEN b.sats END), 0)     AS s1w,
              COUNT(DISTINCT CASE WHEN b.created_at >= ? THEN b.item_guid END)  AS e1w,
              SUM(CASE WHEN b.created_at >= ? THEN 1 ELSE 0 END)                AS b1m,
              COALESCE(SUM(CASE WHEN b.created_at >= ? THEN b.sats END), 0)     AS s1m,
              COUNT(DISTINCT CASE WHEN b.created_at >= ? THEN b.item_guid END)  AS e1m,
              SUM(CASE WHEN b.created_at >= ? THEN 1 ELSE 0 END)                AS b1y,
              COALESCE(SUM(CASE WHEN b.created_at >= ? THEN b.sats END), 0)     AS s1y,
              COUNT(DISTINCT CASE WHEN b.created_at >= ? THEN b.item_guid END)  AS e1y
       FROM boosts b
       LEFT JOIN podcasts p ON p.podcast_guid = b.podcast_guid
       WHERE b.booster_pubkey = ? AND b.podcast_guid IS NOT NULL
       GROUP BY b.podcast_guid
       ORDER BY sats DESC, boosts DESC, b.podcast_guid
       LIMIT ?`
    ).bind(
      cut1w, cut1w, cut1w,
      cut1m, cut1m, cut1m,
      cut1y, cut1y, cut1y,
      hex, SHOWS_CAP,
    ).all(),

    env.DB.prepare(
      // ⚠️ THE SHOW IS SELECTED HERE AND ON NEITHER OTHER PAGE. A boost row names
      // the show beside the episode only where the show is new information, which
      // is this page: on /show it is the <h1> and on /episode it is the eyebrow,
      // so there the join would cost a lookup per render to print what the reader
      // is already looking at. One more LEFT JOIN through the podcasts primary
      // key, on a list capped at BOOSTS_SHOWN.
      `SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
              b.item_guid, b.podcast_guid, b.message,
              e.title AS e_title, e.episode_number AS e_num,
              p.title AS p_title,
              pr.name AS pr_name, pr.display_name AS pr_dname, pr.picture AS pr_pic
       FROM boosts b
       LEFT JOIN episodes e ON e.item_guid = b.item_guid
       LEFT JOIN podcasts p ON p.podcast_guid = b.podcast_guid
       LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
       WHERE b.booster_pubkey = ?
       ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`
    ).bind(hex, BOOSTS_SHOWN).all(),

    fetchBoosterCorpus(env, hex).catch((err) => {
      console.warn("[booster] episode corpus unavailable", err);
      return null;
    }),
  ]);

  // The qualifying rule, and the whole of it. A pubkey nobody has a boost for
  // has no page — not even if a profile row exists, which it can: `profiles`
  // holds anyone the collector resolved, and a page of zeroes about a stranger
  // is not a page.
  if (!totals || !Number(totals.boosts)) return notFound(raw);

  const boostRows = boosts.results || [];
  // Two lookups against the same table and deliberately not one. The boost list
  // wants names for its text chips; the bio wants names AND pictures for its
  // face chips, and merging them would make every /show and /episode render
  // carry a `picture` column it has no use for.
  const [names, bioProfiles] = await Promise.all([
    lookupMentionNames(env, boostRows.map((r) => r.message)),
    // Skipped entirely when the bio has no mention in it, which is the common
    // case — mentionedPubkeys returns empty and the helper never queries.
    lookupMentionProfiles(env, [prof?.about || ""]),
  ]);

  const html = renderBoosterPage({
    hex,
    npub: totals.npub || (raw.startsWith("npub") ? raw : null),
    prof: prof || null,
    totals,
    shows: shows.results || [],
    boosts: boostRows,
    names,
    bioProfiles,
    corpus,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // ⚠️ SHORTER THAN THE OTHER TWO PAGES' 300s, and the reason is upstream.
      // Profiles used to be fetched once and never re-read; since 2026-08-13
      // they are age-gated at 30 days, so a booster who edits their kind-0 now
      // changes this page's header. 120s is the collector's own five-minute
      // cycle rounded down rather than a guess at how often someone edits a bio;
      // the point is only that this page is no longer as immutable as a show's.
      "Cache-Control": "public, max-age=120",
    },
  });
}

// npub → hex. A local copy rather than an import from functions/api/v1/_common.js:
// that module is the API's, carrying CORS allowlists and cursor codecs this page
// has no business loading, and the conversion is fifteen lines. The three-copies
// rule that governs episodePageUrl applies — if one of these changes they all do.
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function toHexPubkey(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  const low = s.toLowerCase();
  if (!low.startsWith("npub1")) return null;
  const pos = low.lastIndexOf("1");
  const data = [];
  for (const c of low.slice(pos + 1)) { const v = B32.indexOf(c); if (v < 0) return null; data.push(v); }
  let acc = 0, bits = 0; const bytes = [];
  for (const v of data.slice(0, -6)) {
    acc = (acc << 5) | v; bits += 5;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  if (bytes.length < 32) return null;
  return bytes.slice(0, 32).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── the page ─────────────────────────────────────────────────────────────────

function renderBoosterPage({ hex, npub, prof, totals, shows, boosts, names, bioProfiles, corpus }) {
  const realName = prof?.display_name || prof?.name || null;
  const label = realName || shortId(npub, hex);
  const pageUrl = `${SITE_ORIGIN}/booster/${encodeURIComponent(npub || hex)}`;
  const pic = isSafeUrl(prof?.picture) ? prof.picture : null;
  const banner = isSafeUrl(prof?.banner) ? prof.banner : null;
  // ⚠️ THE SHARE CARD DOES NOT NAME THE AVATAR URL DIRECTLY. A preview fetcher
  // makes one request and cannot fall back, and the stored picture is a URL a
  // third party may have moved (10% answer 404) or a file bigger than the
  // fetcher will read (Signal Desktop stops at 1MB, the phones at 2MB). The
  // route under /api/og/booster/ fetches, resizes and size-caps it, and serves
  // the banner when it cannot. See functions/api/og/booster/[npub].js. The
  // header <img> below still uses the raw URL: a browser can run onerror.
  const ogImage = pic ? `${SITE_ORIGIN}/api/og/booster/${encodeURIComponent(npub || hex)}` : OG_FALLBACK;

  const satsTotal = Number(totals.sats || 0);
  const boostTotal = Number(totals.boosts || 0);
  const showTotal = Number(totals.shows || 0);
  const epTotal = Number(totals.eps || 0);

  const ogTitle = `${label} — Boosts on Nostr | OnlyBoosts`;

  // ⚠️ THE SCOPE SENTENCE LIVES INSIDE THIS STRING and nowhere else on the page,
  // the same as on the other two. og:description is what travels without the
  // page around it, into a Nostr client's preview card or a group chat where
  // nothing qualifies it. A bare "has sent 97,300 sats" reads as this person's
  // whole giving. Don't trim it.
  const ogDesc =
    `${label} has sent ${num(satsTotal)} sats across ${num(boostTotal)} ` +
    `boost${boostTotal === 1 ? "" : "s"} to ${num(showTotal)} ` +
    `show${showTotal === 1 ? "" : "s"} on Nostr. Counts cover only boosts ` +
    `published to Nostr; most boosting is keysend and never appears.`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: pageUrl,
    mainEntity: {
      "@type": "Person",
      name: label,
      identifier: npub || hex,
      ...(pic ? { image: pic } : {}),
      ...(isSafeUrl(prof?.website) ? { url: prof.website } : {}),
    },
  };

  const stats = [
    { label: "sats", value: compact(satsTotal), exact: num(satsTotal) },
    { label: boostTotal === 1 ? "boost" : "boosts", value: num(boostTotal), exact: num(boostTotal) },
    { label: showTotal === 1 ? "show" : "shows", value: num(showTotal), exact: num(showTotal) },
    { label: epTotal === 1 ? "episode" : "episodes", value: num(epTotal), exact: num(epTotal) },
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

  <meta property="og:type" content="profile" />
  <meta property="og:url" content="${htmlEscape(pageUrl)}" />
  <meta property="og:title" content="${htmlEscape(ogTitle)}" />
  <meta property="og:description" content="${htmlEscape(ogDesc)}" />
  <meta property="og:site_name" content="OnlyBoosts" />
  <!-- The AVATAR, not the banner. A share card is a square-ish thumbnail beside
       a headline in most clients, and a 3:1 banner cropped to that is a strip of
       someone's wallpaper; the face is what identifies the page. Same principle
       as og:image staying on a show's primary artwork. -->
  <meta property="og:image" content="${htmlEscape(ogImage)}" />
  <meta property="og:image:alt" content="${htmlEscape(pic ? `${label}’s profile picture` : "OnlyBoosts")}" />
  <!-- ⚠️ THE CARD TYPE FOLLOWS THE IMAGE, and this is the one page where it has
       to. A large-image card crops to about 1.91:1; a profile picture is nothing
       of the sort. Measured over 26 real booster avatars from the live index:
       NOT ONE is wide enough, 13 are exactly square, and the rest are portrait
       down to 0.67. So the large card was slicing a horizontal band out of the
       middle of every face — the pfp WAS being sent, and was being cropped into
       something unrecognisable, which is a worse failure than sending nothing,
       because it reads as a broken image rather than a missing one. The summary
       card is the small square thumbnail those dimensions actually are.

       The fallback keeps the large card: OG_FALLBACK is the 1800x600 site
       banner, which is the one image here that belongs in a wide frame. Two
       shapes, two cards, chosen by which one is in use. -->
  <meta name="twitter:card" content="${pic ? "summary" : "summary_large_image"}" />
  <meta name="twitter:title" content="${htmlEscape(ogTitle)}" />
  <meta name="twitter:description" content="${htmlEscape(ogDesc)}" />
  <meta name="twitter:image" content="${htmlEscape(ogImage)}" />
  <meta name="twitter:image:alt" content="${htmlEscape(pic ? `${label}’s profile picture` : "OnlyBoosts")}" />

  <script type="application/ld+json">
  ${jsonForScript(ld)}
  </script>

  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v126" />
  <!-- The hero, the drawers and the boost list are the show page's, so this
       page links its stylesheet and adds only the deltas. -->
  <link rel="stylesheet" href="/assets/css/show-page.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/supporter-wall.css?v=ob-v126" />
  <!-- The episode card, for the #episodes rollup: the same chrome
       feeds-podcasts.js paints on the homepage. -->
  <link rel="stylesheet" href="/assets/css/feed-cards.css?v=ob-v126" />
  <!-- The boost thread inside a card's drawer, and its reply / like / repost /
       zap bar, both reached through that same card. -->
  <link rel="stylesheet" href="/assets/css/boosts-thread.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/boost-actions.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/episode-page.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/booster-page.css?v=ob-v126" />
</head>
<body data-booster-pk="${htmlEscape(hex)}"${npub ? ` data-booster-npub="${htmlEscape(npub)}"` : ""}>

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

<main class="show-main show-main--booster">

  <!-- Ships as a real link to the Boosts feed, which is where a booster is
       reachable from today; detail-page.js relabels it "Back" and wires
       history.back() when the previous document was one of ours. /boosters is
       deliberately NOT the target: it is still a coming-soon placeholder, so a
       reader with nowhere to go back to would land on a page that says nothing. -->
  <a class="show-back" href="/#boosts-global" data-show-back>
    <span class="show-back-arrow" aria-hidden="true">←</span><span data-back-label>All Boosts</span>
  </a>

  ${renderHeader({ hex, npub, prof, label, realName, pic, banner, stats, totals, bioProfiles })}

  ${renderShows(shows, realName)}

  ${renderEpisodes(corpus)}

  ${renderBoosts(boosts, names, {
    // "Boosts Sent" rather than "Recent Boosts", for the same reason as on
    // /show: with a range and an order over this person's whole history the
    // section is no longer a sample of the last few days.
    heading: "Boosts Sent",
    sub: "Every boost this booster has sent, as published to Nostr, newest first.",
    itemAbbr: "Ep.",
    noun: "episode",
    // TRUE here, where /episode passes false: every row on this page targets a
    // different episode, so the "→ Ep. 3 · Title" line is the content of the row
    // rather than a repeat of the <h1>. This is the page renderBoosts' default
    // was written for.
    showTarget: true,
    // ⚠️ AND FALSE HERE, uniquely. Every row belongs to the booster whose page
    // this is, so the sweep that pointed every name and avatar at
    // /booster/<npub> would point this page at itself once per row. Same rule as
    // showTarget one line up, one column over.
    linkBooster: false,
    // ⚠️ TRUE HERE AND NOWHERE ELSE, by the same test again: this is the one page
    // where a row's SHOW is new information rather than the subject the reader
    // already has in front of them. It is what makes these rows the same object
    // as the homepage Boosts feed's cards, which have always named both.
    showShow: true,
    // This person's own total, so the load-more control is correct before the
    // client has fetched anything. The list itself is still the newest 24; the
    // heaviest booster in the index has sent 975.
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

<script src="/assets/js/nav.js?v=ob-v126" defer></script>
<script src="/assets/js/booster-page.js?v=ob-v126" type="module"></script>
<!-- Lazy widget bootstrap. Plain (non-defer) script at the end of body, as on
     every page — see CLAUDE.md. -->
<script src="/assets/js/nav-widget-boot.js?v=ob-v126"></script>
<script src="/assets/js/sw-register.js?v=ob-v126" defer></script>
</body>
</html>`;
}

// ── The header ───────────────────────────────────────────────────────────────
//
// The profile card is this page's answer to /episode's player card: one bordered
// surface holding everything about the PERSON, with the stat tiles outside it on
// the page because those are about their boosts. /show has no card because its
// hero has nothing to enclose.
//
// ⚠️ EVERY FIELD BELOW IS CONDITIONAL, and the coverage is why. Measured over
// the 1,948 stored profiles: about 53.9%, lud16 64.7%, website 18.8%,
// banner 42.5%, lud06 4.4%. A header built as a form with empty rows would be
// mostly empty rows; every one of these prints or is absent.
function renderHeader({ hex, npub, prof, label, realName, pic, banner, stats, totals, bioProfiles }) {
  const nip05 = String(prof?.nip05 || "").trim();
  const about = String(prof?.about || "").trim();
  const website = isSafeUrl(prof?.website) ? prof.website : null;

  // PREFER lud16 WHENEVER BOTH ARE PRESENT. The split is lopsided to the point
  // of being decided: 1,178 profiles carry lud16 alone, 82 carry both, and
  // exactly THREE carry lud06 alone. So lud16 is the designed case and lud06 is
  // the one that must not crash rather than one to build an experience around —
  // it prints as an opaque copyable string, being a bech32 LNURL nobody reads.
  const lud16 = String(prof?.lud16 || "").trim();
  const lud06 = String(prof?.lud06 || "").trim();

  // What the index could not supply, declared for booster-page.js to fill from
  // Primal. Nothing waits on it: this card is complete and readable as rendered,
  // and a visitor with no JavaScript keeps the shortened npub and blank circle.
  const missing = [
    realName ? null : "name",
    pic ? null : "pic",
    about ? null : "about",
    lud16 || lud06 ? null : "lud16",
  ].filter(Boolean).join(" ");

  const first = Number(totals.first_ts || 0);
  const latest = Number(totals.latest_ts || 0);
  const bits = [
    first ? `First boost ${fmtDate(first)}` : null,
    latest ? `Last boosted ${relTime(latest)}` : null,
  ].filter(Boolean);

  // ⚠️ THE AVATAR IS THE ONLY THING THAT MAY OVERLAP THE BANNER, and it is
  // positioned against the banner rather than pulled up by a margin. The first
  // version pulled the whole identity ROW up with a negative margin-top, and
  // since that row was avatar and text side by side, it dragged the name onto
  // the banner — a display name over a stranger's photograph is unreadable at
  // any contrast, because the photograph is arbitrary.
  //
  // This is the shape every Nostr client uses and it came from reading one:
  // MyNostr's ProfileModule (`~/Desktop/Files/nostr/mynostr`) renders a
  // fixed-height banner, an avatar absolutely positioned at `-bottom-12` so it
  // hangs exactly half below the banner's edge with a ring in the card's own
  // colour, and then a SEPARATE identity block padded at the top to clear it.
  // Twitter and Bluesky are the same arrangement. The identity block is
  // full-width as a result, which is a gain rather than a cost: the bio and the
  // chips get the whole card instead of a column beside a 112px avatar.
  return `<header class="show-hero">
    <div class="bs-card"${missing ? ` data-pk="${htmlEscape(hex)}" data-missing="${htmlEscape(missing)}"` : ""}>
      <div class="bs-banner${banner ? "" : " bs-banner--blank"}" data-bs-banner>
        ${banner ? `<img src="${htmlEscape(banner)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
        <span class="bs-avatar${pic ? "" : " is-blank"}" data-bs-avatar>
          ${pic ? `<img src="${htmlEscape(pic)}" alt="" width="112" height="112" loading="eager" referrerpolicy="no-referrer" />` : ""}
        </span>
      </div>
      <div class="show-ident bs-ident">
        <p class="show-eyebrow">Booster</p>
        <h1 data-bs-name>${htmlEscape(label)}</h1>
        ${nip05 ? `<p class="bs-nip05" data-bs-nip05><span aria-hidden="true">✓</span> ${htmlEscape(truncate(nip05, 60))}</p>` : `<p class="bs-nip05" data-bs-nip05 hidden></p>`}
        <p class="show-sub">${bits.map(htmlEscape).join(" · ") || "No boosts recorded yet"}</p>
        ${renderBio(about, bioProfiles)}
        ${renderContact({ lud16, lud06, website })}
        <div class="show-actions">
          <!-- In the flow under the bio rather than absolutely placed at the
               avatar's level, which is where MyNostr and Twitter put their Edit
               and Follow buttons. Those surfaces have ONE button; this has
               three plus a display name that can run long, and on a 375px phone
               that corner is where they would collide. -->
          <button type="button" class="btn btn-boost" data-copy-npub="${htmlEscape(npub || hex)}">
            Copy npub
          </button>
          <a class="btn btn-quiet" href="https://njump.me/${htmlEscape(npub || hex)}" target="_blank" rel="noopener noreferrer">View Profile</a>
          <button type="button" class="btn btn-quiet" data-share-page>Share</button>
        </div>
      </div>
    </div>
    <h2 class="show-stats-title">
      <a href="/about#keysend">Nostr Boost</a> Stats
    </h2>
    <dl class="show-stats">
      ${stats.map((s) => `<div class="show-stat"><dt>${htmlEscape(s.label)}</dt><dd title="${htmlEscape(s.exact)}">${htmlEscape(s.value)}</dd></div>`).join("\n      ")}
    </dl>
  </header>`;
}

/* The bio.
 *
 * ⚠️ THE CLAMP IS TWO LINES HERE AND THREE ON /show, and that is the data
 * rather than a preference. Measured over the 1,050 profiles carrying an
 * `about`: median 60 characters, p75 125, p90 220, and only 16.6% run past 160.
 * Two clamped lines covers roughly 84% outright, so a three-line clamp with a
 * More control would ship a control that five profiles in six never need. The
 * 4,965-character outlier is real, which is why there is a clamp at all.
 *
 * Reuses show-desc.js wholesale — the `show-desc` class, the `data-show-desc`
 * hook and the same is-clamped/More machinery — with booster-page.css overriding
 * only the line count. The module renders expanded and collapses afterwards, so
 * a reader with no JavaScript gets the whole bio.
 *
 * Ships EMPTY AND HIDDEN when there is none, rather than being omitted: 46% of
 * profiles have no `about`, and Primal's cache sometimes carries one for a
 * booster whose D1 row does not. booster-page.js fills and reveals it.
 *
 * URLs in it are links and `nostr:` mentions render as a small face plus a
 * display name. Neither is decoration: a bio routinely IS a link ("book at
 * …"), and a mention rendered raw is 63 characters of bech32 in the middle of a
 * sentence, which is most of a two-line clamp spent on noise. See renderBioText
 * for why the mentions are deliberately NOT clickable.
 */
function renderBio(about, bioProfiles) {
  return `<div class="show-desc bs-bio" data-show-desc${about ? "" : " hidden"}>
            <div class="show-desc-body" data-show-desc-body data-bs-about>${about ? renderBioText(about, bioProfiles) : ""}</div>
          </div>`;
}

/* Lightning address and website, as two copy/visit chips.
 *
 * ⚠️ THE LIGHTNING ADDRESS IS NOT A PAYMENT CONTROL. It is text with a copy
 * button, and deliberately not a Boost button: this site's boost paths pay a
 * SHOW's value block, parsed from its RSS, and paying a person is a different
 * transaction with a different recipient and no split. Wiring one here would put
 * a new money path on the page that needed it least. See the money-paths note in
 * CLAUDE.md — if OnlyBoosts ever zaps a booster it gets its own designed flow,
 * not a button borrowed from the show pages.
 */
function renderContact({ lud16, lud06, website }) {
  const chips = [];
  // ⚠️ `data-bs-copy`, NOT `data-copy-npub`. The shared handler in
  // detail-page.js copies through copyNpub(), which toasts "npub copied" — true
  // of every other copy control on the site and false of both of these. This
  // page wires its own, with the label the chip carries.
  if (lud16) {
    chips.push(`<button type="button" class="bs-chip" data-bs-copy="${htmlEscape(lud16)}" data-bs-copy-label="Lightning address" title="Copy lightning address">
              <span class="bs-chip-glyph" aria-hidden="true">⚡</span>${htmlEscape(truncate(lud16, 44))}
            </button>`);
  } else if (lud06) {
    // The three-profile case. An LNURL is a 100+ character bech32 string nobody
    // reads, so it is labelled rather than printed.
    chips.push(`<button type="button" class="bs-chip" data-bs-copy="${htmlEscape(lud06)}" data-bs-copy-label="LNURL" title="Copy LNURL">
              <span class="bs-chip-glyph" aria-hidden="true">⚡</span>Copy LNURL
            </button>`);
  }
  if (website) {
    chips.push(`<a class="bs-chip" href="${htmlEscape(website)}" target="_blank" rel="noopener noreferrer nofollow" title="${htmlEscape(website)}">
              <span class="bs-chip-glyph" aria-hidden="true">🔗</span>${htmlEscape(truncate(website.replace(/^https?:\/\//, "").replace(/\/$/, ""), 40))}
            </a>`);
  }
  // Always emitted, so booster-page.js has somewhere to put a lightning address
  // that only Primal knows about.
  return `<div class="bs-contact" data-bs-contact${chips.length ? "" : " hidden"}>${chips.join("\n            ")}</div>`;
}

// ── Shows and Albums ─────────────────────────────────────────────────────────
//
// Every show and album this person has boosted, ranked, in the same drawer the
// show page's community rollup uses — an .ep-drawer whose <summary> is the
// heading, the range and sort band on the shared .cs-controls inside the lid,
// and the rows beneath in a scroll container.
//
// ⚠️ EVERY ROW SHIPS FOUR WINDOWS OF FIGURES IN ONE `data-bs` ATTRIBUTE, which
// is what makes both controls free. The show page's version packs three numbers
// for one window and offers a sort only; this packs three for each of 1W, 1M, 1Y
// and All, so range-filtering is a re-read of an attribute rather than a fetch.
// The reason the show page cannot do this is not cost — it is that "which shows
// does this audience overlap with" is a standing fact and a window is the wrong
// question of it. "What has this person boosted lately" is exactly the right
// question, so the range earns its place here where it did not there.
//
// ⚠️ UNTITLED SHOWS ARE KEPT, which is the opposite of the call the show page's
// community drawer makes. That drawer is a discovery list, so a row that cannot
// be clicked is dead weight; this is one person's history, and 33% of the shows
// in the index have no title, so dropping them would silently under-report a
// third of what someone has boosted while the stat tile above counted them. They
// render as "Unidentified show" with the guid — the same treatment the Shows
// feed gives them — and are not links.
//
// NO BOOST BUTTON, unlike the show page's community rows. Those exist to let a
// reader support a show they have just discovered; this list is a record of what
// someone else has already boosted, and each row links to that show's own page,
// which carries the button. Keeping the money paths off this page is deliberate.
function renderShows(rows, realName) {
  if (!rows.length) return "";

  return `<section class="show-section show-section--bare" id="shows">
    <details class="ep-drawer cs-drawer" open data-booster-shows>
      <summary>
        <span class="cs-head">
          <span class="cs-head-title">Shows and Albums Boosted</span>
          <span class="cs-head-sub">Every show and album this booster has sent sats to on Nostr</span>
        </span>
        <span class="drawer-hint" aria-hidden="true"></span>
      </summary>
      <!-- Ships hidden and stays hidden without JavaScript: controls that cannot
           control are worse than none, and the list below is already ranked at
           All, which is the view they would land on. -->
      <div class="cs-controls" data-bs-shows-controls hidden></div>
      <ul class="ep-list cs-list" data-bs-shows-list>
        ${rows.map((r, i) => showRow(r, i + 1, realName)).join("\n        ")}
      </ul>
      <!-- Painted by booster-page.js when a range empties the list. A window
           with nothing in it is a real answer here — half of all boosters have
           sent nothing in the last 7 days. -->
      <p class="cs-empty" data-bs-shows-empty hidden></p>
    </details>
  </section>`;
}

function showRow(r, rank, realName) {
  const art = isSafeUrl(r.image) ? r.image : null;
  // The same second-chance URL every other surface carries, on the same terms.
  const art2 = isSafeUrl(r.artwork) && r.artwork !== art ? r.artwork : null;
  const titled = Boolean(String(r.title || "").trim());
  const title = titled ? truncate(r.title, 120) : "Unidentified show";

  const n = (v) => Number(v || 0);
  // boosts,sats,episodes per window, in RANGE_OPTIONS order (1w, 1m, 1y, all),
  // then the newest boost's timestamp for the "Recently boosted" sort. Read by
  // booster-page.js; the shape is the contract between the two files.
  const packed = [
    n(r.b1w), n(r.s1w), n(r.e1w),
    n(r.b1m), n(r.s1m), n(r.e1m),
    n(r.b1y), n(r.s1y), n(r.e1y),
    n(r.boosts), n(r.sats), n(r.eps),
    n(r.latest),
  ].join(",");

  const inner = `<span class="cs-rank" aria-hidden="true">${rank}</span>
      ${art
        ? `<img class="cs-art" src="${htmlEscape(art)}"${art2 ? ` data-art2="${htmlEscape(art2)}"` : ""} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />`
        : `<span class="cs-art cs-art--blank" aria-hidden="true">${r.medium === "music" ? "💿" : "🎙️"}</span>`}
      <span class="cs-main">
        <span class="cs-title">${htmlEscape(title)}</span>
        <span class="cs-meta" data-bs-meta>${htmlEscape(showMeta(n(r.boosts), n(r.sats), n(r.eps)))}</span>
      </span>`;

  // An unidentified show has no page to link to, so the row is a <div> carrying
  // the same class rather than a dead anchor. The guid goes in the title
  // attribute — it is the only handle that show has, and it is what someone
  // reporting a gap would quote.
  const body = titled
    ? `<a class="cs-link" href="/show/${encodeURIComponent(r.podcast_guid)}">${inner}</a>`
    : `<div class="cs-link cs-link--dead" title="${htmlEscape(r.podcast_guid || "")}">${inner}</div>`;

  /* ⚠️ THIS ROLLUP IS THE SHOW PICKER FOR #boosts, and this button is the whole
   * of the affordance. Pressing it filters the boost list at the foot of the page
   * to this show and scrolls there — "what did this person say about THIS show",
   * which is a different question from the per-episode one #episodes answers.
   *
   * ⚠️ IT IS THE PICKER RATHER THAN A DROPDOWN ON THAT BAND, and the data is the
   * reason. Sampled over 30 active boosters, the median has boosted 10 distinct
   * shows, the mean 27 and the heaviest 188 — a menu holding 188 entries is not a
   * dropdown, it is a list, and this is already a better one: ranked by what the
   * person actually gave, scrollable, with its own range and sort, and carrying
   * the artwork. The pick also happens where the question is asked, next to
   * "40.1k sats across 38 episodes".
   *
   * ⚠️ A VERB, SO IT SHIPS `hidden`. It does nothing without JavaScript, and a
   * control that cannot act is worse than no control — the same discipline as the
   * two control bands on this page. booster-page.js reveals it, and only when
   * there is more than one show to choose between and a band to put the chip on.
   * OUTSIDE the anchor, never inside it: a button nested in a link is neither.
   *
   * The label is the row's, so an unidentified show reads "Unidentified show"
   * here as it does above. It still gets a button — a show Podcast Index cannot
   * name still has boosts worth reading. */
  /* ⚠️ THE LABEL NAMES THE BOOSTER, and a bare "Boosts →" is what it replaced.
   * On a row whose subject is a SHOW, that read as "this show's boosts" — every
   * boost anyone has ever sent it — when what the button opens is one person's.
   * The page's <h1> says whose, but a reader twenty rows down cannot see it.
   *
   * "Boosts by X" rather than "X's Boosts" because it is already the site's
   * phrase for this: `title="Boosts by ${name}"` is on every boost row's author
   * link and on every community-wall card. It also sidesteps the possessive on a
   * name ending in s.
   *
   * ⚠️ CAPPED AT 16, because the name is third-party text and is not always a
   * name. Measured over 45 boosters: median 11 characters, mean 11, max 27, and
   * only 5 above 16 — but the tail is "btconboard #LNHANCE or #CTV" and "ChadF
   * and 33 others", so the cap is about strangeness as much as width. The full
   * string is in `title` and `aria-label`, where length costs nothing.
   *
   * ⚠️ AND IT FALLS BACK WHEN THERE IS NO NAME. 51 boosters in the index have no
   * kind-0 on any profile relay, and for them `label` is a truncated identifier —
   * "dbd1ba83b0…ecbd Boosts" is worse than saying nothing about whose. Those rows
   * point at the figures beside them instead. Same call the rows above make in
   * printing "Unidentified show" rather than a guid dressed as a title. */
  const { label: byline, full } = showFilterLabel(realName, title);

  const filter = `<button type="button" class="cs-boosts-btn"
        data-bs-show-filter="${htmlEscape(r.podcast_guid || "")}"
        data-bs-show-label="${htmlEscape(title)}"
        title="${htmlEscape(full)}" aria-label="${htmlEscape(full)}" hidden>${
        htmlEscape(byline)} <span aria-hidden="true">&rarr;</span></button>`;

  return `<li class="cs-row" data-bs="${packed}">${body}${filter}</li>`;
}

/* The show-filter button's two strings: what it shows, and what it says in full.
 *
 * Exported for scripts/test-boost-row.mjs — the cap and the fallback are exactly
 * the kind of decision that regresses silently, and neither is visible from the
 * rendered page without a D1 stub. Only onRequest* is routed, so an extra export
 * here costs nothing.
 *
 * @param {string|null} realName  the booster's kind-0 name, or null if they have
 *   none. NOT the page's `label`, which falls back to a truncated identifier —
 *   "dbd1ba83b0…ecbd Boosts" is worse than saying nothing about whose.
 * @param {string} showTitle  the row's own title, already truncated and already
 *   "Unidentified show" where there is none.
 */
export function showFilterLabel(realName, showTitle) {
  const name = String(realName || "").trim();
  return name
    ? { label: `Boosts by ${truncate(name, LABEL_NAME_MAX)}`, full: `Boosts by ${name} to ${showTitle}` }
    : { label: "Read these", full: `Read this booster's boosts to ${showTitle}` };
}

/* Measured over 45 boosters on 2026-08-16: median name 11 characters, mean 11,
 * max 27, and only 5 above this. The cap is about strangeness as much as width —
 * the tail is "btconboard #LNHANCE or #CTV" and "ChadF and 33 others", which are
 * campaign text rather than names. The full string is in `title` and
 * `aria-label`, where length costs nothing. */
const LABEL_NAME_MAX = 16;

function showMeta(boosts, sats, eps) {
  return `${num(boosts)} boost${boosts === 1 ? "" : "s"} · ` +
    `${compact(sats)} sats · ${num(eps)} episode${eps === 1 ? "" : "s"}`;
}

// ── Episodes and Songs ───────────────────────────────────────────────────────
//
// Everything this person has boosted at the episode level, painted as the
// Episodes feed's own card. Structurally identical to #community-episodes on
// /episode/<guid> — the same drawer, the same controls, the same shared card —
// so see the long note over renderCommunityEpisodes there for the whole
// argument.
//
// ⚠️ SERVER-RENDERED, like every other section on this page. It and its twin on
// /episode were the rendering rule's two standing exceptions, tolerated only
// because the card existed as JavaScript alone; assets/js/episode-card.js is an
// HTML-string builder now and runs at the edge, so both are closed.
//
// ONE DIFFERENCE FROM THE TWIN worth naming: the figures here are NOT
// community-scoped, they are this person's own. So the sort is tagged plainly
// "Sort:" rather than "Community Sort:" — a card's boosts and sats are what this
// booster sent that episode, which is exactly what the section claims.
//
// AND ONE MORE: it opens on Most sats rather than Most boosts. Every card here
// is one person's giving to one episode and the median booster has two boosts
// in total, so a boost-count ranking is mostly ties; sats is the axis that
// actually orders a single person's history.
function renderEpisodes(corpus) {
  // A booster whose every boost carries no item guid has no episode-level
  // history at all, and no section. A failed corpus fetch takes the same exit.
  const { items, profiles } = itemsFromBoosts(corpus?.boosts, { sort: "sats" });
  if (!items.length) return "";

  return `<section class="show-section show-section--bare" id="episodes" data-booster-episodes${
      corpus?.truncated ? " data-truncated" : ""}>
    <details class="ep-drawer" open data-be-body>
      <summary>
        <span class="cs-head">
          <span class="cs-head-title">Episodes and Songs Boosted</span>
          <span class="cs-head-sub">Every episode and track this booster has sent sats to, ranked</span>
        </span>
        <span class="drawer-hint" aria-hidden="true"></span>
      </summary>
      <div class="cs-controls ce-controls" data-be-controls hidden></div>
      <div class="ce-scroll" data-be-scroll tabindex="0" role="region"
           aria-label="Episodes and songs this booster has boosted">
        <div class="pcast-list" data-be-list>${renderCardPage(items, {
          // Not split on medium — see the page header. One person's podcasts and
          // music are one history, and the cards read correctly either way.
          copy: CARD_COPY.other,
          profiles,
          sort: "sats",
          range: "all",
          limit: CARDS_PER_PAGE,
          // The figures go too, unlike the twin on /episode: every card here
          // aggregates ONE person's boosts, so "1 booster · 3 boosts" restates the
          // page's own subject on every row and the booster count is 1 by
          // construction — CLAUDE.md names this case verbatim under what may
          // legitimately differ.
          parts: { stats: false, layout: "compact" },
          state: { surface: "booster-episodes", truncated: !!corpus?.truncated },
        })}</div>
        <div data-be-more></div>
      </div>
    </details>
  </section>`;
}

// A pubkey with no boosts. A real 404 rather than a page of zeroes: `profiles`
// holds anyone the collector has resolved a kind-0 for, which is not the same
// set as "people who have boosted", so a stranger's npub resolves here and has
// nothing to show.
//
// ⚠️ NO REDIRECT, unlike /episode/<guid>'s miss path. That page can send a
// reader to the episode's SHOW because a boost record names one; a pubkey that
// has boosted nothing has no related page anywhere on this site to offer.
function notFound(raw) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Booster not found — OnlyBoosts</title>
  <link rel="icon" type="image/png" href="/assets/onlyboosts_favicon.png" />
  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v126" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v126" />
</head>
<body>
<section class="page-header">
  <p class="page-eyebrow">404</p>
  <h1>Booster not found</h1>
  <p>No indexed boosts match <code>${htmlEscape(truncate(raw || "", 80))}</code>.</p>
</section>
<main class="page-main">
  <div class="page-inner">
    <div class="soon-card">
      <p>This page exists for people who have published a boost to Nostr. An
         npub that has never boosted, or one this index has not seen, has
         nothing to show here.</p>
      <p><a href="/#boosts-global">Browse all boosts →</a></p>
    </div>
  </div>
</main>
<script src="/assets/js/sw-register.js?v=ob-v126" defer></script>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
