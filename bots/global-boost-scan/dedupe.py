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
AND one tier of corroborating evidence holds. Tier 0 below is the one
exception to `same sats`, and it is the strongest evidence of the four.

PAYMENT CLUSTERS REPLACED ONE-TO-ONE PAIRING ON 2026-10-29 (Reed's report:
Chad and Reed's show read as "almost every single one has a duplicate").
Three relay bots were restating every payment on that show — Boostr_Bot on
the 1% split, chadf-boostbot on Chad's node, candr_boost_bot on the show's
node — and most listeners boost from apps that publish no note of their own
(PodcastGuru, The Split Kit, v4vmusic-com), so the pairing above had nothing
non-relay to pair with and let two or three bot notes stand per payment.
Measured over 90 days before the change: 145 standing copies, 121,444 sats,
30 of them on that show. What changed, each against a measured failure:

  * A relay note's partner may be ANOTHER RELAY BOT'S note. A cluster holds
    at most one note per publisher (each bot publishes once per payment it
    sees) and at most one donor note; its keeper is the donor's note when
    there is one, else the bot note carrying the most of the payment (an
    episode, a sender name), else the earliest. A keeper may later be joined
    by a publisher its cluster does not hold, and a donor note arriving
    after two bots were paired takes the keeper's place (`repoint`), so the
    pass converges across ticks and across the scan order. 37 relay-only
    payments stood as two or three notes.
  * `same sats` is ±1 or ±3%, and a leg bot's x100 rounding (LEG_PUBLISHERS):
    candr prints what the node received (6,564 for 6,565; 100 for 101),
    BoostAfterBoost 426 and 429 for 420, Boostr 6,600 for 6,565. The exact
    key missed 18 donor-plus-bot pairs; it also hid 28 Local Bitcoiners
    publisher notes a sat off their Fountain partners over the whole corpus.
  * A missing episode on one side is a wildcard (chadf-boostbot's notes
    carry the show alone); two different episodes still never pair.
  * Evidence between two bot notes is read both ways: the sparser template's
    prose must sit inside the richer one's, and two bots printing the same
    sender name ("<name> boosted N sats") is a tier of its own (`name`). A
    donor note is still read one way: the bot's prose must sit inside it.
  * What a template prints is a fact, not prose: the sender's name, the show
    and episode titles AS PRINTED (a renamed episode's old title read as
    three shared words), a bot's `nostr:npub` mentions and hashtags unless
    the partner shares the word, "saying", "No message".

  Two bots naming two different senders are two payments, whatever else
  agrees. Only a relay-signed note is ever marked, as before. Full-history
  dry run on the day: 118 notes, 95,483 sats, 0 false pairs on inspection;
  what remains is same-publisher twins (identical prose, same sats, seconds
  apart: 62 within 30s, 54 of them chadf-boostbot's per-leg notes), which
  Reed's 2026-08-30 call below keeps. `test_dedupe_clusters.py`.

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

  0. named sender     The relay note NAMES the donor in a `["sender", npub]`
                      tag (Boostr_Bot does; chadf-boostbot never has) and a
                      non-relay note SIGNED BY THAT KEY sits on the same
                      episode and show within ±APP_WINDOW. The amount is not
                      consulted: this is the one tier that waives the hard
                      key's `same sats`, because Boostr_Bot reconstructs the
                      total from its own 1% leg and lands on the split's
                      rounding (100 for 123, 1200 for 1212, 600 for 566 —
                      11 of its first 25 partnered notes disagreed, 2026-09-24,
                      and every one of the 25 named exactly the key that
                      signed the partner). It is not a trusted claim: the
                      partner note's own signature is what verifies it. A
                      named donor with NO note of their own in the window is
                      let through and never falls back to tiers 1-3, since
                      pairing them with a note signed by somebody else would
                      pair two donors' payments. Nearest gap wins among a
                      donor's own burst of boosts to one episode (six such
                      bursts measured, the true partner ≤5s away in each).

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
  note's own "📱 via <App>" line or `app` tag where one exists; the app's domain in the
  note text (APP_DOMAINS) for apps the classifier leaves null. A bot that
  publishes none of these contributes no tier-2/3 evidence — by design.

  BOTH SIDES OF A COMPARISON ARE NORMALISED FIRST, AND EACH REPAIR CLOSED A
  MEASURED HOLE (2026-09-08, Reed's report of one visibly duplicated pair;
  the two together mark 3 relay notes over full history, 1,544 sats, and lose
  none):

    * A `nostr:npub1…` mention is resolved to the name this index holds for
      it, because the donor's app prints the URI where the bot prints `@Name`
      and `_TOKEN` strips the URI. One shared sentence therefore arrived as
      two runs too short to be evidence, and the bot's rendering of the name
      read as prose the partner contradicted — blocking a same-app pair 25
      seconds apart. See `_resolve_mentions`.
    * A note's own app name is neutralised from `note_app` and its via-line
      rather than from a list of app names, which is what lagged: an app not
      on any list read as the donor's only word, so a bot note with NO donor
      prose looked contradicted instead of taking tier 3. See `_app_words`.

  Rejected the same day, and worth not re-inventing: bridging the run across
  the stripped token (a wildcard word matching anything) needs no profile
  lookup and catches the pair, but it also paired an LB publisher note with a
  DIFFERENT payment's note 22 minutes away on an accidental 3-word run. The
  evidence has to be the same word, not a hole in the same place.

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
import json
import re
import sys
import time
from pathlib import Path

import clients
import db

if str(Path(__file__).resolve().parent.parent / "shared") not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))

