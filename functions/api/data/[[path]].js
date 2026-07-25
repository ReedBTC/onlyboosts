// OnlyBoosts data-feed proxy.
//
// Fronts the static JSON the collector publishes to
// https://relay.mynostr.app/onlyboosts/ so the browser never talks to that
// host directly — same rationale as LB's community-boosts proxy: one cached
// edge origin, one CORS policy, and the upstream URL can move without a
// frontend deploy.
//
// ⚠️ THE UPSTREAM RETURNS 200 FOR MISSING FILES.
// relay.mynostr.app serves Nostr at the same origin, so an unknown path falls
// through to the relay and answers `200 text/plain "Please use a Nostr client
// to connect."` — not a 404. Branching on `resp.ok` would hand the frontend a
// plain-text body as if it were data. Both guards below are load-bearing:
// the content-type check, and actually parsing the body as JSON before
// returning it. Do not "optimize" the parse away by streaming the body
// through — validating it is the entire point.
//
// Path handling is a strict allowlist, not a passthrough. A catch-all that
// forwards whatever it's given is an SSRF hole; the shapes the collector
// publishes are known and finite, so they're enumerated.

const UPSTREAM_BASE = "https://relay.mynostr.app/onlyboosts/";
const FETCH_TIMEOUT_MS = 10_000;
// Largest shard today is ~1.2MB (latest.json); the biggest per-show file seen
// is ~570KB. 12MB is generous headroom for growth without letting a
// misbehaving upstream pin the Function's memory.
const RESPONSE_MAX_BYTES = 12 * 1024 * 1024;

// Exact-match origin allowlist — `startsWith` would let a lookalike origin
// get reflected into Access-Control-Allow-Origin.
const ALLOWED_ORIGINS = new Set([
  "https://onlyboosts.social",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

// Every path the collector publishes. Anything else is rejected before a
// request leaves the edge.
const PATH_RULES = [
  /^index\.json$/,
  /^latest\.json$/,
  /^meta\.json$/,
  /^profiles\.json$/,
  /^boosts\/\d{4}-\d{2}\.json$/,
  /^podcasts\/index\.json$/,
  // Per-show shards. The collector derives these from a podcast guid, which is
  // usually a UUID but not always — some feeds carry arbitrary guid strings —
  // so the character class is permissive while still excluding path traversal
  // (no dots-only segments, no slashes, bounded length).
  /^podcasts\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/,
];

function isAllowedPath(p) {
  if (typeof p !== "string" || !p) return false;
  if (p.includes("..") || p.includes("//") || p.startsWith("/")) return false;
  return PATH_RULES.some((re) => re.test(p));
}

function pickCorsOrigin(originHeader) {
  if (typeof originHeader === "string" && ALLOWED_ORIGINS.has(originHeader)) {
    return originHeader;
  }
  return "https://onlyboosts.social";
}

export async function onRequest(context) {
  const origin = context.request.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": pickCorsOrigin(origin),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const segments = context.params?.path;
  const path = Array.isArray(segments) ? segments.join("/") : String(segments || "");

  if (!isAllowedPath(path)) {
    return json({ error: "Unknown data path" }, 404, corsHeaders);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(UPSTREAM_BASE + path, {
      headers: { "User-Agent": "OnlyBoosts-Data-Proxy/1.0", Accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
      signal: ctrl.signal,
    });

    // Guard 1 — content type. A missing file comes back as text/plain from the
    // relay's catch-all, with a 200 status.
    const ctype = resp.headers.get("content-type") || "";
    if (!ctype.includes("json")) {
      return json({ error: "Data file not found" }, 404, corsHeaders);
    }

    const cl = parseInt(resp.headers.get("content-length") || "", 10);
    if (Number.isFinite(cl) && cl > RESPONSE_MAX_BYTES) {
      return json({ error: "Upstream data file exceeded size limit" }, 502, corsHeaders);
    }

    const text = await readBounded(resp, ctrl);
    if (text === null) {
      return json({ error: "Upstream data file exceeded size limit" }, 502, corsHeaders);
    }

    // Guard 2 — it must actually parse. Belt and braces against the upstream
    // ever serving an HTML error page with a JSON content-type.
    try {
      JSON.parse(text);
    } catch {
      return json({ error: "Upstream returned malformed JSON" }, 502, corsHeaders);
    }

    return new Response(text, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    const isTimeout = err?.name === "AbortError";
    return json(
      { error: isTimeout ? "Upstream timed out" : "Failed to fetch data" },
      502, corsHeaders
    );
  } finally {
    clearTimeout(timer);
  }
}

// Stream the body, bailing once cumulative bytes exceed the cap. resp.text()
// would buffer the whole thing before we could check size.
async function readBounded(resp, ctrl) {
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const text = await resp.text();
    return text.length > RESPONSE_MAX_BYTES ? null : text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > RESPONSE_MAX_BYTES) {
      try { ctrl.abort(); } catch {}
      try { reader.cancel(); } catch {}
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder("utf-8").decode(buf);
}

function json(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
