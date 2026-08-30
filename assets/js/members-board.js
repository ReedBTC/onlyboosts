/* The 40 HPW boards, on the Members tab.
 *
 * Boost an episode and the board assumes you listened to all of it, then adds
 * up the durations. It is not a measurement of listening and the page says so.
 *
 * ⚠️ TWO BOARDS, AND THE SECOND ONE IS NOT A NICE-TO-HAVE. Almost nobody clears
 * forty hours: re-measured 2026-08-24 against the collector's derived durations,
 * TWO booster-weeks ever have (Piez, 54.7h in autumn 2025 and 40.2h in March
 * 2026) and nineteen have passed thirty. Six of the all-time top ten are
 * from 2025. So an all-time board on its own is a
 * hall of fame nobody currently reading can get onto, which is the opposite of
 * a leaderboard — This Week is the one with a live race in it, and it leads.
 *
 * ⚠️ AND THIS WEEK IS NOW A WEEK PICKER, which is the third thing the pair
 * needed: an all-time table names the great weeks and the live board names
 * this one, and until 2026-08-24 there was no way to look at any week in
 * between — including the one a reader had just missed. See pickerHtml.
 *
 * The arcade idiom is Reed's: a high-score table, gold on anything over forty.
 * A repeated name is authentic to it rather than a bug to collapse — Piez holds
 * five of the top ten and that is the actual story of the board.
 */
import { boosterPageHref } from '/assets/js/booster-link.js?v=ob-v156'
import { httpsUrl } from '/assets/js/cover-art.js?v=ob-v156'
import { htmlEscape } from '/assets/js/nostr-text.js?v=ob-v156'
/* ⚠️ THE SAME WALL /show AND /episode RENDER, not a copy of it. It moved out of
 * functions/_shared/detail-page.js into a two-sided module for exactly this;
 * that file re-exports every name, so both Functions were untouched. A reader
 * who screenshots the wall here and on a show page must not be able to tell
 * them apart. */
import { renderSupporters, initShowMore, compact } from '/assets/js/supporter-wall.js?v=ob-v156'
/* ⚠️ EXACT BOOST COUNTS HERE, COMPACT SATS. On the wall a row is one of a
 * hundred and `1k` is plenty; here there are four rows and the count is the
 * disclosure itself — "1,021 boosts from dozens of listeners" is the claim the
 * section exists to make, and `1k` rounds the evidence away. */
import { num } from '/assets/js/boost-list.js?v=ob-v156'
import { rangeControl, sortControl } from '/assets/js/feed-controls.js?v=ob-v156'
import { mountFeedSearch } from '/assets/js/feed-search.js?v=ob-v156'
import { searchMembers, SEARCH_HITS } from '/assets/js/ob-live.js?v=ob-v156'
/* ⚠️ THE SAME WEEK RULE THE ENDPOINT CUTS ON, not a second copy of it. That
 * module is two-sided for exactly this: the picker steps and enumerates weeks
 * without a round trip per press, and a Pacific week containing a DST
 * transition is 167 or 169 hours, so a client that stepped by a flat 604800
 * would drift an hour past every March and every November while still
 * producing Mondays. */
import { prevWeek, nextWeek, weekSeries, weekDateString, weekStartFromDate } from '/assets/js/pacific-week.js?v=ob-v156'
import { weekTitle, weekLabel, boardHtml, initials, COPY } from '/assets/js/hpw-board.js?v=ob-v156'
/* The share control: Post to Nostr, Copy link, Share image. A verb, mounted
 * onto each board after it is painted; the same module /hpw/<week> uses. */
import { mountShare } from '/assets/js/hpw-share.js?v=ob-v156'

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

/* ⚠️ THE ROWS ARE A TWO-SIDED MODULE NOW. `weekLabel`, `weekTitle`, `weekSpan`,
 * `hours`, `initials`, `rowHtml` and `boardHtml` lived here until the share
 * cards shipped (2026-08-29) and moved to `hpw-board.js`, where the edge can
 * import them too: `/hpw/<week>` and the card page the collector screenshots
 * paint the same rows this tab does, from the same function. The picker, the
 * jump buttons and the Rules dialog are verbs and stay here. */

