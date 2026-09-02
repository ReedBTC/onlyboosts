# The Members Tab

*Split out of `CLAUDE.md` on 2026-08-29, when that file passed its size budget.
This is the authority for the subject; `CLAUDE.md` keeps the rules a change would
break and points here for the arguments and the measurements. Nothing was rewritten
on the way across — `git log -S <symbol> -- CLAUDE.md` still finds any paragraph
that used to live there.*

---

### The Members Tab

Three sections above the boost firehose, all client-rendered by
`assets/js/members-board.js` and hydrated on the tab's first activation.

**⚠️ THE TAB IS FOUR SECTIONS AND THEY SHARE ONE IDIOM.** #40HPW, Members,
Boost Bots, Boosts. *Reed's call, 2026-08-23:* they read as four loose blocks
stacked in a column where `/show` and `/episode` read as a page made of definite
parts. `.mb-section` restates what those pages get their definition from — a
2.75rem top margin, a Playfair `h2` at the same `clamp(1.2rem, 3vw, 1.6rem)`,
and a `.mb-section-sub` at the same muted 0.88rem.

**⚠️ AND EACH SECTION'S CONTENT LIVES IN A SHELL**, which is where those pages
actually get their edges from. *Reed's call, 2026-08-23: "the boosts live in
their own little shell… can you do that for the members page?"* A hairline above
each heading shipped first as a guess at the same effect and **came back out** —
with the content boxed, a rule above the heading is a second boundary for one
break.

**⚠️ `.mb-shell` AND `.mb-lid` RESTATE `.bs-shell` AND `.bs-controls`, THEY DO
NOT IMPORT THEM.** This page does not link `show-page.css` (30KB of detail-page
chrome for four rules), so the values are copied: 1px `--border`, **12px**
radius, `--cream` fill, and a lid one step darker on `--cream-d` with a bottom
border and no top one. **They must stay in step** — a shell here at 10px where
`/booster` is 12px reads as a different component to anyone who visits both.
`.bots-list` and `.hpw-board` were exactly that near-miss and were corrected.

| Section | Shell |
|---|---|
| #40HPW | each board is one, no lid (no controls) |
| Members | heading outside, range + sort as the lid |
| Boost Bots | the `<ul>` is the shell, no lid |
| Boosts | **two elements** — see below |

**⚠️ THE BOOSTS SHELL IS TWO ELEMENTS AND THE SEAM IS THE WHOLE RISK.** The bar
is the lid and the cards are the body, but the cards live in `.feed-panel`s
outside the section — that panel system serves seven other feeds and moving them
in would fork it. So the lid closes its own bottom (`.mb-shell--lid-only`) and
the active panel opens its own top, both scoped to
`body[data-active-tab="members"]`. **Any vertical margin on either half opens a
gap the border makes visible.**

**⚠️ AND IT OPENED ONE ON THE FIRST TRY: `.mb-section`'s OWN `margin-bottom`.**
That rule gives every section on the tab 2.75rem of space beneath it, which is
right for three of them and wrong for the one whose box *continues into the
element after it* — the result was 2.75rem of nothing between a lid and its
body with the border drawing both edges of the hole. `.members-boosts` zeroes
it. The warning above was written before this shipped and did not save it;
**check the containing section's margin, not only the two halves.**

**⚠️ AND NO `overflow: hidden` ON A SHELL WHOSE LID HOLDS A DROPDOWN.**
`.bs-shell` carries it and gets away with it because its lid sits on top of a
tall list, so the sort menu opens downward *into* the shell. The Boosts lid has
nothing under it inside its own shell, so the menu was clipped the instant it
opened — reported as "the dropdowns get hidden in the gap", the two faults
compounding into one symptom. `.mb-lid` takes the top corners itself, which is
all the clip was doing. `.bots-list` keeps its clip: no dropdown, and its rows
carry their own fill to the rounded edge.

**⚠️ NO `max-width` OR `margin` IN THE SCOPED `.feed-bar` RULE.** Both are
no-ops (the shell already sits inside `.feed-panels-inner`, which reads the
track), and `test-feed-hash.mjs` scans declarations for `.feed-bar` to assert
four elements read `var(--feed-track)` — so a scoped `max-width: none` reads to
it as the track declaration going away. It failed exactly that way once.
Restyle the fill and the padding there; leave the box model to the base rule.

**⚠️ THE WALL'S HEADING IS renderSupporters' AND IS MOVED, NOT REWRITTEN.** The
word is a parameter — "Members" here, "Nostr Community" on the detail pages — so
it is rendered inside that section and lifted into
`[data-members-wall-head]` above the shell, the same `appendChild` move the
controls make. Writing it a second time in `index.html` would be two copies that
could disagree.

**⚠️ AND IT HAS TWO SHAPES.** A populated wall wraps the heading in
`.show-section-head`; the empty branch emits a **bare `<h2>`**. Selecting only
the first left an empty range untitled.

**⚠️ THE EMPTY RANGE GOES THROUGH `renderSupporters` TOO, and that is not
tidiness.** A hand-written "nothing here" paragraph replaced the whole body,
taking the shell and its lid with it — so a reader who narrowed to 1W and found
nobody **lost the range control that would have widened it again**. The dead end
was the bug, not the empty list.

**⚠️ `chart` IS THE WALL'S DEFAULT ORDERING SINCE 2026-08-31.** *Reed's call,
shipping the OnlyBoosts Charts (see that section of `docs/feeds.md`): rank in
sats + rank in boosts + rank in shows boosted, summed, lowest total first,
ties broken shows → sats → boosts.* It supersedes the 2026-08-23 `shows`
default, and the reasoning behind that one carries into this one: breadth is
what rewards listening across the network, and it stays in the formula as both
a component and the first tiebreaker, so no single axis is presented as "the"
story. The single-axis orderings (sats, boosts, shows) are one press away. The
wall still prints no rank numerals — the face's figure under `chart` is sats,
with all three components in the tooltip — and the chart inherits the wall's
publisher exclusion, being computed over the same listing.

**⚠️ THE BOARD TITLES ARE CENTRED AND THEIR SUB-LINES ARE NOT.** *Reed's call,
2026-08-23.* "This Week" and "Proof of #40HPW" name the board the way a scoreboard's
own header does; the line under it is a caption, and a centred caption over a
left-aligned list of rows reads as a second heading rather than as a note. The
`<small>` is inside the `<h3>`, so it opts out of the alignment explicitly.

