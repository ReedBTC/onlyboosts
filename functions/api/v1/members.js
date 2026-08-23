// GET /api/v1/members?q= — find a member by name, npub or pubkey.
//
// A MEMBER IS ANYONE WHO HAS BOOSTED AT LEAST ONE SHOW, which is the same
// qualifying rule /booster/<npub> and /api/v1/boosters/pubkeys already apply:
// the source of truth is `boosts.booster_pubkey`, never `profiles`. 61 of the
// 2,011 members have no kind-0 the collector could resolve on any relay, and
// their pages are live; deriving this set from `profiles` would report them as
// not existing.
//
// ⚠️ WHY THIS EXISTS. The Boosts feed's search box scored `scopedRows` — the
// boosts the browser happened to be holding — so a member was findable only if
// they turned up in what the reader had already scrolled past. Measured against
// the whole corpus on 2026-08-23: the first page (30 boosts) reaches 34 of
// 2,011 members (2%), 500 boosts reaches 164 (8%), and paging in ALL 23,259
// boosts still only reaches 684 (34%). A third of members have never appeared
// in the note feed at all, so loading more could never close it. The question
// "where is this person" has to be asked of the whole index, which means the
// server.
//
// It is also the lookup Chad asked for and the reason idea #2.3 is open: there
// has been no way to reach someone's page except by catching them boosting.
import { json, preflight, clampLimit, toHexPubkey, PUBLISHERS } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// Matches SEARCH_MIN_CHARS in ob-live.js. One character matches 1,150 of the
// 1,950 profiles that have a name, which is not a search result — it is the
// whole list, ordered by sats, at the cost of aggregating every one of them.
const MIN_CHARS = 2;
const MAX_Q = 128;

/* ⚠️ THREE WAYS TO BE A TOP MEMBER, AND THEY ARE DIFFERENT PEOPLE. Sats alone
 * ranks by generosity, which rewards one large boost; boosts rewards how often
 * somebody shows up; shows rewards how widely they spread it. Measured on the
 * live corpus, the top of each list barely overlaps — AdminPacman leads by sats
 * on 24 boosts, where the boost leader has 447. One ordering would present one
 * of those as "the" top member and quietly hide the other two stories.
 *
 * Every row carries ALL THREE figures whichever is asked for, so the caller can
 * label the one it ranked by without a second request. */
const SORTS = {
  sats:   "sats",
  boosts: "boosts",
  // COUNT(DISTINCT podcast_guid) ignores NULLs, which is what we want: ~2% of
  // boosts name no show, and those cannot count toward a breadth figure.
  shows:  "shows",
};
const DEFAULT_SORT = "sats";

/* ⚠️ LIKE'S OWN WILDCARDS HAVE TO BE ESCAPED OR THE READER CAN TYPE THEM. A
 * bare `%` matches everything and `_` matches any character, so a pasted string
 * containing either quietly returns the wrong people rather than nothing. The
 * ESCAPE clause is declared on every LIKE that uses this — it is not a default.
 * (This is the LIKE counterpart of ftsMatch: a raw user string is never a
 * pattern.) */
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

/* ⚠️ THE PUBLISHER LIST IS BOUND ONCE AND REFERENCED TWICE, so its placeholders
 * are NUMBERED rather than bare. The listing excludes these keys and the bots
 * mode asks for exactly them; two bare `?` runs would need eight binds of the
 * same four values, and SQLite numbers a bare `?` from the highest index used
 * *so far*, which makes the second run's numbering depend on where the first
 * one happens to sit in the statement. */