/* ⚠️ THE TITLE IS THE PICKER, RATHER THAN A CONTROL ROW ABOVE OR BELOW IT.
 * Reed's call, 2026-08-24. The board's header is what a scoreboard navigates by,
 * so the arrows flank the word they change and nothing new is added to a tab
 * that already carries a range, a sort, a lookup and a rules dialog.
 *
 * ⚠️ ARROWS ARE THE PRIMARY AND THE MENU IS THE JUMP, and the split is about
 * what people actually ask for. "Last week" is one press on a 44px target that
 * behaves identically under a mouse and a thumb; a month grid would make that
 * common case a page-flip, and its unit is a DAY where the board's unit is a
 * week, so every pick would silently snap somewhere the reader did not tap. The
 * menu exists for the jump a year back, which is why it is behind the label
 * rather than in front of it — and why the High Scores rows above are wired as
 * jumps too.
 *
 * The menu is deliberately the site's own `.pcast-sort-menu`: this is the same
 * kind of choice the feeds' Sort pill makes and a second menu shape for one
 * idea makes the site look like two sites. Its LENGTH IS DATA — 99 weeks today
 * and one more every Monday — so it scrolls, exactly as the language menu does
 * for the same reason.
 *
 * Both arrows render even when disabled. A control that vanishes at the end of
 * a range moves the two beside it, so the header reflows as the reader walks
 * back through the weeks.
 *
 * ⚠️ THE THREE PIECES ARE ONE BORDERED GROUP, AND THE FIRST VERSION WAS NOT.
 * Reed's call, 2026-08-24, on seeing it: the arrows were transparent until
 * hover and the label wore the title's type, so the control was invisible at
 * rest and a touch device never saw the hover state that would have revealed
 * it. The segmented stepper is in `index.html` — everything here builds is the
 * same markup it always was, which is the point of the chrome living in CSS.
 *
 * ⚠️ THE CARET SPAN IS DELIBERATELY EMPTY. It held `▾` (U+25BE) inside a
 * Playfair element, and Playfair carries no such glyph — so it was already
 * falling through to whatever face the platform substituted, at whatever size
 * that face draws it. It is two borders and a rotation now, sized in CSS, the
 * same call `.drawer-hint`'s chevron makes. Putting a character back in here
 * stacks a glyph on top of the drawn one.
 */
function pickerHtml(ws, live, first) {
  const atNewest = !live || ws >= live
  const atOldest = first != null && ws <= first
  const arrow = (dir, glyph, label, off) =>
    `<button type="button" class="hpw-arrow" data-hpw-step="${dir}"` +
    ` aria-label="${esc(label)}" title="${esc(label)}"${off ? ' disabled' : ''}>${glyph}</button>`
  /* No menu without `first_week`: that query is allowed to fail quietly, and a
     menu built from a guess would offer weeks before the index begins as though
     they were empty rather than absent. The arrows still work, so nothing the
     reader can do is lost. */
  const weeks = (first != null && live) ? weekSeries(first, live) : []
  const menu = weeks.length
    ? `<div class="pcast-sort-menu hpw-weeks" data-hpw-menu hidden role="listbox">` +
        weeks.map((w) =>
          `<button type="button" class="pcast-sort-item${w === ws ? ' is-active' : ''}" role="option"` +
          ` aria-selected="${w === ws}" data-hpw-goweek="${esc(weekDateString(w))}">` +
          `${esc(weekTitle(w, live))}</button>`).join('') +
      `</div>`
    : ''
  const label = esc(weekTitle(ws, live))
  const pick = weeks.length
    ? `<button type="button" class="hpw-pick" data-hpw-pick aria-haspopup="listbox" aria-expanded="false"` +
      ` title="Pick a week">${label}<span class="hpw-pick-caret" aria-hidden="true"></span></button>`
    : `<span class="hpw-pick hpw-pick--static">${label}</span>`
  return `<span class="hpw-nav" data-hpw-nav>` +
    arrow('prev', '‹', 'Previous week', atOldest) +
    `<span class="hpw-pick-wrap">${pick}${menu}</span>` +
    arrow('next', '›', 'Next week', atNewest) +
  `</span>`
}