**Rules sits in the #40HPW sub-line**, not under the boards. *Reed's call,
2026-08-23.* Below them it was a footnote to two tall boxes and read as
belonging to the second one; on the line stating the challenge it is where the
question it answers gets asked.

**⚠️ NO SECTION STYLES ITS OWN HEADING ANY MORE.** `.hpw-heading`, `.hpw-sub`,
`.bots-title` and `.bots-sub` are gone, and `members-board.js` emits the shared
`.mb-section-head` markup. `.bots-title` set its type with a `font:` shorthand
at (0,1,0) against `.mb-section > h2` at (0,1,1) — the exact specificity trap
`.show-stat dd` documents in `show-page.css`, and it would have won on
line-height while losing on family.

**⚠️ THE FEED BAR IS MOVED INTO THIS TAB, AND MOVED BACK.** `placeFeedBar` in
the controller relocates `.feed-bar` — the scope menu plus every feed's mounted
range/sort group — into `[data-feed-bar-slot]` inside the Boosts section, and
returns it to `.feed-bar-wrap` on every other tab. *Reed's call, 2026-08-23:*
every other tab puts its feed directly under the bar, so sticky-at-the-top is
right; Members puts three sections above the boost list, which left the controls
a screen and a half from the list they act on, and the list itself unnamed.

- **It is a MOVE, never a duplicate.** `appendChild` relocates the live element
  with its listeners, its open-menu state and all eight `[data-controls-for]`
  groups intact, so the declarative `body[data-active-feed]` rule that decides
  which group is on screen is untouched. A second bar would be two sets of
  controls over one feed, which is the failure that rule exists to prevent.
- **⚠️ THE MOVE BACK IS THE HALF THAT BREAKS.** `.members-block` is
  `display:none` off this tab, so a bar left in the slot vanishes from every
  other feed: no scope menu, no range, no sort, and nothing saying why.
- It stops being sticky for free — `.feed-bar-wrap` carries the `position`, and
  the slot is an ordinary section.
- `test-feed-hash.mjs` pins both directions, and **its window stub now keeps its
  listeners** so `hashchange` can be fired. It was `{ addEventListener(){} }`,
  which silently dropped that handler and made every test in the file a
  cold-load test; anything that happens when a reader moves between tabs was
  untestable before this.

**⚠️ THE WALL CARRIES NO SUB-LINE.** *Reed's call, 2026-08-23.* It read
"Everyone who has boosted a show, all time. Top 100." — a definition the intro
at the top of the tab has already given, a window the range control beside it
already names, and a cap nobody asked about. `.show-section-sub:empty` is what
keeps the `<p>` `renderSupporters` always emits from costing a blank line.

**⚠️ THE BLOCK SITS ABOVE THE PANELS, NOT INSIDE ONE.** Members holds two boosts
PANELS — Global and Follows — so a section inside one would either be duplicated
or vanish when the reader switches scope. Shown by CSS off
`body[data-active-tab]`.

**⚠️ AND IT HYDRATES FROM BOTH ENTRY POINTS.** The cold load does not go through
`lb:feed-activate` — the controller dispatches that during parse, before
`feeds.js` exists, which is why `feeds.js` re-reads `body[data-active-feed]` at
the end. Hooked to the listener alone, the boards rendered when a reader
*clicked* to Members and were an empty gap on every reload and every shared
link. `test-feed-hash.mjs` asserts both call sites exist.

#### `#40HPW`

**The section's visible heading is "Nostr Gang #40HPW Challenge"** (Reed's
rename, 2026-08-27); `#40HPW` stays the feature's name in this file, in ids and
data attributes, and in the Rules dialog's title. The sub-line under the heading
dropped its "40HPW Challenge!" opener with the rename, the heading now carrying
that word itself.

Boost an episode and the board assumes you heard all of it, then adds up the
durations. **It is an assumption, not a measurement**, and the Rules dialog says
so. Two boards: **This Week** leads (it resets Monday and has a live race in
it), **Proof of #40HPW** follows. **⚠️ "This Week" NAMES THE BOARD'S DEFAULT, NOT
ITS ONLY STATE** — since 2026-08-24 its title is a week picker and it renders any
of the 99 weeks in the index. See **The week picker on This Week** below.

**⚠️ FORTY HOURS IS RARE, AND IT IS NO LONGER ALL BUT UNCLEARED.** Measured
against production on 2026-09-01, **twenty-three booster-weeks have passed it**,
held by **four members**: Piez with twenty, and The Bullish ₿itcoiner, rev.hodl
and Nostr Gang with one each. The best week on record is 58.4h. The measurement
is exact rather than a floor — it was read off the fiftieth row of the old
board, and the twenty-fourth row is 39.8h, so the cut falls inside the window.

**⚠️ AND THAT MEASUREMENT IS WHY THE SECOND BOARD WAS RENAMED.** It was
**High Scores**, the ten biggest booster-weeks ever recorded, which was the
right table while there were **two** of them: on 2026-08-24 the figures were
54.7h and 40.2h, both Piez, with nineteen weeks ever past thirty. The
collector's derived durations are what moved it — **duration coverage adds
hours to PAST weeks with no line of board code touched**, which is the second
thing (after the week rule) that silently moves every figure in this section —
and once twenty of the twenty-three belonged to one member, a top ten by hours
printed one name ten times. It reported a backfill rather than a challenge.
*Reed's call, 2026-09-01.*

**Re-measure these figures after any change to the week rule OR to duration
coverage; they are the whole argument for the name, and they move with both.**
Before the Pacific re-cut, Piez's 41.6h UTC week re-cut to 39.8h at midnight
Pacific, which is the worked example for why the boundary moved. A typical
winning week in mid-2026 is 14 to 20 hours, which is why This Week exists
beside the all-time board rather than instead of it. The name is the
provocation, not a threshold.

**⚠️ GOLD NOW MARKS EVERY ROW OF THE SECOND BOARD, AND THAT IS NOT THE FAILURE
THE OLD NOTE WARNED ABOUT.** Gold has always meant "this week cleared forty",
and on Proof clearing forty is the **entry test**, so the claim is true of every
row by construction: the marker did not stop meaning anything, the board became
the set of rows it marks. On a **weekly** board it is still the rare thing it
was built to be, and **if gold ever marks a third of one of those the fix is
the goal, not the styling.**

`GET /api/v1/members/hours?range=week|all`. Four rules, each from a measurement:

