#!/usr/bin/env python3
"""Sync the box SQLite (Tier 0 source of truth) into the Cloudflare D1 projection.

Two modes:
  --emit-sql <file>   Write a full-load SQL file (schema-compatible INSERTs +
                      precomputed aggregates + FTS rows). Use it to seed a LOCAL
                      D1 for dev, or to do the first REMOTE load:
                        wrangler d1 execute onlyboosts --local  --file=seed.sql
                        wrangler d1 execute onlyboosts --remote --file=seed.sql
  --remote            Push directly to the D1 HTTP query API using a scoped CF
                      token (systemd-safe; for the recurring collector step).
                      Delta by default (only event_ids new since last sync);
                      --full recomputes everything.

D1 is a derived, disposable projection — a full re-emit rebuilds it from scratch,
so drift can never accumulate. Between full loads the delta path keeps it honest
in two directions: new boosts (the `d1_boosts_synced` marker) and changed
metadata (the `meta_synced_at` watermark) — see build_meta_drift_sql.
"""

import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "shared"))
import db                                                        # noqa: E402
from nostr_utils import load_config                             # noqa: E402

DB_PATH = str(HERE / "data" / "onlyboosts.db")
CREDENTIALS = "/home/reed/.config/nostr-bots/credentials.env"


def q(v):
    """SQLite string literal (double single-quotes; NULL for None)."""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


# ── projection builders (return list of SQL statements) ───────────────────────
def _boost_rows(conn):
    # Project the CANONICAL guid as podcast_guid so D1 (and the show pages'
    # GROUP BY podcast_guid) see de-fragmented shows, not the as-signed phantoms.
    eg = db.effective_guid("")
    rows = conn.execute(
        f"""SELECT event_id, booster_pubkey, booster_npub, created_at, sats, amount_source,
                  {eg} AS podcast_guid, item_guid, item_url, client,
                  client_id, client_via, message
           FROM boosts WHERE {db.not_excluded('')}""").fetchall()
    for r in rows:
        yield r


def build_podroll_sql(conn):
    """Replace the whole podroll projection.

    Always a full replace, never a delta, and it is NOT part of the boost delta
    path: podroll changes when a publisher edits their feed, which is unrelated to
    any boost arriving. The collector's weekly podroll pass is what moves it, so
    that pass pushes it — a few hundred rows in one batch. Wholesale replacement
    is also what makes a *removed* recommendation actually disappear.
    """
    out = ["DELETE FROM podroll;"]
    for r in db.podroll_rows(conn):
        # Our resolved title wins over the remoteItem's own `title` attribute —
        # same rule as the JSON shards (the attribute is a hint in someone else's
        # feed and goes stale). Same for medium.
        t_title = r["tgt_title"] or r["target_title"]
        out.append(
            "INSERT INTO podroll (source_guid,position,target_guid,target_url,"
            "source_title,source_image,source_artwork,source_medium,source_author,source_linked,"
            "target_title,target_image,target_artwork,target_medium,target_author,target_linked"
            ") VALUES ("
            f"{q(r['source_guid'])},{q(r['position'])},{q(r['target_guid'])},"
            f"{q(r['tgt_feed'] or r['target_url'])},"
            f"{q(r['src_title'])},{q(r['src_img'])},{q(r['src_art2'])},{q(r['src_medium'])},"
            f"{q(r['src_author'])},{q(1 if (r['src_boosted'] and r['src_title']) else 0)},"
            f"{q(t_title)},{q(r['tgt_img'])},{q(r['tgt_art2'])},"
            f"{q(r['tgt_medium'] or r['target_medium'])},{q(r['tgt_author'])},"
            f"{q(1 if (r['tgt_boosted'] and t_title) else 0)});")
    return out


def build_publishers_sql(conn):
    """Replace the publisher projection (both tables) wholesale — the podroll
    rule: it moves when a publisher edits their feed, never when a boost
    arrives, so the collector's `publishers` pass is what pushes it. Album
    display fields are denormalized onto the edge for podroll's reason: a join
    to `podcasts` only answers for albums that have boosts, and most of a
    publisher's catalogue doesn't. Our resolved title/medium win over the
    remoteItem's own attributes — hints in someone else's feed go stale."""
    out = ["DELETE FROM publishers;", "DELETE FROM publisher_albums;"]
    for r in db.publisher_rows(conn):
        out.append(
            "INSERT INTO publishers (publisher_guid,feed_url,title,image,artwork,"
            "description,show_count) VALUES ("
            f"{q(r['publisher_guid'])},{q(r['feed_url'])},{q(r['title'])},"
            f"{q(r['image'])},{q(r['artwork'])},{q(r['description'])},{q(r['show_count'])});")
    for r in db.publisher_album_rows(conn):
        title = r["alb_title"] or r["album_title"]
        out.append(
            "INSERT INTO publisher_albums (publisher_guid,position,album_guid,album_url,"
            "album_title,album_image,album_artwork,album_medium,album_author,album_linked"
            ") VALUES ("
            f"{q(r['publisher_guid'])},{q(r['position'])},{q(r['album_guid'])},"
            f"{q(r['alb_feed'] or r['album_url'])},{q(title)},{q(r['alb_img'])},"
            f"{q(r['alb_art2'])},{q(r['alb_medium'] or r['album_medium'])},"
            f"{q(r['alb_author'])},{q(1 if (r['alb_boosted'] and title) else 0)});")
    return out


