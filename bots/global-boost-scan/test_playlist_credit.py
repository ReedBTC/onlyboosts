#!/usr/bin/env python3
"""resolve_guids.credit_playlist_songs, over a fixture box database built from the
real schema through db.connect, with the playlist fetch stubbed and Podcast Index
made to throw. Run: python3 test_playlist_credit.py  (from this directory).
"""
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                     # noqa: E402
import enrich                 # noqa: E402
import resolve_guids          # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


def boom(*a, **k):
    raise AssertionError("Podcast Index was asked")


enrich.pi_get = boom
NOW = int(time.time())
PLAYLIST = "88b0640a-489f-4920-be4f-00f85af5b2d4"          # ITDV music playlist, musicL
PLAYLIST_URL = "https://example.invalid/itdv.xml"
ALBUM = "2b62ef49-fcff-523c-b81a-0a7dde2b0609"             # the song's own feed
SINGLE = "60e9fcee-0285-5ba9-870f-7e4c381ef846"
SHOW = "afbaa6da-4219-55dd-934a-96e0bc79c442"              # an ordinary podcast
ELSEWHERE = "0190a191-c158-5efc-bb57-70bf1b7f09a6"
SONG_IN_LIST = "2f1fabc9-54c0-4e96-93d8-98737356b448"      # never enriched; the list places it
SONG_KNOWN = "4554be73-db5e-40b1-aa1f-ff34fe39f1bf"        # enriched, on SINGLE
SONG_TAGGED = "a2bf5272-8811-4882-aa39-a730c290af4d"       # not in the list, tag names ALBUM
SONG_LOST = "f625b843-a09e-44b4-853d-0ed729db6708"         # nothing places it
EP_MOVED = "7a6ef9ea-719d-434c-91c7-5c66b6079679"          # podcast item that lives on ELSEWHERE

PLAYLIST_XML = f"""<rss><channel>
  <podcast:medium>musicL</podcast:medium>
  <podcast:guid>{PLAYLIST}</podcast:guid>
  <podcast:publisher>
    <podcast:remoteItem medium="publisher" feedGuid="a778e463-ecc3-5219-8f05-f33b3983e173"/>
  </podcast:publisher>
  <podcast:remoteItem feedGuid="{ALBUM}" itemGuid="{SONG_IN_LIST}"/>
  <podcast:remoteItem feedGuid="{SINGLE}" itemGuid="{SONG_KNOWN}"/>
</channel></rss>"""

fetches = []


def fetch(url):
    fetches.append(url)
    return PLAYLIST_XML if url == PLAYLIST_URL else None


def tags(*guids, item):
    t = [["i", f"podcast:guid:{g}"] for g in guids]
    return json.dumps({"tags": t + [["i", f"podcast:item:guid:{item}"]]})


print("parse_playlist")
m = resolve_guids.parse_playlist(PLAYLIST_XML)
check(m == {SONG_IN_LIST: ALBUM, SONG_KNOWN: SINGLE}, "item-level remoteItems only, publisher link skipped")
clash = PLAYLIST_XML.replace("</channel>", f'<podcast:remoteItem feedGuid="{SHOW}" itemGuid="{SONG_KNOWN}"/></channel>')
check(SONG_KNOWN not in resolve_guids.parse_playlist(clash), "an item listed under two feeds places nothing")
check(resolve_guids.parse_playlist(None) == {}, "a dead feed is an empty map")