- **Dedupe (booster, episode) inside the week.** Five boosts on one episode is
  one listen; deduping removes 8.9% of qualifying rows and one pair carried
  fifteen. Without it the board measures generosity, which the sats totals
  already measure.
- **Weeks start Monday 00:00 US Pacific.** `345600` is the first Monday after
  the epoch; without the shift `ts / 604800` buckets Thursday to Wednesday,
  which still produces weeks and is wrong by three days on every row.

**⚠️ IT WAS UTC UNTIL 2026-08-23, AND UTC IS THE WRONG MIDNIGHT FOR THIS
BOARD.** *Reed's call.* Monday 00:00 UTC is Sunday 5pm on the US west coast and
Sunday 8pm on the east; he watched This Week reset on a Sunday evening, which is
the middle of the weekend for most of the people racing on it. **Pacific is the
choice because it is the last US zone into Monday**: at Monday 00:00 Pacific
every part of the country is already on Monday, so nobody's board resets while
their Sunday is still running.

**⚠️ THE DST RULE IS IMPLEMENTED TWICE AND THE TWO MUST AGREE.** The weekly
board needs one cutoff computed before the query (`pacificWeekStart`, exported);
the all-time board needs a per-row bucket computed inside it, over ten thousand
booster-weeks (`pacificOffsetSql`). They cannot share code, so
`test-members-hours.mjs` runs the real SQL fragment against its own sqlite and
compares it to the JS at both transitions.

**⚠️ AND IT IS ARITHMETIC RATHER THAN `Intl`, DELIBERATELY.** The obvious
version asks `Intl.DateTimeFormat` for `America/Los_Angeles` — exact, and no
rule of our own to maintain — but it puts a runtime ICU dependency on the
request path, and there is no ICU at all on the SQL side, so the two halves
would derive from different sources and could drift with a tzdata update on one.
The US rule has been fixed since 2007 and the corpus begins in 2024. **The test
is where ICU belongs**: Node has full tzdata, so `test-members-hours.mjs` holds
the hand-rolled rule against the real thing on every week for four years. That
check is what would catch the US changing its dates.

**⚠️ `strftime('%s', …)` RETURNS TEXT, AND SQLITE COMPARES TEXT AS GREATER THAN
ANY INTEGER.** Without the `CAST` in `pacificOffsetSql` every comparison is
false, every row takes the PST branch, and the all-time board is quietly an hour
out for eight months of every year — which looks like nothing at all. Verified
to fail the test when removed.

**⚠️ `week_start` IS A REAL INSTANT AND THE CLIENT STILL FORMATS IT IN UTC**,
which is correct only because Pacific is BEHIND UTC: Monday 00:00 Pacific is
Monday 07:00 or 08:00 UTC, still Monday. `weekLabel` in `members-board.js` says
so. If the reset ever moves east of Greenwich, that formatter moves with it.
- **~12.5% of boosts contribute nothing** — 7.6% name no episode, 4.5% name one
  the index cannot resolve, 0.4% resolve to an episode with no duration. Stated
  in the Rules rather than hidden. It was ~14% with the last slice at ~2.5%
  until 2026-08-24, when the collector started DERIVING durations: the feed's
  own `<itunes:duration>`, else an ENDED `<podcast:liveItem>`'s scheduled
  window, else a 64KB probe of the enclosure itself (MPEG frame headers, or
  the MP4 `moov/mvhd` atom for video/m4a enclosures) —
  `bots/global-boost-scan/duration_probe.py`, whose docstring is the design
  record. `episodes.duration_src` says which rung answered, and a `duration: 0`
  from Podcast Index never erases a derived value (`db.upsert_episode`). 183 of
  194 duration-less boosted episodes filled on flip-on; the residue is live
  streams and `.m3u8` playlists, which stay unscored honestly. **The Rules
  dialog was brought into line on 2026-08-24** and now prints all three slices
  rather than "a few percent", plus one sentence saying lengths are filled in as
  they are found — which is the reader-facing half of the self-healing note
  below. **⚠️ THAT COPY IS A MEASUREMENT AND MOVES ON ITS OWN**, so it is
  re-checked whenever these figures are; a Rules dialog that overstates what
  cannot count is the one part of this board a reader has no way to verify.

**⚠️ THE EPISODE COUNT ON A ROW IS EPISODES THAT CONTRIBUTED HOURS, NOT EPISODES
BOOSTED, AND IT READS LIKE A BUG.** Reed checked the board against a member's own
activity on 2026-08-24: four boosts that week, all four to distinct episodes with
guids, and the row said **3 eps**. Nothing was wrong — one of the four aired five
days earlier and its `duration` is `0`, so `e.duration > 0` dropped it, and the
6.49h printed beside it is exactly the other three. It cannot print 4: the hours
are summed over exactly the episodes counted, so a boost count there would claim
four episodes produced those hours. The figure now carries a `title` saying what
it counts. **Anyone comparing the board to a booster page will ask this again**,
so don't "fix" it by widening the count. (That exact row has since healed — the
probe filled the missing duration the same day and it reads 4 eps / 10.54h —
but the semantics stand: an episode still at zero drops out of both figures
together.)

**⚠️ AND THE WEEKLY BOARD IS HIT HARDER THAN THE CORPUS FIGURE SUGGESTS, BECAUSE
IT IS MADE OF RECENT BOOSTS.** Measured 2026-08-24, before the derivation pass:
over the **200 most recent boosts**, **8.5%** landed on an episode with no
duration against ~2% corpus-wide, and every one of those episodes had aired one
to five days earlier. This Week is therefore the board that undercounts most,
and it **self-heals**: both boards recompute from live data on every request, so
a row gains an episode the moment the collector fills the duration in — a reader
who saw the lower number is just never shown a correction. The derivation pass
runs every incremental tick, so the window between a new duration-less episode
appearing and its duration landing is now minutes to one tick, not the old
enrichment lag.

**Two distinct causes, and neither is permanent any more.** Live episodes — a
`<podcast:liveItem>` has no duration **while pending or live** by construction,
so a boost sent during the stream counts nothing that evening; since 2026-08-24
the collector fills the SCHEDULED window (`end − start`, src `live`) once the
feed marks the item `status="ended"`, so those hours arrive when the stream
ends. Only an endless stream (Icecast, `.m3u8`) stays unscored for good. The
rest were enrichment lag or PI faithfully reporting `0`, which the refresh gate
plus the probe now close. **All of it is collector side**; nothing in `hours.js`
can repair any of it, and a client- or edge-side guess at a duration is the
masking fix CLAUDE.md already forbids for episode fields.
- **Publisher keys are excluded.** See below.

