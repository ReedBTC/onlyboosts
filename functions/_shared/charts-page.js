// THE FIVE PAGES ONE SHELL SERVES, rendered at the edge.
//
//   /podcasts/shows · /podcasts/episodes          the Podcast Charts
//   /music/artists · /music/albums · /music/songs   the Music Charts
//   /boosts                                       the boost feed
//   /members                                      the wall and the bots
//   /charts/podcasts · /charts/music · /charts/hpw   the weekly boards
//
// Reed's call, 2026-10-21: the charts page (/charts, hash-routed, the
// homepage until 2026-10-17) was three tabs over one page and "people don't
// get that"; each section became a page of its own, the charts switched by
// underlined text tabs, the weekly boards gathered on a page named Charts,
// and the boost feed given its own address because readers treat it as
// their discovery feed. The route Functions (functions/podcasts, music,
// boosts.js, members.js, charts) each resolve a path to a {page, view} and
// call renderShellPage below.
//
// ⚠️ THE PAGE IS STILL A STATIC FILE, charts.html. This Function does not
// build a page; it fetches the shell through env.ASSETS, marks the route
// into it (the body's page and view attributes, the active page head and
// its underlined tab, the active panel), rewrites the title, the canonical
// and the Open Graph pair, drops the opening feed's cards into one marked
// slot where there is one, and serves the result. Everything else about
// that file (the five page heads, the panels, the inline controller, the
// nav and footer that scripts/sync-partials.js writes into it) is untouched
// and is edited there as it always was. The controller re-derives the same
// route from location when it runs, so the two cannot disagree.
//
// ⚠️ TWO FEEDS ARE RENDERED AT THE EDGE, EACH ON ITS OWN PAGE: Shows on
// /podcasts/shows and Albums on /music/albums (the same renderer, the music
// side of the medium split), both all time by Chart rank, the view their
// renderer opens on. The Episodes, Songs, Artists and Boosts panels ship
// their placeholders and hydrate in the browser as they always have. A page
// asked for with a view in its query (?range=, ?sort=, ?lang=,
// ?scope=follows) is not rendered: the cards would be the wrong list and the
// renderer would replace them under the reader.
//
// ⚠️ IT IS A FAST PATH, NOT A DEPENDENCY. Every failure in the feed render
// (the D1 query, a missing marker) serves the routed shell without cards,
// and the feed hydrates the way it did before this existed. Only the asset
// fetch itself can fail the page.
import { readParams, globalPodcasts } from "../api/v1/podcasts.js";
import { cardsFromPodcasts, renderShowCardPage, SHOW_CARDS_PER_PAGE } from "./show-cards.js";
import { COPY } from "../../assets/js/show-card.js";

const SITE = "https://onlyboosts.social";

/* ⚠️ PINNED TO THE CONTROLLER'S PAGES AND TO THE NAV'S HREFS: the first view
 * of each page is what its bare path opens on (Shows, Artists, the Podcasts
 * boards), and a page's `feed` is the feed type its views name. */
export const PAGES = {
  podcasts: { views: ["shows", "episodes"], feed: true },
  music: { views: ["artists", "albums", "songs"], feed: true },
  boosts: { views: ["members"], feed: true },
  members: { views: [], feed: false },
  charts: { views: ["podcasts", "music", "hpw"], feed: false },
};

/* The words each page wears: its <title>, canonical path and description. */
const META = {
  "podcasts/shows": { title: "Podcast Charts: Shows", path: "/podcasts/shows", desc: "Every podcast with a boost on Nostr, ranked by the OnlyBoosts Charts: all time or this week, month or year, globally or from the accounts you follow." },
  "podcasts/episodes": { title: "Podcast Charts: Episodes", path: "/podcasts/episodes", desc: "Every podcast episode with a boost on Nostr, ranked by the OnlyBoosts Charts: all time or this week, month or year, globally or from the accounts you follow." },
  "music/artists": { title: "Music Charts: Artists", path: "/music/artists", desc: "Every artist with a boost on Nostr, ranked by the OnlyBoosts Charts over their albums and songs." },
  "music/albums": { title: "Music Charts: Albums", path: "/music/albums", desc: "Every album with a boost on Nostr, ranked by the OnlyBoosts Charts: all time or this week, month or year." },
  "music/songs": { title: "Music Charts: Songs", path: "/music/songs", desc: "Every song with a boost on Nostr, ranked by the OnlyBoosts Charts: all time or this week, month or year." },
  "boosts/members": { title: "Boosts", path: "/boosts", desc: "Every Podcasting 2.0 boost published to Nostr, as it was sent, newest first: read the boostagrams globally or from who you follow, and boost back with Lightning." },
  "members/": { title: "Members", path: "/members", desc: "The members of OnlyBoosts: everyone who has boosted a podcast or musician and shared the boost with their Nostr identity, ranked, and the bots that publish boosts for apps that do not." },
  "charts/podcasts": { title: "Charts: Podcasts", path: "/charts/podcasts", desc: "This week's Top 10 podcasts by Nostr boosts, every past week, and the shows that have held #1 the longest." },
  "charts/music": { title: "Charts: Music", path: "/charts/music", desc: "This week's Top 10 artists by Nostr boosts, every past week, and the artists that have held #1 the longest." },
  "charts/hpw": { title: "Charts: #40HPW Challenge", path: "/charts/hpw", desc: "The Nostr Gang #40HPW Challenge: who has shared boosts for forty hours of podcasts this week, every past week, and Proof of #40HPW." },
};

