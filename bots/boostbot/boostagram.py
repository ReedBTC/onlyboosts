"""One shape for a boostagram, whichever channel it arrived by.

Two channels reach the wallet:

  keysend   the TLV record (7629169), which Alby Hub decodes onto the
            transaction as `boostagram`.
  lnaddress the invoice memo `rss::payment::boost <url> [message]`. The URL
            answers with an `x-rss-payment` header carrying the same bLIP-10
            JSON a keysend TLV would (the Helipad convention). Fountain serves
            it on its `?payment=` links, with the total, the playback position,
            the episode and any remote item; the OnlyBoosts site serves it from
            BoostBox. Measured 2026-11-22 on a live Fountain boost.

Field names vary by app, so every read below tries the known spellings. A
value an app could not resolve arrives as a placeholder ("0", "undefined"),
which is treated as absent.
"""
import json
import re
import urllib.parse
from datetime import datetime

import requests

DESCRIPTOR_TIMEOUT = 10
MAX_HEADER_CHARS = 16 * 1024

_JUNK = {"", "0", "00", "000", "-", "--", "n/a", "na", "none", "null", "undefined", "unknown"}
_DESC_RE = re.compile(r"^rss::payment::(\w+)\s+(https://\S+?)(?:\s+(.*))?$", re.DOTALL)


def _clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return None if s.lower() in _JUNK else s


def _first(d, *keys):
    for k in keys:
        v = _clean(d.get(k))
        if v is not None:
            return v
    return None


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _position(d):
    """Seconds into the episode. bLIP-10 calls it `ts`; Fountain `position`;
    some apps send `time` as H:MM:SS."""
    for k in ("position", "ts"):
        v = d.get(k)
        if v not in (None, ""):
            try:
                f = float(v)
                if f >= 0:
                    return f
            except (TypeError, ValueError):
                pass
    t = _clean(d.get("time"))
    if t and re.fullmatch(r"\d{1,2}(:\d{2}){1,2}", t):
        secs = 0
        for part in t.split(":"):
            secs = secs * 60 + int(part)
        return float(secs)
    return None


def normalize(d, channel):
    """The fields this bot reads, from a keysend TLV or an x-rss-payment JSON."""
    return {
        "channel": channel,
        "action": (_first(d, "action") or "").lower(),
        "feed_guid": _first(d, "feed_guid", "guid", "feedGuid", "podcastGuid"),
        "feed_id": _first(d, "feedID", "feedId", "feed_id"),
        "feed_url": _first(d, "url", "feed_url"),
        "feed_title": _first(d, "feed_title", "podcast"),
        "item_guid": _first(d, "item_guid", "episode_guid", "episodeGuid", "itemGuid"),
        "item_title": _first(d, "item_title", "episode"),
        "remote_feed_guid": _first(d, "remote_feed_guid", "remoteFeedGuid"),
        "remote_item_guid": _first(d, "remote_item_guid", "remoteItemGuid"),
        "position": _position(d),
        "value_msat": _int(d.get("value_msat")),
        "value_msat_total": _int(_first(d, "value_msat_total", "valueMsatTotal")),
        "message": (d.get("message") or "").strip(),
        "app_name": _first(d, "app_name", "appName"),
        "sender_name": _first(d, "sender_name", "senderName"),
        "sender_npub": _first(d, "sender_npub", "senderNpub"),
        "sender_pubkey": _first(d, "senderPubkey", "sender_pub_key", "pubkey"),
        "recipient_address": _first(d, "recipient_address", "recipientAddress"),
        "link": _first(d, "link", "boost_link", "boostLink"),
        # One boost, several legs: every leg shares this. A note is per boost.
        "group": _first(d, "group", "boost_uuid", "uuid"),
    }


def parse_description(desc):
    """{'action', 'url', 'message'} for an rss::payment:: memo, else None."""
    m = _DESC_RE.match((desc or "").strip())
    if not m:
        return None
    return {"action": m.group(1).lower(), "url": m.group(2), "message": (m.group(3) or "").strip()}


def fetch_descriptor(url, timeout=DESCRIPTOR_TIMEOUT):
    """The x-rss-payment JSON behind a boost URL, or None.

    HEAD first (Fountain and BoostBox both answer it); GET only when HEAD
    carries no header, and then only the headers are read."""
    for method in ("HEAD", "GET"):
        try:
            r = requests.request(method, url, timeout=timeout, allow_redirects=True, stream=True,
                                 headers={"User-Agent": "onlyboosts-socialhour/1.0 (+https://onlyboosts.social)"})
            raw = r.headers.get("x-rss-payment")
            r.close()
        except requests.RequestException:
            continue
        if not raw or len(raw) > MAX_HEADER_CHARS:
            continue
        try:
            data = json.loads(urllib.parse.unquote(raw))
        except ValueError:
            continue
        if isinstance(data, dict):
            return data
    return None


def settled_ts(settled_at):
    try:
        return int(datetime.fromisoformat((settled_at or "").replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None
