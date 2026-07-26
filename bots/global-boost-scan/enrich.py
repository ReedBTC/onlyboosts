#!/usr/bin/env python3
"""Enrichment pass: Podcast Index show/episode metadata + kind-0 booster profiles.

Runs after the scan has stored boosts. Each distinct show guid, episode guid, and
booster pubkey is resolved once and cached in SQLite; re-runs only fill gaps.
Shownotes are stored in FULL (HTML stripped to plain text, but not length-capped
— OnlyBoosts wants the complete notes; truncation is a render-time concern).
"""

import hashlib
import html
import json
import re
import time

import requests

from collector_common import query_relay

PODCAST_INDEX_BASE = "https://api.podcastindex.org/api/1.0"
_HTML_TAG_RE = re.compile(r"<[^>]+>")


# ── Podcast Index ─────────────────────────────────────────────────────────────
def pi_headers(key, secret):
    epoch = str(int(time.time()))
    auth = hashlib.sha1((key + secret + epoch).encode()).hexdigest()
    return {"X-Auth-Date": epoch, "X-Auth-Key": key, "Authorization": auth,
            "User-Agent": "OnlyBoosts-GlobalScan/1.0"}


def pi_get(path, params, key, secret):
    r = requests.get(f"{PODCAST_INDEX_BASE}/{path}", params=params,
                     headers=pi_headers(key, secret), timeout=15)
    r.raise_for_status()
    return r.json()


def clean_html(raw):
    """HTML → plain text (tags to spaces, entities unescaped). NOT length-capped."""
    if not raw:
        return None
    text = _HTML_TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def _show_from_feed(feed, podcast_guid=None):
    """Normalize a Podcast Index `feed` object into our shows-table shape. When
    `podcast_guid` is omitted it's taken from the feed's own podcastGuid (used when
    we looked the feed up by id/url and are learning its real guid)."""
    if not feed:
        return None
    guid = podcast_guid or feed.get("podcastGuid")
    if not guid:
        return None
    return {
        "podcast_guid": guid,
        "title":     feed.get("title"),
        "image":     feed.get("image") or feed.get("artwork"),
        "feed_url":  feed.get("url"),
        "itunes_id": feed.get("itunesId"),
        "feed_id":   feed.get("id"),
        "medium":    feed.get("medium") or "podcast",
    }


def resolve_show(podcast_guid, key, secret):
    try:
        feed = (pi_get("podcasts/byguid", {"guid": podcast_guid}, key, secret)
                .get("feed") or {})
        return _show_from_feed(feed, podcast_guid)
    except Exception as e:
        print(f"  [warn] PI show lookup failed for {podcast_guid}: {e}")
        return None


def resolve_feed_by_id(feed_id, key, secret):
    """Resolve a Podcast Index feed id → our shows-table dict (its real podcastGuid
    included). For phantom guids that are actually PI feed ids."""
    try:
        feed = (pi_get("podcasts/byfeedid", {"id": feed_id}, key, secret)
                .get("feed") or {})
        return _show_from_feed(feed)
    except Exception as e:
        print(f"  [warn] PI byfeedid lookup failed for {feed_id}: {e}")
        return None


def resolve_feed_by_url(feed_url, key, secret):
    """Resolve a feed URL → our shows-table dict (its real podcastGuid included)."""
    try:
        feed = (pi_get("podcasts/byfeedurl", {"url": feed_url}, key, secret)
                .get("feed") or {})
        return _show_from_feed(feed)
    except Exception as e:
        print(f"  [warn] PI byfeedurl lookup failed for {feed_url}: {e}")
        return None


def resolve_episode(item_guid, feed_id, key, secret):
    try:
        params = {"guid": item_guid}
        if feed_id:
            params["feedid"] = feed_id
        ep = (pi_get("episodes/byguid", params, key, secret).get("episode") or {})
        if not ep or not ep.get("id"):
            return None
        return {
            "item_guid":      item_guid,
            "title":          ep.get("title"),
            "image":          ep.get("image") or ep.get("feedImage"),
            "published":      ep.get("datePublished"),
            "duration":       ep.get("duration"),
            "episode_number": ep.get("episode"),
            "podcast_guid":   ep.get("podcastGuid") or None,
            "feed_id":        ep.get("feedId"),
            "enclosure_url":  ep.get("enclosureUrl"),
            "enclosure_type": ep.get("enclosureType"),
            "description":    clean_html(ep.get("description")),   # FULL shownotes
        }
    except Exception as e:
        print(f"  [warn] PI episode lookup failed for {item_guid}: {e}")
        return None


# ── kind-0 profiles ───────────────────────────────────────────────────────────
def resolve_profiles(pubkey_hexes, relays, batch_size=100, log=print):
    """Fetch newest kind-0 per pubkey across `relays`. Returns {pubkey: profile}.
    Profile fields taken from the kind-0 content JSON (name/display_name/
    picture/nip05)."""
    newest = {}   # pubkey -> (created_at, parsed_profile)
    batches = [pubkey_hexes[i:i + batch_size]
               for i in range(0, len(pubkey_hexes), batch_size)]
    for bi, batch in enumerate(batches, 1):
        filt = {"kinds": [0], "authors": batch}
        for relay in relays:
            for ev in query_relay(relay, filt, max_wall_seconds=30):
                pk = ev.get("pubkey")
                ca = ev.get("created_at", 0)
                if not pk:
                    continue
                if pk not in newest or ca > newest[pk][0]:
                    try:
                        content = json.loads(ev.get("content") or "{}")
                    except Exception:
                        content = {}
                    newest[pk] = (ca, {
                        "name":         content.get("name"),
                        "display_name": content.get("display_name") or content.get("displayName"),
                        "picture":      content.get("picture"),
                        "nip05":        content.get("nip05"),
                    })
        log(f"    profiles: batch {bi}/{len(batches)} — {len(newest)} resolved so far")
    return {pk: prof for pk, (_, prof) in newest.items()}
