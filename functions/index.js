// GET / — the homepage, with its opening feed rendered at the edge.
//
// ⚠️ THE PAGE IS STILL index.html. This Function does not build a homepage; it
// fetches the static file through env.ASSETS, drops thirty ranked episode cards
// into one marked slot inside it, and serves the result. Everything else about
// that file — the feed bar, the eight panels, the inline controller, the nav and
// footer that scripts/sync-partials.js writes into it — is untouched and is
// edited there as it always was.
//
// WHY IT EXISTS. The front door was a shell: every panel shipped a placeholder
// and the Episodes · Global feed painted itself after JavaScript loaded and a
// 431KB request came back. Under the rendering rule in CLAUDE.md that is the
// wrong side of the line — a ranked list of episodes with their boosts is as
// much a FACT as a show page's hero — and it cost the site its most-linked URL
// in search, since Googlebot runs JavaScript on a delayed second pass and not
// dependably per page. It also cost a round trip and a repaint for every reader.
//
// ⚠️ IT IS A FAST PATH, NOT A DEPENDENCY. Every failure — the asset fetch, the
// D1 query, a missing marker — serves the file exactly as it is on disk, and the
// feed hydrates the way it did before this existed. There is no error state and
// no placeholder, because the page already has one.
//
// WHAT IT COSTS. One D1 read of the same query /api/v1/episodes answers, and the
// response is edge-cached for 300s like the detail pages, so it is one query per
// colo per five minutes rather than one per visitor. The bytes are not new: the
// cards are the same rows the browser used to fetch as JSON, and it no longer
// does — measured at 431KB raw / 155KB gzipped for this page of thirty.
import { readParams, globalEpisodes } from "./api/v1/episodes.js";
import { itemsFromBoosts, renderCardPage, CARDS_PER_PAGE } from "./_shared/episode-cards.js";
import { COPY } from "../assets/js/episode-card.js";
import { episodeApiToBoosts } from "../assets/js/ob-data.js";

// The slot in index.html. A marker PAIR, not a single point: the block it wraps
// is the placeholder the page shows when this does nothing, and that has to go
// when the cards arrive.
const OPEN = "<!--OB:SSR-EPISODES-->";
const CLOSE = "<!--/OB:SSR-EPISODES-->";

/* The opening feed, and it must match feeds-podcasts.js's opening state exactly.
 *
 * `boosts` because raw boost volume is the ranking the feed is FOR, `all`
 * because that is the useful opening window on a corpus this size, and
 * not_medium=music because Episodes and Songs are a PARTITION — music goes to
 * Songs, and everything else, including video and the feeds Podcast Index cannot
 * identify, comes here. A mismatch would not break anything; it would just make
 * the reader watch the list they were given get replaced by a different one.
 */
const FEED = {
  scope: "global",
  medium: "other",
  sort: "boosts",
  range: "all",
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  // A non-200 here means the deploy is broken in a way this cannot improve.
  if (!shell.ok) return shell;

  let html = await shell.text();
  try {
    html = injectFeed(html, await openingPage(env));
  } catch (err) {
    // The page is complete without it. Logged rather than surfaced, because the
    // reader's experience is exactly what it was before this Function existed.
    console.warn("[home] opening feed not rendered", err);
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Matches the two detail pages. The collector runs a five-minute cycle, so
      // anything tighter buys nothing but origin load.
      "Cache-Control": "public, max-age=300",
    },
  });
}

/* The cards, built by the same chain the browser runs.
 *
 * ⚠️ THE ORDER COMES FROM THE SERVER AND MUST SURVIVE buildEpisodes, which ends
 * with a sort by recency — the same trap loadEpisodePage documents in
 * feeds-podcasts.js. itemsFromBoosts re-sorts by the feed's key afterwards,
 * which restores it: `boosts` is the endpoint's ranking and the comparator's,
 * and the tiebreakers agree (total sats, then latest). A future sort key that
 * exists in SQL and not in EPISODE_SORTERS would silently reorder the page, so
 * the two tables move together.
 *
 * The figures are stamped from the aggregates rather than counted off the
 * inlined rows, because the endpoint caps notes at 50 an episode while reporting
 * true all-time totals.
 */
async function openingPage(env) {
  const u = new URL("https://ob.invalid/api/v1/episodes");
  u.searchParams.set("not_medium", "music");
  u.searchParams.set("include", "boosts");
  u.searchParams.set("sort", FEED.sort);
  u.searchParams.set("range", FEED.range);
  u.searchParams.set("limit", String(CARDS_PER_PAGE));
  const p = readParams(u);
  if (p.error) throw new Error(p.error);

  const { episodes, nextOffset } = await globalEpisodes(env, p);
  if (!episodes.length) throw new Error("no episodes");

  const { items, profiles, totals } = fromRecords(episodes);
  if (!items.length) throw new Error("nothing built");

  return `<div class="pcast-list">${renderCardPage(items, {
    copy: COPY.other,
    profiles,
    sort: FEED.sort,
    range: FEED.range,
    limit: CARDS_PER_PAGE,
    // The state the client adopts through. `scope` and `medium` are checked
    // against the panel being hydrated, so a shell rendered for one feed can
    // never be adopted by another.
    state: { ...FEED, nextOffset },
  })}</div>`;
}

/* API records → items, with the aggregates put back on.
 *
 * episodeApiToBoosts is imported through ob-data.js rather than reimplemented:
 * it is the function that turns the endpoint's grouped shape back into flat
 * boost records with their podcast and episode blocks, which is what lets one
 * model reach every consumer. This is the same three lines feeds-podcasts.js
 * runs.
 */
function fromRecords(records) {
  const { boosts, totals } = episodeApiToBoosts(records);
  const { items, profiles } = itemsFromBoosts(boosts, { sort: FEED.sort });
  for (const it of items) it.totals = totals.get(it.guid) || null;
  return { items, profiles, totals };
}

function injectFeed(html, block) {
  const start = html.indexOf(OPEN);
  const end = html.indexOf(CLOSE);
  // A missing or reordered marker means index.html was edited in a way this
  // cannot follow. Serving the file untouched is the right answer, not a guess.
  if (start === -1 || end === -1 || end < start) throw new Error("marker not found");
  return html.slice(0, start) + block + html.slice(end + CLOSE.length);
}
