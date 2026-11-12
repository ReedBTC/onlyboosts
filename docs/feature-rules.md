# Money Paths, Mentions, Detail Pages, Favorites

**Moved verbatim out of `CLAUDE.md` on 2026-11-11**, when that file had grown to 200KB and was
loaded into every session's context. Nothing was rewritten on the way across, so
`git log -S <phrase> -- CLAUDE.md` still finds the history of any paragraph here. Where a
paragraph says "this file", "above" or "below", it means the old `CLAUDE.md`; the four
files it became are `docs/site-structure.md`, `docs/architecture.md`,
`docs/feature-rules.md` and `docs/data-pipeline.md`. `CLAUDE.md` keeps the rules a change
elsewhere would break and points here for the reasoning.

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
  **deleted on 2026-08-23**; see `docs/strip-removed.md`. `boostagram.js`
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
| The Note Says One Number | **since 2026-11-11** (Reed's calls): at 90% or more landed the note goes out at the amount typed, by default, with no splits line; under 90% it says what landed, with the line. One figure in the body, the `amount` tag and the quoted receipt, and no second tag. The donor is asked only on the partial done screen. `resolveNoteFigure` in `externalBoostagram.js` is the one declaration of the floor. **An unconfirmed split counts as landed beside at least one confirmed split** (*An Unconfirmed Split Counts*, the same evening: Reed's 150-sat split timed out in the wallet, was reported as unpaid in the note, and had paid); only a FAILED split reduces the figure or prints the line, and a boost with nothing failed publishes itself after the watch. **With nothing confirmed, the booster may vouch for it** (2026-11-12): one button on the done screen, `attested` |
| One Split, Another Wallet | **since 2026-11-11**: a split that failed again on Retry gets a fresh invoice as a QR code for a different wallet. `FAILED` only, Lightning-address splits only, and **asking for it ends Retry for that split for good**; credit needs the provider's verify URL, and there is no self-attest. **It is offered only for an invoice the connected wallet declined**: a split that never got an invoice (`noInvoice`) gets no offer, and one the recipient's own limits rule out (`unpayable`; `maxSendable: 0` is a closed address, Reed's first live test) gets no Retry either |
| A Retried Split Belongs To The Same Boost | `boostRef`: the first pass, a Retry and the other-wallet invoice carry one boost id and the total as typed; a Retry used to tell Helipad the whole boost was the one split |
| The Login Is Not A Gate On The Wallet | no Gate 1; a session-only wallet, and why the NWC URI is never persisted |
| The Signer Session Survives The Tab | **since 2026-10-29**: the NIP-46 client secret's at-rest copy, wrapped under a non-extractable WebCrypto key in IndexedDB, so a phone's tab eviction no longer signs the member out; and **the login modal opens behind a tap, never on page load** (`forceLogoutWithMessage`'s `openLogin`) |
| The Boost Modal Declares What Happens To The Note | two controls, four outcomes, `boostAnonymously` vs `noteRoute` |
| A Donation Is The Boost Flow With One Leg | the nav's Donate button, and why a donation carries no `amount` tag |
| Getting A Boost Into Helipad | the three tiers, and why tier one is preferred |
| The Keysend Upgrade | the wallet gate, the `fountain.fm` exclusion, the whole-or-nothing routing pair |
| The Wallet Gate Is Behind The Boost Button | compose first, pay second; `remembered` is not `connected` |
| The Site Signs For A Booster Who Has No Key | `/api/sign-boost`, the allowlist validator, why proof-of-payment was rejected |
| The Note Quotes One Receipt | **`/api/sign-receipt`, since 2026-10-03**: the bot-signed kind 9735 for the sats that settled, quoted in the `q` tag AND the body because Fountain draws the ⚡ figure off the first quoted receipt and nothing else; who signs the 9734 follows who signs the note; the pre-signed note's receipt is signed and HELD until every leg paid; the boost oracle admits `q` once, under the bot's key only; **the cards do not show the reference** (2026-10-29): `stripNoteRefs` in `nostr-text.js` drops every note, nevent and naddr reference from a rendered message, on every surface, people staying chips |
| The one boost button | `boost-button.js` is chrome, not a money path; six surfaces, six handlers |
| The Boost Is Indexed At The Edge Before The Collector Sees It | `/api/v1/boosts/ingest`, the site's own boosts on the feeds in seconds; why the edge's row is provisional and what the collector owes `boosts_edge` |
| The Boostagram Message Cap | 300 bytes, measured against the 1,300-byte onion over 800 episodes; why `url` became the feed URL and `boost_link` the page; the lnaddress side's `commentAllowed` sample |
| The Feed URL Resolves Before The Guid | `/api/value` and `/api/catalogue` resolve the stored feed URL before the guid, because Podcast Index's one-feed-per-guid answer can be a dead record with a year-old value block |
| The Value Block Comes From The RSS, And Podcast Index Is The Fallback | **`/api/value` reads the show's own feed first, since 2026-09-23**; PI's episode records keep the block each song was ingested with, and ten of Jimmy V's thirteen songs paid a stale seven-leg split. PI answers only for an unreachable feed, a feed with no block anywhere (Anchor), or an item past the 4MB cap |

Six rules from it that a change elsewhere would break, so they are restated here:

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
  **Since 2026-09-04 Check again also asks the WALLET** (NIP-47 lookup by
  payment hash, `paymentLookup.js`), which is what makes a keysend leg and a
  no-verify-URL leg checkable at all; the wallet's explicit `failed` is the
  one thing that moves `UNCERTAIN` to `FAILED`, and it is never inferred.
  See *The wallet is the second source of truth* in `docs/money-paths.md`.
- **⚠️ THE NOTE'S FIGURE IS `resolveNoteFigure`'S ANSWER AND NOTHING ELSE
  DECIDES IT** (2026-11-11). The body, the `amount` tag and the summary
  receipt carry that one number; the splits line prints only when the figure
  is the lesser total; the modal holds no copy of the 90% comparison. **A
  split whose invoice has been shown for another wallet is never retried
  from the connected one** (`canRepayLeg` reads `leg.qr`).
- **⚠️ ONLY A FAILED SPLIT TAKES ANYTHING OFF THE NOTE** (Reed's call,
  2026-11-11: "we better be damn sure that the thing failed if we're going
  to mark it as failed"). An `UNCERTAIN` split counts toward the figure and
  the split count **beside at least one confirmed split**, and never with
  none (an offline wallet leaves every split unconfirmed). It is credited,
  not re-paid: the rule above is untouched. The note waits on `watchSettled`,
  not on `stillChecking`, which is false on the done phase's first render.
- **⚠️ THE TWO OVERRIDE MAPS STAY EMPTY** — see above. That is the one rule in
  this file that has already been violated in production.
- **⚠️ THE ORACLE'S CAP AND THE MODAL'S ARE THE SAME NUMBER** (5,000,000 sats).
  `SITE_SIGN_MAX_SATS` restates `MAX_AMOUNT_MSAT`; `scripts/test-sign-boost.mjs`
  enforces the equality, and the validator is fed by the **shipped** note builder
  so a new tag fails the test rather than production.

## @Mentions: `mention-search.js`

**`docs/mentions.md` is the authority.** Type `@` and a name in any of the
four composers (the boost modal's message, the reply box, the zap message,
the share modal's text) and a menu of people from Primal's cache opens,
**most followed first**; a pick inserts `@label`. Built 2026-09-09, Reed's
ask, on mynostr's shape. What a change elsewhere would break:

- **⚠️ THE NOTE CARRIES `nostr:npub1…`, NEVER `@npub1…` AND NEVER THE LABEL.**
  Reed's rule: the NIP-27 form is what Helipad and every client render as a
  mention. The field holds `@reed`; the composer's map (`createMentionMap`)
  holds the pubkey; **`expand()` is the note**. Every publish reads the picker
  (`mentions.expand()`, or `expandedMessage` in the boost modal) and never the
  field's value — a note that ships the label publishes fine and mentions
  nobody. `test-mentions.mjs` holds each call site by text scan.
- **⚠️ THE BOT ROUTE CARRIES NO `p` TAG, AND THE ORACLE REFUSES ONE.** The
  note builders take `mentionPubkeys` as an opt-in defaulting to empty; the
  boost modal passes it on the donor route alone. A zap request gets none
  either (NIP-57 reads its one `p` as the recipient). Replies and shares tag
  every mentioned pubkey.
- **⚠️ THE MESSAGE CAP IS 300 BYTES OF UTF-8, MEASURED ON THE EXPANDED
  MESSAGE** (`MAX_MESSAGE_BYTES` / `clipMessage`; it was 200 characters, BMB's
  number, until 2026-09-09). An npub is 69 bytes and an emoji four; the boost
  modal's counter and its `onChange` guard read the expansion in bytes, and
  `maxLength` came off the textarea. **The boostagram's `url` is the feed URL
  and `boost_link` the episode page**, which is what made 300 fit; see *The
  Boostagram Message Cap* in `docs/money-paths.md` for the measurement.
- **The lead-in runs past a space since 2026-10-03** (a display name has
  them), to three spaces; Primal answers a spaced query with nothing, so it is
  sent spaceless and narrowed locally, and each picker hands the trigger its
  own map so a made mention does not re-open the menu. **The Trigger** in
  `docs/mentions.md` has the measurements.
- **`:)` becomes 🙂 in every composer** (Reed's ask, 2026-10-22):
  `emoticonAt` in `mention-search.js`, run by the picker's input listener
  and by the boost modal's `onChange`; only the emoticon just typed, on its
  own, and nothing but `:)` / `:-)`. **The Smiley** in `docs/mentions.md`.
- **⚠️ `mention-search.js` IMPORTS NOTHING.** The widget inlines it by
  relative path (`../../../assets/js/`) and the site loads it stamped; a
  `./sibling.js?v=` import is read differently by Vite and the stamper.
  The bech32 codec is written out there for that reason, checked against
  nostr-tools in the test.

## The detail pages

`/show/<guid>`, `/episode/<item-guid>`, `/booster/<npub>` and `/artist/<guid>`
are **one page with four subjects** (the artist page joined 2026-08-30). The back link, the stat tiles, the drawers, the boost list, the
community wall and the whole client chrome come out of two shared modules; what
differs is the subject and which sections apply.

| | `/show` | `/episode` | `/booster` |
|---|---|---|---|
| Hero | show art, "Boost this Show" | a **player card**: art, audio, chapters + show-notes drawers, eyebrow links the show | the person: avatar, banner, bio, lightning address |
| Stats | show totals | that episode's | that person's |
| Rollup | `#community-shows` | `#community-episodes` | four rails since 2026-11-08, `#shows` (Podcasts Boosted, Albums Boosted) and `#episodes` (Episodes Boosted, Songs Boosted), split on the medium at last; the owner sees `#recommended` in their place (none for a day on 2026-11-07, drawers before) |
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
  `#community` `#community-shows` `#podroll` `#reverse-podroll` `#boosts`.
  `/episode`: `#community` `#community-episodes` `#boosts`. `/booster`:
  `#favorites` `#latest` (2026-11-08, the owner's) `#recommended` (2026-10-20) `#boosts`; **`#shows` and `#episodes`
  were its two rollups until 2026-11-07 and ARE ITS FOUR BOOSTED RAILS
  SINCE 2026-11-08** (for a day they aliased to `#boosts`; Reed's call of the 7th: the `#boosts` list
  answers both, with a By show menu and a search over the show and episode
  titles, and the recommendations became rails) and alias to `#boosts`. Ids are reused across pages on purpose where they name the
  same kind of section. `HASH_ALIASES` holds one permanent entry on `/show`
  (`#inverse-podroll`) and two on `/booster`, and **is the repair for a rename that already happened, not
  a licence for the next one** — it needs the module to have run, so a rename is
  still a dead link for anything resolving the URL without a browser.
- **Four pieces hold those ids up, in four files**: the ids on the `<section>`
  elements, `scroll-margin-top: 5rem` on `.show-section` (the nav is sticky at
  64px), `revealHashTarget()`, and `initHashSpy()`.
- **⚠️ THE HASH SPY USES `replaceState`, NEVER `pushState`.** Scrolling isn't
  navigation, and `replaceState` fires **no `hashchange`** — which is the only thing
  stopping the spy tripping `revealHashTarget()` and opening a drawer as a side
  effect of scrolling past it. The two coexist on exactly that property.
- **⚠️ EVERY DRAWER ON THE FOUR PAGES OPENS ON "Overall"** (2026-09-03,
  Reed's ask; the key is `chart`, the label deliberately not "Chart rank"
  inside a drawer): the chart formula over the drawer's own rows, computed by the
  two-sided `rank.js#chartRanks` on both sides, so the Function's order and
  the page script's first re-sort are one function. The breadth key is the
  drawer's own (boosters; the community's boosters; episodes on `/booster`'s
  shows). See **The community rollups** in `docs/detail-pages.md`. **⚠️ ONE
  EXCEPTION SINCE 2026-09-04: THE PODCAST `/show` DRAWER IS THE SHOW'S WHOLE
  CATALOGUE AND OPENS ON LATEST EPISODE.** *Reed's call.* Its summary reads
  "Episodes"; the edge renders the indexed rows and
  `assets/js/episode-catalogue.js` merges the rest of the show's episodes from
  Podcast Index through `/api/catalogue` when the drawer is opened, each with a
  Boost button (the existing `/api/value` path resolves any item guid), a title
  linking to BMB, date and duration and **no figures**. Indexed rows wear
  `.ep-row--indexed`. Nothing touches D1; the boost's note is what creates the
  episode's page, on the next collector cycle. The drawer declares its opening
  sort in `data-ep-sort`, and `COPY.podcast.catalogue` is the switch (music is
  deliberately still the boosted list). It is a written exception to the
  rendering rule. **The Catalogue** in `docs/show-pages-spec.md` is the design
  record; `test-catalogue.mjs` covers the Function and the drawer markup.
- **⚠️ THE CHART STRIP'S FOUR LEADERBOARDS ARE COMPUTED ONCE AND CACHED IN
  KV, NOT ONCE PER PAGE VIEW — SINCE 2026-09-07, AND THE REASON WAS A BILL.**
  `feedRanks` ran the population-wide `RANK()` query four times per render
  with one row kept (all time + Week/Month/Year), 286k D1 rows read for the
  all-time episode chart alone, ~590k per episode page and ~540k per booster
  page; SEO and AI crawlers (Ahrefs, Semrush, Amazonbot, Meta) were 70% of
  the page views, and D1 read **12 billion rows on 2026-09-04** against
  ~150M/day before the strip shipped on 2026-08-31 — the month's included 25B
  ran out that day and the budget alert fired. `chartTable` in
  `feed-rank.js` now computes each (kind, medium side, window) table once,
  keeps it in KV (`env.CHART_KV` if ever bound, else the oracle's
  `SIGN_RATELIMIT` namespace under a `chart:` prefix), serves a stale copy
  while refreshing behind `waitUntil`, and every page looks its subject up —
  the all-time component chips too, so a warm render reads **no** chart rows,
  and the ranking runs in JavaScript over the base rows (the SQL window
  functions cost 286k rows per all-time episode table, the base 24k). **Two
  minutes is the collector's tick**, Reed's call: a boost on the site is on
  the strip too, so a share-card screenshot matches everything around it. `chartCacheOf(context)` is what
  the four pages pass; with no KV (tests, local dev) it computes per call as
  before. `test-charts.mjs` pins that the cached answer is the direct answer
  and that a warm cache runs zero statements. **Same day, Reed blocked
  Meta-ExternalAgent, Amazonbot, ClaudeBot and GPTBot in AI Crawl Control
  and `robots.txt` disallows AhrefsBot, SemrushBot and MJ12bot.** The
  read-only `CF_ANALYTICS_TOKEN` in `credentials.env` is how the per-query
  numbers were pulled (GraphQL `d1QueriesAdaptiveGroups`); check it before
  guessing at a D1 cost again. **⚠️ THE PAGES' `max-age=300` NEVER CACHED
  ANYTHING AT THE EDGE.** Cloudflare caches only static file types by default
  and ignores `Cache-Control` on HTML and JSON, so every Function response
  answered `cf-cache-status: DYNAMIC` and every repeat hit ran the Function; a
  zone Cache Rule marking the page and `/api/v1` paths eligible (respecting the
  origin's own header, so the money endpoints' `no-store` still holds) is the
  dashboard-side half, Reed's to set. (A HEAD request answers `no-store` on
  the same paths, which is what misled the first diagnosis into blaming a
  zone rule; check GET.)
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

## PC 2.0 Favorites: `favorites-merge.js`

**`docs/favorites.md` is the authority.** Chad Farrow's cross-app favorites,
kind 10333: one replaceable event per pubkey, feed and item entries, public or
private as a whole. **All six steps built 2026-09-08: the merge, the reader,
the writer, the heart, the `/booster` section and the account menu rows.
Reed's first live lists reached BoostMeBitch, and artist favorites are written
here first (neither app renders one yet). The migration gate lifted
2026-10-03: episode and song hearts are live, the merge is re-vendored at
the spec's ca652a9 (31 vectors), an empty list is public by rule, and snort
is a publish target (theforest refuses the write and is deliberately out).**
- **⚠️ `favorites-ui.js` IS LOADED ON EVERY PAGE BY `nav.js`**, a dynamic
  import at the end of its IIFE, lazily (no hearts, no relay read). It
  exposes `window.OBFavorites` for the widget's Favorites row; a mode change
  from there is a `userChose` publish cycle, never a standing setting acted
  on. The dark-mode row presses `.nav-theme-toggle` so nav.js keeps ownership.
- **⚠️ THE MENU'S SETTINGS FOLLOW THE ACCOUNT AS A NIP-78 EVENT** (kind 30078,
  `d` = `onlyboosts:settings`, NIP-44 to self; BMB's own pattern):
  `account-settings.js` pushes on change and pulls on login, newest wins
  with the tie to the device. The theme is applied by pressing the nav
  toggle; `favoritesMode` on the event is a stored choice, never a flip.
- **Per-entry public/private is TABLED** (Reed, 2026-09-09): the spec is one
  mode per list; Reed takes NIP-51's per-entry model up with Chad first, and
  nothing goes to GitHub on it before that.

- **⚠️ A HEART CLICK WAITS FOR THE REAL SIGNER AND DECIDES ADD OR REMOVE
  AFTER THE FULL READ** (2026-10-29, Reed's report that a click did nothing):
  the widget boots on a stub user, so `onClick` waits on the widget's
  `isSessionReady()`; an unopened private half paints a heart UNKNOWN, not
  off; `unchanged` gets a toast too; on reads "Favorited" on a tinted pill.
  **A button in flight keeps its word** (2026-11-08, Reed: a press looked
  ignored for twenty seconds): the click's own re-read ran `paintAll`,
  which wrote "Follow" over "Saving…"; `paint` skips an `is-busy` button,
  the pill pulses, and a list with no private content is `privateOpened`
  on the first read so a click does not read it again.
- **⚠️ A PODCAST SHOW IS FOLLOWED, EVERYTHING ELSE IS FAVORITED** (Reed's
  call, 2026-11-07): the show-level button on the podcast side reads Follow /
  Following, plus → check; episodes, albums, songs and artists keep Favorite
  and the heart. `wordsFor` / `isFollow` in `favorite-button.js`; wording and
  glyph only, the kind 10333 event is unchanged. The list is **Follows and
  Favorites** on every surface that names it, **and on `/booster` it is
  THREE DRAWERS since 2026-11-08** (Reed's call): Podcasts You Follow (the
  OPML band), Favorite Podcast Episodes, Favorite Music (Artists / Albums /
  Songs under the Show menu); `DRAWERS` in `favorites-section.js`. See
  **The Heart** in `docs/favorites.md`.
- **⚠️ OPML IMPORT ADDS AND NEVER REMOVES, A PRIVATE FEED ADDRESS NEVER
  LEAVES THE DEVICE, AND A VISITOR WITH NO ACCOUNT CAN IMPORT** (2026-11-07,
  Reed's asks; BMB's rules in `assets/js/opml.js`, two-sided and
  dependency-free). `POST /api/v1/feeds/resolve` turns feed URLs into guids
  (D1 `feed_url` first, PI `byfeedurl` for the rest, `PI_MAX` a request;
  three states, ABSENT is never "not found"); `POST /api/v1/opml/link` reads
  a pasted link server-side and answers outlines only; a signed-out import
  lives in `ob_local_follows` in that browser, seeds the homepage's
  Recommended and Because rails through the endpoint's favorites-only form,
  and is offered to the Nostr list on login; `syncFavorites` takes a batch
  and publishes once. Three doors: the homepage's locked cards, the account
  menu, the owner's `/booster` band. **OPML Import And Export** in
  `docs/favorites.md`; `test-opml.mjs`.
- **⚠️ THE HEART SHIPS `hidden` AND `favorites-ui.js` REVEALS IT FOR A
  SIGNED-IN MEMBER ONLY** (Reed: signed out gets nothing). `favorite-button.js`
  is two-sided chrome on the boost-button pattern, rendered by both cards and
  the /show and /episode Functions ahead of the boost pill. **Episode hearts
  are revealed like show hearts since 2026-10-03**: `ITEMS_ALLOWED` and the
  writer's `items-gated` status are gone, not flipped, because both shipped
  apps have read and written the three-element item since 2026-09-08. The
  catalogue drawer's un-indexed rows still carry no heart.

- **⚠️ THE MERGE IS THE SPEC'S REFERENCE IMPLEMENTATION, LIFTED WITH CHAD'S
  OK, AND THE SPEC'S OWN VECTORS RUN AGAINST IT.** Two adaptations: no
  stand-in codec (real NIP-44 is async, so `plan` takes `readPrivate` in and
  hands `privatePlaintext` out), and TextEncoder for Buffer. **A change the
  vectors do not cover is a change to the spec and goes upstream first**:
  issue #37 (a removal never propagated on a private list) went that way on
  2026-09-08, Chad found a third case, and the module is lifted from the fix
  (PR #38). **Vendor from main, never a PR branch**: main moved three more
  times that day (#40, #47, #49) and the site shipped four red vectors for
  three weeks; re-lifted at ca652a9 on 2026-10-03, 31 vectors. **An empty,
  untagged list is public by rule** (#47) and never asks; the Public/Private
  dialog is for a list that holds entries and cannot say which half.
- **⚠️ ONLYBOOSTS ADOPTS THE LIST AND CLAIMS WHAT IT RENDERS**, both halves,
  with a hydrate pass at the top of every cycle; without it an unfavorite of
  another app's entry silently does not stick. The writer never uses NIP-04,
  records the baseline only on a relay's `OK true`, and refuses an event the
  signer returns under another key.
- **⚠️ ONE FAVORITE, ONE TAG, SINCE THE SPEC'S 9b04dfe (2026-09-07):** a
  feed is `["i", feed]`, an item is `["i", feed, item]`, an artist is a bare
  publisher entry. **No item favorite is written until BOTH existing apps read
  the three-element form** (stage 1 of the feed-guid migration): a reader that
  does not know it turns an episode favorite into a favorite of the whole show.
  **Both have since 2026-09-08 (BMB #364, StableKraft #256)**, so item
  favorites are written and a legacy item on a list is rewritten on the next
  publish, as vector 27 requires (2026-10-03).
- **⚠️ `relay.fountain.fm` REFUSES THE KIND, AND ONE RELAY HELD A STALE
  PRIVATE-MODE COPY WITH ZERO PUBLIC TAGS.** `favorites-read.js` counts per
  relay on raw sockets, never a pool's aggregate EOSE: **trusted on a
  QUORUM since 2026-10-30** (Reed's call): two answers, plus a 1.5s grace for
  the rest, and a relay that opens and stays silent no longer degrades the
  read (until then every reached relay had to answer, and one silent relay,
  damus, broke every heart); newest wins; an untrusted read is `null`, which
  is not an empty list. See `docs/favorites.md`.
- **⚠️ EVERY RELAY ANOTHER APP READS THAT ACCEPTS THE KIND IS IN
  `PUBLISH_RELAYS`.** BMB believes the newest copy it hears within 1.5s of
  the first; primal was in its read set and not in our publish set, and a
  favorite made on `/show` did not reach BMB until re-made (Reed's first
  live test, 2026-09-08). Primal is in both sets now.
