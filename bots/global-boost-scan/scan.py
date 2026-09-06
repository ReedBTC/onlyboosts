#!/usr/bin/env python3
"""The tag-scoped scan engine — the one genuinely new primitive vs LB.

LB scans by author (`authors=[...]`); OnlyBoosts scans by NIP-73 tag across all
of Nostr and walks backward in time with an `until` cursor. Per relay:

    cursor = start (now for backfill)
    loop:
        page = REQ {kinds:[1], <one boost filter>, until:cursor, limit:N}
        if empty: stop
        hand page to callback (classify + upsert)
        oldest = min(created_at in page)
        if oldest >= cursor: stop        # relay ignores `until` — no progress
        cursor = oldest - 1
        checkpoint cursor
        if cursor <= floor: stop

Relays cap `limit` and retain history to different depths; we accept whatever a
page returns and keep walking until the floor, an empty page, or no progress.

THREE FILTER SHAPES, NOT ONE (since 2026-09-03). A boost note is found by:

    #k       {"kinds":[1], "#k":["podcast:guid","podcast:item:guid"]}
    #i       {"kinds":[1], "#i":["podcast:guid:<guid>", ...]}   per known show
    authors  {"kinds":[1], "authors":[<pubkey>, ...]}          per known booster

The `#k` shape was the only one until 2026-09-03, and it only matches a note
that carries a `k` tag. NIP-73 specifies one, but not every client sends it:
Fountain didn't until ~2025-04-14, and StableKraft and Wavlake's own app still
don't — measured 2026-09-03, 415 boosts since 2025-06-01 sat on the core relays
with `i` tags and no `k` tag (209 linking stablekraft.app, 140 fountain.fm, 65
wavlake.com), invisible to every scheduled pass because the relay never
returned them. The other two shapes don't need the tag: a note is found by the
show it names or the booster who signed it, both read from the index at the
start of each run, so a show or booster first seen through a `#k` note on one
tick is covered by the k-free shapes on the next. The residual is a first-time
booster boosting a show the index has never seen, without a `k` tag — no
filter Nostr offers reaches that.

`boost_filters()` builds the set; every scheduled walker takes it. Chunk sizes
and filters-per-REQ were probed on all 12 core relays (400-value filters and 12
filters per REQ accepted everywhere, none answered CLOSED or NOTICE).

⚠️ A MULTI-FILTER REQ CAN ONLY BE PAGED WHEN NO FILTER HITS THE CAP. Relays cap
each filter at ~500 events per REQ, and a REQ's `until` cursor is shared: if
filter A came back capped and filter B returned three old notes, stepping the
cursor to B's oldest skips A's middle. So the tail scan sends filters in
groups (one socket, one EOSE) and, if a group returns a page at the cap,
re-walks each of that group's filters on its own with the backward walker. The
backward walker never groups.

⚠️ `podtards.com` (and, less strictly, `relay.lexingtonbitcoin.org`) rate-limit
WebSocket HANDSHAKES, not messages: measured 2026-09-03, about 8–10 new
connections a minute pass whatever the spacing, then HTTP 429 for a while —
which `query_relay` reports as an empty page, so a walk that hits it records
the gap as "nothing there". The tail scan's 7 REQs per relay per tick fit
under that; a backward walk of all 67 shapes does not, and on that relay reads
mostly empty. Accepted: its paced deepscan re-walk added 5 boosts total, it is
near-fully redundant with relay.fountain.fm, and the tail scan is the path
that matters. `REQ_PAUSE` is the courtesy gap, not the fix.
"""

import time

from collector_common import RelayTimeout, query_relay

BOOST_FILTER_K = ["podcast:guid", "podcast:item:guid"]
PAGE_LIMIT = 500
PAGE_WALL_SECONDS = 45

GUIDS_PER_FILTER = 100      # `#i` values per filter
AUTHORS_PER_FILTER = 100    # pubkeys per filter
FILTERS_PER_REQ = 10        # filters sent over one socket on the tail scan
REQ_PAUSE = 0.5             # seconds between REQs to one relay (429 guard)


