#!/usr/bin/env python3
"""OnlyBoosts — global podcast-boost collector.

Subcommands:
  backfill     deep walk every core relay back to the floor (default 2025-01-01),
               resumable per-relay; classify + store boosts.
  incremental  forward tail scan since the last run (for the recurring timer).
  deepscan     recover the pre-k-tag era (before ~2025-04-14) by #i-per-guid and
               authors= walks, iterated to convergence over a historical window.

Every scheduled walk (backfill, incremental, outbox) asks relays with THREE
filter shapes — `#k`, `#i` per known show, `authors` per known booster — since
2026-09-03; see scan.py's docstring for why the `#k` shape alone missed every
StableKraft and Wavlake-app boost. Catching up a window the old single-shape
scan already walked is `backfill --force --floor <ts>`.
  enrich       fill Podcast Index show/episode metadata + kind-0 profiles.
  excludes     validate excludes.json and report what each entry hides.
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
import fcntl
import json
import re
import requests
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "shared"))

import db                                                       # noqa: E402
import enrich                                                   # noqa: E402
import excludes                                                 # noqa: E402
import clients                                                  # noqa: E402
import dedupe                                                   # noqa: E402
import fountain                                                 # noqa: E402
import export as export_mod                                     # noqa: E402
import duration_probe                                           # noqa: E402
import podroll                                                  # noqa: E402
import publishers as publishers_mod                             # noqa: E402
import resolve_guids                                            # noqa: E402
from classify import classify_boost, decode_note_or_nevent, _QUOTE_RE  # noqa: E402
from relays import CORE_RELAYS, PROFILE_RELAYS, RECEIPT_RELAYS, expand_via_outbox  # noqa: E402
from scan import (scan_relay_backward, scan_relay_incremental,   # noqa: E402
                  fetch_events_by_ids, boost_filters)
from collector_common import query_relay                        # noqa: E402
from nostr_utils import load_config                             # noqa: E402

DB_PATH = str(HERE / "data" / "onlyboosts.db")
SHARDS_DIR = HERE / "data" / "shards"   # the tree `push` ships; the publish gate stamps only this one
CREDENTIALS = "/home/reed/.config/nostr-bots/credentials.env"
# Same restricted-rrsync key + VPS LB uses; shards land UNDER an onlyboosts/
# subdir of the rrsync-locked deploy root so they can never collide with LB's
# files sharing that host (relay.mynostr.app, Caddy-served).
VPS_KEY_FILE = str(Path.home() / ".ssh" / "relay_mynostr_ed25519")
VPS_REMOTE_NS = "onlyboosts"
FLOOR_2025 = 1735689600          # 2025-01-01T00:00:00Z
INCREMENTAL_OVERLAP = 3 * 3600   # re-scan a 3h overlap so nothing slips the seam
OUTBOX_CACHE_TTL = 6 * 3600      # re-resolve the booster outbox relay set at most this often
OUTBOX_WINDOW = 26 * 3600        # freshness sweep window over known outbox relays (covers a daily gap)
OUTBOX_RELAYS_CACHE = str(HERE / "data" / "outbox_relays.json")


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


def _podcasty(events):
    """Only notes carrying a NIP-73 podcast i tag can be boosts. The `authors`
    shape returns whole timelines, and classify_boost's first gate is that tag —
    so this is what keeps a booster's ordinary notes from costing a receipt
    lookup each."""
    return [ev for ev in events
            if any(len(t) >= 2 and t[0] == "i" and str(t[1]).startswith("podcast:")
                   for t in ev.get("tags", []))]


def _known_sets(conn):
    """What the k-free filter shapes are built from: every show guid the index
    knows (phantoms and aliases included — old notes carry the same phantom
    shapes guid_aliases was built for) and every booster pubkey. Read once per
    run, so a show or booster first seen this run is covered next run."""
    guids = set()
    for sql in ("SELECT DISTINCT podcast_guid FROM boosts "
                "WHERE podcast_guid IS NOT NULL AND podcast_guid != ''",
                "SELECT DISTINCT canonical_guid FROM boosts "
                "WHERE canonical_guid IS NOT NULL AND canonical_guid != ''",
                "SELECT podcast_guid FROM shows",
                "SELECT raw_guid FROM guid_aliases"):
        guids.update(r[0] for r in conn.execute(sql).fetchall())
    authors = {r[0] for r in conn.execute(
        "SELECT DISTINCT booster_pubkey FROM boosts").fetchall()}
    return {"guids": guids, "authors": authors}


def _make_page_handler(conn, lock, receipt_cache, totals):
    """Build an on_page(events) callback: batch-resolve receipts, classify, store."""
    def on_page(events):
        events = _podcasty(events)
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
        # A resumed walk picks up at its cursor. A FORCED walk starts from now:
        # it exists to re-read a window with a changed filter set, and a stale
        # cursor below the floor would walk nothing and then mark the relay
        # complete (it did, 2026-09-03, on the first catch-up attempt).
        resume = st.get("backfill_cursor") if st and st.get("backfill_cursor") else None
        start_until = now if args.force or not resume else resume
        plan.append((r, start_until))

    if not plan:
        print("Nothing to do — all relays complete (use --force to re-walk).")
        _print_stats(conn)
        return

    filters = boost_filters(_known_sets(conn))
    print(f"Backfilling {len(plan)} relay(s) to floor "
          f"{time.strftime('%Y-%m-%d', time.gmtime(floor))} (concurrent), "
          f"{len(filters)} filter shapes per relay")
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
                                   log=lambda m: print(m, flush=True),
                                   filters=filters)

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
    if not global_since:
        # Never run: seed from the newest boost the backfill already stored, so the
        # first tail scan is a small window — not a re-walk from the floor.
        row = conn.execute("SELECT MAX(created_at) FROM boosts").fetchone()
        global_since = int(row[0]) if row and row[0] else 0
    since = max(args.floor, global_since - INCREMENTAL_OVERLAP) if global_since else args.floor
    filters = boost_filters(_known_sets(conn))
    print(f"Incremental since {time.strftime('%Y-%m-%d %H:%M', time.gmtime(since))}, "
          f"{len(filters)} filter shapes per relay")

    # Relays in parallel: the k-free shapes turned one REQ per relay into
    # several, and the tail scan has a 5-minute budget to fit inside.
    newest_overall = since
    with ThreadPoolExecutor(max_workers=len(relays)) as ex:
        futs = {ex.submit(scan_relay_incremental, r, since, on_page,
                          lambda m: print(m, flush=True), filters): r
                for r in relays}
        for f in as_completed(futs):
            try:
                newest_overall = max(newest_overall, f.result())
            except Exception as e:
                print(f"[error] {futs[f]}: {e}", flush=True)
    db.set_meta(conn, "last_incremental", newest_overall)
    print(f"Incremental done: {totals['seen']} scanned, {totals['boosts']} boosts, "
          f"{totals['new']} new.")
    _print_stats(conn)


# ── outbox expansion ──────────────────────────────────────────────────────────
def _resolve_outbox_relays(conn, now, refresh, log):
    """Core relays ∪ every booster's NIP-65 write relays, cached to disk. Resolving
    ~2k boosters' relay lists is the expensive part, so it's reused within the TTL."""
    if not refresh and Path(OUTBOX_RELAYS_CACHE).exists():
        c = json.loads(Path(OUTBOX_RELAYS_CACHE).read_text())
        if now - c.get("resolved_at", 0) < OUTBOX_CACHE_TTL:
            log(f"Reusing cached outbox set: {len(c['relays'])} relays "
                f"({(now - c['resolved_at']) // 3600}h old)")
            return c["relays"]
    boosters = [r[0] for r in conn.execute("SELECT DISTINCT booster_pubkey FROM boosts").fetchall()]
    log(f"Resolving NIP-65 outbox relays for {len(boosters)} boosters...")
    relays = expand_via_outbox(boosters, CORE_RELAYS, log=log)
    Path(OUTBOX_RELAYS_CACHE).write_text(json.dumps({"resolved_at": now, "relays": relays}))
    return relays


def cmd_outbox(args):
    """Widen coverage beyond the core relays: discover every booster's own write
    relays, deep-walk any we've never scanned (full history, resumable via
    scan_state), then a windowed sweep for recent boosts on the known ones. The
    core relays are already covered by the 15-min incremental, so they're skipped."""
    conn = db.connect(DB_PATH, check_same_thread=False)
    lock = threading.Lock()
    receipt_cache = {}
    totals = {"seen": 0, "boosts": 0, "new": 0}
    now = int(time.time())
    log = lambda m: print(m, flush=True)

    relays = _resolve_outbox_relays(conn, now, args.refresh, log)
    core = {r.rstrip("/") for r in CORE_RELAYS}
    non_core = [r for r in relays if r.rstrip("/") not in core]
    log(f"{len(non_core)} non-core outbox relays (core handled by the incremental timer)")
    on_page = _make_page_handler(conn, lock, receipt_cache, totals)
    filters = boost_filters(_known_sets(conn))

    def checkpoint_for(relay):
        def cp(cursor, oldest):
            with lock:
                db.set_backfill_cursor(conn, relay, cursor, oldest)
        return cp

    # deep-walk relays not yet completed (new ones since last run get full history)
    to_walk = []
    for r in non_core:
        st = db.get_scan_state(conn, r)
        if st and st.get("backfill_cursor") is None and st.get("backfilled_to"):
            continue
        to_walk.append((r, st.get("backfill_cursor") if st and st.get("backfill_cursor") else now))
    log(f"deep-walking {len(to_walk)} new/unfinished relays to floor")
    if to_walk:
        with ThreadPoolExecutor(max_workers=min(24, len(to_walk))) as ex:
            futs = {ex.submit(scan_relay_backward, r, args.floor, s, on_page,
                              checkpoint_for(r), log, 2, filters): r for r, s in to_walk}
            for f in as_completed(futs):
                try:
                    f.result()
                except Exception as e:
                    print(f"[error] {futs[f]}: {e}", flush=True)

    # windowed freshness sweep over all known outbox relays
    since = now - OUTBOX_WINDOW
    log(f"windowed sweep since {time.strftime('%Y-%m-%d %H:%M', time.gmtime(since))} "
        f"over {len(non_core)} relays")
    if non_core:
        with ThreadPoolExecutor(max_workers=24) as ex:
            futs = [ex.submit(scan_relay_incremental, r, since, on_page, lambda m: None,
                              filters)
                    for r in non_core]
            for f in as_completed(futs):
                try:
                    f.result()
                except Exception:
                    pass

    print(f"\nOutbox pass: {totals['seen']} scanned, {totals['boosts']} boosts, "
          f"{totals['new']} new rows.")
    _print_stats(conn)


