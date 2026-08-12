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
                    if isinstance(u, str) and u.startswith(("wss://", "ws://")):
                        relays.add(_norm(u))
                done += 1
                if done % 50 == 0 or done == total:
                    log(f"    outbox resolved {done}/{total} boosters, {len(relays)} relays so far")
    return sorted(relays)
