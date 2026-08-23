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
import { boosterPageHref } from '/assets/js/booster-link.js?v=ob-v125'
import { httpsUrl } from '/assets/js/cover-art.js?v=ob-v125'
import { htmlEscape } from '/assets/js/nostr-text.js?v=ob-v125'
/* ⚠️ THE SAME WALL /show AND /episode RENDER, not a copy of it. It moved out of
 * functions/_shared/detail-page.js into a two-sided module for exactly this;
 * that file re-exports every name, so both Functions were untouched. A reader
 * who screenshots the wall here and on a show page must not be able to tell
 * them apart. */
import { renderSupporters, initShowMore } from '/assets/js/supporter-wall.js?v=ob-v125'

const esc = htmlEscape
const HOURS_API = '/api/v1/members/hours'
const MEMBERS_API = '/api/v1/members'
const ROWS = 10
/* ⚠️ THE WALL IS CAPPED AT 100 AND SEARCH IS THE ROUTE TO EVERYONE ELSE.
 * Reed's call. On /show the wall holds one show's boosters — a median of one —
 * where site-wide it would hold 2,011, so an uncapped "Show N more" paints
 * nineteen hundred faces on one press. */
const WALL_CAP = 100

/* ⚠️ THREE VIEWS, BECAUSE THEY ARE THREE DIFFERENT PEOPLE. Sats ranks by
 * generosity and rewards one large boost; boosts rewards turning up; shows
 * rewards spreading it around. On the live corpus the leaders barely overlap,
 * so a single ordering would present one of them as "the" top member and hide
 * the other two stories. Reed's call. */
const WALL_VIEWS = [
  ['sats', 'Most sats'],
  ['boosts', 'Most boosts'],
  ['shows', 'Most shows'],
]
let wallView = 'sats'

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
    // ⚠️ "hpw", NOT "h". Every row on both boards is one member's ONE week, so
    // the figure is hours per week and the unit is the name of the thing.
    `<span class="hpw-hours">${esc(hours(m.seconds))}<span class="hpw-unit"> hpw</span></span>` +
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

/* The wall's rows, in the shape renderSupporters reads. That function is the
 * server's, so its field names are D1 column names rather than the API's — the
 * adapter is here rather than in the endpoint, because the endpoint's shape is
 * the one every other caller already consumes. */
function wallRows(members) {
  return members.map((m) => ({
    booster_pubkey: m.pk,
    booster_npub: m.npub,
    display_name: m.name,
    name: null,
    picture: m.pic,
    sats: m.sats,
    boosts: m.boosts,
    shows: m.shows,
  }))
}

/* The view switcher, built here rather than shipped in index.html because the
 * wall it acts on is client-rendered and there is nothing to switch until it
 * lands. Same shape as the feeds' sort control, deliberately. */
function viewsHtml(active) {
  return `<div class="mw-views" role="group" aria-label="Rank members by">` +
    WALL_VIEWS.map(([key, label]) =>
      `<button type="button" class="mw-view" data-view="${esc(key)}"` +
      ` aria-pressed="${key === active ? 'true' : 'false'}">${esc(label)}</button>`).join('') +
    `</div>`
}

async function wall(sort, signal) {
  const resp = await fetch(`${MEMBERS_API}?limit=${WALL_CAP}&sort=${encodeURIComponent(sort)}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`members: HTTP ${resp.status}`)
  const data = await resp.json()
  return Array.isArray(data?.members) ? data.members : []
}

/* The rules dialog. Wired once, alongside the boards, because it is the only
 * thing on this tab that is in the document before anything is fetched — a
 * reader can open it while the boards are still loading, or after they failed.
 *
 * ⚠️ ESCAPE AND THE SCRIM BOTH CLOSE IT, and focus goes back to the button that
 * opened it. Not a focus trap: this is five paragraphs and a close button, and
 * a trap that has to be escaped from is worse than a dialog you can tab past. */
function wireRules() {
  const modal = document.querySelector('[data-hpw-modal]')
  const open = document.querySelector('[data-hpw-rules]')
  if (!modal || !open || modal.dataset.wired) return
  modal.dataset.wired = '1'
  const show = () => {
    modal.hidden = false
    modal.querySelector('.hpw-modal-x')?.focus()
    document.addEventListener('keydown', onKey)
  }
  const hide = () => {
    modal.hidden = true
    document.removeEventListener('keydown', onKey)
    open.focus()
  }
  function onKey(e) { if (e.key === 'Escape') hide() }
  open.addEventListener('click', show)
  for (const el of modal.querySelectorAll('[data-hpw-close]')) el.addEventListener('click', hide)
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
  // Before the fetch, so the rules open even if the boards never arrive.
  wireRules()
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
    /* The wall goes below the boards, in its own container, and is fetched
       alongside them. It fails independently: a wall that cannot load leaves
       the boards standing, and vice versa. */
    const wallRoot = document.querySelector('[data-members-wall]')
    if (wallRoot) {
      await paintWall(wallRoot)
      /* Delegated, so it survives every repaint — the wall's markup is replaced
         wholesale each time the view changes. */
      wallRoot.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-view]')
        if (!btn || btn.dataset.view === wallView) return
        wallView = btn.dataset.view
        paintWall(wallRoot)
      })
    }
  } catch (err) {
    console.warn('[hpw] boards failed', err)
    root.innerHTML = '<p class="hpw-empty">The boards are unavailable right now.</p>'
    // Not 'done': approaching the tab again retries.
    root.dataset.hpwState = ''
  }
}

async function paintWall(wallRoot) {
      try {
        const rows = wallRows(await wall(wallView))
        wallRoot.innerHTML = rows.length
          ? viewsHtml(wallView) + renderSupporters(rows, {
              // ⚠️ "Members" HERE AND "Nostr Community" ON THE DETAIL PAGES.
              // One component, two words, deliberately: the protocol is not the
              // greeting, and a reader who has drilled into a show has chosen to
              // go deeper than one who just landed. See supporter-wall.js.
              heading: 'Members',
              id: 'members-wall',
              sectionClass: 'members-wall-section',
              metric: wallView,
              sub: `Everyone who has boosted a show, all time. Top ${WALL_CAP}.`,
              empty: '',
            })
          : ''
        // The wall ships its overflow hidden behind a "Show N more" button; the
        // handler is delegated, so one call covers every repaint.
        initShowMore()
      } catch (err) {
        console.warn('[members] wall failed', err)
      }
}
