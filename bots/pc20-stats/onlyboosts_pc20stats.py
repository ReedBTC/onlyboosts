#!/usr/bin/env python3
"""PC 2.0 adoption stats — snapshot Podcast Index's public tracking/stats files
and keep a local SQLite of the current value-block corpus.

This is NOT boost data and reads nothing from the OnlyBoosts collector: the
subject is the whole Podcast Index — every feed with a <podcast:value> block
(~33k), plus the index-wide feature counts (funding, transcripts, chapters,
soundbites, socialInteract, medium) PI publishes daily. It exists to feed a
"stats for nerds" surface on the site and Reed's adoption charts.

Why SNAPSHOTS are the design: PI serves only the CURRENT state of every value
block — there is no changelog, and the Wayback Machine holds one truncated
capture (checked 2026-08-21). So historical keysend-vs-lnaddress composition
cannot be reconstructed backwards; it can only be accumulated forwards. Every
day this keeps costs ~10MB gzipped and buys a day of real history nothing else
can recover. daily_counts.json is the same bargain at 1.3KB.

Sources (all public, no API key):
  https://tracking.podcastindex.org/feedValueBlocks.json     (~18MB)
  https://tracking.podcastindex.org/episodeValueBlocks.json  (~33MB)
  https://stats.podcastindex.org/daily_counts.json           (~1.3KB)
  https://stats.podcastindex.org/chart-data.json             (v4v sats series)

NOTE: tracking.podcastindex.org 403s a request with no User-Agent (curl -I too),
so every fetch here sends UA. A body is only stored after it parses as JSON —
same discipline as the /api/data proxy: never trust the status code alone.

Read-only outward. Nothing here signs, publishes, or pays.

Usage:
  onlyboosts_pc20stats.py snapshot [--force]   # fetch today's files + load DB
  onlyboosts_pc20stats.py stats                # current-adoption report
"""

import argparse
import gzip
import hashlib
import json
import re
import sqlite3
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SNAPDIR = DATA / "snapshots"
DB_PATH = DATA / "pc20.db"

UA = "OnlyBoosts-PC20Stats/1.0 (+https://onlyboosts.social)"

SOURCES = {
    "feedValueBlocks.json": "https://tracking.podcastindex.org/feedValueBlocks.json",
    "episodeValueBlocks.json": "https://tracking.podcastindex.org/episodeValueBlocks.json",
    "daily_counts.json": "https://stats.podcastindex.org/daily_counts.json",
    "chart-data.json": "https://stats.podcastindex.org/chart-data.json",
}

# Leg classification is by ADDRESS SHAPE, never by the declared `type`:
# publishers put anything in that attribute (episode titles, "n/a", HTML).
# Measured 2026-08-21: 1,314 legs declare type="keysend" (meaning node), 36
# declare "lightning" and mix node pubkeys with lnaddresses. A 66-hex string is
# a node pubkey however it is labelled; user@domain is an lnaddress.
HEX66 = re.compile(r"^[0-9a-fA-F]{66}$")
LNADDR = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def classify_leg(address):
    a = (address or "").strip()
    if HEX66.match(a):
        return "keysend"
    if LNADDR.match(a):
        return "lnaddress"
    return "other"


def fetch_json(url, timeout=120, retries=2):
    """GET url, require it to parse as JSON. Returns (raw_bytes, parsed)."""
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read(200 * 1024 * 1024)  # hard cap: 200MB
            return raw, json.loads(raw)
        except Exception as e:  # noqa: BLE001 — retried, then surfaced
            last = e
            if attempt < retries:
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"fetch failed for {url}: {last}")


