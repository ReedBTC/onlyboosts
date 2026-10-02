# Who Published A Boost

*Split out of `CLAUDE.md` on 2026-08-29, when that file passed its size budget.
This is the authority for the subject; `CLAUDE.md` keeps the rules a change would
break and points here for the arguments and the measurements. Nothing was rewritten
on the way across — `git log -S <symbol> -- CLAUDE.md` still finds any paragraph
that used to live there.*

---

## Who published a boost: `client_id`

`clients.py` in the collector, `client_id` / `client_via` / `client_src` on
`boosts`, `client_id` + `client_via` in D1 and the shards, `GET /api/v1/clients`
for the breakdown. **A derived classification, not a field anyone published** —
the raw `client` column stays exactly as signed and is never overwritten, which
is why the derivation lands in its own columns with a `client_src` recording how
each answer was reached.

**The NIP-89 `client` tag is on 1.3% of the corpus** (291 of 22,968) and is
absent from the app behind ~94% of it, so reading the tag alone reports the
ecosystem as five hobby projects. Three signals cover everything but 39 boosts:

| signal | boosts | `client_src` |
|---|---|---|
| `fountain.fm` URL in the NIP-73 i-tag | 21,615 | `fountain-itag` |
| a known publisher pubkey | 1,025 | `publisher-pubkey` |
| the NIP-89 tag itself | 291 | `client-tag` |
| nothing — left **null**, never guessed | 39 | — |

Live: `fountain` 21,615 · `chadf-boostbot` 994 · `boostmebitch` 193 ·
`localbitcoiners` 70 · `lnaddress-music` 31 · `bowlafterbowl` 18 · `onlyboosts` 8
· `pv4v` 2.

**⚠️ THE PUBLISHER IS THE CLIENT; THE APP IT RELAYS IS NOT.** `chadf-boostbot`
republishes boosts made in apps that speak **no NIP-73 at all** — Castamatic 294,
StableKraft 260, PodcastGuru 157, CurioCaster 56, LN Beats 21, Podverse 3 —
naming each in its own message body as `📱 via <App>`. Those apps land in
`client_via`, nested under the bot, and are **never** promoted to `client_id`:
they published nothing to Nostr, and listing them as clients would credit six
apps with supporting a spec none of them implement. `/api/v1/clients` returns
them nested rather than flat so a consumer cannot accidentally merge the two.

That precedence is structural, not conventional — the publisher pubkey is tested
**first**, so a `client` tag naming a relayed app could never promote it.

Three measurements that shaped the rules, each of which would otherwise be a
plausible-looking mistake:

- **⚠️ `fountain.fm` and `feeds.fountain.fm` are different things.** The first is
  the app, linked from its own i-tags; the second is Fountain's RSS *hosting*,
  which appears in a boost from any app to a show hosted there — 24 of them, every
  one published by the bot. The host is matched **exactly**; a substring test reads
  Chad's PodcastGuru relays as Fountain.
- **A bare `via X` regex over message text is unusable.** It finds 110 matches
  outside the bot that are ordinary prose ("Ark is amazing.", "…exporting products
  via NIP-99!"), so `via` is only ever read from the bot's own emoji-anchored line.
- **The `nostr:nevent` in a Fountain note** quotes a zap receipt whose author hint
  is a constant Fountain pubkey — a real second identifier that adds **0** rows the
  i-tag rule doesn't already have, so the bech32 decoder it needs isn't carried.

`SLUG_ALIASES` is deliberately tiny. A slug is opaque and unique, so merging two
is a **claim** that two projects are one; `v4v-music`/`v4vmusic-com` and
`itdv-app`/`itdv-lightning` are each plausibly one thing and are **not** merged,
because that is a display decision made with knowledge the module doesn't have.

**Re-derivation, not a backfill.** `onlyboosts_globalscan.py reclassify-clients`
recomputes every row from `raw_json`, so a rule change is an edit plus a re-run;
new boosts are classified inline at ingest by `classify.py`. **⚠️ The boost delta
is `INSERT OR IGNORE`** and will not update a column on a row D1 already has, so
a re-derivation reaches the query layer only through
`d1_sync.py --remote-clients`, which emits UPDATEs. Nothing else re-pushes them.

**The boost note cards render it**, as a `via <App>` chip in the meta row
beside the sats. Two renderers print it — `boost-list.js#boostRow` (the
`#boosts` section on all four detail pages) and `boosts-feed.js` (the Members
feed) — and the shared part is the label table, `assets/js/client-label.js`.

**⚠️ THAT TABLE IS TWO-SIDED AND THAT IS WHY IT MOVED.** It was declared inside
`functions/api/v1/clients.js`, which a card renderer running at the edge *and*
in the browser cannot import from; that endpoint now imports it instead. The
Boosts feed also had a **third** copy, keyed on the RAW `client` tag with
domain-shaped keys and a suffix-stripping fallback — deleted, because the tag is
on 1.3% of the corpus where `client_id` covers 99.8%.

**⚠️ THE CHIP NAMES THE PUBLISHER, NEVER `client_via`.** *Reed's call,
2026-08-24.* A relayed boost carries the listener's own app there (Castamatic
294, StableKraft 260, PodcastGuru 159 …) and showing it would answer a more
interesting question — but the note was published by the bot and **the booster
credited on that same card is the bot**, so "via Castamatic" beside a bot's name
and face is two claims in one row. The origin app is still in the record and
still nested on `/api/v1/clients`.

