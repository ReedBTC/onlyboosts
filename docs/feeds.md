# The Feeds: Range, Sort, Rank, Language, Search

*Split out of `CLAUDE.md` on 2026-08-29, when that file passed its size budget.
This is the authority for the subject; `CLAUDE.md` keeps the rules a change would
break and points here for the arguments and the measurements. Nothing was rewritten
on the way across — `git log -S <symbol> -- CLAUDE.md` still finds any paragraph
that used to live there.*

---

### Range and sort

Every feed carries a range and a sort dropdown, built by
`assets/js/feed-controls.js`. The chrome is shared; **what the range means is
not**, which is why each renderer passes its own tooltips:

| | Range filters on | Sorts |
|---|---|---|
| Episodes / Songs | when the episode **aired** (`ep.published`) | chart rank / latest boost / latest episode / most boosters / most boosts / most sats |
| Boosts | when the boost was **sent** (`b.ts`) | latest boost / latest episode / largest boost |
| Shows / Albums | when the show was **boosted** (`b.ts`) | chart rank / most boosters / boosts / sats / recently boosted |

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
On the ranked feeds the range is a **query parameter** — `RANGE_DAYS` in
`functions/api/v1/episodes.js` and `…/podcasts.js` — so a wider window is a
different `WHERE` clause and costs nothing. **Those two tables and
`RANGE_OPTIONS` move together, or a range button answers 400.** The note feed
**walks** its window instead (`ensureCoverage`), and at ~38 boosts a day a year
is ~13,900 rows: ~70 sequential requests before the first card paints.
**⚠️ THE BOOSTS NOTE FEED GOT ITS 1Y ON 2026-08-23, AND NOT BY GAINING A
QUERY.** *Reed's call, on seeing it missing beside the members wall's four
buttons.* `/api/v1/boosts` does take `since`, but `globalBoostReader` still does
not pass it — a `since`-bounded page returns no cursor, so the client could not
page back **out** when the reader widens the range again. What 1Y got instead is
**the treatment All already had**: it is not pre-walked, a non-chronological sort
ranks only what has been loaded, and the count line says so in those words. The
honesty was already built; 1Y was the one bounded window big enough to need it.

**⚠️ `needsCoverage()` IS A FACT AND `shouldPreWalk()` IS A POLICY, and they are
separate on purpose.** The first says the loaded corpus does not yet reach the
window's cutoff; the second says we will sit and page until it does. Folding
`1y` into the fact takes the **load-older button** away from it too, because
that button is gated on the same condition — and a 1Y view that neither walks
nor offers to load more is a window the reader can never fill. `UNWALKED` is
the policy's whole content.

**⚠️ AND THE COUNT LINE KEYS ON COVERAGE, NOT ON THE RANGE.** `rangeKey !== 'all'`
was right while every bounded window was pre-walked, and would have made a
half-loaded 1Y claim completeness.

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

### The OnlyBoosts Charts

The site's composite ranking, `sort=chart`, shipped 2026-08-31 to Reed's spec.
It is the ranking the definitive published lists (a Top 100 of all time, a Top
10 of the week) will be read off, and the point of it is that the formula can
be stated completely in two lines:

- **Content** (a show, an episode, an album, a song, an artist): rank in sats
  + rank in boosts + rank in boosters, summed; **the lowest total is first**.
- **A member** (npub): rank in sats + rank in boosts + rank in **shows
  boosted**, the npub breadth key, since a person has no booster count.

Each component rank is the site's standard competition ranking (see the
section above) computed over the same corpus the request names: the medium
partition, the range window, the language filter, the follow set on a POST.
The method has prior art worth naming when asked: sailing's Low Point System
and cross-country team scoring are rank sums, and the BCS standings averaged
component rankings for fifteen years. The user-facing name is **OnlyBoosts
Charts**; the sort menu label is **Chart rank**.

**Ties in the total break by the breadth key (boosters, or shows boosted),
then sats, then boosts; a row still tied after that shares its place and
prints `T#`.** Reed's spec, 2026-08-31: audience size settles a tie before
generosity does. It should be noted that the boosts level is provably
unreachable (equal sats and breadth values force equal component ranks, so an
equal total then forces equal boosts); it is kept because the published spec
names it, and it costs one ORDER BY key.

What a change would break:

- **⚠️ THE STANDING IS THE TUPLE, SO THE TIEBREAK LIVES INSIDE THE `RANK()`
  WINDOW** — `(score, breadth DESC, sats DESC, boosts DESC)` — where every
  single-column sort keeps its tiebreak OUT of the window as a paging order
  that must never decide a standing. Both rules are deliberate and they are
  opposites, because here the tiebreak IS the published standing. Only rows
  equal on all four share a place.
