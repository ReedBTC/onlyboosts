#!/usr/bin/env python3
"""OB Boostbot on the box: publish the boosts nobody else published, for any
feed that pays onlyboosts@getalby.com.

Reed, 2026-11-22: any podcast that puts onlyboosts@getalby.com in its value
block, for any share, gets its otherwise-unshared boosts on Nostr, the way
people used to cut Podcast Index in. The OnlyBoosts Social Hour is the first
such feed (100% while the hosts talk, 1% during a song). The notes are signed
by OB Boostbot, the key the site's edge signer already uses for boosts made
on onlyboosts.social, and take that note's shape.

    onlyboosts_boostbot.py                  dry run: notes written to ./dry-run/
    onlyboosts_boostbot.py --fixture F.json dry run over saved transactions, no hub call
    onlyboosts_boostbot.py --live           publish (needs DRY_RUN = False as well)

WHAT KEEPS IT CORRECT

  * The wallet gate. Only the onlyboosts@getalby.com wallet (Alby Hub app 55,
    confirmed by Reed 2026-11-22) counts; the hub's list is node-wide.
  * The feed gate. The boostagram names a feed (guid, Podcast Index id or
    URL); the bot resolves it, fetches the feed itself, and requires that
    every signal agrees with it and that its value block pays
    onlyboosts@getalby.com. A payment naming no feed (a site donation, a tip)
    is not a boost. A BOLT11 boost whose descriptor cannot be read is never
    published on a guess.
  * The amount check. The total an app reports is believed only when the sats
    that landed match the feed's share for onlyboosts@getalby.com at the
    moment played (time splits included). Only a verified total is claimed.
  * Only the unshared. A boost another note already covers gets no note.
    Whatever is published passes a last look at the index and the relays.
  * One note per boost. Dedupe on payment hash and on the boost's group id. A
    note counts as published only when a relay accepted it, and one no relay
    accepted is re-sent next run as the SAME event (same created_at, same id).

SONG CREDIT. Tags name the show and episode the boostagram names, as the
site's own boosts do today; the site ignores time splits. Reed, 2026-11-22:
keep what we do now; the music and time-split overhaul is a later project.
The splits are still read, because the amount check needs them.
"""
import argparse
import fcntl
import hashlib
import json
import re
import sys
import time
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
# A copy of the site's BOOSTBOT_NSEC (a Cloudflare secret today). Reed adds it;
# agents read the field name only. The bot refuses any key but OB Boostbot's.
NSEC_FIELD = "NSEC_ONLYBOOSTS_BOT"
BOT_PUBKEY = "3a87a19c801d57111b0905569225d2b20b39d154fc93bef5a8f2860c409b84d9"

PUBLISHED_FILE = HERE / "state_published.json"
PENDING_FILE = HERE / "state_pending.json"     # signed-but-unconfirmed notes, by payment hash
DEFERRED_FILE = HERE / "state_deferred.json"   # BOLT11 boosts waiting on a descriptor
LAST_SEEN_FILE = HERE / "last_seen.txt"
LOCK_FILE = HERE / "boostbot.lock"
DRY_RUN_DIR = HERE / "dry-run"

SHOW_ADDRESS = "onlyboosts@getalby.com"
WALLET_APP_IDS = frozenset({55})

PAGE_LIMIT = 100
MAX_PAGES = 60
RETRY_SEC = 24 * 3600                  # a descriptor or feed that will not load, then dropped
DESCRIPTOR_BACKOFF_SEC = 1800
AMOUNT_TOLERANCE_MSAT = 2000           # per-leg rounding
AMOUNT_TOLERANCE_FRAC = 0.05
# Reed, 2026-11-22: an unverified figure of 5 sats or less reads as a tiny
# boost when it is only our leg of one; such a note has no figure.
MIN_UNVERIFIED_SATS = 6
PI_BASE = "https://api.podcastindex.org/api/1.0"

# The site's note (login-widget/src/lib/externalBoostagram.js,
# buildExternalNoteTemplate): keep the two in step.
BOOST_BANNER_URL = "https://i.nostr.build/iQ4vHJ88xTrGZ36eey9lWJ.png"
MAX_MESSAGE_BYTES = 300
MAX_SENDER_NAME_CHARS = 40


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


