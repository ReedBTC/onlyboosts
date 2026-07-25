# OnlyBoosts Tier 2 — D1 query layer + `/api/v1` (design of record)

Adds a fast, queryable serving layer alongside the static JSON shards, for the
things static files can't do cheaply: follows-filtered feeds, search, per-npub
lookups, and arbitrary `since`/`until` + filter queries. **Private to the site
first** — built so flipping it public later is additive, not a rewrite.

Decisions locked: **Cloudflare D1** (SQLite at the edge, native Pages binding,
our source of truth is already SQLite); **private/site-first** (serve
onlyboosts.social only; no public docs/rate-limits/open-CORS yet).

---

## Where it fits (division of labor)

Nothing is thrown away. Three tiers, one source of truth (the box `onlyboosts.db`,
rebuildable from Nostr). Read path never touches a relay.

| Need | Served by | Why |
|---|---|---|
| Global boost feed (latest + monthly pages), podcasts index, per-show detail (w/ shownotes), profiles map, meta | **Static shards (CDN)** | Cacheable, high-traffic, infinitely scalable, ~free |
| Follows-filtered feed, search, boosts-by-npub, arbitrary `since`/`until` + filters, per-episode slices | **D1 + `/api/v1`** | Dynamic queries, in-edge (single-digit ms), no giant client download |

The site uses static for the default global views and the API for the dynamic
ones. Same underlying data; the API is just a queryable projection.

---

## D1 schema (lean projection)

Mirrors the box SQLite but drops the heavy `raw_json` blob (raw events stay in
Tier 0 / per-show shards) and precomputes the podcast/episode aggregates so the
list views are a single indexed read.

```sql
CREATE TABLE boosts (
  event_id       TEXT PRIMARY KEY,
  booster_pubkey TEXT NOT NULL,          -- hex; API accepts npub and converts
  created_at     INTEGER NOT NULL,
  sats           INTEGER,
  amount_source  TEXT,                    -- amount_tag | zap_receipt | content | t_tag | none
  podcast_guid   TEXT,
  item_guid      TEXT,
  item_url       TEXT,
  client         TEXT,
  message        TEXT
);
CREATE INDEX idx_boosts_created  ON boosts(created_at DESC);
CREATE INDEX idx_boosts_podcast  ON boosts(podcast_guid, created_at DESC);
CREATE INDEX idx_boosts_item     ON boosts(item_guid, created_at DESC);
CREATE INDEX idx_boosts_booster  ON boosts(booster_pubkey, created_at DESC);

CREATE TABLE podcasts (            -- precomputed aggregates for list/detail
  podcast_guid TEXT PRIMARY KEY, title TEXT, image TEXT, feed_url TEXT, medium TEXT,
  boost_count INTEGER, total_sats INTEGER, booster_count INTEGER,
  episode_count INTEGER, latest_ts INTEGER
);
CREATE INDEX idx_podcasts_latest ON podcasts(latest_ts DESC);
CREATE INDEX idx_podcasts_sats   ON podcasts(total_sats DESC);

CREATE TABLE episodes (
  item_guid TEXT PRIMARY KEY, podcast_guid TEXT, title TEXT, image TEXT,
  published INTEGER, duration INTEGER, episode_number INTEGER,
  enclosure_url TEXT, description TEXT,   -- shownotes (the one heavier column; ~7k rows)
  boost_count INTEGER, total_sats INTEGER
);
CREATE INDEX idx_episodes_podcast ON episodes(podcast_guid);

CREATE TABLE profiles (
  pubkey TEXT PRIMARY KEY, name TEXT, display_name TEXT, picture TEXT, nip05 TEXT
);

-- Full-text search (SQLite FTS5, built into D1 — no extra service)
CREATE VIRTUAL TABLE boosts_fts USING fts5(
  message, content='boosts', content_rowid='rowid'
);
CREATE VIRTUAL TABLE podcasts_fts USING fts5(
  title, content='podcasts', content_rowid='rowid'
);
```

Size stays tiny (current ≈ a few MB; even 10M boosts ≈ a few GB, well under D1's
ceiling). Graduate search to Typesense/Meilisearch only if FTS5 is outgrown.

---

## Sync: collector → D1 (delta, systemd-safe)

D1 is a **derived, disposable** projection — rebuildable from the box SQLite
anytime. The collector's existing 15-min cycle gains a `sync-d1` step after
`export`:

- **Boosts:** `INSERT OR IGNORE` only the event_ids new since last sync (we
  already track this) — immutable, so no updates.
- **podcasts / episodes:** recompute aggregates for guids touched this cycle and
  upsert (small).
