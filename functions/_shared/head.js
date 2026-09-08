// ⚠️ PAGES ROUTES BY METHOD, AND A HEAD WITH NO HANDLER FALLS THROUGH TO THE
// STATIC LOOKUP, WHICH ANSWERS 404 FOR A URL WHOSE GET IS FINE. Link checkers
// and some unfurlers HEAD first. The two OG image routes learned it from the
// collector's bot on 2026-08-29, /hpw repeated it on 2026-08-30, and on
// 2026-09-07 a `curl -I` on /show, /episode, /booster and every /api/v1
// endpoint still answered 404 — the rule in CLAUDE.md was written, and eighteen
// Functions never got the handler. This is the one handler they all export
// now, and scripts/test-head-routes.mjs scans for any Function that exports a
// GET without it.
//
// The GET's status and headers, no body. The GET runs in full — a HEAD costs
// exactly what the GET costs, and that is right: the status can only be known
// by running it, and a HEAD is rare where a GET is common.
//
// ⚠️ DELIBERATELY NOT ON /api/lnurl OR /api/keysend. Their GET asks a third
// party for something on the caller's behalf (a bolt11 invoice, a node's
// keysend record); a link checker's HEAD must not do that. Those two answer
// 404 to HEAD on purpose, and the scan test carries them as the allowlist.
export function headOf(onRequestGet) {
  return async function onRequestHead(ctx) {
    const r = await onRequestGet(ctx);
    return new Response(null, { status: r.status, headers: r.headers });
  };
}
