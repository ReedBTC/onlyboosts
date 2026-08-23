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

Deleted reasoning is recoverable: `git log -S <symbol> -- CLAUDE.md` finds the
paragraph that used to explain any name in here.

## Pages

| Path | What |
|---|---|
| `/` | the whole feed experience: hash-routed feeds, two dropdowns on two axes |
| `/show/<guid>` | one show, edge-rendered |
| `/episode/<item-guid>` | one episode, edge-rendered |
| `/booster/<npub>` | one person, edge-rendered |
| `/about` | the project's own explanation of what the data is and isn't |
| `/stats`, `/boosters` | coming-soon placeholders: nav + header + soon-card, `noindex`, out of the sitemap |
| `/404.html` | see the ⚠️ under LB conventions |

`/shows` and `/podcasts` are both 301s to `/#shows` now; the Shows feed replaced
the standalone page. `feeds.html` and `boosts.html` were folded into `/` and
deleted.

## Site map

The nav's Explore menu and the footer carry the same three groups, in the same
order. They are the site map, so **they're regrouped together or not at all**:

| Group | Items |
|---|---|
| **Feeds** | Episodes `/#episodes-global` · Shows `/#shows` · Songs `/#songs-global` · Albums `/#albums` · Boosts `/#boosts-global` |
| **Stats** | Boost Stats `/stats` · Community `/boosters` — both coming soon |
| **More** (footer: *Connect*) | About · Source · Report a bug |

Feeds has one entry per feed, matching the homepage's what-menu exactly.
**The Global/Follows axis is deliberately not in the nav**: it's the second
dropdown on the page, and listing both scopes would double the group into a grid
restating a control the page already has.

| Feed | Hash | Renders |
|---|---|---|
| Episodes · Global | `#episodes-global` | per-episode rollup by boosts received |
| Episodes · Follows | `#episodes-follows` | same, filtered to your kind-3 contacts |
| Songs · Global | `#songs-global` | the same rollup, music feeds only |
| Songs · Follows | `#songs-follows` | same, filtered to your kind-3 contacts |
| Boosts · Global | `#boosts-global` | the kind-1 boost notes themselves |
| Boosts · Follows | `#boosts-follows` | same, filtered to your kind-3 contacts |
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

**⚠️ THE TAB IS DERIVED FROM THE FEED KEY AND IS NOT IN THE HASH.** `TAB_OF` in
the controller computes it, which is why nothing in the wild changed: `#shows`,
`#episodes-global`, `#songs-follows`, `#albums`, `#boosts-global` and the two
retired `#podcasts-*` aliases all resolve exactly as before. A `#podcasts/shows`
scheme would have been a second address space for the same eight views.

**⚠️ The active tab reads `--accent`, so it tracks the sub-feed inside it** —
Podcasts is `#1b7bc1` on Shows and `#2f6bb5` on Episodes, straight off the
`body[data-active-feed]` mapping. An inactive tab has no active feed to read and
carries its family's shade. No token was added.

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

**A hash may carry a language: `#shows?lang=de`.** The feed key stays intact as
the part before the `?`, so `FEEDS` and `ALIASES` look up exactly as they did and
a retired hash still upgrades. `LANG_FEEDS` lists the six that have the axis; the
two Boosts feeds drop the parameter and rewrite, the same coercion a signed-out
`#episodes-follows` gets. See **The Language Filter** for the whole mechanism.

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

**The rollups that are deliberately NOT split on medium** are the three
community sections and the booster page: what an audience listens to *across*
podcasts and music is the interesting half of the finding. So those headings read
"Shows/Albums" and "Episodes/Songs" and carry no `COPY` entry at all.

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

Twelve test scripts, all plain `node scripts/<name>.mjs` with no runner:

| | |
|---|---|
| `test-episode-card.mjs` | the card's HTML against fixtures |
| `test-boost-row.mjs` | the boost row's two-sided contract: a D1 row through `boostRecord` and back through `rowsFromRecords` must render **character for character** as the edge rendered it, or a reader who re-sorts watches half the list change shape |
| `test-server-render.mjs` | the assembled homepage against a captured production response: the injection, the state element, a 256KB first-view budget, **and the ranking invariants**. Takes the capture as an argument |
| `test-feed-hash.mjs` | the inline feed-bar controller: hash parsing, and the boot sequence |
| `test-feed-lang.mjs` | `feed-lang.js`: menu ordering, the withholding rule, and the copy |
| `test-sign-boost.mjs` | the signing oracle's validator and its KV rate limiter, fed by the **shipped** note builder |
| `test-boost-modal-render.mjs` | the widget's four silent-failure classes: use-before-declare, themed classes that emit no CSS, portals with no container, and the missing preflight. See the ⚠️ below |
| `test-boostbox.mjs` | the BoostBox descriptor path: the comment's whole-or-nothing rule, the record allowlist, and every way `/api/boostbox` is allowed to fail. **Stubs `fetch`**, so it never writes a record to a third party's service |
| `test-show-card.mjs` | the show card's two-sided contract. Its own reason for existing is the crossing: `renderShowCard` was a DOM builder and could afford `Date.now()` and an unpinned locale, which a two-sided module cannot — see the note under the card |
| `test-members-search.mjs` | `/api/v1/members`, running the **shipped handler** against a database built from the real `schema.sql` through an `env.DB` shim over `node:sqlite`. LIKE escaping, the identifier/name split, the listing, and the publisher asymmetry |
| `test-members-hours.mjs` | the 40 HPW boards, same shim, with a fixture built to known answers. Dedupe, week boundaries, the publisher exclusion, and the row-multiplying join |
| `test-keysend-upgrade.mjs` | the keysend upgrade: the `fountain.fm` exclusion's exact-or-parent rule, the routing pair's whole-or-nothing rule, the strict node-pubkey check, every way `/api/keysend` answers "no endpoint", and the wallet gate. **Stubs `fetch`**, so it probes nobody's well-known |

**⚠️ `test-server-render.mjs` IS THE ONE THAT NEEDS AN ARGUMENT, SO IT IS THE ONE
THAT GOES UNRUN.** Its header carries the `curl` that produces the capture; take
a fresh one rather than reusing an old file, since it is also the size
measurement. It asserted `cards are numbered 1..N with no gaps` — the *ordinal*
scheme's invariant — until competition ranking shipped on 2026-08-18, and it
would have been merged red had it not been run. **Run all twelve before a merge**,
and treat this one as the guard on the ranking scheme rather than only on weight.

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
none of them looks like anything when it breaks. `relTime()` read `Date.now()`
— at the edge that clock is the moment the response was *cached*, and the same
bytes go to everyone arriving inside the 300s window, so a server-rendered
"3m ago" is wrong for almost every reader of it and different again from what
the browser rebuilds. The timestamp is the fact and the relative time is a
reading of it, so the card renders `last boost Nov 14, 2023` with
`data-latest-ts` and the actions module rewrites it. `shortDate()` called
`toLocaleDateString(undefined, …)` and `plural()` called `n.toLocaleString()`
unpinned. All three are `en-US` in UTC now. `test-show-card.mjs` scans the
source for all three, because the test process is already en-US in UTC and a
render check passes regardless.

**The show card's drawer is a `<details>` and is always lazy.** Its rows come
from `/api/v1/podcasts/<guid>` scoped to the card's own range, so they are never
in hand when the card is built — at the edge or in the browser. There is no
inline counterpart to choose between, which is why this card has no `parts`
table the way the episode card does.

**The boost row is the third worked example**, and the same split:
`assets/js/boost-list.js` is the facts (`renderBoosts`, `boostRows`, the three
comparators, the range filter) and `assets/js/boost-section.js` is the verbs.
See "Range And Sort On `#boosts`" under the detail pages.

**Three knobs decide what a surface shows of the card, and only three.**
`CARD_PARTS` in `episode-card.js` is the whole table:

| | |
|---|---|
| `stats` | the `Nostr Stats:` line. Off on `/booster/<npub>`, where every card aggregates one person's boosts and the booster count is 1 by construction. |
| `layout` | `feed` or `compact`. Compact is the detail-page drawers and means three things that move together: no inline `<audio>`, no ⋮ subscribe menu, and the boost pill in a right-hand rail of its own, vertically centred. |
| `drawer` | `inline` or `lazy`. **Where the drawer's boost notes come from.** Inline (the default, and both detail pages) renders them into the `<details>` body with the card. Lazy (`HOME_CARD_PARTS`, the homepage only) ships the body holding only its footer, and `episode-card-actions.js#fillLazyDrawer` fetches `/api/v1/episodes/<guid>?names=1` on the first open and renders the rows through the exported `boostRowsHtml`, the same function, so a fetched row is byte-identical to an inline one (verified against production data). |

**⚠️ Lazy is not the homepage being exempted from the rendering rule; it is the
rule's beneficiaries being named.** Server-rendered notes exist for the crawler,
and the crawler's pages are the ~930 show and ~2,000 episode pages in the
sitemap. The homepage is not one of them, and every card on it links to the
`/episode/<guid>` page where those same notes *are* in the document, so nothing
is un-indexed. What it buys is measured under The Cost, Stated. What it costs is
one small fetch per drawer opened, and the drawer becomes *complete*: the inline
rows are capped at 50 per episode by `include=boosts`, where the per-episode
endpoint returns all of them (cap 500, worst case 55). A failed fetch leaves a
status line and the footer's "See all boosts" link, and the next open retries.

**`include=boosts` stays on the homepage's query on both sides**, because the
drawer bar's booster faces are computed from the boost rows. The notes still
travel D1 → edge and, on a client-fetched page, D1 → browser as JSON; they stop
being *rendered* into the document. A lighter faces-only include is the follow-up
if that JSON ever matters.

The player and the ⋮ both come off for one reason: every card's title links to
that episode's own page, which carries both on a surface with room for them.
**The pill can only be centred because the ⋮ is gone** — they share the card's
right edge.

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
| Homepage Episodes / Songs | `functions/index.js` for the opening page, `feeds-podcasts.js` after |
| `/episode/<guid>` `#community-episodes` | `functions/episode/[guid].js` |
| `/booster/<npub>` `#episodes` | `functions/booster/[npub].js` |
| every re-sort, range change and search pick | `feeds-podcasts.js` / `episode-section.js` |

`functions/_shared/episode-cards.js` is the server-side helper all three
Functions call (`itemsFromBoosts`, `renderCardPage`, `CARDS_PER_PAGE`).

**The homepage's front door is server-rendered too.** `functions/index.js`
fetches `index.html` through `env.ASSETS` and splices thirty ranked cards into one
marked slot (`<!--OB:SSR-EPISODES-->`); `feeds-podcasts.js` finds them and
**adopts** them rather than refetching. It is a **fast path, not a dependency** —
a failed asset fetch, a D1 error or a missing marker all serve the file untouched
and the feed hydrates as before.

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
- **A message keeps its line breaks.** `renderMessage` capped its text through
  `truncate`, which collapses *all* whitespace, so a multi-line note arrived as
  one run-on paragraph — with `white-space: pre-wrap` already set on all three
  message classes (`.pcast-boost-msg`, `.note-body`, `.boost-msg`), so the CSS
  had been ready the whole time and the newlines were being destroyed one layer
  above it. It shows up hardest on this site's **own** bot notes, which are
  structured. `capMessage` keeps newlines and collapses only runs of blank
  lines, so a note padded with six cannot push the rest off a card; spaces and
  tabs still collapse.
- **⚠️ AN IMAGE URL IS A LINK, NEVER AN `<img>`, AND THIS WAS TRIED THE OTHER
  WAY.** Inline images shipped on 2026-08-21 and were reverted the same day:
  **they make the notes way too big** (Reed). A boost card is a dense row in a
  long list and one picture turns it into a post — several to a screen instead
  of a dozen. That the height was capped is beside the point; the objection is
  to the block existing, so **it does not come back as a thumbnail either.**
  Nothing is lost — the URL still links out, and clients that render the picture
  inline are unaffected. `test-episode-card.mjs` asserts the revert stayed,
  because re-adding it is a two-line change that looks like an improvement.

### The Cost, Stated

More server rendering is more D1 reads and more edge CPU per request. A detail
page runs six or seven queries plus a Podcast Index fetch in one `Promise.all`.
The 300s edge cache absorbs most of it; the failure mode to watch for is a slow
TTFB rather than a blank page, which is the better failure of the two.

Measured against production when the episode card closed the last exception:

| | |
|---|---|
| Homepage first view | **206.6KB → 217.7KB brotli**, and one round trip instead of two. The 431KB JSON fetch is gone; the document went 14.5KB → 150.6KB br. |
| Homepage raw markup | **54KB → 1.15MB**: ~5,000 extra DOM nodes for 737 boost rows, all inside closed `<details>`. |

**And re-measured on 2026-08-18 when the homepage's drawers went lazy** (the
`drawer` knob), same capture, `test-server-render.mjs`:

| | inline drawers | lazy drawers |
|---|---|---|
| Document, raw | 1,190.7KB | **226.5KB** |
| Document, brotli | 153.8KB | **33.0KB** |
| First view, brotli (document + module graph) | 221.4KB | **100.6KB**, under the old two-round-trip page's 210.2KB for the first time |
| Elements in the card block | 9,774 | **1,449** |
| Feed-bar controller after the first card | 1,160,125 bytes | **~172KB** |

The last row is the one that was the bug: with the controller 1.16MB after the
first card, the browser painted the whole Episodes · Global feed before any
script could read which feed the hash named, and every `#shows` / `#albums` /
`#boosts-global` load flashed Episodes first. **That flash was fixed here, at the
cause, and two patches for it were rejected on 2026-08-17 for that reason**:
skeletons painted over the server's cards, and a boot script in `<head>`
carrying its own copy of the feed-key list. Don't re-propose either.

**It did not touch the eager-avatar problem, and the two are easy to confuse**:
148 of the 236 distinct avatar URLs sit on the visible drawer *bar* as well as
in the rows inside, so those requests were never in the drawer markup. That was
fixed separately and earlier, by making every avatar `loading="lazy"`.
| `/episode/<guid>` | one extra query in the existing `Promise.all` — median 248 rows, capped at 2,000. ~190ms for a heavy episode against a page TTFB of ~170ms, so the page pays `max()` rather than `sum()`. |
| `/booster/<npub>` | the same, and cheaper: one indexed scan, heaviest booster 975 rows. |

**Both detail-page corpus queries are allowed to fail quietly**, the same
discipline the two podroll queries have: a rollup below the fold must never cost
a reader the page they came for. And **neither client module fetches the corpus
until the reader touches a control or presses "Load more"**.

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

The shared stylesheets (`nav.css`, `footer.css`, `boosts-thread.css`,
`boost-actions.css`) read their colors as CSS custom properties off `:root` and
don't define them — every page has to supply the tokens. That supply is
`assets/css/theme.css`: the palette, the `@font-face` rules, and the base
`body`/`a`/`img` styles. **Link it from every page, last among the shared
stylesheets** so a page's own inline `<style>` still wins.

`index.html` keeps one theme block of its own — the eight per-feed accents and
the `body[data-active-feed]` mapping. `assets/css/page.css` is the counterpart
for the plain content pages (`.page-header`, `.soon-card`).

### The Widget Wears The Site's Palette

**The login/boost widget is a fork of LB's and wore LB's dark palette until
2026-08-21** — `bg-neutral-900`, `border-neutral-700`, `text-orange-500` on every
primary button. OnlyBoosts is light, so pressing Boost took the reader out of the
site's visual world entirely. It is now on the site's own tokens.

**⚠️ THE TOKENS ARE READ, NOT COPIED.** `theme.css` defines the palette on
`:root`, the widget mounts into that same document through a portal, and Tailwind
runs there with **preflight off**, so `bg-[var(--modal-bg)]` works with no config
change. Never hardcode a hex into JSX; the palette has one source.

**⚠️ BUT EVERY `var()` CARRIES A LITERAL FALLBACK, AND AN INVISIBLE MODAL IS
WHY.** `scripts/stamp-assets.js` exists so one version of one file can never
meet another — except that **`assets/widgets/` files are stamped at the
reference site and never rewritten**, so `login-widget.js?v=ob-v94` and
`?v=ob-v95` are the same file on disk and the server returns the current build
for either. A browser holding `theme.css?v=ob-v94` in its four-hour HTTP cache
while fetching the widget fresh therefore gets **a new widget against an old
stylesheet**: the `ob-v53` failure class arriving through the one door the
stamper cannot close.

**An undefined custom property makes the whole declaration invalid at
computed-value time**, so `background-color: var(--modal-bg)` resolves to
*transparent*. Observed 2026-08-21: the boost modal rendered as a near-invisible
outline over the dimmed page, in the middle of a payment flow.

The fallbacks are **mirrors, not a second source of truth**:
`scripts/test-boost-modal-render.mjs` reads `theme.css` and asserts that every
`var()` in the widget has a fallback *and* that each one equals the token's
current value. Edit the palette without re-mirroring and that test fails. The
two font tokens are the deliberate exception, degrading to `Georgia,serif`,
because Tailwind strips the space out of `'Playfair Display'` unless it is
written `Playfair_Display` and `PlayfairDisplay` is not a font — a missing token
there costs the face, not legibility.

`theme.css` carries a block for exactly this: `--brand-tint`, `--brand-ring`,
`--ok`, `--warn`, `--danger`, `--scrim`, `--font-display`, `--font-body`.

**⚠️ THE THREE STATE COLOURS WERE RE-PICKED, NOT RE-TONED.** Amber is
`UNCERTAIN` and red is `FAILED`, and the whole double-pay guard rests on a donor
telling them apart at a glance: one may be re-paid and the other may never be.
The dark theme's `amber-400` and `red-400` are near-identical on cream. `--warn`
is a burnt orange and `--danger` a true red, different in hue as well as value.
`--warn` is also deliberately outside the brand family, since brand is cyan and
"warning" must not read as "in progress".

**⚠️ THE MODAL PANEL IS NOT PURE WHITE, DELIBERATELY.** Three surface tokens,
because a modal needs a panel, fields sunk into it and boxes raised off it, and
two cannot express that: `--modal-bg` (panel), `--modal-field` (inputs),
`--modal-inset` (sub-boxes). The panel was `--surface` and read as a slab — a
full-bleed `#fff` rectangle over a dimmed page is the brightest thing on screen
by a wide margin, which at modal size is glare rather than emphasis. The fields
are the white now, which is also the right way round: white is where you type.

