#!/usr/bin/env python3
"""SQLite index for the OnlyBoosts global podcast-boost collector.

The collector-side source of truth. kind-1 boosts are immutable, so dedup is by
`event_id` (INSERT OR IGNORE). Shows / episodes / profiles are enrichment caches
keyed by their natural id and refreshed in place. `scan_state` holds each
relay's resumable backfill cursor so a killed deep scan continues where it left
off.

Nothing here touches the network — pure storage. The website never queries this
DB directly; a separate exporter renders static JSON shards from it.
"""

import json
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS boosts (
    event_id        TEXT PRIMARY KEY,
    booster_pubkey  TEXT NOT NULL,
    booster_npub    TEXT,
    created_at      INTEGER NOT NULL,
    sats            INTEGER,
    amount_source   TEXT,
    podcast_guid    TEXT,          -- as-signed by the note (may be a phantom: feed id / item guid / slug)
    canonical_guid  TEXT,          -- resolved real podcast guid when podcast_guid is a phantom; NULL = trust podcast_guid
    item_guid       TEXT,
    item_url        TEXT,
    show_url        TEXT,
    message         TEXT,
    client          TEXT,
    r_urls          TEXT,          -- JSON array
    raw_json        TEXT           -- full signed event, for anything we didn't model
);
CREATE INDEX IF NOT EXISTS idx_boosts_created  ON boosts(created_at);
CREATE INDEX IF NOT EXISTS idx_boosts_booster  ON boosts(booster_pubkey);
CREATE INDEX IF NOT EXISTS idx_boosts_podcast  ON boosts(podcast_guid);
CREATE INDEX IF NOT EXISTS idx_boosts_item     ON boosts(item_guid);

-- Phantom-guid canonicalization. A client sometimes puts a value that is NOT a
-- podcast:guid (a Podcast Index feed id, an item guid, or a freeform episode
-- slug) into the NIP-73 podcast:guid tag, fragmenting one real show into many
-- phantom rows. This maps a raw (as-signed) guid onto the real podcast guid.
-- The boost row keeps its as-signed podcast_guid; canonical_guid is materialized
-- from this table by the resolver, and everything downstream reads
-- COALESCE(canonical_guid, podcast_guid). See resolve_guids.py.
CREATE TABLE IF NOT EXISTS guid_aliases (
    raw_guid        TEXT PRIMARY KEY,   -- the phantom value as it appears in the tag
    canonical_guid  TEXT NOT NULL,      -- the real podcast:guid it belongs to
    method          TEXT,               -- how it was resolved (feedurl-local, pi-byfeedid, suffix-strip, curated, ...)
    resolved_at     INTEGER
);

CREATE TABLE IF NOT EXISTS shows (
    podcast_guid  TEXT PRIMARY KEY,
    title         TEXT,
    image         TEXT,
    feed_url      TEXT,
    feed_id       INTEGER,
    itunes_id     INTEGER,
    medium        TEXT,
    author        TEXT,          -- <itunes:author>: artist on music feeds, a weak
                                 -- "by" line on podcasts (may be a network/publisher,
                                 -- not a host). Raw string; the site hides it when it
                                 -- just repeats the title. NOT a podcast:person credit.
    updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS episodes (
    item_guid       TEXT PRIMARY KEY,
    title           TEXT,
    image           TEXT,
    published       INTEGER,       -- air date, unix seconds
    duration        INTEGER,
    episode_number  INTEGER,
    podcast_guid    TEXT,
    feed_id         INTEGER,
    enclosure_url   TEXT,
    enclosure_type  TEXT,
    description     TEXT,          -- full shownotes (plain text, NOT length-capped)
    updated_at      INTEGER
);

CREATE TABLE IF NOT EXISTS profiles (
    pubkey        TEXT PRIMARY KEY,
    name          TEXT,
    display_name  TEXT,
    picture       TEXT,
    nip05         TEXT,
    updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS scan_state (
    relay             TEXT PRIMARY KEY,
    backfill_cursor   INTEGER,     -- oldest `until` still to walk (None once complete)
    backfilled_to     INTEGER,     -- oldest created_at actually reached
    last_incremental  INTEGER      -- newest created_at seen on the incremental tail
);

CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT
);

-- Negative cache: guids/pubkeys we tried to enrich and couldn't (Podcast Index
-- has no record, or a URL/opaque guid it rejects; no kind-0 anywhere). Without
-- this, every incremental run re-queries every permanently-unresolvable id and
-- hammers Podcast Index. Retried only after a cooldown, in case data appears.
CREATE TABLE IF NOT EXISTS enrich_failed (
    kind      TEXT,          -- 'show' | 'episode' | 'profile'
    id        TEXT,
    last_try  INTEGER,
    PRIMARY KEY (kind, id)
);
"""

# Re-attempt a failed enrichment at most this often.
ENRICH_RETRY_COOLDOWN = 7 * 24 * 60 * 60

# The show a boost really belongs to: its resolved canonical guid if the as-signed
# podcast_guid was a phantom, else the as-signed value. Used everywhere boosts are
# grouped by show or joined to `shows`. `b` is the `boosts` table alias in the query.
def effective_guid(alias="b"):
    p = f"{alias}." if alias else ""
    return f"COALESCE({p}canonical_guid, {p}podcast_guid)"


def _migrate(conn):
    """Additive migrations for DBs created before a column existed."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(boosts)")}
    if "canonical_guid" not in cols:
        conn.execute("ALTER TABLE boosts ADD COLUMN canonical_guid TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_boosts_canonical ON boosts(canonical_guid)")
    show_cols = {r[1] for r in conn.execute("PRAGMA table_info(shows)")}
    if "author" not in show_cols:
        conn.execute("ALTER TABLE shows ADD COLUMN author TEXT")
    conn.commit()


