# Architecture And Conventions

**Moved verbatim out of `CLAUDE.md` on 2026-11-11**, when that file had grown to 200KB and was
loaded into every session's context. Nothing was rewritten on the way across, so
`git log -S <phrase> -- CLAUDE.md` still finds the history of any paragraph here. Where a
paragraph says "this file", "above" or "below", it means the old `CLAUDE.md`; the four
files it became are `docs/site-structure.md`, `docs/architecture.md`,
`docs/feature-rules.md` and `docs/data-pipeline.md`. `CLAUDE.md` keeps the rules a change
elsewhere would break and points here for the reasoning.

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
- `~/mynostr-web` — the full React Nostr client
- `ChadFarrow/boostmebitch` (BMB) — Podcast Index proxy, wallet rails,
  signed-out boosts via a server-side identity, live-stream zaps

### What The Strip Removed

**Moved verbatim to `docs/strip-removed.md` on 2026-09-23.** LB's own
products (the Events path, the calendar card, the meetup product, ~6,600
lines of source and 202KB off the homepage) were deleted on 2026-08-23; that
file has the table, the calendar-card note this file got wrong for months,
and the two checks worth reusing for any future strip. **A widget deletion
is verified by `test-boost-modal-render.mjs` and by a declared-versus-
referenced diff against the previous revision, never by a green build**:
Vite builds an undeclared identifier away without a word, and this repo has
no linter.

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

Thirty-three test scripts, all plain `node scripts/<name>.mjs` with no runner.
**`docs/tests.md` is the per-test reference** — one row each, saying what it
covers and what it was confirmed red against. What follows here is only what a
change elsewhere would break.

**⚠️ `test-server-render.mjs` IS THE ONE THAT NEEDS AN ARGUMENT, SO IT IS THE ONE
THAT GOES UNRUN.** Its header carries the `curl` that produces the capture; take
a fresh one rather than reusing an old file, since it is also the size
measurement. It asserted `cards are numbered 1..N with no gaps` — the *ordinal*
scheme's invariant — until competition ranking shipped on 2026-08-18, and it
would have been merged red had it not been run. **Run all thirty-three before a
merge**, and treat this one as the guard on the ranking scheme rather than only
on weight. *(That number has been wrong before — it lagged from twelve to twenty-eight, a
test at a time, while the table beside it grew; it was thirty-two for an afternoon on 2026-10-17 (`test-discover-home.mjs` in) and thirty-one again by evening (`test-feed-search.mjs` out); thirty-two since 2026-10-29 (`test-session-secret.mjs` in); thirty-three since 2026-11-07 (`test-opml.mjs` in). `git log -S "before a\nmerge" -- CLAUDE.md` has every value it has held. **Bump it and `docs/tests.md`
together.**)*

**⚠️ AND ITS `curl` CHANGED WITH THE LANDING FEED.** It captures
`/api/v1/podcasts?not_medium=music&sort=chart&range=all&limit=25` now (it read `sort=boosters`
until the Charts became the opening sort on 2026-08-31), not the episodes
query. The whole file was rewritten by Phase D, which is the honest
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

**⚠️ `test-boost-modal-render.mjs` IS A TEXT SCAN, NOT A RENDER, AND THIS REPO
HAS NO LINTER.** It exists because a temporal dead zone reached production and
did not look like a crash: a render error with no boundary above it unmounts the
whole `createRoot`, so one missing line-order produced four unrelated-looking
faults — the modal vanished mid-payment, the payment completed anyway, **no
Nostr note was ever published**, and the page's Boost button was dead until a
reload. Nothing anywhere said an error had been thrown. **Point the scan at any
component that renders while a payment is in flight**, and see *Why
`test-boost-modal-render.mjs` Is A Text Scan* in `docs/tests.md` for the whole
account (`no-use-before-define` would catch the class in one rule; adding eslint
to `login-widget/` is the better fix whenever anyone wants it).

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
  `show-link.js`, `episode-link.js`, `booster-link.js`, `cover-art.js`,
  `nostr-text.js` and `favorite-button.js` are all dependency-free, which is
  what made this cheap.
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
  don't widen the shared policy for one preview. **`script-src` allows
  `https://static.cloudflareinsights.com`** (2026-10-15): Cloudflare injects
  its Web Analytics beacon into every HTML response as an external module
  script, and the policy refused it, so analytics recorded nothing. The
  card frame (`card-frame.js`) deliberately keeps it out; the collector's
  screenshot bot is its only visitor.
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
  HEAD first. Bitten three times in two days on 2026-08-29/30 — **and the
  rule was then found unenforced on 2026-09-07: `/show`, `/episode`,
  `/booster`, `/` and every `/api/v1` endpoint still answered 404 to HEAD.**
  The handler is one line now, `export const onRequestHead =
  headOf(onRequestGet)` from `functions/_shared/head.js`, and
  `test-head-routes.mjs` scans `functions/` for any GET without it. **The two
  money endpoints, `/api/lnurl` and `/api/keysend`, are the allowlist on
  purpose**: their GET asks a third party for an invoice or a node record,
  which a link checker's HEAD must not do.
  **⚠️ AND A PAGE FUNCTION FETCHES ITS SHELL WITH `assetGet(request, path)`
  FROM `head.js`, NEVER WITH THE INCOMING REQUEST AS INIT** (2026-10-21):
  that init copies the method, a HEAD fetched the shell as a HEAD, the empty
  body made the fill throw, and thirteen chart-family routes answered 500 to
  `curl -I` on the preview while GET was 200. The scan was green because it
  only checks the handler exists; it now also refuses the pattern and runs
  a HEAD through the real chart-page renderer against a method-faithful
  asset stub.
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