**⚠️ THE WIDGET CARRIES ITS OWN SCOPED PREFLIGHT, AND EVERY PORTAL MUST WEAR
THE SCOPE.** Tailwind's preflight is off here — correctly, since this bundle
mounts into the live site and must not reset the host page — but preflight also
supplies two things every Tailwind UI silently assumes: `border-width:0;
border-style:solid` on everything, and a form-control reset. Without them the
modals rendered with the **browser's native button outlines** (reported as
"weird button outlines that make it look unprofessional" — they were the
operating system's) while every border the markup *did* ask for drew nothing.
Two opposite faults from one missing base layer, which is why the modals looked
simultaneously outlined and undefined.

`.lb-w` is the scope. `makeHost` puts it on every host div and **every
`createPortal` wraps its children in one**, because a portal renders into
`document.body` and would otherwise sit outside any scope. A new portal without
the wrapper is a modal back in OS chrome.

**⚠️ AND A WRAPPED PORTAL STILL HAS TO BE PASSED A CONTAINER.** Adding that
wrapper put the closing `</div>` on the wrong side of the comma in **eight of
ten** call sites, producing
`createPortal(<div className="lb-w">…document.body</div>)` — one argument, so
React rendered nothing. It is valid JSX (`document.body` just becomes text
inside the div), so **the build was silent and every test passed**, and the only
symptom was that the Boost button and the nav Log in button stopped opening
anything. `scripts/test-boost-modal-render.mjs` now walks to the matching paren
and counts top-level commas, because the broken form and the correct one differ
by six characters in the middle of a JSX block.

**⚠️ AND THE INNER `:where()` IS LOAD-BEARING FOR THE OPPOSITE REASON, BECAUSE
AN ATTRIBUTE SELECTOR CARRIES CLASS WEIGHT.** `:where(.lb-w) [type='button']`
has the scope correctly wrapped and is still **(0,1,0)** — dead level with
`.bg-[var(--brand-dd,#0a6fa8)]` — and `styles.css` is appended **after**
`@tailwind utilities`, so the tie broke in the reset's favour and
`background-color: transparent` won. **Every element in the widget carrying an
explicit `type="button"` had its `bg-*` utility silently killed**, from the day
the reset shipped until 2026-08-22. It surfaced as the four boost presets
rendering at `#f4fafd`, the modal's own background, with the picked one
white-on-white; it was reported as a colour bug and "fixed" as one twice before
anybody sampled the pixels and found all four buttons identical. A bare
`button` is (0,0,1) and was never the problem, which is exactly why it hid: the
buttons with no `type` attribute looked right. The list is wrapped —
`:where(.lb-w) :where(button, [type='button'], …)` — which takes the whole
selector to (0,0,0). **Tailwind's own preflight writes these unwrapped and gets
away with it because it lands in `@layer base` BEFORE the utilities; do not
"match upstream" here.** `test-boost-modal-render.mjs` now computes the real
specificity of every selector in the reset and demands (0,0,0), which is a
strictly stronger check than the `.lb-w`-is-wrapped one beside it.

**⚠️ `:where(.lb-w)` IS LOAD-BEARING, NOT TIDINESS.** Preflight's own selectors
are bare elements at specificity 0,0,0 and 0,0,1, which is exactly why `py-3`
beats the `padding: 0` preflight just set. Scoping naively to `.lb-w button`
makes it 0,1,1, which **beats `.py-3` and flattens every button in the widget**.
`:where()` contributes nothing, so these land at preflight's own weight. The
test counts any `.lb-w` used without it.

**Lists are reset too** (`list-style: none`): the host page's global
`*{padding:0}` had already flattened the indent, so UA disc markers sat *outside*
the content box and were clipped by the container's rounded border — the boost
progress list looked like every row had something cut off its left edge.

**No `img` / `svg` rule is included**, deliberately: preflight's
`max-width:100%; height:auto` would resize icons that are currently correct,
which is a visual change wearing the costume of a bug fix.

**⚠️ AND THE WIDGET RESTORES `border-style` ITSELF, IN THAT SAME LAYER.**
Tailwind's `border` utility sets `border-width` and nothing else; the
`border-style: solid` comes from **preflight**, which is off here so the bundle
cannot reset the host page. So `border-width: 1px` sat over CSS's initial
`border-style: none` and **every border in the widget drew nothing** —
`border-style` appeared nowhere in the built bundle at all. It survived the dark
theme because those surfaces differ by *fill*: a `#171717` panel on `#0a0a0a`
reads as an edge whether or not a line exists. On the light theme the borders
carry all the definition, so their absence flattened every modal into one pale
rectangle. `login-widget/src/styles.css` puts it back, keyed on the border
utility class names, which are safe to select globally **only because Tailwind
scans `./src/**` alone and the site styles itself with semantic classes.** If
the site ever adopts Tailwind, scope it. The test asserts the bundle carries
`border-style:solid`.

**⚠️ `--modal-line` IS A STEP DARKER THAN `--border`, and it earns the extra
token.** `--border` was drawn for cards on the cream *page*; inside a modal every
surface is within a few percent of every other, so the same line disappears.

**⚠️ TWO TAILWIND SHAPES FAIL SILENTLY HERE AND BOTH HAVE BITTEN.**

*An arbitrary value Tailwind cannot classify emits the wrong property.* `font-[var(--font-display)]` compiled to
`font-weight: var(--font-display)` — it cannot tell a family from a weight in a
bare `font-[…]`, so it guessed, and the browser dropped the declaration. Every
heading was in the default sans while every class name in the markup looked
right. The fix is the type hint, `font-[family-name:var(--font-display)]`, and
the same trap sits on `ring-`, `text-` and `bg-` wherever a value could be read
as a length or a colour.

*An opacity modifier on an arbitrary `var()` colour emits nothing at all.*
`border-[var(--brand)]/40` produces **no rule**, so the element falls back to
`currentColor`. Five of these had crept in. There is no way to express it, so
the rule is: **an alpha on a var is a literal `rgba()` or a different token.**

**`scripts/test-boost-modal-render.mjs` catches both**, the first by asserting
against the **built bundle** that each token produces a real declaration, the
second by refusing the `/\d` shape in source. Nothing else about either failure
is visible: the class names look right, the build is silent, and the page is
simply unstyled in one place.

**⚠️ A FILLED BRAND BUTTON IS `--brand-dd`, NEVER `--brand`, AND THE RAMP HAS A
FOURTH STEP FOR ITS HOVER.** White on `--brand` measures **2.50:1** and on
`--brand-d` **3.79:1**, so both fail AA — and the pair failed in the wrong
direction too, since the old buttons went from one illegible fill to a slightly
less illegible one on hover. That is why the wallet menu's log-in button was
reported as "almost invisible until you hover over it" and why the boost
presets were reported twice. All fifteen filled buttons in the widget are now
`--brand-dd` (5.45:1) with `--brand-ddd` (6.96:1) on hover, so contrast only
ever increases. `--brand-ddd` exists for exactly this and has no other caller.

**Two surfaces stay dark on purpose**: `IdentityWidget`'s pill and
`BoostButton`, which sit on the navy nav bar rather than on a modal. Neither
carries the white-on-brand pairing, which is why the sweep above left them
alone.

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

Brand colors are sampled from the supplied art: `--brand: #00aff0` and
`--brand-d: #068ace`. The eight feed accents sit on one cyan→indigo→violet ramp,
so switching feed shifts the page wash along a single system. The violet tail is
the music half of the medium split, so the color family says which side you're
on rather than the position in the menu. `--accent` / `--accent-d` / `--tint` are
the only names the shared chrome sees.

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
Who Has No Key"), and a signing endpoint is an attack surface however well
validated. Rotating a bot key costs a profile and one booster page; rotating the
site npub costs NIP-05, `.well-known/nostr.json`, and the `client` tag on every
event ever published. Both names resolve from the one `.well-known/nostr.json`:
`onlyboosts@` and `boostbot@`.

The domain appears in `robots.txt`, `manifest.webmanifest`,
`functions/sitemap.xml.js`, the CORS allowlist in
`functions/api/data/[[path]].js`, page canonical/OG tags, and the `client` tags
on published events — change them together. The npub is also served for NIP-05
from `.well-known/nostr.json`.

The site subtitle is **"Podcasting 2.0 Boosts on Nostr"**, appearing in four
places that change together: the masthead line under the banner on `index.html`
(where it links to `/about`), the homepage `<title>` and `og:title`, and
`manifest.webmanifest`. Show pages use `<title> — Boosts on Nostr | OnlyBoosts`.

## ⚠️ Money paths

Two separate things are both called "boost":

- **Boosting a podcast** — sats go to that show's own value split, parsed from
  its RSS feed. `externalBoost.js` / `externalBoostagram.js` / `payAllLegs.js`.
  This is the main event and it pays third parties.
- **Donating to the site** — one leg at 100% to `RECIPIENT_LUD16`, behind the
  nav's Donate button. **It runs the BOOST flow, not a flow of its own**:
  `openSiteDonation` → `openExternalBoost` → `ExternalBoostModal` with a
  synthetic one-leg bundle. See *A Donation Is The Boost Flow With One Leg*.
  `boostagram.js` + `BoostModal.jsx` + `MultiLegBoostForm` are the retired LB
  path and now have **no caller on this fork**.

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

### A Lightning Address With No CORS Headers Cannot Be Paid From A Browser

Both LNURL hops run in the page, and a cross-origin response carrying no
`Access-Control-Allow-Origin` is unreadable to JavaScript however healthy the
server is. **The leg therefore dies before an invoice is ever requested**, and it
surfaces as a generic fetch failure indistinguishable from the host being down:
the browser sends the request and then refuses to hand us the answer, so nothing
upstream logs anything either.

**⚠️ EVERY PROVIDER THIS SITE HAD MEASURED SENDS `*`, WHICH IS WHY IT WENT
UNSEEN.** getalby.com and fountain.fm carry 58 of the 63 lightning-address legs
across the top thirty shows. A **self-hosted** address generally sends nothing.
Measured 2026-08-21 on `spencer@bowlafterbowl.com`, 44% of that show's value
block: the metadata document, the keysend document and the invoice callback all
answer 200 with no access-control headers at all. Bowl After Bowl could not be
boosted from this site.

`functions/api/lnurl.js` is the way out and is a **fallback, not the route**.
Every leg still tries the recipient's own server first, so a host that works
today never touches our edge and a Pages outage cannot take down a boost path
that never needed us; verified, a working host makes two direct calls and zero
proxied ones. Four rules hold it together:

- **⚠️ It accepts a lightning address and NEVER a URL**, so a caller cannot steer
  the outbound fetch. The callback the recipient's own metadata returns is held
  to the same host rule the client applies (`CALLBACK_HOST_ALLOWLIST`), which is
  restated in the Function because a Pages Function cannot import from
  `login-widget/src`. **The two copies must stay in step.**
- **An upstream error is mirrored, not replaced.** `readErrorReason` prints the
  recipient's own explanation, which is often the only account a donor gets of
  why a leg failed; answering with our own wording would delete it.
- **A served 4xx is never retried through the proxy.** The server understood and
  refused, and asking again through our edge gets the same refusal.
- **The client remembers which hosts proved unreadable**, per session and never
  persisted. The metadata hop is prefetched on mount, but the invoice hop happens
  with the donor watching, and `fetchJsonCapped` retries once with a 1.2s
  backoff, so a doomed direct attempt costs a visible ~2.5s per leg.

It is excluded from every service-worker cache; see the money-endpoint note
under **What The Service Worker Caches**.

**The invoice must demand what the leg asked for**, and nothing checked this
before, on either path. The split decides a leg's share and the wallet pays
whatever the bolt11 says, so a server answering with a larger figure spent the
donor's sats with nothing here noticing. `bolt11AmountMsats` reads the amount out
of the human-readable part; **an unreadable amount is allowed through**, because
the check exists to catch a mismatch and refusing an encoding nobody anticipated
would break a working payment.

`FEED_GUID` in `boostagram.js` is deliberately `null` — OnlyBoosts is a client,
not a podcast, so it has no feed to claim. Inheriting LB's GUID would have
mis-tagged every share note as a Local Bitcoiners boost and polluted LB's own
collector, which filters on exactly that GUID.

Code edits, dry runs, and read-only inspection are fine without asking.
**Confirm with Reed before running anything that signs or publishes a Nostr
event, or that moves sats.** Published events can't be unpublished. **New bots
start with `DRY_RUN = True`.**

### ⚠️ A Payment We Cannot Confirm Is Not A Payment That Failed

**LUD-21 has no negative signal.** `settled: false` means *not settled at the
moment I asked*; an invoice still in flight and an invoice that will never land
answer byte-identically. `confirmInvoiceSettled` in `boostagram.js` therefore
returns **`'settled'` or `'unknown'` and nothing else**, and its two callers
(`externalBoost.js`, `payAllLegs.js`) may never derive a failure from it.

**This cost a recipient a double payment on 2026-08-19.** The function used to
return `'unsettled'` whenever the verify endpoint answered at least once, over a
poll window of **4 attempts 1500ms apart, so 4.5 seconds**. A leg to
`chadf@getalby.com` settled after that window closed, was reported FAILED with
"your wallet wasn't charged", was re-paid by the donor on that advice, and the
recipient received the money twice. Both attempts settled and both were reported
failed, because the inference was deterministic rather than a race.

**FAILED and UNCERTAIN are now different claims, and only one of them may be
re-paid.**

| | Means | Button |
|---|---|---|
| `FAILED` | the wallet never sent it: a pre-payment error, or a clean decline (`isCleanDecline`) | **Retry**, which re-pays |
| `UNCERTAIN` | an invoice was handed over and no settlement was observed | **Check again**, which only re-polls |
| `PAID` | a preimage, or verify said settled | — |

