// Sitemap. Static pages plus one entry per show landing page.
//
// The show pages (functions/show/[guid].js) are what made this dynamic: ~922 of
// them, generated entirely from indexed data, and a sitemap is how they get
// found. They're enumerated from D1 rather than from
// /api/data/podcasts/index.json so the qualifying rule lives in one place —
// `title IS NOT NULL`, the same test the page itself applies. A show with no
// title has no artwork, feed or Podcast Index record and its page serves a 404,
// so listing it would advertise a dead URL.
//
// The episode pages (functions/episode/[guid].js) are enumerated too, but NOT
// all of them, and the floor is the interesting part. 6,682 episodes qualify for
// a page against 934 shows, and the distribution is long-tailed: the median
// episode carrying an indexed boost has ONE booster and TWO boosts. A page built
// on one person's boost is a real page worth existing — it is what a shared link
// resolves to, and it carries a proper Open Graph card — but it is a thin page
// to put in front of a crawler, and 6,682 of them would be the bulk of what this
// document advertises.
//
// So the sitemap lists the episodes with something to read: EPISODE_MIN_BOOSTERS
// or more distinct boosters, which is 2,027 of the 6,682. The rest are indexable
// and are found by link, from a show page or a feed; they are simply not
// promoted. Both halves carry canonical and OG tags either way, because those
// are about the share card rather than about crawling.
//
// Total at those numbers is ~2,963 URLs, still well inside the 50,000-URL
// sitemap limit and needing no sitemap index.
//
// Cached at the edge for 1 hour.

const SITE_ORIGIN = "https://onlyboosts.social";

// Hard cap so a runaway podcasts table can't produce a multi-megabyte document.
// Far above the current 922; if it's ever hit, it's time for a sitemap index.
const MAX_SHOWS = 20000;

// The floor and the cap for episode pages. Three boosters rather than two: two
// is 3,165 rows and includes a great many episodes whose second booster is the
// same person's second app. Three is where a page starts having a community
// section worth crawling.
const EPISODE_MIN_BOOSTERS = 3;
const MAX_EPISODES = 20000;

// The eight feeds are hash routes on "/" (#boosts-global etc.), and crawlers
// don't index fragments separately — listing them would just be duplicate
// entries for the same URL.
//
// /stats, /boosters and /shows are deliberately absent: they're coming-soon
// placeholders and carry `noindex` themselves. Add them here when they have a
// feature behind them.
//
// /shows is the near-term one: turning it into the crawlable directory that
// links the show pages is the obvious next step, and it goes in this list on
// the same commit that drops its `noindex`. Listing it before then would
// advertise a placeholder.
const STATIC_URLS = [
  { loc: "/", changefreq: "hourly", priority: "1.0" },
  { loc: "/about", changefreq: "monthly", priority: "0.6" },
];

export async function onRequest({ env }) {
  const today = new Date().toISOString().slice(0, 10);

  const urls = STATIC_URLS.map((u) => ({
    loc: `${SITE_ORIGIN}${u.loc}`,
    lastmod: today,
    changefreq: u.changefreq,
    priority: u.priority,
  }));

  // Best-effort by design: a D1 hiccup costs the show entries, not the whole
  // document. Throwing here would drop the static pages out of the index too,
  // which is a worse outcome than a temporarily short sitemap.
  try {
    const { results } = await env.DB.prepare(
      `SELECT podcast_guid, latest_ts FROM podcasts
       WHERE title IS NOT NULL AND title <> ''
       ORDER BY total_sats DESC LIMIT ?`
    ).bind(MAX_SHOWS).all();

    for (const r of results || []) {
      if (!r.podcast_guid) continue;
      urls.push({
        loc: `${SITE_ORIGIN}/show/${encodeURIComponent(r.podcast_guid)}`,
        lastmod: tsToDate(r.latest_ts) || today,
        changefreq: "weekly",
        priority: "0.7",
      });
    }
  } catch (err) {
    console.warn("[sitemap] show enumeration failed", err);
  }

  // Separate try, and separate on purpose: this one is a GROUP BY over the whole
  // boosts table where the shows query is a single indexed scan, so it is the
  // half more likely to be slow or to fail. A failure here must not cost the
  // show entries that already succeeded.
  //
  // The join to `episodes` is also the filter — an episode with no title has no
  // page (the same qualifying rule /episode/<guid> applies), so listing one
  // would advertise a 404.
  try {
    const { results } = await env.DB.prepare(
      `SELECT b.item_guid, MAX(b.created_at) AS latest
       FROM boosts b
       JOIN episodes e ON e.item_guid = b.item_guid
       WHERE e.title IS NOT NULL AND e.title <> ''
       GROUP BY b.item_guid
       HAVING COUNT(DISTINCT b.booster_pubkey) >= ?
       ORDER BY SUM(COALESCE(b.sats, 0)) DESC
       LIMIT ?`
    ).bind(EPISODE_MIN_BOOSTERS, MAX_EPISODES).all();

    for (const r of results || []) {
      if (!r.item_guid) continue;
      urls.push({
        // encodeURIComponent, not a template: 9% of item guids contain a slash
        // and 30 are full URLs. See the note at the top of the page Function.
        loc: `${SITE_ORIGIN}/episode/${encodeURIComponent(r.item_guid)}`,
        lastmod: tsToDate(r.latest) || today,
        // An episode's page changes when it gets a new boost, which is rarer
        // than a show's — a show accumulates every one of its episodes'.
        changefreq: "monthly",
        priority: "0.5",
      });
    }
  } catch (err) {
    console.warn("[sitemap] episode enumeration failed", err);
  }

  return new Response(renderSitemap(urls), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function tsToDate(ts) {
  if (!ts) return null;
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderSitemap(urls) {
  const entries = urls
    .map(
      (u) => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>
    <lastmod>${xmlEscape(u.lastmod)}</lastmod>
    <changefreq>${xmlEscape(u.changefreq)}</changefreq>
    <priority>${xmlEscape(u.priority)}</priority>
  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}
