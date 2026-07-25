#!/usr/bin/env python3
"""The tag-scoped scan engine — the one genuinely new primitive vs LB.

LB scans by author (`authors=[...]`); OnlyBoosts scans by NIP-73 tag across all
of Nostr and walks backward in time with an `until` cursor. Per relay:

    cursor = start (now for backfill)
    loop:
        page = REQ {kinds:[1], "#k":[...podcast...], until:cursor, limit:N}
        if empty: stop
        hand page to callback (classify + upsert)
        oldest = min(created_at in page)
        if oldest >= cursor: stop        # relay ignores `until` — no progress
        cursor = oldest - 1
        checkpoint cursor
        if cursor <= floor: stop

Relays cap `limit` and retain history to different depths; we accept whatever a
page returns and keep walking until the floor, an empty page, or no progress.
"""

import time

from collector_common import query_relay

BOOST_FILTER_K = ["podcast:guid", "podcast:item:guid"]
PAGE_LIMIT = 500
PAGE_WALL_SECONDS = 45


def _page_filter(until, since=None, limit=PAGE_LIMIT):
    f = {"kinds": [1], "#k": BOOST_FILTER_K, "limit": limit}
    if until is not None:
        f["until"] = until
    if since is not None:
        f["since"] = since
    return f


def scan_relay_backward(relay, floor_ts, start_until, on_page, checkpoint,
                        log=print, max_empty=2):
    """Walk one relay backward from `start_until` to `floor_ts`. Calls
    `on_page(list_of_events)` per page and `checkpoint(cursor, oldest_reached)`
    after each, so a killed run resumes. Returns the oldest created_at reached."""
    cursor = start_until
    oldest_reached = start_until
    empty_streak = 0
    pages = 0
    while cursor is not None and cursor > floor_ts:
        page = query_relay(relay, _page_filter(until=cursor),
                           max_wall_seconds=PAGE_WALL_SECONDS)
        pages += 1
        if not page:
            empty_streak += 1
            if empty_streak >= max_empty:
                break
            # nudge the cursor back a day in case of a sparse gap, then retry
            cursor -= 86400
            continue
        empty_streak = 0
        on_page(page)
        oldest = min(ev.get("created_at", cursor) for ev in page)
        oldest_reached = min(oldest_reached, oldest)
        if oldest >= cursor:
            log(f"    {relay}: no progress at until={cursor} (relay ignoring `until`?) — stop")
            break
        cursor = oldest - 1
        checkpoint(cursor, oldest_reached)
        if pages % 5 == 0:
            log(f"    {relay}: {pages} pages, walked back to {_fmt(oldest_reached)}")
    # mark complete: cursor exhausted / floor reached
    checkpoint(None if (cursor is None or cursor <= floor_ts) else cursor, oldest_reached)
    log(f"    {relay}: done — {pages} pages, oldest {_fmt(oldest_reached)}")
    return oldest_reached


def fetch_events_by_ids(ids, relays, chunk=200, max_wall=30):
    """Batch-fetch events by id across `relays` — one REQ per chunk per relay
    instead of one connection per id. Returns {event_id: event}. Used to resolve
    the kind-9735 zap receipts a page of boosts quotes."""
    out = {}
    ids = [i for i in ids if i]
    for i in range(0, len(ids), chunk):
        c = ids[i:i + chunk]
        for relay in relays:
            need = [x for x in c if x not in out]
            if not need:
                break
            for ev in query_relay(relay, {"ids": need}, max_wall_seconds=max_wall):
                if ev.get("id"):
                    out[ev["id"]] = ev
    return out


def scan_relay_incremental(relay, since_ts, on_page, log=print):
    """Forward tail: everything since `since_ts` in one shot (small window)."""
    page = query_relay(relay, _page_filter(until=None, since=since_ts),
                       max_wall_seconds=PAGE_WALL_SECONDS)
    if page:
        on_page(page)
    newest = max((ev.get("created_at", since_ts) for ev in page), default=since_ts)
    log(f"    {relay}: incremental +{len(page)} events (newest {_fmt(newest)})")
    return newest


def _fmt(ts):
    if not ts:
        return "?"
    return time.strftime("%Y-%m-%d", time.gmtime(ts))
