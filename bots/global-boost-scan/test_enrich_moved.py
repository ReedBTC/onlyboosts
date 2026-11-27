#!/usr/bin/env python3
"""A moved feed: enrich.resolve_show's `moved_to` and podroll.moved_to, with
Podcast Index stubbed. Run: python3 test_enrich_moved.py  (from this directory).

The failure it pins (2026-11-25, Local Bitcoiners, Fountain to Podhome): PI held
two entries under one podcastGuid, byguid answered the old one, which still
answered (PI crawls it through the 301) but carried stale episode art, and the
new address's entry was never read.

What it holds:
  * moved_to whose PI entry shares the guid and answers: that entry is taken;
  * moved_to equal to byguid's own URL, or absent: byguid's answer, no extra call;
  * moved_to whose entry names another guid, or does not answer, or is unknown
    to PI, or is the same entry: byguid's answer;
  * podroll.moved_to: only an all-301/308 chain counts as a move.
"""
import os
import sys
from types import SimpleNamespace as NS

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import enrich                 # noqa: E402
import podroll                # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


GUID = "56fbb1aa-da79-5e4b-bebc-3b934ab8914c"
OLD_URL = "https://feeds.fountain.fm/uv4pyDVtNAiiCCx5emOU"
NEW_URL = "https://serve.podhome.fm/rss/56fbb1aa-da79-5e4b-bebc-3b934ab8914c"
OLD = {"id": 7683299, "title": "Local Bitcoiners", "podcastGuid": GUID, "url": OLD_URL,
       "lastHttpStatus": 200, "medium": "podcast", "image": "old.jpg"}
NEW = {**OLD, "id": 8129640, "url": NEW_URL, "image": "new.jpg"}


def run(byfeedurl, moved_to):
    calls = []

    def fake(path, params, key, secret):
        calls.append(path)
        if path == "podcasts/byfeedurl" and byfeedurl is Exception:
            raise RuntimeError("PI down")
        return {"podcasts/byguid": {"feed": OLD},
                "podcasts/byfeedurl": {"feed": byfeedurl or {}},
                "episodes/byfeedid": {"items": []}}[path]
    enrich.pi_get = fake
    show = enrich.resolve_show(GUID, "k", "s", moved_to=moved_to)
    return show, [c for c in calls if c.startswith("podcasts/")]


print("moved feed, same guid, answers: the new entry")
show, calls = run(NEW, NEW_URL)
check(show["feed_id"] == 8129640 and show["feed_url"] == NEW_URL, "feed id and url are the new entry's")
check(show["image"] == "new.jpg", "metadata is the new entry's")
check(calls == ["podcasts/byguid", "podcasts/byfeedurl"], "one extra call")

print("no move recorded, or the move is byguid's own URL: unchanged, no extra call")
for mt in (None, OLD_URL):
    show, calls = run(NEW, mt)
    check(show["feed_id"] == 7683299 and calls == ["podcasts/byguid"], f"moved_to={mt!r}")

print("the address's entry is not a usable sibling: byguid's answer")
for label, entry in (("another guid", {**NEW, "podcastGuid": "a59a6c9e-0753-5675-8a46-915744be3141"}),
                     ("does not answer", {**NEW, "lastHttpStatus": 404}),
                     ("unknown to PI", None),
                     ("the same entry", OLD),
                     ("PI fails", Exception)):
    show, _ = run(entry, NEW_URL)
    check(show["feed_id"] == 7683299 and show["image"] == "old.jpg", label)

print("a pinned feed (resolve_guids `feeds`) crosses guids and keeps ours")
OTHER_GUID = {**NEW, "podcastGuid": "a82d1f80-acc3-5509-a3c2-02a3bea464bd"}
def run_pinned(byfeedurl):
    calls = []
    def fake(path, params, key, secret):
        calls.append(path)
        return {"podcasts/byguid": {"feed": OLD}, "podcasts/byfeedurl": {"feed": byfeedurl or {}},
                "episodes/byfeedid": {"items": []}}[path]
    enrich.pi_get = fake
    return enrich.resolve_show(GUID, "k", "s", moved_to=None, pinned_feed=NEW_URL)
show = run_pinned(OTHER_GUID)
check(show["feed_id"] == 8129640 and show["podcast_guid"] == GUID, "the pinned entry, filed under our guid")
show = run_pinned({**OTHER_GUID, "lastHttpStatus": 410})
check(show["feed_id"] == 7683299, "a pinned entry that does not answer is not taken")
show, _ = run(OTHER_GUID, NEW_URL)
check(show["feed_id"] == 7683299, "unpinned, another guid is still refused")

print("d1_sync.alias_pairs flattens chains")
import sqlite3, d1_sync   # noqa: E402
c = sqlite3.connect(":memory:")
c.execute("CREATE TABLE guid_aliases (raw_guid TEXT PRIMARY KEY, canonical_guid TEXT)")
c.executemany("INSERT INTO guid_aliases VALUES (?,?)", [("a", "b"), ("b", "c"), ("x", "y"), ("loop1", "loop2"), ("loop2", "loop1")])
pairs = dict(d1_sync.alias_pairs(c))
check(pairs["a"] == "c" and pairs["b"] == "c" and pairs["x"] == "y", "a→b→c lands on c")
check("loop1" not in pairs and "loop2" not in pairs, "a cycle terminates and redirects nowhere")

print("podroll.moved_to")
r = lambda codes, url=NEW_URL: NS(history=[NS(status_code=c) for c in codes], url=url)
check(podroll.moved_to(r([301])) == NEW_URL, "one 301")
check(podroll.moved_to(r([301, 308, 301])) == NEW_URL, "a 301/308 chain")
check(podroll.moved_to(r([302])) is None, "a 302 is not a move")
check(podroll.moved_to(r([301, 302])) is None, "a 302 anywhere disqualifies")
check(podroll.moved_to(r([])) is None, "no redirect")

if failures:
    print(f"\n{len(failures)} FAILED"); sys.exit(1)
print("\nall passed")
