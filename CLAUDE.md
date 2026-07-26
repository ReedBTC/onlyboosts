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
| **Feeds** | Episodes `/#episodes-global` · Shows `/#shows` · Boosts `/#boosts-global` |
| **Stats** | Boost Stats `/stats` · Boosters `/boosters` — both coming soon |
| **More** (footer: *Connect*) | About · Source · Report a bug |

Feeds has one entry per feed, matching the homepage's what-menu exactly.
**The Global/Follows axis is deliberately not in the nav**: it's the second
dropdown on the page, and listing both scopes made this a six-item grid
restating a control the page already has. The two `*-follows` feeds are
reachable from that dropdown, and by direct link.

| Feed | Hash | Renders |
|---|---|---|
| Episodes · Global | `#episodes-global` | per-episode rollup by boosts received |
| Episodes · Follows | `#episodes-follows` | same, filtered to your kind-3 contacts |
| Boosts · Global | `#boosts-global` | the kind-1 boost notes themselves |
| Boosts · Follows | `#boosts-follows` | same, filtered to your kind-3 contacts |
| Shows | `#shows` | per-show rollup, Global only |

**The feed bar replaced a row of four tabs**, one per feed. Two dropdowns
instead of four buttons is what makes room for a third `what` (Shows, and
whatever follows it) without the row growing to six tabs. The Boosts hashes are
unchanged; the episodes feed's renamed from `#podcasts-*` and the old form is
permanently aliased — see the naming note.

Shows has no whose-axis **yet**, so its key is the bare `shows` rather than
`shows-global`. Picking it leaves the scope *state* alone, so going Boosts ·
Follows → Shows → Episodes returns you to Follows. Adding Shows · Follows means
renaming the key and keeping `#shows` as an alias.

**Follows only exists for a signed-in npub.** Signed out, the scope menu is
`hidden` outright (a one-option dropdown is worse than none — it's hidden on
Shows for the same reason), and a `#episodes-follows` deep link is coerced to
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

**Each panel's own first child is a `[data-feed-search]` slot**, filled by
`feed-search.js` and left hidden until it is. It's inside the panel rather than
in the bar, so it scrolls away with the cards it filters. See the search note
under Feed loaders.

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

`index.html` keeps one theme block of its own — the five per-feed accents and
the `body[data-active-feed]` mapping — because those only mean anything on
the page that has the feeds. `assets/css/page.css` is the counterpart for the
plain content pages (`.page-header`, `.soon-card`).

Those stylesheets were written against localbitcoiners' token names
(`--cream`, `--navy`, `--orange`, `--green-d` …). Rather than rename ~300
usages across five files, the old names are kept as **aliases repointed at
the OnlyBoosts palette**. Trust the values, not the words — `--orange` is
brand cyan. New code should prefer `--brand` / `--ink` / `--surface`.

