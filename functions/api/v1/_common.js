// Shared helpers for the OnlyBoosts /api/v1 data endpoints (Cloudflare Pages
// Functions over the D1 `DB` binding). Underscore-prefixed → not routed, only
// imported. PRIVATE to the site for now: exact-origin CORS, no public keys.
// Records match the static-shard shape so consumers learn one data model.

const ALLOWED_ORIGINS = new Set([
  "https://onlyboosts.social",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:8788", // wrangler pages dev default
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://onlyboosts.social";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export function json(request, data, { status = 200, cache = 30 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cache}`,
      ...corsHeaders(request),
    },
  });
}

export function preflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

// ── pubkey input: accept npub or 64-char hex ──────────────────────────────────
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function convertbits(data, from, to) {
  let acc = 0, bits = 0; const ret = []; const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v; bits += from;
    while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv); }
  }
  return ret;
}
export function toHexPubkey(s) {
  if (!s) return null;
  s = s.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (!s.toLowerCase().startsWith("npub1")) return null;
  const low = s.toLowerCase();
  const pos = low.lastIndexOf("1");
  const data = [];
  for (const c of low.slice(pos + 1)) { const v = B32.indexOf(c); if (v < 0) return null; data.push(v); }
  const bytes = convertbits(data.slice(0, -6), 5, 8); // drop 6-char checksum
  if (bytes.length < 32) return null;
  return bytes.slice(0, 32).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── cursor pagination (created_at + event_id, newest-first) ───────────────────
export function encodeCursor(row) {
  return row ? btoa(`${row.created_at}:${row.event_id}`) : null;
}
export function decodeCursor(c) {
  if (!c) return null;
  try {
    const [ts, id] = atob(c).split(":");
    const n = parseInt(ts, 10);
    if (!Number.isFinite(n) || !id) return null;
    return { ts: n, id };
  } catch { return null; }
}

export function clampLimit(v, def = 50, max = 200) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

/**
 * Turn a raw search box string into an FTS5 MATCH expression, or null when
 * there is nothing left to match on.
 *
 * ⚠️ A USER STRING IS NOT AN FTS5 QUERY. MATCH parses its right-hand side as an
 * expression language — `-` negates, `:` selects a column, `(` groups, `*`
 * is a prefix operator — so passing typed text through raises
 * `SQLITE_ERROR` and the endpoint 500s on input a person would obviously type.
 * Measured against production before this existed: `q=bitcoin` answered 200
 * while `q=rabbit-hole`, `q=foo:bar` and a pasted show guid all answered 500.
 *
 * The fix is to quote every token, which demotes all of it to literal text, and
 * to put the prefix `*` OUTSIDE the closing quote of the last one so a partial
 * final word still matches the way a search box implies.
 *
 * Tokens are quoted INDIVIDUALLY rather than the whole string being wrapped as
 * one phrase, and that difference is the search's semantics: `"joe" "rogan"*`
 * is an implicit AND of terms appearing anywhere in any indexed column, which is
 * what the client-side ladder did, where `"joe rogan"*` would demand they be
 * adjacent. Verified across `-`, `:`, `(`, `***`, bare `OR` and a full guid:
 * every one either matches or returns nothing, and none of them errors.
 */
export function ftsMatch(raw) {
  if (typeof raw !== "string") return null;
  // The double quote is the one character that cannot survive: it is the
  // quoting mechanism itself, and FTS5 offers no escape for it.
  const parts = raw.replace(/"/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts.map((t, i) => `"${t}"${i === parts.length - 1 ? "*" : ""}`).join(" ");
}

/**
 * Read the `lang` filter. Returns `{ lang }` (null = no filter) or `{ error }`.
 *
 * RSS <language>, stored as the PRIMARY SUBTAG only — 'en', 'de' — because the
 * feeds describe ~21 languages in 36 distinct raw tags ('en', 'en-us', 'en-US',
 * 'en-gb'), and a reader filtering for German wants the show whether its feed
 * says 'de' or 'de-de'. The collector normalizes on write; this only ever sees
 * the normalized form.
 *
 * ⚠️ NULL IS NOT ENGLISH, AND IT IS NOT A ROUNDING ERROR. 52% of music feeds
 * declare no language at all (Wavlake, which hosts most of the music corpus,
 * emits none), against 1% of podcasts. So an untagged show is a real, populous
 * state and not a gap to be defaulted away: `lang=en` deliberately excludes it
 * rather than assuming, and `lang=unknown` is how a caller asks for exactly that
 * bucket. A UI that offers language must therefore either keep an "unknown"
 * option or say that filtering hides untagged shows — silently folding NULL into
 * a language would put half the Albums feed under a claim its publisher never
 * made. Same partition reasoning as `medium`, where the unidentified shows are
 * why the Shows feed is `not_medium=music` rather than `medium=podcast`.
 *
 * Validated by SHAPE (ISO 639 is 2-3 alpha) rather than against a fixed list:
 * the set of languages present grows as shows are indexed, and a hardcoded
 * whitelist here would silently 400 the first Korean show anyone boosts. An
 * unknown-but-well-formed subtag simply matches nothing.
 */
export function readLang(u) {
  const raw = (u.searchParams.get("lang") || "").trim().toLowerCase();
  if (!raw) return { lang: null };
  if (raw === "unknown") return { lang: "unknown" };
  // A full tag is normalized rather than rejected, the same way the collector
  // normalizes on write: nothing is stored as 'en-us', so `lang=en-US` could only
  // ever match zero rows, and 400ing input that plainly means English would be a
  // trap for anyone who passed a value straight back from an RSS feed.
  const primary = raw.split(/[-_]/)[0];
  if (!/^[a-z]{2,3}$/.test(primary)) {
    return { error: "bad lang (2-3 letter subtag, or 'unknown')" };
  }
  return { lang: primary };
}

/** SQL fragment for `lang`, given the column to test. Pushes its own bind. */
export function langWhere(lang, col, args) {
  if (!lang) return null;
  if (lang === "unknown") return `${col} IS NULL`;
  args.push(lang);
  return `${col} = ?`;
}

// The SELECT used by every boost-returning endpoint: joins display fields so a
// row maps straight to the shard record shape.
export const BOOST_SELECT = `
  SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
         b.amount_source, b.podcast_guid, b.item_guid, b.item_url, b.client, b.message,
         b.client_id, b.client_via,
         p.title AS p_title, p.image AS p_image, p.feed_url AS p_feed,
         e.title AS e_title, e.image AS e_image, e.published AS e_pub,
         e.episode_number AS e_num, e.enclosure_url AS e_url,
         pr.name AS pr_name, pr.display_name AS pr_dname, pr.picture AS pr_pic
  FROM boosts b
  LEFT JOIN podcasts p ON p.podcast_guid = b.podcast_guid
  LEFT JOIN episodes e ON e.item_guid    = b.item_guid
  LEFT JOIN profiles pr ON pr.pubkey     = b.booster_pubkey`;

export function boostRecord(r) {
  return {
    id: r.event_id,
    ts: r.created_at,
    sats: r.sats,
    src: r.amount_source,
    msg: r.message,
    // The publisher's own NIP-89 tag, as signed — present on ~1.3% of boosts.
    client: r.client,
    // DERIVED attribution (collector's clients.py): `id` is the app that
    // PUBLISHED the note, `via` the app a relayed boost came from. A null `id`
    // is unattributed and must not be rendered as any app.
    client_app: { id: r.client_id || null, via: r.client_via || null },
    /* ⚠️ `dname` IS ADDITIVE AND `name` DID NOT CHANGE MEANING. The three detail
     * pages print `display_name` in preference to `name` — that is what
     * boost-list.js#displayName does, and it is what those pages have always
     * shipped — while this record carried only `name`. So a boost row rebuilt in
     * the browser from a corpus response would have RENAMED every booster whose
     * kind-0 sets both fields, which is the one component rendering two ways that
     * the rendering rule exists to prevent.
     *
     * Adding the field rather than reordering the existing one: `name` is the
     * collector's published shape (see DATA-API.md) and every feed on the site
     * reads it, so the fix belongs where the difference is rather than in a
     * value 22k records already carry. Nullable, like every display field. */
    booster: { pk: r.booster_pubkey, npub: r.booster_npub, name: r.pr_name, dname: r.pr_dname ?? null, pic: r.pr_pic },
    podcast: { guid: r.podcast_guid, title: r.p_title, img: r.p_image, feed: r.p_feed },
    episode: {
      guid: r.item_guid, title: r.e_title, img: r.e_image || r.p_image,
      date: r.e_pub, num: r.e_num, url: r.e_url || r.item_url,
    },
  };
}
