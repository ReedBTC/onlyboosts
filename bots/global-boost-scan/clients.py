#!/usr/bin/env python3
"""Which app published a boost note — and, for relayed boosts, which app it came
from before that.

⚠️ THIS IS A DERIVED CLASSIFICATION, NOT A FIELD ANYONE PUBLISHED. The raw
`client` column stays exactly as signed (NIP-89 `["client", …]`); everything
here is our inference about it, which is why it lands in its own columns with a
`client_src` recording HOW each answer was reached. Never merge the two: a
reader has to be able to tell the publisher's own claim from our guess.

WHY IT EXISTS. The NIP-89 tag is on **1.3% of the corpus** (291 of 22,968), and
it is absent from the app that published ~94% of it. Measured across the whole
index, three signals cover almost everything:

  fountain.fm i-tag URL   21,615  94.1%   Fountain
  publisher pubkey         1,025   4.5%   relay/app accounts, below
  NIP-89 client tag          291   1.3%   apps that self-identify
  ---------------------------------------------------------------
  nothing                     ~39   0.2%

⚠️ THE PUBLISHER IS THE CLIENT; THE APP IT RELAYS IS NOT. `chadf_boostbot`
republishes boosts made in apps that do **not** speak NIP-73 — Castamatic,
StableKraft, PodcastGuru, CurioCaster, LN Beats, Podverse — and names them in
its own message body as `📱 via <App>`. Those apps therefore get `client_via`,
never `client_id`: they published nothing to Nostr, and crediting them as
clients would report six apps as supporting a spec none of them implement. The
bot is the client, and `via` is a subcategory under it.

That ordering is enforced structurally rather than by convention: the bot's
pubkey is tested FIRST, so a `client` tag naming a relayed app could never
promote it to client status. Today the bot signs no client tag at all (994 of
994), so the rule costs nothing and guards the case that would be wrong.

⚠️ `fountain.fm` AND `feeds.fountain.fm` ARE DIFFERENT THINGS. The first is the
app, linked from its own i-tags; the second is Fountain's RSS *hosting*, which
appears in a boost from any app to a show that happens to be hosted there — 24
of them, every one published by the bot. So the host is matched EXACTLY. A
substring test for "fountain.fm" reads Chad's PodcastGuru relays as Fountain.

Two signals were measured and deliberately not used. The `nostr:nevent` in a
Fountain note quotes a zap receipt whose author hint is a constant Fountain
pubkey, which sounds like a second identifier but adds **0** rows the i-tag rule
does not already have — so the bech32 decoder it would need is not worth
carrying. And a bare `via X` regex over message text finds 110 matches outside
the bot that are ordinary prose ("Ark is amazing.", "…exporting products via
NIP-99!"), so `via` is only ever read from the bot's own structured line.
"""
import re
from urllib.parse import urlparse

# Accounts that publish boosts on behalf of other apps. These ARE clients — they
# are what actually signed and published the note — and the app the boost came
# from lands in `client_via`. Identified by pubkey because neither signs a NIP-89
# tag, and because a pubkey is the one thing about a publisher that cannot be
# spoofed by note content.
#
# `chadf_boostbot@bitpunk.fm` is the big one: 994 boosts relaying six apps that
# speak no NIP-73 at all. `lnaddress music app` publishes its own, and is here
# rather than left unattributed because it does exactly what the bot does —
# signs the note, names the originating app in the body.
#
# The Local Bitcoiners SHOW ACCOUNT is the third, and it is the same case again:
# roughly a quarter of that show's boosts (Castamatic, PodcastGuru and
# CurioCaster keysends, anonymous website boosts, Fountain boosts from donors
# with no linked Nostr identity) never produced a donor-signed note, so the show
# account publishes one carrying the payment evidence and it counts as the
# boost. Those notes name the originating app in the same `📱 via <App>` line
# `_VIA_RE` already reads, so the app lands in `client_via` and never in
# `client_id` — a keysend from Castamatic published nothing to Nostr.
#
# ⚠️ THE SHOW ACCOUNT ALSO SIGNS ITS OWN BOOSTS, from the LB widget, and those
# carry no `via` line. They classify as `localbitcoiners` with no `via`, which
# is correct, so the two cases need no separating rule.
#
# ⚠️ THE PUBKEY IS TESTED BEFORE THE `client` TAG, AND THAT MATTERS HERE. These
# notes carry `["client","localbitcoiners.com"]`, which resolves to the same
# slug through SLUG_ALIASES, so today the precedence changes only `client_src`
# (client-tag → publisher-pubkey) — but it is what makes the `via` line readable
# at all, since the tag path returns before it is looked for.
PUBLISHER_PUBKEYS = {
    "f3bd42a91af5f3f1c40ca45ad2269464ab79996b32da78e8ed2ab91111b08e65": "chadf-boostbot",
    "d35ae076512c29b01a5b33aa764ed4db44a9d0bbd96009705f48101f6cfe76a2": "lnaddress-music",
    "c330881e28768381dd8bdfd274341dca0c5882c29b8642ea4bc82f7563264592": "localbitcoiners",
}

