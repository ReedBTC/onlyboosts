"""Has somebody else's note for this boost already been published?

Ported from Local Bitcoiners' bots/shared/onlyboosts_coverage.py at 9ed7fc1,
where the reasoning lives in full; LB keeps its own copy (LB-back's call,
2026-11-22). The rule is the same: publish untagged when another note covers
the boost, claim (add the payment evidence) only when nothing does, and hold
when it is too early to tell. Every uncertain path resolves toward not
claiming, because a wrong claim counts a donor's sats twice and cannot be
unpublished.

What differs from LB's copy, and why:

  * Nothing is a module constant. The show's guid, its pubkey and the extra
    guids to search all arrive in `scope`, and reach every query, the last-look
    re-check and the relay sweep included. LB's re-check silently fell back to
    LB's guid and pubkey.
  * A boost made during a song can be filed under the SONG. A donor's app may
    tag its note with the remote item, and the indexer files a note by its
    tags, so a search under the show's guid alone would miss it and we would
    claim a boost already counted. `scope["guids"]` is the show plus every song
    feed in the episode, and a note naming either the episode or the song
    playing is the same boost.
  * Episodes are compared by guid only. LB also compared "Ep N" read out of
    titles; Social Hour titles are not numbered that way, and a number read
    out of a song title would call one boost two.
  * No website receipt short-circuit. That is LB's own site.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from boostagram import settled_ts as _ts

API_URL = "https://onlyboosts.social/api/v1/boosts"
MATCH_WINDOW_SEC = 900                 # ±15 min
MIN_MESSAGE_MATCH_CHARS = 12
_NO_MESSAGE = {"", "undefined"}
# Tuned in LB to OnlyBoosts' 2-minute incremental plus its sync. Fountain
# publishes a donor's note late, so the identified window stays at an hour.
HOLD_WINDOW_SEC = 1200
HOLD_WINDOW_IDENTIFIED_SEC = 3600
QUERY_PAD_SEC = 1800
PAGE_LIMIT = 100
MAX_PAGES = 5
_EVIDENCE_TOPIC_TAGS = {"boost", "boostagram", "value4value"}


class CoverageUnavailable(Exception):
    """Unknown, never 'nobody published one'."""


def _norm_message(s):
    if not s:
        return ""
    s = str(s).replace("\\r", " ").replace("\\n", " ")
    s = " ".join(s.split()).casefold()
    if s in _NO_MESSAGE or len(s) < MIN_MESSAGE_MATCH_CHARS:
        return ""
    return s


def message_agreement(payment_message, note_text):
    """True / False when both sides carry a usable message, None otherwise."""
    a, b = _norm_message(payment_message), _norm_message(note_text)
    if not a or not b:
        return None
    return a in b or b in a


def _get(url, timeout):
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "onlyboosts-socialhour (+https://onlyboosts.social)",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_indexed(since_ts, guids, timeout=20, get=_get):
    """Every indexed boost under any of `guids` since `since_ts`, de-duplicated."""
    seen, records = set(), []
    try:
        for guid in guids:
            cursor = None
            for _ in range(MAX_PAGES):
                params = {"podcast": guid, "since": str(int(since_ts)), "limit": str(PAGE_LIMIT)}
                if cursor:
                    params["cursor"] = cursor
                data = get(f"{API_URL}?{urllib.parse.urlencode(params)}", timeout)
                batch = data.get("boosts") or []
                for r in batch:
                    if r.get("id") not in seen:
                        seen.add(r.get("id"))
                        records.append(r)
                cursor = data.get("next_cursor")
                if not cursor or not batch:
                    break
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        raise CoverageUnavailable(str(e)) from e
    return records


def _episode_conflict(record_item_guid, info):
    """True only when the note POSITIVELY names an item this boost was not for.
    `info["item_guids"]` holds the episode and, during a song, the song."""
    mine = info.get("item_guids") or set()
    return bool(record_item_guid and mine and record_item_guid not in mine)


def _record_item(r):
    return ((r.get("episode") or {}).get("guid")) or None


def find_match(records, info, settled, scope, consumed=None):
    """(record, tier) for the indexed note that represents this payment, or
    (None, None). Tiers strongest first: npub, sats+message, message, sats."""
    consumed = consumed if consumed is not None else set()
    npub = info.get("sender_npub")
    total_sats = info.get("total_sats") if info.get("amount_verified") else None
    message = info.get("message")
    own = scope.get("show_pubkey")

    def _candidates():
        for r in records:
            if r.get("id") in consumed:
                continue
            booster = r.get("booster") or {}
            if own and booster.get("pk") == own:
                continue
            try:
                if abs(int(r.get("ts") or 0) - settled) > MATCH_WINDOW_SEC:
                    continue
            except (TypeError, ValueError):
                continue
            if _episode_conflict(_record_item(r), info):
                continue
            yield r, booster, message_agreement(message, r.get("msg"))

    if npub:
        mine = [(r, a) for r, b, a in _candidates() if b.get("npub") == npub]
        for r, agree in mine:
            if agree:
                return r, "npub+message"
        for r, agree in mine:
            if not (agree is False and r.get("sats") != total_sats):
                return r, "npub"
    if total_sats:
        for r, _, agree in _candidates():
            if r.get("sats") == total_sats and agree:
                return r, "sats+message"
    for r, _, agree in _candidates():
        if agree:
            return r, "message"
    if total_sats:
        for r, _, agree in _candidates():
            if r.get("sats") == total_sats and agree is not False:
                return r, "sats"
    return None, None


def _event_item_guids(ev):
    return {t[1][len("podcast:item:guid:"):] for t in ev.get("tags", [])
            if len(t) >= 2 and t[0] == "i" and t[1].startswith("podcast:item:guid:")}


def _note_sats(ev):
    """Sats a relay note claims: its amount tag, else the first "<n> sats" in
    its text. A note that mentions some other figure parses wrong; the cost is
    a missed veto or match, never a crash (LB-back, 2026-11-22)."""
    for t in ev.get("tags", []):
        if len(t) >= 2 and t[0] == "amount":
            try:
                v = int(t[1])
                if v > 0:
                    return round(v / 1000)
            except ValueError:
                pass
    m = re.search(r"([\d][\d,]{0,15})\s*sats\b", ev.get("content", "") or "", re.IGNORECASE)
    if m:
        try:
            return int(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return None


def relay_note_for(info, settled, scope, relays, query_relay):
    """A boost note for this payment already on the relays, or (None, None)."""
    filt = {"kinds": [1], "#i": [f"podcast:guid:{g}" for g in scope["guids"]],
            "since": int(settled - MATCH_WINDOW_SEC),
            "until": int(settled + MATCH_WINDOW_SEC), "limit": 200}
    npub_hex = info.get("sender_pubkey_hex")
    total_sats = info.get("total_sats") if info.get("amount_verified") else None
    message = info.get("message")
    mine = info.get("item_guids") or set()
    own = scope.get("show_pubkey")
    for relay in relays:
        try:
            events = query_relay(relay, filt) or []
        except Exception:
            continue                      # a dead relay is not evidence of absence
        for ev in events:
            if own and ev.get("pubkey") == own:
                continue
            items = _event_item_guids(ev)
            if items and mine and not (items & mine):
                continue
            ev_sats = _note_sats(ev)
            agree = message_agreement(message, ev.get("content"))
            sats_agree = total_sats is not None and ev_sats == total_sats
            if npub_hex and ev.get("pubkey") == npub_hex:
                if agree:
                    return ev, f"{relay} has a note from the donor with this message ({ev['id'][:12]}...)"
                if agree is False and not sats_agree:
                    continue
                if ev_sats is None or total_sats is None or sats_agree:
                    return ev, f"{relay} has a note from the donor ({ev['id'][:12]}...)"
                continue
            has_evidence = (
                any(t[0] == "t" and len(t) >= 2 and t[1] in _EVIDENCE_TOPIC_TAGS
                    for t in ev.get("tags", []) if t)
                or any(t[0] == "amount" for t in ev.get("tags", []) if t))
            if not has_evidence:
                continue
            if agree:
                return ev, f"{relay} has a boost note carrying this message ({ev['id'][:12]}...)"
            if sats_agree and agree is not False:
                return ev, f"{relay} has a {total_sats}-sat boost note ({ev['id'][:12]}...)"
    return None, None


def verify_before_claim(info, scope, relays=None, query_relay=None, fetch=fetch_indexed):
    """The last look before an irreversible claim. (True, why) to claim."""
    settled = _ts(info.get("settled_at"))
    if settled is None:
        return False, "no parseable settledAt"
    try:
        fresh = fetch(settled - QUERY_PAD_SEC, scope["guids"])
    except CoverageUnavailable as e:
        return False, f"OnlyBoosts unreachable on re-check ({e}) — not claiming"
    match, how = find_match(fresh, info, settled, scope)
    if match:
        return False, f"indexed since the batch query (matched on {how}, {match['id'][:12]}...)"
    if relays and query_relay:
        ev, why = relay_note_for(info, settled, scope, relays, query_relay)
        if ev:
            return False, f"a note for this boost is on Nostr but not indexed — {why}"
    return True, "no note for this boost on the index or the relays"


def decide(info, records, now_ts, scope, consumed=None):
    """("skip" | "claim" | "hold", reason). `records` None means the API was down."""
    settled = _ts(info.get("settled_at"))
    if settled is None:
        return "skip", "no parseable settledAt"
    age = now_ts - settled
    hold_window = HOLD_WINDOW_IDENTIFIED_SEC if info.get("sender_npub") else HOLD_WINDOW_SEC
    if records is None:
        if age < hold_window:
            return "hold", "OnlyBoosts API unreachable — retrying next tick"
        return "skip", "OnlyBoosts API unreachable past the hold window"
    match, how = find_match(records, info, settled, scope, consumed)
    if match:
        if consumed is not None:
            consumed.add(match["id"])
        who = ((match.get("client_app") or {}).get("id") or match.get("client") or "unknown client")
        return "skip", f"already indexed via {who} (matched on {how}, {match['id'][:12]}...)"
    if not info.get("amount_verified"):
        # A claim publishes an amount tag; one we could not verify is not ours
        # to publish into an index.
        return "skip", "amount not verified — publishing untagged"
    if age < hold_window:
        return "hold", (f"not indexed yet, {int(age / 60)} min old — waiting up to "
                        f"{int(hold_window / 60)} min for the donor's note")
    return "claim", f"no note indexed after {int(age // 60)} min"