from nostr_utils import npub_to_hex          # noqa: E402

# Publishers whose notes RESTATE a node payment other apps also publish notes
# for — the only droppable side. localbitcoiners checks this very index before
# publishing and so should never pair (its presence here is a safety net for a
# race, and a place to watch: a MATCH on an LB note means its dedupe failed).
# The other PUBLISHER_PUBKEYS entries are first-party and never belong here.
# boostr-bot joined 2026-09-10, its first hour live having produced two pairs
# against BoostMeBitch notes. Two relay notes of one payment (chadf-boostbot
# watching the sending node, boostr-bot the receiving leg) are NOT paired —
# the partner side is non-relay by construction — and stand as two boosts.
# msp-2-0 (MSP_bot, musicsideproject.com's 1% leg) joined 2026-10-02: five of
# its first nine notes restated a Fountain or BoostMeBitch note seconds away,
# every one carrying a `sender` tag naming the partner's signing key, so tier
# 0 is the one that pairs them (300 against Fountain's 333 — the same 1%-leg
# reconstruction as Boostr_Bot). Measured on the collector: the dry run
# marked exactly those five and nothing else. Its v4vmusic.com autoboost
# notes name no sender and have no partner to find, and stand.
# candr-boost (candr_boost_bot, Chad's watcher on the Chad and Reed node)
# joined 2026-10-20. It reports the full amount, so the hard key holds, and
# names no sender, so the prose tiers do the pairing: the body restates the
# donor's message and the `app` tag names the app, chadf-boostbot's shape.
# Measured on registration: 2 of its first 30 notes restated a BoostMeBitch
# note 14-17s earlier (111 sats each, tier msg+app); the other 28 came
# through apps that publish no note (The Split Kit, v4vmusic-com, CurioCaster,
# PodcastGuru) or had no partner within the window, and stand.
RELAY_PUBLISHERS = {"chadf-boostbot", "localbitcoiners", "boostr-bot", "msp-2-0",
                    "candr-boost", "boostafterboost"}

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
    "v4vmusic-com":  "via v4vmusic-com",   # its own notes: no client tag, "… via v4vmusic-com 🎵 …"
}

# Words both sides' templates restate about ANY boost; sharing them proves
# nothing. Lowercase, matched against normalized words.
TEMPLATE_VOCAB = set("""boost boosts boosted boostagram sats sat via user users
episode ep show podcast live stream to the a an and of for on by from with
this is at in zap zapped sent saying no message""".split())

_TOKEN = re.compile(r"(?:nostr:\S+|https?://\S+)")
_WORD = re.compile(r"[^\W_]+", re.UNICODE)
_VIA_LINE = re.compile("\N{MOBILE PHONE}\\s*via\\s+(.+?)\\s*(?:\\n|$)")
_MENTION = re.compile(r"nostr:(npub1[02-9ac-hj-np-z]{20,})")
_NAMES = {}


