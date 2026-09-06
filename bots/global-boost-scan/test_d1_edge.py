#!/usr/bin/env python3
"""The collector's half of the boosts_edge contract (d1_sync.py), driven over a
fixture box database built from the real schema through db.connect, with the
D1 HTTP calls stubbed. Run: python3 test_d1_edge.py  (from this directory).

Five edge rows, one per case the walk distinguishes:
  A  local, unsynced, published; the note named phantom guid X that the box
     canonicalizes to Y        → REPLACED by the delta, marker dropped, X recounted (→ deleted)
  B  local, synced, published  → RE-PUSHED as a replace, marker dropped
  C  local, synced, a duplicate → boost REMOVED from D1, marker dropped, its guids recounted
  D  no local row, 4h old      → ORPHANED: boost removed, marker dropped, its stub show deleted
  E  no local row, 10min old   → PENDING: untouched
"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import db                     # noqa: E402
import d1_sync                # noqa: E402

NOW = int(time.time()) - 60   # cmd_remote_delta reads the real clock, so the fixture must sit just behind it
failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


def boost(conn, eid, pk, pod, item, canonical=None, dup_of=None, synced=False, msg="hi"):
    # `dup_of` rather than `excluded` for the withheld row: db.connect re-applies
    # the repo's excludes.json to the `excluded` flag wholesale, which would
    # un-withhold a fixture row; the duplicate flag is left alone.
    conn.execute(
        "INSERT INTO boosts (event_id,booster_pubkey,booster_npub,created_at,sats,amount_source,"
        "podcast_guid,canonical_guid,item_guid,message,client,client_id,dup_of) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (eid, pk, "npub1" + pk[:8], NOW - 600, 100, "amount_tag", pod, canonical, item, msg,
         "onlyboosts.social", "onlyboosts", dup_of))
    if synced:
        conn.execute("INSERT OR IGNORE INTO d1_boosts_synced (event_id) VALUES (?)", (eid,))


tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "box.db")
conn = db.connect(path, apply_exclusions=False)
d1_sync._ensure_sync_table(conn)
conn.execute("INSERT INTO shows (podcast_guid, title) VALUES ('Y', 'Real Show')")
conn.execute("INSERT INTO shows (podcast_guid, title) VALUES ('Z', 'Other Show')")
conn.execute("INSERT INTO episodes (item_guid, podcast_guid, title) VALUES ('iA', 'Y', 'Ep A')")
conn.execute("INSERT INTO episodes (item_guid, podcast_guid, title) VALUES ('iB', 'Z', 'Ep B')")
PK = "a" * 64
boost(conn, "A", PK, "X", "iA", canonical="Y")
boost(conn, "B", PK, "Z", "iB", synced=True)
boost(conn, "C", PK, "Z", "iB", dup_of="B", synced=True)
conn.commit()

edge = [
    {"event_id": "A", "ingested_at": NOW - 300, "podcast_guid": "X", "item_guid": "iA"},
    {"event_id": "B", "ingested_at": NOW - 300, "podcast_guid": "Z", "item_guid": "iB"},
    {"event_id": "C", "ingested_at": NOW - 300, "podcast_guid": "Z", "item_guid": "iB"},
    {"event_id": "D", "ingested_at": NOW - 4 * 3600, "podcast_guid": "STUB", "item_guid": "iD"},
    {"event_id": "E", "ingested_at": NOW - 600, "podcast_guid": "STUB2", "item_guid": "iE"},
]

print("build_delta_sql with edge ids")
rows = d1_sync._unsynced_boosts(conn)
check([r["event_id"] for r in rows] == ["A"], "only A is unsynced and published")
delta, pods, items, _ = d1_sync.build_delta_sql(conn, rows, {"A"})
j = "\n".join(delta)
check("INSERT OR REPLACE INTO boosts (event_id" in j and "'A'" in j, "A is INSERT OR REPLACEd")
check("DELETE FROM boosts_fts WHERE event_id='A';" in j, "A's FTS row is deleted before re-insert")
check(j.index("DELETE FROM boosts_fts WHERE event_id='A';") < j.index("INSERT INTO boosts_fts (event_id,message) VALUES ('A'"),
      "FTS delete precedes FTS insert")
check(",'Y'," in j.split("INSERT OR REPLACE INTO boosts")[1].split(";")[0], "the replaced row carries the CANONICAL guid Y")
plain, _, _, _ = d1_sync.build_delta_sql(conn, rows)
check(any(x.startswith("INSERT OR IGNORE INTO boosts (") for x in plain)
      and not any(x.startswith("INSERT OR REPLACE INTO boosts (") for x in plain),
      "without edge ids the boost insert stays OR IGNORE")

print("build_edge_sql")
stmts, counts = d1_sync.build_edge_sql(conn, edge, rows, NOW, pods, items)
s = "\n".join(stmts)
check(counts == {"replaced": 1, "repushed": 1, "removed": 1, "orphaned": 1, "pending": 1}, f"counts {counts}")
for eid in "ABCD":
    check(f"DELETE FROM boosts_edge WHERE event_id='{eid}';" in s, f"marker {eid} dropped")
check("DELETE FROM boosts_edge WHERE event_id='E';" not in s and "'E'" not in s, "E (pending) untouched")
check("DELETE FROM boosts WHERE event_id='A';" not in s, "A's boost is not deleted (the delta replaces it)")
check("INSERT OR REPLACE INTO boosts" in s and "'B'" in s.split("INSERT OR REPLACE INTO boosts")[1].split(";")[0],
      "B (synced) is re-pushed as a replace")
check("DELETE FROM boosts WHERE event_id='C';" in s and "DELETE FROM boosts_fts WHERE event_id='C';" in s,
      "C (a duplicate) is removed from D1")
check("DELETE FROM boosts WHERE event_id='D';" in s, "D (orphan) is removed from D1")
check("DELETE FROM podcasts WHERE podcast_guid='X';" in s and "DELETE FROM podcasts_fts WHERE podcast_guid='X';" in s,
      "A's phantom guid X is recounted and, having no boosts, deleted")
check("DELETE FROM podcasts WHERE podcast_guid='STUB';" in s, "D's stub show is deleted")
check("DELETE FROM episodes WHERE item_guid='iD';" in s, "D's stub episode is deleted")
check("INSERT OR REPLACE INTO podcasts" in s and "'Z'" in s, "Z (C's show) is recounted from the box")
zrow = [x for x in stmts if x.startswith("INSERT OR REPLACE INTO podcasts") and "'Z'" in x][0]
check(",1,100,1," in zrow, "Z's recount excludes C: one boost, 100 sats, one booster")
check("podcast_guid='Y'" not in s and "'Y'," not in s, "Y is left to the delta's own upsert (it is in delta_pods)")

print("age boundary")
_, c = d1_sync.build_edge_sql(conn, [dict(edge[3], ingested_at=NOW - d1_sync.EDGE_ORPHAN_AGE + 1)], rows, NOW)
check(c["pending"] == 1 and c["orphaned"] == 0, "one second under the age is pending")
_, c = d1_sync.build_edge_sql(conn, [dict(edge[3], ingested_at=NOW - d1_sync.EDGE_ORPHAN_AGE)], rows, NOW)
check(c["orphaned"] == 1, "exactly the age is an orphan")

print("_edge_rows fails open")
d1_sync._d1_rows = lambda url, hdr, sql: (None, [{"code": 7500, "message": "no such table: boosts_edge"}])
check(d1_sync._edge_rows(("u", {})) == [], "a missing table reads as no edge rows")
d1_sync._d1_rows = lambda url, hdr, sql: (None, "HTTP 502")
check(d1_sync._edge_rows(("u", {})) == [], "a failed read reads as no edge rows (and warns)")

print("cmd_remote_delta end to end, D1 stubbed")
pushed = []
d1_sync._d1_rows = lambda url, hdr, sql: (edge, None)
d1_sync._d1_exec = lambda url, hdr, sql: (pushed.append(sql), (True, None))[1]
d1_sync._cf = lambda cfg: ("u", {})
d1_sync.load_config = lambda p: {}
d1_sync.DB_PATH = path
conn.close()
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    d1_sync.cmd_remote_delta(None)
line = buf.getvalue().strip().splitlines()[-1]
print("   ", line)
allsql = "\n".join(pushed)
check("edge: 1 replaced, 1 repushed, 1 removed, 1 orphaned, 1 pending" in line, "the delta reports every edge case")
check(allsql.index("DELETE FROM boosts_edge WHERE event_id='A';")
      < allsql.index("INSERT OR REPLACE INTO boosts (event_id,booster_pubkey,booster_npub,created_at,sats,amount_source,podcast_guid,item_guid,item_url,client,client_id,client_via,message) VALUES ('A'"),
      "edge statements precede the delta's")
conn = db.connect(path, apply_exclusions=False)
check(conn.execute("SELECT COUNT(*) FROM d1_boosts_synced WHERE event_id='A'").fetchone()[0] == 1, "A marked synced after the push")

print()
print(f"{len(failures)} failure(s)" if failures else "all passed")
sys.exit(1 if failures else 0)
