"""Shared pieces for the filter-rule probes. See README.md in this directory.

Everything here is READ-ONLY against relays and the box index. Nothing signs,
publishes, or writes to data/onlyboosts.db.
"""
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCAN = HERE.parent
sys.path.insert(0, str(SCAN))
sys.path.insert(0, str(SCAN.parent / "shared"))

import bech32                                                   # noqa: E402
from classify import (classify_boost, decode_note_or_nevent, _QUOTE_RE,   # noqa: E402
                      _BECH32_CHARSET, BOOST_TOPIC_TAGS, parse_content_sats)
from clients import PUBLISHER_PUBKEYS                           # noqa: E402
from relays import CORE_RELAYS, RECEIPT_RELAYS                  # noqa: E402

INDEX_DB = SCAN / "data" / "onlyboosts.db"
PROBE_DIR = SCAN / "data" / "probes"
CAND_DB = PROBE_DIR / "candidates.db"
CORPUS_FLOOR = 1719792000          # 2024-07-01, the index's own floor

# BoostMeBitch's two relays we do not scan, plus LB's own relay where its
# publisher writes. Probed alongside the core set so a relay-coverage gap is
# separable from a rule gap.
EXTRA_RELAYS = [
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://relay.mynostr.app",
]
PROBE_RELAYS = list(dict.fromkeys(CORE_RELAYS + EXTRA_RELAYS))

BOOST_T = sorted(BOOST_TOPIC_TAGS)
_SATS_WORD = re.compile(r"\bsats?\b", re.IGNORECASE)
_URL = re.compile(r"https?://\S+")
_FOUNTAIN_URL = re.compile(r"https?://fountain\.fm/(episode|show)/([A-Za-z0-9]+)")


def open_cand(path=CAND_DB):
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path), check_same_thread=False)
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript("""
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, pubkey TEXT, kind INTEGER, created_at INTEGER,
        json TEXT NOT NULL, shapes TEXT NOT NULL DEFAULT '', relays TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS ix_ev_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS ix_ev_pub ON events(pubkey);
    CREATE TABLE IF NOT EXISTS refs (
        id TEXT PRIMARY KEY, json TEXT, kind INTEGER, tried TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS checkpoints (
        relay TEXT, shape TEXT, cursor INTEGER, oldest INTEGER, done INTEGER DEFAULT 0,
        pages INTEGER DEFAULT 0, kept INTEGER DEFAULT 0, seen INTEGER DEFAULT 0,
        updated INTEGER, PRIMARY KEY (relay, shape));
    CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v INTEGER);
    """)
    return c


def open_index():
    return sqlite3.connect(f"file:{INDEX_DB}?mode=ro", uri=True, check_same_thread=False)


def tags(ev, name):
    return [t for t in ev.get("tags") or [] if len(t) >= 2 and t[0] == name]


def podcast_itags(ev):
    return [t for t in tags(ev, "i") if str(t[1]).startswith("podcast:")]


def nip73_guids(ev):
    """(podcast_guid, item_guid) off the lowercase i tags, or the uppercase
    NIP-22 I tags for a kind-1111 comment."""
    show = item = None
    for name in ("i", "I"):
        for t in tags(ev, name):
            v = str(t[1])
            if v.startswith("podcast:item:guid:"):
                item = item or v[len("podcast:item:guid:"):]
            elif v.startswith("podcast:guid:"):
                show = show or v[len("podcast:guid:"):]
    return show, item


def has_boost_t(ev):
    return any(t[1] in BOOST_TOPIC_TAGS for t in tags(ev, "t"))


def amount_tag(ev):
    for t in tags(ev, "amount"):
        try:
            v = int(t[1])
            if v > 0:
                return v
        except Exception:
            pass
    return None


