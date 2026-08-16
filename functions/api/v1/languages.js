// GET /api/v1/languages — which languages are actually in the index, and how big
// each one is. The facet behind any language control.
//
// WHY THIS EXISTS RATHER THAN A CONSTANT IN THE CLIENT. The set of languages here
// is a property of who has been boosted, not of the software: it grows the first
// time anyone boosts a Korean show, and a hardcoded list would then be silently
// wrong in the direction nobody checks — an option that exists in the data and
// not in the menu is unreachable, and one in the menu but not the data is a
// filter that always answers empty. So the menu is built from this.
//
// ⚠️ THE `unknown` ROW IS NOT A ROUNDING ERROR AND MUST BE SHOWN. It is 594 of
// 1,294 shows, because 52% of music feeds declare no <language> at all (Wavlake
// hosts most of the music corpus and emits none) against 1% of podcasts. A menu
// built from this that silently drops the row turns "filter by language" into
// "hide half the Albums feed", and the shows it hides are hidden under a claim
// their publishers never made. Its guid is the literal string `unknown`, which is
// what /api/v1/podcasts?lang= and /api/v1/episodes?lang= accept for it.
//
// Counts respect `medium` / `not_medium` so a control sitting on the Albums feed
// can be built from the albums it will actually filter — on the music side `de`
// is 1 show where on the podcast side it is 40, and a shared menu would offer a
// language that matches nothing on the feed the reader is looking at.
import { json, preflight } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

const MEDIA = new Set(["podcast", "music", "video"]);

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const medium = u.searchParams.get("medium");
  const notMedium = u.searchParams.get("not_medium");
  if (medium && !MEDIA.has(medium)) {
    return json(request, { error: "bad medium (podcast|music|video)" }, { status: 400 });
  }
  if (notMedium && !MEDIA.has(notMedium)) {
    return json(request, { error: "bad not_medium (podcast|music|video)" }, { status: 400 });
  }

  const where = [];
  const args = [];
  if (medium) { where.push("COALESCE(medium,'podcast') = ?"); args.push(medium); }
  if (notMedium) { where.push("COALESCE(medium,'podcast') <> ?"); args.push(notMedium); }

  // Ordered by shows rather than boosts so the menu is stable: boost counts move
  // hourly and would reshuffle a dropdown under the reader between two loads.
  // `unknown` sorts with the rest instead of being pinned — it is genuinely one
  // of the largest buckets, and where it lands is information.
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(language,'unknown')  AS lang,
            COUNT(*)                      AS shows,
            COALESCE(SUM(boost_count),0)  AS boosts,
            COALESCE(SUM(total_sats),0)   AS sats
     FROM podcasts
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY 1
     ORDER BY shows DESC, lang`
  ).bind(...args).all();

  return json(request, {
    count: results.length,
    ...(medium ? { medium } : {}),
    ...(notMedium ? { not_medium: notMedium } : {}),
    languages: results,
    // Same shape for every visitor and it moves about as fast as the show list
    // does, so it caches like the other precomputed reads.
  }, { cache: 300 });
}
