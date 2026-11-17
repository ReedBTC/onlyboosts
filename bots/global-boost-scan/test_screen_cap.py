#!/usr/bin/env python3
"""The per-boost sats cap (classify.MAX_BOOST_SATS), over a fixture box database
built from the real schema through db.connect.

The rule under test: a boost claiming more than the cap stays in the index with
its claimed sats untouched, is withheld through the same `excluded` flag and D1
re-projection queue as an excludes.json entry, and a screen_allow row publishes
it again. A boost at exactly the cap counts.

Run: python3 test_screen_cap.py  (from this directory).
"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                     # noqa: E402
import excludes               # noqa: E402
from classify import MAX_BOOST_SATS   # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


EMPTY = excludes.Excludes([], None)
NOW = int(time.time())
ROWS = [("a" * 64, MAX_BOOST_SATS), ("b" * 64, MAX_BOOST_SATS + 1),
        ("c" * 64, 9_999_999_999), ("d" * 64, None)]

with tempfile.TemporaryDirectory() as tmp:
    conn = db.connect(os.path.join(tmp, "t.db"), apply_exclusions=False)
    db.upsert_boosts(conn, [{
        "event_id": eid, "booster_pubkey": "e" * 64, "created_at": NOW,
        "sats": sats, "podcast_guid": "show-1", "item_guid": "ep-1",
    } for eid, sats in ROWS])
    db.apply_excludes(conn, EMPTY)

    flag = lambda eid: conn.execute(
        "SELECT excluded, sats FROM boosts WHERE event_id=?", (eid,)).fetchone()
    check(flag("a" * 64)[0] == 0, "a boost at exactly the cap is published")
    check(flag("b" * 64)[0] == 1, "one sat over the cap is withheld")
    check(flag("c" * 64)[0] == 1, "9,999,999,999 sats is withheld")
    check(flag("d" * 64)[0] == 0, "a boost with no amount is untouched")
    check(flag("c" * 64)[1] == 9_999_999_999, "the claimed sats are kept, not clamped")
    check(conn.execute(f"SELECT COUNT(*) FROM boosts b WHERE {db.not_excluded('b')}"
                       ).fetchone()[0] == 2, "not_excluded() leaves the two under the cap")

    conn.execute("INSERT INTO screen_allow VALUES (?, 'real', '2026-11-17')", ("c" * 64,))
    conn.commit()
    moved = db.apply_excludes(conn, EMPTY)
    check(moved == 1 and flag("c" * 64)[0] == 0, "an allow publishes that one boost")
    check(flag("b" * 64)[0] == 1, "...and no other")
    check(conn.execute("SELECT COUNT(*) FROM d1_reproject WHERE kind='boost' AND id=?",
                       ("c" * 64,)).fetchone()[0] == 0,
          "...with no pending D1 delete left behind it")

    conn.execute("DELETE FROM screen_allow")
    conn.commit()
    db.apply_excludes(conn, EMPTY)
    check(flag("c" * 64)[0] == 1, "withdrawing the allow withholds it again")
    check(conn.execute("SELECT COUNT(*) FROM d1_reproject WHERE kind='boost' AND id=?",
                       ("c" * 64,)).fetchone()[0] == 1, "...and queues its D1 delete")

print(f"\n{len(failures)} failure(s)" if failures else "\nall passed")
sys.exit(1 if failures else 0)
