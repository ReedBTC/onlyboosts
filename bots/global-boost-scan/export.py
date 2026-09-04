#!/usr/bin/env python3
"""Export the SQLite index to static JSON shards the website reads.

The four OnlyBoosts views all derive from these files:
  • Boosts Global / Follows  → the boost feed (boosts/latest.json + monthly pages);
    Follows is a client-side filter on booster pubkey.
  • Songs / Albums           → boosts/music.json, the all-time music-medium slice
    of the same feed (the medium split is applied here, once, server-side).
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
#
# The trailing WHERE is the exclusion filter (excludes.json → boosts.excluded), and
# it is baked into the SQL rather than added per call site so no consumer of this
# string can forget it — callers that narrow further append `AND …`, not `WHERE`.
_EFF = db.effective_guid("b")
_FEED_SQL = f"""
SELECT b.event_id, b.booster_pubkey, b.booster_npub, b.created_at, b.sats,
       b.amount_source, b.message, b.client, b.client_id, b.client_via,
       {_EFF} AS podcast_guid, b.item_guid,
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
WHERE {db.not_excluded('b')}
"""


def _record(r):
    return {
        "id":     r["event_id"],
        "ts":     r["created_at"],
        "sats":   r["sats"],
        "src":    r["amount_source"],
        "msg":    r["message"],
        # The publisher's own NIP-89 tag, as signed. On ~1.3% of boosts.
        "client": r["client"],
        # DERIVED attribution — see bots/global-boost-scan/clients.py. `client_id`
        # is the app that PUBLISHED the note; `client_via` is the app a relayed
        # boost came from, and is only ever set under a relaying publisher. Null
        # client_id means unattributed (~0.2%) and must not be read as any app.
        "client_id": r["client_id"],
        "client_via": r["client_via"],
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


def _podroll_maps(conn):
    """Both directions of the podroll graph, resolved once for the whole export.

    Every edge is read in a single query and grouped in Python rather than asked
    per shard: the graph is a few hundred rows against ~1,300 shards, so a
    per-shard query would be three orders of magnitude more work for the same
    answer. Returns (forward, reverse) as {guid: [card, …]}, forward in the
    publisher's own order and reverse alphabetical.

    A card's `linked` flag is the site's cue that the target has a /show page —
    which requires boosts AND a title, the same qualifying rule the page itself
    applies. Titleless or boost-less targets still ship: they carry artwork and a
    feed URL, which is enough to render a card that points off-site.
    """
    forward, reverse = {}, {}
    for r in db.podroll_rows(conn):
        # Our resolved title wins over the remoteItem's `title` attribute: the
        # attribute is a hand-written hint in someone else's feed and goes stale.
        t_title = r["tgt_title"] or r["target_title"]
        forward.setdefault(r["source_guid"], []).append({
            "guid":   r["target_guid"],
            "title":  t_title,
            "img":    r["tgt_img"],
            "art2":   r["tgt_art2"],
            "medium": r["tgt_medium"] or r["target_medium"],
            "author": r["tgt_author"],
            "feed":   r["tgt_feed"] or r["target_url"],
            "linked": bool(r["tgt_boosted"] and t_title),
        })
        if not r["target_guid"]:
            continue                      # url-only edge: no key to reverse it under
        reverse.setdefault(r["target_guid"], []).append({
            "guid":   r["source_guid"],
            "title":  r["src_title"],
            "img":    r["src_img"],
            "art2":   r["src_art2"],
            "medium": r["src_medium"],
            "author": r["src_author"],
            "feed":   r["src_feed"],
            "linked": bool(r["src_boosted"] and r["src_title"]),
        })
    for lst in reverse.values():
        lst.sort(key=lambda c: ((c["title"] or "").lower(), c["guid"] or ""))
    return forward, reverse


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
               s.title, s.image, s.artwork, s.feed_url, s.medium, s.author, s.language
        FROM boosts b LEFT JOIN shows s ON s.podcast_guid = {_EFF}
        WHERE {_EFF} IS NOT NULL AND {db.not_excluded('b')}
        GROUP BY {_EFF}
        ORDER BY latest DESC""").fetchall()
    fwd_podroll, rev_podroll = _podroll_maps(conn)
    podcasts = [{
        "guid":     a["podcast_guid"],
        "title":    a["title"],
        "img":      a["image"],
        "art2":     a["artwork"],                # fallback art URL when `img` 404s (may be null)
        "feed":     a["feed_url"],
        "medium":   a["medium"] or "podcast",   # podcast:medium — 'music' etc.; default per the namespace
        "author":   a["author"],                # <itunes:author>: 'Artist' on music, weak 'by' on podcasts; raw
        # RSS <language>, primary subtag ('en', 'de'). NULL/absent means the feed
        # declares none — NOT English. 99% of podcasts carry one against 48% of
        # music, so a consumer filtering on this must treat null as its own state
        # or it silently drops half the music. Same partition rule as `medium`.
        "language": a["language"],
        "boosts":   a["boosts"],
        "sats":     a["sats"],
        "boosters": a["boosters"],
        "episodes": a["episodes"],
        "latest":   a["latest"],
        "file":     f"podcasts/{_safe(a['podcast_guid'])}.json",   # exact per-show shard path
        # Podroll COUNTS only, and only when non-zero. The cards themselves live in
        # the per-show shard: the tag is on ~7% of feeds, so carrying them here
        # would weigh down the file every surface loads for a section 93% of pages
        # don't have — and even two null keys per entry is ~45KB across the index.
        # A missing key means "no section here, don't open the shard for it".
        **({"podroll": len(fwd_podroll[a["podcast_guid"]])}
           if a["podcast_guid"] in fwd_podroll else {}),
        **({"podrolled_by": len(rev_podroll[a["podcast_guid"]])}
           if a["podcast_guid"] in rev_podroll else {}),
    } for a in agg]
    write_json(out / "podcasts" / "index.json",
               {"generated_at": generated, "count": len(podcasts), "podcasts": podcasts})
    log(f"  podcasts index: {len(podcasts)} shows")

    # ── music-only boost feed (boosts/music.json) ─────────────────────────────
    # All-time, newest first, same record shape as latest.json — the Songs feed
    # reads it whole instead of windowing the firehose. Music is ~5% of the boost
    # stream, so the client's three-month window painted 14% of the music in the
    # index while downloading 4MB to use a twentieth of it; this file is the
    # complete set and smaller than that window.
    #
    # The membership test reads `podcasts` — the very list written above — rather
    # than re-querying the medium. The site joins guid → medium through that file,
    # so deriving both from one projection is what keeps a song from appearing in
    # one surface and not the other. Note it inherits the `or "podcast"` default:
    # a show with no declared medium is NOT music, because the split is a
    # partition and filing an unidentified feed under music claims something we
    # can't support. The records themselves stay medium-free — that's a property
    # of the show, and stamping it onto 22k boosts is the thing this file avoids.
    music_guids = {p["guid"] for p in podcasts if p["medium"] == "music"}
    music = [rec for rec in records if rec["podcast"]["guid"] in music_guids]
    write_json(out / "boosts" / "music.json",
               {"generated_at": generated, "count": len(music), "boosts": music})
    log(f"  music feed: {len(music)} records from {len(music_guids)} music shows")

    # ── profiles map (for Follows resolution / richer cards) ──────────────────
    # Excluded boosters lose their identity row too: the map is keyed by pubkey and
    # read by the feeds, so leaving it would publish the name and avatar of someone
    # whose boosts are gone.
    profs = {}
    for p in conn.execute(
        "SELECT * FROM profiles p WHERE NOT EXISTS (SELECT 1 FROM excluded_ids x "
            "WHERE x.kind='booster' AND x.id = p.pubkey)").fetchall():
        profs[p["pubkey"]] = {
            "npub": hex_to_npub(p["pubkey"]),
            "name": p["name"], "display_name": p["display_name"],
            "picture": p["picture"], "nip05": p["nip05"],
            "about": p["about"], "lud16": p["lud16"], "lud06": p["lud06"],
            "website": p["website"], "banner": p["banner"],
        }
    write_json(out / "profiles.json", {"generated_at": generated, "profiles": profs})
    log(f"  profiles: {len(profs)}")

    # ── optional per-show detail shards (full shownotes live here) ────────────
    if per_show:
        # ⚠️ ONE PASS OVER THE DATA, GROUPED IN PYTHON — NOT ONE QUERY PER SHOW.
        # Until 2026-09-04 this block ran two queries per show, each filtering
        # the whole boosts table on the effective guid. That guid is a COALESCE,
        # so no index serves it: 2,450 shows × 2 × ~39k rows ≈ 190M row
        # evaluations, 135s at 100% of one core, every five minutes, to rewrite
        # files that were byte-identical to the previous run. `records` is
        # already the whole feed in newest-first order, so a show's boost list is
        # a bucket of it; the per-episode aggregates come from the same GROUP BY
        # as before with the per-show predicate replaced by a grouping key.
        #
        # Both orders are preserved exactly (verified by diff -r against the
        # per-show version over the live index): boosts newest-first as `records`
        # has them, episodes by their newest boost within each show. Byte
        # identity is load-bearing — rsync skips an unchanged shard, and the site
        # reads these files as a contract.
        boosts_by_show = {}
        for rec in records:
            g = rec["podcast"]["guid"]          # the effective guid, as `agg` keys it
            if g is not None:
                boosts_by_show.setdefault(g, []).append(rec)
        # `e.*` carries its own `podcast_guid` column, so the grouping key gets a
        # name of its own; sqlite3.Row would otherwise hand back whichever came
        # first.
        eps_by_show = {}
        for e in conn.execute(f"""
                SELECT {_EFF} AS show_guid, e.*, COUNT(b.event_id) AS boosts,
                       COALESCE(SUM(b.sats),0) AS sats
                FROM boosts b LEFT JOIN episodes e ON e.item_guid = b.item_guid
                WHERE {_EFF} IS NOT NULL AND b.item_guid IS NOT NULL
                  AND {db.not_excluded('b')}
                GROUP BY show_guid, b.item_guid
                ORDER BY show_guid, MAX(b.created_at) DESC"""):
            eps_by_show.setdefault(e["show_guid"], []).append(e)

        n = 0
        for a in agg:
            pg = a["podcast_guid"]
            eps = eps_by_show.get(pg, ())
            show_boosts = boosts_by_show.get(pg, [])
            # No generated_at here either — a show's file changes only when that
            # show gets a new boost, so rsync ships just the handful that moved.
            write_json(out / "podcasts" / f"{_safe(pg)}.json", {
                "show": {"guid": pg, "title": a["title"], "img": a["image"],
                         "art2": a["artwork"],   # fallback art URL when `img` 404s (may be null)
                         "feed": a["feed_url"], "medium": a["medium"],
                         "author": a["author"], "language": a["language"]},
                # <podcast:podroll>. `podroll` is what this show recommends, in the
                # publisher's order; `recommended_by` is the reverse edge, which is
                # what makes the feature worth having — it lights up ~40% more pages
                # than the forward direction alone. Both omitted when empty.
                **({"podroll": fwd_podroll[pg]} if pg in fwd_podroll else {}),
                **({"recommended_by": rev_podroll[pg]} if pg in rev_podroll else {}),
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
        # A show that dropped out of `agg` — excluded, or emptied by guid re-keying
        # — leaves its shard behind, and the routine push is an rsync WITHOUT
        # --delete, so the VPS would keep serving /show/<guid> from a stale file
        # after the show came off the index. Removing it locally is only half the
        # job; the marker is what tells `push` to mirror this time.
        keep = {f"{_safe(a['podcast_guid'])}.json" for a in agg} | {"index.json"}
        stale = [f for f in (out / "podcasts").glob("*.json") if f.name not in keep]
        for f in stale:
            f.unlink()
        if stale:
            # OUTSIDE the shards tree — everything inside it is rsynced verbatim.
            prune_marker(out).write_text("\n".join(f.name for f in stale) + "\n")
            log(f"  removed {len(stale)} stale per-show shard(s) — next push will mirror")

    # ── manifest (root index.json) — directories aren't browsable on the VPS,
    # so this is how a consumer discovers exact filenames/months up front ──────
    s = db.stats(conn)
    write_json(out / "index.json", {
        "generated_at": generated,
        "totals": s,
        "boosts": {
            "latest": "latest.json",
            "music": "boosts/music.json",     # all-time, music-medium shows only
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


def prune_marker(out_dir):
    """Where `export` records that it deleted shards and `push` must mirror.

    A sibling of the shards directory, never inside it: rsync ships that tree
    verbatim, so a marker in there would land on the VPS as a file the site serves.
    """
    return Path(out_dir).parent / "prune-pending.txt"


_UNSAFE = str.maketrans({c: "_" for c in '/\\:*?"<>| '})


def _safe(name):
    """Filesystem-safe shard name for a podcast guid (UUIDs pass through)."""
    return (name or "unknown").translate(_UNSAFE)
