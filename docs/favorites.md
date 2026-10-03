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

**A favorite on a list that cannot say which half it lives in asks Public or
Private** in a small dialog of the controller's own (`.ob-fav-ask`): no
`visibility` tag, and entries in both halves or a `content` this signer
cannot open. The answer is stored per pubkey and offered again in the account
menu (step six). An empty list never asks (public by rule, 2026-10-03). Every
outcome that is not a quiet success is a toast; a degraded read or a publish
no relay accepted changes nothing and says so.

## The Section On `/booster`

`#favorites` (a frozen id, like every section id on the detail pages) sits
between Episodes and Boosts. The Function ships the shell hidden and
`favorites-section.js` fills it: the list read through the reader (the
private half too when the viewer is the member and the widget is loaded),
every guid resolved through **`POST /api/v1/favorites/resolve`**, and the
rows grouped by the RESOLVED medium into the site's words — Shows, Episodes,
Albums, Songs, and Artists when the list carries any. The lookup wins over the
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
the window (6s). The read is trusted only when **every reached relay answered
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

**Publish** (step three) goes to nos.lol, damus, primal, ditto and snort
plus the NIP-65 write relays. **Snort joined on 2026-10-03**: it is one of
StableKraft's five defaults (nos.lol, snort, primal, theforest, damus, plus
the member's own), it answered a kind-10333 REQ with EOSE that day, and it
held Reed's list after his first publish from the branch. A publish target
only, on the same reasoning as primal below; deliberately not in the read
set, where every reached relay must answer before a read is trusted.
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