def _mention_name(conn, bech):
    """The display name OUR index holds for a mentioned npub, or "" if none."""
    if bech not in _NAMES:
        name = ""
        try:
            pk = npub_to_hex(bech)
            row = conn.execute("SELECT COALESCE(name, display_name) FROM "
                               "profiles WHERE pubkey=?", (pk,)).fetchone()
            if row and row[0]:
                name = str(row[0])
        except Exception:
            pass
        _NAMES[bech] = name
    return _NAMES[bech]


def _resolve_mentions(conn, text):
    """One mention, two renderings: the donor's app writes `nostr:npub1…` and
    the relay bot writes the profile's `@Name`. `_TOKEN` strips the URI, so the
    ONE sentence they share arrives as two short runs either side of the hole,
    and the bot's `reed` reads as prose the partner contradicts — which blocks
    even a same-app match 25 seconds apart, by design. Resolving the URI to the
    name this index already stores makes the two renderings the same word.

    It is not a loosening: an npub we hold no profile for still strips to
    nothing (fails closed), a name that disagrees with the bot's still
    contradicts, and every other tier is untouched. Measured over full history
    2026-09-08: 2 pairs found (both same-app, 25s and 27s apart), 0 lost.
    `nprofile1…` is deliberately not decoded — 2 in the corpus against 2,103
    npubs — and strips as before.
    """
    return _MENTION.sub(lambda m: " " + (_mention_name(conn, m.group(1)) or " ")
                        + " ", text or "")


def _words(text):
    return [w.lower() for w in _WORD.findall(_TOKEN.sub(" ", text or ""))]


def _app_words(row):
    """The app name THIS note prints about itself, which is never donor prose.

    Derived per note rather than read off a list, because the list is what
    lags: a bot note whose whole text was `⚡ 1111 sats /
    📱 via BoostMeBuddy` had `boostmebuddy` counted as the
    donor's own word — an app four months old and not in any literal here nor
    in clients.DISPLAY_NAMES, which labels a slug and does not gate it. So a
    no-prose note six seconds from its partner, same app on both sides, read
    as CONTRADICTED prose and was let through (1,111 sats, found 2026-09-08).
    `note_app` and the via-line answer for any app, including the next one."""
    words = set()
    app = note_app(row)
    if app:
        words.update(_words(app.replace("-", " ")))
    m = _VIA_LINE.search(row["message"] or "")
    if m:
        words.update(_words(m.group(1)))
    return words


# What a bot template prints about the boost besides the message: the show
# and episode titles in leading `[...]` groups (candr, BoostAfterBoost,
# BoostMeBuddy's own) and on a `📻`/`🎵` line (Boostr, MSP, Bowl After Bowl's
# own). The index's CURRENT titles are already facts (`_known_facts`); these
# are the titles AS PRINTED, which differ once a publisher renames an episode
# ("011. Full speed ahead" became "011. Leading with culture", and the old
# title read as three shared words of donor prose, 2026-10-29).
_BRACKET = re.compile(r"\[([^\]]{1,120})\]")
_FACT_LINE = re.compile("^[\N{RADIO}\N{MUSICAL NOTE}]\\s*(.+)$", re.MULTILINE)


def _template_facts(row):
    msg = row["message"] or ""
    words = set()
    first = msg.split("\n", 1)[0]
    for m in _BRACKET.finditer(first):
        words.update(_words(m.group(1)))
    for m in _FACT_LINE.finditer(msg):
        words.update(_words(m.group(1)))
    return words


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
    known.update(_words(" ".join(clients.DISPLAY_NAMES.values())))
    known.update(w for slug in clients.DISPLAY_NAMES
                 for w in _words(slug.replace("-", " ")))
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


def _sender_pubkey(row):
    """The donor a relay note names in its `["sender", npub]` tag, as hex —
    or None when there is no such tag, it does not decode, or it names the
    signer itself (a note that says "I sent this" carries no second party)."""
    try:
        tags = json.loads(row["raw_json"] or "{}").get("tags") or []
    except Exception:
        return None
    for t in tags:
        if len(t) >= 2 and t[0] == "sender" and str(t[1]).startswith("npub1"):
            try:
                pk = npub_to_hex(t[1])
            except Exception:
                return None
            return pk if pk != row["booster_pubkey"] else None
    return None


