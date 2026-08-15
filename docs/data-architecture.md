# Data Architecture: Current State and Consolidation Plan

> **STATUS: COMPLETE as of 2026-08-14.** All four pieces of "The Work" shipped.
> Every feed and page reads D1 through `/api/v1/*`; the shard-reading half of
> `ob-data.js` was deleted, which closed the dependency piece 3 was waiting on.
> The static shards remain a published dataset, and the only thing on the site
> still reading one is `/about`'s stat strip (`meta.json`). Demoting them to an
> export is now a decision rather than a migration. Kept as the record of why
> the consolidation was done and what was measured; **it is not open work.**

Written 2026-08-02, after a run of data defects that raised the question of
whether the D1 and static-JSON approach is the right foundation. The short
answer is that it is, that it is roughly 70% built, and that the defects come
from running two read paths at once rather than from scale. This document
records the measurements behind that conclusion and the work required to finish.

## Assumptions and Scope

This covers how the website reads data. It does not cover the collector's
ingestion (relay scanning, Podcast Index enrichment, podroll parsing), which is a
separate pipeline with its own contract in `bots/global-boost-scan/DATA-API.md`.
Figures are measured against production on 2026-08-01 and 2026-08-02; every one
of them can be re-derived with the commands in the last section, and they should
be re-measured rather than trusted if this document is read much later.

The conclusions assume growth of roughly 10x. They hold with wide margin at
100x; the section on headroom says where the real ceilings are.

## The Size of the Problem

| | Today | At 10x | For comparison |
|---|---|---|---|
| Episodes | 6,688 | ~67,000 | IMDB carries ~11,000,000 titles |
| Boosts | 22,392 | ~224,000 | |
| Shows | 1,295 | ~13,000 | |
| Boosters | 1,990 | ~20,000 | |
| Published JSON | 25.8MB | ~250MB | D1 allows 10GB per database |

At 10x this index would still be roughly 160 times smaller than IMDB. This is
not a large dataset, and no part of the current trouble is caused by its size.

Response times on the query path, measured from a laptop through the Cloudflare
edge:

| Endpoint | Time to first byte | Payload |
|---|---|---|
| `/api/v1/stats` | 431ms cold | 125B |
| `/api/v1/episodes?sort=sats&limit=60` | 125ms | 46KB |
| the same with `include=boosts` | 180ms | 520KB |
| `/api/v1/podcasts?limit=60` | 108ms | 23KB |
| `/api/v1/search?q=bitcoin` | 191ms | 46KB |

Those are competitive with any large media catalogue site. The database is not
the constraint and will not become one at the growth being planned for.

## The Two Root Causes

Every data defect found in the last several days reduces to one of two causes.
Neither is a scaling problem.

### Two Sources of Truth

The site reads both the static JSON shards published to the VPS and the D1
database, and the two are derived separately from the same box SQLite. Nothing
forces them to agree, so they drift.

Consequences observed:

- **67 episodes exist in one and not the other.** The collector reported
  `eps_enriched: 6755` while D1 held 6,688 rows. Feed cards link an episode when
  the *boost record* carries a title, which comes from the static side, whereas
  `/episode/<guid>` renders from D1. About 1% of the episode links the site
  rendered therefore resolved to nothing, including real episodes with
  double-digit boost counts. The cause is in `d1_sync.py`: its delta path pushes
  an episode only in the tick where a boost for it arrives, and silently skips it
  when enrichment has not yet written the local row, never revisiting it. An
  episode enriched after its final boost never reaches D1 while looking complete
  in every static export.
- **The medium split needed a join in the browser.** Because the boost records
  carry no medium, the Episodes and Songs feeds fetched a 103KB show rollup on
  every visit purely to decide which half of the partition each boost belonged
  to.
- **A repaired link is not a repaired record.** `/episode/<guid>` now redirects
  to the show rather than showing a 404, which is a graceful failure, not a fix.

### Aggregation in the Browser

The Episodes and Songs feeds built their corpus from `latest.json` plus three
month archives and rolled it up client-side, which meant they ranked over
whatever those files happened to hold rather than over the index.

Measured against the full corpus:

- 7 of the true all-time top 10 episodes were missing outright.
- Only 20 of the true top 100 appeared at all.
- The true #7 episode painted at #128, because only its last-three-months sats
  were being counted.
