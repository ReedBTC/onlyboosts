// /charts/<year>: the year's Top 33 Songs, Artists, Podcasts and Boosters
// under a "<year> in Numbers" line (2026-11-21). Edge-rendered into the
// charts-year.html shell between <!--OB:YEAR--> markers; facts only, so the
// page ships no script of its own beyond the shell's nav.
//
// The rows are chart-board.js's, the weekly boards' own two-sided renderer, so
// a song on the year list and on a week's board are one function. The data
// is year-charts.js.
//
// ⚠️ CACHED AT THE EDGE FOR TEN MINUTES (caches.default). Five aggregations
// over a year of boosts per view is the D1 cost the chart strip's KV cache
// exists to avoid; the year moves slowly enough that ten minutes is nothing.

import { yearBoards, YEARS, TOP_N } from "./year-charts.js";
import { boardHtml, weekRowHtml, memberChartRowHtml } from "../../assets/js/chart-board.js";
import { assetGet } from "./head.js";

const OPEN = "<!--OB:YEAR-->";
const CLOSE = "<!--/OB:YEAR-->";
const SITE = "https://onlyboosts.social";
const CACHE_SECS = 600;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const pacificDate = (unix, opts) => new Date(unix * 1000).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", ...opts });
const LONG = { weekday: "long", month: "long", day: "numeric", year: "numeric" };

export function isChartYear(seg) {
  return /^\d{4}$/.test(String(seg || "")) && Object.hasOwn(YEARS, seg);
}

export function yearHtml(d) {
  const y = d.year;
  const empty = "No Nostr boosts in this year yet.";
  const board = (key, title, rows) => boardHtml({
    board: `year-${key}`, title, sub: `Top ${TOP_N}`, empty, colhead: true,
    rows: rows.map((r) => weekRowHtml(key, r)),
  });
  // The year's last day is the Sunday before `end`; six days after the last
  // Monday, which holds whichever DST offset is in force (the weekSpan rule).
  const lastDay = d.end - 86400 + 3600;
  const span = `${pacificDate(d.start, LONG)} to ${pacificDate(lastDay, LONG)}`;
  const status = d.open
    ? `The year is in progress; these lists run through ${pacificDate(d.through, { month: "long", day: "numeric", year: "numeric" })} and will change until it closes.`
    : "The year is complete.";
  return `<h1>The OnlyBoosts Charts of ${y}</h1>
    <p class="year-numbers"><strong>${y} in Numbers:</strong>
      <span>${fmt(d.numbers.sats)} Sats</span> · <span>${fmt(d.numbers.boosts)} Boosts</span> · <span>${fmt(d.numbers.boosters)} Boosters</span></p>
    <p class="search-lead">The Top ${TOP_N} of the year on the OnlyBoosts Charts, over every Nostr boost sent in the 52 chart weeks from ${esc(span)}, US Pacific. ${esc(status)} <a href="/about#charts">How the charts work.</a></p>
    <div class="hpw-boards year-boards">
      ${board("songs", `Top Songs of ${y}`, d.songs)}
      ${board("artists", `Top Artists of ${y}`, d.artists)}
      ${board("shows", `Top Podcasts of ${y}`, d.shows)}
      ${boardHtml({
        board: "year-boosters", title: `Top Boosters of ${y}`, sub: `Top ${TOP_N}`, empty, colhead: true,
        colheadLabel: "sats/boosts/shows", list: "hpw-list",
        rows: d.boosters.map((m) => memberChartRowHtml(m)),
      })}
    </div>`;
}

export async function renderYearPage({ request, env, waitUntil }, year) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit;

  const shell = await env.ASSETS.fetch(assetGet(request, "/charts-year"));
  if (!shell.ok) return shell;
  let html = await shell.text();
  let cacheable = false;
  try {
    const data = await yearBoards(env, year, Math.floor(Date.now() / 1000));
    const start = html.indexOf(OPEN);
    const end = html.indexOf(CLOSE);
    if (data && start !== -1 && end > start) {
      html = html.slice(0, start) + yearHtml(data) + html.slice(end + CLOSE.length);
      cacheable = true;
    }
    html = html.replace("<title>Charts of the Year — OnlyBoosts</title>", `<title>The OnlyBoosts Charts of ${esc(year)} — OnlyBoosts</title>`)
      .replace(`<link rel="canonical" href="${SITE}/charts-year" />`, `<link rel="canonical" href="${SITE}/charts/${esc(year)}" />`);
  } catch (err) {
    console.error("[year] boards failed", year, err);
  }
  const resp = new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cacheable ? `public, max-age=${CACHE_SECS}` : "no-store" },
  });
  if (cacheable) {
    const put = cache.put(key, resp.clone()).catch(() => {});
    if (waitUntil) waitUntil(put);
  }
  return resp;
}