Brand colors are sampled from the supplied art: `--brand: #00aff0` (the
mark's cyan) and `--brand-d: #068ace` (its broadcast waves). The five feed
accents sit on one cyan→indigo ramp, so switching feed shifts the page wash
along a single system rather than to an unrelated color. Since the tab row
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
- `assets/js/boosts-feed.js` / `feeds-podcasts.js` — the four boost/episode feeds
  (the latter is the Episodes feed; see the naming note)
- `assets/js/shows-feed.js` — the show-level rollup (written here, not ported)
- `assets/js/feed-controls.js` — the range/sort chrome they all share
- `assets/js/feed-search.js` — the per-feed typeahead at the head of each panel
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

0. **The two Stats pages.** `/stats` (Boost Stats) and `/boosters` are
   coming-soon placeholders — `noindex`, out of `functions/sitemap.xml.js`,
   nav + header + soon-card and nothing else. They're the whole Stats column
   of the Explore menu, so both are visible to a visitor and both promise
   something.

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
   `/api/value` returns a clean 503 and "Boost episode" can't resolve a show's
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
| `episodes-global` | `feeds-podcasts.js` | `latest.json` + 3 recent months, rolled up by episode |
| `episodes-follows` | `feeds-podcasts.js` | `POST /api/v1/boosts/follows`, same rollup |
| `shows` | `shows-feed.js` | `podcasts/index.json` on All; the boost corpus rolled up by show on 1W/1M |

### Range and sort

Every feed carries a 1W/1M/All range and a sort dropdown, built by
`assets/js/feed-controls.js` and mounted into the feed bar. The chrome is
shared; **what the range means is not**, which is why each renderer passes its
own tooltips:

| | Range filters on | Sorts |
|---|---|---|
| Episodes | when the episode **aired** (`ep.published`) | latest boost / latest episode / most boosters / most boosts / most sats |
| Boosts | when the boost was **sent** (`b.ts`) | latest boost / latest episode / largest boost |
| Shows | when the show was **boosted** (`b.ts`) | most boosts / sats / boosters / episodes / recently boosted |

Air date and boost time are different axes on purpose: an old episode boosted
today is in the Episodes data but out of its 1W view, whereas the note and show
feeds are lists of boosts, where "the last 7 days" can only mean the boosts sent
in them. Filtering those by air date instead would drop most of what they hold,
since most boosts land on back catalogue.

The note feed's shorter menu is not an omission — a card there is one boost, so
"most boosters" has nothing to count. Its `episode` sort has to sink undated
rows explicitly: `episode.date` is null on ~12% of records, and a `0` fallback
would float them to the top.

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
panel ships an empty `[data-feed-search]` slot as its first child and the
renderer fills it; the slot stays `hidden` until one does, so a feed showing
"sign in" or an error never grows a search box over a list that isn't there.
**It sits inside the panel, not in the sticky bar** — range and sort are read
while scrolling a long list, a search is a thing you do at the top, and the bar
has no room for a text field beside two dropdowns on a phone.

Each feed searches its own subject, and picks exactly one:

| Feed | Searches | Filters to |
|---|---|---|
| Episodes | episode title, plus the show behind it | that one episode |
| Shows | show title, plus the guid | that one show |
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

Scoring is a ladder (exact / prefix / word-start / substring / label before
`extra`), not a fuzzy distance — these queries are the opening words of a name
the user already knows, so *where* a match lands beats how many characters it
shares. Ties break on the entry's position in the feed's current order, so a
one-letter query offers the biggest shows first. Measured at 12ms for 200
queries over the 1,384-show index, which is why there's no debounce.

The index is built lazily on the first keystroke after each `refresh()`, and
every renderer refreshes on repaint — range, sort, an account switch and a page
of older boosts all change what's searchable.

**Two backends, one record shape.** `ob-data.js` is the static half (immutable
CDN shards under `/api/data/*`); `ob-live.js` is the live half (D1 query API
under `/api/v1/*`). The split is not stylistic: a Global view is the same bytes
for every visitor and caches, a Follows view is scoped to the signed-in user's
contact list and cannot. Both normalize through `ob-data.js#normalizeBoosts`,
so everything downstream of the fetch sees one model and the card renderers are
shared. `ob-live.js` caches nothing in-process — the shard cache is safe only
because those files are immutable.

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

- **Boosts · Follows no longer pages backwards hunting for matches.** It used
  to: a follow set can match nothing in the most recent 1,000 boosts while
  having plenty further back, so the client walked month archives until
  something turned up. The D1 query answers that in one indexed hit, so an
  empty first page now genuinely means empty. The archive-walk branch survives
  on the Global path, where `latest.json` can lag.
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

**The range decides the source, because only one source can answer each range.**

- **All** → `podcasts/index.json`, the collector's own per-show rollup: 1,384
  shows with genuinely all-time counts in one ~440KB request, nothing
  aggregated in the browser. This is the file CLAUDE.md tells the *episode*
  feed not to use, and the reason is the same one that makes it right here —
  it's a show-level rollup, so a show-level view is exactly its consumer.
- **1W / 1M** → the boost corpus, grouped by `podcast.guid` in the browser. The
  published index has no per-window breakdown, so a windowed card can only be
  built from the boosts; and it must be, or "last 7 days" would be showing
  all-time sat totals.

The windowed path walks `latest.json` plus archives until the oldest row passes
the cutoff, so it's **0 extra requests for 1W and 1 for 1M** — and those are the
same shards the Episodes feeds pull, cached by `ob-data.js`, so opening Episodes
first makes it free. Verified against production: 1W = 309 rows → 93 shows, 1M =
1,092 rows → 170 shows, every one of them present in the all-time index with no
windowed count exceeding its all-time count.

Two data facts that shaped the UI, both measured over the live index:

- **462 of 1,384 shows (33%) have no title and no art.** The collector holds
  boosts tagged with their guid but Podcast Index doesn't know the feed. They're
  long tail — median 1 boost, 3.8% of all sats — and the first one doesn't
  appear until #28 on *any* sort, so they never reach the first page. They're
  kept rather than filtered (real boosts to real shows) and labelled
  "Unidentified show" with the guid, so an unnamed card reads as incomplete data
  rather than a bug.
- **Detail shards run 3.5KB at the median, 15KB at p90, and 1.95MB for the
  single most-boosted show.** That's why the episode drawer is an explicit
  expand on the All path. On a windowed range it costs nothing — the rollup
  already holds every boost, so the episode list is built in memory and no shard
  is fetched at all.

`byRange` caches the *grouping* per range for the page's lifetime, on top of
ob-data.js's HTTP cache, so toggling 1M → All → 1M repaints instantly.

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