# ── deep re-scan for the pre-k-tag era ────────────────────────────────────────
# Diagnosed 2026-08-31: Fountain boost notes carried `i` tags with NO `k` tag
# until ~2025-04-14, so the whole i-only era is invisible to the #k scan filter
# on every relay — while relay.fountain.fm retains kind-1s back to late 2022.
# This pass recovers that era two ways, neither needing the k tag: per-guid #i
# queries over every show we know, and authors= walks over every booster we
# know. Recovered boosts name new shows and new boosters, so it iterates until
# convergence. classify_boost reads i tags and fetches quoted zap receipts, so
# no classifier change was needed (measured on one guid's 204 pre-cliff notes:
# 156 classified, 156/156 receipts resolved, 100% sats).
#
# Since 2026-09-03 the same two shapes ride every scheduled walk (scan.py's
# boost_filters), so this command is the HISTORICAL tool: a bounded window,
# convergence rounds, and a resumable state file. The default window still
# ends at KTAG_ADOPTION_UNTIL because everything newer is now covered by the
# recurring scan and was caught up once by `backfill --force --floor` there.
DEEPSCAN_STATE = str(HERE / "data" / "deepscan_state.json")
KTAG_ADOPTION_UNTIL = 1748736000   # 2025-06-01 — the recurring scan covers newer
FLOOR_2022 = 1640995200            # 2022-01-01 — beyond fountain.fm's retention

DEEPSCAN_KINDS = (
    # (state key, filter builder, values per REQ)
    ("guids",   lambda c: {"kinds": [1], "#i": [f"podcast:guid:{g}" for g in c]}, 20),
    ("items",   lambda c: {"kinds": [1], "#i": [p + g for g in c
                           for p in ("podcast:item:guid:", "podcast:guid:")]}, 20),
    ("authors", lambda c: {"kinds": [1], "authors": list(c)}, 50),
)


def _deepscan_known_sets(conn, include_items):
    """Every show guid and booster pubkey the index knows (`_known_sets`, the
    same sets the recurring scan builds its filters from), plus item guids on
    request."""
    known = _known_sets(conn)
    guids, authors = known["guids"], known["authors"]
    items = set()
    if include_items:
        items = {r[0] for r in conn.execute(
            "SELECT DISTINCT item_guid FROM boosts "
            "WHERE item_guid IS NOT NULL AND item_guid != ''").fetchall()}
    return guids, authors, items


def _deepscan_walk(relay, base_filt, until, floor, on_page, max_pages=300,
                   pace=0):
    """Backward until-walk with a caller-supplied filter (the #k walker in
    scan.py hardcodes its filter shape). One empty page is retried once before
    being trusted — a relay timeout also comes back as an empty list. `pace`
    sleeps that many seconds between pages: query_relay opens a fresh WebSocket
    per REQ, and strict nginx fronts (podtards, lexingtonbitcoin) answer
    back-to-back handshakes with 429 — which reads as an empty page and would
    record the gap as 'nothing there'."""
    cursor, empties, pages = until, 0, 0
    while cursor > floor and pages < max_pages:
        if pace and pages:
            time.sleep(pace)
        f = dict(base_filt)
        f["until"], f["limit"] = cursor, 500
        page = query_relay(relay, f, max_wall_seconds=60)
        pages += 1
        if not page:
            empties += 1
            if empties >= 2:
                break
            if pace:
                time.sleep(pace)
            continue
        empties = 0
        on_page(page)
        oldest = min(ev.get("created_at", cursor) for ev in page)
        if oldest >= cursor:
            break                      # relay ignoring `until` — no progress
        cursor = oldest - 1
    return pages


def _deepscan_load_state(until, floor, reset):
    fresh = {"window": [until, floor], "relays": {}}
    if reset or not Path(DEEPSCAN_STATE).exists():
        return fresh
    try:
        st = json.loads(Path(DEEPSCAN_STATE).read_text())
    except Exception:
        return fresh
    if st.get("window") != [until, floor]:
        print("[state] window changed — starting fresh deepscan state")
        return fresh
    return st


