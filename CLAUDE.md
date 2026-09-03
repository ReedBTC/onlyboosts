# OnlyBoosts — Claude Code Notes

A Nostr client for podcast boosts. At heart an ordinary kind-1 client, with one
difference: it does **not** query relays for the feed. Boost data comes from the
collector in `bots/global-boost-scan/`, which publishes to D1 and to static JSON
on the VPS (`relay.mynostr.app`).

**How to read this file.** It is the operating manual, not the design record.
Where a decision has its own document, this file states the rule and points
there rather than restating the argument:

| Subject | Authority |
|---|---|
| Show page design | `docs/show-pages-spec.md` |
| Data shapes the collector publishes | `bots/global-boost-scan/DATA-API.md` |
| The D1 consolidation (complete) | `docs/data-architecture.md` |
| `/about` copy, factual source of record | `docs/about-and-faq-source.md` |
| The `/api/v1` surface | `docs/api-tier2-d1-spec.md` |
| The duplicate filter (rule, tiers, measurements) | `bots/global-boost-scan/dedupe.py` docstring |
| Two-sided modules, the cards, the first-view budget | `docs/two-sided-modules.md` |
| The login/boost widget's styling | `docs/widget-theming.md` |
| Every payment and publishing decision | `docs/money-paths.md` |
| The feed bar: range, sort, rank, language, search | `docs/feeds.md` |
| The Members tab, #40HPW, the member wall | `docs/members-tab.md` |
| The four detail pages | `docs/detail-pages.md` |
| Boost client attribution | `docs/boost-clients.md` |

Deleted reasoning is recoverable: `git log -S <symbol> -- CLAUDE.md` finds the
paragraph that used to explain any name in here.

The last seven were **split out of this file on 2026-08-29**, verbatim, when it
passed its size budget. Nothing was rewritten on the way across, so that same
`git log -S` finds them too.

## Pages

| Path | What |
|---|---|
| `/` | the whole feed experience: hash-routed feeds, two dropdowns on two axes |
| `/show/<guid>` | one show, edge-rendered |
| `/episode/<item-guid>` | one episode, edge-rendered |
| `/booster/<npub>` | one person, edge-rendered |
| `/artist/<guid>` | one artist (publisher), edge-rendered — see the detail pages section |
| `/about` | the project's own explanation of what the data is and isn't |
| `/stats` | a coming-soon placeholder: nav + header + soon-card, `noindex`, out of the sitemap. `/boosters` was the second one and was **deleted** on 2026-08-23 — see the Stats row of the site map |
| `/404.html` | see the ⚠️ under LB conventions |
| `/hpw/<YYYY-MM-DD>`, `/hpw/high-scores` | one 40 HPW board as a page, edge-rendered, the address a shared week has. **⚠️ `high-scores` is a PATH, not the board's name** — that board is **Proof of #40HPW** since 2026-09-01 and the URL deliberately did not move with it. `/hpw/<key>/card` is the 720x900 portrait frame the collector screenshots for `/api/og/hpw/<key>.png`. See **The Share Cards** under the Members tab |
| `/charts/<YYYY-MM-DD>` | the OnlyBoosts Charts page, edge-rendered: weekly Top 10s for **Shows and Artists** on the `sort=chart` rule over the 40 HPW calendar week, plus the **Members 40 HPW board**, each beside a Weeks at #1 companion. `/charts` 302s to the live week. Episodes/Albums/Songs were CUT from the page on ship day (Reed: too sparse) but `week-charts.js` still serves them. See **The Charts Page** in `docs/feeds.md` |

`/shows` and `/podcasts` are both 301s to `/#shows` now; the Shows feed replaced
the standalone page. `feeds.html` and `boosts.html` were folded into `/` and
deleted.

## Site map

The nav's Explore menu and the footer carry the same three groups, in the same
order. They are the site map, so **they're regrouped together or not at all**:

| Group | Items |
|---|---|
| **Feeds** | Podcasts `/#episodes-global` · Music `/#artists` · Members `/#members` |
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

