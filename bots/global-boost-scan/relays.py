#!/usr/bin/env python3
"""Relay strategy for the global boost scan.

Curated boost-dense core (from the 2026-07-24 relay research —
~/localbitcoiners/bots/boost-relay-landscape.md) plus outbox expansion: after a
pass, resolve the NIP-65 write relays of every booster found and fold in any new
ones. Boosters publish to their own relays, so following them is how we reach
boosts that live on relays we'd never hardcode. It converges — each round finds
fewer new relays.
"""

from nostr_utils import get_outbox_relays

# Boost-dense relays. relay.fountain.fm is mandatory: ~90% of Fountain boosts
# live only there. mostr.pub is an ActivityPub bridge with very wide coverage.
CORE_RELAYS = [
    "wss://relay.fountain.fm",
    "wss://nos.lol",
    "wss://relay.ditto.pub",
    "wss://relay.mostr.pub",
    "wss://chadf.nostr1.com",
    "wss://nostr.mom",
    "wss://relay.lexingtonbitcoin.org",
    "wss://nostr21.com",
    "wss://podtards.com",
    "wss://relay.wavlake.com",
    "wss://relay.noderunners.network",
    "wss://nostr.land",
]

# Profile / NIP-65 sources — queried for kind-0 and kind-10002, not boosts.
# relay.nostr.band was dropped in the original pass for timing out on nearly
# every profile batch; re-probed 2026-08-12 it answered 0% on every kind.
#
# Re-measured 2026-08-12 against the 61 distinct boosters behind the 100 most
# recent boosts. Coverage, kind 0 / kind 10002:
#     relay.ditto.pub    80% / 42%
#     nos.lol            78% / 59%
#     relay.mostr.pub    47% / 36%
#     relay.wavlake.com  37% / 37%
#
# ⚠️ The header note above this list used to read "Aggregators (purplepag.es)
# miss many boosters" — that was right, and the measurement is what retired it:
# 32% / 37% on its own, and ZERO marginal coverage once ditto and nos.lol are
# present. Same finding for relay.primal.net (6% / 4%) and relay.wisp.talk
# (26% / 24%). wavlake replaces them because this audience is podcast and music
# listeners, so the relay their boosts live on carries their profiles too.
#
# 11% of boosters have no kind 0 on ANY relay tested and 36% no kind 10002.
# That floor is a fact about them; adding relays does not move it.
#
# ⚠️ THE ZERO-MARGINAL FINDINGS ABOVE ARE ABOUT RECENT BOOSTERS, AND THE
# ARCHIVAL TAIL DISAGREES. Re-measured 2026-09-11 against the 99 boosters with no
# profile row at all — mostly the 2024-era audience the deepscan recovered. These
# four reached 5 of them; `relay.fountain.fm` reached 16 (+15 marginal) and
# `purplepag.es` 16 (+13, overlapping 11), and every other relay tried added
# zero. 77 have no kind-0 on any of 15 relays, which puts the whole-corpus floor
# at 2.6% rather than 11%.
#
# Neither was added here. The 17 storable profiles were recovered by a one-off
# pass, because this set is queried SERIALLY at up to 30s per relay per batch on
# a 120s tick and that tail is finite. Add one only for a standing gap, and
# re-measure first. Fountain is the odd one: already in CORE_RELAYS and
# RECEIPT_RELAYS, dialled every tick, and never asked for a kind-0.
PROFILE_RELAYS = [
    "wss://nos.lol",
    "wss://relay.ditto.pub",
    "wss://relay.mostr.pub",
    "wss://relay.wavlake.com",
]

# Where to look up quoted kind-9735 zap receipts (Fountain boosts carry no amount
# tag; the receipt is how we detect the boost + its sats). Fountain first — it's
# where Fountain publishes its receipts — then a couple of wide general relays.
RECEIPT_RELAYS = [
    "wss://relay.fountain.fm",
    "wss://nos.lol",
    "wss://relay.ditto.pub",
]


def _norm(u):
    return u.rstrip("/")


def reachable_from_here(url):
    """False for a NIP-65 write relay that cannot answer from the public
    internet however long we wait: a private, loopback, link-local or CGNAT
    address, a `.local`/`.lan`/`.onion`/`localhost` name, or a bare hostname
    with no dot. Phone apps advertise their own on-device relay
    (`ws://192.168.x.x:4848`, `ws://100.111.x.x:4848`) in the user's relay
    list, and the outbox set carried ~130 of them — each walked daily, each
    costing a connect timeout per filter shape. Measured 2026-09-06 over the
    1,604-relay cache: 28 private IPs, 78 plain `ws://` (mostly those), 21
    local names. Only the structurally unreachable are dropped here; a dead
    public hostname is left to the parking rule, since a name can come back."""
    import ipaddress
    from urllib.parse import urlsplit
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").rstrip(".").lower()
        parts.port    # raises on a mangled port such as '4848 '
    except ValueError:
        return False
    if not host or "." not in host:
        return False
    if host == "localhost" or host.endswith((".local", ".lan", ".onion", ".localhost", ".internal", ".home", ".arpa")):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast \
            or ip.is_reserved or ip.is_unspecified:
        return False
    if ip.version == 4 and ip in ipaddress.ip_network("100.64.0.0/10"):   # CGNAT / Tailscale
        return False
    return True


def expand_via_outbox(booster_pubkeys, base_relays, max_workers=16, log=print):
    """Return base_relays ∪ every booster's NIP-65 write relays (deduped)."""
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed

    relays = {_norm(u) for u in base_relays}
    lock = threading.Lock()
    done = 0
    total = len(booster_pubkeys)

    def resolve(pk):
        try:
            return get_outbox_relays(pk) or []
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(resolve, pk): pk for pk in booster_pubkeys}
        for fut in as_completed(futs):
            new = fut.result()
            with lock:
                for u in new:
                    if isinstance(u, str) and u.startswith(("wss://", "ws://")) \
                            and reachable_from_here(u):
                        relays.add(_norm(u))
                done += 1
                if done % 50 == 0 or done == total:
                    log(f"    outbox resolved {done}/{total} boosters, {len(relays)} relays so far")
    return sorted(relays)
