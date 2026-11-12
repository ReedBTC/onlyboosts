# OnlyBoosts — Claude Code Notes

A Nostr client for podcast boosts. At heart an ordinary kind-1 client, with one
difference: it does **not** query relays for the feed. Boost data comes from the
collector in `bots/global-boost-scan/`, which publishes to D1 and to static JSON
on the VPS (`relay.mynostr.app`).

**How to read this file.** It is the operating manual: the rules a change
elsewhere would break, and where the reasoning lives. **It is loaded into every
session, so keep it under 40KB**; it reached 200KB on 2026-11-11 and was cut
back that day. A new decision goes in the doc for its subject, with at most
one line here. Deleted reasoning is recoverable: `git log -S <symbol> -- CLAUDE.md`
finds the paragraph that used to explain any name.

| Subject | Authority |
|---|---|
| The pages, the chart pages, the discovery homepage, the nav, the medium split, feed loaders, vocabulary, what's built | `docs/site-structure.md` |
| The fork, the stack, stamping, the service worker, the rendering rule, conventions, theming, site identity, bot conventions, relay sets | `docs/architecture.md` |
| The money paths summary, @mentions, the detail pages, PC 2.0 Favorites | `docs/feature-rules.md` |
| The exclusion list, the duplicate filter, the data feed and record shape, follows scoping, discoverability columns, artwork, profiles, author, language, `client_id`, podroll | `docs/data-pipeline.md` |
| Every payment and publishing decision | `docs/money-paths.md` |
| Show page design | `docs/show-pages-spec.md` |
| Data shapes the collector publishes | `bots/global-boost-scan/DATA-API.md` |
| The D1 consolidation (complete) | `docs/data-architecture.md` |
| `/about` copy, factual source of record | `docs/about-and-faq-source.md` |
| The `/api/v1` surface | `docs/api-tier2-d1-spec.md` |
| The duplicate filter (rule, tiers, measurements) | `bots/global-boost-scan/dedupe.py` docstring |
| Two-sided modules, the cards, the first-view budget | `docs/two-sided-modules.md` |
| The login/boost widget's styling | `docs/widget-theming.md` |
| The feed bar: range, sort, rank, language, search | `docs/feeds.md` |
| The Members tab, #40HPW, the member wall | `docs/members-tab.md` |
| The four detail pages | `docs/detail-pages.md` |
| Boost client attribution | `docs/boost-clients.md` |
| PC 2.0 Favorites (kind 10333), OPML | `docs/favorites.md` |
| The test scripts, one row each | `docs/tests.md` |
| Show artwork and the share cards' images | `docs/show-artwork.md` |
| The relay sets and their measurements | `docs/relay-sets.md` |
| @mentions in the four composers | `docs/mentions.md` |
| What the 2026-08-23 strip deleted | `docs/strip-removed.md` |
| Dark mode | `docs/dark-mode.md` |

## Pages

| Path | What |
|---|---|
| `/` | the discovery homepage: the featured carousel, then rails, fact rails edge-rendered by `functions/index.js`, personal rails in the browser (`discover.js`) |
| `/podcasts/{shows,episodes}`, `/music/{artists,albums,songs}` | the chart pages; the bare path opens on the first view |
| `/boosts` | the boost feed, Global or Follows |
| `/members` | the Top Members wall and the Boost Bots |
| `/charts`, `/charts/{podcasts,music,hpw}` | the weekly boards; `/charts/<key>/card/<kind>` are the share-card frames |
| `/show/<guid>`, `/episode/<item-guid>`, `/booster/<npub>`, `/artist/<guid>` | the four detail pages, edge-rendered |
| `/search?q=`, `/discover/<key>` | the results page (a list, never rails); the whole list behind a discovery rail |
| `/hpw/<YYYY-MM-DD>`, `/hpw/high-scores` | one #40HPW board as a page; `high-scores` is a path, the board is named Proof of #40HPW |
| `/about`, `/stats` (placeholder), `/404.html` | |

What a change elsewhere would break (reasoning in `docs/site-structure.md`):

- **⚠️ `charts.html` IS THE ONE SHELL OF FIVE PAGES** (Podcasts, Music, Boosts,
  Members, Charts), routed by `functions/_shared/charts-page.js` and again by
  the inline controller. **`PAGES` is declared in both and pinned to the nav's
  hrefs**; `test-feed-hash.mjs` extracts the controller. The view is the query
  string (`?scope=&lang=&range=&sort=`), defaults elided, `replaceState` only.
