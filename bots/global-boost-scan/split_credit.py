#!/usr/bin/env python3
"""Value-time-split dual credit: a boost made while a host episode was playing
someone else's song is credited to BOTH, the sats divided by the window's
remotePercentage. Reed's design, 2026-11-23 ("divided by the song's percentage").

The note names two pairs of NIP-73 identifiers, host and track, and the ORDER OF
THE PAIRS IS NOT EVIDENCE: BMB writes the episode first, chadf the song first, and
MSP 2.0 varies. Placement, strongest first, and the method recorded on the row:

  • rss     the host item's own <podcast:valueTimeSplit> names the other item in a
            <podcast:remoteItem itemGuid>. The window's remotePercentage is the
            track's share (the spec's default of 100 when the attribute is absent).
  • medium  both items sit on feeds we know, exactly one of them music, and the
            host RSS has no matching window (in practice a liveItem, whose split
            was announced live and never written into the feed). pct unknown.
  • tag     the host item is on no feed we can read (trimmed from its feed), but
            the note names exactly one non-music show that the song is not on.
            pct unknown.

An unknown percentage gives the track the whole boost and lists the host at 0
sats (Reed's call). Left as they are today, deliberately:

  • a note whose "track" is on no feed we know. One such is a 42,000-sat Bowl
    After Bowl boost whose second item tag is the bare string "440"; the rule
    would have moved every sat off the show onto a song nobody can name.
  • two music items (malformed tagging, not a split), two tracks in one window,
    and a show-level host with no host item.

⚠️ THE BOOSTS ROW IS NEVER TOUCHED. Today's primary credit is sometimes the host
(45 of 301 placements, measured 2026-11-23), and /api/v1/boosts is what Local
Bitcoiners' publisher reads before it posts, so the credit lives in its own table,
`boost_credits`, two rows per placed boost (role 'track' and 'host'), and a reader
counts a boost through those rows when it has them. The shares add up to the
boost's sats exactly (largest remainder over two shares).

A placed percentage is never revisited: a host feed that later drops the window
keeps the last one we read. A row placed without one, and a note nothing placed,
is re-read after SPLIT_RETRY, and a percentage found then rewrites both rows.

The excludes list gates both sides: a note any of whose four identifiers is on it
gets no split, and a boost that later becomes excluded or a duplicate loses its
credits here and in D1 (the reproject queue). Playlist credit and the alias rungs
are separate passes; the measured overlap with them was 0 rows.

Read-only against the network (feed fetches); writes only the local index.
"""
import json
import re
import time

import db
import enrich

SPLIT_RETRY = 7 * 24 * 60 * 60
METHOD_RSS, METHOD_MEDIUM, METHOD_TAG = "rss", "medium", "tag"

_VTS_RE = re.compile(
    r"<(?:[a-zA-Z0-9]+:)?valueTimeSplit\b([^>]*?)(?:/>|>(.*?)</(?:[a-zA-Z0-9]+:)?valueTimeSplit>)",
    re.S | re.I)
_REMOTE_RE = re.compile(r"<(?:[a-zA-Z0-9]+:)?remoteItem\b([^>]*)>", re.I)
_ATTR_RE = re.compile(r'([\w:]+)\s*=\s*["\']([^"\']*)["\']')
ITEM_TAG, SHOW_TAG = "podcast:item:guid:", "podcast:guid:"


def _attrs(s):
    return {k.split(":")[-1].lower(): v.strip() for k, v in _ATTR_RE.findall(s or "")}