def build_full_sql(conn):
    """Full-load statements: wipe the projection tables and repopulate."""
    out = []
    out.append("PRAGMA foreign_keys=OFF;")
    for t in ("boosts", "podcasts", "episodes", "profiles", "meta",
              "boosts_fts", "podcasts_fts", "episodes_fts"):
        out.append(f"DELETE FROM {t};")

    # boosts + FTS
    for r in _boost_rows(conn):
        out.append(
            "INSERT INTO boosts (event_id,booster_pubkey,booster_npub,created_at,sats,"
            "amount_source,podcast_guid,item_guid,item_url,client,client_id,client_via,message) VALUES ("
            f"{q(r['event_id'])},{q(r['booster_pubkey'])},{q(r['booster_npub'])},{q(r['created_at'])},"
            f"{q(r['sats'])},{q(r['amount_source'])},{q(r['podcast_guid'])},"
            f"{q(r['item_guid'])},{q(r['item_url'])},{q(r['client'])},"
            f"{q(r['client_id'])},{q(r['client_via'])},{q(r['message'])});")
        if r["message"]:
            out.append("INSERT INTO boosts_fts (event_id,message) VALUES ("
                       f"{q(r['event_id'])},{q(r['message'])});")

    # podcasts (aggregates joined with show metadata)
    eg = db.effective_guid("b")
    for a in conn.execute(f"""
        SELECT {eg} AS guid,
               COUNT(*) AS boost_count, COALESCE(SUM(b.sats),0) AS total_sats,
               COUNT(DISTINCT b.booster_pubkey) AS booster_count,
               COUNT(DISTINCT b.item_guid) AS episode_count,
               MAX(b.created_at) AS latest_ts,
               s.title, s.image, s.artwork, s.feed_url, s.medium, s.author, s.language,
               s.publisher_guid
        FROM boosts b LEFT JOIN shows s ON s.podcast_guid={eg}
        WHERE {eg} IS NOT NULL AND {db.not_excluded('b')} GROUP BY {eg}""").fetchall():
        # `artwork` is the second-chance art URL (<itunes:image> when it differs
        # from <image>); the show page falls back to it when `image` 404s. The
        # remote D1 `podcasts.artwork` column shipped out-of-band (ALTER + backfill),
        # so it's projected here and in the --remote-delta path below.
        out.append(
            "INSERT INTO podcasts (podcast_guid,title,image,artwork,feed_url,medium,author,language,"
            "publisher_guid,boost_count,total_sats,booster_count,episode_count,latest_ts) VALUES ("
            f"{q(a['guid'])},{q(a['title'])},{q(a['image'])},{q(a['artwork'])},{q(a['feed_url'])},"
            f"{q(a['medium'])},{q(a['author'])},{q(a['language'])},{q(a['publisher_guid'])},"
            f"{q(a['boost_count'])},{q(a['total_sats'])},"
            f"{q(a['booster_count'])},{q(a['episode_count'])},{q(a['latest_ts'])});")
        if a["title"] or a["author"]:
            out.append("INSERT INTO podcasts_fts (podcast_guid,title,author) VALUES ("
                       f"{q(a['guid'])},{q(a['title'])},{q(a['author'])});")

    # episodes (metadata + per-episode aggregates). The aggregate subquery is an
    # INNER join, so filtering it is also what drops an excluded episode entirely:
    # with no surviving boost it produces no row to join to.
    for e in conn.execute(f"""
        SELECT e.item_guid, e.podcast_guid, e.title, e.image, e.published,
               e.duration, e.episode_number, e.enclosure_url, e.description,
               s.title AS show_title,
               agg.boost_count, agg.total_sats, agg.booster_count, agg.latest_ts
        FROM episodes e
        JOIN (SELECT item_guid, COUNT(*) boost_count, COALESCE(SUM(sats),0) total_sats,
                     COUNT(DISTINCT booster_pubkey) booster_count, MAX(created_at) latest_ts
              FROM boosts WHERE item_guid IS NOT NULL AND {db.not_excluded('')}
              GROUP BY item_guid) agg
          ON agg.item_guid = e.item_guid
        LEFT JOIN shows s ON s.podcast_guid = e.podcast_guid""").fetchall():
        out.append(
            "INSERT INTO episodes (item_guid,podcast_guid,title,image,published,"
            "duration,episode_number,enclosure_url,description,boost_count,total_sats,"
            "booster_count,latest_ts) VALUES ("
            f"{q(e['item_guid'])},{q(e['podcast_guid'])},{q(e['title'])},{q(e['image'])},"
            f"{q(e['published'])},{q(e['duration'])},{q(e['episode_number'])},"
            f"{q(e['enclosure_url'])},{q(e['description'])},{q(e['boost_count'])},{q(e['total_sats'])},"
            f"{q(e['booster_count'])},{q(e['latest_ts'])});")
        if e["title"] or e["show_title"]:
            out.append("INSERT INTO episodes_fts (item_guid,title,show) VALUES ("
                       f"{q(e['item_guid'])},{q(e['title'])},{q(e['show_title'])});")

    # profiles (excluded boosters lose their identity row here as in the shards)
    for p in conn.execute(
        f"SELECT {PROFILE_COLS} FROM profiles p "
        "WHERE NOT EXISTS (SELECT 1 FROM excluded_ids x "
        "                  WHERE x.kind='booster' AND x.id = p.pubkey)").fetchall():
        out.extend(_profile_upsert_sql(p, verb="INSERT"))

    out.extend(build_podroll_sql(conn))
    out.extend(build_publishers_sql(conn))

    s = db.stats(conn)
    for k, v in {"generated_at": int(time.time()), "boosts": s["boosts"],
                 "total_sats": s["total_sats"], "distinct_shows": s["distinct_shows"],
                 "distinct_boosters": s["distinct_boosters"]}.items():
        out.append(f"INSERT INTO meta (key,value) VALUES ({q(k)},{q(v)});")
    return out