- **⚠️ EVERY CHART ROW CARRIES `rank` AND `tied` FROM THE SERVER, and the
  renderers never renumber chart rows.** A tuple standing cannot be re-derived
  client-side from any single figure, so the chart sort rides the same
  server-rank path a `q=` search always used: `renumber()` and
  `syncRankLabels()` return early, `markSliceTies` never runs, and the tie
  flag is corpus-true rather than slice-local.
- **The formula is in the open on every row**: `chart: { score, sats, boosts,
  boosters|shows }` beside the rank. Transparency is the feature; do not trim
  it to save bytes.
- **⚠️ `q=` KEEPS RANK RETENTION, AND `peers` IS COUNTED BEFORE THE FILTER**,
  so a searched card agrees with the unfiltered feed and a tie flag survives
  its partner being filtered out (`test-charts.mjs` pins the TieOne case).
- **One spelling, `chart`, on all four endpoints** — `/api/v1/podcasts`,
  `/api/v1/episodes`, `/api/v1/publishers`, `/api/v1/members` — so the
  `count`/`boosters` wart has no sibling.
- **Follows feeds order by chart and print no rank numbers**, the standing
  `showRanks = scope !== 'follows'` rule: a follows corpus must not tell a
  reader their favourite show is "#1".
- **The members wall opens on Chart rank** (Reed's call, 2026-08-31,
  superseding the 2026-08-23 `shows` default — see `members-board.js`), and
  the wall's chart carries the same publisher exclusion as its listing.
- **The detail pages draw a Charts line above the stat tiles** from
  `feedRanks(...).chart`, under the same top-100 `RANK_CUTOFF` as the chips;
  the three tile ranks are the score's own components, which is what makes
  the line self-explaining. `/booster` overrides the link target and the
  breadth wording (`chartHref`, `chartBreadth`).
- **⚠️ COMPUTED AT QUERY TIME, DELIBERATELY — no collector precompute.** The
  Follows path can only be computed per request, so the query-time SQL must
  exist regardless, and a precomputed Global table would be a second
  implementation of the one definition. Measured cost is a window scan over
  corpora of a few thousand aggregated rows. If a live measurement ever says
  otherwise, the escape hatch is a chart table pushed through `d1_sync` the
  way podroll replaces wholesale.
- **A chart score is corpus-relative** (the Borda property): adding or
  excluding one row can move others' scores, and a range or language filter
  re-ranks from scratch. Positions are the stable claim; never compare raw
  scores across corpora or weeks. A definitive published list is therefore a
  **snapshot taken at publication time**, not a live query.

`scripts/test-charts.mjs` owns the correctness: brute-forced expectations from
an independent implementation of the rule, a micro-corpus that inverts if the
tiebreak chain is reordered, and it was confirmed red on four mutations (the
tuple tiebreak removed, the chain flipped in members.js and in feed-rank.js,
and `peers` counted post-filter).

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
pattern the detail pages share.

**The Boosts feeds have no language axis**: `/api/v1/boosts` and
`/api/v1/boosts/follows` take no `lang`. That is backend work, not a decision.

### The View In The Hash

`#shows?lang=de&range=1m&sort=sats` is a shareable view: the top German shows,
this month's shows by sats. Language shipped alone on 2026-08-17, on the argument
that a language names a body of work where a range and a sort are how one reader
is looking at a list; **range and sort joined on 2026-08-27, Reed's ask**, and
the shape had been left with room for them, so it was the promised extension
rather than a redesign. They ride the six `PARAM_FEEDS` feeds — Shows, Albums,
Episodes and Songs on both scopes — and deliberately not the Members feeds,
which have the controls but no shareable view.

**⚠️ A default value is elided, and the elision is the renderer's.** The bare
hash is the default view's address (`#shows`, never
`#shows?range=all&sort=boosters`), and the defaults are the renderers' to own —
**the episodes endpoint spells its boosters ranking `count` where the shows
endpoint says `boosters`**, so the controller validates a sort by *shape* only
(`normSort`) and passes it through; the renderer coerces an unknown key to its
default and reports back, which takes it out of the address bar. `normRange`
holds the real list (`1w|1m|1y`, mirroring `RANGE_OPTIONS`), and `range=all`
folds to no parameter the way `lang=all` does.

The pieces, and the awkward ones are all about a feed that is *already on
screen*:

- **`normLang` in the controller.** `?lang=en-US` normalizes to `en` the way the
  collector normalizes on write. **⚠️ `?lang=all` normalizes to NO FILTER**,
  because the API validates by shape and would take `all` as a well-formed subtag
  matching zero rows.
