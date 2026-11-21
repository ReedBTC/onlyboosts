// /charts/<year>: the year's Top 33 Songs, Artists, Podcasts and Boosters
// under a "<year> in Numbers" line (2026-11-21). Edge-rendered into the
// charts-year.html shell between <!--OB:YEAR--> markers; facts only, so the
// page ships no script of its own beyond the shell's nav.
//
// The rows are chart-board.js's, the weekly boards' own two-sided renderer, so
// a song on the year list and on a week's board are one function. The data
// is year-charts.js.
//
// THE FIGURES AND GRAPHS (Reed's asks, 2026-11-21): a sideways row of stat
// cards above the boards (the homepage rails' gesture), Boosts by Month
// above them too, and below them Fountain and Every Other App and #40HPW
// Finishers by Week. The graphs are inline SVG drawn here, facts rendered at
// the edge like everything else on the page; a hover title on each mark
// carries its figure. Up and down on the monthly line are the market chart's
// green and red, the one place the page wears a second colour.
//
// ⚠️ CACHED AT THE EDGE FOR TEN MINUTES (caches.default). Five aggregations
// over a year of boosts per view is the D1 cost the chart strip's KV cache
// exists to avoid; the year moves slowly enough that ten minutes is nothing.

import { yearBoards, YEARS, TOP_N } from "./year-charts.js";
import { boardHtml, weekRowHtml, memberChartRowHtml } from "../../assets/js/chart-board.js";
import { clientLabel } from "../../assets/js/client-label.js";
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
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym, long = false) => {
  const [y, m] = ym.split("-").map(Number);
  return `${(long ? MONTH : MON)[m - 1]} ${y}`;
};
const pct = (part, whole) => (whole > 0 ? (100 * part) / whole : 0);
const pctLabel = (p) => (p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)) + "%";
const short = (n) => {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
};
/* A round ceiling for an axis: 1, 2 or 5 times a power of ten. */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function isChartYear(seg) {
  return /^\d{4}$/.test(String(seg || "")) && Object.hasOwn(YEARS, seg);
}

/* ── The stat cards ─────────────────────────────────────────────────────── */

function card(fig, label, note = "") {
  return `<li class="ys-card"><span class="ys-fig">${esc(fig)}</span><span class="ys-label">${esc(label)}</span>${note ? `<span class="ys-note">${esc(note)}</span>` : ""}</li>`;
}

function statCards(d) {
  const s = d.stats;
  const n = d.numbers;
  const cards = [
    card(fmt(n.sats), "Sats", "boosted on Nostr this year"),
    card(fmt(n.boosts), "Boosts", n.boosts ? `${fmt(Math.round(n.sats / n.boosts))} sats on average` : ""),
    card(fmt(n.boosters), "Boosters", s ? `${fmt(s.newBoosters)} boosting for the first time` : ""),
  ];
  if (s) {
    cards.push(card(fmt(s.reach.podcasts), "Podcasts Boosted"));
    cards.push(card(fmt(s.reach.songs), "Songs Boosted", s.reach.artists ? `by ${fmt(s.reach.artists)} artists` : ""));
    const closed = d.open ? s.weeks.slice(0, -1) : s.weeks;
    const busiest = closed.reduce((a, w) => (w.boosts > (a?.boosts ?? -1) ? w : a), null);
    if (busiest && busiest.boosts) {
      cards.push(card(fmt(busiest.boosts), "Boosts in the Busiest Week", `week of ${pacificDate(busiest.start, { month: "long", day: "numeric" })}`));
    }
    const yearMonths = s.months.filter((m) => m.month.startsWith(`${d.year}-`));
    const topMonth = yearMonths.reduce((a, m) => (m.boosts > (a?.boosts ?? -1) ? m : a), null);
    if (topMonth) cards.push(card(fmt(topMonth.boosts), "Boosts in the Biggest Month", monthName(topMonth.month, true)));
    cards.push(card(fmt(s.hpw.members), "Members Hit #40HPW", `${fmt(s.hpw.weeks)} forty-hour weeks in all`));
    if (s.apps.total) {
      cards.push(card(fmt(s.apps.other), "Boosts From Other Apps", `${pctLabel(pct(s.apps.other, s.apps.total))} of the year; Fountain ${pctLabel(pct(s.apps.fountain, s.apps.total))}`));
    }
  }
  return `<ul class="ys-cards" aria-label="${esc(d.year)} in figures">${cards.join("")}</ul>`;
}