def cmd_deepscan(args):
    conn = db.connect(DB_PATH, check_same_thread=False)
    lock = threading.Lock()
    receipt_cache = {}
    totals = {"seen": 0, "boosts": 0, "new": 0}
    months = Counter()
    seen_new = set()
    disc_guids, disc_authors = set(), set()
    log = lambda m: print(m, flush=True)

    # A writing run holds the pipeline lock so the incremental timer's ticks
    # skip (flock -n in run-incremental.sh) instead of contending for SQLite.
    lock_fh = None
    if not args.dry_run:
        lock_fh = open(HERE / "data" / "pipeline.lock", "w")
        log("acquiring pipeline lock (waits for a running cycle to finish)...")
        fcntl.flock(lock_fh, fcntl.LOCK_EX)
        log("pipeline lock held — incremental ticks will skip until this run ends")

    known_guids_0, known_authors_0, _ = _deepscan_known_sets(conn, False)
    state = _deepscan_load_state(args.until, args.floor, args.reset)

    def save_state():
        if not args.dry_run:           # a dry run must not mark work done
            Path(DEEPSCAN_STATE).write_text(json.dumps(state))

    def on_page(events):
        # The author walks return whole timelines; classify_boost's first gate
        # is a podcast i tag, so only those notes can need a receipt lookup.
        podcasty = [ev for ev in events
                    if any(len(t) >= 2 and t[0] == "i"
                           and str(t[1]).startswith("podcast:")
                           for t in ev.get("tags", []))]
        cand = _candidate_receipt_ids(podcasty)
        with lock:
            todo = [c for c in cand if c not in receipt_cache]
        if todo:
            fetched = fetch_events_by_ids(todo, RECEIPT_RELAYS)
            with lock:
                for c in todo:
                    receipt_cache[c] = fetched.get(c)
        with lock:
            boosts = [b for b in (classify_boost(ev, receipt_cache,
                                  receipt_fetch=lambda cid: receipt_cache.get(cid))
                                  for ev in podcasty) if b]
            totals["seen"] += len(events)
            totals["boosts"] += len(boosts)
            fresh = []
            for b in boosts:
                if b["event_id"] in seen_new:
                    continue
                if conn.execute("SELECT 1 FROM boosts WHERE event_id = ?",
                                (b["event_id"],)).fetchone():
                    continue
                seen_new.add(b["event_id"])
                fresh.append(b)
                totals["new"] += 1
                months[time.strftime("%Y-%m", time.gmtime(b["created_at"]))] += 1
                if b.get("podcast_guid"):
                    disc_guids.add(b["podcast_guid"])
                disc_authors.add(b["booster_pubkey"])
            if fresh and not args.dry_run:
                db.upsert_boosts(conn, fresh)

    def relay_job(relay, pending):
        walked = 0
        for kind, mk_filter, per in DEEPSCAN_KINDS:
            vals = pending[kind]
            for i in range(0, len(vals), per):
                chunk = vals[i:i + per]
                _deepscan_walk(relay, mk_filter(chunk), args.until, args.floor,
                               on_page, pace=args.pace)
                walked += 1
                if args.pace:
                    time.sleep(args.pace)
                with lock:
                    state["relays"][relay][kind].extend(chunk)
                    save_state()
                if walked % 5 == 0:
                    log(f"    {relay}: {walked} chunk(s) walked, "
                        f"{totals['new']} new so far")
        return walked

    relays = args.relays or CORE_RELAYS
    rounds = 0
    while rounds < args.max_rounds:
        rounds += 1
        guids, authors, items = _deepscan_known_sets(conn, args.items)
        guids |= disc_guids
        authors |= disc_authors
        jobs, pending_total = [], 0
        for r in relays:
            st = state["relays"].setdefault(
                r, {"guids": [], "authors": [], "items": []})
            pending = {"guids":   sorted(guids - set(st["guids"])),
                       "authors": sorted(authors - set(st["authors"])),
                       "items":   sorted(items - set(st["items"]))}
            if args.max_chunks is not None:
                for (kind, _f, per) in DEEPSCAN_KINDS:
                    pending[kind] = pending[kind][:args.max_chunks * per]
            n = sum(len(v) for v in pending.values())
            pending_total += n
            if n:
                jobs.append((r, pending))
        if not jobs:
            log(f"converged after {rounds - 1} round(s) — nothing left to walk")
            break
        log(f"round {rounds}: {len(jobs)} relay(s), {pending_total} pending "
            f"values ({len(guids)} guids / {len(authors)} authors"
            + (f" / {len(items)} items" if items else "") + ")")
        with ThreadPoolExecutor(max_workers=min(12, len(jobs))) as ex:
            futs = {ex.submit(relay_job, r, p): r for r, p in jobs}
            for f in as_completed(futs):
                try:
                    f.result()
                except Exception as e:
                    log(f"  [error] {futs[f]}: {e}")
        if args.max_chunks is not None:
            break                      # debug mode: one bounded pass only

    verb = "would add" if args.dry_run else "added"
    log(f"\nDeepscan: {totals['seen']} notes scanned, {totals['boosts']} "
        f"classified as boosts, {verb} {totals['new']} new rows")
    if months:
        log("new rows by month:")
        for m in sorted(months):
            log(f"  {m}  {months[m]}")
    new_shows = disc_guids - known_guids_0
    new_boosters = disc_authors - known_authors_0
    log(f"previously unknown shows: {len(new_shows)}, "
        f"previously unknown boosters: {len(new_boosters)}")
    if not args.dry_run:
        log("\nnext: resolve-guids → dedupe --all → enrich → export → push → "
            "d1_sync --remote-delta (one manual run-incremental.sh covers all "
            "but the wide dedupe)")
    if lock_fh:
        lock_fh.close()
    _print_stats(conn)


# ── targeted re-scan of one feed ──────────────────────────────────────────────
def cmd_rescan(args):
    """Re-fetch one feed's kind-1 notes by its NIP-73 podcast:guid tag and
    re-classify with the current rules. Use after a classifier change or once a
    client starts tagging correctly. Dedup leaves already-stored boosts untouched;
    only newly-classifiable notes are added."""
    conn = db.connect(DB_PATH, check_same_thread=False)
    i_val = f"podcast:guid:{args.feed}"
    now = int(time.time())
    log = lambda m: print(m, flush=True)
    relays = args.relays or CORE_RELAYS
    log(f"Re-scanning {i_val} across {len(relays)} relays back to "
        f"{time.strftime('%Y-%m-%d', time.gmtime(args.floor))}")

    seen = {}
    for relay in relays:
        cursor, pages = now, 0
        while cursor > args.floor:
            page = query_relay(relay, {"kinds": [1], "#i": [i_val],
                                       "until": cursor, "limit": 500},
                               max_wall_seconds=45)
            pages += 1
            if not page:
                break
            for ev in page:
                if ev.get("id"):
                    seen[ev["id"]] = ev
            oldest = min(ev.get("created_at", cursor) for ev in page)
            if oldest >= cursor or len(page) < 500:
                break
            cursor = oldest - 1
        log(f"  {relay}: {pages} page(s)")
    events = list(seen.values())
    log(f"fetched {len(events)} distinct kind-1 notes tagged {i_val}")

    receipt_cache = {}
    cand = _candidate_receipt_ids(events)
    fetched = fetch_events_by_ids(list(cand), RECEIPT_RELAYS)
    for c in cand:
        receipt_cache[c] = fetched.get(c)
    boosts = [b for b in (classify_boost(ev, receipt_cache,
                          receipt_fetch=lambda cid: receipt_cache.get(cid))
                          for ev in events) if b]
    new = db.upsert_boosts(conn, boosts)
    log(f"{len(boosts)} classified as boosts, {new} NEW rows added")
    _print_stats(conn)


# ── phantom-guid resolution ───────────────────────────────────────────────────
def cmd_resolve_guids(args):
    """Map phantom podcast_guids (feed ids / item guids / freeform slugs) onto the
    real show guid and materialize them onto boosts.canonical_guid. Runs before
    enrich/export/d1_sync so corrections flow through the same cycle."""
    conn = db.connect(DB_PATH, check_same_thread=False)
    key, secret = _pi_creds()
    resolve_guids.resolve_all(conn, key, secret, log=lambda m: print(m, flush=True))
    # Re-key first, exclusion second: a boost that just moved onto an excluded
    # show's real guid is only excluded once its canonical guid says so, and the
    # projection this connection did on open predates that move.
    moved = db.apply_excludes(conn)
    if moved:
        print(f"exclusion list: {moved} boost(s) changed state after re-keying")
    _print_stats(conn)


