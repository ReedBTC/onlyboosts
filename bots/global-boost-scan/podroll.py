#!/usr/bin/env python3
"""Podroll pass: `<podcast:podroll>` recommendations, parsed from raw RSS.

This is the one collector field Podcast Index cannot give us. Its feed object
carries no podroll (`artwork, author, categories, ..., value` — measured, not
assumed), and `/podcasts/bytag?podcast-podroll` returns zero feeds while
`?podcast-value` returns results. So the block has to come from the show's own
feed, which makes this the only pass that fetches third-party RSS at all.

That has three consequences the code is shaped around:

1. **Politeness is load-bearing, not a nicety.** A first scoping sweep at 12 flat
   workers drew 429s from 137 feeds — 135 of them Wavlake, which hosts a large
   slice of the music corpus. Every one of those would have been recorded as
   "no podroll". Requests are therefore grouped by host and issued *serially per
   host* with a delay, so concurrency only ever spans different hosts.
2. **Feeds are big and podroll is small.** One indexed feed is 50MB. Each fetch
   is streamed and abandoned at `CAP_BYTES`, or earlier at `</channel>` — after
   which no channel-level tag can appear. The cap was validated: all 48 feeds
   that exceeded it were re-downloaded in full and none carried a podroll past
   it.
3. **The block is regex-parsed, not XML-parsed.** These are third-party feeds
   read from a deliberately truncated prefix, so a document-level parse would
   fail on both malformed markup and on our own early abort. The scan is scoped
   to the podroll block itself and tolerates any namespace prefix.

Read-only against the network: fetches feeds, writes only the local SQLite.
"""

import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests

CAP_BYTES = 2_000_000      # per-feed read ceiling (validated: no podroll past it)
HOST_DELAY = 0.7           # pause between two requests to the SAME host
HOST_WORKERS = 8           # distinct hosts in flight; never two on one host
TIMEOUT = 25
RETRY_429 = 2              # extra tries on a rate-limit, with backoff
UA = {"User-Agent": "OnlyBoosts/1.0 (+https://onlyboosts.social; podroll indexer)"}

# Any namespace prefix: the tag is conventionally `podcast:` but the prefix is
# the feed's to choose, and a few bind the namespace under another name.
_BLOCK_RE = re.compile(r"<([a-zA-Z0-9]+:)?podroll[\s>].*?</([a-zA-Z0-9]+:)?podroll>",
                       re.S | re.I)
_OPEN_RE = re.compile(r"<([a-zA-Z0-9]+:)?podroll[\s>/]", re.I)
_ITEM_RE = re.compile(r"<([a-zA-Z0-9]+:)?remoteItem\b([^>]*?)/?>", re.I)
_ATTR_RE = re.compile(r'([\w:]+)\s*=\s*"([^"]*)"')


def _norm(u):
    return (u or "").strip() or None


def parse_podroll(xml):
    """Extract the podroll's remoteItems, in publisher order.

    Returns [] for a feed with no podroll (or an empty one), which is the common
    case. A `<podcast:podroll>` opened but not closed inside what we read means
    the block was cut by the read cap; that raises `Truncated` so the caller can
    record it rather than silently publish half a list.
    """
    m = _BLOCK_RE.search(xml)
    if not m:
        if _OPEN_RE.search(xml):
            raise Truncated("podroll block opened but never closed in the bytes read")
        return []
    items = []
    for _prefix, attrs in _ITEM_RE.findall(m.group(0)):
        a = {k.split(":")[-1].lower(): v for k, v in _ATTR_RE.findall(attrs)}
        guid, url = _norm(a.get("feedguid")), _norm(a.get("feedurl"))
        if not (guid or url):
            continue        # nothing to point at; a bare <remoteItem/> is noise
        items.append({
            "target_guid":   guid,
            "target_url":    url,
            # Both attrs are optional and rare in the wild (title on 16 of 376
            # live edges, medium on 11). They're stored as the publisher's own
            # hint and are NOT preferred over what we resolve for the target
            # ourselves — a stale hand-typed title in someone else's feed
            # shouldn't override the real one.
            "target_title":  _norm(a.get("title")),
            "target_medium": _norm(a.get("medium")),
        })
    return items


class Truncated(Exception):
    """The podroll block ran past the bytes we were willing to read."""


# ── publisher linkage ─────────────────────────────────────────────────────────
# An album feed names the publisher feed above it (in practice: the artist) in
# one of two shapes, both channel-level, and both must be parsed:
#
#   1. nested (Fountain, RSS Blue):
#        <podcast:publisher>
#          <podcast:remoteItem medium="publisher" feedGuid="…" feedUrl="…"/>
#        </podcast:publisher>
#   2. flat (Wavlake): a bare channel-level
#        <podcast:remoteItem medium="publisher" feedGuid="…" feedUrl="…">
#        </podcast:remoteItem>
#      — note it is NOT self-closing in the wild, which is why _ITEM_RE matches
#      open tags only.
#
# Channel-level means the link is always inside the prefix fetch_feed_head
# already holds, so extraction rides the podroll fetch at ZERO extra requests.
# The scan is scoped to the channel head (everything before the first
# <item>/<liveItem>) with podroll blocks cut out, so a podroll RECOMMENDING a
# publisher feed can never read as ownership, and an item-level remoteItem (a
# valueTimeSplit's, say) can never leak in. See publishers.py for the design
# record and the pass that fetches the publisher feeds these links point at.

