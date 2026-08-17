#!/usr/bin/env python3
"""Boost classification for OnlyBoosts.

Ported from the Local Bitcoiners community-scan boost pipeline
(bots/community-scan/boost_pipeline.py). Same detection rules — a kind-1 note is
a boost if it carries a NIP-73 podcast identifier AND evidence of a payment
(amount tag, boostagram/value4value `t` tag, or a quoted kind-9735 zap receipt).

Two deliberate differences from LB, because OnlyBoosts is global, not one show:
  • INCLUDE_SHOW_LEVEL — LB drops show-level-only boosts (no episode guid);
    OnlyBoosts keeps them (item_guid stays None, still grouped by podcast_guid).
  • EXCLUDE_FEED_GUIDS — LB excludes its own feed; OnlyBoosts excludes nothing.
"""

import re

import bech32

from nostr_utils import hex_to_npub

import clients

# ── OnlyBoosts scope toggles ──────────────────────────────────────────────────
INCLUDE_SHOW_LEVEL = True        # keep boosts that only name the show, no episode
EXCLUDE_FEED_GUIDS = frozenset() # feed guids to drop (empty = keep everything)

_BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_QUOTE_RE = re.compile(
    r'(?:nostr:)?(?<!\w)(note1[02-9ac-hj-np-z]+|nevent1[02-9ac-hj-np-z]+)',
    re.IGNORECASE)

# Topic tags that signal a note is a boost. `boost` is here for clients (e.g. the
# localbitcoiners.com website widget) that tag t=boost rather than t=boostagram.
BOOST_TOPIC_TAGS = {"boostagram", "value4value", "boost"}

# Some clients put the sats amount only in the note text (no amount tag, no zap
# receipt). Prefer a number sitting next to "boost"/⚡; fall back to any "N sats".
_SATS_NEAR = re.compile(r'(?:boost\w*|⚡)[^\d]{0,6}([\d][\d,]{0,15})\s*sats', re.IGNORECASE)
_SATS_ANY = re.compile(r'([\d][\d,]{0,15})\s*sats\b', re.IGNORECASE)


def parse_content_sats(content):
    """Best-effort integer sats parsed from a boost note's text, or None."""
    if not content:
        return None
    for rx in (_SATS_NEAR, _SATS_ANY):
        m = rx.search(content)
        if m:
            try:
                v = int(m.group(1).replace(",", ""))
                if v > 0:
                    return v
            except ValueError:
                pass
    return None


# ── Fountain trailer stripping (copied verbatim from boost_formatter) ─────────
_FOUNTAIN_TRAILER_RE = re.compile(
    r'\s*https?://fountain\.fm/episode/\S+\s+(?:nostr:)?'
    r'(nevent1[02-9ac-hj-np-z]+)\s*$')


def _nevent_kind(entity):
    """Kind TLV (type 3) of an nevent1... bech32 string, or None."""
    try:
        s = entity.lower()
        if not s.startswith("nevent1"):
            return None
        five = [_BECH32_CHARSET.find(c) for c in s[s.rfind("1") + 1:]]
        if any(v < 0 for v in five):
            return None
        tlv = bech32.convertbits(five[:-6], 5, 8, False)
        if tlv is None:
            return None
        i = 0
        while i + 1 < len(tlv):
            t, ln = tlv[i], tlv[i + 1]
            if t == 3:
                return int.from_bytes(bytes(tlv[i + 2:i + 2 + ln]), "big")
            i += 2 + ln
    except Exception:
        return None
    return None


def strip_fountain_trailer(message):
    """Remove Fountain's auto-appended episode-link + zap-receipt trailer. No-op
    unless the trailing nevent is a kind-9735 receipt, so donor-authored content
    (which may include their own nostr: mentions and URLs) is left verbatim."""
    if not message:
        return message
    m = _FOUNTAIN_TRAILER_RE.search(message)
    if not m or _nevent_kind(m.group(1)) != 9735:
        return message
    return message[:m.start()].rstrip()


# ── quote-ref decoding + bolt11 amount fallback ──────────────────────────────
def decode_note_or_nevent(token):
    """Decode a bare note1.../nevent1... to its 32-byte event id (hex), or None."""
    s = token.lower()
    if s.startswith("note1"):
        is_note = True
    elif s.startswith("nevent1"):
        is_note = False
    else:
        return None
    five = [_BECH32_CHARSET.find(c) for c in s[s.rfind("1") + 1:]]
    if len(five) < 7 or any(v < 0 for v in five):
        return None
    data = bech32.convertbits(five[:-6], 5, 8, False)
    if data is None:
        return None
    if is_note:
        return bytes(data).hex() if len(data) == 32 else None
    i = 0
    while i + 1 < len(data):
        t, ln = data[i], data[i + 1]
        val = bytes(data[i + 2:i + 2 + ln])
        if t == 0 and len(val) == 32:
            return val.hex()
        i += 2 + ln
    return None