def db_connect():
    DATA.mkdir(exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS snapshots(
      day TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER, sha256 TEXT,
      fetched_at INTEGER, PRIMARY KEY (day, file));
    -- One row per day, the whole file: the columns PI adds/drops over time
    -- shouldn't require a migration here to keep being captured.
    CREATE TABLE IF NOT EXISTS daily_counts(
      day TEXT PRIMARY KEY, json TEXT NOT NULL);
    -- Current state, rebuilt wholesale from the newest feedValueBlocks.json.
    CREATE TABLE IF NOT EXISTS value_feeds(
      feed_id INTEGER PRIMARY KEY, podcast_guid TEXT, url TEXT, itunes_id INTEGER,
      model_type TEXT, model_method TEXT, suggested TEXT,
      value_created_on INTEGER,
      n_legs INTEGER, n_keysend INTEGER, n_lnaddress INTEGER, n_other INTEGER);
    CREATE TABLE IF NOT EXISTS value_legs(
      feed_id INTEGER NOT NULL, idx INTEGER NOT NULL,
      leg_class TEXT NOT NULL,          -- keysend | lnaddress | other (address shape)
      decl_type TEXT,                   -- what the publisher actually wrote
      name TEXT, address TEXT, split INTEGER, fee INTEGER,
      custom_key TEXT, custom_value TEXT,
      PRIMARY KEY (feed_id, idx));
    CREATE INDEX IF NOT EXISTS idx_legs_class ON value_legs(leg_class);
    -- Aggregate only: the per-episode corpus stays in the gzipped snapshot.
    CREATE TABLE IF NOT EXISTS episode_value_summary(
      day TEXT PRIMARY KEY, episodes INTEGER, feeds INTEGER);
    """)
    return db


def snapshot(force=False):
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    outdir = SNAPDIR / day
    outdir.mkdir(parents=True, exist_ok=True)
    db = db_connect()

    parsed = {}
    for name, url in SOURCES.items():
        done = db.execute("SELECT 1 FROM snapshots WHERE day=? AND file=?",
                          (day, name)).fetchone()
        gzpath = outdir / (name + ".gz")
        if done and gzpath.exists() and not force:
            print(f"[skip] {name} already snapshotted for {day}")
            with gzip.open(gzpath, "rb") as f:
                parsed[name] = json.load(f)
            continue
        raw, obj = fetch_json(url)
        with gzip.open(gzpath, "wb", compresslevel=6) as f:
            f.write(raw)
        db.execute(
            "INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?)",
            (day, name, len(raw), hashlib.sha256(raw).hexdigest(), int(time.time())))
        parsed[name] = obj
        print(f"[ok] {name}: {len(raw):,} bytes -> {gzpath.name}")

    db.execute("INSERT OR REPLACE INTO daily_counts VALUES (?,?)",
               (day, json.dumps(parsed["daily_counts.json"], separators=(",", ":"))))

    # Rebuild the current-state tables from the feed-level file.
    feeds = parsed["feedValueBlocks.json"]
    db.execute("DELETE FROM value_feeds")
    db.execute("DELETE FROM value_legs")
    for f in feeds:
        v = f.get("value") or {}
        model = v.get("model") or {}
        dests = v.get("destinations") or []
        counts = Counter(classify_leg(d.get("address")) for d in dests)
        db.execute(
            "INSERT OR REPLACE INTO value_feeds VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (f.get("id"), f.get("podcastGuid"), f.get("url"), f.get("itunesId"),
             model.get("type"), model.get("method"), model.get("suggested"),
             f.get("valueCreatedOn"),
             len(dests), counts["keysend"], counts["lnaddress"], counts["other"]))
        for i, d in enumerate(dests):
            db.execute(
                "INSERT OR REPLACE INTO value_legs VALUES (?,?,?,?,?,?,?,?,?,?)",
                (f.get("id"), i, classify_leg(d.get("address")),
                 d.get("type"), d.get("name"), d.get("address"),
                 d.get("split"), 1 if d.get("fee") else 0,
                 d.get("customKey"), d.get("customValue")))

    eps = parsed["episodeValueBlocks.json"]
    db.execute("INSERT OR REPLACE INTO episode_value_summary VALUES (?,?,?)",
               (day, len(eps), len({e.get("feedId") for e in eps})))

    db.commit()
    n = db.execute("SELECT COUNT(*) FROM value_feeds").fetchone()[0]
    print(f"[done] {day}: {n:,} value feeds loaded, "
          f"{len(eps):,} episode-level blocks summarized")


def stats():
    db = db_connect()
    q = lambda sql, *a: db.execute(sql, a).fetchall()  # noqa: E731

    total, ks_feeds, ln_feeds = q(
        "SELECT COUNT(*), SUM(n_keysend>0), SUM(n_lnaddress>0) FROM value_feeds")[0]
    legs = dict(q("SELECT leg_class, COUNT(*) FROM value_legs GROUP BY leg_class"))
    nlegs = sum(legs.values())
    print(f"value-enabled feeds: {total:,}")
    print(f"payment legs: {nlegs:,}  "
          f"keysend {legs.get('keysend',0):,} ({100*legs.get('keysend',0)/nlegs:.1f}%)  "
          f"lnaddress {legs.get('lnaddress',0):,} ({100*legs.get('lnaddress',0)/nlegs:.1f}%)  "
          f"other {legs.get('other',0):,}")
    print(f"feeds with >=1 lnaddress leg: {ln_feeds:,} ({100*ln_feeds/total:.1f}%)")
    print(f"feeds with >=1 keysend leg:   {ks_feeds:,} ({100*ks_feeds/total:.1f}%)")

    print("\nlegs per feed:")
    for legs_n, feeds_n in q("""SELECT CASE WHEN n_legs>=6 THEN '6+' ELSE n_legs END,
        COUNT(*) FROM value_feeds GROUP BY 1 ORDER BY MIN(n_legs)"""):
        print(f"  {legs_n:>2} legs: {feeds_n:,}")

    print("\nlnaddress domains (top 10):")
    for dom, n in q("""SELECT lower(substr(address, instr(address,'@')+1)), COUNT(*)
        FROM value_legs WHERE leg_class='lnaddress'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10"""):
        print(f"  {dom:<24} {n:,}")

    print("\nkeysend nodes (top 10 by feeds):")
    for name, n in q("""SELECT COALESCE(NULLIF(name,''),substr(address,1,12)||'…'),
        COUNT(DISTINCT feed_id) FROM value_legs WHERE leg_class='keysend'
        GROUP BY address ORDER BY 2 DESC LIMIT 10"""):
        print(f"  {name[:40]:<40} {n:,}")

    print("\nvalue blocks first seen (valueCreatedOn), by year:")
    for yr, n in q("""SELECT CASE WHEN value_created_on IS NULL OR value_created_on<1262304000
        THEN 'unknown' ELSE strftime('%Y', value_created_on, 'unixepoch') END, COUNT(*)
        FROM value_feeds GROUP BY 1 ORDER BY 1"""):
        print(f"  {yr}: {n:,}")

    row = q("SELECT day, json FROM daily_counts ORDER BY day DESC LIMIT 1")
    if row:
        day, dc = row[0][0], json.loads(row[0][1])
        print(f"\nindex-wide feature counts (daily_counts.json, {day}):")
        for k in ("feedCountTotal", "feedsWithValueBlocks", "feedsWithFundingTag",
                  "feedsWithChapters", "feedsWithTranscripts", "feedsWithSoundbites",
                  "feedsWithSocialInteract", "feedsWithMediumMusic",
                  "feedsWithMediumVideo", "feedsWithNewEpisodes90days"):
            if k in dc:
                print(f"  {k:<28} {dc[k]:,}")

    row = q("SELECT day, episodes, feeds FROM episode_value_summary ORDER BY day DESC LIMIT 1")
    if row:
        print(f"\nepisode-level value blocks ({row[0][0]}): "
              f"{row[0][1]:,} episodes across {row[0][2]:,} feeds")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot", help="fetch today's files and load the DB")
    s.add_argument("--force", action="store_true", help="refetch even if today exists")
    sub.add_parser("stats", help="print the current-adoption report")
    args = ap.parse_args()
    if args.cmd == "snapshot":
        snapshot(force=args.force)
    else:
        stats()


if __name__ == "__main__":
    sys.exit(main())
