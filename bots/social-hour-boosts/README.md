# Social Hour Boosts

Publishes a kind-1 Nostr note for every boost to The OnlyBoosts Social Hour, from
the show's own wallet on Reed's Alby Hub. It replaces the 1% Boostr split: Podhome
time splits can point at a remote item by percentage but cannot carry their own
recipients, so a third-party bot could only be paid by a split on every episode.

**Status: built and dry-run only.** `DRY_RUN = True`, `WALLET_APP_IDS` is empty,
there is no key and no timer. Nothing publishes until Reed confirms the wallet,
adds the key and approves the note text.

## Files

| File | What |
|---|---|
| `onlyboosts_socialhour.py` | the bot: hub, gates, note, publish |
| `feed.py` | the show's RSS: guid, episodes, value time splits, the show's share at a moment |
| `boostagram.py` | one shape for a keysend TLV and an `x-rss-payment` descriptor |
| `coverage.py` | skip / hold / claim, ported from LB's `onlyboosts_coverage.py` at 9ed7fc1 |
| `test_socialhour.py` | fixtures built from OB-000's real splits; no network |

State, all gitignored: `state_published.json` (payment hash → note, the dedupe
gate, written after every publish), `last_seen.txt`, `state_songs.json` (song
names from Podcast Index), `dry-run/`.

## Assumptions

- **The feed is the source of the splits**, not `splits-final.json`. The feed is
  what the listener's app paid against.
- **A boost is the show's only when its boostagram names the show's
  `podcast:guid`.** `onlyboosts@getalby.com` also receives site donations and song
  splits, so the wallet alone does not establish it. A BOLT11 boost carries the
  boostagram behind its memo URL (`x-rss-payment`, the Helipad convention; Fountain
  serves it on every `?payment=` link, measured 2026-11-22). One without a readable
  descriptor is retried for 24 hours and then dropped, never published on a guess.
- **A reported total is believed only when the sats that landed match the show's
  share of it at the moment played**: 100% while the hosts talk, 100 minus
  `remotePercentage` during a song. An unverified total is never claimed, and the
  note states what the show received instead.

## Song Credit

During a song the note carries the show's guid pair, then the song's, Boostr_Bot's
order. The collector keeps the last `podcast:guid` on a note (`classify.py`), so
OnlyBoosts credits the song, as it does a song boosted off a playlist. That
behaviour is the loop's order rather than a written rule; it should be made one in
the collector before this bot goes live. `SONG_CREDIT = False` tags the show only.

The duplicate check searches the show's guid **and every song feed in the
episode**, because a donor's app may file its own note under the song.

## Before Going Live

1. Reed confirms the wallet's app id (55 or 56) → `WALLET_APP_IDS`.
2. Reed adds `NSEC_SOCIAL_HOUR` to `~/.config/nostr-bots/credentials.env`.
3. The show pubkey joins `PUBLISHER_PUBKEYS` in `../global-boost-scan/clients.py`,
   and `PUBLISHERS` / `RANK_PUBLISHERS` on the site in the same change.
4. Reed approves the note text (`note_text`).
5. After the StartOS 0.4 migration, `ALBY_HUB_URL` in credentials; then a dry run
   against the real hub, then `DRY_RUN = False` and a timer.
6. Boostr comes out of the show's value block the same day.

## Running

```sh
python3 test_socialhour.py
python3 onlyboosts_socialhour.py --app-id 55              # dry run against the hub
python3 onlyboosts_socialhour.py --fixture txs.json --feed feed.xml --app-id 55
```
