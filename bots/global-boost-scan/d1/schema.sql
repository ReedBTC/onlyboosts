-- OnlyBoosts Tier 2 — Cloudflare D1 schema (lean, edge-queryable projection of
-- the box SQLite source of truth). No raw event blob (that lives in Tier 0 /
-- per-show shards); podcast & episode aggregates are precomputed so list views
-- are one indexed read. Rebuildable from the box DB anytime.
--
-- Apply:  wrangler d1 execute onlyboosts --remote --file=bots/global-boost-scan/d1/schema.sql
--   (local dev: same with --local)

CREATE TABLE IF NOT EXISTS boosts (
  event_id       TEXT PRIMARY KEY,
  booster_pubkey TEXT NOT NULL,          -- hex; the API also accepts npub on input and converts
  booster_npub   TEXT,                   -- stored for output (avoids hex->npub encode at the edge)
  created_at     INTEGER NOT NULL,
  sats           INTEGER,
  amount_source  TEXT,                   -- amount_tag | zap_receipt | content | t_tag | none
  podcast_guid   TEXT,
  item_guid      TEXT,
  item_url       TEXT,
  client         TEXT,
  message        TEXT
);
CREATE INDEX IF NOT EXISTS idx_boosts_created ON boosts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boosts_podcast ON boosts(podcast_guid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boosts_item    ON boosts(item_guid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boosts_booster ON boosts(booster_pubkey, created_at DESC);

CREATE TABLE IF NOT EXISTS podcasts (
  podcast_guid  TEXT PRIMARY KEY,
  title         TEXT,
  image         TEXT,
  feed_url      TEXT,
  medium        TEXT,
  author        TEXT,               -- <itunes:author>: 'Artist' on music, weak 'by' on podcasts; raw string
  boost_count   INTEGER,
  total_sats    INTEGER,
  booster_count INTEGER,
  episode_count INTEGER,
  latest_ts     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_podcasts_latest ON podcasts(latest_ts DESC);
CREATE INDEX IF NOT EXISTS idx_podcasts_sats   ON podcasts(total_sats DESC);
CREATE INDEX IF NOT EXISTS idx_podcasts_boosts ON podcasts(boost_count DESC);

CREATE TABLE IF NOT EXISTS episodes (
  item_guid      TEXT PRIMARY KEY,
  podcast_guid   TEXT,
  title          TEXT,
  image          TEXT,
  published      INTEGER,
  duration       INTEGER,
  episode_number INTEGER,
  enclosure_url  TEXT,
  description    TEXT,                    -- full shownotes (the one heavier column)
  boost_count    INTEGER,
  total_sats     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON episodes(podcast_guid);

CREATE TABLE IF NOT EXISTS profiles (
  pubkey       TEXT PRIMARY KEY,
  name         TEXT,
  display_name TEXT,
  picture      TEXT,
  nip05        TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Full-text search (SQLite FTS5, built into D1). Standalone tables that carry the
-- row id UNINDEXED alongside the searchable text: MATCH the text, get the id back,
-- join to the base table. Populated by the sync step.
CREATE VIRTUAL TABLE IF NOT EXISTS boosts_fts   USING fts5(event_id UNINDEXED, message);
CREATE VIRTUAL TABLE IF NOT EXISTS podcasts_fts USING fts5(podcast_guid UNINDEXED, title);
