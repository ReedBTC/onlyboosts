#!/usr/bin/env python3
"""OnlyBoosts — global podcast-boost collector.

Subcommands:
  backfill     deep walk every core relay back to the floor (default 2025-01-01),
               resumable per-relay; classify + store boosts.
  incremental  forward tail scan since the last run (for the recurring timer).
  enrich       fill Podcast Index show/episode metadata + kind-0 profiles.
  stats        print DB counts.

READ-ONLY: this collector only reads Nostr + Podcast Index and writes the local
SQLite index. It never signs, publishes, or pays. (Per repo guardrails, the hard
line is any signing/publish/payment path — none here.)

Receipt handling: Fountain boosts carry NO amount tag — they're only detectable
via the kind-9735 zap receipt their note quotes. So each page batch-fetches all
candidate receipt ids in a couple of REQs (not one fetch per note) before
classifying.
"""

import argparse
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "shared"))

import db                                                       # noqa: E402
import enrich                                                   # noqa: E402
import export as export_mod                                     # noqa: E402
from classify import classify_boost, decode_note_or_nevent, _QUOTE_RE  # noqa: E402
from relays import CORE_RELAYS, PROFILE_RELAYS, RECEIPT_RELAYS, expand_via_outbox  # noqa: E402
from scan import (scan_relay_backward, scan_relay_incremental,   # noqa: E402
                  fetch_events_by_ids)
from nostr_utils import load_config                             # noqa: E402

DB_PATH = str(HERE / "data" / "onlyboosts.db")
CREDENTIALS = "/home/reed/.config/nostr-bots/credentials.env"
# Same restricted-rrsync key + VPS LB uses; shards land UNDER an onlyboosts/
# subdir of the rrsync-locked deploy root so they can never collide with LB's
# files sharing that host (relay.mynostr.app, Caddy-served).
VPS_KEY_FILE = str(Path.home() / ".ssh" / "relay_mynostr_ed25519")
VPS_REMOTE_NS = "onlyboosts"
FLOOR_2025 = 1735689600          # 2025-01-01T00:00:00Z
INCREMENTAL_OVERLAP = 3 * 3600   # re-scan a 3h overlap so nothing slips the seam


def _pi_creds():
    try:
        cfg = load_config(CREDENTIALS)
        return cfg.get("LOCAL_BITCOINERS_INDEX_KEY"), cfg.get("LOCAL_BITCOINERS_INDEX_SECRET")
    except Exception as e:
        print(f"[warn] could not load PI credentials: {e}")
        return None, None


# ── candidate receipt-id extraction (batched, not per-note) ───────────────────
def _candidate_receipt_ids(events):
    ids = set()
    for ev in events:
        for t in ev.get("tags", []):
            if len(t) >= 2 and t[0] in ("q", "e") and isinstance(t[1], str) and len(t[1]) == 64:
                ids.add(t[1])
        for m in _QUOTE_RE.finditer(ev.get("content", "") or ""):
            eid = decode_note_or_nevent(m.group(1))
            if eid:
                ids.add(eid)
    return ids


def _make_page_handler(conn, lock, receipt_cache, totals):
    """Build an on_page(events) callback: batch-resolve receipts, classify, store."""
    def on_page(events):
        cand = _candidate_receipt_ids(events)
        with lock:
            todo = [c for c in cand if c not in receipt_cache]
        if todo:
            fetched = fetch_events_by_ids(todo, RECEIPT_RELAYS)
            with lock:
                for c in todo:
                    receipt_cache[c] = fetched.get(c)
        with lock:
            boosts = []
            for ev in events:
                b = classify_boost(ev, receipt_cache,
                                   receipt_fetch=lambda cid: receipt_cache.get(cid))
                if b:
                    boosts.append(b)
            new = db.upsert_boosts(conn, boosts)
            totals["seen"] += len(events)
            totals["boosts"] += len(boosts)
            totals["new"] += new
    return on_page


