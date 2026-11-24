#!/usr/bin/env python3
"""split_credit.credit_splits, over a fixture box database built from the real
schema through db.connect, with every feed fetch stubbed. Also the D1 side:
d1_sync.build_credits_sql's statements, run against d1/schema.sql in SQLite.
Run: python3 test_split_credit.py  (from this directory).
"""
import json
import os
import sqlite3
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                     # noqa: E402
import d1_sync                # noqa: E402
import split_credit as sc     # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


NOW = int(time.time())
HOST = "ac746d09-7c3b-5bcd-b28a-f12d6456ca8f"       # a podcast that plays songs
LIVE = "41aace28-8679-5ef1-9958-75cf76c2b5f0"       # a podcast whose split is live-only
ALBUM = "6c277321-9d2c-5cd2-98b1-f49efcea0602"      # the song's feed
ALBUM2 = "00f7669f-050e-551f-9e43-6195893835bc"
HOST_URL, LIVE_URL, ALBUM_URL = ("https://example.invalid/host.xml", "https://example.invalid/live.xml",
                                 "https://example.invalid/album.xml")
EP, EP_NOPCT, EP_OLD = "hh-158", "hh-159", "hh-101"  # EP_OLD: trimmed off the host feed
LIVE_EP = "dv-83"
SONG, SONG2, SONG_NEW = "song-1", "song-2", "song-new"   # SONG_NEW: on the album feed, no episodes row
NOT_A_SONG = "440"

host_xml = {"text": f"""<rss><channel>
<item><guid>{EP}</guid><title>Episode 158</title>
  <podcast:value type="lightning" method="keysend">
    <podcast:valueTimeSplit startTime="60" duration="200" remotePercentage="90">
      <podcast:remoteItem feedGuid="{ALBUM}" itemGuid="{SONG}"/>
    </podcast:valueTimeSplit>
    <podcast:valueTimeSplit startTime="300" duration="200" remotePercentage="95">
      <podcast:remoteItem feedGuid="{ALBUM}" itemGuid="{SONG_NEW}"/>
    </podcast:valueTimeSplit>
  </podcast:value></item>
<item><guid>{EP_NOPCT}</guid><title>Episode 159</title>
  <podcast:value><podcast:valueTimeSplit startTime="1" duration="2">
    <podcast:remoteItem feedGuid="{ALBUM2}" itemGuid="{SONG2}"/></podcast:valueTimeSplit></podcast:value></item>
</channel></rss>"""}
ALBUM_XML = f"""<rss><channel><item><guid>{SONG_NEW}</guid><title>New Song</title></item></channel></rss>"""
fetches = []


def fetch(url):
    fetches.append(url)
    return {HOST_URL: host_xml["text"], ALBUM_URL: ALBUM_XML,
            LIVE_URL: "<rss><channel><podcast:liveItem><guid>dv-83</guid></podcast:liveItem></channel></rss>"}.get(url)


def tags(*pairs, show_only=()):
    t = []
    for g, i in pairs:
        t += [["i", f"podcast:guid:{g}"], ["i", f"podcast:item:guid:{i}"]]
    t += [["i", f"podcast:guid:{g}"] for g in show_only]
    return json.dumps({"tags": t})


print("pure parts")
check(sc.split_sats(1000, 90) == (900, 100), "1000 at 90% → 900 / 100")
check(sc.split_sats(333, 99) == (330, 3), "333 at 99% → 329.67 rounds the track up: 330 / 3")
check(sc.split_sats(5, 50) == (3, 2), "a .5 tie goes to the track and the shares still add up")
check(sc.split_sats(777, None) == (777, 0), "unknown pct: the track takes every sat")
check(all(sum(sc.split_sats(s, p)) == s for s in (0, 1, 7, 333, 2222, 42000) for p in (0, 1, 33.3, 50, 88, 99, 100)),
      "the two shares always add up to the boost")
sp = sc.parse_splits(host_xml["text"])
check(sp[EP] == [(SONG, ALBUM, 90.0), (SONG_NEW, ALBUM, 95.0)], f"windows parsed: {sp[EP]}")
check(sp[EP_NOPCT] == [(SONG2, ALBUM2, 100.0)], "remotePercentage absent → the spec's 100")
check(sc.note_ids(tags((HOST, EP), (ALBUM, SONG))) == ([EP, SONG], [HOST, ALBUM]), "note ids, distinct, in order")

