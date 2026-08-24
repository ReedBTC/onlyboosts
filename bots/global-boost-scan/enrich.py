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


def _normalize_language(raw):
    """RSS channel <language> → primary subtag, lowercased. None when absent.

    The region is deliberately dropped: measured over all 943 titled shows in the
    index, 36 distinct raw tags describe ~21 languages — 'en', 'en-us', 'en-US',
    'en-gb', 'en-au' are one language and five filter entries, and the case varies
    by publisher. A reader filtering for German wants Einundzwanzig whether the feed
    says 'de' or 'de-de'. Anything that isn't a plausible subtag (2-3 alpha, per
    ISO 639) is dropped rather than stored — a junk value would become a junk
    filter option, and NULL already means "not declared".
    """
    tag = (raw or "").strip().lower()
    if not tag:
        return None
    primary = re.split(r"[-_]", tag, 1)[0]
    return primary if re.fullmatch(r"[a-z]{2,3}", primary) else None


def _show_from_feed(feed, podcast_guid=None):
    """Normalize a Podcast Index `feed` object into our shows-table shape. When
    `podcast_guid` is omitted it's taken from the feed's own podcastGuid (used when
    we looked the feed up by id/url and are learning its real guid)."""
    if not feed:
        return None
    guid = podcast_guid or feed.get("podcastGuid")
    if not guid:
        return None
    # PI maps RSS channel <image><url> to `image` and <itunes:image> to `artwork`.
    # Prefer `image` but keep `artwork` as a distinct second-chance URL: some feeds
    # (e.g. Homegrown Hits) list a rotted <image> alongside a live <itunes:image>,
    # so the site's <img> can fall back on a 404 instead of showing nothing. Only
    # carried when it actually differs from the chosen primary.
    image = feed.get("image") or feed.get("artwork")
    artwork = feed.get("artwork")
    return {
        "podcast_guid": guid,
        "title":     feed.get("title"),
        "image":     image,
        "artwork":   artwork if (artwork and artwork != image) else None,
        "feed_url":  feed.get("url"),
        "itunes_id": feed.get("itunesId"),
        "feed_id":   feed.get("id"),
        "medium":    feed.get("medium") or "podcast",
        # <itunes:author>: the artist on music feeds, a weak "by" line on podcasts.
        # Raw, un-filtered — the site decides whether it's worth showing (hidden when
        # it just repeats the title). NOT a podcast:person credit; PI exposes no
        # channel-level person data, and it's present on only ~6% of feeds anyway.
        "author":    (feed.get("author") or "").strip() or None,
        # RSS channel <language>, normalized to the primary subtag. Rides the
        # byguid call we already make, so it costs no extra request. Coverage is
        # split hard by medium — 99% of podcasts, 48% of music, because Wavlake
        # (198 of the 251 music misses) publishes no <language> at all.
        "language":  _normalize_language(feed.get("language")),
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
            # PI's `duration: 0` is faithful reporting of a feed that declares
            # none — db.upsert_episode refuses to let it erase a derived one.
            "duration_src":   "pi" if ep.get("duration") else None,
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


# ── raw-RSS fallback ──────────────────────────────────────────────────────────
# Podcast Index is not the whole truth. Three ways an episode we hold boosts for
# is absent from its API but present in the publisher's feed (measured
# 2026-08-04 over the 432 unenriched episodes):
#   * <podcast:liveItem> — a live show. PI's episodes API never indexes these,
#     and they are the richest per-episode boosts we have.
#   * PI simply hasn't indexed the item yet, mostly within a week of publication.
#   * the item aged out of the feed's rolling window before PI (or we) caught it
#     — unfixable after the fact, which is why this runs at scan time rather
#     than waiting on the 7-day retry cooldown.
# A bare-guid PI lookup does NOT substitute (0 hits / 12 tried): it needs feed
# context, so this path is only reachable when we know the show's feed_url.
#
# Regex parsing, deliberately — same call as podroll.py: feeds in the wild are
# too often malformed for a strict XML parser, and we want the one item we can
# match rather than an exception over the whole document.
FEED_CAP_BYTES = 8_000_000     # full item list, not just the channel header
FEED_TIMEOUT = 25
FEED_UA = {"User-Agent": "OnlyBoosts/1.0 (+https://onlyboosts.social; episode enrichment)"}

# <item> and <podcast:liveItem> both hold an episode; the namespace prefix is the
# feed's to choose, so match any.
_ITEM_BLOCK_RE = re.compile(
    r"<(?:[a-zA-Z0-9]+:)?(item|liveItem)\b([^>]*)>(.*?)</(?:[a-zA-Z0-9]+:)?\1>", re.S | re.I)
_CDATA_RE = re.compile(r"^\s*<!\[CDATA\[(.*?)\]\]>\s*$", re.S)


def _tag(block, name):
    """Text of the first <name> in `block`, CDATA unwrapped. Any ns prefix.

    Ordinary text content is entity-decoded (`&#8211;` → `–`), CDATA is not —
    CDATA is literal by definition, and decoding it would corrupt any feed that
    wraps real markup in it."""
    m = re.search(rf"<(?:[a-zA-Z0-9]+:)?{name}\b[^>]*>(.*?)</(?:[a-zA-Z0-9]+:)?{name}>",
                  block, re.S | re.I)
    if not m:
        return None
    val = m.group(1)
    cd = _CDATA_RE.match(val)
    val = cd.group(1) if cd else html.unescape(val)
    return val.strip() or None


def _attr(block, tag_name, *attrs):
    """First matching attribute value off a self-closing-ish tag (e.g. enclosure)."""
    m = re.search(rf"<(?:[a-zA-Z0-9]+:)?{tag_name}\b([^>]*)>", block, re.I)
    if not m:
        return None
    found = dict((k.split(":")[-1].lower(), v)
                 for k, v in re.findall(r'([\w:]+)\s*=\s*"([^"]*)"', m.group(1)))
    for a in attrs:
        if found.get(a):
            return found[a]
    return None


def _parse_int(raw):
    raw = (raw or "").strip()
    return int(raw) if raw.isdigit() else None


def _parse_duration(raw):
    """<itunes:duration> is either seconds or [HH:]MM:SS."""
    if not raw:
        return None
    raw = raw.strip()
    if raw.isdigit():
        return int(raw)
    parts = raw.split(":")
    try:
        parts = [int(p) for p in parts]
    except ValueError:
        return None
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs or None


def _parse_pubdate(raw):
    if not raw:
        return None
    try:
        from email.utils import parsedate_to_datetime
        return int(parsedate_to_datetime(raw).timestamp())
    except Exception:
        return None


def _parse_iso8601(raw):
    """A <podcast:liveItem>'s `start` attribute — its stand-in for pubDate."""
    if not raw:
        return None
    try:
        import datetime
        return int(datetime.datetime.fromisoformat(
            raw.strip().replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def parse_feed_episodes(xml):
    """{guid: episode-dict} for every <item>/<liveItem> in `xml` that has a guid.

    Fields mirror resolve_episode's shape so both paths feed db.upsert_episode
    identically — except podcast_guid/feed_id, which the caller supplies from the
    show we already resolved (a feed's items don't restate them)."""
    out = {}
    for kind, attrs, block in _ITEM_BLOCK_RE.findall(xml):
        guid = _tag(block, "guid")
        if not guid:
            continue
        live = kind.lower() == "liveitem"
        live_attrs = (dict((k.split(":")[-1].lower(), v)
                           for k, v in re.findall(r'([\w:]+)\s*=\s*"([^"]*)"', attrs))
                      if live else {})
        # A live item carries no <pubDate>; its `start` attribute is the airing.
        published = _parse_pubdate(_tag(block, "pubDate"))
        if published is None and live:
            published = _parse_iso8601(live_attrs.get("start"))
        # A live item's enclosure is the stream; some feeds spell the attribute
        # `uri` (podcast:alternateEnclosure's spelling) rather than `url`.
        # Duration ladder: the publisher's <itunes:duration> wins; failing that,
        # an ENDED liveItem's scheduled window (end - start) stands in. Gated on
        # status="ended" — crediting listening hours for a stream that has not
        # happened yet is worse than counting nothing — and it is the SCHEDULED
        # window, the publisher's own claim, same standard as the rest of the
        # pipeline. A pending/live item gets no duration at all.
        duration = _parse_duration(_tag(block, "duration"))
        duration_src = "rss" if duration else None
        if not duration and live and (live_attrs.get("status") or "").lower() == "ended":
            l_start = _parse_iso8601(live_attrs.get("start"))
            l_end = _parse_iso8601(live_attrs.get("end"))
            if l_start and l_end and l_end > l_start:
                duration, duration_src = l_end - l_start, "live"
        out[guid] = {
            "item_guid":      guid,
            "title":          _tag(block, "title"),
            "image":          _attr(block, "image", "href") or _tag(block, "image"),
            "published":      published,
            "duration":       duration,
            "duration_src":   duration_src,
            "episode_number": _parse_int(_tag(block, "episode")),
            "enclosure_url":  _attr(block, "enclosure", "url", "uri"),
            "enclosure_type": _attr(block, "enclosure", "type"),
            "description":    clean_html(_tag(block, "encoded") or _tag(block, "description")),
            "is_live":        live,
        }
    return out


def fetch_feed(url, session=None):
    """Feed body as text, or None on any failure. Never raises — a dead feed is
    an ordinary outcome here (51 of the 432 unenriched episodes sit behind one)."""
    get = (session or requests).get
    try:
        resp = get(url, headers=FEED_UA, timeout=FEED_TIMEOUT, stream=True)
        try:
            if resp.status_code != 200:
                return None
            parts, n = [], 0
            for chunk in resp.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                parts.append(chunk.decode("utf-8", "replace")
                             if isinstance(chunk, bytes) else chunk)
                n += len(parts[-1])
                if n >= FEED_CAP_BYTES:
                    break
            return "".join(parts)
        finally:
            resp.close()
    except Exception:
        return None


def resolve_episodes_from_feeds(pending, log=print):
    """pending: {feed_url: [{item_guid, podcast_guid, feed_id, show_image}, ...]}
    Returns {item_guid: episode-dict} for whatever the feeds actually contain.

    One fetch per feed however many episodes we're chasing in it — the whole
    point of batching the fallback after the PI loop rather than per-episode."""
    resolved = {}
    session = requests.Session()
    for i, (feed_url, wanted) in enumerate(pending.items(), 1):
        xml = fetch_feed(feed_url, session)
        if xml is None:
            log(f"    rss: [{i}/{len(pending)}] unreachable, {len(wanted)} episode(s) left: {feed_url}")
            continue
        episodes = parse_feed_episodes(xml)
        hits = 0
        for want in wanted:
            info = episodes.get(want["item_guid"])
            if not info:
                continue
            info = dict(info)
            live = info.pop("is_live")
            info["podcast_guid"] = want["podcast_guid"]
            info["feed_id"] = want["feed_id"]
            # Plenty of items carry no art of their own; PI's episode object
            # falls back to feedImage, so do the same rather than ship a
            # picture-less card.
            info["image"] = info["image"] or want.get("show_image")
            resolved[want["item_guid"]] = info
            hits += 1
            if live:
                log(f"    rss: recovered LIVE item {want['item_guid']} — {info['title']!r}")
        if hits:
            log(f"    rss: [{i}/{len(pending)}] {hits}/{len(wanted)} recovered from {feed_url}")
    return resolved


# ── kind-0 profiles ───────────────────────────────────────────────────────────
# The fields we read out of a kind-0. `event_at` rides alongside them but is not
# one of them — see resolve_profiles.
PROFILE_CONTENT_FIELDS = ("name", "display_name", "picture", "nip05",
                          "about", "lud16", "lud06", "website", "banner")


def _profile_from_content(content):
    """kind-0 content JSON → the columns we store.

    `lud16` and `lud06` are kept SEPARATE rather than coalesced into one
    "lightning address". They are different types — lud16 is an addressable
    user@host, lud06 a bech32 LNURL blob — and they render differently: one is
    copyable text a reader can paste into a wallet, the other is a QR/scan
    payload. Collapsing them would force every consumer to re-derive which it
    got by sniffing the string shape, which is exactly the branch we'd be
    hiding rather than removing."""
    return {
        "name":         content.get("name"),
        "display_name": content.get("display_name") or content.get("displayName"),
        "picture":      content.get("picture"),
        "nip05":        content.get("nip05"),
        "about":        content.get("about"),
        "lud16":        content.get("lud16"),
        "lud06":        content.get("lud06"),
        "website":      content.get("website"),
        "banner":       content.get("banner"),
    }


def resolve_profiles(pubkey_hexes, relays, batch_size=100, log=print):
    """Fetch newest kind-0 per pubkey across `relays`. Returns {pubkey: profile}.
    Profile fields are taken from the kind-0 content JSON — see
    `_profile_from_content` for the set.

    ⚠️ A profile that parses to NOTHING is dropped rather than returned. This
    only became load-bearing when profiles started being RE-fetched (see
    db.pubkeys_needing_profile): on a first fetch an all-null profile costs
    nothing, but on a refresh it would overwrite a good stored row with nulls
    because a relay served a kind-0 with an unparseable content field. A
    profile we failed to read is not a profile that went blank.

    Each returned profile carries `event_at`, the kind-0's own `created_at`, so
    the write side can refuse to move BACKWARDS — see db.upsert_profile. That
    matters because this reads across five relays and takes the newest of
    whatever answered: when one is down, "newest reachable" can be older than
    what we already stored. Measured on the first backfill sweep, with
    relay.damus.io 503ing throughout, four fields came back net-negative across
    the corpus (display_name 1778→1772, nip05 1304→1300). Once per 30 days
    forever, that ratchets."""
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
                    newest[pk] = (ca, {**_profile_from_content(content),
                                       "event_at": ca})
        log(f"    profiles: batch {bi}/{len(batches)} — {len(newest)} resolved so far")
    # Empty-parse guard, see the docstring: an all-null profile is a failed read,
    # and the caller negative-caches it rather than storing the blank. Checked
    # against the content fields only — `event_at` is always set and would make
    # every empty parse look like a result.
    return {pk: prof for pk, (_, prof) in newest.items()
            if any(prof[f] for f in PROFILE_CONTENT_FIELDS)}
