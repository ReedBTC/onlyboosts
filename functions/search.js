// GET /search?q= — THE FULL RESULTS PAGE behind the nav bar's search.
//
// Reed's call, 2026-10-17: Enter on the search field is a page of every hit,
// not a jump to the first row. And on 2026-10-18: A LIST, LIKE THE CHARTS
// PAGE, not rails of tiles. The sideways tile rail is the homepage's shape;
// anything deeper (a search, the full charts, research) is a list. So every
// hit here is the charts page's own card, rendered at the edge by the same
// two-sided module the feed renders it with in the browser:
//
//   shows and albums      show-card.js, through the podcasts endpoint's q= path
//   episodes and songs    episode-card.js, through the episodes endpoint's q=
//                         path with its boost notes (the homepage's lazy
//                         drawer variant)
//   artists               publisher-card.js, through the publishers endpoint
//   members               supporter-wall.js, the Members tab's own wall, from
//                         /api/v1/members?q=
//
// ⚠️ A HIT CARRIES ITS CHART RANK. The three ranked endpoints' q= paths
// answer each row's position in the UNFILTERED all-time chart (RANK() over
// the whole corpus, never ROW_NUMBER() over the hits; see docs/feeds.md),
// so a card here shows the same number it shows on the charts page. The
// members wall prints no rank anywhere, and does not start here.
//
// ⚠️ THE PAGE IS STILL search.html. This fetches the static shell through
// env.ASSETS, fills the one marker pair, puts the query back into the nav's
// field and the <title>, and serves it. noindex: a hit has its own address.
// assets/js/search-page.js attaches the cards' verbs (drawers, boost pills,
// the wall's show-more), the same modules the charts page uses.
//
// What it costs: five ranked queries (each the endpoint's own q= path, each
// capped at EACH rows) and one member search, cached 60s. No query runs
// nothing.
import { readParams as podcastParams, globalPodcasts } from "./api/v1/podcasts.js";
import { readParams as episodeParams, globalEpisodes } from "./api/v1/episodes.js";
import { readParams as publisherParams, globalPublishers } from "./api/v1/publishers.js";
import { onRequestGet as membersGet } from "./api/v1/members.js";
import { cardsFromPodcasts } from "./_shared/show-cards.js";
import { itemsFromBoosts } from "./_shared/episode-cards.js";
import { COPY as SHOW_COPY, renderShowCards } from "../assets/js/show-card.js";
import { COPY as EPISODE_COPY, renderEpisodeCards, HOME_CARD_PARTS } from "../assets/js/episode-card.js";
import { COPY as PUBLISHER_COPY, toCard as toPublisherCard, publisherCardHtml } from "../assets/js/publisher-card.js";
import { renderSupporters } from "../assets/js/supporter-wall.js";
import { episodeApiToBoosts } from "../assets/js/ob-data.js";
import { rankLabel } from "../assets/js/rank.js";
import { headOf, assetGet } from "./_shared/head.js";

export const EACH = 50;
const MAX_Q = 120;
const OPEN = "<!--OB:SEARCH-->";
const CLOSE = "<!--/OB:SEARCH-->";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* The rank label a hit wears: the server's standing on the unfiltered chart,
   with its corpus-true tie flag. A row with no rank (the endpoint could not
   place it) wears none rather than a made-up one. */
const labelOf = (r) => (Number.isFinite(r?.rank) ? rankLabel(r.rank, r.tied === true) : null);

/* One group: the charts page's list box under a rail heading. `href` is the
   charts view the group's cards come from, so a reader can step from the hits
   to the whole chart. */
function group(id, label, href, count, body) {
  if (!count) return "";
  return `<section class="rail search-group" id="${id}" aria-labelledby="rail-${id}">
    <div class="rail-head"><h2 id="rail-${id}"><a href="${esc(href)}">${esc(label)}</a> <small>${count}</small></h2><a class="rail-more" href="${esc(href)}">The whole chart →</a></div>
    <div class="pcast-list">${body}</div>
  </section>`;
}

/* /api/v1/episodes records (with include=boosts) → ranked card items, the
   chain the old homepage ran: the endpoint's grouped shape back to flat boost
   records, then the same build the browser does, then the endpoint's order
   restored (buildEpisodes sorts by recency on its way through). */
