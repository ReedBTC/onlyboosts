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
// THE FEATURED CAROUSEL (Reed's call, 2026-10-19) sits above the rails: one
// slide per generic rail, the rail's FIRST PLACE, in the page's rail order.
// Each rail hands back its first row beside its HTML, so the hero costs no
// chart query; the one thing it adds is a description per slide (the one
// column the rails do not carry), looked up by primary key and allowed to
// fail quietly. The slide is assets/js/hero.js, two-sided like the tile. A
// rail with no rows has no slide, and with no slides at all the marker is
// left for the browser, like a rail's placeholder.
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
import { railListHtml, tileHtml, showTile, albumTile, episodeTile, memberTile } from "../assets/js/rail-tile.js";
import { showPageHref } from "../assets/js/show-link.js";
import { heroHtml, showSlide, episodeSlide, memberSlide, EYEBROWS } from "../assets/js/hero.js";
import { headOf, assetGet } from "./_shared/head.js";

const TILES = 10;

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

/** A rail's answer: its HTML and, for the hero, its first row as a slide
 *  spec (null when the rail is empty). */
const rail = (html, lead) => ({ html, lead: lead || null });

/* ── The three discovery rails' rows, shared with /discover/<key>, which
   lists them in full (2026-10-20, Reed's ask: ten tiles is the homepage's
   shape; the whole list is a page). Each takes the row count. ── */

/** NEW AND NOTEWORTHY: shows whose FIRST boost landed in the last 90 days,
 *  two or more distinct boosters, by boosters then sats. */