**⚠️ THERE IS NO RE-PAY PATH OUT OF UNCERTAIN, ANYWHERE, AND THAT IS DELIBERATE**
(Reed's call, 2026-08-19). `handleRetry` used to fall through to a re-pay on
`'unsettled'` with the comment "safe to re-pay"; it was not. A donor whose leg
genuinely did not land boosts again from the top, which is one deliberate act
rather than a button that quietly risks their money. `canRepayLeg` and
`canCheckLeg` in `ExternalBoostModal.jsx` are the split.

**The 90-second watcher is the other half.** Waiting 4.5s inline is right, since
the leg loop is sequential and a donor should not watch a spinner; so every
unconfirmed lnaddress leg keeps being polled *after* the run, to a **90s**
wall-clock budget (`WATCH_MS`, 3s interval), and flips itself to Paid if it
lands late. A donor-pressed re-check runs 30s (`RECHECK_MS`). Most unconfirmed
legs resolve with no decision from anybody, which is the point: the bug was a
screen asking the donor to decide on bad information. `deadlineMs` and `signal`
on `confirmInvoiceSettled` exist for this.

**Two consequences for the share note**, both from the same rule that the note
is a *final statement*: Share is **withheld while any leg is still being
checked**, and once the note is published every row's button **goes inert**,
because a leg that changed afterwards could not be reflected in an event that
cannot be edited.

The one true negative signal is bolt11 expiry, which provably ends an invoice.
LNURL invoices typically live an hour, far too long to hold a modal open for, so
it is not used. Do not reintroduce a shorter inference in its place.

### What A Recipient's Server Says Is Shown To The Donor

`fetchJsonCappedOnce` threw `Request failed (${status})` and discarded the
response body. Measured on a real leg, 2026-08-19:
`intuitiveocelot66@zeuspay.com` answered the invoice request **HTTP 400** with
`{"success":false,"error":"Zaplocker payments are temporarily disabled. Check
back later."}`. The donor was shown `Request failed (400)` and pressed Retry
four times against a server that had already explained itself in plain English.

`readErrorReason` now reads that body, through the same bounded reader as any
other third-party response, and the leg prints **"Their Lightning provider said:
…"**. Three shapes, because LUD-06's `reason` is not what everyone sends:
`{status:'ERROR',reason}`, `{error}`, `{message}`. Capped at 2KB of body and 180
characters of message, control characters stripped; React escapes it at render.

**⚠️ A reason from the recipient's server is used VERBATIM and never passed
through `friendlyError`.** That function rewrites on keywords, so a provider
whose message happens to contain *declined* or *expired* would be reported to
the donor as **their own wallet** declining. That is a lie about whose fault it
is, and it sends them to check the wrong thing.

**A 4xx is never retried.** The server understood and refused; asking again
1.2s later gets the same answer and only delays the donor's first sight of the
reason. 5xx and network faults still get the retry.

**⚠️ ZEUS PAY ADDRESSES USE HODL INVOICES, AND THEY ARE THE CASE THE UNCERTAIN
RULE EXISTS FOR.** That endpoint's own metadata reads *"Hodl invoice will settle
when user comes online within 24hrs or you'll be refunded."* So a payment there
is **accepted and held**, not settled — LUD-21 will answer `settled: false` for
up to a day, and the payer's wallet may report a timeout. Under the pre-2026-08-19
code that is a guaranteed double payment: reported FAILED, offered a re-pay,
paid again, and both eventually settle. Under the current rule it is UNCERTAIN,
the 90s watcher gives up, and the only offer is **Check again**. Any
hodl-invoice recipient behaves this way **by design**, so this is a recurring
case and not an edge one.

### Waiting Is Not The Same Event As Giving Up

The unconfirmed-leg screen said both at once. A leg that returned no preimage
arrived carrying *"Don't re-send; it may already be on its way"* the instant the
pay run ended, under a heading reading *"Still checking the rest — don't re-send
them"*, in warning amber, and held that unchanged for the whole 90-second watch.
Every word was true. **Observed on a real boost on 2026-08-19**, a leg to a slow
provider settled after about a minute and the wait was the only part of the
boost that felt broken: it read as a fault, and as a *stuck* fault.

**⚠️ A SCREEN THAT CANNOT BE HURRIED AND NEVER CHANGES IS INDISTINGUISHABLE
FROM ONE THAT HAS STOPPED WORKING.** So the copy moves even though the state
does not. `CHECK_STAGES` in `ExternalBoostModal.jsx` escalates at 0, 15, 35 and
60 seconds, in patience rather than in alarm, and one line under the list
carries it however many legs are in flight.

**⚠️ THE LONGEST WAIT IS BEFORE THE WATCHER EVER STARTS, so `PAY_STAGES` is the
same ladder one state earlier.** Measured on a second real boost the same day,
four legs through one WebLN extension: `chadf@getalby.com` spent **45.5 seconds
inside the wallet's own `sendPayment`** while its siblings answered in 2.3s and
0.4s. The hang is in the wallet, and nothing here can hurry it, shorten it or
see progress inside it. `PAY_STAGES` times the paying leg from a `startedAt`
stamped in `externalBoost.js` where the wait actually is, at the moment the
wallet is handed the invoice; legs are sequential, so there is at most one. **Its
first stage is deliberately silent**, a normal leg paying in one to four seconds
and a reassurance that flashes up and vanishes making a fast boost look
eventful.

**⚠️ DO NOT SHORTEN THE WALLET ADAPTERS' TIMEOUTS TO MAKE THIS TIDIER** (90s for
WebLN, ~60s inside NWC's SDK). That leg took 45.5 seconds and then paid; a
tighter bound would have turned a successful payment into an UNCERTAIN one.

**The warning belongs at the end of the watch, not during it.** While the
watcher runs the donor has no decision to make, since an unconfirmed leg is
never offered a re-pay; when the watcher gives up, a decision arrives and the
give-up text it writes is where "check your wallet rather than re-sending"
lives. What the waiting copy must keep carrying is that **the sats may already
be moving**, because the double-pay risk on this screen was never a button. It
is a donor who closes the modal and boosts the episode again.

Three consequences a change would undo: a row suppresses its own message while
it is being watched, that message being the give-up message; the summary line
takes the sending phase's orange rather than a shortfall's amber while checking,
so the screen reads as continuous with the phase before it; and the escalating
line renders for **every** donor rather than only one who can share, an
anonymous booster being sat in front of the same spinner.

`externalBoost.js`'s UNCERTAIN string is the leg's **resting** message, not its
waiting message, and must not claim that checking is under way. What it serves
is the leg nothing is watching: a keysend, or a provider that returned no
verify URL.

### The Share Note Reports What Settled

A boost distributes across a value block and **any leg of it can fail**, so what
the donor typed and what recipients received are different numbers on every
partial. `buildExternalNoteTemplate` therefore takes `paidSats`, never the form
amount, and its `amount` tag carries the same figure. **⚠️ That tag is what this
site's own collector reads**, so an overstated note is not merely a wrong claim
on someone's feed; it is a wrong row in this index. It shipped that way until
2026-08-19.

**⚠️ THE INTENT IS DECLARED IN THE FORM AND THE FIGURES ARE NOT, and holding
those two apart is what keeps this honest.** This rule read "the share is a VERB
pressed on the done screen, not a checkbox ticked before paying" until Phase 2
shipped on 2026-08-21, and the half of it that was load-bearing is untouched:
**the settled total is unknown until every leg has run *and* the donor has
finished retrying**, an event cannot be edited, and a note published when the
first pass ends can never reflect a successful retry. So the figures are still
recomputed from live leg state at the moment of publishing, and the screen still
names the number the note will carry before it is signed.

What moved into the form is the **choice**: whether a note is posted at all, and
whose identity signs it. That is a decision about the donor rather than about
the outcome, and the done screen is the wrong place to ask it — see *The Boost
Modal Declares What Happens To The Note* below. **A pre-flight control over the
FIGURES is still the bug it always was**; a pre-flight control over the
*intent* is not the same object.

`legsTotal` **excludes SKIPPED legs**: a leg allocated zero sats by the split
was never attempted, and counting it would report a shortfall that never
happened. Where `legsPaid < legsTotal` the note adds one line, `⚠️ 2 of 3 splits
paid` — *splits* rather than *legs*, being the word the value spec and the
podcast apps use, and this line is read outside this codebase.

**⚠️ ONE BOOST PUBLISHES AT MOST ONE NOTE.** `shareState` latches at `shared`,
and a retry that lands afterwards does not republish. Two notes for one payment
would be two rows in the index, which is the same double-count the
OnlyBoosts-signs-it path has to avoid by never being offered alongside a
donor-signed note.

Withheld entirely when nothing paid, and **withheld entirely on an anonymous
boost** rather than shown disabled: signing with the donor's own npub would undo
the anonymity they chose one field up. A signed-out booster is served by the
site-signed path instead; see below.

**The LB path is different and is deliberately not being changed.**
`MultiLegBoostForm` signs its kind-1 *before* paying, batched into one signer
approval with the receipts, and `boostQueue.js` publishes it if any leg paid.
Its content is frozen before any outcome is known. It is unaffected here because
the only surface using it on this fork is the site tip, which is one leg at 100%
and cannot partial.

### The Login Is Not A Gate On The Wallet

A boost is a payment, and a payment needs no Nostr identity. `openExternalBoost`
therefore has **no Gate 1**: a visitor with no account connects a wallet and
boosts with it. The gates that remain are conditional on there *being* an
identity, and each still earns its place for a signed-in user; a stub cannot
unlock the encrypted NWC blob, and a signer that has switched accounts would
sign a payload claiming the wrong pubkey. They are skipped, never weakened.

**⚠️ A WALLET CONNECTED WITH NO LOGIN IS SESSION-ONLY, and that is structural.**
Both at-rest schemes are keyed to an identity: NWC stores the connection URI
encrypted to the user's own signer, and WebLN stores a per-pubkey enabled bit.
With no signer there is nothing to encrypt to, so the connection lives in memory
and dies with the page. **⚠️ Never "fix" this by writing a plaintext NWC URI to
localStorage** — that URI is a bearer credential with a spend budget.
`getStatus().sessionOnly` is how the UI says so, in the connect modal before the
paste and in the identity dropdown afterwards.

**⚠️ A session-only disconnect leaves the stored blob alone.** Any blob present
belongs to an account that is not signed in, and a signed-out visitor
disconnecting the wallet they pasted this page must not delete the saved wallet
of whoever uses this browser signed in. `nwc.disconnect()` reads the flag; the
same rule governs the WebLN wipe in `wallet.connectWebln`.

**The identity slot has a second logged-out form**: a wallet pill with the
dropdown behind it, because that wallet is real, spendable and theirs to
disconnect. A signed-out visitor with no wallet still gets the plain Sign in
pill.

**Signing in afterwards does not save the wallet retroactively.** Only the live
client is held, never the URI, so the dropdown offers **Reconnect to save it**
rather than a one-tap save that would fail silently. Keeping a session wallet
across a sign-in is safe on the same reasoning that makes it session-only: it
cannot survive a page load, so it cannot reach a different visitor.

**`boostAnonymously` in `ExternalBoostModal` is the single derivation the wire
sites read** (`sender_id` and `sender_name`, on the first pass and on a retry);
it is *not* the toggle, because the toggle alone would be right by accident.
Under a signed-in profile it is false; **off the profile, whether by pressing
Anon or by being signed out, the typed name decides it**, absent meaning
anonymous. **⚠️ It must not grow a second meaning** — whether a note publishes
and who signs it is `noteRoute` beside it, a separate derivation. BMB shipped
that promise broken twice by letting one expression carry both.

**The identity toggle is still withheld when there is no identity**, but what
replaced it is no longer a notice. That was right when both of the toggle's
buttons would have sent the same empty fields; a typed name is what gives the
signed-out case something to say. See *The Boost Modal Declares What Happens To
The Note*.

**⚠️ THE SITE TIP USED TO BE THE EXCEPTION AND IS NOT ANY MORE.**
`openShowBoost` → `BoostModal` → `MultiLegBoostForm` signs a kind-1 before
paying, so it needs a signer by construction — which meant the nav's Donate
button demanded a Nostr account long after the episode boosts stopped doing so.
It now opens `openSiteDonation` instead. `openShowBoost` is still exported and
still works; nothing on this fork calls it. `_ensureWalletForPay` (the merch
checkout) keeps its gate.

### The Boost Modal Declares What Happens To The Note

**Two controls in the form, four outcomes, and one automatic publish.** Shipped
2026-08-21; `boost-login.md` D12 through D15 carry the arguments.

**⚠️ ANONYMOUS AND PRIVATE ARE DIFFERENT ANSWERS TO DIFFERENT QUESTIONS.**
**Anonymous** is about whose name is on the boost: not the donor's Nostr
account, and optionally a name they type instead. **Private** is about whether a
note exists at all. So **an anonymous boost is still published**, by OnlyBoosts,
with no npub attached, which is the whole point: an anonymous booster still
counts in the feeds and the totals.

| Boost as | Note box | What happens |
|---|---|---|
| Yourself | unchecked | the donor's own npub signs it, on their press |
| Anon, name typed | unchecked | OnlyBoosts signs it, the name is a line of the body, published by itself on a clean boost |
| Anon, no name | unchecked | OnlyBoosts signs it with no name; the booster this index credits is the bot |
| Either | **checked** | nothing is published from any key, and the done screen says so |

**Signed out there is no "yourself" row and everything else is identical.** That
is the whole difference the login makes here.

**`usingProfile` (`signedIn && !anonymous`) is the one question everything
hangs off**, and the two ways it can be false behave identically. Two
derivations stand beside each other and neither may absorb the other:
`boostAnonymously` is the **boostagram's** answer and governs `sender_name` and
`sender_id` only; `noteRoute` (`'donor' | 'bot' | 'none'`) is who signs.
BMB shipped that promise broken twice by letting one expression carry both.
`signKindOneWithSite` in `login-widget/src/lib/siteSign.js` is the only
difference between the two publishing routes: both produce a signed event and
both publish it from the browser through the same relay set.

**⚠️ `'none'` IS REACHABLE ONLY THROUGH THE CHECKBOX.** Anon routes to the bot;
it does not suppress. The version that shipped for a few hours on 2026-08-21 had
Anon fall through to no note at all, reasoning from the true premise that the
donor's own npub must not sign it. That conclusion quietly cost an anonymous
booster their place in the index, which is the opposite of what this project is
for. **Reed's correction, same day.**

**⚠️ THE TWO ATTRIBUTION ROUTES ARE EXCLUSIVE AND THE FORM SHOWS IT.** The name
field is rendered when `!usingProfile` — so a signed-in donor who presses Anon
gets it too, since their position is identical to a signed-out one's. It is
**absent rather than disabled** while the profile is in use: a typed name beside
a signed-in identity would be a second identity claim on one note.

**⚠️ `sender_id` NEVER RIDES WITHOUT THE PROFILE BEHIND IT.** Recipient
aggregators resolve that pubkey to an avatar and a name, so carrying it on an
Anon boost would undo the anonymity in the one place the donor cannot see it.
That is the exact leak BMB shipped, twice.

**⚠️ THE CHECKBOX SUPPRESSES THE NOTE AND NOTHING ELSE, so its label carries
its own scope**: *Boost privately (no Nostr note)*, never a bare *Boost
privately*. The sats and the message still cross Lightning to the show's own
app, which is the half the word "privately" does not cover.

**⚠️ THE DONOR'S SIGNATURE IS TAKEN AT THE PRESS, NOT AFTER THE PAYMENT.**
Auto-publishing at the end put an approval dialog on screen up to a minute after
the donor thought they were finished, with nothing having asked for it. So the
donor route now **pre-signs**: `presignNote` runs inside `startPay`, before the
first leg, and the two prompts arrive back to back the way a checkout does.

**⚠️ AND IT DOES NOT REOPEN THE PHASE 0 BUG, BECAUSE OF ONE IDENTITY.**
`distributeSats` floors every leg then hands the remainder back a sat at a time,
so **the legs it will attempt sum to exactly the typed amount** (a leg allocated
zero is skipped and contributes zero). A note signed in advance for the full
amount, with no shortfall line, is therefore precisely correct in exactly one
case: every attempted leg pays. **The publish step re-checks that identity —
`pre.sats === paidSats && pre.legs === activeCount` — and discards the
pre-signed note if it does not hold**, falling back to the button, which signs
fresh against live leg state. Change the rounding in `distributeSats` and that
check is what catches it, not this paragraph.

Nothing about pre-signing is allowed to be fatal: a declined prompt, a signer
timeout or a dismissed extension all leave `presignedRef` null, the boost
proceeds regardless, and the done screen offers the press. **A boost must never
fail because a note could not be signed.**

**⚠️ A CLEAN BOOST PUBLISHES ITS NOTE BY ITSELF, ON BOTH ROUTES.** The press
survived on the donor path for one day, on the argument that a signer prompt has
to be asked for. Reed's correction, 2026-08-21: *"shouldn't the opt-in to share
be enough?"* It is. **The ask now happens in the form**, one field above the
amount, and leaving the private box unchecked *is* the request; asking again
afterwards puts the same question twice and reads as the first answer not having
counted.

It fires only when every active leg is `PAID` and nothing is being checked. A
shortfall or an `UNCERTAIN` leg is exactly the state in which a retry could
still change what the note should say, so those render the button **with a line
saying why** — without it the button appears at random rather than as a
decision. The withhold-while-checking rule is untouched and `shareState` still
latches at `shared`, so **one boost still publishes at most one note**.

**⚠️ ON THE DONOR ROUTE THE WAITING COPY IS AN INSTRUCTION, NOT A STATUS**:
*Approve this in your signer to post it to Nostr…* It is reached only when the
pre-sign did not happen or its figures no longer hold, so nothing was pressed
and the prompt arrives with no obvious cause.

**The form's other three controls**, all 2026-08-21 and all Reed's calls: the
amount **ships empty** with four presets (420 / 2100 / 3333 / 6969) rather than
prefilled at 1000, which is a number nobody chose and a donor in a hurry sends
by accident; the note checkbox reads **Private Boost** / *Do not share to
Nostr*; and the `From` field carries **five password-manager opt-out
attributes**, because `autoComplete="off"` is not one — LastPass ignores it
outright and was offering to fill it, and several managers match on the token in
the `id` before they read anything else.

**⚠️ THE LOGIN CONTROL IS ONE COMPONENT IN TWO SKINS**, `LoginButton.jsx`:
`nav` on the navy bar and `checkout` inside the boost modal. A visitor meets it
in the nav and again inside the modal, and if those read as two different things
the second is a stranger asking for an account at the moment they are about to
spend money. **It says "Log in" and shows the site's favicon, never the word
Nostr** — the same vocabulary rule the `From` field and `Private Boost` follow.
In the modal it is the **express-checkout shape**, offered under a divider
*below* the name field: an alternative, not a gate, because the boost works
without ever pressing it and putting it first would make an account look
required.

**⚠️ `nav-widget-boot.js`'s STATIC PLACEHOLDER AND `LoginButton`'s NAV SKIN MUST
MATCH TO THE PIXEL.** The React button replaces that element in place once the
1MB bundle lands, so any drift is a visible jump on every page load. The
placeholder's mark, word, padding, radius and type size are all pinned to it in
`nav.css` with a note saying so.

**⚠️ THE NOTE OPENS WITH A BANNER, AND THE ORACLE PINS THE EXACT URL.**
`BOOST_BANNER_URL` in `externalBoostagram.js` is a bare image URL on line one,
which is what Nostr clients render inline, so it is the note's picture rather
than a link in it. `functions/api/sign-boost.js` restates it as its own constant
and accepts **two** openings and no others: the boost line, or that URL plus a
newline plus the boost line. **The lazy version tests `/^⚡Just boosted /m` and
lets anything precede it**, which hands a caller a free paragraph of arbitrary
text at the top of a note published under our identity — a far better vehicle
for abuse than the boost line under it. The two copies must move together;
`scripts/test-sign-boost.mjs` feeds the validator from the shipped builder and
fails if they drift. **It is deliberately not an `r` tag**: `r` is the episode's
URL, which is what a client and this index both read as what the note is about.

**⚠️ A BLANK "From" IS REPLACED, NOT OMITTED.** `DEFAULT_SENDER_NAME` is
`onlyboosts.social user`, and it fills the boostagram's `sender_name` only. An
empty one renders blank in one aggregator and "Unknown" in the next, so a boost
with nobody's name on it presents differently everywhere it lands; the default
makes it one consistent thing, and it names the **site** rather than a person,
so it discloses nothing the note's own author does not. Same call BMB makes.
**It reaches the note as well**, so every bot-signed note carries a `👤 From`
line whether or not anybody typed. That was scoped to the boostagram for a day
and the absence was the first thing Reed went looking for. Without it an
anonymous note is only the bot's own voice, which reads as *OnlyBoosts boosted
this* rather than *OnlyBoosts published this for somebody* — a different claim,
and the wrong one. It also keeps the note and the boostagram saying the same
string, which is what a podcaster can cross-check. The field is labelled `From`,
placeholders the default, and says *Left blank, boosts are sent as
"onlyboosts.social user"*.

**⚠️ THE TYPED NAME IS PROSE AND NOTHING ELSE** (`👤 From <name>`). It rides the
boostagram TLV, which is what the podcaster's Helipad reads, and it becomes one
line of the bot's own body. It must never become a `p` tag, an author claim or a
`proxy_for_pubkey`: nothing can verify that the person named authorised a note
signed by a key they do not hold. Same treatment the `chadf-boostbot` rows and
the LB show account get. `sanitizeSenderName` bounds it at 40 characters and
strips **newlines** (the body is read line by line) and the **mobile-phone
emoji** (`📱 via <App>` is the line `clients.py#_VIA_RE` fills `client_via`
from). `scripts/test-sign-boost.mjs` pins all of that against the shipped
builder.

**⚠️ SILENCE IS WHAT A FAILURE LOOKS LIKE**, so the suppressed case says out
loud that nothing was posted and that it was the donor's own choice. Without it
the screen a private boost ends on is identical to the screen a broken one would
end on. For the same reason **a failed sign is never allowed to read as a failed
boost**: the sats are gone before the note is attempted, so the offer is another
attempt at the note and never anything resembling unwinding a payment.

**⚠️ THE ORACLE'S AMOUNT CAP AND THE MODAL'S ARE THE SAME NUMBER, 5,000,000
SATS, AND KEEPING THEM EQUAL IS THE POINT.** They were 100k and 5M until
2026-08-21, so a large Anon or signed-out boost paid fine and could then not be
posted, with the endpoint's whole account of itself being `invalid amount`. The
100k figure rested on "above the cap the donor still has the donor-signed path",
and Anon routing here took that escape away. It was raised on Reed's call, on
the reasoning that **the index already accepts unauthenticated writes from the
whole of Nostr** — anyone may publish a fabricated boost note from a burner key
— so a cap changes what a fake looks like, never whether one is possible. What
contains this endpoint is D11's argument, not this number.

`SITE_SIGN_MAX_SATS` in `login-widget/src/lib/siteSign.js` restates
`MAX_AMOUNT_MSAT` in `functions/api/sign-boost.js`; a Function cannot import
from the widget source and the bundle cannot import from `functions/`, the same
split `CALLBACK_HOST_ALLOWLIST` lives with. **`scripts/test-sign-boost.mjs` is
what enforces the equality**, asserting that exactly that figure validates and
one msat more does not. Lower either copy and it fails.

### A Donation Is The Boost Flow With One Leg

**The nav's Donate button opens `ExternalBoostModal`**, driven by a synthetic
bundle of one `lnaddress` recipient at 100% to `RECIPIENT_LUD16`. A donor gets
everything a podcast boost gets: the wallet gate behind the press, the four note
outcomes, Anon, Private Boost, per-leg retry, the 90-second watcher, and the
site-signed note for someone with no account. Writing a parallel modal would
have meant two copies of a money path, and the copy exercised less is the one
that rots.

**⚠️ REACT OWNS THAT BUTTON, NOT `nav-widget-boot.js`.** The boot script's click
handler governs only the press before the bundle lands; `createRoot(boostEl)`
then mounts `BoostApp` over `#lb-boost-slot` and owns every press after. Wiring
the boot script alone left Donate opening the login modal while every file
anyone would grep said otherwise. `test-boost-modal-render.mjs` walks `BoostApp`
and asserts it calls `openSiteDonation` and never `openShowBoost`, whose Gate 1
is a bare `api.requestLogin()`.

**⚠️ A DONATION NOTE IS NOT A BOOST NOTE, AND DROPPING THE NIP-73 TAGS IS NOT
ENOUGH TO MAKE THAT TRUE.** `classify.py` sets `is_boost` from **either** a `t`
tag in `{boostagram, value4value, boost}` **or** a positive `amount` tag. So
`buildDonationNoteTemplate` emits `t=donation`, `t=onlyboosts`, `client` and
`r`, and **no `amount` tag at all** — the figure lives in the text. Sats paid to
OnlyBoosts are not a podcast boost and must never be counted as one, which is
the decision `FEED_GUID = null` already records. The outer guard is `scan.py`,
which REQs `{kinds:[1], "#k": BOOST_FILTER_K}`, so a note with no `k` tag is
never fetched; the tag rules are the inner one.

**⚠️ SO THE ORACLE HAS TWO TEMPLATE FAMILIES AND THEY ARE DISJOINT.**
`validateBoostTemplate` **requires** `t=boostagram`, `t=value4value` and exactly
one `amount` — precisely what a donation must not have — so neither family is
reachable by relaxing the other. `validateTemplate` routes on the opening line
with **no fallback between them**: trying both and accepting either would turn
two strict shapes into one loose one. A donation carries no `amount` tag to cap,
so its headline is matched **whole** and the figure read back out of it.
`t` is an allowed tag name there, so a boost topic smuggled onto a donation is
refused **explicitly** rather than by the allowlist.

**A consequence to state plainly: site donations appear in no feed, no total and
no stat.** That is deliberate. If they should ever be counted, it is a different
tag design and a different decision.

### Getting A Boost Into Helipad

Helipad reads three tiers, and **it never reads Nostr at all** — it polls an LND
node (`LND_URL`, `LND_ADMINMACAROON`, `LND_TLSCERT`). The kind-1 note and its
tags are invisible to it.

| Tier | Source | Our path |
|---|---|---|
| 1 | boostagram TLV 7629169 on the HTLC | keysend legs, **and every lnaddress leg the upgrade can reach** |
| 2 | `rss::payment::boost <url>` in the invoice memo → HEAD → `x-rss-payment` | the lnaddress legs it cannot, via `/api/boostbox` |
| 3 | the memo verbatim | the bare message, which is what shipped before |

`functions/api/boostbox.js` stores the metadata with BoostBox
(podcast-namespace PR #734) and `buildLnurlComment` puts the returned URL in the
LNURL comment.

**⚠️ TIER ONE IS PREFERRED WHEREVER IT IS REACHABLE, AND THE REASON IS NOT
PERFORMANCE.** `parse_boost_from_invoice` reads the TLV in its **first** branch,
before any memo or metadata handling, so a keysend needs nothing switched on at
the podcaster's end; tier two is gated on Helipad's `fetch_metadata`, which
**defaults to false**, and puts a third party's service in the path of the
metadata. So the two are not alternatives of equal standing — tier two is the
answer for the legs tier one cannot have.

### The Keysend Upgrade

`login-widget/src/lib/keysendLookup.js` + `functions/api/keysend.js`. Some
providers publish `/.well-known/keysend/<name>` beside the usual
`/.well-known/lnurlp/<name>`, naming the node pubkey and the custom record that
routes a payment to that account. Where one exists, `resolveKeysendUpgrade` in
`externalBoost.js` swaps the destination and the leg runs the keysend branch the
value block's own node recipients have always run. **The boostagram builder, the
TLV encoding, both wallet calls and the UNCERTAIN rules are untouched; the whole
of the feature is which destination the branch is handed.**

Measured over the top-30 shows' value blocks, 2026-08-21: 48 of 111 legs were
already keysend, 34 more upgrade, 25 are at `fountain.fm` and are deliberately
excluded, 4 publish no usable document. **Tier-one coverage goes from 48 legs to
82.**

**⚠️ AN INVOICE IS MORE RELIABLE AND A KEYSEND IS MORE INFORMATIVE, WHICH IS
THE WHOLE TRADE.** An invoice carries route hints and reaches a node behind
unannounced channels; a keysend to a bare pubkey has none. Measured 2026-08-22,
`podcastindex@getalby.com` names a node with **no public channel record at
all**, which is exactly the shape that fails.

**So an upgraded leg the wallet CLEANLY DECLINES is re-paid as an invoice on the
same leg**, automatically, and the donor never sees it. `FAILED` is the only
status that reaches that branch, and it can only have come from
`isCleanDecline` — this codebase's standing definition of *the payment never
left the wallet*, and already the test that puts a **Retry which re-pays** in
front of a donor. So the fallback is exactly as safe as a button that already
ships; the one thing new about it is that nobody had to press it. The descriptor
runs on the fallback path, so such a leg still reaches tier two.

**⚠️ THE CLASSIFIER HAS TO RECOGNISE THE WALLET'S OWN CODES, AND IT DID NOT.**
Observed on a real boost, 2026-08-22: an upgraded leg to
`podcastindex@getalby.com` came back `Nip47WalletError:
FAILURE_REASON_NO_ROUTE`, and `isCleanPaymentDecline` looks for `no route` —
one underscore, and the leg was classified **UNCERTAIN instead of FAILED**.
**UNCERTAIN is the one status with no way out**: the fallback is gated on
FAILED, Retry is gated on FAILED, and "Check again" needs a verify URL a
keysend has never had. The donor was left with a leg offering no action at all,
in the exact case the fallback was built for. `WALLET_CLEAN_FAILURE_RE` in
`externalBoost.js` closes it, and **what it leaves out is the whole of its
safety**: `FAILURE_REASON_TIMEOUT` is excluded because an HTLC in flight when
the clock expired can still settle, and `FAILURE_REASON_ERROR` says nothing
about settlement. **Only add a code whose meaning is that no HTLC survived.**
The same gap is still in `payAllLegs.js`, which reads the shared classifier
directly; it is unpatched because nothing on this fork calls that path and its
error runs the safe way.

**⚠️ AND `UNCERTAIN` MUST NEVER REACH THAT BRANCH.** An attempt was made and
nothing observable came back, so re-paying it on another rail is the 2026-08-19
double payment. There is no re-pay out of UNCERTAIN anywhere on this site and
this is not the exception. `test-keysend-upgrade.mjs` pins the branch's
condition literally, and pins `payLnaddressLeg` at **exactly two call sites** —
the ordinary route and this one. A third is a path nobody has argued for.

Everything else that could disqualify a leg is asked up front, before anything
is attempted:

- **⚠️ THE WALLET IS ASKED FIRST, AND THAT GATE IS WHAT KEEPS THE UPGRADE FROM
  COSTING A PAYMENT.** An lnaddress leg pays over BOLT11, which every rail
  speaks; a keysend leg does not — most WebLN extensions have no `keysend`
  method and an NWC connection is only as capable as the wallet behind it. So
  upgrading blindly converts 34 of 111 legs into legs that cannot be paid, in
  exchange for metadata. **The metadata is a courtesy to the recipient; the
  payment is the point.** `walletCanKeysend` answers off `window.webln.keysend`
  or the NWC service's `pay_keysend` capability, cached for the session, and
  **every uncertainty answers no** — a wallet that will not answer `get_info` is
  treated as incapable, because a missed upgrade costs metadata where a wrong
  yes costs the payment. It is asked before the address probe so an incapable
  wallet costs one lookup for the whole boost rather than one per leg.
- **⚠️ AND WHAT THE WALLET *SAID* OUTRANKS WHAT IT ADVERTISED.** A capability
  error out of a real attempt latches for the session (`noteKeysendUnsupported`),
  so no later leg is upgraded. The leg it just cost is `FAILED`, so it carries a
  Retry, and the retry re-enters with the latch set and pays over LNURL. **Both
  capability memos are dropped on `wallet.onChange`**: going from a capable
  wallet to one without it and keeping the old yes upgrades legs the new wallet
  cannot pay. The address cache is a fact about recipients and deliberately
  survives.
- **⚠️ `fountain.fm` IS EXCLUDED THOUGH IT QUALIFIES, and this is the largest
  single decision in the file** — 25 of the 111 legs. It has keysend, it
  publishes the document, the payment arrives and the sats land; it just never
  surfaces the TLV to the recipient, so the upgrade fires and the metadata is
  discarded at the far end. The LUD-21 comment is the only channel Fountain
  shows, which is the channel `/api/boostbox` already fills. **Do not "correct"
  this by testing whether the host serves the well-known: it does, and that is
  the trap.** Nothing observable from our side separates a provider that renders
  the TLV from one that drops it. Membership in `LNURL_ONLY_DOMAINS` is
  knowledge about the provider, never a probe.
- **⚠️ THE EXCLUSION IS MATCHED EXACT-OR-PARENT, NEVER `endsWith`.** A bare
  suffix test also matches `notfountain.fm`, which hands anyone who can register
  a hostname the ability to strip the inline boostagram off other people's
  payments. The value block is attacker-authored text.
- **⚠️ THE PUBKEY IS VALIDATED STRICTLY** (`/^0[23][0-9a-f]{64}$/`), because
  there is no second chance. `primal.net` answers the probe **HTTP 200 with its
  SPA's HTML** — three legs of the measured corpus — so a status check alone
  reads them as upgradeable.
- **⚠️ THE ROUTING PAIR IS TAKEN WHOLE OR NOT AT ALL.** `customKey` and
  `customValue` address a sub-account on a shared node, so a key from one entry
  paired with a value from another pays a stranger and the payment still
  succeeds. The upgraded destination is built **field by field and never spread
  from the original recipient**, for the same reason one level up: a value
  block's own pair routes to an account on the node *it* named, which is not
  this node.

**⚠️ `/api/keysend` IS THE ROUTE, NOT A FALLBACK, WHICH IS THE OPPOSITE OF
`/api/lnurl`.** LNURL is browser-facing by design and those endpoints almost all
send CORS headers, so that proxy exists for the minority that do not. The
keysend well-known is a **server-to-server convention** and providers generally
send none, so a direct browser fetch is blocked for a *healthy* endpoint and the
client's catch reads that as "publishes no keysend document" — silently
downgrading every leg. That is exactly how BMB's own upgrade never fired. There
is no direct attempt before it.

**A non-2xx is the ordinary case here**, which is why that Function does not
share `/api/lnurl`'s helpers: mirroring the upstream status and surfacing the
recipient's own words is right where a donor is owed an explanation, and wrong
where the leg pays over LNURL either way. **Everything that is not a usable
document is one 404 with one reason.** The document comes back **verbatim** so
`keysendLookup.js` is the single parser. **It is not rate limited, deliberately**
— `/api/lnurl` is the same shape and carries no counter either; `/api/boostbox`
has one because it *writes*, under our key, to a third party.

**⚠️ THE LEG'S IDENTITY DOES NOT CHANGE, ONLY ITS DESTINATION.** `leg.recipient`
stays exactly as the value block published it — the lightning address is what
the donor sees, what a retry is issued against, what the boostagram credits, and
what the fallback pays. `leg.keysendUpgrade` / `leg.keysendFellBack` and a
`→keysend` or `→keysend→invoice` marker in the console line are the only trace,
and they exist because which rail a leg took is the first thing anyone debugging
a podcaster's missing row needs to know.

**⚠️ THE RSS `type` AND THE WELL-KNOWN ARE NOT IN CONFLICT, which is the frame
this decision turned on** (Reed's question, 2026-08-22). A publisher writing
`type="lnaddress"` and the provider publishing a keysend document *for that same
address* are not two claims to arbitrate between; the provider is naming a
second door to the same account, complete with the `customKey` / `customValue`
that routes to it. So the question was never whose declaration wins — it was
which door is more reliable, and the fallback is what stops us having to answer
that in advance for every recipient.

**Still unverified: a real upgraded leg reaching a real Helipad.** The wallet
gate, the exclusion and the parser are all covered by the test; the end-to-end
path has not been run with sats. **⚠️ And a self-paid leg cannot verify it** —
see the note above on an invoice that never settles.

**⚠️ IT PROXIES BECAUSE OF THE KEY, NOT BECAUSE OF CORS**, which is the opposite
of `/api/lnurl`. tardbox answers with `access-control-allow-origin: *`, so the
browser could call it directly; it must not, because a shared key in a 1MB
public bundle is one anyone can write records under our name with.
`BOOSTBOX_API_KEY` is a secret binding on Preview **and** Production, and Pages
binds at deploy time so a new secret needs a redeploy.

**⚠️ `feed_title` AND `item_title`, NEVER `podcast` AND `episode`.** Helipad
deserializes an `RssPayment` of exactly nine fields — `action`, `app_name`,
`feed_title`, `item_title`, `message`, `remote_feed_guid`, `remote_item_guid`,
`sender_name`, `value_msat_total` — and drops the rest. `podcast`/`episode` are
the **boostagram TLV's** names for the same two facts; sending those stored them
faithfully and rendered a podcaster's row with a sender, a total and no show.
The guids go in **twice** for the same reason: the plain pair drives BoostBox's
own page, the `remote_` pair is the only guid Helipad reads.

**⚠️ THE DESCRIPTOR IS WHOLE OR ABSENT.** Truncation cuts from the right with
the URL on the left, so `${desc} ${msg}`.slice() shortens the URL into a dead
link having spent the whole 255-character allowance on it.

**⚠️ AND A MISSING DESCRIPTOR IS NEVER FATAL.** Every failure — no key, no KV,
rate limit, timeout, upstream refusal — resolves to the bare message. It also
**warns to the console**, because the only other symptom is a row in somebody
else's Helipad. `sender_id` is deliberately never sent, so an anonymous boost
cannot leak a pubkey to a recipient's aggregator through this channel, and the
descriptor is skipped entirely on a site donation.

**⚠️ A SELF-PAID LEG NEVER SETTLES, AND IT IS NOT A BUG IN ANY OF THIS.** Where
the donor is also a split recipient, that leg is their own hub paying an address
it hosts; it can be credited internally with no HTLC, leaving the LND invoice
`OPEN` forever, so nothing reaches Helipad's stream. Measured 2026-08-22: the
memo was intact on the node and the invoice was never settled. **It costs an
ordinary donor nothing** — they are not a recipient of the show they boost — but
it means this phase cannot be verified on such a leg, by keysend or by
descriptor.

### The Wallet Gate Is Behind The Boost Button

**Compose first, pay second.** `openExternalBoost` ran the wallet gate before
the modal ever mounted, so a visitor who pressed Boost was asked to paste an NWC
connection string before seeing what they were boosting or what it would cost.
It now lives in `handleBoost`, where the connect modal arrives at the moment its
purpose is obvious, and the form says one more step is coming rather than
springing a second modal on the reader.

**⚠️ IT COSTS NOTHING TO PRESERVE, AND THE REASON IS Z-INDEX.**
`WalletConnectModal` is `z-[78/79]` and `LoginModal` is `z-[80]`, both already
above the boost modal's `z-[70/71]`. So the boost modal **stays mounted
underneath with its state intact**; there is no draft to save and restore, and
the LNURL prefetch that runs on mount gets the whole detour as extra runway.

**⚠️ THE RESUME IS THE MODAL'S OWN `wallet.onChange` SUBSCRIPTION, NEVER A
`pendingAction`.** That queue re-enters an api method from the top, and
re-entering `openExternalBoost` with the modal already open would mount a second
one over the first. `api.requestWalletForBoost` therefore queues nothing and its
promise is deliberately **not** the resume signal — a second path into
`startPay` is a second way to pay twice. It keeps everything else the retired
gate did: the at-rest restore first, so a returning visitor with a saved blob
never sees the connect modal; and `handleWalletGateFailure`'s distinction
between "no wallet" and "a remembered extension that stalled", since a slow
extension must not be told it has no wallet.

**⚠️ `remembered` IS NOT `connected`, AND MOVING THE GATE IS WHAT MADE THAT
VISIBLE.** `connected` means a live client; a saved NWC blob or an enabled
extension reports `remembered` and engages on the first press. The old gate ran
that unlock *before* the modal mounted, so the modal only ever saw a connected
wallet. Now it opens first — and the form's wallet hint told a returning user
with the identity dot showing green that they had no wallet. They are one press
from paying, so the line is withheld for `remembered` entirely. **Any new copy
about wallet state has to test both.**

### The Site Signs For A Booster Who Has No Key

`functions/api/sign-boost.js`. A visitor who boosted without a Nostr account has
paid a show and no way to put that boost in this index, because the index counts
notes and they have no key to sign one with. The endpoint signs a boost note
under the bot identity and **the browser publishes it** — the endpoint never
touches a relay, an outbound socket per request being a second thing to abuse.

Two bindings, and it refuses to run without either: `BOOSTBOT_NSEC` (secret) and
`SIGN_RATELIMIT` (**a KV namespace**), on Preview *and* Production. Unconfigured,
it answers 503 and the feature is simply off.

**⚠️ IT CANNOT VERIFY THAT ANYTHING WAS PAID, AND NO CHEAP VERSION OF IT CAN.**
Proof-of-payment was designed and rejected on 2026-08-19: a preimage proves only
that someone *knows* the preimage, which is the payer **or whoever issued the
invoice**, so an attacker self-issues an invoice for any amount and passes. A
caller-supplied LUD-21 verify URL is worse. The only real version has this server
issuing the invoices, which puts it in the middle of a money path. Don't
re-propose it in either form.

**So the evidence standard is the SAME as the donor-signed path's**: the
browser's own observation of what settled. That is Reed's call and the symmetry
is the argument — if the evidence is good enough to publish from the donor's
account it is good enough to publish from ours. What differs between the two
paths is not evidence but **accountability**: on the donor path, possession of
the key proves an identity chose to stake itself on the claim. Here there is no
key to possess, so what stands in for it is **containment**:

- one identifiable publisher, so the bot's whole output is a single filterable
  set (`client_src = publisher-pubkey`);
- `excludes.json` removes all of it in one edit, reversibly;
- the caps below bound what one caller can do with it.

Keep it in proportion: **the index already accepts unauthenticated writes from
the whole of Nostr**, since anyone may publish a boost note from a burner key and
the collector indexes it. The endpoint removes the friction of generating a key,
not the capability.

**⚠️ THE VALIDATOR IS AN ALLOWLIST, and `e` and `p` are refused by omission.**
Our template emits neither, so refusing them is provably not a regression — and
with an `e` tag a note signed by this key appears to **reply** to any note in the
world, which is a far better vehicle for harassment than a standalone post nobody
follows; with `p` tags it becomes a mention blast at strangers from an identity
carrying our NIP-05. **If `buildExternalNoteTemplate` ever emits a new tag, add
it to `ALLOWED_TAGS` in the same change** or every site-signed note starts
failing. `scripts/test-sign-boost.mjs` feeds the validator from the **shipped**
builder rather than a fixture, so that coupling fails in the test rather than in
production.

Four more rules, each closing something specific: the `amount` must be **plain
digits**, because `Number('1.5e6')` is an integer and the string `1.5e6` reads as
1,500,000 to a JavaScript consumer and raises in the collector's `int()`;
`client` is not caller-settable, being our own attribution; an `r` URL is checked,
being a link published under our identity; and `created_at` is held to ±5min.

**⚠️ THE RATE LIMIT IS FRICTION, NOT A SECURITY BOUNDARY, and Pages has no rate
limiting binding.** The supported binding types are KV, Durable Objects, R2, D1,
Vectorize, Workers AI, service bindings, Queues, Hyperdrive, Analytics Engine,
variables and secrets; a Pages Function can only *bind* to a Durable Object class
and never define one, so the textbook counter would mean standing up a separate
Worker. It is a fixed-window KV counter instead, 5/min/IP. KV is eventually
consistent so a caller spread across data centres is undercounted, the
read-modify-write loses concurrent increments, and an IP limit falls to anyone
with a proxy pool. It still **fails closed** with nothing bound, because refusing
to run is what makes the operator decide.

### The one boost button

Boosting a SHOW (as opposed to an episode) pays the **feed-level** value block —
`/api/value` with a `podcastGuid` and/or `feedUrl` and no `guid`.

**Every boost affordance on a card is the same control**: the button built by
`assets/js/boost-button.js`, styled as `.ob-boost-pill` in **theme.css** (there,
because it is the one class the homepage and the detail pages both need). It
reads `--brand`, never `--accent`: the feed accents only exist on `index.html`.
It rides the right end of the card's Nostr Stats line, pinned by its own
`margin-left: auto`. Solid brand blue, the word "Boost", no bolt.

| Surface | Handler | Pays |
|---|---|---|
| Episodes / Songs cards | `episode-card-actions.js#onBoostClick` | that episode |
| Shows / Albums cards | `shows-feed.js#onShowBoost` | that show's feed block |
| `/show` community drawer rows | `show-page.js#onCommunityBoost` | another show's |
| `/show` hero button | `show-page.js#initBoosting` | this show's |
| `/episode` hero button | `episode-page.js#initBoosting` | this episode |
| `/episode`, `/booster` cards | `episode-card-actions.js#onBoostClick` | another episode |

**`boost-button.js` is chrome, not a money path.** It builds a button and reports
clicks; each caller owns its own resolve-and-pay sequence, because what a boost
pays differs by surface. All go through `fromApiValue` → `applyExternalOverrides`.
Sharing the button and not the handler is the seam on purpose.

**It does not probe.** The hero button reveals itself only after a value block
resolves; a page can carry 150 community rows, so those reveal optimistically and
resolve on click, reporting an unpayable show in a toast at that point. Withheld
entirely from unidentified shows, which have no Podcast Index record.

**The community drawer is the only place on the site that pays a show other than
the one the surface is about.** The target guid and feed URL come off the row's
own data attributes and are threaded through `resolveValue` *and* `openBoost`
together — passing a guid to one and not the other would resolve one show's
splits and label the published note with another's.

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
| `boosts-global` | `boosts-feed.js` | `GET /api/v1/boosts`, cursor-paged |
| `boosts-follows` | `boosts-feed.js` | `POST /api/v1/boosts/follows`, cursor-paged |
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

**The ranked feeds offer 1W/1M/1Y/All; the Boosts note feed offers 1W/1M/All.**
On the ranked feeds the range is a **query parameter** — `RANGE_DAYS` in
`functions/api/v1/episodes.js` and `…/podcasts.js` — so a wider window is a
different `WHERE` clause and costs nothing. **Those two tables and
`RANGE_OPTIONS` move together, or a range button answers 400.** The note feed
**walks** its window instead (`ensureCoverage`), and at ~38 boosts a day a year
is ~13,900 rows: ~70 sequential requests before the first card paints.
`WALKED_RANGE_OPTIONS` is the subset it passes. Giving it a year means giving it
a `since`-scoped query, not a fourth button.

**Sorting is over the selected window, so a bounded window is paged in completely
before it's painted**; otherwise "largest boost" would rank whichever pages
happened to be loaded. A bounded window that's fully covered therefore has **no**
load-older button. On All the button stays, and a non-chronological order can
only rank what's loaded, so the count line says so. Loading older rows re-sorts
in place under those sorts; under `recent` it appends.

**Neither Boosts scope pages backwards hunting for matches any more.** The D1
query answers in one indexed hit, so an empty first page genuinely means empty.

### Ranking, And The One Definition Of It

**`assets/js/rank.js` is the site's single definition: standard competition
ranking (1-2-2-4).** A rank is the count of rows **strictly ahead, plus one**;
ties share the better place and the next distinct value skips the whole group.
It is two-sided and dependency-free, so the edge and the browser number a card
identically. The full argument, and the dense-ranking measurement that was
rejected, is under **The Rank Line In The Stat Tiles**.

**⚠️ The `T` is on every surface, in two forms.** A feed card prints `T4` beside
the card; a detail-page tile prints `T#4` in its chip, because the tile stands
alone where the card sits in the list it is a rank on. `T4` is golf's own form —
`T#4` would be the two conventions stacked. `rankLabel()` in `rank.js` owns both.

**⚠️ `tied` is only as complete as the rows the caller holds, so the last card of
an open-ended feed cannot see a tie continuing into rows not yet fetched.** That
direction of error is the safe one — the rank is still right and the row simply
does not yet disclose its tie — and both feeds re-sync their painted labels after
an append (`syncRankLabels`), because appending does not re-render what is
already on screen. `feeds-podcasts.js` also patches the **seam**: the server
painted the adopted block's last card without knowing what followed it, and that
card is not in `items` to be re-labelled. The `/episode` and `/booster` rollups
need none of this — `view` is their whole ordering, so every tie is marked on the
first paint.

**⚠️ THE OPENING HOMEPAGE FEED TIES HEAVILY, AND THAT IS THE DATA RATHER THAN A
BUG.** Measured against production on 2026-08-18, the first thirty cards of
Episodes · Global under the default sort (Most boosters) number:

```
1 2 3 4 5 T6 T6 8 T9 T9 T9 T12 ×6 T18 ×13
```

Booster counts are quantised — 29, 27, 25, 23, 22, 21×2, 20, 19×3, 18×6, then
**17 thirteen times** — so the bottom thirteen cards of the page genuinely share
18th. Those cards were always tied; ordinal ranking numbered them 18 through 30
as though they were not, and competition ranking is what discloses it. If it ever
reads as too heavy the honest levers are the default sort or a depth past which
no numeral is painted, **never softening the tie marking**, which would put the
invisible tiebreak back in charge.

**⚠️ `competitionRanks` assumes the list is ALREADY ORDERED BY THE VALUE IT
RANKS.** Hand it rows in another order and it returns confident nonsense rather
than an error. Every caller satisfies it by construction (the API returns the
page in the active sort, and `episodeRankValue` reads the same aggregate the
endpoint ordered by), but a new caller has to check.

**⚠️ `.pcast-rank`'s `min-width` is an alignment floor.** Each card is its own
flex row, so a wider numeral pushes that card's artwork right and the run stops
lining up. The `T` costs about a character, which is what took it from 1.6rem to
2.3rem (1.2 to 1.8 on a phone).

**⚠️ The client can compute this with no new server field, and that is what
makes it cheap.** A competition rank is the position of the first row sharing
your value, and the ranked feeds page forward from offset 0 and only ever
append, so the browser always holds every row ahead of the one it is numbering.
A `RANK()` window over the default listing was **not** used: the `q=` path's
window already reads ~31k rows against ~200 for a plain page, and that shape is
documented as not for the feed.

Four renderers stamp it, all through `competitionRanks`:

| | |
|---|---|
| `functions/_shared/episode-cards.js` | the edge's card page; `page` is a prefix from 0, so no seed |
| `feeds-podcasts.js#renumber` | Episodes / Songs, **with a seed** — see below |
| `shows-feed.js#rebuild` | Shows / Albums; never adopted, so no seed |
| `episode-section.js#stampRanks` | the `/episode` and `/booster` rollups, whole corpus in memory |

**⚠️ `lastRank` / `lastValue` ride the homepage's state element**, and they exist
for exactly one case: the homepage **adopts** thirty server-rendered cards as
markup with no data behind them, so when it fetches page two it holds no row
ahead of the first one it must number. A tie straddling that seam would restart
as a new run and every card below it would be off by the size of the tie. Both
are cleared wherever `adoptedCount` is, since they describe cards no longer on
screen.

**⚠️ `episodeRankValue` reads `totals` before the built fields**, and that is
the correctness half rather than a preference: `boosts.length` is the inline
note count, **capped at 50 per episode** by `include=boosts`, where `totals`
carries the true aggregate the server ranked by. Comparing capped counts reads
two episodes with 60 and 55 boosts as tied. It lives beside `EPISODE_SORTERS`
and `RANKED_SORTS` in `episode-card.js` so all three move together.

**⚠️ The `q=` paths use `RANK()`, never `ROW_NUMBER()`, and carry NO tiebreak
inside the window.** The tiebreak stays on the outer `ORDER BY`, where it makes
paging a total order; inside the window it would hand every member of a tie a
distinct rank again. A searched card has to agree with the number the same card
carries on the unfiltered feed. Verified against `bots/global-boost-scan/d1/schema.sql`
in local sqlite: 400 random corpora x 3 sorts, SQLite's `RANK()`, `competitionRanks` and
a brute-force reference all agreeing, plus the split-page seam.

### The Language Filter

`assets/js/feed-lang.js`, mounted as a third control on **all four ranked feeds**
and on none of the detail pages. `<language>` is an RSS *channel* element, so it
is a property of the SHOW and an episode inherits its feed's; the collector
stores the primary subtag only (`en`, never `en-US`), because the corpus
describes ~21 languages in 36 distinct raw tags.

**⚠️ NULL IS NOT ENGLISH.** The rule and its numbers are under **Show language:
`language`** below; what it costs this control is that the untagged bucket gets
its own menu row, **"Not tagged"**, sending `lang=unknown`. It is there for the
same reason an unidentified show is labelled rather than dropped: once a reader
has filtered, that row is the only way back to those shows.

**⚠️ `lang=all` IS NOT "no filter"; it is a well-formed subtag that matches
nothing.** `readLang` validates by shape, so `all` passes and answers **0 rows**
(verified against production). `ob-live.js` sends the parameter only when the key
is not `all`, and that guard is the whole of what stands between the opening view
and an empty feed.

**⚠️ The menu is FETCHED, never declared.** `GET /api/v1/languages` is
medium-aware and the two halves disagree, German being 38 shows on the podcast
side against 2 on music, so one shared static list would offer Albums options
matching nothing it can show. It would also go stale silently the first time
anybody boosts a show in a new language. Three things follow:

- **A null menu is a withheld control, not an error**, and there are three ways
  to get one: the endpoint failed, it 404'd, or the feed holds a single bucket.
  All three leave exactly the control bar that shipped before this existed. That
  is also the graceful path while the API half of the feature is undeployed.
- **It is inserted into the bar, never awaited.** On the adopted homepage feed
  there is no first-page fetch to hide behind, so blocking would delay
  `enhance()` and leave thirty painted cards with dead boost buttons.
- **Order in the group is filters then ordering**: range, language, sort. The
  sort pill stays at the right end, where it has always been.

**⚠️ NO LANGUAGE IS FLOORED OUT OF THE MENU, so the menu SCROLLS.** Measured live
on 2026-08-17 the endpoint answers **19 buckets** on the podcast side and 6 on
music, and **ten of the podcast languages are a single show** (ar, da, el, fi,
ja, nb, zh …). Boost-weighted the tail is nothing, which makes a floor tempting;
it is not applied, because hiding the one Japanese show's language makes that
show unfindable by the axis the control exists for, and that is the same
objection that keeps "Not tagged" in the list. Twenty rows is ~600px, so
`.pcast-lang` caps the menu at `min(60vh, 21rem)` and scrolls it. **The real
constraint was menu height, not the length of the list.**

**Changing the language is a QUERY, exactly like the range and the sort.**
Filtering the loaded pages instead would rank a German show against the English
ones it was ranked beside, and could only find the languages inside the prefix
already paged in. Two consequences the site's existing discipline demands:

- **The search carries it**, like the medium and the scope. A suggestion the feed
  then filters to nothing is the documented reason `/api/v1/search` is not used
  by these feeds.
- **The feed note gains a second sentence** rather than a rewritten first one:
  "Ranks based on every boost in the index. German-language shows only." One rule
  covers both scopes and both media. `-language` is not padding; "English shows"
  reads as shows from England.
- **`noMatchText` gains a fourth cause, tested FIRST.** It is the narrowest
  filter and the only one whose fix is one press; under Follows plus German,
  "switch to Global" points past the filter actually hiding the reader's show.

### The Bar On A Phone

**⚠️ THREE CONTROLS DO NOT FIT ON ONE LINE AT 375px WITH THEIR DESKTOP LABELS,
and the fix is in the labels rather than the layout.** The bar has 335px inside
its padding; the range is 128px, `Language: All ▾` 124px and
`Sort: Most boosts ▾` 153px, so the group ran 421px and wrapped, putting the
sticky chrome at three rows and 200px with the nav. That is 30% of a 667px
screen before the first card. Two rows was the state before the language pill
existed, and it is the state to hold.

Under 640px, therefore:

- **Both pills drop their tag.** `Sort: ` and `Language: ` cost 41px and 32px
  and say what the value already implies.
- **⚠️ The language pill inverts: unset it shows its AXIS, picked it shows its
  VALUE.** A bare "All" would sit inches from the range's own All button and mean
  something else entirely, so the unset pill reads `Language ▾`.
- **⚠️ A picked language shows its SUBTAG, and this is the load-bearing part.**
  With the name in the pill only **58 of the 120** sort × language combinations
  fit on one line, because `Norwegian Bokmål` is 141px and `Recently boosted`
  another 141px. `DE` is 48px and takes it to **115 of 120**. The name is not
  lost: it is the menu row it was picked from, and the button's tooltip.
- The last ~15px comes off the range's `min-width` and the pills' padding, never
  off the type scale. Shrinking a label is what makes a control look like a
  different control.

The five that still wrap are all *unset* language plus one of the four longest
sort labels, and they wrap gracefully to a second control line. Closing them
means shortening a sort label ("Recently boosted"), which is product copy and a
separate decision. `.pcast-controls` carries `flex-wrap` for exactly this tail.

**Desktop is untouched.** There is room for the tags there, and `Sort: X ▾` is a
pattern the three detail pages share.

**The Boosts feeds have no language axis**: `/api/v1/boosts` and
`/api/v1/boosts/follows` take no `lang`. That is backend work, not a decision.

### The Language In The Hash

`#shows?lang=de` is a shareable view: the top German shows, the top German
episodes. **Language is in the hash and range and sort are not**, which is a
decision rather than an oversight. A language names a body of work somebody would
hand to somebody else; a range and a sort are how one reader is currently looking
at a list. The shape leaves room for them if a reason turns up.

Five pieces, and the awkward ones are all about a feed that is *already on
screen*:

- **`normLang` in the controller.** `?lang=en-US` normalizes to `en` the way the
  collector normalizes on write. **⚠️ `?lang=all` normalizes to NO FILTER**,
  because the API validates by shape and would take `all` as a well-formed subtag
  matching zero rows.
- **The opening language rides `lb:feed-activate`** into `feeds.js` and on into
  the renderer, so it reaches the **first** query. Applying it after one would
  paint the unfiltered feed and then correct itself.
- **⚠️ A LANGUAGE IN THE HASH REFUSES THE SERVER'S CARDS.** `functions/index.js`
  renders the opening Episodes · Global page unfiltered, and a hash never reaches
  the server, so `adoptServerCards()` returns null whenever `langKey` is set.
  Adopting would paint thirty English episodes under a German filter with a note
  beneath them saying otherwise.
- **⚠️ `lb:set-feed-lang` exists because a hydrated feed cannot be re-loaded.**
  `feeds.js` runs each loader once, so a URL pasted into an open tab would move
  the hash and leave the cards alone. Each renderer module keeps a `LANG_APPLY`
  map and **one** listener, so a re-render replaces its entry rather than
  stacking a second listener that requeries twice.
- **`lb:feed-lang` reports back**, and the controller writes the hash from it. So
  a shareable URL is a side effect of using the control, not something the reader
  assembles.

**Coercion happens twice, and both are the `#episodes-follows` precedent.** A
feed with no language axis drops the parameter; and when the menu lands, a
language it has no row for is dropped, reported, and taken out of the address
bar. The report is what keeps the URL from naming a view that is not on screen.

**Language does not carry across a feed switch.** Each renderer hydrates once and
owns its own control, so carrying one would need a command channel into an
already-mounted control; the two menus also differ, so a carried value could name
something the destination cannot show. `langByFeed` remembers each feed's
language, so returning to a feed restores both the view and the address.

### Search

`assets/js/feed-search.js` is the typeahead at the head of every panel, inside
the panel rather than the sticky bar: range and sort are read while scrolling a
long list, a search is a thing you do at the top.

| Feed | Searches | Filters to |
|---|---|---|
| Episodes / Songs | episode title, plus the show behind it | that one episode |
| Shows / Albums | show title, plus the guid | that one show |
| Boosts (Members) | **`/api/v1/members`, over all 2,011** — name, npub or hex | that member's boosts, **fetched** |

**Typing suggests, picking filters.** Five hits, and nothing in the list moves
until one is chosen. That's what a ranked feed needs: the question is "where does
my show stand", and the answer is one card carrying its rank.

**⚠️ Rank retention is the renderer's half of the contract, and it is an
ordering**: sort the range's full corpus, stamp each row with its position,
*then* filter to the picked key, then paint from the stamp. All three renderers
do it in that order. Reversing the middle two steps renumbers the survivor to #1,
which answers a different question.

Two fields, deliberately not the same one: `label` is shown and matched, `sub` is
shown only, `extra` is matched only. Matching what's displayed sounds friendlier
and isn't — the Shows sub-line reads "506 boosts · 12k sats", which made every
show a weak hit for "boost".

**Two backends, and which one a feed gets is not a preference.** `getEntries`
scores a corpus the feed already holds in memory — right for Boosts, whose window
*is* its corpus. Scoring is a ladder (exact / prefix / word-start / substring /
label before `extra`), not a fuzzy distance, because these queries are the
opening words of a name the user already knows. `searchRemote` is for a feed that
**pages a ranked list off the server**, where the loaded pages are a prefix of the
corpus: that is Episodes, Songs, Shows and Albums, where an in-memory index could
only find what the reader had already scrolled past. Debounced at 220ms, every
request abortable, and replies **sequence-guarded as well as aborted** — an
aborted fetch is not guaranteed to lose the race.

**⚠️ The remote source is `/api/v1/episodes?q=`, NOT `/api/v1/search?type=episodes`,
and the choice is forced.** The search endpoint is a flat relevance-ordered
lookup with **no medium filter and no follows scoping**; pointed at these feeds it
would offer Songs inside Episodes, and on a Follows feed every suggestion would
filter to an empty list. The episodes endpoint applies the active medium, range,
sort *and* scope, which is the only way a suggestion is guaranteed to be
something the feed can show. The cost is that hits come back in the feed's
**active sort** rather than by relevance.

**⚠️ A RAW SEARCH STRING IS NOT AN FTS5 QUERY**, and every endpoint that touches
one goes through `_common.js#ftsMatch`. MATCH parses its right-hand side as an
expression language, so `-` negates, `:` selects a column and `(` groups; passing
typed text through raises `SQLITE_ERROR`. Measured before it existed: `q=bitcoin`
answered 200 while `q=rabbit-hole`, `q=foo:bar` and a pasted guid all answered
**500**. `ftsMatch` quotes every token individually and puts the prefix `*`
outside the last closing quote — `"joe" "rogan"*` is an implicit AND of terms
appearing anywhere, where `"joe rogan"*` would demand adjacency.

**Shows and Albums match the guid and the author server-side.** The author is in
`podcasts_fts` beside the title. The guid is **not** indexed there and a pasted
one is all hyphens, so it is tested as a separate equality alongside the MATCH.
That is the only handle on the 33% of shows with no title.

**Notes are left off the typeahead and fetched on the pick.** Measured at 80KB
for 5 rows with `include=boosts` against 4KB without, running while someone is
typing. The pick re-issues the *same* query with notes attached, which is why the
entry carries the `query` that produced it.

**A picked card takes its rank from the server, not from its position.** An
unfiltered page is numbered by position because it arrives in rank order from
offset 0, but a searched card is one row out of a filtered query, so
`loadEpisodePage` stamps `_rank` from the response's own `rank` field.

A pick is a fetch, so it has states an array filter didn't: `pickLoading` paints
"Loading…", a resolved miss paints "Not in this range", and no search at all
paints the empty-window copy. Conflating any two tells the reader something
false.

**The no-match line is a function, not a string** (`noMatchText`), because what a
miss *means* depends on where the reader is standing. On All/Global the truth is
a **coverage boundary**: a show nobody has boosted on Nostr is not in the index
and will not be until someone does. There is no wider view to send them to.
Three strings per medium: `searchNoneAll`, `searchNoneRange`, `searchNoneFollows`.

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

Three sections above the boost firehose, all client-rendered by
`assets/js/members-board.js` and hydrated on the tab's first activation.

**⚠️ THE BLOCK SITS ABOVE THE PANELS, NOT INSIDE ONE.** Members holds two boosts
PANELS — Global and Follows — so a section inside one would either be duplicated
or vanish when the reader switches scope. Shown by CSS off
`body[data-active-tab]`.

**⚠️ AND IT HYDRATES FROM BOTH ENTRY POINTS.** The cold load does not go through
`lb:feed-activate` — the controller dispatches that during parse, before
`feeds.js` exists, which is why `feeds.js` re-reads `body[data-active-feed]` at
the end. Hooked to the listener alone, the boards rendered when a reader
*clicked* to Members and were an empty gap on every reload and every shared
link. `test-feed-hash.mjs` asserts both call sites exist.

#### `#40HPW`

Boost an episode and the board assumes you heard all of it, then adds up the
durations. **It is an assumption, not a measurement**, and the Rules dialog says
so. Two boards: **This Week** leads (it resets Monday and has a live race in
it), **Hall of Fame** follows.

**⚠️ NOBODY CLEARS FORTY HOURS.** Over all 9,977 booster-weeks since 2024-10,
exactly two did — the same person, both in autumn 2025. Eighteen weeks ever
passed 30; a typical winning week in mid-2026 is 14 to 20 hours. Eight of the
all-time top ten are from 2025, which is why This Week exists beside the hall of
fame rather than instead of it. The name is the provocation, not a threshold,
and gold marks the two rows above forty. **If gold ever marks a third of a
board the fix is the goal, not the styling.**

`GET /api/v1/members/hours?range=week|all`. Four rules, each from a measurement:

- **Dedupe (booster, episode) inside the week.** Five boosts on one episode is
  one listen; deduping removes 8.9% of qualifying rows and one pair carried
  fifteen. Without it the board measures generosity, which the sats totals
  already measure.
- **Weeks start Monday 00:00 UTC.** `345600` is the first Monday after the
  epoch; without the shift `ts / 604800` buckets Thursday to Wednesday, which
  still produces weeks and is wrong by three days on every row.
- **~14% of boosts contribute nothing** — 8% name no episode, 2.5% of episodes
  have no duration. Stated in the Rules rather than hidden.
- **Publisher keys are excluded.** See below.

**⚠️ THE NPUB COMES FROM A CORRELATED SUBQUERY, NEVER A SECOND JOIN ON
`boosts`.** That join reads correctly and multiplies every row by the member's
whole boost count, so `COUNT(*)` stops being episodes and `SUM(duration)` stops
being hours — both inflated by the same factor and both still a plausible board.

**Units are `hpw`, not `h`:** every row is one member's one week.

**The Rules are a dialog, in the document rather than fetched**, so they open
while the boards are loading or after they failed. It replaced a sub-line and a
caveat that said the same thing at two sizes.

#### The member wall

`GET /api/v1/members` with no `q` is the top-members listing, capped at 100 with
search as the route to everyone else. **It is the same `renderSupporters` the
detail pages use** — that function and every `.sup-*` rule moved into
`assets/js/supporter-wall.js` and `assets/css/supporter-wall.css`, which
`functions/_shared/detail-page.js` re-exports and all four pages link.

**⚠️ THE HEADING IS A PARAMETER AND THE TWO CALLERS PASS DIFFERENT WORDS.**
"Members" on the homepage, "Nostr Community" on the detail pages. Not an
inconsistency to tidy up: the protocol is not the greeting, and someone who has
drilled into one show's page has chosen to go deeper than someone who just
landed.

**⚠️ THREE ORDERINGS, BECAUSE THEY ARE THREE DIFFERENT PEOPLE.** `sort=sats`
ranks by generosity and rewards one large boost; `boosts` rewards turning up;
`shows` (`COUNT(DISTINCT podcast_guid)`) rewards spreading it around. Live, the
leaders are AdminPacman (2.1M sats on 24 boosts), Piez (940 boosts) and Quantum
Panhandler (129 shows). **The figure under each face is the one the list was
ordered by** — a `metric` parameter on `supporterCard`, defaulting to `sats` so
the detail pages are byte-identical.

**⚠️ THE LISTING EXCLUDES PUBLISHER KEYS AND THE SEARCH DOES NOT.** `PUBLISHERS`
in `functions/api/v1/_common.js` is the four keys that sign boosts for many
donors. `chadf_boostbot` topped both the boosts and shows orderings on other
people's listening before this landed. A ranked list is a claim about who the
top members are; a search result is not, and it is a real account somebody may
want to look up. **One list in one place**, because the boards had the exclusion
from day one and the wall never did, which is how the gap opened.

#### The member search

**⚠️ IT ASKS THE INDEX, AND THE THING IT REPLACED COULD NOT.**
`boosts-feed.js#boosterEntries` indexed `scopedRows` — the boosts in memory — so
a member was findable only if they turned up in what the reader had scrolled
past. Measured: the first page reaches 34 of 2,011 members (2%), 500 boosts
reaches 164 (8%), and paging in all 23,259 still only reaches 684 (34%). A third
of members have never appeared in the note feed, so loading more could never
close it.

**⚠️ AND THE PICK FETCHES RATHER THAN FILTERING**, which is the same bug one
level down: a member chosen out of the whole index will usually have no boosts
in the loaded window, so filtering emptied the list at the moment the search
succeeded. `/api/v1/boosts?booster=` is a parameter that endpoint has always
taken.

Three more rules in `functions/api/v1/members.js`:

- **A member is someone who has boosted, never someone with a profile.** 61 of
  the 2,011 have no kind-0 on any relay the collector tried; deriving the set
  from `profiles` reports their live pages as not existing.
- **⚠️ CANDIDATES FIRST, AGGREGATE SECOND.** The obvious single-`WHERE` shape
  defeats index seeking — the plan comes back `SCAN b USING INDEX
  idx_boosts_booster`, reading all 23,259 boosts per keystroke, measured 20ms
  against 3-6ms for the CTE.
- **⚠️ LIKE's WILDCARDS ARE ESCAPED**, the LIKE counterpart of `ftsMatch`: a
  bare `%` typed into the box otherwise returns everyone, ordered by sats.
  SQLite's LIKE folds ASCII only, so a query differing from a name by the case
  of a non-ASCII letter will not match; nothing cheap fixes that.

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

**⚠️ THE NOTE'S LINK IS PERMANENT.** `episodeBoostLink` in `episode-link.js` is
the single owner of the URL written into a published boost note; three surfaces
import it. It resolved to BMB from the fork because OnlyBoosts had no per-episode
page, and the flip was held back until the pages shipped rather than being taken
as a side effect of them. **Notes already published keep pointing at BMB and
always will**: an event cannot be recalled. The URL it emits is **absolute**,
because the string is read wherever the event is rendered.

It returns null (caller sends `''`, template omits both the content link line and
the `r` tag) when there is no episode to point at, which is also what a
**show-level** boost gets. `/show/<guid>` is **not** the episode target: a boost
note is about one episode, so pointing it at the show would drop the part the
reader wants.

## The three detail pages

`/show/<guid>`, `/episode/<item-guid>` and `/booster/<npub>` are **one page with
three subjects**. The back link, the stat tiles, the drawers, the boost list, the
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

### The Rank Line In The Stat Tiles

On `/show` and `/episode` each stat tile carries a third line, `#4` or `T#118`:
the subject's **all-time, all-language, Global** rank by that tile's own sort
(sats, boosts, boosters) on the feed its card lives on (Shows or Albums,
Episodes or Songs, chosen by the same medium partition the API uses). One
shared caption under the row names the feed and links to it.
`functions/_shared/feed-rank.js` is both halves: `feedRanks(db, kind, row)`
runs one scan of `podcasts` or `episodes`, and `renderStatTiles(stats, ranks,
copy)` prints the tiles for both pages.

**⚠️ THE SCHEME IS STANDARD COMPETITION RANKING (1-2-2-4), and the site has
exactly one.** A rank is the count of rows **strictly ahead, plus one**;
everything tied shares the better place and the next distinct value skips the
whole group. Golf's `T` prefix marks a shared place. Two properties are the
whole reason for it:

- **No tiebreak decides a standing.** The feeds order ties by sats then guid so
  paging is stable; that is a display order, and it must never be what makes one
  of two equal shows 4th.
- **It cannot inflate.** An episode with 2 boosts is `T#2274`, because 2,273
  episodes are ahead of it.

**⚠️ DENSE RANKING (1-2-2-3) WAS PROPOSED AND REJECTED**, and it is the
intuitive choice, so the measurement is worth keeping: there are only **31
distinct boost counts across 6,422 episodes**, so dense collapses the corpus
into 31 places and that same 2-boost episode prints `#30` with 2,273 ahead.
Ordinal is arbitrary inside a tie; dense inflates the tail; competition is
honest at both ends. Measured 2026-08-18.

**⚠️ NO DENOMINATOR, ANYWHERE.** Under any tie-aware scheme the count of places
and the count of rows are different numbers and neither belongs next to a rank.
"of 811" also flatters the tail: 51% of shows have two boosts or fewer.

**⚠️ THE CHIP IS DRAWN ONLY INSIDE THE TOP 100** (`RANK_CUTOFF` in
`feed-rank.js`). *Reed's call, 2026-08-21, reversing "no cutoff" from
2026-08-18* — and the reasoning that decision rested on still holds, which is
why this is a **display rule and not a change to `feedRanks`**. A competition
rank is never false however large; `T#2,274` is an honest statement about an
episode with two boosts.

What changed is what the chip is *for*. It sits in a tile's corner, the
sports-card idiom for a standing worth knowing, and **51% of shows have two
boosts or fewer** — so on most pages it was labelling the long tail with a
number nobody would quote. A distinction printed on every page is not a
distinction.

**It is a boundary on the rank, not on the tie group**: a rank of exactly 100
prints even when it is `T#100` shared by fifty rows, because the rank is what
the reader is told and it is correct. Everything else falls out for free —
`anyRank` stays false when nothing qualifies, so the caption and the reserved
chip line go with it and the page renders exactly as `/booster` already does.

Three more things a change would break:

- **It fails quietly**, the podroll discipline: null resolves to tiles with no
  third line, which is what `/booster` renders.
- **The caption defines the `T` only when a `T` is on screen.** Explaining a
  notation the reader cannot see is worse than saying nothing.
- **The chips are not links and the caption is.** Three links to one feed under
  three tiles is one destination said three times.
- **⚠️ The rank is a CORNER CHIP pinned to the tile's top-right**, separating by
  **position** rather than by weight, and borrowed from the sports stat card
  (NBA.com, Sofascore) — the same place the `T` comes from, so a reader meets
  one idea rather than two. It shipped first as a plain third line and read as
  bolted on, because **`.show-stat dd` sets its type with the `font:`
  shorthand** — which carries the family — so a rule overriding only the size
  left the rank in Playfair at brand blue, the same face and colour as the
  figure and larger than the label between them. **The chip therefore restates
  its font-family explicitly**; dropping that line brings the bug straight back.
- **⚠️ ITS SELECTOR IS `.show-stat dd.show-stat-rank` AND THE `dd` IS
  LOAD-BEARING.** `.show-stat dd` is a class plus an element, specificity
  **(0,1,1)**, where a lone `.show-stat-rank` is **(0,1,0)** — so the tile's own
  rule wins and its `font:` shorthand puts the chip back to 1.5rem Playfair in
  brand blue, the figure's exact type, inside a pill padded for 0.63rem. That
  shipped and read as the number spilling out of its pill. **Specificity beats
  source order, so moving the rule later does not fix it**, and the trap is
  re-armed inside the 640px block where `.show-stat dd` sets a `clamp()` of its
  own: both selectors carry the `dd`. This is the same font-shorthand bug as the
  bullet above, arriving the second time through the cascade rather than through
  an omitted property — when a stat-tile rule looks ignored, check specificity
  before changing values.
- **⚠️ `.show-stat--ranked` reserves the chip's line, and it is emitted by the
  renderer rather than inferred by `:has()`.** Left floating the chip overlaps
  the figure: at 375px a tile is ~107px and "3.0M" is ~40px centred, leaving
  ~33px where `T#2,274` needs ~38px — it works until the data gets wide. The
  class is on exactly the tiles carrying a rank, so `/booster`'s keep their own
  spacing; `:has()` would be silently a no-op where unsupported and fail as an
  overlapping number rather than a spacing nit.
- **It is the most compact treatment measured**: ~0.65rem of reserved line
  against ~1.6rem for a ruled footer band, which was built and rejected for
  that. An ordinal word (ESPN) was rejected too, needing one string for desktop
  and a shorter one for the phone.

### Where the shared code lives

| | |
|---|---|
| `functions/_shared/detail-page.js` | escaping, `isoDate`, `fmtDuration`, the bech32 decoder behind the `@Name` chips, `renderBioText`. **Re-exports `renderBoosts` and five formatters from `assets/js/boost-list.js`, and `renderSupporters` / `SUPPORTERS_VISIBLE` / `PODIUM` / `compact` / `initShowMore` from `assets/js/supporter-wall.js`**, plus `boosterPageUrl` from `booster-link.js`; those are aliases, not definitions |
| `assets/js/supporter-wall.js` | **two-sided**: the community wall, its podium rule, its counts and its "Show N more" handler. Moved here so the homepage can render the same wall without loading detail-page.js, which is 156KB of thread machinery it has no other use for |
| `assets/css/supporter-wall.css` | every `.sup-*` rule, desktop and phone. **⚠️ The phone rules moved with it and that is load-bearing**: `.sup-card--podium` is an exact fraction of its row (/5 desktop, /3 under 640px) because `PODIUM` is a server-side constant and CSS cannot move a card into the grid below |
| `assets/js/boost-list.js` | **two-sided**: the boost row and the `#boosts` section, plus the comparators and the range filter both sides run |
| `assets/js/boost-section.js` | the `#boosts` range and sort, shared by all three |
| `functions/_shared/episode-cards.js` | `itemsFromBoosts`, `renderCardPage`, `CARDS_PER_PAGE` — the server half of the episode card |
| `assets/js/detail-page.js` | the back link, section deep-links, the hash spy, copy-npub, "Show N more", the `art2` fallback, share, the Primal backfill |
| `assets/js/episode-section.js` | the card rollup's controls and verbs, shared by `/episode` and `/booster` |
| `assets/css/show-page.css` | linked by all three; the other two reuse its `.show-*` classes verbatim |

The `.show-*` class names are kept on identical boxes on all three pages
deliberately: a parallel `.episode-*` set would be a rename with no meaning behind
it. `episode-page.css` carries only the deltas.

### ⚠️ The section ids are URLs

Every section is addressable so a podcaster can share one part of their page.
**These ids are frozen.**

| Page | Ids |
|---|---|
| `/show` | `#episodes` `#community-shows` `#community` `#podroll` `#reverse-podroll` `#boosts` |
| `/episode` | `#community-episodes` `#community` `#boosts` |
| `/booster` | `#shows` `#episodes` `#boosts` |

Ids are **reused across pages on purpose** where they name the same kind of
section, so a reader who has learned one URL has learned the others.
`#community-episodes` and `#community-shows` list different things, so they don't
share one.

`HASH_ALIASES`, passed to `initHashRouting()`, does for a retired id what
`ALIASES` does for a feed hash: rewrites it with `replaceState` and scrolls. It
holds one entry, `#inverse-podroll` → `#reverse-podroll`, permanently. But it
needs the module to have run, so a rename is still a dead link for anything
resolving the URL without a browser. **It is the repair for a rename that already
happened, not a licence for the next one.**

Four pieces hold the ids up, in four files:

- the ids themselves, on the `<section>` elements in each Function;
- **`scroll-margin-top: 5rem` on `.show-section`** in `show-page.css`. `#top-nav`
  is sticky at 64px, so without it an anchor scrolls the heading *behind the bar*;
- **`revealHashTarget()`** inside `initHashRouting()`, which opens any collapsed
  **`details.ep-drawer`** inside the targeted section — exactly one case needs it,
  `/show`'s episode drawer, and every other `.ep-drawer` already ships `open`. It
  does **not** re-scroll afterwards. `getElementById`, never `querySelector`: an
  id off the URL is untrusted and would otherwise be parsed as a selector.
  **⚠️ The selector was `details:not([open])` and that was a bug**: a card rollup
  is full of nested drawers (`.pcast-card-details`, one per episode card, holding
  its boost notes), so targeting a rollup section opened every one of them at
  once. The path in was the hash spy below — it leaves `#episodes` in the URL as
  the reader scrolls, and the next **reload** ran this over that section. A card's
  own drawer is the reader's to open;
- **`initHashSpy()`**, which makes the ids reachable by a reader who was never
  told them.

### The hash follows the scroll

`initHashSpy()`. An `rAF`-throttled scroll handler finds the last
`.show-section[id]` whose top has crossed the line and `replaceState`s its id.
**Copying the URL at any point yields a link back to that spot.**

Four properties are load-bearing:

- **`replaceState`, never `pushState`.** Scrolling isn't navigation. It also
  fires **no `hashchange`**, which is what stops the spy tripping
  `revealHashTarget()` and opening the episode drawer as a side effect of
  scrolling past it. The two coexist on exactly that property.
- **The line is read from `scroll-margin-top`** via `getComputedStyle`, never
  hardcoded, or the section the spy names isn't the one an anchor would park at.
- **Only on a change.** Safari throttles `replaceState` to ~100 calls per 30s and
  throws past it.
- **The last screenful belongs to the last section**, checked explicitly. A short
  final section can sit wholly on screen without its top reaching the line.
- **It skips a section with no height.** `#community-episodes` ships
  `display:none` when empty, which reports a `top` of 0 and is always under the
  line.

Offsets are measured live rather than cached at init — a drawer opening, a "Show
N more" and a re-sort all move everything below them. There is **no run at
init**: a page opened on `#boosts` is still being scrolled there when the module
executes.

### The back link

`.show-back`, above the hero. The detail pages are a graph rather than a tree,
and `manifest.webmanifest` declares `display: standalone`, so an installed
OnlyBoosts has no browser back button at all.

It is **server-rendered as a real link to the feed** (`/#shows`, or `/#albums`
off the `COPY` table) and `initBackLink` upgrades it to `history.back()` **only
when `document.referrer` is same-origin**. A visitor who opened a shared link has
no chain behind them, and `history.back()` would take them off the site. The
`href` survives the upgrade, so a modified click still opens the feed in a new
tab.

### Drawer chrome

Every `<details>` on these pages shares `.ep-drawer`, and the affordance work is
in `show-page.css` rather than in any renderer. **A collapsed drawer has to
announce that it opens**, which three cues carry: a `--cream-d` header band so the
box has a lid, a **SHOW / HIDE** word drawn from CSS off `[open]`, and a chevron
built from two borders that rotates. The `.drawer-hint` span is `aria-hidden` —
`<details>` announces its own expanded state.

The summary label is `--ink`, not brand: a full heading in link blue promises
navigation, and these expand in place. Playfair at the `.show-stats-title` size,
because these summaries **stand in for the `<h2>` their sections don't have**.

**No summary carries a count and none may gain one.** The affordance is form, not
information; see "No Episode Counts, Anywhere" in the spec for why the episode one
in particular cannot.

`.cs-controls` (the control band, mounted by every drawer) is `--cream-d`, not
`--cream`: on the page background it read as a gap punched through the card. The
`--accent` / `--tint` supply those controls need lives on `.show-main`, not on any
one drawer.

### `/show/<guid>`

Five sections beyond the shared chrome. The spec is the authority; four things
that are not in it or that a change would break:

- **The description is fetched per request, never stored.** Nothing in D1 or the
  shards carries it. `fetchShowDescription` runs inside the existing
  `Promise.all`, so the page pays `max(D1, PI)` rather than the sum; the timeout
  is **2.5s** against `/api/episode-meta`'s 10s, because this is on a reader's
  TTFB; and it **never rejects and never throws**, so no description, an unknown
  show, unconfigured keys, a timeout and an outage all render exactly as before
  the feature existed. `fulltext` is what makes it whole — without it PI cuts
  every text field to 100 words.
- **The clamp is applied by JavaScript, not shipped in the markup.**
  `show-desc.js` collapses to three lines and adds **More** only when the text
  actually overflows, re-measuring after `document.fonts.ready` and on a debounced
  resize, never re-collapsing a description the reader expanded.
- **⚠️ The podroll's two queries are the only ones on the page allowed to fail
  quietly**, because `podroll` is replaced wholesale by a separate **daily** pass
  where every other table rides the hourly boost delta. A remote carrying every
  other table but not yet this one is a normal intermediate state of a deploy, and
  it must not turn 930 show pages into 500s to report a section 93% of them don't
  render. If the sections are missing everywhere, that is the thing to check first.
- **`linked` is the collector's flag and is read, never re-derived.** True means
  the show has a page here; **44% are false** and link to BMB instead.

Both podroll directions ship, and the reverse edge is why the section exists on
109 pages rather than 65. Merging them into one grid was rejected: *I recommend
them* and *they recommend me* are opposite claims, and a tile carrying only
artwork and a title cannot tell a reader which it is.

**Boost messages render `nostr:` URIs server-side.** The client feeds get this
from `boosts-thread.js#parseSegments`; these pages cannot, because that means
shipping 156KB to a page whose whole design is that it reads with no JavaScript.
So `detail-page.js` carries a bech32 decoder emitting the identical
`.nostr-mention` chip. Three things about it are load-bearing: **the checksum is
verified**, and an identifier that fails it renders as plain text rather than a
link (a corrupted npub would otherwise resolve to somebody else's profile, and it
resolves the tokenizing edge case for free, since `n` is in the bech32 charset);
**nothing is re-encoded**, so links use the identifier exactly as it appeared;
and **the name lookup is bound with placeholders, not `json_each`**, because
`BOOSTS_SHOWN` is 24 and the list is always far inside D1's 100-parameter ceiling.

`.nostr-mention` inside `.boost-msg` is styled in `show-page.css`, restating what
`boosts-thread.css` does under `.note-body`, because these pages don't load that
stylesheet. **Keep the two matching.**

### `/episode/<item-guid>`

**Qualifying rule: the episode has a title.** A missing *show* is not
disqualifying: 23 titled episodes carry no podcast guid, and those lose the
eyebrow link and the boost button and keep everything else.

**⚠️ When there is no page, the reader is redirected to the SHOW rather than
404'd** — `noEpisodePage()`, one indexed lookup on the miss path only. It joins
`boosts` to `podcasts` so the target is confirmed to have a title, so it can never
hand over a second 404. **302, never 301**: both cases are expected to resolve,
and a permanent redirect is cached indefinitely. The target is the bare
`/show/<guid>` and deliberately not `#episodes`, since that anchor opens the
drawer built from the same table that just missed.

It exists because **the two halves of the pipeline can disagree.** A feed card
links an episode when the BOOST RECORD carries a title, from the collector's
static exports; this page renders from D1's `episodes` table. Measured 2026-08-01:
`eps_enriched: 6755` against `episodes: 6688` in D1, so ~1% of episode links
resolved to nothing. The cause is upstream, in `d1_sync.py`'s delta path: it
pushes an episode only in the tick where a boost for it arrives and silently skips
it when enrichment hasn't yet written the local row, never revisiting it. **The
fix belongs in the collector; this is the graceful failure meanwhile.**

**⚠️ A WRONG episode field is a different problem from a MISSING page, and it is
not fixed here either.** Every surface prints `episodes.episode_number`, `title`,
`image` and `published` exactly as stored — no derivation, no fallback — because
the row is the truth and the collector owns keeping it true. It re-reads Podcast
Index on a `checked_at` gate: **daily for an episode that aired inside 90 days,
monthly for the rest** (`db.EPISODE_MAX_AGE`), so a publisher's correction lands
on its own. Two episodes of one show both rendering "Ep. 1" was that gate not
existing yet, not a render bug; `onlyboosts_globalscan.py re-enrich-episodes
--show <guid>` forces it early. **Don't add a client- or edge-side repair for a
field that looks stale** — it would mask the collector and then disagree with it.

**⚠️ `item_guid` IS NOT ALWAYS A UUID, and it is the URL key.** 9% of distinct
guids contain a slash and 30 are full http(s) URLs, so it is only ever
`encodeURIComponent`d and bound, never parsed or split. Pages keeps an encoded
`%2F` inside one path segment rather than routing on it, so `params.guid` arrives
encoded and `decodeURIComponent` recovers the original — verified against
production before the page was written.

**The player card.** One bordered surface holds the artwork, title, credit,
actions, audio element and two `<details>`; the stat tiles sit outside it, because
they are about the episode's *boosts*. The drawers **bleed to the card's edges**
rather than sitting inside its padding, which is what makes the card read as one
object with bands instead of a panel holding two panels — so the negative margins
have to track the card's padding in the base rule and the 640px block both.

**Show notes are server-rendered from D1 and then replaced; chapters cannot be
server-rendered at all.**

| | Show notes | Chapters |
|---|---|---|
| First paint | `episodes.description`, already on the row | — |
| Then | replaced from `/api/episode-meta`, untruncated, with paragraphs | filled from the same response |
| JavaScript off | reads, truncated | **absent** |
| Coverage | 99.5% of episodes | ~45% of items |

**⚠️ D1's copy is truncated, and the truncation is Podcast Index's.** PI cuts
every text field to 100 words unless the request carries `fulltext`, which
`enrich.py` does not send. `clean_html` then collapses all whitespace, so the
publisher's paragraph breaks are gone too. Both are why the drawer's text is
**replaced rather than decorated**.

`functions/api/episode-meta.js` is one PI call serving both fields. Four things
about it are load-bearing:

- **Every failure answers `200` with empty fields.** Both fields are additive, and
  a 500 would be a broken drawer on a page about boosts. The two halves are
  independent: notes ride every exit, including the ones where chapters failed.
- **`notes` absent ≠ `notes: []`.** An empty array means the episode has none and
  the client blanks the drawer; a missing field means the lookup told us nothing
  and the server-rendered set stands.
- **⚠️ Notes come back as a TOKEN TREE, not HTML** — paragraphs of `{t:"text",v}`
  and `{t:"link",href,v}` — and the client builds text nodes and anchors from
  them. Returning cleaned markup would be one `innerHTML` away from a third-party
  description writing into the page. Anchors are kept because a publisher writes
  "get the book here" with the URL only in the `href`.
- **Two cache lives.** A resolved answer holds six hours; a timeout or upstream
  error is not an answer at all and holds five minutes.

The chapters URL is publisher-controlled and reaches an outbound fetch, so it is
http(s) only, no embedded credentials, bounded length; untitled and `toc: false`
entries are dropped, being ad boundaries rather than chapters. The drawer ships
empty and hidden and is withheld outright when there is no enclosure to seek.

Clicking a chapter row seeks the player and starts it. The element is
`preload="none"`, so on a first click there is no duration yet and assigning
`currentTime` is dropped — `play()` triggers the load, so the assignment is
queued behind `loadedmetadata`.

### `/booster/<npub>`

The third detail page, and the newest. `functions/booster/[npub].js` +
`assets/js/booster-page.js`.

**⚠️ THE QUALIFYING RULE IS A BOOST, NOT A PROFILE.** Every other page here
qualifies on a title; this one cannot, because a booster with no kind-0 is a real
and interesting page rather than a degraded one. Measured across the 51 boosters
the collector could not resolve a kind-0 for on any of the five profile relays:
the median has one boost, eleven have five or more, and the heaviest has 374
boosts and 97,300 sats. The header falls back to the npub and everything below is
unaffected. **A pubkey with no boosts at all has nothing to render and 404s.**

**It accepts hex as well as bech32**, because `booster.npub` is nullable where
`booster.pk` is not, so a record with no npub links on its pubkey instead.

**⚠️ `booster-link.js` owns where a booster's name and face point, and its
qualifying rule is NOT the episode rule.** A booster page qualifies on *having
boosted*, and every booster rendered on any surface is there because they boosted
— so the link is unconditional, there is no fallback anywhere, and there is no set
of surfaces to enumerate the way `episode-link.js` has to. Its two arguments are
tried in turn, never collapsed by the caller into `npub || pk`: a malformed npub
would otherwise win over a perfectly good pubkey.

**⚠️ Who is deliberately NOT linked here: an npub MENTIONED inside a boost
message.** Those `.nostr-mention` chips keep pointing at njump.me, because a
mentioned npub need never have boosted anything — most have not, so
`/booster/<npub>` would 404 for the common case. njump resolves any npub, which
is what that chip needs and this page cannot promise.

**Not split on medium**, so the headings read "Shows and Albums" and "Episodes and
Songs" and there is no `COPY` table on this page at all. Splitting would file the
same person under two half-histories.

The `#episodes` rollup is the Episodes-feed card with `stats` off, since every
card aggregates one person's boosts and the booster count is 1 by construction.
`episode-section.js` attaches its controls and verbs, shared with the identical
section on `/episode`. The `#shows` drawer's range and sort need no fetch.

The header runs its **own** Primal backfill rather than `hydrateProfiles()`; see
the note in `booster-page.js`.

### The two shared server modules

Moved out of `functions/api/episode-meta.js` verbatim, since a show description
and an episode's show notes are the same field at two levels:

| | |
|---|---|
| `functions/_shared/podcast-index.js` | `piHeaders` + `piGet` — auth, the timeout, and the colo cache. **⚠️ `/api/value` keeps its own copy deliberately**: it resolves value blocks, where a wrong answer moves sats, and a metadata lookup must never share a code path with it. |
| `functions/_shared/rich-text.js` | `parseNotes` — publisher HTML → paragraphs of `{t:"text"\|"link"}` tokens. Client-side it becomes text nodes and anchors; server-side every field is escaped individually. Either way **nothing it returns can reach `innerHTML`**. |

`OPAQUE_TAG` discards the *content* of `script`, `style`, `noscript`, `iframe`,
`template` and `svg`. Nothing there could ever have become markup, but a feed that
pastes a tracking snippet into its description used to print the script's source
as a paragraph.

### Range And Sort On `#boosts`

The `#boosts` section on all three pages carries a range and a sort, built by
`assets/js/boost-section.js`. **The range means when the boost was SENT**,
matching `/#boosts-global` and `/api/v1/podcasts`. It does not mean when the
episode aired; that axis belongs to the Episodes feeds and to
`/api/v1/episodes`. Two readings of that parameter name exist on this site
deliberately and there must not be a third.

**`/show/<guid>#boosts` is the section that changed character.** It was the most
recent 24 boosts; with an order over the show's whole corpus it is the show's
**boost inbox**, which is how a podcaster reads boosts — across the catalogue
rather than one episode at a time. The heading is `copy.boostsHeading` (Show
Boosts / Album Boosts) for that reason: "Recent Boosts" stops being true the
moment a reader sorts by size. `/booster` reads "Boosts Sent" on the same
argument; `/episode` is unchanged.

| | `/show` | `/episode` | `/booster` |
|---|---|---|---|
| Server-rendered | newest 24 | **all of them** | newest 24 |
| Corpus | `GET /api/v1/podcasts/<guid>?corpus=1` | `GET /api/v1/episodes/<guid>?names=1` | `GET /api/v1/boosters/<npub>?corpus=1` |
| Cap / measured worst case | 2,000 / 1,404 | 500 / 55 | 2,000 / 975 |
| Sorts | latest boost · latest episode · largest boost | the same **minus latest episode** | all three |

`episode` is dropped on `/episode` because every row targets the same episode, so
the sort would be a no-op that looked like a ranking — the same call `/booster`'s
episode rollup makes in leaving "Most boosters" out of its menu. **No sort here
paints a rank numeral**: a row is one boost, so there is no aggregate to rank.

**Ranges are 1W/1M/1Y/All, one more than `/#boosts-global` offers.** That feed
omits 1Y because it *walks* month archives to cover a window; these sections hold
a bounded corpus in memory, so a year costs nothing.

Six things a change would break:

- **The corpus is fetched on the first control press or the first "Load more",
  never on approach.** The server's list answers the opening view, so a reader
  who reads the section and moves on pays nothing. `items === null` versus `[]`
  is load-bearing: null means not yet fetched.
- **⚠️ Every repaint re-attaches the verbs.** These rows carry a full
  reply / like / repost / zap bar, a ⋮ menu, and the Primal backfill. A rebuild
  that replaced the markup and stopped there produces a list of dead boost notes
  that looks correct. `boost-note-actions.js#wireBoostNotes(root)` is the scoped,
  idempotent half that exists for this; `data-actions-on` is what stops a second
  bar being appended.
- **⚠️ `names` comes from the server, not from Primal.** A boost message renders
  `nostr:npub1…` as an `@Name` chip off a D1 `profiles` lookup the edge runs. All
  three corpus responses now carry that map, so a rebuilt row's chips match the
  rows beside it. The Primal backfill is the second line of defence.
- **⚠️ `booster.dname` on the published record** is the same fix one field over:
  the pages print `display_name` in preference to `name` and the record carried
  only the latter. Additive; `name` is unchanged.
- **The row variant and the page size ride the state element**, declared by the
  Function, the same arrangement `card` has in `episode-cards.js`. `page` is 24
  on two pages and `BOOSTS_CAP` on `/episode`, whose sub-line promises every
  boost and whose re-sort therefore must not grow a "Load more".
- **The band is withheld below `CONTROLS_MIN` (3).** The median episode carries
  two boosts, and a range control over a two-item list can only empty it. It
  gates the band, never the list.

**The band is the shell's lid.** `.bs-shell` wraps the band, the list and the
"Load more" in one bordered box, and the load-more is *inside* it — the same call
`.ce-scroll` makes on the episode drawers, for the same reason: a toolbar
floating over a run of separate cards says nothing about what it acts on. The
shell's background is `--cream` rather than `--surface` because the rows inside
are white bordered cards, which a white shell would erase the edges of.

**The range and the sort sit together at the right end**, in a `.bs-knobs` group,
matching `.pcast-controls` on the feeds. `.cs-controls` pins a lone sort to the
far end with an auto margin — right in the drawers, whose band's left end holds a
link out to the show's catalogue, and wrong here; the auto margin moves to the
group and the search box takes the slack.

### Searching Boost Messages

The band's third control is a plain text filter over the corpus, not a typeahead.
`feed-search.js` suggests entries and filters to a **pick**, which is right where
the question is "where does my show stand" and the answer is one card. Here the
question is "what did people say", and the answer is however many messages say
it.

**⚠️ It matches the MESSAGE and nothing else.** Matching the show or episode
title beside it sounds friendlier and is not: on `/show` every row belongs to the
same show, so a query naming it returns everything, and anywhere a search for
"bitcoin" would surface every boost sent to a show with Bitcoin in its title
rather than every boost that *says* bitcoin.

**⚠️ It is a SUBSTRING match, not FTS5**, and `boost-list.js#searchBoostRows` is
the whole of it. `boosts_fts` exists and `/api/v1/search?type=boosts` already
reads it, but MATCH is token-based with a prefix wildcard — "rabbit" does not
find "rabbithole" — and it is a **global** index with no way to scope to one
show, episode or booster without new plumbing. The section already holds its
subject's whole corpus in memory the moment any control is touched. Terms are
ANDed, in any order.

**Only ~16% of indexed boosts carry a message**, so a row without one can never
match, and the empty state says as much rather than leaving a reader to conclude
the search is broken. `emptyMessage()` in `boost-section.js` is three strings for
that reason: no search, a search that missed, and a search on a subject where
nothing carries text at all.

Still out of scope on purpose: the Follows axis. A boost list about one subject
has no scope axis.

### The Show Filter, And Why The Rollup Is Its Picker

**`/booster/<npub>` only.** "What did this person say about *this show*" is a
different question from the per-episode one `#episodes` answers, and it is the
one a podcaster reading their own boosters has. `/show` and `/episode` never call
`setShow`, grow no chip and pay nothing — a boost list about one show cannot be
filtered by show, and a control that can only ever be a no-op is worse than none.

**The picker is the Shows and Albums rollup, not a dropdown**, and the data
decided it. Sampled over 30 active boosters on 2026-08-16 (drawn from the 200
most recent boosts, so skewed toward the people who would use this):

| distinct shows per booster | |
|---|---|
| median | 10 |
| mean | 27 |
| max | **188** |
| more than 20 | 8 of 30 |

A menu of 188 entries is not a dropdown, it is a list — and `#shows` already is
one, ranked by what the person actually gave, scrollable, carrying the artwork
and its own range and sort. The pick also happens where the question is asked,
beside "40.1k sats across 38 episodes". Each row's `.cs-boosts-btn` is the whole
affordance; it sits **outside** the row's anchor, because a button nested in a
link is neither.

**⚠️ The button names the booster, and a bare "Boosts →" is what it replaced.**
On a row whose subject is a SHOW that read as *the show's* boosts — every boost
anyone has ever sent it — where what it opens is one person's. The `<h1>` says
whose, and a reader twenty rows down cannot see it. `showFilterLabel` in
`functions/booster/[npub].js` owns the string:

- **"Boosts by X", not "X's Boosts."** The first is already the site's phrase for
  this — `title="Boosts by ${name}"` is on every boost row's author link and every
  community-wall card — and it has no possessive to get wrong on a name ending
  in s.
- **Capped at 16 characters.** Measured over 45 boosters on 2026-08-16: median
  name 11, mean 11, max 27, only 5 above the cap. The cap is about strangeness as
  much as width; the tail is `btconboard #LNHANCE or #CTV` and
  `ChadF and 33 others`, which are campaign text rather than names. The full
  string rides `title` and `aria-label`, where length costs nothing.
- **⚠️ Name-free when there is no kind-0.** 51 boosters have no profile on any
  relay tested, and for them the page's `label` is a truncated identifier —
  "dbd1ba83b0…ecbd Boosts" is worse than saying nothing about whose. Those rows
  read "Read these" and point at the figures beside them. The same call the rows
  above make in printing "Unidentified show" rather than a guid dressed as a
  title. **Pass `realName`, never the page's `label`.**
- **The label goes below 34rem and the arrow carries it.** The row already holds
  a rank, 44px of artwork, a title and three figures; ~150px of button on top of
  that leaves the show title nothing at 375px, and the title is the row's actual
  content. The breakpoint is set from the longest capped label rather than from a
  device — it was 26rem when the button said only "Boosts".

**The filter renders as a chip, not a fourth control.** A "Show: All shows ▾"
menu would be permanent chrome on a band that already carries three controls and
is two rows on a phone. The chip is absent until something is picked and gone the
moment it is cleared, so the default band is exactly the one the other two pages
carry. **Clearing is all it does** — changing the show means going back to the
rollup, which is the point of there being no menu.

Four things a change would break:

- **The filter is an equality on `podcast_guid`, never on the title.** 33% of
  shows in the index have none and titles are not unique in any case. A row with
  a null guid (~2% of records) therefore matches no picked show, which is right.
- **The picker is withheld below two shows and below `CONTROLS_MIN`.** One show
  is the whole history, so filtering to it is a no-op that looks like a control;
  and with no band there is no chip, so a filtered list would have no visible
  filter and no way to clear it.
- **The chip must not outlive a failed corpus fetch.** `onControlChange` gives up
  quietly when the corpus never arrives, leaving the server's rows on screen, so
  `setShow` reverts rather than leaving the page claiming a filter it did not
  apply.
- **`mountControls` is idempotent.** Pressing "Boosts →" four sections up can
  happen before `#boosts` has ever been approached, so the band has to be built
  on demand as well as on approach.

**The search box takes a full row of its own** (`flex-basis: 100%`), not a width
that wraps when it must. Four range segments, a sort pill, a chip and a search
box share no line at any phone width, and relying on the wrap put the break at
the mercy of how long the picked show's name happened to be — the band reflowed
as the reader used it.

### The community rollups

`#community-shows` on `/show` and `#community-episodes` on `/episode` are the
same object one level apart, and both are **the same `.ep-drawer`** as every
other drawer on the page.

- **Every figure is community-scoped by construction.** The query joins through
  the set of this show's or episode's boosters, so a row's boosts and sats are
  what *these* people sent, never global totals. The sort labels say so — "Most
  boosts here" — and the control band is tagged `Community Sort:` rather than
  `Sort:`.
- **The headline figure is the overlap, not the size**: "27 community boosters".
  It read "27 of 115 boosters" first and the fraction was a puzzle, because the
  denominator is on the page but not next to it.
- **`#community-shows` is all-time only, and that is a decision.** A range control
  shipped and came out: median community had boosted one other show in the last 7
  days and 47% had boosted none, so two of three ranges were empty on half the
  site. A time window is an episode-level question; which shows an audience
  overlaps with is a standing fact.
- **⚠️ On `/episode`, the whole of the subject's SHOW is excluded, not merely the
  subject episode.** The section answers "what *else* does this audience listen
  to". Measured over 900 pages it removes a median of 7.8% of the list and takes
  the share of pages with nothing to show from 3.3% to 6.1%. The clause is
  `(b.podcast_guid IS NULL OR b.podcast_guid <> ?)` — the `IS NULL` half **keeps**
  episodes whose own show is unidentified, because dropping them would be a claim
  we can't support.
- **The corpus is capped at 2,000 boost rows and says when it capped.** Fan-out
  runs to a median of 248 rows, p90 1,171, max 3,368, so 2,000 truncates 1.6% of
  episodes. Ordered newest-first, so a truncated corpus is a recent prefix rather
  than an arbitrary slice.
- **⚠️ "Load more" skips what is already on screen.** On the first press the cards
  in the DOM are the server's, ranked when the page was rendered and edge-cached
  for up to five minutes; the corpus just fetched is current. A boost landing in
  that window can shift the top thirty. It compares guids.
- **The cards sit in a scroll container** (`.ce-scroll`), capped at
  `min(75vh, 46rem)` with "Load N more" **inside** it, so the section is one box.
  A re-sort resets `scrollTop`. **The container clips the two ⋮ menus**, which are
  `position: absolute`; they still contribute to scroll height, and
  `episode-card-actions.js` calls `scrollIntoView({ block: 'nearest' })` on open.
- **Ranks are shown only on the quantitative sorts** (`RANKED_SORTS`), because a
  numeral under "Latest boost" reads as a score when it is chronology.

### The community wall

`renderSupporters` in **`assets/js/supporter-wall.js`** (it moved out of
`functions/_shared/detail-page.js` so the homepage's Members tab could render the
same wall; that file re-exports it). On `/show`, `/episode` and `/#members`.
Follows localbitcoiners'
`supporters.html`, which is its visual ancestor. The card has **no chrome** — no
border, no background, no panel — just a circular avatar, the name, and the sats
centered beneath. The avatars are the pattern, and a grid of bordered boxes
competed with them. `git show lb/main:supporters.html` is the reference.

**No rank numerals.** The wall is ordered by sats, so position already says
standing; a numeral on every face turned a community into a scoreboard. The podium
is marked by size and a brand ring instead.

**The podium wraps rather than counting**: five across on desktop, three on a
phone. `PODIUM` is a server-side constant and CSS cannot move a card into the grid
below, so the row is a centered flex-wrap and `.sup-card--podium` is an exact
fraction of it — `calc((100% - 4 * 1.3rem) / 5)`, and `/ 3` in the 640px block. A
pixel width would put the break at the mercy of viewport arithmetic. 21 boosters
show before the toggle (`SUPPORTERS_VISIBLE`).

### Sitemap

**The substantial episodes only.** 6,682 episodes qualify for a page against 934
shows, and the median one has one booster and two boosts. A page built on one
boost is worth existing and is thin to put in front of a crawler, so
`functions/sitemap.xml.js` lists the **2,027** with three or more distinct
boosters and leaves the rest to be found by link. Both halves carry canonical and
OG tags either way; those are about the share card, not about crawling.

The episode query is a `GROUP BY` over the whole boosts table where the show one
is a single indexed scan, so it has its **own** `try` — a failure there must not
cost the show entries that already succeeded.

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

**⚠️ The share card's TYPE follows its image, on all three detail pages.** A
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

Three measurements that shaped the rules, each of which would otherwise be a
plausible-looking mistake:

- **⚠️ `fountain.fm` and `feeds.fountain.fm` are different things.** The first is
  the app, linked from its own i-tags; the second is Fountain's RSS *hosting*,
  which appears in a boost from any app to a show hosted there — 24 of them, every
  one published by the bot. The host is matched **exactly**; a substring test reads
  Chad's PodcastGuru relays as Fountain.
- **A bare `via X` regex over message text is unusable.** It finds 110 matches
  outside the bot that are ordinary prose ("Ark is amazing.", "…exporting products
  via NIP-99!"), so `via` is only ever read from the bot's own emoji-anchored line.
- **The `nostr:nevent` in a Fountain note** quotes a zap receipt whose author hint
  is a constant Fountain pubkey — a real second identifier that adds **0** rows the
  i-tag rule doesn't already have, so the bech32 decoder it needs isn't carried.

`SLUG_ALIASES` is deliberately tiny. A slug is opaque and unique, so merging two
is a **claim** that two projects are one; `v4v-music`/`v4vmusic-com` and
`itdv-app`/`itdv-lightning` are each plausibly one thing and are **not** merged,
because that is a display decision made with knowledge the module doesn't have.

**Re-derivation, not a backfill.** `onlyboosts_globalscan.py reclassify-clients`
recomputes every row from `raw_json`, so a rule change is an edit plus a re-run;
new boosts are classified inline at ingest by `classify.py`. **⚠️ The boost delta
is `INSERT OR IGNORE`** and will not update a column on a row D1 already has, so
a re-derivation reaches the query layer only through
`d1_sync.py --remote-clients`, which emits UPDATEs. Nothing else re-pushes them.

**Still open: the UI.** Nothing renders attribution yet; `/stats` is where a
"boosts by app" breakdown belongs, and `/api/v1/clients` is what it reads.

### OnlyBoosts Publishes On Behalf Of Its Own Donors

Registered 2026-08-20. `3a87a19c…84d9` is the **fourth** entry in
`PUBLISHER_PUBKEYS` and the first that is not somebody else's bot: it is the key
behind `/api/sign-boost` (see "The Site Signs For A Booster Who Has No Key").

**It takes the SAME SLUG as the donor-signed path**, `onlyboosts`, because both
are boosts made on this site and splitting them into two clients would report one
product as two. `client_src` tells them apart for free, the pubkey being tested
before the tag: **`publisher-pubkey` for bot-signed, `client-tag` for
donor-signed**. Verified against a real signed event.

**⚠️ THE `via != slug` GUARD IS NOW LOAD-BEARING FOR OUR OWN NOTES, and it does
not look it.** The note template's attribution line reads `📱 via
onlyboosts.social`, which is exactly the shape `_VIA_RE` reads, and `slugify`
takes it to `onlyboosts` — the slug itself. That guard was written for somebody
else's bot naming itself; without it **every** bot note would nest OnlyBoosts
under OnlyBoosts on `/api/v1/clients`. Don't remove it as dead defensive code.

**⚠️ THE BOOSTER IS THE BOT, NOT THE DONOR.** These notes carry no claim about
who paid and must not gain one: nothing can verify a donor authorised a note
signed by a key they do not hold. The typed "From" name rides the boostagram TLV
and the note body, and nowhere the index credits. Same treatment the 994
`chadf-boostbot` rows and the LB show account get, and the same reasoning as the
`P`-tag rule below.

### Local Bitcoiners Publishes On Behalf Of Its Donors

Registered 2026-08-18. `c330881e…64592` is the Local Bitcoiners **show account**,
and it is the third entry in `PUBLISHER_PUBKEYS` alongside `chadf-boostbot` and
`lnaddress-music`. About a quarter of that show's boosts never produced a
donor-signed note at all — Castamatic, PodcastGuru and CurioCaster keysends,
anonymous website boosts, Fountain boosts from donors with no linked Nostr
identity — so the show account publishes one carrying the payment evidence, and
**only when no donor note exists**. Volume is small: 8 notes over 14 days.

Nothing in the scan changed. Those notes already match the `#k` filter and were
being fetched; what was missing was the evidence tags (`amount`, the `t` topic
tags) that make `classify_boost` keep one, and that is LB's half. The
originating app is named in the same `📱 via <App>` line `_VIA_RE` already
reads, so it lands in `client_via` and never in `client_id`.

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
- `Nostr Interactions:` on the Episodes/Songs boost drawer;
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
classes and `assets/js/supporter-set.js` all keep their names, the same seam as
Podcasts → Episodes below.

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
| `members-board.js` | the Members tab: the #40HPW boards, the wall and its three orderings, the Rules dialog |
| `feed-controls.js` / `feed-search.js` | the range/sort chrome and the per-feed typeahead |
| `feed-lang.js` | the language menu on the four ranked feeds, and the copy it rewrites |
| `boosts-thread.js` / `boost-actions.js` | the content tokenizer and reply / like / repost / zap |
| `functions/index.js` | the homepage's opening feed, rendered at the edge |
| `functions/{show,episode,booster}/…` | the three edge-rendered detail pages |
| `functions/api/v1/*` | the D1 query API |
| `functions/api/v1/members.js` | member search and the top-members listing, over all 2,011 |
| `functions/api/v1/members/hours.js` | the #40HPW boards |
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

1. **The two Stats pages.** `/stats` (Boost Stats) and `/boosters` (Community) are
   coming-soon placeholders and are the whole Stats column of the Explore menu, so
   both are visible and both promise something. **`/stats` has a rich ancestor
   upstream** and it's the thing to pull from rather than starting over:

   ```
   git show lb/main:stats.html            # 38KB, the charts + view switcher
   git show lb/main:assets/js/stats.js
   git show lb/main:assets/js/stats-boosts.js
   ```

   It was built against LB's own sats log, so the data layer is wrong for us, but
   the chart code, the broken-axis outlier handling and the view switcher are
   directly relevant. **`/boosters` is now much closer than it was**, since
   `/booster/<npub>` exists and `functions/api/v1/boosters/[npub].js` is the query
   it would page. **The path stayed `/boosters` when the label became Community**:
   the URL is in the wild and the rename was a label change. **⚠️ And the
   homepage's Members tab now answers most of what `/boosters` promised** — the
   member search, the top-members wall and the #40HPW boards all live there, so
   the open question is whether `/boosters` becomes a 301 to `/#members` rather
   than a page of its own.

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

5. **Dead LB code still in the tree.** `feeds.js` keeps `loadEvents` and the
   NIP-52 calendar machinery, unreachable since the Events tab went away
   (`LOADERS` doesn't map it). `boosts-thread.js` still has LB's `ROOT_NEVENT` and
   `EXCLUDED_NOTE_IDS`, and `fetchBoostThread` has no caller. `calendar-events.js`
   is only retained because `boosts-thread.js` imports it to render calendar-event
   quotes inside boost notes — that circular import is what makes the cleanup
   fiddly. All of it ships to every visitor.

   **⚠️ `EpisodeBoostModal.jsx` is dead too, and knowing that is worth real
   time.** `openEpisodeBoost` has no caller anywhere in `assets/js` or
   `functions` — it is LB's own-podcast boost flow. The live map is: **every
   podcast boost on this site goes through `openExternalBoost` →
   `ExternalBoostModal`**, from all six surfaces in the boost-button table
   above, **and the nav's Donate button now joins them through
   `openSiteDonation`**. `openShowBoost` → `BoostModal` → `MultiLegBoostForm`
   has no caller left on this fork at all. A change to "the boost modal"
   is one file, not three, and `MultiLegBoostForm`'s presign-then-publish design
   is deliberately untouched because nothing on this fork exercises it
   multi-leg.

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
