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
so drift can never accumulate.
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
                  {eg} AS podcast_guid, item_guid, item_url, client, message
           FROM boosts""").fetchall()
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


def build_full_sql(conn):
    """Full-load statements: wipe the projection tables and repopulate."""
    out = []
    out.append("PRAGMA foreign_keys=OFF;")
    for t in ("boosts", "podcasts", "episodes", "profiles", "meta",
              "boosts_fts", "podcasts_fts"):
        out.append(f"DELETE FROM {t};")

    # boosts + FTS
    for r in _boost_rows(conn):
        out.append(
            "INSERT INTO boosts (event_id,booster_pubkey,booster_npub,created_at,sats,"
            "amount_source,podcast_guid,item_guid,item_url,client,message) VALUES ("
            f"{q(r['event_id'])},{q(r['booster_pubkey'])},{q(r['booster_npub'])},{q(r['created_at'])},"
            f"{q(r['sats'])},{q(r['amount_source'])},{q(r['podcast_guid'])},"
            f"{q(r['item_guid'])},{q(r['item_url'])},{q(r['client'])},{q(r['message'])});")
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
               s.title, s.image, s.artwork, s.feed_url, s.medium, s.author
        FROM boosts b LEFT JOIN shows s ON s.podcast_guid={eg}
        WHERE {eg} IS NOT NULL GROUP BY {eg}""").fetchall():
        # `artwork` is the second-chance art URL (<itunes:image> when it differs
        # from <image>); the show page falls back to it when `image` 404s. The
        # remote D1 `podcasts.artwork` column shipped out-of-band (ALTER + backfill),
        # so it's projected here and in the --remote-delta path below.
        out.append(
            "INSERT INTO podcasts (podcast_guid,title,image,artwork,feed_url,medium,author,"
            "boost_count,total_sats,booster_count,episode_count,latest_ts) VALUES ("
            f"{q(a['guid'])},{q(a['title'])},{q(a['image'])},{q(a['artwork'])},{q(a['feed_url'])},"
            f"{q(a['medium'])},{q(a['author'])},{q(a['boost_count'])},{q(a['total_sats'])},"
            f"{q(a['booster_count'])},{q(a['episode_count'])},{q(a['latest_ts'])});")
        if a["title"]:
            out.append("INSERT INTO podcasts_fts (podcast_guid,title) VALUES ("
                       f"{q(a['guid'])},{q(a['title'])});")

    # episodes (metadata + per-episode aggregates)
    for e in conn.execute("""
        SELECT e.item_guid, e.podcast_guid, e.title, e.image, e.published,
               e.duration, e.episode_number, e.enclosure_url, e.description,
               agg.boost_count, agg.total_sats, agg.booster_count, agg.latest_ts
        FROM episodes e
        JOIN (SELECT item_guid, COUNT(*) boost_count, COALESCE(SUM(sats),0) total_sats,
                     COUNT(DISTINCT booster_pubkey) booster_count, MAX(created_at) latest_ts
              FROM boosts WHERE item_guid IS NOT NULL GROUP BY item_guid) agg
          ON agg.item_guid = e.item_guid""").fetchall():
        out.append(
            "INSERT INTO episodes (item_guid,podcast_guid,title,image,published,"
            "duration,episode_number,enclosure_url,description,boost_count,total_sats,"
            "booster_count,latest_ts) VALUES ("
            f"{q(e['item_guid'])},{q(e['podcast_guid'])},{q(e['title'])},{q(e['image'])},"
            f"{q(e['published'])},{q(e['duration'])},{q(e['episode_number'])},"
            f"{q(e['enclosure_url'])},{q(e['description'])},{q(e['boost_count'])},{q(e['total_sats'])},"
            f"{q(e['booster_count'])},{q(e['latest_ts'])});")

    # profiles
    for p in conn.execute("SELECT pubkey,name,display_name,picture,nip05 FROM profiles").fetchall():
        out.append(
            "INSERT INTO profiles (pubkey,name,display_name,picture,nip05) VALUES ("
            f"{q(p['pubkey'])},{q(p['name'])},{q(p['display_name'])},{q(p['picture'])},{q(p['nip05'])});")

    out.extend(build_podroll_sql(conn))

    s = db.stats(conn)
    for k, v in {"generated_at": int(time.time()), "boosts": s["boosts"],
                 "total_sats": s["total_sats"], "distinct_shows": s["distinct_shows"],
                 "distinct_boosters": s["distinct_boosters"]}.items():
        out.append(f"INSERT INTO meta (key,value) VALUES ({q(k)},{q(v)});")
    return out