# ── feeds ────────────────────────────────────────────────────────────────────
def _pi_get(path, params, config):
    key, secret = config.get("LOCAL_BITCOINERS_INDEX_KEY"), config.get("LOCAL_BITCOINERS_INDEX_SECRET")
    if not key or not secret:
        raise RuntimeError("no Podcast Index credentials")
    epoch = str(int(time.time()))
    auth = hashlib.sha1((key + secret + epoch).encode()).hexdigest()
    r = requests.get(f"{PI_BASE}/{path}", params=params, timeout=15, headers={
        "X-Auth-Date": epoch, "X-Auth-Key": key, "Authorization": auth,
        "User-Agent": "onlyboosts-boostbot/1.0"})
    r.raise_for_status()
    return r.json()


def _norm_url(u):
    u = (u or "").strip().lower()
    u = re.sub(r"^https?://", "", u)
    return u.rstrip("/")


class FeedPending(Exception):
    """The feed could not be resolved or fetched this run; ask again later."""


def resolve_feed(b, config, cache):
    """The feed a boostagram names, fetched and parsed, with `pi_id` and `url`.
    Podcast Index first (guid, then feed id); the boostagram's own URL only
    when the index does not know the feed. Cached per run."""
    pi = None
    try:
        if b["feed_guid"]:
            pi = (_pi_get("podcasts/byguid", {"guid": b["feed_guid"]}, config) or {}).get("feed")
        if not (isinstance(pi, dict) and pi.get("url")) and b["feed_id"]:
            pi = (_pi_get("podcasts/byfeedid", {"id": b["feed_id"]}, config) or {}).get("feed")
    except Exception as e:
        raise FeedPending(f"Podcast Index lookup failed: {e}") from e
    pi = pi if isinstance(pi, dict) and pi.get("url") else None
    url = (pi or {}).get("url") or b["feed_url"]
    if not url:
        return None
    if url not in cache:
        try:
            cache[url] = feedmod.fetch(url)
        except feedmod.FeedUnavailable as e:
            cache[url] = FeedPending(f"feed {url} unavailable: {e}")
    got = cache[url]
    if isinstance(got, FeedPending):
        raise got
    got = dict(got, url=url, pi_id=(pi or {}).get("id"))
    if not got["guid"] and pi and pi.get("podcastGuid"):
        got["guid"] = pi["podcastGuid"]
    return got


def feed_verdict(b, feed):
    """("ours" | "other", why). Each signal the boostagram carries either names
    this feed or contradicts it; one contradiction is decisive, at least one
    positive signal is required, and a title is never a signal."""
    checks = []
    if b["feed_guid"]:
        checks.append(("guid", b["feed_guid"] == feed["guid"], b["feed_guid"]))
    if b["feed_id"] and feed.get("pi_id"):
        checks.append(("feed id", str(b["feed_id"]) == str(feed["pi_id"]), b["feed_id"]))
    if b["feed_url"]:
        checks.append(("feed url", _norm_url(b["feed_url"]) == _norm_url(feed["url"]), b["feed_url"]))
    bad = [c for c in checks if not c[1]]
    if bad:
        return "other", "boostagram contradicts the feed (" + ", ".join(f"{n} {v}" for n, _, v in bad) + ")"
    if not checks:
        return "other", "boostagram carries no guid, feed id or url"
    return "ours", "names the feed by " + ", ".join(n for n, _, _ in checks)


def pays_us(feed):
    """Does any value block in the feed name onlyboosts@getalby.com?"""
    blocks = [feed["recipients"]] + [i["recipients"] for i in feed["items"].values() if i["recipients"]]
    return any(r["address"].lower() == SHOW_ADDRESS for rs in blocks for r in rs)


# ── classification ───────────────────────────────────────────────────────────
DEFERRED = {}    # payment hash -> next time to ask for its descriptor (loaded in main)


def _age(settled_at, now):
    ts = boostagram.settled_ts(settled_at)
    return None if ts is None else now - ts


