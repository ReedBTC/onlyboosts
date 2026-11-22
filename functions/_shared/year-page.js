// /charts/<year>: the year's Top 33 Songs, Artists, Podcasts and Boosters
// (2026-11-21), headed "OnlyBoosts <year> Charts". Edge-rendered into the
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
import { boardHtml, weekRowHtml, memberChartRowHtml, memberFaceName } from "../../assets/js/chart-board.js";
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

/* ⚠️ EVERY GRAPH IS DRAWN TWICE, AT TWO WIDTHS (Reed, 2026-11-22: a phone
 * must see the whole graph without scrolling). One SVG drawn 720 units wide
 * and shrunk to a phone would set its 11-unit type at 5px, so the phone gets
 * its own 360-unit drawing with the same type sizes, and CSS shows one of the
 * two (.yc-wide / .yc-narrow, charts-year.html). The drawing code reads the
 * width from `W`, which dualSvg sets for each pass and restores after. */
let W = 720;
const NARROW = 360;
function dualSvg(draw) {
  const pass = (w, cls) => {
    W = w;
    try { return draw().replace('<svg class="yc-svg"', `<svg class="yc-svg ${cls}"`); } finally { W = 720; }
  };
  const wide = pass(720, "yc-wide");
  return wide ? `<div class="yc-graph">${wide}${pass(NARROW, "yc-narrow")}</div>` : "";
}
const MIN_APP_ROW = 5;

function monthsSvg(d) {
  /* The chart year's months only (Reed, 2026-11-22); the site-wide line
   * belongs on the stats page. Each month's colour is against the month
   * before it, so January is read against the prior December, which is in
   * `months` but not drawn. The month in progress is a hollow point with no
   * segment into it: a part month is never compared whole. */
  const all = d.stats.months;
  const cur = d.open ? pacificDate(d.through, { year: "numeric", month: "2-digit" }).replace(/(\d+)\/(\d+)/, "$2-$1") : null;
  const first = all.findIndex((m) => m.month.startsWith(`${d.year}-`));
  if (first < 0) return "";
  const ms = all.slice(first).filter((m) => m.month.startsWith(`${d.year}-`));
  const H = 210, L = 46, R = 16, T = 14, B = 28;
  const max = niceMax(Math.max(...ms.map((m) => m.boosts)));
  const span = Math.max(ms.length - 1, 1);
  const x = (i) => L + 8 + (i * (W - L - R - 16)) / span;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const parts = [];
  for (const f of [0, 0.5, 1]) {
    const v = max * f;
    parts.push(`<line class="yc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
    parts.push(`<text class="yc-axis" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`);
  }
  ms.forEach((m, i) => {
    parts.push(`<text class="yc-axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${MON[Number(m.month.slice(5)) - 1]}</text>`);
  });
  for (let i = 1; i < ms.length; i++) {
    if (ms[i].month === cur) continue;
    const dir = ms[i].boosts >= ms[i - 1].boosts ? "up" : "down";
    parts.push(`<line class="yc-seg yc-${dir}" x1="${x(i - 1).toFixed(1)}" y1="${y(ms[i - 1].boosts).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(ms[i].boosts).toFixed(1)}"/>`);
  }
  ms.forEach((m, i) => {
    const partial = m.month === cur;
    const prev = all[first + i - 1];
    const change = prev && prev.boosts ? ((m.boosts - prev.boosts) / prev.boosts) * 100 : null;
    const dir = !prev || partial ? "flat" : m.boosts >= prev.boosts ? "up" : "down";
    const tip = `${monthName(m.month, true)}${partial ? " so far" : ""}: ${fmt(m.boosts)} boosts, ${fmt(m.sats)} sats, ${fmt(m.boosters)} boosters` +
      (change !== null && !partial ? `; ${change >= 0 ? "up" : "down"} ${Math.abs(Math.round(change))}% on ${MONTH[Number(prev.month.slice(5)) - 1]}` : "");
    parts.push(`<circle class="yc-dot yc-${dir}${partial ? " yc-partial" : ""}" cx="${x(i).toFixed(1)}" cy="${y(m.boosts).toFixed(1)}" r="4"><title>${esc(tip)}</title></circle>`);
  });

  return `<svg class="yc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Boosts by month, ${esc(d.year)}">${parts.join("")}</svg>`;
}

