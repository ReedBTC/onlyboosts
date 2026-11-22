#!/usr/bin/env python3
"""The Social Hour boost bot over fixtures: a feed shaped like Podhome's, built
from OB-000's real song splits, and boosts shaped like a real Fountain
descriptor and a keysend TLV. Nothing reaches the network: the descriptor
fetch and the index are stubbed. Run: python3 test_socialhour.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import boostagram                       # noqa: E402
import coverage                         # noqa: E402
import feed as feedmod                  # noqa: E402
import onlyboosts_socialhour as bot     # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


SHOW = "de0bcde8-964b-4d71-9280-85d0ca2682c8"
EP = "ep-001-guid"
# OB-000's first two plays, as splits-final.json has them.
SONG1 = ("b2a87a4c-86f0-5194-9eb3-dcba42ce0695", "1ecd5b59-0d4f-4437-8027-f931a9c799b5", 297.758, 220.56)
SONG2_FEED = "aa11aa11-0000-0000-0000-000000000002"
SONG2 = (SONG2_FEED, "bb22bb22-0000-0000-0000-000000000002", 520.136, 213.87)
NPUB = "npub12znrejs4k94kp5efhyhk9rzr9jxpy6ymgrlf6py4awpkkhed7cmshs6yg6"


def feed_xml(show_split="100", boostr=None):
    extra = (f'<podcast:valueRecipient name="Boostr" type="lnaddress" address="boostr@getalby.com" split="{boostr}"/>'
             if boostr else "")
    splits = "".join(
        f'<podcast:valueTimeSplit startTime="{s}" duration="{d}" remotePercentage="99">'
        f'<podcast:remoteItem feedGuid="{f}" itemGuid="{i}"/></podcast:valueTimeSplit>'
        for f, i, s, d in (SONG1, SONG2))
    return f"""<?xml version="1.0"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
<title>The OnlyBoosts Social Hour</title><podcast:guid>{SHOW}</podcast:guid>
<podcast:value type="lightning" method="lnaddress">
 <podcast:valueRecipient name="OnlyBoosts" type="lnaddress" address="onlyboosts@getalby.com" split="{show_split}"/>{extra}
</podcast:value>
<item><title>001. First</title><guid>{EP}</guid><link>https://example.test/ep1</link>
<podcast:value type="lightning" method="lnaddress">
 <podcast:valueRecipient name="OnlyBoosts" type="lnaddress" address="onlyboosts@getalby.com" split="{show_split}"/>{extra}
 {splits}
