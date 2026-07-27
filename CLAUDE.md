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
rewriting every month archive; instead `ob-data.js#mediumPredicate` joins
guid → medium through `podcasts/index.json`. That file is ~103KB over the wire
and cached for the page's lifetime, and the show-level feeds load it anyway, so
the join costs one request the first time and nothing after. `mediumPredicate`
returns `{ test, ok }`: on a failed join `test` keeps everything, so Episodes
degrades to an unsplit feed while the music callers read `ok` and say the index
is unavailable — an empty Songs feed is indistinguishable from a quiet week, so
it must not be the failure mode.

The one cost this imposes is on the **show-level windowed ranges**, which used
to need no extra request. `All` is the opening range on both Shows and Albums
and reads that file anyway, so a visitor who reaches 1W has already loaded it.

Songs has the Global/Follows axis and Albums doesn't. That asymmetry is about
the data source, not the medium: `feeds-podcasts.js` never reads the
show-level rollup, so its follows path works unchanged, while
`podcasts/index.json` is computed over everyone and cannot serve a filtered
audience. See the scope note in `shows-feed.js`.

**Songs · Global pays for the full boost corpus to paint ~120 cards** — it
filters the same `latest.json` + 3 months (~4.7MB) the Episodes feed pulls, of
which ~5% is music. Those shards are shared and cached, so opening Episodes
first makes it free, but a direct landing on `#songs-global` is expensive for
what it shows. A collector-side `boosts/music.json` shard would fix it; not
built.

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

`index.html` keeps one theme block of its own — the eight per-feed accents and
the `body[data-active-feed]` mapping — because those only mean anything on
the page that has the feeds. `assets/css/page.css` is the counterpart for the
plain content pages (`.page-header`, `.soon-card`).

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
  general-purpose relay. Don't prune it.

## What's built vs. what isn't

**Working, ported from LB:**
- `assets/js/boosts-feed.js` / `feeds-podcasts.js` — the boost feeds and the
  episode-level rollup behind both Episodes and Songs (see the naming note)
- `assets/js/shows-feed.js` — the show-level rollup behind Shows and Albums
  (written here, not ported)
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
| `songs-global` | `feeds-podcasts.js` | same as `episodes-global`, `medium: 'music'` |
| `songs-follows` | `feeds-podcasts.js` | same as `episodes-follows`, `medium: 'music'` |
| `shows` | `shows-feed.js` | `podcasts/index.json` on All; the boost corpus rolled up by show on 1W/1M |
| `albums` | `shows-feed.js` | same as `shows`, `medium: 'music'` |

### Range and sort

Every feed carries a 1W/1M/All range and a sort dropdown, built by
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

### The Boost Note's Episode Link

**Two surfaces start an external boost, and they must publish the same note.**
`feeds-podcasts.js` (the Episodes/Songs cards) and `show-page.js` (the
`/show/<guid>` episode rows) both call `LBLogin.openExternalBoost`, so they
share one modal (`ExternalBoostModal.jsx`) and one orchestrator
(`externalBoost.js`). What they did *not* share was the `bmbUrl` field:
the feed built a link inline while the show page passed `''`, and
`buildExternalNoteTemplate` gates both the content link line and the `r` tag on
it. The same episode boosted from the two pages therefore produced two
different notes. Fixed by `assets/js/episode-link.js#episodeBoostLink`, which
both now import.

**That module is the single owner of the target, and the target is temporary.**
It resolves to boostmebitch.com only because OnlyBoosts has no per-episode page
yet; when one lands, this function changes and every boost note follows. That is
the entire reason it exists as a shared function rather than as two inline URL
builders. `/show/<guid>` is **not** the replacement: a boost note is about one
episode, so pointing it at the show would drop the part the reader wants.

It returns null (caller sends `''`, template omits both) when there is no
episode to point at, which is also what a **show-level** boost from
`/show/<guid>` gets. Show pages carry no Podcast Index numeric id, so they
always resolve through `?podcast=<guid>` where the feed can prefer `?feed=`.

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

**The full sentence, on `/show`.** `.ob-scopenote` is defined in `theme.css` and
mounted in the show page hero. That is the page shows share, where the numbers
land in front of people who don't know what this site indexes, so it earns the
paragraph.

**`/about` gets neither.** Its Indexer Stats paragraph says more than the
sentence does and says it first; only the lead stat tile carries the word.

**A scope-note paragraph above the feed panels was built and removed.** It was
the first thing on the homepage, three lines on a phone, and it pushed the feed
below the fold to answer a question a browsing visitor had not asked yet. The
per-card label says the same thing in two words, at the point of the numbers.
Don't reintroduce it; if the qualifier ever needs more weight on `/`, the place
to add it is the masthead line, which already links to `/about`.

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
| Episodes / Songs | Primal (`loadBoosterProfiles`) | Primal (`loadMentionProfiles`) |
| Boosts | Primal (`hydrateProfiles`, post-paint per page) | same pass |
| `/show/<guid>` | Primal (`hydrateProfiles` in `show-page.js`) | same pass |

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