def connect(db_path, check_same_thread=True):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=check_same_thread)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


# ── boosts ────────────────────────────────────────────────────────────────────
def upsert_boosts(conn, boosts):
    """Insert classified boost dicts, ignoring ones already stored (immutable).
    Returns the count of NEW rows."""
    before = conn.total_changes
    conn.executemany(
        """INSERT OR IGNORE INTO boosts
           (event_id, booster_pubkey, booster_npub, created_at, sats,
            amount_source, podcast_guid, item_guid, item_url, show_url,
            message, client, r_urls, raw_json)
           VALUES (:event_id, :booster_pubkey, :booster_npub, :created_at, :sats,
            :amount_source, :podcast_guid, :item_guid, :item_url, :show_url,
            :message, :client, :r_urls, :raw_json)""",
        [{
            "event_id":       b["event_id"],
            "booster_pubkey": b["booster_pubkey"],
            "booster_npub":   b.get("booster_npub"),
            "created_at":     b["created_at"],
            "sats":           b.get("sats"),
            "amount_source":  b.get("amount_source"),
            "podcast_guid":   b.get("podcast_guid"),
            "item_guid":      b.get("item_guid"),
            "item_url":       b.get("item_url"),
            "show_url":       b.get("show_url"),
            "message":        b.get("message"),
            "client":         b.get("client"),
            "r_urls":         json.dumps(b.get("r_urls") or []),
            "raw_json":       json.dumps(b["raw"]) if b.get("raw") is not None else None,
        } for b in boosts],
    )
    conn.commit()
    return conn.total_changes - before


# ── enrichment caches ─────────────────────────────────────────────────────────
def upsert_show(conn, show):
    conn.execute(
        """INSERT INTO shows (podcast_guid, title, image, feed_url, feed_id,
                              itunes_id, medium, author, updated_at)
           VALUES (:podcast_guid, :title, :image, :feed_url, :feed_id,
                   :itunes_id, :medium, :author, :updated_at)
           ON CONFLICT(podcast_guid) DO UPDATE SET
             title=excluded.title, image=excluded.image, feed_url=excluded.feed_url,
             feed_id=excluded.feed_id, itunes_id=excluded.itunes_id,
             medium=excluded.medium, author=excluded.author,
             updated_at=excluded.updated_at""",
        {**show, "updated_at": int(time.time())})
    conn.commit()


def upsert_episode(conn, ep):
    conn.execute(
        """INSERT INTO episodes (item_guid, title, image, published, duration,
                                 episode_number, podcast_guid, feed_id,
                                 enclosure_url, enclosure_type, description, updated_at)
           VALUES (:item_guid, :title, :image, :published, :duration,
                   :episode_number, :podcast_guid, :feed_id,
                   :enclosure_url, :enclosure_type, :description, :updated_at)
           ON CONFLICT(item_guid) DO UPDATE SET
             title=excluded.title, image=excluded.image, published=excluded.published,
             duration=excluded.duration, episode_number=excluded.episode_number,
             podcast_guid=excluded.podcast_guid, feed_id=excluded.feed_id,
             enclosure_url=excluded.enclosure_url, enclosure_type=excluded.enclosure_type,
             description=excluded.description, updated_at=excluded.updated_at""",
        {**ep, "updated_at": int(time.time())})
    conn.commit()