function monthsChart(d) {
  const graph = dualSvg(() => monthsSvg(d));
  return graph ? figure("Boosts by Month", "", graph, "") : "";
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
  /* The ranked list stops at apps with MIN_APP_ROW boosts in the year
   * (Reed, 2026-11-22: "cut off after StableKraft"); the smaller ones stay in
   * the split bar's total. */
  const top = a.rows[0]?.boosts || 1;
  const rows = a.rows.filter((r) => r.boosts >= MIN_APP_ROW).map((r) =>
    `<li><span class="ya-name">${esc(clientLabel(r.slug))}</span>` +
    `<span class="ya-bar"><span style="width:${Math.max(1.5, (100 * r.boosts) / top).toFixed(1)}%"></span></span>` +
    `<span class="ya-n" title="${esc(`${fmt(r.sats)} sats from ${fmt(r.boosters)} booster${r.boosters === 1 ? "" : "s"}`)}">${fmt(r.boosts)}</span></li>`).join("");

  // The year's other-app boosts by chart week (2026-11-22).
  const weekly = dualSvg(() => {
    const g = weekFrame(d, 150, 12, Math.max(1, ...d.stats.weeks.map((w) => w.apps)), short);
    d.stats.weeks.forEach((w, i) => {
      const tip = `Week of ${pacificDate(w.start, { month: "short", day: "numeric" })}${g.live(i) ? " (in progress)" : ""}: ${fmt(w.apps)} boosts from other apps, ${pctLabel(pct(w.apps, w.boosts))} of the week`;
      g.parts.push(g.bar(i, w.apps, tip));
    });
    return `<svg class="yc-svg" viewBox="0 0 ${W} ${g.H}" role="img" aria-label="Boosts from apps other than Fountain, by week of ${esc(d.year)}">${g.parts.join("")}</svg>`;
  });

  return figure("Fountain and Every Other App",
    `Fountain publishes most Nostr boosts; these are the ${esc(d.year)} boosts by the app they were sent from. An app here is a website or app a person boosts from; a boost bot that republishes other people's boosts is not one.`,
    split +
    `<h3 class="yc-sub">Every Other App in ${esc(d.year)}</h3><ul class="ya-rows">${rows || `<li class="ya-none">None yet.</li>`}</ul>` +
    `<h3 class="yc-sub">Boosts From Other Apps by Week</h3>${weekly}`,
    "");
}

/* ── The weekly bar frame ────────────────────────────────────────────────
 * The year's 52 chart weeks across, a zero and a top gridline, a month tick
 * off each week's Thursday (which names the month most of the week is in),
 * and `bar(i, v, tip)` for one week; the week in progress is faded. Shared
 * by the other-apps bars and the #40HPW bars, so the two line up. */
function weekFrame(d, H, T, top, label = String) {
  const ws = d.stats.weeks;
  const L = 34, R = 12, B = 26, slots = Math.max(52, ws.length);
  const max = top <= 4 ? Math.max(2, top) : niceMax(top);
  const bw = (W - L - R) / slots;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const x = (i) => L + i * bw;
  const live = (i) => d.open && i === ws.length - 1;
  const parts = [];
  for (const v of [0, max]) parts.push(`<line class="yc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="yc-axis" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${label(v)}</text>`);
  let lastMonth = -1;
  ws.forEach((w, i) => {
    const m = Number(pacificDate(w.start + 3 * 86400, { month: "numeric" })) - 1;
    // On the narrow drawing every other month, Jan, Mar, May …, or they collide.
    if (m !== lastMonth) { if (W >= 500 || m % 2 === 0) parts.push(`<text class="yc-axis" x="${x(i).toFixed(1)}" y="${H - 8}">${MON[m]}</text>`); lastMonth = m; }
  });
  const bar = (i, v, tip) => {
    const h = (H - T - B) * (v / max);
    return `<rect class="yc-bar${live(i) ? " yc-bar--live" : ""}" x="${(x(i) + 1).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(tip)}</title></rect>`;
  };
  return { H, T, B, L, R, bw, max, x, y, live, parts, bar };
}

