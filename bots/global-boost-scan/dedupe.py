"""Duplicate boost notes: one payment, two Nostr notes, two rows in the index.

`chadf-boostbot` watches Chad's LND node and publishes a NIP-73 note for every
boost the node receives — regardless of whether the app the donor used already
published one. That was the right behaviour when no app did; now BoostMeBitch,
StableKraft, Bowl After Bowl's site (and this site) publish their own notes, so
a boost made through one of them lands in this index twice: once under the
app's note, once under the bot's, doubling the boost count, the sats and
(because the two notes are signed by different keys) the booster count.
Confirmed with Chad on the 4 notes at /episode/133f2ef1-…#boosts, which are two
payments (2026-08-24).

THE RULE. A REPUBLISHERS note is a duplicate of exactly one partner note when:

  • same sats, same item_guid, same effective show guid (canonical-aware);
  • the partner is not itself a republisher's note, not excluded, not already
    claimed as somebody's partner (pairing is one-to-one, which is what lets
    two same-amount boosts in one live-show hour keep both their notes); and
  • ONE of two tiers of corroboration holds:

      msg-match      the donor's own message — the bot note stripped of its
                     boilerplate (the "⚡ N sats" line, the "📱 via App" line,
                     bare URLs and nostr: tokens) — appears verbatim inside the
                     partner's message, within ±MSG_WINDOW. Where both sides
                     name an app, they must agree.

      no-msg + app   the bot note carries no donor message, so the only
                     corroboration is agreement of app identity: the bot's own
                     `📱 via <App>` line (client_via) names the app whose note
                     the partner is — by the partner's client_id, or by the
                     app's domain in the partner's message text for apps the
                     classifier leaves null (StableKraft). Tight window.

  Measured on the full corpus 2026-08-24: 62 of 1,027 bot notes pair (42
  BoostMeBitch, 14 StableKraft, 6 Bowl After Bowl), max observed gap 162s, and
  every long-gap / cross-app candidate the looser drafts of this rule matched
  turned out to be two different payments. The windows are generous multiples
  of the observed lag, not guesses.

WHAT IS DELIBERATELY NOT MATCHED. Same person, same amount, same episode,
minutes apart, from ONE app — that is two real payments with one note each
(live-show boost storms, Chad's test runs: 651 such pairs live in the corpus).
Amount+guid+time alone would eat them, which is why the corroboration tiers
exist and why the scope is the republisher's notes only, never the app's own.

WHICH COPY IS KEPT: always the app's. It is the note the donor's own app chose
to publish, it may be donor-signed (the real member gets the credit), and the
bot note is the relay of it.

MECHANISM. A duplicate gets `dup_of = <kept event_id>` — its own column, NOT
`excluded`, because apply_excludes() recomputes that flag wholesale from
excludes.json on every connect and would silently unmark every dupe.
`db.not_excluded()` gates on both, so every published surface (shards, D1
projection, stats) drops the row in the same edit. D1 rows already pushed are
removed through the same `d1_reproject` queue an exclusion uses, and the
`d1_boosts_synced` marker is cleared so an UNMARKED row re-inserts on the next
delta — the whole thing is reversible by clearing the column.

Runs per-cycle over a trailing window (the bot lags its partner by ~1-3
minutes, but relay/scan order can deliver either side first, so unmarked bot
notes are re-evaluated every tick until the window ages them out).
"""
import re
import time

import db

# Publishers whose notes RESTATE a node payment other apps also publish notes
# for. Scope is deliberately this and not all of PUBLISHER_PUBKEYS: the LB show
# account and our own bot publish ONLY when no other note exists (LB checks this
# very index first), so their notes are never the second copy.
REPUBLISHERS = {"chadf-boostbot"}

MSG_WINDOW = 30 * 60      # donor-message corroboration: generous
EMPTY_WINDOW = 10 * 60    # app-identity corroboration only: tight
MIN_MSG = 4               # a donor message shorter than this is no evidence

# The partner side of an app-identity match, for apps whose own notes the
# classifier leaves unclassified (no client tag, no publisher key): the app's
# domain in the note text is the fingerprint. Exact substring of a URL the app
# itself writes.
APP_DOMAINS = {
    "boostmebitch":  "boostmebitch.com",
    "stablekraft":   "stablekraft.app",
    "bowlafterbowl": "bowlafterbowl.com",
}

_SATS_LINE = re.compile(r"^\s*⚡\s*[\d,.]+\s*sats?\s*$", re.I)
_VIA_LINE = re.compile(r"^\s*\N{MOBILE PHONE}\s*via\s+", re.I)
_TOKEN = re.compile(r"(?:nostr:\S+|https?://\S+)")


def donor_message(text):
    """The donor's own words out of a republisher note: every line minus the
    sats line, the via line, and any URL / nostr: tokens (the bot appends npub
    mentions inline on the donor's line)."""
    keep = []
    for ln in (text or "").splitlines():
        if _SATS_LINE.match(ln) or _VIA_LINE.match(ln):
            continue
        ln = _TOKEN.sub("", ln).strip()
        if ln:
            keep.append(ln)
    return " ".join(keep)


