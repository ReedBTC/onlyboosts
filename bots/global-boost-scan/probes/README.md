# Filter-rule probes

Read-only experiments asking one question: **are there boost notes on the relays
that the collector's rules or shapes leave behind?** Started 2026-10-03 from two
leads Reed brought — a Fountain note with NIP-73 tags and no payment
("I want to boost, but not available"), and a Local Bitcoiners boost whose only
Nostr record is the LB publisher's own untagged note from 2026-03.

Nothing in this directory signs, publishes, or writes to `data/onlyboosts.db`.
Output lands in `data/probes/` (gitignored).

| Script | Does |
|---|---|
| `harvest.py` | walks 15 relays with six filter shapes back to 2024-07-01 and stores every candidate note, classifier or no classifier. Resumable; `--status` for progress. Has its own walker because the shared one reads an HTTP 429 as an empty page. |
| `experiments.py resolve-refs` | fetches every event the unindexed candidates quote — first from the production receipt relays, then from the nevent's own relay hints and the wider set |
| `experiments.py report` | sorts every unindexed candidate into one bucket and writes `data/probes/report.md` plus `samples/<bucket>.json` |

The buckets are in `experiments.py`'s docstring. The one to read first is
**scan-gap**: notes the shipped classifier accepts with the shipped receipt relays
that the index does not hold. Those are not a rule question at all.

What the classifier does today, for reference (`classify.py`): a kind-1 note
with a `podcast:` i tag is a boost if it carries a `t` tag in {boost,
boostagram, value4value}, a positive `amount` tag, or quotes a kind-9735 zap
receipt reachable on `RECEIPT_RELAYS`. A sats figure in the text counts only
after one of those three has fired. BoostMeBitch's test (`lib/nostr/discover.ts`,
`buildNote`) is the same three clauses; it renders comment-only notes too but
flags them `isBoost: false`, and it also subscribes `#t: boostagram/value4value`
and reads relay.damus.io and relay.primal.net, which the collector does not.

## Findings, 2026-10-03 (first full run)

84,633 candidates from 14 live relays (mostr.pub dead), back to 2024-07. The
index held 41,617 rows; 134 of them no relay returned. Unindexed candidates:

| bucket | notes | what it is | verdict |
|---|---|---|---|
| receipt-wide | 35 | Wavlake boosts whose kind-9735 lives on **relay.wavlake.com** (34/35), which is not in `RECEIPT_RELAYS` | **fix**: add relay.wavlake.com to `RECEIPT_RELAYS` |
| scan-gap | 14 | k-less notes (2024-10..2026-04) on shows/boosters the index did not know when the k-free backfill ran with floor 2025-06-01 | re-run `backfill --force` with the floor at 2024-07-01 |
| content-sats, real | ~400 | "⚡ N sats" boosts with NIP-73 tags and no `t`/`amount`/receipt: Chad's ITDV/podtards apps 352 (16k sats, 2025-09..11, one signing key), BoostAfterBoost 13 (217k sats), lnaddress-music 22 | rule candidate: admit `i` + sats-in-text when the text is boost-shaped; Reed's call. The raw bucket also holds one 100M-sat prose note ("a bitcoin is 100,000,000 sats") — never parse unbounded prose |
| publisher-untagged (LB) | 349 (+67 with i tags) | Local Bitcoiners boosts 2026-03..09 whose only record is LB's own untagged publisher note; 329 carry the Fountain episode URL; ~5M sats | LB-side: a one-off backfill that re-publishes claims is NOT possible (notes are immutable); OB-side: a registered-publisher rule (sats in text + publisher key + resolvable URL) would admit them |
| publisher-untagged (chadf) | 839 | chadf-boostbot "📤 Boost Sent!" notes 2025-06..10 with no i tag, show named by title only, 259k sats | not resolvable without guessing; leave |
| comment-only | 11,151 | 8,563 Fountain comments (text, no payment) naming 1,375 shows the index lacks; 2,361 Amplify clip-shares (i tag is an mp3 URL, 90% no text) | Reed's call; not boosts |
| t-only | 5,230 | `#value4value` hashtag on ordinary notes | noise; BoostMeBitch's `#t` subscription buys nothing here |
| k1111 | 2 | NIP-22 comments | nothing there |

Relays: damus and primal contributed 1 and 0 unindexed boosts respectively.
BoostMeBitch's relay set is not where the gap is.
