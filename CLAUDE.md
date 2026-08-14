# OnlyBoosts — Claude Code Notes

A Nostr client for podcast boosts. At heart it's an ordinary kind-1 client —
the difference is that it does **not** query relays for the feed. It reads a
pre-built JSON snapshot off the VPS (`relay.mynostr.app`), the same way
localbitcoiners' community feeds work.

**The whole feed experience is one page.** `index.html` carries the
hash-routed feeds, picked by two dropdowns on two axes — what (episodes /
shows / boosts) x whose (global / your follows). `about.html` is a real
content page — the project's own explanation of what the data is and isn't.
`stats.html` and `boosters.html` are coming-soon placeholders with no feature
behind them; they're nav + header + soon-card + footer and nothing else.
`shows.html` is the same, and is now unlinked — the Shows feed replaced it.

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
dropdown on the page, and listing both scopes would double the group into a
grid restating a control the page already has. The three `*-follows` feeds are
reachable from that dropdown, and by direct link.

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

## The medium split

`<podcast:medium>` is what separates a podcast from a music release: a `music`
feed's items are tracks on an album, not episodes of a show. The collector
projects it onto every row of `podcasts/index.json` (`4982533`), defaulting to
`podcast` per the namespace where a feed carries none. Live counts: **818
podcast, 465 music, 2 video**.

**Two renderers serve five what-options.** Episodes and Songs are one
episode-level rollup; Shows and Albums are one show-level rollup. Each pair
splits on the medium and differs *only* by a copy table at the top of its
module — the grouping, ranking, cards and drawers are identical code. Adding a
third medium is a third entry in those tables, not a third renderer.

**The split is a partition, not a narrowing.** `music` goes to Songs and
Albums; **everything else** goes to Episodes and Shows — podcasts, the two
video feeds, and every show the collector holds boosts for but Podcast Index
can't identify. So Albums is never a subset of Shows under a second name. A
show with no known medium counts as not-music: filing an unidentified feed
under Albums would be a claim about it we can't support. The Boosts feeds take
no medium at all and stay the unsplit firehose.

**The medium is a property of the SHOW, so it is not on the boost record.** The
alternative was the collector stamping one show-level fact onto 22k boosts and
rewriting every month archive.

**⚠️ The medium is a QUERY PARAMETER now, not a client-side join.**
`/api/v1/episodes` and `/api/v1/podcasts` take `medium=music` or
`not_medium=music` and answer already split, so the browser never has to reconcile
two datasets. This paragraph used to describe `ob-data.js#mediumPredicate`, which
joined guid → medium through `podcasts/index.json` in the browser and returned a
`{ test, ok }` pair so a failed join degraded Episodes rather than silently
emptying Songs. That function was **deleted on 2026-08-14 along with the rest of
the shard-reading half of `ob-data.js`**: the ranking move to D1 had taken its
last caller, and the three modules plus this file that still named it were all
doing so in COMMENTS. Its careful failure mode is worth knowing about if a
client-side join is ever needed again; `git log -S mediumPredicate` finds it.

The one cost this imposes is on the **show-level windowed ranges**, which used
to need no extra request. `All` is the opening range on both Shows and Albums
and reads that file anyway, so a visitor who reaches 1W has already loaded it.

Songs has the Global/Follows axis and Albums doesn't. That asymmetry is about
the data source, not the medium: `feeds-podcasts.js` never reads the
show-level rollup, so its follows path works unchanged, while
`podcasts/index.json` is computed over everyone and cannot serve a filtered
audience. See the scope note in `shows-feed.js`.

**The Episodes and Songs feeds rank server-side.** They used to build a corpus
from `latest.json` + 3 months and roll it up in the browser, which ranked over
whatever those shards held rather than over the index: measured against the full
corpus, **7 of the true all-time top 10 episodes were missing outright, only 20
of the true top 100 appeared, and the true #7 painted at #128** because only its
last-three-months sats were counted. Songs was worse — **84 of 601** music
episodes — because music is ~5% of a stream whose window was sized for the other
95%. `GET|POST /api/v1/episodes` aggregates over every boost, so **range and sort
are queries now and changing either refetches**. `boosts/music.json` exists as an
all-time music shard and is no longer needed for this rollup; it stays useful
where individual music boosts are wanted.

**The feed bar replaced a row of four tabs**, one per feed. Two dropdowns
instead of four buttons is what makes room for more `what` options (Shows, then
Songs and Albums) without the row growing a button per feed; it is now five
options over eight feeds. The Boosts hashes are
unchanged; the episodes feed's renamed from `#podcasts-*` and the old form is
permanently aliased — see the naming note.

Shows and Albums have no whose-axis **yet**, so their keys are the bare `shows`
and `albums` rather than `*-global`. Picking one leaves the scope *state*
alone, so going Boosts · Follows → Shows → Episodes returns you to Follows.

`SCOPELESS` in the controller is the set of types with no whose-axis (`shows`,
`albums`) — their key is the bare type, and picking one leaves the scope
*state* alone. Adding Shows · Follows means dropping it from that set,
renaming the key and keeping `#shows` as an alias.

**Follows only exists for a signed-in npub.** Signed out, the scope menu is
`hidden` outright (a one-option dropdown is worse than none — it's hidden on
Shows and Albums for the same reason), and a `#episodes-follows` deep link is coerced to
Global with the hash rewritten to match.

The inline feed-bar controller in `index.html` owns the menus, which panel is
on screen, and the hash, and dispatches `lb:feed-activate`;
`assets/js/feeds.js` listens and lazily hydrates. `feeds.html` and
`boosts.html` were folded into this page and deleted — their markup is the
ancestor of the Episodes and Boosts panels respectively.

**Each feed's range + sort controls mount into the bar's third slot**
(`[data-feed-controls]`), tagged `data-controls-for="<feed>"`. Which group is
visible is **CSS off `body[data-active-feed]`**, not JS: feeds hydrate once and
keep their controls forever, so an imperative swap is the version that can
leave a feed you come back to showing another feed's controls, or none. The
panels have no head of their own any more — the bar names the feed, so a
heading under it would only restate the dropdown.

**Each panel leads with two slots, both shipped empty and `hidden`**: a
`[data-feed-note]` line and, under it, the `[data-feed-search]` box. Both are
filled by the renderer and stay hidden until one does, so a feed showing "sign
in" or an error grows neither. They're inside the panel rather than in the bar,
so they scroll away with the cards they describe. See the search note under Feed
loaders.

