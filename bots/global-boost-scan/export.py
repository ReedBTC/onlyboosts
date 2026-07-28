#!/usr/bin/env python3
"""Export the SQLite index to static JSON shards the website reads.

The four OnlyBoosts views all derive from these files:
  • Boosts Global / Follows  → the boost feed (boosts/latest.json + monthly pages);
    Follows is a client-side filter on booster pubkey.
  • Podcasts Global          → podcasts/index.json (per-show aggregates).
  • Podcasts Follows         → client groups the follow-filtered boost feed by show.

Boost records are denormalized (booster name/pic + episode/show display fields
embedded) so a card renders with no client-side join. Full shownotes are heavy,
so they live only in the per-show detail shards (--per-show), not in the feed.
"""

import json
import time
from pathlib import Path

from nostr_utils import hex_to_npub

import db


def write_json(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(path)                       # atomic
    return path.stat().st_size


# denormalized boost record for the feed (lean — no shownotes).
# podcast identity is the CANONICAL guid (falls back to the as-signed one), so
# phantom-guid boosts join to their real show and carry the real guid to the site.
_EFF = db.effective_guid("b")
_FEED_SQL = f"""
SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
       b.amount_source, b.message, b.client, {_EFF} AS podcast_guid, b.item_guid,
       b.item_url, b.show_url,
       e.title AS ep_title, e.image AS ep_image, e.published AS ep_pub,
       e.enclosure_url AS ep_url, e.episode_number AS ep_num,
       s.title AS show_title, s.image AS show_image, s.artwork AS show_artwork,
       s.feed_url AS show_feed,
       p.name AS p_name, p.picture AS p_pic
FROM boosts b
LEFT JOIN episodes e ON e.item_guid    = b.item_guid
LEFT JOIN shows    s ON s.podcast_guid = {_EFF}
LEFT JOIN profiles p ON p.pubkey       = b.booster_pubkey
"""


def _record(r):
    return {
        "id":     r["event_id"],
        "ts":     r["created_at"],
        "sats":   r["sats"],
        "src":    r["amount_source"],
        "msg":    r["message"],
        "client": r["client"],
        "booster": {
            "pk":   r["booster_pubkey"],
            "npub": r["booster_npub"],
            "name": r["p_name"],
            "pic":  r["p_pic"],
        },
        "podcast": {
            "guid":  r["podcast_guid"],
            "title": r["show_title"],
            "img":   r["show_image"],
            "art2":  r["show_artwork"],   # fallback art URL when `img` 404s (may be null)
            "feed":  r["show_feed"],
        },
        "episode": {
            "guid":  r["item_guid"],
            "title": r["ep_title"],
            "img":   r["ep_image"] or r["show_image"],
            "date":  r["ep_pub"],
            "num":   r["ep_num"],
            "url":   r["ep_url"] or r["item_url"],
        },
    }


def export(conn, out_dir, latest_n=1000, per_show=False, log=print):
    out = Path(out_dir)
    rows = conn.execute(_FEED_SQL + " ORDER BY b.created_at DESC").fetchall()
    records = [_record(r) for r in rows]
    total = len(records)
    generated = int(time.time())

    # ── boost feed: latest (root) + monthly pages under boosts/ ───────────────
    # Layout matches the served contract: /onlyboosts/latest.json (recent),
    # /onlyboosts/boosts/YYYY-MM.json (archives), /onlyboosts/index.json (manifest,
    # written at the end once the podcasts count is known).
    latest = records[:latest_n]
    write_json(out / "latest.json",
               {"generated_at": generated, "count": len(latest), "boosts": latest})

    months = {}
    for rec in records:
        key = time.strftime("%Y-%m", time.gmtime(rec["ts"]))
        months.setdefault(key, []).append(rec)
    for key, recs in months.items():
        # No generated_at in the per-month bodies: a past month's file is then
        # byte-identical run to run, so the incremental push (rsync) skips it and
        # only re-ships the current month. Freshness lives in the manifest.
        write_json(out / "boosts" / f"{key}.json",
                   {"month": key, "count": len(recs), "boosts": recs})
    log(f"  boost feed: {total} records, {len(months)} monthly pages")

    # ── podcasts index (per-show aggregates) ──────────────────────────────────
    agg = conn.execute(f"""
        SELECT {_EFF} AS podcast_guid,
               COUNT(*) AS boosts, COALESCE(SUM(b.sats),0) AS sats,
               COUNT(DISTINCT b.booster_pubkey) AS boosters,
               COUNT(DISTINCT b.item_guid) AS episodes,
               MAX(b.created_at) AS latest,
               s.title, s.image, s.artwork, s.feed_url, s.medium, s.author
        FROM boosts b LEFT JOIN shows s ON s.podcast_guid = {_EFF}
        WHERE {_EFF} IS NOT NULL
        GROUP BY {_EFF}
        ORDER BY latest DESC""").fetchall()
    podcasts = [{
        "guid":     a["podcast_guid"],
        "title":    a["title"],
        "img":      a["image"],
        "art2":     a["artwork"],                # fallback art URL when `img` 404s (may be null)
        "feed":     a["feed_url"],
        "medium":   a["medium"] or "podcast",   # podcast:medium — 'music' etc.; default per the namespace
        "author":   a["author"],                # <itunes:author>: 'Artist' on music, weak 'by' on podcasts; raw
        "boosts":   a["boosts"],
        "sats":     a["sats"],
        "boosters": a["boosters"],
        "episodes": a["episodes"],
        "latest":   a["latest"],
        "file":     f"podcasts/{_safe(a['podcast_guid'])}.json",   # exact per-show shard path
    } for a in agg]
    write_json(out / "podcasts" / "index.json",
               {"generated_at": generated, "count": len(podcasts), "podcasts": podcasts})
    log(f"  podcasts index: {len(podcasts)} shows")

    # ── profiles map (for Follows resolution / richer cards) ──────────────────
    profs = {}
    for p in conn.execute("SELECT * FROM profiles").fetchall():
        profs[p["pubkey"]] = {
            "npub": hex_to_npub(p["pubkey"]),
            "name": p["name"], "display_name": p["display_name"],
            "picture": p["picture"], "nip05": p["nip05"],
        }
    write_json(out / "profiles.json", {"generated_at": generated, "profiles": profs})
    log(f"  profiles: {len(profs)}")

    # ── optional per-show detail shards (full shownotes live here) ────────────
    if per_show:
        n = 0
        for a in agg:
            pg = a["podcast_guid"]
            eps = conn.execute(f"""
                SELECT e.*, COUNT(b.event_id) AS boosts,
                       COALESCE(SUM(b.sats),0) AS sats
                FROM boosts b LEFT JOIN episodes e ON e.item_guid = b.item_guid
                WHERE {_EFF} = ? AND b.item_guid IS NOT NULL
                GROUP BY b.item_guid ORDER BY MAX(b.created_at) DESC""", (pg,)).fetchall()
            show_boosts = [_record(r) for r in
                           conn.execute(_FEED_SQL + f" WHERE {_EFF} = ? "
                                        "ORDER BY b.created_at DESC", (pg,)).fetchall()]
            # No generated_at here either — a show's file changes only when that
            # show gets a new boost, so rsync ships just the handful that moved.
            write_json(out / "podcasts" / f"{_safe(pg)}.json", {
                "show": {"guid": pg, "title": a["title"], "img": a["image"],
                         "art2": a["artwork"],   # fallback art URL when `img` 404s (may be null)
                         "feed": a["feed_url"], "medium": a["medium"],
                         "author": a["author"]},
                "episodes": [{
                    "guid": e["item_guid"], "title": e["title"],
                    "img": e["image"] or a["image"], "date": e["published"],
                    "num": e["episode_number"], "url": e["enclosure_url"],
                    "shownotes": e["description"], "boosts": e["boosts"], "sats": e["sats"],
                } for e in eps if e["item_guid"]],
                "boosts": show_boosts,
            })
            n += 1
        log(f"  per-show detail shards: {n}")

    # ── manifest (root index.json) — directories aren't browsable on the VPS,
    # so this is how a consumer discovers exact filenames/months up front ──────
    s = db.stats(conn)
    write_json(out / "index.json", {
        "generated_at": generated,
        "totals": s,
        "boosts": {
            "latest": "latest.json",
            "months": [{"month": k, "count": len(months[k]),
                        "file": f"boosts/{k}.json"}
                       for k in sorted(months, reverse=True)],
        },
        "podcasts": {"index": "podcasts/index.json", "count": len(podcasts)},
        "profiles": "profiles.json",
    })

    # ── meta ──────────────────────────────────────────────────────────────────
    write_json(out / "meta.json", {"generated_at": generated, **s})
    log(f"  exported to {out}")
    return total


_UNSAFE = str.maketrans({c: "_" for c in '/\\:*?"<>| '})


def _safe(name):
    """Filesystem-safe shard name for a podcast guid (UUIDs pass through)."""
    return (name or "unknown").translate(_UNSAFE)
