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

- **`global-boost-scan/`** — the collector. Scans Nostr network-wide for
  podcast boosts, classifies them, enriches from the Podcast Index, and
  publishes the static JSON the website reads. `DATA-API.md` in that
  directory is the schema contract for consumers.
- **`bug-watcher/`** — polls the bug relay for `onlyboosts-alpha` reports and
  opens GitHub issues. Node, not Python. Needs `onlyboosts-alpha` whitelisted
  in relay.mynostr.app's strfry write-policy before reports get through.
- **`shared/`** — `nostr_utils` (relay list, npub helpers, outbox lookup) and
  `collector_common` (bounded relay queries, VPS push).

## The exclusion list

`../excludes.json` (repo root) names shows, episodes, boosters and individual
boost notes that the collector keeps indexing but never publishes — takedown
requests, and feeds that were never meant to be indexed. Every entry carries a
`reason`, and the file is public so what is hidden and why is readable in one
place. It ships empty.

Adding an entry hides its content everywhere on the next pipeline run; removing
one brings it back. Check an edit before it goes live with:

```
python3 global-boost-scan/onlyboosts_globalscan.py excludes
```

which validates the file and reports what each entry currently hides. See the
file's own `_readme` for the entry format, and the **The exclusion list** section
of the repo `CLAUDE.md` for how it reaches the shards and D1.

The Local Bitcoiners collectors this project forked from — `community-scan`,
`community-boosts`, `community-feeds`, and `shared/boost_formatter.py` — were
removed once `global-boost-scan` superseded them. They're still readable at
`git show lb/main:bots/<name>` if any of that logic is ever wanted back.
