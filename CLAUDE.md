# OnlyBoosts — Claude Code Notes

A Nostr client for podcast boosts. At heart it's an ordinary kind-1 client —
the difference is that it does **not** query relays for the feed. It reads a
pre-built JSON snapshot off the VPS (`relay.mynostr.app`), the same way
localbitcoiners' community feeds work.

**The whole feed experience is one page.** `index.html` carries four
hash-routed tabs on two axes — what (boosts / podcasts) x whose (global /
your follows). `about.html` is a real content page — the project's own
explanation of what the data is and isn't. `boosters.html` and
`podcasts.html` are still coming-soon placeholders with no feature behind
them; they're nav + header + card + footer and nothing else.

| Tab | Hash | Renders |
|---|---|---|
| Boosts · Global | `#boosts-global` | the kind-1 boost notes themselves |
| Boosts · Follows | `#boosts-follows` | same, filtered to your kind-3 contacts |
| Podcasts · Global | `#podcasts-global` | episode/show rollup by boosts received |
| Podcasts · Follows | `#podcasts-follows` | same, filtered to your kind-3 contacts |

**The two Follows tabs only exist for a signed-in npub.** Signed out they're
`hidden`, the row collapses to the two Global tabs (hence `grid-auto-flow:
column` rather than `repeat(4, 1fr)` — a `display:none` grid item creates no
track), and a `#podcasts-follows` deep link is coerced to the default with
the hash rewritten to match. `.feed-tab[hidden] { display: none }` is
load-bearing: `.feed-tab` sets `display:flex`, which otherwise beats the UA's
`[hidden]` rule.

The inline tab controller in `index.html` owns activation and dispatches
`lb:feed-activate`; `assets/js/feeds.js` listens and lazily hydrates.
`feeds.html` and `boosts.html` were folded into this page and deleted —
their markup is the ancestor of the Podcasts and Boosts panels respectively.

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
- **Pages Functions bound every upstream fetch**: wall-clock timeout, byte
  cap, *and* a streamed read (`resp.text()` buffers before you can check
  size). See `functions/api/data/[[path]].js` for the reference shape.
- **CORS origin allowlists are exact-match `Set` lookups**, never
  `startsWith` — a prefix check lets a lookalike origin get reflected into
  `Access-Control-Allow-Origin`.
- **`isSafeUrl()` before any user-supplied URL** reaches `href`/`src`.
- **Bump `VERSION` in `sw.js`** when shipping changed assets that returning
  visitors must get on the *first* navigation rather than the second.

## Theming

The shared stylesheets (`nav.css`, `footer.css`, `boosts-thread.css`,
`boost-actions.css`) read their colors as CSS custom properties off `:root`
and don't define them — every page has to supply the tokens. That supply is
`assets/css/theme.css`: the palette, the `@font-face` rules, and the base
`body`/`a`/`img` styles. **Link it from every page, last among the shared
stylesheets** so a page's own inline `<style>` still wins.

`index.html` keeps one theme block of its own — the four per-feed accents and
the `body[data-active-feed]` mapping — because those only mean anything on
the page that has the tabs. `assets/css/page.css` is the counterpart for the
plain content pages (`.page-header`, `.soon-card`).

Those stylesheets were written against localbitcoiners' token names
(`--cream`, `--navy`, `--orange`, `--green-d` …). Rather than rename ~300
usages across five files, the old names are kept as **aliases repointed at
the OnlyBoosts palette**. Trust the values, not the words — `--orange` is
brand cyan. New code should prefer `--brand` / `--ink` / `--surface`.