function episodeItems(records) {
  const { boosts, totals } = episodeApiToBoosts(records);
  const built = itemsFromBoosts(boosts, { sort: "chart" });
  const byGuid = new Map(built.items.map((it) => [it.guid, it]));
  const items = [];
  const ranks = new Map();
  for (const r of records) {
    const it = byGuid.get(r.guid);
    if (!it) continue;
    it.totals = totals.get(r.guid) || null;
    ranks.set(r.guid, labelOf(r));
    items.push(it);
  }
  return { items, profiles: built.profiles, rankOf: (it) => ranks.get(it.guid) ?? null };
}

function episodeGroup(id, label, href, records, copy) {
  const { items, profiles, rankOf } = episodeItems(records);
  return group(id, label, href, items.length, renderEpisodeCards(items, { copy, profiles, parts: HOME_CARD_PARTS, rankOf }));
}

function showGroup(id, label, href, records, copy) {
  const cards = cardsFromPodcasts(records);
  return group(id, label, href, cards.length, renderShowCards(cards, { copy, rankOf: (s) => labelOf(s) }));
}

/* The Members tab's wall, in the shape renderSupporters reads (D1 column
   names, the adapter members-board.js#wallRows keeps for the same reason). */
function wallRows(members) {
  return members.map((m) => ({
    booster_pubkey: m.pk, booster_npub: m.npub, display_name: m.name, name: null,
    picture: m.pic, sats: m.sats, boosts: m.boosts, shows: m.shows,
  }));
}

/**
 * The whole results block. Every argument is the records its endpoint
 * answers (`shows`/`albums` from /api/v1/podcasts?q=, `episodes`/`songs` from
 * /api/v1/episodes?q=&include=boosts, `artists` from /api/v1/publishers?q=,
 * `members` from /api/v1/members?q=).
 */
/* A pasted key (an npub, a `nostr:npub…`, a 64-hex pubkey) is a member
   lookup, not a search (Reed's ask, 2026-10-22): the FTS tables cannot
   match one, so only the member endpoint is asked, and a miss says what it
   means rather than "Nothing matched". Mirrors pubkeyQuery in nav-search.js. */
const NPUB = /^npub1[02-9ac-hj-np-z]{58}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;
export function pubkeyQuery(q) {
  const s = String(q || "").trim().replace(/^nostr:/i, "");
  return NPUB.test(s) || HEX64.test(s) ? s : null;
}

export function resultsHtml(q, { shows = [], albums = [], episodes = [], songs = [], artists = [], members = [] }) {
  const key = pubkeyQuery(q);
  if (key) {
    const short = key.length > 20 ? key.slice(0, 12) + "…" + key.slice(-6) : key;
    const lead = members.length
      ? `This account is in the index. A member here is any account with at least one boost published to Nostr; the page linked below carries every boost indexed under it.`
      : `<strong>${esc(short)}</strong> is not in the index: no boost published to Nostr under this account has been indexed yet. A member here is any account with at least one indexed boost, so the account may exist on Nostr and still have no page.`;
    return `<h1>Results for <q>${esc(short)}</q></h1><p class="search-lead">${lead}</p>` +
      (members.length ? renderSupporters(wallRows(members), {
        heading: "Members", id: "members", sectionClass: "rail search-group search-wall", metric: "sats",
        sub: "The account the key names.",
      }) : "");
  }
  const groups = [
    showGroup("shows", "Shows", "/podcasts/shows", shows, SHOW_COPY.other),
    showGroup("albums", "Albums", "/music/albums", albums, SHOW_COPY.music),
    episodeGroup("episodes", "Episodes", "/podcasts/episodes", episodes, EPISODE_COPY.other),
    episodeGroup("songs", "Songs", "/music/songs", songs, EPISODE_COPY.music),
    group("artists", "Artists", "/music/artists", artists.length,
      artists.map(toPublisherCard).map((p) => publisherCardHtml(p, { rank: labelOf(p), copy: PUBLISHER_COPY })).join("")),
    members.length
      ? renderSupporters(wallRows(members), {
          heading: "Members", id: "members", sectionClass: "rail search-group search-wall", metric: "sats",
          sub: `${members.length} member${members.length === 1 ? "" : "s"} whose name matched, by sats.`,
        })
      : "",
  ];
  const total = shows.length + albums.length + episodes.length + songs.length + artists.length + members.length;
  const head = `<h1>Results for <q>${esc(q)}</q></h1>
    <p class="search-lead">${total
      ? `${total} hit${total === 1 ? "" : "s"}. Each card carries the <a href="/about#charts">OnlyBoosts Charts</a> rank it holds among every show, album, episode, song or artist in the index, all time, so a hit here reads exactly as it does on the charts page.`
      : "Nothing matched. Try fewer or different words; the search matches titles, artist names and member names."}</p>`;
  return head + groups.join("");
}

