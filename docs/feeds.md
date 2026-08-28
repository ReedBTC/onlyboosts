# The Ranked Feeds: Design Record

Moved out of CLAUDE.md on 2026-08-28 to keep that file within its size
budget. CLAUDE.md's "Feed loaders" section holds the operating rules; this file holds the full record behind five of its subsections (ranking, the language filter, the phone bar, the view in the hash, and search): the measurements and the rejected alternatives.
Headings are unchanged from CLAUDE.md, so `git log -S <text> -- CLAUDE.md`
still finds each section's earlier history there.

---

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
