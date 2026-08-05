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
import sys
import time
from pathlib import Path

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import excludes as excludes_mod

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
    raw_json        TEXT,          -- full signed event, for anything we didn't model
    excluded        INTEGER NOT NULL DEFAULT 0
                                   -- 1 = on the exclusion list; still indexed here,
                                   -- never published. Materialized from excluded_ids
                                   -- by apply_excludes(); see excludes.py.
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
    artwork       TEXT,          -- second-chance art URL (<itunes:image> when it
                                 -- differs from <image>); the site falls back to it
                                 -- when `image` 404s. NULL when there's no distinct
                                 -- alternate. See enrich._show_from_feed.
    feed_url      TEXT,
    feed_id       INTEGER,
    itunes_id     INTEGER,
    medium        TEXT,
    author        TEXT,          -- <itunes:author>: artist on music feeds, a weak
                                 -- "by" line on podcasts (may be a network/publisher,
                                 -- not a host). Raw string; the site hides it when it
                                 -- just repeats the title. NOT a podcast:person credit.
    discovered_via TEXT,         -- provenance: NULL/'boost' = someone boosted it;
                                 -- 'podroll' = resolved only because another feed
                                 -- recommends it, so it may have no boosts at all and
                                 -- then appears in no export or D1 row — it exists to
                                 -- give a podroll card its title and artwork. Written
                                 -- once at insert and never promoted, so it records how
                                 -- a show FIRST arrived; nothing counts off it (stats()
                                 -- asks the boosts table directly, which self-corrects).
    podroll_checked_at INTEGER,  -- last time we fetched this feed looking for a podroll
    podroll_status TEXT,         -- outcome of that fetch: ok | none | truncated | http-<n> | err-<Type>
    updated_at    INTEGER
);

-- <podcast:podroll> — the shows a show's own feed recommends. Feed-level only:
-- every remoteItem observed in the wild points at a feed (feedGuid/feedUrl), none
-- at an item, so there is no item column. Parsed from raw RSS by podroll.py;
-- Podcast Index does not carry this tag.
--
-- Rows are an ORDERED LIST replaced wholesale per source (delete-then-insert), so
-- `position` is a stable part of the key and a removed recommendation disappears
-- rather than lingering. `target_guid` is a real podcast:guid and joins straight to
-- shows.podcast_guid — but it is nullable (a few feeds give only a feedUrl), which
-- is the other reason the key is (source, position) rather than (source, target).
CREATE TABLE IF NOT EXISTS podroll (
    source_guid   TEXT NOT NULL,   -- the show whose feed carries the block
    position      INTEGER NOT NULL,-- order within the block = the publisher's own ranking
    target_guid   TEXT,            -- remoteItem feedGuid (the join key; ~99% present)
    target_url    TEXT,            -- remoteItem feedUrl
    target_title  TEXT,            -- remoteItem title attr, if any — publisher's hint only
    target_medium TEXT,            -- remoteItem medium attr, if any — publisher's hint only
    updated_at    INTEGER,
    PRIMARY KEY (source_guid, position)
);
CREATE INDEX IF NOT EXISTS idx_podroll_target ON podroll(target_guid);

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

-- The exclusion list, projected from the repo's excludes.json by apply_excludes().
-- Rebuilt wholesale on every run, so an entry deleted from the file disappears
-- here and its content comes back — nothing is ever removed from `boosts`.
-- `reason` is carried across only so the CLI can report it; nothing joins on it.
CREATE TABLE IF NOT EXISTS excluded_ids (
    kind    TEXT NOT NULL,   -- 'show' | 'show_feed' | 'episode' | 'booster' | 'boost'
    id      TEXT NOT NULL,
    reason  TEXT,
    added   TEXT,
    PRIMARY KEY (kind, id)
);

