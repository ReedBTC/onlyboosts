/* The 40 HPW boards, on the Members tab.
 *
 * Boost an episode and the board assumes you listened to all of it, then adds
 * up the durations. It is not a measurement of listening and the page says so.
 *
 * ⚠️ TWO BOARDS, AND THE SECOND ONE IS NOT A NICE-TO-HAVE. Nobody clears forty
 * hours: measured over all 9,977 booster-weeks since 2024-10, exactly two did,
 * both the same person, both in autumn 2025. Eight of the all-time top ten are
 * from 2025. So an all-time board on its own is a hall of fame nobody currently
 * reading can get onto, which is the opposite of a leaderboard — This Week is
 * the one with a live race in it, and it leads.
 *
 * The arcade idiom is Reed's: a high-score table, gold on anything over forty.
 * A repeated name is authentic to it rather than a bug to collapse — Piez holds
 * five of the top ten and that is the actual story of the board.
 */
import { boosterPageHref } from '/assets/js/booster-link.js?v=ob-v121'
import { httpsUrl } from '/assets/js/cover-art.js?v=ob-v121'
import { htmlEscape } from '/assets/js/nostr-text.js?v=ob-v121'

const esc = htmlEscape
const HOURS_API = '/api/v1/members/hours'
const ROWS = 10

/* en-US in UTC, matching every other date on the site. A board row names the
 * Monday its week started, so the reader can see the hall of fame is old. */
function weekLabel(unixSec) {
  if (!unixSec) return ''
  const d = new Date(Number(unixSec) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
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

function rowHtml(m, i, goal) {
  const h = Number(m.seconds) / 3600
  const cleared = h >= goal
  const href = boosterPageHref(m.npub, m.pk)
  const name = m.name || (m.npub ? m.npub.slice(0, 12) + '…' : (m.pk || '').slice(0, 12) + '…')
  const pic = httpsUrl(m.pic)
  const face = pic
    ? `<img class="hpw-face" src="${esc(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="hpw-face hpw-face--none" aria-hidden="true">${esc(initials(m.name, m.pk))}</span>`
  const week = m.week_start ? `<span class="hpw-week">${esc(weekLabel(m.week_start))}</span>` : ''
  // The name links to that member's page — the same unconditional rule
  // booster-link.js applies everywhere, since a member is on this board only
  // because they boosted.
  const who = href
    ? `<a class="hpw-name" href="${esc(href)}">${esc(name)}</a>`
    : `<span class="hpw-name">${esc(name)}</span>`
  return `<li class="hpw-row${cleared ? ' hpw-row--gold' : ''}">` +
    `<span class="hpw-pos">${i + 1}</span>` +
    face +
    `<span class="hpw-who">${who}${week}</span>` +
    `<span class="hpw-hours">${esc(hours(m.seconds))}<span class="hpw-unit"> h</span></span>` +
    `<span class="hpw-eps">${esc(String(m.episodes))} ep${m.episodes === 1 ? '' : 's'}</span>` +
    `</li>`
}

function boardHtml({ title, sub, members, goal, empty }) {
  const body = members.length
    ? `<ol class="hpw-list">${members.map((m, i) => rowHtml(m, i, goal)).join('')}</ol>`
    : `<p class="hpw-empty">${esc(empty)}</p>`
  return `<section class="hpw-board">` +
    `<h3 class="hpw-title">${esc(title)}<small>${esc(sub)}</small></h3>` +
    body +
    `</section>`
}

async function board(range, signal) {
  const resp = await fetch(`${HOURS_API}?range=${range}&limit=${ROWS}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`hours: HTTP ${resp.status}`)
  return resp.json()
}

/**
 * Fill the Members tab's boards. Idempotent by a marker, because the tab can be
 * activated many times and this is one fetch pair.
 *
 * ⚠️ IT NEVER THROWS AND IT NEVER BLOCKS THE BOOSTS FEED BELOW IT. The boards
 * are the top of a tab whose bottom half is a working feed; a failed fetch
 * leaves the section saying so and costs the reader nothing else. Same
 * discipline as the podroll queries on /show.
 */
export async function renderMembersBoards(root) {
  if (!root || root.dataset.hpwState === 'done' || root.dataset.hpwState === 'loading') return
  root.dataset.hpwState = 'loading'
  root.innerHTML = '<p class="hpw-empty">Loading the boards…</p>'
  try {
    const [week, all] = await Promise.all([board('week'), board('all')])
    const goal = week.goal_hours || all.goal_hours || 40
    root.innerHTML =
      boardHtml({
        title: 'This Week',
        sub: `Resets Monday. Week of ${weekLabel(week.week_start)}.`,
        members: week.members || [],
        goal,
        empty: 'No boosts with a known episode length yet this week.',
      }) +
      boardHtml({
        title: 'Hall of Fame',
        sub: `The best weeks ever recorded. Gold clears ${goal} hours.`,
        members: all.members || [],
        goal,
        empty: 'Nothing recorded yet.',
      })
    root.dataset.hpwState = 'done'
  } catch (err) {
    console.warn('[hpw] boards failed', err)
    root.innerHTML = '<p class="hpw-empty">The boards are unavailable right now.</p>'
    // Not 'done': approaching the tab again retries.
    root.dataset.hpwState = ''
  }
}
