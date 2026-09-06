#!/usr/bin/env python3
"""enrich.resolve_show's live-sibling rule, with Podcast Index stubbed.
Run: python3 test_enrich_sibling.py  (from this directory).

The failure it pins: `podcasts/byguid` naming a feed whose URL has been 404 for
a year while a second PI entry under the same podcastGuid is live (Stacker News
Live, Anchor → Fountain, 2025-08). The rule: a byguid answer that does not
answer is replaced by a sibling that shares its podcastGuid AND answers, read in
full through byfeedid; anything else keeps byguid's answer exactly as before.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import enrich                 # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


GUID = "afbaa6da-4219-55dd-934a-96e0bc79c442"
DEAD = {"id": 4866432, "title": "Stacker News Live", "podcastGuid": GUID,
        "url": "https://anchor.fm/s/100253d38/podcast/rss", "itunesId": 1607607566,
        "lastHttpStatus": 404, "dead": 0, "medium": "podcast", "language": "en"}
LIVE_THIN = {"id": 7475249, "title": "Stacker News Live", "podcastGuid": GUID,
             "url": "https://feeds.fountain.fm/BXFW5ku8MS7KtGBDSino",
             "lastHttpStatus": 200, "medium": None}                     # byitunesid's shape
LIVE_FULL = {**LIVE_THIN, "medium": "music", "language": "de", "author": "Car and Keyan"}
OTHER = {"id": 999, "title": "Stacker News Live", "podcastGuid": "not-the-same-guid",
         "url": "https://example.com/lookalike.xml", "lastHttpStatus": 200}


def run(byguid, byitunes=None, search=None, byfeedid=None):
    calls = []

    def fake(path, params, key, secret):
        calls.append(path)
        return {"podcasts/byguid": {"feed": byguid},
                "podcasts/byitunesid": {"feed": byitunes or {}},
                "search/byterm": {"feeds": search or []},
                "podcasts/byfeedid": {"feed": byfeedid or {}}}[path]
    enrich.pi_get = fake
    return enrich.resolve_show(GUID, "k", "s"), calls


print("live byguid answer: taken as-is, one call")
show, calls = run({**DEAD, "lastHttpStatus": 200})
check(show["feed_id"] == 4866432 and calls == ["podcasts/byguid"], "no sibling probe when the feed answers")

print("dead byguid answer, live sibling by itunesId: the sibling, read in full")
show, calls = run(DEAD, byitunes=LIVE_THIN, byfeedid=LIVE_FULL)
check(show["feed_id"] == 7475249, "feed_id is the sibling's")
check(show["feed_url"] == LIVE_FULL["url"], "feed_url is the sibling's")
check(show["podcast_guid"] == GUID, "guid is the one asked for")
check(show["medium"] == "music" and show["language"] == "de" and show["author"] == "Car and Keyan",
      "the row is built from byfeedid's full object, not the thin itunes one")
check("podcasts/byfeedid" in calls, "byfeedid was consulted")

print("dead byguid answer, sibling found by title search when there is no itunesId")
show, calls = run({**DEAD, "itunesId": None}, search=[OTHER, LIVE_THIN], byfeedid=LIVE_FULL)
check(show["feed_id"] == 7475249, "the search hit sharing the guid wins")
check("podcasts/byitunesid" not in calls, "no itunes call without an itunesId")

print("dead byguid answer, only a lookalike with another guid: byguid's answer kept")
show, calls = run(DEAD, byitunes=OTHER, search=[OTHER])
check(show["feed_id"] == 4866432 and show["feed_url"] == DEAD["url"], "a different podcastGuid is never taken")

print("dead byguid answer, sibling also dead: kept")
show, calls = run(DEAD, byitunes={**LIVE_THIN, "lastHttpStatus": 404})
check(show["feed_id"] == 4866432, "a sibling that does not answer is not an upgrade")

print("dead byguid answer, sibling's full read disagrees: kept")
show, calls = run(DEAD, byitunes=LIVE_THIN, byfeedid={**LIVE_FULL, "podcastGuid": "moved"})
check(show["feed_id"] == 4866432, "byfeedid must confirm the guid")

print("dead byguid answer, sibling probe throws: kept, not crashed")
def boom(path, params, key, secret):
    if path == "podcasts/byguid":
        return {"feed": DEAD}
    raise RuntimeError("PI down")
enrich.pi_get = boom
show = enrich.resolve_show(GUID, "k", "s")
check(show is not None and show["feed_id"] == 4866432, "a failed probe degrades to today's behaviour")

print("PI status 667 (parse error) with no sibling anywhere: kept")
show, calls = run({**DEAD, "lastHttpStatus": 667}, byitunes={}, search=[])
check(show["feed_id"] == 4866432, "no sibling, no change")

print()
print("FAILURES:" if failures else "all checks passed", *failures, sep="\n  ")
sys.exit(1 if failures else 0)