# The projected `profiles` column list, in one place. It was restated at five
# sites and a partial edit is a silent NULL rather than an error — the column is
# simply never written and the page renders a blank line. Every path that reads
# or writes a profile row goes through these two names.
PROFILE_COL_LIST = ("pubkey", "name", "display_name", "picture", "nip05",
                    "about", "lud16", "lud06", "website", "banner")
PROFILE_COLS = ",".join(PROFILE_COL_LIST)

# ⚠️ Adding a name here also needs an out-of-band ALTER TABLE on the remote D1
# BEFORE the change ships: `d1/schema.sql` is CREATE TABLE IF NOT EXISTS, so it
# will not add a column to a table that already exists, and a projection naming
# an absent column fails the whole batch — which returns before `_mark_synced`,
# so boosts stop reaching D1 entirely until it is fixed.

# ── single-row upserts (shared by the delta and metadata-drift paths) ─────────
def _podcast_upsert_sql(conn, guid):
    """Re-project one podcasts row (aggregates recomputed from ALL its boosts).

    Returns [] when the show has no publishable boost left — every caller reads
    that as "delete it", which is how an excluded show's D1 row goes away.
    """
    eg = db.effective_guid("b")
    a = conn.execute(
        f"""SELECT {eg} AS guid, COUNT(*) AS boost_count,
                  COALESCE(SUM(b.sats),0) AS total_sats,
                  COUNT(DISTINCT b.booster_pubkey) AS booster_count,
                  COUNT(DISTINCT b.item_guid) AS episode_count,
                  MAX(b.created_at) AS latest_ts,
                  s.title, s.image, s.artwork, s.feed_url, s.medium, s.author, s.language,
                  s.publisher_guid
           FROM boosts b LEFT JOIN shows s ON s.podcast_guid={eg}
           WHERE {eg}=? AND {db.not_excluded('b')} GROUP BY {eg}""", (guid,)).fetchone()
    if not a:
        return []
    # `artwork` (second-chance art URL) is projected here and in the full load;
    # the remote D1 column exists.
    out = ["INSERT OR REPLACE INTO podcasts (podcast_guid,title,image,artwork,feed_url,medium,author,language,"
           "publisher_guid,boost_count,total_sats,booster_count,episode_count,latest_ts) VALUES ("
           f"{q(a['guid'])},{q(a['title'])},{q(a['image'])},{q(a['artwork'])},{q(a['feed_url'])},"
           f"{q(a['medium'])},{q(a['author'])},{q(a['language'])},{q(a['publisher_guid'])},"
           f"{q(a['boost_count'])},{q(a['total_sats'])},"
           f"{q(a['booster_count'])},{q(a['episode_count'])},{q(a['latest_ts'])});",
           f"DELETE FROM podcasts_fts WHERE podcast_guid={q(guid)};"]
    if a["title"] or a["author"]:
        out.append("INSERT INTO podcasts_fts (podcast_guid,title,author) VALUES ("
                   f"{q(guid)},{q(a['title'])},{q(a['author'])});")
    return out


