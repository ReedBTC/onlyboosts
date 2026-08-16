#!/usr/bin/env python3
"""Fountain as a show resolver, for the shows Podcast Index can't identify.

87% of the boosts we index carry a `fountain.fm` item_url, and for the shows our
own pipeline never resolved, that URL is the only handle we have. Two surfaces,
in order of how much we should trust them:

1. **Firestore `podcasts` collection — a real, public, structured API.** Anonymous
   reads with the web client's api key, same door LB's sats-log uses for
   `supporters`. It carries `_guid` (the REAL podcast:guid), `_feed_id`
   (Podcast Index id), and `content.{title,rss,image,publisher}`. Only `podcasts`
   and `supporters` are readable — `episodes`, `shows`, `feeds`, `items` and
   `tracks` all answer PERMISSION_DENIED, which is why an episode id can't be
   turned into a show through Firestore alone.

2. **The episode page's embedded feed URL — scraping, and the fragile half.**
   `fountain.fm/episode/<id>` renders a Next.js RSC payload containing
   `"rss":"<the show's feed url>"`. The RSC framing is a Next internal and will
   break on a Fountain redeploy; treat a parse failure as an ordinary miss.

Why the bridge is the FEED URL rather than the guid: the shows we can't resolve
carry *phantom* podcast_guids (client-minted v5 UUIDs), so neither PI nor
Fountain can be keyed by them — `15ac8ac0-24a7-5690-…` for "No Solutions" where
the real guid is `2ff22ba8-f69b-5067-…`. The feed URL is the one identifier every
side agrees on, so we resolve through it and record the phantom as an alias.
"""

import json
import re

import requests

# The web client's public api key — anonymous read access, same as LB's sats-log.
FIRESTORE_PROJECT = "fountain-fm"
FIRESTORE_API_KEY = "AIzaSyDpQs8iMTAn_Bh4uXKBpJPk91iB1JPDs_w"
FIRESTORE_URL = (
    f"https://firestore.googleapis.com/v1/projects/{FIRESTORE_PROJECT}"
    f"/databases/(default)/documents:runQuery?key={FIRESTORE_API_KEY}"
)
TIMEOUT = 25
PAGE_UA = {"User-Agent": "Mozilla/5.0 (compatible; OnlyBoosts/1.0; +https://onlyboosts.social)"}

_RSC_RE = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', re.S)
_RSS_RE = re.compile(r'"rss":"(https?:[^"]+)"')
_OG_RE = re.compile(r'<meta property="og:([a-z:]+)" content="([^"]*)"')


# ── Firestore `podcasts` ──────────────────────────────────────────────────────
def _scalar(field):
    """Unwrap one Firestore typed value."""
    if not field:
        return None
    for t in ("stringValue", "integerValue", "doubleValue", "booleanValue"):
        if t in field:
            v = field[t]
            return int(v) if t == "integerValue" else v
    return None


def _query_podcasts(field_path, value, limit=1):
    """First matching document's `fields`, or None. Never raises."""
    query = {"structuredQuery": {
        "from": [{"collectionId": "podcasts"}],
        "where": {"fieldFilter": {"field": {"fieldPath": field_path},
                                  "op": "EQUAL",
                                  "value": {"stringValue": value}}},
        "limit": limit}}
    try:
        resp = requests.post(FIRESTORE_URL, json=query, timeout=TIMEOUT)
        resp.raise_for_status()
        for row in resp.json():
            if "document" in row:
                return row["document"].get("fields") or {}
    except Exception:
        return None
    return None


def show_by_feed_url(feed_url):
    """Fountain's record for a feed URL → our shows-table shape, or None.

    `medium` is absent from Fountain's schema, so it is left unset rather than
    guessed — Podcast Index is the better source and the caller tries it first."""
    fields = _query_podcasts("content.rss", feed_url)
    if not fields:
        return None
    content = (fields.get("content", {}).get("mapValue", {}).get("fields", {}))
    guid = _scalar(fields.get("_guid"))
    if not guid:
        return None            # without the real guid this buys us nothing
    image = _scalar(content.get("image"))
    return {
        "podcast_guid": guid,
        "title":     _scalar(content.get("title")),
        "image":     image,
        "artwork":   None,
        "feed_url":  _scalar(content.get("rss")) or feed_url,
        "itunes_id": None,
        "feed_id":   _scalar(fields.get("_feed_id")) or _scalar(fields.get("_podcastindex_id")),
        "medium":    None,
        # Fountain's `publisher` is the same idea as <itunes:author>.
        "author":    (_scalar(content.get("publisher")) or "").strip() or None,
        # Fountain's schema carries no language either. Left unset for the same
        # reason as medium: NULL means "we don't know", and the site must not read
        # an unknown as a language.
        "language":  None,
    }


# ── the episode page (scraping — the fragile half) ────────────────────────────
def fetch_episode_page(episode_url, session=None):
    """An episode/track page's HTML, or None. Fetched once and handed to both
    parsers below — they read different layers of the same document."""
    get = (session or requests).get
    try:
        resp = get(episode_url, headers=PAGE_UA, timeout=TIMEOUT)
        return resp.text if resp.status_code == 200 else None
    except Exception:
        return None


def feed_url_from_page(html):
    """The show's RSS feed URL out of the page's RSC payload, or None.

    The only step with no API behind it. A miss is ordinary — the page may 404,
    or a Fountain redeploy may change the RSC framing."""
    if not html:
        return None
    try:
        blob = "".join(json.loads(c) for c in _RSC_RE.findall(html))
    except Exception:
        return None
    m = _RSS_RE.search(blob)
    if not m:
        return None
    # The RSC stream is JSON-escaped a second time inside each chunk (`&` arrives
    # as &), so decode it AS a JSON string rather than by hand — a URL with
    # non-ASCII in it must survive intact.
    try:
        return json.loads(f'"{m.group(1)}"')
    except Exception:
        return m.group(1).replace("\\u0026", "&")


def og_from_page(html):
    """`og:` tags off an episode page: {title, image, audio, show_title, ...}.

    Far more stable than the RSC payload, but it carries no feed URL — this is
    the last-resort shape for an episode whose feed we can never reach."""
    if not html:
        return {}
    og = dict(_OG_RE.findall(html))
    # og:title is "<Show> • <Episode title> • Listen on Fountain"
    parts = [p.strip() for p in (og.get("title") or "").split("•")]
    if len(parts) >= 3:
        og["show_title"], og["episode_title"] = parts[0], parts[1]
    return og
