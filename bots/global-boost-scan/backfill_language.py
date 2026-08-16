#!/usr/bin/env python3
"""One-time backfill of shows.language for rows enriched before the column existed.

The recurring enrich pass only resolves shows that have NO row yet, so existing
shows never get re-fetched. This walks every show with no language and fills it
from Podcast Index podcasts/byguid (the same call enrich already makes for new
shows — no new endpoint). Language-only UPDATE: it does not touch title/image/etc.
After this runs once, new shows get language automatically via
enrich._show_from_feed.

⚠️ A FAILED LOOKUP IS NOT "NO LANGUAGE", and this script is careful about the
difference where backfill_author.py deliberately wasn't. A NULL language is a
first-class state the site has to render (52% of music feeds declare none), so
recording a 429 or a timeout as "no language" would bake a transient failure into
data that reads as fact. `resolve_show` returns None on a failed call and a dict
on a good one, so the two are distinguishable; only a clean read is counted as an
answer, and failures are reported so a re-run can pick them up. Same rule as the
podroll pass: only a clean read may write.

Idempotent and resumable: re-running only re-tries rows still NULL — which
includes the feeds that genuinely have no language, so a re-run is expected to
re-ask about them and get the same empty answer.

Usage:  python3 backfill_language.py [--limit N] [--dry-run] [--workers N]
"""
import argparse
import collections
import sys
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
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    key, secret = _pi_creds()
    if not (key and secret):
        print("[error] no Podcast Index credentials", file=sys.stderr)
        return 1

    conn = db.connect(DB_PATH)
    rows = conn.execute(
        "SELECT podcast_guid FROM shows WHERE language IS NULL "
        "AND title IS NOT NULL ORDER BY podcast_guid").fetchall()
    guids = [r[0] for r in rows]
    if args.limit:
        guids = guids[:args.limit]
    print(f"{len(guids)} show(s) need a language backfill")

    def fetch(guid):
        info = enrich.resolve_show(guid, key, secret)
        # info is None  → the call failed; we learned nothing and must not write.
        # info["language"] is None → the feed declares no language. A real answer.
        return guid, info, (info or {}).get("language")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(fetch, guids))

    filled = declared_none = failed = 0
    langs = collections.Counter()
    for guid, info, lang in results:
        if info is None:
            failed += 1
            continue
        if lang is None:
            declared_none += 1
            continue
        filled += 1
        langs[lang] += 1
        if not args.dry_run:
            conn.execute(
                "UPDATE shows SET language=? WHERE podcast_guid=? AND language IS NULL",
                (lang, guid))
    if not args.dry_run:
        conn.commit()

    print(f"  filled={filled}  declares-none={declared_none}  lookup-failed={failed}"
          + ("   (dry-run, nothing written)" if args.dry_run else ""))
    if langs:
        print("  " + "  ".join(f"{k}:{v}" for k, v in langs.most_common(12)))
    if failed:
        print(f"  [note] {failed} lookup(s) failed and were left NULL — re-run to retry them")
    return 0


if __name__ == "__main__":
    sys.exit(main())
