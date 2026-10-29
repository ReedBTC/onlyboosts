#!/usr/bin/env python3
"""similar.compute over a fixture box database built from the real schema:
the cosine, the distinct-booster rule, the medium partition, the exclusion
gates, the publisher-key skip, the rank order and the D1 statements
d1_sync.build_similar_sql emits. Run: python3 test_similar.py (from this directory).
"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "shared"))
import clients                # noqa: E402
import db                     # noqa: E402
import d1_sync                # noqa: E402
import similar                # noqa: E402

failures = []


def check(cond, msg):
    (print("  ok  ", msg) if cond else (failures.append(msg), print("  FAIL", msg)))


NOW = int(time.time())
BOT = next(pk for pk, slug in clients.PUBLISHER_PUBKEYS.items() if slug == "msp-2-0")
CHAD = next(pk for pk, slug in clients.PUBLISHER_PUBKEYS.items() if slug == similar.MEMBER_BOT)

with tempfile.TemporaryDirectory() as tmp:
    conn = db.connect(os.path.join(tmp, "box.db"), apply_exclusions=False)
    for guid, medium in (("A", "podcast"), ("B", None), ("C", "podcast"), ("M1", "music"),
                         ("M2", "music"), ("D", "podcast"), ("X", "podcast")):
        conn.execute("INSERT INTO shows (podcast_guid, title, medium, updated_at) VALUES (?,?,?,?)",
                     (guid, guid, medium, NOW))
    n = 0

    def boost(show, pk, excluded=0, dup=None, canonical=None):
        global n
        n += 1
        conn.execute("""INSERT INTO boosts (event_id, booster_pubkey, created_at, sats, podcast_guid,
                        canonical_guid, excluded, dup_of) VALUES (?,?,?,?,?,?,?,?)""",
                     (f"ev{n}", pk, NOW - n, 10, show, canonical, excluded, dup))

    # A: boosters p1 p2 p3 (p1 three times — one person). B: p1 p2 p4. C: p3 p5 p6.
    for pk in ("p1", "p1", "p1", "p2", "p3"):
        boost("A", pk)
    for pk in ("p1", "p2", "p4"):
        boost("B", pk)
    for pk in ("p3", "p5", "p6"):
        boost("C", pk)
    # D: only two boosters → under the floor, never a candidate.
    boost("D", "p1"); boost("D", "p2")
    # X: three boosters on paper, but one is excluded and one is a duplicate,
    # and the third is the relay bot — nothing live survives.
    boost("X", "p1", excluded=1); boost("X", "p2", dup="ev1"); boost("X", BOT)
    # Music side: M1 p1 p2 p3, M2 p1 p2 p7 — shares p1,p2 with A too, but A is a
    # podcast and the partition must keep them apart.
    for pk in ("p1", "p2", "p3"):
        boost("M1", pk)
    for pk in ("p1", "p2", "p7"):
        boost("M2", pk)
    # The relay bot boosted A, B and C: it must not add overlap. Chad's bot is a
    # member and counts (a fourth booster on A and B).
    for show in ("A", "B", "C"):
        boost(show, BOT)
    boost("A", CHAD); boost("B", CHAD)
    # An alias: a boost signed with a phantom guid resolved onto A by canonical_guid.
    boost("phantom-A", "p8", canonical="A")
    conn.commit()

    rows, stats = similar.compute(conn)
    by = {}
    for g, o, sc, k, r in rows:
        by.setdefault(g, []).append((o, sc, k, r))

    print("partition and floor")
    check(set(by) == {"A", "B", "C", "M1", "M2"}, f"candidates with neighbours: {sorted(by)}")
    check("D" not in by and not any(o == "D" for l in by.values() for o, *_ in l),
          "a two-booster show is neither a seed nor a neighbour")
    check("X" not in by, "excluded, duplicate and bot boosts do not lift a show over the floor")
    check(all(o in ("M1", "M2") for o, *_ in by["M1"]) and all(o in ("M1", "M2") for o, *_ in by["M2"]),
          "music neighbours are music")
    check(all(o not in ("M1", "M2") for l in (by["A"], by["B"], by["C"]) for o, *_ in l),
          "podcast neighbours are podcasts")

    print("the score")
    # A = {p1,p2,p3,CHAD,p8} (5), B = {p1,p2,p4,CHAD} (4): shared 3 → 3/sqrt(20)
    a_b = next(x for x in by["A"] if x[0] == "B")
    check(a_b[2] == 3, f"A∩B counts distinct people incl. the member bot, not notes: {a_b[2]}")
    check(abs(a_b[1] - 3 / (20 ** 0.5)) < 1e-6, f"A·B cosine = 3/sqrt(5·4): {a_b[1]}")
    a_c = next(x for x in by["A"] if x[0] == "C")
    check(a_c[2] == 1 and abs(a_c[1] - 1 / (15 ** 0.5)) < 1e-6, f"A·C = 1/sqrt(5·3): {a_c}")
    check([x[0] for x in by["A"]] == ["B", "C"] and [x[3] for x in by["A"]] == [1, 2],
          "ranked by score desc, 1..n")
    check(all(x[2] >= 1 for l in by.values() for x in l), "no zero-overlap rows")
    check(stats["sides"]["podcast"]["candidates"] == 3 and stats["sides"]["music"]["candidates"] == 2,
          f"stats: {stats['sides']}")

    print("the projection")
    db.replace_show_similar(conn, rows)
    stmts = d1_sync.build_similar_sql(conn)
    check(stmts[0] == "DELETE FROM show_similar;", "full replace starts with the delete")
    check(len(stmts) == 2 and stmts[1].count("),(") == len(rows) - 1,
          f"{len(rows)} rows in one multi-row INSERT")
    check("INSERT INTO show_similar (podcast_guid,other_guid,score,shared_boosters,rank)" in stmts[1],
          "column list as shipped")
    # Replace is wholesale: a second run with fewer rows leaves no stragglers.
    db.replace_show_similar(conn, rows[:1])
    check(conn.execute("SELECT COUNT(*) FROM show_similar").fetchone()[0] == 1, "replace is wholesale")

    print("the podcast projection carries first_boost_ts and description")
    conn.execute("UPDATE shows SET description='About A' WHERE podcast_guid='A'")
    stmt = d1_sync._podcast_upsert_sql(conn, "A")[0]
    first = conn.execute("SELECT MIN(created_at) FROM boosts WHERE COALESCE(canonical_guid,podcast_guid)='A' "
                         "AND excluded=0 AND dup_of IS NULL").fetchone()[0]
    check(f",{first});" in stmt and "'About A'" in stmt, "first_boost_ts = oldest live boost; description rides")
    conn.execute("UPDATE shows SET newest_item_ts=1790000000 WHERE podcast_guid='A'")
    stmt = d1_sync._podcast_upsert_sql(conn, "A")[0]
    check("newest_item_ts" in stmt.split("VALUES")[0] and "'About A',1790000000," in stmt,
          "newest_item_ts rides the podcast projection, after description")
    fts = d1_sync._podcast_upsert_sql(conn, "A")[2]
    check(fts.startswith("INSERT INTO podcasts_fts (podcast_guid,title,author,description)") and "'About A'" in fts,
          "podcasts_fts gets the description")

print()
if failures:
    print(f"{len(failures)} failure(s)")
    sys.exit(1)
print("all good")
