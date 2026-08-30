"""Duplicate boost notes: one payment, two Nostr notes, two rows in the index.

A relay bot watches a Lightning node and publishes a NIP-73 note for every
boost the node receives — regardless of whether the donor's app already
published one. `chadf-boostbot` is today's case (confirmed with Chad on the 4
notes at /episode/133f2ef1-…#boosts, which are two payments, 2026-08-24), but
the shape is general: any node-watching republisher duplicates every boost
made through an app that publishes its own notes, doubling the boost count,
the sats and (different signing keys) the booster count.

SCOPE. Only notes signed by a key in RELAY_PUBLISHERS are ever droppable.
A future bot is out of scope until its pubkey is registered in clients.py's
PUBLISHER_PUBKEYS — which the member wall already forces — and given a role
here. First-party publishers (BoostMeBitch's site key, our own bot, LB's show
account) are never the droppable side: their note IS the payment's note.

THE RULE. A relay note is a duplicate of exactly one partner when the hard key
holds — same sats, same item_guid, same effective show guid, pairing strictly
one-to-one (two same-amount boosts in one live-show hour keep both notes) —
AND one tier of corroborating evidence holds.

ONE-TO-ONE HAS ONE EXCEPTION, AND IT IS ON THE RELAY SIDE (2026-08-30).
chadf-boostbot signs one kind-9735 receipt and one note PER KEYSEND LEG, so a
multi-leg boost is two or three bot notes, identical except for the quoted
`nevent` (113 clusters over the corpus: 110 of two, 3 of three; every app, not
one). The pass marked the first bot note and the claim then blocked its
sibling from the same partner — 7 relay notes (6 BMB, 1 StableKraft; 6,232
sats) reached D1 that way, every one with a partner AND evidence. So after
the tiers fail, a relay note whose SIBLING — same publisher, same hard key,
identical prose once nostr:/URL tokens are stripped, within ±APP_WINDOW — is
already marked `dup_of P` is marked `dup_of P` too. Measured: it marks exactly
those 7 and can never touch a non-relay note, because it only ever attaches a
relay note to a partner the tiers already matched. What it deliberately is
NOT: a partnerless "identical siblings are one payment" rule. 233 same-author,
same-key, identical-text pairs within 300s exist among REAL notes (150 with
empty text — live-stream repeats), so identical text is not proof of one
payment; the 77 partnerless bot clusters (~51k sats) stay, by Reed's call,
and a second note never adds hours on #40HPW (DISTINCT booster+episode). The tiers are EVIDENCE SOURCES,
not conventions the bots are trusted to follow: a bot whose note format we
have never seen simply produces no evidence, and a pair with no evidence is
LET THROUGH (Reed's call, 2026-08-24: a duplicate slipping through is far
better than a real boost filtered out).

  1. strong message   The two notes share a run of the donor's own words:
                      the longest common contiguous word sequence, counting
                      only DISTINCTIVE words — not the episode/show title,
                      the artist, app names/domains, boost-template
                      vocabulary, or bare numbers, all of which both
                      templates restate from the same facts. ≥3 distinctive
                      words within ±MSG_WINDOW. Format-free by construction:
                      nothing here knows any bot's layout.

  2. weak message     The relay note's whole donor prose is 1–2 distinctive
     + app agreement  words (a name, a "Toast") and ALL of it appears in the
                      partner, AND both sides' publishing app is determinable
                      and equal. ±APP_WINDOW.

  3. no message       The relay note carries no donor prose at all, so app
     + app agreement  identity is the only evidence: both determinable and
                      equal. ±APP_WINDOW.

  Contradiction beats agreement: a relay note whose donor prose does NOT
  appear in the candidate is two different payments, and no app-identity
  match may override that (measured: the one same-app near-miss in the
  corpus, "DELTA OG!!!!" vs a different track's auto-boost, is exactly this).

  App identity is best-effort, in order: the classifier's answer (client_via
  names the app a relay note restates, client_id the publisher itself); the
  note's own "📱 via <App>" line where one exists; the app's domain in the
  note text (APP_DOMAINS) for apps the classifier leaves null. A bot that
  publishes none of these contributes no tier-2/3 evidence — by design.

  Measured on the full corpus 2026-08-24 (1,027 chadf-boostbot notes): 62
  duplicates — 42 BoostMeBitch, 14 StableKraft, 6 Bowl After Bowl — 25,265
  over-counted sats, max true-pair gap 162s. Distinctive-overlap separation
  between true pairs and same-key coincidences was total at ≥3 words; the
  651 same-amount/same-episode/minutes-apart pairs among NON-relay notes are
  distinct real payments and are untouchable by scope.

WHICH COPY IS KEPT: always the partner. It is the note the donor's own app
chose to publish, it may be donor-signed (the real member keeps the credit),
and the relay note is the restatement.

MECHANISM. A duplicate gets `dup_of = <kept event_id>` — its own column, NOT
`excluded`, because apply_excludes() recomputes that flag wholesale from
excludes.json on every connect and would silently unmark every dupe.
`db.not_excluded()` gates on both, so every published surface (shards, D1
projection, stats) drops the row in the same edit. D1 rows already pushed are
removed through the same `d1_reproject` queue an exclusion uses, and the
`d1_boosts_synced` marker is cleared so an UNMARKED row re-inserts on the next
delta — the whole thing is reversible by clearing the column.

Runs per-cycle over a trailing window (the relay bot lags its partner by ~1-3
minutes, but relay/scan order can deliver either side first, so unmarked
relay notes are re-evaluated every tick until the window ages them out).
"""
import re
import time

