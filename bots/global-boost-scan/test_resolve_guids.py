#!/usr/bin/env python3
"""resolve_guids.derive's `unknown:<item_guid>` rung, over a fixture box database
built from the real schema through db.connect, with Podcast Index made to throw
so the rung is proven local. Run: python3 test_resolve_guids.py  (from this directory).
"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                     # noqa: E402
import enrich                 # noqa: E402
import resolve_guids          # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


def boom(*a, **k):
    raise AssertionError("Podcast Index was asked")


enrich.pi_get = boom
SHOW = "afbaa6da-4219-55dd-934a-96e0bc79c442"
ITEM = "a6ef9eaf-719d-434c-91c7-5c66b6079679"
NOW = int(time.time())

with tempfile.TemporaryDirectory() as tmp:
    conn = db.connect(os.path.join(tmp, "box.db"), apply_exclusions=False)
    conn.execute("INSERT INTO episodes (item_guid, title, podcast_guid, updated_at) VALUES (?,?,?,?)",
                 (ITEM, "SNL #239", SHOW, NOW))
    conn.execute("INSERT INTO episodes (item_guid, title, podcast_guid, updated_at) VALUES (?,?,?,?)",
                 ("orphan-item", "no show known", None, NOW))
    for i, raw in enumerate((f"unknown:{ITEM}", "unknown:orphan-item", "unknown:never-seen", SHOW)):
        conn.execute("""INSERT INTO boosts (event_id, booster_pubkey, created_at, sats, podcast_guid, item_guid)
                        VALUES (?,?,?,?,?,?)""", (f"ev{i}", "pk", NOW, 100, raw, raw.split(":", 1)[-1]))
    conn.execute("CREATE TABLE d1_boosts_synced (event_id TEXT PRIMARY KEY)")     # d1_sync owns this table
    conn.execute("INSERT INTO d1_boosts_synced (event_id) VALUES ('ev0')")   # D1 already holds it
    conn.commit()
    curated = resolve_guids.load_curated()

    print("unknown: whose episode row names a show → aliased from the row, no PI call")
    out = resolve_guids.derive(conn, f"unknown:{ITEM}", "k", "s", curated)
    check(out == (SHOW, "episode-row", None), f"derive → {out}")

    print("unknown: whose episode row has no show → left alone")
    check(resolve_guids.derive(conn, "unknown:orphan-item", "k", "s", curated) is None, "no alias")

    print("unknown: with no episode row at all → left alone")
    check(resolve_guids.derive(conn, "unknown:never-seen", "k", "s", curated) is None, "no alias")

    print("a real guid is never touched")
    check(resolve_guids.derive(conn, SHOW, "k", "s", curated) is None, "real guid passes through")

    print("resolve_all materializes it onto the boost and re-asks the rest next time")
    new, rekeyed = resolve_guids.resolve_all(conn, "k", "s", log=lambda m: None)
    row = conn.execute("SELECT canonical_guid FROM boosts WHERE event_id='ev0'").fetchone()
    check(new == 1 and rekeyed == 1 and row[0] == SHOW, f"new={new} rekeyed={rekeyed} canonical={row[0]}")
    check(("boost", "ev0") in {(k, i) for k, ids in db.reproject_queue(conn).items() for i in ids}
          and conn.execute("SELECT COUNT(*) FROM d1_boosts_synced WHERE event_id='ev0'").fetchone()[0] == 0,
          "the re-keyed row is queued for a D1 delete AND un-synced, so one delta replaces it")
    pending = db.raw_guids_needing_alias(conn)
    check("unknown:orphan-item" in pending and "unknown:never-seen" in pending,
          "the two unresolved placeholders stay in the queue")
    # The orphan's episode gets enriched later: the next pass picks it up.
    conn.execute("UPDATE episodes SET podcast_guid=? WHERE item_guid='orphan-item'", (SHOW,)); conn.commit()
    new, rekeyed = resolve_guids.resolve_all(conn, "k", "s", log=lambda m: None)
    check(new == 1 and rekeyed == 1, "heals the tick after the episode resolves")

    print("a Podcast Index miss is parked for the cooldown; a local miss is not")
    calls = []
    def missing(path, params, key, secret):
        calls.append(path); return {"feed": {}}
    enrich.pi_get = missing
    for i, raw in enumerate(("https://fatburningman.com/?p=19122", "20250508FH"), 10):
        conn.execute("""INSERT INTO boosts (event_id, booster_pubkey, created_at, sats, podcast_guid, item_guid)
                        VALUES (?,?,?,?,?,?)""", (f"ev{i}", "pk", NOW, 100, raw, "x"))
    conn.commit()
    resolve_guids.resolve_all(conn, "k", "s", log=lambda m: None)
    check(calls == ["podcasts/byfeedurl"], f"the URL asked PI exactly once ({calls})")
    parked = {r[0] for r in conn.execute("SELECT id FROM enrich_failed WHERE kind='alias'")}
    check(parked == {"https://fatburningman.com/?p=19122"}, f"only the PI-routed miss is parked ({parked})")
    calls.clear()
    pending = db.raw_guids_needing_alias(conn)
    resolve_guids.resolve_all(conn, "k", "s", log=lambda m: None)
    check("https://fatburningman.com/?p=19122" not in pending and "20250508FH" in pending and calls == [],
          "inside the cooldown the URL is not re-asked; the slug still is, locally")
    conn.execute("UPDATE enrich_failed SET last_try = last_try - ?", (db.ENRICH_RETRY_COOLDOWN + 1,)); conn.commit()
    resolve_guids.resolve_all(conn, "k", "s", log=lambda m: None)
    check(calls == ["podcasts/byfeedurl"], "once the cooldown lapses it is asked again")
    conn.execute("DELETE FROM enrich_failed"); conn.commit()
    resolve_guids.resolve_all(conn, None, None, log=lambda m: None)
    check(conn.execute("SELECT COUNT(*) FROM enrich_failed").fetchone()[0] == 0,
          "with no PI credentials nothing is asked, so nothing is parked")

print()
print("FAILURES:" if failures else "all checks passed", *failures, sep="\n  ")
sys.exit(1 if failures else 0)
