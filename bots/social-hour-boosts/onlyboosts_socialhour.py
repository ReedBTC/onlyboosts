#!/usr/bin/env python3
"""Publish a Nostr note for every boost to The OnlyBoosts Social Hour.

The show is hosted on Podhome, whose time splits can point at a remote item by
percentage but cannot carry recipients of their own, so a third-party boost bot
could only be paid by a split on every episode. This is the show's own bot
instead: it reads the show's wallet on Reed's Alby Hub, publishes one kind-1
note per boost, and claims the boost for the index (payment-evidence tags)
only when nobody else's note already covers it (`coverage.py`).

    onlyboosts_socialhour.py                  dry run: notes written to ./dry-run/
    onlyboosts_socialhour.py --fixture F.json dry run over saved transactions, no hub call
    onlyboosts_socialhour.py --live           publish (needs DRY_RUN = False as well)

WHAT KEEPS IT CORRECT

  * The wallet gate. The hub's transaction list is node-wide; only the
    Social Hour wallet's app id counts, and an empty WALLET_APP_IDS publishes
    nothing. onlyboosts@getalby.com also receives site donations and song
    splits, so the wallet alone is not enough either:
  * The feed gate. A boost is the show's only when its boostagram positively
    names the show (its podcast:guid, its Podcast Index feed id, or its feed
    URL) and nothing in it names another feed. Many keysend apps send a feed id
    and URL but no guid. A BOLT11 boost whose descriptor cannot be read is
    never published on a guess.
  * The amount check. The total an app reports is believed only when the sats
    that actually landed match the show's share of it at the moment played
    (100% while the hosts talk, 100 - remotePercentage during a song). An
    unverified total is never published as a claim; the note then states what
    the show received.
  * One note per boost. Dedupe on payment hash and on the boost's group id,
    recorded after every publish. A note is recorded as published only when a
    relay accepted it; one no relay accepted is re-sent next run with the SAME
    created_at, so it is the same event id and cannot become a second note.
"""
import argparse
import fcntl
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shared"))
sys.path.insert(0, str(HERE))
from nostr_utils import (  # noqa: E402
    load_config, publish_to_nostr, hex_to_npub, npub_to_hex, NOSTR_RELAYS,
)
from collector_common import query_relay  # noqa: E402
import boostagram  # noqa: E402
import coverage  # noqa: E402
import feed as feedmod  # noqa: E402

# ── convention: a new bot does not publish until Reed flips it ───────────────
DRY_RUN = True

CREDENTIALS_FILE = Path.home() / ".config/nostr-bots/credentials.env"
NSEC_FIELD = "NSEC_SOCIAL_HOUR"          # Reed adds it; agents read the name only
PUBLISHED_FILE = HERE / "state_published.json"
LAST_SEEN_FILE = HERE / "last_seen.txt"
SONGS_FILE = HERE / "state_songs.json"
PENDING_FILE = HERE / "state_pending.json"     # signed-but-unconfirmed notes, by payment hash
DEFERRED_FILE = HERE / "state_deferred.json"   # BOLT11 boosts waiting on a descriptor
FEEDID_FILE = HERE / "state_feedid.json"
LOCK_FILE = HERE / "socialhour.lock"
DRY_RUN_DIR = HERE / "dry-run"

FEED_URL = "https://serve.podhome.fm/rss/de0bcde8-964b-4d71-9280-85d0ca2682c8"
SHOW_ADDRESS = "onlyboosts@getalby.com"
# ⚠️ EMPTY UNTIL REED CONFIRMS WHICH APP onlyboosts@getalby.com PAYS INTO (the
# hub has 55 "Onlyboosts", isolated, and 56 "onlyboosts"). Empty publishes
# nothing; that is the point.
WALLET_APP_IDS = frozenset()

# A boost made during a song: tag the note with the song's feed and item after
# the show's own pair, Boostr_Bot's order. The collector keeps the last
# podcast:guid on a note, so OnlyBoosts credits the song, as it does a song
# boosted off a playlist. False tags the show and episode only. Reed's call.
SONG_CREDIT = True
CLIENT_TAG = "OnlyBoosts Social Hour"

