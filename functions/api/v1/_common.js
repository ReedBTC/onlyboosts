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

// The SELECT used by every boost-returning endpoint: joins display fields so a
// row maps straight to the shard record shape.
export const BOOST_SELECT = `
  SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
         b.amount_source, b.podcast_guid, b.item_guid, b.item_url, b.client, b.message,
         p.title AS p_title, p.image AS p_image, p.feed_url AS p_feed,
         e.title AS e_title, e.image AS e_image, e.published AS e_pub,
         e.episode_number AS e_num, e.enclosure_url AS e_url,
         pr.name AS pr_name, pr.picture AS pr_pic
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
    client: r.client,
    booster: { pk: r.booster_pubkey, npub: r.booster_npub, name: r.pr_name, pic: r.pr_pic },
    podcast: { guid: r.podcast_guid, title: r.p_title, img: r.p_image, feed: r.p_feed },
    episode: {
      guid: r.item_guid, title: r.e_title, img: r.e_image || r.p_image,
      date: r.e_pub, num: r.e_num, url: r.e_url || r.item_url,
    },
  };
}