- **⚠️ THE OLD HASH ADDRESSES ARE FORWARDED BY TWO IDENTICAL HEAD SCRIPTS**, in
  `index.html` and `charts.html`. Change them together; `test-discover-home.mjs`
  runs both.
- **Two feeds are edge-rendered**: Shows (`<!--OB:SSR-SHOWS-->`) and Albums
  (`<!--OB:SSR-ALBUMS-->`), all time by Chart rank. A page with no feed paints
  off `body[data-page]`; a missing `data-active-feed` hydrates nothing.
- **⚠️ THE HOMEPAGE RAIL ORDER IS REED'S** and nothing a signed-out visitor
  cannot see comes before the fourth rail; `test-discover-home.mjs` pins it.
  Signed out with nothing imported, the personal rails are one locked carrot
  rail. A new ranked rail key needs a `railScope` entry in `discover.js`.
- **The nav bar, the overlay and the footer name the same places; change them
  together.** The boost feed's link is "Boosts", never "Live". Homepage rail
  names say "Podcasts", never "Shows".
- **⚠️ THE THREE FIGURES HAVE ONE ORDER SITE-WIDE: SATS, BOOSTS, BOOSTERS.**
- **⚠️ THE MEDIUM SPLIT IS A PARTITION**: `music` goes to Songs, Albums and
  Artists; everything else, unidentified shows included, to Episodes and Shows
  (`not_medium=music`, never `medium=podcast`). It is a query parameter, never a
  client-side join. The artist tier counts music only.

## Stack

Vanilla HTML + ES modules, no build step for the site itself. Cloudflare Pages +
Pages Functions. The one thing that builds is `login-widget/` (Vite + React),
three targets: `assets/widgets/login-widget.js`, `assets/widgets/nostr-tools.js`,
and `functions/_shared/nostr-sign.js` (the edge signer; the Functions have no npm
dependencies and import relative paths only).

```
cd login-widget && npm install && npm run build
```

**On Reed's .2 box `npm run build` fails**; from `login-widget/` run
`node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js build --config vite.nostr-tools.config.js && node node_modules/vite/bin/vite.js build --config vite.nostr-sign.config.js`.
**`login-widget/src/` edits change nothing until built.**

Local dev: `wrangler pages dev .`

**Before a commit that touches shared markup or assets, in this order:**

```
node scripts/sync-partials.js          # nav + footer into every page
node scripts/stamp-assets.js           # ?v=<VERSION> onto every JS/CSS reference
node scripts/stamp-assets.js --check   # non-zero exit if anything is stale
```

**⚠️ Bump `VERSION` in `sw.js` on ANY asset change, then stamp.** A URL means
exactly one version of one file; that is what closed the `ob-v53` outage (one
stale module took down all eight feeds). Adding a named export to a shared
module is ordinary work since then.

**Thirty-three test scripts**, plain `node scripts/<name>.mjs`. `docs/tests.md`
is the per-test reference; **bump the count here and that file together.** Run
all thirty-three before a merge.

- **⚠️ `test-server-render.mjs` NEEDS A FRESH CAPTURE** and is the one that goes
  unrun: `curl -s 'https://onlyboosts.social/api/v1/podcasts?not_medium=music&sort=chart&range=all&limit=25' -o <file>`
  then `node scripts/test-server-render.mjs <file>`. It guards the ranking scheme.
- **`test-feed-hash.mjs` extracts the controller out of `charts.html`** by
  scanning for `FEED BAR CONTROLLER` and `function <name>(`; renaming either
  breaks it loudly, on purpose.
- **⚠️ `test-boost-modal-render.mjs` IS A TEXT SCAN, NOT A RENDER, AND THIS REPO
  HAS NO LINTER.** A use-before-declare in a component that renders during a
  payment unmounts the whole widget root, and the note is never published.
  Declare new consts and state above their first read.
- `test-charts.mjs`'s "malformed cache entry" case flakes about one run in three;
  rerun before blaming a change.

## What The Service Worker Caches

HTML and `/api/` are network-first with a cached copy offline; widgets and
static assets are stale-while-revalidate. **⚠️ A live endpoint belongs under
`/api/`**, or a returning visitor is served the previous visit. **⚠️ A money
endpoint needs one more step**: `isUncacheableMoneyRequest` holds `/api/value`,
`/api/lnurl`, `/api/boostbox` and `/api/keysend`, never cached, because an
offline answer pays a stale split, a paid invoice or the wrong node. Ask of any
new endpoint whether an offline answer is worse than none.

