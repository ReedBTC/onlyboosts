#!/usr/bin/env python3
"""ONE-TIME admission of two classes of note the classifier rejects, from the
2026-10-03 harvest. Reed's call, 2026-10-03: a backfill pass, NOT a rule —
the shipped classifier is unchanged and these shapes stay rejected going
forward.

  sats-line   a note with a podcast i tag, no t/amount/receipt, whose text has
              a line beginning "⚡ N sats" (the ITDV / podtards / hpm / rssblue /
              podhome / StableKraft / lnaddress-music template). Booster is the
              signer, as always. Test boosts to github/localhost shows excluded.

  lb-publisher a Local Bitcoiners publisher note ("⚡ New boost on Local
              Bitcoiners!" / "💰 N sats") with no payment tag. Reed owns the
              node those boosts settled on, so the note is trusted as the
              payment's record. Show = LB (or the i tag's show); episode =
              the i tag's item guid, else the Fountain episode URL resolved
              through the index's own item_url column; a /show/ URL or no
              URL is a show-level boost. Booster = the LB publisher key, the
              same as the 35 LB rows already indexed.

LB boost-board replies (an `e` tag) are skipped: the standalone is the record.
Both skip any note the index already represents (same sats, same show,
within two hours) and any event id already stored. Rows carry
amount_source='content'. The ids written are recorded in
data/probes/backfill-once-<date>.json so the pass is reversible by one
DELETE. Writes only with --apply; dry-run prints the plan.
"""
import json, re, sys, time, sqlite3
from collections import Counter
sys.path.insert(0, __import__("os").path.dirname(__file__))
from probe_common import (open_cand, load_json, podcast_itags, nip73_guids, tags, is_publisher,
                          fountain_urls, parse_content_sats, app_fingerprint, SCAN, INDEX_DB, PROBE_DIR)
from experiments import index_sets, refs_map, bucket, represented, note_sats, LB_GUID
from classify import strip_fountain_trailer
from nostr_utils import hex_to_npub
import clients
import db

SATS_LINE = re.compile(r"^\s*⚡\s*([\d,]+)\s*sats\b", re.MULTILINE)
TEST_HOSTS = ("github.com", "localhost")
LB_PUB = "c330881e28768381dd8bdfd274341dca0c5882c29b8642ea4bc82f7563264592"


def to_boost(ev, sats, podcast_guid, item_guid, item_url, show_url):
    return {
        "event_id": ev["id"], "booster_pubkey": ev["pubkey"], "booster_npub": hex_to_npub(ev["pubkey"]),
        "created_at": ev["created_at"], "sats": sats, "amount_source": "content",
        "message": strip_fountain_trailer(ev.get("content") or ""),
        "client": next((t[1] for t in tags(ev, "client")), None),
        **clients.classify_client(ev),
        "podcast_guid": podcast_guid, "item_guid": item_guid, "item_url": item_url, "show_url": show_url,
        "r_urls": [t[1] for t in tags(ev, "r")], "raw": ev,
    }