with tempfile.TemporaryDirectory() as tmp:
    conn = db.connect(os.path.join(tmp, "box.db"), apply_exclusions=False)
    for g, medium, url in ((PLAYLIST, "musicL", PLAYLIST_URL), (ALBUM, "music", None),
                           (SINGLE, "music", None), (SHOW, "podcast", None),
                           (ELSEWHERE, "podcast", None)):
        conn.execute("INSERT INTO shows (podcast_guid, title, medium, feed_url, updated_at) VALUES (?,?,?,?,?)",
                     (g, g[:8], medium, url, NOW))
    conn.execute("INSERT INTO episodes (item_guid, title, podcast_guid, updated_at) VALUES (?,?,?,?)",
                 (SONG_KNOWN, "Lowkey", SINGLE, NOW))
    conn.execute("INSERT INTO episodes (item_guid, title, podcast_guid, updated_at) VALUES (?,?,?,?)",
                 (EP_MOVED, "an episode", ELSEWHERE, NOW))
    boosts = [
        # (event_id, as-signed guid, item, raw tags, excluded)
        ("ev_list",   PLAYLIST, SONG_IN_LIST, tags(ALBUM, PLAYLIST, item=SONG_IN_LIST), 0),
        ("ev_noguid", None,     SONG_KNOWN,   tags(item=SONG_KNOWN), 0),
        ("ev_tag",    PLAYLIST, SONG_TAGGED,  tags(ALBUM, PLAYLIST, item=SONG_TAGGED), 0),
        ("ev_lost",   PLAYLIST, SONG_LOST,    tags(PLAYLIST, item=SONG_LOST), 0),
        ("ev_podcast", SHOW,    EP_MOVED,     tags(SHOW, item=EP_MOVED), 0),
        ("ev_vts",    SINGLE,   SONG_KNOWN,   tags(SHOW, SINGLE, item=SONG_KNOWN), 0),
        ("ev_excl",   None,     SONG_KNOWN,   tags(item=SONG_KNOWN), 1),
    ]
    for ev, g, item, raw, ex in boosts:
        conn.execute("""INSERT INTO boosts (event_id, booster_pubkey, created_at, sats, podcast_guid,
                                            item_guid, raw_json, excluded)
                        VALUES (?,?,?,?,?,?,?,?)""", (ev, "pk", NOW, 100, g, item, raw, ex))
    conn.executemany("INSERT INTO enrich_failed (kind, id, last_try) VALUES ('episode', ?, ?)",
                     [(SONG_IN_LIST, NOW), (SONG_LOST, NOW)])
    conn.execute("CREATE TABLE d1_boosts_synced (event_id TEXT PRIMARY KEY)")     # d1_sync owns this table
    conn.executemany("INSERT INTO d1_boosts_synced (event_id) VALUES (?)", [(b[0],) for b in boosts])
    conn.commit()

    def canon(ev):
        return conn.execute("SELECT canonical_guid FROM boosts WHERE event_id=?", (ev,)).fetchone()[0]

    print("dry run moves nothing")
    res = resolve_guids.credit_playlist_songs(conn, log=lambda m: None, fetch=fetch, dry_run=True)
    check(res["credited"] == 3 and canon("ev_list") is None, f"dry run reports 3, writes none ({res['credited']})")
    fetches.clear()

    print("a live run")
    res = resolve_guids.credit_playlist_songs(conn, log=lambda m: None, fetch=fetch)
    check(canon("ev_list") == ALBUM, "playlist boost → the feed the playlist's remoteItem names")
    check(canon("ev_noguid") == SINGLE, "a note naming no feed → the one feed the item sits on")
    check(canon("ev_tag") == ALBUM, "item not in the list → the note's one other, non-list podcast:guid")
    check(canon("ev_lost") is None, "nothing places it → left alone")
    check(canon("ev_podcast") is None, "a regular show whose item lives elsewhere is not this pass's business")
    check(canon("ev_vts") is None, "a value-time split already on the song's feed is untouched")
    check(canon("ev_excl") is None, "an excluded boost is untouched")
    check(res["by_method"] == {"playlist-feed": 1, "episode-row": 1, "note-tag": 1}, f"methods {res['by_method']}")
    check(fetches == [PLAYLIST_URL], f"the playlist is read once per run ({len(fetches)})")
    check(conn.execute("SELECT podcast_guid FROM boosts WHERE event_id='ev_list'").fetchone()[0] == PLAYLIST,
          "the as-signed guid stays on the row")

    failed = {r[0] for r in conn.execute("SELECT id FROM enrich_failed WHERE kind='episode'")}
    check(SONG_IN_LIST not in failed, "a moved song's failed lookup (against the playlist) is forgotten")
    check(SONG_LOST in failed, "an unmoved one keeps its cooldown")

    print("D1 is told")
    synced = {r[0] for r in conn.execute("SELECT event_id FROM d1_boosts_synced")}
    check(not synced & {"ev_list", "ev_noguid", "ev_tag"}, "moved boosts are un-synced")
    check("ev_lost" in synced and "ev_vts" in synced, "unmoved boosts stay synced")
    q = db.reproject_queue(conn)
    check(set(q.get("boost", [])) == {"ev_list", "ev_noguid", "ev_tag"}, f"moved boosts queued: {q.get('boost')}")
    check(q.get("podcast", []) == [PLAYLIST], f"the playlist is recounted, nothing else: {q.get('podcast')}")

    print("the next tick")
    fetches.clear()
    res = resolve_guids.credit_playlist_songs(conn, log=lambda m: None, fetch=fetch)
    check(res["credited"] == 0 and res["unplaced"] == 1, f"only the lost one is still a candidate ({res})")
    check(fetches == [], "a playlist that left a boost unplaced is not re-read inside the retry window")

    print("aliases never overwrite a credited boost")
    db.upsert_alias(conn, SHOW, ELSEWHERE, "test")
    db.apply_aliases(conn)
    check(canon("ev_list") == ALBUM and canon("ev_noguid") == SINGLE, "per-boost credit survives apply_aliases")
    check(canon("ev_podcast") == ELSEWHERE, "and the alias rung still does its own job")

if failures:
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1)
print("\nall passed")