def upsert_profile(conn, pubkey, prof):
    conn.execute(
        """INSERT INTO profiles (pubkey, name, display_name, picture, nip05, updated_at)
           VALUES (:pubkey, :name, :display_name, :picture, :nip05, :updated_at)
           ON CONFLICT(pubkey) DO UPDATE SET
             name=excluded.name, display_name=excluded.display_name,
             picture=excluded.picture, nip05=excluded.nip05, updated_at=excluded.updated_at""",
        {"pubkey": pubkey, "name": prof.get("name"),
         "display_name": prof.get("display_name") or prof.get("displayName"),
         "picture": prof.get("picture"), "nip05": prof.get("nip05"),
         "updated_at": int(time.time())})
    conn.commit()


# ── work queues for the enrichment pass ───────────────────────────────────────
# Each excludes ids that failed enrichment within the cooldown (see enrich_failed).
def _cutoff():
    return int(time.time()) - ENRICH_RETRY_COOLDOWN


def guids_needing_show(conn):
    eg = effective_guid("b")
    rows = conn.execute(
        f"""SELECT DISTINCT {eg} AS g FROM boosts b
           LEFT JOIN shows s ON s.podcast_guid = {eg}
           LEFT JOIN enrich_failed f ON f.kind='show' AND f.id = {eg}
           WHERE {eg} IS NOT NULL AND s.podcast_guid IS NULL
             AND (f.id IS NULL OR f.last_try < ?)""", (_cutoff(),)).fetchall()
    return [r[0] for r in rows]


def guids_needing_episode(conn):
    rows = conn.execute(
        """SELECT DISTINCT b.item_guid FROM boosts b
           LEFT JOIN episodes e ON e.item_guid = b.item_guid
           LEFT JOIN enrich_failed f ON f.kind='episode' AND f.id = b.item_guid
           WHERE b.item_guid IS NOT NULL AND e.item_guid IS NULL
             AND (f.id IS NULL OR f.last_try < ?)""", (_cutoff(),)).fetchall()
    return [r[0] for r in rows]


def pubkeys_needing_profile(conn):
    rows = conn.execute(
        """SELECT DISTINCT b.booster_pubkey FROM boosts b
           LEFT JOIN profiles p ON p.pubkey = b.booster_pubkey
           LEFT JOIN enrich_failed f ON f.kind='profile' AND f.id = b.booster_pubkey
           WHERE p.pubkey IS NULL
             AND (f.id IS NULL OR f.last_try < ?)""", (_cutoff(),)).fetchall()
    return [r[0] for r in rows]


def mark_enrich_failed(conn, kind, ids):
    """Record that these ids failed enrichment now, so they aren't retried until
    the cooldown lapses. `ids` may be a single id or an iterable."""
    if isinstance(ids, str):
        ids = [ids]
    now = int(time.time())
    conn.executemany(
        """INSERT INTO enrich_failed (kind, id, last_try) VALUES (?, ?, ?)
           ON CONFLICT(kind, id) DO UPDATE SET last_try=excluded.last_try""",
        [(kind, i, now) for i in ids])
    conn.commit()


def feed_id_for_guid(conn, podcast_guid):
    row = conn.execute("SELECT feed_id FROM shows WHERE podcast_guid=?",
                       (podcast_guid,)).fetchone()
    return row[0] if row else None


# ── phantom-guid aliasing ─────────────────────────────────────────────────────
def raw_guids_needing_alias(conn):
    """Distinct as-signed podcast_guids that carry no alias yet. The resolver looks
    at each and decides whether it's a phantom that maps to a real guid."""
    rows = conn.execute(
        """SELECT DISTINCT b.podcast_guid FROM boosts b
           LEFT JOIN guid_aliases a ON a.raw_guid = b.podcast_guid
           WHERE b.podcast_guid IS NOT NULL AND a.raw_guid IS NULL""").fetchall()
    return [r[0] for r in rows]


def sample_tag_url(conn, raw_guid):
    """The url (3rd element) of the `podcast:guid` i-tag for one boost carrying this
    raw guid — often the real feed URL, which is enough to resolve the show."""
    import json
    row = conn.execute(
        "SELECT raw_json FROM boosts WHERE podcast_guid=? AND raw_json IS NOT NULL LIMIT 1",
        (raw_guid,)).fetchone()
    if not row:
        return None
    try:
        ev = json.loads(row[0])
    except Exception:
        return None
    for t in ev.get("tags", []):
        if len(t) >= 3 and t[0] == "i" and isinstance(t[1], str) \
                and t[1] == f"podcast:guid:{raw_guid}":
            return t[2] or None
    return None