def _sender_match(conn, b, sender, claimed):
    """Tier 0 (see the module docstring): the non-relay note SIGNED BY the
    donor the relay note names, on the same episode and show, within
    ±APP_WINDOW, nearest first. Sats deliberately not in the key. Returns
    (partner, "sender", gap) or None."""
    ph = ",".join("?" * len(RELAY_PUBLISHERS))
    egb = db.effective_guid("b")
    cands = conn.execute(
        f"""SELECT * FROM boosts b
            WHERE b.booster_pubkey = ? AND b.created_at BETWEEN ? AND ?
              AND COALESCE(b.item_guid,'') = ? AND COALESCE({egb},'') = ?
              AND (b.client_id IS NULL OR b.client_id NOT IN ({ph}))
              AND b.excluded = 0 AND b.dup_of IS NULL AND b.event_id != ?""",
        [sender, b["created_at"] - APP_WINDOW, b["created_at"] + APP_WINDOW,
         b["item_guid"] or "", b["canonical_guid"] or b["podcast_guid"] or ""]
        + list(RELAY_PUBLISHERS) + [b["event_id"]]).fetchall()
    best = None
    for o in cands:
        if o["event_id"] in claimed:
            continue
        gap = abs(o["created_at"] - b["created_at"])
        if best is None or gap < best[2]:
            best = (o, "sender", gap)
    return best



# Relay bots that rebuild the TOTAL from their own 1% leg, so the amount they
# print is the split's rounding of the donor's (6,600 for 6,565; 300 for 333;
# 100 for 123). `_sats_close` admits that rounding for them alone.
LEG_PUBLISHERS = {"boostr-bot", "msp-2-0"}

# `<name> boosted <n> sats`: the sender's display name as the Boostr/MSP and
# candr/BoostAfterBoost templates (and BoostMeBitch's own) print it. Two notes
# that both print one are two statements about the same payment only if the
# names agree; a note that prints none says nothing.
_SENDER_LINE = re.compile(r"(?:^|\]\s*|\n)\s*([^\n\]]{1,80}?)\s+boosted\s+\u200b?[\d,]+\s+sats",
                          re.UNICODE)


def _sender_name(row):
    m = _SENDER_LINE.search(row["message"] or "")
    if not m:
        return None
    name = " ".join(m.group(1).split()).lower().lstrip("\u26a1\u2728\U0001f48b ").strip()
    return name or None


_HASHTAG = re.compile(r"#(\w+)", re.UNICODE)


def _bot_tokens(conn, row):
    """Words a relay note's mentions resolve to, plus its hashtags."""
    msg = row["message"] or ""
    words = set()
    for m in _MENTION.finditer(msg):
        words.update(_words(_mention_name(conn, m.group(1))))
    for m in _HASHTAG.finditer(msg):
        words.update(_words(m.group(1)))
    return words


def _sats_close(b, o):
    """The hard key's `same sats`, loosened to what the bots measurably do:
    candr reports what the node received (6,564 for 6,565; 100 for 101) and
    BoostAfterBoost 426 and 429 for a donor's 420, so ±1 sat or ±3%; a leg bot prints the 1% leg x100 (see LEG_PUBLISHERS)."""
    x, y = b["sats"], o["sats"]
    if x is None or y is None:
        return False
    if abs(x - y) <= max(1, 0.03 * max(x, y)):
        return True
    for leg, other in ((b, o), (o, b)):
        if leg["client_id"] in LEG_PUBLISHERS and leg["sats"] == round(other["sats"] / 100) * 100:
            return True
    return False


def _episode_compatible(b, o):
    """Equal item guids, or one side names no episode (chadf-boostbot's notes
    carry the show alone)."""
    return (not b["item_guid"] or not o["item_guid"] or b["item_guid"] == o["item_guid"])


