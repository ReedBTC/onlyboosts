# The Data Pipeline

**Moved verbatim out of `CLAUDE.md` on 2026-11-11**, when that file had grown to 200KB and was
loaded into every session's context. Nothing was rewritten on the way across, so
`git log -S <phrase> -- CLAUDE.md` still finds the history of any paragraph here. Where a
paragraph says "this file", "above" or "below", it means the old `CLAUDE.md`; the four
files it became are `docs/site-structure.md`, `docs/architecture.md`,
`docs/feature-rules.md` and `docs/data-pipeline.md`. `CLAUDE.md` keeps the rules a change
elsewhere would break and points here for the reasoning.

## The exclusion list

`excludes.json`, at the repo root. Anything named in it is filtered out of every
published surface — the JSON shards, the D1 projection behind `/api/v1`, the show
and episode pages, search, the podroll graph, and the counts on `/about`. It
ships **empty**; it exists so a takedown request is answered by one edit.

**It is at the repo root, and it is public, both on purpose.** The repo is public
and the file is the answer to "what are you hiding, and why" — so every entry
carries a required `reason`, and `pages_build_output_dir = "."` means it is also
served at `onlyboosts.social/excludes.json`. Its `_readme` key is the user-facing
documentation; JSON has no comments, so the file carries its own.

**Four lists, and the medium split does not get its own.** `shows` covers albums
and `episodes` covers songs, because an album *is* a show with
`<podcast:medium>music`. The other two are `boosters` and `boosts`.

**Nothing is deleted.** The collector keeps indexing everything; the list gates
what is *published*. That is what makes it reversible — removing an entry
restores the content on the next pipeline run, verified end to end.

**⚠️ A guid is matched against every identity slot**, not the one its list is
named after. Clients demonstrably sign an *item* guid into the `podcast:guid`
tag. Measured on the live index, 52 of the 107 boosts to one episode name it in
the show slot with no `item_guid` at all, so matching `episode` against
`item_guid` alone would have left most of them published. These ids are opaque
and unique, so a listed id turning up in another slot only ever means the same
content. See `db._excluded_expr`.

**A malformed file is fatal, a missing one is empty.** A file that exists and
doesn't parse raises, and the run scripts validate it as their *first* step so
the failure is legible rather than a traceback inside a scan. The failure mode
being guarded is a typo'd key (`"show"` for `"shows"`) silently excluding nothing
while everyone believes the content is gone.

The collector-side mechanics — `excludes.py`, `db.apply_excludes()`,
`db.not_excluded()`, the podroll and shard-pruning surfaces, and the D1
re-projection queue — are documented in `bots/global-boost-scan/`. Two things to
know from this side: **use `db.not_excluded()` rather than writing `excluded = 0`
by hand**, so a new query is found by grep; and `onlyboosts_globalscan.py
excludes` validates the file and reports what each entry currently hides, which
is the check to run after an edit.

**The removal path is deliberately not documented on the site.** `/about` says
nothing about how to be excluded, and `docs/about-and-faq-source.md` is
intentionally silent on it too. Reed's call; don't add it as a "missing piece".

## The duplicate filter

`bots/global-boost-scan/dedupe.py`, live since 2026-08-24, and **its docstring
is the design record** — the rule, the evidence tiers, and the measurements
behind every threshold. What belongs here is only what a change elsewhere
would break.

One payment can produce two notes: the donor's app publishes one, and a
node-watching relay bot (`chadf-boostbot`) publishes another for the same
boost. Before BMB/OB/LB spoke NIP-73 the bot's note was the only record; now
it double-counts the boost, the sats and — different signing keys — the
booster. The filter marks the relay copy `dup_of = <kept event_id>` and keeps
the app's own note, which may be donor-signed, so the real member keeps the
credit. 62 historical rows were marked on flip-on (42 BMB, 14 StableKraft, 6
Bowl After Bowl, 25,265 sats); the pass runs every incremental cycle over a
7-day trailing window.

- **⚠️ `dup_of` IS ITS OWN COLUMN AND MUST NEVER FOLD INTO `excluded`.**
  `apply_excludes` recomputes that flag wholesale from excludes.json on every
  connect and would silently unmark every duplicate. `db.not_excluded()` gates
  on both, which is how one edit reached every published surface — keep using
  it rather than writing either flag by hand.
- **⚠️ SATS + GUID + TIME WINDOW ALONE OVER-FILTERS, MEASURED.** 651 pairs of
  same-amount, same-episode boosts minutes apart are distinct real payments
  (live-show boost storms). What prevents eating them: only
  `RELAY_PUBLISHERS`-signed notes are ever droppable, pairing is strictly
  one-to-one, and one evidence tier must corroborate — a ≥3-distinctive-word
  common run of the donor's own prose, or app agreement where the note's prose
  (if any) is fully contained in the partner's. **A pair with no evidence is
  let through, and contradicted prose blocks even a same-app match** — Reed's
  call, 2026-08-24: a duplicate slipping through beats a real boost filtered
  out. Don't tighten toward recall.