# ── delta projection (only what changed since last sync) ──────────────────────
def build_delta_sql(conn, rows):
    """SQL for `rows` (boosts not yet in D1): the new boosts (OR IGNORE, immutable)
    + FTS, plus a recomputed upsert of every podcast/episode they touched (an
    aggregate depends on ALL its boosts, so it's recomputed from the box DB) +
    the boosters' profiles + refreshed meta."""
    out = []
    pods, items, pubs = set(), set(), set()
    for r in rows:
        out.append(
            "INSERT OR IGNORE INTO boosts (event_id,booster_pubkey,booster_npub,created_at,sats,"
            "amount_source,podcast_guid,item_guid,item_url,client,message) VALUES ("
            f"{q(r['event_id'])},{q(r['booster_pubkey'])},{q(r['booster_npub'])},{q(r['created_at'])},"
            f"{q(r['sats'])},{q(r['amount_source'])},{q(r['podcast_guid'])},"
            f"{q(r['item_guid'])},{q(r['item_url'])},{q(r['client'])},{q(r['message'])});")
        if r["message"]:
            out.append("INSERT INTO boosts_fts (event_id,message) VALUES ("
                       f"{q(r['event_id'])},{q(r['message'])});")
        if r["podcast_guid"]:
            pods.add(r["podcast_guid"])
        if r["item_guid"]:
            items.add(r["item_guid"])
        pubs.add(r["booster_pubkey"])

    eg = db.effective_guid("b")
    for pg in pods:
        a = conn.execute(
            f"""SELECT {eg} AS guid, COUNT(*) AS boost_count,
                      COALESCE(SUM(b.sats),0) AS total_sats,
                      COUNT(DISTINCT b.booster_pubkey) AS booster_count,
                      COUNT(DISTINCT b.item_guid) AS episode_count,
                      MAX(b.created_at) AS latest_ts,
                      s.title, s.image, s.artwork, s.feed_url, s.medium, s.author
               FROM boosts b LEFT JOIN shows s ON s.podcast_guid={eg}
               WHERE {eg}=? GROUP BY {eg}""", (pg,)).fetchone()
        if not a:
            continue
        # `artwork` (second-chance art URL) is now projected — see the full-load
        # path above; the remote D1 column exists.
        out.append(
            "INSERT OR REPLACE INTO podcasts (podcast_guid,title,image,artwork,feed_url,medium,author,"
            "boost_count,total_sats,booster_count,episode_count,latest_ts) VALUES ("
            f"{q(a['guid'])},{q(a['title'])},{q(a['image'])},{q(a['artwork'])},{q(a['feed_url'])},{q(a['medium'])},"
            f"{q(a['author'])},{q(a['boost_count'])},{q(a['total_sats'])},{q(a['booster_count'])},"
            f"{q(a['episode_count'])},{q(a['latest_ts'])});")
        out.append(f"DELETE FROM podcasts_fts WHERE podcast_guid={q(pg)};")
        if a["title"]:
            out.append("INSERT INTO podcasts_fts (podcast_guid,title) VALUES ("
                       f"{q(pg)},{q(a['title'])});")

    for ig in items:
        e = conn.execute(
            """SELECT e.item_guid,e.podcast_guid,e.title,e.image,e.published,e.duration,
                      e.episode_number,e.enclosure_url,e.description,
                      (SELECT COUNT(*) FROM boosts WHERE item_guid=e.item_guid) AS boost_count,
                      (SELECT COALESCE(SUM(sats),0) FROM boosts WHERE item_guid=e.item_guid) AS total_sats,
                      (SELECT COUNT(DISTINCT booster_pubkey) FROM boosts WHERE item_guid=e.item_guid) AS booster_count,
                      (SELECT MAX(created_at) FROM boosts WHERE item_guid=e.item_guid) AS latest_ts
               FROM episodes e WHERE e.item_guid=?""", (ig,)).fetchone()
        if not e:
            continue
        out.append(
            "INSERT OR REPLACE INTO episodes (item_guid,podcast_guid,title,image,published,"
            "duration,episode_number,enclosure_url,description,boost_count,total_sats,"
            "booster_count,latest_ts) VALUES ("
            f"{q(e['item_guid'])},{q(e['podcast_guid'])},{q(e['title'])},{q(e['image'])},"
            f"{q(e['published'])},{q(e['duration'])},{q(e['episode_number'])},"
            f"{q(e['enclosure_url'])},{q(e['description'])},{q(e['boost_count'])},{q(e['total_sats'])},"
            f"{q(e['booster_count'])},{q(e['latest_ts'])});")

    if pubs:
        ph = ",".join("?" * len(pubs))
        for p in conn.execute(
            f"SELECT pubkey,name,display_name,picture,nip05 FROM profiles WHERE pubkey IN ({ph})",
                tuple(pubs)).fetchall():
            out.append(
                "INSERT OR REPLACE INTO profiles (pubkey,name,display_name,picture,nip05) VALUES ("
                f"{q(p['pubkey'])},{q(p['name'])},{q(p['display_name'])},{q(p['picture'])},{q(p['nip05'])});")

    s = db.stats(conn)
    for k, v in {"generated_at": int(time.time()), "boosts": s["boosts"],
                 "total_sats": s["total_sats"], "distinct_shows": s["distinct_shows"],
                 "distinct_boosters": s["distinct_boosters"]}.items():
        out.append(f"INSERT OR REPLACE INTO meta (key,value) VALUES ({q(k)},{q(v)});")
    return out


