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
import { boosterPageHref } from '/assets/js/booster-link.js?v=ob-v132'
import { httpsUrl } from '/assets/js/cover-art.js?v=ob-v132'
import { htmlEscape } from '/assets/js/nostr-text.js?v=ob-v132'
/* ⚠️ THE SAME WALL /show AND /episode RENDER, not a copy of it. It moved out of
 * functions/_shared/detail-page.js into a two-sided module for exactly this;
 * that file re-exports every name, so both Functions were untouched. A reader
 * who screenshots the wall here and on a show page must not be able to tell
 * them apart. */
import { renderSupporters, initShowMore, compact } from '/assets/js/supporter-wall.js?v=ob-v132'
/* ⚠️ EXACT BOOST COUNTS HERE, COMPACT SATS. On the wall a row is one of a
 * hundred and `1k` is plenty; here there are four rows and the count is the
 * disclosure itself — "1,021 boosts from dozens of listeners" is the claim the
 * section exists to make, and `1k` rounds the evidence away. */
import { num } from '/assets/js/boost-list.js?v=ob-v132'
import { rangeControl, sortControl } from '/assets/js/feed-controls.js?v=ob-v132'
import { mountFeedSearch } from '/assets/js/feed-search.js?v=ob-v132'
import { searchMembers, SEARCH_HITS } from '/assets/js/ob-live.js?v=ob-v132'

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
 * the other two stories. Reed's call.
 *
 * ⚠️ IT IS THE FEEDS' OWN `sortControl` NOW, not a segmented group of its own.
 * Reed's call, 2026-08-23: this is the same kind of choice the feeds' Sort pill
 * makes, so it is the same control. A second shape for one idea makes the site
 * look like two sites. */
const WALL_VIEWS = [
  ['sats', 'Most sats'],
  ['boosts', 'Most boosts'],
  ['shows', 'Most shows'],
]
/* ⚠️ `shows` IS THE DEFAULT, NOT `sats`. Reed's call, 2026-08-23. Sats ranks by
 * generosity, which one large boost can win; breadth is the ordering that
 * rewards listening across the network, which is what a wall of MEMBERS is a
 * claim about. The other two are one press away. */
let wallView = 'shows'

/* ⚠️ THE RANGE MEANS WHEN THE BOOST WAS SENT, which is the reading
 * /api/v1/podcasts and every `#boosts` section give it, and NOT the air-date
 * reading /api/v1/episodes gives the same word. A member is in the 1W wall
 * because they boosted this week.
 *
 * All four, not the Boosts feed's three: that feed WALKS month archives to
 * cover a window, so a year is ~70 sequential requests before the first card.
 * This is one indexed query whatever the window, so 1Y costs nothing. */
const WALL_RANGES = [
  ['1w', '1W'],
  ['1m', '1M'],
  ['1y', '1Y'],
  ['all', 'All'],
]
let wallRange = 'all'

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

/* ⚠️ THE CONTROLS ARE BUILT ONCE AND MOVED, NEVER REBUILT. The wall's markup is
 * replaced wholesale on every change, so a control rendered inside it would be
 * destroyed by the repaint it just triggered — losing its open menu, its
 * listeners and the focus the reader is holding. `appendChild` moves a live
 * node, so state survives.
 *
 * They are the feeds' own `rangeControl` and `sortControl`, wrapped in the same
 * `.pcast-controls` row, so the wall's chrome and a feed's chrome are one
 * thing. Order matches the feeds: filters, then ordering. */
let wallControls = null
function mountWallControls(host, onChange) {
  if (wallControls) return wallControls
  wallControls = document.createElement('div')
  wallControls.className = 'pcast-controls'
  wallControls.append(
    rangeControl(wallRange, (key) => { wallRange = key; onChange() }, {
      options: WALL_RANGES,
      label: 'Filter members by when they boosted',
      titleFor: (key, label) => (key === 'all'
        ? 'Every boost in the index'
        : `Members who boosted in the last ${label.toLowerCase()}`),
    }),
    sortControl(WALL_VIEWS, wallView, (key) => { wallView = key; onChange() }, {
      title: 'Rank members by',
    }),
  )
  host.replaceChildren(wallControls)
  return wallControls
}

