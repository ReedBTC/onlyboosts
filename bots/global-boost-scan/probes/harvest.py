#!/usr/bin/env python3
"""Harvest EVERY candidate note from the relays into data/probes/candidates.db,
with no classifier in the way, so rule changes can be replayed offline.

Shapes walked per relay, back to the corpus floor (2024-07-01), resumable:
    k       kind 1, #k podcast:guid / podcast:item:guid     (the production shape)
    t       kind 1, #t boostagram / value4value / boost      (BoostMeBitch's 2nd shape; we never send it)
    k1111   kind 1111, #K podcast:*                          (NIP-22 comments on a podcast)
    pub     kind 1, authors = the registered publisher keys  (LB's untagged standalones live here)
    i:N     kind 1, #i per 100 known show guids              (production shape)
    a:N     kind 1, authors per 100 known boosters            (production shape)

Relays: the 12 core relays + damus + primal (BoostMeBitch's set) + relay.mynostr.app.

Kept: anything `probe_common.worth_keeping` says — a podcast i tag, a boost t
tag, an amount or zap tag, a publisher-signed note, or 'sats' beside a
fountain.fm URL. Everything else is counted and dropped. Read-only everywhere.

    python3 probes/harvest.py                 # run / resume
    python3 probes/harvest.py --status        # per relay/shape progress
    python3 probes/harvest.py --relays wss://relay.damus.io,wss://relay.primal.net
"""
import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from probe_common import (open_cand, open_index, worth_keeping, PROBE_RELAYS,
                          CORPUS_FLOOR, BOOST_T, PUBLISHER_PUBKEYS)
from scan import GUIDS_PER_FILTER, AUTHORS_PER_FILTER, PAGE_LIMIT
import websocket

LOCK = threading.Lock()


def log(msg):
    sys.stdout.write(time.strftime("%H:%M:%S ") + msg + "\n")
    sys.stdout.flush()


def known_sets():
    ix = open_index()
    guids = set()
    for sql in ("SELECT DISTINCT podcast_guid FROM boosts WHERE podcast_guid IS NOT NULL AND podcast_guid != ''",
                "SELECT DISTINCT canonical_guid FROM boosts WHERE canonical_guid IS NOT NULL AND canonical_guid != ''",
                "SELECT podcast_guid FROM shows",
                "SELECT raw_guid FROM guid_aliases"):
        guids.update(r[0] for r in ix.execute(sql).fetchall())
    authors = {r[0] for r in ix.execute("SELECT DISTINCT booster_pubkey FROM boosts").fetchall()}
    ix.close()
    return sorted(g for g in guids if g), sorted(authors - set(PUBLISHER_PUBKEYS))


def shapes(guids, authors):
    out = [
        ("k", {"kinds": [1], "#k": ["podcast:guid", "podcast:item:guid"]}),
        ("t", {"kinds": [1], "#t": BOOST_T}),
        ("k1111", {"kinds": [1111], "#K": ["podcast:guid", "podcast:item:guid"]}),
        ("pub", {"kinds": [1], "authors": sorted(PUBLISHER_PUBKEYS)}),
    ]
    for n, i in enumerate(range(0, len(guids), GUIDS_PER_FILTER)):
        out.append((f"i:{n:02d}", {"kinds": [1], "#i": [f"podcast:guid:{g}" for g in guids[i:i + GUIDS_PER_FILTER]]}))
    for n, i in enumerate(range(0, len(authors), AUTHORS_PER_FILTER)):
        out.append((f"a:{n:02d}", {"kinds": [1], "authors": authors[i:i + AUTHORS_PER_FILTER]}))
    return out

# Connects per minute a relay's nginx front tolerates before 429ing the
# handshake. Measured 2026-10-03 on this harvest: nos.lol and nostr.mom 429
# within seconds at one connect per 0.5s; podtards.com and lexingtonbitcoin
# are documented in scan.py at ~8-10/min. Everything else took 2/s.
RELAY_GAP = {
    "wss://nos.lol": 8.0,
    "wss://nostr.mom": 8.0,
    "wss://podtards.com": 7.0,
    "wss://relay.lexingtonbitcoin.org": 4.0,
}
DEFAULT_GAP = 1.0
_last_connect = {}


