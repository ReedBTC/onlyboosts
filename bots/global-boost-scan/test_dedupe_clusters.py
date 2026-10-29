#!/usr/bin/env python3
"""dedupe's payment clusters, on a scratch index.
Run: python3 test_dedupe_clusters.py  (from this directory).

The failure it pins (Reed's report, 2026-10-29): Chad and Reed's show had
three relay bots restating every payment (Boostr_Bot on the 1% split,
chadf-boostbot on Chad's node, candr_boost_bot on the show's node), most
listeners boost from apps that publish no note of their own, and the filter
paired a relay note only with a NON-relay partner, one to one, on exact sats
and an exact episode. So a PodcastGuru boost stood as two or three bot notes,
a donor note with two bot restatements kept one of them, and a 6,565-sat
boost the bots printed as 6,564 and 6,600 kept all three.

What it holds:
  * two relay bots restating one payment with no donor note collapse to one,
    the keeper being the note carrying the episode;
  * three bots plus the donor's note collapse to the donor's note;
  * one note per publisher per cluster: a bot's second note (a second
    receipt) stands, even with identical prose, when its sibling's partner
    already holds that publisher — except through the per-leg sibling rule;
  * two bots naming two different senders are two payments;
  * a sender's name is not evidence: two templates both printing "Sir TJ The
    Wrathful" share no donor prose;
  * sats within ±1 or ±1% pair; a leg bot's x100 rounding pairs; 100 vs 150
    does not;
  * a missing episode on one side is a wildcard; two different episodes never
    pair;
  * a donor note arriving after two bots were paired with each other becomes
    the keeper, and the earlier keeper's cluster follows it (`repoint`);
  * a non-relay note is never marked.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                      # noqa: E402
import dedupe                  # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


BOOSTR = "ad" * 32
CANDR = "97" * 32
CHADF = "f3" * 32
DONOR = "50" * 32
SHOW = "7c6f7875-2b73-491e-b32c-e2c8d6e91d53"
ITEM = "c361f4e5-0000-4000-8000-000000000001"
ITEM2 = "c361f4e5-0000-4000-8000-000000000002"
T0 = 1_793_242_600

for slug in ("boostr-bot", "candr-boost", "chadf-boostbot"):
    assert slug in dedupe.RELAY_PUBLISHERS, slug


def note(eid, pk, ts, sats, msg, client_id, via=None, item=ITEM):
    tags = [["i", f"podcast:guid:{SHOW}"]]
    if item:
        tags.append(["i", f"podcast:item:guid:{item}"])
    return {"event_id": eid, "booster_pubkey": pk, "created_at": ts, "sats": sats,
            "podcast_guid": SHOW, "item_guid": item, "message": msg,
            "client_id": client_id, "client_via": via, "client_src": "test",
            "raw": {"id": eid, "pubkey": pk, "created_at": ts, "kind": 1,
                    "content": msg, "tags": tags}}


def candr(eid, ts, sats, sender, msg, app, item=ITEM):
    saying = f' saying "{msg}"' if msg else ""
    return note(eid, CANDR, ts, sats,
                f"⚡ [Chad and Reeds Podcast] [012. The Wait is Over] {sender} boosted {sats} sats{saying} via {app}",
                "candr-boost", via=app.lower(), item=item)


def boostr(eid, ts, sats, sender, msg, app, item=ITEM):
    return note(eid, BOOSTR, ts, sats,
                f"⚡ Boost ⚡\n\n{msg or 'No message'}\n\n{sender} boosted {sats} sats → Chad and Reeds Podcast\n📻 012. The Wait is Over",
                "boostr-bot", via=app.lower(), item=item)


def chadf(eid, ts, sats, msg, app, item=None):
    return note(eid, CHADF, ts, sats,
                f"{msg + chr(10) + chr(10) if msg else ''}⚡ {sats} sats\n📱 via {app}\n\nhttps://podcastindex.org/podcast/7968805",
                "chadf-boostbot", via=app.lower(), item=item)


def fresh(rows):
    d = tempfile.mkdtemp()
    conn = db.connect(os.path.join(d, "t.db"), apply_exclusions=False)
    conn.execute("CREATE TABLE IF NOT EXISTS d1_boosts_synced (event_id TEXT PRIMARY KEY)")
    db.upsert_boosts(conn, rows)
    return conn


def pairs_of(conn):
    return {b["event_id"]: (o["event_id"], tier, gap)
            for b, o, tier, gap in dedupe.find_duplicates(conn)}


print("two bots, no donor note: one survivor, the one with the episode")
conn = fresh([
    boostr("b1", T0, 3336, "Sir TJ The Wrathful", "listening live, but im like 30 min behind", "PodcastGuru"),
    candr("c1", T0 + 15, 3336, "Sir TJ The Wrathful", "listening live, but im like 30 min behind", "PodcastGuru"),
])
p = pairs_of(conn)
check(len(p) == 1, "exactly one note marked")
check(set(p) == {"c1"} and p["c1"][0] == "b1" or set(p) == {"b1"} and p["b1"][0] == "c1",
      "the other is its keeper")

print("keeper preference: the bot note carrying an episode beats one without")
conn = fresh([
    chadf("f1", T0, 1000, "Toast", "PodcastGuru"),
    boostr("b1", T0 + 20, 1000, "Anonymous Podcast Guru user", "Toast", "PodcastGuru"),
])
p = pairs_of(conn)
check(p.get("f1", (None,))[0] == "b1", "chadf (no episode) marked dup of Boostr (episode)")
check("b1" not in p, "Boostr's note stands")

print("three bots and the donor: the donor's note is the record")
conn = fresh([
    note("d1", DONOR, T0, 333, "Testing out the updated candr boosts page...", "boostmebitch"),
    boostr("b1", T0 - 3, 333, "ChadF and 33 others", "Testing out the updated candr boosts page...", "BoostMeBitch"),
    candr("c1", T0 + 8, 333, "ChadF and 33 others", "Testing out the updated candr boosts page...", "BoostMeBitch"),
    chadf("f1", T0 + 19, 333, "Testing out the updated candr boosts page...", "BoostMeBitch"),
])
p = pairs_of(conn)
check({k: v[0] for k, v in p.items()} == {"b1": "d1", "c1": "d1", "f1": "d1"}, "all three bots → d1")
check("d1" not in p, "the donor note is never marked")

print("one note per publisher: a second receipt from the same bot stands")
conn = fresh([
    boostr("b1", T0, 1234, "Sir Libre", "SirSpencer++", "v4vmusic-com"),
    candr("c1", T0 + 19, 1234, "Sir Libre", "SirSpencer++", "v4vmusic-com"),
    candr("c2", T0 + 800, 1234, "Sir Libre", "SirSpencer++", "v4vmusic-com"),
])
p = pairs_of(conn)
check(p.get("c1", (None,))[0] == "b1", "the near candr note pairs with Boostr")
check("c2" not in p, "the second candr note, outside the sibling window, stands")

print("two bots naming two senders are two payments")
conn = fresh([
    boostr("b1", T0, 100, "ericpp", "", "BoostMeBitch"),
    candr("c1", T0 + 10, 100, "Sir Libre", "", "BoostMeBitch"),
])
check(pairs_of(conn) == {}, "same sats, same app, different names: both stand")

print("a sender's name is not donor prose")
conn = fresh([
    candr("c1", T0, 111, "Sir TJ The Wrathful", "not letting me boost live on buddy", "PodcastGuru"),
    note("d1", DONOR, T0 + 468, 111, "⚡ Boost ⚡\n\nTest. Restarted phone. Test.\n\nSir TJ The Wrathful boosted 111 sats → Chad and Reeds Podcast", "boostmebuddy"),
])
check(pairs_of(conn) == {}, "three name words in common, contradicted prose: both stand")

print("sats tolerance")
conn = fresh([
    note("d1", DONOR, T0, 6565, "Glad you came along with us brother", "fountain"),
    candr("c1", T0 + 5, 6564, "makeheroism@fountain.fm", "Glad you came along with us brother", "Fountain"),
    boostr("b1", T0 + 20, 6600, "makeheroism@fountain.fm", "Glad you came along with us brother", "Fountain"),
])
p = pairs_of(conn)
check(p.get("c1", (None,))[0] == "d1", "6,564 pairs with 6,565 (±1)")
check(p.get("b1", (None,))[0] == "d1", "Boostr's 6,600 pairs with 6,565 (x100 rounding)")
conn = fresh([
    note("d1", DONOR, T0, 150, "Glad you came along with us brother", "fountain"),
    candr("c1", T0 + 5, 100, "makeheroism@fountain.fm", "Glad you came along with us brother", "Fountain"),
])
check(pairs_of(conn) == {}, "100 against 150 is not the same payment, whatever the prose")

print("episodes")
conn = fresh([
    boostr("b1", T0, 1000, "Anonymous Podcast Guru user", "Toast", "PodcastGuru"),
    chadf("f1", T0 + 20, 1000, "Toast", "PodcastGuru", item=None),
])
check(pairs_of(conn).get("f1", (None,))[0] == "b1", "no episode on one side is a wildcard")
conn = fresh([
    boostr("b1", T0, 1000, "Anonymous Podcast Guru user", "Toast", "PodcastGuru", item=ITEM),
    candr("c1", T0 + 20, 1000, "Anonymous Podcast Guru user", "Toast", "PodcastGuru", item=ITEM2),
])
check(pairs_of(conn) == {}, "two different episodes never pair")

print("a late donor note becomes the keeper, and the cluster follows it")
conn = fresh([
    boostr("b1", T0, 321, "Matt Finlay", "Keep building fellas, thank you!", "BoostMeBuddy"),
    candr("c1", T0 + 13, 321, "Matt Finlay", "Keep building fellas, thank you!", "BoostMeBuddy"),
])
pairs = dedupe.find_duplicates(conn)
dedupe.apply(conn, pairs)
check(conn.execute("SELECT dup_of FROM boosts WHERE event_id='c1'").fetchone()[0] == "b1",
      "first pass: candr → Boostr")
db.upsert_boosts(conn, [note("d1", DONOR, T0 + 7, 321, "Keep building fellas, thank you!", "boostmebuddy")])
pairs = dedupe.find_duplicates(conn)
tiers = {b["event_id"]: (o["event_id"], t) for b, o, t, _ in pairs}
check(tiers.get("b1", (None,))[0] == "d1", "second pass: Boostr → the donor note")
check(tiers.get("c1") == ("d1", "repoint"), "candr re-pointed at the donor note")
dedupe.apply(conn, pairs)
rows = dict(conn.execute("SELECT event_id, dup_of FROM boosts"))
check(rows == {"b1": "d1", "c1": "d1", "d1": None}, "one keeper, two marked, no chain")

print("scope: a non-relay note is never the marked side")
conn = fresh([
    note("d1", DONOR, T0, 100, "Culture comes first", "fountain"),
    note("d2", "f9" * 32, T0 + 3, 100, "Culture comes first", "fountain"),
    candr("c1", T0 + 19, 100, "aaronofessex@fountain.fm", "Culture comes first", "Fountain"),
])
p = pairs_of(conn)
check(set(p) <= {"c1"}, "only the bot note can be marked")

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