def _episode_upsert_sql(conn, item_guid):
    """Re-project one episodes row, or nothing if the box has no metadata for it
    yet (a boosted item_guid with no `episodes` row is the enrichment gap, not
    something to project as an untitled placeholder).

    Also nothing when every boost on it is excluded. That case can't arise on the
    delta path — the row is there because a new boost landed on it — but it is the
    whole point on the reprojection path, where [] means "delete it".
    """
    nx = db.not_excluded("")
    e = conn.execute(
        f"""SELECT e.item_guid,e.podcast_guid,e.title,e.image,e.published,e.duration,
                  e.episode_number,e.enclosure_url,e.description, s.title AS show_title,
                  (SELECT COUNT(*) FROM boosts WHERE item_guid=e.item_guid AND {nx}) AS boost_count,
                  (SELECT COALESCE(SUM(sats),0) FROM boosts WHERE item_guid=e.item_guid AND {nx}) AS total_sats,
                  (SELECT COUNT(DISTINCT booster_pubkey) FROM boosts WHERE item_guid=e.item_guid AND {nx}) AS booster_count,
                  (SELECT MAX(created_at) FROM boosts WHERE item_guid=e.item_guid AND {nx}) AS latest_ts
           FROM episodes e
           LEFT JOIN shows s ON s.podcast_guid = e.podcast_guid
           WHERE e.item_guid=?""", (item_guid,)).fetchone()
    if not e or not e["boost_count"]:
        return []
    out = ["INSERT OR REPLACE INTO episodes (item_guid,podcast_guid,title,image,published,"
           "duration,episode_number,enclosure_url,description,boost_count,total_sats,"
           "booster_count,latest_ts) VALUES ("
           f"{q(e['item_guid'])},{q(e['podcast_guid'])},{q(e['title'])},{q(e['image'])},"
           f"{q(e['published'])},{q(e['duration'])},{q(e['episode_number'])},"
           f"{q(e['enclosure_url'])},{q(e['description'])},{q(e['boost_count'])},{q(e['total_sats'])},"
           f"{q(e['booster_count'])},{q(e['latest_ts'])});",
           f"DELETE FROM episodes_fts WHERE item_guid={q(e['item_guid'])};"]
    if e["title"] or e["show_title"]:
        out.append("INSERT INTO episodes_fts (item_guid,title,show) VALUES ("
                   f"{q(e['item_guid'])},{q(e['title'])},{q(e['show_title'])});")
    return out


def _profile_upsert_sql(p, verb="INSERT OR REPLACE"):
    return [f"{verb} INTO profiles ({PROFILE_COLS}) VALUES ("
            + ",".join(q(p[c]) for c in PROFILE_COL_LIST) + ");"]


# ── delta projection (only what changed since last sync) ──────────────────────
def build_delta_sql(conn, rows):
    """SQL for `rows` (boosts not yet in D1): the new boosts (OR IGNORE, immutable)
    + FTS, plus a recomputed upsert of every podcast/episode they touched (an
    aggregate depends on ALL its boosts, so it's recomputed from the box DB) +
    the boosters' profiles + refreshed meta.

    Returns (statements, podcast_guids, item_guids, skipped) — the caller feeds
    those guid sets to build_meta_drift_sql so a row isn't projected twice in one
    push. `skipped` counts episodes a NEW boost landed on that we still can't
    name; it is reported rather than swallowed (see db.enrichment_gap_size)."""
    out = []
    pods, items, pubs = set(), set(), set()
    for r in rows:
        out.append(
            "INSERT OR IGNORE INTO boosts (event_id,booster_pubkey,booster_npub,created_at,sats,"
            "amount_source,podcast_guid,item_guid,item_url,client,client_id,client_via,message) VALUES ("
            f"{q(r['event_id'])},{q(r['booster_pubkey'])},{q(r['booster_npub'])},{q(r['created_at'])},"
            f"{q(r['sats'])},{q(r['amount_source'])},{q(r['podcast_guid'])},"
            f"{q(r['item_guid'])},{q(r['item_url'])},{q(r['client'])},"
            f"{q(r['client_id'])},{q(r['client_via'])},{q(r['message'])});")
        if r["message"]:
            out.append("INSERT INTO boosts_fts (event_id,message) VALUES ("
                       f"{q(r['event_id'])},{q(r['message'])});")
        if r["podcast_guid"]:
            pods.add(r["podcast_guid"])
        if r["item_guid"]:
            items.add(r["item_guid"])
        pubs.add(r["booster_pubkey"])

    for pg in pods:
        out.extend(_podcast_upsert_sql(conn, pg))
    skipped = 0
    for ig in items:
        stmts = _episode_upsert_sql(conn, ig)
        out.extend(stmts)
        skipped += not stmts

    if pubs:
        ph = ",".join("?" * len(pubs))
        for p in conn.execute(
            f"SELECT {PROFILE_COLS} FROM profiles WHERE pubkey IN ({ph})",
                tuple(pubs)).fetchall():
            out.extend(_profile_upsert_sql(p))

    out.extend(_meta_sql(conn))
    return out, pods, items, skipped


def build_reproject_sql(conn, queue):
    """SQL for the `d1_reproject` queue — rows the boost delta can't reach.

    The projection is upsert-only and driven by boosts arriving. An exclusion does
    the opposite: a boost has to DISAPPEAR from D1, and the show, episode and
    profile behind it have to be recounted or dropped. `apply_excludes` records
    what moved (in BOTH directions, so un-listing something restores it) and this
    drains it.

    The re-derivation is not a delete: each row is recomputed from the box DB and
    upserted, and only *turns into* a delete when the recompute comes back empty —
    so a show that lost one of fifty episodes keeps its page with corrected totals,
    and a show that lost everything loses its page.

    Returns (statements, pairs) — `pairs` is what to clear once the push succeeds.
    """
    out, pairs = [], []
    for event_id in queue.get("boost", []):
        out.append(f"DELETE FROM boosts WHERE event_id={q(event_id)};")
        out.append(f"DELETE FROM boosts_fts WHERE event_id={q(event_id)};")
        pairs.append(("boost", event_id))
    for guid in queue.get("podcast", []):
        stmts = _podcast_upsert_sql(conn, guid)
        out.extend(stmts or [f"DELETE FROM podcasts WHERE podcast_guid={q(guid)};",
                             f"DELETE FROM podcasts_fts WHERE podcast_guid={q(guid)};"])
        pairs.append(("podcast", guid))
    for item in queue.get("episode", []):
        stmts = _episode_upsert_sql(conn, item)
        out.extend(stmts or [f"DELETE FROM episodes WHERE item_guid={q(item)};",
                             f"DELETE FROM episodes_fts WHERE item_guid={q(item)};"])
        pairs.append(("episode", item))
    for pubkey in queue.get("profile", []):
        p = conn.execute(
            f"""SELECT {PROFILE_COLS} FROM profiles p
               WHERE p.pubkey=? AND NOT EXISTS (SELECT 1 FROM excluded_ids x
                                                WHERE x.kind='booster' AND x.id=p.pubkey)""",
            (pubkey,)).fetchone()
        out.extend(_profile_upsert_sql(p) if p
                   else [f"DELETE FROM profiles WHERE pubkey={q(pubkey)};"])
        pairs.append(("profile", pubkey))
    return out, pairs