## ⚠️ The Rendering Rule: The Server Renders The Facts, JavaScript Adds The Verbs

Facts (anything out of the database that is the same for every visitor) are
server-rendered, always. Verbs (anything needing a signer, a gesture, or who is
looking) are attached by JavaScript, always. A component never has to choose.
If a reader could screenshot the same component on two pages and tell them
apart, that is a bug unless the subject differs.

**One module, imported from both sides** (`docs/two-sided-modules.md`): a
Function imports `../../assets/js/x.js` and esbuild inlines it; the browser
imports `/assets/js/x.js?v=<VERSION>`. So:

- **A two-sided module imports its siblings as `'./thing.js?v=<VERSION>'`**, never
  an absolute path, and everything it imports is two-sided too.
- **⚠️ NO `Date.now()`, NO UNPINNED LOCALE** in a two-sided module; `en-US` in UTC.
- **⚠️ NO SURFACE PRINTS AN EPISODE NUMBER.**
- **The Function declares the card variant and it travels in the state element.**
- **⚠️ `functions/index.js` fetches `/` from `env.ASSETS`, never `/index.html`**
  (Pages 308s it into a redirect loop).
- **⚠️ EVERY REPAINT RE-ATTACHES THE VERBS** (`wireBoostNotes(root)`).

## Conventions

- **CSP meta tag on every page, one shared policy.** `img-src` allows `data:` and
  `https:`, not `blob:`. `script-src` allows Cloudflare's analytics beacon.
- **Shared nav/footer are generated**: edit `partials/nav.html` /
  `partials/footer.html`, run `sync-partials.js`; never edit the copies between
  the markers. A new edge-rendered page needs an `EDGE_PAGES` entry. The nav
  boot script and nav.js may contain no backtick or `${`.
- **Link pages without `.html`.**
- **⚠️ `404.html` is what makes a missing path answer 404**; without it Pages
  answers every unmatched path 200 with the homepage, and a missing module
  reports as a MIME error.
- **Pages Functions bound every upstream fetch**: timeout, byte cap, streamed
  read (`functions/api/data/[[path]].js` is the shape).
- **⚠️ Every Function that exports `onRequestGet` also exports
  `onRequestHead = headOf(onRequestGet)`**, except the money endpoints
  `/api/lnurl` and `/api/keysend`. **A page Function fetches its shell with
  `assetGet(request, path)`**, never with the incoming request as init.
  `test-head-routes.mjs` enforces both.
- **CORS allowlists are exact-match `Set` lookups**, never `startsWith`.
- **`isSafeUrl()` before any user-supplied URL** reaches `href`/`src`.
- **⚠️ `/api/data/*` upstream answers HTTP 200 for missing files**; the proxy
  checks content-type and parses JSON, and its paths are a strict allowlist.
- **Internal identifiers keep LB's `lb` prefix** (`window.LBLogin`,
  `lb_nostr_session`, `lb:feed-activate`). Don't half-rename.
- **Upstream LB is the `lb` remote, pushes disabled**: `git show lb/main:<path>`
  before rewriting something the strip removed.

## Theming

`assets/css/theme.css` supplies the tokens; link it from every page, last
among the shared stylesheets. The grammar is **one ground, hairlines, and one
accent**; don't introduce a surface with its own colour. Dark mode is
`data-theme="dark"` on `<html>`; a dark override of an aliased token goes on
`:root[data-theme="dark"]`, never `body`, and the dark block stays below the
base `:root` block. LB's token names (`--orange`, `--navy`) are aliases;
trust the values. `docs/dark-mode.md` has the rest.

**The widget wears the site's palette** (`docs/widget-theming.md`):

- **⚠️ The tokens are read, not copied, and every `var()` carries a literal
  fallback** that mirrors the token (the test checks it).
- **⚠️ `.lb-w` is the scope and every `createPortal` must wear it**, and still be
  passed a container.
- **⚠️ Every selector in the scoped reset computes to (0,0,0).**
- **⚠️ A filled brand button is `--brand-dd`, never `--brand`** (2.50:1 fails AA).

## Site Identity

| | |
|---|---|
| Domain | `onlyboosts.social` |
| npub | `npub1nmd7u4f5ewsjn6wp4zd9pc4jnadtmluanfhm2g0xryrdga7e7xxq0as4ck` |
| pubkey (hex) | `9edbee5534cba129e9c1a89a50e2b29f5abdff9d9a6fb521e61906d477d9f18c` |
| Lightning | `onlyboosts@getalby.com` |
| Bot npub | `npub182r6r8yqr4t3zxcfq4tfyfwjkg9nn525ljfmaadg72rqcsymsnvslda3ge` |
| Bot pubkey (hex) | `3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9` |

