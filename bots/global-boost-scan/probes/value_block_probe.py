#!/usr/bin/env python3
"""For every show a comment-only note names, ask Podcast Index whether the
feed carries a value block. Measurement for Reed's "index comments only for
shows without a value block" question. Read-only; results in candidates.db
table pi_value.

    python3 probes/value_block_probe.py          # run / resume
    python3 probes/value_block_probe.py --report
"""
import sys, time, json
from collections import Counter
sys.path.insert(0, __import__("os").path.dirname(__file__))
from probe_common import open_cand, open_index, load_json, nip73_guids, podcast_itags
from experiments import index_sets, refs_map, bucket
import enrich
from nostr_utils import load_config

CREDENTIALS = "/home/reed/.config/nostr-bots/credentials.env"


def main():
    conn = open_cand()
    conn.execute("CREATE TABLE IF NOT EXISTS pi_value (guid TEXT PRIMARY KEY, found INTEGER, has_value INTEGER, "
                 "model TEXT, title TEXT, medium TEXT, notes INTEGER, known INTEGER, checked INTEGER)")
    if "--report" in sys.argv:
        rows = conn.execute("SELECT found, has_value, known, COUNT(*), SUM(notes) FROM pi_value GROUP BY 1,2,3").fetchall()
        print("found | has_value | show already in index | shows | comment notes")
        for r in rows: print("  ", r)
        print("value models:", conn.execute("SELECT model, COUNT(*) FROM pi_value WHERE has_value=1 GROUP BY 1").fetchall())
        return
    have, shows, items, boosters, _ = index_sets()
    t1, t2 = refs_map(conn)
    per_show = Counter()
    for eid, js in conn.execute("SELECT id, json FROM events WHERE kind=1"):
        if eid in have: continue
        ev = load_json(js)
        if not podcast_itags(ev): continue
        if bucket(ev, t1, t2)[0] != "comment-only": continue
        s, _ = nip73_guids(ev)
        if s: per_show[s] += 1
    done = {r[0] for r in conn.execute("SELECT guid FROM pi_value")}
    todo = [g for g in per_show if g not in done]
    print(f"{len(per_show)} shows named by comment-only notes, {len(todo)} to check")
    cfg = load_config(CREDENTIALS)
    key, secret = cfg.get("LOCAL_BITCOINERS_INDEX_KEY"), cfg.get("LOCAL_BITCOINERS_INDEX_SECRET")
    for n, g in enumerate(todo, 1):
        found = has_value = 0; model = title = medium = None
        try:
            feed = enrich.pi_get("podcasts/byguid", {"guid": g}, key, secret).get("feed") or {}
            if feed and feed.get("id"):
                found = 1
                v = feed.get("value") or {}
                has_value = 1 if (v.get("destinations") or v.get("model")) else 0
                model = json.dumps(v.get("model")) if v else None
                title = feed.get("title"); medium = feed.get("medium")
        except Exception as e:
            print(f"  {g}: {e}"); time.sleep(5)
            continue
        conn.execute("INSERT OR REPLACE INTO pi_value VALUES (?,?,?,?,?,?,?,?,?)",
                     (g, found, has_value, model, title, medium, per_show[g], 1 if g in shows else 0, int(time.time())))
        if n % 50 == 0:
            conn.commit(); print(f"  {n}/{len(todo)}", flush=True)
        time.sleep(0.25)
    conn.commit()
    print("done")


if __name__ == "__main__":
    main()