def feed_url_to_guid(conn, feed_url):
    """The real podcast_guid of an already-known show with this feed URL, or None."""
    if not feed_url:
        return None
    row = conn.execute("SELECT podcast_guid FROM shows WHERE feed_url=?",
                       (feed_url,)).fetchone()
    return row[0] if row else None


def upsert_alias(conn, raw_guid, canonical_guid, method):
    conn.execute(
        """INSERT INTO guid_aliases (raw_guid, canonical_guid, method, resolved_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(raw_guid) DO UPDATE SET
             canonical_guid=excluded.canonical_guid, method=excluded.method,
             resolved_at=excluded.resolved_at""",
        (raw_guid, canonical_guid, method, int(time.time())))
    conn.commit()


def _has_table(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def apply_aliases(conn):
    """Materialize guid_aliases onto boosts.canonical_guid. Only rows whose value
    actually changes are touched; those are also un-marked in the D1 sync table (if
    present) so the next delta re-pushes them under the corrected guid. Returns the
    number of boost rows re-keyed."""
    to_change = [r[0] for r in conn.execute(
        """SELECT b.event_id FROM boosts b JOIN guid_aliases a ON a.raw_guid = b.podcast_guid
           WHERE b.canonical_guid IS NOT a.canonical_guid""").fetchall()]
    if not to_change:
        return 0
    conn.execute(
        """UPDATE boosts
           SET canonical_guid = (SELECT a.canonical_guid FROM guid_aliases a
                                 WHERE a.raw_guid = boosts.podcast_guid)
           WHERE event_id IN (
             SELECT b.event_id FROM boosts b JOIN guid_aliases a ON a.raw_guid = b.podcast_guid
             WHERE b.canonical_guid IS NOT a.canonical_guid)""")
    if _has_table(conn, "d1_boosts_synced"):
        conn.executemany("DELETE FROM d1_boosts_synced WHERE event_id=?",
                         [(i,) for i in to_change])
    conn.commit()
    return len(to_change)


# ── scan cursors ──────────────────────────────────────────────────────────────
def get_scan_state(conn, relay):
    row = conn.execute("SELECT * FROM scan_state WHERE relay=?", (relay,)).fetchone()
    return dict(row) if row else None


def set_backfill_cursor(conn, relay, cursor, backfilled_to):
    conn.execute(
        """INSERT INTO scan_state (relay, backfill_cursor, backfilled_to)
           VALUES (?, ?, ?)
           ON CONFLICT(relay) DO UPDATE SET
             backfill_cursor=excluded.backfill_cursor,
             backfilled_to=MIN(COALESCE(scan_state.backfilled_to, excluded.backfilled_to),
                               excluded.backfilled_to)""",
        (relay, cursor, backfilled_to))
    conn.commit()


def set_last_incremental(conn, relay, newest):
    conn.execute(
        """INSERT INTO scan_state (relay, last_incremental) VALUES (?, ?)
           ON CONFLICT(relay) DO UPDATE SET
             last_incremental=MAX(COALESCE(scan_state.last_incremental, 0), excluded.last_incremental)""",
        (relay, newest))
    conn.commit()


def get_meta(conn, key, default=None):
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def set_meta(conn, key, value):
    conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                 (key, str(value)))
    conn.commit()


# ── stats ─────────────────────────────────────────────────────────────────────
def stats(conn):
    def one(q):
        return conn.execute(q).fetchone()[0]
    return {
        "boosts":          one("SELECT COUNT(*) FROM boosts"),
        "distinct_shows":  one("SELECT COUNT(DISTINCT COALESCE(canonical_guid, podcast_guid)) "
                               "FROM boosts WHERE podcast_guid IS NOT NULL"),
        "distinct_eps":    one("SELECT COUNT(DISTINCT item_guid) FROM boosts WHERE item_guid IS NOT NULL"),
        "distinct_boosters": one("SELECT COUNT(DISTINCT booster_pubkey) FROM boosts"),
        "total_sats":      one("SELECT COALESCE(SUM(sats),0) FROM boosts"),
        "shows_enriched":  one("SELECT COUNT(*) FROM shows"),
        "eps_enriched":    one("SELECT COUNT(*) FROM episodes"),
        "profiles":        one("SELECT COUNT(*) FROM profiles"),
        "earliest":        one("SELECT MIN(created_at) FROM boosts"),
        "latest":          one("SELECT MAX(created_at) FROM boosts"),
    }
