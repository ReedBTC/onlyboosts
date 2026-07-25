# OnlyBoosts — Claude Code Notes

OnlyBoosts is a **new, standalone project** — an expanded version of the podcast
boost feed that began on localbitcoiners.com. It is a *sibling* to the Local
Bitcoiners repo (`~/localbitcoiners`), not part of it: kept separate so LB's repo
stays uncluttered. Reed manages both.

## Relationship to Local Bitcoiners

This project reuses the patterns, skills, and hard-won lessons from the LB bot
suite (`~/localbitcoiners/bots/`) — Nostr publishing, NIP-73 boost detection,
relay strategy, the sats-log pipeline shape, VPS-push data hosting, etc. When
building here, borrow those patterns rather than reinventing them. Where it makes
sense to share code, prefer a clean copy of the relevant `shared/` utilities over
importing across repos (the two projects sync to different GitHub remotes and
should stay independently cloneable).

Relevant LB findings that likely carry over (see LB's memory + docs):
- Boost notes live on a specific relay set; Fountain boosts are ~90%
  `relay.fountain.fm`-only. See `~/localbitcoiners/bots/boost-relay-landscape.md`.
- NIP-73 tags: `i = podcast:guid:<feed-guid>` / `podcast:item:guid:<item-guid>`,
  with matching `k` tags.

## ⚠️  STOP before any publish or payment

Same hard line as LB: you can freely edit bot code, configs, and refactors, and
run dry runs / read-only inspection. But **confirm with Reed before running
anything that signs/publishes Nostr events or sends payments** — real keys,
irreversible public events, real sats. Always start new bots with
`DRY_RUN = True`.

## Sync

Git remote: `git@github.com:ReedBTC/onlyboosts.git` (SSH, same auth as LB).
Branch: `main`. Commit/push only when Reed asks.
