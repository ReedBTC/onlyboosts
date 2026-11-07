/**
 * POST /api/v1/opml/link — read an OPML file from a link somebody pasted, and
 * answer with its outlines.
 *
 *   body   { url: string }           (http(s), not private-looking, ≤ 4KB body)
 *   200    { outlines: [{ xmlUrl, title }], name }
 *   400    not a web address, or one that carries a credential
 *   422    the far end was not an OPML document
 *   502    the far end did not answer 200, or was too large
 *
 * On the server because most hosts send no `Access-Control-Allow-Origin`, so
 * a browser could read only the few that do. assets/js/opml.js decides what
 * the outlines mean, on the device, exactly as it does for a chosen file
 * (BoostMeBitch #518's shape).
 *
 * ⚠️ POST, NOT `?url=`, AND `no-store`. A subscription list is personal, and
 * an address with no key in it can still be one only its owner knows; a query
 * string lands in logs and, on a GET, keys a shared cache. ⚠️ ONLY OUTLINES
 * COME BACK, NEVER THE BODY, so this is not a general proxy: a page, a feed or
 * a JSON file at the far end is a 422 and nothing of it is returned. The fetch
 * is bounded (8s, OPML_MAX_BYTES streamed) and refuses a literal IP address
 * or a local hostname outright; the platform refuses private networks beneath
 * that.
 */
import { json, preflight } from "../_common.js";
import { OPML_MAX_BYTES, opmlLinkVerdict, opmlLinkName, parseOpml } from "../../../../assets/js/opml.js";

const MAX_REQUEST_BYTES = 4096;
const TIMEOUT_MS = 8000;

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestPost({ request }) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_REQUEST_BYTES) return answer(request, { error: "too large" }, 413);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) return answer(request, { error: "too large" }, 413);
    body = JSON.parse(text);
  } catch { return answer(request, { error: "bad json" }, 400); }
  const raw = body && typeof body === "object" ? body.url : null;
  // The browser asks opml.js first and never sends a refused link. Asked again
  // here because the route must not depend on who is calling it.
  const verdict = typeof raw === "string" ? opmlLinkVerdict(raw) : { refused: "not-web" };
  if ("refused" in verdict) return answer(request, { error: "invalid url", refused: verdict.refused }, 400);
  if (!publicHost(verdict.url)) return answer(request, { error: "invalid url", refused: "not-web" }, 400);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(verdict.url, {
      headers: { "User-Agent": "OnlyBoosts-OPML/1.0 (+https://onlyboosts.social)", Accept: "text/x-opml, application/xml, text/xml, */*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!resp.ok) return answer(request, { error: `upstream ${resp.status}` }, 502);
    const text = await readBounded(resp, ctrl, OPML_MAX_BYTES);
    if (text === null) return answer(request, { error: "too large" }, 502);
    const outlines = parseOpml(text);
    if (!outlines) return answer(request, { error: "not opml" }, 422);
    return answer(request, { outlines, name: opmlLinkName(verdict.url) }, 200);
  } catch (e) {
    return answer(request, { error: ctrl.signal.aborted ? "timeout" : "fetch failed" }, 502);
  } finally {
    clearTimeout(timer);
  }
}

/** A hostname a public OPML file could live at: a name, not an address. */
export function publicHost(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const h = u.hostname.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false; // an IP literal, v4 or v6
  if (/\.(local|internal|arpa|home|lan|localdomain)$/.test(h)) return false;
  if (!h.includes(".")) return false;
  return true;
}

function answer(request, data, status) {
  const r = json(request, data, { status, cache: 0 });
  r.headers.set("Cache-Control", "no-store");
  return r;
}

// Streamed, capped; the reference shape is in functions/api/data/[[path]].js.
async function readBounded(resp, ctrl, maxBytes) {
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const text = await resp.text();
    return text.length > maxBytes ? null : text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) { try { ctrl.abort(); } catch {} return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder("utf-8").decode(all);
}
