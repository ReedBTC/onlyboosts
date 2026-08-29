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
| Money paths: payments, notes, keysend, the oracle | `docs/money-paths.md` |
| Theming and the widget's CSS traps | `docs/theming.md` |
| The detail pages beyond `/show` | `docs/detail-pages.md` |
| The Members tab | `docs/members-tab.md` |
| Feed ranking, language, search, the hash view | `docs/feeds.md` |

The last five are design records carved out of this file on 2026-08-28 to
hold it under its size budget; each keeps its section headings, so
`git log -S <text> -- CLAUDE.md` still finds every section's earlier history
here. Deleted reasoning is likewise recoverable: `git log -S <symbol> --
CLAUDE.md` finds the paragraph that used to explain any name in here.

## Pages

| Path | What |
|---|---|
| `/` | the whole feed experience: hash-routed feeds, two dropdowns on two axes |
| `/show/<guid>` | one show, edge-rendered |
| `/episode/<item-guid>` | one episode, edge-rendered |
| `/booster/<npub>` | one person, edge-rendered |
| `/about` | the project's own explanation of what the data is and isn't |
| `/stats` | a coming-soon placeholder: nav + header + soon-card, `noindex`, out of the sitemap. `/boosters` was the second one and was **deleted** on 2026-08-23 — see the Stats row of the site map |
| `/404.html` | see the ⚠️ under LB conventions |
| `/hpw/<YYYY-MM-DD>`, `/hpw/high-scores` | one 40 HPW board as a page, edge-rendered, the address a shared week has. `/hpw/<key>/card` is the 1200x630 frame the collector screenshots for `/api/og/hpw/<key>.png`. See **The Share Cards** under the Members tab |

`/shows` and `/podcasts` are both 301s to `/#shows` now; the Shows feed replaced
the standalone page. `feeds.html` and `boosts.html` were folded into `/` and
deleted.

## Site map

The nav's Explore menu and the footer carry the same three groups, in the same
order. They are the site map, so **they're regrouped together or not at all**:

| Group | Items |
|---|---|
| **Feeds** | Podcasts `/#episodes-global` · Music `/#albums` · Members `/#members` |
| **Stats** | Boost Stats `/stats` — coming soon |

**⚠️ `/boosters` (Community) WAS THE SECOND STATS ENTRY AND THE PAGE IS DELETED,
NOT REDIRECTED.** *Reed's call, 2026-08-23.* The Members tab answers what it
promised, and the page was `noindex`, unlinked and unbookmarked, so there was
nothing to redirect. **`/api/v1/boosters/<npub>` and `/booster/<npub>` are
different paths entirely and are live** — do not confuse the plural page with
either.
| **More** (footer: *Connect*) | About · Source · Report a bug |

**⚠️ FEEDS IS ONE ENTRY PER TAB, NOT PER FEED, AND EACH LANDS ON THAT TAB'S
DEFAULT SUB-FEED.** *Reed's call, 2026-08-23* — the nav must not restate a
control the page carries. **Those three hrefs and `TAB_DEFAULT` in the
`index.html` controller move together** — Podcasts opens Episodes, Music opens
Albums, Members opens Boosts.

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
| Shows | `#shows` | per-show rollup, Global only |
| Albums | `#albums` | the same rollup, music feeds only, Global only |

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
| **Music** | Albums · Songs | the music side |
| **Members** | *(none shown)* | the boost firehose, which takes no medium and could not go under either without becoming two things it isn't |

**⚠️ THE TAB IS DERIVED FROM THE FEED KEY AND IS NOT IN THE HASH.** `TAB_OF`
computes it, so every hash in the wild resolves exactly as before; a
`#podcasts/shows` scheme would have been a second address space for the same
eight views.

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
lists the six that have the axes; the two Boosts feeds drop the parameters and
rewrite, the same coercion a signed-out `#episodes-follows` gets. See **The View
In The Hash** for the whole mechanism.

`SCOPELESS` in that controller is the set of types with no whose-axis (`shows`,
`albums`) — their key is the bare type, and picking one leaves the scope *state*
alone, so Boosts · Follows → Shows → Episodes returns you to Follows. Adding
Shows · Follows means dropping it from that set, renaming the key and keeping
`#shows` as an alias.

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