def probe_query(relay, filt, timeout=15, max_wall=45):
    """One REQ, one page. Returns (events, status): status is 'ok',
    'ratelimited' (HTTP 429 on the handshake), 'timeout' or 'error'. Unlike
    collector_common.query_relay the failure class is REPORTED, because this
    harvest has to tell "the relay holds nothing older" from "the relay
    refused to talk to us", and only the first may end a shape."""
    gap = RELAY_GAP.get(relay, DEFAULT_GAP)
    wait = _last_connect.get(relay, 0) + gap - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_connect[relay] = time.monotonic()
    got = []
    try:
        ws = websocket.create_connection(relay, timeout=timeout)
    except websocket.WebSocketBadStatusException as e:
        return got, ("ratelimited" if getattr(e, "status_code", 0) == 429 else "error")
    except (websocket.WebSocketTimeoutException, TimeoutError):
        return got, "timeout"
    except Exception:
        return got, "error"
    try:
        ws.send(json.dumps(["REQ", "pr", filt]))
        deadline = time.monotonic() + max_wall
        while time.monotonic() < deadline:
            ws.settimeout(max(0.1, min(timeout, deadline - time.monotonic())))
            try:
                msg = json.loads(ws.recv())
            except Exception:
                break
            if not isinstance(msg, list) or not msg:
                continue
            if msg[0] == "EVENT" and len(msg) >= 3:
                got.append(msg[2])
            elif msg[0] in ("EOSE", "CLOSED"):
                break
        try:
            ws.send(json.dumps(["CLOSE", "pr"]))
        except Exception:
            pass
        ws.close()
    except Exception:
        return got, "error"
    return got, "ok"


def walk(relay, filt, floor_ts, start_until, on_page, checkpoint, log, label=""):
    """Backward walk of one filter. An empty page ends the shape ONLY when the
    relay actually answered; a 429 backs off and retries (up to 6 times, 30s to
    8 min), a timeout/error retries 3 times, and a shape that never gets an
    answer is left with its cursor so a rerun resumes it. Returns True when the
    shape is finished."""
    cursor = start_until
    pages = refusals = errors = empties = 0
    while cursor > floor_ts:
        page, status = probe_query(relay, dict(filt, limit=PAGE_LIMIT, until=cursor))
        if status == "ratelimited":
            refusals += 1
            if refusals > 6:
                log(f"{label}: 429 x{refusals}, giving up for this run at {time.strftime('%Y-%m-%d', time.gmtime(cursor))}")
                checkpoint(cursor, cursor)
                return False
            back = min(30 * 2 ** (refusals - 1), 480)
            log(f"{label}: 429, backing off {back}s")
            time.sleep(back)
            continue
        if status != "ok":
            errors += 1
            if errors > 3:
                log(f"{label}: {status} x{errors}, giving up for this run")
                checkpoint(cursor, cursor)
                return False
            time.sleep(10 * errors)
            continue
        refusals = errors = 0
        pages += 1
        if not page:
            empties += 1
            if empties >= 2:
                break
            cursor -= 86400          # one sparse-gap nudge, as the production walker does
            continue
        empties = 0
        on_page(page)
        oldest = min(ev.get("created_at", cursor) for ev in page)
        if oldest >= cursor:
            log(f"{label}: no progress at until={cursor} — stop")
            break
        cursor = oldest - 1
        checkpoint(cursor, cursor)
        if pages % 10 == 0:
            log(f"{label}: {pages} pages, back to {time.strftime('%Y-%m-%d', time.gmtime(cursor))}")
    checkpoint(cursor, cursor)
    return True