**⚠️ THE NPUB COMES FROM A CORRELATED SUBQUERY, NEVER A SECOND JOIN ON
`boosts`.** That join reads correctly and multiplies every row by the member's
whole boost count, so `COUNT(*)` stops being episodes and `SUM(duration)` stops
being hours — both inflated by the same factor and both still a plausible board.

**Units are `hpw`, not `h`:** every row is one member's one week.

**The all-time board is "Proof of #40HPW"** (*Reed's call, 2026-09-01*), and it
is **one row per member** rather than one per booster-week: a member reaches it
by clearing the goal in any single week and stays on it, ranked by how many such
weeks they hold. The name says what a row is evidence **of** rather than where
it ranks, which is the right claim for a board whose entry test is an
achievement and whose ordering is a count of repeats.

It was **"High Scores", not "Hall of Fame"** (*Reed's call, 2026-08-23*) for the
week it was a table of the biggest weeks: the arcade idiom, where a hall of fame
is a place you are inducted into and a high-score table is one you get onto by
playing. **That argument did not die with the rename** — it moved one board
over, to This Week, which is where the playing happens now.

**⚠️ THE URL DID NOT MOVE WITH THE NAME.** The page is still
`/hpw/high-scores`, its card is still `high-scores.png`, and `mountShare` is
still keyed `high-scores`. That path is in the wild, the collector's card bot
(`bots/hpw-cards/`) screenshots the literal, and
`functions/api/og/hpw/[name].js` allowlists it; renaming buys nothing a reader
can see and costs a redirect, a bot change and an allowlist entry.

**The row's figure is the count of weeks; the rest of the row describes the
member's BEST one** — its date under the name (still the jump button), and
`best 58.4 hpw` where a weekly row prints its episode count. A total across
every qualifying week would be a fifth figure nobody asked for, and an average
would reward a member who stopped after one good week. The episode count moves
into the tooltip rather than off the row.

**⚠️ THE ENTRY TEST IS `>= 40`, WHICH IS THE COMPARISON THE GOLD ROW HAS ALWAYS
MADE, AND THE TWO ARE ONE RULE.** A gold row on This Week means that member is
on Proof, which is the whole invitation. It is tested on raw seconds, never on
the rounded figure a row prints, so a week that displays as "40.0" and is 39.96
does not qualify; `test-members-hours.mjs` pins both sides of that second.

**⚠️ THE RULES DIALOG LINKS OUT TO THE BOOST BOTS SECTION, AND CLOSES ITSELF
FIRST.** A bare `<a href="#boost-bots">` scrolls the document *behind the
scrim*, so the reader arrives at the right section with the rules still over it.
`data-hpw-goto` is the hook; `wireRules` hides the dialog, then scrolls and
moves focus. The id is set by `members-board.js` (`BOTS_ID`), the section being
client-rendered, so nothing in `index.html` can carry it.

**The Rules are a dialog, in the document rather than fetched**, so they open
while the boards are loading or after they failed. It replaced a sub-line and a
caveat that said the same thing at two sizes.

#### The week picker on This Week

*Reed's ask, 2026-08-24.* This Week showed the live week and nothing else, so a
reader who missed a week could not see it, and the all-time board's rows named weeks
there was no way to open. `GET /api/v1/members/hours?range=week&week=YYYY-MM-DD`
answers any of them.

**⚠️ ARROWS ARE THE PRIMARY CONTROL AND THE MENU IS THE JUMP, AND A CALENDAR WAS
REJECTED.** A month grid's unit is a **day** where this board's unit is a week,
so every pick snaps somewhere the reader did not tap; it navigates by month when
the overwhelmingly common request is "last week"; and on a phone it is a second
overlay on a tab that already has the Rules dialog, at seven columns of 44px
against 335px of content. `‹ This Week ▾ ›` is one press for the common case,
identical under a mouse and a thumb.

**⚠️ THE TITLE IS THE PICKER.** A scoreboard is navigated by its own header, and
this tab already carries a lookup, a range, a sort and a dialog; a fourth control
strip above the boards would be permanent chrome for something most readers press
twice. The arrows flank the word they change.

**⚠️ AND THE THREE PIECES ARE ONE BORDERED GROUP, WHICH THE FIRST VERSION WAS
NOT.** *Reed's call, 2026-08-24, on seeing it shipped:* the arrows were
transparent circles until hover and the label wore the title's own type, so
nothing on screen had an edge and **a touch device never sees the hover state
that would reveal one** — the control was invisible at rest. A segmented stepper
is the shape a calendar app and a dashboard both use to walk a date range, so
the two ends explain themselves, and the hairline dividers are what say the
middle is a third control rather than a label between two buttons. Four options
were rendered against it and rejected: solid arrows alone (fixes stepping, leaves
the menu undiscovered), the site's own Sort pill (a real consistency argument,
but it leaves the arrows the only unstyled things in a styled row and costs the
board its Playfair heading), a labelled band under the heading (~2.4rem on every
board, doubled on desktop where two boards sit side by side), and an
accent-tinted version of the stepper (the loudest thing in the board, competing
with the gold row that marks a 40-hour week).

**⚠️ THE LABEL IS `This Week` / `Last Week` / `Week of Aug 10, 2026`, AND A
`Week:` TAG IN FRONT OF IT WAS BUILT AND REVERTED THE SAME DAY.** *Reed,
2026-08-24: "I don't like the font and alignment clashes between `Week:` and
the week printed."* The reasoning behind the tag was sound and is worth keeping
— a word says "pickable" better than any border does — but **the type is what
sank it, and that is the part to understand before anyone proposes it again.**

`.pcast-sort-tag` gets away with `Sort: Most boosts` because both halves are
**one family at one size**, differing only in colour and weight. This label is
1.02rem Playfair bold, so a tag beside it necessarily varies **family and size
and weight at once**, and three axes of difference across two words reads as a
collision rather than as an axis and its value. `align-self: baseline` (needed
because the button is `align-items: center` for the drawn caret) was not enough
to settle it. **A future tag has to solve the type first, not the wording.**

The tag also forced the value to give up "Week of", since `Week: Week of Aug 10,
2026` is unsayable, so the revert restores the prefix with it. **The relative
form for the first two is the calendar-app idiom and is the point**: a reader
one press back is looking at "Last Week", not at a date they would have to
decode.

**⚠️ THE CARET IS DRAWN, NOT TYPED, AND THAT IS WHY IT COULD BE MADE BIGGER AT
ALL.** It was `▾` (U+25BE) inside a Playfair element, and **Playfair carries no
such glyph** — so it was already falling through to whatever face each platform
substituted, at whatever size that face draws it. Its apparent size was not ours
to set anywhere, which is exactly why it read as small. It is two borders and a
rotation now, the same call `.drawer-hint`'s chevron and the `(i)` badge both
make. **The span in `members-board.js` is deliberately empty**; putting a
character back in it stacks a glyph on the drawn one. `.hpw-pick` is
`align-items: center` for the same reason — a drawn box has no baseline and
rides low under `baseline`.

**⚠️ 0.4rem AT 1.5px, AND THE SIZE WAS ARRIVED AT BY MEASUREMENT.** It shipped
at 0.5rem/2px and Reed called it the same day: *"it went from whispering to you
to shouting at you."* The arithmetic agrees. The old `▾` draws about 7px of
visible triangle; a 0.5rem box rotated 45° is 8 × √2 ≈ **11.3px** across, so the
mark had roughly doubled. 0.4rem is ≈ **9px**, the midpoint of the two. **That
midpoint is the whole argument for drawing it rather than typing it** — a
substituted glyph has no midpoint to ask for. The stroke came down with it: 2px
on a 6.4px box is a quarter of the shape and reads as a heavy outline, where a
flat 1px goes to sub-pixel mush on a non-retina screen.

**⚠️ THE PROOF OF #40HPW ROWS ARE THE REAL WAY IN.** Each row's best week is a button
(`data-hpw-goweek`) that opens that week on the board above. A menu of 99 dated
rows can only be scrolled; the board beside it already names the weeks worth
seeing, so the menu is the escape hatch for a week nobody has heard of rather
than the way in. **The jump scrolls the weekly board into view** (`block:
'nearest'`, a no-op on desktop), because on a phone the two boards are stacked
and pressing a date in the lower one would otherwise change a board off screen.

**⚠️ THE WEEK RULE IS A TWO-SIDED MODULE NOW: `assets/js/pacific-week.js`.** It
was private to `hours.js` until the picker needed to step and enumerate weeks in
the browser; the alternative was a second copy of the DST rule in the client.
The endpoint imports it by relative path and re-exports `pacificWeekStart`, so
`test-members-hours.mjs` is unchanged in how it reaches the rule. **The SQL twin
`pacificOffsetSql` is still separate and still what the test holds it against** —
there is no ICU on the SQL side, so that half cannot be shared.

**⚠️ STEPPING IS `pacificWeekStart` OF A DAY WELL INSIDE THE TARGET WEEK, NEVER
`± 604800`.** A Pacific week containing a DST transition is 167 or 169 hours of
real time, so a flat week drifts an hour every March and November while still
producing Mondays. The probes are asymmetric because the anchor is the *start*
of a week: `prevWeek` goes back 3 days, `nextWeek` forward 10.

**⚠️ A `YYYY-MM-DD` IS RESOLVED AT NOON UTC, AND MIDNIGHT IS THE TRAP.**
`Date.UTC(y,m,d)` is 4pm or 5pm **Pacific on the day before**, so a Monday handed
in naively resolves to the *previous* week, every time, with the board looking
entirely correct. Dates are the wire form because they are readable and
shareable; noon is what makes them safe. `test-members-hours.mjs` walks every
week from 2024 to 2029 asserting the round trip, and goes red on midnight.

**⚠️ THE WEEKLY QUERY GAINED A CEILING IT HAD NEVER HAD.** The live week needs
only a floor, nothing having a timestamp in the future. A missing upper bound on
a past week is the failure that looks like nothing: every week would return the
whole board since that Monday, ranked plausibly, under the requested Monday's
heading. Confirmed red on that mutation.

**⚠️ A BAD OR FUTURE `week=` RESOLVES TO THE LIVE WEEK RATHER THAN 400ing, AND
THE ENVELOPE IS WHAT KEEPS THAT HONEST.** These weeks travel in links, so the
caller is often a reader rather than code. The response carries `week_start`,
`week_end`, `is_current`, `current_week` and `first_week`, and **the client
renders the week the server resolved, never the one it asked for.** There is
deliberately **no floor**: a week before the index returns an empty board, which
is the true answer, and `first_week` is what lets the picker stop offering them.

**`first_week` is one seek to the end of `idx_boosts_created` and is allowed to
fail quietly.** It bounds a control where the board is what the reader came for,
so a null answer costs the picker its menu and its disabled arrow, nothing else;
the arrows still step.

**⚠️ A PAST WEEK DOES NOT SHARE THE LIVE ONE'S 60s CACHE.** The live board moves
as boosts land; a closed week moves only when the collector fills in a missing
duration, so it takes the all-time board's 300s.

Three smaller rules: **both arrows render when disabled**, because a control that
vanishes at the end of a range moves the two beside it and the header reflows
under the reader's thumb; **the title repaints before the fetch and does not keep
the old rows**, since a failed fetch would otherwise leave last week's board
under this week's heading; and **the menu's items must undo the title's font** —
`.pcast-sort-item` is declared `font: inherit` and it is inheriting from an `<h3>`
in Playfair bold, the same shorthand trap `.show-stat dd` documents, arriving
through the ancestor rather than through a later rule.

**⚠️ NOT IN THE HASH, AND THAT IS A DECISION RATHER THAN A GAP.** *Reed's call,
2026-08-24: "let's skip the shareable URL, they can take a screenshot if they
want to share it."* The case for `#members?week=2026-08-10` was the
language-in-the-hash argument — a week is a body of work somebody would hand to
somebody else — and what it ran into is that **a board is a picture rather than
a document**: the thing a reader wants to send is ten names and their hours, not
a URL that re-renders with different numbers once a duration lands. A screenshot
carries the moment, which is what a leaderboard actually trades in.

So this is **closed rather than deferred**, and reopening it wants a better idea
than a hash: an OG image for the week, or a card the board itself can produce.
Do not re-propose the plain URL parameter.

#### The member wall

`GET /api/v1/members` with no `q` is the top-members listing, capped at 100 with
search as the route to everyone else. **It is the same `renderSupporters` the
detail pages use** — that function and every `.sup-*` rule moved into
`assets/js/supporter-wall.js` and `assets/css/supporter-wall.css`, which
`functions/_shared/detail-page.js` re-exports and all four pages link.

**⚠️ THE HEADING IS A PARAMETER AND THE TWO CALLERS PASS DIFFERENT WORDS.**
"Members" on the homepage, "Nostr Community" on the detail pages. Not an
inconsistency to tidy up: the protocol is not the greeting, and someone who has
drilled into one show's page has chosen to go deeper than someone who just
landed.

**⚠️ THE WALL CARRIES A RANGE AND A SORT, AND THEY ARE THE FEEDS' OWN
CONTROLS.** *Reed's call, 2026-08-23.* `rangeControl` + `sortControl` from
`feed-controls.js` in a `.pcast-controls` row, not a shape of their own: this is
the same kind of choice a feed's Sort pill makes, and a second shape for one
idea makes the site look like two sites. Order matches the feeds — filters, then
ordering.

**⚠️ `range` MEANS WHEN THE BOOST WAS SENT**, the reading `/api/v1/podcasts` and
every `#boosts` section give it — since 2026-08-31 the one reading of the word site-wide. A member is in the 1W wall because they boosted this week.

All four ranges, where the Boosts note feed offers three: that feed **walks**
month archives to cover a window, so a year is ~70 sequential requests before
the first card. This is one indexed query whatever the window.

**⚠️ THE WINDOW IS ON THE JOIN, NOT ONLY ON THE CANDIDATE SCAN.** Narrowing
candidates alone picks the right people and then sums their **whole history**,
so the 1W wall would rank this week's boosters by their all-time sats — a
plausible-looking board answering neither question. It also drops a member with
no in-window boost for free: the join yields no rows, so the `GROUP BY` yields
none either.

**⚠️ THE RANGE SCOPES A LISTING AND NEVER A SEARCH**, the same asymmetry the
publisher exclusion has and for the same reason. A ranked listing is a claim
about a window; a search answers "where is this person", and a member who last
boosted in March is still the person being looked for. Windowing it would report
a real member as not existing.

**⚠️ THE CONTROLS ARE BUILT ONCE AND MOVED, NEVER REBUILT.** The wall's markup
is replaced wholesale on every change, so a control rendered inside it would be
destroyed by the repaint it just triggered, losing its open menu, its listeners
and the reader's focus. `appendChild` moves a live node into each fresh
`.show-section-head`. `wallSeq` guards the reply, since 1W then 1M puts two
requests in flight and the slower must not paint over the newer.

**The sub-line names the window** rather than a fixed "all time": a caption
contradicting the control above it is worse than no caption.

**⚠️ THREE ORDERINGS, BECAUSE THEY ARE THREE DIFFERENT PEOPLE.** `sort=sats`
ranks by generosity and rewards one large boost; `boosts` rewards turning up;
`shows` (`COUNT(DISTINCT podcast_guid)`) rewards spreading it around. Live, the
leaders are AdminPacman (2.1M sats on 24 boosts), Piez (940 boosts) and Quantum
Panhandler (129 shows). **The figure under each face is the one the list was
ordered by** — a `metric` parameter on `supporterCard`, defaulting to `sats` so
the detail pages are byte-identical.

**⚠️ THE LISTING EXCLUDES PUBLISHER KEYS AND THE SEARCH DOES NOT.** `PUBLISHERS`
in `functions/api/v1/_common.js` is the four keys that sign boosts for many
donors.

**⚠️ `chadf_boostbot` IS NOT ONE OF THEM, SINCE 2026-08-30, AND IT WAS THE
MOTIVATING CASE.** *Reed's call.* It was excluded on the claim that it carried
"1,012 boosts from roughly 34 donors"; that number was read off a different
account's display name ("ChadF and 33 others", `f7922a0a…4788`, Chad's own key),
and the bot's notes carry no sender at all. The bot watches Chad's node and
publishes a note for every boost he **sends** from it, naming the app as
`📱 via <App>`. One person's boosts, so the key is a member: it ranks on the
boards and on the wall (where it takes the Boosts and Shows orderings), and it
left the Boost Bots section and `/about#bots`. Two consequences to know. He is
**two members**, this key for the Castamatic/PodcastGuru/StableKraft listening
and his own key for what BoostMeBitch and OnlyBoosts publish under it, and
nothing merges them. And the duplicate filter matters more, not less: the bot
also republishes what he sends through apps that publish their own notes, and
`RELAY_PUBLISHERS` in `dedupe.py` keeps it for exactly that. Six surviving
pairs were found in D1 on 2026-08-30 and handed to the collector side, which
confirmed seven and is closing them. `test-members-hours.mjs` and
`test-members-search.mjs` both pin that the key ranks.