**⚠️ AN UNATTRIBUTABLE BOOST GETS NO CHIP.** `hasClientLabel` is the gate. A
chip reading "via Unattributed" would state our own coverage gap in the position
a reader expects an app's name. `unattributed` is a real row on
`/api/v1/clients` and is deliberately not a card label.

**⚠️ ALL THREE PAGE QUERIES HAD TO SELECT `b.client_id`, and forgetting one is
the two-sided bug.** Those queries are hand-written rather than `BOOST_SELECT`,
so the edge would have rendered no chip while a re-sort — which refetches
through `/api/v1` and `rowsFromRecords` — added one to every row.
`test-boost-row.mjs`'s round-trip check is what catches it, and was confirmed to
go red when `client_id` is dropped from the adapter.

**The episode-card drawer rows deliberately do NOT carry it.** They are a
different component (`.pcast-boost-*`, not `.ob-boost-*`) with a denser row, and
adding it would mean putting `client_id` on `?include=boosts`, which every
homepage card downloads. Not a rule, just untouched scope.

**Still open: `/stats`.** A "boosts by app" breakdown is what
`/api/v1/clients` was built for and still has no surface.

### Boostr_Bot Publishes For Any Split That Names It

Registered 2026-09-10, on Reed's instruction, the day it went live.
`adab4ccd…0649` (`npub14k45enf…97740t`) is the **sixth** entry in
`PUBLISHER_PUBKEYS` and the fifth in the site's `PUBLISHERS`. Its profile
says what it is: *"I republish Podcasting 2.0 boostagrams to Nostr. Add
boostr@getalby.com as a 1% split in your value block and your boosts show up
here"*, marked alpha. A podcaster opts a show in by adding the leg, and the
bot then publishes one note per boost that leg receives, whichever app sent
it. First show: Chad and Reed's Podcast, six notes on day one.

**Slug `boostr-bot`, the same one its own `["client","Boostr_Bot"]` tag
already slugified to**, so registering the key changes `client_src`
(client-tag → publisher-pubkey) and nothing a card prints. One early test
note carried `["client","Boostr"]` instead and classified as `boostr`; the
pubkey rule folds it into the same slug, which is the one row the reclassify
moves on `client_id`.

