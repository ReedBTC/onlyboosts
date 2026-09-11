#!/usr/bin/env python3
"""db.pubkeys_needing_profile's TWO retry cooldowns, over a fixture box database
built from the real schema through db.connect.

The rule under test: a booster whose first boost is inside PROFILE_NEW_WINDOW
retries a failed kind-0 fetch after PROFILE_NEW_RETRY; everyone else waits
ENRICH_RETRY_COOLDOWN. It exists because the 2-minute incremental tick looks for
a kind-0 before a brand-new account has published one — measured 2026-09-11,
Boostr_Bot published its profile seven minutes after the pass that missed it, and
the flat 7-day cooldown then held that member as a bare npub for a week.

Run: python3 test_profile_cooldown.py  (from this directory).
"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                     # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


NOW = int(time.time())
DAY = 86400

# (pubkey, first boost age, age of the failed attempt or None, queued?, label)
CASES = [
    ("a" * 64, 10 * 60,  31 * 60, True,
     "a 10-minute-old booster missed 31 minutes ago is retried"),
    ("b" * 64, 10 * 60,  10 * 60, False,
     "...and one missed 10 minutes ago is still inside its cooldown"),
    ("c" * 64, 3 * DAY,  31 * 60, True,
     "the short cooldown reaches the whole first week"),
    ("d" * 64, 30 * DAY, 31 * 60, False,
     "an established booster keeps the 7-day cooldown, so 31 minutes is not enough"),
    ("e" * 64, 30 * DAY, 8 * DAY, True,
     "...and is retried once that lapses"),
    ("f" * 64, 10 * 60,  None,    True,
     "a never-attempted pubkey is queued whatever its age"),
    ("0" * 64, 30 * DAY, None,    True,
     "...including an old one"),
]

with tempfile.TemporaryDirectory() as tmp:
    conn = db.connect(os.path.join(tmp, "box.db"), apply_exclusions=False)
    for pk, boost_age, try_age, _, _ in CASES:
        conn.execute("INSERT INTO boosts (event_id, booster_pubkey, created_at, sats) "
                     "VALUES (?,?,?,1)", (pk[:16] + "-evt", pk, NOW - boost_age))
        if try_age is not None:
            conn.execute("INSERT INTO enrich_failed (kind, id, last_try) "
                         "VALUES ('profile',?,?)", (pk, NOW - try_age))
    conn.commit()

    queued = set(db.pubkeys_needing_profile(conn, limit=10_000))
    for pk, _, _, want, label in CASES:
        check((pk in queued) is want, label)

    new_due, stale_due = db.profile_refresh_backlog(conn)
    check(new_due == sum(1 for c in CASES if c[3]) and stale_due == 0,
          "profile_refresh_backlog applies the SAME gate, so it cannot over-report")

    # A resolved profile leaves the queue on its own; the stale side is checked_at,
    # not the cooldown, so a fresh row is not re-read however old its failure is.
    db.upsert_profile(conn, "a" * 64, {"name": "boostr", "display_name": None,
                                       "picture": None, "nip05": None, "about": None,
                                       "lud16": None, "lud06": None, "website": None,
                                       "banner": None, "event_at": NOW})
    check("a" * 64 not in set(db.pubkeys_needing_profile(conn, limit=10_000)),
          "once the kind-0 lands the pubkey drops out of the queue")

    conn.execute("UPDATE profiles SET checked_at = ? WHERE pubkey = ?",
                 (NOW - db.PROFILE_MAX_AGE - 1, "a" * 64))
    conn.commit()
    check("a" * 64 in set(db.pubkeys_needing_profile(conn, limit=10_000)),
          "and comes back for a refresh once checked_at goes stale")

    check(db.PROFILE_NEW_RETRY < db.ENRICH_RETRY_COOLDOWN,
          "the new-booster cooldown is the shorter of the two")

print()
print("FAILURES:" if failures else "all checks passed", *failures, sep="\n  ")
sys.exit(1 if failures else 0)