PAGE_LIMIT = 100
MAX_PAGES = 60
# A BOLT11 boost whose descriptor will not load is retried this long, then
# recorded as unrouted and never published.
DESCRIPTOR_RETRY_SEC = 24 * 3600
DESCRIPTOR_BACKOFF_SEC = 1800
AMOUNT_TOLERANCE_MSAT = 2000             # per-leg rounding, observed in Fountain legs
AMOUNT_TOLERANCE_FRAC = 0.05
PI_BASE = "https://api.podcastindex.org/api/1.0"


def log(msg=""):
    print(msg, flush=True)


# ── state ────────────────────────────────────────────────────────────────────
def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save_json(path, doc):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, indent=1, sort_keys=True))
    tmp.replace(path)


# ── the hub ──────────────────────────────────────────────────────────────────
def fetch_transactions(config, cutoff):
    """Transactions newer than `cutoff`, paging back until a page reaches it.
    Ported from LB's boost-publisher: a stall delays notes instead of losing
    them, and a pending tx (settledAt null) never stops the crawl early."""
    url, token = config["ALBY_HUB_URL"].rstrip("/"), config["ALBY_TOKEN"]
    out = []
    for page in range(MAX_PAGES):
        r = requests.get(f"{url}/api/transactions?limit={PAGE_LIMIT}&offset={page * PAGE_LIMIT}",
                         headers={"Authorization": f"Bearer {token}"}, timeout=30)
        r.raise_for_status()
        data = r.json()
        txs = data if isinstance(data, list) else data.get("transactions", [])
        if not txs:
            break
        out.extend(txs)
        if not cutoff:
            break
        stamps = [t.get("settledAt") for t in txs if t.get("settledAt")]
        if stamps and min(stamps) <= cutoff:
            break
    else:
        log(f"[warn] hit MAX_PAGES ({MAX_PAGES}) still newer than {cutoff}")
    return out


# ── song names (Podcast Index, cached) ───────────────────────────────────────
def _pi_get(path, params, config):
    key, secret = config.get("LOCAL_BITCOINERS_INDEX_KEY"), config.get("LOCAL_BITCOINERS_INDEX_SECRET")
    if not key or not secret:
        return None
    epoch = str(int(time.time()))
    auth = hashlib.sha1((key + secret + epoch).encode()).hexdigest()
    r = requests.get(f"{PI_BASE}/{path}", params=params, timeout=15, headers={
        "X-Auth-Date": epoch, "X-Auth-Key": key, "Authorization": auth,
        "User-Agent": "onlyboosts-socialhour/1.0"})
    r.raise_for_status()
    return r.json()


def song_name(split, config, songs):
    """{'title', 'artist'} for a time split's remote item; cached per item.
    A miss returns None and the note names no song, it never guesses."""
    key = split.get("item_guid")
    if not key:
        return None
    if key in songs:
        return songs[key]
    name = None
    try:
        ep = (_pi_get("episodes/byguid", {"guid": key, "podcastguid": split.get("feed_guid")}, config)
              or {}).get("episode") or {}
        if ep.get("title"):
            pod = (_pi_get("podcasts/byguid", {"guid": split.get("feed_guid")}, config) or {}).get("feed") or {}
            name = {"title": ep["title"], "artist": pod.get("author") or ep.get("feedTitle") or None}
    except Exception as e:
        log(f"  [warn] song lookup failed for {key[:12]}...: {e}")
        return None                     # not cached: try again next run
    songs[key] = name
    return name


# ── classification ───────────────────────────────────────────────────────────
def _age(settled_at, now):
    ts = boostagram.settled_ts(settled_at)
    return None if ts is None else now - ts


def _valid_npub(npub):
    return npub if npub and npub_to_hex(npub) else None


def _norm_url(u):
    u = (u or "").strip().lower()
    u = re.sub(r"^https?://", "", u)
    return u.rstrip("/")


