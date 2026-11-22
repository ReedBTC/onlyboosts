#!/usr/bin/env python3
"""OB Boostbot over fixtures: a feed shaped like Podhome's, built from OB-000's
real song splits, and boosts shaped like a real Fountain descriptor and a
keysend TLV. Nothing reaches the network: Podcast Index, the feed fetch, the
descriptor fetch and the index are stubbed. Run: python3 test_boostbot.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import boostagram                       # noqa: E402
import coverage                         # noqa: E402
import feed as feedmod                  # noqa: E402
import onlyboosts_boostbot as bot       # noqa: E402

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


OTHER = "c0ffee00-0000-0000-0000-00000000beef"
OTHER_XML = feed_xml().replace(SHOW.encode(), OTHER.encode()).replace(b"onlyboosts@getalby.com", b"someone@getalby.com")
FEEDS_BY_URL = {"https://serve.example/social.xml": feed_xml(), "https://serve.example/other.xml": OTHER_XML}
PI = {SHOW: {"url": "https://serve.example/social.xml", "id": 7700001, "podcastGuid": SHOW},
      OTHER: {"url": "https://serve.example/other.xml", "id": 4242, "podcastGuid": OTHER}}
PI_BY_ID = {str(v["id"]): v for v in PI.values()}


def fake_pi(path, params, config):
    if path == "podcasts/byguid":
        return {"feed": PI.get(params["guid"], [])}
    if path == "podcasts/byfeedid":
        return {"feed": PI_BY_ID.get(str(params["id"]), [])}
    raise AssertionError(path)


bot._pi_get = fake_pi
feedmod.fetch = lambda url, timeout=None: feedmod.parse(FEEDS_BY_URL[url])


def cls(tx, now=NOW):
    return bot.classify(tx, {}, {}, now)


print("classification")
kind, info = cls(fountain_tx("a" * 64, 1000, 10_000, 300.0, "g1"))
check(kind == "boost" and info["amount_verified"] and info["total_sats"] == 1000,
      f"Fountain during a song: 1% leg verifies a 1,000-sat total ({info['amount_why']})")
check(info["item_guids"] == {EP, SONG1[1]}, "the song playing joins the duplicate check")
tags = bot.note_tags(info, "claim")
gi = [t[1] for t in tags if t[0] == "i"]
check(gi == [f"podcast:guid:{SHOW}", f"podcast:item:guid:{EP}"],
      "show credit, as the site does today: the show and episode only")
check(["amount", "1000000"] in tags and ["t", "boostagram"] in tags and ["client", "onlyboosts.social"] in tags,
      "a claim carries the site's evidence tags and the full boost")
check(not any(t[0] in ("p", "P") for t in tags), "no p or P: the donor is named in prose only")
text = bot.note_text(info)
check(text.split("\n")[:2] == [bot.BOOST_BANNER_URL, "⚡Just boosted 1,000 sats 📱 via Fountain"],
      "OB Boostbot's banner and ⚡ line, with the donor's app")
check(f"👤 From nostr:{NPUB}" in text and '💬 "Great show, loved this one!"' in text
      and "🎙️ The OnlyBoosts Social Hour • 001. First" in text, "From, message and show • episode lines")
check(not any(t[0] in ("t", "amount") for t in bot.note_tags(info, "untagged")),
      "an untagged note carries no evidence an index would count")

kind, info = cls(fountain_tx("b" * 64, 1000, 1_000_000, 100.0, "g2"))
check(kind == "boost" and info["amount_verified"], "talk: the whole boost landed and verifies")

kind, info = cls(fountain_tx("c" * 64, 1000, 1_000_000, 300.0, "g3"))
check(kind == "boost" and not info["amount_verified"], f"100% landing during a song does not verify ({info['amount_why']})")
check("1,000 sats" in bot.note_text(info), "unverified and over 5 sats: the figure that landed")
kind, info = cls(fountain_tx("c2" * 32, 1000, 5_000, 100.0, "g3b"))
check(not info["amount_verified"] and bot.note_text(info).split("\n")[1] == "⚡Boosted via Fountain",
      "unverified and 5 sats or less: no figure (Reed)")

kind, why = cls(fountain_tx("d" * 64, 1000, 10_000, 300.0, "g4", feed_guid=OTHER))
check(kind == "unrouted" and "does not pay" in why, f"a feed that does not pay onlyboosts is not ours ({why})")

orphan = {"type": "incoming", "state": "settled", "appId": 55, "paymentHash": "e" * 64, "settledAt": SETTLED,
          "amount": 5000, "description": "rss::payment::boost https://nowhere.test/boost/1 hi"}
check(cls(orphan, SETTLED_TS + 60)[0] == "defer", "no descriptor, young: defer")
check(cls(orphan, SETTLED_TS + 25 * 3600)[0] == "unrouted", "no descriptor after 24h: unrouted")
stream = dict(orphan, description="rss::payment::stream https://fountain.fm/episode/X?payment=s")
check(cls(stream) == (None, None), "streams are not published")
check(cls({"type": "incoming", "description": "thanks!", "amount": 1000}) == (None, None),
      "a plain payment (a site donation) is not a boost")

ks = {"type": "incoming", "state": "settled", "appId": 55, "paymentHash": "f" * 64, "settledAt": SETTLED,
      "amount": 21000, "boostagram": {"action": "boost", "valueMsatTotal": 21000, "guid": SHOW,
                                       "episode_guid": EP, "ts": 50, "appName": "Castamatic",
                                       "senderName": "Listener", "message": "keysend hello"}}
kind, info = cls(ks)
check(kind == "boost" and info["amount_verified"] and info["total_sats"] == 21, "keysend in talk verifies")
check("👤 From Listener" in bot.note_text(info), "a name without a key shows as the name")

print("feed gate")
def gate(**bg):
    base = {"action": "boost", "valueMsatTotal": 21000, "episode_guid": EP, "ts": 50}
    base.update(bg)
    return cls(dict(ks, boostagram=base))
check(gate(feedID=7700001)[0] == "boost", "a Podcast Index feed id alone resolves the feed")
check(gate(feedID=7700001, url="https://serve.example/social.xml/")[0] == "boost", "id and normalised url agree")
check(gate(feedID=7700001, url="https://other.test/feed.xml")[0] == "unrouted", "one contradicting signal is decisive")
check(gate(guid=SHOW, feedID=4242)[0] == "unrouted", "a feed id naming another feed beside the right guid")
check(gate(podcast="The OnlyBoosts Social Hour")[0] == "unrouted", "a title alone is not a signal")
check(gate(guid="unknown-to-pi", url="https://serve.example/social.xml")[0] == "unrouted",
      "a url whose feed carries another guid contradicts")
check(gate(guid="unknown-to-pi")[0] == "defer", "a feed Podcast Index does not list yet is retried, not dropped")

print("coverage")
_, info = cls(fountain_tx("1" * 64, 1000, 10_000, 300.0, "g5"))
scope = {"guids": [SHOW, SONG1[0]], "show_pubkey": None}
under_song = {"id": "n1", "ts": SETTLED_TS + 40, "sats": 1000, "msg": "Great show, loved this one!",
              "booster": {"npub": NPUB, "pk": "aa" * 32}, "episode": {"guid": SONG1[1]}}
check(coverage.decide(info, [under_song], NOW, scope)[0] == "skip",
      "a donor note filed under the SONG covers the boost: no note")
other_song = dict(under_song, episode={"guid": SONG2[1]})
check(coverage.decide(info, [other_song], SETTLED_TS + 30, scope)[0] == "hold",
      "a note on a different song is a different boost (held, identified donor)")
site_bot = dict(under_song, booster={"npub": "npub1x", "pk": bot.BOT_PUBKEY}, msg="", episode={"guid": EP})
check(coverage.decide(info, [site_bot], SETTLED_TS + 4000, scope)[0] == "skip",
      "OB Boostbot's own site note for the payment is evidence: no second note")
check(coverage.decide(info, [], SETTLED_TS + 4000, scope)[0] == "claim", "nothing after the hour, verified: claim")
_, unv = cls(fountain_tx("1b" * 32, 1000, 1_000_000, 300.0, "g6"))
check(coverage.decide(unv, [], SETTLED_TS + 4000, scope)[0] == "untagged", "unverified: published, never claimed")
check(coverage.decide(info, None, SETTLED_TS + 4000, scope)[0] == "untagged",
      "index down past the window: never claimed blind")
seen = []
coverage.fetch_indexed(0, ["g-a", "g-b"], get=lambda url, t: seen.append(url) or {"boosts": []})
check(len(seen) == 2 and "podcast=g-a" in seen[0] and "podcast=g-b" in seen[1], "the index is asked under every guid")
calls = []
coverage.verify_before_claim(info, scope, fetch=lambda since, guids: calls.append(guids) or [])
check(calls == [scope["guids"]], "the last-look re-check uses the same scope, not a default")
def capped(url, t):
    return {"boosts": [{"id": url + str(len(url))}], "next_cursor": "more"}
try:
    coverage.fetch_indexed(0, ["busy-artist"], get=capped)
    check(False, "a page cap that is reached raises")
except coverage.CoverageUnavailable:
    check(True, "a page cap that is reached raises (unknown, never absence)")
full = [{"id": str(i), "pubkey": "bb" * 32, "tags": [], "content": ""} for i in range(coverage.RELAY_LIMIT)]
ev, why = coverage.relay_note_for(info, SETTLED_TS, scope, ["wss://r.test"], lambda r, f: full)
check(ev is not None and "limit" in why, "a relay answer at its limit vetoes")

print("one note per boost")
t1 = fountain_tx("2" * 64, 1000, 10_000, 300.0, "same-group")
t2 = fountain_tx("3" * 64, 1000, 10_000, 300.0, "same-group")
check(cls(t1)[1]["group"] == cls(t2)[1]["group"] == "same-group", "two legs of one boost share a group id")

print("a note counts as published only when a relay accepts it")
import json as _json
import nostr_utils
from pynostr.key import PrivateKey


class FakeWS:
    def __init__(self, answers):
        self.answers, self.sent = answers, None
    def send(self, m):
        self.sent = _json.loads(m)[1]["id"]
    def recv(self):
        a = self.answers.pop(0)
        return _json.dumps([x if x != "ID" else self.sent for x in a])
    def close(self):
        pass


def publish_with(*per_relay):
    conns = iter(per_relay)
    nostr_utils.websocket.create_connection = lambda relay, timeout=10: FakeWS(list(next(conns)))
    return nostr_utils.publish_to_nostr("t", PrivateKey().bech32(), relays=[f"wss://r{i}.test" for i in range(len(per_relay))],
                                        created_at=1795300000)


check(publish_with([["OK", "ID", False, "blocked"]], [["NOTICE", "hi"], ["OK", "ID", True, ""]]) is not None,
      "a NOTICE before the OK is read past; one acceptance is enough")
check(publish_with([["OK", "ID", False, "blocked"]], [["OK", "ID", False, "rate-limited"]]) is None,
      "OK carrying false from every relay is not published")
check(publish_with([["OK", "someone-else", True, ""]] * 5) is None, "an OK for another event id does not count")

print("exclusion list")
boostagram.fetch_descriptor = lambda url, timeout=None: DESCRIPTORS.get(url)
bot.DEFERRED.clear()
ex = {"guids": {EP}, "feeds": set(), "pubkeys": set()}
kind, why = bot.classify(fountain_tx("e" * 64, 1000, 10_000, 300.0, "g1"), {}, {}, NOW, ex)
check(kind == "unrouted" and why.startswith("excluded:"), f"an excluded episode is never published ({why})")
ex = {"guids": {SONG1[1]}, "feeds": set(), "pubkeys": set()}
kind, why = bot.classify(fountain_tx("f" * 64, 1000, 10_000, 300.0, "g1"), {}, {}, NOW, ex)
check(kind == "unrouted", "a guid on the list matches any slot, the song playing included")
kind, _ = bot.classify(fountain_tx("9" * 64, 1000, 10_000, 300.0, "g1"), {}, {}, NOW,
                       {"guids": {"someone-else"}, "feeds": set(), "pubkeys": set()})
check(kind == "boost", "a list naming other things lets the boost through")
real = bot.load_excludes()
check(isinstance(real["guids"], set) and real["guids"], "the repo's excludes.json parses and names guids")
_tiny = dict(info, amount_verified=False, our_sats=1, app_name="BoostMeBitch")
check(bot.note_text(_tiny).split("\n")[1] == "⚡Boosted via BoostMeBitch", "no figure: Boosted via the app")
check(bot.note_text(dict(_tiny, app_name=None)).split("\n")[1] == "⚡Boosted", "no figure and no app: Boosted")

if failures:
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1)
print("\nall passed")
