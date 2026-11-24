#!/usr/bin/env python3
"""dedupe through boost_credits: a relay note on the HOST of a value-time split.
Run: python3 test_dedupe_credits.py  (from this directory).

The failure it pins (2026-11-24, Social Hour ep 001): the donor's app records a
boost made during a value-time split on the SONG, chadf-boostbot records the
same payment on the HOST episode, and the hard key compared boosts rows only,
so the pair never met. With boost_credits the donor's note also lands on the
episode, beside the bot's, and the payment read twice there.

What it holds:
  * a sender-tagged relay note pairs with the donor note whose host credit
    sits on its episode (tier 0);
  * an untagged relay note does too, through the ordinary tiers;
  * the donor's note stays the keeper;
  * without a credit row nothing pairs (the old behaviour);
  * a host credit on a different episode of the show never pairs.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                      # noqa: E402
import dedupe                  # noqa: E402
from nostr_utils import hex_to_npub   # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


BOT = "ad" * 32
DONOR = "50" * 32
HOST = "de0bcde8-9644-4c1e-8bb1-6a2bd9c4a8a2"
EP = "8bcebfb8-015e-473c-b641-94d13a017ddf"
EP2 = "11111111-015e-473c-b641-94d13a017ddf"
SONG_FEED = "b62cd990-7820-4b3c-9a6b-7c6f78752b73"
SONG = "1d8cdc03-bd20-4e5a-9a6b-e79257362fd5"
T0 = 1_795_459_950


def note(eid, pk, ts, sats, msg, client_id, show, item, sender=None):
    tags = [["i", f"podcast:guid:{show}"], ["i", f"podcast:item:guid:{item}"]]
    if sender:
        tags.append(["sender", hex_to_npub(sender)])
    return {"event_id": eid, "booster_pubkey": pk, "created_at": ts, "sats": sats,
            "podcast_guid": show, "item_guid": item, "message": msg,
            "client_id": client_id, "client_src": "test",
            "raw": {"id": eid, "pubkey": pk, "created_at": ts, "kind": 1,
                    "content": msg, "tags": tags}}


DONOR_MSG = ("⚡ Boost ⚡\n\nChadF boosted 333 sats to Eleanor Rigby by The Doerfels "
             "from Ep. 001 of The OnlyBoosts Social Hour via BoostMeBitch")
BOT_MSG = "⚡ 333 sats\n📱 via BoostMeBitch"


def fresh(bot_sender=True, credit_item=EP):
    d = tempfile.mkdtemp()
    conn = db.connect(os.path.join(d, "t.db"), apply_exclusions=False)
    db.upsert_boosts(conn, [
        note("bmb", DONOR, T0 + 4, 333, DONOR_MSG, "boostmebitch", SONG_FEED, SONG),
        note("bot", BOT, T0, 333, BOT_MSG, "chadf-boostbot", HOST, EP,
             sender=DONOR if bot_sender else None),
    ])
    if credit_item:
        conn.executemany(
            """INSERT INTO boost_credits (event_id, role, podcast_guid, item_guid,
               sats, pct, method, checked_at) VALUES (?,?,?,?,?,?,?,?)""",
            [("bmb", "track", SONG_FEED, SONG, 330, 99.0, "rss", T0),
             ("bmb", "host", HOST, credit_item, 3, 99.0, "rss", T0)])
        conn.commit()
    return conn


def pairs_of(conn):
    return {b["event_id"]: (o["event_id"], tier)
            for b, o, tier, gap in dedupe.find_duplicates(conn)}


assert "chadf-boostbot" in dedupe.RELAY_PUBLISHERS

print("sender-tagged bot note on the host episode")
p = pairs_of(fresh())
check(p.get("bot") == ("bmb", "sender"), "bot note marked dup of the donor's note, tier sender")
check("bmb" not in p, "the donor's note is the keeper")

print("untagged bot note on the host episode")
p = pairs_of(fresh(bot_sender=False))
check(p.get("bot", (None,))[0] == "bmb", "bot note marked dup through the ordinary tiers")

print("no credit row")
check(pairs_of(fresh(credit_item=None)) == {}, "nothing pairs")

print("untagged, host credit on another episode")
check(pairs_of(fresh(bot_sender=False, credit_item=EP2)) == {}, "nothing pairs")

print("sender-tagged, host credit on another episode")
check(pairs_of(fresh(credit_item=EP2)) == {}, "nothing pairs")

if failures:
    print(f"\n{len(failures)} FAILED"); sys.exit(1)
print("\nall passed")
