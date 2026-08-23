// GET / — the homepage, with its opening feed rendered at the edge.
//
// ⚠️ THE PAGE IS STILL index.html. This Function does not build a homepage; it
// fetches the static file through env.ASSETS, drops the opening feed's cards
// into one marked slot inside it, and serves the result. Everything else about
// that file — the tabs, the eight panels, the inline controller, the nav and
// footer that scripts/sync-partials.js writes into it — is untouched and is
// edited there as it always was.
//
// ⚠️ THE OPENING FEED IS SHOWS, NOT EPISODES, SINCE PHASE D (2026-08-23). The
// front door lands on the show-level leaderboard — all time, ranked by distinct
// boosters — because that is the view that answers "what is this site" to
// somebody who has never seen it. Reed's call. What moved with it is this
// Function: the marker pair is inside the Shows panel now, the cards come from
// /api/v1/podcasts, and shows-feed.js adopts them the way feeds-podcasts.js
// adopted the episode page before it.
//
// ⚠️ ONE FEED IS RENDERED, AND IT IS THE ONE ON SCREEN. Rendering Episodes as
// well would put a second thirty-card list in the document inside a hidden
// panel — bytes every reader downloads, a feed no reader is looking at, and a
// crawler shown two rankings on one URL. So the Episodes panel ships its
// placeholder again and feeds-podcasts.js fetches its first page, exactly as
// Songs and both Follows feeds always have.
//
// WHY IT EXISTS. The front door was a shell: every panel shipped a placeholder
// and the opening feed painted itself after JavaScript loaded and a large JSON
// request came back. Under the rendering rule in CLAUDE.md that is the wrong
// side of the line — a ranked list of shows with their boost figures is as much
// a FACT as a show page's hero — and it cost the site its most-linked URL in
// search, since Googlebot runs JavaScript on a delayed second pass and not
// dependably per page. It also cost a round trip and a repaint for every reader.
//
// ⚠️ IT IS A FAST PATH, NOT A DEPENDENCY. Every failure — the asset fetch, the
// D1 query, a missing marker — serves the file exactly as it is on disk, and the
// feed hydrates the way it did before this existed. There is no error state and
// no placeholder, because the page already has one.
//
// WHAT IT COSTS. One D1 read of the same query /api/v1/podcasts answers, and the
// response is edge-cached for 300s like the detail pages, so it is one query per
// colo per five minutes rather than one per visitor. On the All range that query
// reads the precomputed aggregate columns rather than grouping the boosts table,
// which is the cheapest page this site renders.
import { readParams, globalPodcasts } from "./api/v1/podcasts.js";
import { cardsFromPodcasts, renderShowCardPage, SHOW_CARDS_PER_PAGE } from "./_shared/show-cards.js";
import { COPY } from "../assets/js/show-card.js";

// The slot in index.html. A marker PAIR, not a single point: the block it wraps
// is the placeholder the page shows when this does nothing, and that has to go
// when the cards arrive.
const OPEN = "<!--OB:SSR-SHOWS-->";
const CLOSE = "<!--/OB:SSR-SHOWS-->";

/* The opening feed, and it must match shows-feed.js's opening state exactly.
 *
 * `boosters` (Most boosters) because distinct people is the higher-signal
 * ranking: one listener boosting a show forty times is one vote, not forty. It
 * opened on `boosts` (raw volume) until Phase D. `all` because a show-level
 * leaderboard is an all-time question and the windowed ranges narrow it. And
 * not_medium=music because Shows and Albums are a PARTITION — music goes to
 * Albums, and everything else, including video and the feeds Podcast Index
 * cannot identify, comes here. A mismatch would not break anything; it would
 * just make the reader watch the list they were given get replaced by a
 * different one.
 */
const FEED = {
  scope: "global",
  medium: "other",
  sort: "boosters",
  range: "all",
};

/* ⚠️ ASK THE ASSET SERVER FOR `/`, NEVER FOR `/index.html`, AND NEVER RETURN A
 * REDIRECT FROM IT. This is the shape of an infinite loop and it shipped once.
 *
 * Pages 308-redirects `/index.html` to `/` — that is the same rule that makes
 * `/about.html` redirect to `/about`, and it is documented in CLAUDE.md under
 * the conventions. So fetching `/index.html` here returns a 308 rather than a
 * document; `!shell.ok` was true; the 308 was passed straight back to the
 * browser; the browser followed it to `/`; and `/` is this Function.
 * ERR_TOO_MANY_REDIRECTS on every request to the site's front door.
 *
 * `/` is the correct address for the same file — `env.ASSETS.fetch` resolves it
 * to index.html with a 200 and bypasses Functions routing, so there is no
 * recursion. The guard below is the belt to that brace: whatever the asset
 * server ever answers, a 3xx must not leave this handler, because every
 * redirect it could plausibly emit points back here.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));

  if (shell.status >= 300 && shell.status < 400) {
    // Unreachable in a working deploy, and a loop if it ever happens. Report the
    // one thing that is true rather than sending the reader in a circle.
    console.error("[home] asset server redirected / to", shell.headers.get("location"));
    return new Response("The homepage is temporarily unavailable.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  // Any other non-200 means the deploy is broken in a way this cannot improve.
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
 * ⚠️ THE ORDER IS THE SERVER'S AND IS NEVER RE-DERIVED. `/api/v1/podcasts`
 * answers already ordered by the active sort, with a tiebreak that makes paging
 * a total order; `cardsFromPodcasts` is a map and preserves it. That matters
 * twice over — competitionRanks assumes the rows it is handed are already
 * ordered by the value it ranks, and re-sorting here by the same key would drop
 * the tiebreak and could reorder a run of tied shows against the ranking D1
 * actually answered. The episode page had to restore this order by hand after
 * buildEpisodes' recency sort; the show card has no such step to undo.
 */
async function openingPage(env) {
  const u = new URL("https://ob.invalid/api/v1/podcasts");
  u.searchParams.set("not_medium", "music");
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
    copy: COPY.other,
    sort: FEED.sort,
    range: FEED.range,
    limit: SHOW_CARDS_PER_PAGE,
    // The state the client adopts through. `scope` and `medium` are checked
    // against the panel being hydrated, so a shell rendered for one feed can
    // never be adopted by another.
    state: { ...FEED, nextOffset },
  });
}

function injectFeed(html, block) {
  const start = html.indexOf(OPEN);
  const end = html.indexOf(CLOSE);
  // A missing or reordered marker means index.html was edited in a way this
  // cannot follow. Serving the file untouched is the right answer, not a guess.
  if (start === -1 || end === -1 || end < start) throw new Error("marker not found");
  return html.slice(0, start) + block + html.slice(end + CLOSE.length);
}