def build_plan():
    """({'sats-line': [boost dicts], 'lb-publisher': [...]}, Counter of skips, known show guids)."""
    conn = open_cand()
    have, shows, items, boosters, by_sats = index_sets()
    t1, t2 = refs_map(conn)
    ix = sqlite3.connect(f"file:{INDEX_DB}?mode=ro", uri=True)
    url_map = {}
    for item_url, item_guid, pg in ix.execute(
            "SELECT item_url, item_guid, COALESCE(canonical_guid, podcast_guid) FROM boosts "
            "WHERE item_url LIKE 'https://fountain.fm/episode/%' AND item_guid IS NOT NULL"):
        url_map.setdefault(item_url.split("?")[0].rstrip("/"), (item_guid, pg))
    plan = {"sats-line": [], "lb-publisher": []}
    skipped = Counter()
    for eid, js in conn.execute("SELECT id, json FROM events WHERE kind=1"):
        if eid in have:
            continue
        ev = load_json(js)
        name, b = bucket(ev, t1, t2)
        content = ev.get("content") or ""
        if name == "content-sats" and not is_publisher(ev):
            m = SATS_LINE.search(content)
            if not m:
                skipped["content-sats: no ⚡ line"] += 1; continue
            sats = int(m.group(1).replace(",", ""))
            if sats <= 0 or represented(ev, sats, by_sats):
                skipped["content-sats: represented"] += 1; continue
            itag_urls = [t[2] for t in podcast_itags(ev) if len(t) >= 3 and t[2]]
            if any(h in u for u in itag_urls + [content] for h in TEST_HOSTS):
                skipped["content-sats: test host"] += 1; continue
            show, item = nip73_guids(ev)
            item_url = next((t[2] for t in podcast_itags(ev) if t[1].startswith("podcast:item:guid:") and len(t) >= 3), None)
            show_url = next((t[2] for t in podcast_itags(ev) if t[1].startswith("podcast:guid:") and len(t) >= 3), None)
            plan["sats-line"].append(to_boost(ev, sats, show, item, item_url, show_url))
        elif is_publisher(ev) == "localbitcoiners" and name in ("content-sats", "publisher-untagged"):
            if "New boost on Local Bitcoiners" not in content:
                skipped["lb: not a boost note"] += 1; continue
            # LB publishes each boost twice: a STANDALONE note and a boost-board
            # REPLY with identical text (an `e` tag, no i tags). Measured on this
            # plan: 213 replies, 210 standalones, 206 of the replies pairing with
            # a standalone within 60s. The reply is never the record.
            if tags(ev, "e"):
                skipped["lb: boost-board reply"] += 1; continue
            sats = parse_content_sats(content)
            if not sats or represented(ev, sats, by_sats):
                skipped["lb: represented"] += 1; continue
            show, item = nip73_guids(ev)
            item_url = show_url = None
            if not item:
                for u in fountain_urls(ev):
                    key = u.split("?")[0].rstrip("/")
                    if "/episode/" in key and key in url_map:
                        item, pg = url_map[key]; item_url = key; show = show or pg
                        break
                    if "/show/" in key:
                        show_url = key
            plan["lb-publisher"].append(to_boost(ev, sats, show or LB_GUID, item, item_url, show_url))
    return plan, skipped, shows


def main():
    apply = "--apply" in sys.argv
    plan, skipped, shows = build_plan()
    for name, rows in plan.items():
        print(f"\n== {name}: {len(rows)} notes, {sum(r['sats'] for r in rows):,} sats, "
              f"{len({r['podcast_guid'] for r in rows})} shows ({sum(1 for r in rows if r['podcast_guid'] in shows)} notes on known shows), "
              f"{sum(1 for r in rows if r['item_guid'])} episode-level")
        print("   apps:", Counter(app_fingerprint(r['raw']) for r in rows).most_common(8))
        print("   client_id:", Counter(r['client_id'] for r in rows).most_common(5))
        print("   months:", sorted(Counter(time.strftime('%Y-%m', time.gmtime(r['created_at'])) for r in rows).items()))
        for r in sorted(rows, key=lambda r: -r['sats'])[:3]:
            print(f"   top: {r['sats']:,} sats {r['event_id'][:12]} {json.dumps(r['message'][:90], ensure_ascii=False)}")
    print("\nskipped:", dict(skipped))
    if not apply:
        print("\nDRY RUN — rerun with --apply to write.")
        return
    wconn = db.connect(str(INDEX_DB), apply_exclusions=False)
    written = {}
    for name, rows in plan.items():
        n = db.upsert_boosts(wconn, rows)
        written[name] = [r["event_id"] for r in rows]
        print(f"{name}: {n} new rows written")
    wconn.commit()
    out = PROBE_DIR / f"backfill-once-{time.strftime('%Y-%m-%d')}.json"
    out.write_text(json.dumps(written, indent=1))
    print(f"ids recorded in {out}")


if __name__ == "__main__":
    main()
