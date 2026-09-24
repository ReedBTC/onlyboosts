#!/usr/bin/env python3
"""dedupe's tier 0, the named sender, on a scratch index.
Run: python3 test_dedupe_sender.py  (from this directory).

The failure it pins: Boostr_Bot restates a Fountain boost with the amount it
reconstructs from its own 1% leg (100 for a 123-sat boost, 2026-09-20), so
the hard key's `same sats` never held and both notes counted. The bot names
the donor in a `["sender", npub]` tag, and the partner note is signed by that
very key — evidence the amount cannot contradict.

What it holds:
  * a sender-tagged relay note pairs with the donor's own note, sats ignored;
  * among the donor's burst to one episode, the nearest note wins, one-to-one;
  * a named donor with no note of their own is LET THROUGH, never paired with
    a same-amount note signed by somebody else;
  * a sender tag naming the signer itself is no sender at all, and the note
    takes the ordinary tiers;
  * a note with no sender tag takes the ordinary tiers exactly as before.
"""
import json
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


BOT = "ad" * 32           # the relay bot's key (slug boostr-bot below)
DONOR = "50" * 32         # a Fountain donor
OTHER = "f9" * 32         # a different donor
SHOW = "7c6f7875-2b73-491e-b32c-e2c8d6e91d53"
ITEM = "8c82416b-4adf-43aa-8836-e79257362fd5"
T0 = 1_789_891_000


def note(eid, pk, ts, sats, msg, client_id=None, sender=None, item=ITEM):
    tags = [["i", f"podcast:guid:{SHOW}"], ["i", f"podcast:item:guid:{item}"]]
    if sender:
        tags.append(["sender", hex_to_npub(sender)])
    return {"event_id": eid, "booster_pubkey": pk, "created_at": ts, "sats": sats,
            "podcast_guid": SHOW, "item_guid": item, "message": msg,
            "client_id": client_id, "client_src": "test",
            "raw": {"id": eid, "pubkey": pk, "created_at": ts, "kind": 1,
                    "content": msg, "tags": tags}}


def fresh(rows):
    d = tempfile.mkdtemp()
    conn = db.connect(os.path.join(d, "t.db"), apply_exclusions=False)
    db.upsert_boosts(conn, rows)
    return conn


def pairs_of(conn):
    return {b["event_id"]: (o["event_id"], tier, gap)
            for b, o, tier, gap in dedupe.find_duplicates(conn)}


assert "boostr-bot" in dedupe.RELAY_PUBLISHERS, "the bot under test must be a relay publisher"

print("sender tier: sats differ, partner signed by the named donor")
conn = fresh([
    note("app1", DONOR, T0, 123, "better not make a habit of this lol", "fountain"),
    note("bot1", BOT, T0 + 2, 100, "⚡ Boost ⚡\n\nbetter not make a habit of this lol",
         "boostr-bot", sender=DONOR),
])
p = pairs_of(conn)
check(p.get("bot1", (None,))[0] == "app1", "bot note marked dup of the donor's note")
check(p.get("bot1", (None, None))[1] == "sender", "tier is `sender`")

print("sender tier: no message on either side still pairs")
conn = fresh([
    note("app1", DONOR, T0, 566, "", "fountain"),
    note("bot1", BOT, T0 - 2, 600, "⚡ Boost ⚡", "boostr-bot", sender=DONOR),
])
check(pairs_of(conn).get("bot1", (None,))[0] == "app1", "amount and prose both absent as evidence, signature suffices")

print("sender tier: a burst by one donor, nearest wins and pairing is one-to-one")
conn = fresh([
    note("app1", DONOR, T0, 111, "", "fountain"),
    note("app2", DONOR, T0 + 300, 222, "", "fountain"),
    note("app3", DONOR, T0 + 480, 100, "", "fountain"),
    note("bot1", BOT, T0 + 5, 100, "⚡ Boost ⚡", "boostr-bot", sender=DONOR),
    note("bot2", BOT, T0 + 300, 200, "⚡ Boost ⚡", "boostr-bot", sender=DONOR),
    note("bot3", BOT, T0 + 482, 100, "⚡ Boost ⚡", "boostr-bot", sender=DONOR),
])
p = pairs_of(conn)
check(p.get("bot1", (None,))[0] == "app1", "bot1 → nearest (app1, 5s)")
check(p.get("bot2", (None,))[0] == "app2", "bot2 → app2 (0s)")
check(p.get("bot3", (None,))[0] == "app3", "bot3 → app3 (2s), app1 already claimed")
check(len({v[0] for v in p.values()}) == 3, "three distinct partners, none claimed twice")

print("contradiction: a named donor with no note is let through, not paired with a stranger")
conn = fresh([
    note("app1", OTHER, T0, 100, "", "fountain"),
    note("bot1", BOT, T0 + 2, 100, "⚡ Boost ⚡", "boostr-bot", sender=DONOR),
])
check("bot1" not in pairs_of(conn), "same sats, same app, same second — still two donors, both stand")

print("outside the window: the donor's note 11 minutes away is not the partner")
conn = fresh([
    note("app1", DONOR, T0, 100, "", "fountain"),
    note("bot1", BOT, T0 + 11 * 60, 100, "⚡ Boost ⚡", "boostr-bot", sender=DONOR),
])
check("bot1" not in pairs_of(conn), "APP_WINDOW bounds tier 0")

print("a sender tag naming the signer is no sender: the ordinary tiers apply")
conn = fresh([
    note("app1", OTHER, T0, 100, "ridiculous purple elephant parade tonight", "fountain"),
    note("bot1", BOT, T0 + 2, 100, "ridiculous purple elephant parade tonight",
         "boostr-bot", sender=BOT),
])
p = pairs_of(conn)
check(p.get("bot1", (None, None))[1] == "msg", "strong-message tier reached, sender ignored")

print("no sender tag: the ordinary tiers, exactly as before")
conn = fresh([
    note("app1", OTHER, T0, 100, "ridiculous purple elephant parade tonight", "fountain"),
    note("bot1", BOT, T0 + 2, 100, "ridiculous purple elephant parade tonight", "boostr-bot"),
    note("app2", OTHER, T0 + 60, 123, "", "fountain"),
    note("bot2", BOT, T0 + 62, 100, "⚡ Boost ⚡", "boostr-bot"),
])
p = pairs_of(conn)
check(p.get("bot1", (None, None))[1] == "msg", "message tier still pairs on equal sats")
check("bot2" not in p, "unequal sats with no sender tag is still let through")

print("_sender_pubkey: shapes")
row = {"raw_json": json.dumps({"tags": [["sender", "npub1notvalid"]]}), "booster_pubkey": BOT}
check(dedupe._sender_pubkey(row) is None, "an undecodable npub is None, not a crash")
row = {"raw_json": None, "booster_pubkey": BOT}
check(dedupe._sender_pubkey(row) is None, "no raw event is None")
row = {"raw_json": json.dumps({"tags": [["sender", hex_to_npub(DONOR)]]}), "booster_pubkey": BOT}
check(dedupe._sender_pubkey(row) == DONOR, "a good npub decodes to the donor's hex")

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
