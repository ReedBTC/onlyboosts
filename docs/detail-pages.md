# The Three Detail Pages

*Split out of `CLAUDE.md` on 2026-08-29, when that file passed its size budget.
This is the authority for the subject; `CLAUDE.md` keeps the rules a change would
break and points here for the arguments and the measurements. Nothing was rewritten
on the way across — `git log -S <symbol> -- CLAUDE.md` still finds any paragraph
that used to live there.*

---

### The Rank Line In The Stat Tiles

On `/show`, `/episode` **and `/booster`** each stat tile carries a third line,
`#4` or `T#118`:
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
  third line, which is what every page rendered before this and what any page
  still renders when the query fails.

**⚠️ `/booster` JOINED ON 2026-08-23, AND ITS THIRD KEY IS DIFFERENT.** *Reed's
call.* A show or an episode's third figure is how many **people** boosted it
(`boosters`); a booster's is how many **shows** they boosted (`shows`). Both are
the breadth axis of the list the subject is ranked on, but they are different
columns and different words, so `BOOSTER_RANK_KEYS` sits beside `RANK_KEYS`
rather than one array serving both.

**⚠️ THE EPISODES TILE CAME OFF, AND DROPPING IT IS WHAT LET THE OTHERS RANK.**
The members wall orders by sats, boosts and shows and by nothing else, so an
episodes tile could never carry a chip — and a fourth tile with a visibly empty
corner reads as a rank that failed to load rather than as a figure with no list
behind it. The figure is not lost: the `#shows` rollup's own rows still print
it, and the `#episodes` heading below opens with the count.

**⚠️ THE POPULATION IS THE WALL'S, PUBLISHER EXCLUSION AND ALL.** `RANK_PUBLISHERS`
in `feed-rank.js` restates `PUBLISHERS` from `functions/api/v1/_common.js`,
which it may not import without dragging the API surface in — **the two copies
must stay in step**. Ranking over a population that included those five keys
would be a rank on a list nobody can scroll: every member below `chadf-boostbot`
would read one place worse here than on the wall itself.

**⚠️ AND A PUBLISHER'S OWN PAGE GETS NO CHIPS, WHICH FALLS OUT FOR FREE.** The
subject is not in the CTE, so `at` is 0 and the shared `ranksFrom` guard returns
null — the same guard that catches a medium mismatch. That is the honest answer:
those keys are deliberately not on the wall, so they hold no place on it, and
printing one would contradict the Boost Bots section that says they were left
out.

**It rides the SECOND `Promise.all`, not the first**, because it needs `totals`
and the first batch is what produces them. So `/booster` pays
`first + max(second)` rather than one `max()`. Cost is one scan of `boosts`
(~23k rows) grouped to ~2k, against ~1.3k for a show — heavier than its
siblings, still behind the 300s edge cache, and it never throws.

**⚠️ `test-members-search.mjs`'s `env.DB` SHIM HAD NO `.first()` AND D1 DOES.**
`feedRanks` uses it, so every rank call threw inside that function's own
try/catch and came back null — which is its *documented failure mode*, so
"a publisher gets no rank" passed for entirely the wrong reason. A shim that
models less than the thing it stands in for turns a hard failure into a quiet
one. The rank block there brute-forces every rank against "strictly ahead, plus
one" over the same population, and was confirmed to go red with the exclusion
removed.
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
matching `/#members` and `/api/v1/podcasts`. It does not mean when the
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

**Ranges are 1W/1M/1Y/All, the same four `/#members` offers** since
2026-08-23. These sections hold a bounded corpus in memory, so every window is
complete and the count line can always claim so; that feed pages, so its 1Y is
covered progressively and its count line says which. Same buttons, different
guarantees, and only the note feed has to disclose one.

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
