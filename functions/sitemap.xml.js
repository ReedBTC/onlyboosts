// Static sitemap. OnlyBoosts has no per-item server-rendered pages yet
// (LB's version enumerated /ep### from the show's RSS feed — dropped
// along with the episode renderer), so this is a fixed URL list.
// Cached at the edge for 1 hour.
//
// If OnlyBoosts later grows server-rendered per-show or per-episode
// pages, the dynamic half is recoverable from upstream:
//   git show lb/main:functions/sitemap.xml.js

const SITE_ORIGIN = "https://onlyboosts.social";

const STATIC_URLS = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/feeds", changefreq: "hourly", priority: "0.9" },
  { loc: "/boosts.html", changefreq: "daily", priority: "0.8" },
];

export async function onRequest() {
  const today = new Date().toISOString().slice(0, 10);

  const urls = STATIC_URLS.map((u) => ({
    loc: `${SITE_ORIGIN}${u.loc}`,
    lastmod: today,
    changefreq: u.changefreq,
    priority: u.priority,
  }));

  return new Response(renderSitemap(urls), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
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