- **⚠️ THE FILTER CLUSTERS A PAYMENT'S NOTES SINCE 2026-10-29; IT NO LONGER
  PAIRS ONE RELAY NOTE WITH ONE NON-RELAY PARTNER.** *Reed's report:* Chad
  and Reed's show had three relay bots per payment (Boostr_Bot, chadf-boostbot,
  candr_boost_bot) and listeners on apps that publish no note, so two or
  three bot notes stood for every boost. A relay note now joins a cluster
  with the donor's note AND other bots' notes (one note per publisher, the
  donor's note the keeper, else the bot note with the episode); `same sats`
  is ±1/±3% plus the leg bots' x100 rounding; a missing episode is a
  wildcard; what a template prints (sender name, titles as printed, a bot's
  mentions and hashtags) is a fact, not prose. Only bot-signed notes are
  ever marked, still. Full history on the day: 118 notes, 95,483 sats. The
  design record is the PAYMENT CLUSTERS section of `dedupe.py`'s docstring;
  `test_dedupe_clusters.py`. **BoostAfterBoost (`boostafterboost`, the same
  software as candr_boost_bot on the Homegrown Hits / Bowl After Bowl node)
  was found by the same survey and registered the same day.**
- **⚠️ `SAME SATS` HAS ONE EXCEPTION, AND IT IS THE NAMED SENDER (tier 0,
  2026-09-24).** `Boostr_Bot` reconstructs the amount from its own 1% leg
  (100 for a 123-sat boost; 11 of its first 25 partnered notes disagreed), so
  the hard key never held and Reed saw both notes counted. Its notes name the
  donor in a `["sender", npub]` tag, and the partner note is **signed by that
  key** — the signature is the evidence, not the tag. `_sender_match` pairs
  such a note with the donor's own note on the same episode within
  `APP_WINDOW`, sats ignored, nearest first; **a named donor with no note of
  their own is let through and never falls to tiers 1–3**, since any other
  partner is a different donor's payment. The `sender` tag is still read
  nowhere for attribution (see the `client_id` section). Also the day the
  registration commit (21a70b1) finally reached the collector: it had been
  on origin since 2026-09-10 with "still to run on the collector box" in its
  message, and the timers run this checkout. `test_dedupe_sender.py`.
  **MSP_bot (`msp-2-0`, registered 2026-10-02) is the second bot on this
  tier**: the same 1%-leg shape for musicsideproject.com feeds, the same
  `sender` tag, and five of its first nine notes paired by it.
  **candr_boost_bot (`candr-boost`, registered 2026-10-20) named no sender
  until 2026-11-08 15:05Z**: Chad's watcher on the Chad and Reed node reports
  the full amount, so the prose tiers paired it (2 of its first 30 notes,
  both against BoostMeBitch, tier `msg+app`). Since then it, BoostAfterBoost
  and libre-relay-bot write `["sender", npub]` when they know the payer, and
  chadf-boostbot does on every boost Chad's node sends; see "Chad's Relay
  Bots Name The Payer" in `docs/boost-clients.md`. It is excluded from the
  boards, unlike chadf-boostbot, because it relays other listeners' boosts.
  **libre-relay-bot (`libre-relay-bot`, registered 2026-11-09 at Chad's
  request in that PR) is Chad's reader of the #SirLibre IRC channel**, where
  Sir Libre's node announces each boost; one key, no client tag, the sender
  named in the body as text. 23 notes and 2,391 sats had ranked as a member
  and kept 5 duplicates as a donor would. **Nothing it has published since
  2026-10-03 carries a NIP-73 tag** (91 boost notes measured 2026-11-09;
  the IRC line names the track's album and artist, not the feed paid), so no
  new note of its indexes until Chad fixes the bot; Reed is following up with
  him. Off the boards like candr.
- **⚠️ ONE-TO-ONE HAS ONE EXCEPTION, ON THE RELAY SIDE.** `chadf-boostbot`
  signs one receipt and one note **per keysend leg**, so a multi-leg boost is
  2–3 identical bot notes and the claim used to block the second from the
  partner the first had matched — 7 duplicates reached D1 that way (found
  2026-08-30). A relay note whose identical sibling (same publisher, same hard
  key, prose equal once `nostr:`/URL tokens are stripped, ±`APP_WINDOW`) is
  already marked is marked against the same partner, tier `sibling`. It only
  ever attaches to a partner the tiers already matched, so it cannot reach a
  non-relay note. **It is deliberately not a partnerless "identical siblings"
  rule** — Reed's call, 2026-08-30: 233 real same-author identical-text pairs
  within 300s exist, and #40HPW hours are `DISTINCT (booster, episode)` so a
  second note never adds hours anyway. The 77 partnerless bot clusters stayed
  until **2026-10-29, when Reed ruled on all 62 standing twin pairs** (one
  bot, identical notes within 30s, no partner): the ones carrying a COMMENT
  (anything the booster's app put in the message field, a gif link or "No
  message" included) are one payment and the later note is marked `twin`;
  the bare "⚡ 333 sats / 📱 via App" template twice is not proof and both
  stand. 42 marked, 20 kept; `dedupe._comment` is the line, `TWIN_WINDOW`
  30s, pinned in `test_dedupe_clusters.py`.
- **A new republisher bot is out of scope until registered**: its pubkey in
  `clients.py#PUBLISHER_PUBKEYS` (the member wall already forces this) and its
  slug in `RELAY_PUBLISHERS` — relay bots only; the first-party publisher keys
  (BMB's site account, our bot, LB's show account) are never the droppable
  side, their note being the payment's own record. A bot whose notes carry no
  message and no discoverable app identity slips through until a fingerprint
  joins `APP_DOMAINS`; that is the accepted cost of never guessing.
- **Reversal is two deletes, and D1 heals itself**: clear the row's `dup_of`
  and its `d1_boosts_synced` marker, and the next delta re-inserts it; marking
  rides the same `d1_reproject` queue an exclusion uses, which recounts the
  touched show, episode and profile rows remotely.
- `onlyboosts_globalscan.py dedupe [--days N | --all] [--dry-run]`; the last
  full-history report is `data/dedupe-report.txt` (gitignored).
- **The site needed no change** — it reads D1 and the shards, both corrected
  at the source. `/about` does not yet disclose the filter;
  `docs/about-and-faq-source.md` is where that copy starts if it ever should.

## Data feed

**⚠️ THE CORPUS STARTS 2024-07-01, SINCE THE DEEPSCAN RECOVERY OF 2026-09-01.**
Fountain notes carried `i` tags with no `k` tag until ~2025-04-14, so the scan's
`#k` filter was blind to that whole era while the events sat on
relay.fountain.fm (which retains to late 2022). `onlyboosts_globalscan.py
deepscan` recovered ~15k boosts by #i-per-guid and authors= walks. Detail lives
with the collector (commit 2fa7869 and the deepscan section of the script's
docstring).

**⚠️ EVERY SCHEDULED WALK ASKS RELAYS WITH THREE FILTER SHAPES, NOT ONE, SINCE
2026-09-03.** `#k` alone only matches a note that carries a `k` tag, and
StableKraft and Wavlake's own app still publish `i` tags with no `k` —
measured that day: 415 boosts since 2025-06-01 sat on the core relays unseen
by every pass (209 linking stablekraft.app, 140 fountain.fm, 65 wavlake.com),
found by chasing one StableKraft boost Reed noticed missing. `scan.py`'s
`boost_filters()` adds `#i` per known show guid and `authors` per known
booster, read from the index at the start of each run, and the incremental,
backfill and outbox walkers all take the set — so a show or booster first seen
through a `#k` note on one tick is covered by the k-free shapes on the next.
The residual is a first-time booster on a show the index has never seen,
without a `k` tag; no filter Nostr offers reaches that, and the fix is the
client sending the tag NIP-73 specifies. **StableKraft does since
2026-09-06** (Reed's issue, ChadFarrow/stablekraft-app#237, closed by PR
#243): every `i` is paired with its `k`, plus `["client","StableKraft"]`,
which `clients.py` already slugs and labels. Forward-only — kind 1 is
immutable — so the 274 StableKraft notes from before the fix stay k-less,
unlabelled, and reachable only through the `#i`/`authors` shapes. Its
companion, #242/PR #245, stopped StableKraft naming an internal row id as
`podcast:item:guid` when a track has no RSS guid; a boost to such a track
now names the show only. Six boosts in the index (242 sats, four tracks)
carry those unresolvable ids with no show guid beside them; nothing automatic
heals them, but three of the four albums are shows the index knows, so a
hand re-key to a show-level boost is possible if Reed wants it. Wavlake's own app still sends no `k` and has larger problems.
Untagged boosts land **unlabelled** by design: the only evidence of the app
is the URL the note links, and `clients.py`'s rule is never to guess. The window the single-shape scan had already walked was
caught up with `backfill --force --floor 1748736000` on 2026-09-03; the scan
docstring carries the two relay quirks the wider filter set met (per-filter
caps make a multi-filter REQ unpageable, and two nginx fronts 429 back-to-back
handshakes).

**⚠️ A NOTE PUBLISHED MORE THAN THREE HOURS AFTER ITS OWN `created_at` IS
INVISIBLE TO THE TICK, AND THE PUBLISHER KEYS ARE RE-READ DAILY FOR THAT
REASON, SINCE 2026-10-02.** The tail scan's `since` is `last_incremental`
less `INCREMENTAL_OVERLAP` on `created_at`, and the backfill is complete, so
a relay bot that stamps the payment time and publishes from a backlog, an
outage or a queue slips every walk: MSP_bot had **195 boosts (43,605 sats,
back to 2026-02)** on relay.fountain.fm that nothing had read, each matched
by the live filter set the moment it was asked, with the classifier, the
shapes and the ticks all ruled out first. `rescan-publishers` in
`onlyboosts_globalscan.py` walks every `PUBLISHER_PUBKEYS` key's own
timeline back 30 days on the daily outbox run (one `authors` filter per key
per core relay, idempotent); `--floor` is the recovery form. **The diagnostic
order that proved it — gate, shapes, ticks, then the backfill-date check —
is in the command's docstring and is the order to use for the next "my boost
is missing".** A late note from a person's own app is still unread until the
outbox sweep's `authors` shape meets it, which is the accepted residual.

**⚠️ THE INCREMENTAL CYCLE (EVERY 2 MINUTES SINCE 2026-09-06, 5 BEFORE)
PUBLISHES ONLY WHEN THE INDEX CHANGED, SINCE 2026-09-04.** `publish-due` in `onlyboosts_globalscan.py` digests every
published column of every published table (`db.content_fingerprint`) and
compares it with what the last full export recorded and what the last push
shipped; `export --per-show`, `push` and the share cards run only when it says
so, and the D1 delta runs every tick regardless — it has its own pending
state and its own retry. Before the gate a no-change cycle cost **3m14s of
CPU**, 11.7 CPU-hours a day, to rewrite files rsync then skipped: 135s of it
the per-show export re-scanning the boosts table twice per show on the
unindexable `COALESCE` guid, 48s of it `apply_aliases` doing the same once
per alias. Both are one pass now (`export.py`'s per-show block, and the
`IN (subquery)` note in `db.apply_aliases`); the daily outbox and podroll runs
still export unconditionally. A quiet stretch leaves `generated_at` old while
the data is current — it is when the shards were last built, not a liveness
signal. The gate fails open: an exception in it is "due".

**⚠️ THE SITE'S OWN BOOSTS REACH D1 AHEAD OF THE COLLECTOR, SINCE 2026-09-06.**
*Reed's ask.* `POST /api/v1/boosts/ingest` writes a boost row, its FTS row, a
title-only stub for an episode or show D1 has never seen, and a recount of the
touched show and episode the moment the widget's note is acked by a relay;
`boosts_edge` records every row it wrote. **The collector is still the source
of truth**: its delta collides on the event id, its `INSERT OR REPLACE`
projections overwrite the stubs and the recounts within one cycle, and two
collector duties hang off the marker table (replace rather than ignore an
edge-written boost; sweep one that never turned up on a relay). So **a D1 row
no longer implies a local row** on the collector box, and anything that
reconciles the two directions has to allow for it. The design record is *The
Boost Is Indexed At The Edge Before The Collector Sees It* in
`docs/money-paths.md`; `test-boost-ingest.mjs` covers the endpoint.

Two stores, one model. **D1 behind `/api/v1/*` is what every feed and page
reads.** The collector also publishes static JSON to
`https://relay.mynostr.app/onlyboosts/`, proxied through
`functions/api/data/[[path]].js` (`/api/data/*`); that remains a published
dataset, but the only thing on the site still reading it is `/about`'s stat strip
(`meta.json`).

**⚠️ The upstream returns HTTP 200 for missing files.** `relay.mynostr.app`
serves Nostr on the same origin, so an unknown path falls through to the relay
and answers `200 text/plain "Please use a Nostr client to connect."` — not a 404.
Never branch on status. The proxy has two load-bearing guards: it checks the
content-type *and* parses the body as JSON before returning it. Don't "optimize"
the parse away by streaming the body through.

Path handling is a **strict allowlist**, not a passthrough — a catch-all that
forwards whatever it's given is an SSRF hole. The published shapes are
enumerated in `PATH_RULES`: `index.json`, `latest.json`, `boosts/YYYY-MM.json`,
`podcasts/index.json`, `podcasts/<guid>.json`, `profiles.json`, `meta.json`.
Directories aren't browsable — **discover filenames from the manifest**, never
build paths by hand.

Full schemas live upstream in `bots/global-boost-scan/DATA-API.md`.

### Record shape and nullability

```
{ id, ts, sats, src, msg, client,
  booster{pk,npub,name,pic}, podcast{guid,title,img,feed},
  episode{guid,title,img,date,num,url} }
```

Almost every display field is nullable. Measured over a 1,000-row sample: `msg`
16%, `booster.pic` 15%, `episode.title` 11%, `episode.num` 61%, `podcast.guid`
2%. `ob-data.js#normalizeBoosts` flattens all of it so the *only* fields a caller
may assume are `id`, `ts` and `booster.pk` — everything else is explicitly
nullable and must have a fallback.

Two shape traps:

- **`episode.guid` is sometimes a URL**, not a UUID. Treat it as an opaque key.
- **The per-show shards stringify numerics** (`"9"`, `"55987"`, `"None"`), so
  coerce rather than trusting `typeof`.

Booster names and avatars are **embedded in every record**, so there is no
profile round-trip and nothing to repaint — first paint is final.

### The two client data modules

`ob-data.js` is **shape only**: `normalizeBoosts`, `toEpisodeShape`,
`episodeApiToBoosts` and `boosterLabel` are the reason every consumer downstream
of a fetch sees one model. Its fetching half was deleted on 2026-08-14.

**⚠️ Verify per function INCLUDING internal callers before removing anything
here.** A grep that excludes the file itself hides functions whose only caller is
a sibling in the same module, which is what made `mediumPredicate` look live.

`ob-live.js` is the D1 reader and caches nothing in-process. Two shapes:
`followsBoostReader()` pages incrementally for the note feed;
`getFollowsBoosts()` pulls a bounded corpus for the episodes rollup, capped by
`MAX_EAGER_ROWS` / `MAX_EAGER_PAGES` and reporting `truncated`. That cap is about
how many *boosts* to roll up and is unrelated to the follow set's size.

Two Functions read D1 directly rather than through `ob-live.js`, because each
needs one bounded corpus once rather than a paging reader:
`/api/v1/episodes/<item-guid>?community=1` and
`/api/v1/boosters/<npub>`. Both return the standard boost record shape, so both
run through `normalizeBoosts` and everything downstream sees the one model.

**⚠️ `/api/v1/boosts/follows` passes its whole author list as one bound JSON
array, unrolled by `json_each`.** D1 imposes two limits a large `IN (...)` hits
from opposite sides: 100 bound parameters per statement, and 100,000 bytes of
statement text. One bind per author breaks at 99 follows; interpolating instead
runs out around 1,480. The JSON array escapes both — the statement is a fixed
~180 bytes however many authors there are. Verified on SQLite 3.51 that the plan
still resolves through `idx_boosts_booster`.

Cloudflare documents JSON1 but doesn't enumerate the table-valued functions, so
the endpoint keeps an interpolated fallback if D1 rejects `json_each`. **That
fallback is the only place SQL is built by concatenation**; it's safe because
every value has been through `toHexPubkey` and re-tested against `HEX64`. Don't
generalize the pattern. `MAX_AUTHORS` (10,000) is an abuse guard, not a technical
ceiling.

### Follows scoping

`assets/js/follow-set.js`. `resolveFollows()` reads the signed-in pubkey from
`localStorage.lb_nostr_session` — deliberately *not* by loading the 1MB login
widget, since all we need is an identity, not a signer — then fetches that user's
newest kind-3 across the static relays and unions its p-tags.

**An nsec login is never persisted** (`LoginScreen.jsx` keeps the key in memory
only), so localStorage is empty for a user who is genuinely signed in.
`getSessionPubkey()` therefore falls back to
`window.LBLogin?.getUser?.()?.pubkey` — read only if the bundle is *already*
loaded; it must never load it, which is the whole reason this module exists.
Cached 30 min, keyed by pubkey so an account switch can't serve the previous
user's list; an empty result is never cached. Returns `signed-out` / `ok` /
`empty` / `unavailable`. The user's own pubkey is in the set, so your own boosts
appear in your Follows feed.

**`lb:session-change` is what keeps this in sync.** `setUser` in the widget
dispatches it whenever the *identity* changes (not on profile refreshes). Two
listeners, both also watching `storage` for the same thing in another tab: the
inline feed-bar controller shows/hides the scope menu and drops you back to
Global if you sign out; `feeds.js` drops both `*-follows` keys from its `loaded`
set and re-runs whichever is on screen.

The renderers still carry a `signed-out` branch. Unreachable through the feed bar
now, kept as a fallback.

**The Episodes feeds don't use `podcasts/index.json`.** The cards are *episodes*,
not shows, and the published index is a show-level rollup computed over everyone,
so its counts would be wrong for a Follows audience.

## Discoverability data: `show_similar`, `first_boost_ts`, `description`

Three collector-side pieces for the rails homepage, built 2026-10-17 on
OB-web's spec, all ending in D1. **`bots/global-boost-scan/similar.py` is the
design record for the first**; the D1 shapes are commented in `d1/schema.sql`.

| | |
|---|---|
| `show_similar` | per show with **>= 3 distinct boosters**, its **top 20** same-medium-side shows by cosine over the booster sets, `(podcast_guid, other_guid, score, shared_boosters, rank)`. Recomputed whole by `onlyboosts_globalscan.py similar` on the daily podroll run, replaced wholesale by `d1_sync.py --remote-similar`. 12,186 rows at build (454 podcast + 222 music seeds). |
| `podcasts.first_boost_ts`, `episodes.first_boost_ts` | `MIN(created_at)` of the row's live boosts, on every projection path. Stored raw; the New and Noteworthy rail picks its window (measured: 41 shows first boosted in 30 days, 98 in 90, 3 of the 41 with three boosters). |
| `podcasts.description` | the channel `<description>` off PI's byguid answer, HTML-stripped, via `enrich._show_from_feed`; `backfill_description.py` fills existing rows and bumps `updated_at` so the drift pass carries them. |
| `podcasts.newest_item_ts` | the newest episode's `datePublished` off PI `episodes/byfeedid` (byguid carries no newest-item field, measured), unix seconds, podcasts only, NULL for music and when PI lists no item (2026-10-29, OB-web's spec, Reed's call: a PODCAST whose newest episode is over 183 days old is not recommended; albums never go stale). One extra PI call per podcast refresh; `backfill_newest.py` fills boosted podcasts serially; a failed lookup keeps the stored date. |

What a change elsewhere would break:

- **⚠️ THE RELAY-BOT PUBLISHER KEYS ARE NOT BOOSTERS IN THE SIMILARITY.** One
  key relaying hundreds of donors reads as one person who boosted everything
  and manufactures overlap; `similar.py` drops `PUBLISHER_PUBKEYS` less
  `chadf-boostbot`, the complement `_common.js#PUBLISHERS` takes. Measured:
  with the keys in, 6,627 music pairs; without, 4,354.
- **⚠️ THE FULL TOP 20 IS STORED AND THE FLOOR IS THE EDGE'S.** Half of all
  pairs share exactly one booster (podcast median score 0.09, music 0.24). A
  single-seed rail floors at `shared_boosters >= 2`; the summed rail relaxes
  it. Don't floor in the collector; it forces a resync per rail.
- **⚠️ `podcasts_fts` AND `episodes_fts` CARRY `description` SINCE 2026-10-17,
  AND EVERY FEED SEARCH NAMES ITS COLUMNS.** `ftsMatch(raw, cols)` emits
  `{title author} : (…)`; `podcasts.js`, `episodes.js` and `search.js` pass
  theirs, so a word in a show's notes does not list the episode under the
  sats ordering as if its title matched. Only the front-door search omits the
  list. `publishers_fts(title)` rides the publisher replace. All three are
  `--rebuild-fts` (drop and repopulate) on the remote.
- **⚠️ THE REMOTE STEPS RUN BEFORE THE COLLECTOR PULLS THE CODE**, in this
  order, with the incremental timer stopped: the three `ALTER TABLE`s named
  in `schema.sql`, `--apply-schema` (the new tables), then after the pull
  `--rebuild-fts`, `similar` + `--remote-similar`, and a drift pass. A
  projection naming an absent column fails the whole batch, and the delta
  then stops reaching D1 until it is fixed.
- **Favorites counts (kind 10333) were scoped and deliberately not built**:
  15 lists on the publish relays, 9 with public entries, 843 of 931 entries
  on two of them, top feed favorited by 5. A Most Favorited rail would be two
  people's lists. The probe is in the 2026-10-17 report; re-measure before
  building it.

## Show artwork: the `art2` fallback

Some feeds publish two artwork URLs, RSS `<image><url>` and `<itunes:image>`, and
the first is sometimes dead while the second resolves. The collector publishes the
second as **`art2`**, null when identical to `img`; `assets/js/cover-art.js` walks
the chain on error (`episode art → show img → show art2 → glyph`). Live coverage
is small and real: 5 of 1,287 shows.

**`docs/show-artwork.md` is the authority** — the chain's rules, every wiring
site, the `/episode` third link, the `/booster` OG route and the measurements
behind all of it. Three rules restated here because a change elsewhere would
break them:

- **⚠️ `coverChain()` PROMOTES `http://` TO `https://` BEFORE IT FILTERS.** Every
  page here is https, so an http image is mixed content: Chrome auto-upgrades it
  and **blocks it outright if https fails**, never falling back to the insecure
  copy. `httpsUrl` is exported for the two avatar render sites that do not go
  through the chain.
- **⚠️ The share card's TYPE follows its image, on all four detail pages.**
  Podcast artwork is square by specification and a booster's avatar is square or
  portrait, so artwork gets `summary`; only the 1800x600 banner fallback keeps
  `summary_large_image`. Every page shipped the large card until 2026-08-16, which
  sliced every cover into a horizontal band — a worse failure than sending no
  image, because it reads as a broken picture rather than a missing one.
- **⚠️ `og:image` stays on the primary, deliberately.** A crawler cannot run the
  error handler, so preferring `art2` there is tempting — but `art2`'s presence
  means the feed publishes *two different* URLs, not that the primary is dead.
  Measured over all five shows that carry one: four primaries return 200 and one
  404s. Preferring art2 would swap four working share cards to fix one.

## Profile fallback

**An identity the index doesn't have falls back to Primal's cache before it is
allowed to render as `@npub1abc…`.** `assets/js/primal-profiles.js` owns that
lookup (`fetchProfiles`, chunked at 100, never throws). It was extracted from
`boosts-thread.js` — which now imports it — so the detail pages can use it without
pulling in 156KB of thread machinery.

The index stays the fast path. The collector embeds a booster's name and picture
in every record, which is what makes first paint final; this only fills two holes:

- a booster whose kind-0 was unresolved when the collector last ran;
- **an npub mentioned inside a boost message**, who need never have boosted
  anything and so is in no table of ours at all. This is the common case.

Primal is a **cache, not a relay fan-out**: one WebSocket, one batch, ~6s timeout.

Two invariants:

- **It is always post-paint and best-effort.** Every surface renders complete and
  readable from the index alone; an unreachable cache changes nothing. Never make
  a first paint wait on it.
- **The detail pages mark their own gaps.** The Function emits `data-pk` +
  `data-missing="name pic"` on exactly the cards, rows and chips it couldn't fill,
  and the client patches those and removes the attribute. Don't let the client
  re-derive what the server already knows.

**⚠️ WHICH ROOT EACH PAGE PASSES IS PART OF THE CONTRACT, because
`hydrateProfiles` REMOVES `data-missing` on its way out — including from an
element whose shape it does not know how to fill.** So a page with a second,
private backfill cannot call it on `document`.

| Page | Call | Covers |
|---|---|---|
| `/show`, `/episode` | `hydrateProfiles()` | everything; neither page has a private path |
| `/booster` | `hydrateProfiles(#boosts)` | the boost list only |
| `/artist` | `hydrateProfiles()` | everything — the bio is plain text with no mention chips, so there is no private path to protect |
| any card rollup | `hydrateCardProfiles(list)` | its own cards, on approach |

`/booster` is scoped because its **bio** carries a `.bs-mention` chip with its own
patch path (`fillMention`, selecting `.bs-mention[data-pk][data-missing]`).
Unscoped, `hydrateProfiles` matches that chip, finds none of the four class names
it knows, fills nothing, and strips the attribute — after which the header's own
backfill selects nothing and the bio mention never resolves. Measured in a DOM
against the live cache: unscoped fills 16 of 16 chips and breaks the bio; scoped
fills 8 on load and the rollup's own pass takes the rest to 0 on approach.

**`/booster` had no call at all until 2026-08-16**, so the `nostr:` mentions
inside its `#boosts` messages stayed truncated npubs forever. The hook was
correctly emitted the whole time; nothing read it.

The Boosts feed **rebuilds the card** rather than patching it, seeding
`setCachedProfile` first so the mention chips inside the message body agree with
the avatar above them.

## Show credits: `author`

`<itunes:author>`, backfilled across all 924 identified shows. Measured over the
shipped index, counting non-empty values that aren't just the title repeated:
**97.4% on music (454 of 466), 88.0% on podcasts (405 of 460)**. The collector's
own scoping probe put this far lower because it judged *quality* by eye where the
table applies the mechanical rule the site implements. **Measure off the shipped
index, not the probe.**

On a music feed `author` is the artist and is clean. On a podcast it is whoever
the publisher named there: usually the host, sometimes a network
(`Jupiter Broadcasting`), occasionally a tagline. So:

- **Never label it "Host" or "Creator".** `Artist` on music, a softer `By` on
  podcasts. "By Jupiter Broadcasting" is true; "Host: Jupiter Broadcasting" is not.
- **The only filter is the title repeat** (normalize case, whitespace and a
  leading "The"). Do not build a tagline detector: any rule sharp enough to catch
  "Bitcoin is for Everyone" also eats real names, and a wrongly suppressed credit
  is worse than an odd-looking one.
- `medium` defaults to `podcast` for a feed that declares none, so an untagged
  music feed gets `By` rather than `Artist`. A known consequence of the partition
  rule, not a bug.

It renders as `creditLine()` on `/show/<guid>`, prints nothing when empty or when
it repeats the title (~7% of rows), and `.show-credit` has no reserved space so a
suppressed credit costs no layout. It is also in the Shows feed search entry's
`extra` — matched, never displayed, scoring below every title hit. Not in `sub`:
it would push the show's own numbers off a narrow card.

**Still open:** `author` is not matchable in `/api/v1/search`, which matches
through `podcasts_fts`, declared `fts5(podcast_guid UNINDEXED, title)`. Adding it
is a collector-side schema change plus a repopulate; a SELECT cannot do it. Also
open: `og:title` for music becoming "<artist> — <album>".

## Show language: `language`

RSS channel `<language>`, off the Podcast Index feed object. It rides the
`podcasts/byguid` call `enrich.py` already makes, so it costs **no extra
request**. Carried by `podcasts/index.json`, the per-show shards and D1's
`podcasts` table; `backfill_language.py` filled the existing rows.

**Stored as the primary subtag, lowercased** — `en`, `de`, never `en-US`. The
corpus describes ~21 languages in **36 distinct raw tags** (`en`, `en-us`,
`en-US`, `en-gb`, `en-au` are one language and five menu entries, and the case
varies by publisher). Anything not 2–3 alpha is dropped rather than stored, so a
junk value can't become a junk filter option.

**⚠️ NULL MEANS THE FEED DECLARES NONE, AND THAT IS NOT ENGLISH.** Coverage
splits hard on the medium: **99% of podcasts (466 of 469) against 48% of music
(232 of 485)**, because Wavlake — 198 of the 251 music misses — publishes no
`<language>` at all. Across the index that is **594 untagged of 1,294**. So an
untagged show is a populous, first-class state, not a gap to default away: a
filter that folds NULL into a language turns "filter by language" into "hide half
the Albums feed", under a claim those publishers never made. Same partition rule
as the medium split, where the unidentified shows are why the Shows feed is
`not_medium=music` and never `medium=podcast`.

**The tail is thinner than the show counts suggest.** Boost-weighted: `en` 17,286,
`de` 3,155 across 40 shows — essentially the whole non-English story — `es` 319,
every other language under 50. A menu listing all 20 is mostly dead entries.

`lang=` filters `GET /api/v1/podcasts` and `GET|POST /api/v1/episodes`, on all
four query paths (all-time read, windowed GROUP BY, `q=` ranking CTE, follows
POST). `readLang` / `langWhere` in `_common.js` are shared so both validate
identically. Three rules:

- **`lang=unknown` is how the untagged bucket is asked for.** There is
  deliberately **no `not_lang`**: medium needs its negation because every show
  must land in exactly one of Shows/Albums, and language has no such obligation.
- **A full tag is normalized, not rejected** (`lang=en-US` → `en`). Nothing is
  stored in that form, so a 400 would only trap a caller passing a value straight
  back from a feed.
- **Validated by shape, never against a fixed list.** The set grows the first time
  anyone boosts a show in a new language; a whitelist would 400 it.

**`GET /api/v1/languages` is the facet, and a control is built from it rather than
a constant** — the set is data, not software. It is `medium`-aware because `de` is
38 shows on the podcast side and 2 on the music side, and it returns the `unknown`
row as a peer.

`language` also rides `/api/v1/podcasts/<guid>`, `/api/v1/episodes/<guid>` and
`/api/v1/search`, for consistency with the shards. **It is not in `podcasts_fts`**
and nothing needs to *search* a language.

Remote D1 got `ALTER TABLE podcasts ADD COLUMN language TEXT` out-of-band, as
`artwork` and the profiles fields did — `CREATE TABLE IF NOT EXISTS` adds no
column to an existing table, so `bots/global-boost-scan/d1/schema.sql` and the
live remote are kept in step by hand. The backfill reached D1 through the
**metadata-drift pass**: bumping `shows.updated_at` is what makes a row due.

The UI shipped in `e870b93` — see **The Language Filter** in `docs/feeds.md`.
**Still open:** the Boosts endpoints take no `lang`, so the note feeds have no
language axis.

## Who published a boost: `client_id`

**`docs/boost-clients.md` is the authority** — the three signals and their
coverage, the three measurements that shaped the rules, `SLUG_ALIASES`, the chip
on the boost cards, and the two registered first-party publishers (OnlyBoosts'
own bot and the Local Bitcoiners show account).

A derived classification, not a field anyone published: the raw `client` column
stays exactly as signed and is never overwritten, which is why the derivation
lands in `client_id` / `client_via` / `client_src`. The NIP-89 `client` tag is on
**1.3%** of the corpus; the `fountain.fm` i-tag and known publisher pubkeys cover
the rest, and **39 boosts are left null rather than guessed**.

What a change elsewhere would break:

- **⚠️ THE PUBLISHER IS THE CLIENT; THE APP IT RELAYS IS NOT.** A relay bot's
  notes name the listener's app in `client_via`, nested under the bot and **never**
  promoted to `client_id` — those apps published nothing to Nostr. The publisher
  pubkey is tested **first**, so a `client` tag naming a relayed app could never
  promote it.
- **⚠️ THE BOOSTER IS THE PUBLISHER, NOT THE DONOR.** An uppercase `["P", …]`
  sender tag is read nowhere and must stay that way: nothing here can verify the
  named donor authorised a note signed by a key they do not hold. If it is ever
  surfaced it wants a `proxy_for_pubkey` column, rendered as "on behalf of …", and
  kept out of every count.
- **⚠️ THE CHIP NAMES THE PUBLISHER, NEVER `client_via`**, and an unattributable
  boost gets **no chip** (`hasClientLabel` is the gate). *Reed's call, 2026-08-24.*
- **⚠️ `assets/js/client-label.js` IS TWO-SIDED**, which is why the label table
  lives there and `functions/api/v1/clients.js` imports it rather than declaring it.
- **⚠️ THE BOOST DELTA IS `INSERT OR IGNORE`**, so a re-derivation reaches the
  query layer only through `d1_sync.py --remote-clients`. Nothing else re-pushes it.
- **⚠️ ALL FOUR DETAIL-PAGE BOOST QUERIES MUST SELECT `b.client_id`**, /artist's included. They are
  hand-written rather than `BOOST_SELECT`, so forgetting one renders no chip at the
  edge and a chip on every row after a re-sort. `test-boost-row.mjs` catches it.
- **⚠️ THE `via != slug` GUARD IS LOAD-BEARING FOR OUR OWN NOTES.** Our template's
  `📱 via onlyboosts.social` slugifies to `onlyboosts` — the slug itself — so
  without that guard every bot note nests OnlyBoosts under OnlyBoosts. Not dead
  defensive code.
- **⚠️ THE INDEX IS LOAD-BEARING FOR LB's PUBLISH DECISION.** LB's bot asks
  `/api/v1/boosts` before publishing, so a reclassification that drops rows, or a
  stale D1 sync, makes it publish a duplicate. **Flag such a change rather than
  shipping it quietly.** LB's daily audit files a GitHub issue carrying the event id.

**Still open: `/stats`.** A "boosts by app" breakdown is what `/api/v1/clients`
was built for and still has no surface.

## Not indexed: `podcast:person`

`<podcast:person>` is **not** in this pipeline and deliberately isn't being added.
The collector probed it and found ~6% coverage, confirmed against raw feeds rather
than the API, so it is not a Podcast Index limitation: the tags genuinely aren't
in the feeds. A credits section built on that is the near-empty block that is
worse than nothing. Revisit only if we ever parse channel-level RSS ourselves
*and* a wider scan changes the number.

`ownerName` is also not indexed, and that is the more useful finding: every show
carrying one **also** carries an `author`, so it never fills a blank. It is not a
fallback. Don't re-add it.

## Podroll: the collector side

`<podcast:podroll>` is **not in Podcast Index**, so `podroll.py` fetches the
show's own feed. **It is the only pass in this pipeline that touches third-party
RSS**, and that shapes all of it.

**Daily, never hourly** (`onlyboosts-podroll.timer`, 09:40 UTC). A podroll changes
when a publisher edits their feed, never when a boost arrives.

**⚠️ The timer's cadence is NOT the crawl's cadence.** `db.shows_needing_podroll`
is age-gated by `--max-age` (default 6d), so a feed read cleanly two days ago is
skipped however often the timer fires: on the day the cadence changed, **8 feeds
were due against 948 in a full sweep**. The corpus still turns over about once a
week. Don't "fix" the frequency by lowering `--max-age` to match it — that is the
7x-bandwidth version.

**A new show waits for this pass, and nothing else fills the gap.** There is no
podroll path on the incremental tick by design.

**⚠️ Politeness is load-bearing.** The first scoping sweep, 12 flat workers, drew
429s from 137 feeds, 135 of them Wavlake. Every one would have been recorded as
"no podroll" and the number would have looked plausible. Re-probed serially: all
135 fetched, none had a podroll. So `probe_feeds` groups by host and goes **serial
per host**, concurrent only across hosts. Assume any wide third-party sweep has
this failure.

Three more invariants:

- **Only a clean read may rewrite a stored podroll.** A 429/timeout/truncation
  means we failed to see the feed, not that the publisher deleted their list.
  `http-404` is deliberately not transient: a gone feed is a real answer.
- **Feeds are streamed and abandoned** at `</channel>` or 2MB (one indexed feed is
  50MB). The cap was validated, not guessed: all 48 feeds that exceeded it were
  re-downloaded in full and none carried a podroll past it.
- **The block is regex-parsed, not XML-parsed**, because it's third-party markup
  read from a deliberately truncated prefix. A podroll opened but never closed
  raises `Truncated` rather than storing half a list.

Coverage: 65 of 925 reachable feeds (7%), 371 edges, 221 distinct targets. Only
~56% of cards link anywhere; 136 of 221 targets were new to the index, and the
collector resolves those through PI `podcasts/byguid` and caches them with
`discovered_via='podroll'`.

**In D1 both directions are denormalized onto the edge** (`source_*` / `target_*`),
because a join to `podcasts` would only resolve the half of targets that have
boosts. It syncs as a **full replace** via `d1_sync.py --remote-podroll`, run by
the podroll script, never on the boost delta path. Wholesale replacement is also
what makes a *removed* recommendation actually disappear.

Podroll-discovered `shows` rows have no boosts, so they appear in no export row
and no D1 projection. The one place it leaked was `db.stats()`, whose
`shows_enriched` used to be `COUNT(*) FROM shows`; it now asks the boosts table.