def _meta_sql(conn):
    s = db.stats(conn)
    return [f"INSERT OR REPLACE INTO meta (key,value) VALUES ({q(k)},{q(v)});"
            for k, v in {"generated_at": int(time.time()), "boosts": s["boosts"],
                         "total_sats": s["total_sats"], "distinct_shows": s["distinct_shows"],
                         "distinct_boosters": s["distinct_boosters"]}.items()]


# ── metadata drift (box metadata that changed after it was last projected) ────
META_WATERMARK = "meta_synced_at"
META_OVERLAP = 3600   # re-read an hour behind the watermark; upserts are idempotent


def build_meta_drift_sql(conn, since, skip_pods=(), skip_items=()):
    """Re-project rows whose BOX metadata changed since `since` (unix seconds).

    The boost delta only touches a podcast/episode/profile when a NEW boost
    arrives for it. Metadata, though, moves on its own schedule: an episode
    boosted months ago gets enriched by a later Podcast Index pass, a feed
    re-scrape changes a show's art, a booster updates their kind-0. Without this
    pass D1 keeps the stale — or entirely missing — projection until the next
    boost happens to touch that row, which for a dormant show is never.

    Watermarked on the box's own `updated_at` columns, re-read with an hour of
    overlap: a duplicate upsert is free, a missed row is invisible.

    Returns (statements, counts)."""
    out = []
    since = max(0, since - META_OVERLAP)
    counts = {"podcasts": 0, "episodes": 0, "profiles": 0}

    # Only shows that a podcasts row is actually keyed by: the projection joins
    # `shows` on the CANONICAL guid, so an alias's own show row feeds nothing.
    eg = db.effective_guid("b")
    for r in conn.execute(
        f"""SELECT s.podcast_guid FROM shows s
            WHERE s.updated_at IS NOT NULL AND s.updated_at >= ?
              AND EXISTS (SELECT 1 FROM boosts b
                          WHERE {eg}=s.podcast_guid AND {db.not_excluded('b')})""",
            (since,)).fetchall():
        if r["podcast_guid"] in skip_pods:
            continue
        stmts = _podcast_upsert_sql(conn, r["podcast_guid"])
        out.extend(stmts)
        counts["podcasts"] += bool(stmts)

    for r in conn.execute(
        f"""SELECT e.item_guid FROM episodes e
           WHERE e.updated_at IS NOT NULL AND e.updated_at >= ?
             AND EXISTS (SELECT 1 FROM boosts b
                         WHERE b.item_guid=e.item_guid AND {db.not_excluded('b')})""",
            (since,)).fetchall():
        if r["item_guid"] in skip_items:
            continue
        # No skip counter here: this loop selects FROM `episodes`, so the row is
        # there by construction. The skip that matters is in the delta path — a
        # brand-new boost landing on an episode we still can't name.
        stmts = _episode_upsert_sql(conn, r["item_guid"])
        out.extend(stmts)
        counts["episodes"] += bool(stmts)

    for p in conn.execute(
        f"""SELECT {PROFILE_COLS} FROM profiles p
           WHERE updated_at IS NOT NULL AND updated_at >= ?
             AND NOT EXISTS (SELECT 1 FROM excluded_ids x
                             WHERE x.kind='booster' AND x.id = p.pubkey)""",
            (since,)).fetchall():
        out.extend(_profile_upsert_sql(p))
        counts["profiles"] += 1

    return out, counts


# ── which boosts are already in D1 (marker table in the box DB) ───────────────
def _ensure_sync_table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS d1_boosts_synced (event_id TEXT PRIMARY KEY)")
    conn.commit()


def _unsynced_boosts(conn):
    eg = db.effective_guid("b")
    return conn.execute(
        f"""SELECT b.event_id,b.booster_pubkey,b.booster_npub,b.created_at,b.sats,
                  b.amount_source,{eg} AS podcast_guid,b.item_guid,b.item_url,b.client,
                  b.client_id,b.client_via,b.message
           FROM boosts b LEFT JOIN d1_boosts_synced d ON d.event_id=b.event_id
           WHERE d.event_id IS NULL AND {db.not_excluded('b')}""").fetchall()


