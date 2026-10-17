// GET / — THE DISCOVERY HOMEPAGE, its fact rails rendered at the edge.
//
// Since 2026-10-17 (Reed's call, the Rotten Tomatoes model): the front door
// is a page of rails — this week's top shows, this month's top albums, the
// #40HPW week, then the personal rails, then the year's episodes and songs
// and the week's artists. The feed experience that was `/` is `/charts` now
// (functions/_shared/charts-page.js) and every hash it had forwards there.
//
// ⚠️ THE PAGE IS STILL index.html. This Function does not build a homepage;
// it fetches the static file through env.ASSETS and drops each rail's rows
// into that rail's marker pair. The rails' words, their order, the locked
// cards and the scripts are all in the file and are edited there.
//
// ⚠️ EVERY RAIL IS A FAST PATH, NOT A DEPENDENCY. The rails run together and
// each failure — a query, a missing marker — leaves that rail's placeholder in
// place, which assets/js/discover.js fetches and paints with the same tile
// module. The page is never an error, and no rail waits on another.
//
// ⚠️ THE TILE IS TWO-SIDED (assets/js/rail-tile.js): the edge renders it, and
// a rail the browser rebuilds is byte-identical by construction.
//
// WHAT IT COSTS. The weekly charts are the same windowed queries
// /api/v1/charts answers; the month, year and #40HPW rails are the ranked
// endpoints' own functions with the same arguments the links beside each
// rail open; the response is cached 120s at the edge (the collector's tick),
// so this is a handful of queries per colo per two minutes, not per visitor.
import { weekBoard } from "./api/v1/charts/[[path]].js";
import { weeklyChart } from "./_shared/week-charts.js";
import { pacificWeekStart, prevWeek, nextWeek } from "../assets/js/pacific-week.js";
import { readParams as podcastParams, globalPodcasts } from "./api/v1/podcasts.js";
import { readParams as episodeParams, globalEpisodes } from "./api/v1/episodes.js";
import { hoursBoard } from "./api/v1/members/hours.js";
import { railListHtml, tileHtml, showTile, albumTile, episodeTile, artistTile, memberTile } from "../assets/js/rail-tile.js";
import { showPageHref } from "../assets/js/show-link.js";
import { boostRows } from "../assets/js/boost-list.js";
import { BOOST_SELECT } from "./api/v1/_common.js";
import { lookupMentionNames } from "./_shared/detail-page.js";
import { headOf } from "./_shared/head.js";

const TILES = 10;
const BOOSTS = 12;

/* ── The rails, keyed by the marker in index.html ───────────────────────── */

async function rankedPodcasts(env, query) {
  const u = new URL("https://ob.invalid/api/v1/podcasts?" + query);
  const p = podcastParams(u);
  if (p.error) throw new Error(p.error);
  const { podcasts } = await globalPodcasts(env, p);
  return podcasts || [];
}
async function rankedEpisodes(env, query) {
  const u = new URL("https://ob.invalid/api/v1/episodes?" + query);
  const p = episodeParams(u);
  if (p.error) throw new Error(p.error);
  const res = await globalEpisodes(env, p);
  return res?.episodes || res?.items || [];
}