async function wall(sort, range, signal) {
  const qs = new URLSearchParams({ limit: String(WALL_CAP), sort, range })
  const resp = await fetch(`${MEMBERS_API}?${qs}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`members: HTTP ${resp.status}`)
  const data = await resp.json()
  return Array.isArray(data?.members) ? data.members : []
}

/* The id the Rules dialog links to, and the only thing that makes that link
 * work — the section is client-rendered, so nothing in index.html can carry it. */
const BOTS_ID = 'boost-bots'

/* ⚠️ THE BOTS SECTION IS THE WALL'S EXCLUSION, SHOWN. `/api/v1/members` drops
 * four publisher keys from every ranked listing because one of them stands in
 * for dozens of listeners; `?publishers=1` asks for exactly those four, so what
 * the wall removes is named directly under it rather than silently missing.
 * Reed's call, 2026-08-23: "either way we need to be transparent about anything
 * we are NOT including on this page".
 *
 * ⚠️ AND IT IS CREDIT, NOT A DISCLOSURE NOTICE. These accounts are the only
 * reason a listener who wants no Nostr account is represented here at all, so
 * the section carries their totals and links to their pages the way any other
 * member's row does.
 */

/* What each key does, keyed by pubkey and maintained BY HAND, which is the same
 * discipline PUBLISHERS itself is under: naming an account a bot is a claim,
 * and nothing detects these automatically.
 *
 * ⚠️ A KEY WITH NO ENTRY STILL RENDERS. The server owns the list and this table
 * owns the prose, so a fifth publisher added to PUBLISHERS appears here with its
 * figures and no description — which is a row missing a sentence, where the
 * alternative is a bot the section quietly fails to disclose. */
const BOT_ROLES = {
  f3bd42a91af5f3f1c40ca45ad2269464ab79996b32da78e8ed2ab91111b08e65:
    'Republishes boosts sent from Castamatic, StableKraft, PodcastGuru, CurioCaster and a dozen more apps that publish nothing to Nostr.',
  d35ae076512c29b01a5b33aa764ed4db44a9d0bbd96009705f48101f6cfe76a2:
    'Publishes boosts sent to music feeds through a Lightning address.',
  c330881e28768381dd8bdfd274341dca0c5882c29b8642ea4bc82f7563264592:
    'Publishes for a Local Bitcoiners donor whose own boost produced no note.',
  '3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9':
    'Signs a note for a boost sent from this site by someone with no Nostr identity.',
  /* ⚠️ BOOSTMEBITCH IS ALSO AN APP A MEMBER CAN JOIN THROUGH, and that is not a
     contradiction: it signs under the donor's own key when they have one, and
     under this account when they do not. Exactly the arrangement above. */
  '3820f4ff8587747530c7feafe47c1e592e3ce0fd2929b4f907e40714bd26f408':
    'Signs a note for a boost sent from boostmebitch.com without a connected identity.',
}

async function bots(signal) {
  /* Sorted by boosts rather than sats: lnaddress-music carries no sats figure at
     all, so a sats ordering puts the emptiest row in a fixed last place that
     reads as a ranking. */
  const resp = await fetch(`${MEMBERS_API}?publishers=1&sort=boosts&limit=20`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`publishers: HTTP ${resp.status}`)
  const data = await resp.json()
  return Array.isArray(data?.members) ? data.members : []
}

function botRowHtml(m) {
  const href = boosterPageHref(m.npub, m.pk)
  const name = m.name || (m.npub ? m.npub.slice(0, 12) + '…' : (m.pk || '').slice(0, 12) + '…')
  const pic = httpsUrl(m.pic)
  const face = pic
    ? `<img class="bots-face" src="${esc(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="bots-face bots-face--none" aria-hidden="true">${esc(initials(m.name, m.pk))}</span>`
  const role = BOT_ROLES[m.pk]
  return `<li class="bots-row">` +
    (href ? `<a class="bots-link" href="${esc(href)}">${face}</a>` : face) +
    `<span class="bots-who">` +
      (href ? `<a class="bots-name" href="${esc(href)}">${esc(name)}</a>`
            : `<span class="bots-name">${esc(name)}</span>`) +
      (role ? `<span class="bots-role">${esc(role)}</span>` : '') +
    `</span>` +
    `<span class="bots-figs">` +
      `<span class="bots-fig">${esc(num(m.boosts))}<small> boosts</small></span>` +
      `<span class="bots-fig">${esc(compact(m.sats))}<small> sats</small></span>` +
    `</span>` +
  `</li>`
}

/* ⚠️ A FAILED FETCH LEAVES NOTHING BEHIND, and that is the one case worth
 * thinking about: an error line here would read as "something is being hidden
 * from you", which is the opposite of what the section is for. The claim it
 * makes is additive, so its absence costs a reader nothing they were promised.
 * The wall above is unaffected either way. */
async function paintBots(root) {
  try {
    const members = await bots()
    if (!members.length) return
    /* ⚠️ THE SAME HEAD MARKUP THE OTHER THREE SECTIONS SHIP. Reed's call,
       2026-08-23: the four blocks on this tab read as four loose things
       stacked in a column, so they now share one head structure and one set of
       rules rather than each styling its own heading. */
    root.id = BOTS_ID
    root.innerHTML =
      `<div class="mb-section-head"><h2>Boost Bots</h2>` +
      /* ⚠️ TWO SENTENCES, AND THE LINK CARRIES THE REST. Reed's call,
         2026-08-23: the first version ran four and turned a short section into
         a paragraph with a list under it. What has to be said here is what
         these accounts are and that they are deliberately not ranked; why the
         rule exists, and what it costs, is /about#bots. */
      `<p class="mb-section-sub">These accounts publish boost notes for listeners whose apps do not. ` +
      `Their boosts count everywhere on this site, but they are left off the rankings above. ` +
      `<a class="bots-more" href="/about#bots" target="_blank" rel="noopener">How this works</a></p></div>` +
      `<ul class="bots-list">${members.map(botRowHtml).join('')}</ul>`
  } catch (err) {
    console.warn('[members] bots failed', err)
  }
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

  /* ⚠️ A LINK OUT OF THE DIALOG CLOSES IT FIRST. A bare in-page anchor scrolls
     the document behind the scrim, so the reader arrives at the right section
     with the rules still over it. Closing also returns focus to the Rules
     button, which is why focus is moved to the target explicitly afterwards.
     `getElementById`, never a selector built from the attribute: the value is
     markup here, but the same rule detail-page.js#revealHashTarget follows. */
  for (const el of modal.querySelectorAll('[data-hpw-goto]')) {
    el.addEventListener('click', () => {
      const target = document.getElementById(el.dataset.hpwGoto)
      hide()
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      /* The section is a plain <section>, so it takes focus only if told it
         can; removed again so it never becomes a tab stop. */
      target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
    })
  }
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
  /* ⚠️ ALSO BEFORE THE FETCH, and for the same reason. The lookup leads the tab
     and needs no data of its own, so a reader can find somebody while the
     boards are still loading or after they have failed. It is what this tab is
     FOR; making it wait on two leaderboards would be the old mistake in a new
     place. */
  mountMemberLookup(document.querySelector('[data-members-block]'))
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
        // "High Scores" rather than "Hall of Fame", Reed's call 2026-08-23. It
        // is the arcade idiom the whole board is built on, and a hall of fame
        // is a place you are inducted into where a high-score table is one you
        // get onto by playing — which is the invitation This Week is making.
        title: 'High Scores',
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
      /* Built before the first paint, so the controls are on screen while the
         first query is in flight rather than appearing under the reader's
         cursor when it lands. */
      const host = wallRoot.querySelector('[data-members-controls]')
      if (host) mountWallControls(host, () => paintWall(wallRoot))
      await paintWall(wallRoot)
    }
    /* Below the wall, and started after it: this section explains what is
       missing from the wall, so it must never be the thing that delays it.
       Not awaited — the boards are 'done' either way, and a bots section that
       never lands must not leave the tab looking unfinished. */
    const botsRoot = document.querySelector('[data-members-bots]')
    if (botsRoot) paintBots(botsRoot)
  } catch (err) {
    console.warn('[hpw] boards failed', err)
    root.innerHTML = '<p class="hpw-empty">The boards are unavailable right now.</p>'
    // Not 'done': approaching the tab again retries.
    root.dataset.hpwState = ''
  }
}