def store(conn, relay, shape, events):
    kept = 0
    with LOCK:
        for ev in events:
            why = worth_keeping(ev)
            if not why:
                continue
            kept += 1
            row = conn.execute("SELECT shapes, relays FROM events WHERE id=?", (ev["id"],)).fetchone()
            if row:
                sh = set(filter(None, row[0].split(","))) | {f"{shape}"}
                rl = set(filter(None, row[1].split(","))) | {relay}
                conn.execute("UPDATE events SET shapes=?, relays=? WHERE id=?",
                             (",".join(sorted(sh)), ",".join(sorted(rl)), ev["id"]))
            else:
                conn.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?)",
                             (ev["id"], ev["pubkey"], ev["kind"], ev["created_at"],
                              json.dumps(ev, separators=(",", ":")), shape, relay))
        conn.execute("UPDATE checkpoints SET seen=seen+?, kept=kept+?, pages=pages+1, updated=? "
                     "WHERE relay=? AND shape=?", (len(events), kept, int(time.time()), relay, shape))
        conn.commit()
    return kept


def run_relay(conn, relay, shape_list, start_until):
    for name, filt in shape_list:
        with LOCK:
            row = conn.execute("SELECT cursor, done FROM checkpoints WHERE relay=? AND shape=?",
                               (relay, name)).fetchone()
            if row is None:
                conn.execute("INSERT INTO checkpoints (relay, shape, cursor, oldest, updated) VALUES (?,?,?,?,?)",
                             (relay, name, start_until, start_until, int(time.time())))
                conn.commit()
                cursor = start_until
            else:
                cursor, done = row
                if done:
                    continue
                if cursor is None:
                    cursor = start_until

        def checkpoint(cur, oldest, _name=name):
            with LOCK:
                conn.execute("UPDATE checkpoints SET cursor=?, oldest=?, done=?, updated=? WHERE relay=? AND shape=?",
                             (cur, oldest, 1 if cur is None else 0, int(time.time()), relay, _name))
                conn.commit()

        def on_page(events, _name=name):
            store(conn, relay, _name, events)

        tag = f"[{relay.split('//')[1]}:{name}]"
        try:
            finished = walk(relay, filt, CORPUS_FLOOR, cursor, on_page, checkpoint,
                            log=lambda m: log(f"{tag} {m}"), label=name)
        except Exception as e:
            log(f"{tag} error {e!r} — moving on")
            continue
        if finished:
            with LOCK:
                conn.execute("UPDATE checkpoints SET done=1, updated=? WHERE relay=? AND shape=?",
                             (int(time.time()), relay, name))
                conn.commit()
    log(f"[{relay}] all shapes done")


def status(conn):
    rows = conn.execute("SELECT relay, shape, done, pages, seen, kept, oldest FROM checkpoints ORDER BY relay, shape").fetchall()
    by = {}
    for relay, shape, done, pages, seen, kept, oldest in rows:
        d = by.setdefault(relay, {"shapes": 0, "done": 0, "pages": 0, "seen": 0, "kept": 0})
        d["shapes"] += 1; d["done"] += done or 0; d["pages"] += pages or 0
        d["seen"] += seen or 0; d["kept"] += kept or 0
    for relay, d in sorted(by.items()):
        print(f"{relay:38} shapes {d['done']:3}/{d['shapes']:<3} pages {d['pages']:6} seen {d['seen']:8} kept {d['kept']:7}")
    n, = conn.execute("SELECT COUNT(*) FROM events").fetchone()
    print(f"distinct candidate events stored: {n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--relays", help="comma-separated subset")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    conn = open_cand()
    if a.status:
        status(conn)
        return
    row = conn.execute("SELECT v FROM counters WHERE k='start_until'").fetchone()
    if row:
        start_until = row[0]
    else:
        start_until = int(time.time())
        conn.execute("INSERT INTO counters VALUES ('start_until', ?)", (start_until,))
        conn.commit()
    guids, authors = known_sets()
    sl = shapes(guids, authors)
    log(f"{len(guids)} known guids, {len(authors)} known boosters, {len(PUBLISHER_PUBKEYS)} publisher keys "
        f"→ {len(sl)} shapes per relay; window {CORPUS_FLOOR}..{start_until}")
    relays = a.relays.split(",") if a.relays else PROBE_RELAYS
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(run_relay, conn, r, sl, start_until) for r in relays]
        for f in futs:
            f.result()
    status(conn)


if __name__ == "__main__":
    main()