/* ── Boosts by Month ────────────────────────────────────────────────────── */

const W = 720;

function monthsChart(d) {
  const ms = d.stats.months;
  if (ms.length < 2) return "";
  const H = 230, L = 46, R = 12, T = 14, B = 30;
  const cur = d.open ? pacificDate(d.through, { year: "numeric", month: "2-digit" }).replace(/(\d+)\/(\d+)/, "$2-$1") : null;
  const max = niceMax(Math.max(...ms.map((m) => m.boosts)));
  const x = (i) => L + (i * (W - L - R)) / (ms.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const parts = [];
  // The chart year's months, shaded.
  const yi = ms.map((m, i) => (m.month.startsWith(`${d.year}-`) ? i : -1)).filter((i) => i >= 0);
  if (yi.length) {
    const a = x(yi[0]) - (yi[0] ? (x(1) - x(0)) / 2 : 0), b = Math.min(W - R, x(yi[yi.length - 1]) + (x(1) - x(0)) / 2);
    parts.push(`<rect class="yc-band" x="${a.toFixed(1)}" y="${T}" width="${(b - a).toFixed(1)}" height="${H - T - B}"/>`);
    parts.push(`<text class="yc-band-label" x="${(a + 6).toFixed(1)}" y="${T + 14}">${esc(d.year)}</text>`);
  }
  for (const f of [0, 0.5, 1]) {
    const v = max * f;
    parts.push(`<line class="yc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
    parts.push(`<text class="yc-axis" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`);
  }
  ms.forEach((m, i) => {
    const [yy, mm] = m.month.split("-");
    if (mm === "01" || i === 0) parts.push(`<text class="yc-axis" x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="${i === 0 ? "start" : "middle"}">${mm === "01" ? yy : MON[Number(mm) - 1] + " " + yy}</text>`);
    else if (mm === "07") parts.push(`<text class="yc-axis yc-axis--minor" x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">Jul</text>`);
  });
  for (let i = 1; i < ms.length; i++) {
    const partial = ms[i].month === cur;
    const dir = partial ? "flat" : ms[i].boosts >= ms[i - 1].boosts ? "up" : "down";
    parts.push(`<line class="yc-seg yc-${dir}${partial ? " yc-partial" : ""}" x1="${x(i - 1).toFixed(1)}" y1="${y(ms[i - 1].boosts).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(ms[i].boosts).toFixed(1)}"/>`);
  }
  ms.forEach((m, i) => {
    const partial = m.month === cur;
    const prev = ms[i - 1];
    const change = prev && prev.boosts ? ((m.boosts - prev.boosts) / prev.boosts) * 100 : null;
    const dir = i === 0 ? "flat" : partial ? "flat" : m.boosts >= prev.boosts ? "up" : "down";
    const tip = `${monthName(m.month, true)}${partial ? " so far" : ""}: ${fmt(m.boosts)} boosts, ${fmt(m.sats)} sats, ${fmt(m.boosters)} boosters` +
      (change !== null && !partial ? `; ${change >= 0 ? "up" : "down"} ${Math.abs(Math.round(change))}% on ${MONTH[Number(prev.month.slice(5)) - 1]}` : "");
    parts.push(`<circle class="yc-dot yc-${dir}${partial ? " yc-partial" : ""}" cx="${x(i).toFixed(1)}" cy="${y(m.boosts).toFixed(1)}" r="4"><title>${esc(tip)}</title></circle>`);
  });

  // The sentence under it: the year so far against the same months a year
  // earlier, closed months only, so a part month is never compared whole.
  const done = ms.filter((m) => m.month !== cur);
  const thisYear = done.filter((m) => m.month.startsWith(`${d.year}-`));
  const lastYear = thisYear.map((m) => done.find((p) => p.month === `${d.year - 1}-${m.month.slice(5)}`)).filter(Boolean);
  let line = "";
  if (thisYear.length && lastYear.length === thisYear.length) {
    const a = thisYear.reduce((t, m) => t + m.boosts, 0), b = lastYear.reduce((t, m) => t + m.boosts, 0);
    const span = thisYear.length === 1 ? MONTH[Number(thisYear[0].month.slice(5)) - 1] : `${MON[Number(thisYear[0].month.slice(5)) - 1]} to ${MON[Number(thisYear[thisYear.length - 1].month.slice(5)) - 1]}`;
    const ch = b ? ((a - b) / b) * 100 : 0;
    line = `${span} ${d.year}: ${fmt(a)} boosts, ${ch >= 0 ? "up" : "down"} ${Math.abs(Math.round(ch))}% on the same months of ${d.year - 1} (${fmt(b)}).`;
  }
  const best = done.reduce((a, m) => (m.boosts > (a?.boosts ?? -1) ? m : a), null);
  if (best) line += ` The busiest month in the index is ${monthName(best.month, true)}, with ${fmt(best.boosts)} boosts.`;

  return figure("Boosts by Month",
    `Every Nostr boost in the index by month since ${monthName(ms[0].month, true)}, US Pacific. A green point is up on the month before; a red one is down.${cur ? " The hollow point is this month so far." : ""}`,
    `<div class="yc-scroll"><svg class="yc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Boosts by month">${parts.join("")}</svg></div>`,
    line ? `<p class="yc-foot">${esc(line.trim())}</p>` : "");
}

/* ── Fountain and Every Other App ───────────────────────────────────────── */

function appsChart(d) {
  const a = d.stats.apps;
  if (!a.total) return "";
  const rest = Math.max(0, a.total - a.fountain - a.other);
  const seg = (cls, n, label) => n
    ? `<span class="ya-seg ${cls}" style="flex-grow:${n}" title="${esc(`${label}: ${fmt(n)} boosts, ${pctLabel(pct(n, a.total))}`)}"></span>` : "";
  const split = `<div class="ya-split" role="img" aria-label="${esc(`Fountain ${pctLabel(pct(a.fountain, a.total))}, other apps ${pctLabel(pct(a.other, a.total))}, boost bots and unattributed ${pctLabel(pct(rest, a.total))}`)}">` +
    seg("ya-fountain", a.fountain, "Fountain") + seg("ya-other", a.other, "Other apps") + seg("ya-rest", rest, "Boost bots and unattributed") + `</div>` +
    `<ul class="ya-key">` +
      `<li><span class="ya-sw ya-fountain"></span>Fountain <strong>${fmt(a.fountain)}</strong> (${pctLabel(pct(a.fountain, a.total))})</li>` +
      `<li><span class="ya-sw ya-other"></span>Every other app <strong>${fmt(a.other)}</strong> (${pctLabel(pct(a.other, a.total))})</li>` +
      (rest ? `<li><span class="ya-sw ya-rest"></span>Boost bots and unattributed <strong>${fmt(rest)}</strong> (${pctLabel(pct(rest, a.total))})</li>` : "") +
    `</ul>`;
  const top = a.rows[0]?.boosts || 1;
  const rows = a.rows.map((r) =>
    `<li><span class="ya-name">${esc(clientLabel(r.slug))}</span>` +
    `<span class="ya-bar"><span style="width:${Math.max(1.5, (100 * r.boosts) / top).toFixed(1)}%"></span></span>` +
    `<span class="ya-n" title="${esc(`${fmt(r.sats)} sats from ${fmt(r.boosters)} booster${r.boosters === 1 ? "" : "s"}`)}">${fmt(r.boosts)}</span></li>`).join("");

  // Monthly boosts from the other apps, over the index, as bars.
  const ms = d.stats.months;
  const H = 150, L = 46, R = 12, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...ms.map((m) => m.apps)));
  const bw = (W - L - R) / ms.length;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const bars = [];
  for (const f of [0, 1]) bars.push(`<line class="yc-grid" x1="${L}" x2="${W - R}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}"/><text class="yc-axis" x="${L - 6}" y="${(y(max * f) + 4).toFixed(1)}" text-anchor="end">${short(max * f)}</text>`);
  ms.forEach((m, i) => {
    const h = (H - T - B) * (m.apps / max);
    const tip = `${monthName(m.month, true)}: ${fmt(m.apps)} boosts from other apps, ${pctLabel(pct(m.apps, m.boosts))} of the month`;
    bars.push(`<rect class="yc-bar${m.month.startsWith(`${d.year}-`) ? "" : " yc-bar--past"}" x="${(L + i * bw + 1).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(tip)}</title></rect>`);
    const mm = m.month.slice(5);
    if (mm === "01") bars.push(`<text class="yc-axis" x="${(L + i * bw).toFixed(1)}" y="${H - 8}">${m.month.slice(0, 4)}</text>`);
  });

  return figure("Fountain and Every Other App",
    `Fountain publishes most Nostr boosts; these are the ${esc(d.year)} boosts by the app they were sent from. An app here is a website or app a person boosts from; a boost bot that republishes other people's boosts is not one.`,
    split +
    `<h3 class="yc-sub">Every Other App in ${esc(d.year)}</h3><ul class="ya-rows">${rows || `<li class="ya-none">None yet.</li>`}</ul>` +
    `<h3 class="yc-sub">Boosts From Other Apps by Month</h3><div class="yc-scroll"><svg class="yc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Boosts from apps other than Fountain, by month">${bars.join("")}</svg></div>`,
    "");
}