def _mark_synced(conn, ids):
    conn.executemany("INSERT OR IGNORE INTO d1_boosts_synced (event_id) VALUES (?)",
                     [(i,) for i in ids])
    conn.commit()


def _ensure_state_table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS d1_sync_state (key TEXT PRIMARY KEY, value INTEGER)")
    conn.commit()


def _get_watermark(conn, key):
    """0 when unset — a fresh box re-projects all metadata once, which is correct."""
    _ensure_state_table(conn)
    r = conn.execute("SELECT value FROM d1_sync_state WHERE key=?", (key,)).fetchone()
    return r[0] if r else 0


def _set_watermark(conn, key, ts):
    _ensure_state_table(conn)
    conn.execute("INSERT OR REPLACE INTO d1_sync_state (key,value) VALUES (?,?)", (key, ts))
    conn.commit()


def cmd_emit_sql(args):
    conn = db.connect(DB_PATH)
    stmts = build_full_sql(conn)
    Path(args.emit_sql).write_text("\n".join(stmts) + "\n")
    print(f"wrote {len(stmts)} statements → {args.emit_sql}")


def _cf(cfg):
    """(url, headers) for the D1 HTTP query API, or None if creds are missing.
    The token lives only in the header — never logged."""
    acct, dbid, token = (cfg.get("CF_ACCOUNT_ID"), cfg.get("CF_D1_DATABASE_ID"),
                         cfg.get("CF_API_TOKEN"))
    if not all([acct, dbid, token]):
        return None
    return (f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{dbid}/query",
            {"Authorization": f"Bearer {token}", "Content-Type": "application/json"})


def _d1_exec(url, hdr, sql):
    """POST one SQL chunk to D1. Returns (ok, detail). Errors surface CF's own
    message (no secrets) — the URL/token are never included."""
    import json
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, data=json.dumps({"sql": sql}).encode(),
                                 headers=hdr, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            return bool(data.get("success")), data.get("errors") or data.get("messages")
    except urllib.error.HTTPError as e:
        try:
            return False, json.loads(e.read()).get("errors")
        except Exception:
            return False, f"HTTP {e.code}"
    except Exception as e:
        return False, type(e).__name__


def cmd_apply_schema(args):
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    schema = (HERE / "d1" / "schema.sql").read_text()
    ok, detail = _d1_exec(*cf, schema)
    print("schema applied to remote D1" if ok else f"[error] schema apply failed: {detail}")