**⚠️ THE ORIGIN APP RIDES AN `app` TAG, NOT A `📱 via` LINE.** The notes
carry `["app","Castamatic","13.2.3"]`, `["app","BoostMeBitch","0.1.0"]`, and
so on, and the body names the sender rather than the app ("ChadF boosted 111
sats → Chad and Reeds Podcast"). `classify_client` reads that tag as
`client_via` for a publisher key when the via line is absent, and the rule is
the same as the line's: nested under the publisher, never promoted, and a tag
naming the publisher itself is dropped. Reading it is what gives `dedupe.py`
its app-agreement evidence for these notes, since the body shares almost no
prose with the donor app's own.

**It is a relay publisher and it duplicates.** The first hour produced two
pairs: a BoostMeBitch note signed by Chad's own key at 23:39:14 and the bot's
restatement at 23:39:15, and a BoostMeBitch site-account note at 23:03:13
against the bot's at 23:03:10. So `boostr-bot` is in `RELAY_PUBLISHERS`, the
droppable side, and the donor app's note is the one kept. **One class it
does not close, by construction: a boost Chad sends from Castamatic to a show
carrying the split is published by `chadf-boostbot` (watching the sending
node) AND by Boostr_Bot (watching the receiving leg), and both are relay
notes.** The filter pairs a relay note only with a non-relay partner, so that
pair stands as two boosts; deciding which of two restatements is the record
is a call not made here.

**⚠️ THE BOOSTER IS THE BOT, NOT THE PERSON THE BODY NAMES.** "ChadF and 33
others" is a display name read off a payment, and the same rule as the `P`
tag below applies: text, never an identity.

### MSP_bot Publishes For Music Side Project Feeds

Registered 2026-10-02, on Reed's instruction. `ffff6a7a…fc3e`
(`npub1lllk57h…nx7eul`) is the **seventh** entry in `PUBLISHER_PUBKEYS` and
the sixth in the site's `PUBLISHERS`. Its profile says what it is: *"If you
use musicsideproject.com to make your RSS feed and add me in as a 1% this can
relay all your PC 2.0 Boost to Nostr"*, marked alpha, with
`musicsideproject@getalby.com` as its Lightning address. Boostr_Bot's shape
exactly, and the same note template (the `⚡ Boost ⚡` header, "X boosted N
sats → Show", the `📻` episode line, a tardbox.com share image): an artist
opts a feed in by adding the leg, and the bot publishes one note per boost
that leg receives, whichever app sent it. Nine notes on the index when
registered, across four music shows (Kulture Collection, The Drake Equation,
Songs From The Seaside, Government Approved), 1,808 sats.

**Slug `msp-2-0`, the one its own `["client","MSP 2.0"]` tag already
slugified to**, so registering the key changes `client_src` (client-tag →
publisher-pubkey) on its rows and `client_id` on none; `/api/v1/clients`
listed it under that slug, unlabelled, before the registration. The label is
"MSP Bot", after its profile name, the way Boostr_Bot's is.

**The origin app rides the same `app` tag** (`["app","Fountain"]`,
`["app","BoostMeBitch","0.1.0"]`, `["app","v4vmusic-com","0.17.6"]`,
`["app","candr.space","1.0.0"]`, `["app","PodcastGuru","2.3.2-beta2"]`,
`["app","Castamatic","13.2.7"]` on its first weeks of notes), read by
`_app_tag` into `client_via` on the terms above. Some notes also carry a `p`
tag naming a pubkey; nothing here reads it, on the standing rule that a
sender the bot names is text and never an identity.

**It is a relay publisher and it duplicates, and the `sender` tag is how
it is caught.** Measured on the collector the day it was registered: five of
the first nine notes restated a Fountain or BoostMeBitch note 1–5 seconds
away, each carrying `["sender", npub]`, and on every one the npub decoded
to exactly the key that signed the partner. The amount is reconstructed from
the leg (300 for Fountain's 333), so the hard key would not hold; tier 0 of
`dedupe.py` pairs on the signature with sats waived. The dry run marked
exactly those five and nothing else. After the backlog below was recovered,
`dedupe --days 250` marked 16 more (4,515 sats), 21 in all; 39 sender-tagged
notes stand because the named donor has no note of their own in the index,
and 9 stand beside a non-relay partner the evidence tiers could not pair
(the bot's boilerplate body defeats the prose tiers) — the let-through rule.
The v4vmusic.com autoboosts name no sender and have no partner to find.

**⚠️ MOST OF ITS NOTES WERE NOT ON THE INDEX WHEN IT WAS REGISTERED, AND THE
CAUSE WAS LATE PUBLICATION, NOT ANYTHING ON OUR SIDE.** relay.fountain.fm
held 205 of its kind-1s back to 2026-02-06, 195 of them real boosts (43,605
sats); the index held nine. Diagnosed 2026-10-02 in this order, which is the
order to use next time: every note passes `classify_boost`; a replay of the
live filter set over a gap window returns every missing note on three
shapes; the ticks over the 10-01 gap were 96 clean runs; and 111 of the
notes are stamped before the 2026-09-03 forced backfill that walked
fountain's `#k` shape to 2025-06-01, none indexed. The bot stamps the
payment time and publishes late, and the tail scan's 3h `since` window over
a complete backfill reads such a note never. `rescan-publishers` in
`onlyboosts_globalscan.py` is the fix (the publisher keys' own timelines,
30 days, daily on the outbox run) and the recovery (`--floor 1767225600`
inserted exactly the 195; the other six keys had nothing late). The data
feed section of CLAUDE.md carries the rule.

### OnlyBoosts Publishes On Behalf Of Its Own Donors

Registered 2026-08-20. `3a87a19c…84d9` is the **fourth** entry in
`PUBLISHER_PUBKEYS` and the first that is not somebody else's bot: it is the key
behind `/api/sign-boost` (see "The Site Signs For A Booster Who Has No Key").

**It takes the SAME SLUG as the donor-signed path**, `onlyboosts`, because both
are boosts made on this site and splitting them into two clients would report one
product as two. `client_src` tells them apart for free, the pubkey being tested
before the tag: **`publisher-pubkey` for bot-signed, `client-tag` for
donor-signed**. Verified against a real signed event.

**⚠️ THE `via != slug` GUARD IS NOW LOAD-BEARING FOR OUR OWN NOTES, and it does
not look it.** The note template's attribution line reads `📱 via
onlyboosts.social`, which is exactly the shape `_VIA_RE` reads, and `slugify`
takes it to `onlyboosts` — the slug itself. That guard was written for somebody
else's bot naming itself; without it **every** bot note would nest OnlyBoosts
under OnlyBoosts on `/api/v1/clients`. Don't remove it as dead defensive code.

**⚠️ THE BOOSTER IS THE BOT, NOT THE DONOR.** These notes carry no claim about
who paid and must not gain one: nothing can verify a donor authorised a note
signed by a key they do not hold. The typed "From" name rides the boostagram TLV
and the note body, and nowhere the index credits. Same treatment the 994
`chadf-boostbot` rows and the LB show account get, and the same reasoning as the
`P`-tag rule below.

### Local Bitcoiners Publishes On Behalf Of Its Donors

Registered 2026-08-18. `c330881e…64592` is the Local Bitcoiners **show account**,
and it is the third entry in `PUBLISHER_PUBKEYS` alongside `chadf-boostbot` and
`lnaddress-music`. About a quarter of that show's boosts never produced a
donor-signed note at all — Castamatic, PodcastGuru and CurioCaster keysends,
anonymous website boosts, Fountain boosts from donors with no linked Nostr
identity — so the show account publishes one carrying the payment evidence, and
**only when no donor note exists**. Volume is small: 8 notes over 14 days.

Nothing in the scan changed. Those notes already match the `#k` filter and were
being fetched; what was missing was the evidence tags (`amount`, the `t` topic
tags) that make `classify_boost` keep one, and that is LB's half. The
originating app is named in the same `📱 via <App>` line `_VIA_RE` already
reads, so it lands in `client_via` and never in `client_id`.

**⚠️ THE BOOSTER IS THE SHOW ACCOUNT, NOT THE DONOR NAMED IN `P`.** These notes
may carry an uppercase `["P", <donor pubkey>]`, NIP-57's sender convention. It
is read nowhere and must stay that way: the claim originates in a receipt signed
by a burner key, so nothing here can verify the named donor authorised it.
Crediting them would put an unverified identity into booster pages, per-npub
counts and every leaderboard. Reed's call, 2026-08-18, and the same treatment
the 994 `chadf-boostbot` rows already get. If it is ever surfaced it wants a
column of its own (`proxy_for_pubkey`), rendered as "on behalf of …", and kept
out of every count.

**⚠️ THE INDEX IS NOW LOAD-BEARING FOR SOMEONE ELSE'S PUBLISH DECISION.** LB's
bot asks `/api/v1/boosts?podcast=56fbb1aa-…&since=…` before deciding whether to
publish, and `?id=<event id>` makes that check exact rather than a fuzzy
amount-and-identity match. It sweeps relays directly as a second veto, so a
duplicate needs both checks to fail — but two ordinary-looking changes here have
that shape:

- **A reclassification that drops rows.** If previously-indexed LB boosts stop
  being indexed, the bot reads "no note exists" and publishes a second one.
  **Flag it rather than shipping it quietly.**
- **A stale D1 sync**, which is the same failure with no code change behind it.
  The delta sync in every incremental cycle is what keeps the answer fresh.
- **The duplicate filter marking an LB note.** `localbitcoiners` is in
  `RELAY_PUBLISHERS` as a safety net (zero matches at flip-on, and LB's own
  index check should keep it that way). If it ever fires, the dropped note is
  on relays but unindexed, so **LB's audit files the issue** — that is the
  expected surfacing of an LB-side dedupe race, not a bug here, and the answer
  is to read the pair in `dedupe.py`'s report before un-marking anything.

LB runs a daily audit (`bots/boost-publisher/coverage_audit.py` in that repo)
comparing node payments against relays against this index, and files a GitHub
issue on a double-count or on a note that is on relays but unindexed after 24h.
**So a miss here arrives as an issue carrying the event id**, which is the cheap
way to find out.
