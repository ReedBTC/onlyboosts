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

Nothing built yet — this directory is scaffolding.