def _pending_or_drop(tx, now, why):
    age = _age(tx.get("settledAt"), now)
    if age is not None and age < RETRY_SEC:
        return "defer", why
    return "unrouted", f"{why}; given up after 24h"


def classify(tx, config, feeds, now):
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
            return _pending_or_drop(tx, now, f"boost URL {memo['url'][:60]} gave no x-rss-payment header")
        b = boostagram.normalize(raw, "lnaddress")
        if not b["message"]:
            b["message"] = memo["message"]
    elif tx.get("boostagram"):
        b = boostagram.normalize(tx["boostagram"], "keysend")
    else:
        return None, None
    if b["action"] and b["action"] != "boost":
        return None, None
    if not (b["feed_guid"] or b["feed_id"] or b["feed_url"]):
        return "unrouted", "the boostagram names no feed"

    try:
        feed = resolve_feed(b, config, feeds)
    except FeedPending as e:
        return _pending_or_drop(tx, now, str(e))
    if feed is None:
        # Podcast Index lists a new feed hours after it publishes, and a
        # Fountain descriptor carries no feed URL to fall back on.
        return _pending_or_drop(tx, now, f"Podcast Index does not know {b['feed_guid'] or b['feed_id']} yet")
    verdict, why = feed_verdict(b, feed)
    if verdict != "ours":
        return "unrouted", why
    if not pays_us(feed):
        return "unrouted", f"{feed['title']!r} does not pay {SHOW_ADDRESS}"

    item = feed["items"].get(b["item_guid"]) if b["item_guid"] else None
    if b["remote_item_guid"]:
        split = feedmod.split_for_remote(item, b["remote_feed_guid"], b["remote_item_guid"])
        if split is None:
            split = {"remote_pct": None}
    else:
        split = feedmod.split_at(item, b["position"]) if item is not None else None

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
            why = f"landed {our_msats} msat, expected {expected:.0f} ({share:.2%} of {total})"
        else:
            verified, why = True, f"{share:.2%} of the total landed, as the feed says"

    npub = b["sender_npub"] if b["sender_npub"] and npub_to_hex(b["sender_npub"]) else None
    pk_hex = npub_to_hex(npub) if npub else None
    if not npub and b["sender_pubkey"] and re.fullmatch(r"[0-9a-f]{64}", b["sender_pubkey"]):
        pk_hex = b["sender_pubkey"]
        npub = hex_to_npub(pk_hex)

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
        "app_name": b["app_name"] or ("Fountain" if "fountain.fm" in (b["link"] or "") else None),
        "feed_guid": feed["guid"],
        "feed_title": feed["title"] or b["feed_title"],
        "episode_guid": b["item_guid"],
        "episode_title": (item or {}).get("title") or b["item_title"],
        "split": split,
        # The duplicate check: a donor's app may file its note under the song.
        "item_guids": {g for g in (b["item_guid"], (split or {}).get("item_guid")) if g},
    }
    return "boost", info


# ── the note: OB Boostbot's shape ────────────────────────────────────────────
def _clip_bytes(s, limit):
    out, n = [], 0
    for ch in s:
        n += len(ch.encode("utf-8"))
        if n > limit:
            break
        out.append(ch)
    return "".join(out)


def _sender_line(info):
    if info["sender_npub"]:
        return f"nostr:{info['sender_npub']}"
    name = re.sub(r"[\x00-\x1f\x7f  ]+", " ", info["sender_name"] or "").replace("\U0001F4F1", "")
    name = " ".join(name.split())[:MAX_SENDER_NAME_CHARS].strip()
    return name or None