</podcast:value></item>
</channel></rss>""".encode()


FEED = feedmod.parse(feed_xml())
NOW = 1_795_300_000
SETTLED = "2026-11-23T12:00:00Z"
SETTLED_TS = boostagram.settled_ts(SETTLED)


def fountain_tx(ph, total_sats, leg_msat, position, group, feed_guid=SHOW, msg="Great show, loved this one!"):
    desc = {"action": "BOOST", "split": 0.01, "group": group, "message": msg,
            "link": f"https://fountain.fm/episode/X?payment={ph}", "app_name": "Fountain",
            "sender_name": "someone@fountain.fm", "sender_npub": NPUB,
            "recipient_address": "onlyboosts@getalby.com", "value_msat": leg_msat,
            "value_msat_total": total_sats * 1000, "position": position,
            "feed_guid": feed_guid, "item_guid": EP, "item_title": "001. First",
            "remote_item_guid": None, "remote_feed_guid": None}
    DESCRIPTORS[f"https://fountain.fm/episode/X?payment={ph}"] = desc
    return {"type": "incoming", "state": "settled", "appId": 55, "paymentHash": ph,
            "settledAt": SETTLED, "amount": leg_msat,
            "description": f"rss::payment::boost https://fountain.fm/episode/X?payment={ph} {msg[:20]}"}


DESCRIPTORS = {}
boostagram.fetch_descriptor = lambda url, timeout=None: DESCRIPTORS.get(url)

print("feed parsing")
item = FEED["items"][EP]
check(FEED["guid"] == SHOW and len(item["splits"]) == 2, "guid and both splits read")
check(feedmod.split_at(item, 300)["item_guid"] == SONG1[1], "position inside a split finds the song")
check(feedmod.split_at(item, 100) is None, "position in talk finds no split")
check(feedmod.split_at(item, 297.758 + 220.56) is None, "the split's end is exclusive")
check(abs(feedmod.show_share(FEED, item, None, "onlyboosts@getalby.com") - 1.0) < 1e-9, "100% while talking")
check(abs(feedmod.show_share(FEED, item, item["splits"][0], "onlyboosts@getalby.com") - 0.01) < 1e-9,
      "1% during a 99% song")
F2 = feedmod.parse(feed_xml("99", "1"))
check(abs(feedmod.show_share(F2, F2["items"][EP], F2["items"][EP]["splits"][0], "onlyboosts@getalby.com")
          - 0.0099) < 1e-9, "99/1 with Boostr: 0.99% during a song")
check(feedmod.song_guids(item) == [SONG1[0], SONG2_FEED], "song feeds in play order")

print("boostagram parsing")
m = boostagram.parse_description("rss::payment::boost https://fountain.fm/episode/abc?payment=xyz hello there")
check(m == {"action": "boost", "url": "https://fountain.fm/episode/abc?payment=xyz", "message": "hello there"},
      f"memo split keeps the query string ({m})")
k = boostagram.normalize({"action": "boost", "valueMsatTotal": "21000", "ts": 310, "guid": SHOW,
                          "episode_guid": EP, "appName": "Castamatic", "podcast": "0"}, "keysend")
check(k["value_msat_total"] == 21000 and k["position"] == 310.0 and k["feed_title"] is None,
      "keysend camelCase, ts, and a '0' placeholder")
check(boostagram.normalize({"time": "0:05:10"}, "keysend")["position"] == 310.0, "H:MM:SS time")

print("classification")
kind, info = bot.classify(fountain_tx("a" * 64, 1000, 10_000, 300.0, "g1"), FEED, NOW)
check(kind == "boost" and info["amount_verified"] and info["total_sats"] == 1000,
      f"Fountain during a song: 1% leg verifies a 1,000-sat total ({info['amount_why']})")
check(info["split"]["item_guid"] == SONG1[1] and info["item_guids"] == {EP, SONG1[1]},
      "the song playing is identified from the position")
tags = bot.note_tags(info, SHOW, "claim")
gi = [t[1] for t in tags if t[0] == "i"]
check(gi == [f"podcast:guid:{SHOW}", f"podcast:item:guid:{EP}",
             f"podcast:guid:{SONG1[0]}", f"podcast:item:guid:{SONG1[1]}"],
      "show pair first, song pair last (the collector credits the last)")
check(["amount", "1000000"] in tags and ["t", "boost"] in tags, "claim tags carry the full boost")
check(not any(t[0] == "p" for t in tags), "no lowercase p: the donor is not notified")

kind, info = bot.classify(fountain_tx("b" * 64, 1000, 1_000_000, 100.0, "g2"), FEED, NOW)
check(kind == "boost" and info["amount_verified"] and info["split"] is None, "talk: the whole boost landed")

kind, info = bot.classify(fountain_tx("c" * 64, 1000, 1_000_000, 300.0, "g3"), FEED, NOW)
check(kind == "boost" and not info["amount_verified"], f"100% landing during a song does not verify ({info['amount_why']})")
check("to the show" in bot.note_text(info, None), "an unverified note states what the show received")
check(coverage.decide(info, [], NOW, {"guids": [SHOW]})[0] == "skip", "and is never claimed")

kind, why = bot.classify(fountain_tx("d" * 64, 1000, 10_000, 300.0, "g4", feed_guid="someone-else"), FEED, NOW)
check(kind == "unrouted", f"a descriptor naming another feed is not ours ({why})")

orphan = {"type": "incoming", "state": "settled", "appId": 55, "paymentHash": "e" * 64, "settledAt": SETTLED,
          "amount": 5000, "description": "rss::payment::boost https://nowhere.test/boost/1 hi"}
check(bot.classify(orphan, FEED, SETTLED_TS + 60)[0] == "defer", "no descriptor, young: defer")
check(bot.classify(orphan, FEED, SETTLED_TS + 25 * 3600)[0] == "unrouted", "no descriptor after 24h: unrouted")

stream = dict(orphan, description="rss::payment::stream https://fountain.fm/episode/X?payment=s")
check(bot.classify(stream, FEED, NOW) == (None, None), "streams are not published")
check(bot.classify({"type": "incoming", "description": "thanks!", "amount": 1000}, FEED, NOW) == (None, None),
      "a plain payment (a site donation) is not a boost")

ks = {"type": "incoming", "state": "settled", "appId": 55, "paymentHash": "f" * 64, "settledAt": SETTLED,
      "amount": 21000, "boostagram": {"action": "boost", "valueMsatTotal": 21000, "guid": SHOW,
                                       "episode_guid": EP, "ts": 50, "appName": "Castamatic",
                                       "senderName": "Listener", "message": "keysend hello"}}
kind, info = bot.classify(ks, FEED, NOW)
check(kind == "boost" and info["amount_verified"] and info["total_sats"] == 21, "keysend in talk verifies")
check(info["sender_npub"] is None and "👤 Listener" in bot.note_text(info, None), "a name without a key shows as the name")

print("coverage")
_, info = bot.classify(fountain_tx("1" * 64, 1000, 10_000, 300.0, "g5"), FEED, NOW)
scope = {"guids": [SHOW, SONG1[0], SONG2_FEED], "show_pubkey": "ff" * 32}
under_song = {"id": "n1", "ts": SETTLED_TS + 40, "sats": 1000, "msg": "Great show, loved this one!",
              "booster": {"npub": NPUB, "pk": "aa" * 32}, "episode": {"guid": SONG1[1]}}
check(coverage.decide(info, [under_song], NOW, scope)[0] == "skip",
      "a donor note filed under the SONG covers the boost")
other_song = dict(under_song, episode={"guid": SONG2[1]})
check(coverage.decide(info, [other_song], SETTLED_TS + 30, scope)[0] == "hold",
      "a note on a different song is a different boost (held, identified donor)")
mine = dict(under_song, booster={"npub": "npub1x", "pk": "ff" * 32}, msg="")
check(coverage.decide(info, [mine], SETTLED_TS + 4000, scope)[0] == "claim",
      "our own note is never evidence; after the hour, claim")
seen = []
coverage.fetch_indexed(0, ["g-a", "g-b"], get=lambda url, t: seen.append(url) or {"boosts": []})
check(len(seen) == 2 and "podcast=g-a" in seen[0] and "podcast=g-b" in seen[1], "the index is asked under every guid")
calls = []
coverage.verify_before_claim(info, scope, fetch=lambda since, guids: calls.append(guids) or [])
check(calls == [scope["guids"]], "the last-look re-check uses the same scope, not a default")

print("one note per boost")
DESCRIPTORS.clear()
t1 = fountain_tx("2" * 64, 1000, 10_000, 300.0, "same-group")
t2 = fountain_tx("3" * 64, 1000, 10_000, 300.0, "same-group")
check(bot.classify(t1, FEED, NOW)[1]["group"] == bot.classify(t2, FEED, NOW)[1]["group"] == "same-group",
      "two legs of one boost share a group id")

if failures:
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1)
print("\nall passed")