def cmd_remote(args):
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    started = int(time.time())
    stmts = build_full_sql(conn)
    BATCH = 100
    sent = 0
    for i in range(0, len(stmts), BATCH):
        ok, detail = _d1_exec(*cf, "\n".join(stmts[i:i + BATCH]))
        if not ok:
            print(f"[error] batch {i // BATCH} failed: {detail}")
            return
        sent += len(stmts[i:i + BATCH])
        if (i // BATCH) % 50 == 0:
            print(f"  …{sent}/{len(stmts)} statements", flush=True)
    _ensure_sync_table(conn)
    # Excluded boosts are marked synced too: they are absent from the load, and the
    # marker is what keeps the next delta from re-adding them. apply_excludes
    # un-marks any that come off the list.
    _mark_synced(conn, [r["event_id"] for r in conn.execute("SELECT event_id FROM boosts").fetchall()])
    # Everything is projected as of `started`, so the drift pass starts from here.
    _set_watermark(conn, META_WATERMARK, started)
    # A full load already reflects the exclusion list; a queued re-derivation of it
    # would be a no-op at best and a stale delete at worst.
    db.clear_reproject_queue(conn, [(k, i) for k, ids in db.reproject_queue(conn).items()
                                    for i in ids])
    print(f"pushed {sent} statements to D1 (remote, full load); marked all boosts synced")


def cmd_remote_delta(args):
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    _ensure_sync_table(conn)
    started = int(time.time())
    rows = _unsynced_boosts(conn)

    # Exclusions FIRST, so a delete never lands after the re-insert that undoes it
    # on an exclude→un-exclude round trip inside one cycle. Its recomputed
    # podcast/episode rows are superseded by the delta's own recompute below, which
    # reads the same box DB — duplicating an upsert is free, dropping one isn't.
    reproj, reproj_pairs = build_reproject_sql(conn, db.reproject_queue(conn))
    stmts, pods, items, skipped = (list(reproj), set(), set(), 0)
    if rows:
        delta, pods, items, skipped = build_delta_sql(conn, rows)
        stmts += delta
    # Shows emptied by guid re-keying: the projection is upsert-only, so a phantom
    # that lost all its boosts has to be deleted explicitly or its page lives on
    # in D1 double-counting them against the real show.
    orphans = [g for g in db.orphaned_podcast_guids(conn) if g not in pods]
    for g in orphans:
        stmts.append(f"DELETE FROM podcasts WHERE podcast_guid={q(g)};")
        stmts.append(f"DELETE FROM podcasts_fts WHERE podcast_guid={q(g)};")
    # Metadata moves independently of boosts — always run the drift pass, even
    # on a cycle where no new boost arrived.
    drift, counts = build_meta_drift_sql(conn, _get_watermark(conn, META_WATERMARK), pods, items)
    stmts += drift
    # An exclusion changes the published totals with no new boost behind it, and
    # `_meta_sql` otherwise only rides along with the delta path.
    if reproj and not rows:
        stmts += _meta_sql(conn)
    if not stmts:
        print("D1 delta: nothing new to sync")
        _set_watermark(conn, META_WATERMARK, started)
        return

    BATCH = 100
    for i in range(0, len(stmts), BATCH):
        ok, detail = _d1_exec(*cf, "\n".join(stmts[i:i + BATCH]))
        if not ok:
            print(f"[error] delta batch {i // BATCH} failed: {detail}")
            return   # neither watermark advances: the whole push retries next cycle
    _mark_synced(conn, [r["event_id"] for r in rows])
    _set_watermark(conn, META_WATERMARK, started)
    db.mark_orphaned_podcasts_deleted(conn, orphans)
    db.clear_reproject_queue(conn, reproj_pairs)
    print(f"D1 delta: pushed {len(rows)} new boost(s), refreshed "
          f"{counts['podcasts']} show(s) / {counts['episodes']} episode(s) / "
          f"{counts['profiles']} profile(s) whose metadata changed"
          + (f", deleted {len(orphans)} emptied show(s)" if orphans else "")
          + (f", re-derived {len(reproj_pairs)} row(s) for the exclusion list"
             if reproj_pairs else "")
          + f" ({len(stmts)} statements)")
    # Never let the un-projectable population be silent: a boosted episode with
    # no metadata row is skipped on purpose, but "on purpose" and "unnoticed" are
    # not the same thing, and the last defect here hid in exactly that gap.
    if skipped:
        print(f"  skipped {skipped} newly-boosted episode(s) with no metadata row "
              f"(standing enrichment gap: {db.enrichment_gap_size(conn)})")


def cmd_remote_podroll(args):
    """Push the podroll projection alone (full replace). Run after the collector's
    `podroll` pass; the boost delta never touches this table."""
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    stmts = build_podroll_sql(conn)
    BATCH = 100
    for i in range(0, len(stmts), BATCH):
        ok, detail = _d1_exec(*cf, "\n".join(stmts[i:i + BATCH]))
        if not ok:
            # A missing-table error here means d1/schema.sql hasn't been applied to
            # the remote yet: run --apply-schema first (it's CREATE ... IF NOT EXISTS).
            print(f"[error] podroll batch {i // BATCH} failed: {detail}")
            return
    print(f"D1 podroll: replaced with {len(stmts) - 1} edge(s)")


def cmd_remote_publishers(args):
    """Push the publisher projection alone (full replace of both tables). Run
    after the collector's `publishers` pass; the boost delta never touches
    them. (podcasts.publisher_guid travels separately, on the metadata-drift
    pass — set_show_publisher bumps shows.updated_at when the link moves.)"""
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    stmts = build_publishers_sql(conn)
    BATCH = 100
    for i in range(0, len(stmts), BATCH):
        ok, detail = _d1_exec(*cf, "\n".join(stmts[i:i + BATCH]))
        if not ok:
            # A missing-table error here means d1/schema.sql hasn't been applied to
            # the remote yet: run --apply-schema first (it's CREATE ... IF NOT EXISTS).
            print(f"[error] publishers batch {i // BATCH} failed: {detail}")
            return
    print(f"D1 publishers: replaced with {len(stmts) - 2} row(s) across both tables")


def cmd_remote_clients(args):
    """Push client attribution onto boosts D1 ALREADY HAS, as UPDATEs.

    ⚠️ THE DELTA CANNOT DO THIS. `build_delta_sql` is INSERT OR IGNORE — it
    carries NEW boosts, so a re-derived column on an existing row is silently
    dropped. Attribution is derived rather than signed, so it changes when
    clients.py changes, on rows that were pushed long ago. Hence a separate
    verb, run after `onlyboosts_globalscan.py reclassify-clients`.

    New boosts need none of this: the delta's INSERT carries the columns, so
    this is only ever for a rule change or the initial population.
    """
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    rows = conn.execute(
        f"""SELECT event_id, client_id, client_via FROM boosts
            WHERE {db.not_excluded('')}""").fetchall()
    # Only rows with something to say: a NULL/NULL update over ~22k rows would be
    # thousands of statements asserting the default D1 already holds.
    rows = [r for r in rows if r["client_id"] or r["client_via"]]
    stmts = [f"UPDATE boosts SET client_id={q(r['client_id'])},"
             f"client_via={q(r['client_via'])} WHERE event_id={q(r['event_id'])};"
             for r in rows]
    print(f"pushing attribution for {len(stmts)} boost(s)...")
    BATCH = 100
    for i in range(0, len(stmts), BATCH):
        ok, detail = _d1_exec(*cf, "\n".join(stmts[i:i + BATCH]))
        if not ok:
            print(f"[error] batch {i // BATCH} failed: {detail}")
            return
        if (i // BATCH) % 50 == 0:
            print(f"  …{min(i + BATCH, len(stmts))}/{len(stmts)}", flush=True)
    print(f"pushed {len(stmts)} statements to D1")


def cmd_rebuild_fts(args):
    """Drop and repopulate the podcasts/episodes FTS tables.

    Needed because `CREATE VIRTUAL TABLE IF NOT EXISTS` will not reshape a table
    that already exists: adding `author` to podcasts_fts, or introducing
    episodes_fts at all, is invisible to --apply-schema on a live database.

    Only these two — boosts_fts is untouched and far the largest, so this stays a
    few thousand statements instead of a full reload. The base tables aren't
    touched either: FTS content is derived, so rebuilding it is safe at any time
    (search is briefly empty mid-run)."""
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    stmts = [
        "DROP TABLE IF EXISTS podcasts_fts;",
        "DROP TABLE IF EXISTS episodes_fts;",
        "CREATE VIRTUAL TABLE podcasts_fts USING fts5(podcast_guid UNINDEXED, title, author);",
        "CREATE VIRTUAL TABLE episodes_fts USING fts5(item_guid UNINDEXED, title, show);",
    ]
    eg = db.effective_guid("b")
    for a in conn.execute(f"""
        SELECT {eg} AS guid, s.title, s.author
        FROM boosts b LEFT JOIN shows s ON s.podcast_guid={eg}
        WHERE {eg} IS NOT NULL AND {db.not_excluded('b')} GROUP BY {eg}""").fetchall():
        if a["title"] or a["author"]:
            stmts.append("INSERT INTO podcasts_fts (podcast_guid,title,author) VALUES ("
                         f"{q(a['guid'])},{q(a['title'])},{q(a['author'])});")
    for e in conn.execute(f"""
        SELECT e.item_guid, e.title, s.title AS show_title
        FROM episodes e
        LEFT JOIN shows s ON s.podcast_guid = e.podcast_guid
        WHERE (e.title IS NOT NULL OR s.title IS NOT NULL)
          AND EXISTS (SELECT 1 FROM boosts
                      WHERE item_guid = e.item_guid AND {db.not_excluded('')})""").fetchall():
        stmts.append("INSERT INTO episodes_fts (item_guid,title,show) VALUES ("
                     f"{q(e['item_guid'])},{q(e['title'])},{q(e['show_title'])});")

    BATCH = 100
    for i in range(0, len(stmts), BATCH):
        ok, detail = _d1_exec(*cf, "\n".join(stmts[i:i + BATCH]))
        if not ok:
            print(f"[error] fts batch {i // BATCH} failed: {detail}")
            return
        if (i // BATCH) % 20 == 0:
            print(f"  …{min(i + BATCH, len(stmts))}/{len(stmts)} statements", flush=True)
    print(f"rebuilt podcasts_fts + episodes_fts ({len(stmts)} statements)")


def cmd_mark_all_synced(args):
    """One-time reconcile after an out-of-band full seed: mark every current boost
    as already in D1 so the first delta run doesn't re-push everything."""
    conn = db.connect(DB_PATH)
    _ensure_sync_table(conn)
    ids = [r[0] for r in conn.execute("SELECT event_id FROM boosts").fetchall()]
    _mark_synced(conn, ids)
    print(f"marked {len(ids)} boosts as already-synced to D1")


def main():
    ap = argparse.ArgumentParser(description="Sync box SQLite → Cloudflare D1")
    ap.add_argument("--emit-sql", metavar="FILE", help="write a full-load SQL file")
    ap.add_argument("--apply-schema", action="store_true", help="apply d1/schema.sql to the remote D1")
    ap.add_argument("--remote", action="store_true", help="full-load the projection to the remote D1")
    ap.add_argument("--remote-delta", action="store_true", help="push only boosts new since last sync (for the timer)")
    ap.add_argument("--remote-podroll", action="store_true",
                    help="replace the podroll projection (run after the weekly podroll pass)")
    ap.add_argument("--remote-clients", action="store_true",
                    help="push re-derived client attribution onto existing D1 boosts")
    ap.add_argument("--remote-publishers", action="store_true",
                    help="full-replace the publisher projection (run after the publishers pass)")
    ap.add_argument("--rebuild-fts", action="store_true",
                    help="drop + repopulate podcasts_fts/episodes_fts (needed after a column change)")
    ap.add_argument("--mark-all-synced", action="store_true", help="one-time: mark all current boosts as already in D1")
    args = ap.parse_args()
    if args.emit_sql:
        cmd_emit_sql(args)
    elif args.apply_schema:
        cmd_apply_schema(args)
    elif args.remote:
        cmd_remote(args)
    elif args.remote_delta:
        cmd_remote_delta(args)
    elif args.remote_podroll:
        cmd_remote_podroll(args)
    elif args.remote_publishers:
        cmd_remote_publishers(args)
    elif args.remote_clients:
        cmd_remote_clients(args)
    elif args.rebuild_fts:
        cmd_rebuild_fts(args)
    elif args.mark_all_synced:
        cmd_mark_all_synced(args)
    else:
        ap.error("choose --emit-sql <file>, --apply-schema, --remote, --remote-delta, "
                 "--remote-podroll, --remote-publishers, --rebuild-fts, or --mark-all-synced")


if __name__ == "__main__":
    main()