**The bot is a second identity on purpose**: it signs notes for donors with no
key, and a signing endpoint is an attack surface. The banner is two files:
`onlyboosts_banner_clear.png` renders on the page, `onlyboosts_banner.png` is
the `og:image`; change the art and both move. The domain is in `robots.txt`,
the manifest, the sitemap, the CORS allowlist, canonical/OG tags and the
`client` tags; change them together.

## ⚠️ Money Paths

Two things are both called "boost": **boosting a podcast** pays the show's own
value split (`externalBoost.js` / `externalBoostagram.js`), and **donating to
the site** runs the same flow with one synthetic leg to `onlyboosts@getalby.com`.
**`docs/money-paths.md` is the authority for every payment and publishing
decision**; read the section before touching a path.

**Code edits, dry runs, and read-only inspection are fine without asking.
Confirm with Reed before running anything that signs or publishes a Nostr
event, or that moves sats.** Published events can't be unpublished. New bots
start with `DRY_RUN = True`. After any change to a money path, rebuild and:

```sh
grep -c "onlyboosts@getalby.com" assets/widgets/login-widget.js   # expect >= 1
```

The rules a change elsewhere would break:

- **⚠️ THE TWO OVERRIDE MAPS STAY EMPTY**: `LNADDRESS_OVERRIDES` in
  `recipientOverrides.js` and `EXTERNAL_OVERRIDES` in `assets/js/value-block.js`.
  **No leg of a third party's value block is ever rewritten, renamed, merged or
  dropped.** One entry already shipped once and rerouted a live boost. Grep both
  after any restore from `lb/main`.
- **`FEED_GUID` in `boostagram.js` is `null`**: OnlyBoosts is a client, not a podcast.
- **⚠️ THERE IS NO RE-PAY PATH OUT OF `UNCERTAIN`, ANYWHERE.** Only `FAILED` may
  be re-paid (`isCleanPaymentDecline`). Check again also asks the wallet by
  payment hash; the wallet's explicit `failed` is the one thing that moves
  `UNCERTAIN` to `FAILED`, never inferred.
- **⚠️ THE NOTE'S FIGURE IS `resolveNoteFigure`'S ANSWER AND NOTHING ELSE DECIDES
  IT.** At 90% landed or more the note goes out at the amount typed, with no
  splits line; under 90% it says what landed, with the line. One figure in the
  body, the `amount` tag and the quoted receipt; no second tag. The modal holds
  no copy of the 90% comparison.
- **⚠️ ONLY A FAILED SPLIT TAKES ANYTHING OFF THE NOTE.** An `UNCERTAIN` split
  counts beside at least one split the CONNECTED wallet confirmed (a split paid
  by QR from another wallet is not that evidence: `viaQr`, `walletPaidSats`),
  never with none. The note waits on `watchSettled`, not `stillChecking`, and
  nothing moves a split while the note is being signed.
- **A failed Lightning-address split may be paid from another wallet by QR**;
  asking for it ends Retry for that split (`canRepayLeg` reads `leg.qr`). No offer
  on a split that never got an invoice (`noInvoice`); no Retry either on one the
  recipient's limits rule out (`unpayable`).
- **⚠️ ANONYMOUS AND PRIVATE ARE DIFFERENT ANSWERS.** Anon is still published,
  by the bot, with no npub; only the Private Boost checkbox suppresses the note.
  **`boostAnonymously` and `noteRoute` are two derivations and neither may absorb
  the other**; `sender_id` never rides without the profile behind it.
- **⚠️ THE ORACLE'S CAP AND THE MODAL'S ARE THE SAME NUMBER** (5,000,000 sats).
  `test-sign-boost.mjs` enforces it, fed by the shipped note builder.
- **The boostagram message cap is 300 bytes of UTF-8 on the expanded message.**
  The note carries `nostr:npub1…` mentions, never the label; the bot route
  carries no `p` tag and the oracle refuses one (`docs/mentions.md`).
- **⚠️ THE ROLLUP'S SYNTHETIC `unknown:` SHOW GUID NEVER LEAVES THE CLIENT**;
  `isSyntheticGuid` / `realShowGuid` guard every site that hands a guid out.