**Moved verbatim to `docs/dark-mode.md` on 2026-09-23.** The rules that
reach outside it: `data-theme="dark"` on `<html>`, set before first paint by
the boot script in `partials/nav.html` and toggled by `nav.js` (**neither may
contain a backtick or `${`**; sync-partials exits nonzero); the grammar is
**one ground, hairlines, and one accent** (Reed's call, 2026-08-27), so
**don't re-introduce a surface with its own colour**; `--navy` flips to the
ground, `--brand-dd`/`--brand-ddd` and `--warn`/`--danger` deliberately do
not flip, and a new `--navy` fill or `--brand-dd` text usage needs its own
dark-scoped rule; and **a dark override of an aliased token goes on
`:root[data-theme="dark"]`, never on `body`**, or every alias bakes in the
light value first. **The dark block stays below the base `:root` block in
`theme.css`**: `test-boost-modal-render.mjs` parses the first one it finds.

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
surface however well validated. Rotating a bot key costs a profile, one booster page and
`BOOSTBOT_PUBKEY_HEX` in `assets/js/zap-receipt.js` (the donor's zap request is addressed to it, and
`/api/sign-receipt` refuses one addressed anywhere else; see *The Note Quotes One Receipt* in
`docs/money-paths.md`); rotating the
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

The site subtitle is **"Podcasting 2.0 Nostr Boosts"**, in the homepage
`<title>` and `og:title` and in `manifest.webmanifest`, which change together.
**The masthead line under the banner stopped carrying it on 2026-09-03**
(Reed's wording): it reads "Charts and RSS Discoverability powered by
Podcasting 2.0 Boosts on Nostr", the linked half going to `/about`, and is a
tagline rather than the subtitle of record. It read "Podcasting 2.0 Boosts on Nostr" until
2026-08-24; *Nostr boost* is the term the project settled on in public, so the
subtitle now uses it as the compound noun the vocabulary table already treats it
as. **Show pages still use `<title> — Boosts on Nostr | OnlyBoosts`** and were
deliberately left alone: there the phrase follows a show's name and reads as a
description of the page rather than as the site's own label.

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
recent boosts. **Re-measure before changing one**; reputation is a bad proxy.

**`docs/relay-sets.md` is the authority** — the coverage table, every set and the
file it lives in, the `NC_RELAYS` NIP-46 findings, and the floors worth knowing
(11% of boosters have no kind 0 anywhere, 36% no kind 10002). Five things from it
that a change elsewhere would break:

- **⚠️ Reading and publishing are different jobs and take different sets.** A read
  set answers "who HAS this event", which is measurable, and a useless member costs
  latency on every query. A publish set answers "who will SEE this event", which
  cannot be measured from outside. **So the read sets are cut to what the
  measurement supports and the publish sets are deliberately generous, and a low
  score is not an argument against a publish target.** One list doing both jobs is
  the smell that produced the split.
- **⚠️ `relay.damus.io` answers a WebSocket connect with HTTP 503 and must not come
  back** — it was first in every browser-side list. *(Measured 2026-08-12; the
  favorites work reached it fine in ~300ms on 2026-09-08, so this one wants
  re-measuring before it is trusted either way.)* **On 2026-10-30 it opened and
  answered nothing, which degraded every favorites read, so it is off the
  favorites READ set** (a publish target still); see `docs/favorites.md`.
- **⚠️ `relay.getalby.com` is NWC transport, not a relay.** Both it and `/v1` answer
  *every* REQ with `blocked: Request rejected`, so a note published there can never
  be read. NWC is unaffected: the wallet's relay comes from the connection string.
- **⚠️ A relay has to accept the kind.** `purplepag.es` stores only 0/3/10002;
  `relay.fountain.fm` refuses 30078 *and* kind 10333 with `kinds not supported`.
  **An OK is not proof of transport** — fountain answers `OK: true` and then CLOSEs
  the subscription. Test the read side too.
- **⚠️ NDK dials relays this repo never names**, building a second outbox pool from
  its own `DEFAULT_OUTBOX_RELAYS` unless `outboxRelayUrls` is passed; `ndk.js` now
  passes it explicitly. And **`publishRelaySet()` unions `PUBLISH_RELAYS` with
  NDK's pool** — a set built from `PUBLISH_RELAYS` alone would replace the pool and
  silently stop publishing to the user's own NIP-65 write relays.
