#!/usr/bin/env python3
"""Publisher pass: resolve the <podcast:publisher> feeds album feeds point at.

Design record (2026-08-30). Music has three ownership tiers — publisher > album
(show) > song (episode) — and in practice the publisher is the ARTIST: Wavlake
mints one publisher feed per artist (wavlake.com/feed/artist/<guid>), Fountain
and RSS Blue mint them for their music uploaders. A publisher feed is an RSS
feed with <podcast:medium>publisher</podcast:medium>, NO items, and
channel-level <podcast:remoteItem medium="music" …> entries listing the
publisher's albums (which may live on OTHER hosts: an RSS Blue publisher
observed listing Wavlake albums, which is why the edges key on feedGuid).

How the data flows, and why it is cheap:

  1. podroll.py#parse_publisher extracts each album feed's upward link during
     the podroll sweep — the link is channel-level, so it is always inside the
     prefix that pass already streams, and extraction costs ZERO extra fetches.
     It lands on shows.publisher_guid / shows.publisher_feed_url, gated by the
     same clean-read-only rule as the podroll list itself.
  2. THIS module fetches each distinct publisher feed once (a few hundred, not
     a thousand): title, artwork, description, and the album remoteItems, which
     give the downward edges — including albums we hold no boosts for, the
     discovered_via='podroll' idea one tier up.
  3. Podcast Index is the FALLBACK, not the source. Measured live 2026-08-30:
     podcasts/byguid resolves a Fountain and an RSS Blue publisher feed but
     returns an EMPTY feed object for a Wavlake artist guid (and byfeedurl
     400s on the artist URL) — and Wavlake hosts most of the corpus. The
     publisher feed itself answers for everyone, so it is the primary. The PI
     feed object also carries no publisher field at all (checked against the
     API yaml 2026-08-30), which is why the linkage is RSS-only in the first
     place — the same class of gap as podroll.

Politeness is inherited from podroll.py: grouped by host, serial per host with
HOST_DELAY between requests — Wavlake hosts most of these feeds and is the host
that 429'd the original podroll sweep at 12 flat workers. Read-only against the
network: fetches feeds and returns results; the caller owns every write.
"""

import html
import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests

from enrich import _tag, clean_html
from podroll import (HOST_DELAY, HOST_WORKERS, RETRY_429,
                     _ATTR_RE, _ITEM_RE, _norm, channel_head, fetch_feed_head)

_HREF_IMG_RE = re.compile(
    r"<(?:[a-zA-Z0-9]+:)?image\b[^>]*?\bhref\s*=\s*\"([^\"]*)\"", re.I)
_RSS_IMG_RE = re.compile(r"<image\s*>.*?<url\s*>\s*(.*?)\s*</url>", re.S | re.I)


def _images(head):
    """(image, artwork) on the enrich convention: prefer RSS <image><url>, keep
    <itunes:image> as the distinct second-chance URL only when it differs."""
    rss = _RSS_IMG_RE.search(head)
    rss = (rss.group(1).strip() or None) if rss else None
    it = _HREF_IMG_RE.search(head)
    it = (it.group(1).strip() or None) if it else None
    image = rss or it
    return image, (it if it and it != image else None)


def parse_publisher_feed(xml):
    """Channel metadata + the album list out of one publisher feed.

    Returns (meta, albums). `meta` is None when the feed declares a medium that
    is NOT 'publisher' — a stale link can point at an ordinary album feed, and
    storing that channel's title as a publisher's would be wrong. A feed
    declaring no medium at all is accepted (observed nowhere, but the metadata
    would still be the channel's own).
    """
    head = channel_head(xml)
    medium = (_tag(head, "medium") or "").strip().lower()
    if medium and medium != "publisher":
        return None, None
    image, artwork = _images(head)
    meta = {
        "publisher_guid": _norm(_tag(head, "guid")),   # the feed's own claim
        "title": _tag(head, "title"),
        "image": image,
        "artwork": artwork,
        "description": clean_html(_tag(head, "description")),
    }
    # ⚠️ album_guid IS THE remoteItem's feedGuid, AND ON WAVLAKE THAT IS NOT
    # THE ALBUM'S DECLARED podcast:guid. Measured 2026-08-31 on Ainsley
    # Costello's publisher feed: every remoteItem names Wavlake's internal feed
    # id (also the artwork filename), while the album feed itself declares a
    # different podcast:guid — the one PI, boost notes and shows.podcast_guid
    # all key on. So publisher_albums.album_guid does NOT join against shows
    # for Wavlake albums; any future consumer of these downward edges must
    # resolve through album_url instead (BMB walks this same chain by URL for
    # exactly this reason). The upward edge (shows.publisher_guid) is
    # unaffected: an album feed's publisher remoteItem names the publisher
    # feed's own guid, which is consistent on every host observed.
    albums = []
    for _prefix, attrs in _ITEM_RE.findall(head):
        a = {k.split(":")[-1].lower(): v for k, v in _ATTR_RE.findall(attrs)}
        guid, url = _norm(a.get("feedguid")), _norm(a.get("feedurl"))
        med = (_norm(a.get("medium")) or "").lower() or None
        if not (guid or url) or med == "publisher":
            continue      # a publisher pointing at a publisher is not an album
        title = _norm(a.get("title"))
        albums.append({"album_guid": guid, "album_url": url,
                       "album_title": html.unescape(title) if title else None,
                       "album_medium": med})
    return meta, albums


def _probe_one(row, session):
    """One publisher feed → a result dict. Never raises: a failure is a status."""
    out = {"publisher_guid": row["publisher_guid"], "feed_url": row["feed_url"],
           "status": None, "meta": None, "albums": None}
    for attempt in range(RETRY_429 + 1):
        try:
            status, text = fetch_feed_head(out["feed_url"], session)
            if status == 429 and attempt < RETRY_429:
                time.sleep(2 ** attempt * 3)
                continue
            if status != 200:
                out["status"] = f"http-{status}"
                return out
            meta, albums = parse_publisher_feed(text)
            if meta is None:
                out["status"] = "not-publisher"
                return out
            out["meta"], out["albums"] = meta, albums
            out["status"] = "ok"
            return out
        except Exception as e:
            out["status"] = f"err-{type(e).__name__}"
            return out
    out["status"] = "http-429"
    return out


def probe_publishers(rows, log=print):
    """Fetch every publisher feed, politely: one connection per host at a time,
    HOST_WORKERS hosts at once — the podroll.probe_feeds shape with the
    publisher parse. Returns result dicts in no particular order."""
    by_host = defaultdict(list)
    for r in rows:
        by_host[urlparse(r["feed_url"]).netloc.lower()].append(r)
    hosts = sorted(by_host, key=lambda h: -len(by_host[h]))
    log(f"  {len(rows)} publisher feed(s) across {len(hosts)} host(s); "
        f"largest: {hosts[0] if hosts else '—'} "
        f"({len(by_host[hosts[0]]) if hosts else 0})")
    done = [0]
    results = []

    def run_host(host):
        out = []
        with requests.Session() as session:
            for i, row in enumerate(by_host[host]):
                if i:
                    time.sleep(HOST_DELAY)
                out.append(_probe_one(row, session))
                done[0] += 1
                if done[0] % 50 == 0:
                    log(f"    …{done[0]}/{len(rows)} feeds")
        return out

    with ThreadPoolExecutor(max_workers=HOST_WORKERS) as ex:
        for out in ex.map(run_host, hosts):
            results.extend(out)
    return results
