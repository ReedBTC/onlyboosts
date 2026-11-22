# OB Boostbot (Box)

Publishes the boosts nobody else published, for any feed that pays
`onlyboosts@getalby.com`. A podcast that puts the address in its value block, at
any share, gets its otherwise-unshared boosts on Nostr; the OnlyBoosts Social
Hour is the first (100% while the hosts talk, 1% during a song). Reed's design,
2026-11-22. The notes are signed by OB Boostbot (`npub182r6…`), the key the
site's edge signer uses for boosts made on onlyboosts.social, and take that
note's shape (`buildExternalNoteTemplate` in
`login-widget/src/lib/externalBoostagram.js`; keep the two in step).

**Status: built and dry-run only.** `DRY_RUN = True`, no key on this box, no
timer.

## Files

| File | What |
|---|---|
| `onlyboosts_boostbot.py` | the bot: hub, gates, note, publish |
| `feed.py` | a feed's guid, episodes, value time splits, and an address's share at a moment |
| `boostagram.py` | one shape for a keysend TLV and an `x-rss-payment` descriptor |
| `coverage.py` | skip / hold / claim / untagged, ported from LB's `onlyboosts_coverage.py` at 9ed7fc1 |
| `test_boostbot.py` | fixtures built from OB-000's real splits; no network |

State, all gitignored: `state_published.json` (payment hash → note or "covered";
the dedupe gate, written after every decision), `state_pending.json` (signed
notes no relay has accepted yet), `state_deferred.json`, `last_seen.txt`,
`dry-run/`.

## Assumptions

- **The wallet is Alby Hub app 55**, `onlyboosts@getalby.com` (Reed, 2026-11-22).
  It also receives site donations and the site's own boost legs, so the wallet
  alone does not make a payment a boost.
- **A boost names its feed.** The bot resolves the guid or Podcast Index id (the
  boostagram's URL only when the index does not know the feed), fetches the feed
  itself, and requires that every signal agrees with it and that some value
  block in it pays `onlyboosts@getalby.com`. A title is never a signal. A BOLT11
  boost carries its boostagram behind the memo URL (`x-rss-payment`; Fountain
  serves it on every `?payment=` link, measured 2026-11-22). A descriptor or feed
  that will not load is retried for 24 hours, then dropped, never guessed.
- **A total is believed only when it adds up**: the sats that landed must match
  the feed's share for `onlyboosts@getalby.com` at the moment played, time splits
  included.

## What It Publishes

| Decision | When | Note |
|---|---|---|
| skip | another note covers the boost (the index, or the relays at the last look) | none |
| excluded | the show, episode, song or sender is on the site's `excludes.json` (any guid slot, as the collector matches) | none; a list that will not parse stops the run |
| hold | too early to tell (20 min, 60 if the donor is known) | none yet |
| claim | nobody covered it, amount verified | with `t` tags and `amount`: the index counts it |
| untagged | nobody covered it, amount not verified | for readers only; no index counts it. The figure is what landed; at 5 sats or less the line reads "⚡Boosted via <app>" (Reed) |

**Our own key is evidence.** The site's edge signer publishes as OB Boostbot too,
and that note is the payment's note; LB's copy excluded its own key, which here
would double every site boost that pays `onlyboosts@getalby.com`.

**Song credit is the show's**, as the site's own boosts are today: the tags name
the show and episode the boostagram names. Reed: keep what we do now; the music
and time-split overhaul is later. The duplicate check still searches the song
playing at that boost, because a donor's app may file its own note under it.

## Publishing

A note is recorded as published only when a relay answered `OK` true for its id
(`publish_to_nostr` returns None otherwise, since 2026-11-22). The signed note is
saved before it is sent, and one no relay accepted is re-sent next run with the
same `created_at`: the same event id, never a second note.

## Before Going Live

1. Reed copies the site's `BOOSTBOT_NSEC` into `~/.config/nostr-bots/credentials.env`
   as `NSEC_ONLYBOOSTS_BOT`. The bot refuses any key whose pubkey is not OB
   Boostbot's.
2. A dry run against the real hub. Since StartOS 0.4 (2026-11-22) the hub is
   `https://custom-gnats.local:51818`. Restarting LND restarts the hub, which comes
   back locked: every read answers 401 until Reed unlocks it, and that is not a
   rotated token. The bot exits without advancing `last_seen`, so nothing is lost.
3. Reed's go: `DRY_RUN = False` and a timer. Boostr comes out of the Social Hour's
   value block the same day.

## Running

```sh
python3 test_boostbot.py
python3 onlyboosts_boostbot.py                       # dry run against the hub
python3 onlyboosts_boostbot.py --fixture txs.json    # dry run over saved transactions
```