**The note slot is on the four ranked feeds only** (`mountFeedNote` in
`feed-controls.js`, text off each renderer's `COPY` table). It names the corpus
the ranking was computed over: "Ranks based on every boost in the index" on
Global, "Ranks based on only boosts from the accounts you follow" on Follows.
Global vs Follows
is self-explanatory on the Boosts note feed, where a card is one note and the
axis is the one every Nostr client has; on a rollup a card is an **aggregate**,
so the scope is a claim about what was counted rather than about which cards
survived, and nothing on screen said so. Shows and Albums carry the Global form
and gain the second when Shows · Follows lands.

This is deliberately one line and no box. `.ob-scopenote` was the full scope
paragraph and it lived in exactly this position before being removed for pushing
the feed below the fold; don't grow this back into it.

## Where this code came from

This repo is a hard fork of **ReedBTC/localbitcoiners** (cloned at `lb-v43`,
history intact). Upstream is wired as the `lb` remote with pushes disabled:

```
git fetch lb
git log lb/main --oneline          # see what's new upstream
git cherry-pick <sha>              # pull a specific LB fix across
git show lb/main:path/to/file.js   # read a file that was stripped here
```

Anything deleted during the strip is still recoverable that way — reach for
`git show lb/main:...` before rewriting something from scratch.

Design and code are also expected to be pulled from:
- `~/Desktop/Files/nostr/mynostr` — the full React Nostr client
- `ChadFarrow/boostmebitch` (BMB) — Podcast Index proxy, wallet rails,
  signed-out boosts via a server-side identity, live-stream zaps

## Stack

Vanilla HTML + ES modules, no build step for the site itself. Cloudflare
Pages + Pages Functions. The one thing that *does* build is
`login-widget/` (Vite + React), which compiles to
`assets/widgets/login-widget.js`:

```
cd login-widget && npm install && npm run build
```

Local dev: `wrangler pages dev .` (so `/api/*` Functions resolve).

**Two scripts run before a commit that touches shared markup or assets, in this
order:**

```
node scripts/sync-partials.js     # nav + footer into every page
node scripts/stamp-assets.js      # ?v=<VERSION> onto every JS/CSS reference
node scripts/stamp-assets.js --check   # verify; non-zero exit if anything is stale
```

**Order matters.** `sync-partials` injects markup into the page files; anything
it injects has to be stamped afterwards.

### ⚠️ Asset Stamping Retired The "Never Add A Named Export" Rule

`scripts/stamp-assets.js` appends `?v=<VERSION>` to every `/assets/{js,css,widgets}/…`
reference, reading VERSION from `sw.js` so there is one source of truth. It
exists to close the failure that produced `ob-v53`.

**The failure:** Pages serves assets `public, max-age=14400, must-revalidate`
(verified against production), and **every module URL runs that four-hour clock
on its own**. A reader could hold a three-hour-old `feed-controls.js` against a
freshly-fetched renderer importing something the old copy did not export, and an
unresolved named import is a **link-time** error, so the renderer never executed
at all. All eight feeds went down together. Bumping `sw.js` never closed it: the
service worker's cache is only consulted for clients it already controls, and the
HTTP cache underneath is per-URL either way.

**The fix:** a URL now means exactly one version of one file. A deploy references
new URLs, so a stale copy is unreachable rather than merely undesirable, and every
asset on a page turns over together instead of on twenty independent timers.

**So the old prohibition is history.** Adding a named export to a module other
modules import is ordinary work now, as is any cross-module refactor. The notes
warning against it survive in `feed-controls.js`, `feed-note.js`, `show-desc.js`,
`booster-link.js` and `boost-note-actions.js` as the reason each of those exists;
they are accurate history, not live constraints. **One rule replaces the several
it displaced: bump `VERSION` in `sw.js` when you change any asset, then run the
script.** Consistency is then guaranteed by construction rather than by memory.

Two details worth knowing before editing the script:

- **It matches only quoted references** — `href="…"`, `src="…"`, `from '…'`,
  `import('…')`, and `sw.js`'s `PRECACHE_URLS` literals. An unanchored pattern
  also matches comment prose ("behavior in `/assets/js/nav.js`."), and the
  sentence's full stop then sits where the version suffix goes, so the next run
  parses it as part of the version and deletes it. That is a script that edits
  documentation a little more every time it runs. It happened on the first
  attempt and `--check` is what caught it.
- **It stamps two shapes.** The absolute `/assets/{js,css,widgets}/…` reference
  every page and module uses, and a **relative** `'./sibling.js?v=…'` import
  inside `assets/js`. The second exists for the modules imported from BOTH the
  browser and a Pages Function — an absolute specifier cannot be bundled by
  esbuild, a relative one resolves correctly on both sides, and an unstamped
  relative import would reopen the four-hour skew through the back door. See
  "The Exception Is Closed".
- **JS and CSS only.** Images and fonts are left alone deliberately: the failure
  being closed is two *code* files disagreeing, and a stale logo is not a broken
  page. `assets/widgets/` is stamped at the reference sites but its files are
  never rewritten, since they are build artifacts a rebuild would overwrite.

`sw.js` routes on `url.pathname`, so the query string does not disturb it, and
its VERSION-keyed cache names evict the previous run's entries as before.

## ⚠️ The Rendering Rule: The Server Renders The Facts, JavaScript Adds The Verbs

**This is the standard every page is held to. Adopted 2026-08-14.** It replaces
an unstated habit that had drifted into "some pages work without JavaScript and
some don't", which was never a decision anyone made and was quietly deciding
what could be built where.

| | |
|---|---|
| **Facts** | Anything that comes out of the database and is the same for every visitor: who boosted, how many sats, which show and episode, message text, artwork, rankings, air dates. **Server-rendered, always, on every page.** |
| **Verbs** | Anything needing a signer, a gesture, or knowledge of who is looking: reply, like, repost, zap, boost, copy, sort, filter, search, expand, seek. **Attached by JavaScript, always, on every page.** |

The consequence worth internalising: **a component never has to choose between
being server-rendered and being interactive.** A boost note is server-rendered
*and* carries a full reply/like/repost/zap bar, because the note is a fact and
the bar is a verb. Reaching for "this section has to be client-rendered so it can
be interactive" means the split has been drawn in the wrong place.

**What this is actually protecting**, because "works without JavaScript" overstates
it and was the phrase that caused the confusion:

- **Search.** ~930 show pages and 2,027 episode pages are in the sitemap.
  Googlebot runs JavaScript, but on a delayed second pass and not dependably per
  page. Server-rendered content is indexed on the first pass.
- **Resilience.** `ob-v53` blanked all eight feeds when one cached module didn't
  match another. The feeds went down; the show pages did not.
- **Speed.** Finished HTML paints once. A shell paints, fetches, then paints again.
- **Not** readers with JavaScript disabled. That is a rounding error and was never
  the reason.

### What Must Be Identical Across Pages, And What May Differ

**The test: if a reader could screenshot the same component from two pages and
tell them apart, that is a bug** unless the subject genuinely differs.

| Identical everywhere | Legitimately differs |
|---|---|
| A boost note: card, message, mentions, reaction bar, ⋮ menu | The **subject** (show / episode / person) |
| A rollup drawer: the box, the lid, the range and sort controls | **Which sections exist** (a podroll is show-level; chapters are episode-level) |
| An artwork fallback chain | **The words**, off a `COPY` table (Episode vs Track) |
| A booster's name and face, and where they link | **Which figures are meaningful** (a booster page has no booster count) |

### The Exception Is Closed

`feeds-podcasts.js#episodeCard` was the one component that existed only as
JavaScript, so the two sections built from it — `#community-episodes` on
`/episode` and `#episodes` on `/booster` — did not render without it, and the
homepage's opening feed was a shell. This section used to record that as a
tolerated exception with instructions to close it rather than add a second.
**It was closed on 2026-08-14, by the route named here: split the card along
the facts/verbs line.**

| | |
|---|---|
| `assets/js/episode-card.js` | the FACTS, as an HTML **string**: artwork and its fallback chain, title, show, air date, rank, the `Nostr Stats:` line, and every boost note inside the drawer. No DOM, no `fetch`, no `Intl` defaults. |
| `assets/js/episode-card-actions.js` | the VERBS: the ⋮ subscribe menu, the boost pill, the drawer's hide control, the per-boost ⋮ menu, and the reply / like / repost / zap bars. |

**Two parts of the card are per-surface, and only two.** `CARD_PARTS` in
`episode-card.js` is the whole table — `stats` (the `Nostr Stats:` line, off on
`/booster/<npub>`, where every card aggregates one person's boosts and the
booster count is 1 by construction) and `player` (the inline `<audio>`, off in
the two detail-page drawers, where every title links to a page that has one).
Both are cases the table above already sanctions as legitimately different.
**⚠️ The Function declares the variant and it travels in the state element**, so
a client repaint cannot render a different card than the edge did; setting it on
both sides would be two declarations that agree only until one is edited.

**⚠️ `functions/index.js` fetches `/` from `env.ASSETS`, never `/index.html`.**
Pages 308-redirects `/index.html` to `/`, `/` is that Function, and returning the
redirect made the front door answer `ERR_TOO_MANY_REDIRECTS`. It shipped that way
once. A 3xx from the asset server is now never propagated.

**⚠️ ONE MODULE, IMPORTED FROM BOTH SIDES, and that is the mechanism the whole
thing rests on.** A Pages Function imports `../../assets/js/episode-card.js` by
relative path and esbuild inlines it off the filesystem; the browser imports
`/assets/js/episode-card.js?v=<VERSION>` and gets the same file. So a card
rendered at the edge and the same card rebuilt in the browser after a re-sort are
byte-identical **by construction** rather than by inspection. The note in
`functions/_shared/detail-page.js` that "a Pages Function cannot import a client
module" was true of the modules it was written about and is false in general;
what a two-sided module cannot use is an **absolute** `/assets/js/…` import,
which the browser resolves and esbuild cannot.

Two rules follow, and both are enforced by `scripts/stamp-assets.js`:

- **A two-sided module imports its siblings as `'./thing.js?v=<VERSION>'`.** The
  browser resolves that against the importing module's own stamped URL and
  arrives at exactly the absolute form; esbuild strips the query and reads the
  file. The script stamps both shapes.
- **Everything a two-sided module imports must itself be two-sided.**
  `show-link.js`, `episode-link.js`, `booster-link.js`, `cover-art.js` and
  `nostr-text.js` are all dependency-free, which is what made this cheap.

The four surfaces, all now one definition:

| Surface | Rendered by |
|---|---|
| Homepage Episodes / Songs | `functions/index.js` for the opening page, `feeds-podcasts.js` after |
| `/episode/<guid>` `#community-episodes` | `functions/episode/[guid].js` |
| `/booster/<npub>` `#episodes` | `functions/booster/[npub].js` |
| every re-sort, range change and search pick | `feeds-podcasts.js` / `episode-section.js` |

**The homepage's front door is server-rendered too.** `functions/index.js`
fetches `index.html` through `env.ASSETS` and splices thirty ranked cards into
one marked slot (`<!--OB:SSR-EPISODES-->`); `feeds-podcasts.js` finds them and
**adopts** them rather than fetching the same rows again. It is a **fast path,
not a dependency** — a failed asset fetch, a D1 error or a missing marker all
serve the file untouched and the feed hydrates the way it did before.

Three things that fell out of the split and are worth knowing:

- **The drawer is a `<details>`**, not a button beside a hidden div. The boost
  notes inside it are facts and are in the document, so a control only
  JavaScript could open would leave them unreachable. It is also the idiom
  `.ep-drawer` already uses on `/show` and `/episode`. `feed-cards.css` carries
  the two-rule delta; `.pcast-card.is-open` has no emitter any more.
- **Dates are `en-US` in UTC on the feeds now**, not the reader's locale, because
  the edge and the browser have to produce the same string. That is what
  `functions/_shared/detail-page.js` has always done, so the site has one date
  format rather than two.
- **Boost messages tokenize through `nostr-text.js`**, extracted from
  `functions/_shared/detail-page.js` (which re-exports it, so no caller changed).
  The homepage's cards used `boosts-thread.js#parseSegments`, which needs
  nostr-tools and a DOM; a `nostr:note1…` inside a message is now the same njump
  chip on all four surfaces rather than a quoted-note chip on one.

**⚠️ It did NOT make the homepage's module graph smaller** — measured 20 modules
at 124.5KB gzipped before, 23 at 136.8KB after. `follow-set.js` and `feeds.js`
import nostr-tools and `boosts-thread.js` directly, so both arrive regardless.
The win is one card definition and a crawlable front door.

### The Cost, Stated

More server rendering is more D1 reads and more edge CPU per request. A detail
page already runs six or seven queries plus a Podcast Index fetch in one
`Promise.all`. The 300s edge cache absorbs most of it and current traffic is
nowhere near a limit, but the failure mode to watch for is a slow TTFB rather
than a blank page — which is the better failure of the two, and is part of why
this trade is the right one.

**Measured when the episode card closed the exception**, against production:

| | |
|---|---|
| Homepage first view | **206.6KB → 217.7KB brotli, +11.1KB**, and one round trip instead of two. The 431KB JSON fetch it used to make is gone; the document went 14.5KB → 150.6KB br. Gated on an absolute 256KB budget rather than a percentage — see the note in `test-server-render.mjs` for why. |
| Homepage raw markup | **54KB → 1.15MB**, which is the cost that does not compress away: ~5,000 extra DOM nodes for 737 boost rows, all inside closed `<details>` so nothing lays them out until a drawer opens. |
| `/episode/<guid>` | one extra query in the existing `Promise.all` — the community corpus, median 248 rows, capped at 2,000. Measured at ~190ms for a heavy episode (834 rows) against a page TTFB of ~170ms, so the page pays `max()` rather than `sum()`. |
| `/booster/<npub>` | the same, and cheaper: one indexed scan, heaviest booster 975 rows against the same cap. |

**Both detail-page queries are allowed to fail quietly**, the same discipline the
two podroll queries on `/show` have: a rollup below the fold must never cost a
reader the page they came for. And **neither client module fetches the corpus any
more until the reader touches a control or presses "Load more"** — the server's
ranking answers the opening view, so a reader who reads the section and moves on
pays nothing for it, where the old version fetched it on approach every time.

`scripts/test-episode-card.mjs` asserts on the card's HTML against fixtures;
`scripts/test-server-render.mjs` asserts on the assembled homepage against a
captured production response, including the size table above.

## Conventions carried over from LB — keep these

- **CSP meta tag on every page.** All pages share one policy so tightening
  happens in lockstep.
- **Shared nav/footer are generated.** Edit `partials/nav.html` /
  `partials/footer.html`, then run `node scripts/sync-partials.js`. Never
  edit the copies inside page files — they're between `NAV:START`/`NAV:END`
  markers and get overwritten. A new page only needs the empty marker pair;
  the script fills it and adds the css/js tags.
- **The nav's lazy-widget bootstrap is `assets/js/nav-widget-boot.js`**, not
  inline — it wires the Donate button and the identity slot to the 1MB
  login-widget bundle and every page loads it as a plain (non-defer) script
  at the end of `<body>`.
- **Link pages without the `.html`.** Cloudflare Pages serves `/about` and
  308-redirects `/about.html` to it, so an in-site link with the extension
  costs a redirect hop.
- **⚠️ `404.html` is what makes a missing path answer 404.** Without it in the
  repo root, Cloudflare Pages answers **every** unmatched path with `200` and
  the full homepage. Measured before it existed: `/this/does/not/exist`,
  `/assets/js/nope.js` and `/assets/css/nope.css` all returned `200
  text/html` and 56KB of `index.html`. Three consequences, and the third is the
  one that costs an afternoon: a dead link silently showed the homepage instead
  of saying anything; a crawler was told every dead URL was a real page
  duplicating `/`; and **a file that failed to deploy reported a MIME error
  rather than a 404**, since the browser fetched HTML where a module was
  expected and (correctly, under `nosniff`) refused it with "Expected a
  JavaScript-or-Wasm module script but the server responded with a MIME type of
  text/html". Nothing in that message says the file is missing. Pages picks the
  file up automatically; it needs no config, and it is deliberately out of
  `functions/sitemap.xml.js` and `noindex`.

  It carries **no canonical and no Open Graph tags**, which is the one place the
  page conventions above are deliberately broken: this file is served under
  whatever URL was missed, so there is no single address for either to name.
  `follow` is kept so a crawler landing here still traverses the nav back into
  the site map.

  `/show/<guid>` and `/episode/<guid>` answer their own misses and are
  unaffected. The static page matches their look on purpose (`page-eyebrow`
  carrying the status, an `h1` naming what was not found, a `.soon-card`
  explaining and pointing out), so the site has one 404 rather than two.
- **Pages Functions bound every upstream fetch**: wall-clock timeout, byte
  cap, *and* a streamed read (`resp.text()` buffers before you can check
  size). See `functions/api/data/[[path]].js` for the reference shape.
- **CORS origin allowlists are exact-match `Set` lookups**, never
  `startsWith` — a prefix check lets a lookalike origin get reflected into
  `Access-Control-Allow-Origin`.
- **`isSafeUrl()` before any user-supplied URL** reaches `href`/`src`.
- **Bump `VERSION` in `sw.js`** when shipping changed assets that returning
  visitors must get on the *first* navigation rather than the second.
- **⚠️ Never add a named export to an existing module that existing modules
  import.** Assets ship `max-age=14400`, so the browser holds each module URL
  for up to four hours **on its own clock**; the provider and its consumers
  therefore never turn over together. A reader with a stale provider and a fresh
  consumer gets `does not provide an export named 'X'`, and an unresolved named
  import is a **link-time** error, so the consumer never executes and everything
  in it fails rather than the one feature that was added. **A `VERSION` bump does
  not close this** — the service worker's cache is only consulted for clients it
  already controls, and the HTTP cache underneath is per-URL either way. This is
  how `ob-v53` took all eight feeds down: three renderers importing
  `mountFeedNote` from `feed-controls.js`.

  Two shapes are safe, and `feed-controls.js` carries the worked example of
  each. **Put new behaviour in a new module** — a URL with no cached old version
  can only resolve or 404, which is what `assets/js/feed-note.js` is. Or **derive
  it from something the module already exports**, which degrades instead of
  throwing: `WALKED_RANGES` in `boosts-feed.js` filters `RANGE_OPTIONS`, so an
  older copy lacking the `1y` row yields a missing button rather than a dead
  feed. Adding an **optional property to an options object** is safe in both
  directions for the same reason.

## Theming

The shared stylesheets (`nav.css`, `footer.css`, `boosts-thread.css`,
`boost-actions.css`) read their colors as CSS custom properties off `:root`
and don't define them — every page has to supply the tokens. That supply is
`assets/css/theme.css`: the palette, the `@font-face` rules, and the base
`body`/`a`/`img` styles. **Link it from every page, last among the shared
stylesheets** so a page's own inline `<style>` still wins.

`index.html` keeps one theme block of its own — the eight per-feed accents and
the `body[data-active-feed]` mapping — because those only mean anything on
the page that has the feeds. `assets/css/page.css` is the counterpart for the
plain content pages (`.page-header`, `.soon-card`).

`assets/css/feed-cards.css` holds the **episode card and everything that hangs
off it** — the range/sort controls, the card, the boost drawer, the inline boost
thread, the copy toast, `.ob-stats-label` and `.feed-placeholder`. It was inline
in `index.html` until `/episode/<guid>` needed the same cards. Every rule in it
reads `--accent` / `--accent-d` / `--tint`, which `index.html` supplies per feed
off `body[data-active-feed]` and `show-page.css` supplies on `.show-main`, so a
page that links it has to supply them too. The Shows and Boosts feeds' own card
variants build on `.pcast-card` but exist only on the homepage, and stay inline
there.

Those stylesheets were written against localbitcoiners' token names
(`--cream`, `--navy`, `--orange`, `--green-d` …). Rather than rename ~300
usages across five files, the old names are kept as **aliases repointed at
the OnlyBoosts palette**. Trust the values, not the words — `--orange` is
brand cyan. New code should prefer `--brand` / `--ink` / `--surface`.

Brand colors are sampled from the supplied art: `--brand: #00aff0` (the
mark's cyan) and `--brand-d: #068ace` (its broadcast waves). The eight feed
accents sit on one cyan→indigo→violet ramp, so switching feed shifts the page
wash along a single system rather than to an unrelated color. The violet tail
is the music half of the medium split — Songs and Albums are the same two
rollups as Episodes and Shows, so the color family is what says which side
you're on rather than the position in the menu. Since the tab row
went away, that accent is read by the panel wash, the menus and the range /
sort controls; `--accent` / `--accent-d` / `--tint` are the only names the
shared chrome sees.

## Site identity

| | |
|---|---|
| Domain | `onlyboosts.social` |
| npub | `npub1nmd7u4f5ewsjn6wp4zd9pc4jnadtmluanfhm2g0xryrdga7e7xxq0as4ck` |
| pubkey (hex) | `9edbee5534cba129e9c1a89a50e2b29f5abdff9d9a6fb521e61906d477d9f18c` |
| Lightning | `onlyboosts@getalby.com` |

The domain appears in `robots.txt`, `manifest.webmanifest`,
`functions/sitemap.xml.js`, the CORS allowlist in
`functions/api/data/[[path]].js`, page canonical/OG tags, and the
`client` tags on published events — change them together. The npub is also
served for NIP-05 from `.well-known/nostr.json`.

## ⚠️ Money paths

Two separate things are both called "boost":

- **Boosting a podcast** — sats go to that show's own value split, parsed
  from its RSS feed. `externalBoost.js` / `externalBoostagram.js` /
  `payAllLegs.js`. This is the main event and it pays third parties.
- **Boosting the site** — a tip to OnlyBoosts, one leg at 100% to
  `RECIPIENT_LUD16`. `boostagram.js` + `BoostModal.jsx`, behind the nav's
  Boost button.

All LB payment and identity values were replaced on fork and the shipped
`assets/widgets/login-widget.js` was rebuilt — verified zero occurrences of
LB's address, npub, feed GUID, or host addresses. **`login-widget/` is a
build artifact: editing `login-widget/src/` changes nothing until you run
`npm run build`.** Verify after any change to a money path:

```sh
grep -c "onlyboosts@getalby.com" assets/widgets/login-widget.js   # expect >= 1
```

`LNADDRESS_OVERRIDES` in `recipientOverrides.js` is deliberately empty. An
entry there silently reroutes sats away from the address a show's RSS names,
without telling donor or recipient. That was defensible on LB (Reed's own
feed); here it would divert money from third-party shows. Only add one for a
feed OnlyBoosts owns.

**It has a twin: `EXTERNAL_OVERRIDES` in `assets/js/value-block.js`, and both
must stay empty.** They are two separate maps on two sides of the fork's strip,
which is how the LB entry survived: `recipientOverrides.js` was emptied, then
`8bc4cf9` restored `value-block.js` wholesale with
`boostbot@fountain.fm → aquafox30@primal.net` still in it, labelled "Local
Bitcoiners". It shipped, and rewrote Fountain's 2% leg on a live external boost
before being caught on 2026-07-27. **No leg of a third party's value block is
ever rewritten, renamed, merged or dropped** — `applyExternalOverrides` is now a
documented passthrough, and the external boost pays exactly what the show
published. If OnlyBoosts ever takes a cut it gets its own leg under its own
name. Grep both maps after any restore from `lb/main`.

`FEED_GUID` in `boostagram.js` is deliberately `null` — OnlyBoosts is a
client, not a podcast, so it has no feed to claim. Inheriting LB's GUID
would have mis-tagged every share note as a Local Bitcoiners boost and
polluted LB's own collector, which filters on exactly that GUID.

Code edits, dry runs, and read-only inspection are fine without asking.
**Confirm with Reed before running anything that signs or publishes a Nostr
event, or that moves sats.** Published events can't be unpublished. **New
bots start with `DRY_RUN = True`.**

## Bot conventions

Carried from the scaffold commit and the LB suite:

- One bot per subdirectory, script named `onlyboosts_{function}.py`.
- Shared utilities live in `bots/shared/` — import from there, never
  copy/paste relay lists or publish helpers into individual bots.
- State files (`state.json`, `last_seen.txt`, `published_events.json`) sit
  next to each bot and are gitignored.
- Prefer a clean copy of an LB `shared/` utility over importing across
  repos — the two projects push to different remotes and must stay
  independently cloneable.
- Relay note that carries over: Fountain boosts are heavily
  `wss://relay.fountain.fm`-only (~90%), which is why it's in the
  `NOSTR_RELAYS` list in `bots/shared/nostr_utils.py` despite not being a
  general-purpose relay. Don't prune it. See the relay section below.

## Relay sets

**A relay list is defined by the kind it carries and the audience it reaches,
not by which relays are popular.** Every set in this repo was re-derived from
that rule on 2026-08-12, measured against the 61 distinct boosters behind the
100 most recent boosts. **Re-measure before changing one**; the numbers below
are the whole argument, and reputation is a bad proxy for them.

**⚠️ Reading and publishing are different jobs and take different sets.** A
read set answers "who HAS this event", which is measurable, and a useless
member costs latency on every query. A publish set answers "who will SEE this
event", which cannot be measured from outside, and an extra member costs one
socket on an infrequent action while omitting one costs reach nobody can
observe. **So the read sets are cut to what the measurement supports and the
publish sets are deliberately generous, and a low score is not an argument
against a publish target.** One list doing both jobs is the smell that produced
the 2026-08-12 split; `FALLBACK_RELAYS` was it.

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

The sets, and the one job each has:

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

Five findings that outlive the numbers:

- **⚠️ `relay.damus.io` is gone and must not come back.** It answers a
  WebSocket connect with **HTTP 503**. It was first in every browser-side list.
- **⚠️ `relay.getalby.com` is NWC transport, not a relay.** Both it and
  `/v1` answer *every* REQ with `blocked: Request rejected`, so a note
  published there can never be read. It was in `NOSTR_RELAYS`. NWC is
  unaffected either way: the wallet's relay comes from the connection string.
- **A relay has to accept the kind.** `purplepag.es` stores only 0/3/10002 and
  was in `BOOSTAGRAM_RELAYS`, where a kind-30078 publish to it could never be
  stored; `relay.fountain.fm` refuses 30078 with `kinds not supported`.
- **Aggregators are not automatically worth a slot.** `purplepag.es` scored
  respectably alone and added **zero** marginal coverage once ditto and nos.lol
  were present. Same for `relay.primal.net`, which was in five sets. That is
  the *relay*; `cache1.primal.net` behind `primal-profiles.js` is a different
  service and is the reason profiles still resolve.
- **⚠️ NDK dials relays this repo never names.** It builds a second, outbox
  pool from its own `DEFAULT_OUTBOX_RELAYS` (`purplepag.es`, `nos.lol`) unless
  `outboxRelayUrls` is passed. Removing a relay from every list here does not
  stop the browser connecting to it; `ndk.js` now passes the option explicitly.
- **⚠️ Publishing to Primal's RELAY is not how Primal users see a note.**
  Measured on a real boost note: absent from `relay.primal.net`, which held
  **0** of that author's kind-1s on a limit-200 query, and simultaneously
  **present in `cache1.primal.net`**, which is what the Primal client reads.
  The cache ingests from the network at large, so a note published to any
  well-connected relay reaches Primal users. `relay.primal.net` is in
  `PUBLISH_RELAYS` on the read/publish asymmetry above, not on evidence.

### `NC_RELAYS` Is a Third Job, and the Signer Pays for a Bad Member

**⚠️ The `nostrconnect://` relay list is OURS, not the user's signer's.** NIP-46
requires the signer to answer on the relays named in the URI, so the relays
configured in someone's Amber do not govern that handshake; they govern the
`bunker://` path, where the pasted string carries the signer's own list. The
two directions are opposite and the same five relays serve only one of them.

That makes this neither a read set nor a publish set. A member has to be
reachable **by both sides** and has to carry kind 24133, which is ephemeral, so
nothing is stored and a reply arriving while nobody is subscribed is gone for
good. The set was re-derived on 2026-08-12 by publishing a throwaway 24133 to
each relay and watching a second socket on the same relay for delivery:

| Relay | Publish | Relayed |
|---|---|---|
| `relay.primal.net` | `OK: true` | yes |
| `relay.ditto.pub` | `OK: true` | yes |
| `nos.lol` | `OK: true` | yes |
| `relay.mostr.pub` | `OK: true` | yes (tested spare, not shipped) |
| `relay.nsec.app` | HTTP 502, socket closes 1006 in ~540ms | — |
| `relay.nostr.band` | TCP connect never completes; ~10s, then 1006 | — |

- **⚠️ An OK is not proof of transport.** `relay.fountain.fm` answers `OK: true`
  to the publish and then CLOSEs the subscription with `kinds not supported`, so
  the event is accepted and never delivered. **Test the read side too.**
- **⚠️ A hang costs more than a refusal, and the SIGNER pays it.** A 502 is half
  a second; a connect that never completes costs the dialer's whole timeout, and
  the dialer here is the signer app, off where this site cannot see or report
  it. That is what a login "taking forever and then working" looks like, and
  `relay.nostr.band` was doing it from inside a list nobody had measured.
- **The 2026-08-12 sweep did not cover this set.** It measured kinds 0, 1, 3 and
  10002; `NC_RELAYS` carries 24133 and got only the mechanical
  `damus.io` → `ditto.pub` substitution, which is why two relays that were
  already dead survived it. **A relay list is defined by the kind it carries**,
  and that rule applies to this one too.

The URI also names `perms` (`get_public_key`, `sign_event`). Amber prompts once
per ungranted scope and the second prompt lands after the user has tabbed back
to the browser, which is where a connect appears to hang; naming both up front
lets one screen approve them. A signer that ignores the parameter is left
exactly where it was.

**⚠️ `publishRelaySet()` in `ndk.js` unions `PUBLISH_RELAYS` with NDK's pool,
and the union is load-bearing.** `ensureUserWriteRelays` seeds that pool with
the signed-in user's NIP-65 write relays, so passing a relay set built from
`PUBLISH_RELAYS` alone would replace the pool and silently stop publishing to
the user's own relays — the note still publishes, to the wrong audience, and no
error is raised. Both kind-1 publish paths in `boostagram.js` go through it, so
one note cannot reach two different audiences depending on which built it.

Floors worth knowing before chasing coverage: **11% of boosters have no kind 0
on any relay tested, and 36% have no kind 10002.** No list closes that.

Untested, and the one thing to confirm: **write policy.** Every relay above
reports open writes in NIP-11, but strfry usually leaves `restricted_writes`
unset, so a publish target is unproven until an event actually lands.

## What's built vs. what isn't

**Working, ported from LB:**
- `assets/js/boosts-feed.js` / `feeds-podcasts.js` — the boost feeds and the
  episode-level rollup behind both Episodes and Songs (see the naming note)
- `assets/js/episode-card.js` + `episode-card-actions.js` — **the** episode
  card, facts and verbs, shared by the edge and the browser
- `assets/js/episode-section.js` — the card drawer on `/episode` and `/booster`
- `functions/index.js` — the homepage's opening feed, rendered at the edge
- `assets/js/shows-feed.js` — the show-level rollup behind Shows and Albums
  (written here, not ported)
- `assets/js/feed-controls.js` — the range/sort chrome they all share
- `assets/js/feed-search.js` — the per-feed typeahead at the head of each panel
- `assets/js/boosts-thread.js` — the content tokenizer (nostr: mentions,
  URLs, quoted notes) the boost cards render through
- `assets/js/boost-actions.js` — reply / like / repost / zap
- `login-widget/` — NIP-07/46/nsec login, NWC + WebLN wallets, boost modals,
  multi-leg value-split payments, bug-report modal
- `functions/show/[guid].js` + `functions/episode/[guid].js` — the two
  edge-rendered detail pages, sharing `functions/_shared/detail-page.js` on the
  server and `assets/js/detail-page.js` on the client
- `assets/js/show-page.js` / `episode-page.js` — what each one adds on top
- `partials/` + `scripts/sync-partials.js` — shared nav/footer. **Its
  `EDGE_PAGES` list is what keeps the two Functions' nav and footer in sync**;
  a new edge-rendered page needs an entry there and an empty marker pair.
- `functions/api/data/[[path]].js` + `assets/js/ob-data.js` — the data feed
- `bots/bug-watcher/` — polls the bug relay, opens GitHub issues
- `bots/global-boost-scan/` — the network-wide collector: NIP-73
  `podcast:item:guid` detection, zap-receipt unwrapping for Fountain-style
  notes with no `amount` tag, Podcast Index enrichment, and the static-JSON
  export the site reads. `DATA-API.md` there is the schema contract.

**Still to build:**

0. **The two Stats pages.** `/stats` (Boost Stats) and `/boosters` (Community)
   are coming-soon placeholders — `noindex`, out of `functions/sitemap.xml.js`,
   nav + header + soon-card and nothing else. They're the whole Stats column
   of the Explore menu, so both are visible to a visitor and both promise
   something. **The path stayed `/boosters` when the label became Community**:
   the URL is in the wild and the rename was a label change, so renaming the
   file would have bought a redirect hop and nothing else.

   **`/stats` has a rich ancestor upstream.** LB shipped a full stats page and
   it's the thing to pull from rather than starting over:

   ```
   git show lb/main:stats.html            # 38KB, the charts + view switcher
   git show lb/main:assets/js/stats.js
   git show lb/main:assets/js/stats-boosts.js
   ```

   It was built against LB's own sats log, so the data layer is wrong for us —
   but the chart code, the broken-axis outlier handling and the view switcher
   are all directly relevant, and `/api/data/*` now carries far more to plot
   (22k boosts, 45M sats, 1,384 shows, month archives back to 2024-10).

   **`shows.html` is a leftover.** The Shows *feed* (`#shows`) is built and the
   nav and footer point at it, so nothing links to the page any more. Decide
   whether to redirect it to `/#shows` and delete the file, or keep a page — and
   note `_redirects` already carries `/podcasts → /shows`, so that hop would
   chain.

   **Shows · Follows** is the other unbuilt half: the scope menu is hidden on
   Shows because `podcasts/index.json` is computed over everyone. See the
   scope note at the top of `shows-feed.js` for what building it takes.

   `/about` is done. Its copy is distilled from
   `docs/about-and-faq-source.md`, written by the collector-side agent —
   **that file is the factual source of record**, so correct it there first
   if the pipeline's behaviour changes.

   Its **live stat strip** (`.stat-strip`, five cards) was removed in
   `7f35bf4` on the reasoning that `/boosters` and `/shows` were where the
   numbers belonged, then restored — those two are still placeholders, and
   the about page is where a reader asking "how big is this index" actually
   is. It no longer floats above the table of contents; it sits inside an
   **Indexer Stats** section of its own, second in the page order, so the
   copy qualifying the figures is next to them rather than absent.

   Four pieces that live or die together: the section markup in
   `about.html`, its TOC entry, the `.stat-*` rules in `page.css`
   (including a `.prose .stat-strip` re-space and a 640px `.stat-num`
   step-down), and the inline `/api/data/meta.json` fetch at the foot of
   the page. It is **best-effort by design**: the strip ships `hidden` and
   reveals itself only if the whole fetch-and-parse succeeds *and*
   `m.boosts` is truthy, so a broken endpoint costs a row of numbers rather
   than rendering a shell of em-dashes or zeroes. Verified against all five
   failure modes (HTTP error, network error, non-JSON body, empty manifest,
   zero boosts). `auto-fit` columns mean a sixth figure needs no media
   query, but **`distinct_eps` is not the candidate to add** — it counts
   episodes carrying at least one indexed boost, not episodes, and reads as a
   claim about catalogues we don't have. Every per-show episode count was
   removed from the UI for that reason; see the "No Episode Counts, Anywhere"
   section of `docs/show-pages-spec.md`.

1. ~~**Podcast Index credentials.**~~ **Done.** `PODCAST_INDEX_KEY` and
   `PODCAST_INDEX_SECRET` are set as secrets in both the production and preview
   Cloudflare environments; verified 2026-07-26 against production, where
   `/api/value?podcastGuid=…` returns live feed-level splits. Without them
   `/api/value` returns a clean 503 and no boost button can resolve a show's
   splits, so locally you still need them in `.dev.vars` (gitignored).

2. **Bug relay write-policy.** `BUG_TAG` is `onlyboosts-alpha` in both
   `login-widget/src/lib/bugReport.js` and `bots/bug-watcher/watcher.js`, but
   `relay.mynostr.app`'s strfry write-policy plugin still has to whitelist
   that literal string. **VPS-side — reports are silently rejected until
   it's made.**

3. **Dead LB code still in the tree.** `feeds.js` keeps `loadEvents` and the
   NIP-52 calendar machinery, unreachable since the Events tab went away
   (`LOADERS` doesn't map it). `boosts-thread.js` still has LB's
   `ROOT_NEVENT` and `EXCLUDED_NOTE_IDS`, and `fetchBoostThread` now has no
   caller. `calendar-events.js` is only retained because `boosts-thread.js`
   imports it to render calendar-event quotes inside boost notes — that
   circular import is what makes the cleanup fiddly.

4. **Typography.** The brand wordmark is a bold sans; the site is still on
   LB's Playfair Display / Source Serif 4. It reads fine, but the serif is
   inherited, not chosen. Only those two families are self-hosted in
   `assets/fonts/`.

## The exclusion list

`excludes.json`, at the repo root. Anything named in it is filtered out of every
published surface — the JSON shards, the D1 projection behind `/api/v1`, the
show and episode pages, search, the podroll graph, and the counts on `/about`.
It ships **empty**; it exists so a takedown request, or a feed like the LNURL
test feed that was never meant to be indexed, is answered by one edit.

**It is at the repo root, and it is public, both on purpose.** The repo is
public and the file is the answer to "what are you hiding, and why" — so every
entry carries a required `reason`, and `pages_build_output_dir = "."` means it
is also served at `onlyboosts.social/excludes.json`. Its `_readme` key is the
user-facing documentation; JSON has no comments, so the file carries its own.

**Four lists, and the medium split does not get its own.** `shows` covers albums
and `episodes` covers songs, because an album *is* a show with
`<podcast:medium>music` — see The medium split. The other two are `boosters`
(one person's boosts and their profile) and `boosts` (one note).

**Nothing is deleted.** The collector keeps indexing everything; the list gates
what is *published*. That is what makes it reversible — removing an entry
restores the content on the next pipeline run, verified end to end (a filtered
export followed by a restored one reproduces the unfiltered shards exactly). The
box's SQLite is not a published surface, so there is no half-measure here.

### How it reaches the data

`bots/global-boost-scan/excludes.py` parses the file; `db.apply_excludes()`
projects it onto the `excluded_ids` table and a `boosts.excluded` flag, and
**every publish path filters on `db.not_excluded()`**. Use that helper rather
than writing `excluded = 0` by hand — it is how a new query is found by grep.

**`db.connect()` applies it, not the pipeline scripts.** There is deliberately
no path to the data that can skip it: a command that opened the DB against a
stale list would publish against a stale list. It is idempotent and touches
nothing when the file and the table agree, which is every run but the one after
an edit.

**A malformed file is fatal, a missing one is empty.** A fresh clone with no
file publishes everything, which is right for a list that is empty anyway. A
file that exists and doesn't parse — an unknown list name, a missing id, a
missing reason — raises, and the run scripts validate it as their *first* step
so the failure is legible rather than a traceback inside a scan. The failure
mode being guarded is a typo'd key (`"show"` for `"shows"`) silently excluding
nothing while everyone believes the content is gone.

**⚠️ A guid is matched against every identity slot**, not the one its list is
named after. Clients demonstrably sign an *item* guid into the `podcast:guid`
tag — that is what `guid_aliases` exists to repair and it doesn't always manage
it. Measured on the live index, 52 of the 107 boosts to one episode name it in
the show slot with no `item_guid` at all, so matching `episode` against
`item_guid` alone would have left most of them published. These ids are opaque
and unique, so a listed id turning up in another slot only ever means the same
content. See `db._excluded_expr`.

**Two surfaces need more than the boost filter**, and both are easy to miss:

- **The podroll graph** renders shows we hold no boosts for, so
  `boosts.excluded` never reaches it. `db.podroll_rows` drops an edge excluded at
  *either* end, and `stats()` counts through the same predicate so the graph and
  its figures can't disagree.
- **The per-show shards on the VPS.** The routine push is an rsync *without*
  `--delete`, so an excluded show's `podcasts/<guid>.json` would keep being
  served after it left the index. `export` deletes the stale shards and leaves
  `data/prune-pending.txt`; `push` reads that marker, forces `--delete` for that
  run, and clears it. The marker is a sibling of the shards directory, never
  inside it — everything in there is rsynced verbatim.

**D1 needs to be told, because its projection is upsert-only** and driven by new
boosts arriving. An exclusion is the opposite: a row has to *disappear*.
`apply_excludes` queues what moved in `d1_reproject` — in both directions, so
un-listing restores — and `d1_sync.build_reproject_sql` drains it. That drain is
a re-derivation, not a delete: each show/episode/profile is recomputed from the
box DB and only *becomes* a delete when the recompute comes back empty. So a
show that lost one episode keeps its page with corrected totals, and a show that
lost everything loses its page. The deletes are emitted **before** the delta's
inserts, so an exclude→un-exclude round trip inside one cycle lands right way up.

**Enrichment skips excluded rows too.** Podcast Index lookups and kind-0 fetches
exist to make a row publishable, so continuing to make outbound requests about
the show that asked us to stop is the one thing worse than showing it.

`onlyboosts_globalscan.py excludes` validates the file and reports what each
entry currently hides, in boosts and sats. That is the check to run after an
edit — the alternative is waiting for a timer and reading a feed.

**All three units carry `OnFailure=lb-bot-alert@%n.service`**, and the two that
didn't were wired *because* of this feature: a broken exclusion file stops the
cycle, and without the alert it would stop silently. Two caveats that come with
the alerter — it only catches **non-zero exits**, so an error a step swallows
stays invisible, and its target repo is hardcoded to `ReedBTC/localbitcoiners`,
so an OnlyBoosts failure files an issue over there. Closing the issue re-arms it.

**The removal path is deliberately not documented on the site.** `/about` says
nothing about how to be excluded, and `docs/about-and-faq-source.md` — the
factual source of record for that page — is intentionally silent on it too.
Reed's call; don't add it as a "missing piece".

## Data feed

The collector publishes static JSON to `https://relay.mynostr.app/onlyboosts/`.
The browser never touches that host directly — everything goes through
`functions/api/data/[[path]].js` (`/api/data/*`) and the client in
`assets/js/ob-data.js`.

**⚠️ The upstream returns HTTP 200 for missing files.** `relay.mynostr.app`
serves Nostr on the same origin, so an unknown path falls through to the relay
and answers `200 text/plain "Please use a Nostr client to connect."` — not a
404. Never branch on status. The proxy has two load-bearing guards: it checks
the content-type *and* parses the body as JSON before returning it. Don't
"optimize" the parse away by streaming the body through; validating it is the
whole point.

Path handling is a **strict allowlist**, not a passthrough — a catch-all that
forwards whatever it's given is an SSRF hole. The published shapes are known
and finite, so they're enumerated in `PATH_RULES`.

| Path | What |
|---|---|
| `index.json` | manifest — totals, month list, file pointers. Read first. |
| `latest.json` | most recent ~1,000 boosts, newest-first |
| `boosts/YYYY-MM.json` | month archives, 2024-10 → present |
| `podcasts/index.json` | ~1,376 per-show rollups, each with a `file` pointer |
| `podcasts/<guid>.json` | one show: metadata + episodes + all its boosts |
| `profiles.json` | booster identities by pubkey |
| `meta.json` | summary counts |

Directories aren't browsable — **discover filenames from the manifest**, never
build paths by hand. The one per-show exception still uses the rollup's own
`file` field verbatim.

Full schemas live upstream in `bots/global-boost-scan/DATA-API.md`.

### Record shape and nullability

```
{ id, ts, sats, src, msg, client,
  booster{pk,npub,name,pic}, podcast{guid,title,img,feed},
  episode{guid,title,img,date,num,url} }
```

Almost every display field is nullable. Measured over a 1,000-row sample:
`msg` 16%, `booster.pic` 15%, `episode.title` 11%, `episode.num` 61%,
`podcast.guid` 2%. `ob-data.js#normalizeBoosts` flattens all of it so the
*only* fields a caller may assume are `id`, `ts` and `booster.pk` — everything
else is explicitly nullable and must have a fallback.

Two shape traps worth remembering:

- **`episode.guid` is sometimes a URL**, not a UUID. Treat it as an opaque key.
- **The per-show shards stringify numerics** (`"9"`, `"55987"`, `"None"`), so
  coerce rather than trusting `typeof`. `normalizeBoosts` handles the boost
  records; the episode list inside a shard is coerced at the render site.

Booster names and avatars are **embedded in every record**, so there is no
profile round-trip and nothing to repaint — first paint is final. That's the
main simplification over the old LB snapshot.

## Feed loaders

`assets/js/feeds.js` maps every feed key in `LOADERS`; each lazy-imports its
renderer on first view.

| Feed | Module | Source |
|---|---|---|
| `boosts-global` | `boosts-feed.js` | `GET /api/v1/boosts`, cursor-paged |
| `boosts-follows` | `boosts-feed.js` | `POST /api/v1/boosts/follows`, cursor-paged |
| `episodes-global` | `feeds-podcasts.js` | `GET /api/v1/episodes?not_medium=music&include=boosts`, ranked and paged server-side |
| `episodes-follows` | `feeds-podcasts.js` | the same endpoint as `POST`, body `{follows:[…]}` |
| `songs-global` | `feeds-podcasts.js` | same, `medium=music` |
| `songs-follows` | `feeds-podcasts.js` | same, `medium=music`, as `POST` |
| `shows` | `shows-feed.js` | `GET /api/v1/podcasts?not_medium=music`, ranked and paged server-side |
| `albums` | `shows-feed.js` | same, `medium=music` |

### Range and sort

Every feed carries a range and a sort dropdown, built by
`assets/js/feed-controls.js` and mounted into the feed bar. The chrome is
shared; **what the range means is not**, which is why each renderer passes its
own tooltips:

| | Range filters on | Sorts |
|---|---|---|
| Episodes / Songs | when the episode **aired** (`ep.published`) | latest boost / latest episode / most boosters / most boosts / most sats |
| Boosts | when the boost was **sent** (`b.ts`) | latest boost / latest episode / largest boost |
| Shows / Albums | when the show was **boosted** (`b.ts`) | most boosts / sats / boosters / episodes / recently boosted |

Songs and Albums use the same axes as the feeds they mirror; only the wording
changes (the air date is a track's release date, the sort menu says "Latest
release"). Both come out of the copy tables.

Air date and boost time are different axes on purpose: an old episode boosted
today is in the Episodes data but out of its 1W view, whereas the note and show
feeds are lists of boosts, where "the last 7 days" can only mean the boosts sent
in them. Filtering those by air date instead would drop most of what they hold,
since most boosts land on back catalogue.

The note feed's shorter menu is not an omission — a card there is one boost, so
"most boosters" has nothing to count. Its `episode` sort has to sink undated
rows explicitly: `episode.date` is null on ~12% of records, and a `0` fallback
would float them to the top.

**The ranked feeds offer 1W/1M/1Y/All; the Boosts note feed offers 1W/1M/All,
and the missing 1Y is a consequence of how each answers a window.** On Episodes,
Songs, Shows and Albums the range is a **query parameter** — `RANGE_DAYS` in
`functions/api/v1/episodes.js` and `…/podcasts.js` — so a wider window is a
different `WHERE` clause and costs nothing. **Those two tables and
`RANGE_OPTIONS` move together, or a range button answers 400.** The note feed
**walks** its window instead (`ensureCoverage`, below), and at ~38 boosts a day
network-wide a year is ~13,900 rows: ~70 sequential 200-row requests and several
megabytes before the first card paints. `WALKED_RANGE_OPTIONS` is the subset it
passes. Giving it a year means giving it a `since`-scoped query the way the
ranked feeds have, so the window is answered rather than walked; it is not a
fourth button.

**Sorting is over the selected window, so a bounded window is paged in
completely before it's painted** (`ensureCoverage` in `boosts-feed.js`) —
otherwise "largest boost" would rank whichever pages happened to be loaded.
This is cheap by construction: `latest.json` is ~1,000 boosts spanning ~26
days, so 1W needs no extra fetch and 1M needs at most one archive; on Follows
the first cursor page usually already reaches back months. A bounded window
that's fully covered therefore has **no** load-older button — there is nothing
left in it. On All the button stays, and a non-chronological order can only
rank what's loaded, so the count line under it says so rather than implying the
whole 22k archive. Loading older rows re-sorts in place under those sorts
(newer pages can outrank painted cards); under `recent` it appends, as it
always did.

### Search

`assets/js/feed-search.js` is the typeahead at the head of every panel. Each
panel ships an empty `[data-feed-search]` slot (under the `[data-feed-note]`
line, where there is one) and the
renderer fills it; the slot stays `hidden` until one does, so a feed showing
"sign in" or an error never grows a search box over a list that isn't there.
**It sits inside the panel, not in the sticky bar** — range and sort are read
while scrolling a long list, a search is a thing you do at the top, and the bar
has no room for a text field beside two dropdowns on a phone.

Each feed searches its own subject, and picks exactly one:

| Feed | Searches | Filters to |
|---|---|---|
| Episodes / Songs | episode title, plus the show behind it | that one episode |
| Shows / Albums | show title, plus the guid | that one show |
| Boosts | booster display name, npub or hex pubkey | that booster's boosts |

**Typing suggests, picking filters.** Five hits, and nothing in the list moves
until one is chosen. That's what a ranked feed needs: the question is "where
does my show stand", and the answer is one card carrying its rank, not a
shortlist whose positions would have to be renumbered.

**Rank retention is the renderer's half of the contract**, and it is an
ordering: sort the range's full corpus, stamp each row with its position, *then*
filter to the picked key, then paint from the stamp. All three renderers do it
in that order in their rebuild/repaint function. Reversing the middle two steps
renumbers the survivor to #1, which answers a different question. The note feed
has no rank to retain — a card there is one boost, so it has no ranked sort.

Two fields, and they are deliberately not the same one: `label` is shown and
matched, `sub` is shown only, `extra` is matched only. Matching what's displayed
sounds friendlier and isn't. The Shows sub-line reads "506 boosts · 12k sats",
which made every show in the index a weak hit for "boost" and pushed the real
ones out of a five-row menu; the boosters' sub-line carries a truncated npub,
while `extra` holds the full one so a pasted npub still resolves.

#### Two Backends, and Which One a Feed Gets Is Not a Preference

`getEntries` is the original: the feed hands over the corpus it already holds
and the ladder scores it in memory. Right for a feed whose window **is** the
corpus, which Shows, Albums and Boosts all load. Scoring is a ladder (exact /
prefix / word-start / substring / label before `extra`), not a fuzzy distance —
these queries are the opening words of a name the user already knows, so *where*
a match lands beats how many characters it shares. Ties break on the entry's
position in the feed's current order, so a one-letter query offers the biggest
shows first. Measured at 12ms for 200 queries over the 1,384-show index, which
is why that path has no debounce; its index is built lazily on the first
keystroke after each `refresh()`, and every renderer refreshes on repaint.

`searchRemote` is for a feed that **pages a ranked list off the server**, where
the loaded pages are a prefix of the corpus rather than the whole of it. That is
Episodes and Songs since their ranking moved server-side, and Shows and Albums
since theirs did: an in-memory index there could only find what the reader had
already scrolled past, so a show at #300 was unfindable until "load more" had
been pressed nine times. A feed supplies one or the other, never both. Boosts is
the only feed still on `getEntries`.

**Shows and Albums keep matching the guid and the author, and both moved
server-side.** The author is in `podcasts_fts` beside the title, so it is part of
the MATCH. The guid is **not** indexed there and a pasted one is all hyphens, so
`/api/v1/podcasts?q=` tests it as a separate equality alongside the MATCH. That
is the only handle on the 33% of shows with no title. The remote path is debounced at 220ms,
every request is abortable, and replies are **sequence-guarded as well as
aborted** — an aborted fetch is not guaranteed to lose the race, so a stale
answer is dropped on arrival rather than merely asked to stop.

**⚠️ The remote source is `/api/v1/episodes?q=`, NOT
`/api/v1/search?type=episodes`, and the choice is forced.** The search endpoint
is a flat relevance-ordered "does this exist" lookup with **no medium filter and
no follows scoping at all**; pointed at these feeds it would offer Songs inside
Episodes, and on a Follows feed it would suggest episodes nobody the reader
follows has boosted, every one of which would then filter to an empty list. The
episodes endpoint applies the active medium, range, sort *and* scope, which is
the only way a suggestion is guaranteed to be something the feed can show. The
cost is the ordering: hits come back in the feed's **active sort** rather than by
relevance, so the menu reads as the feed with non-matches removed, which is
exactly what picking one does.

**⚠️ A RAW SEARCH STRING IS NOT AN FTS5 QUERY**, and every endpoint that
touches one goes through `_common.js#ftsMatch`. MATCH parses its right-hand side
as an expression language, so `-` negates, `:` selects a column and `(` groups;
passing typed text through raises `SQLITE_ERROR`. Measured against production
before it existed: `q=bitcoin` answered 200 while `q=rabbit-hole`, `q=foo:bar`
and a pasted show guid all answered **500**. `ftsMatch` quotes every token and
puts the prefix `*` outside the last closing quote. Tokens are quoted
individually rather than the whole string being one phrase, because that
difference is the semantics: `"joe" "rogan"*` is an implicit AND of terms
appearing anywhere, which is what the client ladder did, where `"joe rogan"*`
would demand adjacency.

**Notes are left off the typeahead and fetched on the pick.** Measured at 80KB
for 5 rows with `include=boosts` against 4KB without, and it runs while someone
is typing. The pick re-issues the *same* query with the notes attached and finds
its row inside the same handful of hits; that is why the entry carries the
`query` that produced it. Both responses were verified to agree row for row.

**A picked card takes its rank from the server, not from its position.** An
unfiltered page is numbered by position because it arrives in rank order from
offset 0, but a searched card is one row out of a filtered query, so
`loadEpisodePage` stamps `_rank` from the response's own `rank` field and
`rebuild()` does not renumber it. Rank is scoped to the active range: on `1m` the
top hits come back 1, 2, 4.

A pick is a fetch now, so it has states an array filter didn't: `pickLoading`
paints "Loading…", a resolved miss paints "Not in this range", and no search at
all paints the empty-window copy. Conflating any two of them tells the reader
something false.

**The no-match line is a function, not a string** (`noMatchText`), because what a
miss *means* depends on where the reader is standing. It used to read "No
matching episode in this view" everywhere, which suggests a filter problem when
on All/Global the truth is a **coverage boundary**: the search has seen the whole
index, and a show nobody has boosted on Nostr is not in it and will not be until
someone does. There is no wider view to send them to, and the old copy pointed at
one. Three strings per medium, off the `COPY` table: `searchNoneAll`,
`searchNoneRange`, `searchNoneFollows`.

**⚠️ EVERY FEED READS `ob-live.js` NOW. The static/live split is over.**

It was: `ob-data.js` for the Global views (immutable CDN shards under
`/api/data/*`) and `ob-live.js` for Follows (the D1 query API under
`/api/v1/*`), on the reasoning that a Global view is the same bytes for every
visitor and caches where a Follows view cannot. The caching benefit was real;
generalising it into "static for global, live for follows" is what produced two
stores that had to agree with nothing forcing them to. See
`docs/data-architecture.md`.

`ob-data.js` is now **shape only**. `normalizeBoosts`, `toEpisodeShape`,
`episodeApiToBoosts` and `boosterLabel` still have callers and are the reason
every consumer downstream of a fetch sees one model. Its *fetching* half —
`getPodcastIndex`, `getPodcastDetail`, `getShowMediums`, `getShowAuthors`,
`getLatestBoosts`, `getBoostMonths`, `getBoostMonth`, `fetchJson`, `getManifest`
and `mediumPredicate` — was **deleted on 2026-08-14**, 168 lines and 32% of the
file. It was kept for a while on the reasoning that the shards remain a published
dataset; that is still true and is untouched, since
`functions/api/data/[[path]].js` still proxies them and `/about`'s stat strip
still reads `/api/data/meta.json`. Publishing a dataset does not require shipping
an unused client for it to every visitor.

⚠️ **Verify per function INCLUDING internal callers before removing anything
here.** A grep that excludes the file itself hides functions whose only caller is
a sibling in the same module, which is exactly what made `mediumPredicate` look
live. All four of its remaining references turned out to be comments, in three
modules and in this document.

That closes the dependency piece 3 was waiting on. Demoting the shards to an
export is now a decision rather than a migration.

`ob-live.js` caches nothing in-process — the shard cache was safe only because
those files are immutable.

A third consumer reads D1 directly rather than through `ob-live.js`:
`/episode/<guid>`'s community section fetches
`GET /api/v1/episodes/<item-guid>?community=1` itself, because it needs one
bounded corpus once rather than a paging reader. It returns the same record
shape, so it too runs through `normalizeBoosts` and everything downstream sees
the one model.

Two shapes on the live side: `followsBoostReader()` pages incrementally for the
note feed, `getFollowsBoosts()` pulls a bounded corpus for the episodes rollup,
which has to group and range-filter before it can paint anything. The corpus is
capped (`MAX_EAGER_ROWS` / `MAX_EAGER_PAGES`) and reports `truncated`. That cap
is about how many *boosts* to roll up, and is unrelated to the follow set's
size, which is no longer capped in any way that matters.

**`/api/v1/boosts/follows` passes its whole author list as one bound JSON
array, unrolled by `json_each`.** D1 imposes two limits a large `IN (...)` hits
from opposite sides: 100 bound parameters per statement, and 100,000 bytes of
statement text. One bind per author breaks at 99 follows (worse mid-pagination,
where the cursor adds three binds); interpolating the authors instead trades
that for the text limit, which runs out around 1,480. The JSON array escapes
both — the statement is a fixed ~180 bytes however many authors there are, and
parameter *values* don't count toward statement length. Verified on SQLite 3.51
that the plan still resolves through `idx_boosts_booster` rather than degrading
to a scan.

Cloudflare documents JSON1 support but doesn't enumerate the table-valued
functions, so the endpoint keeps an interpolated fallback that reproduces the
old truncate-at-1,000 behaviour if D1 rejects `json_each`. The fallback is the
only place SQL is built by concatenation; it's safe because every value has been
through `toHexPubkey` and re-tested against `HEX64`, both of which yield hex-only
strings. Don't generalize the pattern. `MAX_AUTHORS` (10,000) is an abuse guard,
not a technical ceiling.

**Follows scoping** lives in `assets/js/follow-set.js`. `resolveFollows()`
reads the signed-in pubkey from `localStorage.lb_nostr_session` —
deliberately *not* by loading the 1MB login widget, since all we need is an
identity, not a signer — then fetches that user's newest kind-3 across the
static relays and unions its p-tags.

**An nsec login is never persisted** (`LoginScreen.jsx` keeps the key in
memory only), so localStorage is empty for a user who is genuinely signed
in. `getSessionPubkey()` therefore falls back to
`window.LBLogin?.getUser?.()?.pubkey` — read only if the bundle is *already*
loaded; it must never load it, which is the whole reason this module exists. Cached 30 min, keyed by pubkey so an
account switch can't serve the previous user's list; an empty result is never
cached. Returns `signed-out` / `ok` / `empty` / `unavailable`, each with its
own placeholder. The user's own pubkey is in the set, so your own boosts
appear in your Follows feed.

**`lb:session-change` is what keeps all of this in sync.** `setUser` in the
widget dispatches it on the window whenever the *identity* changes (not on
profile refreshes or stub→real restores). Two listeners, both also watching
`storage` for the same thing happening in another tab:

- the inline feed-bar controller shows/hides the scope menu, and drops you
  back to Global if you sign out while reading a Follows feed;
- `feeds.js` drops both `*-follows` keys from its `loaded` set and re-runs
  whichever is on screen — `loaded` is what makes each feed hydrate exactly
  once, so without this a Follows feed would keep the previous account's
  results after a switch.

The renderers still carry a `signed-out` branch. It's unreachable through the
feed bar now and kept as a fallback — if the hiding logic ever fails, the feed
says something sane instead of rendering an empty list.

Two scoping details that aren't obvious:

- **Neither Boosts scope pages backwards hunting for matches any more.** Follows
  used to: a follow set can match nothing in the most recent 1,000 boosts while
  having plenty further back, so the client walked month archives until
  something turned up. The D1 query answers that in one indexed hit, so an empty
  first page now genuinely means empty. **The archive walk is gone from the
  Global path too** — it was the last thing keeping it, and `latest.json` lagging
  its own edge was the reason to remove it rather than to keep it.
- **The Episodes feeds don't use `podcasts/index.json`.** The cards are
  *episodes*, not shows, and the published index is a show-level rollup
  computed over everyone — so its counts would also be wrong for a Follows
  audience. Both roll the boost feed up by episode instead, via
  `ob-data.js#toEpisodeShape`. Global bounds that at `latest.json` + the three
  most recent months (the range filter offers "All", which needs more than the
  recent 1,000 boosts to mean anything; all 22 archives would be ~20MB).
  Follows has no month window — a follow set's boosts are a thin slice of the
  same table, so the query walks its own history and stops on `ob-live.js`'s
  row budget instead of at an archive boundary. "All" therefore reaches further
  back on Follows than on Global, which is the right way round.

### The Shows feed

`assets/js/shows-feed.js`. The card is the SHOW where the Episodes card is one
EPISODE — same boosts, rolled up a level. An earlier pass at this *replaced* the
episode feed and was reverted (`1f24c77`); it has its own slot now, so nothing is
displaced. The reverted renderer is still readable at
`git show 7995db0:assets/js/podcasts-feed.js`.

**Both ranges are now one query, and the range is a parameter rather than a
source.** `GET /api/v1/podcasts` answers all three off D1: on All it reads the
precomputed aggregate columns, on 1W/1M it GROUPs the boosts inside the window.
The card cannot tell which one answered, and neither can anything below the
fetch. **Range and sort are queries, so changing either refetches.**

**⚠️ `range` MEANS BOOST TIME on this endpoint and AIR DATE on
`/api/v1/episodes`.** A show is in the 1W view because someone boosted it this
week and its figures are that week's; an episode is in the 1W view because it
AIRED this week, however long ago it was boosted. Both sides are deliberate and
the parameter name is shared; do not "unify" them.

What this replaced, and why it was a correctness fix rather than a speedup:

- **All** read `podcasts/index.json` WHOLE — ~440KB describing every show in the
  index, downloaded to paint thirty cards.
- **1W / 1M** walked `latest.json` plus month archives and GROUPed the boosts by
  `podcast.guid` **in the browser**, so a windowed ranking was computed over
  whatever shards the walk happened to pull rather than over the window. This
  was the last client-side aggregation on the site, and the same defect the
  Episodes feeds were fixed for.

**Nothing on the site reads `podcasts/index.json` or the per-show shards any
more**, and as of 2026-08-14 nothing can: `getPodcastIndex`, `getPodcastDetail`,
`getShowMediums` and `getShowAuthors` are deleted along with the rest of
`ob-data.js`'s fetching half. The shards remain a published dataset served by the
proxy; see the note in the Feed loaders section.

Two data facts that shaped the UI, both measured over the live index:

- **462 of 1,384 shows (33%) have no title and no art.** The collector holds
  boosts tagged with their guid but Podcast Index doesn't know the feed. They're
  long tail — median 1 boost, 3.8% of all sats — and the first one doesn't
  appear until #28 on *any* sort, so they never reach the first page. They're
  kept rather than filtered (real boosts to real shows) and labelled
  "Unidentified show" with the guid, so an unnamed card reads as incomplete data
  rather than a bug.
- **Detail shards ran 3.5KB at the median, 15KB at p90, and 1.95MB for the
  single most-boosted show**, because a shard carries every boost the show ever
  had plus full shownotes. **That fetch is retired.** The drawer now calls
  `GET /api/v1/podcasts/<guid>?boosts=0`, which returns the episode rows and
  nothing else.

**Both ranges fetch the drawer now, where the windowed ones used to build it in
memory for free.** That freedom came from the browser holding every boost in the
window, which is precisely the thing that moved to the server; so the window
goes with the request instead, as `?since=<unix>`, and the rows come back scoped
and recounted. A drawer showing all-time figures under a card showing the week's
would contradict the card it opened from. It is one small request on an explicit
expand, traded against never fetching a 1.95MB shard again.

`byRange` is gone with the grouping it cached.

### The episode feed adapter

`feeds-podcasts.js` predates this data feed: it groups a flat boost list by
`item_guid` and looks episode/show metadata up in side tables, where the new
feed embeds that metadata in every boost. `ob-data.js#toEpisodeShape` adapts
the data to the consumer rather than the reverse — rewriting the UI around
the new shape would have cost the boost drawer, the 1W/1M/All range filter
and the five-way sort menu, which are the point of that view.

Two fields the feed doesn't carry:

- **`feed_id` / `itunes_id`** (Podcast Index numerics) drive the "listen on"
  links and the `/api/value` split lookup. `/api/value` now also accepts
  `feedUrl` or `podcastGuid` and resolves the id server-side, so boosting
  works; the pod.link / PI links are omitted for shows we can't identify.
- **`description` / `enclosure_type`** only exist in the per-show shard,
  which is too expensive to fetch per card. Cards degrade to no blurb and let
  the browser sniff the audio type.

`toEpisodeShape` also returns a `profiles` map built from the embedded
booster identities, which `renderPodcasts` seeds before first paint — so the
batched Primal lookup now only runs for stragglers the collector couldn't
resolve.

### Every Episode Link Points at `/episode/<item-guid>`

**Seven surfaces name an episode, and all seven now resolve to its page here.**
Six are hyperlinks a reader clicks; the seventh is the URL written into a
published boost note, which is why the set was wired in two passes rather than
one.

| Surface | What links | Built by |
|---|---|---|
| Episodes / Songs cards | artwork, title, "See all boosts" in the drawer | `feeds-podcasts.js`, via `show-link.js#episodePageHref` |
| `/episode` community cards | the same card, unchanged | the same |
| Shows / Albums cards' episode drawer | the row's title | `shows-feed.js#renderEpisodes`, same module |
| Boosts cards | the episode title on the meta row | `boosts-feed.js`, same module |
| `/show` episode drawer rows | the row's title | `functions/show/[guid].js#episodePageUrl` |
| A published boost note | the content link line and the `r` tag | `episode-link.js#episodeBoostLink` |

**Both mediums, everywhere.** Songs is `feeds-podcasts.js` and Albums is
`shows-feed.js` — the same two renderers behind Episodes and Shows, differing
only by a copy table — so a track's title links exactly as an episode's does and
there was nothing medium-specific to add. `/episode/<item-guid>` serves a track
the same way it serves an episode; only the words change.

**The qualifying rule is the TITLE in all of them**, and each falls back to what
it linked before rather than emitting a URL that 404s: 6,682 of the 7,182
episodes carrying an indexed boost have one, and the other 500 are boosts tagged
with an item guid Podcast Index cannot identify. The fallbacks differ because
what each surface linked before differs — Boost Me Bitch on the feed cards and in
the note, the episode's own audio URL on the Boosts cards and in the Shows/Albums
drawer, and plain text in the `/show` drawer, where a row already carries a Boost
button and had no link at all before.

**Two surfaces used to point at the AUDIO**, `episode.url`, because that was the
only destination they had: the Boosts card's episode name and the Shows/Albums
drawer's rows. That URL is now the untitled fallback, and it is the only branch
on those surfaces that still opens a new tab.

**⚠️ Two surfaces still point at boostmebitch.com on purpose, and both are
show-level**, in `functions/show/[guid].js` through one `bmbShowUrl()`:

- **"See All Episodes"** on the episode drawer's control band. The drawer lists
  only the episodes carrying an indexed boost, so this link reaches the one thing
  this site does not hold: the show's full catalogue.
- **A podroll tile** for a show we have no page of our own for, which is 44% of
  them.

Neither has an equivalent here, which is the whole test. `episode-link.js`
enumerates the set.

**Two surfaces started an external boost and had to publish the same note.**
`feeds-podcasts.js` and `show-page.js` both call `LBLogin.openExternalBoost`, so
they share one modal (`ExternalBoostModal.jsx`) and one orchestrator
(`externalBoost.js`). What they did *not* share was the `bmbUrl` field: the feed
built a link inline while the show page passed `''`, and
`buildExternalNoteTemplate` gates both the content link line and the `r` tag on
it, so the same episode boosted from the two pages produced two different notes.
`episodeBoostLink` is the fix and is the single owner of that target — three
surfaces import it now, `episode-page.js` being the third.

**⚠️ THE NOTE'S LINK IS PERMANENT, WHICH IS WHY IT MOVED ON ITS OWN DECISION.**
It resolved to BMB from the fork because OnlyBoosts had no per-episode page, and
the flip was held back when the pages shipped rather than being taken as a side
effect of them. **Notes already published keep pointing at BMB and always will**:
an event cannot be recalled. The URL it emits is **absolute** for the same
reason — the string is read wherever the event is rendered, so a site-relative
path would resolve against whatever client is displaying it.

`episode-page.js` passed `bmbUrl: ''` until that moment, deliberately: a page
passing its own URL while the feed passed BMB is exactly the
two-notes-for-one-episode bug the module exists to prevent. It now passes the
shared builder's answer, which is this page's own URL, arrived at through the
module rather than from `location.href` — the page does not get its own opinion.

`episodeBoostLink` returns null (caller sends `''`, template omits both) when
there is no episode to point at, which is also what a **show-level** boost from
`/show/<guid>` gets. `/show/<guid>` is **not** the episode target and never was:
a boost note is about one episode, so pointing it at the show would drop the part
the reader wants.

**The `/show` drawer row links its title and not its artwork**, where the feed
card links both. A 44px thumbnail in a list row is not a target anyone aims for,
and the row already carries a Boost button at its other end; a third hit area
would be three things to hit in 44 pixels.

### Snapshot → card

The feed carries each boost's identity and content but **not the signed
event**. That's enough: the card needs only those fields, and reply / like / zap
need only `id` + `pubkey`. Every surface builds a minimal
`{id, pubkey, kind, content, created_at, tags}` object purely to hand to
`buildActionBar` — a projection, not a verified event. Don't pass it anywhere
that assumes a real one.

**⚠️ THE MISSING `sig` HAS BITTEN ONCE.** `handleRepost` embedded the original
note only when `ev.sig` was present, and no surface on this site has it, so every
repost published from here was a bare kind-6 with empty content — valid NIP-18
and still unrenderable, since 98% of boost notes live on `relay.fountain.fm`
alone. Fixed in `b6c0bd4` by fetching the original through NDK. The projection is
now built in three places (`episode-card-actions.js`, `boost-note-actions.js`,
`boosts-feed.js`) and each says so; **when a new action is added, decide
explicitly whether it needs the real signed event or only the projection.**

On both feeds a booster's avatar and display name copy their npub —
`assets/js/copy-npub.js` holds the clipboard + toast helpers (the toast keeps
its historical `.pcast-toast` class; it's the site's only one). `booster.npub`
is nullable where `booster.pk` isn't, so `boosts-feed.js` derives the npub
from the hex pubkey when the record has none.

`boosts-feed.js` builds its own card rather than calling
`boosts-thread.js#renderNoteCard`, because that function caches cards by event
id and appends the action bar itself — appending the boost-meta row (sats +
what was boosted) afterwards would double up on a cached repaint.

## Vocabulary and the scope note

Every number on this site is bounded by the handful of apps that publish boost
notes to Nostr. A reader who does not know that reads them as the show's real
numbers, and the failure mode is a podcaster seeing our figure as a verdict on
their audience. Two mechanisms carry the qualifier, and they divide the work:

| | |
|---|---|
| **A Nostr boost** | an indexed boost. Bare "boost" is fine inside a surface the scope note already covers. |
| **A booster** | one person who sent one. This is the count noun everywhere: cards, hero tiles, drawer bars. |
| **The Nostr Community** | the *set* of them. Names a group, never counts one — the show page section, the `/boosters` page, the nav entry. |
| **Sats** | never qualified inline. `Sats (Public)` was considered and rejected: it reads as a claim about the payment rather than the record, and invites a private counterpart we never explain. |
| ~~Supporter~~ | **removed from every user-visible string.** It is a claim about who supports a show, and this data cannot make it: a show with 200 keysend supporters and 3 Nostr boosters would read as having 3 supporters. That is the single highest-risk word the site had, and it was on the page shows share. |

**NIP-73 is deliberately *not* the qualifier**, and the drawer summaries that
used to say "Episodes with NIP-73 Boosts" now say "Nostr Boosts". NIP-73 is the
tag linking a note to a show; what actually excludes a boost from this index is
that nobody published a note at all. A reader who learns what NIP-73 is still
does not understand why their community is missing. The term survives in exactly
one place, `/about#nip73`, where it is the subject.

**The qualifier is carried two ways, and which one depends on the surface.**

**A two-word label, on the feeds.** Every rollup card prefixes its figures with
`Nostr Stats:` (`.ob-stats-label`, styled in `index.html`), and the boost drawer
on an Episodes/Songs card is titled `Nostr Interactions:`. **Both keep the
colon**: the booster faces and the sats sit immediately to the right of the
drawer label, so without it the label reads as a heading over an unexplained row
of avatars rather than as introducing them. The Episodes card's
counts moved out of that drawer bar and into the card body under the Fountain
link to make room for it; the sats stayed on the drawer bar beside the booster
faces.

**A linked heading, on `/show`.** The stat tiles sit under
`<h2 class="show-stats-title">`, reading **"Nostr Boost Stats"** with *Nostr
Boost* linking to `/about#keysend` — "What Is Not Indexed", the section that
explains what the numbers exclude. The qualifier is above the figures rather
than after them, and the link carries the rest.

**The full sentence now survives in exactly one place: `og:description`.** That
is the string that travels without the page around it, into a preview card or a
group chat where nothing else qualifies it, so **don't trim it**.

**`.ob-scopenote` is gone.** It was the shared one-sentence paragraph, and it
had three intended homes; none are left. The feed panels dropped it (first
thing on the homepage, three lines on a phone, pushing the feed below the fold
to answer a question a browsing visitor had not asked yet). `/about` never took
it — its Indexer Stats paragraph says more and says it first, and only the lead
tile carries the word. `/show` was the last mount, replaced by the heading
above: it said more than two words can, but it said it *after* the numbers, on
a page whose whole design is to fit one screen. The rule is deleted from
`theme.css`; `git show f0c5f66:assets/css/theme.css` has it.

**The pattern across every surface is now the same**: a short label at the
point of the numbers, not a paragraph near them — `Nostr Stats:` on the rollup
cards, `Nostr Interactions:` on the boost drawer, `Nostr Boost Stats` over the
show hero's tiles. Don't reintroduce the paragraph; if the qualifier ever needs
more weight on `/`, the place to add it is the masthead line, which already
links to `/about`.

The `/boosts` cards carry no qualifier at all: one card is one boost, and its
sats figure is that note's own claim rather than an aggregate.

**The rename is a surface rename only.** `supporterCard`, `renderSupporters`,
`SUPPORTERS_VISIBLE`, `data-show-more="supporter"`, `data-supporter-grid`, the
`.sup-*` CSS classes and `assets/js/supporter-set.js` all keep their names — the
same seam as Podcasts → Episodes below. The section's anchor did move
(`#supporters` → `#community`), which was safe because nothing linked to it.

The site subtitle is **"Podcasting 2.0 Boosts on Nostr"** and it appears in four
places that change together: the masthead line under the banner on `index.html`
(where it links to `/about`), the homepage `<title>` and `og:title`, and
`manifest.webmanifest`. Show pages use `<title> — Boosts on Nostr | OnlyBoosts`.
The show page's `og:description` states the scope *inside the sentence*, because
it is the one string that travels without the page around it.

## Show pages: the drawer chrome, and the back link

Both `<details>` on `/show` share `.ep-drawer`, and the affordance work is in
`show-page.css` rather than in either renderer. **A collapsed drawer has to
announce that it opens**, which three cues carry: a `--cream-d` header band so
the box has a lid, a **SHOW / HIDE** word at the right end drawn from CSS off
`[open]`, and a chevron built from two borders that rotates. The word is the one
a first-time visitor reads; the chevron confirms it. The `.drawer-hint` span is
`aria-hidden` — `<details>` announces its own expanded state and does not need
to say it twice.

The summary label is `--ink`, not brand: a full heading in link blue promises
navigation, and these expand in place. Playfair at the `.show-stats-title` size,
because these summaries **stand in for the `<h2>` their sections don't have**.

**Neither summary carries a count and neither may gain one.** The affordance is
form, not information; see "No Episode Counts, Anywhere" in the spec for why the
episode one in particular cannot.

**The episode drawer's band carries a second control**, at the end opposite the
sort: **See All Episodes** (*See All Tracks* on music, off the `COPY` table),
linking to the show on BMB. The drawer lists only episodes carrying an indexed
boost, which is a small slice of most shows' output, and the page said nothing
about where the rest were. It is styled as the same pill as the sort beside it,
since a link styled as a link reads as body text stranded in a toolbar.

That is why the two bands now ship differently: the episode one holds a plain
link that works with **no JavaScript**, so it ships visible and only the sort is
conditional; the community one holds nothing but a sort, so it still ships
`hidden`. The band wraps on a narrow phone rather than squeezing either control.

**It is one of the two surfaces still pointing at boostmebitch.com**, and it is
the reason that link survived the sweep that moved every episode link onto
`/episode/<item-guid>`: the drawer lists only the episodes carrying an indexed
boost, so a show's FULL catalogue is the one thing this site cannot offer. The
podroll tile for an unknown show is the other. `assets/js/episode-link.js` owns
the target and enumerates the set; the Function builds the URL inline because a
Pages Function cannot import a client module, and both files carry a ⚠️ pointing
at the other.

`.cs-controls` (the control band, mounted by **both** drawers) is `--cream-d`, not
`--cream`. On the page background it read as a gap punched through the card, so
an open drawer looked severed at the sort row. The `--accent` / `--tint` supply
those controls need moved from `.cs-drawer` up to `.show-main` at the same time:
only the community drawer carried that class, so the **episode** drawer's sort
pill had been reading an undefined `--accent`, which drops every declaration
using one at computed-value time.

**The back link** (`.show-back`, above the hero) exists because the show pages
are a graph rather than a tree — a community row links to another show page,
whose rows link on again — and because `manifest.webmanifest` declares
`display: standalone`, so an installed OnlyBoosts has no browser back button at
all.

It is **server-rendered as a real link to the feed** (`/#shows`, or `/#albums`
off the `COPY` table) and `detail-page.js#initBackLink` upgrades it to
`history.back()` **only when `document.referrer` is same-origin**. That split is
the point: a visitor who opened a shared link has no chain behind them, and
`history.back()` would take them off the site or nowhere. The `href` survives the
upgrade, so a modified click still opens the feed in a new tab.

## Show pages: the section ids are URLs

Every section on `/show/<guid>` is addressable, so a podcaster can share one part
of their own page: `/show/<guid>#podroll`. **These six ids are frozen.**

| Hash | Section |
|---|---|
| `#episodes` | the episode drawer |
| `#community-shows` | Other Shows/Albums This Community Boosts |
| `#community` | the Nostr Community wall |
| `#podroll` | Podroll - Recommended by Show Authors |
| `#reverse-podroll` | Reverse Podroll - \<Show Name\> is Recommended By: |
| `#boosts` | Recent Boosts |

Same rule as `ALIASES` in `index.html`, and it was written here as the stricter
one: a feed hash is read by a JS controller that can map an old form onto a new
key and rewrite the bar, where these resolve in the browser's own anchor
handling, which has nowhere to put a redirect.

**That is now qualified rather than repealed.** `HASH_ALIASES`, passed to
`initHashRouting()` in `detail-page.js`,
does for a retired id exactly what `ALIASES` does for a feed hash: rewrites it
with `replaceState` and scrolls. It carried `#inverse-podroll` →
`#reverse-podroll` and holds that one entry, permanently. But it needs the module
to have run, so a rename is still a dead link for a reader with JavaScript off
and for anything resolving the URL without a browser. It is the repair for a
rename that already happened, **not a licence for the next one**. The note about
`#supporters` → `#community` being "safe because nothing linked to it" was true
when it was written and is not a precedent either.

Four pieces hold it up and they live in four files:

- the ids themselves, on the `<section>` elements in `functions/show/[guid].js`
  (the podroll pair come off `PODROLL_COPY[*].id`);
- **`scroll-margin-top: 5rem` on `.show-section`** in `show-page.css`. `#top-nav`
  is `position: sticky` at 64px, so without it an anchor scrolls the heading to
  y=0 and *behind the bar* — the reader's first visible line is the second line
  of what they followed a link to. `page.css` solved this for `/about` first;
- **`revealHashTarget()`** inside `initHashRouting()` in `detail-page.js`,
  which opens any collapsed
  `<details>` inside the targeted section. Exactly one case needs it: the episode
  drawer ships closed, so `#episodes` otherwise lands on a lid. It does **not**
  re-scroll afterwards — the drawer expands downward from a summary already at
  the top of its section, so the section's offset doesn't move and the browser's
  scroll is still right; scrolling again would only add a smooth-scroll animation
  on load that reads as a glitch. `getElementById`, never `querySelector`: an id
  off the URL is untrusted and would otherwise be parsed as a selector;
- **`initHashSpy()`** beside it, which is what makes the ids reachable by a
  reader who was never told them. See the section below.

With JavaScript off the anchors still resolve and still scroll. Only the drawer
stays shut, one click from open, which is what a visitor who scrolled there
themselves would find; the address bar simply doesn't follow.

## Show pages: the hash follows the scroll

`initHashSpy()` in `detail-page.js`, shared with `/episode/<guid>`. An
`rAF`-throttled scroll handler finds the
last `.show-section[id]` whose top has crossed the line and `replaceState`s its
id, clearing back to the bare URL above the first one. **Copying the URL at any
point yields a link back to that spot**, which is the whole point: the six ids
above were shareable and undiscoverable, reachable only by someone who had been
told them.

The two alternatives were considered and both put something on the page. A
permalink glyph beside each heading is the documentation-site convention, but it
reaches only **four of the six** sections — `#episodes` and `#community-shows`
are `show-section--bare`, with a `<summary>` where the `<h2>` would be — and it
asks the reader to notice a control before they can use it. A clickable heading
was rejected for the reason that recommends it in the abstract: nothing about a
plain heading says it does anything, so nobody finds it.

Four properties are load-bearing:

- **`replaceState`, never `pushState`.** Scrolling isn't navigation, and a Back
  button replaying a scroll one section at a time is worse than the feature. It
  also fires **no `hashchange`**, which is what stops the spy tripping
  `revealHashTarget()` and opening the episode drawer as a side effect of
  scrolling past it. The two coexist on exactly that property.
- **The line is read from `scroll-margin-top`** via `getComputedStyle`, never
  hardcoded. The section the spy names has to be the one an anchor would park at,
  or following your own copied link lands you a section off.
- **Only on a change.** Safari throttles `replaceState` to ~100 calls per 30s and
  throws past it; a call per scroll frame spends that in a second.
- **The last screenful belongs to the last section**, checked explicitly. A short
  Recent Boosts can sit wholly on screen at the foot of the document without its
  top ever reaching the line, and would otherwise be the one section the spy can
  never name.

Offsets are measured live rather than cached at init — a drawer opening, a "Show
N more" and a re-sort of the community rows all move everything below them. There
is **no run at init**: a page opened on `#boosts` is still being scrolled there
when the module executes, and measuring mid-flight would replace the hash the
reader arrived on.

Two things it is honest about. On iOS Safari and Chrome for Android the URL bar
collapses while scrolling, so most phone readers never watch it happen; the
payoff there is that Share and Copy Link carry the section. And the hash reports
where the reader *stopped* rather than what they chose, which is the price of
asking for no affordance at all.

## Show pages: other shows this community boosts

A drawer above the Nostr Community wall listing every other show this show's
boosters have boosted. `renderCommunityShows` in `functions/show/[guid].js`,
`initCommunityShows` in `assets/js/show-page.js`, `.cs-*` in `show-page.css`.
Design of record: the section of the same name in `docs/show-pages-spec.md`.

**It is the one rollup that is not split on medium.** A music community also
boosting podcasts is the interesting half of the finding, so the heading is
"Other Shows/Albums This Community Boosts" on both and there is no `COPY` entry.

**The headline figure per row is the overlap, not the size**: "27 community
boosters". That is what the homepage Shows feed cannot say, and it's the default
sort. It read "27 of 115 boosters" first and the fraction was a puzzle — the
denominator is this show's own booster count, which is on the page but not next
to it, so the reader had to go find what they were 27 of. Sampled from rank #1 to #400, this list's top ten shares 0–6 entries with
the global top ten, so it is not the site-wide ranking repeated.

**Every figure is community-scoped by construction.** The query joins through
the set of this show's boosters, so a row's boosts and sats are what *these*
people sent that show, never its global totals. The sort labels say so — "Most
boosts here", "Most sats here".

**The drawer summary carries no count**, and neither does the episode drawer's.

**All time only. There is no range control, and that is a decision.** One
shipped first and came out: a time window is an episode-level question, where
which shows an audience overlaps with is a standing fact. The data agreed —
median community had boosted one other show in the last 7 days, 47% had boosted
none, so two of three ranges were empty on half the site. Rank is recomputed per
sort rather than retained, because the list is never filtered.

**It ships open**, unlike the episode drawer above it: a catalogue is something
you consult, a recommendation is something you browse.

Each row ships its three figures in one `data-cs` attribute, so sorting is a
re-order and a renumber — no fetch, no re-label, and the section renders ranked
with JavaScript off. Capped at 150 rows (fan-out is median 45, p90 191, max
608); the biggest page's section is ~154KB raw, ~21KB gzipped. The bolt icon is
one `<symbol>` referenced by every row — inlining it 150 times cost 49KB of
markup and 150 identical subtrees to parse.

The `.pcast-sort` control styles are restated in `show-page.css` from the inline
block in `index.html`, the same arrangement as `.nostr-mention`. Only the sort
half is carried; there is no range control here.

Untitled shows are excluded though the Shows feed keeps them — they have no page
to link to, and no Podcast Index record, so their boost button could only fail.

**The community wall follows localbitcoiners' `supporters.html`**, which is its
visual ancestor and reads better than the boxed grid that came first. The card
has **no chrome** — no border, no background, no panel — just a circular avatar,
the name, and the sats centered beneath. The avatars are the pattern, and a grid
of bordered boxes competed with them. `git show lb/main:supporters.html` is the
reference.

**No rank numerals.** The wall is ordered by sats, so position already says
standing; a numeral on every face turned a community into a scoreboard. The
podium is marked by size and a brand ring instead.

**The podium wraps rather than counting**: five across on desktop, three on a
phone with the last two centered beneath. `PODIUM` is a server-side constant and
CSS cannot move a card into the grid below, so the row is a centered flex-wrap
and `.sup-card--podium` is an exact fraction of it —
`calc((100% - 4 * 1.3rem) / 5)`, and `/ 3` in the 640px block. A pixel width
would put the break at the mercy of viewport arithmetic: a 430px phone fits four
84px cards where a 375px one fits three, so one rule would give two different
counts on two phones. 21 boosters show before the toggle
(`SUPPORTERS_VISIBLE`).

## Show pages: the podroll, in both directions

`<podcast:podroll>` is a publisher's own list of other shows worth hearing, read
from the show's raw RSS. The collector half is documented under "Podroll: the
first field we parse from raw RSS" below; this is the site half.
`renderPodroll` / `podrollTile` / `PODROLL_COPY` in `functions/show/[guid].js`,
`.pr-*` in `show-page.css`, `initArt2('.pr-art[data-art2]', …)` in
`show-page.js`.

**Two sections, never one.** "Podroll - Recommended by Show Authors" and
"Reverse Podroll - <Show Name> is Recommended By:", between the Nostr Community wall and
Recent Boosts. Forward-only would be a section on 65 pages; the reverse edge is
the same rows read the other way and brings it to **109**, because plenty of
shows are recommended by someone without publishing a podroll themselves (Local
Bitcoiners is one, via Bowl After Bowl). Merging them into one grid was rejected:
*I recommend them* and *they recommend me* are opposite claims, and a tile
carrying only artwork and a title cannot tell a reader which it is.

**It is the one section on the page not derived from boost data**, and the form
says so. Everything else here is a row — 44px thumbnail, title, a line of
figures, a border — and a podroll has no figures at all, so a row would leave
two thirds of its width empty and read as a ranked list that lost its ranking.
Square artwork at tile size with the name beneath is what the artwork earns when
it is the only content. Bowl After Bowl's own roll-call page is the reference.
**Five across on desktop, two on a phone**, as fixed `grid-template-columns`
counts rather than `auto-fill`: the wall above can auto-fill because an avatar
has a natural size, where a tile is as wide as a fifth of the column, so here the
count is the design and the width follows from it.

**No figures, no sort, no boost button, no drawer.** The tile is artwork and a
title, full stop. A boost button was withheld on purpose: barely half of podroll
targets have a Podcast Index record to resolve splits from, and the section's job
is to send a reader onward rather than to take a payment. Ten tiles paint before
a `.show-more` toggle (`PODROLL_VISIBLE`) — median podroll is 4, so it bites on
one page (63 entries) and two reverse lists.

**`linked` is the collector's flag and is read, never re-derived.** True means
the show has a `/show/<guid>` page; **44% of cards are false** and link to
`boostmebitch.com/?podcast=<guid>` in a new tab instead. Every one of the 371
live edges carries a guid at both ends, so a tile is always linkable and the
query selects no `*_url` column at all. This is one of the **two** remaining
surfaces pointing at BMB, both show-level and both in this file through one
`bmbShowUrl()`; `assets/js/episode-link.js` owns the target and enumerates them.

**Neither heading carries a count, and neither may gain one.** Both figures are
bounded by which feeds the collector has read, so a badge would state a fact
about our coverage as though it were one about the show; each sub-line says what
bounds it, which is what a badge cannot do. **The Nostr Community wall's count
came off at the same time**, for the matching reason — it read as the size of the
show's community where it counts who published a boost to Nostr — so `.show-count`
now has no emitter anywhere on the page. The rule stays in `show-page.css` with a
note: the shape is right for a figure that is complete and unqualified, and this
page has none.

`Podroll` is used as the term of art rather than explained, which is the one
place a spec name is a user-visible label. That is not the NIP-73 case: NIP-73 is
the *mechanism* behind a number, so naming it explains nothing to a reader
wondering why their community is missing, where a podroll is the **subject** of
the section — the tiles beneath it define the word, and a publisher who already
knows it is looking for exactly that word.

**A titleless card is dropped rather than labelled.** All four in the live corpus
have no artwork either, so the tile would be empty. This is the one place the
site does *not* fall back to "Unidentified show" — that label works in a list of
names and figures and reads as a bug in a grid whose entire content is names.

**⚠️ These are the only two queries on the page allowed to fail quietly**, and
the reason is the write path. Every other table there rides the collector's
hourly boost delta; `podroll` is replaced wholesale by a separate **daily** pass
(`d1_sync.py --remote-podroll`). A remote carrying every other table but not yet
this one is a normal intermediate state of a deploy, and it must not turn 930
show pages into 500s to report a section 93% of them don't render. A failure
degrades to no section, which is what a show with no podroll gets anyway. If the
sections are missing everywhere, that is the thing to check first.

## Show pages: the description

The publisher's own summary of the show, between the hero's identity block and
the `Nostr Boost Stats` tiles. `fetchShowDescription` / `renderDescription` in
`functions/show/[guid].js`, `.show-desc` in `show-page.css`,
`assets/js/show-desc.js` for the toggle.

**⚠️ It is fetched per request rather than stored, and that is the decision.**
Nothing in D1 or the shards carries it: `podcasts` holds title, image, artwork,
feed_url, medium, author and the three boost aggregates, and a shard's `show`
object is `{guid, title, img, feed, medium}`. Storing it means a schema
migration, a backfill across ~930 shows and a field on every enrichment tick
that has to be re-fetched to stay current, all to cache a string Podcast Index
already serves and already caches for us. `enrich.py` calls
`podcasts/byguid` for every show it identifies; this reads the same object one
field further across. **No change to any collection run.**

`fulltext` is what makes it whole, the same parameter and the same reason as
`/api/episode-meta`: without it PI cuts every text field to 100 words, so a
stored copy would have been the clipped version anyway.

**It is the one outbound third-party fetch inside a show-page render**, which is
what the three properties below are for:

- **It runs inside the existing `Promise.all`** with the six D1 queries, so the
  page pays `max(D1, PI)` rather than the sum. `piGet` sets `cacheEverything`
  with an hour's TTL and a show page is the same request for every reader, so
  after the first reader in a colo it is a cache hit.
- **The timeout is 2.5s**, against `/api/episode-meta`'s 10s. That endpoint
  fills a drawer after paint; this is on a reader's TTFB, so a slow upstream has
  to cost a paragraph rather than a hung page.
- **It never rejects and never throws.** No description, a show PI has never
  seen, unconfigured keys, a timeout and an outage all produce the same empty
  array, and the page renders exactly as it did before the feature existed.

**`og:description` is deliberately not sourced from it.** That string is
synthesized from the boost data and is the only place the full scope sentence
survives; see the note over `ogDesc`.

**The clamp is applied by JavaScript, not shipped in the markup.** The page
renders the description in full and `show-desc.js` collapses it to three lines
and adds the **More** control, only when the text actually overflows — so a
short description never grows a control it doesn't need, and a reader with no
JavaScript gets the whole thing rather than three lines with no way to reach
the rest. Same direction as the "Show N more" toggles. It re-measures after
`document.fonts.ready` (the body copy is a self-hosted serif, and the fallback
metrics can cross or clear three lines) and on a debounced resize, but never
re-collapses a description the reader expanded.

**It is a new module rather than a ninth export from `detail-page.js`**, which
is the `feed-note.js` shape and the rule from the `ob-v53` outage: a stale
`detail-page.js` against a fresh `show-page.js` is a link-time error that takes
the page's whole JavaScript down, where a new URL can only resolve or 404.

### The two shared server modules

Both were moved out of `functions/api/episode-meta.js` verbatim when this
landed, since a show description and an episode's show notes are the same field
at two levels:

| | |
|---|---|
| `functions/_shared/podcast-index.js` | `piHeaders` + `piGet` — auth, the timeout, and the colo cache. **⚠️ `/api/value` keeps its own copy deliberately**: it resolves value blocks, where a wrong answer moves sats, and a metadata lookup must never share a code path with it. |
| `functions/_shared/rich-text.js` | `parseNotes` — publisher HTML → paragraphs of `{t:"text"\|"link"}` tokens. Client-side it becomes text nodes and anchors (`paintNotes`); server-side every field is escaped individually (`renderDescription`). Either way **nothing it returns can reach `innerHTML`**. |

One behaviour changed in the move: `OPAQUE_TAG` now discards the *content* of
`script`, `style`, `noscript`, `iframe`, `template` and `svg`. Nothing there
could ever have become markup, but a feed that pastes a tracking snippet into
its description used to print the script's source as a paragraph. This applies
to the episode notes drawer too.

## Episode pages

`/episode/<item-guid>`, rendered by `functions/episode/[guid].js`. **The same
page as `/show/<guid>`, one level down**: the hero, the `Nostr Boost Stats`
tiles, the Nostr Community wall and the boost list are the same components, and
both pages call them from the same two files. What differs is the subject, three
sections that don't apply, and one that only exists here.

| | `/show/<guid>` | `/episode/<guid>` |
|---|---|---|
| Hero | show art, eyebrow "Show", Boost this Show | **a player card**: episode art, eyebrow **is the show's name and links to its page**, Boost this Episode, View Show, an audio player, and the chapters and show-notes drawers |
| Stats | show totals | that episode's |
| `#episodes` | the show's episode drawer | — no equivalent |
| Community rollup | `#community-shows` — other shows | `#community-episodes` — other **episodes**, as full feed cards |
| `#community` | boosters of the show | boosters of the episode |
| Podroll | both directions | — a podroll is a show-level tag |
| `#boosts` | Recent Boosts, capped at 24 | **Episode Boosts, all of them** |

**The three ids are frozen** the same way the show page's six are, and two of
them are deliberately the *same* ids: `#community` and `#boosts` name the same
section on both pages, so a reader who has learned one URL has learned both.
`#community-episodes` and `#community-shows` are different sections listing
different things, so they don't share one.

**Qualifying rule: the episode has a title.** 6,682 of the 7,182 episodes
carrying an indexed boost do; the other 500 are boosts tagged with an item guid
Podcast Index can't identify, so there is nothing to render — the same rule and
the same reasoning as a titleless show. A missing *show* is not disqualifying: 23
titled episodes carry no podcast guid, and those lose the eyebrow link and the
boost button and keep everything else.

**⚠️ When there is no page, the reader is redirected to the SHOW rather than
404'd** — `noEpisodePage()`, one indexed lookup on the miss path only. It joins
`boosts` to `podcasts` so the target is confirmed to have a title, which is
exactly the rule `/show/<guid>` applies, so it can never hand over a second 404.
A failed lookup degrades to the 404 rather than a 500.

It exists because **the two halves of the pipeline can disagree, and this page
cannot see the disagreement.** A feed card links an episode when the BOOST RECORD
carries a title, which comes from the collector's static exports; this page
renders from D1's `episodes` table. Measured 2026-08-01: the manifest reported
`eps_enriched: 6755` against `episodes: 6688` in D1, so **~1% of the episode
links the site rendered resolved to nothing** — including real episodes with
double-digit boost counts. The cause is upstream, in `d1_sync.py`'s delta path:
it pushes an episode only in the tick where a boost for it arrives, and silently
skips it when enrichment hasn't yet written the local row, never revisiting it.
An episode enriched after its last boost therefore never reaches D1 while looking
complete in every static export. **The fix belongs in the collector; this is the
graceful failure while any such skew exists.**

It covers the permanent miss too — the 434 episodes with no title and nothing to
enrich — whose show is usually known perfectly well.

**302, never 301.** Both cases are expected to resolve, and a permanent redirect
is cached by browsers indefinitely, so it would keep sending readers to the show
long after the episode page started working. The target is the bare `/show/<guid>`
and deliberately not `#episodes`: that anchor opens the show's episode drawer,
which is built from the same `episodes` table that just missed, so it is
precisely the list this episode is not in.

**⚠️ `item_guid` IS NOT ALWAYS A UUID, and it is the URL key.** 9% of the
distinct guids contain a slash and 30 are full http(s) URLs, so it is only ever
`encodeURIComponent`d and bound, never parsed or split. Cloudflare Pages keeps an
encoded `%2F` inside one path segment rather than routing on it, so `params.guid`
arrives encoded and `decodeURIComponent` recovers the original — **verified
against production** (`/show/https%3A%2F%2Fexample.com%2Fa%2Fb` echoes the
decoded string back in its 404) before the page was written.

**Every episode link on the site resolves here** — the Episodes and Songs cards'
artwork, title and "See all boosts", the Boosts cards' episode title, the `/show`
episode drawer's rows, and the URL in a published boost note. See "Every Episode
Link Points at `/episode/<item-guid>`" above for the full set and for the two
show-level links that deliberately still leave the site. It is the same move the
show name made when `/show/<guid>` landed: the name of a thing points at the page
for that thing.

`show-link.js#episodePageHref` owns the rule for the client surfaces, next to `showPageHref` so the two
cannot drift. **The qualifying test is the TITLE, not the guid**, and that is not
the show rule: the page is keyed on the item guid alone and renders for the 13
episodes in the corpus whose show is unidentified, losing only the eyebrow link
and the boost button. Measured over the full 22,366-boost corpus, the rule links
**6,682 of 7,182** episodes — exactly the collector's own `eps_enriched`, which
is what fills the D1 `episodes` table — and the 500 it declines are the ones that
render as "Untitled episode" and fall back to BMB. 947 of the linked guids are
URL-shaped and all round-trip through one path segment.

`functions/show/[guid].js#episodePageUrl` restates it for the server-rendered
drawer rows, because nothing in `functions/` can import a client module, and
`episode-link.js` restates it again for the note path. **Three copies of one
test, and they must agree**; each is marked.

### The Player Card: Chapters and Show Notes

**One card holds the recording.** The artwork, the title, the credit, the
actions, the audio element and two `<details>` are inside a single bordered
surface (`.ep-card`, a delta in `episode-page.css` scoped to
`.show-main--episode`); the `Nostr Boost Stats` tiles sit outside it on the page,
because they are about the episode's *boosts* and they are the same tiles `/show`
carries in the same place. localbitcoiners' episode pages are the model, down to
the drawers **bleeding to the card's edges** rather than sitting inside its
padding as nested boxes — that is what makes the card read as one object with
bands instead of a panel holding two panels. The negative margins therefore have
to track the card's padding, in the base rule and in the 640px block both.

Both drawers reuse `.ep-drawer` from `show-page.css` unchanged — the sunken band,
the SHOW/HIDE word, the rotating chevron — so a reader who has opened the episode
drawer on `/show` has already learned the control.

LB's chapter list ships open; **both of these ship collapsed**, because that page
is one show's own episode page with nothing under it where a forty-row list here
would push the stats, the community wall and the boosts off the first screen.
**Neither summary carries a count.** The chapters one shipped with a chapter
count for a day and it came off: it was defensible on its own terms (a chapter
count is a complete fact about the publisher's file, not a figure bounded by our
coverage the way the show page's would be), but a lid that sometimes carries a
number and sometimes does not is a worse rule than one that never does.

**Show notes are server-rendered from D1 and then replaced; chapters cannot be
server-rendered at all.**

| | Show notes | Chapters |
|---|---|---|
| First paint | `episodes.description`, already on the row the page selects | — |
| Then | replaced from `/api/episode-meta`, untruncated and with its paragraphs | filled from the same response |
| JavaScript off | reads, truncated | **absent**, like `#community-episodes` |
| Coverage | 99.5% of episodes | ~45% of items on the boosted feeds |

**⚠️ D1's copy is truncated, and the truncation is Podcast Index's.** PI cuts
every text field to 100 words unless the request carries `fulltext`, which
`enrich.py` does not send — so the collector stored a prefix. Measured over 2,218
episodes in the live index: 99.5% carry notes, median 590 characters, maximum
1,055, and 0.6% cut mid-sentence. `clean_html` then collapses all whitespace, so
the publisher's paragraph breaks are gone too. **Both are why the drawer's text is
replaced rather than decorated**: `/api/episode-meta` asks for `fulltext` and
parses the HTML back into paragraphs. The collector could fix half of this at
source by adding the parameter; the chapters half of the endpoint would still be
needed.

**`functions/api/episode-meta.js` is one PI call serving both fields.**
`episodes/byguid` returns the episode object, which carries `chaptersUrl` *and*
`description`. It resolves the episode in one hop when a `podcastguid` is passed
(an accepted parameter, confirmed against PI's OpenAPI source), with
`/api/value`'s feed-id resolution as the fallback, then fetches the chapters file
under the house bounds: timeout, byte cap, streamed read.

Four things about it that are load-bearing:

- **Every failure answers `200` with empty fields.** Both are additive, and a 500
  would be a broken drawer on a page about boosts. The two halves are
  independent: the notes ride every exit, including the ones where the chapters
  fetch failed.
- **`notes` absent ≠ `notes: []`.** An empty array means the episode has none and
  the client would blank the drawer; a missing field means the lookup told us
  nothing and the truncated server-rendered set stands.
- **⚠️ Notes come back as a TOKEN TREE, not HTML** — paragraphs of
  `{t:"text",v}` and `{t:"link",href,v}` — and the client builds text nodes and
  anchors from them. Returning cleaned markup would be one `innerHTML` away from
  a third-party description writing into the page. Anchors are kept because a
  publisher writes "get the book here" with the URL only in the `href`, so LB's
  strip-and-linkify would leave the sentence pointing at nothing.
- **Two cache lives.** A resolved answer holds for six hours; a timeout or an
  upstream error is not an answer at all and holds for five minutes. Same
  principle as the podroll collector's rule that only a clean read may overwrite
  a stored list. The chapters URL is publisher-controlled and reaches an outbound
  fetch, so it is http(s) only, no embedded credentials, bounded length; untitled
  and `toc: false` entries are dropped, being ad and segment boundaries rather
  than chapters.

The chapters drawer **ships empty and hidden**, which is the opposite of what
`#community-episodes` does and correct for the same reason. That section needs a
zero-height sentinel because an `IntersectionObserver` never fires on a hidden
target; this one sits above the fold and is fetched unconditionally on load, so
nothing observes it, and a visible-but-empty drawer would be a lid over nothing
on the ~55% of episodes that publish no chapters. It is withheld outright when
there is no enclosure to seek. The notes drawer ships hidden too when D1 had
nothing, since PI sometimes has notes for an episode whose row does not.

**No Download MP3, no transcript link, and no subscribe menu**, all three of
which LB's player card carries. The download button is the same call the episode
cards already made and lost: every browser's native audio controls carry Download
in their own ⋮ menu.

Clicking a chapter row seeks the player and starts it; the row covering the
playhead takes `.is-active` as playback advances. The element is `preload="none"`,
so on a first click there is no duration yet and assigning `currentTime` is
dropped — `play()` is what triggers the load, so the assignment is queued behind
`loadedmetadata` and applied there.

### Other Episodes/Songs This Community Boosts

The episode-level counterpart of the show page's community drawer. It was the
one section on either detail page that was **not** server-rendered, and as of
2026-08-14 it is — see "The Exception Is Closed" above.

**It is the same OBJECT as its show-page counterpart, down to the class list**:
an `.ep-drawer` whose `<summary>` is the heading, the range and sort band inside
the lid on the shared `.cs-controls`, and the list beneath — the same box both
drawers on `/show` are. It shipped first as a plain `<section>` with an `<h2>`
and a control row under it, which made one component look like two things
depending on which page you were reading. The summary carries a second line,
"Other show's episodes boosted by people who boosted this episode", set as a
caption under the title rather than in the band below it, where it would have
crowded the range buttons off a phone.

The community is the set of pubkeys that boosted this episode; the section is
every other episode those pubkeys have boosted, painted as **the Episodes feed's
own card** — artwork, air date, the `Nostr Stats:` line, the boost pill, the ⋮
subscribe menu, an audio player, and the `Nostr Interactions:` drawer with a
reply / like / repost / zap bar on every boost note inside it. It carries the
same 1W/1M/All range and the same five sorts, tagged **`Community Sort:`** rather
than `Sort:` for the same reason the show page's is: every figure on a card is
what *these* boosters sent, never the episode's global totals.

**The card is one definition now, so the section is server-rendered.** The
Function fetches the corpus inside its existing `Promise.all`, ranks it with the
shared comparators and paints the first thirty cards; `episode-section.js`
attaches the controls and the verbs. A reader with no JavaScript gets the list,
the artwork, the figures and every boost note, and loses the re-sort, the range
and the reactions — exactly the line the rendering rule draws. **The section is
omitted outright when the corpus is empty or the query failed**, because an empty
heading over nothing is worse than no heading; 6.1% of episodes land there.

**`assets/js/episode-section.js` is this section AND `/booster`'s `#episodes`.**
They were two near-identical client implementations, each carrying its own copy
of the comparators with its own note explaining why; the difference between them
is now a copy table — the corpus, the opening sort, the sort menu and three
strings.

**The corpus is no longer fetched on approach.** It is fetched on the first
control change or the first "Load more", which are gestures with somewhere to
show a loading state. The old version pulled it unconditionally as the section
neared the viewport — a median ~75KB gzipped and up to ~600KB at the cap — for a
section most readers scroll past. What IS still deferred to approach is the verb
layer, which is where the boost widget and (on a drawer open) the reaction
machinery come from.

**⚠️ "Load more" skips what is already on screen, and that guard is not
paranoia.** On the first press the cards in the DOM are the server's, ranked when
the page was rendered and edge-cached for up to five minutes; the corpus just
fetched is current. A boost landing in that window can shift the top thirty, so
appending blind would repaint a card the reader is looking at. It compares guids.

**Not split on medium**, which every other rollup on this site is — the same call
`renderCommunityShows` makes, for the same reason: a music community also
boosting podcasts is the interesting half of the finding. Hence
"Episodes/Songs" on both mediums and no `COPY` entry.

**⚠️ The whole of the subject's SHOW is excluded, not merely the subject
episode.** The section answers "what *else* does this audience listen to", and a
community that boosts one show heavily fills the list with more of that show —
the one thing the reader is already looking at and can reach from the eyebrow
link. Measured over a 900-page sample it removes a median of **7.8%** of the list
(mean 15.3%) and takes the share of pages with nothing to show from **3.3% to
6.1%**; those are communities that have boosted nothing but this show, where no
section is a truer answer than the same show again. The clause is
`(b.podcast_guid IS NULL OR b.podcast_guid <> ?)` — the `IS NULL` half **keeps**
episodes whose own show is unidentified, because we cannot know they belong to
this one and dropping them would be a claim. A subject episode with no show falls
back to excluding only itself.

**The cards sit in a scroll container** (`.ce-scroll`), the same shape the show
page's community drawer uses. Not the same number: `.ep-list` caps at 32rem,
which shows eleven 44px rows and would show two and a half ~180px cards here, so
this caps on the viewport instead — `min(75vh, 46rem)`. The "Load N more" is
**inside** it, so the section is one box rather than a window with a button
underneath, and a re-sort or a range change resets `scrollTop` so the reader
lands on the new #1 rather than mid-ranking.

**The container clips the two ⋮ menus**, which are `position: absolute` — the
card's subscribe menu and the per-boost one. They still contribute to the
container's scroll height, so an opened menu is reachable rather than lost, and
`episode-card-actions.js` calls `scrollIntoView({ block: 'nearest' })` on open, which is
a no-op when the menu is already visible and therefore costs the homepage
nothing. The alternative is a portal or a popover, which is a rewrite of a
component both surfaces share. That trade is the price of the container.

**The corpus is capped at 2,000 boost rows and says when it capped.** Measured
over all 22,366 indexed boosts, the fan-out behind this runs to a **median of 248
rows across 189 distinct other episodes, a p90 of 1,171 and a maximum of 3,368**,
so 2,000 truncates 1.6% of episodes. It is ordered newest-first, so a truncated
corpus is a recent prefix of the community's history rather than an arbitrary
slice — the same trade `ob-live.js` makes for the Follows feeds. The note under
the last page of cards passes that on rather than letting a ranking over a prefix
pose as a ranking over everything.

`GET /api/v1/episodes/<item-guid>?community=1` is where it comes from. The
endpoint returns the **standard boost record shape**, so the client runs it
through `ob-data.js#normalizeBoosts` → `toEpisodeShape` → `buildEpisodes` and the
cards are built from the same model as the feed's. A deduped side-table shape was
measured and rejected: it saves 27% of the gzipped bytes and costs the one data
model everything downstream of a fetch shares.

**Rank first, filter second**, the same ordering the feeds' search contract
depends on: rank over the whole window, then paint. Ranks are shown only on the
quantitative sorts (`RANKED_SORTS`), because a numeral under "Latest boost" reads
as a score when it is chronology.

### What the two pages share, and where it lives

Four files, and the split is server / client rather than show / episode:

| | |
|---|---|
| `functions/_shared/detail-page.js` | escaping, the stat-tile number and date formats, the bech32 decoder behind the `@Name` chips in a boost message, `renderSupporters` (the community wall) and `renderBoosts` |
| `assets/js/detail-page.js` | the back link, the section deep-links, the hash spy, copy-npub, "Show N more", the `art2` fallback, share, and the Primal profile backfill |
| `assets/css/show-page.css` | linked by both; the episode page reuses its `.show-*` classes verbatim |
| `assets/css/feed-cards.css` | the episode card, **extracted from `index.html`'s inline `<style>`** so the episode page could link it |

All of it came out of the show page unchanged — these are moves, not rewrites.
The episode page keeps the `.show-*` class names on identical boxes deliberately:
a parallel `.episode-*` set would be a rename with no meaning behind it, the same
call the site already makes for `lb-*` and `.sup-*`. `assets/css/episode-page.css`
carries only the deltas.

**`feed-cards.css` is a real extraction, not a restatement.** show-page.css
*restates* the `.pcast-sort` rules under `.cs-controls` because that is one
control; this is 370 lines, so index.html now links the file instead of holding
it inline. That is why `sw.js` needed a `VERSION` bump — a returning visitor
holding the precached `index.html` would paint every feed card unstyled until the
new file fetched, the same shape as the `ob-v9` bump that moved the theme tokens
out of the same block.

**One behavioural change fell out of the move**: the hash spy now skips a section
with no height. `#community-episodes` ships `display:none`, which reports a
`top` of 0 — always under the line — so without the skip the spy would name it
while the reader was still at the head of the document.

**Sitemap: the substantial episodes only.** 6,682 qualify for a page against 934
shows, and the median one has **one booster and two boosts**. A page built on one
boost is worth existing — it is what a shared link resolves to and it carries a
proper share card — and is thin to put in front of a crawler, so
`functions/sitemap.xml.js` lists the **2,027** with three or more distinct
boosters and leaves the rest to be found by link. Both halves carry canonical and
OG tags either way; those are about the share card, not about crawling. The
episode query is a `GROUP BY` over the whole boosts table where the show one is a
single indexed scan, so it has its **own** `try` — a failure there must not cost
the show entries that already succeeded.

## ⚠️ Show-level boosting, and the one boost button

Boosting a SHOW (as opposed to an episode) pays the **feed-level** value block —
`/api/value` with a `podcastGuid` and/or `feedUrl` and no `guid`.

**Every boost affordance on a card is the same control**: the button built by
`assets/js/boost-button.js`, styled as `.ob-boost-pill` in **theme.css** (there,
not in a page's own stylesheet, because it is the one class the homepage and the
show pages both need — same reasoning as `.ob-scopenote`). It reads `--brand`,
never `--accent`: the feed accents only exist on `index.html`.

It rides the **right end of the card's Nostr Stats line**, pinned there by its
own `margin-left: auto`, which is what let it replace a labelled pill in a button
row of its own that cost a whole band of card height.

**Solid brand blue, the word "Boost", and no bolt.** An icon-only circle was
tried between those two and was too small a target to read as the card's primary
action; the bolt inside it bought nothing the label doesn't say. Tight padding is
what keeps it on the stats line instead of taking a row.

| Surface | Handler | Pays |
|---|---|---|
| Episodes / Songs cards | `episode-card-actions.js#onBoostClick` | that episode |
| Shows / Albums cards | `shows-feed.js#onShowBoost` | that show's feed block |
| `/show` community drawer rows | `show-page.js#onCommunityBoost` | another show's |
| `/show` hero button | `show-page.js#initBoosting` | this show's |
| `/episode` hero button | `episode-page.js#initBoosting` | this episode |
| `/episode` community cards | `episode-card-actions.js#onBoostClick` | another episode |
| `/booster` episode cards | the same | another episode |

The last two rows are not extra handlers: those cards **are** the Episodes feed's
cards, and since the card became one definition all four episode-card surfaces
share **one** boost path rather than the feed owning it and two page modules
borrowing it. The handler reads the card's own data attributes, because the card
it is attached to may have been built by a Pages Function that finished running
before the module loaded.

**`boost-button.js` is chrome, not a money path.** It builds a button and
reports clicks; each caller owns its own resolve-and-pay sequence, because what
a boost pays differs by surface. All of them go through
`fromApiValue` → `applyExternalOverrides`, which is where split logic belongs.
Sharing the button and not the handler is the seam on purpose — do not fold the
handlers together here.

The show page's drawer rows are server-rendered, so `functions/show/[guid].js`
emits the same markup by hand rather than calling the builder; the class name
and the busy/disabled states are the contract between the two.

**The community drawer is the only place on the site that pays a show other than
the one the surface is about.** The target guid and feed URL come off the row's
own data attributes and are threaded through `resolveValue` *and* `openBoost`
together — passing a guid to one and not the other would resolve one show's
splits and label the published note with another's.

**It does not probe.** The hero button reveals itself only after a value block
resolves; a page can carry 150 community rows, so those reveal optimistically
and resolve on click, reporting an unpayable show in a toast at that point. The
feed cards likewise. Withheld entirely from unidentified shows, which have no
Podcast Index record to resolve.

Verified against production for a live feed: five legs parsed, five legs after
overrides, identical leg for leg — including the `boostbot@fountain.fm` leg that
the LB override in `8bc4cf9` used to rewrite. Re-run that check after any
restore from `lb/main`.

**The episode cards' "↓ Download MP3" button is gone.** Every browser's native
audio controls already carry Download in their ⋮ menu, and it cost a full row of
card height to duplicate that. The blob-fetch trick it used (a plain
`<a download>` is ignored cross-origin without `Content-Disposition`) is in git
history if a surface ever needs it again.

## Show artwork: the `art2` fallback

Some feeds publish two different artwork URLs, RSS `<image><url>` and
`<itunes:image>`, and the first is sometimes dead while the second resolves.
Homegrown Hits is the case that prompted it. The collector now publishes the
second as **`art2`**, null when identical to `img`, and
`assets/js/cover-art.js` walks the chain on error.

```
episode art  →  show art (img)  →  show art2  →  glyph / placeholder
```

`coverChain()` filters to http(s) and **dedupes** — `art2` is meant to be null
when it equals `img`, but the shards are third-party data and a repeat would
cost a second request for the URL that just failed. `wireCoverFallback()`
advances on each error and clears its own handler at the end, so an unreachable
placeholder cannot loop; it returns `false` for an empty chain, which is the
caller's cue to render its no-art state rather than an empty `<img>`.

Wired at four sites: `ob-data.js` carries `podcast.art2` through
`normalizeBoosts` and builds `imageChain` in `toEpisodeShape`; `shows-feed.js`
reads `art2` off both the all-time rollup and the windowed grouping;
`boosts-feed.js` puts it in the booster-avatar chain; `feeds-podcasts.js` uses
the episode chain.

**`art2` is now on both sides.** The collector's `shows.artwork` column and its
`art2` shard projection landed in `cc68da3`; the remote D1 `podcasts.artwork`
column was added and backfilled out-of-band, and `d1_sync.py` un-gated the
projection in `6be0eb5`. So the D1-backed surfaces carry it too:

| Surface | Source | Chain |
|---|---|---|
| Episodes / Songs cards | shard | episode art → show img → show art2 → glyph |
| Shows / Albums cards | shard | img → art2 → glyph |
| Boosts cards | shard | booster pic → show img → show art2 → silhouette |
| `/show` hero | D1 `artwork` | img → `data-art2` → blank tile |
| `/episode` hero | D1 `episodes.image` + `podcasts.artwork` | episode img → show img (`data-art2`) → show art2 (`data-art3`) → glyph |
| `/show` community drawer rows | D1 `artwork` | img → `data-art2` → glyph |
| `/show` podroll tiles | D1 `podroll.*_artwork` | img → `data-art2` → glyph |
| `/api/v1/podcasts`, `…/<guid>` | D1 `artwork` | returned as `art2` |

**The community drawer row was the surface this was missed on**, and it is the
one where it mattered most: those rows are *other* shows' artwork, so a single
show with a dead primary rendered broken on every page that lists it while its
own page had already recovered. The cause was the query rather than the render —
the community CTE selected `p.image` and not `p.artwork`. All three `/show`
surfaces now run through one `wireArt2()` in `detail-page.js` — the hero, the
community rows and the podroll tiles, the last of which is the same case again:
8 of the 371 podroll edges carry an art2, and Homegrown Hits (the show the whole
chain exists for) is in Bowl After Bowl's podroll.

**The episode drawer's rows are deliberately still outside this.** A row falls
back to the show's own `img` when the episode has no art of its own, and does not
go on to `art2`; see the note over `episodeRow`. It bites only where a show has a
dead primary *and* an episode with no art, and episode art was 100% present on
every show sampled.

The episode hero is the one surface whose chain is **two** fallbacks long rather
than one, because an episode with no art of its own falls back to the show's
primary before the show's second chance — the same order `toEpisodeShape` builds
for the feed cards. `data-art3` is that third link and exists nowhere else;
`wireArt2` reads both attributes and `coverChain` dedupes, so a show whose
`art2` equals its `image` still costs one request rather than two.

**On `/show` it is a `data-art2` attribute, not a second `<img>` or an inline
`onerror`.** The Function emits the attribute and `detail-page.js#initArt2`
wires the swap through the same `cover-art.js` helpers the feeds use, so there
is **no fetch at all** and the house's no-inline-handler convention holds. It
also handles the case the deferred module can't observe directly: the hero is
`loading="eager"`, so it may have already failed by the time the module runs,
which `img.complete && !img.naturalWidth` detects.

**`og:image` stays on the primary, deliberately.** A crawler cannot run the
error handler, so the temptation is to prefer `art2` there — but `art2`'s
presence means the feed publishes *two different* URLs, not that the primary is
dead. Measured over all five shows that carry one: **four primaries return 200
and one 404s** (Homegrown Hits). Preferring art2 would swap four working share
cards to fix one.

An earlier pass routed the hero's fallback through `/api/value`, which already
fetches the Podcast Index feed object and so could return the art for free. That
was a workaround for D1 not having the column, and it was **reverted** once it
did — `/api/value` is a money path and carrying show metadata on it earned its
keep only while there was no alternative.

Live coverage is small and real: 5 of 1,287 shows in the index, 20–31 boosts per
recent month archive.

## Show pages: the medium, and nostr: mentions

`functions/show/[guid].js` has a `COPY` table keyed on `show.medium`, the same
arrangement as `shows-feed.js` and `feeds-podcasts.js`: a `music` feed says
Album / album / "Boost this Album" / Tracks / "Track 3" / `MusicAlbum` JSON-LD,
everything else says Show / show / Episodes / "Ep. 3" / `PodcastSeries`. The
medium changes the words and never the layout, so a third medium is a third
entry in that table rather than a second page. `copyFor()` defaults to
`podcast`, matching the namespace default and the reasoning in the medium-split
section above.

**Boost messages render `nostr:` URIs server-side.** The two client feeds get
this from `boosts-thread.js#parseSegments`; the show page cannot, because
importing that module means shipping `boosts-thread.js` (30KB) +
`calendar-events.js` (24KB) + `nostr-tools` (102KB) to a page whose whole design
is that it reads with no JavaScript. So `[guid].js` carries a ~70-line bech32
decoder and a `renderMessage()` that emits the identical `.nostr-mention` chip.

Three things about it that are load-bearing:

- **The checksum is verified**, and an identifier that fails it renders as plain
  text rather than a link. A corrupted npub would otherwise resolve to somebody
  else's profile. It also resolves the one tokenizing edge case for free: `n` is
  in the bech32 charset, so two mentions run together with no space match one
  character too many, and that over-long capture fails the checksum.
- **Nothing is re-encoded.** Links use the identifier exactly as it appeared in
  the note, so only decode is implemented; the decode exists purely to look a
  display name up in `profiles`.
- **The name lookup is one extra query, bound with placeholders, not
  `json_each`.** `BOOSTS_SHOWN` is 24, so the list is always far inside D1's
  100-parameter ceiling (and it is sliced at 90 regardless). The follows
  endpoint needs `json_each` because its author list runs to thousands; here it
  would only add a dependency on a table-valued function Cloudflare does not
  document.

`.nostr-mention` inside `.boost-msg` is styled in `show-page.css`, restating
what `boosts-thread.css` does under `.note-body`, because the show page does not
load that stylesheet. **Keep the two matching.**

## Profile fallback

**An identity the index doesn't have falls back to Primal's cache before it is
allowed to render as `@npub1abc…`.** `assets/js/primal-profiles.js` owns that
lookup (`fetchProfiles`, chunked at 100, never throws). It was extracted from
`boosts-thread.js` — which now imports it, and still owns `profileCache`, the
thread queries and the chip builder — so `/show` pages can use it without
pulling in 156KB of thread machinery.

The index stays the fast path. The collector embeds a booster's name and
picture in every record, which is what makes first paint final; this only fills
two holes it cannot cover:

- a booster whose kind-0 was unresolved when the collector last ran;
- **an npub mentioned inside a boost message**, who need never have boosted
  anything and so is in no table of ours at all. This is the common case.

| Surface | Boosters | Mentions |
|---|---|---|
| Episodes / Songs | Primal (`hydrateProfiles`, off `data-pk`) | same pass |
| Boosts | Primal (`hydrateProfiles`, post-paint per page) | same pass |
| `/show/<guid>` | Primal (`hydrateProfiles` in `detail-page.js`) | same pass |
| `/episode/<guid>` | same module, same pass | same pass |

Primal is a **cache, not a relay fan-out**: one WebSocket, one batch, ~6s
timeout. A normal client would ask relays; this answers a page of pubkeys in a
single round trip, and it's the same fallback localbitcoiners.com leans on.

Two invariants worth keeping:

- **It is always post-paint and best-effort.** Every surface renders complete
  and readable from the index alone; an unreachable cache changes nothing, and
  the show pages still work with JavaScript off. Never make a first paint wait
  on it.
- **The show page marks its own gaps.** The Function emits `data-pk` +
  `data-missing="name pic"` on exactly the supporter cards, boost rows and
  mention chips it couldn't fill, and `show-page.js` patches those and removes
  the attribute. Don't let the client re-derive what the server already knows.

The Boosts feed **rebuilds the card** rather than patching it, seeding
`setCachedProfile` first so the mention chips inside the message body agree with
the avatar and the display name above them.

## Show credits: `author`

`podcasts/index.json` carries **`author`** (`<itunes:author>`), added by the
collector on `47d9469` and backfilled across all 924 identified shows. Measured
over the shipped index, counting non-empty values that aren't just the title
repeated:

| | pages | usable | coverage |
|---|---|---|---|
| music | 466 | 454 | **97.4%** |
| podcast | 460 | 405 | **88.0%** |

The collector's own scoping probe put this at ~38% / ~52%; the gap is that it
judged *quality* (excluding networks and taglines by eye) where the table above
applies the mechanical rule the site actually implements. **Measure off the
shipped index, not the probe.**

On a music feed `author` is the artist and is clean. On a podcast it is whoever
the publisher named there: usually the host (`Guy Swann` → Bitcoin Audible),
sometimes a network (`Jupiter Broadcasting`), occasionally a tagline. So:

- **Never label it "Host" or "Creator".** `Artist` on music, a softer `By` on
  podcasts. "By Jupiter Broadcasting" is true; "Host: Jupiter Broadcasting" is
  not.
- **The only filter is the title repeat** (normalize case, whitespace and a
  leading "The"). Do not build a tagline detector: any rule sharp enough to
  catch "Bitcoin is for Everyone" also eats real names, and a wrongly suppressed
  credit is worse than an odd-looking one.
- `medium` defaults to `podcast` for a feed that declares none, so an untagged
  music feed gets `By` rather than `Artist`. Consistent with the partition rule
  in the medium-split section, and a known consequence rather than a bug.

**Built: search.** `ob-data.js#getShowAuthors` joins guid → author off the same
cached rollup `getShowMediums` reads, so it costs no request, and `shows-feed.js`
puts it in the search entry's `extra` — matched, never displayed. An author hit
scores below every title hit through the existing ladder. Not in `sub`: it would
push the show's own numbers off a narrow card, and a name is a way *in* rather
than a way to tell two similar results apart.

**Built: the credit line on `/show/<guid>`.** `creditLine()` in
`functions/show/[guid].js`, between the `<h1>` and the "Last boosted" sub-line,
labelled off the `COPY` table's `credit` field. The page reads **D1**, not the
shards, so this needed the collector's `cf6ac14` migration before it could
render at all; the search half shipped first precisely because it reads the
static rollup instead.

It prints nothing at all in two cases, and both matter more than they look: an
empty author, and one that merely repeats the show title (~7% of rows) after
normalizing case, punctuation and a leading "The". `.show-credit` has no
reserved space, so a suppressed credit costs no layout.

**`author` is also returned by three `/api/v1/*` endpoints** (`podcasts`,
`podcasts/<guid>`, `search`). Nothing on this site consumes those — they are the
public API surface — so that is about keeping the API consistent with the shards,
not about a feature.

**One thing the handoff asked for that is NOT in this lane:** making author
*matchable* in `/api/v1/search`. That endpoint matches through `podcasts_fts`,
an FTS5 virtual table declared `fts5(podcast_guid UNINDEXED, title)` in
`d1/schema.sql`. Adding author to the index is a collector-side schema change
plus a repopulate; a SELECT cannot do it. The client feeds are unaffected, since
they match on the static rollup.

Still open: `og:title` for music becoming "<artist> — <album>", which would
improve the share card on ~97% of album pages.

## Not indexed: `podcast:person`

`<podcast:person>` is **not** in this pipeline and deliberately isn't being
added. The collector probed it and found ~6% coverage, confirmed against raw
feeds rather than the API, so it is not a Podcast Index limitation: the tags
genuinely aren't in the feeds. A credits section built on that is the near-empty
block that is worse than nothing. Revisit only if we ever parse channel-level
RSS ourselves *and* a wider scan changes the number.

`ownerName` is also not indexed, and that is the more useful finding: every show
carrying one **also** carries an `author`, so it never fills a blank. It is not
a fallback. Don't re-add it.

`author` itself did ship; see the section above.

## Podroll: the first field we parse from raw RSS

`<podcast:podroll>` — a publisher's own list of other shows worth hearing —
**is not in Podcast Index**. Its feed object has no podroll field (`artwork,
author, categories, … value`, measured) and `/podcasts/bytag?podcast-podroll`
returns zero feeds where `?podcast-value` returns results. Every other show
field rode along on a PI call `enrich.py` already made; this one could not, so
`podroll.py` fetches the show's own feed. **It is the only pass in this
pipeline that touches third-party RSS**, and that shapes all of it.

**Daily, never hourly** (`onlyboosts-podroll.timer`, 09:40 UTC). A podroll
changes when a publisher edits their feed, never when a boost arrives, so
putting this on the incremental tick would spend ~900 feed fetches an hour of
other people's bandwidth to learn nothing. `run-podroll.sh` takes the same
pipeline lock as the other two jobs.

**The timer's cadence is NOT the crawl's cadence, which is what makes daily
cheap.** `db.shows_needing_podroll` is age-gated by `--max-age` (default 6d), so
a feed read cleanly two days ago is skipped however often the timer fires. It
was weekly until 2026-08-11; measured on the day it changed, **8 feeds were due
against 948 in a full sweep**. So the whole corpus still turns over about once a
week — one run gets the cohort, the other six pick up the handful of shows first
boosted since. Don't "fix" the frequency by lowering `--max-age` to match it:
that is the 7x-bandwidth version, and it buys edits among the 69 of 948 feeds
that carry a podroll at all.

The wall clock is a politeness floor, not compute: the last full sweep was 948
feeds in 261s, and that time is Wavlake's 187 feeds going serially at
`HOST_DELAY` — see below for why that delay exists.

Daily also makes `--retry-age` reachable for the first time. It defaults to
`max_age // 6` = 24h, the shorter cooldown a never-completed read earns
(`PODROLL_TRANSIENT`), and on a weekly timer the timer itself was the floor.

**A new show waits for this pass, and nothing else fills the gap.** The row is
created by whichever tick first sees a boost for it, so a show boosted just after
a run has no podroll section until the next one — a real report, and the reason
the cadence changed. There is no podroll path on the incremental tick by design.

**Politeness is load-bearing.** The first scoping sweep, 12 flat workers, drew
429s from 137 feeds — 135 of them Wavlake, which hosts a big slice of the music
corpus. Every one would have been recorded as "no podroll", and the number
would have looked plausible. Re-probed serially: all 135 fetched, none had a
podroll. So `probe_feeds` groups by host and goes **serial per host**,
concurrent only across hosts. This is the same failure the Podcast Index
coverage probes hit; assume any wide third-party sweep has it.

Three more invariants:

- **Only a clean read may rewrite a stored podroll.** A 429/timeout/truncation
  means we failed to see the feed, not that the publisher deleted their list.
  Failures record a status and leave the rows alone. They also get a shorter
  re-check window than successes (`db.PODROLL_TRANSIENT`) and one retry sweep at
  the end of the pass, when a rate-limiting host has had minutes of quiet.
  `http-404` is deliberately not transient: a gone feed is a real answer.
- **Feeds are streamed and abandoned** at `</channel>` or 2MB (one indexed feed
  is 50MB). The cap was validated, not guessed: all 48 feeds that exceeded it
  were re-downloaded in full and none carried a podroll past it.
- **The block is regex-parsed, not XML-parsed**, because it's third-party markup
  read from a deliberately truncated prefix. A podroll opened but never closed
  raises `Truncated` rather than storing half a list.

**Coverage, and the reason the reverse edge exists:** 65 of 925 reachable feeds
(7%), 371 edges, 221 distinct targets. Forward-only that is a section on 65
pages. Adding `recommended_by` — the same rows read the other way — brings it to
**109**, because plenty of shows are recommended by someone without publishing a
podroll themselves. Local Bitcoiners is one of them (Bowl After Bowl recommends
it). Build both directions or most of the feature is left on the table. **Both
are built** — see "Show pages: the podroll, in both directions" above for the
site half.

**Only ~56% of cards link anywhere.** A podroll routinely recommends shows
nobody in this corpus has boosted; 136 of 221 targets were new to the index. Two
consequences. First, the collector resolves those targets through PI
`podcasts/byguid` and caches them in `shows` with `discovered_via='podroll'` —
96% come back with a title and artwork, so the cards render properly instead of
as bare guids. Second, every card carries a **`linked`** flag (boosts AND a
title, the same qualifying rule `/show/<guid>` applies); `false` means render the
card but point it at the feed. Don't re-derive that flag site-side.

Podroll-discovered `shows` rows have no boosts, so they appear in no export row
and no D1 projection — the exports are all boosts-driven. The one place it would
have leaked is `db.stats()`, whose `shows_enriched` used to be `COUNT(*) FROM
shows`; it now asks the boosts table, which also self-corrects if such a show
later gets boosted.

**In D1, both endpoints are denormalized onto the edge** (`source_*` /
`target_*`). A join to `podcasts` would only resolve the half of targets that
have boosts, since that table holds nothing else. It syncs as a **full replace**
via `d1_sync.py --remote-podroll`, run by the podroll script — never on the boost
delta path, which is unrelated to it. Wholesale replacement is also what makes a
*removed* recommendation actually disappear. Requires `d1/schema.sql` applied to
the remote first (`--apply-schema`, idempotent).

Shape of both surfaces is specified in `DATA-API.md`.

## Naming note

Internal identifiers still use LB's `lb` prefix — `window.LBLogin`,
`lb_nostr_session` in localStorage, `lb-*` CSS classes, `lb:feed-activate`
events. Renaming is cosmetic and touches many files; it's deliberately not
done. Don't half-rename it.

### Podcasts → Episodes

The episode-level feed was called **Podcasts** until Shows arrived and made the
name ambiguous: both are podcasts, one is episode-level. Renamed to Episodes,
and the line drawn was **the product surface renames, the module does not**:

| Renamed | Kept |
|---|---|
| the dropdown label, panel `aria-label`s | `assets/js/feeds-podcasts.js` |
| feed keys `episodes-global` / `episodes-follows` | its `renderPodcasts` export |
| URL hashes `#episodes-*` | its `[podcasts]` console prefixes |
| panel ids `panel-episodes-*` | `PODCASTS` const in `feeds.js` |
| accent tokens `--eg-*` / `--ef-*` | `podcasts/*.json` data paths (collector-owned) |

The file and its export renamed *together or not at all*, and not at all was
the choice — a module filename isn't a URL, and renaming it costs the git
history that follows the file. So this is not a half-rename; the seam is
between the surface and the module, and it's a seam, not a gap.

`ALIASES` in the index.html controller maps `#podcasts-global` and
`#podcasts-follows` to the new keys and rewrites the hash in place, the way a
301 would. **Never remove an entry** — those links are in the wild.

The nav and footer no longer have a **Podcasts** heading at all — see the site
map below.