/* The opening feed each edge-rendered panel adopts, and it must match the
 * renderer's opening state exactly: `chart` (the OnlyBoosts Charts, since
 * 2026-08-31) over `all` time, Global. A mismatch would not break anything;
 * the reader would watch the list they were given get replaced. */
const SSR = {
  "podcasts/shows": { open: "<!--OB:SSR-SHOWS-->", close: "<!--/OB:SSR-SHOWS-->", medium: "other", copy: COPY.other },
  "music/albums": { open: "<!--OB:SSR-ALBUMS-->", close: "<!--/OB:SSR-ALBUMS-->", medium: "music", copy: COPY.music },
};
const FEED = { scope: "global", sort: "chart", range: "all" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** The {page, view} a route Function resolved, or null for a path the shell
 *  does not serve. `view` undefined means the bare path: the page's first. */
export function resolveRoute(page, view) {
  const cfg = PAGES[page];
  if (!cfg) return null;
  if (view === undefined || view === "") return { page, view: cfg.views[0] || "" };
  return cfg.views.includes(view) ? { page, view } : null;
}

/* ⚠️ ASK THE ASSET SERVER FOR `/charts`, NEVER FOR `/charts.html`, AND NEVER
 * RETURN A REDIRECT FROM IT. Pages 308-redirects `/charts.html` to
 * `/charts`, which is this Function's own route: fetching the .html here
 * returns a 308, passing it back sends the browser to /charts, and /charts
 * is this Function. ERR_TOO_MANY_REDIRECTS, and it shipped once when this
 * page was `/`. The guard below is the belt to that brace. */
export async function fetchShell(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/charts", request.url), request));
  if (shell.status >= 300 && shell.status < 400) {
    console.error("[shell] asset server redirected /charts to", shell.headers.get("location"));
    return { error: new Response("The page is temporarily unavailable.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }) };
  }
  if (!shell.ok) return { error: shell };
  return { html: await shell.text() };
}

/** The shell, routed and rendered for one page. */
export async function renderShellPage(context, route) {
  const { request, env } = context;
  const got = await fetchShell(context);
  if (got.error) return got.error;
  let html = routeShell(got.html, route);

  const key = `${route.page}/${route.view}`;
  const ssr = SSR[key];
  const url = new URL(request.url);
  const hasView = ["scope", "range", "sort", "lang"].some((k) => url.searchParams.has(k));
  if (ssr && !hasView) {
    try {
      html = inject(html, ssr, await openingPage(env, ssr));
    } catch (err) {
      // The page is complete without it: the placeholder is what the reader
      // sees for the moment before the feed hydrates.
      console.warn(`[shell] ${key} opening feed not rendered`, err);
    }
  }
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Two minutes is the collector's tick (2026-09-06), honored at the
      // edge since the zone Cache Rule of 2026-09-07.
      "Cache-Control": "public, max-age=120",
    },
  });
}

/* A 404 in the shell's own chrome, for a view the page does not have
 * (/podcasts/videos): the 404 page is a static file, and a Function's own
 * miss has to answer it by hand. */