/* ⚠️ EVERY REPAINT IS A QUERY, exactly as the ranked feeds' range and sort are.
 * Filtering the loaded hundred in the browser would rank a member against the
 * ninety-nine who happened to lead all-time, and could only ever find people
 * inside that prefix.
 *
 * `seq` guards the reply: a reader pressing 1W then 1M has two requests in
 * flight, and the slower one must not paint over the newer. */
let wallSeq = 0
async function paintWall(wallRoot) {
  const body = wallRoot.querySelector('[data-members-wall-body]') || wallRoot
  const controlsHost = wallRoot.querySelector('[data-members-controls]')
  const headHost = wallRoot.querySelector('[data-members-wall-head]')
  const mine = ++wallSeq
  try {
    const rows = wallRows(await wall(wallView, wallRange))
    if (mine !== wallSeq) return
    /* ⚠️ THE EMPTY CASE GOES THROUGH renderSupporters TOO, and that is not
       tidiness. A hand-written "nothing here" paragraph has no heading in it,
       so moving the head out left an untitled section; and it replaced the
       whole body, taking the shell and its lid with it — so a reader who
       narrowed to 1W and found nobody lost the range control that would have
       widened it again. The dead end was the bug, not the empty list. */
    body.innerHTML = renderSupporters(rows, {
          // ⚠️ "Members" HERE AND "Nostr Community" ON THE DETAIL PAGES.
          // One component, two words, deliberately: the protocol is not the
          // greeting, and a reader who has drilled into a show has chosen to
          // go deeper than one who just landed. See supporter-wall.js.
          heading: 'Members',
          id: 'members-wall',
          sectionClass: 'members-wall-section',
          metric: wallView,
          /* ⚠️ NO SUB-LINE. Reed's call, 2026-08-23. It said "Everyone who has
             boosted a show, all time. Top 100." — a definition the reader has
             already been given by the intro at the top of the tab, a window the
             range control beside it already names, and a cap nobody asked
             about. Three restatements in one line. `.show-section-sub:empty`
             is what keeps the empty <p> renderSupporters always emits from
             costing a blank line. */
          sub: '',
          empty: 'Nobody boosted a show in this range.',
        })
    /* ⚠️ THE HEADING IS LIFTED OUT OF THE SHELL. renderSupporters owns the word
       ("Members" here, "Nostr Community" on the detail pages) so it is rendered
       inside its section and moved, never written a second time up here where
       the two copies could disagree. The controls stay where the markup put
       them, as the shell's lid — a lid belongs to the box, not to the heading
       above it. */
    /* ⚠️ TWO SHAPES, BECAUSE renderSupporters HAS TWO. A populated wall wraps
       its heading in `.show-section-head`; the empty branch emits a bare <h2>.
       Selecting only the first left the empty view untitled. */
    const head = body.querySelector('.show-section-head') || body.querySelector('h2')
    if (headHost && head) headHost.replaceChildren(head)
    if (controlsHost) controlsHost.hidden = false
    // The wall ships its overflow hidden behind a "Show N more" button; the
    // handler is delegated, so one call covers every repaint.
    initShowMore()
  } catch (err) {
    if (mine !== wallSeq) return
    console.warn('[members] wall failed', err)
  }
}

