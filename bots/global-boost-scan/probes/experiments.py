#!/usr/bin/env python3
"""Replay candidate rule changes against the harvested corpus and the index.

    python3 probes/experiments.py resolve-refs     # network: fetch every quoted event, two tiers
    python3 probes/experiments.py report           # offline: data/probes/report.md + samples/

Every candidate the harvest kept that the index does NOT hold is sorted into
exactly one bucket, in this order:

    scan-gap          the SHIPPED classifier accepts it with the SHIPPED receipt
                      relays — the rules are fine, the scan never saw it
    receipt-wide      accepted only once the quoted receipt is fetched from the
                      nevent's own relay hints / the wider relay set
    content-sats      i tag + "N sats" in the text, no other evidence
                      (parse_content_sats is gated behind is_boost today)
    zap-tag           i tag + a NIP-57 `zap` split tag, nothing else
    comment-only      i tag, no evidence of payment at all (Reed's first lead)
    publisher-untagged a registered publisher's note with NO i tag but boost-
                      shaped text (Reed's second lead: LB's pre-2026-06 notes)
    t-only            boost t tag, no i tag (BoostMeBitch's 2nd subscription)
    k1111             a NIP-22 comment naming a podcast
    other             kept by the harvest, fits none of the above

Nothing here writes to the index. The report is a measurement, not a decision.
"""
import json
import sys
import time
from collections import Counter, defaultdict

from probe_common import (open_cand, open_index, load_json, podcast_itags, nip73_guids,
                          has_boost_t, amount_tag, quote_ids, nevent_relay_hints,
                          is_publisher, current_verdict, parse_content_sats, tags,
                          fountain_urls, app_fingerprint, ym, PROBE_RELAYS, RECEIPT_RELAYS,
                          PROBE_DIR, EXTRA_RELAYS)
from harvest import probe_query


def fetch_ids(ids, relays, chunk=200):
    """fetch_events_by_ids on the paced, 429-aware probe_query: a relay that
    refuses the handshake is retried (3x, 30s) rather than read as 'not
    there', which is the one mistake this measurement cannot afford."""
    out = {}
    for i in range(0, len(ids), chunk):
        c = ids[i:i + chunk]
        for relay in relays:
            need = [x for x in c if x not in out]
            if not need:
                break
            for attempt in range(4):
                evs, status = probe_query(relay, {"ids": need}, max_wall=30)
                if status == "ratelimited" and attempt < 3:
                    time.sleep(30 * (attempt + 1))
                    continue
                break
            for ev in evs:
                if ev.get("id"):
                    out[ev["id"]] = ev
    return out

TIER1 = list(RECEIPT_RELAYS)                                   # what production asks
TIER2 = [r for r in PROBE_RELAYS if r not in TIER1] + ["wss://relay.nostr.band", "wss://nostr.wine"]
SAMPLES = 15


def index_sets():
    ix = open_index()
    have = {r[0]: (r[1], r[2]) for r in ix.execute("SELECT event_id, excluded, dup_of FROM boosts")}
    shows = set()
    for sql in ("SELECT podcast_guid FROM shows",
                "SELECT DISTINCT podcast_guid FROM boosts WHERE podcast_guid IS NOT NULL",
                "SELECT DISTINCT canonical_guid FROM boosts WHERE canonical_guid IS NOT NULL",
                "SELECT raw_guid FROM guid_aliases"):
        shows.update(r[0] for r in ix.execute(sql) if r[0])
    items = {r[0] for r in ix.execute("SELECT DISTINCT item_guid FROM boosts WHERE item_guid IS NOT NULL")}
    boosters = {r[0] for r in ix.execute("SELECT DISTINCT booster_pubkey FROM boosts")}
    by_sats = defaultdict(list)       # sats -> [(created_at, show_guid)] for the represented check
    for sats, ts, g, cg in ix.execute("SELECT sats, created_at, podcast_guid, canonical_guid FROM boosts WHERE sats IS NOT NULL"):
        by_sats[sats].append((ts, cg or g))
    ix.close()
    return have, shows, items, boosters, by_sats


def candidates(conn):
    for eid, pk, kind, ts, js, shapes, relays in conn.execute(
            "SELECT id, pubkey, kind, created_at, json, shapes, relays FROM events"):
        yield load_json(js), shapes.split(","), relays.split(",")