with tempfile.TemporaryDirectory() as tmp:
    conn = db.connect(os.path.join(tmp, "box.db"), apply_exclusions=False)
    for g, medium, url in ((HOST, "podcast", HOST_URL), (LIVE, "podcast", LIVE_URL),
                           (ALBUM, "music", ALBUM_URL), (ALBUM2, None, None)):
        conn.execute("INSERT INTO shows (podcast_guid, title, medium, feed_url, updated_at) VALUES (?,?,?,?,?)",
                     (g, g[:8], medium, url, NOW))
    conn.execute("DELETE FROM shows WHERE podcast_guid=?", (ALBUM2,))     # a credited feed with no shows row
    for item, feed in ((EP, HOST), (EP_NOPCT, HOST), (SONG, ALBUM), (SONG2, ALBUM2), (LIVE_EP, LIVE)):
        conn.execute("INSERT INTO episodes (item_guid, title, podcast_guid, updated_at) VALUES (?,?,?,?)",
                     (item, item, feed, NOW))
    boosts = [
        # event, sats, primary (guid, item), raw, excluded
        ("ev_bmb",   1000, (ALBUM, SONG), tags((HOST, EP), (ALBUM, SONG)), 0),      # BMB: host pair first
        ("ev_chadf",  333, (HOST, EP),    tags((ALBUM, SONG), (HOST, EP)), 0),      # song first; primary is the host today
        ("ev_new",    100, (ALBUM, SONG_NEW), tags((HOST, EP), (ALBUM, SONG_NEW)), 0),
        ("ev_100",     50, (ALBUM2, SONG2), tags((HOST, EP_NOPCT), (ALBUM2, SONG2)), 0),
        ("ev_live",  2222, (LIVE, LIVE_EP), tags((LIVE, LIVE_EP), (ALBUM, SONG)), 0),
        ("ev_tag",    777, (ALBUM, SONG), json.dumps({"tags": [["i", f"podcast:item:guid:{EP_OLD}"],
                                                               ["i", f"podcast:guid:{HOST}"],
                                                               ["i", f"podcast:guid:{ALBUM}"],
                                                               ["i", f"podcast:item:guid:{SONG}"]]}), 0),
        ("ev_440",  42000, (HOST, EP),    tags((HOST, EP), (HOST, NOT_A_SONG)), 0),
        ("ev_mm",     100, (ALBUM, SONG), tags((ALBUM, SONG), (ALBUM, SONG_NEW)), 0),
        ("ev_excl",   100, (ALBUM, SONG), tags((HOST, EP), (ALBUM, SONG)), 1),
        ("ev_one",    100, (ALBUM, SONG), tags((ALBUM, SONG), (ALBUM, SONG)), 0),
    ]
    for ev, sats, (g, item), raw, ex in boosts:
        conn.execute("""INSERT INTO boosts (event_id, booster_pubkey, created_at, sats, podcast_guid,
                                            item_guid, raw_json, excluded)
                        VALUES (?,?,?,?,?,?,?,?)""", (ev, "pk", NOW, sats, g, item, raw, ex))
    conn.commit()
    boost_rows = {r[0]: r for r in conn.execute("SELECT * FROM boosts")}

    def credits(ev):
        return {r["role"]: dict(r) for r in conn.execute(
            "SELECT * FROM boost_credits WHERE event_id=?", (ev,))}

    print("dry run writes nothing")
    res = sc.credit_splits(conn, log=lambda m: None, fetch=fetch, dry_run=True, now=NOW)
    check(res["placed"] == 6 and not conn.execute("SELECT COUNT(*) FROM boost_credits").fetchone()[0],
          f"dry run reports 6, writes none ({res['placed']})")

    print("a live run")
    fetches.clear()
    res = sc.credit_splits(conn, log=lambda m: None, fetch=fetch, now=NOW)
    c = credits("ev_bmb")
    check(c["track"]["podcast_guid"] == ALBUM and c["track"]["item_guid"] == SONG and c["track"]["sats"] == 900,
          "host pair first (BMB): the track row is the song, 900 sats")
    check(c["host"]["podcast_guid"] == HOST and c["host"]["item_guid"] == EP and c["host"]["sats"] == 100,
          "and the host row the episode, 100 sats")
    check(c["host"]["pct"] == 90 and c["host"]["method"] == "rss", "pct as the feed wrote it, method rss")
    c = credits("ev_chadf")
    check(c["track"]["item_guid"] == SONG and c["host"]["item_guid"] == EP and
          (c["track"]["sats"], c["host"]["sats"]) == (300, 33), "song pair first: same answer, 300 / 33")
    check(credits("ev_new")["track"]["pct"] == 95, "the window for THIS song, not the episode's first one")
    check(credits("ev_100")["track"]["sats"] == 50, "no remotePercentage → 100: the song takes all 50")
    c = credits("ev_live")
    check(c["host"]["method"] == "medium" and c["host"]["pct"] is None and
          (c["track"]["sats"], c["host"]["sats"]) == (2222, 0), "live-only split: medium, pct NULL, 2222 / 0")
    c = credits("ev_tag")
    check(c["host"]["method"] == "tag" and c["host"]["podcast_guid"] == HOST and c["host"]["item_guid"] == EP_OLD,
          "host item off the feed: the note's one podcast show places it (tag)")
    for ev, why in (("ev_440", "a 'song' on no feed"), ("ev_mm", "two music items"),
                    ("ev_excl", "an excluded boost"), ("ev_one", "one item tagged twice")):
        check(not credits(ev), f"left as it is: {why}")
    check(res["reasons"].get("track-unknown") == 1, f"the 42k case is counted as track-unknown: {res['reasons']}")
    check(all(sum(r["sats"] for r in credits(ev).values()) == boost_rows[ev]["sats"]
              for ev in ("ev_bmb", "ev_chadf", "ev_new", "ev_100", "ev_live", "ev_tag")),
          "every placed pair adds up to its boost")
    check(fetches.count(HOST_URL) == 1, f"the host feed is read once per run ({fetches.count(HOST_URL)})")
    check({r[0]: tuple(r[1:]) for r in conn.execute(
        "SELECT event_id, podcast_guid, item_guid, sats FROM boosts")} ==
          {k: (v["podcast_guid"], v["item_guid"], v["sats"]) for k, v in boost_rows.items()},
          "no boosts row changed")
    check(conn.execute("SELECT podcast_guid FROM episodes WHERE item_guid=?", (SONG_NEW,)).fetchone()[0] == ALBUM,
          "a credited song with no episodes row gets one from its feed")
    check(ALBUM2 in db.guids_needing_show(conn), "a credited feed with no shows row is queued for enrich")

    print("the next tick is a no-op")
    fetches.clear()
    res = sc.credit_splits(conn, log=lambda m: None, fetch=fetch, now=NOW + 120)
    check(res["placed"] == 0 and not fetches, f"nothing re-read ({fetches})")

    print("the weekly re-read")
    host_xml["text"] = host_xml["text"].replace("</channel>", f"""<item><guid>{EP_OLD}</guid>
      <podcast:value><podcast:valueTimeSplit startTime="1" duration="2" remotePercentage="80">
      <podcast:remoteItem feedGuid="{ALBUM}" itemGuid="{SONG}"/></podcast:valueTimeSplit></podcast:value></item></channel>""")
    host_xml["text"] = host_xml["text"].replace('remotePercentage="90"', 'remotePercentage="10"')
    res = sc.credit_splits(conn, log=lambda m: None, fetch=fetch, now=NOW + sc.SPLIT_RETRY + 1)
    c = credits("ev_tag")
    check(c["host"]["method"] == "rss" and c["host"]["pct"] == 80 and
          (c["track"]["sats"], c["host"]["sats"]) == (622, 155), "a percentage found later rewrites both rows")
    check(res["rewritten"] == 1, f"counted as a rewrite ({res['rewritten']})")
    check(credits("ev_bmb")["host"]["pct"] == 90, "a placed percentage is never revisited")
    check(credits("ev_live")["host"]["pct"] is None, "still unknown stays unknown")

    print("D1")
    q = db.reproject_queue(conn)
    stmts, synced, pairs = d1_sync.build_credits_sql(conn, q)
    check(stmts[:len(d1_sync.CREDITS_DDL)] == d1_sync.CREDITS_DDL, "the batch opens with the table's DDL")
    check(len(synced) == 12, f"six pairs to push ({len(synced)})")
    d1 = sqlite3.connect(":memory:")
    d1.executescript(open(os.path.join(HERE, "d1", "schema.sql")).read())
    d1.executescript("\n".join(stmts))
    check(d1.execute("SELECT COUNT(*), SUM(sats) FROM boost_credits").fetchone() ==
          (12, sum(boost_rows[e]["sats"] for e in ("ev_bmb", "ev_chadf", "ev_new", "ev_100", "ev_live", "ev_tag"))),
          "they land in d1/schema.sql's table and add up")
    d1.executescript("\n".join(d1_sync.CREDITS_DDL))
    check(True, "the DDL is idempotent beside schema.sql's")
    conn.executemany("UPDATE boost_credits SET d1_synced=1 WHERE event_id=? AND role=? AND checked_at=?", synced)

    print("a boost that becomes a duplicate loses its credits")
    conn.execute("UPDATE boosts SET dup_of='ev_bmb' WHERE event_id='ev_chadf'")
    conn.commit()
    res = sc.credit_splits(conn, log=lambda m: None, fetch=fetch, now=NOW + sc.SPLIT_RETRY + 200)
    check(res["pruned"] == 1 and not credits("ev_chadf"), "pruned locally")
    stmts, synced, pairs = d1_sync.build_credits_sql(conn, db.reproject_queue(conn))
    check("DELETE FROM boost_credits WHERE event_id='ev_chadf';" in stmts and pairs == [("credit", "ev_chadf")],
          "and deleted in D1 through the reproject queue")
    d1.executescript("\n".join(stmts))
    check(d1.execute("SELECT COUNT(*) FROM boost_credits WHERE event_id='ev_chadf'").fetchone()[0] == 0,
          "gone from the D1 copy")

print()
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("all passed")