# ── which boosts are already in D1 (marker table in the box DB) ───────────────
def _ensure_sync_table(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS d1_boosts_synced (event_id TEXT PRIMARY KEY)")
    conn.commit()


def _unsynced_boosts(conn):
    eg = db.effective_guid("b")
    return conn.execute(
        f"""SELECT b.event_id,b.booster_pubkey,b.booster_npub,b.created_at,b.sats,
                  b.amount_source,{eg} AS podcast_guid,b.item_guid,b.item_url,b.client,b.message
           FROM boosts b LEFT JOIN d1_boosts_synced d ON d.event_id=b.event_id
           WHERE d.event_id IS NULL""").fetchall()


def _mark_synced(conn, ids):
    conn.executemany("INSERT OR IGNORE INTO d1_boosts_synced (event_id) VALUES (?)",
                     [(i,) for i in ids])
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
    stmts = build_full_sql(conn)   # NOTE: full load for now; delta mode is a follow-up
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
    _mark_synced(conn, [r["event_id"] for r in conn.execute("SELECT event_id FROM boosts").fetchall()])
    print(f"pushed {sent} statements to D1 (remote, full load); marked all boosts synced")


def cmd_remote_delta(args):
    cf = _cf(load_config(CREDENTIALS))
    if not cf:
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    _ensure_sync_table(conn)
    rows = _unsynced_boosts(conn)
    if not rows:
        print("D1 delta: nothing new to sync")
        return
    stmts = build_delta_sql(conn, rows)
    BATCH = 100
    for i in range(0, len(stmts), BATCH):
        ok, detail = _d1_exec(*cf, "\n".join(stmts[i:i + BATCH]))
        if not ok:
            print(f"[error] delta batch {i // BATCH} failed: {detail}")
            return
    _mark_synced(conn, [r["event_id"] for r in rows])
    print(f"D1 delta: pushed {len(rows)} new boost(s) ({len(stmts)} statements)")


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
    elif args.mark_all_synced:
        cmd_mark_all_synced(args)
    else:
        ap.error("choose --emit-sql <file>, --apply-schema, --remote, --remote-delta, "
                 "--remote-podroll, or --mark-all-synced")


if __name__ == "__main__":
    main()