# Fountain links its own episode/show pages from the URL slot of each NIP-73
# i-tag. Exact host — see the warning above.
FOUNTAIN_HOST = "fountain.fm"

# `📱 via <App>`, the bot's own attribution line. Anchored on the emoji rather
# than the word so it cannot match prose; the 54 bot notes without it are its
# early tests and correctly resolve to the bot with no `via`.
_VIA_RE = re.compile(r"\N{MOBILE PHONE}\s*via\s+(.+?)\s*(?:\n|$)")

# Display names for the slugs we mint. A slug not listed here still classifies —
# it just renders as its slug — so a new client appearing in the wild is a
# missing label rather than a missing row.
DISPLAY_NAMES = {
    "fountain":        "Fountain",
    "chadf-boostbot":  "ChadF Boost Bot",
    "boostmebitch":    "BoostMeBitch",
    "localbitcoiners": "Local Bitcoiners",
    "bowlafterbowl":   "Bowl After Bowl",
    "onlyboosts":      "OnlyBoosts",
    "pv4v":            "PV4V",
    "castamatic":      "Castamatic",
    "stablekraft":     "StableKraft",
    "podcastguru":     "PodcastGuru",
    "curiocaster":     "CurioCaster",
    "ln-beats":        "LN Beats",
    "podverse":        "Podverse",
    "podcast-index":   "Podcast Index",
    "boostcli":        "BoostCLI",
}

# Self-identified names that are the same product under two spellings. Kept
# deliberately short: a slug is opaque and unique enough that merging two of
# them is a CLAIM about them being one app, and a wrong merge silently reports
# two projects as one. `v4v-music` / `v4vmusic-com` and `itdv-app` /
# `itdv-lightning` are each plausibly one thing and are NOT merged here for
# exactly that reason — if they are, that is a display decision made with
# knowledge this module does not have.
SLUG_ALIASES = {
    "localbitcoiners-com": "localbitcoiners",
    "onlyboosts-social":   "onlyboosts",
    "boostmebitch-com":    "boostmebitch",
    "lnbeats":             "ln-beats",
}


def slugify(name):
    """A display name → a stable lowercase slug, or None if nothing survives."""
    if not name:
        return None
    s = re.sub(r"[^a-z0-9]+", "-", str(name).strip().lower()).strip("-")
    if not s or len(s) > 40:
        return None
    return SLUG_ALIASES.get(s, s)


def display_name(slug):
    """Label for a slug. Falls back to the slug so an unlabelled client renders."""
    return DISPLAY_NAMES.get(slug, slug)


def _itag_hosts(event):
    hosts = set()
    for t in event.get("tags") or []:
        if t and len(t) >= 3 and t[0] == "i":
            url = t[2]
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                try:
                    hosts.add(urlparse(url).netloc.lower())
                except ValueError:
                    pass
    return hosts


def classify_client(event):
    """Signed event → {client_id, client_via, client_src}.

    `client_src` is the provenance and is the point of the whole function:
      publisher-pubkey — the author is a known publishing account
      client-tag       — the note's own NIP-89 tag
      fountain-itag    — a fountain.fm URL in the NIP-73 i-tag
      None             — unattributed, and left that way

    Order is precedence and is load-bearing; see the module docstring.
    """
    if not isinstance(event, dict):
        return {"client_id": None, "client_via": None, "client_src": None}

    # 1. A known publisher account, first so no tag can promote a relayed app
    #    to client status.
    slug = PUBLISHER_PUBKEYS.get(event.get("pubkey"))
    if slug:
        m = _VIA_RE.search(event.get("content") or "")
        via = slugify(m.group(1)) if m else None
        return {
            "client_id":  slug,
            # A publisher naming itself as the origin is not a subcategory of
            # itself — that reads as a relay of something else on every surface.
            "client_via": via if via and via != slug else None,
            "client_src": "publisher-pubkey",
        }

    # 2. The publisher's own claim.
    for t in event.get("tags") or []:
        if t and len(t) >= 2 and t[0] == "client":
            tagged = slugify(t[1])
            if tagged:
                return {"client_id": tagged, "client_via": None, "client_src": "client-tag"}

    # 3. Fountain, by the URL it links from its own i-tags. Exact host.
    if FOUNTAIN_HOST in _itag_hosts(event):
        return {"client_id": "fountain", "client_via": None, "client_src": "fountain-itag"}

    # 4. Unattributed. Deliberately not guessed — an unknown client is a fact
    #    about our coverage, and inventing one would hide it.
    return {"client_id": None, "client_via": None, "client_src": None}