def cmd_durations(args):
    """Derive durations for boosted episodes that have none — the #40HPW
    evenness pass. Ladder per episode, each rung only when the one above
    returned nothing usable:

      1. the feed's own <itunes:duration>            (src 'rss')
      2. an ENDED <podcast:liveItem>'s window        (src 'live')
      3. the enclosure's MPEG headers, one 64KB read (src 'probe')

    Writes go through db.set_episode_duration, which refuses to touch a row
    already holding a publisher-declared duration; misses stamp
    duration_checked_at and retry after db.DURATION_RETRY. Politeness follows
    podroll.py's lesson: never two consecutive requests to one host without a
    pause, and a network failure is a cooldown, never a negative answer.
    """
    conn = db.connect(DB_PATH, check_same_thread=False)
    rows = db.episodes_needing_duration(conn, limit=(0 if args.all else args.limit))
    if not rows:
        print("durations: nothing due")
        return
    print(f"durations: {len(rows)} boosted episode(s) with no usable duration due")
    from urllib.parse import urlsplit
    session = requests.Session()
    host_last = {}

    def polite(url):
        host = urlsplit(url).netloc.lower()
        wait = 0.7 - (time.time() - host_last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        host_last[host] = time.time()

    # Rungs 1+2: one fetch per distinct feed, however many episodes it owes.
    by_feed = {}
    for r in rows:
        if r["feed_url"]:
            by_feed.setdefault(r["feed_url"], []).append(r)
    declared = {}       # item_guid -> (seconds, src)
    rss_enclosures = {} # enclosure recovered from RSS for rows whose DB has none
    for i, (fu, wanted) in enumerate(by_feed.items(), 1):
        polite(fu)
        xml = enrich.fetch_feed(fu, session)
        if xml is None:
            print(f"  rss [{i}/{len(by_feed)}] unreachable ({len(wanted)} ep): {fu}")
            continue
        eps = enrich.parse_feed_episodes(xml)
        hits = 0
        for w in wanted:
            info = eps.get(w["item_guid"])
            if info and info.get("duration"):
                declared[w["item_guid"]] = (info["duration"],
                                            info.get("duration_src") or "rss")
                hits += 1
            elif info and info.get("enclosure_url") and not w["enclosure_url"]:
                rss_enclosures[w["item_guid"]] = info["enclosure_url"]
        print(f"  rss [{i}/{len(by_feed)}] {hits}/{len(wanted)} declared: {fu}")

    # Rung 3: probe the enclosure.
    probed, net_fail = {}, 0
    for r in rows:
        ig = r["item_guid"]
        if ig in declared:
            continue
        url = r["enclosure_url"] or rss_enclosures.get(ig)
        if not url:
            continue
        polite(url)
        secs, how = duration_probe.probe_enclosure_duration(url, session)
        name = (r["title"] or ig)[:60]
        if secs:
            probed[ig] = (secs, "probe")
            print(f"  probe [{how}] {secs}s ({secs / 3600:.2f}h): {name}")
        else:
            net_fail += how == "fetch"
            print(f"  probe [{how}]: {name}  [{url[:70]}]")

    results = {**declared, **probed}
    if args.dry_run:
        print(f"[dry-run] would fill {len(results)} of {len(rows)} "
              f"({len(declared)} declared, {len(probed)} probed); no writes")
        return
    filled = sum(bool(db.set_episode_duration(conn, ig, secs, s))
                 for ig, (secs, s) in results.items())
    for r in rows:
        if r["item_guid"] not in results:
            db.mark_duration_checked(conn, r["item_guid"])
    print(f"durations: {filled} filled ({len(declared)} declared in feed, "
          f"{len(probed)} probed), {len(rows) - len(results)} unresolved "
          f"({net_fail} network), retry in {db.DURATION_RETRY // 86400}d")


def cmd_fountain_shows(args):
    """Identify shows through Fountain when Podcast Index couldn't.

    Targets exactly the dead end the raw-RSS fallback can't open: an episode we
    hold boosts for whose SHOW we never resolved, so there's no feed to read. The
    boost's fountain.fm URL is the only handle left. Per unresolved show:

        episode page -> its show's RSS url -> the real show (PI, else Fountain)

    and, because the podcast_guid on those boosts is typically a client-minted
    phantom, the phantom is recorded as an alias of the real guid so every boost
    under it re-keys onto the real show. One episode page per SHOW, not per
    episode — the feed url is a property of the show.

    Deliberately its own command rather than a step inside `enrich`: it scrapes a
    third-party page, so it stays out of the 5-minute cycle until it has earned
    its place there.
    """
    conn = db.connect(DB_PATH, check_same_thread=False)
    key, secret = _pi_creds()
    eg = db.effective_guid("b")

    # One representative fountain.fm URL per unresolved show, worst-first by sats.
    rows = conn.execute(f"""
        SELECT {eg} AS pg, b.item_url,
               COUNT(DISTINCT b.item_guid) AS eps, SUM(b.sats) AS sats
        FROM boosts b
        LEFT JOIN episodes e ON e.item_guid = b.item_guid
        WHERE b.item_guid IS NOT NULL AND e.item_guid IS NULL
          AND {eg} IS NOT NULL
          AND b.item_url LIKE '%fountain.fm/%'
          AND NOT EXISTS (SELECT 1 FROM shows s
                          WHERE s.podcast_guid = {eg} AND s.feed_url IS NOT NULL)
        GROUP BY {eg} ORDER BY sats DESC""").fetchall()
    if args.limit:
        rows = rows[:args.limit]
    print(f"Fountain show resolution: {len(rows)} unresolved show(s) with a Fountain URL")

    session = requests.Session()
    resolved = aliased = 0
    for i, r in enumerate(rows, 1):
        html = fountain.fetch_episode_page(r["item_url"], session)
        feed_url = fountain.feed_url_from_page(html)
        if not feed_url:
            print(f"  [{i}/{len(rows)}] {r['pg'][:20]}… no feed url on {r['item_url']}")
            continue
        # Podcast Index first — it returns the richer record (medium, itunes_id,
        # artwork). Fountain's own row is the fallback and carries the guid too.
        show = enrich.resolve_feed_by_url(feed_url, key, secret) if key else None
        via = "pi-byfeedurl"
        if not show:
            show = fountain.show_by_feed_url(feed_url)
            via = "fountain-podcasts"
        if not show:
            print(f"  [{i}/{len(rows)}] {r['pg'][:20]}… feed {feed_url} resolved by neither")
            continue
        db.upsert_show(conn, show, discovered_via="fountain")
        resolved += 1
        real = show["podcast_guid"]
        note = ""
        if real != r["pg"]:
            db.upsert_alias(conn, r["pg"], real, f"fountain-episode-rss/{via}")
            aliased += 1
            note = f"  (alias {r['pg'][:12]}… -> {real[:12]}…)"
        print(f"  [{i}/{len(rows)}] {show['title']!r} via {via}, "
              f"{r['eps']} episode(s), {r['sats'] or 0:,} sats{note}")

    rekeyed = db.apply_aliases(conn) if aliased else 0
    print(f"Fountain show resolution: {resolved} show(s) identified, "
          f"{aliased} phantom guid(s) aliased, {rekeyed} boost(s) re-keyed")
    if resolved:
        print("  run `enrich` next — those shows now have a feed to read episodes from")
    _print_stats(conn)


# ── enrichment ────────────────────────────────────────────────────────────────
def _refresh_shows(conn, key, secret):
    """Re-read show-level metadata — title, art, feed URL, medium, author,
    language — for the shows db.shows_needing_refresh hands back, on the same
    daily/monthly cadence as their episodes. The first-fetch loop above only
    ever sees a show ONCE; this is what notices a publisher changing the cover.

    Same rule as the episode refresh: a Podcast Index miss on a row we already
    hold is a failed look, not news, so the row is kept and only `checked_at`
    moves. There is no RSS fallback here for the reasons _enrich_episodes gives.
    """
    recent_due, old_due = db.show_refresh_backlog(conn)
    shows = db.shows_needing_refresh(conn)
    print(f"Refreshing {len(shows)} show(s) via Podcast Index "
          f"({recent_due} recent, {old_due} dormant due)...")
    changed = missed = 0
    for pg in shows:
        info = enrich.resolve_show(pg, key, secret)
        if info:
            changed += bool(db.upsert_show(conn, info))
        else:
            db.mark_show_checked(conn, pg)
            missed += 1
    if shows:
        print(f"  shows: {changed} row(s) changed, {missed} refresh(es) found nothing (row kept)")
    if len(shows) >= db.SHOW_BATCH:
        print(f"  show refresh capped at {db.SHOW_BATCH}; "
              f"{recent_due + old_due - len(shows)} left for the next pass")


def _enrich_episodes(conn, key, secret, eps=None):
    """Resolve episode metadata for whatever `db.guids_needing_episode` hands back.

    ⚠️ A FIRST FETCH AND A REFRESH ARE NOT THE SAME PASS, and the split is the
    whole of why this function is not one loop:

    | | first fetch (`known` 0) | refresh (`known` 1) |
    |---|---|---|
    | Podcast Index answers | store it | store it |
    | Podcast Index misses | fall back to the publisher's RSS, then negative-cache | **leave the row alone** |

    The refresh half deliberately does NOT reach the raw-RSS fallback. Two
    reasons, and both are about not turning a metadata refresh into a crawl:

    - **Data.** The fallback exists for episodes we have nothing for — live items
      PI never indexes, items it has not caught up with. Every one of those keeps
      its row on a refresh, and a PI miss on a row we already hold is a failed
      look, not news that the episode changed. Rewriting it from a second source
      is how a good row gets replaced by a thinner one.
    - **Traffic.** It is one RSS fetch per feed per pass. On the first-fetch path
      that is bounded by how many new episodes were boosted; on the refresh path
      it would be every feed holding a live item, every 30 days, forever, and it
      would owe podroll.py's serial-per-host politeness rule a lot more care than
      a fallback batched behind a PI loop currently takes.

    A refresh that misses still bumps `checked_at` (db.mark_episode_checked), or
    the same rows fill the cap on every tick for ever.
    """
    if eps is None:
        new_due, stale_due = db.episode_refresh_backlog(conn)
        eps = db.guids_needing_episode(conn)
        print(f"Enriching {len(eps)} episode(s) "
              f"({new_due} never fetched, {stale_due} stale)...")
    else:
        new_due = stale_due = None
        print(f"Enriching {len(eps)} episode(s)...")

    # map item_guid -> its show's canonical guid so we can pass feedid
    eg = db.effective_guid("boosts")
    rss_pending = {}      # feed_url -> [{item_guid, podcast_guid, feed_id, show_image}]
    rss_unreachable = []  # PI missed it and we have no feed to fall back to
    changed = refreshed_miss = 0
    for i, (ig, known) in enumerate(eps, 1):
        row = conn.execute(
            f"SELECT {eg} AS g FROM boosts WHERE item_guid=? AND {eg} IS NOT NULL LIMIT 1",
            (ig,)).fetchone()
        pg = row[0] if row else None
        feed_id = db.feed_id_for_guid(conn, pg) if pg else None
        info = enrich.resolve_episode(ig, feed_id, key, secret)
        if info:
            changed += bool(db.upsert_episode(conn, info))
            # Rung 1 of the duration ladder: PI answered but with no usable
            # duration — `duration: 0` is PI faithfully reporting a feed that
            # declares none in the fields IT reads, yet the feed itself still
            # gets a say (<itunes:duration>, or an ended liveItem's window).
            # First-fetch only, the same batched one-fetch-per-feed path the
            # full fallback rides; the refresh path stays out of RSS for the
            # documented traffic reasons, and stored rows are the `durations`
            # command's job.
            if not known and not info.get("duration"):
                show = db.show_feed_for_guid(conn, pg) if pg else None
                if show and show["feed_url"]:
                    rss_pending.setdefault(show["feed_url"], []).append(
                        {"item_guid": ig, "podcast_guid": pg, "feed_id": feed_id,
                         "show_image": show["image"], "duration_only": True})
        elif known:
            # A refresh that found nothing. The stored row stands; record the look.
            db.mark_episode_checked(conn, ig)
            refreshed_miss += 1
        else:
            # Don't negative-cache yet — the publisher's own feed still gets
            # a say (live items and not-yet-indexed episodes are invisible to
            # PI but present in the RSS). Batched below, one fetch per feed.
            show = db.show_feed_for_guid(conn, pg) if pg else None
            if show and show["feed_url"]:
                rss_pending.setdefault(show["feed_url"], []).append(
                    {"item_guid": ig, "podcast_guid": pg, "feed_id": feed_id,
                     "show_image": show["image"]})
            else:
                rss_unreachable.append(ig)
        if i % 50 == 0:
            print(f"  episodes {i}/{len(eps)}")

    db.mark_enrich_failed(conn, "episode", rss_unreachable)
    if rss_pending:
        chasing = sum(len(v) for v in rss_pending.values())
        print(f"  raw-RSS fallback: {chasing} episode(s) PI missed, across "
              f"{len(rss_pending)} feed(s)")
        found = enrich.resolve_episodes_from_feeds(rss_pending, log=print)
        dur_only = {w["item_guid"] for wanted in rss_pending.values()
                    for w in wanted if w.get("duration_only")}
        for ig2, info in found.items():
            if ig2 in dur_only:
                # The PI row just stored is the better record; the feed was
                # consulted for its duration alone. A full upsert here would
                # replace a good row with a thinner one.
                if info.get("duration"):
                    changed += bool(db.set_episode_duration(
                        conn, ig2, info["duration"],
                        info.get("duration_src") or "rss"))
                else:
                    db.mark_duration_checked(conn, ig2)
            else:
                changed += bool(db.upsert_episode(conn, info))
        for ig2 in dur_only - set(found):
            # The feed had no such item (or was unreachable): the duration chase
            # is what failed, not the enrichment — cool it down, don't
            # negative-cache the episode.
            db.mark_duration_checked(conn, ig2)
        still_missing = [w["item_guid"] for wanted in rss_pending.values()
                         for w in wanted if w["item_guid"] not in found
                         and not w.get("duration_only")]
        db.mark_enrich_failed(conn, "episode", still_missing)
        print(f"  raw-RSS fallback: recovered {len(found)}, "
              f"{len(still_missing)} still unresolved")

    # `changed` is the number the D1 metadata-drift pass will carry, NOT the
    # number we looked at — the point of the two-timestamp split is that most
    # refreshes are a no-op downstream. Saying both makes a silent sweep legible.
    print(f"  episodes: {changed} row(s) changed, {refreshed_miss} refresh(es) "
          f"found nothing (row kept)")
    if new_due is not None and len(eps) >= db.EPISODE_BATCH:
        print(f"  episode queue capped at {db.EPISODE_BATCH}; "
              f"{new_due + stale_due - len(eps)} left for the next pass")
    return changed


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
            else:
                db.mark_enrich_failed(conn, "show", pg)   # negative-cache: don't re-query weekly+
            if i % 25 == 0:
                print(f"  shows {i}/{len(shows)}")

        _enrich_episodes(conn, key, secret)
        _refresh_shows(conn, key, secret)
    else:
        print("[warn] no Podcast Index credentials — skipping show/episode enrichment")

    # Capped per pass, new pubkeys first — see db.pubkeys_needing_profile. The
    # backlog is printed rather than inferred from the count: a full batch means
    # "there is more", and that is worth saying out loud on a pass that is
    # deliberately not finishing the job.
    new_due, stale_due = db.profile_refresh_backlog(conn)
    pubkeys = db.pubkeys_needing_profile(conn)
    print(f"Enriching {len(pubkeys)} profile(s) via kind-0 "
          f"({new_due} never fetched, {stale_due} stale)...")
    profs = enrich.resolve_profiles(pubkeys, PROFILE_RELAYS,
                                    log=lambda m: print(m, flush=True))
    for pk, prof in profs.items():
        db.upsert_profile(conn, pk, prof)
    missed = [pk for pk in pubkeys if pk not in profs]
    if missed:
        db.mark_enrich_failed(conn, "profile", missed)     # no kind-0 found this pass
    print(f"Enrichment done: {len(profs)} profiles resolved, {len(missed)} negative-cached.")
    if len(pubkeys) >= db.PROFILE_BATCH:
        print(f"  profile queue capped at {db.PROFILE_BATCH}; "
              f"{new_due + stale_due - len(pubkeys)} left for the next pass")
    _print_stats(conn)


def cmd_reenrich_episodes(args):
    """Re-read episode metadata now, rather than waiting on the natural cadence.

    The refresh gate turns the corpus over about monthly, which is the right
    cadence for drift nobody is watching and the wrong one for a publisher who
    has just corrected their feed and wants to see it. `--guid` / `--show` bypass
    the age gate for exactly that; a bare run just pulls the next capped batch
    forward, the same work the incremental tick would have done.

    ⚠️ Nothing here reaches D1 by itself. A changed row rides the metadata-drift
    pass, which selects on `updated_at` — which is why upsert_episode only moves
    that on a real change. That pass has NO flag of its own: it runs inside
    `d1_sync.py --remote-delta`, unconditionally, on every incremental tick. So a
    correction reaches the site within five minutes on its own, and running that
    command by hand is only how you make it sooner.
    """
    conn = db.connect(DB_PATH, check_same_thread=False)
    key, secret = _pi_creds()
    if not (key and secret):
        print("[error] no Podcast Index credentials — nothing to re-read")
        return
    eps = db.guids_needing_episode(conn, limit=args.limit,
                                   only_guids=args.guid or None, only_show=args.show)
    if not eps:
        print("re-enrich: nothing due")
        return
    changed = _enrich_episodes(conn, key, secret, eps=eps)
    if changed:
        print("  the next incremental tick carries these to /api/v1; "
              "`python3 d1_sync.py --remote-delta` does it now")


# ── podroll ───────────────────────────────────────────────────────────────────
def cmd_podroll(args):
    """Refresh <podcast:podroll> for every indexed show, then resolve the shows it
    points at so each recommendation can render as a real card.

    The ONLY pass that fetches third-party RSS — Podcast Index carries no podroll.
    Weekly, not hourly: a podroll changes when a publisher edits their feed, never
    when a boost arrives, so re-crawling ~900 feeds on the incremental tick would
    be a lot of other people's bandwidth for no new data. Read-only outward."""
    conn = db.connect(DB_PATH, check_same_thread=False)
    rows = db.shows_needing_podroll(conn, max_age=args.max_age, retry_age=args.retry_age,
                                    only_boosted=not args.include_podroll_shows)
    if not rows:
        print("podroll: every feed checked within the freshness window — nothing to do")
        return
    print(f"Podroll: fetching {len(rows)} feed(s)...")
    t0 = time.time()
    results = podroll.probe_feeds(rows, log=lambda m: print(m, flush=True))
    counts, edges = _store_podroll(conn, results)

    # One retry sweep for the reads that never completed. By now the whole main
    # pass has elapsed, so a host that rate-limited us has had minutes of quiet —
    # and the alternative is a transient 429 blinding one show until next week.
    retry = [r for r in results
             if r["items"] is None and r["status"].startswith(db.PODROLL_TRANSIENT)]
    if retry:
        print(f"  retrying {len(retry)} incomplete read(s)...")
        again = podroll.probe_feeds(retry, log=lambda m: print(m, flush=True))
        c2, e2 = _store_podroll(conn, again)
        for k, v in c2.items():
            counts[k] = counts.get(k, 0) + v
        edges += e2
        print("  after retry: " + ", ".join(f"{k}={v}" for k, v in sorted(c2.items())))

    print(f"  fetched in {time.time() - t0:.0f}s — "
          + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print(f"  {edges} recommendation(s) stored")

    # Resolve the targets. Without this a podroll card has a guid and nothing to
    # show; ~96% of un-indexed targets come back from PI with a title and artwork.
    key, secret = _pi_creds()
    todo = db.podroll_targets_needing_show(conn)
    if not (key and secret):
        print(f"[warn] no Podcast Index credentials — {len(todo)} target(s) left unresolved")
    elif todo:
        print(f"Resolving {len(todo)} podroll target(s) via Podcast Index...")
        # 4 workers: concurrent PI sweeps get rate-limited into silent failures
        # that look exactly like "no such feed".
        with ThreadPoolExecutor(max_workers=4) as ex:
            found = list(ex.map(lambda g: (g, enrich.resolve_show(g, key, secret)), todo))
        ok = 0
        for guid, info in found:
            if info:
                # 'podroll' provenance: these have no boosts, so they appear in no
                # export row or D1 projection — they exist to title a card.
                db.upsert_show(conn, info, discovered_via="podroll")
                ok += 1
            else:
                db.mark_enrich_failed(conn, "show", guid)
        print(f"  resolved {ok}/{len(todo)}")
    _print_podroll_stats(conn)


def _store_podroll(conn, results):
    """Persist a sweep's results. Returns ({status: count}, edges stored)."""
    counts, edges = {}, 0
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        # Only a clean read may rewrite the stored list. A 429/timeout/truncation
        # is us failing to see the feed, not the publisher removing their podroll,
        # and treating the two alike would delete real data on a bad network day.
        if r["items"] is not None:
            db.replace_podroll(conn, r["podcast_guid"], r["items"])
            edges += len(r["items"])
            # The publisher link rides the same clean read (parse_publisher).
            # set_show_publisher bumps updated_at only when the link moved, which
            # is what carries it to D1 on the metadata-drift pass.
            pub = r.get("publisher") or {}
            db.set_show_publisher(conn, r["podcast_guid"],
                                  pub.get("guid"), pub.get("url"))
        db.mark_podroll_checked(conn, r["podcast_guid"], r["status"])
    conn.commit()
    return counts, edges


def _print_podroll_stats(conn):
    # `IN (boosted)` rather than a correlated EXISTS — the effective guid is a
    # COALESCE no index can serve, so EXISTS re-scans every boost per row.
    boosted = (f"SELECT DISTINCT {db.effective_guid('')} FROM boosts "
               f"WHERE podcast_guid IS NOT NULL")
    one = lambda q: conn.execute(q).fetchone()[0]                    # noqa: E731
    print("\n── podroll ──")
    print(f"  shows with a podroll:  {one('SELECT COUNT(DISTINCT source_guid) FROM podroll'):>6}")
    print(f"  recommendation edges:  {one('SELECT COUNT(*) FROM podroll'):>6}")
    print(f"  distinct targets:      {one('SELECT COUNT(DISTINCT target_guid) FROM podroll'):>6}")
    print(f"  targets we can link:   "
          f"{one(f'SELECT COUNT(DISTINCT target_guid) FROM podroll WHERE target_guid IN ({boosted})'):>6}")
    print(f"  pages gaining a section (either direction): "
          f"{one(f'''SELECT COUNT(*) FROM (SELECT DISTINCT source_guid AS g FROM podroll
                     UNION SELECT target_guid FROM podroll WHERE target_guid IS NOT NULL) x
                     WHERE x.g IN ({boosted})'''):>6}")


# ── publishers ────────────────────────────────────────────────────────────────
def cmd_publishers(args):
    """Fetch the publisher (artist) feeds album feeds declare — publishers.py
    carries the design record. Extraction of the LINKS rides the podroll sweep;
    this pass resolves the publisher feeds those links point at, and the albums
    they list. Read-only outward; --dry-run fetches and writes nothing."""
    conn = db.connect(DB_PATH, check_same_thread=False)
    rows = db.publishers_needing_fetch(conn, max_age=args.max_age,
                                       retry_age=args.retry_age)
    if not rows:
        print("publishers: every linked publisher checked within the freshness window")
    else:
        print(f"Publishers: fetching {len(rows)} feed(s)...")
        t0 = time.time()
        results = publishers_mod.probe_publishers(rows, log=lambda m: print(m, flush=True))
        counts = Counter(r["status"] for r in results)
        summary = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        if args.dry_run:
            print(f"  [dry-run] fetched in {time.time() - t0:.0f}s — {summary}; nothing written")
            for r in results:
                m = r["meta"] or {}
                print(f"    {r['status']:<14} {(m.get('title') or '—')[:32]:<34} "
                      f"{len(r['albums'] or []):>3} album(s)  {r['feed_url']}")
            return
        mismatch = 0
        for r in results:
            if r["meta"] is not None:
                claimed = r["meta"].pop("publisher_guid", None)
                if claimed and claimed != r["publisher_guid"]:
                    mismatch += 1
                db.upsert_publisher(conn, {**r["meta"],
                                           "publisher_guid": r["publisher_guid"],
                                           "feed_url": r["feed_url"]})
                db.replace_publisher_albums(conn, r["publisher_guid"], r["albums"] or [])
            db.mark_publisher_checked(conn, r["publisher_guid"], r["status"])
        conn.commit()
        print(f"  fetched in {time.time() - t0:.0f}s — {summary}")
        if mismatch:
            print(f"  [warn] {mismatch} feed(s) claim a different podcast:guid than the "
                  f"one album feeds link them by (stored under the linked guid)")
        # Podcast Index fallback for feeds we could not read. PI knows the
        # Fountain/RSS Blue publisher feeds and NOT Wavlake's (measured; see
        # publishers.py), so this fills failures, never replaces the fetch. The
        # stored status keeps the fetch outcome so transients still retry.
        failed = [r for r in results
                  if r["meta"] is None and r["status"] != "not-publisher"]
        key, secret = _pi_creds()
        if failed and key and secret:
            ok = 0
            for r in failed:
                info = enrich.resolve_show(r["publisher_guid"], key, secret)
                if info and (info.get("medium") or "").lower() == "publisher":
                    db.upsert_publisher(conn, {
                        "publisher_guid": r["publisher_guid"],
                        "feed_url": info.get("feed_url") or r["feed_url"],
                        "title": info.get("title"), "image": info.get("image"),
                        "artwork": info.get("artwork"), "description": None})
                    ok += 1
            conn.commit()
            if ok:
                print(f"  Podcast Index fallback titled {ok}/{len(failed)} unreadable feed(s)")

    # Resolve listed albums we hold no shows row for, so a publisher's album
    # list can render titled — discovered_via='publisher', the podroll-targets
    # idea. Capped: a publisher lists its whole catalogue.
    if args.resolve_albums:
        todo = db.publisher_albums_needing_show(conn, limit=args.resolve_albums)
        key, secret = _pi_creds()
        if todo and not (key and secret):
            print(f"[warn] no Podcast Index credentials — {len(todo)} album(s) left unresolved")
        elif todo:
            print(f"Resolving {len(todo)} listed album(s) via Podcast Index...")
            # 4 workers: concurrent PI sweeps get rate-limited into silent
            # failures that look exactly like "no such feed".
            with ThreadPoolExecutor(max_workers=4) as ex:
                found = list(ex.map(lambda g: (g, enrich.resolve_show(g, key, secret)), todo))
            ok = 0
            for guid, info in found:
                if info:
                    db.upsert_show(conn, info, discovered_via="publisher")
                    ok += 1
                else:
                    db.mark_enrich_failed(conn, "show", guid)
            print(f"  resolved {ok}/{len(todo)}")
    _print_publisher_stats(conn)


def _print_publisher_stats(conn):
    from urllib.parse import urlparse
    one = lambda q: conn.execute(q).fetchone()[0]                    # noqa: E731
    print("\n── publishers ──")
    print(f"  shows declaring a publisher: "
          f"{one('SELECT COUNT(*) FROM shows WHERE publisher_guid IS NOT NULL'):>5}")
    for med, n, tot in conn.execute(
            """SELECT COALESCE(medium,'podcast') m,
                      SUM(CASE WHEN publisher_guid IS NOT NULL THEN 1 ELSE 0 END),
                      COUNT(*)
               FROM shows WHERE feed_url IS NOT NULL AND podroll_checked_at IS NOT NULL
               GROUP BY m ORDER BY 3 DESC""").fetchall():
        print(f"    {med:<10} {n:>4} of {tot:>4} swept feeds")
    print(f"  distinct publishers linked:  "
          f"{one('SELECT COUNT(DISTINCT publisher_guid) FROM shows WHERE publisher_guid IS NOT NULL'):>5}")
    print(f"  publisher feeds resolved:    "
          f"{one('SELECT COUNT(*) FROM publishers WHERE title IS NOT NULL'):>5}")
    print(f"  album edges listed:          "
          f"{one('SELECT COUNT(*) FROM publisher_albums'):>5}")
    print(f"  …to shows we index:          "
          f"{one('SELECT COUNT(*) FROM publisher_albums WHERE album_guid IN (SELECT podcast_guid FROM shows)'):>5}")
    print("  per-host linkage:")
    hosts = Counter(urlparse(r[0]).netloc.lower() for r in conn.execute(
        "SELECT publisher_feed_url FROM shows WHERE publisher_feed_url IS NOT NULL"))
    for host, n in hosts.most_common(10):
        print(f"    {host:<30} {n:>4}")


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


def _is_shards_dir(path):
    return Path(path).resolve() == SHARDS_DIR.resolve()


def cmd_export(args):
    conn = db.connect(DB_PATH, check_same_thread=False)
    # The publish gate: a full export into the tree `push` ships records what
    # the shards were built from. A feed-only export leaves the per-show
    # shards behind the index, and a scratch --out is somebody's diff test, so
    # neither is recorded. The digest is taken BEFORE the reads: a write that
    # lands between the two then shows up as "changed" next cycle and costs one
    # spare export, where taking it after would record a state the shards do
    # not hold and skip the export that fixes it.
    stamp = args.per_show and _is_shards_dir(args.out)
    fp = db.content_fingerprint(conn) if stamp else None
    print(f"Exporting shards → {args.out}")
    n = export_mod.export(conn, args.out, latest_n=args.latest_n,
                          per_show=args.per_show,
                          log=lambda m: print(m, flush=True))
    if stamp:
        db.set_meta(conn, db.EXPORT_FP_KEY, fp)
    print(f"Export done: {n} boost records.")


def cmd_publish_due(args):
    """The publish gate for run-incremental.sh: exit 0 when the shards need
    exporting and pushing, 1 when the index is unchanged since the last full
    export AND that export reached the VPS. One line of stdout says which.

    Three things make it due, checked in order: no export on record (a fresh
    box, or the first cycle after this gate shipped); the live digest differs
    from the exported one (a new boost, an enrichment, a dedupe mark, an
    edited excludes.json — every connect re-applies the list, so the flags
    are already in the digest by the time this runs); or the exported digest
    is not the pushed one (the last rsync failed, and `push` reports that with
    a message and exit 0, so this is what retries it).

    ⚠️ FAILS OPEN. A gate that breaks must cost CPU, never freshness, so any
    exception here is "due", not "skip" — a traceback's exit 1 would otherwise
    read to the shell as "nothing to do" on every cycle until someone noticed.
    """
    try:
        conn = db.connect(DB_PATH, check_same_thread=False)
        now = db.content_fingerprint(conn)
        exported = db.get_meta(conn, db.EXPORT_FP_KEY)
        pushed = db.get_meta(conn, db.PUSHED_FP_KEY)
    except Exception as e:                      # noqa: BLE001 — see docstring
        print(f"publish due: gate failed open ({e!r})")
        return
    if exported is None:
        why = "no full export on record"
    elif now != exported:
        why = "the index changed since the last export"
    elif pushed != exported:
        why = "the last export has not reached the VPS"
    else:
        print("publish: index unchanged since the last export and push — "
              "skipping export, push and cards this cycle")
        sys.exit(1)
    print(f"publish due: {why}")


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
    # The routine push is add/update-only, which is right for a tail run: nothing
    # is ever removed. An exclusion (or a guid re-key) DOES remove a shard, and the
    # exporter leaves this marker to say so — a removal that only happened locally
    # is a show still being served from the VPS. Cleared once the mirror succeeds.
    marker = export_mod.prune_marker(shards)
    mirror = args.delete or marker.exists()
    ssh_cmd = f"ssh -i {VPS_KEY_FILE} -p {port} -o StrictHostKeyChecking=accept-new"
    dest = f"{user}@{host}:{VPS_REMOTE_NS}/"       # relative to the rrsync-forced root
    cmd = ["rsync", "-a", "-e", ssh_cmd, f"{shards}/", dest]
    if mirror:
        cmd[1:1] = ["--delete"]     # mirror: prune stale files WITHIN onlyboosts/ only
        if not args.delete:
            print(f"  --delete forced: {marker.name} lists "
                  f"{len(marker.read_text().split())} shard(s) removed since the last push")
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
        if mirror and not args.dry_run:
            marker.unlink(missing_ok=True)
        if not args.dry_run and _is_shards_dir(shards):
            # The VPS now holds whatever the last full export built — record
            # that for the publish gate. Not touched on failure, so a cycle
            # whose rsync broke re-exports and re-pushes on the next tick.
            conn = db.connect(DB_PATH, apply_exclusions=False)
            db.set_meta(conn, db.PUSHED_FP_KEY, db.get_meta(conn, db.EXPORT_FP_KEY, ""))
        print("push OK" if not args.dry_run else "dry-run OK (nothing written)")


def cmd_reclassify_clients(args):
    """Recompute client attribution for stored boosts from their signed events.

    A RE-DERIVATION, NOT A BACKFILL, and that is why it is a standing command
    rather than a one-shot script: the classifier's inputs are all in `raw_json`,
    so when a rule changes — a new relay bot, a client that starts tagging
    itself — the fix is to edit clients.py and run this again. It rewrites
    `client_id`/`client_via`/`client_src` in place and never touches the raw
    `client` tag.

    Idempotent. `--only-missing` restricts to rows never classified, which is the
    normal case after a migration; the default re-derives everything, which is
    what you want after a rule change.
    """
    conn = db.connect(DB_PATH, check_same_thread=False)
    where = "WHERE client_src IS NULL" if args.only_missing else ""
    rows = conn.execute(f"SELECT event_id, raw_json, client_id, client_via, client_src "
                        f"FROM boosts {where}").fetchall()
    print(f"classifying {len(rows)} boost(s)...")
    updates, changed, no_raw = [], 0, 0
    tally, vias = Counter(), Counter()
    for r in rows:
        if not r["raw_json"]:
            no_raw += 1
            continue
        try:
            event = json.loads(r["raw_json"])
        except (ValueError, TypeError):
            no_raw += 1
            continue
        c = clients.classify_client(event)
        tally[c["client_id"] or "(unattributed)"] += 1
        if c["client_via"]:
            vias[c["client_via"]] += 1
        if (c["client_id"], c["client_via"], c["client_src"]) != (
                r["client_id"], r["client_via"], r["client_src"]):
            changed += 1
            updates.append((c["client_id"], c["client_via"], c["client_src"], r["event_id"]))
    if not args.dry_run and updates:
        conn.executemany("UPDATE boosts SET client_id=?, client_via=?, client_src=? "
                         "WHERE event_id=?", updates)
        conn.commit()
    print(f"  changed {changed} row(s)" + ("   (dry-run, nothing written)" if args.dry_run else ""))
    if changed and not args.dry_run:
        # ⚠️ The boost delta is INSERT OR IGNORE — it exists to carry NEW boosts,
        # so it will not update a column on a row D1 already has. A re-derivation
        # reaches the query layer through `d1_sync.py --remote-clients`, which
        # emits UPDATEs. Nothing else re-pushes these columns.
        print("  → run `python3 d1_sync.py --remote-clients` to push these to D1")
    if no_raw:
        print(f"  {no_raw} row(s) had no usable raw event and were left alone")
    print("\n  client_id:")
    for k, v in tally.most_common():
        print(f"    {clients.display_name(k):22} {v:6}")
    if vias:
        print("\n  client_via (relayed through chadf-boostbot):")
        for k, v in vias.most_common():
            print(f"    {clients.display_name(k):22} {v:6}")


def cmd_dedupe(args):
    """Mark republisher notes that duplicate another app's note for the same
    payment — see dedupe.py for the rule and the measurements behind it.

    Default scope is a trailing window: the bot lags its partner by a minute or
    three, but relay/scan order can deliver either side first, so unmarked notes
    are re-evaluated every cycle until the window ages them out. `--all` is the
    historical pass. Marking is reversible (clear `dup_of`, drop the row's
    `d1_boosts_synced` marker, and the next delta re-inserts it into D1)."""
    conn = db.connect(DB_PATH)
    try:
        dedupe.run(conn, days=None if args.all else args.days,
                   dry_run=args.dry_run)
    finally:
        conn.close()


def cmd_excludes(args):
    """Validate excludes.json and report what each entry currently hides.

    The list is public and hand-edited, so it needs a way to be checked that
    doesn't involve waiting for a timer and reading a feed. Read-only apart from
    the projection every connect does anyway.
    """
    try:
        ex = excludes.load()
    except excludes.ExcludeError as e:
        print(f"[error] {e}")
        sys.exit(1)
    print(f"{ex.path}: {ex.summary()}")
    conn = db.connect(DB_PATH, check_same_thread=False)
    if not ex.entries:
        print("nothing excluded — every indexed boost is published")
        return
    total = conn.execute("SELECT COUNT(*) FROM boosts WHERE excluded=1").fetchone()[0]
    # Per entry, not per row: two entries can hide the same boost (a show and one
    # of its episodes), so these will not sum to the total, and shouldn't.
    eg = db.effective_guid("b")
    for e in ex.entries:
        # Mirrors db._excluded_expr, including its slot-agnostic guid match — a
        # report that counted differently from the filter would be worse than none.
        where = {
            "boost":     "b.event_id = ?",
            "booster":   "b.booster_pubkey = ?",
            "show_feed": f"{eg} IN (SELECT podcast_guid FROM shows WHERE feed_url = ?)",
        }.get(e["kind"], f"? IN (b.podcast_guid, {eg}, b.item_guid)")
        hits = conn.execute(
            f"SELECT COUNT(*), COALESCE(SUM(b.sats),0) FROM boosts b WHERE {where}",
            (e["id"],)).fetchone()
        print(f"  {e['list'][:-1]:<8} {e['raw'][:52]:<52} "
              f"{hits[0]:>5} boost(s), {hits[1]:>9} sats")
        print(f"           reason: {e['reason']}"
              + (f"  [added {e['added']}]" if e["added"] else "")
              + (f"  [via {e['source']}]" if e["source"] else ""))
    print(f"\n{total} of {conn.execute('SELECT COUNT(*) FROM boosts').fetchone()[0]} "
          f"indexed boosts are withheld from every published surface.")
    print("Nothing is deleted: removing an entry republishes it on the next run.")


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

    o = sub.add_parser("outbox", help="widen coverage via booster NIP-65 write relays")
    o.add_argument("--floor", type=int, default=FLOOR_2025)
    o.add_argument("--refresh", action="store_true",
                   help="force re-resolve the outbox relay set (ignore the cache)")
    o.set_defaults(func=cmd_outbox)

    rs = sub.add_parser("rescan", help="re-fetch + re-classify one feed's notes by podcast:guid")
    rs.add_argument("--feed", required=True, help="the feed's podcast:guid value")
    rs.add_argument("--floor", type=int, default=FLOOR_2025)
    rs.add_argument("--relays", nargs="*")
    rs.set_defaults(func=cmd_rescan)

    ds = sub.add_parser("deepscan",
                        help="recover pre-k-tag boosts: #i-by-guid + author walks, "
                             "iterated to convergence")
    ds.add_argument("--until", type=int, default=KTAG_ADOPTION_UNTIL,
                    help="newest created_at to walk from (default 2025-06-01 — "
                         "newer notes are #k-covered)")
    ds.add_argument("--floor", type=int, default=FLOOR_2022,
                    help="oldest created_at to walk to (default 2022-01-01)")
    ds.add_argument("--relays", nargs="*", help="override the relay set")
    ds.add_argument("--items", action="store_true",
                    help="also walk known item_guids under both #i prefixes (slower)")
    ds.add_argument("--dry-run", action="store_true",
                    help="classify + count, write nothing, mark no progress")
    ds.add_argument("--max-rounds", type=int, default=4,
                    help="cap on discovery iterations (default 4)")
    ds.add_argument("--max-chunks", type=int, default=None,
                    help="debug: cap chunks per relay per kind, single round")
    ds.add_argument("--pace", type=float, default=0,
                    help="seconds to sleep between pages/chunks per relay, for "
                         "hosts whose nginx 429s back-to-back handshakes")
    ds.add_argument("--reset", action="store_true",
                    help="forget deepscan progress state and re-walk everything")
    ds.set_defaults(func=cmd_deepscan)

    rg = sub.add_parser("resolve-guids",
                        help="canonicalize phantom podcast_guids (feed ids / item guids / slugs)")
    rg.set_defaults(func=cmd_resolve_guids)

    e = sub.add_parser("enrich", help="Podcast Index + profile enrichment")
    e.set_defaults(func=cmd_enrich)

    re_ = sub.add_parser("re-enrich-episodes",
                         help="re-read episode metadata from Podcast Index now "
                              "(the refresh gate, pulled forward)")
    re_.add_argument("--guid", action="append", metavar="ITEM_GUID",
                     help="one episode's item_guid; repeatable. Bypasses the age gate")
    re_.add_argument("--show", metavar="PODCAST_GUID",
                     help="every boosted episode of one show. Bypasses the age gate")
    re_.add_argument("--limit", type=int, default=db.EPISODE_BATCH,
                     help=f"cap for this run (default {db.EPISODE_BATCH}, "
                          f"the per-tick batch)")
    re_.set_defaults(func=cmd_reenrich_episodes)

    du = sub.add_parser("durations",
                        help="derive durations for boosted episodes that have none "
                             "(feed <itunes:duration> → ended liveItem window → enclosure probe)")
    du.add_argument("--limit", type=int, default=40,
                    help="max episodes per run (timer-tick budget; default 40)")
    du.add_argument("--all", action="store_true", help="no cap (backfill)")
    du.add_argument("--dry-run", action="store_true",
                    help="report what would be written, write nothing")
    du.set_defaults(func=cmd_durations)

    fs = sub.add_parser("fountain-shows",
                        help="identify unresolved shows via their Fountain episode page")
    fs.add_argument("--limit", type=int, default=0,
                    help="only process the N highest-sats shows (0 = all)")
    fs.set_defaults(func=cmd_fountain_shows)

    pr = sub.add_parser("podroll", help="parse <podcast:podroll> from each show's RSS feed")
    pr.add_argument("--max-age", type=int, default=6 * 24 * 3600,
                    help="re-check a feed only if it was last checked longer ago than this "
                         "(seconds; default just under a week, so a weekly timer never skips)")
    pr.add_argument("--retry-age", type=int, default=None,
                    help="shorter re-check window for feeds whose last read never completed "
                         "(429/timeout/5xx); default is a sixth of --max-age")
    pr.add_argument("--include-podroll-shows", action="store_true",
                    help="also crawl the podrolls OF podroll targets (walks the graph a "
                         "second hop; those shows have no page to show it on)")
    pr.set_defaults(func=cmd_podroll)

    pb = sub.add_parser("publishers",
                        help="fetch the publisher (artist) feeds album feeds declare "
                             "(links themselves are extracted by the podroll pass)")
    pb.add_argument("--max-age", type=int, default=6 * 24 * 3600,
                    help="re-fetch a publisher feed only if last checked longer ago "
                         "than this (seconds; default just under a week)")
    pb.add_argument("--retry-age", type=int, default=None,
                    help="shorter re-check window for feeds whose last read never "
                         "completed; default is a sixth of --max-age")
    pb.add_argument("--resolve-albums", type=int, default=300,
                    help="cap on Podcast Index lookups for listed albums with no "
                         "shows row yet (0 = skip)")
    pb.add_argument("--dry-run", action="store_true",
                    help="fetch and report; write nothing")
    pb.set_defaults(func=cmd_publishers)

    x = sub.add_parser("export", help="write static JSON shards for the website")
    x.add_argument("--out", default=str(HERE / "data" / "shards"),
                   help="output directory for the shards")
    x.add_argument("--latest-n", type=int, default=1000,
                   help="how many recent boosts in boosts/latest.json")
    x.add_argument("--per-show", action="store_true",
                   help="also write per-show detail shards (full shownotes)")
    x.set_defaults(func=cmd_export)

    pd = sub.add_parser("publish-due",
                        help="exit 0 if the shards need exporting+pushing (index changed, "
                             "or last export not pushed), 1 if not — the incremental gate")
    pd.set_defaults(func=cmd_publish_due)

    pu = sub.add_parser("push", help="rsync shards to the VPS (onlyboosts/ namespace)")
    pu.add_argument("--out", default=str(HERE / "data" / "shards"),
                    help="shards directory to push")
    pu.add_argument("--dry-run", action="store_true",
                    help="show what would transfer without writing anything")
    pu.add_argument("--delete", action="store_true",
                    help="prune remote files no longer exported (within onlyboosts/ only)")
    pu.set_defaults(func=cmd_push)

    dd = sub.add_parser("dedupe",
                        help="mark republisher notes duplicating another app's note (dedupe.py)")
    dd.add_argument("--days", type=int, default=7,
                    help="trailing window of bot notes to evaluate (default 7)")
    dd.add_argument("--all", action="store_true", help="full history")
    dd.add_argument("--dry-run", action="store_true")
    dd.set_defaults(func=cmd_dedupe)

    xc = sub.add_parser("excludes",
                        help="validate excludes.json and report what each entry hides")
    xc.set_defaults(func=cmd_excludes)

    rc = sub.add_parser("reclassify-clients",
                        help="re-derive which app published each boost (clients.py)")
    rc.add_argument("--only-missing", action="store_true",
                    help="only rows never classified (default: re-derive all)")
    rc.add_argument("--dry-run", action="store_true")
    rc.set_defaults(func=cmd_reclassify_clients)

    s = sub.add_parser("stats", help="print index counts")
    s.set_defaults(func=cmd_stats)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