/* ── #40HPW Finishers by Week ───────────────────────────────────────────── */

/* The #40HPW board went live on the evening of Sunday 2026-08-23 (the merge
 * of the homepage branch, 39e546a2, 20:56 EDT), the last hours of the chart
 * week of Aug 17; the week of Aug 24 is the first it was live for. */
const HPW_LAUNCH = Date.UTC(2026, 7, 24, 0, 56, 44) / 1000;

/* The launch, drawn as a marker annotation (Reed, 2026-11-22: "the red
 * marker, hand-drawn arrow and circle"): a dashed rule at the launch week, a
 * loose ring around the finishes since, and an arrow from a note giving the
 * before-and-after counts. The roughness is an SVG displacement filter on
 * the strokes only; the type stays crisp. Static geometry, no randomness, so
 * every render of a given week is byte-identical. */
function launchMark(g, ws) {
  const li = ws.findIndex((w) => w.start > HPW_LAUNCH);
  if (li < 12) return "";
  const lx = g.x(li);
  let last = li;
  ws.forEach((w, i) => { if (i >= li && w.hpw) last = i; });
  const peak = Math.max(1, ...ws.slice(li).map((w) => w.hpw));
  const before = ws.slice(0, li).reduce((t, w) => t + w.hpw, 0);
  const since = ws.slice(li).reduce((t, w) => t + w.hpw, 0);
  const n = (k) => `${k} forty-hour week${k === 1 ? "" : "s"}`;

  // The ring: an ellipse round the bars since launch, drawn as one stroke
  // that overshoots its start, the way a marker circle does.
  const x0 = lx - 6, x1 = g.x(last + 1) + 6;
  // An ellipse holds a box's corners at about 1.3 times its half-sides.
  const top = g.y(peak) - 12, bot = g.y(0) + 4;
  const rx = ((x1 - x0) / 2) * 1.3, ry = Math.min(((bot - top) / 2) * 1.25, (g.H - 6) / 2);
  const cx = Math.min((x0 + x1) / 2, W - 5 - rx * 1.09), cy = Math.min(Math.max((top + bot) / 2, ry + 3), g.H - ry - 3);
  const tilt = -0.06, pts = [];
  for (let k = 0; k <= 64; k++) {
    const t = -2.2 + (k / 64) * (2 * Math.PI + 0.55);
    const grow = 1 + 0.06 * (k / 64) + 0.025 * Math.sin(3 * t + 0.8);
    const ex = rx * grow * Math.cos(t), ey = ry * grow * Math.sin(t);
    pts.push(`${(cx + ex * Math.cos(tilt) - ey * Math.sin(tilt)).toFixed(1)} ${(cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)).toFixed(1)}`);
  }
  const ring = `<path class="yh-ink" d="M${pts.join(" L")}"/>`;

  // The note, upper left of the rule, and an arrow curving down into the ring.
  const nx = cx - rx - (W < 500 ? 8 : 26), ny = 14;
  const narrow = W < 500;
  const ax0 = nx - 10, ay0 = ny + (narrow ? 48 : 36), ax1 = cx - rx * 0.97, ay1 = cy + ry * 0.12;
  const c1x = ax0 - 6, c1y = ay1 - 4, c2x = ax1 - 46, c2y = ay1 + 16;
  const ang = Math.atan2(ay1 - c2y, ax1 - c2x), hl = 10;
  const head = [0.5, -0.5].map((o) => `M${(ax1 - hl * Math.cos(ang + o)).toFixed(1)} ${(ay1 - hl * Math.sin(ang + o)).toFixed(1)} L${ax1.toFixed(1)} ${ay1.toFixed(1)}`).join(" ");
  const arrow = `<path class="yh-ink" d="M${ax0.toFixed(1)} ${ay0.toFixed(1)} C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${ax1.toFixed(1)} ${ay1.toFixed(1)} ${head}"/>`;

  return `<defs><filter id="yh-rough-${W}" x="-5%" y="-5%" width="110%" height="110%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4"/>` +
      `<feDisplacementMap in="SourceGraphic" scale="3.2"/></filter></defs>` +
    `<line class="yh-rule" x1="${lx.toFixed(1)}" x2="${lx.toFixed(1)}" y1="${g.T - 4}" y2="${g.y(0).toFixed(1)}"/>` +
    `<g class="yh-mark" filter="url(#yh-rough-${W})">${ring}${arrow}</g>` +
    `<g class="yh-note" transform="rotate(-3 ${nx.toFixed(1)} ${ny.toFixed(1)})">` +
      `<text class="yh-note-h" x="${nx.toFixed(1)}" y="${(ny + 8).toFixed(1)}" text-anchor="end">#40HPW goes live, Aug 23</text>` +
      (narrow
        ? `<text class="yh-note-s" x="${nx.toFixed(1)}" y="${(ny + 23).toFixed(1)}" text-anchor="end">${esc(`Before: ${before} in ${li} weeks.`)}</text>` +
          `<text class="yh-note-s" x="${nx.toFixed(1)}" y="${(ny + 37).toFixed(1)}" text-anchor="end">${esc(`Since: ${since} in ${ws.length - li} weeks.`)}</text>`
        : `<text class="yh-note-s" x="${nx.toFixed(1)}" y="${(ny + 24).toFixed(1)}" text-anchor="end">${esc(`Before: ${n(before)} in ${li} weeks. Since: ${since} in ${ws.length - li} weeks.`)}</text>`) +
    `</g>`;
}

