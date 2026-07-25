# OnlyBoosts — Global Podcast-Boost Indexer: Design

*Status: design locked 2026-07-25. Not yet built.*

The backend for onlyboosts.social — a global index of Podcasting 2.0 / V4V
boosts across Nostr, powering four frontend views:

| View | Shape (existing LB analogue) | Filter |
|---|---|---|
| **Boosts — Global** | flat chronological boost feed (`boosts.html`) | all boosts |
| **Boosts — Follows** | same | booster ∈ viewer's kind-3 follows |
| **Podcasts — Global** | per-podcast cards (LB community feed) | all boosts, grouped by show |
| **Podcasts — Follows** | same | booster ∈ viewer's follows |

**All four derive from ONE dataset.** Boosts vs Podcasts = flat rows vs rows
grouped by `podcast_guid`. Global vs Follows = a **client-side filter** against
the logged-in user's follow list — zero per-user backend work.

---

## Core idea

We don't scan "all of Nostr." Podcast boosts are a narrow, well-tagged slice:
every LB/BMB/Fountain boost is a **kind-1 note tagged
`["k","podcast:guid"]` / `["k","podcast:item:guid"]`**. Relays index
single-letter tags, so we ask each relay *"give me every podcast boost you
hold"*:

```json
{"kinds":[1], "#k":["podcast:guid","podcast:item:guid"], "until":<cursor>, "limit":500}
```

The only architectural change from the LB community-scan is the query axis:
**LB is author-scoped** (`authors=members`); **OnlyBoosts is tag-scoped with time
pagination**. Everything downstream is reused.

Backfill floor: **2025-01-01** (safely before Fountain's boost bot; relays that
retain that far will fill it, most prune and stop earlier — fine).

---

## Storage: SQLite index → static JSON shards

SQLite is the **collector-side source of truth**; the website still serves
**static JSON** from the VPS exactly like LB (Caddy → CF Pages Function proxy).
No live DB in the request path.

**SQLite (`onlyboosts.db`):**
```
boosts(event_id PK, booster_pubkey, created_at, sats, amount_source,
       podcast_guid, item_guid, item_url, show_url, message, client, raw_json)
shows(podcast_guid PK, title, image, feed_url, feed_id, itunes_id, medium)
episodes(item_guid PK, title, image, published, duration, episode_number,
         podcast_guid, feed_id, enclosure_url, enclosure_type, description)
profiles(pubkey PK, name, display_name, picture, nip05, updated_at)
scan_state(relay PK, backfill_cursor, backfilled_to, last_incremental)
```

**Exported shards (pushed to VPS):**
- `boosts/latest.json` — most recent N (default view / first page)
- `boosts/YYYY-MM.json` — monthly pages for infinite scroll
- `podcasts/index.json` — per-show aggregates (count, total sats, latest boost, metadata)
- `podcasts/<guid>.json` — per-show episode + boost detail, on demand
- `profiles.json` — booster name/avatar/nip05 map

Follows filtering is client-side to start. Cloudflare D1 is the future option
*only if* Follows-at-scale needs server help.

---

## The two scan primitives

### 1. Deep backfill (heavy, one-time, resumable)
Per relay, concurrently:
```
cursor = now
while cursor > FLOOR(2025-01-01):
    batch = REQ {kinds:[1], "#k":[...], until:cursor, limit:500} → wait EOSE
    if empty: break
    upsert(batch)
    oldest = min(created_at in batch)
    if oldest >= cursor: break          # relay ignoring `until` — no-progress guard
    cursor = oldest - 1
    persist scan_state[relay].backfill_cursor = cursor   # resumable checkpoint
```
Runs **detached**; a restart resumes from each relay's checkpoint. Relays cap
`limit` and retain depth differently — accept partial, keep walking.
`relay.fountain.fm` is the one expected to hold boosts back to the floor.

### 2. Incremental tail (light, on a timer)
Same shape, `{... "since": last_incremental - overlap}`, small window. Mirrors
LB's quick tier. Plus a daily re-page of the last few days to catch late
propagation, and a weekly outbox-expansion refresh.

---

## Relay strategy — curated core + outbox expansion

**Curated core** (boost-dense, from the 2026-07-24 relay research —
see `~/localbitcoiners/bots/boost-relay-landscape.md`):
```
wss://relay.fountain.fm        (MANDATORY — ~90% of Fountain boosts are here only)
wss://nos.lol
wss://relay.damus.io
wss://relay.mostr.pub          (ActivityPub bridge, very wide)
wss://chadf.nostr1.com         (BMB / ChadFarrow)
wss://nostr.mom
wss://relay.lexingtonbitcoin.org
wss://nostr21.com
wss://podtards.com
wss://relay.wavlake.com
wss://relay.noderunners.network
wss://nostr.land
```
Plus `purplepag.es` + `relay.nostr.band` for **profile + NIP-65 resolution**
(not boost content).

**Outbox expansion:** after each backfill round, resolve the kind-10002 write
relays of every booster found, add any new ones, re-scan. Boosters publish to
their own relays; this auto-discovers boost-heavy relays and **converges** (each
round finds fewer new relays). This is the honest "reach all of Nostr" mechanism
— follow the boosters to wherever they publish.

---

## Enrichment

- **Podcast Index** (`resolve_show`/`resolve_episode`) — cached in SQLite,
  resolved lazily, each guid looked up once ever. Fountain boosts often carry
  `item_url`, giving a display fallback on PI misses.
- **Profiles** (kind-0) — cached, periodically refreshed off `purplepag.es`.
- **Verification** — `verify_raw_event` on everything before it's served (public
  host; never re-serve a forged event).

---

## Reuse ledger (from `~/localbitcoiners/bots/`)

**Lift verbatim:** `classify_boost`, `resolve_zap_amount`, `bolt11_amount_msats`,
`decode_note_or_nevent`, the zap-receipt path, `resolve_show` / `resolve_episode`
/ `clean_description`, `verify_raw_event`, `push_file_to_vps`, `query_relay`.

**New code:** paginated tag-scan engine (the `until` loop), SQLite layer, shard
exporter, outbox-expansion loop.

Shared utils get a **clean copy** into `onlyboosts/bots/shared/` (not a
cross-repo import) so both repos stay independently cloneable.

**Scope note:** LB's `classify_boost` drops show-level-only boosts (requires
`item_guid`) and excludes LB's own feed guid. For OnlyBoosts, make both a config
toggle (we likely want show-level boosts, and no feed exclusion).

---

## Runtime

Default = LB model: systemd timers on the box collect + push shards to the VPS;
CF Pages Function proxies. New bots start `DRY_RUN = True`; nothing signs,
publishes, or pays. This indexer is **read-only** (only outward action is the
VPS rsync push) — but a live publish/payment path elsewhere still stops for Reed.

---

## Build phases (proposed)

1. **Schema + scanner skeleton** — SQLite init, paginated tag-scan against the
   curated core, `classify_boost` port, dry-run counts. No shards, no push.
2. **Deep backfill run** — detached, resumable, to the 2025-01-01 floor; measure
   volume + coverage.
3. **Enrichment** — PI show/episode + profile resolution, cached.
4. **Shard exporter + VPS push** — the JSON the site eats.
5. **Outbox expansion** — discovery loop + weekly refresh.
6. **Incremental timer** — the recurring tail scan.
7. **Frontend** — the four views over the shards (separate track).
