// GET /api/v1/clients — which apps publish the boost notes in this index.
//
// ⚠️ THE PUBLISHER IS THE CLIENT; THE APP IT RELAYS IS NOT. `chadf-boostbot`
// republishes boosts made in apps that speak no NIP-73 at all — Castamatic,
// StableKraft, PodcastGuru, CurioCaster, LN Beats, Podverse. Those apps appear
// under `via`, nested inside the bot's own row, and never as a top-level client:
// they published nothing to Nostr, and listing them as clients would report six
// apps as supporting a spec none of them implement. That nesting IS the finding,
// so a consumer must not flatten the two lists into one leaderboard.
//
// ⚠️ EVERY FIGURE HERE IS DERIVED, not read off a field a publisher wrote. The
// NIP-89 `client` tag is on 1.3% of the corpus and absent from the app behind
// ~94% of it, so the collector infers attribution from three signals (see
// bots/global-boost-scan/clients.py). `unattributed` is the honest residual —
// ~0.2% — and is returned as its own row rather than folded into anyone.
//
// This is the endpoint a "boosts by app" surface is built from. The set of
// clients grows whenever a new app starts publishing, so it is data, not a
// constant to hardcode — same rule as /api/v1/languages.
import { json, preflight } from "./_common.js";

export async function onRequestOptions({ request }) { return preflight(request); }

/* ⚠️ THE LABELS MOVED TO assets/js/client-label.js ON 2026-08-24, and the
 * direction of the move is the point. They were declared here, on the reasoning
 * that one rename should land everywhere — but the only consumer was a surface
 * that does not exist yet (`/stats`), and when the boost cards started printing
 * client names they could not reach a table inside a Pages Function. A card
 * renderer that runs at the edge AND in the browser can only import from
 * `assets/js`, so that is where the table has to live for both to read it.
 *
 * A slug with no entry renders as itself, so a new app is a missing label
 * rather than a missing row.
 */
import { clientLabel as label } from "../../../assets/js/client-label.js";

const RANGE_DAYS = { "1w": 7, "1m": 30, "1y": 365, all: null };

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const range = u.searchParams.get("range") || "all";
  if (!(range in RANGE_DAYS)) {
    return json(request, { error: "bad range (1w|1m|1y|all)" }, { status: 400 });
  }
  const days = RANGE_DAYS[range];
  // Boost time, the only axis that means anything for "who published this".
  const cutoff = days ? Math.floor(Date.now() / 1000) - days * 86400 : null;
  const where = cutoff ? "WHERE created_at >= ?" : "";
  const args = cutoff ? [cutoff] : [];

  const [clients, vias] = await Promise.all([
    env.DB.prepare(
      `SELECT COALESCE(client_id,'unattributed') AS slug,
              COUNT(*) AS boosts, COALESCE(SUM(sats),0) AS sats,
              COUNT(DISTINCT booster_pubkey) AS boosters
       FROM boosts ${where} GROUP BY 1 ORDER BY boosts DESC`).bind(...args).all(),
    // Relayed origins, keyed by the publisher that relayed them so the nesting
    // survives to the client. Not a second flat ranking.
    env.DB.prepare(
      `SELECT client_id AS parent, client_via AS slug,
              COUNT(*) AS boosts, COALESCE(SUM(sats),0) AS sats
       FROM boosts
       ${cutoff ? "WHERE created_at >= ? AND" : "WHERE"} client_via IS NOT NULL
       GROUP BY 1,2 ORDER BY boosts DESC`).bind(...args).all(),
  ]);

  const byParent = new Map();
  for (const r of vias.results) {
    if (!byParent.has(r.parent)) byParent.set(r.parent, []);
    byParent.get(r.parent).push({
      slug: r.slug, name: label(r.slug), boosts: r.boosts, sats: r.sats,
    });
  }

  return json(request, {
    range,
    count: clients.results.length,
    clients: clients.results.map((r) => ({
      slug: r.slug,
      name: r.slug === "unattributed" ? "Unattributed" : label(r.slug),
      boosts: r.boosts,
      sats: r.sats,
      boosters: r.boosters,
      // Present only on a publisher that relays. Its entries are apps that do
      // NOT publish to Nostr themselves — see the header.
      ...(byParent.has(r.slug) ? { via: byParent.get(r.slug) } : {}),
    })),
  }, { cache: 300 });
}
