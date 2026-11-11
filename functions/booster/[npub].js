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
// ⚠️ NOT SPLIT ON MEDIUM, which every rollup on the feeds is: what one person
// listens to ACROSS podcasts and music is one history, and splitting it would
// file the same person under two half-histories. So the #boosts list holds
// podcasts and music together and there is no COPY table on this page at all.
//
// ⚠️ THE TWO ROLLUPS ("Shows and Albums Boosted", "Episodes and Songs Boosted")
// CAME OFF ON 2026-11-07 and CAME BACK AS FOUR RAILS ON 2026-11-08, split on
// the medium after all (Reed's call: Podcasts Boosted, Albums Boosted,
// Episodes Boosted, Songs Boosted, the homepage's shape, ranked by the sats
// this member sent). #shows holds the first two and #episodes the second two,
// both edge-rendered for every reader. The recommendation rails are the
// MEMBER'S OWN VIEW: booster-page.js paints #recommended for the owner alone
// and hides these for them. `git log -S renderShows -- functions/booster` has
// the drawer-era rollups.
//
// NAV/FOOTER markup between the marker comments is GENERATED — edit
// partials/nav.html or partials/footer.html and run scripts/sync-partials.js.
// Do not hand-edit it here.
import {
  htmlEscape, jsonForScript, isSafeUrl, num, compact, fmtDate, relTime,
  truncate, shortId, lookupMentionNames, lookupMentionProfiles, renderBioText,
  renderBoosts,
} from "../_shared/detail-page.js";
import { feedRanks, renderStatTiles, chartCacheOf } from "../_shared/feed-rank.js";
// The four boosted rails are the homepage's tiles, two-sided (2026-11-08).
import { boostedShowRailsHtml, boostedEpisodeRailsHtml } from "../../assets/js/boosted-rails.js";

import { headOf } from "../_shared/head.js";
import { npubEncode } from "../../assets/js/mention-search.js";
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
// All three are server-rendered since 2026-11-08 (#episodes was client-
// rendered in the drawer era) and resolve with JavaScript off.

// An npub is 63 characters. The cap is slack for the hex form and nothing more —
// this is a guard against a kilobyte string reaching a bound query, not a real
// length. Unlike the episode page's key, an npub has no slashes and no URL-shaped
// values, so it needs none of that page's decoding care.
const NPUB_MAX = 200;

// The boost list at the foot. 24 is what /show/<guid> shows, and the same
// reasoning applies: this is the "recent" list, and the whole history is what
// the two rollups above it are for.
const BOOSTS_SHOWN = 24;
// The four boosted rails' GROUP BY cap, before the split on medium.
const ROLLUP_CAP = 80;