Brand colors are sampled from the supplied art: `--brand: #00aff0` (the
mark's cyan) and `--brand-d: #068ace` (its broadcast waves). The four feed
accents sit on one cyan→indigo ramp so the tab row reads as a single system.

One ordering trap: `.feed-tab { --tab: var(--muted) }` is a default that
appears *after* the per-tab `--tab` rules would naturally go. Same
specificity, so the per-tab rules must stay below it or every tab renders
grey.

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
  general-purpose relay. Don't prune it.

## What's built vs. what isn't

**Working, ported from LB:**
- `assets/js/boosts-feed.js` / `podcasts-feed.js` — the four feeds
- `assets/js/boosts-thread.js` — the content tokenizer (nostr: mentions,
  URLs, quoted notes) the boost cards render through
- `assets/js/boost-actions.js` — reply / like / repost / zap
- `login-widget/` — NIP-07/46/nsec login, NWC + WebLN wallets, boost modals,
  multi-leg value-split payments, bug-report modal
- `partials/` + `scripts/sync-partials.js` — shared nav/footer
- `functions/api/data/[[path]].js` + `assets/js/ob-data.js` — the data feed
- `bots/bug-watcher/` — polls the bug relay, opens GitHub issues
- `bots/global-boost-scan/` — the network-wide collector: NIP-73
  `podcast:item:guid` detection, zap-receipt unwrapping for Fountain-style
  notes with no `amount` tag, Podcast Index enrichment, and the static-JSON
  export the site reads. `DATA-API.md` there is the schema contract.

**Still to build:**

0. **Two coming-soon pages have no feature behind them.** `/boosters` (a
   directory of the npubs sending boosts) and `/podcasts` (a show-level
   directory — the feed tabs are episode-level). Both are `noindex` and out
   of `functions/sitemap.xml.js` until there's something on them.

   `/about` is done. Its copy is distilled from
   `docs/about-and-faq-source.md`, written by the collector-side agent —
   **that file is the factual source of record**, so correct it there first
   if the pipeline's behaviour changes. The page's live stat strip reads
   `/api/data/meta.json` and stays hidden if the fetch fails, so the numbers
   can never go stale in the markup.

1. **Podcast Index credentials.** `/api/value` needs `PODCAST_INDEX_KEY` and
   `PODCAST_INDEX_SECRET` in the Cloudflare env. Without them it returns a
   clean 503 and "Boost episode" can't resolve a show's splits. Locally, put
   them in `.dev.vars` (gitignored).

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
| `boosts-global` | `boosts-feed.js` | `latest.json`, paging back through month archives |
| `boosts-follows` | `boosts-feed.js` | `POST /api/v1/boosts/follows`, cursor-paged |
| `podcasts-global` | `feeds-podcasts.js` | `latest.json` + 3 recent months, rolled up by episode |
| `podcasts-follows` | `feeds-podcasts.js` | `POST /api/v1/boosts/follows`, same rollup |

**Two backends, one record shape.** `ob-data.js` is the static half (immutable
CDN shards under `/api/data/*`); `ob-live.js` is the live half (D1 query API
under `/api/v1/*`). The split is not stylistic: a Global view is the same bytes
for every visitor and caches, a Follows view is scoped to the signed-in user's
contact list and cannot. Both normalize through `ob-data.js#normalizeBoosts`,
so everything downstream of the fetch sees one model and the card renderers are
shared. `ob-live.js` caches nothing in-process — the shard cache is safe only
because those files are immutable.

Two shapes on the live side: `followsBoostReader()` pages incrementally for the
note feed, `getFollowsBoosts()` pulls a bounded corpus for the podcasts rollup,
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

- the inline tab controller shows/hides the Follows tabs, and bounces you to
  the default feed if you sign out while reading one;
- `feeds.js` drops both `*-follows` keys from its `loaded` set and re-runs
  whichever is on screen — `loaded` is what makes each feed hydrate exactly
  once, so without this a Follows feed would keep the previous account's
  results after a switch.

The renderers still carry a `signed-out` branch. It's unreachable through the
tabs now and kept as a fallback — if the hiding logic ever fails, the feed
says something sane instead of rendering an empty list.

Two scoping details that aren't obvious:

- **Boosts · Follows no longer pages backwards hunting for matches.** It used
  to: a follow set can match nothing in the most recent 1,000 boosts while
  having plenty further back, so the client walked month archives until
  something turned up. The D1 query answers that in one indexed hit, so an
  empty first page now genuinely means empty. The archive-walk branch survives
  on the Global path, where `latest.json` can lag.
- **The Podcasts tabs don't use `podcasts/index.json`.** The cards are
  *episodes*, not shows, and the published index is a show-level rollup
  computed over everyone — so its counts would also be wrong for a Follows
  audience. Both tabs roll the boost feed up by episode instead, via
  `ob-data.js#toEpisodeShape`. Global bounds that at `latest.json` + the three
  most recent months (the range filter offers "All", which needs more than the
  recent 1,000 boosts to mean anything; all 22 archives would be ~20MB).
  Follows has no month window — a follow set's boosts are a thin slice of the
  same table, so the query walks its own history and stops on `ob-live.js`'s
  row budget instead of at an archive boundary. "All" therefore reaches further
  back on Follows than on Global, which is the right way round.

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

### Snapshot → card

The feed carries each boost's identity and content but **not the signed
event**. That's enough: the card needs only those fields, and reply / repost /
like / zap need only `id` + `pubkey`. Both renderers build a minimal
`{id, pubkey, kind, content, created_at, tags}` object purely to hand to
`buildActionBar` — a projection, not a verified event. Don't pass it anywhere
that assumes a real one.

On both feeds a booster's avatar and display name copy their npub —
`assets/js/copy-npub.js` holds the clipboard + toast helpers (the toast keeps
its historical `.pcast-toast` class; it's the site's only one). `booster.npub`
is nullable where `booster.pk` isn't, so `boosts-feed.js` derives the npub
from the hex pubkey when the record has none.

`boosts-feed.js` builds its own card rather than calling
`boosts-thread.js#renderNoteCard`, because that function caches cards by event
id and appends the action bar itself — appending the boost-meta row (sats +
what was boosted) afterwards would double up on a cached repaint.

## Naming note

Internal identifiers still use LB's `lb` prefix — `window.LBLogin`,
`lb_nostr_session` in localStorage, `lb-*` CSS classes, `lb:feed-activate`
events. Renaming is cosmetic and touches many files; it's deliberately not
done. Don't half-rename it.