def feed_verdict(b, feed):
    """("ours" | "other", why). Each signal the boostagram carries either names
    the show or contradicts it; one contradiction is decisive, and at least one
    positive signal is required. A title is never a signal: two shows can share
    one. `feed["pi_id"]` is None until Podcast Index knows the show, and then a
    feed id can neither confirm nor contradict."""
    checks = []
    if b["feed_guid"]:
        checks.append(("guid", b["feed_guid"] == feed["guid"], b["feed_guid"]))
    if b["feed_id"] and feed.get("pi_id"):
        checks.append(("feed id", str(b["feed_id"]) == str(feed["pi_id"]), b["feed_id"]))
    if b["feed_url"]:
        checks.append(("feed url", _norm_url(b["feed_url"]) == _norm_url(FEED_URL), b["feed_url"]))
    bad = [c for c in checks if not c[1]]
    if bad:
        return "other", "boostagram names another feed (" + ", ".join(f"{n} {v}" for n, _, v in bad) + ")"
    if not checks:
        return "other", (f"boostagram carries no guid, usable feed id or url "
                         f"(feed id {b['feed_id'] or '-'}, title {b['feed_title'] or '-'})")
    return "ours", "names the show by " + ", ".join(n for n, _, _ in checks)


def show_pi_id(feed, config):
    """The show's Podcast Index feed id, cached once found; None until PI has it."""
    cached = load_json(FEEDID_FILE, {})
    if cached.get(feed["guid"]):
        return cached[feed["guid"]]
    try:
        fid = ((_pi_get("podcasts/byguid", {"guid": feed["guid"]}, config) or {}).get("feed") or {}).get("id")
    except Exception as e:
        log(f"[warn] Podcast Index feed id lookup failed: {e}")
        return None
    if fid:
        cached[feed["guid"]] = fid
        save_json(FEEDID_FILE, cached)
    return fid


DEFERRED = {}    # payment hash -> next time to ask for its descriptor (loaded in main)


def classify(tx, feed, now):
    """("boost", info) | ("defer", why) | ("unrouted", why) | (None, None) not a boost."""
    desc = tx.get("description") or ""
    ph = tx.get("paymentHash") or ""
    memo = boostagram.parse_description(desc)
    if memo:
        if memo["action"] != "boost":
            return None, None                         # streams are not published
        raw = None if DEFERRED.get(ph, 0) > now else boostagram.fetch_descriptor(memo["url"])
        if raw is None:
            if DEFERRED.get(ph, 0) <= now:
                DEFERRED[ph] = now + DESCRIPTOR_BACKOFF_SEC
            age = _age(tx.get("settledAt"), now)
            if age is not None and age < DESCRIPTOR_RETRY_SEC:
                return "defer", f"boost URL {memo['url'][:60]} returned no x-rss-payment header"
            return "unrouted", "no readable descriptor after 24h; the feed cannot be confirmed"
        b = boostagram.normalize(raw, "lnaddress")
        if not b["message"]:
            b["message"] = memo["message"]
    elif (tx.get("boostagram") or {}):
        b = boostagram.normalize(tx["boostagram"], "keysend")
    else:
        return None, None
    if b["action"] and b["action"] != "boost":
        return None, None

    verdict, why = feed_verdict(b, feed)
    if verdict != "ours":
        return "unrouted", why

    item = feed["items"].get(b["item_guid"]) if b["item_guid"] else None
    split = None
    if b["remote_item_guid"]:
        split = feedmod.split_for_remote(item, b["remote_feed_guid"], b["remote_item_guid"])
        if split is None:
            # The app says a song was playing that this episode's splits do not
            # name. Trust the app for the credit; the share is then unknown.
            split = {"feed_guid": b["remote_feed_guid"], "item_guid": b["remote_item_guid"],
                     "remote_pct": None}
    elif item is not None:
        split = feedmod.split_at(item, b["position"])

    our_msats = int(tx.get("amount") or 0)
    total = b["value_msat_total"]
    verified, why = False, "no total reported"
    if total and split is not None and split.get("remote_pct") is None:
        why = "share unknown: the remote item is not in the feed's splits"
    elif total:
        share = feedmod.show_share(feed, item, split, SHOW_ADDRESS)
        expected = total * share
        tol = max(AMOUNT_TOLERANCE_MSAT, AMOUNT_TOLERANCE_FRAC * expected)
        if b["recipient_address"] and b["recipient_address"].lower() != SHOW_ADDRESS:
            why = f"descriptor names recipient {b['recipient_address']}, not {SHOW_ADDRESS}"
        elif share <= 0:
            why = f"the feed gives {SHOW_ADDRESS} no share here"
        elif abs(our_msats - expected) > tol:
            why = (f"landed {our_msats} msat, expected {expected:.0f} "
                   f"({share:.2%} of {total})")
        else:
            verified, why = True, f"{share:.2%} of the total landed, as the feed says"

    npub = _valid_npub(b["sender_npub"])
    pk_hex = None
    if not npub and b["sender_pubkey"] and re.fullmatch(r"[0-9a-f]{64}", b["sender_pubkey"]):
        pk_hex = b["sender_pubkey"]
        npub = hex_to_npub(pk_hex)
    elif npub:
        pk_hex = npub_to_hex(npub)

    item_guids = {g for g in (b["item_guid"], (split or {}).get("item_guid")) if g}
    info = {
        "payment_hash": ph,
        "settled_at": tx.get("settledAt") or "",
        "group": b["group"],
        "channel": b["channel"],
        "our_sats": round(our_msats / 1000),
        "total_sats": round(total / 1000) if verified else None,
        "amount_verified": verified,
        "amount_why": why,
        "sender_npub": npub,
        "sender_pubkey_hex": pk_hex,
        "sender_name": b["sender_name"],
        "message": b["message"],
        "app_name": b["app_name"] or ("Fountain" if "fountain.fm" in (b["link"] or "") else "unknown app"),
        "episode_guid": b["item_guid"],
        "episode_title": (item or {}).get("title") or b["item_title"],
        "episode_link": (item or {}).get("link"),
        "split": split,
        "item_guids": item_guids,
    }
    return "boost", info