_BOLT11_RE = re.compile(r'^ln(?:bc|tb)(\d+)([munp]?)', re.IGNORECASE)
_BOLT11_MULT = {"": 1, "m": 1e-3, "u": 1e-6, "n": 1e-9, "p": 1e-12}


def bolt11_amount_msats(bolt11):
    m = _BOLT11_RE.match((bolt11 or "").strip())
    if not m:
        return None
    amount, unit = m.group(1), m.group(2).lower()
    btc = int(amount) * _BOLT11_MULT.get(unit, 1)
    return round(btc * 1e11)


def resolve_zap_amount(receipt_event):
    tags = {t[0]: t[1] for t in receipt_event.get("tags", []) if len(t) >= 2}
    try:
        v = int(tags.get("amount", 0) or 0)
        if v > 0:
            return v
    except Exception:
        pass
    return bolt11_amount_msats(tags.get("bolt11"))


# ── the classifier ────────────────────────────────────────────────────────────
def classify_boost(event, receipt_cache, receipt_fetch=None):
    """Return an OnlyBoosts boost dict, or None if `event` isn't a real podcast
    boost. `receipt_cache` (event_id -> event|None) memoizes zap-receipt lookups
    within a run; `receipt_fetch(event_id) -> event|None` performs one (pass None
    to skip receipt resolution entirely, e.g. a fast first pass)."""
    tags = event.get("tags", [])
    i_tags = [t for t in tags if len(t) >= 2 and t[0] == "i"]
    podcast_guid = item_guid = None
    item_url = show_url = None
    for t in i_tags:
        v = t[1]
        url = t[2] if len(t) >= 3 and t[2] else None
        if v.startswith("podcast:item:guid:"):
            item_guid = v[len("podcast:item:guid:"):]
            item_url = url
        elif v.startswith("podcast:guid:"):
            podcast_guid = v[len("podcast:guid:"):]
            show_url = url

    if not item_guid and not (INCLUDE_SHOW_LEVEL and podcast_guid):
        return None                                  # no NIP-73 podcast identifier
    if podcast_guid and podcast_guid in EXCLUDE_FEED_GUIDS:
        return None

    t_vals = {t[1] for t in tags if len(t) >= 2 and t[0] == "t"}
    amount_msats = None
    amount_source = None
    is_boost = bool(t_vals & BOOST_TOPIC_TAGS)
    if is_boost:
        amount_source = "t_tag"

    amt_tag = next((t[1] for t in tags if len(t) >= 2 and t[0] == "amount"), None)
    if amt_tag:
        try:
            v = int(amt_tag)
            if v > 0:
                amount_msats, amount_source, is_boost = v, "amount_tag", True
        except Exception:
            pass

    if amount_msats is None and receipt_fetch is not None:
        candidate_ids = [t[1] for t in tags
                         if len(t) >= 2 and t[0] in ("q", "e") and len(t[1]) == 64]
        for m in _QUOTE_RE.finditer(event.get("content", "") or ""):
            eid = decode_note_or_nevent(m.group(1))
            if eid:
                candidate_ids.append(eid)
        for cid in dict.fromkeys(candidate_ids):
            if cid not in receipt_cache:
                receipt_cache[cid] = receipt_fetch(cid)
            receipt = receipt_cache[cid]
            if receipt and receipt.get("kind") == 9735:
                is_boost = True
                v = resolve_zap_amount(receipt)
                if v:
                    amount_msats, amount_source = v, "zap_receipt"
                break

    # Last-resort amount: a boost-tagged note whose sats live only in its text
    # (localbitcoiners.com website widget: t=boost, no amount tag, no receipt).
    if is_boost and amount_msats is None:
        sats = parse_content_sats(event.get("content", "") or "")
        if sats:
            amount_msats, amount_source = sats * 1000, "content"

    if not is_boost:
        return None

    client = next((t[1] for t in tags if len(t) >= 2 and t[0] == "client"), None)
    r_urls = [t[1] for t in tags if len(t) >= 2 and t[0] == "r"]

    return {
        "event_id":       event["id"],
        "booster_pubkey": event["pubkey"],
        "booster_npub":   hex_to_npub(event["pubkey"]),
        "created_at":     event["created_at"],
        "sats":           round(amount_msats / 1000) if amount_msats else None,
        "amount_source":  amount_source or "none",
        "message":        strip_fountain_trailer(event.get("content", "") or ""),
        "client":         client,
        # Derived attribution — see clients.py. Computed here so a boost is
        # classified once, at ingest, from the event we already have in hand.
        # `reclassify-clients` recomputes the same thing for stored rows when a
        # rule changes; both read the signed event and nothing else.
        **clients.classify_client(event),
        "podcast_guid":   podcast_guid,
        "item_guid":      item_guid,
        "item_url":       item_url,
        "show_url":       show_url,
        "r_urls":         r_urls,
        "raw":            event,
    }
