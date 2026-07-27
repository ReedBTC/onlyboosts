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
    `SELECT podcast_guid, title, image, feed_url, medium, author, boost_count,
            total_sats, booster_count, latest_ts
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

  // Display names for any npub mentioned inside a boost message. One extra
  // query, and only when a message actually carries a mention — most don't.
  // A mentioned npub need not be a booster, so a miss here is normal and the
  // chip falls back to a truncated identifier.
  const boostRows = boosts.results || [];
  // Placeholders rather than json_each: BOOSTS_SHOWN is 24, so this list is
  // tiny and always far inside D1's 100-bound-parameter ceiling. The follows
  // endpoint needs json_each because its author list runs to thousands; here it
  // would only add a dependency on a table-valued function Cloudflare does not
  // document. Sliced anyway, so a pathological message can't blow the limit.
  const mentioned = mentionedPubkeys(boostRows.map((r) => r.message)).slice(0, 90);
  const names = new Map();
  if (mentioned.length) {
    const rows = await env.DB.prepare(
      `SELECT pubkey, name, display_name FROM profiles
       WHERE pubkey IN (${mentioned.map(() => "?").join(",")})`
    ).bind(...mentioned).all();
    for (const p of rows.results || []) {
      const n = p.display_name || p.name;
      if (n) names.set(p.pubkey, n);
    }
  }

  const html = renderShowPage({
    show,
    episodes: eps.results || [],
    supporters: sups.results || [],
    boosts: boostRows,
    names,
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

// ── nostr: URIs in boost messages ────────────────────────────────────────────
//
// The two client feeds render mentions through boosts-thread.js#parseSegments,
// which decodes with nostr-tools and paints an @Name chip. This page cannot:
// importing that module here would mean shipping boosts-thread.js (30KB),
// calendar-events.js (24KB) and nostr-tools (102KB) to a page whose stated
// design is that it reads with no JavaScript at all. So the same job is done
// server-side, and the output is deliberately the same `.nostr-mention` chip
// so the two surfaces look identical.
//
// Only bech32 DECODE is implemented, and only far enough to recover a pubkey.
// Links use the identifier exactly as it appeared in the note, so nothing has
// to be re-encoded; the decode exists purely to look a display name up.

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

// Returns the data part as bytes, or null. The checksum is verified: an
// identifier that fails it is left as plain text rather than being linked,
// since a corrupted npub would otherwise resolve to somebody else's profile.
function bech32ToBytes(str) {
  const s = String(str).toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length || s.length > 2000) return null;

  const words = [];
  for (let i = sep + 1; i < s.length; i++) {
    const v = BECH32_CHARSET.indexOf(s[i]);
    if (v === -1) return null;
    words.push(v);
  }

  // bech32 (not bech32m): the polymod of hrp-expansion ++ data must be 1.
  const hrp = s.slice(0, sep);
  const expanded = [];
  for (let i = 0; i < hrp.length; i++) expanded.push(hrp.charCodeAt(i) >> 5);
  expanded.push(0);
  for (let i = 0; i < hrp.length; i++) expanded.push(hrp.charCodeAt(i) & 31);
  let chk = 1;
  for (const v of expanded.concat(words)) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i];
  }
  if (chk !== 1) return null;

  // 5-bit groups back to 8-bit, dropping the 6-word checksum.
  const data = words.slice(0, -6);
  const out = [];
  let acc = 0, bits = 0;
  for (const v of data) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  // Any leftover must be zero padding, per the spec.
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) return null;
  return out;
}

const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

// npub → the pubkey. nprofile → the pubkey in its TLV type-0 record.
function pubkeyFromBech32(id) {
  const bytes = bech32ToBytes(id);
  if (!bytes) return null;
  if (/^npub1/i.test(id)) return bytes.length === 32 ? toHex(bytes) : null;
  if (/^nprofile1/i.test(id)) {
    for (let i = 0; i + 2 <= bytes.length; ) {
      const type = bytes[i], len = bytes[i + 1];
      if (i + 2 + len > bytes.length) return null;
      if (type === 0) return len === 32 ? toHex(bytes.slice(i + 2, i + 34)) : null;
      i += 2 + len;
    }
  }
  return null;
}

const NOSTR_URI_RE = /nostr:((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

// Every pubkey mentioned across a set of boost messages, for the name lookup.
function mentionedPubkeys(messages) {
  const out = new Set();
  for (const m of messages) {
    for (const match of String(m || "").matchAll(NOSTR_URI_RE)) {
      const pk = pubkeyFromBech32(match[1]);
      if (pk) out.add(pk);
    }
  }
  return [...out];
}

// A boost message as HTML: nostr: URIs become @Name chips, bare URLs become
// links, everything else is escaped text. Mirrors buildMentionEl() in
// boosts-thread.js, including the .nostr-mention class and the njump target.
function renderMessage(text, names) {
  const src = truncate(String(text || ""), 420);
  const spans = [];
  for (const m of src.matchAll(NOSTR_URI_RE)) spans.push({ start: m.index, end: m.index + m[0].length, id: m[1], value: m[0], kind: "nostr" });
  for (const m of src.matchAll(URL_RE)) {
    if (spans.some((s) => m.index >= s.start && m.index < s.end)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, id: m[0], kind: "url" });
  }
  spans.sort((a, b) => a.start - b.start);

  let out = "", cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    out += htmlEscape(src.slice(cursor, s.start));
    cursor = s.end;
    if (s.kind === "url") {
      out += isSafeUrl(s.id)
        ? `<a href="${htmlEscape(s.id)}" target="_blank" rel="noopener noreferrer">${htmlEscape(truncate(s.id, 60))}</a>`
        : htmlEscape(s.id);
      continue;
    }
    // An identifier that fails its checksum is left as plain text rather than
    // linked. It would only ever open an empty njump tab, and it is also how
    // the one tokenizing edge case resolves itself: bech32's charset includes
    // `n`, so two mentions run together with no space ("…ckn ostr:npub1…")
    // greedily match one character too many. That over-long capture fails the
    // checksum, so it degrades to text instead of pointing at the wrong person.
    if (!bech32ToBytes(s.id)) { out += htmlEscape(s.value ?? s.id); continue; }
    const pk = pubkeyFromBech32(s.id);
    const name = pk ? names.get(pk) : null;
    const label = name ? "@" + name : "@" + s.id.slice(0, 14) + "…";
    // An unresolved mention carries its pubkey so show-page.js can ask Primal
    // for the name and swap the label in. A mentioned npub need never have
    // boosted anything, so missing from `profiles` is the normal case here
    // rather than the exceptional one.
    const hook = !name && pk ? ` data-pk="${htmlEscape(pk)}" data-missing="name"` : "";
    out += `<a class="nostr-mention" href="https://njump.me/${htmlEscape(s.id)}" target="_blank" rel="noopener noreferrer"${hook}>${htmlEscape(label)}</a>`;
  }
  out += htmlEscape(src.slice(cursor));
  return out;
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
    boostBtn: "Boost this Show",
    itemsPlural: "Episodes",
    itemAbbr: "Ep.",
    untitledItem: "Untitled episode",
    drawer: "Episodes with Nostr Boosts, newest first",
    noItems: "No episodes with Nostr boosts yet.",
    ldType: "PodcastSeries",
    // Deliberately "By", never "Host" or "Creator". The source is
    // <itunes:author>, whoever the publisher named there: usually the host,
    // sometimes a network ("Jupiter Broadcasting"), occasionally a tagline.
    // "By Jupiter Broadcasting" is true of all three; "Host:" is true of one.
    credit: "By",
  },
  music: {
    eyebrow: "Album",
    noun: "album",
    boostBtn: "Boost this Album",
    itemsPlural: "Tracks",
    itemAbbr: "Track",
    untitledItem: "Untitled track",
    drawer: "Tracks with Nostr Boosts, newest first",
    noItems: "No tracks with Nostr boosts yet.",
    ldType: "MusicAlbum",
    // On a music feed <itunes:author> IS the artist, and cleanly so: 97.4% of
    // album pages carry a usable one. The stronger label is earned here in a
    // way it is not on the podcast side.
    credit: "Artist",
  },
};

const copyFor = (medium) => (medium === "music" ? COPY.music : COPY.podcast);

// ── the page ─────────────────────────────────────────────────────────────────

function renderShowPage({ show, episodes, supporters, boosts, names }) {
  const copy = copyFor(show.medium);
  const title = show.title;
  const pageUrl = `${SITE_ORIGIN}/show/${encodeURIComponent(show.podcast_guid)}`;
  const art = isSafeUrl(show.image) ? show.image : null;
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
  // client's preview card or a group chat, where the .ob-scopenote under the
  // stats is not there to qualify them. A bare "3 supporters have sent…" reads
  // as a verdict on the show's whole audience.
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

  ${renderHeader(show, art, title, copy)}

  ${renderEpisodes(episodes, show, copy)}

  ${renderSupporters(supporters, show, copy)}

  ${renderBoosts(boosts, names, copy)}

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

<script src="/assets/js/nav.js" defer></script>
<script src="/assets/js/show-page.js" type="module"></script>
<!-- Lazy widget bootstrap. Plain (non-defer) script at the end of body, as on
     every page — see CLAUDE.md. -->
<script src="/assets/js/nav-widget-boot.js"></script>
<script src="/assets/js/sw-register.js" defer></script>
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

function creditLine(show, copy) {
  const author = usableAuthor(show);
  if (!author) return "";
  return `<p class="show-credit"><span class="show-credit-label">${htmlEscape(copy.credit)}</span> ${htmlEscape(truncate(author, 120))}</p>`;
}

function renderHeader(show, art, title, copy) {
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
  const stats = [
    { label: "sats", value: compact(show.total_sats), exact: num(show.total_sats) },
    { label: show.boost_count === 1 ? "boost" : "boosts", value: num(show.boost_count), exact: num(show.boost_count) },
    { label: show.booster_count === 1 ? "booster" : "boosters", value: num(show.booster_count), exact: num(show.booster_count) },
  ];

  return `<header class="show-hero">
    <div class="show-hero-inner">
      <div class="show-art">${
        art
          ? `<img src="${htmlEscape(art)}" alt="" width="180" height="180" loading="eager" />`
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
    <dl class="show-stats">
      ${stats.map((s) => `<div class="show-stat"><dt>${htmlEscape(s.label)}</dt><dd title="${htmlEscape(s.exact)}">${htmlEscape(s.value)}</dd></div>`).join("\n      ")}
    </dl>
    <!-- These pages are meant to be shared by the shows themselves, so the
         figures land in front of people with no idea what this site indexes.
         The caveat belongs next to the numbers that prompt the question, not
         buried in the footer: most boosting is keysend and never touches
         Nostr, so a show's real total is higher than what's shown here, and a
         booster can be missing entirely. Both anchors are real sections of
         /about. The .ob-scopenote class is shared with the feed panels on / and
         the stat strip on /about, and is defined once in theme.css. -->
    <p class="ob-scopenote">
      These counts cover only boosts published to Nostr.
      <a href="/about#keysend">Most boosts are sent by keysend</a> and leave no
      public record, so the real totals are higher and some boosters won't
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
// "Nostr Community" rather than "Supporters", and the distinction is the point.
// "Supporters" is a claim about who supports the show, and the wall cannot make
// it: a show with two hundred keysend supporters and three Nostr boosters would
// read as having three supporters. "Community" names the group this page can
// actually see, and the qualifier says which group that is. The count noun
// elsewhere on the page stays "booster", because a person is a booster and only
// the set of them is a community. See the site-wide vocabulary note in
// CLAUDE.md.
function renderSupporters(rows, show, copy) {
  if (!rows.length) {
    return `<section class="show-section" id="community">
      <h2>Nostr Community</h2>
      <p class="show-empty">No boosters recorded for this ${copy.noun} yet.</p>
    </section>`;
  }

  const podium = rows.slice(0, PODIUM);
  const rest = rows.slice(PODIUM);
  const hidden = Math.max(0, rest.length - (SUPPORTERS_VISIBLE - PODIUM));

  return `<section class="show-section" id="community">
    <div class="show-section-head">
      <h2>Nostr Community <span class="show-count">${num(rows.length)}</span></h2>
      <p class="show-section-sub">Everyone who has boosted ${htmlEscape(show.title)} on Nostr, ranked by sats sent, all time.</p>
    </div>

    <ol class="sup-podium">
      ${podium.map((r, i) => supporterCard(r, i + 1, true)).join("\n      ")}
    </ol>

    ${rest.length ? `<ol class="sup-grid" data-supporter-grid>
      ${rest.map((r, i) => supporterCard(r, i + 1 + PODIUM, false, i >= SUPPORTERS_VISIBLE - PODIUM)).join("\n      ")}
    </ol>` : ""}

    ${hidden > 0 ? `<button type="button" class="btn btn-quiet show-more" data-show-more="supporter">
      Show ${num(hidden)} more booster${hidden === 1 ? "" : "s"}
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

  // What the index couldn't supply is declared for the client to fill from
  // Primal (show-page.js). Nothing here waits on that: the card is complete
  // and readable as rendered, and a visitor with no JavaScript keeps the
  // shortened npub and the blank circle, which is what always shipped.
  const missing = [name ? null : "name", pic ? null : "pic"].filter(Boolean).join(" ");

  return `<li class="sup-card${isPodium ? " sup-card--podium" : ""}"${hidden ? " hidden data-overflow" : ""}${
        missing ? ` data-pk="${htmlEscape(r.booster_pubkey)}" data-missing="${missing}"` : ""}>
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
function renderBoosts(rows, names, copy) {
  if (!rows.length) return "";

  return `<section class="show-section" id="boosts">
    <div class="show-section-head">
      <h2>Recent Boosts</h2>
      <p class="show-section-sub">The most recent boosts sent to this ${copy.noun}, as published to Nostr.</p>
    </div>
    <ul class="boost-list">
      ${rows.map((r) => boostRow(r, names, copy)).join("\n      ")}
    </ul>
  </section>`;
}

function boostRow(r, names, copy) {
  const realName = displayName(r);
  const name = realName || shortId(r.booster_npub, r.booster_pubkey);
  const pic = isSafeUrl(r.pr_pic) ? r.pr_pic : null;
  const copyVal = r.booster_npub || r.booster_pubkey;
  const missing = [realName ? null : "name", pic ? null : "pic"].filter(Boolean).join(" ");
  const target = r.e_title
    ? (r.e_num ? `${copy.itemAbbr} ${htmlEscape(r.e_num)} · ${htmlEscape(truncate(r.e_title, 70))}` : htmlEscape(truncate(r.e_title, 70)))
    : `the ${copy.noun}`;

  return `<li class="boost-row"${missing ? ` data-pk="${htmlEscape(r.booster_pubkey)}" data-missing="${missing}"` : ""}>
        <button type="button" class="sup-avatar sup-avatar--sm${pic ? "" : " is-blank"}" data-copy-npub="${htmlEscape(copyVal)}" title="Copy npub" aria-label="Copy npub for ${htmlEscape(name)}">
          ${pic ? `<img src="${htmlEscape(pic)}" alt="" loading="lazy" />` : ""}
        </button>
        <div class="boost-body">
          <p class="boost-meta">
            <span class="boost-who">${htmlEscape(name)}</span>
            <span class="boost-amt">${htmlEscape(num(r.sats))} sats</span>
            <span class="boost-when">${htmlEscape(relTime(r.created_at))}</span>
          </p>
          ${r.message ? `<p class="boost-msg">${renderMessage(r.message, names)}</p>` : ""}
          <p class="boost-target">→ ${target}</p>
        </div>
      </li>`;
}

function renderEpisodes(rows, show, copy) {
  if (!rows.length) {
    return `<section class="show-section show-section--bare" id="episodes">
      <p class="show-empty">${copy.noItems}</p>
    </section>`;
  }

  // No heading or sub-line: the drawer's own summary already reads
  // "62 episodes", so a section title above it would only say it again.
  return `<section class="show-section show-section--bare" id="episodes">
    <details class="ep-drawer">
      <summary>${copy.drawer}</summary>
      <ul class="ep-list">
        ${rows.map((e) => episodeRow(e, copy)).join("\n        ")}
      </ul>
    </details>
  </section>`;
}

function episodeRow(e, copy) {
  const bits = [fmtDate(e.published), fmtDuration(e.duration)].filter(Boolean);
  return `<li class="ep-row">
          <div class="ep-main">
            <p class="ep-title">${e.episode_number ? `<span class="ep-num">${copy.itemAbbr} ${htmlEscape(e.episode_number)}</span> ` : ""}${htmlEscape(e.title || copy.untitledItem)}</p>
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
