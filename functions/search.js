// GET /search?q= — THE FULL RESULTS PAGE behind the nav bar's search.
//
// Reed's call, 2026-10-17: Enter on the search field is a page of every hit,
// grouped the way the typeahead groups them (shows, episodes, artists,
// members), not a jump to the first row. Each hit is the homepage's tile,
// rendered at the edge by the same two-sided module, in a wrapping grid.
//
// ⚠️ THE PAGE IS STILL search.html. This fetches the static shell through
// env.ASSETS, fills the one marker pair, puts the query back into the nav's
// field and the <title>, and serves it. noindex: a hit has its own address.
//
// What it costs: three FTS lookups (functions/_shared/search-all.js) and one
// member search, each capped at EACH rows, cached 60s. No query runs nothing.
import { searchAll } from "./_shared/search-all.js";
import { onRequestGet as membersGet } from "./api/v1/members.js";
import { railListHtml, showTile, albumTile, episodeTile, artistTile, memberSearchTile } from "../assets/js/rail-tile.js";
import { headOf } from "./_shared/head.js";

const EACH = 50;
const MAX_Q = 120;
const OPEN = "<!--OB:SEARCH-->";
const CLOSE = "<!--/OB:SEARCH-->";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function group(id, label, tiles) {
  if (!tiles.length) return "";
  return `<section class="rail" id="${id}" aria-labelledby="rail-${id}">
    <div class="rail-head"><h2 id="rail-${id}">${esc(label)} <small>${tiles.length}</small></h2></div>
    <div class="rail-track">${railListHtml(tiles).replace('class="rail-list"', 'class="rail-list rail-list--wrap"')}</div>
  </section>`;
}

export function resultsHtml(q, { shows = [], episodes = [], artists = [], members = [] }) {
  const unranked = (fn) => (r, i) => fn({ ...r, rank: null }, i).replace(/<span class="rt-rank[^>]*>[^<]*<\/span>/, "");
  const total = shows.length + episodes.length + artists.length + members.length;
  const head = `<h1>Results for <q>${esc(q)}</q></h1>
    <p class="search-lead">${total ? `${total} hit${total === 1 ? "" : "s"} across shows, episodes, artists and members, each group by sats.` : "Nothing matched. Try fewer or different words; the search matches titles, artist names and member names."}</p>`;
  const podcasts = shows.filter((s) => (s.medium || "podcast") !== "music");
  const albums = shows.filter((s) => (s.medium || "podcast") === "music");
  return head +
    group("shows", "Shows", podcasts.map(unranked(showTile))) +
    group("albums", "Albums", albums.map(unranked(albumTile))) +
    group("episodes", "Episodes and Songs", episodes.map(unranked((r, i) => episodeTile(r, i, "🎙")))) +
    group("artists", "Artists", artists.map(unranked(artistTile))) +
    group("members", "Members", members.map((m) => memberSearchTile(m)));
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

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, MAX_Q);

  const shell = await env.ASSETS.fetch(new Request(new URL("/search", request.url), request));
  if (shell.status >= 300 && shell.status < 400) {
    console.error("[search] asset server redirected /search to", shell.headers.get("location"));
    return new Response("Search is temporarily unavailable.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (!shell.ok) return shell;
  let html = await shell.text();

  if (q.length >= 2) {
    try {
      const [all, members] = await Promise.all([searchAll(env, q, EACH), findMembers(env, request, q)]);
      const block = resultsHtml(q, { ...all, members });
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