# ── the note ─────────────────────────────────────────────────────────────────
def note_text(info, song):
    """A DRAFT for Reed to approve; nothing publishes with it until he does."""
    lines = ["⚡ New boost on The OnlyBoosts Social Hour!"]
    if info["amount_verified"]:
        lines.append(f"💰 {info['total_sats']:,} sats 📱 via {info['app_name']}")
    else:
        lines.append(f"💰 {info['our_sats']:,} sats to the show 📱 via {info['app_name']}")
    if info["sender_npub"]:
        lines.append(f"👤 nostr:{info['sender_npub']}")
    elif info["sender_name"]:
        lines.append(f"👤 {info['sender_name']}")
    if info["message"]:
        lines.append(f"💬 {info['message']}")
    if song:
        lines.append(f"🎵 {song['title']}" + (f" by {song['artist']}" if song.get("artist") else ""))
    if info["episode_title"]:
        lines.append(f"🎙️ {info['episode_title']}")
    if info["episode_link"]:
        lines.append(f"🔗 {info['episode_link']}")
    return "\n".join(lines)


def note_tags(info, show_guid, decision):
    tags = [["i", f"podcast:guid:{show_guid}"], ["k", "podcast:guid"]]
    if info["episode_guid"]:
        tags += [["i", f"podcast:item:guid:{info['episode_guid']}"], ["k", "podcast:item:guid"]]
    split = info["split"]
    if SONG_CREDIT and split and split.get("feed_guid") and split.get("item_guid"):
        # After the show's pair, on purpose: see SONG_CREDIT.
        tags += [["i", f"podcast:guid:{split['feed_guid']}"],
                 ["i", f"podcast:item:guid:{split['item_guid']}"]]
    if decision == "claim":
        tags += [["t", "boost"], ["t", "boostagram"], ["t", "value4value"],
                 ["amount", str(int(info["total_sats"]) * 1000)],
                 ["client", CLIENT_TAG]]
        if info["sender_pubkey_hex"]:
            tags.append(["P", info["sender_pubkey_hex"]])   # uppercase: no notification
    return tags


