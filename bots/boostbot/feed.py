"""The show's own RSS: its podcast:guid, its episodes, and each episode's value
time splits.

The bot reads the splits from the published feed rather than from the editor's
splits-final.json, because the feed is what the listener's app paid against. A
split in the editor's file that never reached the feed paid nobody, and a split
corrected in the feed after publishing is the one the money followed.
"""
import xml.etree.ElementTree as ET

import requests

NS = {"podcast": "https://podcastindex.org/namespace/1.0"}
P = "{https://podcastindex.org/namespace/1.0}"

FETCH_TIMEOUT = 20
MAX_FEED_BYTES = 8 * 1024 * 1024


class FeedUnavailable(Exception):
    """The feed could not be fetched or parsed. Publishing nothing is the only
    safe answer: every gate in this bot hangs off the feed."""


def fetch(url, timeout=FETCH_TIMEOUT):
    try:
        with requests.get(url, timeout=timeout, stream=True,
                          headers={"User-Agent": "onlyboosts-socialhour/1.0 (+https://onlyboosts.social)"}) as r:
            r.raise_for_status()
            body = b""
            for chunk in r.iter_content(65536):
                body += chunk
                if len(body) > MAX_FEED_BYTES:
                    raise FeedUnavailable(f"feed exceeds {MAX_FEED_BYTES} bytes")
    except requests.RequestException as e:
        raise FeedUnavailable(str(e)) from e
    return parse(body)


def _float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _recipients(value_el):
    out = []
    for r in value_el.findall("podcast:valueRecipient", NS):
        out.append({
            "name": r.get("name") or "",
            "address": (r.get("address") or "").strip(),
            "type": r.get("type") or "",
            "split": _float(r.get("split")) or 0.0,
            "fee": (r.get("fee") or "").lower() == "true",
        })
    return out


def _time_splits(value_el):
    out = []
    for ts in value_el.findall("podcast:valueTimeSplit", NS):
        start, dur = _float(ts.get("startTime")), _float(ts.get("duration"))
        if start is None or dur is None:
            continue
        remote = ts.find("podcast:remoteItem", NS)
        out.append({
            "start": start,
            "duration": dur,
            # Absent means 100 in the spec: the remote item takes the whole boost.
            "remote_pct": _float(ts.get("remotePercentage")) if ts.get("remotePercentage") else 100.0,
            "feed_guid": remote.get("feedGuid") if remote is not None else None,
            "item_guid": remote.get("itemGuid") if remote is not None else None,
            "feed_url": remote.get("feedUrl") if remote is not None else None,
            "title": remote.get("title") if remote is not None else None,
        })
    out.sort(key=lambda s: s["start"])
    return out


def parse(xml_bytes):
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        raise FeedUnavailable(f"unparseable feed: {e}") from e
    ch = root.find("channel")
    if ch is None:
        raise FeedUnavailable("no <channel>")
    show_value = ch.find("podcast:value", NS)
    feed = {
        "guid": (ch.findtext("podcast:guid", default="", namespaces=NS) or "").strip() or None,
        "title": (ch.findtext("title") or "").strip(),
        "link": (ch.findtext("link") or "").strip() or None,
        "recipients": _recipients(show_value) if show_value is not None else [],
        "items": {},
    }
    for it in ch.findall("item"):
        guid = (it.findtext("guid") or "").strip()
        if not guid:
            continue
        val = it.find("podcast:value", NS)
        feed["items"][guid] = {
            "guid": guid,
            "title": (it.findtext("title") or "").strip(),
            "link": (it.findtext("link") or "").strip() or None,
            # An item with no value block of its own pays the channel's.
            "recipients": _recipients(val) if val is not None else None,
            "splits": _time_splits(val) if val is not None else [],
        }
    return feed


def address_share(recipients, address):
    """The fraction of a boost the value block sends to `address`.

    Fee recipients come off the top as a percentage; the rest is shared in
    proportion to the non-fee splits (the Podcasting 2.0 value spec)."""
    address = (address or "").lower()
    fee_pct = sum(r["split"] for r in recipients if r["fee"])
    shares = [r for r in recipients if not r["fee"]]
    total = sum(r["split"] for r in shares)
    out = 0.0
    for r in recipients:
        if r["address"].lower() != address:
            continue
        if r["fee"]:
            out += r["split"] / 100.0
        elif total:
            out += (1 - fee_pct / 100.0) * r["split"] / total
    return out


def split_at(item, position):
    """The time split playing at `position` seconds, or None (the show talking)."""
    if item is None or position is None:
        return None
    for s in item["splits"]:
        if s["start"] <= position < s["start"] + s["duration"]:
            return s
    return None


def split_for_remote(item, feed_guid, item_guid):
    """The time split naming this remote item, or None. Used when the app sent
    remote_feed_guid/remote_item_guid; a song played twice in one episode
    returns its first play, which is the same song either way."""
    if item is None or not item_guid:
        return None
    for s in item["splits"]:
        if s["item_guid"] == item_guid and (not feed_guid or s["feed_guid"] == feed_guid):
            return s
    return None


def show_share(feed, item, split, address):
    """The fraction of the boost this address receives, given the split playing."""
    recips = (item or {}).get("recipients")
    if recips is None:
        recips = feed["recipients"]
    base = address_share(recips, address)
    if split is not None:
        base *= (100.0 - split["remote_pct"]) / 100.0
    return base


def song_guids(item):
    """Every remote feed guid this episode's splits name, in play order, unique."""
    seen, out = set(), []
    for s in (item or {}).get("splits", []):
        g = s.get("feed_guid")
        if g and g not in seen:
            seen.add(g)
            out.append(g)
    return out