-- Rows D1 has to be told about out of band. The projection is upsert-only and
-- driven by NEW boosts, so a row that must DISAPPEAR (excluded) or be RECOUNTED
-- (its show/episode lost boosts to an exclusion) has no other way to reach it.
-- Drained by d1_sync --remote-delta; see cmd_remote_delta.
CREATE TABLE IF NOT EXISTS d1_reproject (
    kind  TEXT NOT NULL,     -- 'boost' (delete) | 'podcast' | 'episode' | 'profile' (re-derive or delete)
    id    TEXT NOT NULL,
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


# ── the exclusion list ────────────────────────────────────────────────────────
# Everything that reaches a reader is filtered on `boosts.excluded = 0`. Use this
# rather than writing the flag by hand, so the one predicate is greppable.
def not_excluded(alias="b"):
    return f"{alias + '.' if alias else ''}excluded = 0"


def _excluded_expr(alias="b"):
    """1 when this boost is on the list, by any of the ways of naming it.

    A guid is matched against EVERY identity slot, not the one its list is named
    after, and that is load-bearing rather than sloppy. Two reasons:

      • The as-signed `podcast_guid` and the resolved `canonical_guid` both have to
        answer, so a takedown naming the guid a client actually signed works after
        we've aliased it onto the real feed, and one naming the real feed works on
        boosts still carrying the phantom.
      • Clients demonstrably sign an ITEM guid in the `podcast:guid` tag — that's
        what guid_aliases exists to repair, and it doesn't always manage it.
        Measured on the live index, 52 of the 107 boosts to one episode name it in
        the show slot with no item_guid at all. Matching `episode` against
        `item_guid` alone would have left every one of them published.

    These ids are opaque and unique, so a listed id turning up in another slot only
    ever means the same content, and erring toward hiding is the right direction
    for a list whose entries are undertakings not to publish.
    """
    p = f"{alias}."
    eg = effective_guid(alias)
    return f"""(EXISTS (SELECT 1 FROM excluded_ids x WHERE
                   (x.kind='boost'   AND x.id = {p}event_id)
                OR (x.kind='booster' AND x.id = {p}booster_pubkey)
                OR (x.kind IN ('show','episode')
                    AND x.id IN ({p}podcast_guid, {eg}, {p}item_guid)))
           OR EXISTS (SELECT 1 FROM shows s
                      JOIN excluded_ids x ON x.kind='show_feed' AND x.id = s.feed_url
                      WHERE s.podcast_guid = {eg}))"""


def show_excluded(guid_col, feed_col=None):
    """Predicate for a SHOW row itself — the podroll graph is the one surface that
    renders a show we hold no boosts for, so filtering boosts doesn't reach it.

    Takes `episode` ids against the guid column too, for the phantom-guid reason
    in _excluded_expr: a listed 'episode' can be what a feed is keyed by here.
    """
    return ("EXISTS (SELECT 1 FROM excluded_ids x WHERE "
            f"(x.kind IN ('show','episode') AND x.id = {guid_col})"
            + (f" OR (x.kind='show_feed' AND x.id = {feed_col})" if feed_col else "")
            + ")")


def excluded_booster_ids(conn):
    return {r[0] for r in conn.execute(
        "SELECT id FROM excluded_ids WHERE kind='booster'").fetchall()}


def apply_excludes(conn, ex=None):
    """Project excludes.json onto `excluded_ids` + `boosts.excluded`.

    Runs on every connect. Returns the number of boost rows whose flag MOVED —
    normally 0, non-zero only on the run after the file was edited.

    Both directions are handled, because the list has to be reversible: an entry
    added hides content, an entry removed brings it back. The rows that moved are
    queued in `d1_reproject`, which is the only way a *deletion* can reach D1 (the
    projection is upsert-only and driven by new boosts). The JSON shards need no
    equivalent — they are rewritten whole on every export.
    """
    if ex is None:
        ex = excludes_mod.load()
    _rebuild_excluded_ids(conn, ex)

    expr = _excluded_expr("b")
    eg = effective_guid("b")
    moved = conn.execute(f"""
        SELECT * FROM (
            SELECT b.event_id, b.booster_pubkey, b.item_guid, {eg} AS pod_guid,
                   b.excluded AS was, CASE WHEN {expr} THEN 1 ELSE 0 END AS now
            FROM boosts b)
        WHERE was <> now""").fetchall()
    if not moved:
        return 0

    conn.executemany("UPDATE boosts SET excluded=? WHERE event_id=?",
                     [(r["now"], r["event_id"]) for r in moved])

    # Un-mark every moved row so the next delta re-derives it: an un-excluded boost
    # is re-inserted by the ordinary path, and an excluded one is filtered out of
    # _unsynced_boosts, so the marker would otherwise lie in both directions.
    if _has_table(conn, "d1_boosts_synced"):
        conn.executemany("DELETE FROM d1_boosts_synced WHERE event_id=?",
                         [(r["event_id"],) for r in moved])
    queue, unqueue = [], []
    for r in moved:
        (queue if r["now"] else unqueue).append(("boost", r["event_id"]))
        for kind, val in (("podcast", r["pod_guid"]), ("episode", r["item_guid"]),
                          ("profile", r["booster_pubkey"])):
            if val:
                queue.append((kind, val))
    conn.executemany("INSERT OR IGNORE INTO d1_reproject (kind,id) VALUES (?,?)", queue)
    # An exclude→un-exclude round trip between two pushes must not leave a pending
    # DELETE behind the re-insert.
    conn.executemany("DELETE FROM d1_reproject WHERE kind=? AND id=?", unqueue)
    conn.commit()
    return len(moved)


def _rebuild_excluded_ids(conn, ex):
    """Replace the table with the file's contents, touching nothing when they agree
    (the common case — this runs on every connect)."""
    want = {(e["kind"], e["id"]): (e["reason"], e["added"]) for e in ex.entries}
    have = {(r["kind"], r["id"]): (r["reason"], r["added"])
            for r in conn.execute("SELECT kind,id,reason,added FROM excluded_ids")}
    if want == have:
        return
    conn.execute("DELETE FROM excluded_ids")
    conn.executemany("INSERT INTO excluded_ids (kind,id,reason,added) VALUES (?,?,?,?)",
                     [(k, i, r, a) for (k, i), (r, a) in want.items()])
    conn.commit()


def _migrate(conn):
    """Additive migrations for DBs created before a column existed."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(boosts)")}
    if "canonical_guid" not in cols:
        conn.execute("ALTER TABLE boosts ADD COLUMN canonical_guid TEXT")
    if "excluded" not in cols:
        conn.execute("ALTER TABLE boosts ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_boosts_canonical ON boosts(canonical_guid)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_boosts_excluded  ON boosts(excluded)")
    show_cols = {r[1] for r in conn.execute("PRAGMA table_info(shows)")}
    if "author" not in show_cols:
        conn.execute("ALTER TABLE shows ADD COLUMN author TEXT")
    if "artwork" not in show_cols:
        conn.execute("ALTER TABLE shows ADD COLUMN artwork TEXT")
    for col, decl in (("discovered_via", "TEXT"), ("podroll_checked_at", "INTEGER"),
                      ("podroll_status", "TEXT")):
        if col not in show_cols:
            conn.execute(f"ALTER TABLE shows ADD COLUMN {col} {decl}")
    conn.commit()


def connect(db_path, check_same_thread=True, apply_exclusions=True):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=check_same_thread)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    _migrate(conn)
    # Deliberately on the CONNECTION, not in the pipeline scripts: every publish
    # path filters on `boosts.excluded`, so a command that opened the DB without
    # refreshing it would publish against a stale list. There is no path to the
    # data that skips this one. Idempotent and near-free when nothing changed.
    if apply_exclusions:
        apply_excludes(conn)
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
def upsert_show(conn, show, discovered_via="boost"):
    """Cache a resolved show. `discovered_via` is recorded on INSERT only — a
    re-resolve must not rewrite how the show first arrived."""
    conn.execute(
        """INSERT INTO shows (podcast_guid, title, image, artwork, feed_url, feed_id,
                              itunes_id, medium, author, discovered_via, updated_at)
           VALUES (:podcast_guid, :title, :image, :artwork, :feed_url, :feed_id,
                   :itunes_id, :medium, :author, :discovered_via, :updated_at)
           ON CONFLICT(podcast_guid) DO UPDATE SET
             title=excluded.title, image=excluded.image, artwork=excluded.artwork,
             feed_url=excluded.feed_url,
             feed_id=excluded.feed_id, itunes_id=excluded.itunes_id,
             medium=excluded.medium, author=excluded.author,
             updated_at=excluded.updated_at""",
        {**show, "discovered_via": discovered_via, "updated_at": int(time.time())})
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


# Each also skips excluded boosts: enrichment exists to make a row publishable, so
# fetching Podcast Index and kind-0s for content we've undertaken not to show is
# outbound traffic about exactly the show that asked us to stop.
def guids_needing_show(conn):
    eg = effective_guid("b")
    rows = conn.execute(
        f"""SELECT DISTINCT {eg} AS g FROM boosts b
           LEFT JOIN shows s ON s.podcast_guid = {eg}
           LEFT JOIN enrich_failed f ON f.kind='show' AND f.id = {eg}
           WHERE {eg} IS NOT NULL AND s.podcast_guid IS NULL AND {not_excluded('b')}
             AND (f.id IS NULL OR f.last_try < ?)""", (_cutoff(),)).fetchall()
    return [r[0] for r in rows]


def guids_needing_episode(conn):
    rows = conn.execute(
        f"""SELECT DISTINCT b.item_guid FROM boosts b
           LEFT JOIN episodes e ON e.item_guid = b.item_guid
           LEFT JOIN enrich_failed f ON f.kind='episode' AND f.id = b.item_guid
           WHERE b.item_guid IS NOT NULL AND e.item_guid IS NULL AND {not_excluded('b')}
             AND (f.id IS NULL OR f.last_try < ?)""", (_cutoff(),)).fetchall()
    return [r[0] for r in rows]


def pubkeys_needing_profile(conn):
    rows = conn.execute(
        f"""SELECT DISTINCT b.booster_pubkey FROM boosts b
           LEFT JOIN profiles p ON p.pubkey = b.booster_pubkey
           LEFT JOIN enrich_failed f ON f.kind='profile' AND f.id = b.booster_pubkey
           WHERE p.pubkey IS NULL AND {not_excluded('b')}
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


# ── podroll ───────────────────────────────────────────────────────────────────
#: A read we never completed (rate-limited, timed out, server error, cut short)
#: is not evidence about the feed, so it earns a shorter cooldown than a clean
#: answer. `http-404` is deliberately NOT in here: a feed that is gone is a real
#: answer, and retrying it daily forever is what an unloved crawler does.
PODROLL_TRANSIENT = ("http-429", "http-5", "err-", "truncated")


def shows_needing_podroll(conn, max_age, retry_age=None, only_boosted=True):
    """Feeds due a podroll fetch: never checked, or last checked too long ago.

    Two ages, because a failed read and a successful one mean different things —
    see PODROLL_TRANSIENT. `retry_age` defaults to a sixth of `max_age`.

    Ordered oldest-first so an interrupted pass resumes where it left off.
    `only_boosted` keeps the sweep to shows the site actually has a page for:
    podroll-discovered shows have feed URLs too, but crawling THEIR podrolls
    walks the graph outward one hop per run, and the second hop is a set of shows
    nothing on the site links to."""
    if retry_age is None:
        retry_age = max_age // 6
    now = int(time.time())
    transient = " OR ".join("s.podroll_status LIKE ?" for _ in PODROLL_TRANSIENT)
    scope = ""
    if only_boosted:
        eg = effective_guid("b")
        scope = (f" AND EXISTS (SELECT 1 FROM boosts b "
                 f"WHERE {eg} = s.podcast_guid AND {not_excluded('b')})")
    return conn.execute(
        f"""SELECT s.podcast_guid, s.feed_url FROM shows s
            WHERE s.feed_url IS NOT NULL
              AND NOT {show_excluded('s.podcast_guid', 's.feed_url')}
              AND (s.podroll_checked_at IS NULL
                   OR s.podroll_checked_at < ?
                   OR (({transient}) AND s.podroll_checked_at < ?)){scope}
            ORDER BY COALESCE(s.podroll_checked_at, 0), s.podcast_guid""",
        (now - max_age, *[p + "%" for p in PODROLL_TRANSIENT], now - retry_age)).fetchall()


def replace_podroll(conn, source_guid, items):
    """Swap in a show's whole podroll. The block is an ordered list the publisher
    rewrites as a unit, so this deletes every row for the source before inserting
    — a dropped recommendation has to actually disappear."""
    now = int(time.time())
    conn.execute("DELETE FROM podroll WHERE source_guid=?", (source_guid,))
    conn.executemany(
        """INSERT INTO podroll (source_guid, position, target_guid, target_url,
                                target_title, target_medium, updated_at)
           VALUES (?,?,?,?,?,?,?)""",
        [(source_guid, i, it.get("target_guid"), it.get("target_url"),
          it.get("target_title"), it.get("target_medium"), now)
         for i, it in enumerate(items)])


def mark_podroll_checked(conn, source_guid, status):
    conn.execute("UPDATE shows SET podroll_checked_at=?, podroll_status=? "
                 "WHERE podcast_guid=?", (int(time.time()), status, source_guid))


def podroll_targets_needing_show(conn):
    """Podroll target guids with no `shows` row yet — the cards that would render
    with no title or artwork. Excludes ones inside the enrich-failure cooldown."""
    rows = conn.execute(
        f"""SELECT DISTINCT p.target_guid FROM podroll p
           LEFT JOIN shows s ON s.podcast_guid = p.target_guid
           LEFT JOIN enrich_failed f ON f.kind='show' AND f.id = p.target_guid
           WHERE p.target_guid IS NOT NULL AND s.podcast_guid IS NULL
             AND NOT {show_excluded('p.target_guid', 'p.target_url')}
             AND (f.id IS NULL OR f.last_try < ?)""", (_cutoff(),)).fetchall()
    return [r[0] for r in rows]


#: The excluded-edge test, shared by podroll_rows and the podroll figures in
#: stats() so the graph and its counts can't disagree. Both endpoints are tested,
#: by guid and by feed URL; see the WHERE clause in podroll_rows for why it is a
#: NOT EXISTS rather than a NOT ... IN.
_PODROLL_EDGE_OK = """NOT EXISTS (
    SELECT 1 FROM excluded_ids x
     WHERE (x.kind IN ('show','episode') AND x.id IN (p.source_guid, p.target_guid))
        OR (x.kind='show_feed' AND x.id IN (src.feed_url, tgt.feed_url, p.target_url)))"""

_PODROLL_FILTERED = f"""(podroll p
    LEFT JOIN shows src ON src.podcast_guid = p.source_guid
    LEFT JOIN shows tgt ON tgt.podcast_guid = p.target_guid)
    WHERE {_PODROLL_EDGE_OK}"""


def podroll_rows(conn):
    """Every podroll edge with both endpoints' display metadata resolved.

    The one join both consumers read — the JSON exporter and the D1 projection —
    so the two can't drift into disagreeing about what a card says. `*_boosted`
    is whether that end has boosts, which is exactly whether it has a /show page.

    The boosted set is materialized ONCE in a CTE and left-joined. A correlated
    EXISTS per endpoint reads far more naturally and is a trap: the effective guid
    is a COALESCE, which no index can serve, so each one re-scans every boost.
    """
    return conn.execute(f"""
        WITH boosted AS (SELECT DISTINCT {effective_guid('')} AS g FROM boosts
                         WHERE podcast_guid IS NOT NULL AND {not_excluded('')})
        SELECT p.source_guid, p.position, p.target_guid, p.target_url,
               p.target_title, p.target_medium,
               src.title AS src_title, src.image AS src_img, src.artwork AS src_art2,
               src.medium AS src_medium, src.author AS src_author, src.feed_url AS src_feed,
               tgt.title AS tgt_title, tgt.image AS tgt_img, tgt.artwork AS tgt_art2,
               tgt.medium AS tgt_medium, tgt.author AS tgt_author, tgt.feed_url AS tgt_feed,
               (sb.g IS NOT NULL) AS src_boosted,
               (tb.g IS NOT NULL) AS tgt_boosted
        FROM podroll p
        LEFT JOIN shows   src ON src.podcast_guid = p.source_guid
        LEFT JOIN shows   tgt ON tgt.podcast_guid = p.target_guid
        LEFT JOIN boosted sb  ON sb.g = p.source_guid
        LEFT JOIN boosted tb  ON tb.g = p.target_guid
        -- Excluded at EITHER end drops the edge. This is the one surface that can
        -- render a show we hold no boosts for, so `boosts.excluded` never reaches
        -- it; an excluded feed must not survive as somebody else's podroll tile.
        -- Written as NOT EXISTS with the ids on the inside so a NULL target_guid
        -- (url-only edges) stays harmless — `NULL IN (…)` inside NOT (…) drops the
        -- row, inside EXISTS it just fails to match.
        WHERE {_PODROLL_EDGE_OK}
        ORDER BY p.source_guid, p.position""").fetchall()


def feed_id_for_guid(conn, podcast_guid):
    row = conn.execute("SELECT feed_id FROM shows WHERE podcast_guid=?",
                       (podcast_guid,)).fetchone()
    return row[0] if row else None


def show_feed_for_guid(conn, podcast_guid):
    """(feed_url, image) for a show — what the raw-RSS enrichment fallback needs
    when Podcast Index has no episode for a guid. None when the show is unknown."""
    return conn.execute("SELECT feed_url, image FROM shows WHERE podcast_guid=?",
                        (podcast_guid,)).fetchone()


# ── phantom-guid aliasing ─────────────────────────────────────────────────────
def raw_guids_needing_alias(conn):
    """Distinct as-signed podcast_guids that carry no alias yet. The resolver looks
    at each and decides whether it's a phantom that maps to a real guid."""
    rows = conn.execute(
        f"""SELECT DISTINCT b.podcast_guid FROM boosts b
           LEFT JOIN guid_aliases a ON a.raw_guid = b.podcast_guid
           WHERE b.podcast_guid IS NOT NULL AND a.raw_guid IS NULL
             AND {not_excluded('b')}""").fetchall()
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
    # Recorded unconditionally, BEFORE the no-op return: an alias applied on an
    # earlier run leaves the same emptied row behind, and that run had nothing
    # left to re-key by the time anyone noticed.
    conn.execute("CREATE TABLE IF NOT EXISTS d1_podcasts_orphaned (podcast_guid TEXT PRIMARY KEY)")
    conn.execute(
        f"""INSERT OR IGNORE INTO d1_podcasts_orphaned (podcast_guid)
            SELECT DISTINCT a.raw_guid FROM guid_aliases a
            WHERE a.raw_guid <> a.canonical_guid
              AND NOT EXISTS (SELECT 1 FROM boosts b
                              WHERE {effective_guid("b")} = a.raw_guid)""")
    conn.commit()

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


def enrichment_gap_size(conn):
    """How many boosted item_guids still have no `episodes` row.

    These are invisible everywhere downstream — the D1 projection inner-joins
    metadata, so they can't be ranked, searched, or linked. That silence is
    exactly why the population went unwatched for so long, so the sync prints
    this number rather than leaving it to be discovered."""
    return conn.execute(
        f"""SELECT COUNT(DISTINCT b.item_guid) FROM boosts b
           LEFT JOIN episodes e ON e.item_guid = b.item_guid
           WHERE b.item_guid IS NOT NULL AND e.item_guid IS NULL
             AND {not_excluded('b')}""").fetchone()[0]


def orphaned_podcast_guids(conn):
    """Guids whose D1 podcasts row should be deleted (emptied by re-keying)."""
    if not _has_table(conn, "d1_podcasts_orphaned"):
        return []
    return [r[0] for r in conn.execute(
        "SELECT podcast_guid FROM d1_podcasts_orphaned").fetchall()]


def clear_orphaned_podcast_guids(conn, guids):
    conn.executemany("DELETE FROM d1_podcasts_orphaned WHERE podcast_guid=?",
                     [(g,) for g in guids])
    conn.commit()


def reproject_queue(conn):
    """What D1 has to be told about that no new boost will tell it — see the
    d1_reproject table comment. {kind: [id, …]}."""
    if not _has_table(conn, "d1_reproject"):
        return {}
    out = {}
    for r in conn.execute("SELECT kind, id FROM d1_reproject").fetchall():
        out.setdefault(r["kind"], []).append(r["id"])
    return out


def clear_reproject_queue(conn, pairs):
    conn.executemany("DELETE FROM d1_reproject WHERE kind=? AND id=?", list(pairs))
    conn.commit()


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
    """Every figure here is published — meta.json, the manifest totals and the
    /about stat strip all read it — so every one of them is net of exclusions.
    `nx` is the flag test; the metadata-cache counts subtract excluded rows the
    same way, since "excluded from all feeds and stats" means the counts too."""
    def one(q):
        return conn.execute(q).fetchone()[0]
    nx = not_excluded("")
    return {
        "boosts":          one(f"SELECT COUNT(*) FROM boosts WHERE {nx}"),
        "distinct_shows":  one("SELECT COUNT(DISTINCT COALESCE(canonical_guid, podcast_guid)) "
                               f"FROM boosts WHERE podcast_guid IS NOT NULL AND {nx}"),
        "distinct_eps":    one("SELECT COUNT(DISTINCT item_guid) FROM boosts "
                               f"WHERE item_guid IS NOT NULL AND {nx}"),
        "distinct_boosters": one(f"SELECT COUNT(DISTINCT booster_pubkey) FROM boosts WHERE {nx}"),
        "total_sats":      one(f"SELECT COALESCE(SUM(sats),0) FROM boosts WHERE {nx}"),
        # Shows that have boosts AND metadata. Filtered rather than a bare
        # COUNT(*) because `shows` also caches podroll targets nobody has boosted;
        # those must not inflate a number the website prints. Reads the boosts
        # table directly so it self-corrects when a podroll target later gets one.
        # `IN (subquery)`, NOT a correlated EXISTS: the effective guid is a
        # COALESCE, so no index can serve it and EXISTS re-scans all 22k boosts
        # once per show — 6.2s versus 0.02s here, on a function the exporter calls.
        "shows_enriched":  one(f"SELECT COUNT(*) FROM shows WHERE podcast_guid IN "
                               f"(SELECT DISTINCT {effective_guid('')} FROM boosts "
                               f" WHERE podcast_guid IS NOT NULL AND {nx})"),
        "eps_enriched":    one("SELECT COUNT(*) FROM episodes e WHERE NOT EXISTS "
                               "(SELECT 1 FROM excluded_ids x "
                               " WHERE x.kind IN ('show','episode') "
                               "   AND x.id IN (e.item_guid, e.podcast_guid))"),
        "profiles":        one("SELECT COUNT(*) FROM profiles p WHERE NOT EXISTS "
                               "(SELECT 1 FROM excluded_ids x "
                               " WHERE x.kind='booster' AND x.id = p.pubkey)"),
        # Same edge filter as podroll_rows, minus its metadata join — these are
        # counts, and re-running that query's boosts CTE twice per export to get
        # two integers is the expensive way to agree with it.
        "podroll_edges":   one(f"SELECT COUNT(*) FROM {_PODROLL_FILTERED}"),
        "podroll_shows":   one(f"SELECT COUNT(DISTINCT p.source_guid) FROM {_PODROLL_FILTERED}"),
        "earliest":        one(f"SELECT MIN(created_at) FROM boosts WHERE {nx}"),
        "latest":          one(f"SELECT MAX(created_at) FROM boosts WHERE {nx}"),
    }
