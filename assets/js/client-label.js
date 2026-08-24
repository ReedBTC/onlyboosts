/* Which app published a boost note, as a word a reader recognises.
 *
 * ⚠️ TWO-SIDED AND DEPENDENCY-FREE, which is the whole reason it is a file.
 * `boost-list.js` renders the boost row at the edge AND rebuilds it in the
 * browser after a re-sort, and those two must be byte-identical; a module it
 * imports therefore has to resolve on both sides, so this one imports nothing
 * and uses no DOM, no `fetch` and no `Intl`. See the header of boost-list.js.
 *
 * ⚠️ AND IT IS THE ONE SOURCE OF THESE NAMES. `functions/api/v1/clients.js`
 * held the map privately and rendered it on a surface that does not exist yet
 * (`/stats`); the boost cards are the first thing to actually print a client
 * name, and a second copy of the table is two places a rename has to land. That
 * endpoint imports this now.
 *
 * ⚠️ A SLUG WITH NO ENTRY RENDERS AS ITSELF. The set of clients grows the first
 * time a new app publishes a boost note, so this table is data that trails the
 * corpus rather than a closed list. An unlabelled slug is a cosmetic gap; a
 * dropped row would be an app the site quietly refuses to credit.
 */

const DISPLAY = {
  "fountain": "Fountain",
  "chadf-boostbot": "ChadF Boost Bot",
  "boostmebitch": "BoostMeBitch",
  "localbitcoiners": "Local Bitcoiners",
  "bowlafterbowl": "Bowl After Bowl",
  "onlyboosts": "OnlyBoosts",
  "pv4v": "PV4V",
  "lnaddress-music": "lnaddress music",
  "castamatic": "Castamatic",
  "stablekraft": "StableKraft",
  "podcastguru": "PodcastGuru",
  "curiocaster": "CurioCaster",
  "ln-beats": "LN Beats",
  "podverse": "Podverse",
  "podcast-index": "Podcast Index",
  "boostcli": "BoostCLI",
  // Carried over from the Boosts feed's own map, which read the raw client tag
  // and is now deleted. No boost in the index currently classifies to this slug;
  // it costs a line and saves the label if one ever does.
  "truefans": "TrueFans",
  "helipad": "Helipad",
};

/** A client slug → its display name. An unknown slug is returned unchanged. */
export function clientLabel(slug) {
  const s = typeof slug === "string" ? slug.trim() : "";
  if (!s) return "";
  return DISPLAY[s] || s;
}

/* ⚠️ `unattributed` IS A REAL ROW ON /api/v1/clients AND IS NOT A CARD LABEL.
 * The collector leaves `client_id` null when none of its three signals fired —
 * 39 boosts, ~0.2% — and that endpoint reports the residual honestly as its own
 * row rather than folding it into anyone. On a card there is nothing to say: a
 * chip reading "via Unattributed" states our own coverage gap in the position a
 * reader expects an app's name, which is worse than the line being absent. So
 * the card asks THIS, not `clientLabel`, and prints nothing when it answers
 * false.
 *
 * ⚠️ `client_via` IS DELIBERATELY NOT CONSULTED BY THE CARD. A boost relayed by
 * ChadF Boost Bot carries the listener's own app there (Castamatic, StableKraft,
 * PodcastGuru …), and showing it would answer a more interesting question —
 * but the note was PUBLISHED by the bot, the booster credited on that same card
 * is the bot, and "via Castamatic" beside a bot's name and face is two different
 * claims in one row. Reed's call, 2026-08-24, choosing the publisher. The origin
 * app is still in the record (`client_app.via`) and still nested under the bot
 * on /api/v1/clients; nothing was dropped, it is just not what the chip says.
 */
export function hasClientLabel(slug) {
  const s = typeof slug === "string" ? slug.trim() : "";
  return s !== "" && s !== "unattributed";
}