- Songs painted 84 of 601 music episodes, because music is about 5% of a boost
  stream whose window was sized for the other 95%. That feed downloaded 4.04MB
  to use 5% of it.

This pattern was inherited from localbitcoiners, where the entire dataset was one
podcast and comfortably fit in the page. It stopped being appropriate the moment
the collector went network-wide. It was documented as a known cost rather than
fixed, which was the wrong call.

The feed search regression found on 2026-08-02 is the same class again: with
ranking and paging moved server-side, a client-side search index can only see the
pages already fetched, so a typeahead finds only what is already on screen.
**Closed 2026-08-04**; `feed-search.js` grew a `searchRemote` backend and the
Episodes and Songs feeds query `/api/v1/episodes?q=` instead of indexing their
loaded pages.

### On the Origin of the Split

The static and live halves were separated deliberately, and the original
reasoning was sound in the case it was written for: a Global view is identical
bytes for every visitor and caches at the edge, whereas a Follows view is scoped
to one user's contact list and cannot. That argument applies to the Boosts feed.
It was then generalised into a rule, "static for global, live for follows," and
the rule is what produced two stores that must agree with no mechanism forcing
them to. The caching benefit was real; treating it as an architectural principle
was the error.

## What Genuinely Does Not Scale

One thing in the current design has a real ceiling, and it is the half being
moved away from.

Publishing the static shards means `latest.json`, 23 month archives, and one JSON
file per show, currently 1,295 of them. At 10x that becomes roughly 13,000 files
and 250MB republished on a schedule. The rsync grows, and worse, any client that
downloads shards in order to compute something gets 10x slower along with it.

Keeping those files published as a **dataset** for third parties is cheap and
worth doing; they are a genuine public good and the API surface documents them.
Having the website itself *read* them is the part that has to end.

The D1 query path has no comparable ceiling at the sizes under discussion.

## Target Architecture

The pattern every large catalogue site converges on, and the one to finish here:

1. **One authoritative store.** D1, read through `/api/v1/*`.
2. **Aggregates precomputed and maintained on write**, never summed at read time.
3. **A real search index**, queried rather than downloaded.
4. **A browser that renders what it is given and computes nothing.**
5. **Edge caching** on the responses that are identical for every visitor.

Current standing against that target:

| | State |
|---|---|
| One authoritative store | Done. D1 is the only read path the feeds use |
| Precomputed aggregates | Done. `boost_count`, `total_sats`, `booster_count`, `latest_ts` are maintained columns |
| Search index | Done. `podcasts_fts` covers shows (title + author), `episodes_fts` covers episodes (title + show), both queried rather than downloaded |
| Browser computes nothing | Done. Every feed's ranking, range and search are queries |
| Edge caching | In place on the static proxy and the detail pages |

The architecture is right, and as of 2026-08-04 it is built. Four of the five
rows above are done; the fifth was already in place. The pain this document was
written about came from operating both halves at once, which was the worst point
of the migration and was temporary by construction, as expected.

What remains is not architecture but housekeeping: piece 3 below, demoting the
shards from a read path they no longer serve to the published dataset they
already are.

## The Work

Four pieces. None is large, and they can be sequenced independently apart from
the dependency noted in the third.

### 1. Move the Remaining Feeds to D1 — Done, 2026-08-04

Shows, Albums and the two Boosts feeds still read static shards and, in the case
of Shows and Albums on the windowed ranges, still group in the browser. They
should read D1 endpoints in the same shape the Episodes and Songs feeds now do.

The Episodes migration is the template: `/api/v1/episodes?include=boosts` returns
each episode's notes inline in the collector's record shape, so
`ob-data.js#episodeApiToBoosts` rehydrates them and the existing
`normalizeBoosts` to `toEpisodeShape` to `buildEpisodes` to `episodeCardHtml` chain
runs unmodified. Nothing about the card had to change. A `/api/v1/podcasts`
equivalent for the show-level rollup would follow the same shape.

This also removes the last client-side reads of `podcasts/index.json`.

Delivered. Shows and Albums page `/api/v1/podcasts`, which grew range (on boost
time), the medium partition, the two sorts it lacked and `q=` with a rank; their
drawer reads `/api/v1/podcasts/<guid>?boosts=0&since=`, retiring the per-show
shard that ran to 1.95MB on the most-boosted show. The Boosts feeds' Global
scope pages `/api/v1/boosts` by cursor, retiring `latest.json` and the archive
walk. `ob-data.js` is now shape-only: every one of its fetching functions has no
caller.