/* Who finished #40HPW in the year, and which weeks (Reed, 2026-11-22): a
 * member row each, most forty-hour weeks first, with a strip of the year's 52
 * chart weeks under the name, a filled cell per week finished. The strip
 * shares the bars' weeks below it, and carries the launch as a red tick. */
function finishersHtml(d) {
  const ws = d.stats.weeks;
  const rows = d.stats.hpw.finishers || [];
  if (!rows.length) return "";
  const slots = Math.max(52, ws.length), cw = 6;
  const li = ws.findIndex((w) => w.start > HPW_LAUNCH);
  let rank = 0, prev = -1;
  const out = rows.map((m, i) => {
    const n = m.weeks.length;
    if (n !== prev) { rank = i + 1; prev = n; }
    const tied = rows.filter((r) => r.weeks.length === n).length > 1;
    const done = new Set(m.weeks);
    const cells = [];
    for (let k = 0; k < slots; k++) {
      const cls = done.has(k) ? "yf-cell yf-cell--on" : k >= ws.length ? "yf-cell yf-cell--future" : "yf-cell";
      const tip = done.has(k) ? `<title>${esc(`Week of ${pacificDate(ws[k].start, { month: "short", day: "numeric" })}`)}</title>` : "";
      cells.push(`<rect class="${cls}" x="${k * cw}" y="0" width="${cw - 1}" height="8" rx="1">${tip}</rect>`);
    }
    if (li >= 12) cells.push(`<line class="yf-launch" x1="${li * cw - 0.5}" x2="${li * cw - 0.5}" y1="-1" y2="9"/>`);
    const { face, whoM } = memberFaceName(m);
    return `<li class="hpw-row">` +
      `<span class="hpw-pos">${tied ? "T" : ""}${rank}</span>` + face +
      `<span class="hpw-who">${whoM}<svg class="yf-strip" viewBox="0 -1 ${slots * cw} 10" role="img" aria-label="${esc(`${n} forty-hour week${n === 1 ? "" : "s"} in ${d.year}`)}">${cells.join("")}</svg></span>` +
      `<span class="yf-n"><strong>${n}</strong> week${n === 1 ? "" : "s"}</span>` +
      `</li>`;
  }).join("");
  return `<h3 class="yc-sub">Members Who Hit 40 Hours</h3><ul class="hpw-list yf-list">${out}</ul>`;
}