export async function newShowsRows(env, limit) {
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  const { results } = await env.DB.prepare(
    `SELECT podcast_guid AS guid, title, image, artwork, author, medium, feed_url AS feed,
            total_sats, booster_count, boost_count, first_boost_ts
       FROM podcasts
      WHERE first_boost_ts >= ? AND booster_count >= 2 AND COALESCE(title, '') <> ''
      ORDER BY booster_count DESC, total_sats DESC, first_boost_ts DESC LIMIT ?`
  ).bind(since, limit).all();
  return results || [];
}
export const firstBoost = (r) => "First boost " + new Date(r.first_boost_ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** MOVERS: this week's Shows chart against last week's, to 100 places:
 *  climbers by places climbed, then this week's debuts in chart order.
 *  Answers the picks and last week's places. */
export async function moversRows(env, limit) {
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
  return { picks: [...climbers, ...debuts].slice(0, limit), was };
}

/** PODCASTERS RECOMMEND: podroll targets by how many shows list them. An
 *  unindexed target (`linked` 0) has no page and no figures. */
export async function podrollRows(env, limit) {
  const { results } = await env.DB.prepare(
    `SELECT r.target_guid AS guid, MAX(r.target_title) AS title, MAX(r.target_image) AS image,
            MAX(r.target_artwork) AS artwork, MAX(r.target_linked) AS linked, MAX(r.target_medium) AS medium,
            COUNT(DISTINCT r.source_guid) AS n,
            MAX(p.total_sats) AS total_sats, MAX(p.booster_count) AS booster_count, MAX(p.boost_count) AS boost_count,
            MAX(p.feed_url) AS feed
       FROM podroll r LEFT JOIN podcasts p ON p.podcast_guid = r.target_guid
      WHERE r.target_guid IS NOT NULL AND COALESCE(r.target_title, '') <> ''
      GROUP BY r.target_guid
      ORDER BY n DESC, title ASC LIMIT ?`
  ).bind(limit).all();
  return results || [];
}
export const onN = (r) => `On ${r.n} podroll${Number(r.n) === 1 ? "" : "s"}`;

export const RAILS = {
  "shows-week": async (env) => {
    const { body } = await weekBoard(env, { kind: "shows", limit: TILES });
    return rail(railListHtml(body.rows.map(showTile), { empty: "No shows boosted yet this week." }),
      body.rows[0] && showSlide("shows-week", body.rows[0], { medium: "podcast" }));
  },
  "albums-month": async (env) => {
    const rows = await rankedPodcasts(env, `medium=music&sort=chart&range=1m&limit=${TILES}`);
    return rail(railListHtml(rows.map(albumTile), { empty: "No albums boosted yet this month." }),
      rows[0] && showSlide("albums-month", rows[0], { medium: "music" }));
  },
  /* The #40HPW week as a rail of faces, not the board: Reed's call,
     2026-10-17, every rail the same shape. Gold past the goal. */
  "hpw-week": async (env) => {
    const { body } = await hoursBoard(env, { range: "week", limit: TILES });
    return rail(railListHtml(body.members.map((m, i) => memberTile(m, i, body.goal_hours)), { empty: "No qualifying boosts yet this week." }),
      body.members[0] && memberSlide("hpw-week", body.members[0], body.goal_hours));
  },
  "episodes-year": async (env) => {
    const rows = await rankedEpisodes(env, `not_medium=music&sort=chart&range=1y&limit=${TILES}`);
    return rail(railListHtml(rows.map((r, i) => episodeTile(r, i, "🎙")), { empty: "No episodes boosted this year." }),
      rows[0] && episodeSlide("episodes-year", rows[0]));
  },
  "songs-year": async (env) => {
    const rows = await rankedEpisodes(env, `medium=music&sort=chart&range=1y&limit=${TILES}`);
    return rail(railListHtml(rows.map((r, i) => episodeTile(r, i, "🎵")), { empty: "No songs boosted this year." }),
      rows[0] && episodeSlide("songs-year", rows[0]));
  },
  /* NEW AND NOTEWORTHY: shows whose FIRST boost ever landed in the last 90
     days, two or more distinct boosters, by boosters then sats. The all-time
     charts bury a debut; this is the Billboard instrument. 90 days and the
     floor are the collector's measurement (2026-10-17: 41 debuts in 30 days,
     3 of them with three boosters; 21 in 90 days with two). */
  "new-shows": async (env) => {
    const rows = await newShowsRows(env, TILES);
    return rail(railListHtml(rows.map((r, i) => tileHtml({
      rank: i + 1, href: showPageHref(r.guid), title: r.title,
      sub: firstBoost(r),
      subTitle: `${r.booster_count} boosters since its first boost`,
      img: r.image, art2: r.artwork, glyph: (r.medium === "music" ? "🎵" : "🎙"),
    })), { empty: "No show had its first boost in the last 90 days." }),
      rows[0] && showSlide("new-shows", rows[0], { line: `${firstBoost(rows[0])} · ${rows[0].booster_count} boosters since` }));
  },
  /* MOVERS: the biggest climbs on this week's Shows chart against last
     week's, then this week's debuts in chart order. Both weeks are the
     same query /api/v1/charts answers, read to 100 places. */
  "movers": async (env) => {
    const { picks, was } = await moversRows(env, TILES);
    const top = picks[0];
    return rail(railListHtml(picks.map(({ r, climb }) => tileHtml({
      rank: r.rank, tied: !!r.tied, href: showPageHref(r.guid), title: r.title,
      sub: climb != null ? `▲ ${climb} · was #${was.get(r.guid)}` : "New this week",
      subTitle: climb != null ? "Places climbed since last week's chart" : "Not on last week's chart",
      img: r.image, art2: r.artwork, glyph: "🎙",
    })), { empty: "Nothing has moved yet this week." }),
      top && showSlide("movers", top.r, {
        medium: "podcast",
        eyebrow: top.climb != null ? EYEBROWS.movers : "New on the Chart This Week",
        line: top.climb != null
          ? `Up ${top.climb} place${top.climb === 1 ? "" : "s"} to #${top.r.rank}, from #${was.get(top.r.guid)} last week`
          : `#${top.r.rank} this week, not on last week's chart`,
      }));
  },
  /* PODCASTERS RECOMMEND: the shows most often listed on other shows'
     podrolls, the one editorial signal publishers wrote themselves. A
     target the index has no page for is a figure, not a link. */
  "podroll": async (env) => {
    const rows = await podrollRows(env, TILES);
    return rail(railListHtml(rows.map((r, i) => tileHtml({
      rank: i + 1, href: Number(r.linked) ? showPageHref(r.guid) : null, title: r.title,
      sub: onN(r),
      subTitle: "How many shows list it on their podroll",
      img: r.image, art2: r.artwork, glyph: (r.medium === "music" ? "🎵" : "🎙"),
    })), { empty: "No podroll in the index yet." }),
      rows[0] && showSlide("podroll", rows[0], {
        href: Number(rows[0].linked) ? showPageHref(rows[0].guid) : null,
        line: `${onN(rows[0])}, more than any other show`,
      }));
  },
};

/* ── The hero ────────────────────────────────────────────────────────────── */

/** A description cut for a slide: tags off, entities decoded, whitespace
 *  collapsed, clipped at a word boundary. The podcasts column is stored
 *  stripped; an episode's shownotes are not, and a publisher's bio and a
 *  member's about field can be anything. */
export function blurb(text, max = 220) {
  let t = String(text ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max);
  return t.slice(0, cut > max * 0.6 ? cut : max).replace(/[\s,;:.]+$/, '') + '…';
}

/* The one lookup a slide adds: the subject's description by primary key.
   A show slide also picks up the feed URL, which the weekly chart's rows
   do not carry and the boost pill prefers. Any failure leaves the slide as
   it was. */
const DESCRIBE = {
  show:    (env, s) => env.DB.prepare(`SELECT description AS d, feed_url AS feed FROM podcasts WHERE podcast_guid = ?`).bind(s.guid || '').first(),
  album:   (env, s) => DESCRIBE.show(env, s),
  episode: (env, s) => env.DB.prepare(`SELECT description AS d FROM episodes WHERE item_guid = ?`).bind(s.guid || '').first(),
  song:    (env, s) => DESCRIBE.episode(env, s),
  artist:  (env, s) => env.DB.prepare(`SELECT description AS d FROM publishers WHERE publisher_guid = ?`).bind(s.guid || '').first(),
  member:  (env, s) => env.DB.prepare(`SELECT about AS d FROM profiles WHERE pubkey = ?`).bind(s.pk || '').first(),
};

/** The slides in `order` (the page's rail order), each described. */
export async function buildHero(env, leads, order) {
  const slides = order.map((k) => leads[k]).filter(Boolean);
  await Promise.all(slides.map(async (s) => {
    try {
      const row = await DESCRIBE[s.kind]?.(env, s);
      if (!row) return;
      const d = blurb(row.d);
      if (d) s.desc = d;
      if (row.feed && s.boost && !s.boost.feed) s.boost.feed = row.feed;
    } catch (e) { console.warn(`[home] slide ${s.key} not described`, e?.message); }
  }));
  return slides;
}

/** The page's rail order, read off the shell so the slides follow the
 *  sections as Reed placed them, personal rails skipped. */
export function railOrder(html) {
  return [...html.matchAll(/<section[^>]*data-rail="([a-z-]+)"(?![^>]*data-rail-personal)/g)].map((m) => m[1]);
}

export function injectHero(html, block) {
  const open = "<!--OB:HERO-->", close = "<!--/OB:HERO-->";
  const start = html.indexOf(open), end = html.indexOf(close);
  if (start === -1 || end === -1 || end < start) throw new Error("hero marker not found");
  return html.slice(0, start) + block + html.slice(end + close.length);
}

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
  const shell = await env.ASSETS.fetch(assetGet(request, "/"));

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
  const leads = {};
  settled.forEach((s, i) => {
    if (s.status !== "fulfilled") { console.warn(`[home] rail ${keys[i]} not rendered`, s.reason); return; }
    const v = typeof s.value === "string" ? { html: s.value, lead: null } : s.value;
    try { html = injectRail(html, keys[i], v.html); leads[keys[i]] = v.lead; }
    catch (err) { console.warn(`[home] rail ${keys[i]} not injected`, err); }
  });

  // The hero, from the rails' first rows; nothing rendered leaves the marker.
  try {
    const slides = await buildHero(env, leads, railOrder(html));
    if (slides.length) html = injectHero(html, heroHtml(slides));
  } catch (err) { console.warn("[home] hero not rendered", err); }

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