def parse_splits(xml):
    """{host_item_guid: [(track_item_guid, track_feed_guid, pct)]} for every item
    and liveItem in `xml`. pct is a float, 100.0 when the attribute is absent."""
    out = {}
    for _kind, _a, block in enrich._ITEM_BLOCK_RE.findall(xml or ""):
        guid = enrich._tag(block, "guid")
        if not guid:
            continue
        wins = []
        for a, body in _VTS_RE.findall(block):
            raw = _attrs(a).get("remotepercentage")
            try:
                pct = float(raw) if raw not in (None, "") else 100.0
            except ValueError:
                continue
            if not 0 <= pct <= 100:
                continue
            for ri in _REMOTE_RE.findall(body or ""):
                r = _attrs(ri)
                if r.get("itemguid"):
                    wins.append((r["itemguid"], r.get("feedguid"), pct))
        out[guid] = wins
    return out


def note_ids(raw_json):
    """(item guids, show guids) off the signed note, each distinct, in tag order."""
    try:
        tags = json.loads(raw_json or "{}").get("tags", [])
    except ValueError:
        return [], []
    items, shows = [], []
    for t in tags:
        if len(t) >= 2 and t[0] == "i" and isinstance(t[1], str):
            if t[1].startswith(ITEM_TAG):
                v, into = t[1][len(ITEM_TAG):], items
            elif t[1].startswith(SHOW_TAG):
                v, into = t[1][len(SHOW_TAG):], shows
            else:
                continue
            if v and v not in into:
                into.append(v)
    return items, shows


def split_sats(sats, pct):
    """(track, host). Largest remainder over two shares: the share whose exact
    value has the larger fractional part takes the spare sat, the track on a tie,
    so the two always add up to `sats`. pct None is the unknown case."""
    sats = sats or 0
    if pct is None:
        return sats, 0
    exact = sats * pct / 100.0
    track = int(exact)
    if exact - track >= 0.5:
        track += 1
    return track, sats - track


class Index:
    """The local facts placement reads, memoized for one pass."""

    def __init__(self, conn):
        self.conn = conn
        self.shows = {r["podcast_guid"]: r for r in conn.execute(
            "SELECT podcast_guid, feed_url, feed_id, medium FROM shows")}
        self.by_feed_id = {str(r["feed_id"]): g for g, r in self.shows.items() if r["feed_id"]}
        self.aliases = dict(conn.execute("SELECT raw_guid, canonical_guid FROM guid_aliases"))
        self.excluded = {r[0] for r in conn.execute("SELECT id FROM excluded_ids")}
        self._owners = {}

    def canon(self, g):
        if g is None:
            return None
        g = self.by_feed_id.get(g, g) if g.isdigit() else g
        return self.aliases.get(g, g)

    def owners(self, item):
        """Non-list feeds the item sits on, per the episodes table."""
        if item not in self._owners:
            self._owners[item] = [self.canon(r[0]) for r in self.conn.execute(
                "SELECT podcast_guid FROM episodes WHERE item_guid=? AND podcast_guid IS NOT NULL",
                (item,))]
        return self._owners[item]

    def medium(self, g):
        s = self.shows.get(g)
        return s["medium"] if s else None

    def is_music(self, g):
        return self.medium(g) == "music"


class Feeds:
    """Feed fetches for one pass: each feed read at most once, parsed twice
    (splits, and the episode rows a credit may need)."""

    def __init__(self, idx, fetch=None):
        self.idx, self.fetch = idx, fetch or enrich.fetch_feed
        self.xml, self.splits, self.read = {}, {}, 0

    def get(self, feed_guid):
        if feed_guid not in self.xml:
            s = self.idx.shows.get(feed_guid)
            xml = self.fetch(s["feed_url"]) if s and s["feed_url"] else None
            self.read += bool(s and s["feed_url"])
            self.xml[feed_guid] = xml
            self.splits[feed_guid] = parse_splits(xml) if xml else None
        return self.splits[feed_guid]