- **The opening view rides `lb:feed-activate`** into `feeds.js` and on into
  the renderer, so it reaches the **first** query. Applying it after one would
  paint the default feed and then correct itself. The cold load re-reads it off
  three body attributes (`data-feed-lang`, `data-feed-range`, `data-feed-sort`),
  the controller having dispatched during parse.
- **⚠️ A VIEW IN THE HASH REFUSES THE SERVER'S CARDS.** `functions/index.js`
  renders the opening page unfiltered at its own default range and sort, and a
  hash never reaches the server, so `adoptServerCards()` returns null whenever
  `langKey` is set or a URL-supplied range or sort differs from the state
  element's. Adopting would paint the all-time boosters board under a URL and
  controls claiming this month by sats. An explicit `?sort=boosters` that
  matches the server's view is adopted as before.
- **⚠️ `lb:set-feed-lang` and `lb:set-feed-view` exist because a hydrated feed
  cannot be re-loaded.** `feeds.js` runs each loader once, so a URL pasted into
  an open tab would move the hash and leave the cards alone. Each renderer
  module keeps a `LANG_APPLY` and a `VIEW_APPLY` map with **one** listener each,
  so a re-render replaces its entry rather than stacking a second listener that
  requeries twice. Range and sort travel as **one** event so a pasted URL costs
  one requery, and an externally-set view **rebuilds the range/sort controls**
  (the mountLangControl move), each control owning its own pressed/label state.
- **`lb:feed-lang` and `lb:feed-view` report back**, and the controller writes
  the hash from them. So a shareable URL is a side effect of using the controls,
  not something the reader assembles.

**Coercion happens twice, and both are the `#episodes-follows` precedent.** A
feed without the axes drops the parameters; and a value the feed cannot show — a
language with no menu row, a sort key the renderer's table refuses — is dropped,
reported, and taken out of the address bar. The report is what keeps the URL
from naming a view that is not on screen.

**The view does not carry across a feed switch.** Each renderer hydrates once and
owns its own controls, so carrying one would need a command channel into an
already-mounted control; the menus also differ, so a carried value could name
something the destination cannot show. `langByFeed`, `rangeByFeed` and
`sortByFeed` remember each feed's view, so returning to a feed restores both the
view and the address.

### Search

`assets/js/feed-search.js` is the typeahead at the head of every panel, inside
the panel rather than the sticky bar: range and sort are read while scrolling a
long list, a search is a thing you do at the top.

| Feed | Searches | A pick does | Enter does |
|---|---|---|---|
| Episodes / Songs | episode title, plus the show behind it | filters to that one episode | the feed becomes the full result list |
| Shows / Albums | show title, plus the guid | filters to that one show | the same |

