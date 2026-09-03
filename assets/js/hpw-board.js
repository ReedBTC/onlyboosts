/* The 40 HPW board's rows, as an HTML string. The FACTS half of the board.
 *
 * ⚠️ THIS MODULE IS TWO-SIDED. The Members tab (`members-board.js`) imports it
 * as `/assets/js/hpw-board.js?v=<VERSION>` and paints the boards in the
 * browser; `functions/hpw/[[path]].js` imports it by relative path and esbuild
 * inlines it, so `/hpw/<week>` and the card page the collector screenshots
 * render the same rows the tab does. It lived inside `members-board.js` until
 * the share cards shipped (2026-08-29) and was moved out under the rendering
 * rule: the server renders the facts, and a second copy of `rowHtml` at the
 * edge is the drift `test-hpw-board.mjs` now exists to prevent. The move was
 * verified by diff — byte-identical output on a fixture before and after.
 *
 * The rules a two-sided module lives under, all enforced by that test:
 *   - siblings are imported as `'./thing.js?v=<VERSION>'`, never absolutely,
 *     and every sibling is itself two-sided (all four here are leaves);
 *   - no DOM, no `fetch`, no `Date.now()` — at the edge that clock is the
 *     moment the response was cached;
 *   - every locale call is pinned to `en-US` in UTC, so the edge and the
 *     browser produce the same string.
 *
 * The VERBS — the week picker, the jump buttons, the Rules dialog — stay in
 * `members-board.js`, which is the browser's alone.
 */
import { boosterPageHref } from './booster-link.js?v=ob-v184'
import { httpsUrl } from './cover-art.js?v=ob-v184'
import { htmlEscape, isSafeUrl } from './nostr-text.js?v=ob-v184'
import { prevWeek, weekDateString } from './pacific-week.js?v=ob-v184'

const esc = htmlEscape

/* en-US in UTC, matching every other date on the site. A board row names the
 * Monday its week started, so the reader can see how old a great week is.
 *
 * ⚠️ UTC IS STILL RIGHT HERE EVEN THOUGH THE WEEKS ARE PACIFIC, and the reason
 * is one-directional. `week_start` is the real instant of a Monday 00:00
 * Pacific, which is Monday 07:00 or 08:00 UTC — Pacific is behind UTC, so that
 * instant is always still Monday in UTC and this prints the right day. It would
 * not survive a zone AHEAD of UTC; if the reset ever moves east, this formatter
 * has to move with it. */