def _evidence(conn, b, o):
    """The evidence tiers between a relay note `b` and a candidate `o`, which
    may be the donor's own note or ANOTHER relay bot's. Returns a tier name or
    None (no evidence, or contradicted prose: let through).

    Direction matters on the donor side and not between bots. A donor's note
    is the payment's own record, so the bot's prose must sit inside it; two
    bots restate the same payment with different templates (chadf-boostbot
    prints the message and no sender, candr prints sender and message), so
    the sparser one's prose must sit inside the richer one's."""
    gap = abs(o["created_at"] - b["created_at"])
    o_relay = o["client_id"] in RELAY_PUBLISHERS
    if gap > (APP_WINDOW if o_relay else MSG_WINDOW):
        return None
    known = (_known_facts(conn, b) | _app_words(b) | _app_words(o)
             | _template_facts(b) | _template_facts(o))
    nb, no = _sender_name(b), _sender_name(o)
    for name in (nb, no):
        if name:
            known.update(_words(name))   # the sender's name is a fact, not prose
    bw = _words(_resolve_mentions(conn, b["message"]))
    ow = _words(_resolve_mentions(conn, o["message"]))
    # A bot's mentions and hashtags are its template naming the sender, the
    # show, the recipient (chadf-boostbot prints the donor's npub, resolved
    # above to a name the donor's own note never contains; BoostAfterBoost
    # signs off with #bowlafterbowl #bowloftrust). They are facts unless the
    # partner shares the word, in which case they are the same evidence a
    # restated "@Name" has always been.
    known |= _bot_tokens(conn, b) - set(ow)
    if o_relay:
        known |= _bot_tokens(conn, o) - set(bw)
    b_prose = set(_distinctive(bw, known))
    o_prose = set(_distinctive(ow, known))
    if o_relay and nb and no and nb != no:
        return None                       # two bots naming two donors
    if _overlap_run(bw, ow, known) >= STRONG_OVERLAP:
        return "msg"
    if gap > APP_WINDOW:
        return None
    if o_relay:
        contained = b_prose <= set(ow) or o_prose <= set(bw)
    else:
        contained = b_prose <= set(ow)
    if not contained:
        return None                       # contradicted prose beats agreement
    if o_relay and nb and no and nb == no:
        return "name"
    b_app = note_app(b)
    if b_app is None or note_app(o) != b_app:
        return None
    return "msg+app" if (b_prose or (o_relay and o_prose)) else "app"


def _keeper(members):
    """Which note of a cluster is the record. The donor's own note always;
    among bot notes alone, the one carrying the most of the payment (an
    episode, a sender name), then the earliest."""
    own = [m for m in members if m["client_id"] not in RELAY_PUBLISHERS]
    if own:
        return min(own, key=lambda m: m["created_at"])
    return min(members, key=lambda m: (0 if m["item_guid"] else 1,
                                       0 if _sender_name(m) else 1,
                                       m["created_at"]))