/* ⚠️ THE LOOKUP NAVIGATES; IT DOES NOT FILTER. Reed's call, 2026-08-23. It was
 * a filter over the Boosts feed's loaded window, which is the bug that put it
 * inside that panel in the first place — a reader had to reach the feed to find
 * the control that finds people. The question it answers is "where is this
 * person", and the answer is `/booster/<npub>`: their whole history, their
 * shows, their totals, rather than a narrowed slice of one feed.
 *
 * ⚠️ IT IS THE SHARED WIDGET, so the debounce, the abort, the sequence guard
 * and the keyboard handling are the four ranked feeds' own. The suggestion rows
 * are `role="option"` buttons rather than anchors because that is what a
 * combobox listbox is; the navigation lives in onPick. */
function mountMemberLookup(block) {
  if (!block || block.dataset.findWired) return
  block.dataset.findWired = '1'
  mountFeedSearch(block, {
    placeholder: 'Find a member by name or npub…',
    label: 'Find a member',
    noun: 'member',
    glyph: '👤',
    /* ⚠️ THE ENDPOINT'S SEARCH IS DELIBERATELY NOT RANGE-SCOPED AND DOES NOT
       EXCLUDE PUBLISHERS. A ranked listing is a claim; this is a lookup, and a
       member who last boosted in March is still the person being looked for. */
    searchRemote: async (q, { signal } = {}) => {
      const found = await searchMembers({ q, limit: SEARCH_HITS, signal })
      return found.map((m) => ({
        key: m.pk,
        href: boosterPageHref(m.npub, m.pk),
        label: m.name || (m.npub ? m.npub.slice(0, 12) + '…' : m.pk.slice(0, 12) + '…'),
        sub: `${num(m.boosts)} boost${m.boosts === 1 ? '' : 's'} · ${compact(m.sats)} sats`,
        img: m.pic,
      }))
    },
    onPick: (entry) => {
      /* A clear passes null. Nothing to undo — the list was never filtered. */
      if (entry?.href) window.location.assign(entry.href)
    },
  })
}
