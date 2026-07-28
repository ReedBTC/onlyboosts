#!/usr/bin/env python3
"""One-time backfill of shows.artwork for rows enriched before the column existed.

The recurring enrich pass only resolves shows that have NO row yet, so existing
shows never get re-fetched for the new second-chance art URL. This walks every
show and fills `artwork` from Podcast Index podcasts/byguid (the same call enrich
already makes for new shows — no new endpoint). It writes artwork only; it does
not touch title/image/author/etc.

Most shows have no distinct <itunes:image>, so `artwork` stays NULL for them —
that's expected, not a failure. Only feeds whose <image> and <itunes:image>
differ (e.g. Homegrown Hits, whose <image> 404s) get a value.

Because "no artwork" is the common, legitimate result, this can't cheaply tell
"already checked, none" from "not checked yet" via NULL alone. It re-checks every
show each run (idempotent, read-only against PI); pass --limit to chunk it. After
it runs once, new shows get artwork automatically via enrich._show_from_feed.

Usage:  python3 backfill_artwork.py [--limit N] [--dry-run] [--workers N]
"""
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "shared"))

import db                                             # noqa: E402
import enrich                                         # noqa: E402
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
        "SELECT podcast_guid FROM shows WHERE artwork IS NULL "
        "AND title IS NOT NULL ORDER BY podcast_guid").fetchall()
    guids = [r[0] for r in rows]
    if args.limit:
        guids = guids[:args.limit]
    print(f"{len(guids)} show(s) to check for a distinct artwork URL")

    def fetch(guid):
        info = enrich.resolve_show(guid, key, secret)   # includes artwork now
        return guid, (info or {}).get("artwork")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(fetch, guids))

    filled = none = 0
    for guid, artwork in results:
        if not artwork:
            none += 1
            continue
        filled += 1
        if not args.dry_run:
            conn.execute("UPDATE shows SET artwork=? WHERE podcast_guid=?",
                         (artwork, guid))
    if not args.dry_run:
        conn.commit()

    print(f"  filled={filled}  no-distinct-artwork-or-failed={none}"
          + ("   (dry-run, nothing written)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