def write_preview(text, tags, pubkey, suffix):
    DRY_RUN_DIR.mkdir(exist_ok=True)
    ev = {"kind": 1, "pubkey": pubkey, "created_at": int(time.time()), "tags": tags, "content": text}
    path = DRY_RUN_DIR / f"boost-{int(time.time() * 1000)}-{suffix}.json"
    path.write_text(json.dumps(ev, indent=2, ensure_ascii=False))
    return path


# ── the run ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Publish Social Hour boosts to Nostr.")
    ap.add_argument("--live", action="store_true", help="publish (DRY_RUN must also be False)")
    ap.add_argument("--fixture", help="read transactions from this JSON file instead of the hub")
    ap.add_argument("--feed", help="read the feed from this file instead of FEED_URL")
    ap.add_argument("--app-id", type=int, action="append",
                    help="dry runs only: treat this hub app id as the show's wallet")
    ap.add_argument("--since", help="dry runs only: ISO settledAt to start from, ignoring last_seen")
    args = ap.parse_args()

    dry = DRY_RUN or not args.live
    app_ids = WALLET_APP_IDS
    if args.app_id:
        if not dry:
            log("[error] --app-id is for dry runs; set WALLET_APP_IDS to go live")
            return 1
        app_ids = frozenset(args.app_id)
    if not app_ids:
        log("[stop] WALLET_APP_IDS is empty — no wallet is the show's yet, nothing to do")
        return 0

    lock = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("[skip] another run holds the lock")
        return 0

    config = load_config(CREDENTIALS_FILE)
    nsec = config.get(NSEC_FIELD)
    if not nsec and not dry:
        log(f"[error] no {NSEC_FIELD} in credentials.env — cannot publish")
        return 1
    from pynostr.key import PrivateKey
    if nsec:
        show_pubkey = PrivateKey.from_nsec(nsec).public_key.hex()
    else:
        show_pubkey = None
        log(f"[dry-run] no {NSEC_FIELD} yet — previews carry no pubkey")

    try:
        feed = feedmod.parse(Path(args.feed).read_bytes()) if args.feed else feedmod.fetch(FEED_URL)
    except (feedmod.FeedUnavailable, OSError) as e:
        log(f"[abort] feed unavailable ({e}) — every gate hangs off it; publishing nothing")
        return 1
    if not feed["guid"]:
        log("[abort] the feed carries no podcast:guid — publishing nothing")
        return 1
    feed["pi_id"] = show_pi_id(feed, config)
    DEFERRED.update(load_json(DEFERRED_FILE, {}))
    log(f"{'DRY-RUN — ' if dry else ''}{feed['title']} ({feed['guid']}, PI {feed['pi_id'] or 'not indexed'}), "
        f"{len(feed['items'])} episode(s), wallet app(s) {sorted(app_ids)}")

    published = load_json(PUBLISHED_FILE, {})
    groups = {v.get("group"): k for k, v in published.items() if v.get("group")}
    songs = load_json(SONGS_FILE, {})
    last_seen = args.since if (args.since and dry) else (
        LAST_SEEN_FILE.read_text().strip() if LAST_SEEN_FILE.exists() else None)

    if args.fixture:
        txs = json.loads(Path(args.fixture).read_text())
    else:
        try:
            txs = fetch_transactions(config, last_seen)
        except Exception as e:
            log(f"[error] could not reach the hub: {e}")
            return 1

    now = int(time.time())
    cands = []
    for tx in txs:
        if tx.get("type") != "incoming" or tx.get("state") != "settled":
            continue
        if tx.get("appId") not in app_ids:
            continue
        if last_seen and (tx.get("settledAt") or "") <= last_seen:
            continue
        if tx.get("paymentHash") in published:
            continue
        cands.append(tx)
    cands.sort(key=lambda t: t.get("settledAt") or "")
    log(f"{len(cands)} new payment(s) in the show's wallet")
    if not cands:
        return 0

    boosts = []
    for tx in cands:
        kind, info = classify(tx, feed, now)
        ph = (tx.get("paymentHash") or "")[:12]
        if kind is None:
            boosts.append((tx, None, None))
            continue
        if kind != "boost":
            log(f"[{kind}] {ph}... {info}")
        boosts.append((tx, kind, info))

    # One index query per guid per run, shared by every boost that needs it.
    # Each boost is scoped to the show plus the song playing at that boost.
    oldest = boostagram.settled_ts(cands[0].get("settledAt")) or now
    by_guid = {}

    def indexed_for(guids):
        out, seen = [], set()
        for g in guids:
            if g not in by_guid:
                try:
                    by_guid[g] = coverage.fetch_indexed(oldest - coverage.QUERY_PAD_SEC, [g])
                except coverage.CoverageUnavailable as e:
                    by_guid[g] = None
                    log(f"[coverage] {g}: {e} — boosts that need it are not claimed this run")
            if by_guid[g] is None:
                return None
            for r in by_guid[g]:
                if r.get("id") not in seen:
                    seen.add(r.get("id"))
                    out.append(r)
        return out

    pending = load_json(PENDING_FILE, {})

    consumed, newest, blocked = set(), last_seen, False
    for tx, kind, info in boosts:
        settled = tx.get("settledAt") or ""
        if kind in ("defer",):
            blocked = True
            continue
        if kind != "boost":
            if not blocked:
                newest = settled
            continue
        ph = info["payment_hash"]
        if info["group"] and info["group"] in groups:
            log(f"[dedupe] {ph[:12]}... is another leg of boost {info['group']} — recorded, not published")
            if not dry:
                published[ph] = {"sibling_of": groups[info["group"]], "group": info["group"],
                                 "settled_at": settled}
                save_json(PUBLISHED_FILE, published)
            if not blocked:
                newest = settled
            continue

        split = info["split"] or {}
        scope = {"guids": [feed["guid"]] + ([split["feed_guid"]] if split.get("feed_guid") else []),
                 "show_pubkey": show_pubkey}
        decision, why = coverage.decide(info, indexed_for(scope["guids"]), now, scope, consumed)
        if decision == "hold":
            log(f"[hold] {ph[:12]}... — {why}")
            blocked = True
            continue
        if decision == "claim":
            ok, vwhy = coverage.verify_before_claim(info, scope, NOSTR_RELAYS, query_relay)
            if not ok:
                decision, why = "skip", vwhy

        song = song_name(info["split"], config, songs) if info["split"] else None
        text = note_text(info, song)
        tags = note_tags(info, feed["guid"], decision)
        log("─" * 50)
        log(text)
        log(f"  [{info['channel']} | {ph[:16]}... | amount: {info['amount_why']}]")
        log(f"  [decision: {decision} — {why}]")

        if ph in pending:
            # Signed and sent before, accepted by no relay we heard from. Send the
            # identical event: same text, tags and created_at, so the same id.
            text, tags, created_at = pending[ph]["text"], pending[ph]["tags"], pending[ph]["created_at"]
            log(f"  [resend] {ph[:12]}... as first signed (created_at {created_at})")
        else:
            created_at = int(time.time())
        if dry:
            log(f"  [dry-run] → {write_preview(text, tags, show_pubkey, ph[:12])}")
            if info["group"]:
                groups[info["group"]] = ph        # in memory only: a dry run records nothing
        else:
            pending[ph] = {"text": text, "tags": tags, "created_at": created_at}
            save_json(PENDING_FILE, pending)               # before the send, not after
            event_id = publish_to_nostr(text, nsec, extra_tags=tags, created_at=created_at)
            if not event_id:
                log(f"  [error] no relay accepted {ph[:12]}...; the same event is re-sent next run")
                blocked = True
                continue
            pending.pop(ph, None)
            save_json(PENDING_FILE, pending)
            published[ph] = {"event_id": event_id, "settled_at": settled,
                             "group": info["group"], "decision": decision}
            if info["group"]:
                groups[info["group"]] = ph
            save_json(PUBLISHED_FILE, published)   # per boost: the note is already out
        if not blocked:
            newest = settled

    save_json(SONGS_FILE, songs)
    if not dry:
        save_json(DEFERRED_FILE, {k: v for k, v in DEFERRED.items() if k not in published})
    if not dry and newest and newest != last_seen:
        LAST_SEEN_FILE.write_text(newest)
        log(f"last_seen → {newest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