function hpwChart(d) {
  const s = d.stats;
  const ws = s.weeks;
  if (!ws.length) return "";
  const weekly = dualSvg(() => {
    const g = weekFrame(d, 240, 74, Math.max(...ws.map((w) => w.hpw)));
    const mark = launchMark(g, ws);
    ws.forEach((w, i) => {
      const tip = `Week of ${pacificDate(w.start, { month: "short", day: "numeric" })}${g.live(i) ? " (in progress)" : ""}: ${w.hpw} member${w.hpw === 1 ? "" : "s"} at 40 hours or more`;
      g.parts.push(g.bar(i, w.hpw, tip));
      // The narrow bars are too thin to carry a figure; the hover title has it.
      if (w.hpw && W >= 500) g.parts.push(`<text class="yc-val" x="${(g.x(i) + g.bw / 2).toFixed(1)}" y="${(g.y(w.hpw) - 3).toFixed(1)}" text-anchor="middle">${w.hpw}</text>`);
    });
    return `<svg class="yc-svg" viewBox="0 0 ${W} ${g.H}" role="img" aria-label="#40HPW finishers by week">${g.parts.join("")}${mark}</svg>`;
  });
  return figure(`#40HPW in ${d.year}`,
    `Members who reached 40 hours of boosted listening in a chart week of ${esc(d.year)}, by the #40HPW Challenge's own count.`,
    `<p class="yh-head"><strong>${fmt(s.hpw.members)}</strong> member${s.hpw.members === 1 ? "" : "s"} reached 40 hours at least once; <strong>${fmt(s.hpw.weeks)}</strong> forty-hour weeks in all. <a href="/hpw/high-scores">Proof of #40HPW</a></p>` +
    finishersHtml(d) +
    `<h3 class="yc-sub">Finishers by Week</h3>${weekly}`,
    "");
}

function figure(title, lead, body, foot) {
  return `<section class="yc-fig"><h2>${esc(title)}</h2>${lead ? `<p class="yc-lead">${lead}</p>` : ""}${body}${foot}</section>`;
}

export function yearHtml(d) {
  const y = d.year;
  const empty = "No Nostr boosts in this year yet.";
  const board = (key, title, rows) => boardHtml({
    board: `year-${key}`, title, sub: `Top ${TOP_N}`, empty, colhead: true,
    rows: rows.map((r) => weekRowHtml(key, r)),
  });
  return `<h1>OnlyBoosts ${y} Charts</h1>
    <p class="search-lead"><a href="/about#charts">How the charts work.</a></p>
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
  /* Keyed by the deploy too, so a new deploy never serves the last one's
   * HTML with its old ?v= stamps for the rest of the ten minutes. */
  const keyUrl = new URL(request.url);
  if (env.CF_PAGES_COMMIT_SHA) keyUrl.searchParams.set("__deploy", env.CF_PAGES_COMMIT_SHA);
  const key = new Request(keyUrl.toString(), { method: "GET" });
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
    html = html.replace("<title>Charts of the Year — OnlyBoosts</title>", `<title>OnlyBoosts ${esc(year)} Charts — OnlyBoosts</title>`)
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