# ── backfill ──────────────────────────────────────────────────────────────────
def cmd_backfill(args):
    conn = db.connect(DB_PATH, check_same_thread=False)
    lock = threading.Lock()
    receipt_cache = {}
    totals = {"seen": 0, "boosts": 0, "new": 0}
    floor = args.floor
    now = int(time.time())
    relays = args.relays or CORE_RELAYS

    plan = []
    for r in relays:
        st = db.get_scan_state(conn, r)
        if st and st.get("backfill_cursor") is None and st.get("backfilled_to") and not args.force:
            print(f"[skip] {r} already backfilled to {time.strftime('%Y-%m-%d', time.gmtime(st['backfilled_to']))}")
            continue
        start_until = (st.get("backfill_cursor") if st and st.get("backfill_cursor") else now)
        plan.append((r, start_until))

    if not plan:
        print("Nothing to do — all relays complete (use --force to re-walk).")
        _print_stats(conn)
        return

    print(f"Backfilling {len(plan)} relay(s) to floor "
          f"{time.strftime('%Y-%m-%d', time.gmtime(floor))} (concurrent)")
    on_page = _make_page_handler(conn, lock, receipt_cache, totals)

    def checkpoint_for(relay):
        def cp(cursor, oldest):
            with lock:
                db.set_backfill_cursor(conn, relay, cursor, oldest)
        return cp

    def run_relay(item):
        relay, start_until = item
        return scan_relay_backward(relay, floor, start_until, on_page,
                                   checkpoint_for(relay),
                                   log=lambda m: print(m, flush=True))

    with ThreadPoolExecutor(max_workers=len(plan)) as ex:
        futs = {ex.submit(run_relay, it): it[0] for it in plan}
        for fut in as_completed(futs):
            relay = futs[fut]
            try:
                fut.result()
            except Exception as e:
                print(f"[error] {relay}: {e}", flush=True)
            print(f"  running totals: {totals['seen']} scanned, "
                  f"{totals['boosts']} boosts, {totals['new']} new", flush=True)

    print(f"\nBackfill pass done: {totals['seen']} events scanned, "
          f"{totals['boosts']} classified, {totals['new']} new rows.")
    _print_stats(conn)


# ── incremental tail ──────────────────────────────────────────────────────────
def cmd_incremental(args):
    conn = db.connect(DB_PATH, check_same_thread=False)
    lock = threading.Lock()
    receipt_cache = {}
    totals = {"seen": 0, "boosts": 0, "new": 0}
    relays = args.relays or CORE_RELAYS
    on_page = _make_page_handler(conn, lock, receipt_cache, totals)

    global_since = int(db.get_meta(conn, "last_incremental", 0) or 0)
    since = max(0, global_since - INCREMENTAL_OVERLAP) if global_since else args.floor
    print(f"Incremental since {time.strftime('%Y-%m-%d %H:%M', time.gmtime(since))}")

    newest_overall = since
    for r in relays:
        try:
            newest = scan_relay_incremental(r, since, on_page,
                                            log=lambda m: print(m, flush=True))
            newest_overall = max(newest_overall, newest)
        except Exception as e:
            print(f"[error] {r}: {e}")
    db.set_meta(conn, "last_incremental", newest_overall)
    print(f"Incremental done: {totals['seen']} scanned, {totals['boosts']} boosts, "
          f"{totals['new']} new.")
    _print_stats(conn)


# ── enrichment ────────────────────────────────────────────────────────────────
def cmd_enrich(args):
    conn = db.connect(DB_PATH, check_same_thread=False)
    key, secret = _pi_creds()

    if key and secret:
        shows = db.guids_needing_show(conn)
        print(f"Enriching {len(shows)} show(s) via Podcast Index...")
        for i, pg in enumerate(shows, 1):
            info = enrich.resolve_show(pg, key, secret)
            if info:
                db.upsert_show(conn, info)
            if i % 25 == 0:
                print(f"  shows {i}/{len(shows)}")

        eps = db.guids_needing_episode(conn)
        print(f"Enriching {len(eps)} episode(s)...")
        # map item_guid -> a podcast_guid so we can pass feedid
        for i, ig in enumerate(eps, 1):
            row = conn.execute(
                "SELECT podcast_guid FROM boosts WHERE item_guid=? AND podcast_guid IS NOT NULL LIMIT 1",
                (ig,)).fetchone()
            feed_id = db.feed_id_for_guid(conn, row[0]) if row else None
            info = enrich.resolve_episode(ig, feed_id, key, secret)
            if info:
                db.upsert_episode(conn, info)
            if i % 50 == 0:
                print(f"  episodes {i}/{len(eps)}")
    else:
        print("[warn] no Podcast Index credentials — skipping show/episode enrichment")

    pubkeys = db.pubkeys_needing_profile(conn)
    print(f"Enriching {len(pubkeys)} profile(s) via kind-0...")
    profs = enrich.resolve_profiles(pubkeys, PROFILE_RELAYS,
                                    log=lambda m: print(m, flush=True))
    for pk, prof in profs.items():
        db.upsert_profile(conn, pk, prof)
    print(f"Enrichment done: {len(profs)} profiles resolved.")
    _print_stats(conn)


