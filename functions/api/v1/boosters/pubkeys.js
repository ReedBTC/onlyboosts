// GET /api/v1/boosters/pubkeys — every pubkey that has a /booster page, and
// nothing else. One flat array, no pagination, no profile data.
//
// IT ANSWERS ONE BOOLEAN PER PUBKEY, IN BULK, AND THAT IS THE WHOLE DESIGN.
// The caller is a page that renders many people at once and has to know, at
// render time and synchronously, which of them link here. A per-pubkey check
// cannot serve that: it produces no real `<a href>` (so no cursor affordance and
// no middle-click), and a `window.open()` after an `await` is what a mobile
// popup blocker eats. `/api/v1/boosters/<npub>` is the wrong shape for it twice
// over — a hit is ~63KB, and a miss answers 200 with an empty array rather than
// 404, so existence has to be inferred from the payload.
//
// ⚠️ THE QUALIFYING RULE IS A BOOST, NOT A PROFILE, and this is the one thing a
// change here could get wrong quietly. functions/booster/[npub].js 404s on
// `!Number(totals.boosts)` and on nothing else, so a booster with no resolvable
// kind-0 still has a real page headed by their npub. Deriving this set from
// `profiles` instead would drop the 51 boosters (of 2,003) the collector could
// not resolve a kind-0 for on any relay — people whose pages are live, reported
// as having none. The `boosts` table is the only source that agrees with the
// page, which is why `/api/v1/stats`'s `boosters` figure is the check.
//
// Excluded content needs no clause here: excludes.json is applied upstream, in
// the collector's D1 projection, so an excluded booster has no rows in `boosts`
// at all. See `db.not_excluded()` in bots/global-boost-scan/.
//
// Hex rather than npub deliberately. Every consumer already holds pubkeys in
// hex, `boosts.booster_npub` is nullable where `booster_pubkey` is not, and
// bech32-encoding 2,003 keys per response would be work done twice.
import { json, preflight } from "../_common.js";

// Lowercase 64-char hex. The same test toHexPubkey applies, and the reason to
// apply it is that /booster/<npub> binds the hex form to `booster_pubkey = ?`:
// a row stored in any other shape has no page, so publishing it would hand the
// caller a link to a 404. Zero rows fail this in the live index; it is a guard
// against a future collector bug, not a live filter.
const HEX64 = /^[0-9a-f]{64}$/;

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env }) {
  // A covering-index scan of idx_boosts_booster, which is already in
  // (booster_pubkey, created_at DESC) order, so DISTINCT costs no temp B-tree.
  // Unsorted output is fine: the caller builds a Set from it.
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT booster_pubkey FROM boosts WHERE booster_pubkey IS NOT NULL`
  ).all();

  const pubkeys = (results || [])
    .map((r) => r.booster_pubkey)
    .filter((pk) => typeof pk === "string" && HEX64.test(pk));

  // Thirty minutes, where the rest of /api/v1 runs 30 to 300 seconds. The set
  // changes only when somebody boosts for the first time, and the response is
  // ~130KB raw, so a short TTL would buy freshness nobody can perceive at the
  // cost of the one expensive thing here.
  return json(request, {
    // Query time, not a stored column: D1 is live rather than a snapshot, so
    // there is no generation to name. It is here for the caller's own cache-age
    // display and TTL logic.
    generated_at: Math.floor(Date.now() / 1000),
    // Included so a truncated response is detectable at the far end.
    count: pubkeys.length,
    pubkeys,
  }, { cache: 1800 });
}