def find_duplicates(conn, since=None):
    """Cluster relay-publisher notes with the other notes of the same payment.
    Read-only. Returns [(note, keeper, tier, gap_seconds)] for every note
    that is to be marked `dup_of keeper`; tier `repoint` is a note already
    marked whose cluster gained a better keeper (a donor note arriving after
    two bots had already been paired with each other).

    A cluster holds at most ONE note per publisher (each bot publishes once
    per payment it sees; the per-leg sibling rule is the exception) and at
    most one donor note. A note joins at most one cluster; a keeper may still
    be joined by a publisher its cluster does not hold yet, which is how a
    third bot's note lands on a pair marked in an earlier run."""
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

    # keeper -> publishers already in its cluster (from prior runs)
    members = {}
    for keeper, cid in conn.execute(
            "SELECT dup_of, client_id FROM boosts WHERE dup_of IS NOT NULL"):
        members.setdefault(keeper, set()).add(cid)
    for keeper in list(members):
        row = conn.execute("SELECT client_id FROM boosts WHERE event_id=?",
                           (keeper,)).fetchone()
        if row:
            members[keeper].add(row["client_id"])
    absorbed = set()          # notes marked or re-pointed in THIS run
    marked_by = {}            # relay event_id -> keeper, for the sibling rule

    egb = db.effective_guid("b")
    pairs = []
    for b in bots:
        if b["event_id"] in absorbed:
            continue
        own_pubs = members.get(b["event_id"], {b["client_id"]})
        sender = _sender_pubkey(b)
        chosen = {}           # slot -> (note, tier, gap); slot = "own" or a relay slug
        if sender:
            # Tier 0: a named donor is their own note or nothing (docstring).
            hit = _sender_match(conn, b, sender, absorbed)
            if hit is not None:
                chosen["own"] = hit
        cands = conn.execute(
            f"""SELECT * FROM boosts b
                WHERE b.created_at BETWEEN ? AND ? AND COALESCE({egb},'') = ?
                  AND b.excluded = 0 AND b.dup_of IS NULL AND b.event_id != ?
                  AND b.sats IS NOT NULL""",
            [b["created_at"] - MSG_WINDOW, b["created_at"] + MSG_WINDOW,
             b["canonical_guid"] or b["podcast_guid"] or "", b["event_id"]]).fetchall()
        for o in cands:
            if o["event_id"] in absorbed or not _episode_compatible(b, o) or not _sats_close(b, o):
                continue
            o_relay = o["client_id"] in RELAY_PUBLISHERS
            if o_relay:
                if o["client_id"] in own_pubs:
                    continue          # one note per publisher per payment
                o_pubs = members.get(o["event_id"], {o["client_id"]})
                if o_pubs & own_pubs:
                    continue
                slot = o["client_id"]
            else:
                if sender:
                    continue          # tier 0 owns the donor slot
                if "own" in own_pubs or any(p not in RELAY_PUBLISHERS for p in own_pubs):
                    continue
                slot = "own"
            tier = _evidence(conn, b, o)
            if tier is None:
                continue
            gap = abs(o["created_at"] - b["created_at"])
            if slot not in chosen or gap < chosen[slot][2]:
                chosen[slot] = (o, tier, gap)
        if not chosen:
            hit = _sibling_match(conn, b, marked_by)
            if hit is not None:
                o, tier, gap = hit
                absorbed.add(b["event_id"])
                marked_by[b["event_id"]] = o["event_id"]
                members.setdefault(o["event_id"], {o["client_id"]}).add(b["client_id"])
                pairs.append((b, o, tier, gap))
            continue
        cluster = [b] + [v[0] for v in chosen.values()]
        keeper = _keeper(cluster)
        pubs = set()
        for m in cluster:
            pubs |= members.get(m["event_id"], {m["client_id"]})
        members[keeper["event_id"]] = pubs
        for m in cluster:
            if m["event_id"] == keeper["event_id"]:
                continue
            tier, gap = ("self", 0)
            for v in chosen.values():
                if v[0]["event_id"] == m["event_id"]:
                    tier, gap = v[1], v[2]
            if m["event_id"] == b["event_id"]:
                # b joins: its tier is the strongest evidence that pulled it in
                best = min(chosen.values(), key=lambda v: v[2])
                tier, gap = best[1], best[2]
            absorbed.add(m["event_id"])
            marked_by[m["event_id"]] = keeper["event_id"]
            pairs.append((m, keeper, tier, gap))
            if m["event_id"] in members:
                # m kept a cluster of its own: its members follow it
                for old in conn.execute("SELECT * FROM boosts WHERE dup_of=?",
                                        (m["event_id"],)):
                    pairs.append((old, keeper, "repoint", 0))
                del members[m["event_id"]]
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
    for b, o, tier, _gap in pairs:
        conn.execute("UPDATE boosts SET dup_of=? WHERE event_id=?",
                     (o["event_id"], b["event_id"]))
        if tier == "repoint":
            continue              # already out of D1; only its keeper moved
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
    new = [p for p in pairs if p[2] != "repoint"]
    sats = sum(b["sats"] or 0 for b, *_ in new)
    print(f"[dedupe] {scope}: {len(new)} duplicate note(s), {sats:,} over-counted sats"
          + (" (dry run — nothing marked)" if dry_run else ""))
    for b, o, tier, gap in pairs:
        print(f"  [{tier}] {b['event_id'][:12]} ({b['client_id']}, via {b['client_via'] or '?'}) "
              f"= {o['event_id'][:12]} ({o['client_id'] or 'unclassified'}), "
              f"{b['sats']} sats, gap {gap}s")
    if not dry_run:
        apply(conn, pairs)
    return len(pairs)
