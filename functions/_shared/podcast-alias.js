// A retired podcast guid, and where its page went.
//
// ⚠️ WHY THIS EXISTS. A show that moves feeds can declare a new podcast:guid.
// When Reed merges the old guid into the new one (Pete Quiñones, Abel James
// (Video), Bitcoin Magazine Podcast and Radio Detox, 2026-11-27), the collector
// remaps the boosts, the old guid's `podcasts` row leaves D1 through the orphan
// path, and every link already shared as /show/<old> would 404. The collector
// publishes `podcast_aliases(from_guid PRIMARY KEY, to_guid)`, every alias it
// holds (about 1,000 rows, mostly phantom guids such as numeric feed ids and
// `<uuid>-<n>`), with `to_guid` already flattened to the effective guid. It
// replaces the table whole whenever the alias set changes.
//
// ⚠️ READ ON A MISS ONLY. A normal page view never reaches this; the caller
// asks `podcasts` first and comes here only when that answered nothing. One
// lookup by primary key, so a 404 costs one indexed read more than it did.
//
// The JOIN is what makes the answer a redirect rather than a guess, the same
// rule noEpisodePage() in functions/episode/[guid].js applies: the target must
// have a `podcasts` row, so a stale alias can never send the reader on to a
// second 404. `title` comes back so the page, whose qualifying rule is a
// title, can hold the target to that rule too; the API needs only the row.
//
// A failed lookup, including the table not existing yet, is no alias. The
// caller answers its ordinary 404, which is what it answered before this file.
export async function podcastAlias(env, guid) {
  if (!guid) return null;
  let row = null;
  try {
    row = await env.DB.prepare(
      `SELECT a.to_guid AS guid, p.title AS title
       FROM podcast_aliases a
       JOIN podcasts p ON p.podcast_guid = a.to_guid
       WHERE a.from_guid = ?`
    ).bind(guid).first();
  } catch (err) {
    if (!/no such table/i.test(String(err?.message || err))) {
      console.warn("[podcast-alias] lookup failed", err);
    }
    return null;
  }
  // A self-alias would be a redirect loop; the collector should never write
  // one, and this is the cheap guarantee that a bad row cannot cause one.
  if (!row?.guid || row.guid === guid) return null;
  return { guid: row.guid, title: row.title || null };
}

// ⚠️ 301, BUT NOT CACHED FOREVER. The move is permanent and a crawler or an
// unfurler should carry the old URL's standing to the new one, which is what
// 301 says. A browser, however, caches a 301 with no freshness indefinitely,
// and an alias's direction is a decision (Radio Detox folds the NEW guid into
// the old): reversing one would leave a returning reader's browser bouncing
// between two cached redirects. The zone's Cache Rule honors this header at
// the edge as well (2026-09-07), so it bounds both copies. An hour costs
// nothing: traffic on a retired link is small, and every hop still answers in
// one indexed read.
export const ALIAS_REDIRECT_CACHE = "public, max-age=3600";
