# PC 2.0 Favorites (kind 10333)

The design record for OnlyBoosts' support of Chad Farrow's cross-app podcast
favorites. **Status, 2026-10-03: all six steps built and the migration gate
lifted.** The heart is on the show, episode and artist surfaces, the Favorites
section is on `/booster`, the account menu carries the dark-mode and
Public/Private rows, and Reed's first live test (2026-09-08) published real
lists that BoostMeBitch read back. The 2026-10-03 review against the spec's
current main (ca652a9) and both apps' current code re-vendored the reference
(31 vectors, up from 29), lifted the gate, retired the first-favorite dialog
in favour of the spec's public default, and added StableKraft's two relays
to the publish set. Open: a live test of an episode favorite reaching BMB.

| | |
|---|---|
| Spec | https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites.md (re-read it before building on this file; it moved five times in the first week of September 2026, the last a rewrite of the item entry, and three more times on 2026-09-08 after this site vendored it, which the 2026-10-03 re-vendor caught up with) |
| Vendored vectors | `scripts/vendor/pc20-favorites/` at the SHA in its `PROVENANCE` |
| The merge | `assets/js/favorites-merge.js`, the spec's reference implementation with two adaptations; `node scripts/test-favorites-merge.mjs` |
| The reader | `assets/js/favorites-read.js`, per-relay trust on raw sockets; `node scripts/test-favorites-read.mjs` |
| The writer | `assets/js/favorites-sync.js`, the cycle around `plan`: adopt, merge, encrypt, sign, publish, record; `node scripts/test-favorites-sync.mjs` |
| The heart | `assets/js/favorite-button.js` (two-sided chrome) and `assets/js/favorites-ui.js` (reveal, paint, click); `node scripts/test-favorite-button.mjs` |
| The section | `assets/js/favorites-section.js` on `/booster`, over `POST /api/v1/favorites/resolve`; `node scripts/test-favorites-section.mjs` |
| The settings | `assets/js/account-settings.js`, the account menu's settings as a NIP-78 event; `node scripts/test-account-settings.mjs` |
| Upstream | https://github.com/ChadFarrow/PC20-Nostr/issues/37, the reference's private-list removal defect |
| Other writers | BoostMeBitch (`lib/nostr/favorites-list.ts`) and StableKraft (`lib/nostr/favorites-single-list.ts`); both carry `content`, both write the `visibility` tag, both implement the private half, and both read AND write the three-element item (BMB since its PR #364, 2026-09-07; StableKraft since its PR #256, 2026-09-08), rewriting a legacy item once. Neither originates or renders an artist favorite (checked 2026-10-03) |

## What The List Is

One replaceable event per pubkey, kind 10333. **One favorite, one tag**, since
commit 9b04dfe (2026-09-07): every `i` tag is a thing the user chose, and there
is no scaffolding on the list. Three entry shapes, told apart by prefix and
element count, and a `medium` tag that runs until the next one:

| tag | what |
|---|---|
| `["i", "podcast:guid:F"]` | a feed favorite (a show or an album) |
| `["i", "podcast:guid:F", "podcast:item:guid:X"]` | item X of feed F (an episode or a song); the feed is on the tag, so nothing above it means anything |
| `["i", "podcast:publisher:guid:P"]` | an artist; belongs to no feed |
| `["i", "podcast:item:guid:X"]` | **legacy**: an item whose feed is the entry above it. Every list published before 2026-09-07 holds these; neither app writes them any more, a reader must still accept them, and a writer rewrites one on its next publish |

This is `<podcast:remoteItem>` as one tag, `feedGuid` first and `itemGuid`
second, both carrying their NIP-73 prefix. It is the flat model Reed argued
for on 2026-09-06: a show favorite and an episode favorite are two independent
tags, and a saved episode of a show you do not follow is an ordinary state.
The position-2 marker (`fav`/`placement`) that lived in the spec for one day
is gone; nothing ever published it. The list is public (tags) or private
(NIP-44 to self in `content`), whole list one mode, stated by a `visibility`
tag. Inside a medium run entries are emitted in four bands (legacy items that
name no feed, artists, feeds, then items grouped by feed) so two writers
converge on one order; rule 5 compares after reframing `alt`, `visibility` and
the `k` tags, because two conforming events differ byte for byte.

**So shows and albums are one entry type, episodes and songs are another, and
the hint separates the two sides.** On this site that is the medium partition
already in force: the `/booster` section will render four groups in the site's
vocabulary, Shows, Episodes, Albums, Songs, with the medium taken from our
index or Podcast Index rather than from the hint (the spec says the lookup
wins), and a feed with no known medium filed on the podcast side, the rule the
Shows feed already uses. **Artist favorites are written here since
2026-09-08** (Reed's call): the spec defines the entry, both apps carry it,
and neither creates or displays one yet, so an artist favorited here shows on
OnlyBoosts alone until they render it. Chad is told.

## The Migration Gate, Lifted 2026-10-03

`pc20-favorites-feed-guid-migration.md` ordered the move to the three-element
item, and the order protected live data: **neither app may write the
three-element item until both read it** (stage 1), because a reader that does
not know the form sees `podcast:guid:F` at position 1 and silently converts
someone's episode favorite into a favorite of the whole show. Our module is
built on the reference, which writes only the new form and rewrites a legacy
tag on sight, so from 2026-09-08 this site refused an item favorite
(`items-gated`) and refused to publish onto any list still holding legacy
items, and kept the episode hearts hidden (`ITEMS_ALLOWED = false`).

**Both apps cleared stage 2 the week the gate was written.** BoostMeBitch
reads and writes the pair since its PR #364 (2026-09-07) and StableKraft since
its PR #256 (2026-09-08); each rewrites a legacy item once and bands each run
(stage 4), and each deliberately leaves stage 3 undone, carrying a placement
feed entry already on the wire rather than retracting it. The 2026-10-03
review found this in both headers, and the gate, the constant, the
`items-gated` status, `holdsLegacyItems` and the `itemsAllowed` dependency
came out rather than being flipped: a gate whose condition is permanently
met is a second way to read the same decision. Episode and song hearts are
revealed and written like show hearts; a legacy item on a list is rewritten on
the next publish, as vector 27 requires. `test-favorites-sync.mjs` pins the
three-element write and the rewrite.

## The Module

`assets/js/favorites-merge.js` is the spec's `conformance/reference/favorites.mjs`
at commit ca652a9 (first lifted at 0fc52c4, re-lifted 2026-10-03), with Chad's
OK (via Reed, 2026-09-07). The reference's own header says it has never served
traffic; what makes it the right base is that every rule in it cites the spec
section it implements and the spec's 31 vectors run against it unchanged. Two
adaptations, and nothing else differs:

- **No stand-in codec.** The reference seals the private half with reversible
  base64 so its vectors need no crypto. That code lives only in the test shim
  (`scripts/favorites-conformance-adapter.mjs`) and the test scans the shipped
  module for it. Real NIP-44 goes through the signer and is **async**, so
  `plan` takes the decrypted private half in (`readPrivate`) and hands the
  plaintext to encrypt back out (`publish.privatePlaintext`, with `content`
  null). An opaque half is carried byte for byte; an empty one is `''`.
- **`plaintextBytes` counts with TextEncoder**, not Buffer.

**The deal with Chad**: anything changed here that the vectors do not cover is
a change to the spec, and it goes upstream as an issue or PR before it ships.
Re-vendoring is copying the two files, bumping the SHA in `PROVENANCE` and
running the test; a new vector going red is the spec moving under us.

## The Writer

`favorites-sync.js` (step three, 2026-09-08) is the cycle the spec describes,
with each side effect injected so the test drives the shipped code against
scripted relays, a stand-in codec and a real key:

1. **Read**, through the reader; a degraded read ends the cycle with nothing
   published and nothing recorded.
2. **Open the private half** with NIP-44 through the widget's signer
   (`LBLogin.getNDK().signer`, the same path the NWC secret uses), never
   NIP-04. A signer without NIP-44 carries the bytes and cannot write into
   that half; the cycle says so (`no-nip44`).
3. **Adopt both halves.** OnlyBoosts has no library of its own, so what it
   renders is the shared list and it claims what it renders (rule 2). Every
   cycle therefore opens with a HYDRATE pass: adopt the list and let `plan`
   record the claims when the bytes already agree. Without it, unfavoriting
   an entry another app wrote is read as "another app's, carry it" on first
   contact and silently does not stick. The private half is adopted beside
   the public one for the same reason; the merge's own `parse` reads the
   public tags only.
4. **Ask only when the list cannot answer.** A list with no `visibility` tag
   that holds entries in both halves, or a `content` this signer cannot open,
   is `needs-mode`; the caller prompts Public or Private and calls again with
   `userChose`. **An empty, untagged list is public by the spec's rule** (its
   #47, vector 16, adopted here 2026-10-03, Reed's call): the first favorite
   publishes into the tags, writes no `visibility` tag and stores no choice,
   so a new member's first heart just works and the Public/Private switch
   waits in the account menu. The dialog asked on every first favorite from
   2026-09-08 until then, on the spec's earlier "no default" rule.
5. **Merge** through `plan`, **encrypt** the returned plaintext when the
   publish needs the private half, **sign** through `LBLogin.signEvent`, and
   refuse an event the signer returns under another key.
6. **Publish** on raw sockets to nos.lol, damus, primal, ditto and snort
   plus the member's NIP-65 write relays (read off their kind 10002), one OK
   per relay. One `OK true` is landing; the baseline is
   recorded then and only then.

**Issue #37, found by the writer's test and fixed upstream the same day.**
In the two whole-list-move branches of `plan` (going private, and a licensed
private → public move) the reference merged the active half with `adoptAll`,
which kept every entry read whatever the baseline said, so **a removal from a
private list never propagated**. Chad confirmed it, and found a third case one
level down that our first patch had left open: the *moving* merge was handed
an empty local set, so an entry unfavorited in the other half rode the move
across, permanently. PR #38 (commit 0fc52c4) fixes both sites, adds vector 29
for all three cases, and writes the rule into §3 of the spec: a move between
halves is a merge, not a copy. The module here is lifted from that commit, so
there is no local departure any more; `test-favorites-merge.mjs` keeps the
first two cases as a regression beside the vectors.

**The same day, main moved three more times, and this site did not follow
until 2026-10-03.** #40 fixed three defects on the claim-back path (a
whole-list move claimed back an entry the member no longer held, and a
carried claim outlived its entry, so a removal made in the other half could
resurrect; vector 29 was rewritten and vector 31 added), #47 made an empty
untagged list public by rule and pruned an emptied `medium` run from the
private half (vectors 16 and 30: our module encrypted `[["medium","podcast"]]`
where the other apps wrote `''`, which they then read as a private half), and
#49 fixed the `visibility` tag's position (vector 21, which already passed).
Against the 31 vectors the shipped module failed 16, 29, 30 and 31. The
reference's diff (206 lines, 23 of 27 hunks code, the four rejects prose)
applied cleanly over the two adaptations; the module is now at ca652a9 and
all 31 pass. **Vendoring from a PR branch is how this slipped**: the
re-vendor rule in `PROVENANCE` is unchanged, but the SHA to take is main's.

## The Heart

**⚠️ A PODCAST SHOW IS FOLLOWED, EVERYTHING ELSE IS FAVORITED, SINCE
2026-11-07.** *Reed's call.* The show-level button on the podcast side
(declared `podcast`, `video`, or no medium at all: the Shows feed's partition
rule) reads **Follow / Following** with a plus that becomes a check, the
podcast-app convention (Apple Podcasts: a circled plus → check; Pocket Casts:
"+ Subscribe" → check; Spotify, X and Instagram use a text pill with no
icon). Podcast episodes, albums, songs and artists keep **Favorite /
Favorited** with the heart. `wordsFor(kind, medium)` in `favorite-button.js`
is the rule, `isFollow(btn)` reads it off a rendered button for
favorites-ui.js's toasts ("Following this podcast" / "Unfollowed"), and the
pill carries `.ob-fav-pill--follow`. **Wording and glyph only**: the event is
Chad's kind 10333 byte for byte, `changeFor` is untouched, and the other apps
see a feed favorite. The list's name on the site is **Follows and Favorites**
(the account menu's row, the public/private dialog). **On `/booster` the
section is THREE DRAWERS since 2026-11-08** (Reed's call: "I don't want to
see my favorite podcast episodes in the same list as my favorite songs"):
**Podcasts You Follow** (the owner's Import / Export OPML band, since an
OPML is podcast subscriptions and nothing else), **Favorite Podcast
Episodes**, and **Favorite Music**, which keeps the grouped shape (Artists,
Albums, Songs under their headings) and the Show menu. `DRAWERS` in
`favorites-section.js` is the table and the Function ships one `<details
data-fav-drawer>` per row; the `shows` group key keeps its name.

`favorite-button.js` is chrome on the boost-button.js pattern: two-sided and
dependency-free, because the two cards and the /show and /episode Functions
render it at the edge and a card rebuilt in the browser must match byte for
byte. An outline pill where the boost pill is solid (two filled brand
controls on one line would read as one action twice, and Boost is the
primary), the word Favorite, the heart filling when on. It carries full
NIP-73 identifiers on the element (`data-fav-id`, `data-fav-item`) and the
feed's declared medium when the surface knows it, never a default.

**It ships `hidden` and favorites-ui.js reveals it for a signed-in member
only**, reading the session pubkey the way follow-set.js does, so painting
hearts on a cold page loads no widget. The widget comes in on the first click,
through the nav's own loader, because signing needs it. The private half is
opened only once the widget is present, so a member with a private list sees
outlines until their first click on the page.

Surfaces, 2026-09-08:

| Surface | Heart | Written by |
|---|---|---|
| Shows / Albums cards | show | `show-card.js`, ahead of the boost pill on the Nostr Stats line |
| `/show` hero | show, as a `.btn` in `.show-actions` | `functions/show/[guid].js` |
| `/show` community rows | show | the same Function, ahead of the row's boost pill |
| Episodes / Songs cards, `/episode` and `/booster` cards | episode | `episode-card.js`, on the stats line and in the compact rail |
| `/episode` hero | episode | `functions/episode/[guid].js` |
| Artists cards | artist | `publisher-card.js`, alone at the right end of the stats line (no boost pill there) |
| `/artist` hero and its community rows | artist | `functions/artist/[guid].js` |

**Episode hearts are revealed like show hearts since 2026-10-03**, when the
migration gate (`ITEMS_ALLOWED`, false from 2026-09-08) came out of
favorites-ui.js; see **The Migration Gate, Lifted** above. The catalogue
drawer's un-indexed rows still have no heart: they are built by
`episode-catalogue.js` from Podcast Index on open, and a heart there is a
follow-up rather than a gate. An episode whose show the collector never
identified has no feed guid on its heart (`episode-card.js#realShowGuid`) and
cannot be favorited, which is the spec's own rule: without the feed, an item
is unresolvable by every app.

**A degraded read retries itself since 2026-10-03** (BMB's #430, on Reed's
ask). The read's guard is right and stays: an untrusted read keeps what is on
the device, paints the hearts unknown, and publishes nothing. But it was the
one reader on the page with no way back: on a phone every launch is a cold
page load against a radio that is not up yet, so the first read failed at
t=0 and the member saw unknown hearts for the life of the page or until they
pressed one. favorites-ui.js now re-asks on a ladder of three rungs (2, 8 and
20 seconds) armed when a read ends untrusted, and from the first rung again
when the page comes back (`online`, `focus`, the document turning visible).
Only a trusted read resets the budget; a retry's own pass going through
`loading` must not, or it is a retry storm (BMB measured two reads every four
seconds). The retry repeats the read that failed with the same options, so a
read that was going to open the private half still does, and a timer never
loads the widget on its own.

**A favorite on a list that cannot say which half it lives in asks Public or
Private** in a small dialog of the controller's own (`.ob-fav-ask`): no
`visibility` tag, and entries in both halves or a `content` this signer
cannot open. The answer is stored per pubkey and offered again in the account
menu (step six). An empty list never asks (public by rule, 2026-10-03). Every
outcome that is not a quiet success is a toast; a degraded read or a publish
no relay accepted changes nothing and says so.

### The First Button Starts The Read

`favorites-ui.js` reads the list lazily, when a page has a heart to paint.
On `/booster` the only buttons are the rows' own, made after the section has
read the list, so the first paint of such a button has to START the read;
until 2026-11-08 the signed-in gate came first, and a button that arrived
before any read was hidden with no read ever asked for. The owner's Follow
buttons stayed hidden on Reed's phone (a desktop passed on timing). `paint`
now asks for the read before it reads the gate.

## The Section On `/booster`

`#favorites` (a frozen id, like every section id on the detail pages) sits
between Episodes and Boosts. The Function ships the shell hidden and
`favorites-section.js` fills it: the list read through the reader (the
private half too when the viewer is the member and the widget is loaded),
every guid resolved through **`POST /api/v1/favorites/resolve`**, and the
rows grouped by the RESOLVED medium into the site's words — Shows, Episodes,
Albums, Songs, and Artists when the list carries any — and dealt into the
three drawers (Podcasts You Follow; Favorite Podcast Episodes; Favorite
Music, the three music groups under their headings) since 2026-11-08. The lookup wins over the
list's hint, the spec's rule, and a feed with no known medium files on the
podcast side, the Shows feed's rule. Rows are on the community-row vocabulary
(`.cs-row`), link to the page here or to BoostMeBitch when there is none (the
podroll tiles' rule for a show we have no page for), and for the owner carry
the Favorite heart, painted and handled by favorites-ui.js, so a list can be
pruned from the page that shows it. A visitor to a member with an empty list
sees no section; the owner sees a line inviting the first favorite, or one
saying the list is private and the signer cannot open it.

**The drawer sits directly under the Nostr Boost Stats tiles, normally
closed, and is on screen from the first paint** (Reed, 2026-09-09): a relay
read takes seconds and a drawer that appears late reads as a page changing
under the reader, so the Function renders it with a "Loading favorites from
Nostr…" foot and the module only ever changes the foot — "No favorites yet",
"keeps their favorites private", or a couldn't-reach line, never a vanished
section. It carries a dropdown on the sort pill's chrome:
All, Shows, Episodes, Artists, Albums, Songs. All is the default so a member
whose favorites are all songs does not open on an empty Shows view; a pick
filters the groups on screen and says so when the pick has nothing.

**Per-entry public/private is tabled** (Reed, 2026-09-09). Reed's model is
NIP-51 bookmarks, where each entry chooses its half; the spec settled on one
mode for the whole list after measuring a mixed list (13 of 449 entries left
public by an app that could only move its own). Reed will take it up with
Chad before anything goes to GitHub; until then the site ships to the spec,
and the account menu's Public/Private row stays as the list's mode switch.

**The resolver is bounded on both sides.** The index side is one bound JSON
array unrolled by `json_each` per table (the follows endpoint's pattern); the
Podcast Index side is at most eight lookups per request through `piGet`'s
timeout, byte cap and edge cache, first come. A long list of unknown feeds
resolves over a few loads rather than one burst. An item is resolved as the
PAIR: the same item guid under another feed is not this favorite. A guid
nobody can name is absent from the answer and the row renders the guid,
because it is still somebody's favorite.

## The Account Menu

Two rows in the widget's identity dropdown (`IdentityDropdown.jsx`), not a
settings page (Reed, 2026-09-06). The pill at the top links to the member's
own `/booster` page, where their boosts and favorites are. **Dark mode**
presses the nav's own toggle button so `nav.js` keeps ownership of the
attribute, the storage write and the cross-tab sync. **Favorites: Public /
Private** goes through `window.OBFavorites`, the API `favorites-ui.js`
exposes for exactly this, because the widget is a React bundle that cannot
import a site module. A change there is a whole-list move on the relays and
runs the same publish cycle a heart does, with `userChose` set, since the spec
lets only a choice flip a list's half; a standing setting that disagrees with
the list is never acted on. On anything but success the stored choice is put
back. `getMode()` answers from the stored choice, else from the list itself
(its `visibility` tag, or the half that holds entries), else "not chosen".

**The settings follow the account** (Reed's ask, 2026-09-09: the wallet comes
back on its own after a login, so these should too). `account-settings.js`
keeps them in a NIP-78 event, kind 30078, `d` = `onlyboosts:settings`,
content NIP-44 encrypted to the member's own key: `{ theme, favoritesMode,
updatedAt }`. The same pattern BoostMeBitch uses for its own preferences
(`lib/nostr/settings-backup.ts`, `d` = `boostmebitch:settings`). Pushed,
debounced, when the theme toggle is pressed or the favorites mode chosen,
signed in with a NIP-44 signer; pulled on login and applied only when the
relay copy's `updatedAt` is later than this device's own last change, the
theme through the nav's own toggle. The favorites mode on the event is the
member's stored CHOICE, never something that flips a list on its own. A
signer without NIP-44 keeps the settings on the device, silently.

**The controller is loaded on every page by `nav.js`**, through a dynamic
import at the end of its IIFE, lazily: a page with no hearts pays for the
module and makes no relay read, and the menu's rows have their API anywhere
the nav is. The two page-level imports it had on 2026-09-08 came out.

## Relays

Measured 2026-09-06 against Chad's own list (read-only): `relay.fountain.fm`
**refuses** the kind ("kinds not supported"); `nos.lol` and `relay.damus.io`
held the current event; `relay.ditto.pub` a copy 19 hours stale;
`relay.mostr.pub` a three-day-old copy from when the list was private, with
**zero public tags** (read alone it is an empty list); `relay.wavlake.com`
three weeks stale; `relay.primal.net`, `relay.snort.social` and
`theforest.nostr1.com` nothing, though both apps publish to primal.

**The reader (`favorites-read.js`, step two, 2026-09-08)** reads nos.lol,
damus, ditto and mostr plus the member's NIP-65 write relays through
`extraRelays`, one raw socket each, and counts for itself: a relay is
*reached* when its socket opened and has *answered* when it sent EOSE inside
the window (6s). Until 2026-10-30 the read was trusted only when **every reached relay answered
and at least two did**; a relay that never connected is out of both counts, so
a dead default does not degrade every read forever, and a relay that connected
and hung is a genuine unknown, so it does. A CLOSED (fountain's "kinds not
supported") is a refusal and is excluded rather than counted as evidence of an
empty list. Only an event of the right kind, by the right pubkey, with a
verifying signature counts; newest `created_at` wins and a tie goes to the
lowest id. An untrusted read hands the merge `null`, which is not an empty
list; a trusted read with nothing held is `{tags: [], content: ''}`. BMB's
`read-trust.ts` is the rule this restates, with the two-answer floor added
because mostr alone would have been "event in hand". The test drives the
shipped module against scripted sockets; the live smoke on 2026-09-08 read
Chad's list from five relays in under a second, with primal now holding the
current copy too.

**Damus left the read set on 2026-10-30.** It opened the socket and answered
nothing, to any REQ, so by the rule above every read was untrusted after the
full six seconds: the hearts painted unknown and a click changed nothing, or
took the second try (Reed's report: "I have to click it twice", "20+
seconds"). Measured against Reed's own list the same day: untrusted at 6.0s
with damus `hung`, trusted at 0.6s without it. It stays a publish target, and
**a publish now returns 1.5s after the first `OK true`** (`PUBLISH_GRACE_MS`)
instead of waiting out a hung relay's eight seconds; a straggler is reported
`pending` and its socket finishes on its own timer.

**The rule became a quorum on 2026-10-30** (Reed's call, the same day):
a read is trusted once two relays have answered, and the rest get
`QUORUM_GRACE_MS` (1.5s) to answer too, a newer copy among them still
winning; a relay still silent then counts as hung and no longer degrades the
read. The cost Reed accepted: an edit made in another app that reached ONLY
the silent relay is not seen, and the next click here writes over it, which
the several-relay publishing every app does makes rare. Measured against
Reed's list with damus added back as a test: trusted in 2.1s, damus `hung`.
Damus stays out of the read set anyway (it would cost every read the grace).

**Publish** (step three) goes to nos.lol, damus, primal, ditto and snort
plus the NIP-65 write relays. **Snort joined on 2026-10-03**: it is one of
StableKraft's five defaults (nos.lol, snort, primal, theforest, damus, plus
the member's own), it answered a kind-10333 REQ with EOSE that day, and it
held Reed's list after his first publish from the branch. A publish target
only, on the same reasoning as primal below; deliberately not in the read
set, where (until the quorum of 2026-10-30) every reached relay had to
answer before a read was trusted.
**Theforest (`theforest.nostr1.com`), the fifth, was added and dropped the
same day** (Reed's call): it answers a read but held nothing after the
publish, a members-only relay refusing the write, so the socket bought
nothing. A StableKraft member who is also a theforest member could still be
served a stale copy from it; nothing this site can do reaches that. **Primal joined both sets on 2026-09-08, after Reed's
first live test**: two shows favorited from the feed reached BoostMeBitch, a
show favorited from `/show` did not until it was unfavorited and re-favorited.
BMB reads damus, primal, nos.lol and fountain, takes the newest copy it hears,
and stops listening 1.5 seconds after the first event arrives; primal held a
copy we had never written to, so whenever primal answered first the stale copy
won and our favorite was invisible there. The rule that falls out: **every
relay another app reads that accepts the kind is in our publish set**, or a
stale copy is waiting to win a race. Fountain refuses the kind and stays out.
Chad's own set includes fountain and he reports it fine; his apps have a local
library to fall back on and this site does not.

The two shows favorited from the feed most likely won the same race by timing
rather than by surface; nothing in the code differs between the two surfaces
beyond the markup.

## Decisions Standing From The 2026-09-06 Session

- Favorites live on `/booster/<npub>` as a `#favorites` section, client
  rendered: the list is on relays, not D1, and ciphertext cannot be opened at
  the edge. A written exception to the rendering rule.
- **No boosts, no page, no member.** Reed's call. A member with favorites and
  no boosts has no `/booster` page and that is not changing.
- The word is **Favorite**, the glyph is a **heart**, matching both apps. The
  boost note's reaction bar already uses `♥`/`♡` for Like; the two never
  share a row and the word carries the difference.
- Settings rows in the existing identity dropdown (dark mode, Public/Private),
  not a settings page. First favorite on an untagged, empty list prompted
  Public or Private while the spec allowed no default; **the spec gained a
  public default on 2026-09-08 (#47) and this site follows it since
  2026-10-03**, Reed's call, so the dialog is reserved for a list that
  genuinely cannot say.
- Foreign entries the index cannot resolve go through a bounded Podcast Index
  lookup on `_shared/podcast-index.js#piGet` and link to BMB, the way podroll
  tiles already do for a show with no page here.
- Signed out gets nothing. The bot cannot hold favorites.
- A signer without NIP-44 is read-and-carry only, with a line on screen. The
  NIP-04 fallback in `selfEncrypt.js` is forbidden here.

## OPML Import And Export

Built 2026-11-07 (Reed's ask, after BoostMeBitch shipped the same in #508 and
#518; Chad's rules are lifted whole). OPML is the subscription list every
podcast app writes and reads; here a subscription is a followed podcast, or
a favorited album when the file lists a music feed, so an import adds feed
entries to the kind 10333 list and an export writes them out. Episodes and
songs have no place in the format.

**The rules are one dependency-free module, `assets/js/opml.js`**, served to
the browser, inlined into the link-fetching Function and run as shipped by
`test-opml.mjs`: the reader (`parseOpml`, a quote-honouring scanner rather
than DOMParser, so one copy serves both sides and a stray `&` in a title
does not lose the list), what may leave the device (`planOpmlImport`,
`opmlLinkVerdict`), what each lookup answer means (`sortOpmlAnswers`) and
the bytes an export writes (`buildOpml`).

- **⚠️ AN IMPORT ADDS AND NEVER REMOVES** (Reed's rule). The review shows what
  will be added, what is already on the list, what Podcast Index does not
  hold, and what could not be asked; nothing is written before the press,
  and the press is ONE publish: `syncFavorites` takes an array of changes
  since the same day and applies them in order into one event.
- **⚠️ A PRIVATE FEED ADDRESS IS A CREDENTIAL AND NEVER LEAVES THE DEVICE.**
  Patreon, Supercast, Supporting Cast, Memberful and Glow hosts, a `/private/`
  path, userinfo, and a query parameter named like a key (`auth`, `key`,
  `token`, `sig`, `session`…) are planned out before the first request and
  shown by host only. The resolve endpoint applies the same test again and
  never binds or sends such an address, because a route must not depend on
  who is calling it. A pasted link gets the same two tests before it is
  sent to the link route; no `https://` is guessed for a bare paste, so a
  pasted secret key is not turned into a hostname.
- **The lookup is `POST /api/v1/feeds/resolve { urls }`**: D1's
  `podcasts.feed_url` on the address's spellings (either scheme, with or
  without the trailing slash) first, then Podcast Index `podcasts/byfeedurl`
  for the rest, `PI_MAX` a request, a few at a time. Reed's own Fountain
  export measured 71 feeds: 55 matched the index by feed URL, 3 more are
  shows the index holds under a different URL, 13 unknown; that is why PI
  is the authority and the index the fast path. **⚠️ THREE STATES**: a row,
  `null` (both sides answered: no such feed), or ABSENT (not asked, or the
  ask failed). The browser asks again for the absent and never calls one
  "not found". `no-store`, since a subscription list is personal.
- **A pasted link is read by `POST /api/v1/opml/link { url }`**, on the
  server because most hosts send no CORS header: POST not `?url=`, no-store,
  an IP literal or a local name refused outright, 8 seconds, 16MB streamed,
  and ONLY OUTLINES COME BACK, never the body, so it is not a proxy.
- **⚠️ A VISITOR WITH NO NOSTR ACCOUNT CAN IMPORT.** Reed's call: the
  recommendations are the carrot, and a subscription list is enough to seed
  them. The list lives in that browser alone (`ob_local_follows`, rows the
  resolve endpoint answered), durable across sessions, is what
  `OBFavorites.feeds()` reports and `ob:favorites-read` carries (`local:
  true`) while signed out, and seeds the two Recommended rails and the
  Because rails on the homepage through the endpoint's favorites-only form;
  the follows rails stay locked. The panel's manage view removes one,
  forgets all, or exports. On the first trusted read after a login the
  controller offers the list for saving to the Nostr list (one publish),
  then clears it; "Later" asks again next page. Hearts stay hidden signed
  out, as before.
- **Three doors**: the homepage's one signed-out carrot rail ("Log in or
  import your OPML for personalized recommendations"; the two Recommended
  rails' own locked cards carried the door for a day, until the four
  personal rails became one for a signed-out visitor on 2026-11-08), the
  account menu's Podcast list row (Import / Export),
  and the owner's Import OPML / Export OPML on `/booster`'s Follows and
  Favorites band, shown over an empty list too. The panel itself is
  `assets/js/opml-import.js`, loaded on first use.
- **The export** is every feed entry on the list, named and addressed
  through `/api/v1/favorites/resolve` (whose rows carry `feed` since the same
  day) or the local list, written as OPML 2.0 with every value escaped (an
  unescaped `&` is a document the next app rejects whole), downloaded as a
  `data:` URL (the CSP admits no `blob:`), named
  `onlyboosts-podcasts-<date>.opml`. A feed the index has no address for is
  counted and left out.

## What Is Next

1. ~~The relay reader~~ built 2026-09-08.
2. ~~The writer~~ built 2026-09-08.
3. ~~The heart~~ built 2026-09-08, show surfaces live; episode surfaces
   revealed 2026-10-03 when the gate lifted.
4. ~~The `#favorites` section~~ built 2026-09-08.
5. ~~The dropdown rows~~ built 2026-09-08.
6. Per-entry public/private (NIP-51 bookmarks' model): tabled 2026-09-09
   pending Reed's conversation with Chad; a spec change, not a site change.
7. Later, and the real reason to do it: the collector indexes public lists and
   "favorited by N members" becomes a show stat or chart component.
9. ~~OPML import and export~~ built 2026-11-07; the section above.
8. ~~The list as recommendation seeds~~ built 2026-11-07 (Reed's report that
   a followed show stayed recommended): `favorites-ui.js` keeps the list's
   feed guids (`feedGuidsOf`: feed entries and the feed of each item entry,
   artists out), fires `ob:favorites-read` on `window` after every read, and
   exposes `OBFavorites.feeds()` / `ensureRead()`; `discover.js` asks
   `/api/v1/recommend` again with them, and on `/booster` the section's
   `onEntries` hands them to `booster-page.js`, which repaints the rails with
   the two-sided `recommend-rails.js`. A seed is never recommended, so the
   heart takes a show off the rails. The event fires trusted or not, with an
   empty list when untrusted, so a listener can tell no list from no read.
   **⚠️ The guids are BARE**, the form D1 stores: a feed entry's `id` is the
   whole `podcast:guid:` identifier and `feedGuidsOf` strips it through the
   merge module's `feedGuidOf`. The first paint sent the identifier, nothing
   matched a seed, and Reed saw three followed shows still recommended the
   same day; `test-discover-home.mjs` runs the shipped function.

## A Button In Flight Keeps Its Word

A click reads the list again before it decides add or remove, and that read's first `paintAll` painted every button from the list, the pressed one included, so "Saving…" became "Follow" again for as long as the relays took (Reed, 2026-11-08: a press that looked ignored for twenty seconds). `paint` in `favorites-ui.js` leaves an `is-busy` button alone; `setBusy(btn, false)` repaints it when the cycle ends. The pill pulses while busy. A list with no private content counts as opened on the first read, so a new member's click no longer re-reads the list before writing.