_PUB_BLOCK_RE = re.compile(
    r"<([a-zA-Z0-9]+:)?publisher[\s>].*?</([a-zA-Z0-9]+:)?publisher>", re.S | re.I)
_HEAD_END_RE = re.compile(r"<([a-zA-Z0-9]+:)?(item|liveItem)[\s>]", re.I)


def channel_head(xml):
    """Everything before the first <item>/<liveItem> — where every channel-level
    tag sits in practice. (An <itunes:…> tag is not cut: the tag NAME must be
    item, not merely start with it.)"""
    m = _HEAD_END_RE.search(xml)
    return xml[:m.start()] if m else xml


def parse_publisher(xml):
    """The publisher feed this feed declares itself part of, or None.

    Returns {"guid", "url", "title"} off the remoteItem's attributes; any single
    field may be None but at least one of guid/url is set. The nested block's
    remoteItem counts with or without its medium attribute (every one observed
    carries medium="publisher", but inside <podcast:publisher> the position
    already says what it is); a flat remoteItem counts only when it SAYS
    medium="publisher" — any other channel-level remoteItem is a different
    feature and must not be read as ownership.
    """
    head = channel_head(xml)
    block = _PUB_BLOCK_RE.search(head)
    scopes = ((block.group(0), False),) if block else ()
    scopes += ((_BLOCK_RE.sub("", head), True),)
    for scope, need_medium in scopes:
        for _prefix, attrs in _ITEM_RE.findall(scope):
            a = {k.split(":")[-1].lower(): v for k, v in _ATTR_RE.findall(attrs)}
            if need_medium and (a.get("medium") or "").strip().lower() != "publisher":
                continue
            guid, url = _norm(a.get("feedguid")), _norm(a.get("feedurl"))
            if guid or url:
                return {"guid": guid, "url": url, "title": _norm(a.get("title"))}
    return None


def fetch_feed_head(url, session):
    """Stream a feed until the channel header is done. Returns (status, text).

    `text` is None for any non-200. Stops at `</channel>` (nothing channel-level
    follows it) or at CAP_BYTES, whichever comes first.
    """
    resp = session.get(url, headers=UA, timeout=TIMEOUT, stream=True)
    status = resp.status_code
    try:
        if status != 200:
            return status, None
        parts, n = [], 0
        for chunk in resp.iter_content(chunk_size=65536):
            if not chunk:
                continue
            parts.append(chunk.decode("utf-8", "replace") if isinstance(chunk, bytes) else chunk)
            n += len(parts[-1])
            if "</channel>" in parts[-1] or n >= CAP_BYTES:
                break
        return status, "".join(parts)
    finally:
        resp.close()


def _probe_one(row, session):
    """One feed → a result dict. Never raises: a failure is a recorded status."""
    guid, url = row["podcast_guid"], row["feed_url"]
    out = {"podcast_guid": guid, "feed_url": url, "status": None, "items": None,
           "publisher": None}
    for attempt in range(RETRY_429 + 1):
        try:
            status, text = fetch_feed_head(url, session)
            if status == 429 and attempt < RETRY_429:
                time.sleep(2 ** attempt * 3)
                continue
            if status != 200:
                out["status"] = f"http-{status}"
                return out
            out["items"] = parse_podroll(text)
            # Rides the same clean read; on a Truncated podroll the whole result
            # is recorded as truncated and the link is not extracted either.
            out["publisher"] = parse_publisher(text)
            out["status"] = "ok" if out["items"] else "none"
            return out
        except Truncated:
            out["status"] = "truncated"
            return out
        except Exception as e:
            out["status"] = f"err-{type(e).__name__}"
            return out
    out["status"] = "http-429"
    return out


def probe_feeds(rows, log=print):
    """Fetch every row's feed and parse its podroll. Concurrency is per-HOST:
    one connection per host at a time, `HOST_WORKERS` hosts at once. Returns a
    list of result dicts in no particular order."""
    by_host = defaultdict(list)
    for r in rows:
        by_host[urlparse(r["feed_url"]).netloc.lower()].append(r)
    # Biggest hosts first so the long serial tail (Wavlake's ~130 feeds) starts
    # immediately instead of being picked up last by an otherwise idle pool.
    hosts = sorted(by_host, key=lambda h: -len(by_host[h]))
    log(f"  {len(rows)} feed(s) across {len(hosts)} host(s); "
        f"largest: {hosts[0] if hosts else '—'} ({len(by_host[hosts[0]]) if hosts else 0})")

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
                if done[0] % 100 == 0:
                    log(f"    …{done[0]}/{len(rows)} feeds")
        return out

    with ThreadPoolExecutor(max_workers=HOST_WORKERS) as ex:
        for out in ex.map(run_host, hosts):
            results.extend(out)
    return results