const PUB_FIRST = 6;
const PUB_HOLES = PUBLISHERS.map((_, i) => "?" + (PUB_FIRST + i)).join(",");
const PUB_FLAG = "?" + (PUB_FIRST + PUBLISHERS.length);

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const raw = (u.searchParams.get("q") || "").trim().slice(0, MAX_Q);
  const limit = clampLimit(u.searchParams.get("limit"), 8, 200);
  const askedSort = u.searchParams.get("sort");
  const sort = Object.hasOwn(SORTS, askedSort) ? askedSort : DEFAULT_SORT;

  /* ⚠️ NO QUERY IS A LIST, NOT AN ERROR. `?limit=100` with no `q` is the top
   * members by sats — what the wall on the Members tab renders — and it is the
   * same endpoint deliberately: one definition of what a member is, one place
   * the qualifying rule lives, one shape of row for the caller. A `top=1` flag
   * or a second path would be two answers to "who is a member" that could
   * disagree.
   *
   * A ONE-CHARACTER query is still refused: it matches 1,150 of the 1,950
   * named profiles, which is not a search result — it is the whole list at the
   * cost of aggregating every one of them. An EMPTY query asks for the list on
   * purpose, so it is served. */
  /* ⚠️ `publishers=1` IS A THIRD MODE AND IT IS THE EXACT COMPLEMENT OF THE
   * LISTING. The wall excludes these four keys; the Boost Bots section under it
   * asks for those four and nothing else, which is what makes the exclusion
   * visible rather than silent. It is the same endpoint for the same reason the
   * listing is: one definition of a member, one shape of row, one place the
   * aggregate is computed. A separate path would be a second answer that could
   * disagree with the first.
   *
   * It wins over an empty q, so `?publishers=1` is never also the listing. */
  const bots = u.searchParams.get("publishers") === "1";
  const listing = !bots && raw.length === 0;
  if (!bots && !listing && raw.length < MIN_CHARS) {
    return json(request, { q: raw, count: 0, members: [] });
  }

  /* Three ways to name a member, and a query can only sensibly be one of them.
   *
   * An identifier is resolved to hex where it can be, so the lookup rides
   * `idx_boosts_booster` rather than scanning: toHexPubkey takes both a full
   * npub and a bare 64-char hex string. A PARTIAL npub cannot be decoded, so it
   * falls back to a prefix LIKE over `booster_npub`, which is not indexed — a
   * scan of the boosts table, measured at ~2ms against the live corpus. Worth
   * knowing before that column grows a lot; not worth an index today. */
  const hex = (listing || bots) ? "" : (toHexPubkey(raw) || "");
  const partialNpub = !listing && !bots && !hex && /^npub1[02-9ac-hj-np-z]+$/i.test(raw)
    ? likeEscape(raw.toLowerCase()) + "%"
    : "";
  // A string that is plainly an identifier is not also a name. Searching both
  // would let a half-typed npub match somebody whose display name contains it.
  const like = (listing || bots || hex || partialNpub) ? "" : "%" + likeEscape(raw) + "%";

  /* ⚠️ CANDIDATES FIRST, AGGREGATE SECOND. The obvious shape puts the three
   * tests in one WHERE over the join, and the ORs defeat index seeking: the
   * plan comes back `SCAN b USING INDEX idx_boosts_booster`, reading all 23,259
   * boosts on every keystroke (measured 20ms, against 3-6ms for this). Here the
   * CTE resolves a small set of pubkeys and the join seeks each one.
   *
   * LIKE is case-insensitive for ASCII in SQLite and NOT for anything else, so
   * "piez" finds Piez and a query differing from a name only by the case of a
   * non-ASCII letter will not. Nothing cheap fixes that; a NOCASE collation is
   * ASCII-only too. */
  const sql = `
    WITH hits(pk) AS (
      SELECT pubkey FROM profiles
       WHERE ?1 <> '' AND (display_name LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\')
      UNION
      SELECT booster_pubkey FROM boosts
       WHERE ?2 <> '' AND booster_pubkey = ?2
      UNION
      SELECT booster_pubkey FROM boosts
       WHERE ?3 <> '' AND booster_npub LIKE ?3 ESCAPE '\\'
      UNION
      /* The listing: every member. Guarded by ?5 so a SEARCH never falls into
         it, which would return the whole membership for a query that missed.

         ⚠️ THE LISTING EXCLUDES PUBLISHER KEYS AND THE SEARCH DOES NOT, which is
         the one asymmetry in this file and it is deliberate. A key that signs
         boosts for dozens of donors is not a top MEMBER — chadf_boostbot led
         both the boosts and the shows orderings on the live index, on other
         people's listening, which is the same category error the 40 HPW boards
         exclude it for. But it is a real account somebody may want to look up,
         so typing its name still finds it. Ranked lists are a claim; a search
         result is not. */
      SELECT booster_pubkey FROM boosts
       WHERE ?5 = 1 AND booster_pubkey NOT IN (${PUB_HOLES})
      UNION
      /* The bots mode: exactly the keys the branch above removes. Guarded by its
         own flag, so it can never widen a search or a listing. */
      SELECT booster_pubkey FROM boosts
       WHERE ${PUB_FLAG} = 1 AND booster_pubkey IN (${PUB_HOLES})
    )
    SELECT b.booster_pubkey AS pk,
           MAX(b.booster_npub) AS npub,
           COUNT(*)                          AS boosts,
           COALESCE(SUM(b.sats), 0)          AS sats,
           COUNT(DISTINCT b.podcast_guid)    AS shows,
           MAX(p.name)         AS name,
           MAX(p.display_name) AS dname,
           MAX(p.picture)      AS pic
      FROM hits h
      JOIN boosts b ON b.booster_pubkey = h.pk
      LEFT JOIN profiles p ON p.pubkey = h.pk
     GROUP BY b.booster_pubkey
     /* The two trailing keys are a tiebreak, never a ranking: sats settles a
        tie on boosts or shows, and the pubkey settles a tie on sats so paging
        is a total order. */
     ORDER BY ${SORTS[sort]} DESC, sats DESC, pk
     LIMIT ?4`;

  try {
    const { results } = await env.DB.prepare(sql)
      .bind(like, hex, partialNpub, limit, listing ? 1 : 0, ...PUBLISHERS, bots ? 1 : 0).all();
    return json(request, {
      q: raw,
      listing,
      publishers: bots,
      sort,
      count: results.length,
      members: results.map((r) => ({
        pk: r.pk,
        npub: r.npub || null,
        // display_name in preference to name, the same order the detail pages
        // print. Either may be absent; the client falls back to the npub.
        name: r.dname || r.name || null,
        pic: r.pic || null,
        boosts: r.boosts,
        sats: r.sats,
        shows: r.shows,
      })),
    });
  } catch (err) {
    console.error("[members] query failed", err);
    return json(request, { error: "query failed" }, { status: 500, cache: 0 });
  }
}