export async function notFoundPage(context) {
  const { request, env } = context;
  let body = null;
  try {
    const r = await env.ASSETS.fetch(new Request(new URL("/404", request.url), request));
    if (r.ok) body = await r.text();
  } catch { /* the plain answer below */ }
  return new Response(body || "Not found", {
    status: 404,
    headers: { "Content-Type": body ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

/* ── Marking the route into the shell ──
 * Six string operations, each against markup charts.html ships and each
 * checked, since a shell edited out from under one of them is a page that
 * contradicts itself: the controller would correct it on the first script
 * run, and a crawler would read the wrong page. */
export function routeShell(html, route) {
  const { page, view } = route;
  const cfg = PAGES[page];
  const feed = cfg.feed ? `${view}-global` : null;
  const meta = META[`${page}/${view}`] || META[`${page}/`];

  // 1. The body's route attributes, which every page-scoped CSS rule reads.
  const bodyTag = /<body data-page="[^"]*" data-view="[^"]*" data-active-feed="[^"]*">/;
  if (!bodyTag.test(html)) throw new Error("body tag not found");
  html = html.replace(bodyTag, `<body data-page="${esc(page)}" data-view="${esc(view)}"${feed ? ` data-active-feed="${esc(feed)}"` : ""}>`);

  // 2. The page head: the active one shown, its tab underlined.
  const headRe = new RegExp(`<header class="page-head" data-page-head="${page}" hidden>([\\s\\S]*?)</header>`);
  const headM = headRe.exec(html);
  if (!headM) throw new Error(`page head for ${page} not found`);
  const headBody = headM[1].replace(`data-view="${view}">`, `data-view="${view}" aria-current="page">`);
  html = html.replace(headM[0], `<header class="page-head" data-page-head="${page}">${headBody}</header>`);

  // 3. The panels: the Shows panel ships active; the route's panel takes over.
  const SHOWS_ACTIVE = '<section class="feed-panel is-active" id="panel-shows"';
  if (!html.includes(SHOWS_ACTIVE)) throw new Error("the Shows panel does not ship active");
  if (feed !== "shows-global") {
    html = html.replace(SHOWS_ACTIVE, '<section class="feed-panel" id="panel-shows"');
    html = html.replace(/(<section class="feed-panel" id="panel-shows"[^>]*?) data-scope="global">/, '$1 data-scope="global" hidden>');
    if (feed) {
      const panelRe = new RegExp(`<section class="feed-panel" (id="panel-[^"]+"[^>]*data-feed="${feed}"[^>]*?) hidden>`);
      if (!panelRe.test(html)) throw new Error(`panel for ${feed} not found`);
      html = html.replace(panelRe, '<section class="feed-panel is-active" $1>');
    }
  }

  // 4. The words: title, canonical, the Open Graph pair.
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)} — OnlyBoosts</title>`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${SITE}${meta.path}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${SITE}${meta.path}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(meta.title)} — OnlyBoosts" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(meta.desc)}" />`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(meta.desc)}" />`);
  return html;
}

/* The cards, built by the same chain the browser runs.
 *
 * ⚠️ THE ORDER IS THE SERVER'S AND IS NEVER RE-DERIVED. `/api/v1/podcasts`
 * answers already ordered by the active sort with a tiebreak that makes
 * paging a total order; `cardsFromPodcasts` is a map and preserves it.
 * competitionRanks assumes the rows it is handed are already ordered by the
 * value it ranks, and re-sorting here would drop the tiebreak. */
async function openingPage(env, ssr) {
  const u = new URL("https://ob.invalid/api/v1/podcasts");
  u.searchParams.set(ssr.medium === "music" ? "medium" : "not_medium", "music");
  u.searchParams.set("sort", FEED.sort);
  u.searchParams.set("range", FEED.range);
  u.searchParams.set("limit", String(SHOW_CARDS_PER_PAGE));
  const p = readParams(u);
  if (p.error) throw new Error(p.error);

  const { podcasts, nextOffset } = await globalPodcasts(env, p);
  if (!podcasts.length) throw new Error("no shows");
  const cards = cardsFromPodcasts(podcasts);
  if (!cards.length) throw new Error("nothing built");

  return renderShowCardPage(cards, {
    copy: ssr.copy,
    sort: FEED.sort,
    range: FEED.range,
    limit: SHOW_CARDS_PER_PAGE,
    // The state the client adopts through. `scope` and `medium` are checked
    // against the panel being hydrated, so a shell rendered for one feed can
    // never be adopted by another.
    state: { ...FEED, medium: ssr.medium, nextOffset },
  });
}

function inject(html, ssr, block) {
  const start = html.indexOf(ssr.open);
  const end = html.indexOf(ssr.close);
  // A missing or reordered marker means charts.html was edited in a way this
  // cannot follow. Serving the file untouched is the right answer, not a guess.
  if (start === -1 || end === -1 || end < start) throw new Error("marker not found");
  return html.slice(0, start) + block + html.slice(end + ssr.close.length);
}