async function board(range, { signal, week } = {}) {
  const qs = new URLSearchParams({ range, limit: String(ROWS) })
  // Omitted for the live week, so the default board's URL is the one it has
  // always been and the edge cache is not split by a redundant parameter.
  if (week) qs.set('week', week)
  const resp = await fetch(`${HOURS_API}?${qs}`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!resp.ok) throw new Error(`hours: HTTP ${resp.status}`)
  return resp.json()
}

/* ══ THE WEEK PICKER'S STATE ══
 * Four values, module-scoped because the boards are painted as markup and
 * re-painted wholesale, so nothing can be hung off a live element.
 *
 * ⚠️ `liveWeek` AND `firstWeek` COME OFF THE ENVELOPE, NEVER OFF `Date.now()`
 * OR A CONSTANT. The client and the edge would otherwise disagree about which
 * Monday it is for the eight hours a Pacific week is behind UTC, and the picker
 * would offer a "next week" the endpoint answers as the current one. */
let liveWeek = null      // the Monday the index is standing in
let firstWeek = null     // the oldest week with any boost at all; the ◀ floor
let shownWeek = null     // the week on screen
let goalHours = 40
/* A reader stepping through weeks has several requests in flight and the slower
 * must not paint over the newer — the same guard `wallSeq` is. */
let weekSeq = 0

function weeklyBoardHtml(ws, members, isCurrent, empty) {
  return boardHtml({
    board: 'week',
    titleHtml: pickerHtml(ws, liveWeek, firstWeek),
    sub: COPY.weekSub(ws, isCurrent),
    members,
    goal: goalHours,
    empty,
  })
}

/* ⚠️ THE TITLE IS REPAINTED BEFORE THE FETCH, NOT AFTER IT. A press has to
 * register instantly or the reader presses again, and the week they asked for
 * is the one piece of information already in hand. What is NOT done is keeping
 * the previous week's rows under the new title: a failed fetch would then leave
 * last week's board sitting under this week's heading, which is the one outcome
 * this control must never produce. */
async function showWeek(root, ws, { scroll = false } = {}) {
  if (!root) return
  const mine = ++weekSeq
  shownWeek = ws
  const isCurrent = !liveWeek || ws >= liveWeek
  const paint = (html) => {
    const host = root.querySelector('[data-hpw-board="week"]')
    if (host) host.outerHTML = html
  }
  /* After the rows land, never on the loading paint: the address it shares is
     the week the SERVER resolved, and the loading board has no rows to share. */
  const share = () => {
    const el = root.querySelector('[data-hpw-board="week"]')
    if (el && shownWeek) mountShare(el, { key: weekDateString(shownWeek), title: `Week of ${weekLabel(shownWeek)}`, isLive: !liveWeek || shownWeek >= liveWeek })
  }
  paint(weeklyBoardHtml(ws, [], isCurrent, 'Loading the board…'))
  if (scroll) root.querySelector('[data-hpw-board="week"]')?.scrollIntoView({ block: 'nearest' })
  try {
    const data = await board('week', { week: isCurrent ? null : weekDateString(ws) })
    if (mine !== weekSeq) return
    /* ⚠️ RENDER THE WEEK THE SERVER RESOLVED, NEVER THE ONE WE ASKED FOR. The
       endpoint clamps a future or unparseable week to the live one rather than
       erroring, so the two can legitimately differ, and the board must not
       print a heading its rows do not belong to. */
    shownWeek = data.week_start || ws
    goalHours = data.goal_hours || goalHours
    if (data.current_week) liveWeek = data.current_week
    if (data.first_week) firstWeek = data.first_week
    paint(weeklyBoardHtml(
      shownWeek, data.members || [], data.is_current !== false,
      data.is_current !== false ? COPY.emptyLive : COPY.emptyPast,
    ))
    share()
  } catch (err) {
    if (mine !== weekSeq) return
    console.warn('[hpw] week failed', err)
    /* The picker survives the failure, which is the point of repainting it
       rather than replacing the whole board with an error line: the way out of
       a week that will not load is the arrow beside its name. */
    paint(weeklyBoardHtml(shownWeek, [], isCurrent, 'This week could not be loaded.'))
  }
}

