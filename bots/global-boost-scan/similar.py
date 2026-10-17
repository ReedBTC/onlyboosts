"""Show similarity by distinct-booster overlap: the data behind the
recommendation rails (Recommended For You, Because You Boosted X).

For every show with at least MIN_BOOSTERS distinct boosters, its TOP most
similar shows by cosine over the booster sets:

    score = |A ∩ B| / sqrt(|A| · |B|)

One person counts once however many times they boosted, excluded and
duplicate rows are out through db.not_excluded(), and the candidates are
partitioned by medium side the way the feeds are (COALESCE(medium,'podcast')
= 'music' against everything else), so a podcast seeds podcast neighbours and
an album seeds music neighbours.

⚠️ THE RELAY-BOT PUBLISHER KEYS ARE NOT BOOSTERS HERE. Boostr_Bot, MSP_bot and
the other republishers sign one key across every donor they relay, so each
reads as one person who boosted hundreds of shows and manufactures overlap
between shows that share no listener. Measured 2026-10-17 on the live index:
with the keys in, 234 music shows cleared the floor and 6,627 music pairs
overlapped; with them out, 203 and 4,354. The set is clients.PUBLISHER_PUBKEYS
less chadf-boostbot, the same complement functions/api/v1/_common.js#PUBLISHERS
takes for the member wall: that bot publishes Chad's own boosts, so it is one
person.

The table changes slowly and is recomputed whole on the daily podroll run
(`onlyboosts_globalscan.py similar`), then replaced wholesale in D1 by
`d1_sync.py --remote-similar`, the podroll rule. Nothing is stored per
member: the edge POSTs a member's seed shows and sums scores over the
candidates, which is why the full top 20 is stored with `shared_boosters`
rather than a floor being applied here. A single-seed rail can floor at
shared_boosters >= 2 (half of all pairs share exactly one booster; the podcast
median score is 0.09 and the music median 0.24) and the summed rail can relax
it, without a resync.

Corpus at build time (2026-10-17): 2,530 boosted shows, 1,376 with one
booster; 455 podcast + 234 music shows at the floor of three; top-20 tables of
8.3k + 4.1k rows.
"""
import collections
import math

import clients
import db

TOP = 20
MIN_BOOSTERS = 3
MEMBER_BOT = "chadf-boostbot"


def excluded_pubkeys():
    """The relay-bot publisher keys: every registered publisher except the one
    that is also a member (see the module docstring)."""
    return {pk for pk, slug in clients.PUBLISHER_PUBKEYS.items() if slug != MEMBER_BOT}


def booster_sets(conn):
    """{show_guid: set(booster_pubkey)} over live boosts, plus {guid: side}."""
    eg = db.effective_guid("b")
    skip = excluded_pubkeys()
    sets = collections.defaultdict(set)
    side = {}
    for g, pk, sd in conn.execute(f"""
            SELECT {eg} AS g, b.booster_pubkey,
                   CASE WHEN COALESCE(s.medium,'podcast')='music'
                        THEN 'music' ELSE 'podcast' END
            FROM boosts b LEFT JOIN shows s ON s.podcast_guid = {eg}
            WHERE {eg} IS NOT NULL AND {db.not_excluded('b')}"""):
        if pk in skip:
            continue
        sets[g].add(pk)
        side[g] = sd
    return sets, side


def compute(conn, top=TOP, min_boosters=MIN_BOOSTERS):
    """Returns (rows, stats). Rows are (podcast_guid, other_guid, score,
    shared_boosters, rank) tuples, rank 1..top per show, ordered by score
    desc, shared desc, guid asc so the output is deterministic."""
    sets, side = booster_sets(conn)
    rows = []
    stats = {"shows": len(sets), "sides": {}}
    for sd in ("podcast", "music"):
        cand = [g for g in sets if side[g] == sd and len(sets[g]) >= min_boosters]
        inv = collections.defaultdict(list)
        for g in cand:
            for pk in sets[g]:
                inv[pk].append(g)
        shared = collections.Counter()
        for lst in inv.values():
            lst.sort()
            for i in range(len(lst)):
                for j in range(i + 1, len(lst)):
                    shared[(lst[i], lst[j])] += 1
        nb = collections.defaultdict(list)
        for (a, b), k in shared.items():
            sc = k / math.sqrt(len(sets[a]) * len(sets[b]))
            nb[a].append((sc, k, b))
            nb[b].append((sc, k, a))
        n_rows = 0
        for g, lst in nb.items():
            lst.sort(key=lambda x: (-x[0], -x[1], x[2]))
            for rank, (sc, k, other) in enumerate(lst[:top], 1):
                rows.append((g, other, round(sc, 6), k, rank))
                n_rows += 1
        stats["sides"][sd] = {"candidates": len(cand), "pairs": len(shared),
                              "with_neighbours": len(nb), "rows": n_rows}
    return rows, stats
