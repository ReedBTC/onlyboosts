# OnlyBoosts — bots

Automated Nostr / Lightning bots for OnlyBoosts, following the same conventions
as the Local Bitcoiners bot suite (`~/localbitcoiners/bots/`):

- One bot per subdirectory, script named `onlyboosts_{function}.py`.
- Shared utilities live in `bots/shared/` — import from there, never copy/paste
  relay lists or publish helpers into individual bots.
- State files (`state.json`, `last_seen.txt`, `published_events.json`) sit next
  to each bot and are gitignored.
- New bots start with `DRY_RUN = True`. Nothing signs, publishes, or pays without
  Reed's explicit go-ahead.

## What's here

Carried over from the Local Bitcoiners fork and still LB-scoped — these are
starting points, not finished OnlyBoosts bots:

- **`bug-watcher/`** — polls the bug relay for `onlyboosts-alpha` reports and
  opens GitHub issues. Node, not Python; already repointed at this repo. The
  one bot that works as-is. Needs `onlyboosts-alpha` whitelisted in
  relay.mynostr.app's strfry write-policy before reports get through.
- **`community-scan/`** — the boost classifier: NIP-73 `podcast:item:guid`
  detection, zap-receipt unwrapping for Fountain-style notes that carry no
  `amount` tag, and Podcast Index enrichment. Read-only; never publishes.
  Still scoped to LB's supporters and skips LB's own show — OnlyBoosts wants
  network-wide coverage and skips nothing.
- **`community-boosts/`, `community-feeds/`** — the standalone collectors
  community-scan replaced. Kept for reference.
- **`shared/`** — `nostr_utils` (relay list), `boost_formatter`,
  `collector_common`.

The collector that writes the OnlyBoosts snapshot to the VPS isn't built
yet; the site currently reads LB's `community_boosts.json`.