export async function onRequestGet(context) {
  const { env, params } = context;
  let raw = params.npub;
  if (Array.isArray(raw)) raw = raw[0];
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw form */ }
  if (!raw || raw.length > NPUB_MAX) return notFound(raw);

  const hex = toHexPubkey(raw);
  if (!hex) return notFound(raw);

  // ⚠️ THE ADDRESS IS THE NPUB (Reed's call, 2026-11-08: "no one really uses
  // hex"). A hex form still resolves, since it is in the wild (the homepage's
  // full-list link emitted one until this day), but it is forwarded to the
  // npub form rather than served under it, so the bar and every share of it
  // carry one address. 301: the two were always the same page. The fragment
  // (#latest, #recommended) survives a redirect in every browser.
  if (!/^npub1/i.test(raw)) {
    const npub = npubEncode(hex);
    if (npub) return Response.redirect(`${new URL(context.request.url).origin}/booster/${npub}`, 301); // the request's own host, so a preview forwards within itself
  }

  // The four queries in one round of parallelism, the same shape both other
  // pages use. Every one of them is served by idx_boosts_booster.

  /* The four boosted rails' rows (2026-11-08): one GROUP BY per level over
     the member's boosts, by sats sent, split on the medium in the renderer.
     ROLLUP_CAP is slack for the split: a side never shows more than twenty.
     Allowed to fail: a rail below the fold never costs the page. */
  const rollup = (sql, cap) => env.DB.prepare(sql).bind(hex, cap).all().then((r) => r.results || []).catch((e) => { console.warn("[booster] rollup", e?.message); return []; });
  const showsP = rollup(
    `SELECT b.podcast_guid AS guid, p.title, p.image AS img, p.artwork AS art2, p.medium,
            COUNT(*) AS boosts, COALESCE(SUM(b.sats), 0) AS sats
       FROM boosts b LEFT JOIN podcasts p ON p.podcast_guid = b.podcast_guid
      WHERE b.booster_pubkey = ? AND b.podcast_guid IS NOT NULL
      GROUP BY b.podcast_guid ORDER BY sats DESC, boosts DESC, b.podcast_guid LIMIT ?`, ROLLUP_CAP);
  const episodesP = rollup(
    `SELECT b.item_guid AS guid, e.title, e.image AS img, b.podcast_guid AS show_guid,
            p.title AS show_title, p.image AS show_img, p.artwork AS show_art2, p.medium,
            COUNT(*) AS boosts, COALESCE(SUM(b.sats), 0) AS sats
       FROM boosts b LEFT JOIN episodes e ON e.item_guid = b.item_guid
       LEFT JOIN podcasts p ON p.podcast_guid = b.podcast_guid
      WHERE b.booster_pubkey = ? AND b.item_guid IS NOT NULL
      GROUP BY b.item_guid ORDER BY sats DESC, boosts DESC, b.item_guid LIMIT ?`, ROLLUP_CAP);
  const [prof, totals, boosts] = await Promise.all([
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

    env.DB.prepare(
      // ⚠️ THE SHOW IS SELECTED HERE AND ON NEITHER OTHER PAGE. A boost row names
      // the show beside the episode only where the show is new information, which
      // is this page: on /show it is the <h1> and on /episode it is the eyebrow,
      // so there the join would cost a lookup per render to print what the reader
      // is already looking at. One more LEFT JOIN through the podcasts primary
      // key, on a list capped at BOOSTS_SHOWN.
      `SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
              b.item_guid, b.podcast_guid, b.message, b.client_id,
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
  const [names, bioProfiles, ranks] = await Promise.all([
    lookupMentionNames(env, boostRows.map((r) => r.message)),
    // Skipped entirely when the bio has no mention in it, which is the common
    // case — mentionedPubkeys returns empty and the helper never queries.
    lookupMentionProfiles(env, [prof?.about || ""]),
    /* ⚠️ THE SECOND BATCH, NOT THE FIRST, because it needs `totals` — which the
       first batch is what produces. So this page pays `first + max(second)`
       rather than one `max()`, which is the cost of a rank that has to be
       compared against figures the page has just computed. It never throws
       (see _shared/feed-rank.js), so the worst case is the tiles rendering
       exactly as they did before this existed. */
    feedRanks(env.DB, "booster", {
      pk: hex,
      sats: totals.sats,
      boosts: totals.boosts,
      shows: totals.shows,
    }, chartCacheOf(context)),
  ]);

  const html = renderBoosterPage({
    hex,
    npub: totals.npub || (raw.startsWith("npub") ? raw : null),
    prof: prof || null,
    totals,
    boosts: boostRows,
    names,
    bioProfiles,
    ranks,
    shows: await showsP,
    episodes: await episodesP,
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

function renderBoosterPage({ hex, npub, prof, totals, boosts, names, bioProfiles, ranks, shows = [], episodes = [] }) {
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
  /* `totals.eps` is still SELECTed and still used by the #shows rollup's own
     per-row meta line; it just no longer has a tile of its own. */

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

  /* ⚠️ THREE TILES, NOT FOUR: THE EPISODES ONE CAME OFF ON 2026-08-23 (Reed's
     call), and dropping it is what let the other three carry a rank. The
     members wall ranks by sats, boosts and shows and by nothing else, so an
     episodes tile could never have a chip beside it — a fourth tile with a
     visibly empty corner reads as a rank that failed to load rather than as a
     figure with no list behind it. The figure is not lost: the #episodes
     rollup below opens with "N sats across M episodes".

     `key` is what pairs a tile with its rank; see _shared/feed-rank.js. */
  const stats = [
    { key: "sats", label: "sats", value: compact(satsTotal), exact: num(satsTotal) },
    { key: "boosts", label: boostTotal === 1 ? "boost" : "boosts", value: num(boostTotal), exact: num(boostTotal) },
    { key: "shows", label: showTotal === 1 ? "show" : "shows", value: num(showTotal), exact: num(showTotal) },
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
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com;
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

  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v270" />
  <!-- The hero, the drawers and the boost list are the show page's, so this
       page links its stylesheet and adds only the deltas. -->
  <link rel="stylesheet" href="/assets/css/show-page.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/supporter-wall.css?v=ob-v270" />
  <!-- The episode card, for the #episodes rollup: the same chrome
       feeds-podcasts.js paints on the homepage. -->
  <link rel="stylesheet" href="/assets/css/feed-cards.css?v=ob-v270" />
  <!-- The boost thread inside a card's drawer, and its reply / like / repost /
       zap bar, both reached through that same card. -->
  <link rel="stylesheet" href="/assets/css/boosts-thread.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/boost-actions.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/episode-page.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/booster-page.css?v=ob-v270" />
  <!-- The recommendation rails are the homepage's (rail-tile.js); this is their stylesheet. -->
  <link rel="stylesheet" href="/assets/css/discover.css?v=ob-v270" />
</head>
<body data-booster-pk="${htmlEscape(hex)}"${npub ? ` data-booster-npub="${htmlEscape(npub)}"` : ""}>

<!-- NAV:START (generated by scripts/sync-partials.js — edit the partial) -->
<!-- ══════════════════════════════ NAV ══════════════════════════════
     SHARED NAV — single source of truth. Do NOT edit the copies inside the
     page files; edit THIS file, then run scripts/sync-partials.js to
     push it into every page (between the NAV:START / NAV:END markers).
     Styles live in /assets/css/nav.css; behavior in /assets/js/nav.js and
     /assets/js/nav-search.js.

     THE BAR, SINCE 2026-10-17 (Reed's pick, direction A of the discovery
     homepage mockups): logo and wordmark, the sections, the site search in
     the middle, then the theme toggle, Donate and the account control. On a
     phone the links fold into the hamburger's overlay (the Explore menu,
     which is also the site map the footer mirrors) and the search drops to
     its own full-width row under the bar.

     THE RIBBONS, SINCE 2026-10-20 (Reed's call, after Rotten Tomatoes' section
     menus): Podcasts, Music and #40HPW each open a ribbon under the bar with
     two top-five lists, a Discover column of that side's rails, and the first
     list's #1 at the right. Each ribbon is a <details>, so it opens with no
     script; /assets/js/nav-ribbons.js adds hover, Escape, outside-click and
     fills the lists from the chart endpoints the first time a ribbon opens
     (the lists are data and the nav is a partial on every page, static ones
     included, so they are never rendered at the edge). Charts and Boosts are
     plain links (2026-10-21): the weekly boards' own page, where the #40HPW
     link of 2026-10-20 landed once the boards moved there, and the boost
     feed's own page, the two places people kept asking for. Every section
     is a PAGE since 2026-10-21 (/podcasts, /music, /members, /charts,
     /boosts); the hash-routed charts page is forwarded. THE THIRD RIBBON IS
     NAMED #40HPW AND OPENS /charts/hpw SINCE 2026-10-21 (Reed's call: the
     challenge is what people open that ribbon for, and its board is the
     ribbon's first list); it was Members for one day. Its key stays
     data-ribbon="members", its Discover column still carries Top Members,
     and the footer keeps the Members entry, /members being a page. The desktop links,
     the overlay's groups and the footer's Browse group name the same
     places; change them together.
     ⚠️ A RIBBON'S LIST SLOT IS data-ribbon-list="<key>" AND THE KEYS ARE
     nav-ribbons.js's SOURCES. The Discover links are static. -->
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
    <!-- The site map behind one trigger: a hamburger and a full-screen
         overlay on a phone, hidden on a desktop where the links are inline.
         The Feeds group mirrors the footer's; they are regrouped together
         or not at all. -->
    <details class="nav-explore">
      <summary aria-label="Open the site menu">
        <span class="nav-explore-glyph" aria-hidden="true">☰</span>
      </summary>
      <div class="nav-explore-panel">
        <div class="nav-explore-head">
          <span>OnlyBoosts</span>
          <button type="button" class="nav-explore-close" aria-label="Close menu">✕</button>
        </div>
        <a class="nav-explore-home" href="/"><span aria-hidden="true">🏠</span> Home</a>
        <div class="nav-explore-groups">
          <!-- ⚠️ ONE ENTRY PER PAGE. Each section is a page since 2026-10-21
               and its bare path opens on its first chart (PAGES in
               charts.html's controller): /podcasts on Shows (Reed, 2026-09-03),
               /music on Artists (2026-08-31), /charts on the Podcasts boards.
               The Global vs Follows axis stays absent: it is a control on the page. -->
          <!-- The three sections are accordions on a phone (Rotten Tomatoes'
               app pattern, Reed's pick 2026-10-20): the row itself opens the
               section's page; the chevron opens that side's Discover links,
               the same links the desktop ribbon's Discover column carries. -->
          <div class="nav-explore-group nav-explore-sections">
            <h4>Browse</h4>
            <details class="nav-explore-acc">
              <summary><a href="/podcasts"><span aria-hidden="true">🎙</span> Podcasts</a><span class="nav-explore-chev" aria-hidden="true">⌄</span></summary>
              <div class="nav-explore-sub">
                <a href="/charts/podcasts">Top Podcasts This Week</a>
                <a href="/podcasts/shows?range=1y">Top Podcasts This Year</a>
                <a href="/podcasts/episodes?range=1y">Top Episodes This Year</a>
                <a href="/discover/new-shows">New and Noteworthy</a>
                <a href="/discover/movers">Movers This Week</a>
                <a href="/discover/podroll">Podcasters Recommend</a>
                <a href="/#rail-lang-1">Top Podcasts by Language</a>
                <a href="/#rail-follows-latest">Latest From Podcasts You Follow</a>
                <a href="/#rail-recommended">Podcasts Recommended For You</a>
                <a href="/#rail-follows">Top Podcasts From Your Follows</a>
                <a href="/#rail-because">Because You Boosted</a>
              </div>
            </details>
            <details class="nav-explore-acc">
              <summary><a href="/music"><span aria-hidden="true">🎵</span> Music</a><span class="nav-explore-chev" aria-hidden="true">⌄</span></summary>
              <div class="nav-explore-sub">
                <a href="/music/albums?range=1m">Top Albums This Month</a>
                <a href="/music/songs?range=1y">Top Songs This Year</a>
                <a href="/charts/music">Top Artists This Week</a>
                <a href="/discover/new-music">New and Noteworthy</a>
                <a href="/#rail-recommended-music">Music Recommended For You</a>
                <a href="/#rail-follows-songs">Top Songs From Your Follows</a>
                <a href="/#rail-because">Because You Boosted</a>
              </div>
            </details>
            <details class="nav-explore-acc">
              <summary><a href="/charts/hpw"><span aria-hidden="true">👥</span> #40HPW</a><span class="nav-explore-chev" aria-hidden="true">⌄</span></summary>
              <div class="nav-explore-sub">
                <a href="/charts/hpw">#40HPW Challenge</a>
                <a href="/members">Top Members</a>
                <a href="/boosts">Boost Feed</a>
              </div>
            </details>
            <a href="/charts"><span aria-hidden="true">📈</span> Charts</a>
            <a href="/boosts"><span aria-hidden="true">⚡</span> Boosts</a>
          </div>
          <!-- Stats: the aggregate view over the same data. A coming-soon
               page for now (noindex, out of the sitemap). -->
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
    <a class="nav-logo" href="/" aria-label="OnlyBoosts home">
      <img src="/assets/onlyboosts_pfp.png" alt="" />
    </a>
    <a class="nav-site-name" href="/">OnlyBoosts</a>
    <nav class="nav-links" aria-label="Main navigation">
      <details class="nav-ribbon" data-ribbon="podcasts">
        <summary><a href="/podcasts">Podcasts</a><span class="nav-ribbon-caret" aria-hidden="true">▾</span></summary>
        <div class="nav-ribbon-panel">
          <div class="nav-ribbon-col">
            <h4>Top Podcasts This Week <a href="/charts/podcasts">View all</a></h4>
            <ol class="nav-ribbon-list" data-ribbon-list="shows-week"></ol>
          </div>
          <div class="nav-ribbon-col">
            <h4>Top Podcasts This Year <a href="/podcasts/shows?range=1y">View all</a></h4>
            <ol class="nav-ribbon-list" data-ribbon-list="shows-year"></ol>
          </div>
          <div class="nav-ribbon-col nav-ribbon-discover">
            <h4>Discover</h4>
            <a href="/podcasts/episodes?range=1y">Top Episodes This Year</a>
            <a href="/discover/new-shows">New and Noteworthy</a>
            <a href="/discover/movers">Movers This Week</a>
            <a href="/discover/podroll">Podcasters Recommend</a>
            <a href="/#rail-lang-1">Top Podcasts by Language</a>
            <a href="/#rail-follows-latest">Latest From Podcasts You Follow</a>
            <a href="/#rail-recommended">Podcasts Recommended For You</a>
            <a href="/#rail-follows">Top Podcasts From Your Follows</a>
            <a href="/#rail-because">Because You Boosted</a>
          </div>
          <div class="nav-ribbon-feat" data-ribbon-feat="shows-week" hidden>
            <span class="nav-ribbon-eyebrow">#1 Podcast This Week</span>
            <a class="nav-ribbon-feat-art" data-ribbon-feat-art href="#"></a>
            <a class="nav-ribbon-feat-title" data-ribbon-feat-title href="#"></a>
            <span class="nav-ribbon-feat-line" data-ribbon-feat-line></span>
          </div>
        </div>
      </details>
      <details class="nav-ribbon" data-ribbon="music">
        <summary><a href="/music">Music</a><span class="nav-ribbon-caret" aria-hidden="true">▾</span></summary>
        <div class="nav-ribbon-panel">
          <div class="nav-ribbon-col">
            <h4>Top Albums This Month <a href="/music/albums?range=1m">View all</a></h4>
            <ol class="nav-ribbon-list" data-ribbon-list="albums-month"></ol>
          </div>
          <div class="nav-ribbon-col">
            <h4>Top Songs This Year <a href="/music/songs?range=1y">View all</a></h4>
            <ol class="nav-ribbon-list" data-ribbon-list="songs-year"></ol>
          </div>
          <div class="nav-ribbon-col nav-ribbon-discover">
            <h4>Discover</h4>
            <a href="/charts/music">Top Artists This Week</a>
            <a href="/discover/new-music">New and Noteworthy</a>
            <a href="/#rail-recommended-music">Music Recommended For You</a>
            <a href="/#rail-follows-songs">Top Songs From Your Follows</a>
            <a href="/#rail-because">Because You Boosted</a>
          </div>
          <div class="nav-ribbon-feat" data-ribbon-feat="albums-month" hidden>
            <span class="nav-ribbon-eyebrow">#1 Album This Month</span>
            <a class="nav-ribbon-feat-art" data-ribbon-feat-art href="#"></a>
            <a class="nav-ribbon-feat-title" data-ribbon-feat-title href="#"></a>
            <span class="nav-ribbon-feat-line" data-ribbon-feat-line></span>
          </div>
        </div>
      </details>
      <details class="nav-ribbon" data-ribbon="members">
        <summary><a href="/charts/hpw">#40HPW</a><span class="nav-ribbon-caret" aria-hidden="true">▾</span></summary>
        <div class="nav-ribbon-panel">
          <div class="nav-ribbon-col">
            <h4>#40HPW This Week <a href="/charts/hpw">View all</a></h4>
            <ol class="nav-ribbon-list" data-ribbon-list="hpw-week"></ol>
          </div>
          <div class="nav-ribbon-col">
            <h4>Largest Boosts This Week <a href="/boosts">View all</a></h4>
            <ol class="nav-ribbon-list" data-ribbon-list="boosts-week"></ol>
          </div>
          <div class="nav-ribbon-col nav-ribbon-discover">
            <h4>Discover</h4>
            <a href="/charts/hpw">#40HPW Challenge</a>
            <a href="/members">Top Members</a>
            <a href="/boosts">Boost Feed</a>
          </div>
          <div class="nav-ribbon-feat" data-ribbon-feat="hpw-week" hidden>
            <span class="nav-ribbon-eyebrow">Leading #40HPW This Week</span>
            <a class="nav-ribbon-feat-art" data-ribbon-feat-art href="#"></a>
            <a class="nav-ribbon-feat-title" data-ribbon-feat-title href="#"></a>
            <span class="nav-ribbon-feat-line" data-ribbon-feat-line></span>
          </div>
        </div>
      </details>
      <a href="/charts">Charts</a>
      <a href="/boosts">Boosts</a>
    </nav>
    <!-- The site search. nav-search.js turns typing into a grouped menu
         (shows, episodes, artists, members); Enter, or the form with no
         script, lands on /search?q=, the full results page. -->
    <form class="nav-search" role="search" action="/search" method="get" data-nav-search autocomplete="off">
      <svg class="nav-search-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
      <label class="nav-sr-only" for="nav-search-q">Search OnlyBoosts</label>
      <input id="nav-search-q" type="search" name="q" placeholder="Search shows, episodes, artists, members" autocomplete="off" spellcheck="false" />
      <div class="nav-search-menu" role="listbox" aria-label="Search results" hidden></div>
    </form>
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

<main class="show-main show-main--booster">

  <!-- Ships as a real link to the Boosts feed, which is where a booster is
       reachable from today; detail-page.js relabels it "Back" and wires
       history.back() when the previous document was one of ours. /boosters is
       deliberately NOT the target: it is still a coming-soon placeholder, so a
       reader with nowhere to go back to would land on a page that says nothing. -->
  <a class="show-back" href="/members" data-show-back>
    <span class="show-back-arrow" aria-hidden="true">←</span><span data-back-label>All Boosts</span>
  </a>

  ${renderHeader({ hex, npub, prof, label, realName, pic, banner, stats, ranks, totals, bioProfiles })}

  ${renderFavorites()}
  ${renderBoosted(shows, episodes)}

  ${renderBoosts(boosts, names, {
    // "Boosts Sent" rather than "Recent Boosts", for the same reason as on
    // /show: with a range and an order over this person's whole history the
    // section is no longer a sample of the last few days.
    heading: "Boosts Sent",
    sub: "Every boost this booster has sent, as published to Nostr, newest first.",
    noun: "episode",
    // TRUE here, where /episode passes false: every row on this page targets a
    // different episode, so the "→ Title" line is the content of the row rather
    // than a repeat of the <h1>. This is the page renderBoosts' default was
    // written for.
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
      <!-- ⚠️ ONE ENTRY PER PAGE, and it mirrors the nav's Explore menu exactly.
           The two are the site map and are regrouped together or not at all;
           each section is a page since 2026-10-21 and its bare path opens on
           its first chart. See partials/nav.html. -->
      <h3>Browse</h3>
      <ul>
        <li><a href="/podcasts">🎙 Podcasts</a></li>
        <li><a href="/music">🎵 Music</a></li>
        <li><a href="/members">👥 Members</a></li>
        <li><a href="/charts">📈 Charts</a></li>
        <li><a href="/boosts">⚡ Boosts</a></li>
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

<script src="/assets/js/nav.js?v=ob-v270" defer></script>
<script src="/assets/js/booster-page.js?v=ob-v270" type="module"></script>
<!-- Lazy widget bootstrap. Plain (non-defer) script at the end of body, as on
     every page — see CLAUDE.md. -->
<script src="/assets/js/nav-widget-boot.js?v=ob-v270"></script>
<script src="/assets/js/sw-register.js?v=ob-v270" defer></script>
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
function renderHeader({ hex, npub, prof, label, realName, pic, banner, stats, ranks, totals, bioProfiles }) {
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
    ${renderStatTiles(stats, ranks, {
      rankFeed: "Members",
      /* The wall, not this page's back link. `/members` is where those three
         orderings live and where a reader can go and find the row; the back
         link above points at the same place, which is a coincidence of this
         page rather than something to rely on. */
      backHref: "/members",
      /* The Charts line links the wall too: the Members hash drops query
         parameters (PARAM_FEEDS excludes it), so `?sort=chart` would be dead
         weight — and the wall now OPENS on Chart rank anyway. The breadth key
         in a member's formula is shows boosted, not boosters. */
      chartHref: "/members",
      chartBreadth: "shows boosted",
    })}
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


/* ── Recommended ──────────────────────────────────────────────────────────────
 *
 * The homepage's personal rails for THIS member, as a section of their own
 * page (2026-10-20, Reed's ask; rails since 2026-11-07, Reed's ask: the same
 * sideways shape the homepage uses for everything a signed-in member sees):
 * Recommended Podcasts, Recommended Music, then one Because rail per seed,
 * the collector's similarity scores summed over every show they have boosted
 * (see /about#recommendations). Facts about a public boost history, so
 * rendered here, through the two-sided assets/js/recommend-rails.js. The
 * favorites a member keeps on Nostr are not read at the edge; booster-page.js
 * hands them to the endpoint once the Favorites section has read the list
 * and repaints `.bs-rails` with the same function. Omitted when there is
 * nothing to recommend: an empty section would only say the member has
 * boosted too little, which the tiles above already show. */
/* #shows: Podcasts Boosted and Albums Boosted; #episodes: Episodes Boosted and
   Songs Boosted (2026-11-08). Each section is omitted when its side of the
   history is empty. booster-page.js hides both for the member on their own
   page, where #recommended takes their place. */
function renderBoosted(shows, episodes) {
  const eps = (episodes || []).map((r) => ({
    guid: r.guid, title: r.title, img: r.img, sats: r.sats, boosts: r.boosts,
    show: { guid: r.show_guid, title: r.show_title, img: r.show_img, art2: r.show_art2, medium: r.medium },
  }));
  const a = boostedShowRailsHtml(shows || []);
  const b = boostedEpisodeRailsHtml(eps);
  return (a ? `<section class="show-section show-section--bare" id="shows" data-booster-boosted>
    <div class="bs-rails">${a}
    </div>
  </section>` : "") + (b ? `<section class="show-section show-section--bare" id="episodes" data-booster-boosted>
    <div class="bs-rails">${b}
    </div>
  </section>` : "");
}


// The member's PC 2.0 Favorites (kind 10333). A written exception to the
// rendering rule: the list lives on relays, not in D1, and its private half is
// ciphertext only the member's own signer can open, so the edge can render the
// shell and nothing more. assets/js/favorites-section.js reads the list,
// resolves the guids through /api/v1/favorites/resolve, fills this in and
// fills it in. The id is frozen the way every section id on these pages is.
// See docs/favorites.md. It sits directly under the Nostr Boost Stats tiles as
// a NORMALLY CLOSED drawer, and it is ON SCREEN FROM THE FIRST PAINT (Reed,
// 2026-09-09): a relay read takes seconds, and a drawer that appears late
// reads as a page that changed under the reader. Until the read answers the
// foot says so; a list with nothing on it says that instead of vanishing.
// ⚠️ THREE DRAWERS SINCE 2026-11-08 (Reed's call: each kind of entry gets
// its own home): Podcasts You Follow, with the owner's Import / Export OPML
// on its controls band; Favorite Podcast Episodes; Favorite Music, grouped
// Artists / Albums / Songs under the Show menu. One section, the frozen
// `#favorites`; favorites-section.js#DRAWERS names the keys and fills each.
const FAV_DRAWERS = [
  ["follows", "Podcasts You Follow", "The podcasts on this member’s follows list, from any Podcasting 2.0 app"],
  ["episodes", "Favorite Podcast Episodes", "The podcast episodes this member favorited"],
  ["music", "Favorite Music", "The artists, albums and songs this member favorited"],
];
function renderFavorites() {
  const drawers = FAV_DRAWERS.map(([key, title, sub]) => `
    <details class="ep-drawer cs-drawer" data-fav-drawer="${key}">
      <summary>
        <span class="cs-head">
          <span class="cs-head-title">${title}</span>
          <span class="cs-head-sub">${sub}</span>
        </span>
        <span class="drawer-hint" aria-hidden="true"></span>
      </summary>
      <!-- The controls band: the owner's OPML buttons (follows), the Show
           menu (music). Filled and revealed by favorites-section.js. -->
      <div class="cs-controls" data-fav-controls hidden></div>
      <div class="fav-groups" data-fav-groups></div>
      <p class="cs-empty" data-fav-empty>Loading from Nostr…</p>
    </details>`).join("");
  return `<section class="show-section show-section--bare" id="favorites" data-booster-favorites>${drawers}
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
  <link rel="stylesheet" href="/assets/css/nav.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/footer.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/theme.css?v=ob-v270" />
  <link rel="stylesheet" href="/assets/css/page.css?v=ob-v270" />
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
      <p><a href="/members">Browse all boosts →</a></p>
    </div>
  </div>
</main>
<script src="/assets/js/sw-register.js?v=ob-v270" defer></script>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" },
  });
}

// The GET's status and headers, no body — see _shared/head.js.
export const onRequestHead = headOf(onRequestGet);
