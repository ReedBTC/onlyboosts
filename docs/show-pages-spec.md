# OnlyBoosts Show Pages (design of record)

A per-show landing page at `/show/<podcast-guid>`, built entirely from indexed
data plus Podcast Index. No hand-written content on any of them, ever; if a
field can't be filled automatically it isn't on the page.

**There is no Cloudflare work in this document.** D1 is provisioned, populated
and serving in production (`/api/v1/stats` reports 22,129 boosts across 1,285
shows), and the Podcast Index credentials are configured in both the production
and preview environments. Every task below is code in this repository. See
Appendix B for the one item that belongs to the collector instead.

---

## Scope

Locked for the first pass:

| Decision | Choice |
|---|---|
| Granularity | Shows only. Episodes are listed inside the page, not addressable. |
| URL | The bare `podcast:guid`. No slugs. |
| Community ranking | All time only. No range control. |
| Community crossover | Own drawer above the wall, all-time, sort only. |
| Community layout | Top five highlighted (three on mobile), rest by sats; 21 shown, no numerals. |
| Show-level boost | Yes, alongside the per-episode buttons. |

Episode pages and per-npub pages are both expected later. The shapes below are
chosen so that adding them is additive; see Forward Compatibility.

---

## The URL

```
/show/<podcast-guid>
```

`podcast:guid` is the show's own RSS-declared identifier. It is what every boost
carries via NIP-73, it is the per-show shard's filename, and it is the primary
key of the D1 `podcasts` table. It survives a rename, a change of host and a
change of feed URL, none of which a title-derived slug would. Any client holding
a boost record can therefore build the URL with no lookup, which is the
predictability requirement.

**Slugs are deferred, not rejected.** The page emits `<link rel="canonical">`
pointing at itself from day one, so introducing `/show/<slug>` later means
adding a route, repointing the canonical, and 301ing the guid form. Nothing
about this design has to be unwound to get there.

The router must treat the guid as an **opaque key**: percent-decode it, cap its
length, and look it up. Six guids in the live index contain characters that need
encoding (`NA-1863 Live`, `substack:post:150038410`, two bare feed URLs); none
of them are shows that qualify for a page, but the decode still has to be
correct rather than incidentally working.

---

## Which Shows Get a Page

**927 of the 1,285 shows in the index** (as of the collector's 2026-07-26
canonicalization pass; it was 922 of 1,384 before). The qualifying test is
`title IS NOT NULL`.

The remaining 358 have no title, no artwork, no feed URL and no Podcast Index
record. There is nothing to render for them, so they get **no page at all** and
no link from anywhere. They keep appearing in the Shows feed as unlinked
"Unidentified show" cards. They are a small share of boosts and sats, so nothing
meaningful is hidden.

**Do not hardcode either number.** The collector is actively repairing malformed
show identifiers, so both move: it has already merged 33 numeric feed-ids and
collapsed 74 `<uuid>-<epnum>` rows, and the freeform slugs (209 guids, the
largest remaining group) resolve by hand through
`bots/global-boost-scan/data/guid_aliases.json` as mappings are established.
Every entry added there turns unidentified rows into a real show, which may or
may not already have a page. The site needs no change when that happens; the
qualifying rule does the work.

A request for a non-qualifying guid returns **404** with a short page pointing
back at `/#shows`. It must not return a shell of empty fields, and it must not
500.

---

## Rendering

**A Pages Function that returns real HTML**, at `functions/show/[guid].js`. This
departs from the rest of the site, which is static HTML plus a client fetch, and
the reason is the Open Graph card. A show supporters page is a thing a podcaster
shares; if the crawler receives an empty shell then the share renders blank,
which defeats the page's main distribution channel. Search indexing of ~927 pages
is a second and lesser reason.

BMB reached the same conclusion from the same constraint. Its show view is
query-param routed (`/?podcast=<guid>`) rather than a path route, but the
metadata is generated server-side: fetching
`/?podcast=56fbb1aa-da79-5e4b-bebc-3b934ab8914c` returns `<title>Local
Bitcoiners</title>` with a matching `og:title`, `og:description` and
`og:image` already in the served HTML, and the body renders on the client
afterwards. An unresolvable guid falls back to the site's generic metadata,
which is the same 404-shaped answer this spec gives.

The Function emits, server-side:

