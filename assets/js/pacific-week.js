/* The week rule the 40 HPW boards are cut on, in one place.
 *
 * ⚠️ WEEKS START MONDAY 00:00 US PACIFIC. Reed's call, 2026-08-23. Monday 00:00
 * UTC is Sunday 5pm on the US west coast and Sunday 8pm on the east, so the old
 * boundary reset This Week in the middle of most racers' weekend. Pacific is
 * the choice because it is the LAST US zone into Monday: at Monday 00:00
 * Pacific every part of the country is already on Monday, so nobody's board
 * resets while their Sunday is still running.
 *
 * ⚠️ THIS MODULE IS TWO-SIDED. `functions/api/v1/members/hours.js` imports it
 * by relative path and esbuild inlines it; the browser imports it as
 * `/assets/js/pacific-week.js?v=<VERSION>` so the week picker can step and
 * enumerate weeks without a round trip per press. It was a private function
 * inside that endpoint until the picker shipped on 2026-08-24; moving it is
 * what stops a second copy of the DST rule existing in the client.
 *
 * ⚠️ IT IS ARITHMETIC RATHER THAN `Intl`, DELIBERATELY. The obvious version
 * asks `Intl.DateTimeFormat` for `America/Los_Angeles`, which is exact and
 * needs no rule of our own — but it puts a runtime ICU dependency on an
 * endpoint's critical path, and there is no ICU at all on the SQL side, where
 * the same rule is restated as `pacificOffsetSql` for the all-time board's
 * per-row buckets. Two halves derived from different sources could drift with
 * a tzdata update on one of them. The US rule has been fixed since 2007 and
 * the corpus begins in 2024, so the history this gets wrong does not exist.
 * `scripts/test-members-hours.mjs` is where ICU belongs: Node carries full
 * tzdata, so the hand-rolled rule is held against the real thing there, on
 * every week for four years.
 *
 * No imports, by rule: everything a two-sided module imports must itself be
 * two-sided, and this one is a leaf.
 */

export const WEEK = 604800;
/* Unix epoch 0 is a Thursday, so `ts / WEEK` would bucket weeks Thursday to
 * Wednesday. 345600 is 1970-01-05, the first Monday after the epoch; shifting
 * by it puts every bucket boundary on a Monday midnight. */
export const MONDAY_EPOCH = 345600;
export const PST = -8 * 3600;
export const PDT = -7 * 3600;

/* Second Sunday in March at 02:00 PST (10:00 UTC) through the first Sunday in
 * November at 02:00 PDT (09:00 UTC). */
function nthSundayUTC(year, month, firstDom) {
  const d = Date.UTC(year, month - 1, firstDom);
  const dow = new Date(d).getUTCDay();          // 0 = Sunday
  return (d + ((7 - dow) % 7) * 86400000) / 1000;
}

export function pacificOffset(tsSec) {
  const year = new Date(tsSec * 1000).getUTCFullYear();
  const dstStart = nthSundayUTC(year, 3, 8) + 10 * 3600;
  const dstEnd = nthSundayUTC(year, 11, 1) + 9 * 3600;
  return (tsSec >= dstStart && tsSec < dstEnd) ? PDT : PST;
}

/* The UTC instant of the Monday 00:00 Pacific that `tsSec` falls inside.
 *
 * ⚠️ TWO OFFSETS, NOT ONE, AND THE SECOND IS THE ONE THAT IS EASY TO MISS. The
 * first shifts `tsSec` onto the Pacific wall clock so the Monday boundary can
 * be floored; the second is the offset in force at THAT MONDAY, which is not
 * always the offset in force now — the transition falls on a Sunday, the last
 * day of a Monday-anchored week, so during the changeover week the two differ
 * by an hour and reusing the first would move the board's cutoff.
 *
 * The `+ 8h` inside the second call resolves a wall-clock reading back to an
 * instant well away from any transition: transitions happen on a Sunday
 * morning UTC, roughly a day earlier, so either candidate offset lands the
 * probe on the same side of the rule. */
export function pacificWeekStart(tsSec) {
  const local = tsSec + pacificOffset(tsSec);
  const localMonday = Math.floor((local - MONDAY_EPOCH) / WEEK) * WEEK + MONDAY_EPOCH;
  return localMonday - pacificOffset(localMonday - PST);
}

/* ⚠️ STEPPING IS `pacificWeekStart` OF A DAY WELL INSIDE THE TARGET WEEK, NEVER
 * `± WEEK`. A Pacific week containing a DST transition is 167 or 169 hours of
 * real time, so adding a flat 604800 lands an hour off twice a year — which is
 * still a Monday-ish instant and still produces a board, so it would go
 * unnoticed until somebody compared two weeks across March.
 *
 * The probes are asymmetric because the anchor is the START of a week: three
 * days BEFORE a Monday is the Friday of the week before, and ten days AFTER it
 * is the Thursday of the week after. Both are days, not hours, from any
 * boundary. */
export function prevWeek(weekStart) {
  return pacificWeekStart(weekStart - 3 * 86400);
}

export function nextWeek(weekStart) {
  return pacificWeekStart(weekStart + 10 * 86400);
}

/* Every week start from `latest` back to the week containing `first`, newest
 * first. The picker's menu is built from this, so it is bounded: `limit`
 * exists because a corrupt or absent `first` would otherwise spin. */
export function weekSeries(first, latest, limit = 600) {
  const out = [];
  let w = pacificWeekStart(latest);
  const stop = pacificWeekStart(first);
  while (w >= stop && out.length < limit) {
    out.push(w);
    w = prevWeek(w);
  }
  return out;
}

/* ⚠️ A `YYYY-MM-DD` IS RESOLVED AT NOON UTC, AND MIDNIGHT IS THE TRAP. The
 * picker's weeks travel as dates because that is the readable, shareable form —
 * but `Date.UTC(y, m, d)` is midnight UTC, which is 4pm or 5pm PACIFIC on the
 * day BEFORE. Handed a Monday, `pacificWeekStart` would then answer the
 * PREVIOUS week, every time, and the board would be off by seven days while
 * looking entirely correct. Noon UTC is 4am or 5am Pacific on the named day,
 * which is inside it whichever offset is in force.
 *
 * Returns null for anything that is not a real calendar date, so a caller can
 * tell "no week asked for" from "a week asked for badly". */
export function weekStartFromDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d, 12);
  if (Number.isNaN(ms)) return null;
  const back = new Date(ms);
  // Rejects 2026-02-30 and friends, which Date.UTC rolls forward silently.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return pacificWeekStart(Math.floor(ms / 1000));
}

/* The inverse, for building a link or a query. Safe in UTC only because
 * Pacific is BEHIND UTC: Monday 00:00 Pacific is Monday 07:00 or 08:00 UTC, so
 * the instant is always still Monday in UTC. It would not survive a reset moved
 * east of Greenwich — the same one-directional argument `weekLabel` rests on. */
export function weekDateString(weekStart) {
  return new Date(Number(weekStart) * 1000).toISOString().slice(0, 10);
}