# ── stats ─────────────────────────────────────────────────────────────────────
def _print_stats(conn):
    s = db.stats(conn)
    def d(ts):
        return time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else "—"
    print("\n── OnlyBoosts index ──")
    print(f"  boosts:      {s['boosts']:>8}   ({d(s['earliest'])} → {d(s['latest'])})")
    print(f"  total sats:  {s['total_sats']:>8}")
    print(f"  shows:       {s['distinct_shows']:>8}   ({s['shows_enriched']} enriched)")
    print(f"  episodes:    {s['distinct_eps']:>8}   ({s['eps_enriched']} enriched)")
    print(f"  boosters:    {s['distinct_boosters']:>8}   ({s['profiles']} profiled)")


def cmd_export(args):
    conn = db.connect(DB_PATH, check_same_thread=False)
    print(f"Exporting shards → {args.out}")
    n = export_mod.export(conn, args.out, latest_n=args.latest_n,
                          per_show=args.per_show,
                          log=lambda m: print(m, flush=True))
    print(f"Export done: {n} boost records.")


def cmd_push(args):
    """rsync the whole shards/ tree to the VPS under the onlyboosts/ namespace.
    Reads VPS host/port/user from credentials.env (never printed). Dry-run first
    is strongly recommended on a host shared with LB's live data."""
    cfg = load_config(CREDENTIALS)
    host, port, user = cfg.get("RELAY_VPS_HOST"), cfg.get("RELAY_VPS_PORT"), cfg.get("RELAY_VPS_USER")
    if not all([host, port, user]):
        print("[error] RELAY_VPS_HOST/PORT/USER missing from credentials.env")
        return
    if not Path(VPS_KEY_FILE).exists():
        print(f"[error] SSH key not found: {VPS_KEY_FILE}")
        return
    shards = Path(args.out)
    if not shards.exists():
        print(f"[error] no shards at {shards} — run `export` first")
        return
    n = sum(1 for _ in shards.rglob("*.json"))
    ssh_cmd = f"ssh -i {VPS_KEY_FILE} -p {port} -o StrictHostKeyChecking=accept-new"
    dest = f"{user}@{host}:{VPS_REMOTE_NS}/"       # relative to the rrsync-forced root
    cmd = ["rsync", "-a", "-e", ssh_cmd, f"{shards}/", dest]
    if args.dry_run:
        cmd[1:1] = ["-n", "-v", "--stats"]
    print(f"{'DRY-RUN ' if args.dry_run else ''}rsync {n} json files → {VPS_REMOTE_NS}/ on the VPS")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except Exception as e:
        print(f"[error] rsync failed to launch: {e}")
        return
    tail = "\n".join(r.stdout.splitlines()[-25:])
    print(tail)
    if r.returncode != 0:
        print(f"[error] rsync exit {r.returncode}: {r.stderr.strip()[-600:]}")
    else:
        print("push OK" if not args.dry_run else "dry-run OK (nothing written)")


def cmd_stats(args):
    _print_stats(db.connect(DB_PATH, check_same_thread=False))


def main():
    ap = argparse.ArgumentParser(description="OnlyBoosts global boost collector")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("backfill", help="deep resumable walk to the floor")
    b.add_argument("--floor", type=int, default=FLOOR_2025,
                   help="oldest created_at to walk to (unix seconds)")
    b.add_argument("--relays", nargs="*", help="override the relay set")
    b.add_argument("--force", action="store_true", help="re-walk relays already complete")
    b.set_defaults(func=cmd_backfill)

    inc = sub.add_parser("incremental", help="forward tail scan")
    inc.add_argument("--floor", type=int, default=FLOOR_2025)
    inc.add_argument("--relays", nargs="*")
    inc.set_defaults(func=cmd_incremental)

    e = sub.add_parser("enrich", help="Podcast Index + profile enrichment")
    e.set_defaults(func=cmd_enrich)

    x = sub.add_parser("export", help="write static JSON shards for the website")
    x.add_argument("--out", default=str(HERE / "data" / "shards"),
                   help="output directory for the shards")
    x.add_argument("--latest-n", type=int, default=1000,
                   help="how many recent boosts in boosts/latest.json")
    x.add_argument("--per-show", action="store_true",
                   help="also write per-show detail shards (full shownotes)")
    x.set_defaults(func=cmd_export)

    pu = sub.add_parser("push", help="rsync shards to the VPS (onlyboosts/ namespace)")
    pu.add_argument("--out", default=str(HERE / "data" / "shards"),
                    help="shards directory to push")
    pu.add_argument("--dry-run", action="store_true",
                    help="show what would transfer without writing anything")
    pu.set_defaults(func=cmd_push)

    s = sub.add_parser("stats", help="print index counts")
    s.set_defaults(func=cmd_stats)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