export const RAILS = {
  "shows-week": async (env) => {
    const { body } = await weekBoard(env, { kind: "shows", limit: TILES });
    return railListHtml(body.rows.map(showTile), { empty: "No shows boosted yet this week." });
  },
  "albums-month": async (env) => {
    const rows = await rankedPodcasts(env, `medium=music&sort=chart&range=1m&limit=${TILES}`);
    return railListHtml(rows.map(albumTile), { empty: "No albums boosted yet this month." });
  },
  /* The #40HPW week as a rail of faces, not the board: Reed's call,
     2026-10-17, every rail the same shape. Gold past the goal. */
  "hpw-week": async (env) => {
    const { body } = await hoursBoard(env, { range: "week", limit: TILES });
    return railListHtml(body.members.map((m, i) => memberTile(m, i, body.goal_hours)), { empty: "No qualifying boosts yet this week." });
  },
  "episodes-year": async (env) => {
    const rows = await rankedEpisodes(env, `not_medium=music&sort=chart&range=1y&limit=${TILES}`);
    return railListHtml(rows.map((r, i) => episodeTile(r, i, "🎙")), { empty: "No episodes boosted this year." });
  },
  "songs-year": async (env) => {
    const rows = await rankedEpisodes(env, `medium=music&sort=chart&range=1y&limit=${TILES}`);
    return railListHtml(rows.map((r, i) => episodeTile(r, i, "🎵")), { empty: "No songs boosted this year." });
  },
  "artists-week": async (env) => {
    const { body } = await weekBoard(env, { kind: "artists", limit: TILES });
    return railListHtml(body.rows.map(artistTile), { empty: "No artists boosted yet this week." });
  },
  /* NEW AND NOTEWORTHY: shows whose FIRST boost ever landed in the last 90
     days, two or more distinct boosters, by boosters then sats. The all-time
     charts bury a debut; this is the Billboard instrument. 90 days and the
     floor are the collector's measurement (2026-10-17: 41 debuts in 30 days,
     3 of them with three boosters; 21 in 90 days with two). */
  "new-shows": async (env) => {
    const since = Math.floor(Date.now() / 1000) - 90 * 86400;
    const { results } = await env.DB.prepare(
      `SELECT podcast_guid AS guid, title, image, artwork, author, medium, total_sats, booster_count, first_boost_ts
         FROM podcasts
        WHERE first_boost_ts >= ? AND booster_count >= 2 AND COALESCE(title, '') <> ''
        ORDER BY booster_count DESC, total_sats DESC, first_boost_ts DESC LIMIT ?`
    ).bind(since, TILES).all();
    const rows = results || [];
    return railListHtml(rows.map((r, i) => tileHtml({
      rank: i + 1, href: showPageHref(r.guid), title: r.title,
      sub: "First boost " + new Date(r.first_boost_ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      subTitle: `${r.booster_count} boosters since its first boost`,
      img: r.image, art2: r.artwork, glyph: (r.medium === "music" ? "🎵" : "🎙"),
    })), { empty: "No show had its first boost in the last 90 days." });
  },
  /* MOVERS: the biggest climbs on this week's Shows chart against last
     week's, then this week's debuts in chart order. Both weeks are the
     same query /api/v1/charts answers, read to 100 places. */
  "movers": async (env) => {
    const live = pacificWeekStart(Math.floor(Date.now() / 1000));
    const last = prevWeek(live);
    const [now, before] = await Promise.all([
      weeklyChart(env, "shows", live, nextWeek(live), 100),
      weeklyChart(env, "shows", last, live, 100),
    ]);
    const was = new Map(before.map((r) => [r.guid, r.rank]));
    const climbers = now.filter((r) => was.has(r.guid) && was.get(r.guid) > r.rank)
      .map((r) => ({ r, climb: was.get(r.guid) - r.rank }))
      .sort((a, b) => b.climb - a.climb || a.r.rank - b.r.rank);
    const debuts = now.filter((r) => !was.has(r.guid)).map((r) => ({ r, climb: null }));
    const picks = [...climbers, ...debuts].slice(0, TILES);
    return railListHtml(picks.map(({ r, climb }) => tileHtml({
      rank: r.rank, tied: !!r.tied, href: showPageHref(r.guid), title: r.title,
      sub: climb != null ? `▲ ${climb} · was #${was.get(r.guid)}` : "New this week",
      subTitle: climb != null ? "Places climbed since last week's chart" : "Not on last week's chart",
      img: r.image, art2: r.artwork, glyph: "🎙",
    })), { empty: "Nothing has moved yet this week." });
  },
  /* PODCASTERS RECOMMEND: the shows most often listed on other shows'
     podrolls, the one editorial signal publishers wrote themselves. A
     target the index has no page for is a figure, not a link. */
  "podroll": async (env) => {
    const { results } = await env.DB.prepare(
      `SELECT target_guid AS guid, MAX(target_title) AS title, MAX(target_image) AS image,
              MAX(target_artwork) AS artwork, MAX(target_linked) AS linked, MAX(target_medium) AS medium,
              COUNT(DISTINCT source_guid) AS n
         FROM podroll
        WHERE target_guid IS NOT NULL AND COALESCE(target_title, '') <> ''
        GROUP BY target_guid
        ORDER BY n DESC, title ASC LIMIT ?`
    ).bind(TILES).all();
    const rows = results || [];
    return railListHtml(rows.map((r, i) => tileHtml({
      rank: i + 1, href: Number(r.linked) ? showPageHref(r.guid) : null, title: r.title,
      sub: `On ${r.n} podroll${Number(r.n) === 1 ? "" : "s"}`,
      subTitle: "How many shows list it on their podroll",
      img: r.image, art2: r.artwork, glyph: (r.medium === "music" ? "🎵" : "🎙"),
    })), { empty: "No podroll in the index yet." });
  },
  /* The boost firehose's newest rows, the same two-sided boost row every
     detail page's #boosts list renders (boost-list.js), facts at the edge
     and the reaction bar attached by discover.js. The Members tab holds
     the whole feed with its range, sort and paging; this is the foot of
     the front door. */
  "boosts-latest": async (env) => {
    const { results } = await env.DB.prepare(`${BOOST_SELECT} ORDER BY b.created_at DESC, b.event_id DESC LIMIT ?`).bind(BOOSTS).all();
    const rows = results || [];
    if (!rows.length) return `<p class="rail-empty">No boosts yet.</p>`;
    const names = await lookupMentionNames(env, rows.map((r) => r.message));
    return `<ul class="boost-list ob-boost-list" data-bs-list>${boostRows(rows, names, { noun: "episode", showTarget: true, linkBooster: true, showShow: true })}</ul>`;
  },
};

/* ── The injection ───────────────────────────────────────────────────────── */

export function injectRail(html, key, block) {
  const open = `<!--OB:RAIL:${key}-->`;
  const close = `<!--/OB:RAIL:${key}-->`;
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  if (start === -1 || end === -1 || end < start) throw new Error(`marker ${key} not found`);
  return html.slice(0, start) + block + html.slice(end + close.length);
}

/* ⚠️ ASK THE ASSET SERVER FOR `/`, NEVER FOR `/index.html`, AND NEVER RETURN
 * A REDIRECT FROM IT. Pages 308-redirects `/index.html` to `/`, and `/` is
 * this Function: the loop shipped once as ERR_TOO_MANY_REDIRECTS on the front
 * door. `env.ASSETS.fetch` resolves `/` to the file with a 200 and bypasses
 * Functions routing, and the guard below is the belt to that brace. */
export async function onRequestGet(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));

  if (shell.status >= 300 && shell.status < 400) {
    console.error("[home] asset server redirected / to", shell.headers.get("location"));
    return new Response("The homepage is temporarily unavailable.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (!shell.ok) return shell;

  let html = await shell.text();
  const keys = Object.keys(RAILS);
  const settled = await Promise.allSettled(keys.map((k) => RAILS[k](env)));
  settled.forEach((s, i) => {
    if (s.status !== "fulfilled") { console.warn(`[home] rail ${keys[i]} not rendered`, s.reason); return; }
    try { html = injectRail(html, keys[i], s.value); }
    catch (err) { console.warn(`[home] rail ${keys[i]} not injected`, err); }
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Two minutes is the collector's tick; honored at the edge since the
      // zone Cache Rule of 2026-09-07, so it is how stale a copy can be.
      "Cache-Control": "public, max-age=120",
    },
  });
}

// The GET's status and headers, no body — see _shared/head.js.
export const onRequestHead = headOf(onRequestGet);