/* One delegated listener for the whole boards block, wired once. The weekly
 * board's markup is replaced on every press, so a handler bound to an arrow
 * would not survive the press that used it; and the High Scores rows live in
 * the OTHER board, which is never repainted, so a single delegate is the only
 * shape that covers both without two wiring paths. */
function wirePicker(root) {
  if (!root || root.dataset.pickWired) return
  root.dataset.pickWired = '1'
  const closeMenus = () => {
    for (const m of root.querySelectorAll('[data-hpw-menu]')) {
      m.hidden = true
      m.closest('.hpw-pick-wrap')?.querySelector('[data-hpw-pick]')?.setAttribute('aria-expanded', 'false')
    }
  }
  root.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-hpw-pick]')
    if (pick) {
      const menu = pick.closest('.hpw-pick-wrap')?.querySelector('[data-hpw-menu]')
      if (!menu) return
      const open = menu.hidden
      closeMenus()
      menu.hidden = !open
      pick.setAttribute('aria-expanded', String(open))
      /* Ninety-nine rows deep, the week on screen is usually well below the
         fold of its own menu. Opening on it rather than at the top is what
         makes the menu a jump rather than a scroll. */
      if (open) menu.querySelector('.is-active')?.scrollIntoView({ block: 'center' })
      return
    }
    const go = e.target.closest('[data-hpw-goweek]')
    if (go) {
      closeMenus()
      const ws = weekStartFromDate(go.dataset.hpwGoweek)
      /* Scrolled because the jump can come from the High Scores board, which is
         BELOW the weekly one on a phone — pressing a date there would otherwise
         change a board the reader cannot see. `nearest` is a no-op on desktop,
         where the two sit side by side. */
      if (ws) showWeek(root, ws, { scroll: true })
      return
    }
    const step = e.target.closest('[data-hpw-step]')
    if (step && !step.disabled) {
      closeMenus()
      const from = shownWeek || liveWeek
      if (!from) return
      const to = step.dataset.hpwStep === 'prev' ? prevWeek(from) : nextWeek(from)
      if (firstWeek != null && to < firstWeek) return
      if (liveWeek && to > liveWeek) return
      showWeek(root, to)
    }
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.hpw-pick-wrap')) closeMenus()
  }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus() })
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
      `<div class="mb-section-head"><h2>Shoutout to the Boost Bots</h2>` +
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
    goalHours = goal
    /* Read before the first paint, because `pickerHtml` needs all three to
       decide which arrow is disabled and whether there is a menu at all. */
    liveWeek = week.current_week || week.week_start || null
    firstWeek = week.first_week ?? null
    shownWeek = week.week_start || liveWeek
    root.innerHTML =
      weeklyBoardHtml(
        shownWeek, week.members || [], week.is_current !== false, COPY.emptyLive,
      ) +
      boardHtml({
        board: 'all',
        // The words are hpw-board.js's COPY, shared with /hpw/high-scores.
        title: COPY.highScoresTitle,
        sub: COPY.highScoresSub(goal),
        members: all.members || [],
        goal,
        empty: COPY.emptyAll,
      })
    /* After the first paint, and once: the arrows and the menu live inside
       markup this line just wrote, and the listener is delegated so it survives
       every repaint after it. */
    wirePicker(root)
    const weekEl = root.querySelector('[data-hpw-board="week"]')
    if (weekEl && shownWeek) mountShare(weekEl, { key: weekDateString(shownWeek), title: `Week of ${weekLabel(shownWeek)}`, isLive: !liveWeek || shownWeek >= liveWeek })
    const allEl = root.querySelector('[data-hpw-board="all"]')
    if (allEl) mountShare(allEl, { key: 'high-scores', title: COPY.highScoresTitle, isLive: false })
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