def note_text(info):
    """The site's bot note (buildExternalNoteTemplate), with the app the donor
    used in the via line where the site writes onlyboosts.social."""
    lines = [BOOST_BANNER_URL]
    via = f" 📱 via {info['app_name']}" if info["app_name"] else ""
    if info["amount_verified"]:
        lines.append(f"⚡Just boosted {info['total_sats']:,} sats{via}")
    elif info["our_sats"] >= MIN_UNVERIFIED_SATS:
        lines.append(f"⚡Just boosted {info['our_sats']:,} sats{via}")
    else:
        lines.append(f"⚡Just boosted{via}")
    sender = _sender_line(info)
    if sender:
        lines.append(f"👤 From {sender}")
    if info["message"]:
        lines.append(f'💬 "{_clip_bytes(info["message"], MAX_MESSAGE_BYTES)}"')
    lines.append("")
    show = info["feed_title"] or "a podcast"
    lines.append(f"🎙️ {show} • {info['episode_title']}" if info["episode_title"] else f"🎙️ {show}")
    return "\n".join(lines)


def note_tags(info, decision):
    tags = []
    if decision == "claim":
        tags += [["t", "boost"], ["t", "podcast"], ["t", "boostagram"], ["t", "value4value"]]
    tags.append(["client", "onlyboosts.social"])
    tags += [["i", f"podcast:guid:{info['feed_guid']}"], ["k", "podcast:guid"]]
    if info["episode_guid"]:
        tags += [["i", f"podcast:item:guid:{info['episode_guid']}"], ["k", "podcast:item:guid"]]
    if decision == "claim":
        tags.append(["amount", str(int(info["total_sats"]) * 1000)])
    # No `p` and no `P`: the site's oracle refuses a mention tag on the bot
    # route, and the bot names the donor in prose only, as the site does.
    return tags


def write_preview(text, tags, suffix):
    DRY_RUN_DIR.mkdir(exist_ok=True)
    ev = {"kind": 1, "pubkey": BOT_PUBKEY, "created_at": int(time.time()), "tags": tags, "content": text}
    path = DRY_RUN_DIR / f"boost-{int(time.time() * 1000)}-{suffix}.json"
    path.write_text(json.dumps(ev, indent=2, ensure_ascii=False))
    return path