def _norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def partner_app(row):
    """Which app published this (non-republisher) note, best effort: the
    classifier's answer, else the domain fingerprint. None = undeterminable."""
    if row["client_id"]:
        return row["client_id"]
    msg = row["message"] or ""
    for slug, domain in APP_DOMAINS.items():
        if domain in msg:
            return slug
    return None


def find_duplicates(conn, since=None):
    """Pair unmarked republisher notes against partner notes. Read-only.

    Returns [(bot_row, partner_row, tier, gap_seconds)], partner-claims
    one-to-one against both prior runs (dup_of already set) and this one.
    """
    ph = ",".join("?" * len(REPUBLISHERS))
    since_sql = "AND created_at >= ?" if since else ""
    args = list(REPUBLISHERS) + ([since] if since else [])
    bots = conn.execute(
        f"""SELECT * FROM boosts
            WHERE client_id IN ({ph}) AND excluded = 0 AND dup_of IS NULL
              AND sats IS NOT NULL {since_sql}
            ORDER BY created_at""", args).fetchall()
    if not bots:
        return []

    claimed = {r[0] for r in conn.execute(
        "SELECT dup_of FROM boosts WHERE dup_of IS NOT NULL")}

    egb = db.effective_guid("b")
    pairs = []
    for b in bots:
        dm = _norm(donor_message(b["message"]))
        has_msg = len(dm) >= MIN_MSG
        window = MSG_WINDOW if has_msg else EMPTY_WINDOW
        cands = conn.execute(
            f"""SELECT * FROM boosts b
                WHERE b.sats = ? AND b.created_at BETWEEN ? AND ?
                  AND COALESCE(b.item_guid,'') = ? AND COALESCE({egb},'') = ?
                  AND (b.client_id IS NULL OR b.client_id NOT IN ({ph}))
                  AND b.excluded = 0 AND b.dup_of IS NULL AND b.event_id != ?""",
            [b["sats"], b["created_at"] - window, b["created_at"] + window,
             b["item_guid"] or "",
             b["canonical_guid"] or b["podcast_guid"] or ""]
            + list(REPUBLISHERS) + [b["event_id"]]).fetchall()
        best = best_tier = best_gap = None
        for o in cands:
            if o["event_id"] in claimed:
                continue
            gap = abs(o["created_at"] - b["created_at"])
            pa = partner_app(o)
            if has_msg:
                # Where both sides name an app they must agree; either side
                # unknown is allowed — the message match is the evidence.
                if b["client_via"] and pa and pa != b["client_via"]:
                    continue
                if dm not in _norm(o["message"]):
                    continue
                tier = "msg-match"
            else:
                # No donor message: app identity is the ONLY corroboration, so
                # both sides must be known and equal.
                if not b["client_via"] or pa != b["client_via"]:
                    continue
                tier = "app-match"
            if best is None or gap < best_gap:
                best, best_tier, best_gap = o, tier, gap
        if best is not None:
            claimed.add(best["event_id"])
            pairs.append((b, best, best_tier, best_gap))
    return pairs


def apply(conn, pairs):
    """Mark each duplicate and stage its removal from D1, mirroring what
    apply_excludes() does for a newly-listed boost: clear the synced marker (so
    an unmarked row would re-insert via the ordinary delta) and queue the boost
    delete plus the show/episode/profile recounts."""
    queue = []
    for b, o, _tier, _gap in pairs:
        conn.execute("UPDATE boosts SET dup_of=? WHERE event_id=?",
                     (o["event_id"], b["event_id"]))
        conn.execute("DELETE FROM d1_boosts_synced WHERE event_id=?",
                     (b["event_id"],))
        queue.append(("boost", b["event_id"]))
        pod = b["canonical_guid"] or b["podcast_guid"]
        for kind, val in (("podcast", pod), ("episode", b["item_guid"]),
                          ("profile", b["booster_pubkey"])):
            if val:
                queue.append((kind, val))
    conn.executemany("INSERT OR IGNORE INTO d1_reproject (kind,id) VALUES (?,?)",
                     queue)
    conn.commit()
    return len(pairs)


def run(conn, days=7, dry_run=False):
    """One pass: find, report, and (unless dry_run) apply."""
    since = int(time.time()) - days * 86400 if days else None
    pairs = find_duplicates(conn, since=since)
    scope = f"last {days}d" if days else "full history"
    if not pairs:
        print(f"[dedupe] {scope}: no new duplicates")
        return 0
    sats = sum(b["sats"] or 0 for b, *_ in pairs)
    print(f"[dedupe] {scope}: {len(pairs)} duplicate note(s), {sats:,} over-counted sats"
          + (" (dry run — nothing marked)" if dry_run else ""))
    for b, o, tier, gap in pairs:
        print(f"  [{tier}] {b['event_id'][:12]} (bot, via {b['client_via'] or '?'}) "
              f"= {o['event_id'][:12]} ({o['client_id'] or 'unclassified'}), "
              f"{b['sats']} sats, gap {gap}s")
    if not dry_run:
        apply(conn, pairs)
    return len(pairs)