/* ── #40HPW Finishers by Week ───────────────────────────────────────────── */

function hpwChart(d) {
  const s = d.stats;
  const ws = s.weeks;
  if (!ws.length) return "";
  const H = 170, L = 30, R = 12, T = 12, B = 26;
  const max = Math.max(2, ...ws.map((w) => w.hpw));
  const slots = 52;
  const bw = (W - L - R) / slots;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const parts = [];
  for (const v of [0, max]) parts.push(`<line class="yc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="yc-axis" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`);
  let lastMonth = -1;
  ws.forEach((w, i) => {
    const h = (H - T - B) * (w.hpw / max);
    const live = d.open && i === ws.length - 1;
    const date = pacificDate(w.start, { month: "short", day: "numeric" });
    const tip = `Week of ${date}${live ? " (in progress)" : ""}: ${w.hpw} member${w.hpw === 1 ? "" : "s"} at 40 hours or more`;
    const xx = L + i * bw;
    parts.push(`<rect class="yc-bar${live ? " yc-bar--live" : ""}" x="${(xx + 1).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(h, w.hpw ? 0 : 0).toFixed(1)}"><title>${esc(tip)}</title></rect>`);
    if (w.hpw) parts.push(`<text class="yc-val" x="${(xx + bw / 2).toFixed(1)}" y="${(H - B - h - 3).toFixed(1)}" text-anchor="middle">${w.hpw}</text>`);
    // Month ticks off the week's Thursday, which names the month most of the week is in.
    const m = Number(pacificDate(w.start + 3 * 86400, { month: "numeric" })) - 1;
    if (m !== lastMonth) { parts.push(`<text class="yc-axis" x="${xx.toFixed(1)}" y="${H - 8}">${MON[m]}</text>`); lastMonth = m; }
  });
  return figure("#40HPW Finishers by Week",
    `How many members reached 40 hours of boosted listening in each chart week of ${esc(d.year)}, by the #40HPW Challenge's own count.`,
    `<p class="yh-head"><strong>${fmt(s.hpw.members)}</strong> member${s.hpw.members === 1 ? "" : "s"} reached 40 hours at least once; <strong>${fmt(s.hpw.weeks)}</strong> forty-hour weeks in all. <a href="/hpw/high-scores">Proof of #40HPW</a></p>` +
    `<div class="yc-scroll"><svg class="yc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="#40HPW finishers by week">${parts.join("")}</svg></div>`,
    "");
}

function figure(title, lead, body, foot) {
  return `<section class="yc-fig"><h2>${esc(title)}</h2><p class="yc-lead">${lead}</p>${body}${foot}</section>`;
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
    ${statCards(d)}
    ${d.stats ? monthsChart(d) : ""}
    <div class="hpw-boards year-boards">
      ${board("songs", `Top Songs of ${y}`, d.songs)}
      ${board("artists", `Top Artists of ${y}`, d.artists)}
      ${board("shows", `Top Podcasts of ${y}`, d.shows)}
      ${boardHtml({
        board: "year-boosters", title: `Top Boosters of ${y}`, sub: `Top ${TOP_N}`, empty, colhead: true,
        colheadLabel: "sats/boosts/shows", list: "hpw-list",
        rows: d.boosters.map((m) => memberChartRowHtml(m)),
      })}
    </div>
    ${d.stats ? `<div class="yc-pair">${appsChart(d)}${hpwChart(d)}</div>` : ""}`;
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