- `<title>`, `<meta name="description">`, canonical link
- `og:title` / `og:description` / `og:image` (the show's artwork) and
  `twitter:card`
- `PodcastSeries` JSON-LD
- the show header, the supporters grid and the episode list, already in markup
- the shared CSP meta tag, nav and footer, identical to every other page

The client then hydrates only the interactive parts: boost buttons, the episode
drawer, and copy-npub on the supporter avatars. First paint requires no
JavaScript.

Cache the response at the edge (`Cache-Control: public, max-age=300`). The
underlying data moves on the collector's five-minute cycle, so anything tighter
buys nothing.

---

## Data Path

`/api/v1/podcasts/:guid` already returns the show, its episodes and its recent
boosts from D1. Two changes make it fit.

### Drop Shownotes From the Episode List

Measured on Citadel Dispatch, the current response is **67KB, of which 54% is
episode `description` text** that the page does not display until a drawer is
opened. Remove `description` from the list query. The endpoint drops to roughly
30KB for a large show.

Shownotes then load on demand. Add `?shownotes=1` to fetch them for a single
episode, or accept no blurb in the drawer; the per-show static shard already
carries them if a heavier path is ever wanted.

### Add the Supporters Aggregate

Ranked by sats sent to this show, all time:

```sql
SELECT b.booster_pubkey, b.booster_npub,
       SUM(b.sats)  AS sats,
       COUNT(*)     AS boosts,
       MAX(b.created_at) AS latest,
       pr.name, pr.display_name, pr.picture
FROM boosts b
LEFT JOIN profiles pr ON pr.pubkey = b.booster_pubkey
WHERE b.podcast_guid = ?
GROUP BY b.booster_pubkey
ORDER BY sats DESC, boosts DESC, b.booster_pubkey
LIMIT 500;
```

`idx_boosts_podcast(podcast_guid, created_at DESC)` already covers the `WHERE`,
so **no schema change and no new index are required.** The busiest show in the
index has 210 boosters, so the 500 cap is a guard rather than a limit and no
pagination is needed.

The `profiles` join supplies the name and avatar, so there is no relay
round-trip and nothing repaints; first paint is final, consistent with the rest
of the site.

**Tie-breaking must be total.** Two supporters on equal sats and equal boost
counts would otherwise order arbitrarily between requests, and the page is
edge-cached, so the ordering has to be stable. Breaking finally on
`booster_pubkey` guarantees it.

Nullability follows the existing contract: only `pk` is guaranteed. `npub` is
derived from the hex where the record has none (`copy-npub.js` already does
this for the boost cards), `name` falls back to a shortened npub, and a missing
`picture` renders a blank circle rather than a broken image.

---

## Other Shows This Community Boosts

A drawer directly above the Nostr Community wall, listing every **other** show
this show's boosters have boosted, ranked. The community is the set of pubkeys
that have boosted this show; the rollup is a self-join over `boosts` through
that set.

**It answers a question the Shows feed structurally cannot.** The homepage feed
ranks shows by size. This ranks them by overlap with one audience, and the
headline figure on each row is that overlap: "27 community boosters." Measured
across nine shows sampled from rank #1 to #400, this list's top ten shares
between **0 and 6** entries with the global top ten, so it is a different list
rather than the site-wide ranking repeated.

Every figure is community-scoped by construction: the join means only boosts
sent *by a member* are counted, so a row's boosts and sats are what these people
sent that show, never its global totals. The sort menu says so — "Most boosts
here", "Most sats here" — and there are only three sorts, all of them measures
of this audience.

**Not split on medium**, which every other rollup on the site is. A music
community also boosting podcasts is the interesting half of the finding, so the
heading reads "Other Shows/Albums This Community Boosts" on both mediums and
there is no `COPY` entry for it.

**Untitled shows are excluded**, unlike the Shows feed which keeps them as
"Unidentified show" cards. A show with no title has no page to link to and no
Podcast Index record, so its row would be an unlinkable card with a boost button
that could only fail.

**It ships open.** The episode drawer above it is closed because a catalogue is
something you consult; this is a recommendation, and a closed recommendation is
one nobody sees.

### All Time Only

A 1W/1M/All range shipped in the first pass and was removed. A time window is an
**episode-level** question — what is this show doing lately — where which shows
an audience overlaps with is a standing fact about the audience. The data agreed:
across the live index the median community had boosted **one** other show in the
last 7 days and **47% of shows had boosted none**, so two of the three ranges
were empty on half the site.

Dropping it removed the empty states, the per-range count badge, and the
duplicated server/client label formatter along with them: with no range, a row's
text is fixed at render time and the client only moves nodes.

Rank is **recomputed per sort**, not retained. That differs from the feeds'
search, where filtering to one row has to preserve its standing in the full list;
here the list is never filtered, so position under the current sort is the rank.

### Why It Needs No Requests

One D1 query returns each row's boosts, sats and members, and the row carries
them in a single `data-cs` attribute. Sorting is a re-order and a renumber, so
the section is instant and renders ranked and correct with JavaScript off.

The cap is **150 rows**. Fan-out over the live corpus runs to a median of 45, a
p90 of 191 and a maximum of 608, so the cap only bites on the head of the
distribution. The largest page's section measures ~154KB raw, ~21KB gzipped.

The row buttons carry no icon, so there is no glyph to inline 150 times. An
icon-only circle shipped briefly and needed a `<symbol>` + `<use>` to avoid 49KB
of repeated path data; the word "Boost" costs five characters a row.

### The Per-Row Boost Button

**MONEY PATH.** Each row carries a compact icon button that boosts *that* show —
the only place on the site that pays a show other than the one the surface is
about. See the show-level boosting section of CLAUDE.md for the full contract.
Two things specific to here:

- The button is a **sibling** of the row's link, not a child. A button inside an
  anchor is invalid, and nesting one would make the row swallow its clicks.
- It is the **same control** the homepage's Episodes, Songs, Shows and Albums
  cards carry at the right end of their own stats line: a tight blue
  `.ob-boost-pill`, built by `assets/js/boost-button.js` and styled once in
  `theme.css`. The server builds this markup by hand, so the class name and the
  busy/disabled states are the contract between the two.

## The Nostr Community Section

**This section was called Supporters and the heading is now "Nostr Community".**
The reasoning is set out under *Vocabulary and the scope note* in `CLAUDE.md`
and is worth restating once here, because it is the point of the section:
"supporters" is a claim about who supports the show, and this page cannot make
it. A show with two hundred keysend supporters and three Nostr boosters would
have read as having three supporters. "Community" names the group the page can
actually see, and "Nostr" says which group that is. The count noun stays
**booster** everywhere else, since a person is a booster and only the set of
them is a community.

The section's anchor moved from `#supporters` to `#community`; nothing linked to
it. Every internal identifier below (`renderSupporters`, `supporterCard`,
`SUPPORTERS_VISIBLE`, `data-supporter-grid`, the `.sup-*` classes) deliberately
kept its name, so the prose that follows still uses the old word for them.


Ported from `git show lb/main:supporters.html` in look, not in structure.

**What carries over:** the circular-avatar grid, the count badge on the heading,
the name beneath each avatar, click-to-copy npub with the shared `.pcast-toast`,
the blank circle for a supporter with a name but no picture, and the skeleton
loaders. Also, as of the rebuild, LB's **absence of card chrome** — no border,
no background, no rounded panel. A first pass boxed each supporter and it
competed with the avatars, which are the pattern. Sats sit centered under the
name.

**No rank numerals.** The wall is ordered by sats, so position says standing; a
number on every face turned a community into a scoreboard. Size and a brand ring
mark the podium instead.

**The podium wraps rather than counting** — five across on desktop, three on a
phone with the last two centered beneath. `PODIUM` is decided server-side and
CSS cannot move a card into the grid below, so `.sup-podium` is a centered
flex-wrap and `.sup-card--podium` is an exact fraction of the row
(`calc((100% - 4 * 1.3rem) / 5)`, and `/ 3` under 640px). A pixel width would
leave the break to viewport arithmetic: a 430px phone fits four 84px cards where
a 375px one fits three.

**What does not:** LB's tier system. It bucketed supporters by absolute lifetime
sats (100k / 69k / 21k / rest), which works across one show's entire audience
and collapses per show. The median show in this index has **one** booster and
only 209 of 1,384 have five or more; even Citadel Dispatch, with 153 boosters,
has most of them far under 21k *to that show*. Absolute thresholds would file
almost everyone under the bottom tier and the section would read as broken.

Relative standing replaces it:

- **The top three** get a podium: larger avatar, rank ring, sat total and boost
  count spelled out.
- **Everyone else** follows in one flat grid, ranked, with the sat total under
  the name.

LB's follow-pack buttons don't carry over either. Those linked kind-39089 packs
published by the LB account; a per-show equivalent would mean a bot publishing
922 of them, which is a separate project and a good one.

`assets/js/supporter-set.js` is **not** the thing to reuse. Despite the name it
resolves LB's own follow packs from relays and is unrelated to this feature; it
is dead code in this repository and should be deleted rather than adapted.

---

## No Episode Counts, Anywhere

The show page shows three stat tiles, not four, and the Shows feed cards show
three figures, not four. There is no "Most episodes" sort. This is deliberate
and should not be undone without reading what follows.

**Sats, boosts and boosters are measures of boost activity.** They have no
meaning outside boosting, so "as published to Nostr" is the only reading
available, and the scope note under the stats covers them.

**An episode count is a property of the podcast.** It has a true value out in
the world whether or not anyone ever boosted. Printed beside a show's name and
artwork it reads as a claim about the show, and ours was not that claim: it
counted episodes carrying at least one boost we indexed, which excludes keysend
boosts entirely and any boost published before NIP-73 tagging was in use.

Measured against the shows' own RSS feeds:

| Show | We showed | Feed actually has |
|---|---|---|
| LINUX Unplugged | 64 | 676 |
| Rabbit Hole Recap | 70 | 415 |
| Podcasting 2.0 | 47 | 199 |
| Citadel Dispatch | 62 | 251 |
| This Week in Bitcoin | 65 | 116 |
| Local Bitcoiners | 22 | **21** |

Note the last row. Episodes are keyed off `item_guid` from boosts, and a feed
can drop or re-guid an old item, so our count can **exceed** the real
catalogue. It was not reliably a subset, which means no short label could have
rescued it. "Episodes boosted" would still have overclaimed.

**The alternative was rejected on product grounds.** Pulling each show's full
catalogue would make the number true, and would also turn OnlyBoosts into a
podcast directory. That is BMB's job and BMB already does it. This site is for
seeing what people on Nostr are boosting and finding others with the same
taste; an episode nobody boosted is, here, not information. It would also cost
a per-show RSS or Podcast Index fetch across every qualifying show, and put
LINUX Unplugged's 612 unboosted episodes into a drawer where each one reads
"none".

The underlying figure is still loaded and still returned by
`/api/v1/podcasts/:guid`, because the Shows feed uses it to decide whether a
card gets an episode drawer at all. It is simply never rendered as a number.
`functions/show/[guid].js` does not even select the column, so that a future
edit has to go and fetch it deliberately rather than finding it to hand.

**Do not add `distinct_eps` to the About page stat strip.** CLAUDE.md formerly
named it the obvious candidate for a sixth card. It is the same number with the
same problem, one level up.

## Recent Boosts

The page carries a Recent Boosts section: booster, sats, message, and what it
was aimed at. **It is not filtered to feed-level boosts**, and that decision is
worth recording because the obvious instinct is the opposite.

Feed-level boosts (a `podcast_guid` with no `item_guid`, someone boosting the
show rather than an episode) do exist; they are 7.1% of the corpus. But measured
per show over six months of archives, 8,002 boosts across 484 qualifying shows:

| | Shows |
|---|---|
| At least one feed-level boost | 85 of 484 (**18%**) |
| Three or more | 22 of 484 (**5%**) |

The distribution is not merely thin, it is uneven in a way that penalises the
wrong shows. Homegrown Hits (51 of 134), Bowl After Bowl (42 of 141) and Local
Bitcoiners (26 of 268) would have a full section, while UNGOVERNABLE, Citadel
Dispatch, What Bitcoin Did, Nodesignal and Einundzwanzig would each show an
empty one **despite carrying 130 to 262 boosts apiece** in the same window.
Whether a show accumulates feed-level boosts is an artifact of how its listeners'
apps construct a boost, not a fact about the show.

So the section lists **every boost to the show**, newest first, and labels each
row with the episode it targeted or "the show" when it targeted none. That is
also the plain reading of "boosts to this show", and it stays correct when
episode pages arrive: the episode page will show its own slice, and the show page
remains the superset.

One happy detail: **every feed-level boost in the sample carried a message**, so
the rows that do surface are worth reading. Globally only 16% of boosts have
message text, so rows without one render as a sats line alone rather than a gap.

## The Podroll

`<podcast:podroll>` is the publisher's own list of other shows worth hearing,
parsed from the show's raw RSS by the collector's weekly pass. It renders as
**two sections** between the Nostr Community wall and Recent Boosts: "Podroll -
Recommended by Show Authors" and "Reverse Podroll - <Show Name> is Recommended
By:". The second names the show because "Recommended By" alone reads as though it
modifies the section above rather than opening a new claim; the title is
truncated hard at 52 characters, since this index carries titles past 90 and the
heading is Playfair at a size that already wraps on a phone.

Neither is split on medium. "Show Authors" reads flat on an album page on
purpose, the same call the community drawer makes: a music feed recommending
podcasts is the interesting half of the finding.

`Podroll` is the term of art, used rather than explained. That is deliberately
unlike NIP-73, which is never the qualifier anywhere on this site: NIP-73 is the
mechanism behind a number, so naming it explains nothing to a reader wondering
why their community is missing. A podroll is the subject of the section, the
tiles beneath it define the word, and a publisher who knows it is looking for it.

Coverage, measured over the live corpus: 65 of 925 reachable feeds publish a
podroll, 371 edges, 221 distinct targets. Forward-only would be a section on 65
pages. The reverse edge is the same rows read the other way and brings it to
**109**, because plenty of shows are recommended by someone without publishing a
podroll themselves; Local Bitcoiners is one, recommended by Bowl After Bowl.

**They are two sections rather than one grid.** "I recommend them" and "they
recommend me" are opposite claims, and a tile carrying nothing but artwork and a
title has no way to distinguish them. Two headings do it for free.

### Why the Form Is Different

This is the only section on the page that is not derived from boost data, and it
should not look like one that is. Every other list here is a row: a 44px
thumbnail, a title, a line of figures, a border underneath. A recommendation has
no figure attached to it. A row would therefore leave two thirds of its width
empty and read as a ranked list that had lost its ranking, and inventing a figure
to fill the gap would misrepresent what a podroll is.

So: **square artwork at tile size, the show's name beneath it, and nothing
else.** Five across on desktop, two on a phone. Bowl After Bowl's own roll-call
page is the reference, and the artwork earns the space because it is the only
content.

The column counts are fixed rather than `auto-fill`, which is the opposite of the
choice the community wall makes above. The difference is that a circular avatar
has a natural size and the count can follow it, where a tile is as wide as a
fifth of the column: here the count is the design and the width follows from it.

Ten tiles paint before a "Show N more" toggle. The median podroll is 4, so this
bites on one page in the corpus (63 entries) and on two of the reverse lists.

### Where a Tile Points

The collector stamps each edge with **`linked`**: true when that end has a
`/show/<guid>` page of ours, which is boosts *and* a title, the same qualifying
rule this page applies to itself. It is read, never re-derived — the collector
owns the rule and already accounts for the titleless case.

**44% of cards are not linked.** A podroll routinely recommends shows nobody in
this corpus has boosted, and those cards are still worth rendering because they
carry real artwork and a real title. They point at the show on
`boostmebitch.com/?podcast=<guid>`, in a new tab. All 371 live edges carry a guid
at both ends, so a tile is always linkable and the query selects no feed-URL
column at all.

A card with **no title** is dropped rather than labelled. All four such edges have
no artwork either, so the tile would be empty. This is deliberately not the
"Unidentified show" treatment the Shows feed gives an unnamed row: that label
works in a list of names and figures, and reads as a rendering bug in a grid whose
entire content is names.

### No Figures, and No Boost Button

The tile carries no boost count, no sats, no sort control and no boost button.
Every other list of other shows on this site carries one, and this one does not
because barely half of podroll targets have a Podcast Index record to resolve
splits from, and because the section's whole job is to send a reader onward rather
than to take a payment in place.

**Neither heading carries a count, and neither may gain one.** Both figures are
bounded by which feeds the collector has read, so a badge would state a fact about
our coverage as though it were a fact about the show. Each sub-line says what
bounds it, which is what a badge cannot do. This now matches the rest of the page:
neither drawer summary carries a count either, for reasons set out under *Drawer
Affordance* and *No Episode Counts, Anywhere*.

The **Nostr Community wall's count came off with them**, and the reason is the
same one that named the section: the badge read as the size of the show's
community, where it counts the people who published a boost to Nostr. The
sub-line under the heading already names the set precisely, all time and ranked
by sats, so the badge added a number and subtracted a qualifier. `.show-count`
therefore has no emitter left anywhere on the page; the rule stays in
`show-page.css` because the shape is right for a figure that is complete and
unqualified, and this page has none.

### The One Query Allowed to Fail

`podroll` is the only table on this page populated by a separate **weekly** push
(`d1_sync.py --remote-podroll`), where every other table rides the collector's
hourly boost delta. A remote that carries every other table but not yet this one
is a normal intermediate state of a deploy, so both podroll queries catch their
own failure and render no section. Turning 930 show pages into 500s to report a
section that 93% of them do not render would be the wrong trade, and "no section"
is exactly what a show with no podroll gets.

## Page Order

The back link, the hero, the "Nostr Boost Stats" heading and its tiles,
**episodes**, other shows this community boosts, the Nostr Community wall, the
two podroll sections, recent boosts.

Episodes sit directly under the stats rather than at the foot of the page: a
podcaster arriving at their own page is looking for their catalogue, and a
visitor sent here by that podcaster wants somewhere to boost before they want a
leaderboard. The drawer is **collapsed by default**, so it costs one line of
height and the supporters wall still opens the page's body.

The podroll sits **below the wall and above recent boosts**. It is the page's
second discovery list, and putting it under the community rather than beside it
keeps the two apart: the community drawer is what *this audience* also boosts,
which is ours to compute, where the podroll is what *the publisher* recommends,
which is theirs to declare. Recent boosts stays last, as the page's log.

## Section Deep Links

Every section is addressable, because the person most likely to share this page
is the podcaster it is about and the part they want to send someone to is often
one section rather than the whole thing. `/show/<guid>#podroll` is the shape.

| Hash | Section |
|---|---|
| `#episodes` | the episode drawer |
| `#community-shows` | Other Shows/Albums This Community Boosts |
| `#community` | the Nostr Community wall |
| `#podroll` | Podroll - Recommended by Show Authors |
| `#reverse-podroll` | Reverse Podroll - \<Show Name\> is Recommended By: |
| `#boosts` | Recent Boosts |

**The six are frozen.** This is the same commitment `ALIASES` makes for the
homepage feed hashes, and it was written here as the stricter one: a feed hash
goes through a JS controller that can alias an old form to a new key and rewrite
the bar, where these resolve in the browser's own anchor handling and have
nowhere to put a redirect.

That last clause has since been qualified rather than repealed. `HASH_ALIASES` in
`show-page.js` does for a retired id exactly what `ALIASES` does for a feed hash:
rewrites it with `replaceState` and scrolls. It carried `#inverse-podroll` to
`#reverse-podroll`, and it holds one entry, permanently. But it needs the module
to have run, so a rename is still a dead link for a reader with JavaScript off
and for anything resolving the URL without a browser. **It is the repair for a
rename that has already happened, not a licence for the next one.** The earlier
note that moving `#supporters` to `#community` was "safe because nothing linked
to it" was true when written and is not a precedent either.

Three supports, none of them obvious from the markup:

**`scroll-margin-top: 5rem` on `.show-section`.** The nav is `position: sticky`
at 64px tall, so a bare anchor scrolls the section's heading to y=0 and leaves it
behind the bar. The reader lands on a page whose first visible line is the second
line of the thing they followed a link to, which reads as a broken link rather
than a near miss. `page.css` hit this on `/about` first and the value matches.

**`revealHashTarget()` in `show-page.js`.** The episode drawer ships collapsed,
so `#episodes` would otherwise land on a closed lid — the one section whose
anchor answers with nothing. Any `<details>` inside the targeted section is
opened. It deliberately does **not** scroll afterwards: the drawer expands
downward from a summary already at the top of its section, so the section's
offset does not move and the browser's own scroll is still correct. A second
scroll would only add a smooth-scroll animation on load, which reads as a glitch.

**`initHashSpy()` in `show-page.js`.** The address bar's hash tracks the section
being read: an `rAF`-throttled scroll handler finds the last section whose top
has crossed the line and `replaceState`s its id, clearing back to the bare URL
above the first one. Copying the URL at any point therefore yields a link back to
that spot.

This is what makes the ids reachable by someone who was never told them. The
alternative shapes were considered and this is the one with nothing on the page
to discover: a permalink glyph beside each heading is the documentation-site
convention, but it reaches only four of the six sections (`#episodes` and
`#community-shows` are `show-section--bare`, with a `<summary>` where the `<h2>`
would be), and it asks the reader to notice a control first. A clickable heading
was rejected for the reason that recommends it in the abstract — nothing about a
plain heading says it does anything, so nobody finds it, and the readers who
click by accident get an unexplained scroll.

Four properties are load-bearing:

- **`replaceState`, never `pushState`.** Scrolling is not navigation, and a Back
  button that replayed a scroll one section at a time would be worse than the
  feature. It also fires no `hashchange`, which is what keeps the spy from
  tripping `revealHashTarget()` and opening the episode drawer as a side effect
  of scrolling past it.
- **The line is read from `scroll-margin-top`,** through `getComputedStyle`, not
  hardcoded. The section the spy names has to be the one an anchor would have
  parked at, or following your own copied link lands you a section off.
- **Only on a change.** Safari throttles `replaceState` to about 100 calls per 30
  seconds and throws past it; a call per scroll frame would spend that in a
  second.
- **The last screenful belongs to the last section,** checked explicitly. A short
  Recent Boosts can sit entirely on screen at the foot of the document without
  its top ever reaching the line, and would otherwise be the one section the spy
  can never name.

It measures live rather than caching offsets at init, because a drawer opening, a
"Show N more" and a re-sort of the community rows all move everything below them.
There is no run at init: a page opened on `#boosts` is still being scrolled there
when the module executes, and measuring mid-flight would replace the hash the
reader arrived on.

Honest about two things. On iOS Safari and Chrome for Android the URL bar
collapses while scrolling, so most phone readers never watch it happen; the
payoff there is that Share and Copy Link carry the section. And the hash reports
where the reader stopped rather than what they chose, which is the cost of asking
for no affordance at all.

With JavaScript off every anchor still resolves and still scrolls. The drawer
stays shut, one click from open, which is exactly what a visitor who scrolled
there under their own steam would find, and the address bar simply does not
follow. Nothing about the deep link itself is load-bearing on the client.

## Reversing Out

These pages are a **graph, not a tree**. A row in the community drawer links to
another show page, whose own rows link on again, so a reader who follows an
interesting overlap from the homepage through four shows has a genuine chain
behind them and every intent to walk back down it. Two facts make that chain a
dead end without a control on the page: `manifest.webmanifest` declares
`display: standalone`, so an installed OnlyBoosts has no browser chrome and no
back button of its own, and the pages carry no other upward link than the nav's
Explore menu, which restarts rather than reverses.

`.show-back` sits above the hero, and it is **two different controls in one
element**:

| Arrival | Renders | Does |
|---|---|---|
| Followed a link from within the site | "← Back" | `history.back()` |
| Shared link, search result, direct URL | "← All Shows" / "← All Albums" | Navigates to `/#shows` or `/#albums` |

The distinction is `document.referrer`, read in `show-page.js#initBackLink`, and
it matters in both directions. A visitor who opened a shared link has nothing
behind them, and `history.back()` would take them off the site entirely or do
nothing at all; a visitor four shows deep does not want the feed, they want the
show they just left. Same-origin navigations pass a full referrer under the
default policy, and no page here sets a document-level one.

**The server renders the feed link and the client upgrades it**, rather than the
reverse. That order is what makes the control work with JavaScript off, keeps its
label honest for a crawler, and leaves the `href` intact so a modified click
still opens the feed in a new tab. A self-referrer (a reload keeps one) is
excluded: "back" to the page you are on is worse than the feed.

The destination of the no-chain case comes off the `COPY` table, so an album
page offers Albums rather than Shows.

## Drawer Affordance

Both `<details>` on the page share `.ep-drawer`, and a collapsed one has to
announce that it opens. The first version did not: the summary was a line of
small blue text on the same white as the body, with a `▸` text bullet, and no
hover state at all beyond `cursor: pointer`, which arrives too late to be a cue.
A visitor read the whole box as a caption on a bordered rectangle.

Three cues carry it, in the order a visitor notices them:

1. **A `--cream-d` header band**, so the box has a lid rather than being a
   rectangle with a caption in it.
2. **A SHOW / HIDE word** at the right end, drawn in CSS off `[open]`. This is
   the cue that actually does the work — a word is unambiguous where an icon is
   a convention the reader has to already hold. Its span is `aria-hidden`,
   because `<details>` announces its own expanded state and a screen reader
   should not hear both.
3. **A chevron that rotates**, built from two borders rather than set as `▸`/`▾`
   so it does not depend on how a font renders those glyphs or where it sits
   them on the baseline.

The label is `--ink`, not brand. A whole heading in link blue promises
navigation somewhere else, which is the wrong promise for a control that expands
in place; the brand sits on the chevron and the hint, which are the parts that
are the control. Playfair at the `.show-stats-title` size, because these two
summaries **stand in for the `<h2>` their sections do not have** — with that,
every band down the page is the same typeface.

**Neither summary carries a count, and the affordance work did not add one.**
The community drawer's was removed deliberately, and the episode drawer's cannot
be honest at all; see No Episode Counts, Anywhere. The cues above are form
rather than information, which is why they were available.

### The Way Out of the Episode Drawer

The episode drawer lists only episodes carrying an **indexed boost**, which is a
small slice of what most shows have published: LINUX Unplugged shows 64 rows
against 676 in its own feed, Rabbit Hole Recap 70 against 415. No Episode Counts,
Anywhere is why the page never states that as a number, but the page also said
nothing at all about where the rest of the catalogue was, which left the drawer
reading as a claim about the show's output rather than about our index of it.

**See All Episodes** ("See All Tracks" on music, off the `COPY` table) sits at
the left end of the control band, opposite the sort, linking to the show on Boost
Me Bitch. It is styled as the same pill as the sort beside it, because they are
two controls on one band and a link styled as a link reads as body text stranded
in a toolbar; the outbound arrow is the only difference, carrying the one thing
the sort does not do.

**BMB is a temporary target and this is its second surface.**
`assets/js/episode-link.js` owns it for boost notes and documents why. This link
is built inline in `renderEpisodes` because a Pages Function cannot import a
client module and nothing else in `functions/` reaches outside it; both files
carry a ⚠️ naming the other. This one is show-level (`?podcast=<guid>` alone — a
`/show` page holds no Podcast Index numeric id to prefer `?feed=` with) and is
not a boost note, so retiring BMB for notes does not have to retire it here.

### The Sort Row

The two bands ship differently, and only in one way: the episode band holds that
link, which needs no JavaScript, so it renders visible and only the sort is
conditional on there being at least two rows to order. The community band holds
nothing but a sort, so it still ships `hidden` and JavaScript reveals it — a sort
control that cannot sort is worse than none.

`.cs-controls` is mounted by **both** drawers and was painted `--cream`, the page
background. Inside a white card that reads as a gap punched through to the page
behind it, so an open drawer looked severed at the sort row rather than open. It
is `--cream-d` now, matching the header band: the open drawer is a header /
toolbar / list stack, one component, and the white sort pill has a surface to sit
on that it is not already the same color as.

The `--accent` / `--accent-d` / `--tint` supply those controls read moved from
`.cs-drawer` to `.show-main` in the same pass. Only the community drawer carried
`.cs-drawer`, so the **episode** drawer's pill had been reading an undefined
`--accent` — an undefined custom property invalidates the declaration using it at
computed-value time, which is why its current sort value rendered in body text
instead of brand and its active menu item had no highlight.

## Episodes and Boosting

The episode list comes from D1's `episodes` table, which already carries
`boost_count` and `total_sats` per episode.

**Ordered by air date, newest first** by default, not by sats. The drawer is a
catalogue, and a catalogue is chronological; opening it ranked by sats would make
it a second leaderboard next to the supporters wall and bury this week's episode.

**It carries a sort control** — Latest Episode / Most Boosters / Most Boosts /
Most Sats — the same chrome and the same shape as the community drawer below:
each row ships its four figures in one `data-ep` attribute and the client only
re-orders. The default reproduces the server's own `ORDER BY`, so the first paint
and the first sort agree, and undated rows sink under it rather than floating.

`booster_count` is **not** a column on `episodes`; the collector stores boosts
and sats per episode but not distinct boosters. "Most Boosters" derives it with a
grouped subquery over this show's boosts — one indexed scan, measured at 2.9ms
over 290 episodes — rather than a correlated lookup per row. Note that
`published` is null on a meaningful slice of rows, and SQLite sorts NULL below
every value, so a plain `DESC` sinks the undated ones with no explicit guard. A
`0` fallback would have floated them to the top, which is the trap the Episodes
feed documents in CLAUDE.md.

Every episode row gets a boost button, and the show gets one of its own in the
header. Both route through `/api/value`, which resolves splits server-side and
accepts `podcastGuid` or `feedUrl`; all 922 qualifying shows have both, so the
lookup succeeds for every page this design builds. The show-level button omits
the `guid` parameter and takes the feed-level value block.

Verified in production against Citadel Dispatch: `/api/value?podcastGuid=…`
returns a live feed-level block (ODELL at 99%, Fountain at 1% with its
`customKey`/`customValue` intact). The credentials are configured; the earlier
note in CLAUDE.md claiming otherwise is stale and should be corrected.

Shows whose feed has no payable value block render the page without boost
buttons rather than with buttons that fail. Concretely: every boost button ships
`hidden`, and `show-page.js` runs **one** feed-level probe on load and reveals
them all only if it returns a block. One probe covers the episode buttons too,
because `/api/value` falls back to the feed block for an episode that has none
of its own, so a show with a feed block has every episode boostable.

The one case this gets wrong: an episode carrying its own value block on a show
whose feed carries none would be boostable but stays hidden. That is rare enough
to be worth the trade, since the alternative is revealing buttons on every show
and letting most of them fail at click time.

## The Data Caveat

The stat tiles carry a heading, **"Nostr Boost Stats"**, with *Nostr Boost*
linked to `/about#keysend`.

It is there because of who these pages are for. A show sharing its own page puts
these figures in front of an audience with no idea what the site indexes, and
the two questions that follow are "why is this number so low" and "where is my
regular booster". Both answers are on the About page: most boosting is keysend
and never touches Nostr, and a boost note is a claim rather than a receipt.

**This began as a paragraph under the tiles** (`.ob-scopenote`, linking
`#keysend` and `#limits`) and became a heading over them. The paragraph said
more than two words can, but it said it *after* the numbers and ran three lines
on a phone, on a page whose whole design is to fit one screen. Above the figures
is also simply the better place for a qualifier on them. `og:description` still
states the scope inside its sentence and is now the only place the full wording
survives, which matters more than the on-page copy: it is the string that
travels into a preview card with no page around it.

---

## Site Wiring

**The Shows feed links its cards.** `shows-feed.js` already holds the guid for
every card; titled shows link to `/show/<guid>`, untitled ones stay unlinked.

**`shows.html` becomes the directory.** CLAUDE.md leaves its fate undecided and
this settles it: a crawlable page linking all 922 landing pages is worth
considerably more than sitemap entries alone, and it gives the file a reason to
exist. Drop its `noindex`. `_redirects` already carries `/podcasts → /shows`, so
that hop keeps working.

**The sitemap goes dynamic.** `functions/sitemap.xml.js` currently hard-codes two
URLs and its own header anticipates this change, naming
`git show lb/main:functions/sitemap.xml.js` as the recoverable dynamic version.
Enumerate the qualifying shows from `/api/v1/podcasts` and add `/shows`. At 922
entries the file stays well inside the 50,000-URL limit, so no sitemap index is
needed yet; episode pages would change that.

**Bump `VERSION` in `sw.js`**, per the standing convention.

---

## Forward Compatibility

Two pages are expected next, and neither should require reshaping this one.

**Episode pages** slot in at `/show/<podcast-guid>/<item-guid>`, which is why
the show route is `/show/<guid>` and not `/<guid>`. The episode drawer's rows
become links; the supporters query gains a `WHERE item_guid = ?` variant with
the same shape and the same renderer. Note that `episode.guid` is sometimes a
URL, so it must be percent-encoded into the path.

**Per-npub pages** slot in at `/booster/<npub>`, and
`functions/api/v1/boosters/[npub].js` already performs the query. Every avatar
in the supporters grid currently has nowhere to link; the grid should be built
so that turning each card into an anchor is a one-line change. This is also what
finally fills `/boosters`, which today is a placeholder promising something.

---

## Appendix A: Build Order

1. ~~Extend `/api/v1/podcasts/:guid`~~ **Done.** `description` dropped from the
   episode list (67KB → ~31KB on Citadel Dispatch), `?supporters=1` aggregate
   added, `?shownotes=<item_guid>` fetches one episode's notes on demand.
2. ~~`functions/show/[guid].js`~~ **Done.** Server-rendered page; 404 for
   non-qualifying guids.
3. ~~`assets/css/show-page.css`~~ **Done.** Supporters grid ported from LB's
   `.sup-*` rules onto the OnlyBoosts tokens.
4. ~~Client hydration~~ **Done.** `assets/js/show-page.js`: boost buttons,
   supporters overflow toggle, share, copy-npub.
5. ~~Link the Shows feed cards~~ **Done.** Titled shows link to
   `/show/<guid>`; unnamed ones stay inert, since the qualifying rule is
   exactly "has a title".
6. ~~Dynamic sitemap; bump `sw.js`~~ **Done.** The sitemap enumerates
   qualifying shows from D1, best-effort so a D1 hiccup costs the show entries
   rather than the whole document. `VERSION` is `ob-v25`.

**Still open:**

7. **`shows.html` as the crawlable directory.** Not built, because its fate is
   an open decision (CLAUDE.md: redirect to `/#shows` and delete, or keep a
   page). It now has a reason to exist, and the sitemap has a matching comment
   marking where its entry goes. Note the mechanical wrinkle: a static
   `shows.html` and a `functions/shows.js` both claim `/shows`, so a
   server-rendered directory means deleting the static file, whereas a
   client-rendered one does not.
8. **Delete `assets/js/supporter-set.js`.** Deferred, and it should not be done
   as part of this feature. Despite the name it resolves LB's own follow packs
   and is unrelated here, but `feeds.js` still imports it from the unreachable
   `loadEvents` path, which is entangled with the `calendar-events.js` circular
   import that CLAUDE.md already flags as fiddly. It belongs to that cleanup.

---

## Appendix B: A Collector-Side Finding

Not part of this work. Written up in full, with evidence and the specific asks,
in **`docs/collector-handoff-show-identity.md`**.

**Largely resolved upstream on 2026-07-26** (`159a51a`), which is why the
numbers above moved. The collector now resolves numeric feed-ids and strips
`<uuid>-<epnum>` suffixes automatically, folding both back into the real show;
`about.html#show-identity` explains the case to readers.

Verified against the live index afterwards, and the merges match what the
handoff predicted to the sat: Bowl After Bowl +99,372, UNGOVERNABLE +15,997,
Homegrown Hits +13,995, Podcasting 2.0 +6,331, Local Bitcoiners +666.

What remains is the 209 freeform slugs, deliberately left alone: a label like
`20250508FH` carries no reliable link back to a show's GUID, and pattern-matching
it would misattribute boosts. Those resolve by hand via `guid_aliases.json`.

---

## Show Credits (Blocked on the Collector)

A credits section naming a show's hosts and contributors is wanted on these
pages and **cannot be built yet, because none of that data is indexed.** The
`podcasts` table carries `title`, `image`, `feed_url`, `medium` and the three
boost aggregates; `enrich.py#_show_from_feed` maps six fields off the Podcast
Index feed object, and no person, author or owner field is among them. The
per-show shards are no richer: their `show` object is exactly
`{guid, title, img, feed, medium}`.

Two sources could supply it, and they are not equivalent.

**`feed.author` and `feed.ownerName`**, already present on the Podcast Index
`podcasts/byguid` response the collector calls today. This is the cheap option:
no new API call, two new columns, and it is available for every show already
enriched. It is also weak data. `author` is the `<itunes:author>` string, which
is frequently a network name, a show name repeated, or blank, and `ownerName`
is an administrative contact rather than a credit. Useful as a fallback line,
not as a credits list.

**`<podcast:person>`**, the Podcasting 2.0 namespace tag built for exactly this.
It carries a name, a role (Host, Guest, Producer, Writer), a group, an optional
`href` and an optional `img`, and it can appear at the channel level or on an
individual item. This is the right source and it is the one to ask for. It
needs verification rather than assumption on two points: whether Podcast Index
returns these tags on the endpoints the collector already uses or requires a
different one, and what the coverage actually is across the ~930 identified
shows. Coverage is the question that decides whether the section ships at all;
a credits block present on 5% of pages is worse than none.

**OUTCOME (this section is now settled; the ask above is history).**

The collector probed all three and the answers inverted the priority:

1. **`podcast:person` was dropped.** ~6% coverage, and confirmed against raw
   feeds rather than the API, so it is not a Podcast Index limitation: the tags
   genuinely aren't in the feeds. Exactly the near-empty block this section
   warned against. Revisit only if we parse channel-level RSS ourselves and a
   wider scan moves the number.
2. **`owner_name` was dropped.** Every show carrying one also carries an
   `author`, on both mediums, so it never fills a blank. It is not a fallback.
3. **`author` shipped** (`47d9469`), backfilled across all 924 identified shows
   into `podcasts/index.json` and the per-show shards.

**The coverage figure that matters is measured off the shipped index, not the
probe.** Counting non-empty values that are not merely the title repeated:
97.4% of music pages (454/466) and 88.0% of podcast pages (405/460). The
probe's ~52% / ~38% judged *quality*, excluding networks and taglines by eye,
where these numbers apply the mechanical rule the site implements. At ~90% this
is a line that is essentially always present rather than an occasional one.

Consequences for this page, all recorded in CLAUDE.md under *Show credits*:
label it `Artist` on music and `By` on podcasts, **never** `Host` or `Creator`;
filter only the title repeat; expect an untagged music feed to read `By`.

**Still blocked: the credit line itself.** This page renders from D1 and
`author` is only in the shards, so the column needs a production migration plus
a full reload before anything can appear here. Search shipped first because it
reads the shards. Do not work around the gap with a render-time fetch.

**Note the value block is a separate thing and is already available.**
`/api/value?podcastGuid=<guid>` returns the show's Lightning recipients with
their `name`, `split` and `fee` fields, resolved live from Podcast Index, and
the show page already calls it to enable the boost button. Those names are who
the sats actually reach, which is a genuinely useful thing to show on a boost
site, but they are payment destinations rather than credits: the list mixes
people with apps and index fees (`Fountain` at 2%, `Podcastindex.org` at 1%,
both flagged `fee: true`). If a "where your sats go" block is wanted it can be
built today with no collector change; it should not be labelled as credits.