def resolve_refs(conn):
    have = index_sets()[0]
    want = {}
    hints = defaultdict(set)
    for ev, _, _ in candidates(conn):
        if ev["id"] in have or ev.get("kind") != 1 or not podcast_itags(ev):
            continue
        for q in quote_ids(ev):
            want[q] = True
            for h in nevent_relay_hints(ev):
                hints[q].add(h)
    known = {r[0]: r[1] for r in conn.execute("SELECT id, tried FROM refs")}
    todo1 = [q for q in want if q not in known]
    print(f"{len(want)} quoted ids across unindexed candidates; {len(todo1)} not yet tried on tier 1")
    for i in range(0, len(todo1), 500):
        chunk = todo1[i:i + 500]
        got = fetch_ids(chunk, TIER1)
        for q in chunk:
            ev = got.get(q)
            conn.execute("INSERT OR REPLACE INTO refs VALUES (?,?,?,?)",
                         (q, json.dumps(ev) if ev else None, (ev or {}).get("kind"), "tier1"))
        conn.commit()
        print(f"  tier1 {i + len(chunk)}/{len(todo1)}: resolved {sum(1 for q in chunk if got.get(q))}")
    todo2 = [r[0] for r in conn.execute("SELECT id FROM refs WHERE json IS NULL AND tried='tier1'")]
    print(f"{len(todo2)} unresolved after tier 1 → tier 2 (hints + wide set)")
    hinted = sorted({h for q in todo2 for h in hints.get(q, ())})
    relays2 = [r for r in hinted if r not in TIER1 and r not in TIER2] + TIER2
    print(f"  tier2 relays: {relays2}")
    for i in range(0, len(todo2), 300):
        chunk = todo2[i:i + 300]
        got = fetch_ids(chunk, relays2)
        for q in chunk:
            ev = got.get(q)
            conn.execute("UPDATE refs SET json=?, kind=?, tried='tier1,tier2' WHERE id=?",
                         (json.dumps(ev) if ev else None, (ev or {}).get("kind"), q))
        conn.commit()
        print(f"  tier2 {i + len(chunk)}/{len(todo2)}: resolved {sum(1 for q in chunk if got.get(q))}")
    n1, = conn.execute("SELECT COUNT(*) FROM refs WHERE json IS NOT NULL AND tried='tier1'").fetchone()
    n2, = conn.execute("SELECT COUNT(*) FROM refs WHERE json IS NOT NULL AND tried='tier1,tier2'").fetchone()
    n0, = conn.execute("SELECT COUNT(*) FROM refs WHERE json IS NULL").fetchone()
    print(f"refs: {n1} on production relays, {n2} only on the wider set, {n0} nowhere")


def refs_map(conn):
    t1, t2 = {}, {}
    for q, js, tried in conn.execute("SELECT id, json, tried FROM refs"):
        ev = load_json(js) if js else None
        if tried == "tier1":
            t1[q] = ev; t2[q] = ev
        else:
            t1[q] = None; t2[q] = ev
    return t1, t2


def bucket(ev, t1, t2):
    kind = ev.get("kind")
    if kind == 1111:
        return "k1111", None
    itags = podcast_itags(ev)
    if itags:
        b = current_verdict(ev, t1)
        if b:
            return "scan-gap", b
        b = current_verdict(ev, t2)
        if b:
            return "receipt-wide", b
        if parse_content_sats(ev.get("content") or ""):
            return "content-sats", None
        if tags(ev, "zap"):
            return "zap-tag", None
        if quote_ids(ev) and any(q not in t2 for q in quote_ids(ev)):
            return "comment-only-unresolved", None     # quotes something resolve-refs has not fetched yet
        return "comment-only", None
    if is_publisher(ev):
        if parse_content_sats(ev.get("content") or "") and "New boost" in (ev.get("content") or "") \
                or parse_content_sats(ev.get("content") or "") and "Boost Sent" in (ev.get("content") or ""):
            return "publisher-untagged", None
        return "other", None
    if has_boost_t(ev):
        return "t-only", None
    return "other", None


LB_GUID = "56fbb1aa-da79-5e4b-bebc-3b934ab8914c"
REPRESENTED_WINDOW = 2 * 3600