def boost_filters(known=None):
    """The filter set that finds a boost note: the `#k` shape first, then a `#i`
    filter per GUIDS_PER_FILTER known show guids and an `authors` filter per
    AUTHORS_PER_FILTER known boosters. `known` is {"guids": iterable, "authors":
    iterable}; with none given the set is the `#k` shape alone. Shapes carry no
    since/until/limit — the walkers stamp those."""
    filters = [{"kinds": [1], "#k": BOOST_FILTER_K}]
    known = known or {}
    guids = sorted(g for g in known.get("guids", ()) if g)
    authors = sorted(a for a in known.get("authors", ()) if a)
    for i in range(0, len(guids), GUIDS_PER_FILTER):
        chunk = guids[i:i + GUIDS_PER_FILTER]
        filters.append({"kinds": [1], "#i": [f"podcast:guid:{g}" for g in chunk]})
    for i in range(0, len(authors), AUTHORS_PER_FILTER):
        filters.append({"kinds": [1], "authors": authors[i:i + AUTHORS_PER_FILTER]})
    return filters


def _stamp(filt, until=None, since=None, limit=PAGE_LIMIT):
    f = dict(filt)
    f["limit"] = limit
    if until is not None:
        f["until"] = until
    if since is not None:
        f["since"] = since
    return f


def _page_filter(until, since=None, limit=PAGE_LIMIT):
    """The `#k` shape alone, stamped. Kept for callers that predate the set."""
    return _stamp(boost_filters()[0], until=until, since=since, limit=limit)


def _walk(relay, filt, floor_ts, start_until, on_page, checkpoint=None,
          log=print, max_empty=2, label="", deadline=None):
    """Walk ONE filter backward from `start_until` to `floor_ts`. Calls
    `on_page(events)` per page and, when given, `checkpoint(cursor,
    oldest_reached)` after each so a killed run resumes. Returns
    (oldest_reached, pages).

    Two ways out besides the floor, both leaving the checkpoint where the walk
    stood so the next run resumes rather than restarts:

    - `deadline` (a `time.monotonic()` instant) — the caller's wall budget.
      The outbox deep-walk has ~1,600 relays and a unit timeout that used to
      kill the whole run, sweep and export included, when they did not fit.
    - `RelayTimeout` — the handshake ran out its connect timeout. Until
      2026-09-06 that read as an empty page: the cursor stepped back a day,
      a second timeout ended the walk, and the relay came back the next run
      one day further along a two-year floor. 1,627 of 1,642 relays were
      "unfinished" that way. It is raised through to the caller, which is
      what lets the outbox count consecutive dead runs and park the relay."""
    cursor = start_until
    oldest_reached = start_until
    empty_streak = 0
    pages = 0
    while cursor is not None and cursor > floor_ts:
        if deadline is not None and time.monotonic() >= deadline:
            log(f"    {relay}{label}: wall budget spent at {_fmt(oldest_reached)} — resuming next run")
            if checkpoint:
                checkpoint(cursor, oldest_reached)
            return oldest_reached, pages
        if pages:
            time.sleep(REQ_PAUSE)
        try:
            page = query_relay(relay, _stamp(filt, until=cursor),
                               max_wall_seconds=PAGE_WALL_SECONDS,
                               raise_on_timeout=True)
        except RelayTimeout:
            if checkpoint:
                checkpoint(cursor, oldest_reached)
            raise
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
        if checkpoint:
            checkpoint(cursor, oldest_reached)
        if pages % 5 == 0:
            log(f"    {relay}{label}: {pages} pages, walked back to {_fmt(oldest_reached)}")
    if checkpoint:
        # mark complete: cursor exhausted / floor reached
        checkpoint(None if (cursor is None or cursor <= floor_ts) else cursor, oldest_reached)
    return oldest_reached, pages