import db

# Publishers whose notes RESTATE a node payment other apps also publish notes
# for — the only droppable side. localbitcoiners checks this very index before
# publishing and so should never pair (its presence here is a safety net for a
# race, and a place to watch: a MATCH on an LB note means its dedupe failed).
# The other PUBLISHER_PUBKEYS entries are first-party and never belong here.
RELAY_PUBLISHERS = {"chadf-boostbot", "localbitcoiners"}

MSG_WINDOW = 30 * 60      # strong message corroboration: generous
APP_WINDOW = 10 * 60      # app-identity corroboration: tight
STRONG_OVERLAP = 3        # distinctive words in a common run = strong evidence

# The partner side of an app-identity match, for apps whose own notes the
# classifier leaves unclassified (no client tag, no publisher key): the app's
# domain in the note text is the fingerprint. Exact substring of a URL the app
# itself writes.
APP_DOMAINS = {
    "boostmebitch":  "boostmebitch.com",
    "stablekraft":   "stablekraft.app",
    "bowlafterbowl": "bowlafterbowl.com",
}

# Words both sides' templates restate about ANY boost; sharing them proves
# nothing. Lowercase, matched against normalized words.
TEMPLATE_VOCAB = set("""boost boosts boosted boostagram sats sat via user users
episode ep show podcast live stream to the a an and of for on by from with
this is at in zap zapped sent""".split())

_TOKEN = re.compile(r"(?:nostr:\S+|https?://\S+)")
_WORD = re.compile(r"[^\W_]+", re.UNICODE)
_VIA_LINE = re.compile("\N{MOBILE PHONE}\\s*via\\s+(.+?)\\s*(?:\\n|$)")


def _words(text):
    return [w.lower() for w in _WORD.findall(_TOKEN.sub(" ", text or ""))]


def _known_facts(conn, row):
    """Words both notes can derive from the boost itself: episode title, show
    title, artist/author, and every app's name. Sharing these is not evidence."""
    known = set(TEMPLATE_VOCAB)
    for slug, domain in APP_DOMAINS.items():
        known.add(slug)
        known.update(domain.split("."))
    known.update({"fountain", "castamatic", "podcastguru", "curiocaster",
                  "podverse", "onlyboosts", "localbitcoiners", "fm", "com",
                  "app", "social"})
    if row["item_guid"]:
        for t in conn.execute("SELECT title FROM episodes WHERE item_guid=?",
                              (row["item_guid"],)):
            known.update(_words(t[0]))
    eg = row["canonical_guid"] or row["podcast_guid"]
    if eg:
        for t in conn.execute(
                "SELECT title, author FROM shows WHERE podcast_guid=?", (eg,)):
            known.update(_words(t[0]))
            known.update(_words(t[1]))
    return known


def _distinctive(ws, known):
    return [w for w in ws if w not in known and not w.isdigit() and len(w) > 1]


def _overlap_run(a_words, b_words, known):
    """Distinctive-word count of the longest common contiguous word run."""
    best = 0
    prev = [0] * (len(b_words) + 1)
    for i, aw in enumerate(a_words, 1):
        cur = [0] * (len(b_words) + 1)
        for j, bw in enumerate(b_words, 1):
            if aw == bw:
                cur[j] = prev[j - 1] + 1
                run = a_words[i - cur[j]:i]
                best = max(best, len(_distinctive(run, known)))
        prev = cur
    return best


def note_app(row):
    """Which app this note claims to have come through, best effort: the
    classifier's answer (client_via names the app a relay note restates,
    client_id the publisher itself), else the note's own via-line, else a
    domain fingerprint. None = no claim, which contributes no evidence."""
    if row["client_via"]:
        return row["client_via"]
    if row["client_id"] and row["client_id"] not in RELAY_PUBLISHERS:
        return row["client_id"]
    msg = row["message"] or ""
    m = _VIA_LINE.search(msg)
    if m:
        import clients
        return clients.slugify(m.group(1))
    for slug, domain in APP_DOMAINS.items():
        if domain in msg:
            return slug
    return None


