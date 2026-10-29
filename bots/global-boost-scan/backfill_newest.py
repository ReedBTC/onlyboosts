#!/usr/bin/env python3
"""One-time backfill of shows.newest_item_ts (the newest episode's datePublished off
PI episodes/byfeedid, through enrich.resolve_show) for podcast-side boosted shows
enriched before the column existed. Two PI calls per show; serial by default.

backfill_language.py's shape, for the same reason: the show refresh gate re-reads
Podcast Index a month apart for a dormant show, so left to it the column would
fill over a month. This walks every show with no newest_item_ts and fills it from
podcasts/byguid (the call enrich already makes). Description-only UPDATE, and it
BUMPS updated_at on a fill, which is what carries the row to D1 on the
metadata-drift pass. New shows get newest_item_ts through enrich._show_from_feed.

⚠️ A FAILED LOOKUP IS NOT "NO DESCRIPTION". `resolve_show` returns None on a
failed call and a dict on a good one; only a clean read is counted as an answer,
and failures are reported so a re-run can pick them up. A feed that genuinely
declares none is re-asked on a re-run and answers the same empty thing.

Usage:  python3 backfill_newest.py [--limit N] [--dry-run] [--workers N]
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
    # 4, not the author script's 8: PI is keyed and tolerant, but a wide concurrent
    # sweep is exactly what silently undercounted the podroll probe.
    ap.add_argument("--workers", type=int, default=1)
    args = ap.parse_args()

    key, secret = _pi_creds()
    if not (key and secret):
        print("[error] no Podcast Index credentials", file=sys.stderr)
        return 1

    conn = db.connect(DB_PATH)
    rows = conn.execute(
        f"SELECT s.podcast_guid FROM shows s WHERE s.newest_item_ts IS NULL "
        f"AND s.title IS NOT NULL AND COALESCE(s.medium,'podcast') <> 'music' "
        f"AND {db._boosted_shows_expr()} ORDER BY s.podcast_guid").fetchall()
    guids = [r[0] for r in rows]
    if args.limit:
        guids = guids[:args.limit]
    print(f"{len(guids)} show(s) need a newest_item_ts backfill")

    def fetch(guid):
        info = enrich.resolve_show(guid, key, secret)
        # info is None → the call failed; we learned nothing and must not write.
        # info["newest_item_ts"] is None → the feed declares none. A real answer.
        return guid, info, (info or {}).get("newest_item_ts")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(fetch, guids))

    filled = declared_none = failed = 0
    now = int(time.time())
    for guid, info, desc in results:
        if info is None:
            failed += 1
            continue
        if desc is None:
            declared_none += 1
            continue
        filled += 1
        if not args.dry_run:
            conn.execute(
                "UPDATE shows SET newest_item_ts=?, updated_at=? "
                "WHERE podcast_guid=? AND newest_item_ts IS NULL",
                (desc, now, guid))
    if not args.dry_run:
        conn.commit()

    print(f"  filled={filled}  declares-none={declared_none}  lookup-failed={failed}"
          + ("   (dry-run, nothing written)" if args.dry_run else ""))
    if failed:
        print(f"  [note] {failed} lookup(s) failed and were left NULL — re-run to retry them")
    return 0


if __name__ == "__main__":
    sys.exit(main())
