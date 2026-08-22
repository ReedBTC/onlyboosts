# PC 2.0 Stats — status and the candidate menu

*Where the "stats for nerds" project stood when parked on 2026-08-21. This
file is the pick-up point.*

## Status

- **Built and running:** `onlyboosts_pc20stats.py` snapshots four Podcast
  Index public files daily (timer 11:10 UTC, ~6MB gzipped/day) and rebuilds
  `data/pc20.db` (`value_feeds`, `value_legs`, `daily_counts`,
  `episode_value_summary`). First snapshot 2026-08-21.
- **Why daily snapshots are sacred:** PI serves only the CURRENT state of a
  value block — no changelog, and the Wayback Machine holds one truncated
  capture. History accumulates forward only; a lost day is lost forever.
- **Decided:** stats publish as a static `pc20/stats.json` on the VPS behind
  a new `PATH_RULES` entry, fetched by /about like the existing stat strip.
  NOT D1 (that enters only if a per-show features section ships on /show).
  Backend (this box) computes every number; the frontend agent gets the JSON
  contract + a sample, never the raw files.
- **Parked at:** Reed has the menu below and hasn't picked yet. Next step:
  pick stats → freeze the `stats.json` shape → add the export+push step to
  the daily run → PATH_RULES entry → hand the contract to the website agent.
  Suggested first picks: #1, #2, #4, #6, #8.

## Findings that reframe the data (day-one corpus, 2026-08-21)

- **The 33,219 "value-enabled feeds" total is mostly platform
  auto-generation.** By feed host: 3speak.tv ~12.9k (video feeds paying via
  the v4v.app Hive bridge — "Brian of London" node / sats.v4v.app), Wavlake
  7,596, media.rss.com 4,418 (host-inserted). Roughly ~8k residual feeds
  where someone configured their own block. Any published stat should show
  this decomposition or it flatters the raw total.
- **Wavlake is fully custodial fan-out** (Reed asked): all 7,596 feeds have
  exactly one leg; 7,175 point at ONE node ("Beekeeper via Wavlake"), 421
  remix feeds at a second. Per-artist routing is TLV customKey `16180339`
  with a distinct customValue per feed. Same at track level, where Wavlake
  is 23,561 of 49,393 episode-level blocks.
- **Legs classify by address shape, never the declared `type`** (publishers
  put junk there): 66-hex = keysend, user@domain = lnaddress.
- **customKey decoder ring:** 906608 = Fountain user id · 696969 = Alby
  wallet id · 16180339 = Wavlake artist id · 818818 = v4v.app/Hive account
  (11,341 feeds) · 112111100 = podStation.
- **`feedsWithTranscripts` in daily_counts.json is upstream-buggy** (equals
  episodesWithTranscripts, 6.46M — impossible). Exclude it; the other
  fields look sane.
- **PayPal/Patreon are not in value blocks** — they live in the `funding`
  tag, and PI publishes only the count (89,972 feeds). URL-level breakdown
  needs crawling (Tier 4).

## The menu

**Tier 1 — ready today from the snapshot:**
1. Keysend vs lnaddress: 47,357 vs 6,476 legs (83.2%/11.4%); 2,456 of
   33,219 feeds (7.4%) with ≥1 lnaddress leg. Mix: keysend-only 27,992 ·
   lnaddress-only 2,355 · mixed 101 · no valid leg 2,771.
2. Platform decomposition of the 33k (the honesty chart) — see above.
3. Non-lightning models: hive 695 · webmonetization/ILP 57 · bitcoin/amp 2.
4. Custody concentration: PI donation legs on 13,013 feeds, v4v.app 11,279,
   Wavlake 7,596, Alby 5,186+, Fountain 2,892; lnaddress domains
   sats.v4v.app 3,124 · getalby.com 1,935 · fountain.fm 1,122.
5. Platform rake: 15,323 feeds carry a fee=true leg (PI 1% voluntary;
   Podping 4% on 1,562 rss.com feeds; blubrry 3–5% on ~800).
6. Episode-level value: 49,393 episodes / 9,342 feeds; 660 feeds have ONLY
   episode-level blocks. The music-tracks story.
7. Value-block vintage: valueCreatedOn cohorts by year (2021: 3.3k → 2026
   YTD: 2.9k).
8. Index-wide feature counts (daily → time series for free): funding 89,972
   · chapters 63,322 · soundbites 72,380 · socialInteract 4,526 · medium
   music 9,612 / video 14,611 · value share of 90-day-active feeds 6.8%.
9. PI's own v4v sats-flow series (chart-data.json), republishable context.

**Tier 2 — one authed API sweep each:** medium × value join via
`podcasts/bymedium` (podcast vs music vs video axes on everything);
valueTimeSplit count via `bytag?podcast-valueTimeSplit`.

**Tier 3 — needs the ~1GB weekly feeds dump:** alive-vs-dead value feeds
(newestItemPubdate join), language/category crosses.

**Tier 4 — needs RSS crawling (separate project; podroll politeness lessons
apply):** podroll adoption index-wide (sampled crawl of ~2k active feeds
gives an error-barred estimate; our-corpus number is 65/925 = 7%);
funding-tag destination breakdown (Patreon vs PayPal vs BMAC).

**Parked from an earlier turn:** the monthly keysend-vs-lnaddress history
charts back to 2020. Needs `/episodes/byfeedid` per value feed (~33k calls,
one overnight run) for "aired that month", and carries the stated caveat
that backfilled composition projects TODAY's block onto past months
(valueCreatedOn as floor). The daily snapshots make it truly accurate from
2026-08-21 forward.