function weekLabel(unixSec) {
  if (!unixSec) return ''
  const d = new Date(Number(unixSec) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

/* ⚠️ THE PICKER'S LABEL NAMES A POSITION FIRST AND A DATE SECOND, which is the
 * calendar-app idiom: a reader one press back is looking at "Last week", not at
 * "Aug 17, 2026". The date is the answer to a question they did not ask, and
 * the relative form is the one they would say out loud. Everything older takes
 * the date, because "three weeks ago" stops being something anybody counts.
 *
 * ⚠️ A `Week:` TAG WAS BUILT IN FRONT OF THIS AND WAS REVERTED THE SAME DAY.
 * Reed's call, 2026-08-24: "I don't like the font and alignment clashes between
 * `Week:` and the week printed." The reasoning for it was sound — a word says
 * "pickable" better than any border does — and the EXECUTION is what could not
 * work here. The feeds' Sort pill gets away with `Sort: Most boosts` because
 * both halves are ONE family at ONE size, varying only in colour and weight;
 * this label is 1.02rem Playfair bold, so a tag beside it varied family AND
 * size AND weight at once, and three axes of difference across two words reads
 * as a collision rather than as an axis and its value. `align-self: baseline`
 * was not enough to settle it.
 *
 * The tag also forced the value to give up "Week of", since "Week: Week of Aug
 * 10, 2026" is unsayable — so reverting it restores the prefix too, which is
 * what these three strings said before and what Reed asked to have back.
 * ⚠️ ANY FUTURE TAG HAS TO SOLVE THE TYPE FIRST, NOT THE WORDING. */
function weekTitle(ws, live) {
  if (!ws || !live) return 'This Week'
  if (ws === live) return 'This Week'
  if (ws === prevWeek(live)) return 'Last Week'
  return `Week of ${weekLabel(ws)}`
}

/* The span a past week covers, for the sub-line under the title.
 *
 * `+ 6 days` is safe where `+ WEEK` would not be: week_start is Monday 07:00 or
 * 08:00 UTC, so six days on is Sunday 07:00 or 08:00 UTC — still Sunday
 * whichever offset is in force, where a flat week lands on the following Monday
 * and a DST week lands an hour either side of it. */
function weekSpan(ws) {
  const end = Number(ws) + 6 * 86400
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  const a = new Date(Number(ws) * 1000).toLocaleDateString('en-US', opts)
  const b = new Date(end * 1000).toLocaleDateString('en-US', opts)
  const year = new Date(end * 1000).toLocaleDateString('en-US', { year: 'numeric', timeZone: 'UTC' })
  return `${a} to ${b}, ${year}`
}

/* One decimal, always. `26h` and `25.9h` in the same column read as different
 * kinds of number, and the gap between second and third place is often less
 * than an hour. */
function hours(seconds) {
  return (Number(seconds) / 3600).toFixed(1)
}

function initials(name, pk) {
  const src = (name || '').trim()
  if (src) return src.slice(0, 1).toUpperCase()
  return (pk || '?').slice(0, 2).toUpperCase()
}

/* `weekHref(dateString)` is the page's option: on `/hpw/high-scores` a row's
 * week is a link to that week's own page, where on the tab it is the picker's
 * jump button (see the note over `week` below). Omitted, the output is exactly
 * what the tab has always painted. */
function rowHtml(m, i, goal, { weekHref = null } = {}) {
  /* ⚠️ THE ROW HAS TWO SHAPES AND `m.weeks` IS WHAT CHOOSES BETWEEN THEM.
   * On a weekly board a row is one member's one week, so the figure is that
   * week's hours and the note beside it is the episodes behind them. On Proof
   * of #40HPW a row is one MEMBER, so the figure is how many weeks they have
   * cleared and the rest of the row describes the best of those weeks. It is
   * one function rather than two because everything to the left of the figure
   * is identical, and a second copy is the drift this module exists to
   * prevent. */
  const proof = m.weeks != null
  const h = Number(m.seconds) / 3600
  /* ⚠️ EVERY PROOF ROW IS GOLD, AND THAT IS THE BOARD RATHER THAN A MARKER
   * THAT HAS STOPPED MEANING ANYTHING. Gold has always meant "this week
   * cleared the goal" and it still does; on this board the entry test IS
   * clearing the goal, so the claim is true of every row by construction.
   * The comparison is the same one the endpoint's HAVING makes, on the same
   * raw seconds, so a row can never be on this board and not be gold. */
  const cleared = h >= goal
  const href = boosterPageHref(m.npub, m.pk)
  const name = m.name || (m.npub ? m.npub.slice(0, 12) + '…' : (m.pk || '').slice(0, 12) + '…')
  /* Promoted to https first (a mixed-content URL was unreachable as written),
   * then held to http(s) before it reaches `src` — the picture is third-party
   * kind-0 content. Anything else renders the initials. */
  const upgraded = httpsUrl(m.pic)
  const pic = isSafeUrl(upgraded) ? upgraded : null
  const face = pic
    ? `<img class="hpw-face" src="${esc(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="hpw-face hpw-face--none" aria-hidden="true">${esc(initials(m.name, m.pk))}</span>`
  /* ⚠️ ON PROOF OF #40HPW THE WEEK IS A BUTTON, AND IT IS THE PICKER'S REAL
   * DISCOVERY PATH. A menu of ninety-nine dated rows can only be scrolled; this
   * board already names the weeks worth looking at, so seeing Piez at 58.4h and
   * pressing the date beside it opens that whole week on the board above. The
   * menu is the escape hatch for a week nobody has heard of, not the way in.
   *
   * It sits OUTSIDE the name's anchor, in the row's second column: a button
   * nested inside a link is neither, which is the same call `.cs-boosts-btn`
   * makes on the booster page's rollup rows. */
  const weekTip = proof
    ? 'Show the whole board for this member’s best week'
    : 'Show the whole board for this week'
  const week = !m.week_start
    ? ''
    : weekHref
      ? `<a class="hpw-week hpw-week-jump" href="${esc(weekHref(weekDateString(m.week_start)))}"` +
        ` title="${esc(weekTip)}">${esc(weekLabel(m.week_start))}</a>`
      : `<button type="button" class="hpw-week hpw-week-jump" data-hpw-goweek="${esc(weekDateString(m.week_start))}"` +
        ` title="${esc(weekTip)}">${esc(weekLabel(m.week_start))}</button>`
  // The name links to that member's page — the same unconditional rule
  // booster-link.js applies everywhere, since a member is on this board only
  // because they boosted.
  const who = href
    ? `<a class="hpw-name" href="${esc(href)}">${esc(name)}</a>`
    : `<span class="hpw-name">${esc(name)}</span>`
  /* ⚠️ "hpw", NOT "h". Every row on a weekly board is one member's ONE week, so
   * the figure is hours per week and the unit is the name of the thing. On
   * Proof the figure is a count of those weeks, so the unit names them. */
  const figure = proof
    ? `<span class="hpw-hours">${esc(String(m.weeks))}<span class="hpw-unit"> wk${m.weeks === 1 ? '' : 's'}</span></span>`
    : `<span class="hpw-hours">${esc(hours(m.seconds))}<span class="hpw-unit"> hpw</span></span>`
  /* ⚠️ THIS COUNTS EPISODES THAT CONTRIBUTED HOURS, NOT EPISODES BOOSTED, and
   * the two differ often enough that the figure needs to say so. Reed read
   * the board against a member's own activity on 2026-08-24, saw four boosts
   * against "3 eps", and reported it as a bug — which is the right reaction to
   * a number that looks like a boost count and is not one.
   *
   * It cannot be the boost count: the hours beside it are the sum over
   * exactly these episodes, so printing 4 there would claim four episodes
   * produced 6.49 hours. What was missing was any way to connect the figure
   * to the rule. The tooltip does that; the Rules dialog carries the why.
   *
   * ⚠️ AND THE WEEKLY BOARD FEELS THIS HARDER THAN THE CORPUS RATE SUGGESTS.
   * Measured 2026-08-24: 2.2% of episodes across the index have no usable
   * duration, but 8.5% of the last 200 BOOSTS landed on one, because This
   * Week is made entirely of boosts on episodes that aired days ago — the
   * least likely to have been enriched. It self-heals as enrichment catches
   * up, which is why a row can gain an episode after the fact.
   *
   * ⚠️ PROOF SPENDS THIS SLOT ON THE BEST WEEK'S HOURS INSTEAD, because the
   * hours are what the count is a count OF and dropping them entirely would
   * leave a board about forty hours printing no hours anywhere. The episode
   * count moves into the tooltip rather than off the row. */
  const note = proof
    ? `<span class="hpw-eps hpw-best" title="Best week: ${esc(hours(m.seconds))} hours across ${esc(String(m.episodes))} episode${m.episodes === 1 ? '' : 's'} with a known length${m.week_start ? `, the week of ${esc(weekLabel(m.week_start))}` : ''}.">` +
        /* Plain text rather than a nested `.hpw-unit`: that class is sized
           0.72rem against `.hpw-hours`, which is LARGER than `.hpw-eps`'s
           0.7rem, so reusing it here would print the unit bigger than the
           figure it qualifies. This whole column is one muted size already. */
        `best ${esc(hours(m.seconds))} hpw</span>`
    : `<span class="hpw-eps" title="${esc(String(m.episodes))} episode${m.episodes === 1 ? '' : 's'} with a known length. Boosts to a show, or to an episode Podcast Index has no length for, add no hours and are not counted here.">` +
        `${esc(String(m.episodes))} ep${m.episodes === 1 ? '' : 's'}</span>`
  return `<li class="hpw-row${cleared ? ' hpw-row--gold' : ''}">` +
    `<span class="hpw-pos">${i + 1}</span>` +
    face +
    `<span class="hpw-who">${who}${week}</span>` +
    figure +
    note +
    `</li>`
}

/* `title` is escaped text; `titleHtml` is markup and overrides it. Only the
 * weekly board passes the second, and only because its title IS the picker —
 * see pickerHtml. Keeping the escaped path as the default is what stops the
 * next caller reaching for innerHTML by habit. */
function boardHtml({ title, titleHtml, sub, members, goal, empty, board, weekHref = null, card = false }) {
  /* `card` marks the list for the collector's clip guard (`data-card-list`);
   * only a card frame passes it (functions/_shared/card-frame.js). */
  const body = members.length
    ? `<ol class="hpw-list"${card ? ' data-card-list' : ''}>${members.map((m, i) => rowHtml(m, i, goal, { weekHref })).join('')}</ol>`
    : `<p class="hpw-empty">${esc(empty)}</p>`
  return `<section class="hpw-board"${board ? ` data-hpw-board="${esc(board)}"` : ''}>` +
    `<h3 class="hpw-title">${titleHtml || esc(title)}<small>${esc(sub)}</small></h3>` +
    body +
    `</section>`
}


/* The words, in one place, so the tab and the pages cannot drift by a
 * sentence. Every string here is user-visible board copy; the tab's own verbs
 * (the picker's tooltips, the Rules dialog) stay in members-board.js. */
const COPY = {
  challenge: 'Nostr Gang #40HPW Challenge',
  intro: 'Share boosts for 40 hours of podcasts in a week.',
  /* ⚠️ "Proof of #40HPW", AND IT REPLACED "High Scores" ON 2026-09-01.
   * *Reed's call.* High Scores was the arcade idiom the whole board was built
   * on, and it was the right one while clearing forty hours had happened twice
   * in the index's history: a table of the ten biggest weeks was then a table
   * of the only weeks worth naming. The collector's duration backfill took that
   * to twenty-three qualifying weeks, twenty of them one member's, so the
   * ten-row table became one name printed ten times. The board now answers who
   * has done it and how often, and the name says what a row is EVIDENCE of
   * rather than where it ranks. The arcade reading survives one board over,
   * where This Week still has a live race in it.
   *
   * ⚠️ THE URL DID NOT MOVE WITH THE NAME. The page is still `/hpw/high-scores`
   * and its card is still `high-scores.png`: that path is in the wild, the
   * collector's bot (bots/hpw-cards/) screenshots it by name, and
   * `functions/api/og/hpw/[name].js` allowlists the literal. A rename there
   * buys nothing a reader can see and costs a redirect, a bot change and an
   * allowlist entry. */
  proofTitle: 'Proof of #40HPW',
  proofSub: (goal) => `Every member who has cleared ${goal} hours in a week, and how many times.`,
  weekSub: (ws, isCurrent) => isCurrent
    ? `Resets midnight Monday, Pacific. Week of ${weekLabel(ws)}.`
    : `${weekSpan(ws)}. Weeks run Monday to Sunday, Pacific.`,
  emptyLive: 'No boosts with a known episode length yet this week.',
  emptyPast: 'Nobody boosted an episode with a known length that week.',
  emptyAll: 'Nobody has cleared the goal in a week yet.',
}

export { weekLabel, weekTitle, weekSpan, hours, initials, rowHtml, boardHtml, COPY }