def represented(ev, sats, by_sats):
    """True when the index already holds a boost of the same sats to the same
    show (when the note names one; a Local Bitcoiners publisher note implies
    LB) within two hours — i.e. the donor's own note or a relay bot's copy is
    there and this note is the duplicate the LB publisher chose not to claim."""
    if not sats:
        return False
    show, _ = nip73_guids(ev)
    if not show and is_publisher(ev) == "localbitcoiners":
        show = LB_GUID
    ts = ev["created_at"]
    for its, ig in by_sats.get(sats, ()):
        if abs(its - ts) <= REPRESENTED_WINDOW and (show is None or ig == show):
            return True
    return False


def note_sats(ev, b):
    if b and b.get("sats"):
        return b["sats"]
    return parse_content_sats(ev.get("content") or "")


def sample_of(ev, extra=None):
    show, item = nip73_guids(ev)
    d = {"id": ev["id"], "created": time.strftime("%Y-%m-%d %H:%M", time.gmtime(ev["created_at"])),
         "pubkey": ev["pubkey"][:16], "app": app_fingerprint(ev), "show_guid": show, "item_guid": item,
         "tags": [t[:2] for t in ev.get("tags", []) if t and t[0] not in ("e", "p")][:8],
         "content": (ev.get("content") or "")[:220]}
    if extra:
        d.update(extra)
    return d