def place(idx, feeds, items, shows, known_hosts=()):
    """The placement for one note, or (None, reason). A placement is
    {host_feed, host_item, track_feed, track_item, pct, method}."""
    if len(items) != 2:
        return None, "not-two-items"
    shows = [idx.canon(g) for g in shows]
    owners = {i: idx.owners(i) for i in items}
    cands = list(dict.fromkeys(shows + [g for i in items for g in owners[i]] + list(known_hosts)))
    found = []
    for f in cands:
        wins = feeds.get(f)
        if not wins:
            continue
        for host in items:
            for t_item, t_feed, pct in wins.get(host, []):
                if t_item in items and t_item != host:
                    found.append((f, host, t_item, t_feed, pct))
    if found:
        pairs = {(f, h, t) for f, h, t, _, _ in found}
        pcts = {p for *_, p in found}
        if len(pairs) != 1 or len(pcts) != 1:
            return None, "rss-ambiguous"
        f, h, t, t_feed, pct = found[0]
        t_feed = idx.canon(t_feed) or (owners[t] or [None])[0]
        return dict(host_feed=f, host_item=h, track_feed=t_feed, track_item=t,
                    pct=pct, method=METHOD_RSS), None

    music = [i for i in items if owners[i] and all(idx.is_music(g) for g in owners[i])]
    podcast = [i for i in items if owners[i] and not any(idx.is_music(g) for g in owners[i])
               and all(idx.medium(g) for g in owners[i])]
    unowned = [i for i in items if not owners[i]]
    if len(music) == 1 and len(podcast) == 1:
        h, t = podcast[0], music[0]
        return dict(host_feed=owners[h][0], host_item=h, track_feed=owners[t][0],
                    track_item=t, pct=None, method=METHOD_MEDIUM), None
    if len(music) == 1 and len(unowned) == 1:
        t = music[0]
        named = [g for g in shows if g not in owners[t] and idx.medium(g)
                 and not idx.is_music(g)]
        if len(named) == 1:
            return dict(host_feed=named[0], host_item=unowned[0], track_feed=owners[t][0],
                        track_item=t, pct=None, method=METHOD_TAG), None
        return None, "host-unknown"
    if len(podcast) == 1 and len(unowned) == 1:
        return None, "track-unknown"
    if len(music) == 2:
        return None, "two-music-items"
    return None, "unplaced"


def credit_rows(event_id, sats, p, now):
    t_sats, h_sats = split_sats(sats, p["pct"])
    return [(event_id, "track", p["track_feed"], p["track_item"], t_sats, p["pct"], p["method"], now),
            (event_id, "host", p["host_feed"], p["host_item"], h_sats, p["pct"], p["method"], now)]


def _episode_rows_wanted(idx, feeds, placements):
    """Episode rows a credit names that the box does not have, from feeds this
    pass already read (or the track's own feed, read once). A song or host
    episode with no row renders untitled."""
    pending = {}
    for p in placements:
        for feed, item in ((p["host_feed"], p["host_item"]), (p["track_feed"], p["track_item"])):
            if not feed or idx.owners(item):
                continue
            s = idx.shows.get(feed)
            if s and s["feed_url"]:
                pending.setdefault(feed, []).append(item)
    out = {}
    for feed, wanted in pending.items():
        feeds.get(feed)
        xml = feeds.xml.get(feed)
        if not xml:
            continue
        eps = enrich.parse_feed_episodes(xml)
        for item in wanted:
            ep = eps.get(item)
            if ep:
                ep = dict(ep)
                ep.pop("is_live", None)
                ep["podcast_guid"], ep["feed_id"] = feed, idx.shows[feed]["feed_id"]
                out[item] = ep
    return out