**The note slot is on the four ranked feeds only** (`mountFeedNote` in
`feed-controls.js`, text off each renderer's `COPY` table). It names the corpus
the ranking was computed over: "Ranks based on every boost in the index" on
Global, "Ranks based on only boosts from the accounts you follow" on Follows. On
a rollup a card is an **aggregate**, so the scope is a claim about what was
counted rather than about which cards survived. This is deliberately one line and
no box; don't grow it back into the scope paragraph it replaced.

### The Landing Feed

**The front door opens on Shows / All time / Most boosters.** Reed's call,
2026-08-23, shipping the last piece of the tabs work (Phase D, idea #18). The
show-level leaderboard is the view that answers "what is this site" to somebody
who has never seen it; the episode feed is one press away on the sub-row above
it. It opened on Episodes · Global from the day the feed bar existed.

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

**⚠️ THE OPENING SORT IS `boosters` ON BOTH ROLLUPS** — distinct people,
because one listener boosting a show forty times is one vote, not forty. But
`feeds-podcasts.js` spells that ranking `count` (the episodes endpoint's own
name for it); setting it to `boosters` would be an unknown key silently
falling back to Latest boost. The two endpoints disagree about the word and
agree about the ranking.

**The Function renders ONE feed and it is the one on screen** — see the ⚠️ under
the rendering rule for why, and for why `feeds-podcasts.js#adoptServerCards` is
kept with no producer.

## The medium split

`<podcast:medium>` is what separates a podcast from a music release: a `music`
feed's items are tracks on an album, not episodes of a show. Live counts: **818
podcast, 465 music, 2 video**.

**Two renderers serve five what-options.** Episodes and Songs are one
episode-level rollup; Shows and Albums are one show-level rollup. Each pair
splits on the medium and differs *only* by a copy table at the top of its module.
Adding a third medium is a third entry in those tables, not a third renderer.

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

Songs has the Global/Follows axis and Albums doesn't. That asymmetry is about
the data source, not the medium: `feeds-podcasts.js` never reads the show-level
rollup, so its follows path works unchanged. See the scope note in
`shows-feed.js`.

**⚠️ THE TWO COMMUNITY ROLLUPS WERE THE EXCEPTION AND ARE NOT ANY MORE.**
*Reed's call, 2026-08-24.* `#community-shows` and `#community-episodes`
crossed the partition deliberately; they now follow it, under headings that
say so (**Other Shows This Community Boosts** / **Other Albums…**). **The
heading and the query's WHERE clause are ONE decision** — a
`communityHeading` `COPY` entry and a `COALESCE(medium,'podcast')` filter in
the show page's community CTE and in `fetchCommunityBoosts`; change either
alone and the section names something it isn't. The lost crossover was
measured (12% of a podcast page's rollup, 39% of an album page's); if it is
ever wanted back it wants a **section of its own with its own heading**,
never this list widened again under a narrower name.

**Two rollups are still deliberately unsplit, for different reasons.** The
**podroll** is the publisher's own list, written by them, so filtering it would
misreport what they wrote. The **booster page** would file one person under two
half-histories, so its headings still read "Shows and Albums" and "Episodes and
Songs" and it carries no `COPY` table at all. `episode-section.js`'s range
tooltip stays medium-neutral ("aired or released") because it serves the
booster page's rollup too.

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

The fork left LB's own products in the tree, unreachable but shipped; they
were deleted on 2026-08-23 — the whole Events/calendar path, the meetup
product, the LB boost modals (`BoostModal`, `MultiLegBoostForm`) and their
helpers. ~6,600 lines of source, 202KB off what a homepage visitor downloads.
The full inventory and both incidents are in this file's git history
(`git log -S "What The Strip Removed" -- CLAUDE.md`) and the code in
`git show 75f88ef`. What survives them as rules:

- **⚠️ The build does not catch a deletion that goes too far.** Cutting
  `index.jsx` by banner-comment ranges swallowed `BoostApp` and a guard
  variable; Vite built both away silently (an undeclared identifier is a
  runtime error, not a build error, and there is no linter here). **A widget
  deletion is verified by `test-boost-modal-render.mjs` and by a
  declared-versus-referenced diff against the previous revision, never by a
  green build.**
- **Two checks worth reusing for any future strip**, neither a test in the
  repo: a module-graph walk resolving every import *and* every named import
  against the target's exports (the `ob-v53` failure class), and a
  reachability walk over `login-widget/src` from `index.jsx` that lists
  orphaned files — counting bare side-effect imports, or it reports
  `styles.css` and `navigationGuard.js` as dead.
- A quoted calendar event still links out as the naddr chip ("📅 Linked event
  on Nostr →"); the two NIP-52 kinds are inlined in `boosts-thread.js`.

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

Fifteen test scripts, all plain `node scripts/<name>.mjs` with no runner:

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
| `test-members-hours.mjs` | the 40 HPW boards, same shim, with a fixture built to known answers. Dedupe, week boundaries, the publisher exclusion, the row-multiplying join, and **the week picker**: the bounded window's ceiling, the noon-UTC date rule, DST-safe stepping, and the resolve-rather-than-400 envelope. Confirmed red on three mutations — the ceiling removed, dates resolved at midnight, and stepping by a flat 604800. **Its `env.DB` shim models `.first()`**, which `feed-rank.js` taught `test-members-search.mjs` the hard way |
| `test-community-medium.mjs` | the two community rollups and the medium partition they were split on, against a `node:sqlite` build of the real `schema.sql`. **Two halves reached two ways**: `fetchCommunityBoosts` is exported and called directly, where `/show`'s query is inline in the page Function and is **extracted from the source and executed**, the `test-feed-hash.mjs` technique. A copy of the SQL written into the test would pass forever while the shipped one rotted. Confirmed to go red on three mutations: the filter removed, its polarity inverted, and the `COALESCE` dropped |
| `test-keysend-upgrade.mjs` | the keysend upgrade: the `fountain.fm` exclusion's exact-or-parent rule, the routing pair's whole-or-nothing rule, the strict node-pubkey check, every way `/api/keysend` answers "no endpoint", and the wallet gate. **Stubs `fetch`**, so it probes nobody's well-known |
| `test-feed-search.mjs` | the search box's two outcomes, driving the **shipped** `mountFeedSearch` against a stub DOM: Enter submits the whole query where a feed supplies `onSubmit`, arrow + Enter still picks, emptying the box or Escape clears through `onPick(null)`, the footer row renders — and **the member lookup, with no `onSubmit`, keeps its old Enter**. Confirmed red on two mutations: auto-highlight restored, and the empty-box clear removed |
| `test-hpw-cards.mjs` | the 40 HPW share cards, three halves: `hpw-board.js`'s two-sided rules (a **source** scan for absolute imports, `Date.now()` and unpinned locales, plus the row's escaping and `isSafeUrl` on the face); the **shipped** `/hpw` Function over a `node:sqlite` build of the real schema (every redirect, the 404s, the page's canonical and `og:image`, the card's frame and ready signal, and that the page carries `rowHtml` byte for byte); and `/api/og/hpw/<name>.png` with **`fetch` stubbed** (the allowlist, the upstream's 200-for-missing answered with the banner, the PNG signature, the 900KB cap). Nothing in it touches the VPS |

**⚠️ `test-server-render.mjs` IS THE ONE THAT NEEDS AN ARGUMENT, SO IT IS THE
ONE THAT GOES UNRUN.** Its header carries the `curl` that produces the capture
(`/api/v1/podcasts?not_medium=music&sort=boosters&range=all&limit=25` since
Phase D); take a fresh one, since it is also the size measurement. **Run all
fifteen before a merge**, and treat this one as the guard on the ranking
scheme rather than only on weight — it would have been merged red once had it
not been run. *(If the table grows again, the "fifteen" above grows with
it.)* `git show 4c22017:scripts/test-server-render.mjs` is the episode-card
version if the front door ever moves back.

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
PRODUCTION AND DID NOT LOOK LIKE A CRASH**: a use-before-declare inside a
ternary that only evaluated once a leg was actually paying, so every test
passed and a live boost threw during render. **A render error with no boundary
above it unmounts the whole `createRoot`** — one line-order bug produced four
unrelated-looking faults (modal vanished mid-payment, the detached payment
completed anyway, no note published, Boost button dead until reload) and
nothing anywhere said an error was thrown. Two load-bearing consequences: the
scan is a **text check, not a render** (a real render test means jsdom), and
**this repo has no linter** — adding eslint to `login-widget/` is the better
fix whenever anyone wants it; until then the scan is the whole defence, so
point it at any component that renders while a payment is in flight.

### Asset Stamping, And The Rule It Replaced

`scripts/stamp-assets.js` appends `?v=<VERSION>` to every
`/assets/{js,css,widgets}/…` reference, reading VERSION from `sw.js` so there is
one source of truth.

**The failure it closed** (`ob-v53`): every module URL runs Pages' four-hour
HTTP-cache clock on its own, so a stale module could meet a fresh one
importing something it did not export — an unresolved named import is a
**link-time** error, and all eight feeds went down together. Bumping `sw.js`
never closed it. Now a URL means exactly one version of one file, so **the old
"never add a named export" prohibition is history**; the warnings surviving in
`feed-controls.js`, `feed-note.js`, `show-desc.js`, `booster-link.js` and
`boost-note-actions.js` are accurate history, not live constraints.

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

This is the mechanism the whole thing rests on. A Pages Function imports
`../../assets/js/episode-card.js` by relative path and esbuild inlines it off the
filesystem; the browser imports `/assets/js/episode-card.js?v=<VERSION>` and gets
the same file. So a card rendered at the edge and the same card rebuilt in the
browser after a re-sort are byte-identical **by construction**. What a two-sided
module cannot use is an **absolute** `/assets/js/…` import, which the browser
resolves and esbuild cannot.

Two rules follow, both enforced by `scripts/stamp-assets.js`:

- **A two-sided module imports its siblings as `'./thing.js?v=<VERSION>'`.**
- **Everything a two-sided module imports must itself be two-sided.**
  `show-link.js`, `episode-link.js`, `booster-link.js`, `cover-art.js` and
  `nostr-text.js` are all dependency-free, which is what made this cheap.

The episode card is the worked example, split along the facts/verbs line:

| | |
|---|---|
| `assets/js/episode-card.js` | the FACTS, as an HTML **string**: artwork and its fallback chain, title, show, air date, rank, the `Nostr Stats:` line, and every boost note inside the drawer. No DOM, no `fetch`, no `Intl` defaults. |
| `assets/js/episode-card-actions.js` | the VERBS: the ⋮ subscribe menu, the boost pill, the drawer's hide control, the per-boost ⋮ menu, and the reply / like / repost / zap bars. |

**The show card is the second, and it exists because of the tabs.**
`assets/js/show-card.js` is the facts as a string and
`assets/js/show-card-actions.js` the verbs; `functions/_shared/show-cards.js` is
the server half, mirroring `episode-cards.js`. `shows-feed.js` is the feed
around that card rather than the card itself.

**⚠️ THREE FORMATTERS WERE SAFE IN A DOM BUILDER AND ARE NOT SAFE HERE**, and
none of them looks like anything when it breaks: `Date.now()` (at the edge
that clock is the moment the response was cached, so a server-rendered "3m
ago" is wrong for almost everyone — the card renders the absolute date with
`data-latest-ts` and the actions module rewrites it), and the two unpinned
locale calls (`toLocaleDateString(undefined, …)`, `n.toLocaleString()`). All
three are `en-US` in UTC now, and `test-show-card.mjs` scans the **source**
for them — a render check passes regardless, the test process being en-US in
UTC already.

**The show card's drawer is a `<details>` and is always lazy.** Its rows come
from `/api/v1/podcasts/<guid>` scoped to the card's own range, so they are never
in hand when the card is built — at the edge or in the browser. There is no
inline counterpart to choose between, which is why this card has no `parts`
table the way the episode card does.

**⚠️ NO SURFACE PRINTS AN EPISODE NUMBER, ANYWHERE.** *Reed's call, 2026-08-24.*
Most publishers already put the number in the title they wrote, so the site
printed it twice; the title is left to speak for itself. The `itemAbbr` copy
key is gone from all three `COPY` tables, `renderBoosts`' signature and the
boost row's state element, so a repaint cannot reintroduce it on one surface —
but the DATA survives (`episodes.episode_number`, `e_num`, `num` on
`/api/v1`). **`test-boost-row.mjs` asserts the chip renders the title alone**,
because re-adding the prefix is a one-line change that looks like an
improvement.

**The boost row is the third worked example**, and the same split:
`assets/js/boost-list.js` is the facts (`renderBoosts`, `boostRows`, the three
comparators, the range filter) and `assets/js/boost-section.js` is the verbs.
See the `#boosts` rules under the detail pages, and "Range And Sort On
`#boosts`" in `docs/detail-pages.md`.

**Three knobs decide what a surface shows of the card, and only three.**
`CARD_PARTS` in `episode-card.js` is the whole table:

| | |
|---|---|
| `stats` | the `Nostr Stats:` line. Off on `/booster/<npub>`, where every card aggregates one person's boosts and the booster count is 1 by construction. |
| `layout` | `feed` or `compact`. Compact is the detail-page drawers and means three things that move together: no inline `<audio>`, no ⋮ subscribe menu, and the boost pill in a right-hand rail of its own, vertically centred. |
| `drawer` | `inline` or `lazy`. **Where the drawer's boost notes come from.** Inline (the default, and both detail pages) renders them into the `<details>` body with the card. Lazy (`HOME_CARD_PARTS`, the homepage only, and since Phase D declared by `feeds-podcasts.js` itself rather than by a Function) ships the body holding only its footer, and `episode-card-actions.js#fillLazyDrawer` fetches `/api/v1/episodes/<guid>?names=1` on the first open and renders the rows through the exported `boostRowsHtml`, the same function, so a fetched row is byte-identical to an inline one (verified against production data). |

**⚠️ Lazy is not the homepage being exempted from the rendering rule; it is the
rule's beneficiaries being named.** Server-rendered notes exist for the
crawler, whose pages are the show and episode pages in the sitemap; the
homepage is not one of them and every card links to the `/episode/<guid>` page
where the same notes *are* in the document. A lazy drawer is also *complete*
(the inline rows are capped at 50 by `include=boosts`; the per-episode
endpoint returns all), and a failed fetch leaves a status line, the "See all
boosts" link, and a retry on the next open. **`include=boosts` stays on the
homepage's query on both sides** — the drawer bar's booster faces are
computed from the boost rows. Compact drops the player and the ⋮ because every
card's title links to the episode's own page, which carries both; **the pill
can only be centred because the ⋮ is gone.**

**⚠️ The Function declares the variant and it travels in the state element**, so
a client repaint cannot render a different card than the edge did. **Spacing is
not in that table** — the compact card's padding, artwork size and type scale are
CSS scoped to `.ce-scroll` in `episode-page.css`, because a padding value cannot
make the two sides render different markup.

**⚠️ `functions/index.js` fetches `/` from `env.ASSETS`, never `/index.html`.**
Pages 308-redirects `/index.html` to `/`, `/` is that Function, and returning the
redirect made the front door answer `ERR_TOO_MANY_REDIRECTS`. It shipped that way
once. A 3xx from the asset server is now never propagated.

The five surfaces the card serves, all one definition:

| Surface | Rendered by |
|---|---|
| Homepage Episodes / Songs | `feeds-podcasts.js` — **client-rendered since Phase D**, the front door having moved to Shows |
| `/episode/<guid>` `#community-episodes` | `functions/episode/[guid].js` |
| `/booster/<npub>` `#episodes` | `functions/booster/[npub].js` |
| every re-sort, range change and search pick | `feeds-podcasts.js` / `episode-section.js` |

`functions/_shared/episode-cards.js` is the server-side helper all three
Functions call (`itemsFromBoosts`, `renderCardPage`, `CARDS_PER_PAGE`).

**The homepage's front door is server-rendered too, and since Phase D it is
the SHOW card that renders there.** `functions/index.js` splices one ranked
page into `<!--OB:SSR-SHOWS-->` inside the Shows panel; `shows-feed.js`
**adopts** those cards rather than refetching. A **fast path, not a
dependency** — any failure serves the file untouched and the feed hydrates as
before. **⚠️ ONE FEED IS SERVER-RENDERED AND IT IS THE ONE ON SCREEN** —
rendering a hidden panel too would be bytes every reader downloads and a
crawler shown two rankings on one URL. So `feeds-podcasts.js#adoptServerCards`
has no producer today and **is kept rather than deleted**, marked as such at
its definition: it collapses to `adoptedCount = 0`, and it is what makes
moving the front door a change to the Function alone.

Three things that fell out of the split:

- **The drawer is a `<details>`**, not a button beside a hidden div. The boost
  notes inside it are facts and, on the detail pages, are in the document, so a
  control only JavaScript could open would leave them unreachable. On the
  homepage the same `<details>` fills on open; see the `drawer` knob above.
- **Dates are `en-US` in UTC on the feeds**, not the reader's locale, because the
  edge and the browser have to produce the same string. The site has one date
  format rather than two.
- **Boost messages tokenize through `nostr-text.js`**, so a `nostr:note1…` inside
  a message is the same njump chip on every surface.
- **A message keeps its line breaks.** Messages cap through `capMessage`,
  which keeps newlines and collapses only runs of blank lines (never through
  `truncate`, which collapses all whitespace into one run-on paragraph — the
  three message classes already carry `white-space: pre-wrap`).
- **⚠️ AN IMAGE URL IS A LINK, NEVER AN `<img>`, AND THIS WAS TRIED THE OTHER
  WAY.** Inline images shipped on 2026-08-21 and were reverted the same day:
  **they make the notes way too big** (Reed). The objection is to the block
  existing, so a capped height or a thumbnail does not bring it back; the URL
  still links out. `test-episode-card.mjs` asserts the revert stayed, because
  re-adding it is a two-line change that looks like an improvement.

### The Cost, Stated

More server rendering is more D1 reads and more edge CPU per request. A detail
page runs six or seven queries plus a Podcast Index fetch in one
`Promise.all`; the 300s edge cache absorbs most of it, and the failure mode to
watch for is a slow TTFB rather than a blank page, which is the better failure
of the two. The full measurement history (inline drawers → lazy drawers → the
Phase D show card) is in this file's git history; the current numbers, from
the 2026-08-23 capture:

| | Episodes, lazy drawers | **Shows** (shipped) |
|---|---|---|
| Cards on the opening page | 30 | **25** (`SHOW_CARDS_PER_PAGE`) |
| Document, raw / brotli | 226.5KB / 33.0KB | **152.8KB / 35.5KB** |
| First view, brotli (document + module graph) | 100.6KB | **103.7KB** |
| Feed-bar controller after the first card | ~172KB | **46.3KB** |

**⚠️ The saving is a round trip, not bytes**: the show page's own JSON is
3.2KB brotli, so the case for server-rendering the front door is the rendering
rule and the crawler, not weight. The last row is what fixed the feed flash —
with the controller a megabyte behind the first card, the browser painted
Episodes before any script could read which feed the hash named — **and two
patches for that flash were rejected on 2026-08-17: skeletons painted over the
server's cards, and a boot script in `<head>` carrying its own feed-key list.
Don't re-propose either.** The eager-avatar problem was separate and was fixed
earlier, by `loading="lazy"` on every avatar.

| | |
|---|---|
| `/episode/<guid>` | one extra query in the existing `Promise.all` — median 248 rows, capped at 2,000; the page pays `max()` rather than `sum()` |
| `/booster/<npub>` | the same, and cheaper: one indexed scan |

**Both detail-page corpus queries are allowed to fail quietly**, the same
discipline the two podroll queries have, and **neither client module fetches
the corpus until the reader touches a control or presses "Load more"**.

## Conventions carried over from LB — keep these

- **CSP meta tag on every page.** All pages share one policy so tightening
  happens in lockstep.
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

**Design record: `docs/theming.md`** — the dark-mode passes, the widget's CSS
failure classes and the measurements behind the rules below, under the same
headings.

The shared stylesheets read their colors as custom properties off `:root` and
don't define them; **`assets/css/theme.css` is the supply** (palette,
`@font-face`, base styles) — link it from every page, **last** among the shared
stylesheets. `index.html` keeps one theme block of its own (the feed accent
aliases and the `body[data-active-feed]` mapping); `assets/css/page.css` serves
the plain content pages; `assets/css/feed-cards.css` holds the episode card and
reads `--accent` / `--accent-d` / `--tint`, which any page linking it must
supply. Old LB token names survive as **aliases repointed at the OnlyBoosts
palette** — trust the values, not the words (`--orange` is brand cyan); new
code prefers `--brand` / `--ink` / `--surface`. Brand, sampled from the art:
`--brand: #00aff0`, `--brand-d: #068ace`.

The rules a change would break:

- **Dark mode is `data-theme="dark"` on `<html>`**, set before first paint by
  the boot script in `partials/nav.html`, toggled by `nav.js`, stored
  per-browser as `ob-theme`; absence is the light theme. Neither script in the
  nav partial may contain a backtick or `${` (sync-partials exits nonzero).
- **⚠️ The dark grammar is one ground, hairlines, and one accent** (Reed,
  2026-08-27, against a Primal reference — "blocky and choppy" is the failure).
  **Don't re-introduce a surface with its own colour into dark mode.**
  `--navy` flips to the page ground, so a new `--navy` fill needs a
  dark-scoped border or fill of its own and a new navy-as-text usage needs a
  remap; **`--brand-dd` / `--brand-ddd` never flip** (they are the AA fills
  under white on every filled widget button — a new `--brand-dd` *text* usage
  needs its own dark override); `--warn` / `--danger` are lightened, never
  re-hued — amber is UNCERTAIN and red is FAILED, and the double-pay guard
  rests on telling them apart in either theme.
- **⚠️ A dark override of an aliased token goes on the element the alias is
  declared on.** The accent aliases live on `:root`, so the remap lives on
  `:root[data-theme="dark"]`, never `body` — it shipped wrong once and nothing
  errored; the page was simply the wrong colors.
- **⚠️ The per-feed accent ramp is retired, values-only** (Reed, 2026-08-27):
  every feed wears the one brand-cyan family. The eight family names survive
  in `index.html` as aliases of `--bg-*`, the `data-active-feed` mapping is
  untouched, and the dark remap touches `--bg-*` alone. A revival is
  repointing the aliases; the ramp's values are in git before 2026-08-27.
- **⚠️ The widget reads the tokens live off `:root` — never hardcode a hex
  into JSX — and every `var()` carries a literal fallback**, mirrored against
  `theme.css` by `test-boost-modal-render.mjs`. The fallbacks exist because
  `assets/widgets/` files are stamped at the reference site and never
  rewritten, so a fresh widget can meet a stale cached stylesheet; an
  undefined custom property makes the whole declaration invalid, which
  rendered the boost modal invisible mid-payment once. The dark block stays
  below the base `:root` block in `theme.css` (the test parses the first one).
- **⚠️ The widget carries its own scoped preflight** (`.lb-w`), and three
  rules there are load-bearing: `:where()` on every scope use (a bare
  `.lb-w button` beats `.py-3` and flattens every button); the reset's
  selectors must compute to **(0,0,0)** (an attribute selector carries class
  weight and silently killed every `bg-*` utility on `type="button"` elements
  for weeks); and every `createPortal` wraps its children in `.lb-w` **and
  still passes `document.body` as the second argument** — the one-argument
  form is valid JSX that renders nothing. The widget restores
  `border-style: solid` itself. No `img`/`svg` rule, deliberately. All
  enforced by `test-boost-modal-render.mjs`.
- **⚠️ Two Tailwind shapes fail silently**: an arbitrary value it cannot
  classify emits the wrong property (`font-[var(--font-display)]` →
  `font-weight`; use the `family-name:` type hint — same trap on `ring-`,
  `text-`, `bg-`), and an opacity modifier on an arbitrary `var()` colour
  emits nothing at all (an alpha on a var is a literal `rgba()` or a
  different token). The test catches both against the built bundle.
- **⚠️ A filled brand button is `--brand-dd`, never `--brand`** (white on
  `--brand` measures 2.50:1), hovering to `--brand-ddd`, so contrast only
  ever increases. The modal panel is deliberately not pure white — three
  surface tokens (`--modal-bg` / `--modal-field` / `--modal-inset`; white is
  where you type) — and `--modal-line` is a step darker than `--border`.
- **⚠️ The feed accent's text step is `--accent-dd`** (least darkening of the
  cyan reaching 6:1 on white), mapped beside `--accent` on every
  `body[data-active-feed]` row. The desktop tab and sub-row still use
  `--accent` at 2.50:1 — a decision, not an oversight (the seam note under
  The Three Tabs).
- `boosts-thread.css` / `boost-actions.css` still tint hover states with LB's
  bitcoin orange: known, deliberately unchanged. The masthead needs no second
  banner in dark — the clear PNG's wordmark is cyan on transparency (see Site
  identity).

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
boost notes for donors with no Nostr account ("The Site Signs For A Booster
Who Has No Key" in `docs/money-paths.md`), and a signing endpoint is an attack
surface however well
validated. Rotating a bot key costs a profile and one booster page; rotating the
site npub costs NIP-05, `.well-known/nostr.json`, and the `client` tag on every
event ever published. Both names resolve from the one `.well-known/nostr.json`:
`onlyboosts@` and `boostbot@`.

**⚠️ THE BANNER IS TWO FILES AND THEY ARE NOT INTERCHANGEABLE.**
`assets/onlyboosts_banner_clear.png` is the artwork on transparency and is what
the masthead renders; `assets/onlyboosts_banner.png` is the same artwork
flattened onto white and is the `og:image` on every page plus `OG_FALLBACK` on
the three detail pages and `BANNER_PATH` in `/api/og/booster`. **Change the art
and both files move.**

The split is about who composites: the wordmark is brand cyan on transparency
(which is what makes a dark theme a palette change rather than a second
banner), and a preview crawler composites a transparent PNG onto a background
it never discloses, so the share card is the one surface where the flattened
copy is the safe one. Only the clear file is in `PRECACHE_URLS` — the opaque
one is fetched by crawlers and never by a browser.

The domain appears in `robots.txt`, `manifest.webmanifest`,
`functions/sitemap.xml.js`, the CORS allowlist in
`functions/api/data/[[path]].js`, page canonical/OG tags, and the `client` tags
on published events — change them together. The npub is also served for NIP-05
from `.well-known/nostr.json`.

The site subtitle is **"Podcasting 2.0 Nostr Boosts"**, appearing in four
places that change together: the masthead line on `index.html` (linking to
`/about`), the homepage `<title>` and `og:title`, and `manifest.webmanifest`.
**Show pages still use `<title> — Boosts on Nostr | OnlyBoosts`**,
deliberately: there the phrase follows a show's name and reads as a
description of the page rather than as the site's own label.

## ⚠️ Money paths

**Design record: `docs/money-paths.md`** — the incidents, measurements and full
arguments behind every rule below, under the same section headings. What
follows is the rules; do not relax one without reading its section there.

Two separate things are both called "boost":

- **Boosting a podcast** — sats go to that show's own value split, parsed from
  its RSS feed. `externalBoost.js` / `externalBoostagram.js` / `payAllLegs.js`.
  This is the main event and it pays third parties.
- **Donating to the site** — one leg at 100% to `RECIPIENT_LUD16`, behind the
  nav's Donate button. **It runs the BOOST flow, not a flow of its own**:
  `openSiteDonation` → `openExternalBoost` → `ExternalBoostModal` with a
  synthetic one-leg bundle. React owns that button, not `nav-widget-boot.js`.
  A donation note carries `t=donation` and **no `amount` tag**, so the
  collector never counts it as a boost; site donations appear in no feed, no
  total and no stat, deliberately.

**`login-widget/` is a build artifact: editing `login-widget/src/` changes
nothing until you run `npm run build`.** Verify after any change to a money
path:

```sh
grep -c "onlyboosts@getalby.com" assets/widgets/login-widget.js   # expect >= 1
```

Code edits, dry runs, and read-only inspection are fine without asking.
**Confirm with Reed before running anything that signs or publishes a Nostr
event, or that moves sats.** Published events can't be unpublished. **New bots
start with `DRY_RUN = True`.**

The standing rules:

- **⚠️ `LNADDRESS_OVERRIDES` (`recipientOverrides.js`) and `EXTERNAL_OVERRIDES`
  (`value-block.js`) both stay empty.** No leg of a third party's value block
  is ever rewritten, renamed, merged or dropped; an entry silently reroutes
  sats away from the address a show's RSS names. One LB entry survived a
  wholesale restore and rewrote Fountain's leg on a live boost — **grep both
  maps after any restore from `lb/main`.** `FEED_GUID` in `boostagram.js` is
  deliberately `null`.
- **⚠️ FAILED and UNCERTAIN are different claims and only FAILED may be
  re-paid** (Retry re-pays; Check again only re-polls). `confirmInvoiceSettled`
  returns `'settled'` or `'unknown'` and nothing else — LUD-21 has no negative
  signal, and deriving failure from it caused a real double payment
  (2026-08-19). **There is no re-pay path out of UNCERTAIN, anywhere**; Zeus
  Pay hodl invoices are the recurring case the rule exists for. The one true
  negative is bolt11 expiry; do not reintroduce a shorter inference. Do not
  shorten the wallet adapters' timeouts (90s WebLN, ~60s NWC): a 45.5s
  `sendPayment` that then paid was measured. The 90s watcher re-polls
  unconfirmed lnaddress legs after the run; the waiting copy escalates on a
  timer (`PAY_STAGES` / `CHECK_STAGES`) because a screen that cannot be
  hurried and never changes reads as hung.
- **A recipient server's error reason is shown to the donor VERBATIM**
  (`readErrorReason`, bounded and capped) — never through `friendlyError`,
  which would blame the donor's own wallet. A served 4xx is never retried.
- **⚠️ One boost publishes at most one note** (`shareState` latches), and the
  note reports what SETTLED: figures recomputed from live leg state at
  publish, `amount` tag carrying `paidSats` — **this site's own collector
  reads that tag.** A clean boost publishes by itself on both routes (the
  opt-in is the form's checkbox); the donor route pre-signs at the press and
  the publish re-checks `pre.sats === paidSats && pre.legs === activeCount`,
  falling back to the button. A failed sign must never read as a failed boost,
  and a suppressed note says out loud that nothing was posted. Withheld
  entirely when nothing paid.
- **⚠️ Anonymous and private are different answers.** Anon routes the note to
  the bot; **`'none'` is reachable only through the Private checkbox** — an
  anon fall-through to no note shipped for hours and was reversed (Reed,
  2026-08-21). Two derivations, never merged: `boostAnonymously` (the
  boostagram's `sender_name`/`sender_id`) and `noteRoute` (who signs).
  **`sender_id` never rides without the profile behind it.** The typed From
  name is prose only (`👤 From <name>`), never a `p` tag or author claim;
  blank is replaced by `onlyboosts.social user`, in the TLV and the note both.
  The checkbox suppresses the note and nothing else, so its label carries its
  own scope (*no Nostr note*).
- **The login is not a gate on the wallet** — `openExternalBoost` has no Gate
  1; identity gates are skipped, never weakened. **A wallet connected with no
  login is session-only, structurally; never write a plaintext NWC URI to
  localStorage** (bearer credential), and a session-only disconnect leaves the
  stored blob alone. The wallet gate lives in `handleBoost` (compose first,
  pay second; the boost modal stays mounted underneath on z-index); the resume
  is the modal's own `wallet.onChange` subscription, **never a
  `pendingAction`** — a second path into `startPay` is a second way to pay
  twice. `remembered` is not `connected`; any new wallet-state copy has to
  test both. The login control is one component in two skins
  (`LoginButton.jsx`); its nav placeholder in `nav-widget-boot.js` must match
  to the pixel.
- **⚠️ The signing oracle** (`functions/api/sign-boost.js`; client half
  `siteSign.js`): the validator is an **allowlist** — `e` and `p` refused by
  omission; **if `buildExternalNoteTemplate` ever emits a new tag, add it to
  `ALLOWED_TAGS` in the same change**. Amount is plain digits; `client` is not
  caller-settable; `created_at` ±5min; the banner URL is pinned as an exact
  opening, not a lazy regex. The two template families (boost / donation) are
  disjoint with no fallback between them. **The caps are the same number on
  both sides, 5,000,000 sats** (`SITE_SIGN_MAX_SATS` restates
  `MAX_AMOUNT_MSAT`; `scripts/test-sign-boost.mjs` enforces the equality and
  pins the builder against the validator). It cannot verify payment and no
  cheap version can — proof-of-payment was designed and rejected (2026-08-19);
  don't re-propose it. The endpoint never touches a relay; the browser
  publishes. The KV rate limit (5/min/IP) is friction, not a security
  boundary, and fails closed when unbound.
- **⚠️ The keysend upgrade** (`keysendLookup.js` + `functions/api/keysend.js`):
  the wallet is asked first (`walletCanKeysend`; every uncertainty answers
  no), and what the wallet SAID outranks what it advertised — both capability
  memos drop on `wallet.onChange`. **`fountain.fm` is excluded though it
  qualifies**: membership in `LNURL_ONLY_DOMAINS` is knowledge about the
  provider, never a probe, matched exact-or-parent, never `endsWith`. The node
  pubkey is validated strictly; the `customKey`/`customValue` pair is taken
  whole or not at all, built field by field. A cleanly-declined upgraded leg
  falls back to invoice on the same leg — FAILED only, and **UNCERTAIN must
  never reach that branch**. The clean-decline codes live in
  `utils.js#isCleanPaymentDecline` (all three payment paths read it;
  `boost-actions.js` carries a pinned hand-copy); **only add a code whose
  meaning is that no HTLC survived** (`FAILURE_REASON_TIMEOUT` is excluded).
  The leg's identity never changes, only its destination. `/api/keysend` is
  **the route, not a fallback** (the well-known is server-to-server and sends
  no CORS); `test-keysend-upgrade.mjs` pins `payLnaddressLeg` at exactly two
  call sites.
- **`/api/lnurl` is the opposite: a fallback, not the route.** Every leg tries
  the recipient's own server first. It accepts a lightning address and
  **never a URL**; callbacks are held to `CALLBACK_HOST_ALLOWLIST` (two
  copies, client and Function, kept in step); upstream errors are mirrored,
  not replaced. **The invoice must demand what the leg asked for**
  (`bolt11AmountMsats`; an unreadable amount is allowed through).
- **Helipad reads LND, never Nostr.** Keysend legs reach its first tier (the
  TLV); `/api/boostbox` covers the lnaddress legs the upgrade cannot — it
  proxies **because of the key, not CORS** (`BOOSTBOX_API_KEY` must never
  ship in the bundle), sends Helipad's nine `RssPayment` field names
  (**`feed_title` / `item_title`, never `podcast` / `episode`**; the guids go
  in twice), and the descriptor is whole or absent, never fatal, `sender_id`
  never sent. **A self-paid leg never settles** (the donor's own hub credits
  internally; the invoice stays OPEN) — not a bug, and it means end-to-end
  verification cannot use one.
- **The one boost button**: every boost affordance is the same
  `boost-button.js` control, styled `.ob-boost-pill` in theme.css, reading
  `--brand` never `--accent`. **It is chrome, not a money path** — each
  surface owns its own resolve-and-pay handler, all through `fromApiValue` →
  `applyExternalOverrides` (a documented passthrough). It does not probe: the
  hero button reveals after a value block resolves; community rows resolve on
  click. The community drawer is the only surface paying a show other than
  the page's own; its guid and feed URL thread through `resolveValue` and
  `openBoost` **together**.
- **Money endpoints are excluded from every service-worker cache**
  (`isUncacheableMoneyRequest`: `/api/value`, `/api/lnurl`, `/api/boostbox`,
  `/api/keysend`). Ask of any new endpoint whether an offline answer is worse
  than no answer.

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

**⚠️ The `nostrconnect://` relay list is OURS, not the user's signer's** (the
signer's own list governs only the `bunker://` path). Neither a read set nor a
publish set: a member must be reachable **by both sides** and carry kind
24133, which is ephemeral — a reply arriving while nobody is subscribed is
gone. Re-derived 2026-08-12 by publishing a throwaway 24133 and watching a
second socket: `relay.primal.net`, `relay.ditto.pub` and `nos.lol` relayed
(`relay.mostr.pub` is the tested spare); `relay.nsec.app` 502s and
`relay.nostr.band` hangs the TCP connect for ~10s. Three findings: **an OK is
not proof of transport** (`relay.fountain.fm` answers `OK: true` then CLOSEs
with `kinds not supported` — test the read side too); **a hang costs more
than a refusal, and the SIGNER pays it**, off where this site cannot see or
report it; and the URI names both `perms` up front so Amber approves them on
one screen. Still untested: **write policy** — a publish target is unproven
until an event actually lands.

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
named after — clients demonstrably sign an *item* guid into the `podcast:guid`
tag, and the ids are opaque and unique, so a listed id in another slot only
ever means the same content. See `db._excluded_expr`.

**A malformed file is fatal, a missing one is empty.** The run scripts
validate it as their *first* step; the guarded failure is a typo'd key
(`"show"` for `"shows"`) silently excluding nothing while everyone believes
the content is gone.

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

One payment can produce two notes (the donor's app's, and a relay bot's); the
filter marks the relay copy `dup_of = <kept event_id>` so the real member
keeps the credit, running every incremental cycle over a 7-day window.

- **⚠️ `dup_of` IS ITS OWN COLUMN AND MUST NEVER FOLD INTO `excluded`** —
  `apply_excludes` recomputes that flag wholesale on every connect and would
  silently unmark every duplicate. `db.not_excluded()` gates on both; keep
  using it rather than writing either flag by hand.
- **⚠️ SATS + GUID + TIME WINDOW ALONE OVER-FILTERS, MEASURED** (651 pairs of
  near-identical boosts are distinct real payments). Only
  `RELAY_PUBLISHERS`-signed notes are ever droppable, pairing is one-to-one,
  and an evidence tier must corroborate; **a pair with no evidence is let
  through, and contradicted prose blocks even a same-app match** — Reed's
  call, 2026-08-24: a duplicate slipping through beats a real boost filtered
  out. Don't tighten toward recall.
- **A new republisher bot is out of scope until registered** (pubkey in
  `clients.py#PUBLISHER_PUBKEYS`, slug in `RELAY_PUBLISHERS` — relay bots
  only; first-party publisher keys are never the droppable side).
- **Reversal is two deletes, and D1 heals itself**: clear the row's `dup_of`
  and its `d1_boosts_synced` marker; marking rides the `d1_reproject` queue.
- `onlyboosts_globalscan.py dedupe [--days N | --all] [--dry-run]`. **The site
  needed no change** — it reads D1 and the shards, both corrected at the
  source. `/about` does not yet disclose the filter.

## Data feed

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
array, unrolled by `json_each`** — D1's 100-bound-parameter and 100KB-statement
limits both bite a large `IN (...)`, and the JSON array escapes both (plan
verified through `idx_boosts_booster`). The endpoint keeps an interpolated
fallback if D1 rejects `json_each`: **the only place SQL is built by
concatenation**, safe because every value passed `toHexPubkey` and is
re-tested against `HEX64`. Don't generalize the pattern. `MAX_AUTHORS`
(10,000) is an abuse guard, not a technical ceiling.

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
| `shows` | `shows-feed.js` | `GET /api/v1/podcasts?not_medium=music` |
| `albums` | `shows-feed.js` | same, `medium=music` |

**All four ranked feeds rank server-side.** They used to build a corpus in the
browser and roll it up, which ranked over whatever shards the walk happened to
pull: measured against the full corpus, **7 of the true all-time top 10 episodes
were missing outright, only 20 of the true top 100 appeared, and the true #7
painted at #128**. Songs was worse (**84 of 601** music episodes) because music
is ~5% of a stream whose window was sized for the other 95%. **So range and sort
are queries now, and changing either refetches.**

### Range and sort

Every feed carries a range and a sort dropdown, built by
`assets/js/feed-controls.js`. The chrome is shared; **what the range means is
not**, which is why each renderer passes its own tooltips:

| | Range filters on | Sorts |
|---|---|---|
| Episodes / Songs | when the episode **aired** (`ep.published`) | latest boost / latest episode / most boosters / most boosts / most sats |
| Boosts | when the boost was **sent** (`b.ts`) | latest boost / latest episode / largest boost |
| Shows / Albums | when the show was **boosted** (`b.ts`) | most boosts / sats / boosters / episodes / recently boosted |

**⚠️ `range` MEANS BOOST TIME on `/api/v1/podcasts` and AIR DATE on
`/api/v1/episodes`.** A show is in the 1W view because someone boosted it this
week; an episode is in the 1W view because it AIRED this week, however long ago
it was boosted. Both sides are deliberate and the parameter name is shared; do
not "unify" them. Filtering the note and show feeds by air date instead would
drop most of what they hold, since most boosts land on back catalogue.

The note feed's shorter menu is not an omission — a card there is one boost, so
"most boosters" has nothing to count. Its `episode` sort has to sink undated rows
explicitly: `episode.date` is null on ~12% of records, and a `0` fallback would
float them to the top.

**Every feed offers 1W/1M/1Y/All.**
On the ranked feeds the range is a **query parameter** (`RANGE_DAYS`), so a
wider window is a different `WHERE` clause; **those two tables and
`RANGE_OPTIONS` move together, or a range button answers 400.** The note feed
**walks** its window instead (`ensureCoverage`) — a year is ~70 sequential
requests — so **its 1Y (2026-08-23) is not pre-walked and gets the treatment
All already had**: a non-chronological sort ranks only what has been loaded
and the count line says so. **⚠️ `needsCoverage()` is a FACT and
`shouldPreWalk()` is a POLICY, separate on purpose** — folding `1y` into the
fact takes the load-older button away with it (same gate), leaving a window
the reader can never fill; `UNWALKED` is the policy's whole content. **The
count line keys on coverage, not on the range** — `rangeKey !== 'all'` would
make a half-loaded 1Y claim completeness.

**Sorting is over the selected window, so a bounded window is paged in
completely before it's painted**; a fully-covered bounded window therefore has
**no** load-older button. On All the button stays and the count line says the
order ranks only what's loaded. Loading older rows re-sorts in place under
those sorts; under `recent` it appends.

**Neither Boosts scope pages backwards hunting for matches any more.** The D1
query answers in one indexed hit, so an empty first page genuinely means empty.

### Ranking, And The One Definition Of It

**`assets/js/rank.js` is the site's single definition: standard competition
ranking (1-2-2-4)** — a rank is the count of rows strictly ahead, plus one;
ties share the better place; golf's `T` marks a shared place on every surface
(`T4` on feed cards, `T#4` in the detail-page tiles; `rankLabel()` owns both).
Dense ranking was measured and rejected; **no denominator, anywhere.** The
measurements and the four stamping renderers are in `docs/feeds.md`. What a
change would break:

- **⚠️ `competitionRanks` assumes the list is ALREADY ORDERED by the value it
  ranks** — hand it another order and it returns confident nonsense. Every
  current caller satisfies it by construction; a new one has to check.
- **⚠️ `lastRank` / `lastValue` ride the homepage's state element** to seed
  ranking past the adopted server cards; both are cleared wherever
  `adoptedCount` is. Both feeds re-sync painted labels after an append
  (`syncRankLabels`), and `feeds-podcasts.js` also patches the seam card.
- **⚠️ `episodeRankValue` reads `totals` before the built fields** —
  `boosts.length` is the inline count capped at 50, and comparing capped
  counts invents ties. It lives beside `EPISODE_SORTERS` and `RANKED_SORTS`
  in `episode-card.js` so all three move together.
- **⚠️ The `q=` paths use `RANK()`, never `ROW_NUMBER()`, with no tiebreak
  inside the window** — the tiebreak stays on the outer `ORDER BY`, where it
  makes paging a total order. Verified against the real schema in sqlite.
- **The heavy ties on the opening feed are the data, not a bug** (thirteen
  cards genuinely share 18th); the honest levers are the default sort or a
  numeral depth, **never softening the tie marking**. `.pcast-rank`'s
  `min-width` is an alignment floor.

### The Language Filter

`assets/js/feed-lang.js`, a third control on the four ranked feeds only; the
collector stores the primary subtag (`en`, never `en-US`). Full record in
`docs/feeds.md` and under **Show language: `language`** below.

- **⚠️ NULL is not English** — the untagged bucket is a menu row of its own
  ("Not tagged", `lang=unknown`).
- **⚠️ `lang=all` is a well-formed subtag that matches nothing** (0 rows,
  verified). `ob-live.js` sends the parameter only when the key is not
  `all`, and that guard is the whole of what stands between the opening view
  and an empty feed.
- **The menu is FETCHED (`GET /api/v1/languages`), never declared** — it is
  medium-aware and grows with the data. A null menu is a withheld control,
  not an error; it is inserted into the bar, never awaited. **No language is
  floored out; the menu scrolls** (`min(60vh, 21rem)`).
- **Changing the language is a QUERY**, exactly like range and sort. The
  search carries it; the feed note gains a second sentence
  ("German-language shows only" — never "German shows"); `noMatchText`
  tests the language cause first.

### The Bar On A Phone

Under 640px three controls do not fit with desktop labels, and the fix is in
the labels, not the layout: both pills drop their tag, the language pill
**inverts** (unset shows its axis, `Language ▾`; picked shows its **subtag**,
`DE` — the name stays in the menu row and the tooltip), and the last pixels
come off `min-width` and padding, **never the type scale**. Desktop is
untouched. Measurements in `docs/feeds.md`. The Boosts feeds have no language
axis — backend work, not a decision.

### The View In The Hash

`#shows?lang=de&range=1m&sort=sats` is a shareable view, on the six
`PARAM_FEEDS` feeds and deliberately not the Members feeds. Full mechanism in
`docs/feeds.md`. Load-bearing:

- **A default value is elided, and the elision is the renderer's** — the
  episodes endpoint spells its boosters ranking `count` where the shows
  endpoint says `boosters`, so the controller validates a sort by shape only
  (`normSort`) and the renderer coerces an unknown key to its default and
  **reports back**, which takes it out of the address bar. `normRange` holds
  the real list; `range=all` and `lang=all` fold to no parameter
  (`normLang`: `en-US` → `en`).
- **The opening view rides `lb:feed-activate` into the FIRST query**; the
  cold load re-reads the three body attributes (`data-feed-lang`,
  `data-feed-range`, `data-feed-sort`).
- **⚠️ A view in the hash refuses the server's cards** — `adoptServerCards()`
  returns null whenever `langKey` is set or a URL-supplied range or sort
  differs from the state element's.
- **⚠️ `lb:set-feed-lang` / `lb:set-feed-view` exist because a hydrated feed
  cannot be re-loaded**; each renderer keeps ONE listener per map
  (`LANG_APPLY` / `VIEW_APPLY`), range and sort travel as one event, and an
  externally-set view rebuilds the range/sort controls. `lb:feed-lang` /
  `lb:feed-view` report back and the controller writes the hash from them.
- **The view does not carry across a feed switch**; `langByFeed` /
  `rangeByFeed` / `sortByFeed` restore each feed's own view and address.
  Coercion (a feed without the axes, a value the feed cannot show) drops,
  reports, and rewrites the hash — the `#episodes-follows` precedent.

### Search

`assets/js/feed-search.js`, the typeahead at the head of every panel (inside
the panel, not the sticky bar). **Typing suggests, picking filters, Enter
submits** (2026-08-27). The member lookup is no longer a filter — it
navigates; see The Members Tab. Full record in `docs/feeds.md`.

- **Results mode is the feed's own pipeline with `q=` attached** — the state
  gains a `query` beside `langKey`, and medium, range, sort, language and
  scope all apply, with paging working inside the results.
- **⚠️ Query results are never renumbered**: each row wears the server's
  `RANK()` over the whole ordering (`loadEpisodePage` stamps `_rank` from
  the response); ties come from `rank.js#markSliceTies`.
- **⚠️ `onSubmit` is what flips the box's Enter behaviour** — with it, no
  auto-highlight and a "See all results for …" footer row; without it (the
  member lookup) Enter still takes the top suggestion. Clearing arrives as
  `onPick(null)` either way, and **the renderer must reset its corpus when
  the query drops** (`shows`/`items` hold RESULTS while one is active).
  `test-feed-search.mjs` pins both mutations.
- **⚠️ Rank retention is an ordering**: sort the range's full corpus, stamp
  positions, THEN filter to the pick, then paint from the stamp — reversed,
  the survivor renumbers to #1.
- **⚠️ A raw search string is not an FTS5 query.** Every endpoint touching
  one goes through `_common.js#ftsMatch` (each token quoted, the prefix `*`
  outside the last quote); a bare `-`, `:` or `(` otherwise answers 500.
  The member endpoint's LIKE has the same rule one operator over.
- **The remote source is `/api/v1/episodes?q=`, NOT `/api/v1/search`** —
  the search endpoint has no medium filter and no follows scoping, so its
  suggestions could name things the feed cannot show. Notes are left off
  the typeahead and fetched on the pick (which carries its `query`);
  replies are **sequence-guarded as well as aborted**; Shows/Albums match
  the guid and author server-side. `getEntries` (the in-memory ladder
  scorer) has no feed caller since the member search left, and stays.
- **`noMatchText` is a function, not a string** — three strings per medium,
  because on All/Global a miss is a coverage boundary, not a filter.

### The Shows feed

`assets/js/shows-feed.js`. The card is the SHOW where the Episodes card is one
EPISODE — same boosts, rolled up a level. `GET /api/v1/podcasts` answers all
three ranges off D1: on All it reads the precomputed aggregate columns, on 1W/1M
it GROUPs the boosts inside the window. The card cannot tell which one answered.

Two data facts that shaped the UI:

- **462 of 1,384 shows (33%) have no title and no art.** The collector holds
  boosts tagged with their guid but Podcast Index doesn't know the feed. They're
  long tail — median 1 boost, 3.8% of all sats — and the first one doesn't appear
  until #28 on *any* sort. They're kept rather than filtered (real boosts to real
  shows) and labelled "Unidentified show" with the guid, so an unnamed card reads
  as incomplete data rather than a bug.
- **Detail shards ran 3.5KB at the median, 15KB at p90, and 1.95MB for the single
  most-boosted show.** That fetch is retired; the drawer calls
  `GET /api/v1/podcasts/<guid>?boosts=0`, which returns the episode rows only.

**Both ranges fetch the drawer**, with the window passed as `?since=<unix>` so
the rows come back scoped and recounted. A drawer showing all-time figures under
a card showing the week's would contradict the card it opened from.

### The Members Tab

**Design record: `docs/members-tab.md`** — the shells, the #40HPW boards and
week picker, the wall, the lookup, the Boost Bots section and every rejected
alternative, under the same headings. Client-rendered by
`assets/js/members-board.js`, hydrated on the tab's first activation **from
both entry points** (the cold load re-reads `body[data-active-feed]`;
`test-feed-hash.mjs` asserts both call sites). The block sits **above** the two
boosts panels, shown by CSS off `body[data-active-tab]`. Four sections —
#40HPW, Members, Boost Bots, Boosts — in one idiom (`.mb-section`), each
section's content in a shell.

- **⚠️ `.mb-shell` / `.mb-lid` restate `.bs-shell` / `.bs-controls` values and
  must stay in step** (1px `--border`, 12px radius, `--cream` fill,
  `--cream-d` lid) — this page does not link `show-page.css`. The Boosts
  shell is **two elements** (the lid closes its own bottom, the active panel
  opens its own top, scoped to `body[data-active-tab="members"]`): any
  vertical margin on either half opens a gap, **including the containing
  section's own `margin-bottom`** (`.members-boosts` zeroes it). No
  `overflow: hidden` on a shell whose lid holds a dropdown (it clipped the
  sort menu once). No `max-width` or `margin` in the scoped `.feed-bar` rule
  — `test-feed-hash.mjs` scans `.feed-bar` declarations for the
  `var(--feed-track)` reads and fails on either.
- **⚠️ `placeFeedBar` MOVES the live `.feed-bar` into the tab's slot and
  back** — `appendChild`, a move, never a duplicate — and **the move back is
  the half that breaks** (`.members-block` is `display:none` off this tab, so
  a bar left behind vanishes from every other feed). Pinned both ways by
  `test-feed-hash.mjs`.
- **#40HPW** (`GET /api/v1/members/hours?range=week|all`, heading "Nostr Gang
  #40HPW Challenge"): boost an episode and the board assumes the whole
  listen — an assumption, not a measurement, and the Rules dialog says so.
  Dedupe (booster, episode) inside the week; publisher keys excluded; the
  npub comes from a **correlated subquery, never a second join on `boosts`**
  (row multiplication inflates both figures plausibly). **Weeks start Monday
  00:00 US Pacific**; the DST rule is implemented twice — `assets/js/
  pacific-week.js` (two-sided, arithmetic not `Intl`) and `pacificOffsetSql`
  (whose `CAST` is load-bearing: `strftime` returns text) — and
  `test-members-hours.mjs` holds both against real tzdata. A row's episode
  count is **episodes that contributed hours**, not episodes boosted; don't
  widen it, and expect the question. The headline figures (two 40h weeks
  ever, both Piez; ~12.5% of boosts contribute nothing) are measurements
  that move with the week rule AND duration coverage — re-measure before
  quoting, and re-check the Rules dialog's coverage copy with them. The
  boards self-heal as the collector fills durations; nothing in `hours.js`
  can repair a missing one. "High Scores", not "Hall of Fame".
- **The week picker**: the title is the picker — arrows primary, menu as
  jump; a calendar was rejected. Stepping is `pacificWeekStart` of a day
  inside the target week, **never `± 604800`** (DST weeks are 167/169h); a
  `YYYY-MM-DD` resolves at **noon UTC** (midnight lands in the previous
  week, invisibly); a past week takes a **ceiling** the live week never
  needed, and the 300s cache rather than the live 60s; a bad or future
  `week=` resolves to the live week and **the client renders the week the
  server resolved**, off the response envelope. High Scores rows are the
  real way in (`data-hpw-goweek`). The caret is drawn, not typed (Playfair
  has no `▾`). **Not in the hash: closed, not deferred** (Reed,
  2026-08-24 — "they can take a screenshot"); don't re-propose the plain URL
  parameter.
- **The Share Cards** (2026-08-29; design record in `docs/members-tab.md`):
  the week is still not in the hash — **`/hpw/<YYYY-MM-DD>` and
  `/hpw/high-scores` are the address a shared board has**, edge-rendered by
  `functions/hpw/[[path]].js` from `hoursBoard()` (lifted out of the hours
  endpoint) and the **two-sided `assets/js/hpw-board.js`** (`rowHtml`,
  `boardHtml`, `COPY`), which the tab imports too; the move was verified by
  diff. **⚠️ THE IMAGE IS A CHROMIUM SCREENSHOT TAKEN ON THE COLLECTOR
  MACHINE, NOT RENDERED AT THE EDGE** (Reed's call, over satori + resvg-wasm:
  +1.1MB on a 109KB Functions bundle and blank emoji in names). The bot
  (`bots/hpw-cards/`) loads `/hpw/<key>/card`, waits for
  `html[data-card-ready="1"]`, captures 1200x630 at 2x, and writes the PNG
  **inside the shards tree** so the routine `push` ships it;
  `/api/og/hpw/<key>.png` proxies it on the booster OG route's shape
  (`_shared/og-image.js`): name allowlist, **PNG signature checked because
  the upstream answers 200 text for a missing file**, 900KB cap, banner
  fallback. The share control (`hpw-share.js`: Post to Nostr / Copy link /
  Share image) is a verb mounted onto each board by the tab and by
  `hpw-page.js`; it refuses to share the banner (`X-OB-Image: fallback`),
  never signs on anyone's behalf, and the image it links is **the latest
  render, not a snapshot at the moment of sharing**. `.hpw-*` CSS moved to
  `assets/css/hpw-board.css` (37 selectors, audited) so both surfaces dress
  the same rows.
- **The member wall** (`GET /api/v1/members`, top 100) is the same
  `renderSupporters` the detail pages use; the heading is a parameter
  ("Members" here, "Nostr Community" there) and is moved into the head slot,
  not rewritten — and it has two shapes (populated vs a bare empty-range
  `<h2>`). The empty range still renders through `renderSupporters` so the
  reader keeps the range control. The range/sort are the feeds' own controls
  (`feed-controls.js`), **built once and moved with `appendChild`, never
  rebuilt** (the repaint would destroy them; `wallSeq` guards stale
  replies). `range` means when the boost was **sent**; **the window is on
  the JOIN, not only the candidate scan** (candidates-only sums whole
  histories — a plausible wrong board). It scopes the listing and **never
  the search**. Three orderings are three different people (sats / boosts /
  shows); default is `shows` (breadth — Reed's call); the figure under each
  face is the one the list was ordered by.
- **⚠️ The listing excludes `PUBLISHERS` (in `functions/api/v1/_common.js`)
  and the search does not** — a ranked list is a claim about who the top
  members are; a lookup answers where a real account is. `boostmebitch` is
  both an app a listener becomes a member through AND a publisher key that
  must not rank; do not "resolve" the duplication. The collector's
  `PUBLISHER_PUBKEYS` (`clients.py`) is a separate mirror, not touched from
  here.
- **The member lookup leads the tab and NAVIGATES** to `/booster/<npub>`; it
  never filters the boost list (two retired attempts are documented in
  `boosts-feed.js` so neither comes back). It is the shared
  `mountFeedSearch` **with no Enter-submit** (Reed: "leave npubs alone").
  `resetFeedSearch(panel)` is still called for readers holding cached
  modules. The endpoint: **candidates first, aggregate second** (the
  single-`WHERE` shape defeats index seeking, measured); LIKE wildcards
  escaped; **a member is someone who has boosted, never someone with a
  profile** (61 of 2,011 have no kind-0).
- **Boost Bots** is `?publishers=1` — the **exact complement** of the
  listing, same endpoint so the aggregate is computed in one place; it wins
  over an empty `q` and a `q` beside it does not union in the search
  (`test-members-search.mjs` pins both; the publisher list is bound once
  with numbered placeholders). **The section is the exclusion, shown**, not
  a disclosure notice: rows not faces, exact boost counts (`1k` rounds the
  evidence away), two sentences with `/about#bots` carrying the rest, a key
  with no `BOT_ROLES` entry still renders, and **a failed fetch leaves
  nothing behind**. The four keys were determined by hand; nothing detects
  them. Heading: "Shoutout to the Boost Bots".
- **The intro is one sentence** and the (i) is a **real link to
  `/about#membership`, opening in a new tab** — the badge is a CSS circle,
  not the `ⓘ` glyph. **`/about#membership` and `/about#bots` are in the
  wild: frozen**, like the detail pages' section ids. `/#members` is the
  tab's address (a rename, handled by the tabs' alias machinery), and
  `#membership` is the one place on the site that leads with Nostr and
  explains it — see [[nostr-vocabulary-by-depth]]. Two app lists exist on
  `/about` answering different questions (four in `#pipeline`, three in
  `#membership`; LB is deliberately off the second).

### The episode feed adapter

`feeds-podcasts.js` predates this data feed: it groups a flat boost list by
`item_guid` and looks metadata up in side tables, where the feed embeds that
metadata in every boost. `ob-data.js#toEpisodeShape` adapts the data to the
consumer rather than the reverse — rewriting the UI around the new shape would
have cost the boost drawer, the range filter and the five-way sort menu.

Two fields the feed doesn't carry:

- **`feed_id` / `itunes_id`** drive the "listen on" links and the `/api/value`
  split lookup. `/api/value` also accepts `feedUrl` or `podcastGuid` and resolves
  the id server-side, so boosting works; the pod.link / PI links are omitted for
  shows we can't identify.
- **`description` / `enclosure_type`** only exist in the per-show shard, too
  expensive to fetch per card. Cards degrade to no blurb and let the browser
  sniff the audio type.

`toEpisodeShape` also returns a `profiles` map built from the embedded booster
identities, which `renderPodcasts` seeds before first paint.

### Snapshot → card

The feed carries each boost's identity and content but **not the signed event**.
Every surface builds a minimal `{id, pubkey, kind, content, created_at, tags}`
object purely to hand to `buildActionBar` — a projection, not a verified event.
Don't pass it anywhere that assumes a real one.

**⚠️ THE MISSING `sig` HAS BITTEN ONCE.** `handleRepost` embedded the original
note only when `ev.sig` was present, and no surface here has it, so every repost
published from this site was a bare kind-6 with empty content — valid NIP-18 and
still unrenderable, since 98% of boost notes live on `relay.fountain.fm` alone.
Fixed in `b6c0bd4` by fetching the original through NDK. The projection is built
in three places (`episode-card-actions.js`, `boost-note-actions.js`,
`boosts-feed.js`) and each says so; **when a new action is added, decide
explicitly whether it needs the real signed event or only the projection.**

`boosts-feed.js` builds its own card rather than calling
`boosts-thread.js#renderNoteCard`, because that function caches cards by event id
and appends the action bar itself — appending the boost-meta row afterwards would
double up on a cached repaint.

### Every Episode Link Points at `/episode/<item-guid>`

Seven surfaces name an episode and all seven resolve here: the Episodes/Songs
cards (artwork, title, "See all boosts"), `/episode`'s community cards, the
Shows/Albums episode drawer rows, the Boosts cards' meta row, the three detail
pages' boost rows, `/show`'s episode drawer rows, and the URL written into a
published boost note.

**The qualifying rule is the TITLE**, not the guid: 6,682 of the 7,182 episodes
carrying an indexed boost have one. Each surface falls back to what it linked
before rather than emitting a URL that 404s, and the fallbacks differ because
what each linked before differs.

`show-link.js#episodePageHref` owns the rule for client surfaces, next to
`showPageHref` so the two cannot drift.
`functions/show/[guid].js#episodePageUrl` restates it for the server-rendered
drawer rows, and `episode-link.js` restates it again for the note path. **Three
copies of one test, and they must agree**; each is marked.

**⚠️ Two surfaces still point at boostmebitch.com on purpose, and both are
show-level**, in `functions/show/[guid].js` through one `bmbShowUrl()`: **"See
All Episodes"** on the episode drawer's control band, and a **podroll tile** for a
show we have no page for (44% of them). The drawer lists only episodes carrying
an indexed boost, so a show's full catalogue is the one thing this site cannot
offer. `episode-link.js` enumerates the set.

**⚠️ THE NOTE'S LINK IS PERMANENT.** `episodeBoostLink` in `episode-link.js`
is the single owner of the URL written into a published boost note; three
surfaces import it, and notes already published keep pointing at BMB forever
(an event cannot be recalled). The URL it emits is **absolute**. It returns
null when there is no episode to point at — which is also what a show-level
boost gets, because `/show/<guid>` is **not** the episode target: pointing a
boost note at the show would drop the part the reader wants.

## The three detail pages

`/show/<guid>`, `/episode/<item-guid>` and `/booster/<npub>` are **one page
with three subjects**; the shared chrome comes out of the shared modules below.
**Design of record for `/show` is `docs/show-pages-spec.md`; for everything
else on these pages it is `docs/detail-pages.md`** — the rank chips, the
`#boosts` controls and message search, the show filter, the community rollups,
the player card, the hash routing, all under the same headings. The rules that
bind from outside:

| | `/show` | `/episode` | `/booster` |
|---|---|---|---|
| Qualifies on | a title | a title (a missing SHOW is not disqualifying) | **a boost, not a profile** — 404 only with zero boosts |
| Hero | show art, "Boost this Show" | a player card: audio, chapters + show-notes drawers | avatar, banner, bio, lightning address |
| Rollup | `#community-shows` | `#community-episodes` | `#shows` + `#episodes` |
| Boosts | `#boosts`, opens on 24 | `#boosts`, all of them | `#boosts`, opens on 24 |

- **⚠️ The section ids are URLs and are frozen.** `/show`: `#episodes`
  `#community-shows` `#community` `#podroll` `#reverse-podroll` `#boosts`;
  `/episode`: `#community-episodes` `#community` `#boosts`; `/booster`:
  `#shows` `#episodes` `#boosts`. Ids are reused across pages where they name
  the same kind of section. `HASH_ALIASES` is the repair for a rename that
  already happened (`#inverse-podroll`), not a licence for the next one. Four
  pieces hold them up: the ids in each Function, `scroll-margin-top: 5rem` on
  `.show-section`, `revealHashTarget()` (`getElementById`, never
  `querySelector`; opens only `details.ep-drawer`, never nested card drawers),
  and the hash spy.
- **The hash follows the scroll** (`initHashSpy`): `replaceState`, never
  `pushState` (so it fires no `hashchange` and cannot trip
  `revealHashTarget`); only on a change (Safari throttles); the line read
  from `scroll-margin-top`; offsets measured live; no run at init.
- **⚠️ On a miss, `/episode` 302s (never 301) to the bare show page** rather
  than 404ing — the two pipeline halves can disagree and the fix belongs in
  the collector. **`item_guid` is not always a UUID** (9% carry a slash, 30
  are URLs): only ever `encodeURIComponent`d and bound, never parsed. And a
  WRONG episode field is not fixed here either: every surface prints the D1
  row as stored; the collector's `checked_at` gate owns corrections. Don't
  add a client- or edge-side repair for a field that looks stale.
- **⚠️ The rank chips** (`functions/_shared/feed-rank.js`): `rank.js` is the
  site's one ranking definition — competition 1-2-2-4, the `T`, **no
  denominator anywhere** (dense ranking was measured and rejected). The chip
  draws only inside the top 100 (`RANK_CUTOFF`, a display rule; `feedRanks`
  is unchanged, and a rank of exactly 100 prints even as a tie). All-time,
  all-language, Global, on the feed the subject's card lives on. It fails
  quietly. `/booster`'s third key is `shows`, not `boosters`
  (`BOOSTER_RANK_KEYS`); its population is the wall's, so **`RANK_PUBLISHERS`
  restates `PUBLISHERS` from `_common.js` and the two copies must stay in
  step** — a publisher's own page gets no chips, for free. The chip's
  selector is `.show-stat dd.show-stat-rank` and **the `dd` is load-bearing**
  against `.show-stat dd`'s `font:` shorthand, in the base rule and the 640px
  block both; `.show-stat--ranked` reserves the chip's line and is emitted by
  the renderer, never inferred by `:has()`. The chips are not links; the one
  caption is, and it defines the `T` only when one is on screen.
- **⚠️ `#boosts` range means when the boost was SENT** (matching `/#members`
  and `/api/v1/podcasts`), never air date — two readings of `range` exist
  deliberately and there must not be a third. The corpus is fetched on the
  first control press or "Load more", never on approach (`items === null` vs
  `[]` is load-bearing); **every repaint re-attaches the verbs**
  (`wireBoostNotes`, idempotent via `data-actions-on`); `names` comes from
  the server, not Primal; the row variant and page size ride the state
  element; the band is withheld below `CONTROLS_MIN` (3). The message search
  is a **substring** match over the in-memory corpus
  (`boost-list.js#searchBoostRows`), matching the MESSAGE and nothing else —
  not FTS5, and only ~16% of boosts carry one, which the empty state says.
- **The show filter is `/booster` only**; the picker is the `#shows` rollup
  itself (median 10 shows, max 188 — not a dropdown), the filter an equality
  on `podcast_guid` never the title, rendered as a chip that clears and
  nothing else. The chip must not outlive a failed corpus fetch; the button
  names the booster ("Boosts by X", capped 16 chars, name-free without a
  kind-0 — pass `realName`, never the page's `label`).
- **The community rollups** are community-scoped by construction (the join
  runs through this subject's boosters; the sort labels say "here"). On
  `/episode` the whole of the subject's SHOW is excluded, and the `IS NULL`
  half of that clause **keeps** episodes of unidentified shows.
  `#community-shows` is all-time only — a decision, measured. Both rollups
  obey the medium partition; see the one-decision rule under **The medium
  split**. "Load more" skips what is already on screen (edge-cached cards vs fresh
  corpus, compared by guid); ranks show only on `RANKED_SORTS`.
- **`/show`'s podroll queries are the only ones on the page allowed to fail
  quietly** (the daily pass can lag a deploy); the detail-page corpus queries
  get the same discipline. The description is fetched per request (2.5s
  timeout, never throws, `fulltext`); the clamp is applied by JavaScript;
  `linked` is the collector's flag, read never re-derived; the two podroll
  directions are never merged into one grid.
- **`/episode`'s show notes are server-rendered from D1 and then replaced
  from `/api/episode-meta`** (D1's copy is 100-word-truncated by PI);
  chapters cannot be server-rendered (~45% coverage) and their
  publisher-controlled URL is http(s)-only and bounded. That Function answers
  **every failure `200` with empty fields**; `notes` absent ≠ `notes: []`;
  notes come back as a **token tree, never HTML**; two cache lives (6h
  resolved, 5min error). A first-click chapter seek queues behind
  `loadedmetadata` (`preload="none"`).
- **The stat tiles are one row on a phone whatever the count**
  (`grid-auto-flow: column` under 640px, count-agnostic); the binding
  constraint is the label, not the number; a fifth tile wants looking at.
  **The back link** is server-rendered to the feed and upgraded to
  `history.back()` only on a same-origin referrer. **Drawer chrome**: every
  `<details>` shares `.ep-drawer`; the summary label is `--ink`, not brand;
  **no summary carries a count and none may gain one**; `.cs-controls` is
  `--cream-d`; the `--accent`/`--tint` supply lives on `.show-main`.
- **Boost messages render `nostr:` URIs server-side** via `detail-page.js`'s
  bech32 decoder (checksum verified — a failure renders plain text; nothing
  re-encoded; names bound with placeholders). `.nostr-mention` inside
  `.boost-msg` is styled in `show-page.css`, restating `boosts-thread.css` —
  keep the two matching.
- **The sitemap lists the substantial episodes only** (2,027 with ≥3 distinct
  boosters, of 6,682 qualifying) plus all ~930 shows; the episode query has
  its own `try`. Share-card image rules are under **Show artwork** below.

### Where the shared code lives

| | |
|---|---|
| `functions/_shared/detail-page.js` | escaping, `isoDate`, `fmtDuration`, the bech32 decoder behind the `@Name` chips, `renderBioText`. **Re-exports `renderBoosts` and five formatters from `assets/js/boost-list.js`, and `renderSupporters` / `SUPPORTERS_VISIBLE` / `PODIUM` / `compact` / `initShowMore` from `assets/js/supporter-wall.js`**, plus `boosterPageUrl` from `booster-link.js`; those are aliases, not definitions |
| `assets/js/supporter-wall.js` | **two-sided**: the community wall, its podium rule, its counts and its "Show N more" handler. Moved here so the homepage can render the same wall without loading detail-page.js, which is 156KB of thread machinery it has no other use for |
| `assets/css/supporter-wall.css` | every `.sup-*` rule, desktop and phone. **⚠️ The phone rules moved with it and that is load-bearing**: `.sup-card--podium` is an exact fraction of its row (/5 desktop, /3 under 640px) because `PODIUM` is a server-side constant and CSS cannot move a card into the grid below |
| `assets/js/boost-list.js` | **two-sided**: the boost row and the `#boosts` section, plus the comparators and the range filter both sides run |
| `assets/js/boost-section.js` | the `#boosts` range and sort, shared by all three |
| `functions/_shared/episode-cards.js` | `itemsFromBoosts`, `renderCardPage`, `CARDS_PER_PAGE` — the server half of the episode card |
| `functions/_shared/podcast-index.js` | `piHeaders` + `piGet`. **⚠️ `/api/value` keeps its own copy deliberately** — a metadata lookup must never share a code path with the one that moves sats |
| `functions/_shared/rich-text.js` | `parseNotes`: publisher HTML → text/link tokens. **Nothing it returns can reach `innerHTML`**; `OPAQUE_TAG` discards script/style/iframe content |
| `assets/js/detail-page.js` | the back link, section deep-links, the hash spy, copy-npub, "Show N more", the `art2` fallback, share, the Primal backfill |
| `assets/js/episode-section.js` | the card rollup's controls and verbs, shared by `/episode` and `/booster` |
| `assets/css/show-page.css` | linked by all three; the other two reuse its `.show-*` classes verbatim |

The `.show-*` class names are kept on identical boxes on all three pages
deliberately: a parallel `.episode-*` set would be a rename with no meaning
behind it. `episode-page.css` carries only the deltas. The community wall
(`renderSupporters`) follows LB's `supporters.html`: no card chrome, no rank
numerals, a podium marked by size and a brand ring that **wraps rather than
counting** (`.sup-card--podium` is an exact fraction of its row).

## Show artwork: the `art2` fallback

Some feeds publish two artwork URLs, RSS `<image><url>` and `<itunes:image>`, and
the first is sometimes dead while the second resolves. The collector publishes the
second as **`art2`**, null when identical to `img`; `assets/js/cover-art.js` walks
the chain on error.

```
episode art  →  show art (img)  →  show art2  →  glyph / placeholder
```

**⚠️ `coverChain()` PROMOTES `http://` TO `https://` BEFORE IT FILTERS.** An
http image is mixed content Chrome blocks outright, so the URL was already
unreachable as written; an upgraded URL that fails advances to the next source
like any dead URL, which is what makes this safe to do to a third party's.
`httpsUrl` is exported for the two avatar render sites (`boost-list.js`,
`episode-card.js`), which do not go through the chain.

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

`wireArt2()` covers all three `/show` surfaces: the hero, the community rows
and the podroll tiles (the community rows were the surface this was missed on
— the CTE selected `p.image` and not `p.artwork`). The `/episode` hero is the
one chain that is **two** fallbacks long (`data-art3`, existing nowhere else).
**The `/show` episode drawer rows are deliberately outside this** — a row
falls back to the show's `img` and stops; episode art was 100% present on
every show sampled.

**⚠️ The share card's TYPE follows its image, on all three detail pages.**
Nothing these pages send is large-card-shaped (podcast artwork is square by
specification; avatars are square or portrait), and a wide crop of a square
image reads as a broken picture, worse than a missing one. Artwork gets
`summary`; only the fallback keeps `summary_large_image`, `OG_FALLBACK` being
the 1800x600 site banner.

**⚠️ `/booster`'s share image is served through `/api/og/booster/<npub>`, not
named as the raw avatar URL.** A preview fetcher makes one request, cannot
fall back, and stops reading at a size the page cannot see (Signal Desktop at
1MB — a quarter of booster pages drew no image, measured 2026-08-18). The
route looks the picture up **by npub in D1** (never off the query string, so
it is not an open proxy), fetches it bounded, resizes via `cf.image`, and
answers with the banner for anything that is not a 200 raster under 900KB.
The header `<img>` keeps the raw URL (a browser can run `onerror`);
`X-OB-Image` says which path answered. Two things that follow: **a platform
caches OG data per URL** (a stale 404 card is not a broken route), and
**`node --check` is not a syntax check for these Functions** — import the
module instead.

**⚠️ `og:image` stays on the primary, deliberately.** `art2`'s presence means
the feed publishes two *different* URLs, not that the primary is dead; four of
the five live primaries return 200, so preferring art2 would swap four working
share cards to fix one.

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
| any card rollup | `hydrateCardProfiles(list)` | its own cards, on approach |

`/booster` is scoped because its **bio** carries a `.bs-mention` chip with its
own patch path (`fillMention`): unscoped, `hydrateProfiles` finds none of the
class names it knows, fills nothing, and strips the attribute, after which the
header's own backfill selects nothing and the bio mention never resolves. The
Boosts feed **rebuilds the card** rather than patching it, seeding
`setCachedProfile` first so the mention chips inside the message body agree
with the avatar above them.

## Show credits: `author`

`<itunes:author>`, backfilled across all 924 identified shows (~97% coverage
on music, ~88% on podcasts — **measure off the shipped index, not the probe**,
which judged quality by eye). On a music feed `author` is the artist and is
clean; on a podcast it is whoever the publisher named there — a host, a
network, occasionally a tagline. So:

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

**⚠️ NULL MEANS THE FEED DECLARES NONE, AND THAT IS NOT ENGLISH.** 594 of
1,294 shows are untagged (nearly all music: Wavlake publishes no
`<language>`), so untagged is a populous first-class state, not a gap to
default away — folding NULL into a language turns "filter by language" into
"hide half the Albums feed", under a claim those publishers never made. Same
partition rule as the medium split. Boost-weighted, `de` is essentially the
whole non-English story.

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

The UI shipped in `e870b93` — see the language-menu section under Feed loaders.
**Still open:** the Boosts endpoints take no `lang`, so the note feeds have no
language axis.

## Who published a boost: `client_id`

`clients.py` in the collector, `client_id` / `client_via` / `client_src` on
`boosts`, `client_id` + `client_via` in D1 and the shards, `GET /api/v1/clients`
for the breakdown. **A derived classification, not a field anyone published** —
the raw `client` column stays exactly as signed and is never overwritten, which
is why the derivation lands in its own columns with a `client_src` recording how
each answer was reached.

**The NIP-89 `client` tag is on 1.3% of the corpus** (291 of 22,968) and is
absent from the app behind ~94% of it, so reading the tag alone reports the
ecosystem as five hobby projects. Three signals cover everything but 39 boosts:

| signal | boosts | `client_src` |
|---|---|---|
| `fountain.fm` URL in the NIP-73 i-tag | 21,615 | `fountain-itag` |
| a known publisher pubkey | 1,025 | `publisher-pubkey` |
| the NIP-89 tag itself | 291 | `client-tag` |
| nothing — left **null**, never guessed | 39 | — |

Live: `fountain` 21,615 · `chadf-boostbot` 994 · `boostmebitch` 193 ·
`localbitcoiners` 70 · `lnaddress-music` 31 · `bowlafterbowl` 18 · `onlyboosts` 8
· `pv4v` 2.

**⚠️ THE PUBLISHER IS THE CLIENT; THE APP IT RELAYS IS NOT.** `chadf-boostbot`
republishes boosts made in apps that speak **no NIP-73 at all** — Castamatic 294,
StableKraft 260, PodcastGuru 157, CurioCaster 56, LN Beats 21, Podverse 3 —
naming each in its own message body as `📱 via <App>`. Those apps land in
`client_via`, nested under the bot, and are **never** promoted to `client_id`:
they published nothing to Nostr, and listing them as clients would credit six
apps with supporting a spec none of them implement. `/api/v1/clients` returns
them nested rather than flat so a consumer cannot accidentally merge the two.

That precedence is structural, not conventional — the publisher pubkey is tested
**first**, so a `client` tag naming a relayed app could never promote it.

Three measured rules, each otherwise a plausible-looking mistake: **the i-tag
host is matched exactly** (`feeds.fountain.fm` is Fountain's RSS *hosting*,
appearing in bot-published boosts from any app — a substring test misreads
them); **`via` is only ever read from the bot's own emoji-anchored line** (a
bare `via X` regex over prose finds 110 false matches); and the `nostr:nevent`
in a Fountain note adds zero rows the i-tag rule lacks, so its bech32 decoder
isn't carried. `SLUG_ALIASES` is deliberately tiny — merging two slugs is a
claim that two projects are one, made with knowledge the module doesn't have.

**Re-derivation, not a backfill.** `onlyboosts_globalscan.py reclassify-clients`
recomputes every row from `raw_json`, so a rule change is an edit plus a re-run;
new boosts are classified inline at ingest by `classify.py`. **⚠️ The boost delta
is `INSERT OR IGNORE`** and will not update a column on a row D1 already has, so
a re-derivation reaches the query layer only through
`d1_sync.py --remote-clients`, which emits UPDATEs. Nothing else re-pushes them.

**The boost note cards render it**, as a `via <App>` chip in the meta row —
`boost-list.js#boostRow` and `boosts-feed.js`, sharing the label table
`assets/js/client-label.js`. **⚠️ That table is two-sided and that is why it
lives there**: `functions/api/v1/clients.js` imports it, never the reverse.

**⚠️ THE CHIP NAMES THE PUBLISHER, NEVER `client_via`.** *Reed's call,
2026-08-24.* A relayed boost carries the listener's own app there (Castamatic
294, StableKraft 260, PodcastGuru 159 …) and showing it would answer a more
interesting question — but the note was published by the bot and **the booster
credited on that same card is the bot**, so "via Castamatic" beside a bot's name
and face is two claims in one row. The origin app is still in the record and
still nested on `/api/v1/clients`.

**⚠️ AN UNATTRIBUTABLE BOOST GETS NO CHIP.** `hasClientLabel` is the gate. A
chip reading "via Unattributed" would state our own coverage gap in the position
a reader expects an app's name. `unattributed` is a real row on
`/api/v1/clients` and is deliberately not a card label.

**⚠️ ALL THREE PAGE QUERIES HAD TO SELECT `b.client_id`, and forgetting one is
the two-sided bug.** Those queries are hand-written rather than `BOOST_SELECT`,
so the edge would have rendered no chip while a re-sort — which refetches
through `/api/v1` and `rowsFromRecords` — added one to every row.
`test-boost-row.mjs`'s round-trip check is what catches it, and was confirmed to
go red when `client_id` is dropped from the adapter.

**The episode-card drawer rows deliberately do NOT carry it.** They are a
different component (`.pcast-boost-*`, not `.ob-boost-*`) with a denser row, and
adding it would mean putting `client_id` on `?include=boosts`, which every
homepage card downloads. Not a rule, just untouched scope.

**Still open: `/stats`.** A "boosts by app" breakdown is what
`/api/v1/clients` was built for and still has no surface.

### OnlyBoosts Publishes On Behalf Of Its Own Donors

Registered 2026-08-20: the bot key behind `/api/sign-boost` is the fourth
entry in `PUBLISHER_PUBKEYS`. **It takes the SAME SLUG as the donor-signed
path**, `onlyboosts` — splitting them would report one product as two, and
`client_src` tells them apart for free (`publisher-pubkey` for bot-signed,
`client-tag` for donor-signed). **⚠️ The `via != slug` guard is now
load-bearing for our own notes**: the template's `📱 via onlyboosts.social`
line slugifies to `onlyboosts` itself, and without the guard every bot note
would nest OnlyBoosts under OnlyBoosts — don't remove it as dead defensive
code. **⚠️ The booster is the bot, not the donor**: nothing can verify a
donor authorised a note signed by a key they do not hold; the typed "From"
name rides the TLV and the note body, and nowhere the index credits — the
same reasoning as the `P`-tag rule below.

### Local Bitcoiners Publishes On Behalf Of Its Donors

Registered 2026-08-18. `c330881e…64592` is the Local Bitcoiners **show
account**, the third entry in `PUBLISHER_PUBKEYS`: it publishes a note
carrying the payment evidence for boosts that produced no donor-signed note,
and **only when no donor note exists**. The originating app rides the same
`📱 via <App>` line `_VIA_RE` already reads, so it lands in `client_via` and
never in `client_id`.

**⚠️ THE BOOSTER IS THE SHOW ACCOUNT, NOT THE DONOR NAMED IN `P`.** These notes
may carry an uppercase `["P", <donor pubkey>]`, NIP-57's sender convention. It
is read nowhere and must stay that way: the claim originates in a receipt signed
by a burner key, so nothing here can verify the named donor authorised it.
Crediting them would put an unverified identity into booster pages, per-npub
counts and every leaderboard. Reed's call, 2026-08-18, and the same treatment
the 994 `chadf-boostbot` rows already get. If it is ever surfaced it wants a
column of its own (`proxy_for_pubkey`), rendered as "on behalf of …", and kept
out of every count.

**⚠️ THE INDEX IS NOW LOAD-BEARING FOR SOMEONE ELSE'S PUBLISH DECISION.** LB's
bot asks `/api/v1/boosts?podcast=56fbb1aa-…&since=…` before deciding whether to
publish, and `?id=<event id>` makes that check exact rather than a fuzzy
amount-and-identity match. It sweeps relays directly as a second veto, so a
duplicate needs both checks to fail — but two ordinary-looking changes here have
that shape:

- **A reclassification that drops rows.** If previously-indexed LB boosts stop
  being indexed, the bot reads "no note exists" and publishes a second one.
  **Flag it rather than shipping it quietly.**
- **A stale D1 sync**, which is the same failure with no code change behind it.
  The delta sync in every incremental cycle is what keeps the answer fresh.
- **The duplicate filter marking an LB note.** `localbitcoiners` is in
  `RELAY_PUBLISHERS` as a safety net (zero matches at flip-on, and LB's own
  index check should keep it that way). If it ever fires, the dropped note is
  on relays but unindexed, so **LB's audit files the issue** — that is the
  expected surfacing of an LB-side dedupe race, not a bug here, and the answer
  is to read the pair in `dedupe.py`'s report before un-marking anything.

LB runs a daily audit (`bots/boost-publisher/coverage_audit.py` in that repo)
comparing node payments against relays against this index, and files a GitHub
issue on a double-count or on a note that is on relays but unindexed after 24h.
**So a miss here arrives as an issue carrying the event id**, which is the cheap
way to find out.

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

**⚠️ The timer's cadence is NOT the crawl's cadence** — `db.shows_needing_podroll`
is age-gated by `--max-age` (default 6d), so the corpus turns over about once
a week however often the timer fires. Don't "fix" the frequency by lowering
`--max-age` to match it. **A new show waits for this pass**; there is no
podroll path on the incremental tick by design.

**⚠️ Politeness is load-bearing.** A flat concurrent sweep drew 429s from 137
feeds, every one of which would have been recorded as "no podroll" and looked
plausible; `probe_feeds` goes **serial per host**, concurrent only across
hosts. Assume any wide third-party sweep has this failure. Three more
invariants: **only a clean read may rewrite a stored podroll** (a
429/timeout/truncation means we failed to see the feed; `http-404` is
deliberately not transient); **feeds are streamed and abandoned** at
`</channel>` or 2MB (validated — nothing carried a podroll past it); and
**the block is regex-parsed, not XML-parsed**, a podroll opened but never
closed raising `Truncated` rather than storing half a list.

Coverage: 65 of 925 reachable feeds, 371 edges, 221 targets; 136 targets were
new to the index, resolved through PI and cached with
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
- `Nostr Boosts:` on the Episodes/Songs boost drawer (*Nostr boost* being the
  term the project settled on in public);
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

The Supporter → Community rename was a **surface rename only**.
`supporterCard`, `renderSupporters`, `SUPPORTERS_VISIBLE`,
`data-supporter-grid`, the `.sup-*` classes and `supporter-wall.js` all keep
their names, the same seam as Podcasts → Episodes below.

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
| `supporter-wall.js` + `supporter-wall.css` | **the** community wall, shared by the three detail pages and the Members tab |
| `members-board.js` | the Members tab: the #40HPW boards and their week picker, the wall and its three orderings, the Rules dialog |
| `feed-controls.js` / `feed-search.js` | the range/sort chrome and the per-feed typeahead |
| `feed-lang.js` | the language menu on the four ranked feeds, and the copy it rewrites |
| `boosts-thread.js` / `boost-actions.js` | the content tokenizer and reply / like / repost / zap |
| `functions/index.js` | the homepage's opening feed — **Shows**, rendered at the edge |
| `functions/{show,episode,booster}/…` | the three edge-rendered detail pages |
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

2. **Shows · Follows.** The scope menu is hidden on Shows because the show-level
   rollup is computed over everyone. See the scope note at the top of
   `shows-feed.js`.

3. **A crawlable show directory.** ~930 show pages are reachable only through the
   sitemap and through links on other pages. See the note in
   `functions/sitemap.xml.js`.

4. **Bug relay write-policy.** `BUG_TAG` is `onlyboosts-alpha` in both
   `login-widget/src/lib/bugReport.js` and `bots/bug-watcher/watcher.js`, but
   `relay.mynostr.app`'s strfry write-policy plugin still has to whitelist that
   literal string. **VPS-side — reports are silently rejected until it's made.**

5. **Dead LB code — mostly gone, one layer left.** The bulk was deleted on
   2026-08-23 (see **What The Strip Removed** above). What is left is
   `boostQueue.js` and `payAllLegs.js`: both dead, but `boostQueue.js` is
   still *imported* by `navigationGuard.js` and `IdentityDropdown.jsx` for
   in-flight tracking that can no longer become non-empty, so removing them
   means editing two live components rather than deleting files.

6. **Typography.** The brand wordmark is a bold sans; the site is still on LB's
   Playfair Display / Source Serif 4. It reads fine, but the serif is inherited,
   not chosen. Only those two families are self-hosted in `assets/fonts/`.
   **The widget now reads both as `--font-display` / `--font-body` tokens**, so
   a change here reaches the modals without touching them.

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