# ── the run ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="OB Boostbot: publish unshared boosts to feeds that pay onlyboosts.")
    ap.add_argument("--live", action="store_true", help="publish (DRY_RUN must also be False)")
    ap.add_argument("--fixture", help="read transactions from this JSON file instead of the hub")
    ap.add_argument("--since", help="dry runs only: ISO settledAt to start from, ignoring last_seen")
    args = ap.parse_args()
    dry = DRY_RUN or not args.live

    lock = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("[skip] another run holds the lock")
        return 0

    config = load_config(CREDENTIALS_FILE)
    nsec = config.get(NSEC_FIELD)
    if nsec:
        from pynostr.key import PrivateKey
        if PrivateKey.from_nsec(nsec).public_key.hex() != BOT_PUBKEY:
            log(f"[error] {NSEC_FIELD} is not OB Boostbot's key — refusing to run")
            return 1
    elif not dry:
        log(f"[error] no {NSEC_FIELD} in credentials.env — cannot publish")
        return 1

    published = load_json(PUBLISHED_FILE, {})
    groups = {v.get("group"): k for k, v in published.items() if v.get("group")}
    pending = load_json(PENDING_FILE, {})
    DEFERRED.update(load_json(DEFERRED_FILE, {}))
    last_seen = args.since if (args.since and dry) else (
        LAST_SEEN_FILE.read_text().strip() if LAST_SEEN_FILE.exists() else None)

    if args.fixture:
        txs = json.loads(Path(args.fixture).read_text())
    else:
        try:
            txs = fetch_transactions(config, last_seen)
        except Exception as e:
            hint = (" (the hub comes back locked after an LND restart; it answers 401 until unlocked)"
                    if getattr(getattr(e, "response", None), "status_code", None) == 401 else "")
            log(f"[error] could not reach the hub: {e}{hint}")
            return 1

    now = int(time.time())
    cands = sorted((tx for tx in txs
                    if tx.get("type") == "incoming" and tx.get("state") == "settled"
                    and tx.get("appId") in WALLET_APP_IDS
                    and not (last_seen and (tx.get("settledAt") or "") <= last_seen)
                    and tx.get("paymentHash") not in published),
                   key=lambda t: t.get("settledAt") or "")
    log(f"{'DRY-RUN — ' if dry else ''}{len(cands)} new payment(s) to {SHOW_ADDRESS} (app {sorted(WALLET_APP_IDS)})")
    if not cands:
        return 0

    feeds = {}
    classified = []
    for tx in cands:
        kind, info = classify(tx, config, feeds, now)
        if kind in ("defer", "unrouted"):
            log(f"[{kind}] {(tx.get('paymentHash') or '')[:12]}... {info}")
        classified.append((tx, kind, info))

    # One index query per guid per run. Each boost's scope is its show plus
    # the song playing at that boost, never a whole episode's songs.
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
                    log(f"[coverage] {g}: {e} — boosts that need it are held")
            if by_guid[g] is None:
                return None
            for r in by_guid[g]:
                if r.get("id") not in seen:
                    seen.add(r.get("id"))
                    out.append(r)
        return out

    consumed, newest, blocked = set(), last_seen, False
    for tx, kind, info in classified:
        settled = tx.get("settledAt") or ""
        if kind == "defer":
            blocked = True
            continue
        if kind != "boost":
            if not blocked:
                newest = settled
            continue
        ph = info["payment_hash"]
        if info["group"] and info["group"] in groups:
            log(f"[dedupe] {ph[:12]}... is another leg of boost {info['group']} — no second note")
            if not dry:
                published[ph] = {"sibling_of": groups[info["group"]], "group": info["group"], "settled_at": settled}
                save_json(PUBLISHED_FILE, published)
            if not blocked:
                newest = settled
            continue

        split = info["split"] or {}
        scope = {"guids": [info["feed_guid"]] + ([split["feed_guid"]] if split.get("feed_guid") else []),
                 "show_pubkey": None}           # our own key is evidence: see coverage.py
        decision, why = coverage.decide(info, indexed_for(scope["guids"]), now, scope, consumed)
        if decision in ("claim", "untagged") and ph not in pending:
            ok, vwhy = coverage.verify_before_claim(info, scope, NOSTR_RELAYS, query_relay)
            if not ok:
                decision, why = "skip", vwhy
        log(f"[{decision}] {ph[:12]}... {info['feed_title']!r} — {why} (amount: {info['amount_why']})")
        if decision == "hold":
            blocked = True
            continue
        if decision == "skip":
            if not dry:
                published[ph] = {"covered": why, "group": info["group"], "settled_at": settled}
                save_json(PUBLISHED_FILE, published)
            if info["group"]:
                groups[info["group"]] = ph
            if not blocked:
                newest = settled
            continue

        if ph in pending:
            # Signed and sent before, accepted by no relay we heard from: send the
            # identical event (same text, tags and created_at, so the same id).
            text, tags, created_at = pending[ph]["text"], pending[ph]["tags"], pending[ph]["created_at"]
            log(f"  [resend] as first signed (created_at {created_at})")
        else:
            text, tags, created_at = note_text(info), note_tags(info, decision), int(time.time())
        log("─" * 50)
        log(text)
        log(f"  tags: {tags}")
        if dry:
            log(f"  [dry-run] → {write_preview(text, tags, ph[:12])}")
        else:
            pending[ph] = {"text": text, "tags": tags, "created_at": created_at}
            save_json(PENDING_FILE, pending)                # before the send, not after
            event_id = publish_to_nostr(text, nsec, extra_tags=tags, created_at=created_at)
            if not event_id:
                log(f"  [error] no relay accepted {ph[:12]}...; the same event is re-sent next run")
                blocked = True
                continue
            pending.pop(ph, None)
            save_json(PENDING_FILE, pending)
            published[ph] = {"event_id": event_id, "settled_at": settled,
                             "group": info["group"], "decision": decision}
            save_json(PUBLISHED_FILE, published)            # per boost: the note is already out
        if info["group"]:
            groups[info["group"]] = ph
        if not blocked:
            newest = settled

    if not dry:
        save_json(DEFERRED_FILE, {k: v for k, v in DEFERRED.items() if k not in published})
        if newest and newest != last_seen:
            LAST_SEEN_FILE.write_text(newest)
            log(f"last_seen → {newest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
