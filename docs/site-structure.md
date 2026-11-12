# Site Structure

**Moved verbatim out of `CLAUDE.md` on 2026-11-11**, when that file had grown to 200KB and was
loaded into every session's context. Nothing was rewritten on the way across, so
`git log -S <phrase> -- CLAUDE.md` still finds the history of any paragraph here. Where a
paragraph says "this file", "above" or "below", it means the old `CLAUDE.md`; the four
files it became are `docs/site-structure.md`, `docs/architecture.md`,
`docs/feature-rules.md` and `docs/data-pipeline.md`. `CLAUDE.md` keeps the rules a change
elsewhere would break and points here for the reasoning.

## Pages

| Path | What |
|---|---|
| `/` | **the discovery homepage since 2026-10-17**: rails of tiles (this week's shows, this month's albums, the #40HPW week, the personal rails, the three discovery instruments, the Because rails, the year's episodes and songs; the week's artists came off on 2026-10-21), the fact rails edge-rendered by `functions/index.js`. See **The Discovery Homepage** below |
| `/podcasts/shows`, `/podcasts/episodes` | **the Podcast Charts** (2026-10-21): one chart per page, switched by the page head's underlined tabs, the chart box (scope, range, language, sort) under it. The bare `/podcasts` is Shows. See **The Chart Pages** below |
| `/music/artists`, `/music/albums`, `/music/songs` | **the Music Charts**, the same shape; the bare `/music` is Artists |
| `/boosts` | **the boost feed on its own page** (2026-10-21, Reed's call: readers treat it as their discovery feed). Global or Follows, newest first |
| `/members` | the Top Members wall and the Boost Bots section, with the membership line |
| `/charts`, `/charts/podcasts`, `/charts/music`, `/charts/hpw` | **the weekly boards' own page, named Charts** (2026-10-21): the week's Top 10 beside Weeks at #1 for shows and for artists, and the #40HPW week beside Proof of #40HPW, one pair per view. The bare `/charts` is Podcasts. From 2026-10-17 to 2026-10-21 `/charts` was the hash-routed feed page that was `/` before that; **every `/charts#<feed>` and `/#<feed>` address in the wild is forwarded to its page by the head scripts of `charts.html` and `index.html`**, since a server never sees a hash. All five pages are one shell, `charts.html`, routed by `functions/_shared/charts-page.js` |
| `/show/<guid>` | one show, edge-rendered |
| `/episode/<item-guid>` | one episode, edge-rendered |
| `/booster/<npub>` | one person, edge-rendered. **The address is the npub**: a hex pubkey in its place 301s to the npub form (Reed's call, 2026-11-08; the homepage's full-list link had emitted hex) |
| `/artist/<guid>` | one artist (publisher), edge-rendered — see the detail pages section |
| `/search?q=` | the site search's results page, edge-rendered, `noindex` (2026-10-17) |
| `/discover/<key>` | **the whole list behind a discovery rail** (2026-10-20, Reed's ask: ten tiles lived nowhere else): `new-shows`, `new-music`, `movers`, `podroll`, each a list of the charts page's show cards with one extra line saying why the card is there, rendered by `functions/discover/[key].js` from the same row fetchers `functions/index.js` exports for the rails (`newShowsRows`, `moversRows`, `podrollRows`), in the `discover.html` shell. In the sitemap. The rail headings and the ribbons' Discover columns link them |
| `/about` | the project's own explanation of what the data is and isn't |
| `/stats` | a coming-soon placeholder: nav + header + soon-card, `noindex`, out of the sitemap. `/boosters` was the second one and was **deleted** on 2026-08-23 — see the Stats row of the site map |
| `/404.html` | see the ⚠️ under LB conventions |
| `/hpw/<YYYY-MM-DD>`, `/hpw/high-scores` | one 40 HPW board as a page, edge-rendered, the address a shared week has. **⚠️ `high-scores` is a PATH, not the board's name** — that board is **Proof of #40HPW** since 2026-09-01 and the URL deliberately did not move with it. `/hpw/<key>/card` is the 720x900 portrait frame the collector screenshots for `/api/og/hpw/<key>.png`. See **The Share Cards** under the Members tab |
| `/charts/<key>/card/<kind>` | the five chart share-card frames (`shows`/`artists` per week, `shows`/`artists`/`members` under `weeks-at-1`), 720x900, noindex; the collector's bot screenshots them. **⚠️ THE ONLYBOOSTS CHARTS PAGE THAT LIVED AT `/charts/<YYYY-MM-DD>` WAS TORN DOWN ON 2026-09-04** (Reed's call, two days after it shipped): the same boards live on the Shows and Artists feeds and the Members tab, so `/charts` and `/charts/<date>` 302 to `/#shows`. `week-charts.js` still serves the queries, behind `/api/v1/charts`. **Untitled shows are off these boards and only these** (Reed's call, 2026-09-11; `TITLED` in `week-charts.js`). See **The chart blocks on the feeds** in `docs/feeds.md` |

`/shows` 301s to `/podcasts/shows` (`_redirects`); the `/podcasts` redirect came
off on 2026-10-21 because the Function serves that path now. `feeds.html` and
`boosts.html` were folded into the feed page and deleted.

**⚠️ EVERYWHERE THIS FILE SAYS `index.html` ABOUT THE FEED BAR, THE TABS, THE
CONTROLLER OR THE SSR MARKERS, IT MEANS `charts.html` SINCE 2026-10-17.** The
file was moved, not rewritten; only the address changed. `test-feed-hash.mjs`
and `test-server-render.mjs` read `charts.html` now. **AND SINCE 2026-10-21
`charts.html` IS THE SHELL OF FIVE PAGES, NOT ONE**: the three tabs and the
sub-row are gone, the hash router became a path router, and the sections
below that describe the tabs, the sub-row, `TAB_OF`, `TAB_DEFAULT`,
`ALIASES`, `HASH_OF` and the view in the hash are history kept for the
decisions they record. **The Chart Pages** below is the current shape.

## The Chart Pages

**One charts page became five pages on 2026-10-21** (Reed's call: readers
"don't get" a page with three big tabs, and the weekly boards above the
charts were distracting from the charts themselves). The options he picked
from are in the session memory (A2, underlined text tabs; the boards page
named Charts).

| Page | Views | What it holds |
|---|---|---|
| `/podcasts` | `shows`, `episodes` | the Podcast Charts, the chart box as it was |
| `/music` | `artists`, `albums`, `songs` | the Music Charts |
| `/boosts` | one | the boost feed, Global or Follows |
| `/members` | none | the Top Members wall, the Boost Bots, the membership line |
| `/charts` | `podcasts`, `music`, `hpw` | the weekly boards in three pairs, with their week pickers and share buttons |

- **⚠️ ONE SHELL, `charts.html`, SERVES ALL FIVE, AND THE ROUTE IS MARKED
  INTO IT TWICE.** `routeShell` in `functions/_shared/charts-page.js` sets
  `body[data-page]`, `body[data-view]` and `body[data-active-feed]` (absent
  on Members and Charts), un-hides the page's head and underlines its tab
  (`aria-current="page"`), activates the feed's panel, and rewrites the
  title, canonical and Open Graph pair; the inline controller re-derives
  the same route from `location` when it runs. The five route Functions
  (`functions/podcasts/[[path]].js`, `functions/music/[[path]].js`,
  `functions/boosts.js`, `functions/members.js`, the bare and one-segment
  paths of `functions/charts/[[path]].js`) each resolve a path and call
  `renderShellPage`; an unknown view answers the 404 page. The shell ships
  routed to `/podcasts/shows` for the no-script read.
- **⚠️ `PAGES` IS DECLARED TWICE AND PINNED TO THE NAV'S HREFS**: in the
  controller and in `charts-page.js`, each page's first view being what its
  bare path opens on (Shows, Artists, the Podcasts boards). `test-feed-hash.mjs`
  extracts the controller's and checks every feed type is a view of exactly
  one page.
- **A tab is a link, so switching charts is a navigation.** The controller
  rewrites each sibling tab's href with the active feed's view, so Shows at
  1Y opens Episodes at 1Y. Underlined text tabs (A2), Reed's pick over a
  segmented switch and over a menu on the lid; the latter was the
  what-dropdown the tabs replaced in August.
- **⚠️ THE VIEW IS THE QUERY STRING: `/podcasts/shows?scope=follows&lang=de&range=1m&sort=sats`.**
  The scope joined the three axes when the hash became a path (it was the
  feed key's `-follows` suffix). Defaults are elided, so the bare path is
  the default view's address. The controller normalizes the address on boot
  only when one of its four parameters was dropped or respelled, and leaves
  a parameter it does not own alone. `history.replaceState`, never push.
- **⚠️ THE HASH FORWARD IS TWO IDENTICAL HEAD SCRIPTS**, in `index.html`
  (for `/#feed`, the address until 2026-10-17) and `charts.html` (for
  `/charts#feed`, the address until 2026-10-21), mapping every key and alias
  the old controller resolved: `#shows` → `/podcasts/shows`, `#podcasts-global`
  → `/podcasts/episodes`, `#members-follows` → `/boosts?scope=follows`,
  `#boosts` → `/boosts`, the view carried. **A bare `#members` lands on
  `/charts/hpw`**, because the Members tab opened on the #40HPW boards and
  the #40HPW share notes link it. `test-discover-home.mjs` runs both shipped
  scripts against every address. **Change them together.**
- **⚠️ TWO FEEDS ARE RENDERED AT THE EDGE, EACH ON ITS OWN PAGE**: Shows on
  `/podcasts/shows` through `<!--OB:SSR-SHOWS-->` and Albums on
  `/music/albums` through `<!--OB:SSR-ALBUMS-->` (2026-10-21; the same
  renderer, the music side), both all time by Chart rank, skipped when the
  query carries a view. Episodes, Songs, Artists and Boosts hydrate in the
  browser as they always have.
- **The pages with no feed paint off the body**: `feeds.js` reads
  `body[data-page]` and `body[data-view]` at boot and calls
  `loadChartsBlock`, `loadMemberBoards` or `loadMembersWall`
  (`renderMembersWall` in `members-board.js`, split from the boards on
  2026-10-21). **A missing `data-active-feed` hydrates nothing**; the old
  `|| 'episodes-global'` fallback would have painted Episodes under the
  Members page.
- **The nav bar is Podcasts ▾ · Music ▾ · #40HPW ▾ · Charts · Boosts.** The
  #40HPW plain link of 2026-10-20 folded into Charts, where both its boards
  are, and the same evening Reed renamed the third ribbon from Members to
  #40HPW, opening `/charts/hpw` ("that's the only thing people go to that
  members thing for"); its key is still `data-ribbon="members"`, its
  Discover column still lists Top Members, and the footer keeps Members,
  `/members` being a page. The overlay's and the footer's group is
  **Browse** (it holds a Charts entry now). The ribbons' View all links: the weekly lists go to the
  Charts page, the year and month lists to the chart pages with the range.
- **What went with the tabs**: the masthead (the banner and tagline above
  the tabs; the nav bar carries the brand), `pinScroll` and the `#boosts`
  landing scroll of 2026-10-20 (nothing sits above a feed shell now),
  `lb:members-painted`, `hashchange`, and the Rules dialog's in-page jump to
  the bots (a real link to `/members#boost-bots`).

## The Discovery Homepage

**`/` is a page of rails since 2026-10-17** (Reed's project, modelled on
Rotten Tomatoes: "the PC 2.0 version of those sites"). The mockup canvas it
was picked from is in the session memory; direction A won, with the sans.

- **⚠️ THE RAIL ORDER IS REED'S AND NOTHING A SIGNED-OUT VISITOR CANNOT SEE
  COMES BEFORE THE FOURTH RAIL.** Top Shows This Week, Top Albums This
  Month, the #40HPW week, THEN Podcasts Recommended For You, Music
  Recommended For You, Top Shows From Your Follows and (2026-10-30, Reed's
  ask) Top Songs From Your Follows, `follows-songs` (since 2026-11-08 Latest
  From Podcasts You Follow, `follows-latest`, leads those four, behind the
  signed-out carrot), then New and
  Noteworthy, Movers and Podcasters Recommend, then the Because rails, then
  the year's episodes and songs. That is the evening-of-2026-10-21 order
  (Reed's final pass: the three discovery instruments moved up under the
  follows rail, the Because rails slid down, and **Top Artists This Week
  came off the page**, its renderer and fallback deleted; the Music ribbon's
  Discover column still links `/charts/music` under that name). The two
  recommendation rails were "Recommended For You" and "Recommended Music"
  until the same pass, and both carry the "Your full list" link now.
  **Since 2026-10-22 (Reed's ask, "let people scroll and scroll") three
  LANGUAGE RAILS sit between Podcasters Recommend and the Because rails,
  and the foot is ten WINDOW RAILS**: Episodes, Songs, Albums and Shows
  over the week, the month and the year, the two already at the head
  (Shows This Week, Albums This Month) not repeated, **podcasts before
  music** (episodes, shows, then songs, albums; Reed's order); `windowRail` in
  `functions/index.js`, trailing windows (`range=1w|1m|1y`, the window the
  link opens), no hero slide for any but the two year rails (the same
  subject tops all three windows). **The language rails are three SLOTS,
  `lang-1`..`lang-3`, whose marker pair wraps the heading too and sits
  tight against the `<section>`** (the heading names the language;
  `langRailHtml` in `rail-tile.js` renders head and track; an empty slot
  renders empty and `.rail:empty` hides it): `languageRails` takes the
  podcast side's non-English languages by boosts, `en` and NULL out, the
  first three whose year chart has `LANG_MIN_ROWS` (5; Reed's floor, set
  the same day a three-tile Italian rail went up at 3) rows, memoized per
  request on the `ctx` every rail now receives; `lang-1` leads a slide
  ("#1 German Podcast This Year"). German and Spanish on 2026-10-22, the
  third slot empty until a language reaches five. `assets/js/lang-name.js` is the two-sided subtag → English
  name (`feed-lang.js` reads it too). The Podcasts ribbon's Discover column
  links `/#rail-lang-1` as "Top Podcasts by Language".
  `test-discover-home.mjs` pins the first three, the personal rails'
  position, and the generic order.
- **THE FEATURED CAROUSEL SITS ABOVE THE RAILS AND IS THE FIRST PLACE OF
  EACH GENERIC RAIL, IN THE PAGE'S RAIL ORDER** (Reed's call, 2026-10-19,
  after the heroes on Rotten Tomatoes, IMDb and Fountain's discovery tab;
  he had turned the idea down on 2026-10-17 and asked for it two days
  later). Nothing editorial, nothing personal: the same nine slides for
  every visitor, so it is facts and the Function renders it. Each `RAILS`
  entry answers `{ html, lead }`, the lead being its first row as a slide
  spec from the two-sided `assets/js/hero.js` (`showSlide`, `episodeSlide`,
  `artistSlide`, `memberSlide`, `EYEBROWS`), so the hero costs no chart
  query; `buildHero` adds the one thing the rails do not carry, a
  description by primary key (`blurb` strips and clips it), allowed to fail
  per slide; `railOrder` reads the order off the shell; `injectHero` fills
  `<!--OB:HERO-->`, left in place when there is nothing to show. The shape
  is Fountain's, since the art is square: the artwork blurred as the
  backdrop, the art at left, the eyebrow (the rail's rule), title, figures,
  two lines of description, Open and Boost. **The Boost pill reuses the
  cards' own handlers**: the slide carries the same data attributes a show
  card or an episode card does and `discover.js` hands a click to the
  exported `onShowBoost` / `onBoostClick`, loaded on first use. The rotation
  (seven seconds, paused on hover, focus and touch, off under reduced
  motion and off screen), the arrows, the dots and the artwork fallback are
  `discover.js`; a rail the browser filled gets its slide added with the
  same mappers (no description: the endpoints do not carry one). Two
  trade-offs Reed accepted: the hero pushes the first rail down, most of a
  phone's first screen; and slide one repeats the first tile under it. The
  rails still start at #1. `/about#recommendations` says it is not an
  editorial pick.
- **A signed-out visitor with nothing imported sees ONE LOCKED RAIL, THE
  CARROT, in place of the four personal rails** (`data-rail="personal"`,
  "Log in or import your OPML for personalized recommendations"; Reed's
  call, 2026-11-08, after four locked cards in a row pushed everything a
  signed-out reader can see below them; from 2026-10-17 to then every
  personal rail showed its own locked card, the carrot being the sense of
  missing out on what logging in unlocks). **A personal rail is `hidden`
  until it has something to show** (`reveal` in `discover.js`, the one
  place a rail un-hides; the four ship `hidden` in `index.html`, so the
  no-script read is the signed-out state): the two Follows rails for any
  signed-in member, the two Recommended rails once the member has seeds
  (boosted shows or list entries; a member with neither sees the Follows
  rails alone), and for an imported list without an account each
  Recommended side that has rows, the podcast side with a note when both
  are empty. **AND THE CARROT STAYS UP UNTIL THE MEMBER HAS A SEED ON BOTH
  SIDES, SAYING WHAT IS MISSING** (Reed's second ask the same day:
  "advertising space to explain what the site is doing"): `CARROT` in
  `discover.js` holds the states (loading; signed out; an imported list,
  what logging in adds; no seeds; an empty list with boosts to seed from,
  "follow or favorite", Reed's boosted-once account; no podcast seed,
  "boost or follow a podcast"; no music seed, "favorite an album"), read
  off the endpoint's `sides` (`sidesOf` in `recommend.js`, the seeds
  counted per medium side) and the feeds the browser sent; **an empty
  Recommended rail is a hook with a button, never a shrug** ("No music to
  recommend from yet · Browse albums"); it
  leads the personal block when nothing personal is painted and follows it
  otherwise (`setCarrot` moves the section). The ribbons' Discover links to
  a hidden personal rail land on it. The locked track is a grid whose
  placeholder tiles and card share one cell, so the card sizes the track.
  The rail head's extras (the full-list link, the imported list's Manage)
  ride the `.rail-sub` line, never a third flex item, so the heading never
  wraps.
- **Every language is first class**: no language rail, no language default.
- **Fact rails are edge-rendered, personal rails are browser-only.** Each
  fact rail is an `<!--OB:RAIL:<key>-->` marker pair in `index.html` filled
  by `RAILS[key]` in `functions/index.js`; a rail that fails keeps its
  placeholder and `assets/js/discover.js` fetches the same endpoint and
  paints it with the same two-sided `assets/js/rail-tile.js`. The #40HPW rail
  renders the two-sided `hpw-board.js` board, not tiles.
- **The nav bar is direction A on every page** (`partials/nav.html`): logo and
  wordmark, the sections, the site search in the middle
  (`assets/js/nav-search.js`, loaded by `nav.js`, asking
  `/api/v1/search?type=all` and `/api/v1/members?q=`), the theme toggle,
  Donate, the account control. **A pasted npub, `nostr:npub…` or 64-hex
  pubkey is a MEMBER LOOKUP, not a search** (Reed's ask, 2026-10-22):
  `pubkeyQuery` in `nav-search.js` and again in `functions/search.js`
  (the two must agree) sends it to the member endpoint alone, the
  typeahead answers the member's row (Enter opens their page) or a "not in
  the index" line named through Primal's cache when it can be, and the
  results page says the same instead of "Nothing matched". On a phone the links fold into the
  hamburger's overlay and the search takes its own row. **The overlay's
  Charts group, the inline links and the footer's Charts group name the same
  places; change them together.**
- **THE SECTIONS ARE RIBBONS SINCE 2026-10-20: Podcasts · Music · #40HPW
  (Members until the evening of 2026-10-21, see The Chart Pages) each open a
  panel under the bar, then two plain links** (Reed's call,
  after Rotten Tomatoes' section menus). The plain links were #40HPW and
  Boosts for one day and are **Charts and Boosts since 2026-10-21**, when
  the boards got their own page under that name; see **The Chart Pages**. A
  ribbon is two top-five lists (Shows This Week + Shows This Year; Albums
  This Month + Songs This Year; #40HPW This Week + Largest Boosts This
  Week), a **Discover** column of that side's rails minus the two listed
  (the personal rails named, so a signed-out visitor sees what logging in
  unlocks), and the first list's #1 at the right. Each is a `<details>` so
  the caret opens it with no script; `assets/js/nav-ribbons.js` (loaded by
  `nav.js` like the search) adds hover, Escape and outside-click, and
  **fills the lists on first open from the chart endpoints**: the nav is a
  partial on static pages too, so the lists are never edge-rendered.
  `SOURCES` there is keyed by the partial's `data-ribbon-list` slots. The
  Members ribbon's second list is `/api/v1/boosts?sort=sats&range=1w`, the
  one ordering that endpoint has besides time (no cursor in it). On a phone
  the overlay's three section rows are accordions: the row opens the page,
  the chevron opens the Discover links. **Reed's wording rule: the boost
  feed's link is "Boosts", never "Live"**, which means something else in
  podcasting. **`/boosts` is the boost feed's own address since 2026-10-21**
  (the nav's Boosts link, the footer, the ribbon); it was `/charts#boosts`,
  an alias plus a pinned scroll, for one day, and that address forwards. The Discover
  links to homepage rails are `/#rail-<key>`, the rails' heading ids, under
  a `scroll-margin-top` for the sticky bar. `test-discover-home.mjs` pins
  the bar, the slots against `SOURCES`, the Discover columns, the overlay
  and footer in step, the forward and the alias, and the sats ordering.
- **`--font-sans` is Outfit** (`assets/fonts/outfit.woff2`, OFL, a variable
  file), used by the bar and the rails. The two serifs are still the display
  and body faces everywhere else; the typography item below is still open.
- **⚠️ THE THREE FIGURES HAVE ONE ORDER SITE-WIDE: SATS, BOOSTS, BOOSTERS**
  (Reed's call, 2026-10-29): the chart formula's order and the detail
  pages' stat tiles. The rail triplet, the weekly boards' triplet and
  column head, the card stats lines and every sort menu follow it (chart
  rank and the chronological sorts keep their places).
- **A tile's one line is the chart triplet** (rank in sats / boosts /
  boosters, each behind its icon since 2026-10-29: a Bitcoin sign, a speech
  bubble, a person, `rankTripletHtml` in `rail-tile.js`; Reed's ask, the
  words do not fit), printed "#6 / #2 / #3" (the number sign marks a
  place, not a count) and **never wider than the artwork**: the line is
  sized off the tile's width by its digit count (`rt-d3`..`rt-d9`,
  container units, measured in Chromium at 96 to 180px). **Each figure is pressable** (Reed's ask,
  2026-10-30): a click opens a small note, not the tile's link ("Ranked
  5th in sats this week", in the rail's own window and noun; `railScope`
  in `discover.js`, the explainer, caught in the capture phase). A new
  ranked rail key needs an entry there or its figures explain nothing. **A MIXED RAIL'S
  tiles carry a MEDIUM BADGE** (Podcasters Recommend, the one mixed rail
  since 2026-10-30, when Reed split New and Noteworthy into New and
  Noteworthy Podcasts and New and Noteworthy Music, `new-shows` and
  `new-music`, `/discover/new-music` the second's page; Movers is the Shows
  chart, one side, and is headed "Podcast Movers"): a light chip with an icon and the
  word ("Podcast", "Music") in the artwork's bottom-right corner
  (`mediumBadge`, printed only when the caller passes `medium`; the tile
  mappers pass none). Every other rail is one side and its HEADING says
  which: **"Podcasts", never "Shows", in the homepage's rail names and the
  ribbons** (Top Podcasts This Week, Top Podcasts From Your Follows, #1
  Podcast This Week; Reed's call, 2026-10-30), the two New and Noteworthy
  rails reading "New and Noteworthy Podcasts" and "New and Noteworthy Music". The chart pages' Shows
  view keeps its name. **Only a ranked rail prints the line**:
  the two Recommended rails, Top Shows From Your Follows and the Because
  rails map through `bare()` and show the title alone (Reed's call,
  2026-10-29), and the #40HPW tile reads "34.3 HPW", no episode count.
  New and Noteworthy's tiles print no line (the badge says the medium);
  New and Noteworthy and Movers explain themselves in the rail head (`.rail-more--note`) rather than linking a chart (Movers has none of its own);
  **a superlative names its population** ("more than any other show in the
  index"; Reed, 2026-10-30: the site's figures are this index's, never the
  world's);
  Reed's call after seeing "7 boosters · 38.8k sats" at tile size. The #40HPW
  rail is tiles too (face, name, "34.3 HPW", gold past the
  goal), not the board: every rail the same shape. **A person's tile is
  ROUND** (`person: true` → `.rail-tile--person`, Reed's call 2026-10-18: a
  circle reads as an individual, a square as content); the two member
  mappers set it and nothing else does.
- **`/search?q=` is the results page, AND IT IS A LIST, NOT RAILS**
  (`search.html` + `functions/search.js` + `assets/js/search-page.js`).
  Reed's rule, 2026-10-18: the sideways tile rail is the HOMEPAGE's shape;
  anything deeper (a search, the full charts, research) is a list like the
  charts page. So every hit is the charts page's own card (show-card,
  episode-card with the lazy drawer, publisher-card, and the Members tab's
  wall for members), rendered at the edge through the three ranked
  endpoints' own `q=` paths in process, so **a hit wears the chart rank it
  holds on the unfiltered all-time chart**, and `search-page.js` attaches
  the same verbs the feeds attach. Groups: shows, albums, episodes, songs,
  artists, members, each linking its chart. `noindex`. Enter in the nav
  field goes there (Reed's call: a typed query deserves every hit, not the
  first); an arrow-key pick still goes to its row. `_shared/search-all.js`
  is the typeahead's alone now.
- **The foot of the page is ONE STRIP INTO THE BOOST FEED** (`.rail-cta`,
  `/boosts` since 2026-10-21; `/charts#members` before, which forwards), not
  boost rows. The newest twelve rows sat there from
  the 2026-10-17 feedback round until 2026-10-18, when Reed traded them for
  the Because rails; the whole feed with its controls is the Boosts page,
  and the nav's Boosts link already lands on it. Ideas for a stronger
  one-click (a Live pill in the nav bar, a ticker of the newest boost) are
  open with Reed.
- **The personal rails are `POST /api/v1/recommend`** (`{pubkey,
  favorites?}` → `{seeds, podcasts, music, because}`): the member's boosted
  shows, plus the favorites the browser hands over, are the seeds; the
  collector's `show_similar` scores (distinct-booster cosine, top 20 per
  show, daily full replace) are summed over them, seeds excluded, **floor:
  reached from two seeds or two boosters shared with one** (half of all
  pairs share exactly one booster, measured 2026-10-17). Two lists, never
  one: the music side's overlap runs nearly three times the podcast side's.
  **`because` is up to FIVE rails, one per seed, THE SEEDS WITH THE MOST TO
  SHOW FIRST AND NONE UNDER FOUR TILES** (Reed's ask, 2026-10-18 for the
  rails; 2026-10-22 for the pick: "we should pick the biggest ones", after
  a two-tile rail beside a ten-tile one and the question why those five).
  `becauseOf` reads the `BECAUSE_POOL` (12) most-boosted seeds with
  neighbours over the floor, then picks greedily: the seed with the most
  neighbours not yet shown, re-counted after every pick since a show
  appears under one rail only, until five or until no seed has
  `BECAUSE_MIN` (4) left. Until 2026-10-22 it was the five most-boosted
  seeds in boost order, any size. Cloned by `discover.js` from the hidden
  prototype section. Nothing is stored per
  member. **A podcast whose newest episode is over 183 days old is not
  recommended** (Reed's call, 2026-10-29; podcast side only, NULL kept),
  off `podcasts.newest_item_ts`, the newest item's datePublished from PI episodes/byfeedid, a
  collector column briefed to OB-back the same day; until it exists the
  query falls back to unfiltered on "no such column". **The Because rails are deliberately NOT filtered** (Reed's call, 2026-10-30, after seeing the cut: 223 of 639 podcast-side shows at 183 days); `becauseOf` carries no date clause. **The method is public: `/about#recommendations`** states every
  rail's rule, Reed's data-transparency call, and the three personal rails'
  one-liners link it; `docs/about-and-faq-source.md` is the factual backing
  and is corrected first. **Favorites ARE handed over since 2026-11-07** (Reed's report
  that a followed show stayed recommended): `favorites-ui.js` fires
  `ob:favorites-read` on `window` after every read and exposes
  `OBFavorites.feeds()` / `ensureRead()`; `discover.js` re-asks the endpoint
  with the feeds, `/booster` repaints its rails through the two-sided
  `recommend-rails.js`; `because[].why` ('boosted' | 'follow') picks the
  heading's verb, and **the rails say "you" on `/booster` too** (Reed's call
  the same day, over "Because Reed boosted"). `pubkey` is optional on the
  endpoint when `favorites` is sent (for the OPML path). **The feeds are
  BARE guids**: a list entry's id is the whole `podcast:guid:` identifier,
  and the first paint sent that, so nothing matched. See `docs/favorites.md`
  item 8.
- **Three more fact rails off the new columns**: New and Noteworthy
  (`first_boost_ts` within 90 days and two boosters; the collector measured
  21 such shows; **since 2026-10-30 two rails, and the podcast one adds
  COMEBACKS**, Reed's call after it held five tiles: boosted in 90 days after
  180+ days with no boost, one non-bot booster, the six-month dormant rule
  applied, about 21 tiles on OB-back's measurement; `newShowsRows`, `whyNew`
  in `functions/index.js`; music stays debuts only), Movers (this week's Shows chart against last week's to 100
  places, climbers by places then debuts), Podcasters Recommend (podroll
  targets by how many sources list them; an unindexed target is a figure,
  not a link).
- **A member's recommendations are on THEIR OWN PAGE too: `/booster/<npub>#recommended`,
  AND SINCE 2026-11-08 FOR THE OWNER ALONE** (2026-10-20, Reed's ask: a
  member with recommendations has a page here already; 2026-11-08, Reed's
  call: "you" was always the member, so a visitor to another member's page
  gets what that member boosts instead, the four boosted rails). Nothing is
  edge-rendered for it now (`recommendationsFor` stays the endpoint's core):
  `booster-page.js` asks `/api/v1/recommend` with the list once the
  Favorites section has read it, for the owner only, paints the rails
  through the two-sided `recommend-rails.js` with the homepage's hooks and
  carrot, and hides the boosted rails for them; **from the moment the read
  starts the owner sees the homepage's loading card in their place**
  (`personalLoading`, off the section's `onStart`/`onFail`; Reed's ask,
  2026-11-08), and a read that fails gives the boosted rails back. The homepage's Recommended
  rails gain a "Your full list →" link to it once painted.
- **⚠️ RETIRED 2026-10-21 WITH THE TABS: `pinScroll` is gone from
  `charts.html`, since a view is a page of its own and nothing sits above a
  feed shell any more (see The Chart Pages). Kept for the decision it
  records.** A HASH THAT NAMES A VIEW LANDS ON THE LIST, AND A LANDING
  SCROLL IS PINNED (`pinScroll` in the `charts.html` controller, 2026-10-20). The
  chart blocks sit above the feed shell on Shows, Albums and Artists, so
  `#shows?range=1y` from a "View all" link was landing on the week's board;
  now any hash carrying a range, sort or language scrolls to the active
  panel's `.feed-shell`, and `#boosts` to the Members tab's Boosts section.
  The scroll is re-made on every change of the document's height for six
  seconds (the blocks, boards, wall and bots all grow the page after the
  first paint; a one-shot scroll drifted onto the boards) and stops at the
  reader's first wheel, touch or key. The bare `#shows` still lands at the
  top.
- **Latest From Podcasts You Follow** (2026-11-08, Reed's ask: follows were
  the input the dropped followed-podcasts feed was missing) leads the
  personal block: `POST /api/v1/follows/latest {feeds}` takes the list's
  podcast guids (an imported list's too), and **asks Podcast Index, since
  D1 holds boosted episodes only**: one `byfeedurl` (or `byguid`) per show
  for the feed id, cached a week, then ONE `episodes/byfeedid?id=a,b,c`
  for the lot, cached ten minutes; at most `SHOWS_MAX` (40) shows a
  request, newest `newest_item_ts` first; the index's own newest boosted
  episodes when PI is absent or silent (`source: 'index'`). `latestTile`
  puts the show's name under the title. **The homepage draws TEN, like every
  other rail, and the long rail is the owner's `/booster#latest`** (Reed's
  call the same evening: the one rail with a scroll bar looked odd): twenty
  tiles, then a View more tile that asks for a larger page (`LIMIT_MAX`,
  100) and appends what was not shown; `latestRailHtml` in
  `recommend-rails.js`, `repaintLatest` in `booster-page.js`, the owner
  alone, right after Favorites. A PI feed-id column on D1
  `podcasts` would make it one D1 query and one PI call; OB-back's, if
  wanted.
- **The owner's `/booster` carries the homepage's hooks and carrot**
  (2026-11-08): `recommendRailsHtml(recs, { owner, feeds })` renders an
  empty side's hook and the carrot rail after the rails; the copy is one
  table, `CARROT` / `HOOKS` in `recommend-rails.js`, which `discover.js`
  imports. A visitor to another member's page sees the rails alone.
- **Still to build here**: boost messages on the results page, New Music
  and Album Movers as music-side discovery rails (the
  Music ribbon's Discover column is three lines because the movers, new
  and podroll instruments are podcast-side today; `newShowsRows` already
  takes both media). Most Favorited is held: 15 lists on the whole network
  on 2026-10-17.

## Site map

The nav's Explore menu and the footer carry the same three groups, in the same
order. They are the site map, so **they're regrouped together or not at all**:

| Group | Items |
|---|---|
| **Browse** | Podcasts `/podcasts` · Music `/music` · Members `/members` · Charts `/charts` · Boosts `/boosts` — *Feeds* until 2026-10-17, *Charts* until 2026-10-21, when every section became a page and the weekly boards took the Charts name |
| **Stats** | Boost Stats `/stats` — coming soon |

**⚠️ `/boosters` (Community) WAS THE SECOND STATS ENTRY AND THE PAGE IS DELETED,
NOT REDIRECTED.** *Reed's call, 2026-08-23.* The Members tab now answers what it
promised — the member lookup, the top-members wall, the #40HPW boards — so the
placeholder pointed a reader at a promise for content that exists one tab over.
It was `noindex`, out of the sitemap, and linked from nowhere but this menu and
the footer, so there is nothing to redirect: no inbound links, no bookmarks, no
search presence. **`/api/v1/boosters/<npub>` and `/booster/<npub>` are different
paths entirely and are live** — do not confuse the plural page with either.
| **More** (footer: *Connect*) | About · Source · Report a bug |

**⚠️ BROWSE IS ONE ENTRY PER PAGE, NOT PER CHART, AND EACH BARE PATH OPENS ON
ITS FIRST CHART** (`PAGES` in the controller and in `charts-page.js`, since
2026-10-21; `TAB_DEFAULT` before). The paragraph that follows is the tabs-era
reasoning and still holds. *Reed's call, 2026-08-23.* It listed all five sub-feeds,
which was right while the homepage hid them behind a dropdown and wrong the
moment the tabs put them on screen: the nav then restated a control the page
carries, in a different order, using different words for the same things.
**Those three hrefs and `TAB_DEFAULT` in the `charts.html` controller move
together** — Podcasts opens Shows (Episodes until 2026-09-03, Reed's call with the chart blocks: the three default feeds are the charted ones), Music opens Artists (Albums until 2026-08-31, Reed's call with the Chart Positions strip), Members opens Boosts.

**The Global/Follows axis is deliberately not in the nav**: it's the second
dropdown on the page, and listing both scopes would double the group into a grid
restating a control the page already has.

| Feed | Hash | Renders |
|---|---|---|
| Episodes · Global | `#episodes-global` | per-episode rollup by boosts received |
| Episodes · Follows | `#episodes-follows` | same, filtered to your kind-3 contacts |
| Songs · Global | `#songs-global` | the same rollup, music feeds only |
| Songs · Follows | `#songs-follows` | same, filtered to your kind-3 contacts |
| Members · Global | `#members` | the kind-1 boost notes themselves |
| Members · Follows | `#members-follows` | same, filtered to your kind-3 contacts |
| Shows | `#shows` / `#shows-follows` | per-show rollup; Follows since 2026-08-31 |
| Albums | `#albums` / `#albums-follows` | the same rollup, music feeds only |
| Artists | `#artists` / `#artists-follows` | the publisher tier above Albums |

The inline feed-bar controller in `index.html` owns the tabs, the sub-category
row, the scope menu, which panel is on screen, and the hash, and dispatches
`lb:feed-activate`; `assets/js/feeds.js` listens and lazily hydrates.

### The Three Tabs

**⚠️ RETIRED 2026-10-21. The tabs, the sub-row, `TAB_OF`, `TAB_DEFAULT`, the
chrome box and the phone chips are gone from `charts.html`; each tab is a
page and each sub-feed a view with an underlined text tab (see The Chart
Pages). Kept for the decisions it records.**

**Podcasts · Music · Members**, on Local Bitcoiners' `feeds.html` pattern
(`git show lb/main:feeds.html`): a full-bleed equal-column grid, an icon over
each label, a 3px top rule, and the selected tab **filled with its accent**
rather than underlined. The what-dropdown they replaced hid four of five feeds
behind a control you had to know to open, which is idea #18's whole complaint.

| Tab | Sub-feeds | Why |
|---|---|---|
| **Podcasts** | Shows · Episodes | the not-music side of `<podcast:medium>` |
| **Music** | Albums · Songs · Artists | the music side |
| **Members** | *(none shown)* | the boost firehose, which takes no medium and could not go under either without becoming two things it isn't |

**⚠️ THE TAB IS DERIVED FROM THE FEED KEY AND IS NOT IN THE HASH.** `TAB_OF` in
the controller computes it, which is why nothing in the wild changed: `#shows`,
`#episodes-global`, `#songs-follows`, `#albums`, `#members` and the two
retired `#podcasts-*` aliases all resolve exactly as before. A `#podcasts/shows`
scheme would have been a second address space for the same eight views.

**⚠️ The active tab reads `--accent`, straight off the `body[data-active-feed]`
mapping**; an inactive tab has no active feed to read and carries its family's
shade. Since the ramp retired (see the Theming section) every family resolves to
the one brand cyan, so the tracking no longer shows — the mapping is kept, and
no token was added.

**⚠️ Which sub-buttons are on screen is CSS off `body[data-active-tab]`, not
JS** — the same call `.feed-bar-controls` makes, for the same reason. Each
`.feed-sub-group` is pinned to its own grid column, and that explicit
`grid-column` is what makes hiding the others safe: with auto placement plus
`display:none`, whichever group survived would fall into column 1.

**⚠️ `.feed-subs` and `.feed-tabs` must share a content box.** Both are
three-column grids; if one takes a horizontal padding or a gap the other does
not, every block narrows and the pair slides out from under its tab a few pixels
at a time. `test-feed-hash.mjs` compares them per breakpoint.

**⚠️ The seam under the tab row runs all the way across, including under the
selected tab**, in `--accent-d`. Broken there, the tab and the block below it
share a fill, touch, and merge into one slab.

**The tabs and the sub-row sit in one bordered, rounded box at the track
width (`.feed-chrome`) since 2026-09-03**, Reed's call: the masthead's and
the sticky wrap's hairlines ran edge to edge on a wide screen. The box is the
edge now; on a phone its sides and radius come off and only the bottom
hairline stays.

**On a phone the tabs become chips and KEEP THEIR LABELS.** LB goes icon-only
because four tabs and four words do not fit; three do, and a reorganization that
exists because visitors cannot tell what the site shows them must not open with
three unlabelled glyphs.

**⚠️ The page track is `--feed-track`, which is `.show-main`'s width; both read
`--page-track` in `theme.css` since 2026-11-07 (60rem, 72rem from 1100px up,
the homepage's width; Reed's ask: every page the same width on a desktop).**
Three elements read it — the tabs, the sub-row and the panels (the control bar
was the fourth until 2026-09-03, when it became the lid inside the active
panel's shell) — so the column no longer narrows by 240px when a reader clicks
a card through to its detail page. The masthead's logo and subtitle keep their own smaller
measures; those are typographic, not the track.

**⚠️ THE HASH IS HISTORY SINCE 2026-10-21: the view is the query string of a
path (`/podcasts/shows?scope=follows&lang=de&range=1m&sort=sats`), the hash
addresses are forwarded by two head scripts, and `ALIASES`, `HASH_OF` and
`SCOPELESS`'s companions are gone from the controller.** The paragraphs that
follow describe the 2026-08-17 to 2026-10-21 shape.

**A hash may carry a view: `#shows?lang=de&range=1m&sort=sats`.** The feed key
stays intact as the part before the `?`, so `FEEDS` and `ALIASES` look up exactly
as they did and a retired hash still upgrades. `PARAM_FEEDS` (né `LANG_FEEDS`)
lists the ten that have the axes; the two Boosts feeds drop the parameters and
rewrite, the same coercion a signed-out `#episodes-follows` gets. See **The View
In The Hash** in `docs/feeds.md` for the whole mechanism.

**⚠️ `SCOPELESS` IS EMPTY SINCE 2026-08-31 AND THE BARE HASHES DID NOT BECOME
ALIASES.** Shows, Albums and Artists gained the whose-axis with the Charts
branch, so every feed key is `<type>-<scope>` now — and `#shows`, `#albums`
and `#artists` are the CANONICAL hashes of the global scope through `HASH_OF`,
the `#members` arrangement, so no link in the wild rewrites. The set itself is
kept empty rather than deleted: `feedKey` and the scope-menu rule read it, and
a future scopeless feed is one entry rather than a re-derivation. One
behaviour changed with it, deliberately: picking Shows while on a Follows feed
now lands on Shows · Follows, since the scope state applies everywhere.

**Follows only exists for a signed-in npub.** Signed out, the scope menu is
`hidden` outright, and a `#episodes-follows` deep link is coerced to Global with
the hash rewritten to match.

**Each feed's range + sort controls mount into the bar's third slot**
(`[data-feed-controls]`), tagged `data-controls-for="<feed>"`. Which group is
visible is **CSS off `body[data-active-feed]`**, not JS: feeds hydrate once and
keep their controls forever, so an imperative swap is the version that can leave
a feed you come back to showing another feed's controls, or none.

**Each panel leads with one slot, shipped empty and `hidden`**: the
`[data-feed-note]` line, filled by the renderer and hidden until it is, so a
feed showing "sign in" or an error grows nothing. It is inside the panel
rather than the bar, so it scrolls away with the cards it describes. **The
`[data-feed-search]` box beside it, and the member lookup on the Members tab,
were removed on 2026-10-17** (Reed's call): the nav bar's site search is on
every page and `/search` is the results page, so three per-feed boxes restated
one control. `feed-search.js` and its test went with them; the ranked
endpoints' `q=` paths stay for the API, and the renderers' pick/query state is
unreachable but still in place.

**The note slot is on the four ranked feeds only** (`mountFeedNote` and
`viewNote` in `feed-note.js`). Since 2026-08-31 the line is composed from the
view itself rather than being a fixed corpus sentence: what orders the list
("Ranked by total sats boosted"; the chart sort states its formula), plus a
corpus clause only when the corpus deviates from all time/Global ("Counting
only boosts from the accounts you follow"), plus `langNote`'s language
sentence. On the chart sort it also carries an ⓘ linking to `/about#charts` —
an anchor now in the wild, frozen like `/about#membership`. On a rollup a card
is an **aggregate**, so the corpus clause is a claim about what was counted
rather than about which cards survived. This is deliberately one line and no
box; don't grow it back into the scope paragraph it replaced.

### The Landing Feed

**⚠️ "LANDING" MEANS THE PODCASTS PAGE'S OPENING CHART SINCE 2026-10-21**
(`/podcasts/shows`; the charts page's opening feed from 2026-10-17), not the
site's front door, which is the discovery homepage above. The three
declarations below read, since 2026-10-21: `PAGES.podcasts.views[0]` in the
controller; `is-active` on `#panel-shows` and the marker pair inside it; and
the `SSR` table and `FEED` in `functions/_shared/charts-page.js`. `DEFAULT_TYPE`
and `TAB_DEFAULT` are gone.

**The front door opens on Shows / All time / Chart rank.** Two Reed calls:
Shows on 2026-08-23 (Phase D, idea #18, shipping the last piece of the tabs
work), and Chart rank on 2026-08-31, when the OnlyBoosts Charts became the
opening sort on **every ranked feed at once** — Shows, Albums, Artists,
Episodes and Songs, both scopes, plus the members wall. The show-level
leaderboard is the view that answers "what is this site" to somebody who has
never seen it; the episode feed is one press away on the sub-row above it. It
opened on Episodes · Global from the day the feed bar existed, and on Most
boosters from Phase D to the Charts flip.

**⚠️ IT IS THREE DECLARATIONS AND THEY MOVE TOGETHER.** Any one of them alone is
a page that contradicts itself, and `test-server-render.mjs` pins all three:

| | |
|---|---|
| `DEFAULT_TYPE` in the `index.html` controller | what the controller resolves to when the hash names nothing |
| `is-active` on `#panel-shows`, and the `<!--OB:SSR-SHOWS-->` markers inside it | what a reader with no JavaScript and a crawler on its first pass actually see, since the controller only hides and shows panels once it runs |
| `FEED` in `functions/index.js` | which query was rendered into that panel, and the `sort` / `range` the client's controls open on |

**`TAB_DEFAULT.podcasts` IS `'shows'` SINCE 2026-09-03**, agreeing with
`DEFAULT_TYPE`. It stayed `'episodes'` from 2026-08-23 until then, on the
argument that where a cold load lands and what the **Podcasts tab** opens on
when pressed are two questions and only one had been asked; Reed asked the
second when the chart blocks made Shows the Podcasts tab's charted feed. The
constant is pinned to the nav's and the footer's Podcasts href (`/#shows`),
so the three move together.

**⚠️ THE OPENING SORT IS `chart` ON EVERY RANKED FEED — one key, one
spelling.** *Reed's call, 2026-08-31.* The OnlyBoosts Charts is deliberately
spelled `chart` on all four ranked endpoints, so the default is the first sort
key the two rollups have ever agreed on. The history matters because the wart
it stepped around is still live for the OPTION menus: the boosters ranking is
spelled `count` on the episodes endpoint and `boosters` on the shows endpoint,
and each renderer coerces the other's word to its default — that coercion now
lands on `chart`. `shows-feed.js` opened on `boosts`, then `boosters` (Phase
D: distinct people, because one listener boosting a show forty times is one
vote, not forty), now `chart`; `feeds-podcasts.js` opened on `boosts`, then
`count`, now `chart`. Breadth stays in the chart as both a component and the
first tiebreaker, which is what made the flip a sharpening of the Phase-D
argument rather than a reversal.

**The Function renders ONE feed and it is the one on screen** — see the ⚠️ under
the rendering rule for why, and for why `feeds-podcasts.js#adoptServerCards` is
kept with no producer.

## The medium split

`<podcast:medium>` is what separates a podcast from a music release: a `music`
feed's items are tracks on an album, not episodes of a show. Live counts
(2026-09-01, after the deepscan recovery): **1,034 music, 714 podcast, 20 video**,
plus a handful of radio/course/film/publisher and 10 with none — music became the
majority when the recovered era landed. Any count or coverage figure in this file
measured before 2026-09-01 was measured on a corpus 63% smaller.

**Two renderers serve five what-options.** Episodes and Songs are one
episode-level rollup; Shows and Albums are one show-level rollup. Each pair
splits on the medium and differs *only* by a copy table at the top of its module.
Adding a third medium is a third entry in those tables, not a third renderer.

**Music has a third tier above the album: the publisher, which in practice is
the ARTIST.** `<podcast:publisher>` links an album feed to its artist's own
publisher feed; the collector resolves it from raw RSS (PI carries no publisher
field — `bots/global-boost-scan/publishers.py` is that design record) and the
Artists feed (`#artists`, shipped 2026-08-30) ranks them. **⚠️ THE ARTIST TIER
COUNTS MUSIC ONLY — hard-wired server-side since 2026-08-31.** *Reed's call,
reversing the launch decision* (the endpoint took no medium on the argument
that the tier is ownership, the ~9 podcast-side declaring shows counting too):
the surface says ARTIST and sits under the Music tab, so an artist's figures
are their music's figures on every surface — the listing, the detail endpoint,
`/artist` (whose `#shows` section was removed the same day), and the
feed-rank chips, all on the standing `COALESCE(medium,'podcast') = 'music'`
partition reading. An artist's podcast-side shows still live on Shows/Episodes
and their own `/show` pages; they are simply not part of the tier. **The
Artists feed** in `docs/feeds.md` carries the rest of the decisions.

**⚠️ The split is a partition, not a narrowing.** `music` goes to Songs and
Albums; **everything else** goes to Episodes and Shows — podcasts, the two video
feeds, and every show the collector holds boosts for but Podcast Index can't
identify. So Albums is never a subset of Shows under a second name. A show with
no known medium counts as not-music: filing an unidentified feed under Albums
would be a claim about it we can't support. The Boosts feeds take no medium and
stay the unsplit firehose.

**The medium is a property of the SHOW, so it is not on the boost record.** The
alternative was the collector stamping one show-level fact onto 22k boosts and
rewriting every month archive.

**⚠️ The medium is a QUERY PARAMETER, not a client-side join.**
`/api/v1/episodes` and `/api/v1/podcasts` take `medium=music` or
`not_medium=music` and answer already split, so the browser never reconciles two
datasets.

Every feed on both sides of the split has the Global/Follows axis since
2026-08-31. The old asymmetry (Songs had it, Albums didn't) was about the data
source: the show-level rollup read a published aggregate computed over
everyone. Server-side ranking retired that, and `/api/v1/podcasts` and
`/api/v1/publishers` now take the same follows POST `/api/v1/episodes` always
had. See the scope note in `shows-feed.js`.

**⚠️ THE TWO COMMUNITY ROLLUPS WERE THE EXCEPTION AND ARE NOT ANY MORE.**
*Reed's call, 2026-08-24.* `#community-shows` on `/show` and
`#community-episodes` on `/episode` crossed the partition deliberately, on the
argument that what an audience listens to *across* podcasts and music is the
interesting half of the finding; both headings read "Shows/Albums" and
"Episodes/Songs" and neither carried a `COPY` entry. The homepage separates the
two, so these pages now do the same: a podcast page reads **Other Shows This
Community Boosts** and an album page **Other Albums This Community Boosts**,
with **Other Episodes** / **Other Songs** one level down.

**The heading and the query's WHERE clause are ONE decision** — a `communityHeading`
entry in each page's `COPY` table, and a `COALESCE(medium,'podcast')` filter in
the show page's community CTE and in `fetchCommunityBoosts`. Change either alone
and the section names something it isn't.

**The cost was measured over 24 live pages before the change, and it is
asymmetric**: a podcast page's rollup was **12% albums**, an album page's was
**39% podcasts**. So the album side is where the crossover lived and where it was
lost. If it is ever wanted back it wants a **section of its own with its own
heading**, never this list widened again under a narrower name.

**Two rollups are still deliberately unsplit, for different reasons.** The
**podroll** is the publisher's own list, written by them, so filtering it would
misreport what they wrote. The **booster page** was the other until 2026-11-08,
on the argument that splitting files one person under two half-histories;
**Reed split it that day** (Podcasts Boosted, Albums Boosted, Episodes
Boosted, Songs Boosted, `boosted-rails.js`); its `#boosts` list is still
unsplit and the page carries no `COPY` table. `episode-section.js`'s range
tooltip reads "Boosted in the last N days" — one reading of `range`
site-wide since 2026-08-31 — which also serves the booster page's unsplit
rollup with no medium-neutral dance.

## Feed loaders

`assets/js/feeds.js` maps every feed key in `LOADERS`; each lazy-imports its
renderer on first view.

| Feed | Module | Source |
|---|---|---|
| `members-global` | `boosts-feed.js` | `GET /api/v1/boosts`, cursor-paged |
| `members-follows` | `boosts-feed.js` | `POST /api/v1/boosts/follows`, cursor-paged |
| `episodes-global` | `feeds-podcasts.js` | `GET /api/v1/episodes?not_medium=music&include=boosts` |
| `episodes-follows` | `feeds-podcasts.js` | the same endpoint as `POST`, body `{follows:[…]}` |
| `songs-global` | `feeds-podcasts.js` | same, `medium=music` |
| `songs-follows` | `feeds-podcasts.js` | same, `medium=music`, as `POST` |
| `shows-global` | `shows-feed.js` | `GET /api/v1/podcasts?not_medium=music` |
| `shows-follows` | `shows-feed.js` | the same endpoint as `POST`, body `{follows:[…]}` |
| `albums-global` | `shows-feed.js` | same, `medium=music` |
| `albums-follows` | `shows-feed.js` | same, `medium=music`, as `POST` |
| `artists-global` | `artists-feed.js` | `GET /api/v1/publishers` — the publisher tier, music-only server-side |
| `artists-follows` | `artists-feed.js` | the same endpoint as `POST` |

**All four ranked feeds rank server-side.** They used to build a corpus in the
browser and roll it up, which ranked over whatever shards the walk happened to
pull: measured against the full corpus, **7 of the true all-time top 10 episodes
were missing outright, only 20 of the true top 100 appeared, and the true #7
painted at #128**. Songs was worse (**84 of 601** music episodes) because music
is ~5% of a stream whose window was sized for the other 95%. **So range and sort
are queries now, and changing either refetches.**

### Range, sort, rank, language, search: `docs/feeds.md`

**That file is the authority for everything the feed bar does.** Its sections:
*Range and sort*, *Ranking, And The One Definition Of It*, *The OnlyBoosts
Charts*, *The Language Filter*, *The Bar On A Phone*, *The View In The Hash*,
*Search*, *The Shows feed*.

What a change would break, restated here because each rule reaches outside that
file:

- **⚠️ `range` MEANS BOOST TIME, EVERYWHERE — one reading since 2026-08-31.**
  *Reed's call*, retiring the air-date reading `/api/v1/episodes` inherited
  from LB (it served a different purpose there, and here it made the music
  windows structurally near-empty: 612 of 618 boosted tracks were older than
  30 days). A row is in the 1W view because someone **boosted** it this week,
  and a windowed card's figures — and its drawer's notes — are the window's
  own, recomputed over the window's boosts. Air date survives as the "Latest
  episode" SORT and as the date on the card; it is never a window again.
- **`RANGE_DAYS` in `functions/api/v1/episodes.js` and `…/podcasts.js` and
  `RANGE_OPTIONS` move together**, or a range button answers 400.
- **⚠️ THE HASH CARRIES THE WHOLE VIEW: `#shows?lang=de&range=1m&sort=sats`.**
  Language shipped alone on 2026-08-17; **range and sort joined on 2026-08-27,
  Reed's ask**. They ride the ten `PARAM_FEEDS` (né `LANG_FEEDS`) feeds and
  deliberately not the Members feeds, which have the controls but no shareable
  view. **A default value is elided**, so the bare `#shows` is the default view's
  address — and because the two endpoints spell the boosters ranking differently
  (`count` vs `boosters`), the controller validates a sort by **shape only** and
  the renderer coerces an unknown key.
- **⚠️ `assets/js/rank.js` IS THE SITE'S SINGLE DEFINITION OF A RANK: standard
  competition ranking (1-2-2-4).** Count of rows strictly ahead, plus one; ties
  share the better place and the next distinct value skips the group. Two-sided
  and dependency-free, so the edge and the browser number a card identically.
  `rankLabel()` owns both forms of the tie marker — `T4` on a feed card, `T#4` in
  a detail-page tile. Dense ranking was measured and rejected; **no denominator,
  anywhere.**
- **⚠️ THE ONLYBOOSTS CHARTS: `sort=chart`, ONE SPELLING ON ALL FOUR RANKED
  ENDPOINTS, AND ITS TIEBREAK LIVES INSIDE THE WINDOW.** Rank in sats + rank in
  boosts + rank in the breadth key (boosters; shows boosted for a member),
  summed, lowest total first; ties break breadth → sats → boosts, the rest
  share a `T#`. The standing is the tuple, so — alone among the sorts — the
  tiebreak is part of the `RANK()` window, every row carries `rank`/`tied`
  from the server, and the renderers never renumber chart rows. Computed at
  query time deliberately (no collector precompute; Follows forces the
  query-time path to exist). The members wall opens on it; the detail pages
  draw its top-100 **window strip** above the stat tiles — Week · Month ·
  Year · All time, each cell that boost-time window's chart place
  (`chartWindows` in `feed-rank.js`), each charted cell linking to that
  window's chart view. **Since 2026-09-03 the strip is also the tiles'
  window selector** (Reed's ask): `feedRanks` returns `windows` (each
  window's figures and component ranks), four rows of tiles ship with all
  but All time `hidden`, and `initStatWindows` in `detail-page.js` swaps
  them. The "Rank on the all-time … feed" caption is gone with it. **See *The OnlyBoosts Charts* in `docs/feeds.md`** —
  the design record — and `test-charts.mjs`.
- **⚠️ `competitionRanks` ASSUMES THE LIST IS ALREADY ORDERED BY THE VALUE IT
  RANKS**, and returns confident nonsense otherwise. Every caller satisfies it by
  construction; a new one has to check.
- **⚠️ THE `q=` PATHS USE `RANK()`, NEVER `ROW_NUMBER()`, AND CARRY NO TIEBREAK
  INSIDE THE WINDOW.** A searched card has to agree with the number the same card
  carries on the unfiltered feed.
- **⚠️ NULL LANGUAGE IS NOT ENGLISH**, and **`lang=all` is not "no filter"** — it
  is a well-formed subtag matching zero rows, so `ob-live.js` sends the parameter
  only when the key is not `all`. The menu is **fetched** from
  `GET /api/v1/languages`, never declared, and is medium-aware.
- **The per-feed search box is gone since 2026-10-17** (see the slot
  paragraph under The Three Tabs); the two bullets after this one describe
  the API behaviour its removal left in place, and the `onSubmit` rule is
  history.
- **⚠️ `onSubmit` IS WHAT FLIPS THE SEARCH BOX'S ENTER BEHAVIOUR.** Typing
  suggests, picking filters, **Enter submits the whole query** (2026-08-27, Reed's
  ask) — and with `onSubmit` present suggestions are **not** auto-highlighted. The
  member lookup deliberately supplies none and keeps its old Enter (*"leave npubs
  alone"*). `test-feed-search.mjs` drives the **shipped** `mountFeedSearch`.
- **⚠️ A RAW SEARCH STRING IS NOT AN FTS5 QUERY.** Everything touching one goes
  through `_common.js#ftsMatch`; passing typed text straight to MATCH answers 500
  on any `-`, `:` or `(`.
- **The remote search source is `/api/v1/episodes?q=`, not `/api/v1/search`**,
  which has no medium filter and no follows scoping and would suggest rows the
  feed cannot show.
- **Rank retention is an ordering**: sort the range's full corpus, stamp each row
  with its position, *then* filter to the pick. Reversing the last two steps
  renumbers the survivor to #1, which answers a different question.

### The Members Tab

**⚠️ THE TAB IS THREE PAGES SINCE 2026-10-21**: the #40HPW boards are
`/charts/hpw`, the wall and the Boost Bots are `/members`, the boost feed is
`/boosts` (see The Chart Pages). `renderMembersBoards` paints the boards and
`renderMembersWall` the wall and the bots, each off its page's load. The
section below is the tab-era record; its rules about the boards, the week,
the wall's orderings and the share cards all still hold.

Three sections above the boost firehose — **#40HPW, Members, Boost Bots,
Boosts** — all client-rendered by `assets/js/members-board.js` and hydrated on
the tab's first activation.

**⚠️ THE SECTION'S VISIBLE HEADING IS "Nostr Gang #40HPW Challenge"** (Reed's
rename, 2026-08-27). `#40HPW` stays the feature's name in this file, in ids and
data attributes, and in the Rules dialog's title.

**`docs/members-tab.md` is the authority**: the four-section idiom and its
shells, the #40HPW rules and every measurement behind them, the week picker, the
member wall's four orderings (Chart rank the default since 2026-08-31), the lookup, the member search endpoint, the Boost
Bots section, and the intro copy. Nearly every paragraph in it is a Reed call.

What a change elsewhere would break:

- **⚠️ THE BLOCK SITS ABOVE THE PANELS, NOT INSIDE ONE**, Members holding two
  boosts panels (Global and Follows), and it **hydrates from both entry points** —
  the cold load does not go through `lb:feed-activate`, so `feeds.js` re-reads
  `body[data-active-feed]` at the end. Hooked to the listener alone, the boards
  were an empty gap on every reload and every shared link.
- **⚠️ THE FEED BAR IS MOVED INTO THE ACTIVE PANEL'S LID, ON EVERY FEED**,
  `appendChild` on the live element — since 2026-09-03, Reed's ask, every
  feed is a shell with its controls on the lid (`.feed-shell` / `.feed-lid`
  in `index.html`), which generalizes the 2026-08-23 move that put the bar
  beside this tab's boost list. The bar ships in the Shows panel's lid and
  `placeFeedBar(feed)` relocates it. **A bar left in the wrong panel is the
  failure**: an inactive panel is `hidden`, so it takes the scope menu and
  every feed's range and sort with it. The `.members-boosts` section is the
  heading alone now; the lid-only `.mb-shell` and the seam it had are gone.
- **⚠️ `.mb-shell` / `.mb-lid` RESTATE `.bs-shell` / `.bs-controls`, THEY DO NOT
  IMPORT THEM** — this page does not link `show-page.css`. 1px `--border`, 12px
  radius, `--cream` fill, lid on `--cream-d`. **They must stay in step.**
- **⚠️ WEEKS START MONDAY 00:00 US PACIFIC**, and the DST rule is implemented
  **twice** — in `assets/js/pacific-week.js` and in SQL — because the two boards
  need it at different times. They cannot share code, so `test-members-hours.mjs`
  holds the hand-rolled rule against Node's real tzdata at both transitions, every
  week for four years.
- **⚠️ THE SECOND SLOT IS A STACK SINCE 2026-09-03: Proof of #40HPW ⇄ Weeks at
  #1**, flipped by the week picker's own stepper in the board's title (Reed's
  ask: "like how you can toggle between weeks"). Weeks at #1 is the Charts
  page's members board (`memberOnesBoardHtml` in `chart-board.js`, rows from
  `/api/v1/charts/members/weeks-at-1`); its share card is
  `members-weeks-at-1` under `/api/og/charts/`, its link is `/#members`, and
  its rows' "Last:" weeks are picker jumps. `paintStack` in
  `members-board.js` mounts the shown board's share button on every flip.
- **⚠️ THE PROOF BOARD IS "Proof of #40HPW" SINCE 2026-09-01 AND IT IS ONE ROW
  PER MEMBER.** *Reed's call.* It was **High Scores**, the ten biggest
  booster-weeks; `range=all` now returns every member who has ever cleared forty
  hours in a week, ranked by how many such weeks they hold, carrying their best
  one. The rename followed the data rather than a design idea: clearing forty had
  happened **twice** when the board shipped and **twenty-three times** by
  2026-09-01, twenty of those one member's, so a top ten by hours printed one
  name ten times. **The entry test is `>= 40` on raw seconds, the same
  comparison the gold row makes**, so a gold row on This Week means that member
  is on Proof — change one and change both. **⚠️ THE URL DID NOT MOVE:**
  `/hpw/high-scores`, `high-scores.png` and `mountShare`'s key are all still the
  old name, which is in the wild and which the collector's card bot screenshots
  by literal. The design record is **The all-time board** in `docs/members-tab.md`.
- **⚠️ THE #40HPW FIGURES MOVE WITH THE WEEK RULE *AND* WITH DURATION COVERAGE.**
  Duration coverage adds hours to **past** weeks with no board code touched.
  Re-measure after either changes; the numbers are the whole argument for the name.
- **⚠️ THE EPISODE COUNT ON A ROW IS EPISODES THAT CONTRIBUTED HOURS**, not
  episodes boosted, and it reads like a bug. Don't "fix" it by widening the count —
  the hours are summed over exactly the episodes counted.
- **⚠️ PUBLISHER KEYS ARE EXCLUDED FROM THE LISTING AND THE BOARDS, NOT FROM THE
  SEARCH.** `PUBLISHERS` in `functions/api/v1/_common.js` is the collector's
  `PUBLISHER_PUBKEYS` **less `chadf-boostbot`, by design** (Reed's call,
  2026-08-30): that bot publishes the boosts Chad sends from his own node, so
  it is a publisher for attribution and a member for ranking. The old "34
  donors" figure was read off a different account's display name. It stays in
  `dedupe.py`'s `RELAY_PUBLISHERS`, where it matters more now. `?publishers=1`
  is the exact complement of the listing. `RANK_PUBLISHERS` in
  `functions/_shared/feed-rank.js` restates the list and moved with it.
- **⚠️ `/about#membership` AND `/about#bots` ARE IN THE WILD** — treat them as
  frozen the way the detail pages' section ids are.
- **The Share Cards** (2026-08-29/30; the design record is the section of that
  name in `docs/members-tab.md`). The week is still not in the hash:
  **`/hpw/<YYYY-MM-DD>` and `/hpw/high-scores` are the address a shared board
  has**, edge-rendered by `functions/hpw/[[path]].js` from `hoursBoard()`
  (lifted out of the hours endpoint) and the **two-sided
  `assets/js/hpw-board.js`** (`rowHtml`, `boardHtml`, `COPY`), which the tab
  imports too. **⚠️ THE IMAGE IS A CHROMIUM SCREENSHOT TAKEN ON THE COLLECTOR
  MACHINE, NOT RENDERED AT THE EDGE** (Reed's call over satori + resvg-wasm):
  the bot (`bots/hpw-cards/`) loads `/hpw/<key>/card`, waits for
  `html[data-card-ready="1"]`, captures 720x900 at 2x, and writes the PNG
  **inside the shards tree**, which is also what saves it from a `--delete`
  mirror run. **A board is re-rendered when its hash moves, and since
  2026-09-07 the hash covers the rows AND `is_current`**: the frame says "In
  progress." off that flag, and with the rows alone a week whose last boost
  landed before Monday kept its live-week card for good (Reed saw the
  Aug 31 week's Shows card still "In progress." days later). **Every URL the
  bot loads carries a `_=<ms>` cache-buster and the card frames answer
  `no-store`**, because the zone Cache Rule of 2026-09-07 would otherwise
  hand it the previous board. **⚠️ ITS STEP IN `run-incremental.sh` CARRIES A SECOND `push`,
  AND THAT IS NOT REDUNDANT**: the card photographs the live site and the live
  site reads D1, so the render has to follow `d1_sync --remote-delta` — which
  sits BELOW the routine `push`, so by then the rsync has already run. Rendering
  above the sync instead would photograph the previous cycle's board;
  `/api/og/hpw/<key>.png` proxies it on the booster OG route's shape
  (`_shared/og-image.js`): name allowlist, **PNG signature checked because the
  upstream answers 200 text for a missing file**, 900KB cap, banner fallback,
  HEAD answered. **⚠️ THE NOTE'S IMAGE IS FROZEN AT THE MOMENT OF SHARING**:
  the share modal (`hpw-share.js`, one icon per board, mounted by the tab and
  by `hpw-page.js`) uploads the reader's copy of the card to Blossom under
  their key (`LBLogin.uploadToBlossom`) and the note carries that URL, never
  the proxy's, which moves every cycle. The note is `<message>`, `<blossom
  url>`, `<link>`; the link is `/#members` for the live week and the week's
  own page otherwise. The modal opens signed out (Publish becomes Log in;
  Download image works); Publish is blocked until the upload succeeds; a
  banner answer is refused; **`lb:session-change` is listened for on
  `window`**, where the widget dispatches it. `.hpw-*` and `.hpw-modal*` CSS
  live in `assets/css/hpw-board.css`, shared by both surfaces.
  **⚠️ ROW HEIGHT ON THE CARD IS A CARD-SIZE DECISION, AND THE BUDGET IS
  MEASURED, NOT DERIVED**: ten rows share the list box (560px), which clips —
  a taller row **silently drops the tenth member from the card while the tab
  still shows them**. Measured 2026-08-30: rows 49.2–50.2px, ceiling 56.0px,
  and the ceiling moves with ANY chrome change around the list. The bot
  refuses to publish a card with a clipped row; have it re-measure after
  touching the card page at all.

### The episode feed adapter, the card projection, and episode links

All three are in `docs/feeds.md`. What a change would break:

- **`ob-data.js#toEpisodeShape` adapts the data to the consumer rather than the
  reverse.** The feed embeds metadata in every boost where `feeds-podcasts.js`
  expects a flat boost list plus side tables. Two fields the feed doesn't carry
  (`feed_id`/`itunes_id`, `description`/`enclosure_type`) degrade rather than block.
- **⚠️ THE CARD'S EVENT IS A PROJECTION, NOT A VERIFIED EVENT**, built in three
  places and carrying **no `sig`**. `handleRepost` once embedded the original only
  when `ev.sig` was present, so every repost from this site was an unrenderable
  bare kind-6. **When a new action is added, decide explicitly whether it needs the
  real signed event or only the projection.**
- **⚠️ THE ROLLUP'S SYNTHETIC SHOW GUID NEVER LEAVES THE CLIENT.**
  `toEpisodeShape` files a boost with no show under `unknown:<item_guid>` so it
  can group; on 2026-09-03 that key reached a **signed boost note** as
  `podcast:guid:unknown:…`, through the card's `data-show-guid` →
  `onBoostClick` → the widget's tag builder (the collector heals such a note
  after the fact, `resolve_guids.py`; the note itself is permanent). Since
  2026-09-06 `show-link.js#isSyntheticGuid` is the one test and
  `episode-card.js#realShowGuid` applies it at every site that hands a show
  guid outside the page: the boost primitives, the note link, and the
  Castamatic/Podverse subscribe links. **The same day the windowed
  `/api/v1/episodes` rollup stopped losing the show of an un-enriched
  episode**: it selected `e.podcast_guid` and bare `pc.*` columns under the
  GROUP BY, so an episode with no row had a null show and one placeholder
  boost blanked the show's title; the boosts are grouped first now and the
  show joined to the resolved guid outside the aggregate (the medium and
  language filters moved to that outer WHERE with it). `test-episode-card.mjs`
  and `test-charts.mjs` pin both halves.
- **⚠️ EVERY EPISODE LINK POINTS AT `/episode/<item-guid>`, AND THE QUALIFYING
  RULE IS THE TITLE**, not the guid. **Three copies of that one test must agree**:
  `show-link.js#episodePageHref`, `functions/show/[guid].js#episodePageUrl`, and
  `episode-link.js`. Each is marked in its own source.
- **⚠️ `episodeBoostLink` OWNS THE URL WRITTEN INTO A PUBLISHED BOOST NOTE, AND IT
  IS PERMANENT AND ABSOLUTE.** Notes published before the flip still point at BMB
  and always will. It returns null for a show-level boost; `/show/<guid>` is **not**
  the fallback target.
- **Three surfaces still point at boostmebitch.com on purpose.** Two are
  show-level, through `bmbShowUrl()` in the show Function: "See All Tracks" on
  the ALBUM drawer, and a podroll tile for a show we have no page for. The
  third is episode-level: the un-indexed rows of the podcast drawer's
  catalogue, built in the browser through `episode-link.js#bmbEpisodeUrl`,
  the one builder the boost note's BMB fallback also uses. "See All Episodes"
  went with the catalogue on 2026-09-04.

## Vocabulary

Every number on this site is bounded by the handful of apps that publish boost
notes to Nostr. A reader who doesn't know that reads them as the show's real
numbers, and the failure mode is a podcaster seeing our figure as a verdict on
their audience.

| | |
|---|---|
| **A Nostr boost** | an indexed boost. Bare "boost" is fine inside a surface the scope note already covers. |
| **A booster** | one person who sent one. The count noun everywhere: cards, hero tiles, drawer bars. |
| **The Nostr Community** | the *set* of them. Names a group, never counts one. |
| **Sats** | never qualified inline. `Sats (Public)` was rejected: it reads as a claim about the payment rather than the record, and invites a private counterpart we never explain. |
| ~~Supporter~~ | **removed from every user-visible string.** It is a claim about who supports a show, and this data cannot make it: a show with 200 keysend supporters and 3 Nostr boosters would read as having 3 supporters. |

**NIP-73 is deliberately *not* the qualifier.** It is the tag linking a note to a
show; what actually excludes a boost from this index is that nobody published a
note at all. A reader who learns what NIP-73 is still does not understand why
their community is missing. The term survives in exactly one place, `/about#nip73`,
where it is the subject.

**The qualifier is carried by a short label at the point of the numbers, never a
paragraph near them:**

- `Nostr Stats:` on every rollup card (`.ob-stats-label`);
- `Nostr Boosts:` on the Episodes/Songs boost drawer. It read
  `Nostr Interactions:` until 2026-08-24; *Nostr boost* is the term the project
  settled on in public and the drawer holds boosts, so the vaguer word was
  naming the same thing twice over;
- `Nostr Boost Stats` over the detail pages' stat tiles, with *Nostr Boost*
  linking to `/about#keysend`.

Both labels keep their colon: the booster faces and sats sit immediately to the
right, so without it the label reads as a heading over an unexplained row of
avatars.

**The full sentence survives in exactly one place: `og:description`.** That is the
string that travels without the page around it, into a preview card or a group
chat where nothing else qualifies it, so **don't trim it**. It is also why
`og:description` is not sourced from the publisher's own show description.

**`.ob-scopenote` is gone** and must not come back — it was the shared
one-sentence paragraph, and it pushed the feed below the fold to answer a question
a browsing visitor had not asked yet. The rule is deleted from `theme.css`;
`git show f0c5f66:assets/css/theme.css` has it.

**The `/boosts` cards carry no qualifier at all**: one card is one boost, and its
sats figure is that note's own claim rather than an aggregate.

**A boost note names what it was boosted to, and both halves link** — the episode
to `/episode/<item-guid>` and the show to `/show/<guid>`. **⚠️ Each half is
suppressed where it is the page's own subject**: the episode on `/episode`
(`showTarget: false`), the show on `/show` and `/episode` (`showShow` is true on
`/booster` alone). A row must not repeat the `<h1>`.

**No episode counts, anywhere.** See the section of that name in
`docs/show-pages-spec.md`. `.show-count` now has no emitter; the rule stays in
`show-page.css` with a note, because the shape is right for a figure that is
complete and unqualified and this site has none.

The Supporter → Community rename was a **surface rename only**. `supporterCard`,
`renderSupporters`, `SUPPORTERS_VISIBLE`, `data-supporter-grid`, the `.sup-*`
classes and `assets/js/supporter-wall.js` all keep their names, the same seam as
Podcasts → Episodes below. (`assets/js/supporter-set.js` was named here too until
2026-08-23; it was LB's supporter-TIER resolver, a different thing that happened
to share the word, and it was deleted with the rest of the strip.)

## Naming note

Internal identifiers still use LB's `lb` prefix — `window.LBLogin`,
`lb_nostr_session` in localStorage, `lb-*` CSS classes, `lb:feed-activate` events.
Renaming is cosmetic and touches many files; it's deliberately not done. Don't
half-rename it.

### Podcasts → Episodes

The episode-level feed was called **Podcasts** until Shows arrived and made the
name ambiguous. The line drawn was **the product surface renames, the module does
not**:

| Renamed | Kept |
|---|---|
| the dropdown label, panel `aria-label`s | `assets/js/feeds-podcasts.js` |
| feed keys `episodes-global` / `episodes-follows` | its `renderPodcasts` export |
| URL hashes `#episodes-*` | its `[podcasts]` console prefixes |
| panel ids `panel-episodes-*` | `PODCASTS` const in `feeds.js` |
| accent tokens `--eg-*` / `--ef-*` | `podcasts/*.json` data paths (collector-owned) |

A module filename isn't a URL, and renaming it costs the git history that follows
the file. The seam is between the surface and the module, and it's a seam, not a
gap.

**⚠️ `ALIASES` in the `index.html` controller maps `#podcasts-global` and
`#podcasts-follows` to the new keys and rewrites the hash in place, the way a 301
would. Never remove an entry** — those links are in the wild.

## What's built vs. what isn't

**Working:**

| | |
|---|---|
| `boosts-feed.js` / `feeds-podcasts.js` | the boost feeds and the episode-level rollup behind Episodes and Songs |
| `episode-card.js` + `episode-card-actions.js` | **the** episode card, facts and verbs, shared by the edge and the browser |
| `episode-section.js` | the card rollup on `/episode` and `/booster` |
| `rank.js` | **the** definition of a rank, competition-style, shared by the edge and the browser |
| `boost-list.js` + `boost-section.js` | **the** boost row and the `#boosts` range and sort, facts and verbs, shared by the edge and the browser |
| `show-card.js` + `show-card-actions.js` | **the** show card, facts and verbs, shared by the edge and the browser |
| `shows-feed.js` | the feed around that card, behind Shows and Albums |
| `publisher-card.js` + `publisher-card-actions.js` | **the** artist card, facts and verbs — no edge surface yet, but built to the two-sided rules so gaining one is a Function-only change |
| `artists-feed.js` | the feed around that card, behind Artists — the publisher tier |
| `functions/api/v1/publishers.js` + `…/publishers/[guid].js` | the artist rollup and the per-artist album list, off the collector's publisher pass |
| `supporter-wall.js` + `supporter-wall.css` | **the** community wall, shared by `/show`, `/episode`, `/artist` and the Members tab |
| `members-board.js` | the Members tab: the #40HPW boards and their week picker, the wall and its four orderings (Chart rank the default), the Rules dialog |
| `feed-controls.js` / `feed-search.js` | the range/sort chrome and the per-feed typeahead |
| `feed-lang.js` | the language menu on the four ranked feeds, and the copy it rewrites |
| `boosts-thread.js` / `boost-actions.js` | the content tokenizer and reply / like / repost / zap |
| `functions/index.js` | **the discovery homepage's fact rails**, rendered at the edge (2026-10-17) |
| `functions/_shared/charts-page.js` | **the five chart pages' shell renderer** (2026-10-21): routes `charts.html` to a page and view, renders Shows and Albums at the edge; it was the charts page's opening feed, and `functions/index.js` before the front door moved |
| `rail-tile.js` + `discover.js` | **the** rail tile, facts and verbs, shared by the edge and the browser; the personal rails (Because ×5) and the SSR fallback |
| `hero.js` | **the** featured carousel's slide, two-sided: the first place of each generic rail, rendered by `functions/index.js` from the rails' own rows; `discover.js` rotates it and wires its Boost to the cards' handlers |
| `functions/search.js` + `search-page.js` | the results page: the charts page's cards in a list, each wearing its chart rank, through the ranked endpoints' `q=` paths in process |
| `nav-search.js` + `/api/v1/search?type=all` | the nav bar's grouped typeahead: shows, episodes, artists and members |
| `nav-ribbons.js` | the bar's three section ribbons (2026-10-20): hover and close rules, the top-five lists fetched on first open, the featured #1 |
| `functions/{show,episode,booster,artist}/…` | the four edge-rendered detail pages |
| `functions/charts/[[path]].js` + `_shared/week-charts.js` + **two-sided** `assets/js/chart-board.js` | the five chart share-card frames (the Charts page they came from was torn down 2026-09-04) |
| `assets/js/charts-block.js` + `functions/api/v1/charts/[[path]].js` | **the chart boards on the Shows and Artists feeds** (2026-09-03): the week's Top 10 with the picker in its title beside Weeks at #1, from JSON; `assets/js/week-picker.js` is the picker's markup and delegate, shared with the Members tab |
| `functions/_shared/card-frame.js` + `functions/api/og/charts/[name].js` | the one 720x900 share-card frame every card renders in, and the proxy for the chart cards' PNGs (`shows-<date>`, `artists-<date>`, `<kind>-weeks-at-1`) |
| `functions/api/v1/*` | the D1 query API |
| `functions/api/v1/members.js` | member search and the top-members listing, over all 2,011 |
| `functions/api/v1/members/hours.js` | the #40HPW boards, and any past week by `week=YYYY-MM-DD` |
| `assets/js/pacific-week.js` | **the** week rule, Mondays in US Pacific with the DST arithmetic, shared by the edge and the browser |
| `functions/api/sign-boost.js` | the signing oracle for the boost bot, with `functions/_shared/nostr-sign.js` |
| `login-widget/src/lib/siteSign.js` | its client half: a wallet-only boost gets a note without a key |
| `functions/api/keysend.js` + `keysendLookup.js` | the keysend upgrade: an lnaddress leg reaches Helipad's first tier |
| `functions/api/boostbox.js` | the BoostBox descriptor for the legs the upgrade cannot reach |
| `login-widget/src/components/LoginButton.jsx` | **the** log-in control, one component in a nav skin and a checkout skin |
| `functions/api/data/[[path]].js` + `ob-data.js` | the static shard proxy and the shape layer |
| `login-widget/` | NIP-07/46/nsec login, NWC + WebLN wallets, boost modals, multi-leg value-split payments, bug reports |
| `bots/bug-watcher/` | polls the bug relay, opens GitHub issues |
| `bots/global-boost-scan/` | the network-wide collector |

**Still to build:**

1. **`/stats` (Boost Stats).** A coming-soon placeholder, and now the whole
   Stats column of the Explore menu, so it is visible and it promises something.
   **It has a rich ancestor upstream** and that's the thing to pull from rather
   than starting over:

   ```
   git show lb/main:stats.html            # 38KB, the charts + view switcher
   git show lb/main:assets/js/stats.js
   git show lb/main:assets/js/stats-boosts.js
   ```

   It was built against LB's own sats log, so the data layer is wrong for us, but
   the chart code, the broken-axis outlier handling and the view switcher are
   directly relevant. `/api/v1/clients` is already built and renders nowhere,
   which makes "boosts by app" the obvious first view.

   **⚠️ `/boosters` IS NO LONGER THE SECOND HALF OF THIS ITEM.** It was deleted
   on 2026-08-23 rather than built or redirected: the Members tab answers what
   it promised. See the Stats row of the site map.

2. **A crawlable show directory.** ~930 show pages are reachable only through the
   sitemap and through links on other pages. See the note in
   `functions/sitemap.xml.js`.

3. **Bug relay write-policy.** `BUG_TAG` is `onlyboosts-alpha` in both
   `login-widget/src/lib/bugReport.js` and `bots/bug-watcher/watcher.js`, but
   `relay.mynostr.app`'s strfry write-policy plugin still has to whitelist that
   literal string. **VPS-side — reports are silently rejected until it's made.**

4. **Dead LB code — mostly gone, one layer left.** The bulk of it was deleted
   on 2026-08-23 (`git show 75f88ef` and the commit after it); what that
   removed and what it did not is in `docs/strip-removed.md`.

   **What is left is `boostQueue.js` and `payAllLegs.js`.** `submitBoost`'s only
   caller was `MultiLegBoostForm`, so both are now dead — but `boostQueue.js` is
   still *imported*, by `navigationGuard.js` and `IdentityDropdown.jsx`, for the
   in-flight tracking those two read. That tracking can no longer become
   non-empty, so the dropdown's in-flight UI and the navigation guard are dead
   with it. Removing them means editing two live components rather than deleting
   files, which is why it was left. `payAllLegs.js`'s keysend classifier gap was **fixed on 2026-08-24 by fixing
   it somewhere else**: the NIP-47 codes moved into the shared classifier, so
   that path gets them whether or not it ever gains a caller.

5. **Typography.** The brand wordmark is a bold sans; the site is still on LB's
   Playfair Display / Source Serif 4. It reads fine, but the serif is inherited,
   not chosen. Those two families are self-hosted in `assets/fonts/`.
   **The widget now reads both as `--font-display` / `--font-body` tokens**, so
   a change here reaches the modals without touching them.

   A third file, `Movie Poster Personal Use.ttf` (the CHARTS wordmark link,
   Reed's pick 2026-09-01, licensed FREE FOR PERSONAL USE ONLY), sat beside
   them from 2026-09-01 to 2026-09-03, when Reed cut the wordmark links with
   the Charts page they pointed at; the file, its `@font-face` and
   `.ob-charts-link` went with them (`git log -S 'Movie Poster'`).

`/about` is done. Its copy is distilled from `docs/about-and-faq-source.md` —
**that file is the factual source of record**, so correct it there first if the
pipeline's behaviour changes. Its **live stat strip** is four pieces that live or
die together: the section markup in `about.html`, its TOC entry, the `.stat-*`
rules in `page.css`, and the inline `/api/data/meta.json` fetch at the foot of the
page. It is **best-effort by design**: it ships `hidden` and reveals itself only
if the whole fetch-and-parse succeeds *and* `m.boosts` is truthy, so a broken
endpoint costs a row of numbers rather than rendering em-dashes. Verified against
all five failure modes. **`distinct_eps` is not a candidate to add** — it counts
episodes carrying at least one indexed boost, not episodes, and reads as a claim
about catalogues we don't have.