**⚠️ BOOSTMEBITCH IS IN BOTH LISTS AND THAT IS NOT A CONTRADICTION.** The app
publishes under the donor's **own** key when they are signed in — 13 distinct
pubkeys behind the `boostmebitch` slug — and its site account
(`3820f4ff…f408`, 35 boosts / 114,753 sats / 13 shows) publishes for everyone
else, exactly the arrangement this site has. So `boostmebitch` is an application
a listener can become a member through **and** that pubkey is a publisher key
that must not rank. Added 2026-08-23 on Reed's instruction. Do not "resolve" the
apparent duplication by removing either one.

**⚠️ THE COLLECTOR'S HALF IS SEPARATE AND WAS NOT TOUCHED HERE.**
`PUBLISHER_PUBKEYS` in `bots/global-boost-scan/clients.py` lives on the other
machine and governs `client_via` nesting on `/api/v1/clients`, not the wall.
**The two lists differ by one entry by design**: `chadf_boostbot` is a
publisher for attribution (the note is bot-published) and a member for
ranking (the boosts are one person's). A ranked list is a claim about who the
top members are; a search result is not, and it is a real account somebody may
want to look up. **One list in one place** on the site side, because the boards
had the exclusion from day one and the wall never did, which is how the gap
opened.

#### The member lookup

**⚠️ IT LEADS THE TAB AND IT NAVIGATES; IT DOES NOT FILTER THE BOOST LIST.**
*Reed's call, 2026-08-23.* The question is "where is this person" and the answer
is `/booster/<npub>` — their whole history, their shows, their totals — not a
narrowed slice of one feed. It sat inside the Boosts panel while it was a
filter, which is also how a reader had to reach the feed to find the control
that finds people.

It is the shared `mountFeedSearch`, so the debounce, the abort, the sequence
guard and the keyboard handling are the four ranked feeds' own. The suggestion
rows stay `role="option"` **buttons rather than anchors**, because that is what
a combobox listbox is; the navigation lives in `onPick`.

**Two retired attempts are buried in `boosts-feed.js` so neither comes back**:
`boosterEntries()` indexed the boosts in memory (34 of 2,011 members on the
first page, 684 after paging in all 23,259), and `pickedRows` fixed that by
fetching the picked member's own corpus — at which point the feed was rendering
a different subject than its own controls described. `getMemberBoosts` in
`ob-live.js` now has no caller.

**⚠️ `resetFeedSearch(panel)` IS STILL CALLED THOUGH NOTHING MOUNTS THERE.** A
reader holding a cached module from before the move may have mounted a box into
that host; clearing it is one call, and the alternative is a live search box
over a feed that no longer reads it.

#### The member search endpoint

**⚠️ IT ASKS THE INDEX, AND THE THING IT REPLACED COULD NOT.**
`boosts-feed.js#boosterEntries` indexed `scopedRows` — the boosts in memory — so
a member was findable only if they turned up in what the reader had scrolled
past. Measured: the first page reaches 34 of 2,011 members (2%), 500 boosts
reaches 164 (8%), and paging in all 23,259 still only reaches 684 (34%). A third
of members have never appeared in the note feed, so loading more could never
close it.

**⚠️ AND THE PICK FETCHES RATHER THAN FILTERING**, which is the same bug one
level down: a member chosen out of the whole index will usually have no boosts
in the loaded window, so filtering emptied the list at the moment the search
succeeded. `/api/v1/boosts?booster=` is a parameter that endpoint has always
taken.

Three more rules in `functions/api/v1/members.js`:

- **A member is someone who has boosted, never someone with a profile.** 61 of
  the 2,011 have no kind-0 on any relay the collector tried; deriving the set
  from `profiles` reports their live pages as not existing.
- **⚠️ CANDIDATES FIRST, AGGREGATE SECOND.** The obvious single-`WHERE` shape
  defeats index seeking — the plan comes back `SCAN b USING INDEX
  idx_boosts_booster`, reading all 23,259 boosts per keystroke, measured 20ms
  against 3-6ms for the CTE.
- **⚠️ LIKE's WILDCARDS ARE ESCAPED**, the LIKE counterpart of `ftsMatch`: a
  bare `%` typed into the box otherwise returns everyone, ordered by sats.
  SQLite's LIKE folds ASCII only, so a query differing from a name by the case
  of a non-ASCII letter will not match; nothing cheap fixes that.

#### The Boost Bots section, and what the tab discloses

`/api/v1/members?publishers=1` is the **exact complement of the listing**: the
wall drops the four `PUBLISHERS` keys, and this asks for those four and nothing
else. Same endpoint, same row shape, one place the aggregate is computed; a
second path would be two answers to "who is a member" that could disagree. It
wins over an empty `q`, so it is never also the listing, and a `q` alongside it
does not union in the search — `test-members-search.mjs` pins both.

**⚠️ THE PUBLISHER LIST IS BOUND ONCE AND ITS PLACEHOLDERS ARE NUMBERED.** The
statement references it twice (`NOT IN` for the listing, `IN` for the bots), and
SQLite numbers a bare `?` from the highest index used *so far*, which would make
the second run's numbering depend on where the first happens to sit in the SQL.
`PUB_FIRST` / `PUB_HOLES` / `PUB_FLAG` in `members.js` are the whole of it.

**The heading is "Shoutout to the Boost Bots"** (*Reed's call, 2026-08-23*),
not a bare "Boost Bots". These four accounts are the only reason a listener with
no Nostr account is represented here at all, and the section's job is to credit
them; the flatter label read as a category of thing being disclosed rather than
as thanks. **The Rules dialog's link still says "Boost Bots"** — it is a
reference inside a sentence ("They are named under Boost Bots below"), and the
longer name does not fit that grammar. The section id stays `boost-bots`, and
`/about#bots` is untouched.

**⚠️ THE SECTION IS THE EXCLUSION, SHOWN — it is not a disclosure notice.**
*Reed's call, 2026-08-23: "either way we need to be transparent about anything
we are NOT including on this page."* These four accounts are the only reason a
listener who wants no Nostr account is represented here at all, so the section
carries their totals and links to their pages the way any member's row does.

Four rules a change would break:

- **Rows, not faces.** The wall is a grid of avatars because it is a community;
  these are four accounts each needing a sentence saying what it does. Rendering
  them as more faces puts them back in the list they were taken out of.
- **⚠️ A KEY WITH NO `BOT_ROLES` ENTRY STILL RENDERS.** The server owns the list
  and `members-board.js` owns the prose, so a fifth publisher appears with its
  figures and no description. A row missing a sentence beats a bot the section
  quietly fails to disclose.
- **Exact boost counts, compact sats.** `num(m.boosts)` and `compact(m.sats)`.
  On the wall a row is one of a hundred and `1k` is plenty; here the count *is*
  the claim, and `1k` for 1,021 rounds the evidence away.
- **⚠️ TWO SENTENCES, AND THE LINK CARRIES THE REST.** *Reed's call,
  2026-08-23.* The first version ran four and turned a short section into a
  paragraph with a list under it. What has to be said here is what these
  accounts are and that they are deliberately not ranked; why the rule exists,
  and what it costs, is `/about#bots`.
- **⚠️ A FAILED FETCH LEAVES NOTHING BEHIND.** An error line here would read as
  "something is being hidden from you", which is the opposite of the point. The
  claim is additive, so its absence costs a reader nothing they were promised.
  It is started after the wall and never awaited.

**How the four were determined: by hand, and nothing detects them.**
`PUBLISHERS` in `functions/api/v1/_common.js` is the collector's
`PUBLISHER_PUBKEYS` less `chadf_boostbot`. Naming an account a bot is a claim,
and the cost of getting it wrong is a real person left off a leaderboard; that
is exactly what happened to `chadf_boostbot` for a week.

#### The Members intro, and the (i)

The intro is **one sentence** and the mechanics live behind a badge: *"Become a
member by boosting one podcast or musician and sharing the boost with your Nostr
identity."* Reed's wording, 2026-08-23.

**⚠️ THE (i) IS A REAL LINK TO `/about#membership`, NOT A TOOLTIP, AND IT
OPENS IN A NEW TAB** (Reed's call, 2026-08-23) — a reader consulting a
definition has not finished with the tab they are standing on. What it has
to answer is "which app do I use", and the answer is three named applications
with a caveat on each; that is a section, not a hover. It is also the one thing
on this tab a crawler should follow. The badge is a CSS circle rather than the
`ⓘ` character, whose glyph is missing or differently sized in several of the
fallback faces — the same call `.drawer-hint`'s chevron makes.

**⚠️ `/about#membership` AND `/about#bots` ARE IN THE WILD, so treat them as
frozen** the way the detail pages' section ids are. Two surfaces point at them:
this badge and the Boost Bots section's "How this works".

**`/#members` IS THE TAB'S ADDRESS** since the feed was renamed on 2026-08-23.
It was `/#boosts-global`, and for one day this note said there was no `#members`
hash and that adding one would be a second address space. That was true of an
*alias*; it is not true of a rename, which is what shipped. See **The Three
Tabs** for the mechanism.

**⚠️ `#membership` LEADS WITH NOSTR AND EXPLAINS IT, which is the one place on
this site that should.** *Reed's call, 2026-08-23:* the front door says
"Members" and never says Nostr; a reader who has clicked through to the about
page has dug deeper, and here the answer to "how is a boost public at all" **is**
the protocol. So the section states the definition — *a member is anyone who has
shared a boost publicly using their Nostr account* — and then explains that an
ordinary boost is a private transaction, that a boost note is an announcement of
one rather than the payment itself, and that the membership belongs to a keypair
the reader holds rather than to a profile here. See
[[nostr-vocabulary-by-depth]]; this is the depth.

**It also says boosting without any of this is not worse**, only unrecorded.
The sats and the message arrive identically; what is missing is the public
record, which is the whole of what membership means here.

**⚠️ TWO LISTS OF APPS EXIST ON `/about` AND THEY ANSWER DIFFERENT QUESTIONS.**
`#pipeline`'s *Applications Publishing Boost Notes* is the technical inventory
and holds **four**, Local Bitcoiners among them. `#membership` holds **three** —
Fountain, BoostMeBitch and OnlyBoosts — being the apps that publish a note signed
by a key the *listener* controls. LB is deliberately off that list: it is one
show's own website widget, not a route a listener can take to boosting podcasts
generally. **Reed's call.** Each section cross-references the other so the two
counts cannot read as a contradiction.

### The Share Cards

Shipped 2026-08-29, after several members asked for a way to share the boards
on Nostr. Reed wanted two things at once: a share that works as a Nostr note,
and an image a reader can capture and carry anywhere else; and he wanted it to
"look like a screenshot, not a replication of the screen with glitches in it".

**Three designs were weighed.** A browser-drawn `<canvas>` (cheap, but faces
hit CORS taint and a Nostr post then needs a Blossom upload, which a signed-out
reader cannot sign). Rasterizing at the edge with satori and resvg-wasm (a
permanent PNG URL, but it measured at ~1.1MB gzip against a 109KB Functions
bundle, satori draws blanks for the emoji that Nostr display names carry, and
it would have used the Workers Paid plan to be *allowed* to carry all that).
And the one taken: **a real Chromium screenshot on the collector machine**,
which already runs a pipeline that computes things off-request and publishes
them as static files. The card changes when a boost lands, not when someone
looks at it, so it belongs on the batch path.

**The contract between the two machines**, which must not drift:

| | |
|---|---|
| The bot screenshots | `https://onlyboosts.social/hpw/<YYYY-MM-DD>/card` and `/hpw/high-scores/card` |
| Ready signal | `html[data-card-ready="1"]`, set once fonts and faces settle (and after 8s regardless) |
| Capture | 720x900 viewport (portrait, 4:5; it shipped landscape and Reed asked for phone-shaped on the first download) at device scale 2; under 900KB or re-captured at 1x |
| Where it lands | inside the shards tree, so the routine `push` ships it and a `--delete` mirror keeps it: `onlyboosts/hpw/<key>.png` plus `hpw/index.json` |
| Change detection | the bot hashes the `members` array of the hours endpoint and re-renders only on a change; Chromium PNGs are not byte-stable, and an unchanged file is what lets rsync skip it |
| The site's URL | `/api/og/hpw/<key>.png`, proxied with the PNG signature checked |

**What the site carries** is small: the page Function, the proxy, the share
control, and the move of the board's rows into a two-sided module so the page
and the tab paint the same row. The page wears the plain content-page chrome
(`page.css`) with the board in its 640px column, which is the width a board
has on the tab. The card is the same board in a fixed frame with a larger
base size, no nav, no theme boot script, and no hover chrome; it is
`noindex`, the page being the thing to index.

**The share modal (2026-08-30).** The first version was a dropdown of three
actions (Post to Nostr, Copy link, Share image), and the note it composed
linked the proxy's URL for the image. Reed's objection was exact: that URL is
re-rendered every cycle the board moves, so "I'm in first so far" posted with
it stopped being backed by its own picture an hour later; and a share that is
not better than a phone screenshot is not worth a pipeline. The answer is a
freeze. The share button now opens one modal; it fetches the card the reader
is looking at and uploads that file to Blossom under the reader's own key
(`LBLogin.uploadToBlossom`, the helper the bug-report modal already used),
and the note carries the content-addressed URL. Blossom addresses a file by
its SHA-256, so that URL can never show anything but the file it was posted
with. The proxy's URL keeps moving, which is right for the page's `og:image`.

The note is exactly `<message>`, `<blossom url>`, `<link>`, each on its own
paragraph. The message is what the reader typed (the suggestion is a
placeholder, never content); the image and the link are shown as what will be
added and added at publish. The link is `/#members` for the live week and the
week's own page for a past week or Proof of #40HPW, so a reader does not land on
a different board than the picture.

Three rules the modal follows. It opens for everyone: signed out, Publish is
a Log in button and Download image works, so a reader with no Nostr account
can take the picture to a text message. Publish is blocked until the upload
succeeds, with Retry; a note without the picture is not what the control is
for. And a banner answer from the proxy (`X-OB-Image: fallback`, a week not
rendered yet) is refused rather than uploaded as "the board". Copy link and
the old download-only path are gone; Download lives inside the modal.

What the freeze does not change: the card is the collector's last render, so
it is up to one cycle (five minutes) behind the board on screen, which is the
site's cadence everywhere. The card's footer is one line,
`onlyboosts.social/#members`, left-aligned; everything else came out.