def quote_ids(ev):
    """Every event id a note points at: e/q tags and note1/nevent1 in content."""
    ids = []
    for t in ev.get("tags") or []:
        if len(t) >= 2 and t[0] in ("q", "e") and isinstance(t[1], str) and len(t[1]) == 64:
            ids.append(t[1])
    for m in _QUOTE_RE.finditer(ev.get("content") or ""):
        eid = decode_note_or_nevent(m.group(1))
        if eid:
            ids.append(eid)
    return list(dict.fromkeys(ids))


def nevent_relay_hints(ev):
    """Relay hints (TLV type 1) carried by any nevent1 the note quotes."""
    hints = []
    for m in _QUOTE_RE.finditer(ev.get("content") or ""):
        s = m.group(1).lower()
        if not s.startswith("nevent1"):
            continue
        try:
            five = [_BECH32_CHARSET.find(c) for c in s[s.rfind("1") + 1:]]
            data = bech32.convertbits(five[:-6], 5, 8, False)
            i = 0
            while i + 1 < len(data):
                t, ln = data[i], data[i + 1]
                if t == 1:
                    hints.append(bytes(data[i + 2:i + 2 + ln]).decode("utf-8", "ignore"))
                i += 2 + ln
        except Exception:
            pass
    for t in ev.get("tags") or []:
        if len(t) >= 3 and t[0] in ("e", "q") and isinstance(t[2], str) and t[2].startswith("ws"):
            hints.append(t[2])
    return [h.rstrip("/") for h in hints if h.startswith("wss://")]


def is_publisher(ev):
    return PUBLISHER_PUBKEYS.get(ev.get("pubkey"))


def worth_keeping(ev):
    """The harvest's keep rule — deliberately WIDER than the classifier, so the
    experiments can ask what each loosening would admit. Returns a reason or
    None. Kind 1111 comments are kept whenever they name a podcast."""
    if ev.get("kind") == 1111:
        return "k1111" if nip73_guids(ev) != (None, None) else None
    if ev.get("kind") != 1:
        return None
    if podcast_itags(ev):
        return "itag"
    if has_boost_t(ev):
        return "ttag"
    if amount_tag(ev):
        return "amount"
    if tags(ev, "zap"):
        return "zaptag"
    if is_publisher(ev):
        return "publisher"
    c = ev.get("content") or ""
    if _SATS_WORD.search(c) and _FOUNTAIN_URL.search(c):
        return "sats+fountainurl"
    return None


def fountain_urls(ev):
    return [m.group(0) for m in _FOUNTAIN_URL.finditer(ev.get("content") or "")]


def app_fingerprint(ev):
    """Best-effort app name for a breakdown: client tag, publisher key, the
    '📱 via X' line, or a domain in the text. Never used for attribution."""
    c = next((t[1] for t in tags(ev, "client")), None)
    if c:
        return f"client:{c}"
    p = is_publisher(ev)
    if p:
        return f"publisher:{p}"
    m = re.search("\N{MOBILE PHONE}\\s*via\\s+(.+?)\\s*(?:\\n|$)", ev.get("content") or "")
    if m:
        return f"via:{m.group(1).strip()[:30]}"
    for t in tags(ev, "i"):
        if len(t) >= 3 and t[2]:
            m = re.match(r"https?://([^/]+)", t[2])
            if m:
                return f"iurl:{m.group(1)}"
    for m in _URL.finditer(ev.get("content") or ""):
        host = re.match(r"https?://([^/]+)", m.group(0)).group(1)
        if host not in ("fountain.fm",):
            return f"url:{host}"
        return "url:fountain.fm"
    return "none"


def current_verdict(ev, refs):
    """Run the SHIPPED classifier with the receipts the probe has resolved.
    refs: {id: event|None}."""
    cache = dict(refs)
    return classify_boost(ev, cache, receipt_fetch=lambda cid: cache.get(cid))


def ym(ts):
    return time.strftime("%Y-%m", time.gmtime(ts))


def load_json(s):
    return json.loads(s)
