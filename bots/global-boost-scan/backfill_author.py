#!/usr/bin/env python3
"""One-time backfill of shows.author for rows enriched before the column existed.

The recurring enrich pass only resolves shows that have NO row yet, so existing
shows never get re-fetched. This walks every show missing an author and fills it
from Podcast Index podcasts/byguid (the same call enrich already makes for new
shows — no new endpoint). Author-only UPDATE: it does not touch title/image/etc.

Idempotent and resumable: re-running only re-tries rows still NULL. Read-only
against Podcast Index; the only write is the local SQLite author column. After
this runs once, new shows get author automatically via enrich._show_from_feed.

Usage:  python3 backfill_author.py [--limit N] [--dry-run]
"""
import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "shared"))

import db                                          # noqa: E402
import enrich                                      # noqa: E402
from onlyboosts_globalscan import _pi_creds, DB_PATH  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="cap rows (0 = all)")
    ap.add_argument("--dry-run", action="store_true", help="fetch but don't write")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    key, secret = _pi_creds()
    if not (key and secret):
        print("[error] no Podcast Index credentials", file=sys.stderr)
        return 1

    conn = db.connect(DB_PATH)
    rows = conn.execute(
        "SELECT podcast_guid FROM shows WHERE author IS NULL "
        "AND title IS NOT NULL ORDER BY podcast_guid").fetchall()
    guids = [r[0] for r in rows]
    if args.limit:
        guids = guids[:args.limit]
    print(f"{len(guids)} show(s) need an author backfill")

    def fetch(guid):
        info = enrich.resolve_show(guid, key, secret)   # includes author now
        return guid, (info or {}).get("author")

    filled = blank = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(fetch, guids))

    for guid, author in results:
        if author is None:
            # distinguish "PI returned no author" from "lookup failed" is not worth
            # a second call; both leave the row NULL and a future re-run retries it.
            blank += 1
            continue
        filled += 1
        if not args.dry_run:
            conn.execute("UPDATE shows SET author=? WHERE podcast_guid=? AND author IS NULL",
                         (author, guid))
    if not args.dry_run:
        conn.commit()

    print(f"  filled={filled}  no-author-or-failed={blank}"
          + ("   (dry-run, nothing written)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
