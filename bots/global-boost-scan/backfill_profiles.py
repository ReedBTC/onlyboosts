#!/usr/bin/env python3
"""One-time backfill of the profile fields added for the per-booster pages:
about / lud16 / lud06 / website / banner.

Why this exists rather than letting the timer do it: until now a profile was
fetched exactly once, on the first tick after that booster's first boost, and
never looked at again (`pubkeys_needing_profile` selected `WHERE p.pubkey IS
NULL`). Every stored row would therefore keep the four columns it has and gain
NULLs in the five new ones forever. The refresh gate that ships alongside this
fixes the FUTURE — a row is re-read once it passes db.PROFILE_MAX_AGE — but it
is deliberately capped per tick and the whole corpus was written inside the last
19 days, so without this pass the feature reaches nobody for another ~11 days
and then only in dribs.

It re-reads the newest kind-0 for EVERY known booster, the same call the enrich
pass makes, and writes through db.upsert_profile — so it bumps `updated_at`,
which is what carries the rows to D1 on the next metadata-drift pass. That is
not incidental: `build_delta_sql` is driven by new boosts arriving, so a
re-fetched profile for a booster who has not boosted since would not ride it.
`build_meta_drift_sql` selects on `updated_at >= since` and runs on every
incremental tick, including ones where no boost arrived.

⚠️ The remote D1 `profiles` table needs its five ALTER TABLE ADD COLUMNs BEFORE
the first sync after this runs. `d1/schema.sql` is CREATE TABLE IF NOT EXISTS
and will not add them.

Read-only against the relays; the only write is the local SQLite profiles table.
Idempotent and resumable — re-running re-reads and re-writes, which is harmless.

Usage:  python3 backfill_profiles.py [--limit N] [--dry-run] [--report-only]
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "shared"))

import db                                    # noqa: E402
import enrich                                # noqa: E402
from relays import PROFILE_RELAYS            # noqa: E402
from onlyboosts_globalscan import DB_PATH    # noqa: E402

NEW_FIELDS = ("about", "lud16", "lud06", "website", "banner")


def report(conn):
    """Coverage of the new fields, measured off the stored rows rather than a
    sample — the point of reporting after the backfill and not before."""
    def one(where, params=()):
        return conn.execute(f"SELECT COUNT(*) FROM profiles p WHERE {where}",
                            params).fetchone()[0]

    total = one("1")
    boosters = conn.execute(
        "SELECT COUNT(DISTINCT booster_pubkey) FROM boosts").fetchone()[0]
    print(f"\n  profiles stored: {total}   distinct boosters: {boosters}"
          f"   (no row: {boosters - total})")

    # The 670 whose pages anyone is likely to visit.
    heavy = """p.pubkey IN (SELECT booster_pubkey FROM boosts
                            GROUP BY 1 HAVING COUNT(*) >= 5)"""
    heavy_total = one(heavy)

    print(f"\n  {'field':<14}{'all':>14}{'5+ boosts':>16}")
    print(f"  {'-'*14}{'-'*14:>14}{'-'*16:>16}")
    for f in ("name", "display_name", "picture", "nip05") + NEW_FIELDS:
        nn = f"p.{f} IS NOT NULL AND p.{f} <> ''"
        a, h = one(nn), one(f"({nn}) AND {heavy}")
        print(f"  {f:<14}{a:>6} {a/total*100 if total else 0:>6.1f}%"
              f"{h:>8} {h/heavy_total*100 if heavy_total else 0:>6.1f}%")
    print(f"  {'(population)':<14}{total:>6}        {heavy_total:>8}")

    # lud16 vs lud06 is the split the header has to branch on.
    both = one("p.lud16 <> '' AND p.lud06 <> ''")
    only16 = one("p.lud16 <> '' AND COALESCE(p.lud06,'') = ''")
    only06 = one("COALESCE(p.lud16,'') = '' AND p.lud06 <> ''")
    neither = one("COALESCE(p.lud16,'') = '' AND COALESCE(p.lud06,'') = ''")
    print(f"\n  lightning: lud16 only {only16}, lud06 only {only06}, "
          f"both {both}, neither {neither}")

    # about length distribution — the header needs to know whether it is
    # clamping paragraphs or showing one line.
    lens = [r[0] for r in conn.execute(
        "SELECT LENGTH(about) FROM profiles WHERE about IS NOT NULL AND about <> ''"
        " ORDER BY 1").fetchall()]
    if lens:
        def pct(p):
            return lens[min(len(lens) - 1, int(len(lens) * p))]
        print(f"  about length: n={len(lens)} min={lens[0]} p50={pct(.5)} "
              f"p75={pct(.75)} p90={pct(.9)} p99={pct(.99)} max={lens[-1]}")
        for cut in (80, 160, 280, 500):
            print(f"    over {cut:>3} chars: {sum(1 for n in lens if n > cut):>5}"
                  f"  ({sum(1 for n in lens if n > cut)/len(lens)*100:.1f}% of those with a bio)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="cap pubkeys (0 = all)")
    ap.add_argument("--dry-run", action="store_true", help="fetch but don't write")
    ap.add_argument("--report-only", action="store_true", help="just print coverage")
    ap.add_argument("--include-missing", action="store_true",
                    help="also re-try boosters with no profile row (negative-cached)")
    args = ap.parse_args()

    conn = db.connect(DB_PATH)
    if args.report_only:
        report(conn)
        return 0

    if args.include_missing:
        # Every booster we hold a boost for, whether or not enrichment ever
        # resolved one. The negative cache is bypassed deliberately: it exists to
        # stop the 5-minute tick re-asking, not to make a one-off sweep skip them.
        rows = conn.execute(
            f"""SELECT DISTINCT b.booster_pubkey FROM boosts b
                WHERE {db.not_excluded('b')}""").fetchall()
    else:
        rows = conn.execute(
            """SELECT p.pubkey FROM profiles p
               WHERE NOT EXISTS (SELECT 1 FROM excluded_ids x
                                 WHERE x.kind='booster' AND x.id = p.pubkey)
               ORDER BY p.updated_at""").fetchall()
    pubkeys = [r[0] for r in rows]
    if args.limit:
        pubkeys = pubkeys[:args.limit]

    print(f"Re-reading kind-0 for {len(pubkeys)} pubkey(s) across "
          f"{len(PROFILE_RELAYS)} relay(s)...", flush=True)
    profs = enrich.resolve_profiles(pubkeys, PROFILE_RELAYS,
                                    log=lambda m: print(m, flush=True))
    print(f"  resolved {len(profs)}/{len(pubkeys)}")

    if args.dry_run:
        got = {f: sum(1 for p in profs.values() if p.get(f)) for f in NEW_FIELDS}
        print(f"  [dry-run] nothing written. would fill: {got}")
        return 0

    for pk, prof in profs.items():
        db.upsert_profile(conn, pk, prof)
    print(f"  wrote {len(profs)} profile(s); updated_at bumped, so the next "
          f"--remote-delta drift pass carries them to D1")
    report(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
