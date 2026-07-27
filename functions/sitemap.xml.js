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
// At ~922 entries this stays well inside the 50,000-URL sitemap limit and needs
// no sitemap index. Episode pages would change that.
//
// Cached at the edge for 1 hour.

const SITE_ORIGIN = "https://onlyboosts.social";

// Hard cap so a runaway podcasts table can't produce a multi-megabyte document.
// Far above the current 922; if it's ever hit, it's time for a sitemap index.
const MAX_SHOWS = 20000;

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