def scan_relay_backward(relay, floor_ts, start_until, on_page, checkpoint,
                        log=print, max_empty=2, filters=None, deadline=None):
    """Walk one relay backward from `start_until` to `floor_ts` with every shape
    in `filters` (default: the `#k` shape alone). The FIRST filter is the one
    the checkpoint tracks — `scan_state` holds one cursor per relay, and that
    cursor has always described the `#k` walk. The k-free shapes are walked
    after it, each to the floor, with no checkpoint: a killed run redoes them,
    which costs pages rather than coverage. Returns the oldest created_at the
    checkpointed walk reached.

    `deadline` and `RelayTimeout` pass through from `_walk`; a timeout on any
    shape ends the relay's walk, since every remaining shape would pay the same
    connect timeout (67 shapes x 15s was the outbox's 2026-09-04 failure)."""
    filters = filters or boost_filters()
    oldest_reached, pages = _walk(relay, filters[0], floor_ts, start_until,
                                  on_page, checkpoint, log, max_empty,
                                  deadline=deadline)
    log(f"    {relay}: #k done — {pages} pages, oldest {_fmt(oldest_reached)}")
    extra = filters[1:]
    if extra:
        total = 0
        for n, filt in enumerate(extra, 1):
            if deadline is not None and time.monotonic() >= deadline:
                log(f"    {relay}: wall budget spent before k-free shape {n}/{len(extra)}")
                break
            time.sleep(REQ_PAUSE)
            _, pages = _walk(relay, filt, floor_ts, start_until, on_page, None,
                             log, max_empty, label=f" [{n}/{len(extra)}]",
                             deadline=deadline)
            total += pages
        log(f"    {relay}: {len(extra)} k-free filter(s) done — {total} pages")
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


def scan_relay_incremental(relay, since_ts, on_page, log=print, filters=None,
                           on_timeout=None):
    """Forward tail: everything since `since_ts`, every shape in `filters`
    (default: the `#k` shape alone). Filters go to the relay in groups of
    FILTERS_PER_REQ over one socket; a group whose page comes back at the cap
    is re-walked one filter at a time down to `since_ts`, since a capped page
    is a page with something missing (see the module docstring). Returns the
    newest created_at seen, clamped to now — an author walk returns whole
    timelines, and one future-dated note must not push the watermark past
    the present, where every later tick would start.

    `on_timeout(relay)`, when given, is called once if the relay's handshake
    times out and the rest of the tick is skipped — the outbox sweep uses it
    to count consecutive dead runs. The core tail scan passes nothing."""
    filters = filters or boost_filters()
    now = int(time.time())
    seen_ids = set()
    newest = since_ts
    reqs = 0

    def handle(page):
        nonlocal newest
        # Dedupe within the page too: podtards and lexingtonbitcoin send an
        # event once per filter it matches, so a multi-filter REQ can carry
        # the same note several times in one response (measured 2026-09-03).
        fresh = []
        for ev in page:
            eid = ev.get("id")
            if eid and eid not in seen_ids:
                seen_ids.add(eid)
                fresh.append(ev)
        if fresh:
            on_page(fresh)
            newest = max(newest, max(ev.get("created_at", since_ts) for ev in fresh))

    overflow = 0
    groups = [filters[i:i + FILTERS_PER_REQ]
              for i in range(0, len(filters), FILTERS_PER_REQ)]
    for gi, group in enumerate(groups):
        if reqs:
            time.sleep(REQ_PAUSE)
        # A relay whose handshake times out is skipped for the REST OF THIS
        # TICK, not retried per group: every group would run out the same
        # connect timeout, and the tick's wall budget is what a dead relay
        # eats (relay.mostr.pub, 2026-09-06: 7 x 15s on a 2-minute timer).
        # Only the timeout class is skipped — a 429'd handshake is a
        # half-second refusal and the next group usually passes (see the
        # podtards note in the module docstring). The groups it never sent
        # are covered by INCREMENTAL_OVERLAP on the next tick, the same
        # safety net an empty page from a down relay already relies on.
        try:
            page = query_relay(relay, [_stamp(f, since=since_ts) for f in group],
                               max_wall_seconds=PAGE_WALL_SECONDS,
                               raise_on_timeout=True)
        except RelayTimeout:
            reqs += 1
            log(f"    {relay}: handshake timed out on REQ {reqs} — skipping "
                f"its remaining {len(groups) - gi - 1} group(s) this tick")
            if on_timeout:
                on_timeout(relay)
            break
        reqs += 1
        handle(page)
        if len(page) >= PAGE_LIMIT:
            overflow += 1
            for filt in group:
                time.sleep(REQ_PAUSE)
                _walk(relay, filt, since_ts, now, handle, None, log)
    log(f"    {relay}: incremental +{len(seen_ids)} events over {reqs} REQ(s)"
        + (f", {overflow} group(s) re-walked at the cap" if overflow else "")
        + f" (newest {_fmt(min(newest, now))})")
    return min(newest, now)


def _fmt(ts):
    if not ts:
        return "?"
    return time.strftime("%Y-%m-%d", time.gmtime(ts))
