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
    rows = conn.execute(
        """SELECT event_id, booster_pubkey, booster_npub, created_at, sats, amount_source,
                  podcast_guid, item_guid, item_url, client, message
           FROM boosts""").fetchall()
    for r in rows:
        yield r


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
    for a in conn.execute("""
        SELECT b.podcast_guid AS guid,
               COUNT(*) AS boost_count, COALESCE(SUM(b.sats),0) AS total_sats,
               COUNT(DISTINCT b.booster_pubkey) AS booster_count,
               COUNT(DISTINCT b.item_guid) AS episode_count,
               MAX(b.created_at) AS latest_ts,
               s.title, s.image, s.feed_url, s.medium
        FROM boosts b LEFT JOIN shows s ON s.podcast_guid=b.podcast_guid
        WHERE b.podcast_guid IS NOT NULL GROUP BY b.podcast_guid""").fetchall():
        out.append(
            "INSERT INTO podcasts (podcast_guid,title,image,feed_url,medium,"
            "boost_count,total_sats,booster_count,episode_count,latest_ts) VALUES ("
            f"{q(a['guid'])},{q(a['title'])},{q(a['image'])},{q(a['feed_url'])},"
            f"{q(a['medium'])},{q(a['boost_count'])},{q(a['total_sats'])},"
            f"{q(a['booster_count'])},{q(a['episode_count'])},{q(a['latest_ts'])});")
        if a["title"]:
            out.append("INSERT INTO podcasts_fts (podcast_guid,title) VALUES ("
                       f"{q(a['guid'])},{q(a['title'])});")

    # episodes (metadata + per-episode aggregates)
    for e in conn.execute("""
        SELECT e.item_guid, e.podcast_guid, e.title, e.image, e.published,
               e.duration, e.episode_number, e.enclosure_url, e.description,
               agg.boost_count, agg.total_sats
        FROM episodes e
        JOIN (SELECT item_guid, COUNT(*) boost_count, COALESCE(SUM(sats),0) total_sats
              FROM boosts WHERE item_guid IS NOT NULL GROUP BY item_guid) agg
          ON agg.item_guid = e.item_guid""").fetchall():
        out.append(
            "INSERT INTO episodes (item_guid,podcast_guid,title,image,published,"
            "duration,episode_number,enclosure_url,description,boost_count,total_sats) VALUES ("
            f"{q(e['item_guid'])},{q(e['podcast_guid'])},{q(e['title'])},{q(e['image'])},"
            f"{q(e['published'])},{q(e['duration'])},{q(e['episode_number'])},"
            f"{q(e['enclosure_url'])},{q(e['description'])},{q(e['boost_count'])},{q(e['total_sats'])});")

    # profiles
    for p in conn.execute("SELECT pubkey,name,display_name,picture,nip05 FROM profiles").fetchall():
        out.append(
            "INSERT INTO profiles (pubkey,name,display_name,picture,nip05) VALUES ("
            f"{q(p['pubkey'])},{q(p['name'])},{q(p['display_name'])},{q(p['picture'])},{q(p['nip05'])});")

    s = db.stats(conn)
    for k, v in {"generated_at": int(time.time()), "boosts": s["boosts"],
                 "total_sats": s["total_sats"], "distinct_shows": s["distinct_shows"],
                 "distinct_boosters": s["distinct_boosters"]}.items():
        out.append(f"INSERT INTO meta (key,value) VALUES ({q(k)},{q(v)});")
    return out


def cmd_emit_sql(args):
    conn = db.connect(DB_PATH)
    stmts = build_full_sql(conn)
    Path(args.emit_sql).write_text("\n".join(stmts) + "\n")
    print(f"wrote {len(stmts)} statements → {args.emit_sql}")


def cmd_remote(args):
    import json
    import urllib.request
    cfg = load_config(CREDENTIALS)
    acct, dbid, token = (cfg.get("CF_ACCOUNT_ID"), cfg.get("CF_D1_DATABASE_ID"),
                         cfg.get("CF_API_TOKEN"))
    if not all([acct, dbid, token]):
        print("[error] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN missing from credentials.env")
        return
    conn = db.connect(DB_PATH)
    stmts = build_full_sql(conn)   # NOTE: full load for now; delta mode is a follow-up
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{dbid}/query"
    hdr = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    BATCH = 100
    sent = 0
    for i in range(0, len(stmts), BATCH):
        chunk = "\n".join(stmts[i:i + BATCH])
        body = json.dumps({"sql": chunk}).encode()
        req = urllib.request.Request(url, data=body, headers=hdr, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                ok = json.loads(resp.read()).get("success")
                if not ok:
                    print(f"[warn] batch {i//BATCH} not successful")
        except Exception as e:
            print(f"[error] batch {i//BATCH} failed: {e}")
            return
        sent += len(stmts[i:i + BATCH])
    print(f"pushed {sent} statements to D1 (remote, full load)")


def main():
    ap = argparse.ArgumentParser(description="Sync box SQLite → Cloudflare D1")
    ap.add_argument("--emit-sql", metavar="FILE", help="write a full-load SQL file")
    ap.add_argument("--remote", action="store_true", help="push to the D1 HTTP API")
    args = ap.parse_args()
    if args.emit_sql:
        cmd_emit_sql(args)
    elif args.remote:
        cmd_remote(args)
    else:
        ap.error("choose --emit-sql <file> or --remote")


if __name__ == "__main__":
    main()