def report(conn):
    have, shows, items, boosters, by_sats = index_sets()
    t1, t2 = refs_map(conn)
    total = Counter(); indexed = Counter()
    buckets = defaultdict(list)
    harvest_hit = 0
    only_extra_relay = Counter()
    for ev, shapes, relays in candidates(conn):
        total[ev.get("kind")] += 1
        if ev["id"] in have:
            harvest_hit += 1
            continue
        name, b = bucket(ev, t1, t2)
        buckets[name].append((ev, shapes, relays, b))
        if all(r in EXTRA_RELAYS for r in relays):
            only_extra_relay[name] += 1

    out = []
    w = out.append
    w(f"# Filter-rule probe report — {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}\n")
    w(f"Harvested candidates: {sum(total.values())} (kind 1: {total[1]}, kind 1111: {total[1111]}). "
      f"Already in the index: {harvest_hit}. Index size: {len(have)}.\n")
    w("Relays walked: " + ", ".join(r.split('//')[1] for r in PROBE_RELAYS) + "\n")
    rows = conn.execute("SELECT relay, SUM(done), COUNT(*), SUM(pages), SUM(seen), SUM(kept) FROM checkpoints GROUP BY relay").fetchall()
    w("| relay | shapes done | pages | seen | kept |\n|---|---|---|---|---|")
    for relay, done, n, pages, seen, kept in rows:
        w(f"| {relay.split('//')[1]} | {done}/{n} | {pages} | {seen} | {kept} |")
    w("\n## Unindexed candidates by bucket\n")
    w("| bucket | notes | distinct authors | sats (where known) | already represented in index | only on damus/primal/mynostr | first | last |\n|---|---|---|---|---|---|---|---|")
    order = ["scan-gap", "receipt-wide", "content-sats", "zap-tag", "comment-only",
             "comment-only-unresolved", "publisher-untagged", "t-only", "k1111", "other"]
    for name in order:
        rows_ = buckets.get(name, [])
        if not rows_:
            w(f"| {name} | 0 | | | | | | |"); continue
        sats = sum(note_sats(ev, b) or 0 for ev, _, _, b in rows_)
        rep = sum(1 for ev, _, _, b in rows_ if represented(ev, note_sats(ev, b), by_sats))
        ts = [ev["created_at"] for ev, *_ in rows_]
        w(f"| {name} | {len(rows_)} | {len({ev['pubkey'] for ev, *_ in rows_})} | {sats:,} | {rep} | {only_extra_relay[name]} | "
          f"{ym(min(ts))} | {ym(max(ts))} |")

    (PROBE_DIR / "samples").mkdir(exist_ok=True)
    for name in order:
        rows_ = buckets.get(name, [])
        if not rows_:
            continue
        w(f"\n## {name} ({len(rows_)})\n")
        apps = Counter(app_fingerprint(ev) for ev, *_ in rows_)
        w("Apps: " + ", ".join(f"{a} {n}" for a, n in apps.most_common(12)) + "\n")
        months = Counter(ym(ev["created_at"]) for ev, *_ in rows_)
        w("By month: " + ", ".join(f"{m} {n}" for m, n in sorted(months.items())) + "\n")
        sh = Counter(); known_show = 0; known_item = 0; known_booster = 0
        for ev, *_ in rows_:
            s, i = nip73_guids(ev)
            if s in shows: known_show += 1
            if i in items: known_item += 1
            if ev["pubkey"] in boosters: known_booster += 1
            if s: sh[s] += 1
        unknown_shows = {s for s in sh if s not in shows}
        w(f"Show already in the index: {known_show}; episode already boosted: {known_item}; "
          f"author already a booster: {known_booster}. Distinct shows named: {len(sh)}, "
          f"of which NOT in the index: {len(unknown_shows)}.\n")
        auth = Counter(ev["pubkey"] for ev, *_ in rows_)
        w("Top authors: " + ", ".join(f"{pk[:12]}{'*' if pk in boosters else ''} {n}" for pk, n in auth.most_common(8))
          + "  (* = already a booster in the index)\n")
        if name in ("content-sats", "publisher-untagged", "scan-gap", "receipt-wide", "zap-tag"):
            rep_rows = [(ev, b) for ev, _, _, b in rows_ if represented(ev, note_sats(ev, b), by_sats)]
            w(f"Already represented (same sats, same show, ±2h in the index): {len(rep_rows)}; "
              f"NOT represented: {len(rows_) - len(rep_rows)}, "
              f"{sum(note_sats(ev, b) or 0 for ev, _, _, b in rows_) - sum(note_sats(ev, b) or 0 for ev, b in rep_rows):,} sats\n")
            unrep_apps = Counter(app_fingerprint(ev) for ev, _, _, b in rows_ if not represented(ev, note_sats(ev, b), by_sats))
            w("Unrepresented, by app: " + ", ".join(f"{a} {n}" for a, n in unrep_apps.most_common(10)) + "\n")
        shp = Counter(s for _, shapes, _, _ in rows_ for s in shapes)
        w("Found by shape: " + ", ".join(f"{s} {n}" for s, n in shp.most_common(8)) + "\n")
        rl = Counter(r.split('//')[1] for _, _, relays, _ in rows_ for r in relays)
        w("On relays: " + ", ".join(f"{r} {n}" for r, n in rl.most_common(16)) + "\n")
        if name == "publisher-untagged":
            urls = Counter(u for ev, *_ in rows_ for u in fountain_urls(ev))
            w(f"Fountain URLs in text: {sum(urls.values())} across {len(urls)} distinct; "
              f"notes with a sats figure in text: {sum(1 for ev, *_ in rows_ if parse_content_sats(ev.get('content') or ''))}\n")
        if name == "t-only":
            with_url = sum(1 for ev, *_ in rows_ if fountain_urls(ev) or tags(ev, "r"))
            w(f"Notes with a fountain URL or an r tag to resolve a show from: {with_url}\n")
        if name in ("comment-only", "k1111"):
            with_text = sum(1 for ev, *_ in rows_ if (ev.get("content") or "").strip())
            w(f"With non-empty text: {with_text}\n")
        samples = [sample_of(ev, {"shapes": shapes, "relays": [r.split('//')[1] for r in relays],
                                  "verdict_sats": (b or {}).get("sats"), "source": (b or {}).get("amount_source")})
                   for ev, shapes, relays, b in sorted(rows_, key=lambda r: -r[0]["created_at"])[:SAMPLES]]
        json.dump([sample_of(ev) for ev, *_ in rows_], open(PROBE_DIR / "samples" / f"{name}.json", "w"),
                  indent=1, ensure_ascii=False)
        w("Newest samples (full list in `samples/" + name + ".json`):\n")
        for s in samples[:8]:
            w(f"- `{s['id'][:12]}` {s['created']} {s['app']} show={str(s['show_guid'])[:8]} "
              f"{'sats=' + str(s['verdict_sats']) if s.get('verdict_sats') else ''} — "
              + json.dumps(s["content"][:140], ensure_ascii=False))
    w("\n## Index rows the harvest did NOT reach\n")
    reached = {ev["id"] for ev, *_ in candidates(conn)}
    missed = [e for e in have if e not in reached]
    w(f"{len(missed)} of {len(have)} index rows were not returned by any relay/shape in this harvest "
      f"(relay retention, or the shapes' limits). Not a filter question; listed for the record.\n")
    text = "\n".join(out)
    (PROBE_DIR / "report.md").write_text(text)
    print(text)


def main():
    conn = open_cand()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd == "resolve-refs":
        resolve_refs(conn)
    elif cmd == "report":
        report(conn)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