- **profiles:** upsert the ones resolved this cycle.
- Keep FTS in sync via triggers or explicit `INSERT INTO *_fts`.

**Transport (prod):** the box has no interactive `wrangler login`, so the
collector talks to the **D1 HTTP query API**
(`POST /accounts/{acct}/d1/database/{db}/query`) with a **scoped Cloudflare API
token** (D1 Edit only) stored in `credentials.env` alongside `ALBY_TOKEN` — same
file-based, systemd-safe pattern. Statements are chunked to respect the API's
per-request limits.

**Transport (dev):** `wrangler d1 execute onlyboosts --local --file=delta.sql`
writes to the local `.wrangler` SQLite; `wrangler pages dev` binds it so the
whole API runs offline with no CF auth.

A weekly (or on-demand) **full rebuild** from the box SQLite guarantees drift can
never accumulate.

---

## `/api/v1` endpoints (Pages Functions over the `DB` binding)

Records reuse the **shard record shape** (`id, ts, sats, src, msg, client,
booster{}, podcast{}, episode{}`) so consumers learn one model. Cursor-based
pagination (`cursor` = base64 of `created_at:event_id`), newest-first. npub or
hex accepted anywhere a pubkey is taken.

```
GET  /api/v1/boosts?podcast=&item=&booster=&since=&until=&cursor=&limit=
POST /api/v1/boosts/follows        body: { authors:[npub|hex,…], since?, cursor?, limit? }
GET  /api/v1/podcasts?sort=recent|sats|boosts&cursor=&limit=
GET  /api/v1/podcasts/{guid}       → podcast + its episodes (+ recent boosts)
GET  /api/v1/boosters/{npub}       → profile + that booster's boosts
GET  /api/v1/search?q=&type=boosts|podcasts&limit=
GET  /api/v1/stats                 → totals (mirrors meta.json)
```

- **Follows** is a POST (follow lists get large); server does
  `WHERE booster_pubkey IN (…)` against the indexed column — the thing that's
  painful client-side becomes a fast indexed query.
- Every GET sets `Cache-Control` (short TTL) so the CF edge still absorbs bursts.
- Bound every query (`limit` capped, e.g. 200) — no unbounded scans.

---

## "Private first, public-ready"

Private now = these Functions serve the site only: **exact-origin CORS**
(onlyboosts.social + localhost), same pattern as the existing `/api/*` proxies;
no public docs, no third-party keys. The site's own fetches are same-origin, so
this costs nothing.

Going public later is purely additive: open CORS to `*`, add rate limiting
(Workers rate-limit binding or a KV counter), publish the OpenAPI spec, and —
optionally, the Nostr-idiomatic touch — accept **NIP-98** signed-event auth for
higher-tier access. No endpoint or schema rewrite.

---

## What Reed does (Cloudflare, one-time)

1. `wrangler login` (or dashboard) → **create the D1 database**: `wrangler d1 create onlyboosts`.
2. In the Pages project → Settings → Functions → **D1 bindings**: bind
   `DB` → the `onlyboosts` database (for production). Add the same binding to a
   committed `wrangler.toml` for local dev / preview.
3. Create a **scoped API token** (D1 Edit) + note the account ID + database ID;
   put them in `~/.config/nostr-bots/credentials.env` (`CF_ACCOUNT_ID`,
   `CF_D1_DATABASE_ID`, `CF_API_TOKEN`) for the collector's `sync-d1` step.
4. Run the schema once: `wrangler d1 execute onlyboosts --remote --file=schema.sql`.

## What I build (locally, now — no CF auth needed)

- `schema.sql` (the DDL above) + a committed `wrangler.toml` with the local `DB` binding.
- `sync_d1.py` (collector step): delta SQL from the box SQLite → local D1 for dev,
  → D1 HTTP API for prod; wired into `run-incremental.sh` after `export`.
- `functions/api/v1/*.js`: the endpoints above over the `DB` binding.
- Full local validation via `wrangler pages dev` against a seeded local D1.

Then it's live the moment Reed finishes the 4 dashboard steps and the collector
gets the token.

---

## Build phases

1. schema.sql + wrangler.toml + seed a local D1 from the current shards/SQLite.
2. `/api/v1` Functions, validated locally against local D1.
3. `sync_d1.py` + wire into the incremental cycle (local first).
4. Point the site's dynamic views (follows, search, per-npub) at `/api/v1`;
   leave the global feed/aggregates on the static shards.
5. (Reed) provision remote D1 + binding + token → flip prod on.
6. (Later, optional) public: open CORS + rate limit + OpenAPI + NIP-98.