- **`/api/value` reads the show's own RSS first, Podcast Index as fallback**, and
  resolves the stored feed URL before the guid.

## Data Rules That Reach The Site

Reasoning in `docs/data-pipeline.md`.

- **⚠️ THE CORPUS STARTS 2024-07-01.** D1 behind `/api/v1/*` is what every page
  reads; the static shards remain a published dataset.
- **Almost every display field is nullable**; only `id`, `ts` and `booster.pk` may
  be assumed. `episode.guid` and `item_guid` are opaque keys, sometimes URLs:
  `encodeURIComponent`d and bound, never parsed.
- **⚠️ NULL LANGUAGE IS NOT ENGLISH, AND NULL MEDIUM IS NOT MUSIC.**
- **⚠️ `range` MEANS BOOST TIME, EVERYWHERE.** `RANGE_DAYS` in the endpoints and
  `RANGE_OPTIONS` move together.
- **⚠️ `rank.js` IS THE ONE DEFINITION OF A RANK** (competition, 1-2-2-4). The
  chart sort is `sort=chart` on all four ranked endpoints. `q=` paths use `RANK()`.
  **A raw search string goes through `ftsMatch`**, never straight to MATCH.
- **⚠️ `PUBLISHERS` in `_common.js` and `RANK_PUBLISHERS` in `feed-rank.js` stay in
  step** (the collector's publisher keys less `chadf-boostbot`).
- **⚠️ THE CHART STRIP'S LEADERBOARDS ARE CACHED IN KV** (`chartTable`); a D1 read
  per page view cost a month's budget in a day. Check `CF_ANALYTICS_TOKEN`'s
  numbers before guessing at a D1 cost.
- **`excludes.json` at the repo root gates every published surface**; it is
  public, every entry carries a `reason`, and the removal path is deliberately
  undocumented on the site.
- **⚠️ THE INDEX IS LOAD-BEARING FOR LOCAL BITCOINERS' PUBLISH DECISION**: a
  dropped row in `/api/v1/boosts` is a duplicate note there. Flag such a change.
- **The site's own boosts reach D1 at the edge** (`/api/v1/boosts/ingest`); the
  collector stays the source of truth.

## Detail Pages And Favorites

Reasoning in `docs/feature-rules.md`, `docs/detail-pages.md`, `docs/favorites.md`.

- **⚠️ THE SECTION IDS ARE URLS AND THEY ARE FROZEN.** `/show`: `#episodes`
  `#community` `#community-shows` `#podroll` `#reverse-podroll` `#boosts`.
  `/episode`: `#community` `#community-episodes` `#boosts`. `/booster`:
  `#favorites` `#latest` `#recommended` `#shows` `#episodes` `#boosts`.
  `/artist`: `#albums` `#community-artists`. So are `/about#membership`,
  `/about#bots`, `/about#charts`, `/about#recommendations`.
- **The hash spy uses `replaceState`, never `pushState`.**
- **Every drawer opens on "Overall"**, except the podcast `/show` drawer, which is
  the show's whole catalogue from Podcast Index and opens on Latest episode.
- **⚠️ ALL FOUR DETAIL-PAGE BOOST QUERIES SELECT `b.client_id`.**
- **`/booster` passes `#boosts` to `hydrateProfiles`**; the other pages pass nothing.
- **`/episode` 302s to the show on a miss**; the fix for a stale episode field
  belongs in the collector, never a repair at the edge.
- **The heart ships `hidden`** and is revealed for a signed-in member only. A
  podcast show is Followed; everything else is Favorited. The favorites merge is
  the spec's reference implementation, vendored from main, never a PR branch.

## Vocabulary

Every number here is bounded by the apps that publish boost notes to Nostr.
"A Nostr boost", "a booster" (the count noun), "the Nostr Community" (a group,
never a count), "Sats" (never qualified inline). **"Supporter" is removed from
every user-visible string.** The qualifier is a short label at the numbers
(`Nostr Stats:`, `Nostr Boosts:`, `Nostr Boost Stats`), never a paragraph;
`og:description` keeps the full sentence. A superlative names the index. User-facing
copy avoids Nostr jargon.

## Bot Conventions

One bot per subdirectory, `onlyboosts_{function}.py`; shared utilities in
`bots/shared/`; state files beside the bot, gitignored. **A relay set is defined
by the kind it carries and the audience it reaches**: read sets are cut to the
measurement, publish sets are generous (`docs/relay-sets.md`).
`relay.getalby.com` is NWC transport, not a relay.
