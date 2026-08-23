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
import { json, preflight, clampLimit, toHexPubkey } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

// Matches SEARCH_MIN_CHARS in ob-live.js. One character matches 1,150 of the
// 1,950 profiles that have a name, which is not a search result — it is the
// whole list, ordered by sats, at the cost of aggregating every one of them.
const MIN_CHARS = 2;
const MAX_Q = 128;

/* ⚠️ LIKE'S OWN WILDCARDS HAVE TO BE ESCAPED OR THE READER CAN TYPE THEM. A
 * bare `%` matches everything and `_` matches any character, so a pasted string
 * containing either quietly returns the wrong people rather than nothing. The
 * ESCAPE clause is declared on every LIKE that uses this — it is not a default.
 * (This is the LIKE counterpart of ftsMatch: a raw user string is never a
 * pattern.) */
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const raw = (u.searchParams.get("q") || "").trim().slice(0, MAX_Q);
  const limit = clampLimit(u.searchParams.get("limit"), 8, 50);

  if (raw.length < MIN_CHARS) {
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
  const hex = toHexPubkey(raw) || "";
  const partialNpub = !hex && /^npub1[02-9ac-hj-np-z]+$/i.test(raw)
    ? likeEscape(raw.toLowerCase()) + "%"
    : "";
  // A string that is plainly an identifier is not also a name. Searching both
  // would let a half-typed npub match somebody whose display name contains it.
  const like = (hex || partialNpub) ? "" : "%" + likeEscape(raw) + "%";

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
    )
    SELECT b.booster_pubkey AS pk,
           MAX(b.booster_npub) AS npub,
           COUNT(*)            AS boosts,
           COALESCE(SUM(b.sats), 0) AS sats,
           MAX(p.name)         AS name,
           MAX(p.display_name) AS dname,
           MAX(p.picture)      AS pic
      FROM hits h
      JOIN boosts b ON b.booster_pubkey = h.pk
      LEFT JOIN profiles p ON p.pubkey = h.pk
     GROUP BY b.booster_pubkey
     ORDER BY sats DESC, boosts DESC, pk
     LIMIT ?4`;

  try {
    const { results } = await env.DB.prepare(sql)
      .bind(like, hex, partialNpub, limit).all();
    return json(request, {
      q: raw,
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
      })),
    });
  } catch (err) {
    console.error("[members] query failed", err);
    return json(request, { error: "query failed" }, { status: 500, cache: 0 });
  }
}