async function findMembers(env, request, q) {
  try {
    const u = new URL("/api/v1/members", request.url);
    u.searchParams.set("q", q);
    u.searchParams.set("limit", String(EACH));
    const r = await membersGet({ request: new Request(u, { headers: request.headers }), env });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.members) ? j.members : [];
  } catch (e) {
    console.warn("[search] members", e?.message);
    return [];
  }
}

/* The three ranked endpoints' own q= paths, in process: the same params the
   charts page's feeds send (chart rank, all time), so a hit's figures and
   standing are the feed's. Each group fails alone to an empty list. */
const quiet = (what, p) => p.catch((e) => { console.warn(`[search] ${what}`, e?.message); return []; });

function podcastsQ(env, q, side) {
  const u = new URL(`https://ob.invalid/api/v1/podcasts?${side}&sort=chart&range=all&limit=${EACH}`);
  u.searchParams.set("q", q);
  const p = podcastParams(u);
  if (p.error) return Promise.resolve([]);
  return globalPodcasts(env, p).then((r) => r.podcasts || []);
}
function episodesQ(env, q, side) {
  const u = new URL(`https://ob.invalid/api/v1/episodes?${side}&sort=chart&range=all&include=boosts&limit=${EACH}`);
  u.searchParams.set("q", q);
  const p = episodeParams(u);
  if (p.error) return Promise.resolve([]);
  return globalEpisodes(env, p).then((r) => r.episodes || []);
}
function publishersQ(env, q) {
  const u = new URL(`https://ob.invalid/api/v1/publishers?sort=chart&range=all&limit=${EACH}`);
  u.searchParams.set("q", q);
  const p = publisherParams(u);
  if (p.error) return Promise.resolve([]);
  return globalPublishers(env, p).then((r) => r.publishers || []);
}

export async function searchEverything(env, request, q) {
  const key = pubkeyQuery(q);
  if (key) return { shows: [], albums: [], episodes: [], songs: [], artists: [], members: await findMembers(env, request, key) };
  const [shows, albums, episodes, songs, artists, members] = await Promise.all([
    quiet("shows", podcastsQ(env, q, "not_medium=music")),
    quiet("albums", podcastsQ(env, q, "medium=music")),
    quiet("episodes", episodesQ(env, q, "not_medium=music")),
    quiet("songs", episodesQ(env, q, "medium=music")),
    quiet("artists", publishersQ(env, q)),
    findMembers(env, request, q),
  ]);
  return { shows, albums, episodes, songs, artists, members };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, MAX_Q);

  const shell = await env.ASSETS.fetch(assetGet(request, "/search"));
  if (shell.status >= 300 && shell.status < 400) {
    console.error("[search] asset server redirected /search to", shell.headers.get("location"));
    return new Response("Search is temporarily unavailable.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (!shell.ok) return shell;
  let html = await shell.text();

  if (q.length >= 2) {
    try {
      const block = resultsHtml(q, await searchEverything(env, request, q));
      const start = html.indexOf(OPEN);
      const end = html.indexOf(CLOSE);
      if (start !== -1 && end > start) html = html.slice(0, start) + block + html.slice(end + CLOSE.length);
      html = html.replace("<title>Search — OnlyBoosts</title>", `<title>${esc(q)} — Search — OnlyBoosts</title>`);
      // The query back in the field, so the page reads as the search it is.
      html = html.replace('id="nav-search-q" type="search" name="q"', `id="nav-search-q" type="search" name="q" value="${esc(q)}"`);
    } catch (err) {
      console.warn("[search] results not rendered", err);
    }
  }

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": q ? "public, max-age=60" : "public, max-age=300" },
  });
}

export const onRequestHead = headOf(onRequestGet);