def _match(conn, b, cands, claimed):
    """The evidence tiers, against one relay note. Returns (partner, tier, gap)
    or None. `cands` already satisfy the hard key within MSG_WINDOW."""
    known = _known_facts(conn, b)
    bw = _words(b["message"])
    b_prose = set(_distinctive(bw, known))
    b_app = note_app(b)
    best = None
    for o in cands:
        if o["event_id"] in claimed:
            continue
        gap = abs(o["created_at"] - b["created_at"])
        ow = _words(o["message"])
        run = _overlap_run(bw, ow, known)
        apps_agree = b_app is not None and note_app(o) == b_app
        if run >= STRONG_OVERLAP:
            tier = "msg"
        elif b_prose and b_prose <= set(ow) and apps_agree and gap <= APP_WINDOW:
            tier = "msg+app"
        elif not b_prose and apps_agree and gap <= APP_WINDOW:
            tier = "app"
        else:
            continue          # no evidence, or contradicted prose: let it through
        if best is None or gap < best[2]:
            best = (o, tier, gap)
    return best


def find_duplicates(conn, since=None):
    """Pair unmarked relay-publisher notes against partner notes. Read-only.

    Returns [(relay_row, partner_row, tier, gap_seconds)], partner-claims
    one-to-one against both prior runs (dup_of already set) and this one.
    """
    ph = ",".join("?" * len(RELAY_PUBLISHERS))
    since_sql = "AND created_at >= ?" if since else ""
    args = list(RELAY_PUBLISHERS) + ([since] if since else [])
    bots = conn.execute(
        f"""SELECT * FROM boosts
            WHERE client_id IN ({ph}) AND excluded = 0 AND dup_of IS NULL
              AND sats IS NOT NULL {since_sql}
            ORDER BY created_at""", args).fetchall()
    if not bots:
        return []

    claimed = {r[0] for r in conn.execute(
        "SELECT dup_of FROM boosts WHERE dup_of IS NOT NULL")}
    marked_by = {}            # relay event_id -> partner, for THIS run's pairs

    egb = db.effective_guid("b")
    pairs = []
    for b in bots:
        cands = conn.execute(
            f"""SELECT * FROM boosts b
                WHERE b.sats = ? AND b.created_at BETWEEN ? AND ?
                  AND COALESCE(b.item_guid,'') = ? AND COALESCE({egb},'') = ?
                  AND (b.client_id IS NULL OR b.client_id NOT IN ({ph}))
                  AND b.excluded = 0 AND b.dup_of IS NULL AND b.event_id != ?""",
            [b["sats"], b["created_at"] - MSG_WINDOW, b["created_at"] + MSG_WINDOW,
             b["item_guid"] or "",
             b["canonical_guid"] or b["podcast_guid"] or ""]
            + list(RELAY_PUBLISHERS) + [b["event_id"]]).fetchall()
        hit = _match(conn, b, cands, claimed)
        if hit is None:
            hit = _sibling_match(conn, b, marked_by)
        if hit is not None:
            o, tier, gap = hit
            claimed.add(o["event_id"])
            marked_by[b["event_id"]] = o["event_id"]
            pairs.append((b, o, tier, gap))
    return pairs


def _prose_key(msg):
    """A note's text with every nostr:/URL token removed and whitespace
    folded — what two per-leg sibling notes share to the character."""
    return " ".join(_TOKEN.sub(" ", msg or "").split())


def _sibling_match(conn, b, marked_by):
    """The one-to-one exception (see the module docstring): a relay note whose
    identical sibling by the same publisher is already marked — in a prior run
    (dup_of) or earlier in this one (marked_by) — is a duplicate of that same
    partner. Returns (partner_row, "sibling", gap_to_sibling) or None. Never
    consults non-relay notes, so it cannot widen the partner side."""
    egb = db.effective_guid("b")
    sibs = conn.execute(
        f"""SELECT event_id, message, created_at, dup_of FROM boosts b
            WHERE b.client_id = ? AND b.sats = ? AND b.created_at BETWEEN ? AND ?
              AND COALESCE(b.item_guid,'') = ? AND COALESCE({egb},'') = ?
              AND b.excluded = 0 AND b.event_id != ?""",
        [b["client_id"], b["sats"],
         b["created_at"] - APP_WINDOW, b["created_at"] + APP_WINDOW,
         b["item_guid"] or "", b["canonical_guid"] or b["podcast_guid"] or "",
         b["event_id"]]).fetchall()
    key = _prose_key(b["message"])
    best = None
    for s in sibs:
        partner_id = s["dup_of"] or marked_by.get(s["event_id"])
        if not partner_id or _prose_key(s["message"]) != key:
            continue
        gap = abs(s["created_at"] - b["created_at"])
        if best is None or gap < best[1]:
            best = (partner_id, gap)
    if best is None:
        return None
    o = conn.execute("SELECT * FROM boosts WHERE event_id = ?", (best[0],)).fetchone()
    return (o, "sibling", best[1]) if o is not None else None


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
