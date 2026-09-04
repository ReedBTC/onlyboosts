// GET /api/v1/charts/<kind>?week=YYYY-MM-DD      one week's Top 10 on the chart rule
// GET /api/v1/charts/<kind>/weeks-at-1           the Weeks at #1 companion
//
// The JSON behind the chart boards on the Shows and Artists feeds
// (assets/js/charts-block.js) and the Members tab's Weeks at #1 board
// (members-board.js), and the change-detection source for the collector's
// card bot (bots/hpw-cards/), which hashes `rows` and re-renders a card only
// when they move. The queries are functions/_shared/week-charts.js's — the
// /charts page's own — so a board on the tab, on the page and in a screenshot
// is one computation.
//
//   kind   shows | artists for the weekly board; shows | artists | members for
//          weeks-at-1. The members' WEEKLY board is the 40 HPW board and lives
//          at /api/v1/members/hours, which this deliberately does not restate.
//   week   any date; resolved to the Pacific Monday of the week containing
//          it, a future or unparseable week to the live one, the hours
//          endpoint's envelope rule — these travel in links, so the caller is
//          often a reader, and the client renders `week_start` off the
//          response, never off what it asked for.
//
// ⚠️ THE ENVELOPE'S WEEK FIELDS ARE THE HOURS ENDPOINT'S, BY NAME: week_start,
// week_end, is_current, current_week, first_week. The week picker
// (week-picker.js) reads exactly those off either endpoint, and the bot steps
// weeks by asking for the date three days before `week_start`.

import { json, preflight, clampLimit } from "../_common.js";
import { pacificWeekStart, nextWeek, weekStartFromDate } from "../../../../assets/js/pacific-week.js";
import { weeklyChart, weeksAtNumberOne, hpwWeeksAtNumberOne } from "../../../_shared/week-charts.js";

const WEEKLY_KINDS = new Set(["shows", "artists"]);
const ONES_KINDS = new Set(["shows", "artists", "members"]);

export async function onRequestOptions({ request }) { return preflight(request); }

export async function onRequestGet({ request, env, params }) {
  let segs = params.path;
  if (segs == null) segs = [];
  if (!Array.isArray(segs)) segs = [segs];
  segs = segs.filter((s) => s !== "");
  const u = new URL(request.url);
  const limit = clampLimit(u.searchParams.get("limit"), 10, 50);

  if (segs.length === 2 && segs[1] === "weeks-at-1" && ONES_KINDS.has(segs[0])) {
    try {
      const { body, cache } = await onesBoard(env, { kind: segs[0], limit });
      return json(request, body, { cache });
    } catch (err) {
      console.error("[charts] weeks-at-1 query failed", err);
      return json(request, { error: "query failed" }, { status: 500, cache: 0 });
    }
  }
  if (segs.length === 1 && WEEKLY_KINDS.has(segs[0])) {
    try {
      const { body, cache } = await weekBoard(env, { kind: segs[0], week: u.searchParams.get("week"), limit });
      return json(request, body, { cache });
    } catch (err) {
      console.error("[charts] week query failed", err);
      return json(request, { error: "query failed" }, { status: 500, cache: 0 });
    }
  }
  return json(request, { error: "not found" }, { status: 404, cache: 0 });
}

/* The oldest boost in the index, so the picker knows where to stop stepping
 * back. Allowed to fail quietly: it bounds a control, where the board is the
 * thing the reader came for. */
function firstWeekOf(env) {
  return env.DB.prepare("SELECT MIN(created_at) AS t FROM boosts").first()
    .then((r) => (r && r.t ? pacificWeekStart(r.t) : null))
    .catch(() => null);
}

/** One week's Top `limit` for `kind`, in the hours endpoint's envelope shape.
 *  Exported for the card frames in functions/charts/[[path]].js, which render
 *  the same envelope rather than fetching this over the network. */
export async function weekBoard(env, { kind, week = null, limit = 10 } = {}) {
  const live = pacificWeekStart(Math.floor(Date.now() / 1000));
  const asked = weekStartFromDate(week);
  const ws = (asked === null || asked > live) ? live : asked;
  const isCurrent = ws === live;
  const we = nextWeek(ws);
  const [rows, first] = await Promise.all([weeklyChart(env, kind, ws, we, limit), firstWeekOf(env)]);
  return {
    cache: isCurrent ? 60 : 300,
    body: {
      kind,
      week_start: ws,
      week_end: we,
      is_current: isCurrent,
      current_week: live,
      first_week: first,
      count: rows.length,
      rows,
    },
  };
}

/** The Weeks at #1 board for `kind`, counted over completed weeks before the
 *  live week's Monday. The members board is the hours leader's, the content
 *  boards the chart rule's — week-charts.js's own split. */
export async function onesBoard(env, { kind, limit = 10 } = {}) {
  const live = pacificWeekStart(Math.floor(Date.now() / 1000));
  const rows = kind === "members"
    ? await hpwWeeksAtNumberOne(env, live, limit)
    : await weeksAtNumberOne(env, kind, live, limit);
  return {
    cache: 300,
    body: { kind, before: live, current_week: live, count: rows.length, rows },
  };
}