def credit_splits(conn, log=print, fetch=None, dry_run=False, now=None):
    """One pass. Returns {"placed", "by_method", "pct_unknown", "rewritten",
    "unplaced", "reasons", "pruned", "episodes", "feeds_read", "rows"}."""
    now = now or int(time.time())
    res = {"placed": 0, "by_method": {}, "pct_unknown": 0, "rewritten": 0, "unplaced": 0,
           "reasons": {}, "pruned": 0, "episodes": 0, "feeds_read": 0, "rows": []}

    # Prune first: a boost that became excluded or a duplicate keeps no credit.
    gone = [r[0] for r in conn.execute(
        f"""SELECT DISTINCT c.event_id FROM boost_credits c
            JOIN boosts b ON b.event_id = c.event_id
            WHERE NOT {db.not_excluded('b')}""")]
    res["pruned"] = len(gone)
    if gone and not dry_run:
        db.drop_credits(conn, gone)

    if not dry_run:
        # The day totals start counting through credits (d1_sync, db.credited_rows),
        # the credits already written are recounted once; later ones queue their own.
        res["recount_queued"] = db.queue_credit_recount_once(conn)
    rows = db.split_credit_candidates(conn, now - SPLIT_RETRY)
    if not rows:
        return res
    idx = Index(conn)
    feeds = Feeds(idx, fetch)
    known_hosts = [r[0] for r in conn.execute(
        "SELECT DISTINCT podcast_guid FROM boost_credits WHERE role='host'")]
    write, checks, placements = [], [], []
    # Two rounds: a host this pass places is a feed the next note's host item may
    # sit on when that note names only its song (an old Homegrown Hits episode).
    decided = {}
    for r in rows:
        items, shows = note_ids(r["raw_json"])
        decided[r["event_id"]] = place(idx, feeds, items, shows, known_hosts)
    more = {p["host_feed"] for p, _ in decided.values() if p} - set(known_hosts)
    if more:
        for r in rows:
            if decided[r["event_id"]][1] == "host-unknown":
                items, shows = note_ids(r["raw_json"])
                decided[r["event_id"]] = place(idx, feeds, items, shows, sorted(more))
    for r in rows:
        p, why = decided[r["event_id"]]
        if p and r["credited_guid"]:
            # The side the boosts row already credits keeps the feed it is counted
            # under today. One song can sit on two feed rows (a single listed
            # twice), and a credit naming the other would move its page's only
            # boost off it.
            for side in ("track", "host"):
                if p[f"{side}_item"] == r["item_guid"]:
                    p[f"{side}_feed"] = r["credited_guid"]
        if p and any(x in idx.excluded for x in
                     (p["host_feed"], p["host_item"], p["track_feed"], p["track_item"])):
            p, why = None, "excluded"
        if not p:
            res["unplaced"] += 1
            res["reasons"][why] = res["reasons"].get(why, 0) + 1
            checks.append((r["event_id"], now, why))
            continue
        if r["had_pct"] is not None:            # a placed pct is never revisited
            continue
        if r["had_method"] and p["pct"] is None:  # still unknown: only the clock moves
            checks.append((r["event_id"], now, "pct-unknown"))
            continue
        res["rewritten"] += bool(r["had_method"])
        res["placed"] += not r["had_method"]
        res["by_method"][p["method"]] = res["by_method"].get(p["method"], 0) + 1
        res["pct_unknown"] += p["pct"] is None
        write += credit_rows(r["event_id"], r["sats"], p, now)
        checks.append((r["event_id"], now, p["method"]))
        placements.append(p)
    eps = _episode_rows_wanted(idx, feeds, placements)
    res["episodes"], res["feeds_read"], res["rows"] = len(eps), feeds.read, write
    if not dry_run:
        db.write_credits(conn, write, checks)
        for ep in eps.values():
            db.upsert_episode(conn, ep)
    if write or res["pruned"]:
        by = ", ".join(f"{m}={n}" for m, n in sorted(res["by_method"].items()))
        log(f"Split credit: {res['placed']} boost(s) credited to song and host"
            + (f" ({by})" if by else "")
            + f", {res['pct_unknown']} with no percentage, {res['rewritten']} rewritten,"
            f" {res['unplaced']} left as they are, {res['pruned']} pruned,"
            f" {res['episodes']} episode row(s) added, {feeds.read} feed(s) read"
            + (" [dry run]" if dry_run else ""))
    return res