### 2. Add an Episode Search Index — Done, 2026-08-04

`episodes_fts` in the collector schema, populated on sync, plus a `q=` parameter
on `/api/v1/episodes` honouring the active sort, range and medium.

The client-side alternative was measured and rejected: downloading a full episode
index to search locally costs 5.25MB over 34 requests, and even a slim
`{guid, title, show}` projection is 349KB gzipped and still 34 requests, because
the page limit caps at 200. A `q=` query returns five rows.

One subtlety that must not be lost. Picking a search hit filters the feed to a
single card, and that card keeps **the rank it holds in the current ordering**;
the whole question the search answers is "where does my show stand". The client
can no longer compute that once it stops holding the full ordering, so each hit
needs its position under the active sort returned with it. It is only meaningful
on the quantitative sorts.

The empty state also needs rewriting. It currently reads "No matching episode in
this view", which suggests a filter problem when the truth is a coverage
boundary: a show that nobody has boosted on Nostr is not in the index at all and
never will be until someone boosts it. That is a copy change in `feed-search.js`,
and it is worth making regardless of the rest.

### 3. Demote the Static Shards to a Published Dataset

Once the feeds read D1, the shards stop being a read path and become an export.
At that point the two stores can no longer disagree in the user interface,
because only one of them is rendered. This is the piece that actually stops the
class of defect described above, rather than catching instances of it.

Depends on the first piece.

### 4. Close the Sync Gap — Done, 2026-08-04

`d1_sync.py` should sync episodes on their own change signal rather than only on
boost arrival. The `episodes` table already carries `updated_at`, so the delta can
select rows enriched since the last sync and union that with the rows touched by
new boosts. The 67 already stranded need a one-off reconciliation, or an
equivalent full episode reload, which is idempotent because the projection is
`INSERT OR REPLACE`.

The silent `continue` that caused this should also count and log; the defect was
invisible for as long as it was precisely because nothing reported it.

Delivered in `2f96516` and `fec5a06`, and generalised past the ask: rather than
special-casing episodes, the delta gained a metadata drift pass watermarked on
the box's own `updated_at` columns, covering shows and profiles as well, and it
runs on every cycle including ones where no boost arrived, which was the actual
hole. D1 and the manifest now agree at 6,788 episodes.

## What Is Deliberately Not Being Done

- **No change of database.** D1 answers in ~110ms at this size and has three
  orders of magnitude of headroom.
- **No dedicated search cluster.** Elasticsearch or similar for 6,688 rows, or
  67,000, would be buying operational complexity for a problem we do not have.
  SQLite FTS5 covers this comfortably.
- **No rearchitecture.** The direction is correct; the work is finishing it.

## Open Decisions

1. ~~**Whether to hold `episodes-api` until `q=` lands.**~~ **Resolved: held,
   and both shipped together.** The branch carried the ranking fix and the
   server-side search into `main` as one change, so the regression it would have
   introduced alone never reached a reader.
2. **Ordering of the four pieces.** Recommendation was 4, then 2, then 1, then 3,
   and 4, 2 and 1 are done in that order. **3 is now unblocked**: nothing on the
   site reads a shard, so demoting them is a decision rather than a migration.
3. **Whether the published shards keep their current shape** once they are an
   export rather than a read path. They are a public contract, so the default
   answer is yes. Still open.

## Re-deriving the Measurements

```sh
# Row counts, both sides. These two should agree on episodes; a gap is the
# sync defect described above.
curl -s https://onlyboosts.social/api/v1/stats
curl -s https://onlyboosts.social/api/data/index.json | python3 -m json.tool | head -20

# Query-path timing
curl -s -o /dev/null -w 'ttfb %{time_starttransfer}s  %{size_download}b\n' \
  'https://onlyboosts.social/api/v1/episodes?sort=sats&range=all&limit=60'

# The medium partition. music + not_medium=music should equal the total.
# `count` is the page size, not the total, so this has to page through.
curl -s 'https://onlyboosts.social/api/v1/episodes?range=all&limit=200&medium=music'

# Size of the published corpus
curl -s https://onlyboosts.social/api/data/index.json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["totals"])'
```
