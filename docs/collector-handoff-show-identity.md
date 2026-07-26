# Handoff: Show Identity and GUID Fragmentation

**To:** whoever owns `bots/global-boost-scan`
**From:** the website side
**Date:** 2026-07-26
**Status:** items 1 and 2 shipped in `159a51a` on 2026-07-26. Item 3 confirmed;
the freeform group remains, by design. Kept as the record of the analysis.
**Related:** `docs/show-pages-spec.md`, `bots/global-boost-scan/DATA-API.md`

The site is building a per-show landing page at `/show/<podcast-guid>` for every
show the index can identify. This document is what that work needs from the
collector. Nothing here blocks the site build; the pages ship for the 922 shows
that already qualify, and each item below raises that number.

---

## The Qualifying Rule

A show gets a landing page when `title IS NOT NULL`. In the live index that test
is exactly equivalent to two others: every titled show also carries a feed URL,
and every titled show also carries a well-formed UUID guid. 922 of 1,384 pass.

So **anything that gives a currently-untitled show a title gives it a page**,
automatically, with no site-side change. That is the entire ask.

---

## The Finding

The 462 untitled shows are not 462 unknown podcasts. Most are a small number of
real shows fragmented into phantom rows, because a value that is not a
`podcast:guid` landed in the `podcast_guid` field. Breakdown of the 319
non-UUID guids:

| Pattern | Guids | What it actually is |
|---|---|---|
| Numeric (`946122`, `5904093`) | 34 | Podcast Index **feed IDs** |
| UUID plus a suffix (`b2f4a5a4-…-45`) | 74 | **Item** guids from one single show |
| Freeform (`homegrownhits-111`, `20251023FH`) | 209 | **Item** guids, collapsing to ~65 families |
| Bare feed URLs | 2 | Feed URLs |

Plus 143 rows that carry a clean UUID and are simply not in Podcast Index.

### Evidence

The numeric guids resolve as PI feed IDs. Verified against
`/podcasts/byfeedid`: **31 of 34 return a live feed**, and 32 return a title.
Sample, with the boost totals currently filed under the phantom row:

| GUID | Resolves to | Phantom row holds |
|---|---|---|
| `946122` | Bowl After Bowl | 90 boosts, 99,372 sats |
| `7755557` | SXWorldwide | 17 boosts, 78,297 sats |
| `5904093` | The Two Hour Folk Hour | 18 boosts, 25,913 sats |
| `352598` | UNGOVERNABLE | 13 boosts, 15,997 sats |
| `6611624` | Homegrown Hits | 17 boosts, 13,995 sats |
| `7683299` | **Local Bitcoiners** | 2 boosts, 666 sats |

**21 of the 24 that resolve to a name are already in the index under a proper
UUID.** They are not missing shows; they are double counts. UNGOVERNABLE already
sits at 828 boosts and 2,504,755 sats under `290e12c3-…`, and Local Bitcoiners
at 268 boosts and 2,948,483 sats under `56fbb1aa-…`. Only three (Hog Story,
v4vmusic, Ring That Bell) are genuinely absent.

This means the current index **understates the totals of at least 21 real shows**
and inflates the show count. Both are visible on the site: the Shows feed ranks
by sats, so an affected show ranks lower than it should, and `/api/v1/stats`
reports 1,384 shows when the true figure is lower.

---

## What We Need

### 1. Treat a Numeric `podcast_guid` as a Podcast Index Feed ID

Highest value, smallest change. When `podcast_guid` matches `^\d{4,9}$`, resolve
it through `/podcasts/byfeedid?id=<n>` rather than `/podcasts/byguid`, take the
`podcastGuid` from the response, and **re-key the boosts onto it**, merging into
the existing row where one exists.

Three of the 34 return no feed. Leave those as they are.

### 2. Collapse Item GUIDs Landing in the Podcast Field

The 74 `b2f4a5a4-…-<n>` rows are one show split 74 ways; the base UUID is
`b2f4a5a4-96a6-4414-bd78-2d76b367352c`. The 209 freeform rows collapse to about
65 families, four of which (`…FH`, `homegrownhits`, `Episode`, `MMO`) account
for 148 rows on their own.

Worth understanding **why** this happens before patching it. These look like
boosts whose NIP-73 tag carried the item guid where the podcast guid was
expected, so the fix may belong at parse time rather than in a cleanup pass; a
cleanup that guesses at families by string prefix will misfire on the 61
singletons. If the source events distinguish the two tags, prefer trusting them
over pattern matching.

Note that collapsing alone does not produce a title. `b2f4a5a4-…` is not in
Podcast Index, so those 74 rows become one untitled show rather than one titled
one. The value is a correct show count and correct totals, not a new page.

### 3. Nothing for the 143

Confirmed dead: 0 of the top 20 by boost count resolve via `/podcasts/byguid`,
and the two bare feed URLs fail `/podcasts/byfeedurl`. Podcast Index does not
have these feeds. Enrichment is not broken.

**Please keep publishing them.** They are real boosts to real shows and the
Shows feed labels them "Unidentified show" with the guid. They just will not get
landing pages.

---

## What Not To Do

- **Do not drop unidentified rows** from `podcasts/index.json`. The site relies
  on them being present and labelled; filtering them would silently lose 5.8% of
  boosts and 3.8% of sats.
- **Do not change the `file` pointer convention.** The site reads each rollup's
  own `file` field verbatim and never builds shard paths by hand.
- **Do not add a slug field yet.** The site deliberately uses bare guids in URLs
  for now. If slugs are wanted later they should be generated collector-side and
  published, but that decision has not been made.

---

## Optional: A `description` Column

Only if it is cheap. The show pages need a `<meta name="description">` and an
Open Graph description, and the site currently plans to synthesize one from
boost totals ("N supporters have sent M sats across K boosts"), which needs
nothing from the collector and describes what our page is actually about.

If the show's own blurb were available in the `podcasts` rollup and the D1
`podcasts` table (it exists today only inside the per-show shard, which is too
heavy to fetch per page), the page could lead with the real description and
append the stats. That is a genuine improvement but not a blocker, and it is the
lowest-priority item here.

---

## How the Site Reads This Data

For context on what the pages touch, so changes upstream are not surprising:

- Show metadata, episode lists and the supporters aggregate all come from **D1**
  via `/api/v1/podcasts/:guid`, populated by the existing `d1_sync` step. The
  supporters ranking is a `GROUP BY booster_pubkey` over `boosts` filtered by
  `podcast_guid`, so **boost-to-show attribution is the single most important
  field for this feature.** A boost filed under a phantom guid does not just
  mis-rank a show; it drops that supporter off the show's supporters wall
  entirely.
- The static shards are untouched by this work.
- No schema change is required on the site's side. Items 1 and 2 above change
  data, not shape.