**⚠️ FEEDS IS ONE ENTRY PER TAB, NOT PER FEED, AND EACH LANDS ON THAT TAB'S
DEFAULT SUB-FEED.** *Reed's call, 2026-08-23.* It listed all five sub-feeds,
which was right while the homepage hid them behind a dropdown and wrong the
moment the tabs put them on screen: the nav then restated a control the page
carries, in a different order, using different words for the same things.
**Those three hrefs and `TAB_DEFAULT` in the `index.html` controller move
together** — Podcasts opens Episodes, Music opens Artists (Albums until 2026-08-31, Reed's call with the Chart Positions strip), Members opens Boosts.

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

**On a phone the tabs become chips and KEEP THEIR LABELS.** LB goes icon-only
because four tabs and four words do not fit; three do, and a reorganization that
exists because visitors cannot tell what the site shows them must not open with
three unlabelled glyphs.

**⚠️ The page track is `--feed-track: 60rem`, which is `.show-main`'s width.**
Four elements read it — the tabs, the sub-row, the control bar and the panels —
so the column no longer narrows by 240px when a reader clicks a card through to
its detail page. The masthead's logo and subtitle keep their own smaller
measures; those are typographic, not the track.

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

**Each panel leads with two slots, both shipped empty and `hidden`**: a
`[data-feed-note]` line and, under it, the `[data-feed-search]` box. Both are
filled by the renderer and stay hidden until one does, so a feed showing "sign
in" or an error grows neither. They're inside the panel rather than the bar, so
they scroll away with the cards they describe.

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

**⚠️ `TAB_DEFAULT.podcasts` IS DELIBERATELY STILL `'episodes'`.** Where a cold
load lands and what the **Podcasts tab** opens on when pressed are two questions,
and only one of them was asked. That constant is also pinned to the nav's own
Podcasts href (`/#episodes-global`), so changing it is the nav's decision as much
as the page's. A change that makes those two constants agree has almost
certainly merged them.

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
misreport what they wrote. The **booster page** would file one person under two
half-histories, so its headings still read "Shows and Albums" and "Episodes and
Songs" and it carries no `COPY` table at all. `episode-section.js`'s range
tooltip reads "Boosted in the last N days" — one reading of `range`
site-wide since 2026-08-31 — which also serves the booster page's unsplit
rollup with no medium-neutral dance.

## Where this code came from

A hard fork of **ReedBTC/localbitcoiners** (cloned at `lb-v43`, history intact).
Upstream is wired as the `lb` remote with pushes disabled:

```
git fetch lb
git log lb/main --oneline          # see what's new upstream
git cherry-pick <sha>              # pull a specific LB fix across
git show lb/main:path/to/file.js   # read a file that was stripped here
```

Anything deleted during the strip is recoverable that way — reach for
`git show lb/main:...` before rewriting something from scratch.

Design and code are also expected to be pulled from:
- `~/Desktop/Files/nostr/mynostr` — the full React Nostr client
- `ChadFarrow/boostmebitch` (BMB) — Podcast Index proxy, wallet rails,
  signed-out boosts via a server-side identity, live-stream zaps

### What The Strip Removed

The fork left LB's own products in the tree, unreachable but shipped. They were
deleted on 2026-08-23, before the `homepage` branch merged. **~6,600 lines of
source, and what a homepage visitor downloads went down by 202KB raw:**

| | |
|---|---|
| `assets/js/feeds.js` | 50.4KB → **12.4KB**. The whole Events path: `loadEvents`, the NIP-52 calendar machinery, the streaming relay subscription, the month browser. Unreachable since the Events tab went on fork — `LOADERS` never mapped it — and two endpoints it read, `/api/community-events` and `/api/meetups`, do not exist on this fork at all. |
| `assets/js/boosts-thread.js` | 29.6KB → **18.4KB**. `ROOT_NEVENT`, `EXCLUDED_NOTE_IDS`, `fetchBoostThread` and the six helpers only it called. |
| `assets/js/calendar-events.js` | **deleted** (24.4KB, and it was precached). |
| `assets/js/supporter-set.js` | **deleted** (7.1KB). Its only importer was `feeds.js`. |
| `assets/widgets/login-widget.js` | 1,051KB → **929KB**. 22 source files: `BoostModal`, `EpisodeBoostModal`, `MultiLegBoostForm`, `BoostProgressView`, `BoostExpectations`, and the entire LB meetup product (`CreateMeetupModal`, `MyMeetupsModal`, `SearchMeetupsModal`, `EventComposer`, `eventForm`, `eventPublish`, `eventTypes`, `eventAnnouncement`, `primalSearch`, …), plus `openShowBoost`, `openEpisodeBoost`, `openMeetupModal` and `mountFindFlow` out of `index.jsx`. |

**⚠️ THE CALENDAR CARD HAD ALREADY BEEN UNREACHABLE, AND THE NOTE HERE SAID
OTHERWISE FOR MONTHS.** This file used to claim `calendar-events.js` was
"retained because `boosts-thread.js` imports it to render calendar-event quotes
inside boost notes — that circular import is what makes the cleanup fiddly."
Both halves were wrong. There was no circular import: the module had two
ordinary importers. And the rich card could never appear, because the only
writer of the cache it read was `fetchBoostThread`, which has had no caller
since the fork — so every quoted calendar event fell through to the naddr chip,
every time. **The chip's own reading of the two NIP-52 kinds is what survives**,
inlined as two integers in `boosts-thread.js`, so a quoted event still links out
as "📅 Linked event on Nostr →" rather than as an article. Nothing a reader
could see changed.

**⚠️ THE BUILD DOES NOT CATCH A DELETION THAT GOES TOO FAR, AND THIS ONE DID.**
Cutting `index.jsx` by banner-comment ranges swallowed `BoostApp` — the nav's
Donate button — and `let mounted = false`, which `api.mount()` guards on. Vite
built both away without a word: an undeclared module-level identifier is a
runtime `ReferenceError`, not a build error, and there is no linter here.
`scripts/test-boost-modal-render.mjs` is what failed, because it walks for
`function BoostApp()` by name. **A widget deletion is verified by that test and
by a declared-versus-referenced diff against the previous revision, never by a
green build.**

**Two checks are worth reusing for any future strip**, and neither is a test in
the repo: a module-graph walk that resolves every import *and* every named
import against the target's exports (the `ob-v53` failure class), and a
reachability walk over `login-widget/src` from `index.jsx` that lists orphaned
files. The second one must count bare side-effect imports (`import './x.js'`)
or it reports `styles.css` and `navigationGuard.js` as dead.

## Stack

Vanilla HTML + ES modules, no build step for the site itself. Cloudflare Pages +
Pages Functions. The one thing that *does* build is `login-widget/` (Vite +
React), compiling to `assets/widgets/login-widget.js`:

```
cd login-widget && npm install && npm run build
```

**That one command has three targets**, and the third is not for the browser:
`assets/widgets/login-widget.js` (the React widget),
`assets/widgets/nostr-tools.js` (nostr-tools for the static pages), and
`functions/_shared/nostr-sign.js` (**the edge signer**). The last exists because
the Pages Functions have no npm dependencies and this repo has no root
`package.json` — every Function imports relative paths only, which is what keeps
"no build step for the site itself" true. Signing a Nostr event needs schnorr
and WebCrypto has no secp256k1, so the one dependency the edge needs is vendored
the same way the browser's copy already is. `scripts/stamp-assets.js` leaves it
alone: its relative-import rule runs only inside `assets/js`.

Local dev: `wrangler pages dev .` (so `/api/*` Functions resolve).

**Two scripts run before a commit that touches shared markup or assets, in this
order:**

```
node scripts/sync-partials.js          # nav + footer into every page
node scripts/stamp-assets.js           # ?v=<VERSION> onto every JS/CSS reference
node scripts/stamp-assets.js --check   # verify; non-zero exit if anything is stale
```

**Order matters.** `sync-partials` injects markup into the page files; anything
it injects has to be stamped afterwards.

Sixteen test scripts, all plain `node scripts/<name>.mjs` with no runner:

| | |
|---|---|
| `test-episode-card.mjs` | the card's HTML against fixtures |
| `test-boost-row.mjs` | the boost row's two-sided contract: a D1 row through `boostRecord` and back through `rowsFromRecords` must render **character for character** as the edge rendered it, or a reader who re-sorts watches half the list change shape |
| `test-server-render.mjs` | the assembled homepage against a captured production response: the injection, **the three declarations that name the landing feed**, the state element, a 256KB first-view budget, and the ranking invariants. Takes the capture as an argument, and is written against the **show** card since Phase D |
| `test-feed-hash.mjs` | the inline feed-bar controller: hash parsing, and the boot sequence |
| `test-feed-lang.mjs` | `feed-lang.js`: menu ordering, the withholding rule, and the copy |
| `test-sign-boost.mjs` | the signing oracle's validator and its KV rate limiter, fed by the **shipped** note builder |
| `test-boost-modal-render.mjs` | the widget's four silent-failure classes: use-before-declare, themed classes that emit no CSS, portals with no container, and the missing preflight. See the ⚠️ below |
| `test-boostbox.mjs` | the BoostBox descriptor path: the comment's whole-or-nothing rule, the record allowlist, and every way `/api/boostbox` is allowed to fail. **Stubs `fetch`**, so it never writes a record to a third party's service |
| `test-show-card.mjs` | the show card's two-sided contract. Its own reason for existing is the crossing: `renderShowCard` was a DOM builder and could afford `Date.now()` and an unpinned locale, which a two-sided module cannot — see the note under the card |
| `test-members-search.mjs` | `/api/v1/members`, running the **shipped handler** against a database built from the real `schema.sql` through an `env.DB` shim over `node:sqlite`. LIKE escaping, the identifier/name split, the listing, the publisher asymmetry, and `publishers=1` as its exact complement. **Two publisher keys are in the fixture deliberately**: with one, a single-row answer says nothing about whether the mode asks for the list or found the loudest key |
| `test-members-hours.mjs` | the 40 HPW boards, same shim, with a fixture built to known answers. Dedupe, week boundaries, the publisher exclusion, the row-multiplying join, and **the week picker**: the bounded window's ceiling, the noon-UTC date rule, DST-safe stepping, and the resolve-rather-than-400 envelope. **Proof of #40HPW has its own six fixture members** (2026-09-01), each written to a hand-computable answer: one row per member, a sub-goal week that must not count, exactly-40 in and one second under out, the best week rather than the newest, and the more recent of two identical bests. Confirmed red on seven mutations — the ceiling removed, dates resolved at midnight, stepping by a flat 604800, the `HAVING` dropped, the best-week tiebreak flipped, the two weeks merged in the inner GROUP BY, and the entry test made strictly greater. **Its `env.DB` shim models `.first()`**, which `feed-rank.js` taught `test-members-search.mjs` the hard way |
| `test-community-medium.mjs` | the two community rollups and the medium partition they were split on, against a `node:sqlite` build of the real `schema.sql`. **Two halves reached two ways**: `fetchCommunityBoosts` is exported and called directly, where `/show`'s query is inline in the page Function and is **extracted from the source and executed**, the `test-feed-hash.mjs` technique. A copy of the SQL written into the test would pass forever while the shipped one rotted. Confirmed to go red on three mutations: the filter removed, its polarity inverted, and the `COALESCE` dropped |
| `test-keysend-upgrade.mjs` | the keysend upgrade: the `fountain.fm` exclusion's exact-or-parent rule, the routing pair's whole-or-nothing rule, the strict node-pubkey check, every way `/api/keysend` answers "no endpoint", and the wallet gate. **Stubs `fetch`**, so it probes nobody's well-known |
| `test-feed-search.mjs` | the search box's two outcomes, driving the **shipped** `mountFeedSearch` against a stub DOM: Enter submits the whole query where a feed supplies `onSubmit`, arrow + Enter still picks, emptying the box or Escape clears through `onPick(null)`, the footer row renders — and **the member lookup, with no `onSubmit`, keeps its old Enter**. Confirmed red on two mutations: auto-highlight restored, and the empty-box clear removed |
| `test-hpw-cards.mjs` | the 40 HPW share cards, three halves: `hpw-board.js`'s two-sided rules (a **source** scan for absolute imports, `Date.now()` and unpinned locales, plus the row's escaping and `isSafeUrl` on the face); `hpw-share.js`'s pure parts (the note's shape, the link rule, the tags, the `window` listener); the **shipped** `/hpw` Function over a `node:sqlite` build of the real schema (every redirect, the 404s, the page's canonical and `og:image`, the card's frame and ready signal, and that the page carries `rowHtml` byte for byte); and `/api/og/hpw/<name>.png` with **`fetch` stubbed** (the allowlist, the upstream's 200-for-missing answered with the banner, the PNG signature, the 900KB cap, HEAD). Nothing in it touches the VPS |
| `test-publishers-api.mjs` | the **shipped** `/api/v1/publishers` handlers — listing and per-artist detail — over a `node:sqlite` build of the real `schema.sql`, on the members-search pattern. Three sorts with three winners, the boost-time windows, the language filter recounting through the declaring shows (`lang=unknown` included), LIKE-wildcard decoys, rank retention on `q=`, the title-less publisher's exclusion, HEAD, the album list's publisher-order and its live-row-over-edge-hint preference |
| `test-charts.mjs` | the OnlyBoosts Charts: `sort=chart` on the **shipped** handlers of all four ranked endpoints over a `node:sqlite` build of the real `schema.sql`. **Expectations are brute-forced from an independent JS implementation of the rule**, one boost list feeding both sides; a micro-corpus that inverts if the tiebreak chain is reordered; `q=` rank retention with pre-filter tie flags; the follows-POST chart on all three POSTing endpoints (podcasts and publishers gained theirs in phase 2, with `publisher=` and boost-time `since=` for the drawers' follows paths); `feedRanks`' chart place — all four boost-time windows since the strip — and the tiles' Charts strip. Confirmed red on five mutations: the tuple tiebreak removed, the chain flipped in members.js and again in feed-rank.js, `peers` counted post-filter, and the podcasts POST's follows filter dropped |

| `test-weekly-charts.mjs` | the OnlyBoosts Charts page: the **shipped** `/charts/<week>` Function over a `node:sqlite` build of the real `schema.sql`, on the members-hours pattern. The routing contract (one URL per week, HEAD answered); the Shows and Artists Top 10s against a **brute-forced independent implementation** of the chart rule, component-rank triplets included; the medium partition; the Members pair (the hours board held to brute-forced hours, the publisher exclusion); and every Weeks at #1 tally — completed weeks only, a tied #1 crediting every holder, a fixture week whose #1 is decided by the tiebreak CHAIN. The retired kinds (episodes, albums, songs) stay covered at module level. Confirmed red on six mutations: the chain flipped, the live week counted on each side, the medium filter dropped, the per-week `PARTITION BY` removed, and the member boards' publisher exclusion dropped |

**⚠️ `test-server-render.mjs` IS THE ONE THAT NEEDS AN ARGUMENT, SO IT IS THE ONE
THAT GOES UNRUN.** Its header carries the `curl` that produces the capture; take
a fresh one rather than reusing an old file, since it is also the size
measurement. It asserted `cards are numbered 1..N with no gaps` — the *ordinal*
scheme's invariant — until competition ranking shipped on 2026-08-18, and it
would have been merged red had it not been run. **Run all eighteen before a
merge**, and treat this one as the guard on the ranking scheme rather than only
on weight. *(It read "all twelve" until 2026-08-24, "all fifteen" until 2026-08-30, "all sixteen" and then "all seventeen" until 2026-08-31, contradicting the table
directly above it — the count moved when a test was added and this sentence did
not. If the table grows again, this line grows with it.)*

**⚠️ AND ITS `curl` CHANGED WITH THE LANDING FEED.** It captures
`/api/v1/podcasts?not_medium=music&sort=chart&range=all&limit=25` now (it read
`sort=boosters` until the Charts became the opening sort on 2026-08-31 — and
until a deploy serving `sort=chart` is live, production coerces the unknown
key, so the capture is built through the shipped handler instead; the test's
header carries the recipe), not the episodes query. The whole file was rewritten by Phase D, which is the honest
measure of how big that change was: the landing feed is not a constant this test
could have been parameterised by, since the two cards share no renderer, no state
element and no drawer. `git show 4c22017:scripts/test-server-render.mjs` is the
episode version if the front door ever moves back.

**⚠️ `test-feed-hash.mjs` EXTRACTS THE CONTROLLER OUT OF `index.html` and runs
it**, because it is an inline `<script>` and cannot be imported. That is the
whole value of it: a second copy of `normLang()` inside the test would pass
forever while the shipped one rotted. It scans for `FEED BAR CONTROLLER` and for
`function <name>(` with a balanced-brace walk, so **renaming those functions or
that comment breaks the test loudly**, which is the intended failure.

It exists because two bugs shipped that no unit test of the parsing could see,
both living in the boot sequence: the language reached `lb:feed-activate` but not
`body[data-feed-lang]`, so every shared link opened unfiltered; and it was filed
under the feed key the hash named rather than the one `setFeed` resolved to, so a
signed-out `#episodes-follows?lang=de` filed it against a feed that was not on
screen. **Anything about how this page boots wants a test here, not a unit test.**

`test-feed-lang.mjs` imports the real module and rewrites only its two
version-stamped absolute imports to stubs, so the module under test is the
shipped source.

**⚠️ `test-boost-modal-render.mjs` EXISTS BECAUSE A TEMPORAL DEAD ZONE REACHED
PRODUCTION AND DID NOT LOOK LIKE A CRASH.** `paySeconds` read `payTick` thirty
lines above its `useState`, inside the ternary
`payingLeg?.startedAt ? (… payTick …) : 0` — so the branch was only evaluated
once a leg was actually paying. The form rendered, the done screen rendered,
every test passed, and a live boost threw during render about a second in.

**A render error with no boundary above it unmounts the whole `createRoot`**,
which is why one missing line-order produced four unrelated-looking faults: the
modal vanished mid-payment; the payment completed anyway, its promise being
detached; **no Nostr note was ever published**, because the publish lives in
`phase === 'done'` and phase never got there; and the page's Boost button was
dead until a reload, because the host root was gone. Nothing anywhere said an
error had been thrown.

Two things came out of it and both are load-bearing. The scan is a **text
check, not a render** — advancing state past `'form'` needs a DOM, and
`renderToString` runs no effects, so a real render test would mean adding jsdom.
And **this repo has no linter**: `no-use-before-define` would catch the class in
one rule, and adding eslint to `login-widget/` is the better fix whenever anyone
wants it. Until then the scan is the whole defence, so point it at any component
that renders while a payment is in flight.

### Asset Stamping, And The Rule It Replaced

`scripts/stamp-assets.js` appends `?v=<VERSION>` to every
`/assets/{js,css,widgets}/…` reference, reading VERSION from `sw.js` so there is
one source of truth.

**The failure it closed:** Pages serves assets `public, max-age=14400,
must-revalidate`, and **every module URL runs that four-hour clock on its own**.
A reader could hold a three-hour-old `feed-controls.js` against a freshly-fetched
renderer importing something the old copy did not export, and an unresolved named
import is a **link-time** error, so the renderer never executed at all. All eight
feeds went down together (`ob-v53`). Bumping `sw.js` never closed it: the service
worker's cache is only consulted for clients it already controls, and the HTTP
cache underneath is per-URL either way.

**The fix:** a URL now means exactly one version of one file. A deploy references
new URLs, so a stale copy is unreachable rather than merely undesirable.

**So the old "never add a named export" prohibition is history.** Adding a named
export to a shared module is ordinary work now, as is any cross-module refactor.
Notes warning against it survive in `feed-controls.js`, `feed-note.js`,
`show-desc.js`, `booster-link.js` and `boost-note-actions.js` as the reason each
of those exists; they are accurate history, not live constraints.

**⚠️ One rule replaces the several it displaced: bump `VERSION` in `sw.js` when
you change any asset, then run the script.**

Three details before editing the script:

- **It matches only quoted references** — `href="…"`, `src="…"`, `from '…'`,
  `import('…')`, and `sw.js`'s `PRECACHE_URLS` literals. An unanchored pattern
  also matches comment prose, and the sentence's full stop then sits where the
  version suffix goes, so the next run parses it as part of the version and
  deletes it. That is a script that edits documentation a little more every time
  it runs. `--check` is what caught it.
- **It stamps two shapes.** The absolute reference every page uses, and a
  **relative** `'./sibling.js?v=…'` import inside `assets/js`, which exists for
  the modules imported from both the browser and a Pages Function.
- **JS and CSS only.** Images and fonts are left alone deliberately: the failure
  being closed is two *code* files disagreeing, and a stale logo is not a broken
  page. `assets/widgets/` is stamped at the reference sites but its files are
  never rewritten, being build artifacts.

`sw.js` routes on `url.pathname`, so the query string doesn't disturb it.

### What The Service Worker Caches, And How

`sw.js`'s fetch handler is four routes, and **which route a URL lands in decides
whether a returning visitor can be shown a stale answer**:

| Request | Route | Cache |
|---|---|---|
| HTML / navigations | network-first, cached copy offline | `HTML_CACHE` |
| `/api/` except `/api/data/` | **network-first, cached copy offline** | `API_CACHE` |
| `/api/value`, `/api/lnurl` | network only, never cached | — |
| `/api/data/` | stale-while-revalidate (5-minute snapshot) | `SNAPSHOT_CACHE` |
| `/assets/widgets/` | stale-while-revalidate | `WIDGET_CACHE` |
| everything else same-origin | stale-while-revalidate | `STATIC_CACHE` |

**⚠️ The catch-all is for ASSETS, and a live endpoint that falls into it is
served from the previous visit.** `/api/v1/*` sat there until `ob-v73`: a boost
live in D1 took two reloads to appear, and only for returning visitors, so it
read as intermittent. The Follows feeds never showed it because they POST and
the handler ignores non-GET. Any new live endpoint belongs under `/api/`, where
`isLiveAPIRequest` picks it up with no SW change; one placed anywhere else needs
its own route before it ships.

**⚠️ BUT A MONEY ENDPOINT NEEDS ONE MORE STEP, AND LANDING UNDER `/api/` IS WHAT
HIDES IT.** That bucket is network-first **with a cached copy served when the
network is down**, which is right for a feed and wrong for anything that moves
sats. `isUncacheableMoneyRequest` is the opt-out and holds four:
`/api/value`, because a stale value block pays a split the show no longer
publishes; `/api/lnurl`, because it returns a **bolt11 invoice** and a cached
invoice is one the donor may already have paid; `/api/boostbox`, because it
returns a descriptor URL a podcaster's Helipad will fetch, so a cached one
attaches **another boost's** message, amount and episode to this payment; and
`/api/keysend`, which is the most direct of the four — it names the **node the
sats are addressed to** and the record routing them to an account on it, so a
stale copy pays the wrong destination outright. `/api/lnurl` shipped
without the exclusion in `ob-v91` and was caught before deploy; the reason it
was easy to miss is that placing it under `/api/` was the correct, documented
thing to do. **Ask of any new endpoint not just where it routes, but whether an
offline answer is worse than no answer.**

## ⚠️ The Rendering Rule: The Server Renders The Facts, JavaScript Adds The Verbs

**The standard every page is held to.**

| | |
|---|---|
| **Facts** | Anything out of the database that is the same for every visitor: who boosted, how many sats, which show and episode, message text, artwork, rankings, air dates. **Server-rendered, always.** |
| **Verbs** | Anything needing a signer, a gesture, or knowledge of who is looking: reply, like, repost, zap, boost, copy, sort, filter, search, expand, seek. **Attached by JavaScript, always.** |

The consequence worth internalising: **a component never has to choose between
being server-rendered and being interactive.** A boost note is server-rendered
*and* carries a full reply/like/repost/zap bar. Reaching for "this section has to
be client-rendered so it can be interactive" means the split has been drawn in
the wrong place.

**What this protects**, because "works without JavaScript" overstates it:

- **Search.** ~930 show pages and 2,027 episode pages are in the sitemap.
  Googlebot runs JavaScript, but on a delayed second pass and not dependably per
  page. Server-rendered content is indexed on the first pass.
- **Resilience.** `ob-v53` blanked all eight feeds when one cached module didn't
  match another. The feeds went down; the show pages did not.
- **Speed.** Finished HTML paints once. A shell paints, fetches, then paints again.
- **Not** readers with JavaScript disabled. That is a rounding error and was
  never the reason.

### What Must Be Identical Across Pages, And What May Differ

**The test: if a reader could screenshot the same component from two pages and
tell them apart, that is a bug** unless the subject genuinely differs.

| Identical everywhere | Legitimately differs |
|---|---|
| A boost note: card, message, mentions, reaction bar, ⋮ menu | The **subject** (show / episode / person) |
| A rollup drawer: the box, the lid, the range and sort controls | **Which sections exist** (a podroll is show-level; chapters are episode-level) |
| An artwork fallback chain | **The words**, off a `COPY` table (Episode vs Track) |
| A booster's name and face, and where they link | **Which figures are meaningful** (a booster page has no booster count) |

### ⚠️ One Module, Imported From Both Sides

**`docs/two-sided-modules.md` is the authority** — the mechanism, the three
worked examples (episode card, show card, boost row), the `CARD_PARTS` table,
the five surfaces the episode card serves, and the first-view measurements
behind lazy drawers and the Shows landing feed.

The mechanism: a Pages Function imports `../../assets/js/episode-card.js` by
relative path and esbuild inlines it off the filesystem; the browser imports
`/assets/js/episode-card.js?v=<VERSION>` and gets the same file. So a card
rendered at the edge and the same card rebuilt in the browser after a re-sort
are byte-identical **by construction**.

What a change would break:

- **A two-sided module imports its siblings as `'./thing.js?v=<VERSION>'`**, never
  an absolute `/assets/js/…` — the browser resolves that and esbuild cannot.
  Enforced by `scripts/stamp-assets.js`.
- **Everything a two-sided module imports must itself be two-sided.**
  `show-link.js`, `episode-link.js`, `booster-link.js`, `cover-art.js` and
  `nostr-text.js` are all dependency-free, which is what made this cheap.
- **⚠️ NO `Date.now()`, NO UNPINNED LOCALE.** Three formatters were safe in a DOM
  builder and are not safe here; at the edge the clock is the moment the response
  was *cached*. All three are `en-US` in UTC, and `test-show-card.mjs` scans the
  **source** for them, because the test process is already en-US in UTC and a
  render check passes regardless.
- **⚠️ NO SURFACE PRINTS AN EPISODE NUMBER, ANYWHERE.** *Reed's call,
  2026-08-24.* The data is still stored and still on `/api/v1`; `itemAbbr` is gone
  from all three `COPY` tables. `test-boost-row.mjs` pins it.
- **⚠️ THE FUNCTION DECLARES THE CARD VARIANT AND IT TRAVELS IN THE STATE
  ELEMENT**, so a client repaint cannot render a different card than the edge did.
  Three knobs and only three (`CARD_PARTS`): `stats`, `layout`, `drawer`.
- **⚠️ `functions/index.js` fetches `/` from `env.ASSETS`, never `/index.html`.**
  Pages 308-redirects the latter and the front door answered
  `ERR_TOO_MANY_REDIRECTS`. It shipped that way once.
- **⚠️ ONE FEED IS SERVER-RENDERED AND IT IS THE ONE ON SCREEN.**
  `feeds-podcasts.js#adoptServerCards` is deliberately kept with no producer — it
  is the client half of the landing-feed decision, and what makes moving the front
  door a change to the Function alone.

## Conventions carried over from LB — keep these

- **CSP meta tag on every page.** All pages share one policy so tightening
  happens in lockstep. **`img-src` allows `data:` and `https:` and not
  `blob:`**, so a preview of a fetched blob is a `data:` URL, never
  `createObjectURL` (the share modal shipped a broken-image icon that way);
  don't widen the shared policy for one preview.
- **Shared nav/footer are generated.** Edit `partials/nav.html` /
  `partials/footer.html`, then run `node scripts/sync-partials.js`. Never edit
  the copies inside page files — they're between `NAV:START`/`NAV:END` markers
  and get overwritten. A new page only needs the empty marker pair. **Its
  `EDGE_PAGES` list is what keeps the Functions' nav and footer in sync**; a new
  edge-rendered page needs an entry there.
- **The nav's lazy-widget bootstrap is `assets/js/nav-widget-boot.js`**, not
  inline — it wires the Donate button and the identity slot to the 1MB
  login-widget bundle, loaded as a plain (non-defer) script at the end of `<body>`.
- **Link pages without the `.html`.** Pages serves `/about` and 308-redirects
  `/about.html` to it, so an in-site link with the extension costs a redirect hop.
- **⚠️ `404.html` is what makes a missing path answer 404.** Without it in the
  repo root, Cloudflare Pages answers **every** unmatched path with `200` and the
  full homepage. Three consequences, the third being the one that costs an
  afternoon: a dead link silently showed the homepage; a crawler was told every
  dead URL was a real page duplicating `/`; and **a file that failed to deploy
  reported a MIME error rather than a 404**, since the browser fetched HTML where
  a module was expected and refused it under `nosniff`. Nothing in that message
  says the file is missing.

  It carries **no canonical and no Open Graph tags**, the one place the page
  conventions are deliberately broken: it is served under whatever URL was
  missed, so there is no single address for either to name. `follow` is kept so a
  crawler landing here still traverses the nav back into the site map. It is
  deliberately out of the sitemap and `noindex`. `/show/<guid>` and
  `/episode/<guid>` answer their own misses and are unaffected.
- **Pages Functions bound every upstream fetch**: wall-clock timeout, byte cap,
  *and* a streamed read (`resp.text()` buffers before you can check size). See
  `functions/api/data/[[path]].js` for the reference shape.
- **⚠️ Every Function that exports `onRequestGet` also exports
  `onRequestHead`** (the GET's status and headers, no body). Pages routes by
  method, and a HEAD with no handler falls through to the static lookup and
  answers 404 for a URL whose GET is fine; link checkers and some unfurlers
  HEAD first. Bitten three times in two days on 2026-08-29/30.
- **CORS origin allowlists are exact-match `Set` lookups**, never `startsWith` —
  a prefix check lets a lookalike origin get reflected into
  `Access-Control-Allow-Origin`.
- **`isSafeUrl()` before any user-supplied URL** reaches `href`/`src`.
- **⚠️ Bump `VERSION` in `sw.js` on ANY asset change, then run
  `scripts/stamp-assets.js`.** Not "when returning visitors need it on the first
  navigation" — that was the old conditional rule, and it is now unconditional,
  because the stamper reads VERSION to build every asset URL.
- **Adding a named export to a shared module is ordinary work.** See the stamping
  section above for why the old prohibition is retired.

## Theming

The shared stylesheets (`nav.css`, `footer.css`, `boosts-thread.css`,
`boost-actions.css`) read their colors as CSS custom properties off `:root` and
don't define them — every page has to supply the tokens. That supply is
`assets/css/theme.css`: the palette, the `@font-face` rules, and the base
`body`/`a`/`img` styles. **Link it from every page, last among the shared
stylesheets** so a page's own inline `<style>` still wins.

`index.html` keeps one theme block of its own — the eight per-feed accents and
the `body[data-active-feed]` mapping. `assets/css/page.css` is the counterpart
for the plain content pages (`.page-header`, `.soon-card`).

### Dark Mode

**`data-theme="dark"` on `<html>`, set before first paint by the boot script in
`partials/nav.html` and toggled by the moon/sun button beside it; the choice is
per-browser in `localStorage` under `ob-theme`.** Absence of the attribute — and
any stored value other than `dark` — is the light theme, which is exactly what
every visitor saw before the toggle existed. `nav.js` owns the click, the
storage write, the button's label, and cross-tab sync via the `storage` event;
the boot script only replays the stored choice. Riding the nav partial is what
puts both on every page, the edge-rendered ones included, from one source —
which is also why **neither may contain a backtick or `${`** (sync-partials
exits nonzero if one appears; it bit once, in a comment).

The theme itself is `:root[data-theme="dark"]` blocks: the palette flip in
`theme.css`, the feed accent's flip in `index.html`'s inline block (one family
since the ramp retired — its `-d`/`-dd` steps lighten against the dark
background, the same derivation the light `-dd` used against white), and a short
dark section at the foot of each stylesheet that needed one. Every shipped value
was contrast-measured; text ≥ 4.5:1 on its surface, links and accents ≥ 6:1.

**⚠️ THE DARK GRAMMAR IS ONE GROUND, HAIRLINES, AND ONE ACCENT.** *Reed's call,
2026-08-27, against a Primal dark-mode screenshot* ("ours feels blocky and
choppy"). The first cut flipped each light surface to its own blue-tinted dark
shade and kept the navy chrome, which read as bands and boxes. What replaced it:
a near-neutral black ground; the nav, footer and `.page-header` band sit ON
that ground behind a 1px `--border` hairline instead of on their own navy; the
card (`--white`/`--surface`) and sunken (`--cream-d`) surfaces are within a few
percent of the ground, with borders doing the separating; and cyan appears only
as text, accents and fills, never as a wash a region wears (`--bg-tint` is
barely off the ground for the same reason). **Don't re-introduce a surface with
its own colour into dark mode** — that is the specific thing this pass removed.

**⚠️ TWO TOKENS DELIBERATELY DO NOT FLIP, AND `--navy` FLIPS TO THE GROUND:**

- **`--navy` becomes the page ground in dark**, which is what merges the nav
  and footer into the page. Three consequences carry scoped repairs: those
  components read `--cream`/`--cream-d`/`--white` as light TEXT, so `theme.css`
  re-supplies those inside `#top-nav`, `#site-footer` and `.page-header`; the
  `.tagblock` and `.lb-toast` fills vanished into the ground and became
  bordered surfaces (dark sections of `page.css` / `boost-actions.css`); and
  `boosts-thread.css` / `boost-actions.css` remap `--navy`/`--navy-l` *inside*
  the components that used them as text on light surfaces (`.note-card`,
  `.embed-note`, `.zap-modal`). **A new `--navy` fill needs a dark-scoped
  border or fill of its own**; a new navy-as-text usage needs a remap.
- **`--brand-dd` / `--brand-ddd`.** They are the AA fills under white on every
  filled widget button, read live by the bundle, so lightening them breaks the
  checkout. Where they were doing the *other* job — darkest text step on a
  light page — each stylesheet carries a dark-scoped override reading the
  lightened `--brand-d` instead. **A new `--brand-dd` text usage needs its own
  override**; a new filled button needs nothing.
- **`--warn` / `--danger`** are lightened, never re-hued: amber is UNCERTAIN
  and red is FAILED, and the double-pay guard rests on telling them apart in
  either theme.

**`--brand-d` inverts its role in dark**: it is the brand TEXT step (lightened),
so the two filled controls that hover onto it (`.ob-boost-pill`, `.show-main
.btn-boost`) carry scoped rules hovering to `--brand-dd` instead — contrast
still only ever increases.

**⚠️ A DARK OVERRIDE OF AN ALIASED TOKEN GOES ON THE ELEMENT THE ALIAS IS
DECLARED ON, AND THIS SHIPPED WRONG ONCE.** A custom property substitutes its
`var()` at computed-value time on the element that *declares* it, then inherits
as the resolved value. The accent families are aliases on `:root`
(`--eg-tint: var(--bg-tint)`), and the dark remap sat on `body` — so every
alias had already baked in the light value before body's override existed, and
dark mode rendered the feed panels on the light-mode cyan with the light
`--accent-d` (a blue picked for white, ~2.5:1 on a dark card) on every eyebrow
and link. Nothing errors; the page is simply the wrong colors. The remap lives
on `:root[data-theme="dark"]` now, and the inline comment beside it says why.
Reed's screenshots are what caught it — "still a lot of different shades".

Two structural notes. **The widget needed no change**: it reads the tokens live
off `:root`, so the dark `--modal-*`/state values reach the modals by
themselves, and its `var()` fallbacks stay mirrors of the *light* values — a
fallback only fires when a token is undefined (a stale `theme.css`), never in
dark mode. Which is also why **the dark block must stay below the base `:root`
block in `theme.css`**: `test-boost-modal-render.mjs` parses the first `:root`
block it finds. And the masthead needed no second banner — the clear PNG's
wordmark is cyan on transparency, which is what that file's split was for.

### The Widget Wears The Site's Palette

**The login/boost widget is a fork of LB's and wore LB's dark palette until
2026-08-21.** OnlyBoosts is light, so pressing Boost took the reader out of the
site's visual world entirely. It is now on the site's own tokens, and it inherits
**Dark Mode** above for free — the tokens flip on `<html>` and the widget mounts
into that same document.

**`docs/widget-theming.md` is the authority** — the scoped preflight, the two
specificity traps, the two Tailwind shapes that fail silently, the three surface
tokens, and the contrast measurements behind `--brand-dd`.

Six rules, each of which shipped as a bug before it was written down:

- **⚠️ THE TOKENS ARE READ, NOT COPIED.** Tailwind runs in the host document with
  preflight off, so `bg-[var(--modal-bg)]` works with no config change. Never
  hardcode a hex into JSX.
- **⚠️ BUT EVERY `var()` CARRIES A LITERAL FALLBACK.** `assets/widgets/` files are
  stamped at the reference site and **never rewritten**, so a new widget can meet
  an old `theme.css` — the `ob-v53` failure class arriving through the one door the
  stamper cannot close. An undefined custom property invalidates the whole
  declaration, which is how the boost modal once rendered transparent mid-payment.
  The fallbacks are **mirrors**: `test-boost-modal-render.mjs` asserts each equals
  the token's current value, so editing the palette without re-mirroring fails.
- **⚠️ `.lb-w` IS THE SCOPE AND EVERY `createPortal` MUST WEAR IT** — and must
  still be passed a container. Eight of ten call sites once put the closing `</div>`
  on the wrong side of the comma, which is valid JSX and rendered nothing.
- **⚠️ EVERY SELECTOR IN THE SCOPED RESET MUST COMPUTE TO (0,0,0)**, `:where()`
  around the element list included. An unwrapped `[type='button']` carries class
  weight and silently killed every `bg-*` utility on it.
- **⚠️ A FILLED BRAND BUTTON IS `--brand-dd`, NEVER `--brand`** — white on
  `--brand` is 2.50:1 and fails AA — with `--brand-ddd` on hover, so contrast only
  ever increases. `IdentityWidget`'s pill and `BoostButton` stay dark on purpose,
  sitting on the navy nav bar rather than on a modal.
- **⚠️ `nav-widget-boot.js`'s STATIC PLACEHOLDER AND `LoginButton`'s NAV SKIN MUST
  MATCH TO THE PIXEL**, the React button replacing that element in place.

**Known and deliberately not changed:** `boosts-thread.css` and
`boost-actions.css` still tint hover states with `rgba(247,147,26,…)`, LB's
bitcoin orange. Those are the site's own reaction bars, not the widget, and they
were out of scope for the widget restyle.

`assets/css/feed-cards.css` holds the **episode card and everything that hangs
off it** — the range/sort controls, the card, the boost drawer, the inline boost
thread, the copy toast, `.ob-stats-label` and `.feed-placeholder`. Every rule in
it reads `--accent` / `--accent-d` / `--tint`, so a page that links it has to
supply them.

Those stylesheets were written against LB's token names (`--cream`, `--navy`,
`--orange`, `--green-d` …). Rather than rename ~300 usages, the old names are
kept as **aliases repointed at the OnlyBoosts palette**. Trust the values, not
the words — `--orange` is brand cyan. New code should prefer `--brand` / `--ink`
/ `--surface`.

**⚠️ THE FEED ACCENT HAS A FOURTH STEP, `--*-accent-dd`, AND IT IS FOR TEXT.**
Same idea as `--brand-dd`: white on `--bg-accent` measures **2.50:1** and the
same colour as ink on cream is **2.29:1**, so anything small wearing the accent
is illegible. The phone's tab chips read it both ways — as a fill under white
when selected, as the label and border when not — which is where Reed saw it
(2026-08-23). The value is the least darkening of the cyan that reaches 6:1 on
white. `--accent-dd` is mapped beside `--accent` on every `body[data-active-feed]`
row, and `--tab-dd` rides beside `--tab` on the tabs because CSS cannot build
one custom property's name out of another's.

**⚠️ THE DESKTOP TAB AND THE SUB-ROW STILL USE `--accent` AND STILL MEASURE
2.50:1.** Only the phone chips were changed, which is what was asked for and
where the type is smallest. It is the same bug at a larger size; fixing it means
the selected tab and the block below it stop sharing a fill, which is the thing
the seam note under **The Three Tabs** exists to protect. A decision, not an
oversight.

Brand colors are sampled from the supplied art: `--brand: #00aff0` and
`--brand-d: #068ace`. **⚠️ THE PER-FEED ACCENT RAMP IS RETIRED.** *Reed's call,
2026-08-27, on seeing the feeds beside dark mode:* the eight feeds sat on one
cyan→indigo→violet ramp, the violet tail marking the music half of the medium
split, so switching feed shifted the page wash. Every feed now wears the one
brand-cyan family — the one Members · Global always wore, and the same accent
the detail pages supply — in both themes. **The retirement is values-only**: the
eight family names survive in `index.html` as aliases of `--bg-*`, the
`body[data-active-feed]` mapping is untouched, and the dark remap touches
`--bg-*` alone (a dark line for any other family would silently override the
aliasing — the inline comment says so). A revival is repointing the aliases; the
ramp's light and dark values and the reasoning that picked them are in git
before 2026-08-27. `--accent` / `--accent-d` / `--tint` remain the only names
the shared chrome sees.

## Site identity

| | |
|---|---|
| Domain | `onlyboosts.social` |
| npub | `npub1nmd7u4f5ewsjn6wp4zd9pc4jnadtmluanfhm2g0xryrdga7e7xxq0as4ck` |
| pubkey (hex) | `9edbee5534cba129e9c1a89a50e2b29f5abdff9d9a6fb521e61906d477d9f18c` |
| Lightning | `onlyboosts@getalby.com` |
| Bot npub | `npub182r6r8yqr4t3zxcfq4tfyfwjkg9nn525ljfmaadg72rqcsymsnvslda3ge` |
| Bot pubkey (hex) | `3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9` |

**⚠️ THE BOT IS A SECOND IDENTITY AND THE SEPARATION IS THE POINT.** It signs
boost notes for donors with no Nostr account (see "The Site Signs For A Booster
Who Has No Key" in `docs/money-paths.md`), and a signing endpoint is an attack
surface however well validated. Rotating a bot key costs a profile and one booster page; rotating the
site npub costs NIP-05, `.well-known/nostr.json`, and the `client` tag on every
event ever published. Both names resolve from the one `.well-known/nostr.json`:
`onlyboosts@` and `boostbot@`.

**⚠️ THE BANNER IS TWO FILES AND THEY ARE NOT INTERCHANGEABLE.**
`assets/onlyboosts_banner_clear.png` is the artwork on transparency and is what
the masthead renders; `assets/onlyboosts_banner.png` is the same artwork
flattened onto white and is the `og:image` on every page plus `OG_FALLBACK` on
the four detail pages and `BANNER_PATH` in `/api/og/booster`. **Change the art
and both files move.**

The split is about who composites. The wordmark is brand cyan and nothing else
(measured: 15% of the image is ink, all of it cyan), so on transparency it sits
on whatever the page's background is — which is what makes a dark theme a
palette change rather than a second banner. A **preview crawler** composites a
transparent PNG onto a background it picks and never discloses, so a share card
is the one surface where the flattened copy is the safe one. Only the clear file
is in `PRECACHE_URLS`: the opaque one is fetched by crawlers and never by a
browser, so precaching it spent 93KB on every install for nothing.

The domain appears in `robots.txt`, `manifest.webmanifest`,
`functions/sitemap.xml.js`, the CORS allowlist in
`functions/api/data/[[path]].js`, page canonical/OG tags, and the `client` tags
on published events — change them together. The npub is also served for NIP-05
from `.well-known/nostr.json`.

The site subtitle is **"Podcasting 2.0 Nostr Boosts"**, appearing in four places
that change together: the masthead line under the banner on `index.html` (where
it links to `/about`), the homepage `<title>` and `og:title`, and
`manifest.webmanifest`. It read "Podcasting 2.0 Boosts on Nostr" until
2026-08-24; *Nostr boost* is the term the project settled on in public, so the
subtitle now uses it as the compound noun the vocabulary table already treats it
as. **Show pages still use `<title> — Boosts on Nostr | OnlyBoosts`** and were
deliberately left alone: there the phrase follows a show's name and reads as a
description of the page rather than as the site's own label.

## ⚠️ Money paths

Two separate things are both called "boost":

- **Boosting a podcast** — sats go to that show's own value split, parsed from
  its RSS feed. `externalBoost.js` / `externalBoostagram.js` / `payAllLegs.js`.
  This is the main event and it pays third parties.
- **Donating to the site** — one leg at 100% to `RECIPIENT_LUD16`, behind the
  nav's Donate button. **It runs the BOOST flow, not a flow of its own**:
  `openSiteDonation` → `openExternalBoost` → `ExternalBoostModal` with a
  synthetic one-leg bundle. See *A Donation Is The Boost Flow With One Leg* in
  `docs/money-paths.md`.
  `BoostModal.jsx` and `MultiLegBoostForm` were the retired LB path and were
  **deleted on 2026-08-23**; see *What The Strip Removed*. `boostagram.js`
  survives and is live — `index.jsx` imports `bolt11PaymentHash`,
  `confirmInvoiceSettled` and `RECIPIENT_LUD16` from it.

All LB payment and identity values were replaced on fork and the shipped
`assets/widgets/login-widget.js` was rebuilt — verified zero occurrences of LB's
address, npub, feed GUID, or host addresses. **`login-widget/` is a build
artifact: editing `login-widget/src/` changes nothing until you run
`npm run build`.** Verify after any change to a money path:

```sh
grep -c "onlyboosts@getalby.com" assets/widgets/login-widget.js   # expect >= 1
```

`LNADDRESS_OVERRIDES` in `recipientOverrides.js` is deliberately empty. An entry
there silently reroutes sats away from the address a show's RSS names, without
telling donor or recipient. That was defensible on LB (Reed's own feed); here it
would divert money from third-party shows. Only add one for a feed OnlyBoosts
owns.

**It has a twin: `EXTERNAL_OVERRIDES` in `assets/js/value-block.js`, and both
must stay empty.** They are two separate maps on two sides of the fork's strip,
which is how the LB entry survived: `recipientOverrides.js` was emptied, then
`8bc4cf9` restored `value-block.js` wholesale with
`boostbot@fountain.fm → aquafox30@primal.net` still in it. It shipped, and
rewrote Fountain's 2% leg on a live external boost before being caught on
2026-07-27. **No leg of a third party's value block is ever rewritten, renamed,
merged or dropped** — `applyExternalOverrides` is a documented passthrough, and
the external boost pays exactly what the show published. If OnlyBoosts ever takes
a cut it gets its own leg under its own name. Grep both maps after any restore
from `lb/main`.

`FEED_GUID` in `boostagram.js` is deliberately `null` — OnlyBoosts is a client,
not a podcast, so it has no feed to claim. Inheriting LB's GUID would have
mis-tagged every share note as a Local Bitcoiners boost and polluted LB's own
collector, which filters on exactly that GUID.

Code edits, dry runs, and read-only inspection are fine without asking.
**Confirm with Reed before running anything that signs or publishes a Nostr
event, or that moves sats.** Published events can't be unpublished. **New bots
start with `DRY_RUN = True`.**

### The rest of the money paths: `docs/money-paths.md`

**That file is the authority for every payment and publishing decision on this
site**, and it is long because each rule in it cost something to learn. Its
sections, so you know when to open it:

| Section | Answers |
|---|---|
| A Lightning Address With No CORS Headers | why `/api/lnurl` exists, and why it is a **fallback, not the route** |
| ⚠️ A Payment We Cannot Confirm Is Not A Payment That Failed | `FAILED` vs `UNCERTAIN`, the 90s watcher, the double payment of 2026-08-19 |
| What A Recipient's Server Says Is Shown To The Donor | `readErrorReason`, and why it is never passed through `friendlyError` |
| Waiting Is Not The Same Event As Giving Up | `PAY_STAGES` / `CHECK_STAGES`, and why the wallet's own 45s hang must not be shortened |
| The Share Note Reports What Settled | `paidSats`, the `amount` tag this site's own collector reads, one note per boost |
| The Login Is Not A Gate On The Wallet | no Gate 1; a session-only wallet, and why the NWC URI is never persisted |
| The Boost Modal Declares What Happens To The Note | two controls, four outcomes, `boostAnonymously` vs `noteRoute` |
| A Donation Is The Boost Flow With One Leg | the nav's Donate button, and why a donation carries no `amount` tag |
| Getting A Boost Into Helipad | the three tiers, and why tier one is preferred |
| The Keysend Upgrade | the wallet gate, the `fountain.fm` exclusion, the whole-or-nothing routing pair |
| The Wallet Gate Is Behind The Boost Button | compose first, pay second; `remembered` is not `connected` |
| The Site Signs For A Booster Who Has No Key | `/api/sign-boost`, the allowlist validator, why proof-of-payment was rejected |
| The one boost button | `boost-button.js` is chrome, not a money path; six surfaces, six handlers |

Five rules from it that a change elsewhere would break, so they are restated here:

- **⚠️ ANONYMOUS AND PRIVATE ARE DIFFERENT ANSWERS TO DIFFERENT QUESTIONS.** An
  anonymous boost is **still published**, by OnlyBoosts, with no npub attached —
  that is the whole point, an anonymous booster still counts in the feeds and the
  totals. Only the Private Boost checkbox suppresses a note. `'none'` is reachable
  **only** through that checkbox; Anon routes to the bot. **Reed's correction,
  2026-08-21**, after a version that let Anon suppress shipped for a few hours.
- **⚠️ `boostAnonymously` AND `noteRoute` ARE TWO DERIVATIONS AND NEITHER MAY
  ABSORB THE OTHER.** The first governs the boostagram's `sender_name` /
  `sender_id`; the second governs who signs. BMB shipped that promise broken twice
  by letting one expression carry both. **`sender_id` never rides without the
  profile behind it.**
- **⚠️ THERE IS NO RE-PAY PATH OUT OF `UNCERTAIN`, ANYWHERE.** Reed's call,
  2026-08-19. `UNCERTAIN` offers only **Check again**; only `FAILED` may be
  re-paid, and only because it means the wallet never sent it
  (`isCleanPaymentDecline` in `utils.js`, read by all three payment paths).
- **⚠️ THE TWO OVERRIDE MAPS STAY EMPTY** — see above. That is the one rule in
  this file that has already been violated in production.
- **⚠️ THE ORACLE'S CAP AND THE MODAL'S ARE THE SAME NUMBER** (5,000,000 sats).
  `SITE_SIGN_MAX_SATS` restates `MAX_AMOUNT_MSAT`; `scripts/test-sign-boost.mjs`
  enforces the equality, and the validator is fed by the **shipped** note builder
  so a new tag fails the test rather than production.

## Bot conventions

- One bot per subdirectory, script named `onlyboosts_{function}.py`.
- Shared utilities live in `bots/shared/` — import from there, never copy/paste
  relay lists or publish helpers into individual bots.
- State files (`state.json`, `last_seen.txt`, `published_events.json`) sit next
  to each bot and are gitignored.
- Prefer a clean copy of an LB `shared/` utility over importing across repos —
  the two projects push to different remotes and must stay independently
  cloneable.

## Relay sets

**A relay list is defined by the kind it carries and the audience it reaches, not
by which relays are popular.** Every set in this repo was re-derived from that
rule on 2026-08-12, measured against the 61 distinct boosters behind the 100 most
recent boosts. **Re-measure before changing one**; the numbers below are the
whole argument, and reputation is a bad proxy for them.

**⚠️ Reading and publishing are different jobs and take different sets.** A read
set answers "who HAS this event", which is measurable, and a useless member costs
latency on every query. A publish set answers "who will SEE this event", which
cannot be measured from outside, and an extra member costs one socket on an
infrequent action while omitting one costs reach nobody can observe. **So the
read sets are cut to what the measurement supports and the publish sets are
deliberately generous, and a low score is not an argument against a publish
target.** One list doing both jobs is the smell that produced the split.

| Relay | kind 0 | kind 10002 | kind 3 | kind 1 |
|---|---|---|---|---|
| `relay.fountain.fm` | 0% | 0% | 4% | **98%** |
| `nos.lol` | 78% | **59%** | **75%** | 44% |
| `relay.ditto.pub` | **80%** | 42% | 67% | 32% |
| `relay.mostr.pub` | 47% | 36% | 47% | 44% |
| `relay.wavlake.com` | 37% | 37% | 24% | 14% |
| `purplepag.es` | 32% | 37% | 50% | 0% |
| `relay.primal.net` | 6% | 4% | 18% | 29% |
| `relay.nostr.band` | 0% | 0% | 0% | 0% |

| Set | File | Kinds |
|---|---|---|
| `STATIC_RELAYS` | `assets/js/boosts-thread.js` | read 1 threads + 3 follows |
| `FALLBACK_RELAYS` | `login-widget/src/lib/ndk.js` | **read** 0, 10002 |
| `OUTBOX_RELAYS` | `login-widget/src/lib/ndk.js` | read 10002 only |
| `PUBLISH_RELAYS` | `login-widget/src/lib/ndk.js` | **publish** 1 share notes |
| `BOOSTAGRAM_RELAYS` | `login-widget/src/lib/boostagram.js` | publish 30078 |
| `NC_RELAYS` | `login-widget/src/components/LoginScreen.jsx` | 24133 bunker transport |
| `BUG_RELAY` | `login-widget/src/lib/bugReport.js` | 1, tag-gated, isolated |
| `BOOTSTRAP_RELAYS` | `bots/shared/nostr_utils.py` | 0, 3, 10002 |
| `NOSTR_RELAYS` | `bots/shared/nostr_utils.py` | publish 1 |
| `CORE_` / `PROFILE_` / `RECEIPT_RELAYS` | `bots/global-boost-scan/relays.py` | 1 / 0+10002 / 9735 |
| NIP-05 hints | `.well-known/nostr.json` | mirrors `FALLBACK_RELAYS` |

Findings that outlive the numbers:

- **⚠️ `relay.damus.io` is gone and must not come back.** It answers a WebSocket
  connect with **HTTP 503**. It was first in every browser-side list.
- **⚠️ `relay.getalby.com` is NWC transport, not a relay.** Both it and `/v1`
  answer *every* REQ with `blocked: Request rejected`, so a note published there
  can never be read. NWC is unaffected either way: the wallet's relay comes from
  the connection string.
- **A relay has to accept the kind.** `purplepag.es` stores only 0/3/10002 and
  was in `BOOSTAGRAM_RELAYS`, where a kind-30078 publish could never be stored;
  `relay.fountain.fm` refuses 30078 with `kinds not supported`.
- **Aggregators are not automatically worth a slot.** `purplepag.es` scored
  respectably alone and added **zero** marginal coverage once ditto and nos.lol
  were present. Same for `relay.primal.net`, which was in five sets. That is the
  *relay*; `cache1.primal.net` behind `primal-profiles.js` is a different service.
- **⚠️ NDK dials relays this repo never names.** It builds a second, outbox pool
  from its own `DEFAULT_OUTBOX_RELAYS` (`purplepag.es`, `nos.lol`) unless
  `outboxRelayUrls` is passed. `ndk.js` now passes the option explicitly.
- **⚠️ Publishing to Primal's RELAY is not how Primal users see a note.**
  Measured on a real boost note: absent from `relay.primal.net`, which held **0**
  of that author's kind-1s, and simultaneously **present in `cache1.primal.net`**,
  which is what the Primal client reads. `relay.primal.net` is in
  `PUBLISH_RELAYS` on the read/publish asymmetry above, not on evidence.
- **Fountain boosts are heavily `relay.fountain.fm`-only (~90%)**, which is why
  it is in `NOSTR_RELAYS` despite not being general-purpose. Don't prune it.

**⚠️ `publishRelaySet()` in `ndk.js` unions `PUBLISH_RELAYS` with NDK's pool, and
the union is load-bearing.** `ensureUserWriteRelays` seeds that pool with the
signed-in user's NIP-65 write relays, so a relay set built from `PUBLISH_RELAYS`
alone would replace the pool and silently stop publishing to the user's own
relays — the note still publishes, to the wrong audience, and no error is raised.

Floors worth knowing before chasing coverage: **11% of boosters have no kind 0 on
any relay tested, and 36% have no kind 10002.** No list closes that.

### `NC_RELAYS` Is a Third Job, and the Signer Pays for a Bad Member

**⚠️ The `nostrconnect://` relay list is OURS, not the user's signer's.** NIP-46
requires the signer to answer on the relays named in the URI, so the relays
configured in someone's Amber do not govern that handshake; they govern the
`bunker://` path, where the pasted string carries the signer's own list.

That makes this neither a read set nor a publish set. A member has to be
reachable **by both sides** and has to carry kind 24133, which is ephemeral, so
nothing is stored and a reply arriving while nobody is subscribed is gone for
good. Re-derived by publishing a throwaway 24133 to each relay and watching a
second socket for delivery:

| Relay | Publish | Relayed |
|---|---|---|
| `relay.primal.net` | `OK: true` | yes |
| `relay.ditto.pub` | `OK: true` | yes |
| `nos.lol` | `OK: true` | yes |
| `relay.mostr.pub` | `OK: true` | yes (tested spare, not shipped) |
| `relay.nsec.app` | HTTP 502, socket closes 1006 in ~540ms | — |
| `relay.nostr.band` | TCP connect never completes; ~10s, then 1006 | — |

- **⚠️ An OK is not proof of transport.** `relay.fountain.fm` answers `OK: true`
  and then CLOSEs the subscription with `kinds not supported`. **Test the read
  side too.**
- **⚠️ A hang costs more than a refusal, and the SIGNER pays it.** A 502 is half
  a second; a connect that never completes costs the dialer's whole timeout, and
  the dialer is the signer app, off where this site cannot see or report it. That
  is what a login "taking forever and then working" looks like.

The URI also names `perms` (`get_public_key`, `sign_event`). Amber prompts once
per ungranted scope and the second prompt lands after the user has tabbed back to
the browser, which is where a connect appears to hang; naming both up front lets
one screen approve them.

Untested, and the one thing to confirm: **write policy.** Every relay above
reports open writes in NIP-11, but strfry usually leaves `restricted_writes`
unset, so a publish target is unproven until an event actually lands.

## The exclusion list

`excludes.json`, at the repo root. Anything named in it is filtered out of every
published surface — the JSON shards, the D1 projection behind `/api/v1`, the show
and episode pages, search, the podroll graph, and the counts on `/about`. It
ships **empty**; it exists so a takedown request is answered by one edit.

**It is at the repo root, and it is public, both on purpose.** The repo is public
and the file is the answer to "what are you hiding, and why" — so every entry
carries a required `reason`, and `pages_build_output_dir = "."` means it is also
served at `onlyboosts.social/excludes.json`. Its `_readme` key is the user-facing
documentation; JSON has no comments, so the file carries its own.

**Four lists, and the medium split does not get its own.** `shows` covers albums
and `episodes` covers songs, because an album *is* a show with
`<podcast:medium>music`. The other two are `boosters` and `boosts`.

**Nothing is deleted.** The collector keeps indexing everything; the list gates
what is *published*. That is what makes it reversible — removing an entry
restores the content on the next pipeline run, verified end to end.

**⚠️ A guid is matched against every identity slot**, not the one its list is
named after. Clients demonstrably sign an *item* guid into the `podcast:guid`
tag. Measured on the live index, 52 of the 107 boosts to one episode name it in
the show slot with no `item_guid` at all, so matching `episode` against
`item_guid` alone would have left most of them published. These ids are opaque
and unique, so a listed id turning up in another slot only ever means the same
content. See `db._excluded_expr`.

**A malformed file is fatal, a missing one is empty.** A file that exists and
doesn't parse raises, and the run scripts validate it as their *first* step so
the failure is legible rather than a traceback inside a scan. The failure mode
being guarded is a typo'd key (`"show"` for `"shows"`) silently excluding nothing
while everyone believes the content is gone.

The collector-side mechanics — `excludes.py`, `db.apply_excludes()`,
`db.not_excluded()`, the podroll and shard-pruning surfaces, and the D1
re-projection queue — are documented in `bots/global-boost-scan/`. Two things to
know from this side: **use `db.not_excluded()` rather than writing `excluded = 0`
by hand**, so a new query is found by grep; and `onlyboosts_globalscan.py
excludes` validates the file and reports what each entry currently hides, which
is the check to run after an edit.

**The removal path is deliberately not documented on the site.** `/about` says
nothing about how to be excluded, and `docs/about-and-faq-source.md` is
intentionally silent on it too. Reed's call; don't add it as a "missing piece".

## The duplicate filter

`bots/global-boost-scan/dedupe.py`, live since 2026-08-24, and **its docstring
is the design record** — the rule, the evidence tiers, and the measurements
behind every threshold. What belongs here is only what a change elsewhere
would break.

One payment can produce two notes: the donor's app publishes one, and a
node-watching relay bot (`chadf-boostbot`) publishes another for the same
boost. Before BMB/OB/LB spoke NIP-73 the bot's note was the only record; now
it double-counts the boost, the sats and — different signing keys — the
booster. The filter marks the relay copy `dup_of = <kept event_id>` and keeps
the app's own note, which may be donor-signed, so the real member keeps the
credit. 62 historical rows were marked on flip-on (42 BMB, 14 StableKraft, 6
Bowl After Bowl, 25,265 sats); the pass runs every incremental cycle over a
7-day trailing window.

- **⚠️ `dup_of` IS ITS OWN COLUMN AND MUST NEVER FOLD INTO `excluded`.**
  `apply_excludes` recomputes that flag wholesale from excludes.json on every
  connect and would silently unmark every duplicate. `db.not_excluded()` gates
  on both, which is how one edit reached every published surface — keep using
  it rather than writing either flag by hand.
- **⚠️ SATS + GUID + TIME WINDOW ALONE OVER-FILTERS, MEASURED.** 651 pairs of
  same-amount, same-episode boosts minutes apart are distinct real payments
  (live-show boost storms). What prevents eating them: only
  `RELAY_PUBLISHERS`-signed notes are ever droppable, pairing is strictly
  one-to-one, and one evidence tier must corroborate — a ≥3-distinctive-word
  common run of the donor's own prose, or app agreement where the note's prose
  (if any) is fully contained in the partner's. **A pair with no evidence is
  let through, and contradicted prose blocks even a same-app match** — Reed's
  call, 2026-08-24: a duplicate slipping through beats a real boost filtered
  out. Don't tighten toward recall.
- **⚠️ ONE-TO-ONE HAS ONE EXCEPTION, ON THE RELAY SIDE.** `chadf-boostbot`
  signs one receipt and one note **per keysend leg**, so a multi-leg boost is
  2–3 identical bot notes and the claim used to block the second from the
  partner the first had matched — 7 duplicates reached D1 that way (found
  2026-08-30). A relay note whose identical sibling (same publisher, same hard
  key, prose equal once `nostr:`/URL tokens are stripped, ±`APP_WINDOW`) is
  already marked is marked against the same partner, tier `sibling`. It only
  ever attaches to a partner the tiers already matched, so it cannot reach a
  non-relay note. **It is deliberately not a partnerless "identical siblings"
  rule** — Reed's call, 2026-08-30: 233 real same-author identical-text pairs
  within 300s exist, and #40HPW hours are `DISTINCT (booster, episode)` so a
  second note never adds hours anyway. The 77 partnerless bot clusters stay.
- **A new republisher bot is out of scope until registered**: its pubkey in
  `clients.py#PUBLISHER_PUBKEYS` (the member wall already forces this) and its
  slug in `RELAY_PUBLISHERS` — relay bots only; the first-party publisher keys
  (BMB's site account, our bot, LB's show account) are never the droppable
  side, their note being the payment's own record. A bot whose notes carry no
  message and no discoverable app identity slips through until a fingerprint
  joins `APP_DOMAINS`; that is the accepted cost of never guessing.
- **Reversal is two deletes, and D1 heals itself**: clear the row's `dup_of`
  and its `d1_boosts_synced` marker, and the next delta re-inserts it; marking
  rides the same `d1_reproject` queue an exclusion uses, which recounts the
  touched show, episode and profile rows remotely.
- `onlyboosts_globalscan.py dedupe [--days N | --all] [--dry-run]`; the last
  full-history report is `data/dedupe-report.txt` (gitignored).
- **The site needed no change** — it reads D1 and the shards, both corrected
  at the source. `/about` does not yet disclose the filter;
  `docs/about-and-faq-source.md` is where that copy starts if it ever should.

## Data feed

**⚠️ THE CORPUS STARTS 2024-07-01, SINCE THE DEEPSCAN RECOVERY OF 2026-09-01.**
Fountain notes carried `i` tags with no `k` tag until ~2025-04-14, so the scan's
`#k` filter was blind to that whole era while the events sat on
relay.fountain.fm (which retains to late 2022). `onlyboosts_globalscan.py
deepscan` recovered ~15k boosts by #i-per-guid and authors= walks. Detail lives
with the collector (commit 2fa7869 and the deepscan section of the script's
docstring).

**⚠️ EVERY SCHEDULED WALK ASKS RELAYS WITH THREE FILTER SHAPES, NOT ONE, SINCE
2026-09-03.** `#k` alone only matches a note that carries a `k` tag, and
StableKraft and Wavlake's own app still publish `i` tags with no `k` —
measured that day: 415 boosts since 2025-06-01 sat on the core relays unseen
by every pass (209 linking stablekraft.app, 140 fountain.fm, 65 wavlake.com),
found by chasing one StableKraft boost Reed noticed missing. `scan.py`'s
`boost_filters()` adds `#i` per known show guid and `authors` per known
booster, read from the index at the start of each run, and the incremental,
backfill and outbox walkers all take the set — so a show or booster first seen
through a `#k` note on one tick is covered by the k-free shapes on the next.
The residual is a first-time booster on a show the index has never seen,
without a `k` tag; no filter Nostr offers reaches that, and the fix is the
client sending the tag NIP-73 specifies (Reed is asking StableKraft; Wavlake
has larger problems). Those boosts land **unlabelled** by design: the only
evidence of the app is the URL the note links, and `clients.py`'s rule is
never to guess. The window the single-shape scan had already walked was
caught up with `backfill --force --floor 1748736000` on 2026-09-03; the scan
docstring carries the two relay quirks the wider filter set met (per-filter
caps make a multi-filter REQ unpageable, and two nginx fronts 429 back-to-back
handshakes).

Two stores, one model. **D1 behind `/api/v1/*` is what every feed and page
reads.** The collector also publishes static JSON to
`https://relay.mynostr.app/onlyboosts/`, proxied through
`functions/api/data/[[path]].js` (`/api/data/*`); that remains a published
dataset, but the only thing on the site still reading it is `/about`'s stat strip
(`meta.json`).

**⚠️ The upstream returns HTTP 200 for missing files.** `relay.mynostr.app`
serves Nostr on the same origin, so an unknown path falls through to the relay
and answers `200 text/plain "Please use a Nostr client to connect."` — not a 404.
Never branch on status. The proxy has two load-bearing guards: it checks the
content-type *and* parses the body as JSON before returning it. Don't "optimize"
the parse away by streaming the body through.

Path handling is a **strict allowlist**, not a passthrough — a catch-all that
forwards whatever it's given is an SSRF hole. The published shapes are
enumerated in `PATH_RULES`: `index.json`, `latest.json`, `boosts/YYYY-MM.json`,
`podcasts/index.json`, `podcasts/<guid>.json`, `profiles.json`, `meta.json`.
Directories aren't browsable — **discover filenames from the manifest**, never
build paths by hand.

Full schemas live upstream in `bots/global-boost-scan/DATA-API.md`.

### Record shape and nullability

```
{ id, ts, sats, src, msg, client,
  booster{pk,npub,name,pic}, podcast{guid,title,img,feed},
  episode{guid,title,img,date,num,url} }
```

Almost every display field is nullable. Measured over a 1,000-row sample: `msg`
16%, `booster.pic` 15%, `episode.title` 11%, `episode.num` 61%, `podcast.guid`
2%. `ob-data.js#normalizeBoosts` flattens all of it so the *only* fields a caller
may assume are `id`, `ts` and `booster.pk` — everything else is explicitly
nullable and must have a fallback.

Two shape traps:

- **`episode.guid` is sometimes a URL**, not a UUID. Treat it as an opaque key.
- **The per-show shards stringify numerics** (`"9"`, `"55987"`, `"None"`), so
  coerce rather than trusting `typeof`.

Booster names and avatars are **embedded in every record**, so there is no
profile round-trip and nothing to repaint — first paint is final.

### The two client data modules

`ob-data.js` is **shape only**: `normalizeBoosts`, `toEpisodeShape`,
`episodeApiToBoosts` and `boosterLabel` are the reason every consumer downstream
of a fetch sees one model. Its fetching half was deleted on 2026-08-14.

**⚠️ Verify per function INCLUDING internal callers before removing anything
here.** A grep that excludes the file itself hides functions whose only caller is
a sibling in the same module, which is what made `mediumPredicate` look live.

`ob-live.js` is the D1 reader and caches nothing in-process. Two shapes:
`followsBoostReader()` pages incrementally for the note feed;
`getFollowsBoosts()` pulls a bounded corpus for the episodes rollup, capped by
`MAX_EAGER_ROWS` / `MAX_EAGER_PAGES` and reporting `truncated`. That cap is about
how many *boosts* to roll up and is unrelated to the follow set's size.

Two Functions read D1 directly rather than through `ob-live.js`, because each
needs one bounded corpus once rather than a paging reader:
`/api/v1/episodes/<item-guid>?community=1` and
`/api/v1/boosters/<npub>`. Both return the standard boost record shape, so both
run through `normalizeBoosts` and everything downstream sees the one model.

**⚠️ `/api/v1/boosts/follows` passes its whole author list as one bound JSON
array, unrolled by `json_each`.** D1 imposes two limits a large `IN (...)` hits
from opposite sides: 100 bound parameters per statement, and 100,000 bytes of
statement text. One bind per author breaks at 99 follows; interpolating instead
runs out around 1,480. The JSON array escapes both — the statement is a fixed
~180 bytes however many authors there are. Verified on SQLite 3.51 that the plan
still resolves through `idx_boosts_booster`.

Cloudflare documents JSON1 but doesn't enumerate the table-valued functions, so
the endpoint keeps an interpolated fallback if D1 rejects `json_each`. **That
fallback is the only place SQL is built by concatenation**; it's safe because
every value has been through `toHexPubkey` and re-tested against `HEX64`. Don't
generalize the pattern. `MAX_AUTHORS` (10,000) is an abuse guard, not a technical
ceiling.

### Follows scoping

`assets/js/follow-set.js`. `resolveFollows()` reads the signed-in pubkey from
`localStorage.lb_nostr_session` — deliberately *not* by loading the 1MB login
widget, since all we need is an identity, not a signer — then fetches that user's
newest kind-3 across the static relays and unions its p-tags.

**An nsec login is never persisted** (`LoginScreen.jsx` keeps the key in memory
only), so localStorage is empty for a user who is genuinely signed in.
`getSessionPubkey()` therefore falls back to
`window.LBLogin?.getUser?.()?.pubkey` — read only if the bundle is *already*
loaded; it must never load it, which is the whole reason this module exists.
Cached 30 min, keyed by pubkey so an account switch can't serve the previous
user's list; an empty result is never cached. Returns `signed-out` / `ok` /
`empty` / `unavailable`. The user's own pubkey is in the set, so your own boosts
appear in your Follows feed.

**`lb:session-change` is what keeps this in sync.** `setUser` in the widget
dispatches it whenever the *identity* changes (not on profile refreshes). Two
listeners, both also watching `storage` for the same thing in another tab: the
inline feed-bar controller shows/hides the scope menu and drops you back to
Global if you sign out; `feeds.js` drops both `*-follows` keys from its `loaded`
set and re-runs whichever is on screen.

The renderers still carry a `signed-out` branch. Unreachable through the feed bar
now, kept as a fallback.

**The Episodes feeds don't use `podcasts/index.json`.** The cards are *episodes*,
not shows, and the published index is a show-level rollup computed over everyone,
so its counts would be wrong for a Follows audience.

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
  window's chart view. **See *The OnlyBoosts Charts* in `docs/feeds.md`** —
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
- **⚠️ THE FEED BAR IS MOVED INTO THIS TAB AND MOVED BACK**, `appendChild` on the
  live element. **The move back is the half that breaks**: `.members-block` is
  `display:none` off this tab, so a bar left behind takes the scope menu and every
  feed's range and sort with it.
- **⚠️ `.mb-shell` / `.mb-lid` RESTATE `.bs-shell` / `.bs-controls`, THEY DO NOT
  IMPORT THEM** — this page does not link `show-page.css`. 1px `--border`, 12px
  radius, `--cream` fill, lid on `--cream-d`. **They must stay in step.**
- **⚠️ WEEKS START MONDAY 00:00 US PACIFIC**, and the DST rule is implemented
  **twice** — in `assets/js/pacific-week.js` and in SQL — because the two boards
  need it at different times. They cannot share code, so `test-members-hours.mjs`
  holds the hand-rolled rule against Node's real tzdata at both transitions, every
  week for four years.
- **⚠️ THE SECOND BOARD IS "Proof of #40HPW" SINCE 2026-09-01 AND IT IS ONE ROW
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
  mirror run. **⚠️ ITS STEP IN `run-incremental.sh` CARRIES A SECOND `push`,
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
- **⚠️ EVERY EPISODE LINK POINTS AT `/episode/<item-guid>`, AND THE QUALIFYING
  RULE IS THE TITLE**, not the guid. **Three copies of that one test must agree**:
  `show-link.js#episodePageHref`, `functions/show/[guid].js#episodePageUrl`, and
  `episode-link.js`. Each is marked in its own source.
- **⚠️ `episodeBoostLink` OWNS THE URL WRITTEN INTO A PUBLISHED BOOST NOTE, AND IT
  IS PERMANENT AND ABSOLUTE.** Notes published before the flip still point at BMB
  and always will. It returns null for a show-level boost; `/show/<guid>` is **not**
  the fallback target.
- **Two surfaces still point at boostmebitch.com on purpose**, both show-level and
  both through `bmbShowUrl()`: "See All Episodes", and a podroll tile for a show we
  have no page for.

## The detail pages

`/show/<guid>`, `/episode/<item-guid>`, `/booster/<npub>` and `/artist/<guid>`
are **one page with four subjects** (the artist page joined 2026-08-30). The back link, the stat tiles, the drawers, the boost list, the
community wall and the whole client chrome come out of two shared modules; what
differs is the subject and which sections apply.

| | `/show` | `/episode` | `/booster` |
|---|---|---|---|
| Hero | show art, "Boost this Show" | a **player card**: art, audio, chapters + show-notes drawers, eyebrow links the show | the person: avatar, banner, bio, lightning address |
| Stats | show totals | that episode's | that person's |
| Rollup | `#community-shows` | `#community-episodes` | `#shows` + `#episodes` |
| Community wall | `#community` | `#community` | — |
| Podroll | both directions | — show-level tag | — |
| Boosts | `#boosts`, opens on 24 | `#boosts`, all of them | `#boosts`, opens on 24 |

**Design of record for `/show` is `docs/show-pages-spec.md`.** What follows here
is only what a change would break.

**⚠️ The stat tiles are one row on a phone, whatever the count.** They are
`repeat(auto-fit, minmax(7rem, 1fr))` at full width, which on a 375px phone needs
360px for three columns against 335px of content — so `/show` and `/episode` broke
2 + 1 and `/booster` broke 2 + 2, and the second line read as a separate row of
figures rather than the rest of one. Under 640px the grid switches to
`grid-auto-flow: column` over `grid-template-columns: none`, which is what makes
it **count-agnostic**: three tiles become three equal columns and four become
four, with no rule naming either number. The maximum today is four (sats, boosts,
shows, episodes on `/booster`); a fifth wants looking at rather than squeezing in.
The type scales with `clamp()` rather than stepping, and **the binding constraint
is the LABEL, not the number** — "episodes" and "boosters" are eight characters,
where the widest figure is five.

**`/artist/<guid>` is the fourth, shipped 2026-08-30 with the Artists feed** —
the publisher tier's landing page, structured as the album page one level up
(Reed's spec): hero, Nostr Boost Stats tiles with the rank chip (`feedRanks`
gained a `publisher` kind ranking on the Artists feed), **#albums** ("Albums
with Nostr Boosts", the indexed declaring MUSIC shows by sats, the
episode-drawer chrome — **the page's one show list since 2026-08-31**, when
the artist tier went music-only and the launch-day `#shows` section for the
not-music declaring shows was REMOVED, a removal rather than a rename),
**#community-artists** ("Other Artists This Community Boosts",
the /show community rollup one tier up — NOT medium-split, because every row
is a publisher and there is no partition to cross), the **#community** wall,
and **#boosts** (opens on 24, whole corpus behind
`/api/v1/publishers/<guid>?corpus=1`, the shared boost-section machinery). No
boost button (PI cannot resolve most publisher feeds); index-only
throughout. Section ids `#albums` and `#community-artists` are frozen. It is
in `EDGE_PAGES`, the sitemap, and `show-link.js#publisherPageHref` is the one
place that decides an artist title links — the feed card reads it too.
`scripts/test-publishers-api.mjs` executes the page's extracted SQL.

**`docs/detail-pages.md` carries the rest**: the rank line in the stat tiles,
where the shared code lives, the section ids, the hash spy, the back link, the
drawer chrome, each page in turn, the two shared server modules,
the `#boosts` range and sort, message search, the show filter, the community
rollups and wall, and the sitemap.

What a change elsewhere would break:

- **⚠️ THE SECTION IDS ARE URLS AND THEY ARE FROZEN.** `/show`: `#episodes`
  `#community-shows` `#community` `#podroll` `#reverse-podroll` `#boosts`.
  `/episode`: `#community-episodes` `#community` `#boosts`. `/booster`: `#shows`
  `#episodes` `#boosts`. Ids are reused across pages on purpose where they name the
  same kind of section. `HASH_ALIASES` holds one permanent entry
  (`#inverse-podroll`) and **is the repair for a rename that already happened, not
  a licence for the next one** — it needs the module to have run, so a rename is
  still a dead link for anything resolving the URL without a browser.
- **Four pieces hold those ids up, in four files**: the ids on the `<section>`
  elements, `scroll-margin-top: 5rem` on `.show-section` (the nav is sticky at
  64px), `revealHashTarget()`, and `initHashSpy()`.
- **⚠️ THE HASH SPY USES `replaceState`, NEVER `pushState`.** Scrolling isn't
  navigation, and `replaceState` fires **no `hashchange`** — which is the only thing
  stopping the spy tripping `revealHashTarget()` and opening a drawer as a side
  effect of scrolling past it. The two coexist on exactly that property.
- **⚠️ THE RANK CHIP IS DRAWN ONLY INSIDE THE TOP 100** (`RANK_CUTOFF`), a
  display rule and not a change to `feedRanks`. It fails quietly to no third line.
  **`RANK_PUBLISHERS` in `feed-rank.js` restates `PUBLISHERS` from
  `functions/api/v1/_common.js` and the two must stay in step.**
- **⚠️ `.show-stat dd` SETS ITS TYPE WITH THE `font:` SHORTHAND**, which carries
  the family, and `.show-stat dd.show-stat-rank` is (0,1,1) where a lone
  `.show-stat-rank` is (0,1,0). **When a stat-tile rule looks ignored, check
  specificity before changing values** — and the trap is re-armed inside the 640px
  block.
- **⚠️ EVERY REPAINT RE-ATTACHES THE VERBS.** A rebuild that replaced the boost
  rows and stopped there produces a list of dead notes that looks correct.
  `boost-note-actions.js#wireBoostNotes(root)` is the scoped, idempotent half;
  `data-actions-on` stops a second bar being appended.
- **⚠️ `/episode` REDIRECTS TO THE SHOW ON A MISS RATHER THAN 404ING**, 302 and
  never 301. It exists because the two halves of the pipeline can disagree — a card
  links on the boost record's title, this page renders from D1's `episodes` table.
  **The fix belongs in the collector; this is the graceful failure meanwhile.**
- **⚠️ DON'T ADD A CLIENT- OR EDGE-SIDE REPAIR FOR A STALE EPISODE FIELD.** The row
  is the truth and the collector owns keeping it true, on a `checked_at` gate. A
  repair here would mask the collector and then disagree with it.
- **⚠️ `item_guid` IS NOT ALWAYS A UUID AND IT IS THE URL KEY** — 9% contain a
  slash, 30 are full URLs. Only ever `encodeURIComponent`d and bound, never parsed.
- **⚠️ WHICH ROOT EACH PAGE PASSES TO `hydrateProfiles` IS PART OF THE
  CONTRACT**, because it removes `data-missing` on its way out, including from an
  element whose shape it does not know how to fill. `/show` and `/episode` pass
  nothing; **`/booster` must scope to `#boosts`**, its bio mention having a private
  patch path.
- **The podroll's two queries and both community rollups are allowed to fail
  quietly.** A rollup below the fold must never cost a reader the page they came for.

## Show artwork: the `art2` fallback

Some feeds publish two artwork URLs, RSS `<image><url>` and `<itunes:image>`, and
the first is sometimes dead while the second resolves. The collector publishes the
second as **`art2`**, null when identical to `img`; `assets/js/cover-art.js` walks
the chain on error.

```
episode art  →  show art (img)  →  show art2  →  glyph / placeholder
```

**⚠️ `coverChain()` PROMOTES `http://` TO `https://` BEFORE IT FILTERS.** Every
page here is https, so an http image is mixed content: Chrome auto-upgrades it
and **blocks it outright if https fails**, never falling back to the insecure
copy. The http URL was therefore already unreachable as written, and promoting
it only stops the console filling with warnings and stops the chain holding two
entries for one picture. Measured over 200 boosts on 2026-08-22: 7
`episode.img`, 5 `podcast.img`, 1 `booster.pic`. A host with no https at all is
not made worse — an upgraded URL that fails advances to the next source exactly
as a dead https URL always has, which is what makes this safe to do to a third
party's URL. `httpsUrl` is exported for the two avatar render sites
(`boost-list.js`, `episode-card.js`), which do not go through the chain.

`coverChain()` filters to http(s) and **dedupes** — `art2` is meant to be null
when it equals `img`, but the shards are third-party data and a repeat would cost
a second request for the URL that just failed. `wireCoverFallback()` advances on
each error and clears its own handler at the end, so an unreachable placeholder
cannot loop; it returns `false` for an empty chain, which is the caller's cue to
render its no-art state rather than an empty `<img>`.

Wired on the feeds through `ob-data.js` (`normalizeBoosts` carries
`podcast.art2`, `toEpisodeShape` builds `imageChain`), `shows-feed.js`,
`boosts-feed.js` and `feeds-podcasts.js`. On the detail pages it is a
**`data-art2` attribute, not a second `<img>` or an inline `onerror`**: the
Function emits the attribute and `detail-page.js#initArt2` wires the swap through
the same `cover-art.js` helpers, so there is **no fetch at all** and the
no-inline-handler convention holds. It also handles what a deferred module can't
observe directly — the hero is `loading="eager"`, so it may have already failed by
the time the module runs, which `img.complete && !img.naturalWidth` detects.

`wireArt2()` covers all three `/show` surfaces: the hero, the community rows and
the podroll tiles. **The community drawer row was the surface this was missed on**,
and the one where it mattered most: those rows are *other* shows' artwork, so a
single show with a dead primary rendered broken on every page listing it while its
own page had already recovered. The cause was the query rather than the render —
the community CTE selected `p.image` and not `p.artwork`.

The `/episode` hero is the one chain that is **two** fallbacks long, because an
episode with no art of its own falls back to the show's primary before the show's
second chance. `data-art3` is that third link and exists nowhere else.

**The `/show` episode drawer rows are deliberately outside this.** A row falls
back to the show's `img` when the episode has no art, and does not go on to
`art2`. It bites only where a show has a dead primary *and* an episode with no
art, and episode art was 100% present on every show sampled.

**⚠️ The share card's TYPE follows its image, on all four detail pages.** A
large-image card crops to roughly 1.91:1, and nothing these pages send is that
shape: podcast artwork is square by specification (Apple requires 1400x1400 to
3000x3000, and 12 of 12 sampled from the live index are exactly 1.00), and a
booster's avatar is square or portrait (0 of 26 sampled were wide enough; 13 were
exactly square, the rest ran down to 0.67). Every page shipped
`summary_large_image` until 2026-08-16, so every cover and every face was being
sliced into a horizontal band — **a worse failure than sending no image, because
it reads as a broken picture rather than a missing one.** Artwork now gets
`summary`; only the fallback keeps the large card, `OG_FALLBACK` being the
1800x600 site banner. Two shapes, two cards, chosen by which is in use.

**⚠️ `/booster`'s share image is served through `/api/og/booster/<npub>`, not
named as the raw avatar URL.** A preview fetcher makes one request and cannot
fall back, and it stops reading at a size the page cannot see: **Signal Desktop
at 1MB** (`MAX_IMAGE_BYTES_TO_LOAD`), Android and iOS at 2MB. Measured
2026-08-18 over the 49 stored avatars behind the last 100 boosts, 5 answered 404
and 7 were over 1MB (largest 4.3MB), so a quarter of booster pages drew a card
with no image on Desktop while the phones were fine. The route looks the picture
up **by npub in D1** (never off the query string, so it is not an open proxy),
fetches it bounded, asks Cloudflare to resize it to 600x600 JPEG on the way
through (`cf.image`; ignored on a zone without Image Transformations enabled),
and answers with the banner for anything that is not a 200 raster under 900KB.
The header `<img>` still uses the raw URL, because a browser can run `onerror`.
`X-OB-Image: avatar|fallback` on the response says which path answered.

Two things that follow. **A platform caches OG data per URL**, so a link shared
before a page existed keeps its 404 card until the TTL expires or someone forces
a re-scrape — worth knowing before concluding a card is broken. And **`node
--check` is not a syntax check for these Functions**: it accepted a template
literal broken by backticks inside an HTML comment. Import the module instead.

**⚠️ `og:image` stays on the primary, deliberately.** A crawler cannot run the
error handler, so the temptation is to prefer `art2` there — but `art2`'s presence
means the feed publishes *two different* URLs, not that the primary is dead.
Measured over all five shows that carry one: **four primaries return 200 and one
404s**. Preferring art2 would swap four working share cards to fix one.

Live coverage is small and real: 5 of 1,287 shows.

## Profile fallback

**An identity the index doesn't have falls back to Primal's cache before it is
allowed to render as `@npub1abc…`.** `assets/js/primal-profiles.js` owns that
lookup (`fetchProfiles`, chunked at 100, never throws). It was extracted from
`boosts-thread.js` — which now imports it — so the detail pages can use it without
pulling in 156KB of thread machinery.

The index stays the fast path. The collector embeds a booster's name and picture
in every record, which is what makes first paint final; this only fills two holes:

- a booster whose kind-0 was unresolved when the collector last ran;
- **an npub mentioned inside a boost message**, who need never have boosted
  anything and so is in no table of ours at all. This is the common case.

Primal is a **cache, not a relay fan-out**: one WebSocket, one batch, ~6s timeout.

Two invariants:

- **It is always post-paint and best-effort.** Every surface renders complete and
  readable from the index alone; an unreachable cache changes nothing. Never make
  a first paint wait on it.
- **The detail pages mark their own gaps.** The Function emits `data-pk` +
  `data-missing="name pic"` on exactly the cards, rows and chips it couldn't fill,
  and the client patches those and removes the attribute. Don't let the client
  re-derive what the server already knows.

**⚠️ WHICH ROOT EACH PAGE PASSES IS PART OF THE CONTRACT, because
`hydrateProfiles` REMOVES `data-missing` on its way out — including from an
element whose shape it does not know how to fill.** So a page with a second,
private backfill cannot call it on `document`.

| Page | Call | Covers |
|---|---|---|
| `/show`, `/episode` | `hydrateProfiles()` | everything; neither page has a private path |
| `/booster` | `hydrateProfiles(#boosts)` | the boost list only |
| `/artist` | `hydrateProfiles()` | everything — the bio is plain text with no mention chips, so there is no private path to protect |
| any card rollup | `hydrateCardProfiles(list)` | its own cards, on approach |

`/booster` is scoped because its **bio** carries a `.bs-mention` chip with its own
patch path (`fillMention`, selecting `.bs-mention[data-pk][data-missing]`).
Unscoped, `hydrateProfiles` matches that chip, finds none of the four class names
it knows, fills nothing, and strips the attribute — after which the header's own
backfill selects nothing and the bio mention never resolves. Measured in a DOM
against the live cache: unscoped fills 16 of 16 chips and breaks the bio; scoped
fills 8 on load and the rollup's own pass takes the rest to 0 on approach.

**`/booster` had no call at all until 2026-08-16**, so the `nostr:` mentions
inside its `#boosts` messages stayed truncated npubs forever. The hook was
correctly emitted the whole time; nothing read it.

The Boosts feed **rebuilds the card** rather than patching it, seeding
`setCachedProfile` first so the mention chips inside the message body agree with
the avatar above them.

## Show credits: `author`

`<itunes:author>`, backfilled across all 924 identified shows. Measured over the
shipped index, counting non-empty values that aren't just the title repeated:
**97.4% on music (454 of 466), 88.0% on podcasts (405 of 460)**. The collector's
own scoping probe put this far lower because it judged *quality* by eye where the
table applies the mechanical rule the site implements. **Measure off the shipped
index, not the probe.**

On a music feed `author` is the artist and is clean. On a podcast it is whoever
the publisher named there: usually the host, sometimes a network
(`Jupiter Broadcasting`), occasionally a tagline. So:

- **Never label it "Host" or "Creator".** `Artist` on music, a softer `By` on
  podcasts. "By Jupiter Broadcasting" is true; "Host: Jupiter Broadcasting" is not.
- **The only filter is the title repeat** (normalize case, whitespace and a
  leading "The"). Do not build a tagline detector: any rule sharp enough to catch
  "Bitcoin is for Everyone" also eats real names, and a wrongly suppressed credit
  is worse than an odd-looking one.
- `medium` defaults to `podcast` for a feed that declares none, so an untagged
  music feed gets `By` rather than `Artist`. A known consequence of the partition
  rule, not a bug.

It renders as `creditLine()` on `/show/<guid>`, prints nothing when empty or when
it repeats the title (~7% of rows), and `.show-credit` has no reserved space so a
suppressed credit costs no layout. It is also in the Shows feed search entry's
`extra` — matched, never displayed, scoring below every title hit. Not in `sub`:
it would push the show's own numbers off a narrow card.

**Still open:** `author` is not matchable in `/api/v1/search`, which matches
through `podcasts_fts`, declared `fts5(podcast_guid UNINDEXED, title)`. Adding it
is a collector-side schema change plus a repopulate; a SELECT cannot do it. Also
open: `og:title` for music becoming "<artist> — <album>".

## Show language: `language`

RSS channel `<language>`, off the Podcast Index feed object. It rides the
`podcasts/byguid` call `enrich.py` already makes, so it costs **no extra
request**. Carried by `podcasts/index.json`, the per-show shards and D1's
`podcasts` table; `backfill_language.py` filled the existing rows.

**Stored as the primary subtag, lowercased** — `en`, `de`, never `en-US`. The
corpus describes ~21 languages in **36 distinct raw tags** (`en`, `en-us`,
`en-US`, `en-gb`, `en-au` are one language and five menu entries, and the case
varies by publisher). Anything not 2–3 alpha is dropped rather than stored, so a
junk value can't become a junk filter option.

**⚠️ NULL MEANS THE FEED DECLARES NONE, AND THAT IS NOT ENGLISH.** Coverage
splits hard on the medium: **99% of podcasts (466 of 469) against 48% of music
(232 of 485)**, because Wavlake — 198 of the 251 music misses — publishes no
`<language>` at all. Across the index that is **594 untagged of 1,294**. So an
untagged show is a populous, first-class state, not a gap to default away: a
filter that folds NULL into a language turns "filter by language" into "hide half
the Albums feed", under a claim those publishers never made. Same partition rule
as the medium split, where the unidentified shows are why the Shows feed is
`not_medium=music` and never `medium=podcast`.

**The tail is thinner than the show counts suggest.** Boost-weighted: `en` 17,286,
`de` 3,155 across 40 shows — essentially the whole non-English story — `es` 319,
every other language under 50. A menu listing all 20 is mostly dead entries.

`lang=` filters `GET /api/v1/podcasts` and `GET|POST /api/v1/episodes`, on all
four query paths (all-time read, windowed GROUP BY, `q=` ranking CTE, follows
POST). `readLang` / `langWhere` in `_common.js` are shared so both validate
identically. Three rules:

- **`lang=unknown` is how the untagged bucket is asked for.** There is
  deliberately **no `not_lang`**: medium needs its negation because every show
  must land in exactly one of Shows/Albums, and language has no such obligation.
- **A full tag is normalized, not rejected** (`lang=en-US` → `en`). Nothing is
  stored in that form, so a 400 would only trap a caller passing a value straight
  back from a feed.
- **Validated by shape, never against a fixed list.** The set grows the first time
  anyone boosts a show in a new language; a whitelist would 400 it.

**`GET /api/v1/languages` is the facet, and a control is built from it rather than
a constant** — the set is data, not software. It is `medium`-aware because `de` is
38 shows on the podcast side and 2 on the music side, and it returns the `unknown`
row as a peer.

`language` also rides `/api/v1/podcasts/<guid>`, `/api/v1/episodes/<guid>` and
`/api/v1/search`, for consistency with the shards. **It is not in `podcasts_fts`**
and nothing needs to *search* a language.

Remote D1 got `ALTER TABLE podcasts ADD COLUMN language TEXT` out-of-band, as
`artwork` and the profiles fields did — `CREATE TABLE IF NOT EXISTS` adds no
column to an existing table, so `bots/global-boost-scan/d1/schema.sql` and the
live remote are kept in step by hand. The backfill reached D1 through the
**metadata-drift pass**: bumping `shows.updated_at` is what makes a row due.

The UI shipped in `e870b93` — see **The Language Filter** in `docs/feeds.md`.
**Still open:** the Boosts endpoints take no `lang`, so the note feeds have no
language axis.

## Who published a boost: `client_id`

**`docs/boost-clients.md` is the authority** — the three signals and their
coverage, the three measurements that shaped the rules, `SLUG_ALIASES`, the chip
on the boost cards, and the two registered first-party publishers (OnlyBoosts'
own bot and the Local Bitcoiners show account).

A derived classification, not a field anyone published: the raw `client` column
stays exactly as signed and is never overwritten, which is why the derivation
lands in `client_id` / `client_via` / `client_src`. The NIP-89 `client` tag is on
**1.3%** of the corpus; the `fountain.fm` i-tag and known publisher pubkeys cover
the rest, and **39 boosts are left null rather than guessed**.

What a change elsewhere would break:

- **⚠️ THE PUBLISHER IS THE CLIENT; THE APP IT RELAYS IS NOT.** A relay bot's
  notes name the listener's app in `client_via`, nested under the bot and **never**
  promoted to `client_id` — those apps published nothing to Nostr. The publisher
  pubkey is tested **first**, so a `client` tag naming a relayed app could never
  promote it.
- **⚠️ THE BOOSTER IS THE PUBLISHER, NOT THE DONOR.** An uppercase `["P", …]`
  sender tag is read nowhere and must stay that way: nothing here can verify the
  named donor authorised a note signed by a key they do not hold. If it is ever
  surfaced it wants a `proxy_for_pubkey` column, rendered as "on behalf of …", and
  kept out of every count.
- **⚠️ THE CHIP NAMES THE PUBLISHER, NEVER `client_via`**, and an unattributable
  boost gets **no chip** (`hasClientLabel` is the gate). *Reed's call, 2026-08-24.*
- **⚠️ `assets/js/client-label.js` IS TWO-SIDED**, which is why the label table
  lives there and `functions/api/v1/clients.js` imports it rather than declaring it.
- **⚠️ THE BOOST DELTA IS `INSERT OR IGNORE`**, so a re-derivation reaches the
  query layer only through `d1_sync.py --remote-clients`. Nothing else re-pushes it.
- **⚠️ ALL FOUR DETAIL-PAGE BOOST QUERIES MUST SELECT `b.client_id`**, /artist's included. They are
  hand-written rather than `BOOST_SELECT`, so forgetting one renders no chip at the
  edge and a chip on every row after a re-sort. `test-boost-row.mjs` catches it.
- **⚠️ THE `via != slug` GUARD IS LOAD-BEARING FOR OUR OWN NOTES.** Our template's
  `📱 via onlyboosts.social` slugifies to `onlyboosts` — the slug itself — so
  without that guard every bot note nests OnlyBoosts under OnlyBoosts. Not dead
  defensive code.
- **⚠️ THE INDEX IS LOAD-BEARING FOR LB's PUBLISH DECISION.** LB's bot asks
  `/api/v1/boosts` before publishing, so a reclassification that drops rows, or a
  stale D1 sync, makes it publish a duplicate. **Flag such a change rather than
  shipping it quietly.** LB's daily audit files a GitHub issue carrying the event id.

**Still open: `/stats`.** A "boosts by app" breakdown is what `/api/v1/clients`
was built for and still has no surface.

## Not indexed: `podcast:person`

`<podcast:person>` is **not** in this pipeline and deliberately isn't being added.
The collector probed it and found ~6% coverage, confirmed against raw feeds rather
than the API, so it is not a Podcast Index limitation: the tags genuinely aren't
in the feeds. A credits section built on that is the near-empty block that is
worse than nothing. Revisit only if we ever parse channel-level RSS ourselves
*and* a wider scan changes the number.

`ownerName` is also not indexed, and that is the more useful finding: every show
carrying one **also** carries an `author`, so it never fills a blank. It is not a
fallback. Don't re-add it.

## Podroll: the collector side

`<podcast:podroll>` is **not in Podcast Index**, so `podroll.py` fetches the
show's own feed. **It is the only pass in this pipeline that touches third-party
RSS**, and that shapes all of it.

**Daily, never hourly** (`onlyboosts-podroll.timer`, 09:40 UTC). A podroll changes
when a publisher edits their feed, never when a boost arrives.

**⚠️ The timer's cadence is NOT the crawl's cadence.** `db.shows_needing_podroll`
is age-gated by `--max-age` (default 6d), so a feed read cleanly two days ago is
skipped however often the timer fires: on the day the cadence changed, **8 feeds
were due against 948 in a full sweep**. The corpus still turns over about once a
week. Don't "fix" the frequency by lowering `--max-age` to match it — that is the
7x-bandwidth version.

**A new show waits for this pass, and nothing else fills the gap.** There is no
podroll path on the incremental tick by design.

**⚠️ Politeness is load-bearing.** The first scoping sweep, 12 flat workers, drew
429s from 137 feeds, 135 of them Wavlake. Every one would have been recorded as
"no podroll" and the number would have looked plausible. Re-probed serially: all
135 fetched, none had a podroll. So `probe_feeds` groups by host and goes **serial
per host**, concurrent only across hosts. Assume any wide third-party sweep has
this failure.

Three more invariants:

- **Only a clean read may rewrite a stored podroll.** A 429/timeout/truncation
  means we failed to see the feed, not that the publisher deleted their list.
  `http-404` is deliberately not transient: a gone feed is a real answer.
- **Feeds are streamed and abandoned** at `</channel>` or 2MB (one indexed feed is
  50MB). The cap was validated, not guessed: all 48 feeds that exceeded it were
  re-downloaded in full and none carried a podroll past it.
- **The block is regex-parsed, not XML-parsed**, because it's third-party markup
  read from a deliberately truncated prefix. A podroll opened but never closed
  raises `Truncated` rather than storing half a list.

Coverage: 65 of 925 reachable feeds (7%), 371 edges, 221 distinct targets. Only
~56% of cards link anywhere; 136 of 221 targets were new to the index, and the
collector resolves those through PI `podcasts/byguid` and caches them with
`discovered_via='podroll'`.

**In D1 both directions are denormalized onto the edge** (`source_*` / `target_*`),
because a join to `podcasts` would only resolve the half of targets that have
boosts. It syncs as a **full replace** via `d1_sync.py --remote-podroll`, run by
the podroll script, never on the boost delta path. Wholesale replacement is also
what makes a *removed* recommendation actually disappear.

Podroll-discovered `shows` rows have no boosts, so they appear in no export row
and no D1 projection. The one place it leaked was `db.stats()`, whose
`shows_enriched` used to be `COUNT(*) FROM shows`; it now asks the boosts table.

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
| `functions/index.js` | the homepage's opening feed — **Shows**, rendered at the edge |
| `functions/{show,episode,booster,artist}/…` | the four edge-rendered detail pages |
| `functions/charts/[[path]].js` + `_shared/week-charts.js` + `_shared/chart-board.js` | the OnlyBoosts Charts page: the Shows/Artists Top 10s, the Members 40 HPW pair and the Weeks at #1 boards, edge-rendered; `assets/js/charts-page.js` mounts the week-picker dropdown |
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
   removed and what it did not is under **What The Strip Removed** below.

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

   **⚠️ A third file sits beside them and is NOT free to rework: `Movie Poster
   Personal Use.ttf`** (the CHARTS wordmark link, Reed's pick 2026-09-01) is
   licensed FREE FOR PERSONAL USE ONLY, and its EULA forbids converting,
   subsetting or renaming the file — which is why it is a raw 375KB TTF under
   its original name rather than a woff2, fetched lazily via a caps-only
   `unicode-range`. The note over its `@font-face` in `theme.css` carries the
   licensing contact. Don't "optimize" it into a subset.

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