**⚠️ THE MEMBERS LOOKUP IS NO LONGER IN THIS TABLE AND IS NOT A FILTER.** It
left the Boosts panel on 2026-08-23, leads the Members tab, and **navigates** to
`/booster/<npub>`. It is the same `mountFeedSearch`, so everything below about
debouncing, aborting and sequence-guarding still applies to it; nothing below
about rank retention or `noMatchText` does — **and it has no Enter-submit**,
deliberately (Reed's call, 2026-08-27: "leave npubs alone"), so there Enter
still takes the top suggestion. See **The member lookup**.

**Typing suggests, picking filters, Enter submits.** Five hits, and nothing in
the list moves until one is chosen — a pick answers "where does my show stand"
with one card carrying its rank. **Enter (2026-08-27, Reed's ask) answers the
other question**: the feed becomes the full scrollable result list for what was
typed, because five truncated hits is not an answer to "what's here about
bitcoin". Three things hold it together:

- **Results mode is the feed's own pipeline with `q=` attached** — the four
  ranked feeds' state gains a `query` beside `langKey`, every page load carries
  it, and the endpoints apply the active medium, range, sort, language and
  scope and page as usual (verified against production: `offset`/`next_offset`
  work on the `q=` path), so "Load more", the range buttons, the sort menu and
  the language pill all keep working *inside* the results.
- **⚠️ Query results are never renumbered.** Each row wears the server's
  `RANK()` over the whole ordering; `renumber()`/`competitionRanks` and the
  tie-sync are skipped. The tie flag comes from `rank.js#markSliceTies` —
  a rank repeated inside the slice is provably a tie, and a partner the query
  filtered out stays undisclosed, the same safe direction the open-ended feeds
  err in.
- **⚠️ `onSubmit` is what flips the box's Enter behaviour**, in feed-search.js:
  with it, suggestions are NOT auto-highlighted (Enter means "search what I
  typed" until the reader arrows into the menu, the submitting-combobox
  convention) and the menu grows a "See all results for …" footer row so a
  mouse-only reader can find it. Without it — the member lookup — nothing
  changed. Clearing arrives as `onPick(null)` either way, and **the renderer
  must reset its corpus when the query drops**, because `shows`/`items` hold
  RESULTS while one is active and `refetchUnfiltered`'s still-in-hand shortcut
  would repaint them as the feed.

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
scores a corpus the caller already holds in memory. **It has no caller on the
feeds any more** — the Boosts panel was its one user and its search is gone —
but it is what `#boosts`'s message filter and any future in-memory picker want,
so it stays. Scoring is a ladder (exact / prefix / word-start / substring /
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
### The Artists feed

`assets/js/artists-feed.js`, behind Artists in the feed bar — the third Music
sub-feed, shipped 2026-08-30. Music has three tiers of ownership — publisher >
album (show) > song (episode) — and `<podcast:publisher>` is the top one: in
practice the publisher is the ARTIST (Wavlake, Fountain and RSS Blue mint one
publisher feed per artist). The collector resolves the linkage from raw RSS
(Podcast Index carries no publisher field; `bots/global-boost-scan/publishers.py`
is the design record), and `GET /api/v1/publishers` aggregates the boosts to
every show declaring the publisher. Coverage, measured on the full corpus:
386 of 492 music shows (78%) declare one; 182 publishers.

The renderer is `shows-feed.js` minus the adoption machinery and the medium
split, and the two stay parallel on purpose. The card is
`assets/js/publisher-card.js` + `publisher-card-actions.js`, on the show card's
classes and discipline. What differs from the show-level rollups, each a
decision:

- **Global only and SCOPELESS**, like Shows and Albums, same reason.
- **The endpoint takes no medium.** The tier is ownership: 9 of the 395
  declaring shows are podcasts, and an artist's figures are the figures of
  everything they declared. The SURFACE sits under Music because the tag is a
  music-host feature today (zero coverage on anchor/podhome/buzzsprout),
  not because the query narrows.
- **Always a GROUP BY.** `publishers` carries no precomputed aggregates, so
  All aggregates like the windowed ranges do. 182 publishers over an indexed
  join; the windowed show path already does this work on every 1W press.
- **`lang` runs through the declaring shows' languages**: "German artists" is
  artists ranked by their German albums' boosts, and `lang=unknown` recounts
  over only the untagged half — NULL is not English, here as everywhere. The
  menu is the music facet (`languageOptions({medium:'music'})`), which is this
  feed's facet to within those nine shows.
- **Search is a LIKE, not FTS.** 182 rows do not earn an FTS table; the title
  LIKE escapes its wildcards (`likeEscape`, members.js's rule) and a pasted
  guid matches as an equality. The `q=` path still ranks with `RANK()` over
  the whole filtered ordering — rank retention holds.
- **The card's title links to `/artist/<guid>`** (the page shipped alongside,
  2026-08-30; `show-link.js#publisherPageHref` owns the rule). The drawer is
  the inline navigation: the artist's **indexed** albums from
  `GET /api/v1/publishers/<guid>`, ranked by sats and windowed with the
  card's range (`?since`, the show drawer's contract), each row linking to
  its `/show` page, with the foot linking the artist page. A MIXED drawer —
  an artist who also declares podcasts — renders the medium partition as two
  labelled groups (Albums, then Shows); unmixed drawers carry no labels.
- **⚠️ THE DRAWER IS INDEX-ONLY.** *Reed's call, 2026-08-30.* Nothing without
  at least one Nostr boost appears anywhere on this site — the podroll is the
  one standing exception, and it is not a ranked feed. The first cut listed
  the publisher feed's own catalogue on the podroll's argument and rendered
  ~270 titleless off-index Wavlake rows linking to raw XML. The endpoint now
  reads `podcasts WHERE publisher_guid` — exactly the shows the card's
  figures were computed over — and `albumRowsHtml` has **no external-URL
  branch at all**, so the rule is structural. `publisher_albums` (the
  artist's catalogue file) stays collected and deliberately unrendered; if
  off-index content ever comes to this site, it comes site-wide, not through
  this feed.
- **No boost pill.** `/api/value` resolves through Podcast Index, which cannot
  see most publisher feeds (measured: empty object for Wavlake artist guids).
  A pill that fails for most artists is worse than none; boosting stays one
  drawer-click away, at the album and song level.
- **No album count on the card face** — same reasoning as the episode count
  the show card dropped: a catalogue size is a claim about the artist's work,
  not about boost activity, and the drawer answers it properly.

`scripts/test-publishers-api.mjs` drives both shipped handlers over a
node:sqlite build of the real schema.

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
