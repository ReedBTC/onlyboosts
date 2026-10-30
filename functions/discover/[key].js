// GET /discover/<key> — THE WHOLE LIST BEHIND A DISCOVERY RAIL.
//
// Reed's ask, 2026-10-20: the homepage's New and Noteworthy, Movers and
// Podcasters Recommend rails are ten tiles each and lived nowhere else, so a
// reader who wanted more had nowhere to click. These pages are those rails
// in full. By the standing rule (2026-10-18: the tile rail is the HOMEPAGE's
// shape; anything deeper is a list like the charts page) each is a list of
// the charts page's own show card, rendered at the edge by the same two-sided
// module the feeds use, with one extra line per card saying why it is here:
// the places climbed, the first boost's date, the podroll count.
//
// The rows are the rails' own fetchers in functions/index.js (newShowsRows,
// moversRows, podrollRows) with a bigger count, so a page can never disagree
// with the rail it expands. The shell is discover.html, filled through its
// one marker pair, the title and the canonical rewritten per key.
//
//   /discover/new-shows   first boost within 90 days, two boosters, all of them
//   /discover/movers      this week's climbers then debuts, to 100 places
//   /discover/podroll     podroll targets by how many shows list them, 100
//
// An unindexed podroll target has no page and no figures; its card carries
// no link and says so in its line. Cached 5 minutes, like the homepage.
import { newShowsRows, moversRows, podrollRows, whyNew, onN } from "../index.js";
import { cardsFromPodcasts } from "../_shared/show-cards.js";
import { COPY as SHOW_COPY, renderShowCards } from "../../assets/js/show-card.js";
import { rankLabel } from "../../assets/js/rank.js";
import { headOf, assetGet } from "../_shared/head.js";

const OPEN = "<!--OB:DISCOVER-->";
const CLOSE = "<!--/OB:DISCOVER-->";
const SITE = "https://onlyboosts.social";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* A podcasts-table row (or a weekly chart row, or a podroll target) in the
   shape toCard reads: the ranked endpoint's record. */
function record(r, { linked = true } = {}) {
  return {
    guid: linked ? r.guid : "", title: r.title, img: r.image, art2: r.artwork || null, feed: r.feed || null,
    author: r.author || null, medium: r.medium || null,
    sats: Number(r.total_sats || 0), boosters: Number(r.booster_count || 0), boosts: Number(r.boost_count || 0),
    rank: Number.isFinite(r.rank) ? r.rank : null, tied: r.tied === true,
  };
}

export const PAGES = {
  "new-shows": {
    title: "New and Noteworthy Podcasts",
    lead: "Podcasts boosted on Nostr for the first time in the last 90 days, by two or more members, and podcasts boosted again in that time after six months or more without a boost, ordered by boosters and then sats within those 90 days. A podcast with no new episode in six months is left out. The all-time charts bury a debut and a comeback; this is where they show.",
    rows: (env) => newShowsRows(env, 100, "podcast"),
    cards: (rows) => ({
      records: rows.map((r) => record(r)),
      rankOf: (s, i) => rankLabel(i + 1, false),
      noteOf: (s, i) => whyNew(rows[i]),
    }),
  },
  "new-music": {
    title: "New and Noteworthy Music",
    lead: "Albums whose first boost on Nostr landed in the last 90 days and that two or more members have boosted since, by boosters then sats. The all-time charts bury a debut; this is where one shows.",
    rows: (env) => newShowsRows(env, 100, "music"),
    cards: (rows) => ({
      records: rows.map((r) => record(r)),
      rankOf: (s, i) => rankLabel(i + 1, false),
      noteOf: (s, i) => whyNew(rows[i]),
    }),
  },
  "movers": {
    title: "Podcast Movers This Week",
    lead: "This week's Shows chart against last week's, to 100 places: the biggest climbs first, then the shows that are on the chart this week and were not last week. The rank is the show's place on this week's chart.",
    rows: (env) => moversRows(env, 100),
    cards: ({ picks, was }) => ({
      records: picks.map(({ r }) => record(r)),
      rankOf: (s, i) => rankLabel(picks[i].r.rank, !!picks[i].r.tied),
      noteOf: (s, i) => picks[i].climb != null
        ? `Up ${picks[i].climb} place${picks[i].climb === 1 ? "" : "s"} · #${was.get(picks[i].r.guid)} last week`
        : "New on the chart this week",
    }),
  },
  "podroll": {
    title: "Podcasters Recommend",
    lead: "The shows most often listed on other shows' podrolls, the one recommendation podcasters write themselves into their feeds, by how many shows list them. A show the index has no page for yet is a figure, not a link.",
    rows: (env) => podrollRows(env, 100),
    cards: (rows) => ({
      records: rows.map((r) => record(r, { linked: Number(r.linked) > 0 })),
      rankOf: (s, i) => rankLabel(i + 1, false),
      noteOf: (s, i) => onN(rows[i]) + (Number(rows[i].linked) ? "" : " · not boosted on Nostr yet"),
    }),
  },
};

export function listHtml(key, data) {
  const page = PAGES[key];
  const { records, rankOf, noteOf } = page.cards(data);
  const cards = cardsFromPodcasts(records);
  const body = cards.length
    ? `<div class="pcast-list">${renderShowCards(cards, { copy: SHOW_COPY.other, rankOf, noteOf })}</div>`
    : `<p class="search-lead">Nothing here yet.</p>`;
  return `<h1>${esc(page.title)}</h1>
    <p class="search-lead">${esc(page.lead)} <a href="/about#recommendations">How every list on the homepage is built.</a></p>
    <section class="rail search-group" id="list" aria-label="${esc(page.title)}">${body}</section>`;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const key = String(params?.key || "");
  const page = PAGES[key];
  const shell = await env.ASSETS.fetch(assetGet(request, "/discover"));
  if (shell.status >= 300 && shell.status < 400) {
    console.error("[discover] asset server redirected /discover to", shell.headers.get("location"));
    return new Response("Discover is temporarily unavailable.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (!shell.ok) return shell;
  let html = await shell.text();
  if (!page) {
    // The bare index of the three lists is the shell as shipped.
    return new Response(html, { status: key ? 404 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": key ? "no-store" : "public, max-age=300" } });
  }
  try {
    const block = listHtml(key, await page.rows(env));
    const start = html.indexOf(OPEN);
    const end = html.indexOf(CLOSE);
    if (start !== -1 && end > start) html = html.slice(0, start) + block + html.slice(end + CLOSE.length);
    html = html.replace("<title>Discover — OnlyBoosts</title>", `<title>${esc(page.title)} — OnlyBoosts</title>`)
      .replace(`<link rel="canonical" href="${SITE}/discover" />`, `<link rel="canonical" href="${SITE}/discover/${esc(key)}" />`);
  } catch (err) {
    console.warn("[discover] list not rendered", key, err);
  }
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

export const onRequestHead = headOf(onRequestGet);
