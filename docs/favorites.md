# PC 2.0 Favorites (kind 10333)

The design record for OnlyBoosts' support of Chad Farrow's cross-app podcast
favorites. **Status, 2026-09-08: all six steps built.** The heart is on the show
surfaces, the Favorites section is on `/booster`, the account menu carries the
dark-mode and Public/Private rows, and Reed's first live test published real
lists that BoostMeBitch read back. Open: the episode hearts behind the
migration gate, and the artist heart.

| | |
|---|---|
| Spec | https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites.md (re-read it before building on this file; it moved five times in the first week of September 2026, the last a rewrite of the item entry) |
| Vendored vectors | `scripts/vendor/pc20-favorites/` at the SHA in its `PROVENANCE` |
| The merge | `assets/js/favorites-merge.js`, the spec's reference implementation with two adaptations; `node scripts/test-favorites-merge.mjs` |
| The reader | `assets/js/favorites-read.js`, per-relay trust on raw sockets; `node scripts/test-favorites-read.mjs` |
| The writer | `assets/js/favorites-sync.js`, the cycle around `plan`: adopt, merge, encrypt, sign, publish, record; `node scripts/test-favorites-sync.mjs` |
| The heart | `assets/js/favorite-button.js` (two-sided chrome) and `assets/js/favorites-ui.js` (reveal, paint, click); `node scripts/test-favorite-button.mjs` |
| The section | `assets/js/favorites-section.js` on `/booster`, over `POST /api/v1/favorites/resolve`; `node scripts/test-favorites-section.mjs` |
| Upstream | https://github.com/ChadFarrow/PC20-Nostr/issues/37, the reference's private-list removal defect |
| Other writers | BoostMeBitch (`lib/nostr/favorites-list.ts`) and StableKraft (`lib/nostr/favorites-single-list.ts`); both carry `content`, both write the `visibility` tag, both implement the private half |

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
| `["i", "podcast:item:guid:X"]` | **legacy**: an item whose feed is the entry above it. Both shipped writers still write this; a reader must accept it and a writer rewrites it on its next publish |

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
Shows feed already uses. Artists wait until the two existing apps read the
entry; a publisher feed rarely resolves through Podcast Index, so an artist
favorite made here would render badly there today.

## The Migration Gate, And What We May Write Today

Both shipped writers still emit the legacy item and read an item's feed from
the entry above it. `pc20-favorites-feed-guid-migration.md` orders the move,
and the order protects live data: **neither app may write the three-element
item until both read it** (stage 1), because a reader that does not know the
form sees `podcast:guid:F` at position 1 and silently converts someone's
episode favorite into a favorite of the whole show. Our module is built on the
reference, which writes only the new form and rewrites a legacy tag on sight.

For OnlyBoosts, a fresh writer with no legacy of its own, that means:

- **Show, album and artist favorites are safe to write now.** Two-element
  feed entries are what every reader already understands.
- **Episode and song favorites wait for stage 1 in both apps.** Until Chad
  confirms it, this site reads and renders item favorites and writes none.
- **A list we republish is upgraded on the way through** (vector 27), which
  is itself a three-element write. So the gate applies to any publish onto a
  list holding legacy items, not only to our own item favorites: until stage
  1, a publish onto such a list is declined, with a line on screen.

## The Module

`assets/js/favorites-merge.js` is the spec's `conformance/reference/favorites.mjs`
at commit 0fc52c4, lifted with Chad's OK (via Reed, 2026-09-07). The reference's
own header says it has never served traffic; what makes it the right base is
that every rule in it cites the spec section it implements and the spec's 29
vectors run against it unchanged. Two adaptations, and nothing else differs:

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
4. **Ask before the first favorite** on a list with no `visibility` tag that
   cannot say which half it lives in (`needs-mode`); the caller prompts
   Public or Private and calls again with `userChose`.
5. **Merge** through `plan`, **encrypt** the returned plaintext when the
   publish needs the private half, **sign** through `LBLogin.signEvent`, and
   refuse an event the signer returns under another key.
6. **Publish** on raw sockets to nos.lol, damus and ditto plus the member's
   NIP-65 write relays (read off their kind 10002), one OK per relay. One
   `OK true` is landing; the baseline is recorded then and only then.

**The migration gate is enforced here**: an item favorite is refused
(`items-gated`), and so is any publish onto a list still holding legacy
two-element items, because the merge rewrites them on the way through.
`itemsAllowed` lifts both once Chad confirms both apps read the new form.

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
first two cases as a regression beside the 29 vectors. The vendored SHA is
ahead of the spec's `main` until the PR merges.

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

**Publish** (step three) goes to nos.lol, damus, primal and ditto plus the
NIP-65 write relays. **Primal joined both sets on 2026-09-08, after Reed's
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
  not a settings page. First favorite on an untagged, empty list prompts
  Public or Private; the spec allows no default.
- Foreign entries the index cannot resolve go through a bounded Podcast Index
  lookup on `_shared/podcast-index.js#piGet` and link to BMB, the way podroll
  tiles already do for a show with no page here.
- Signed out gets nothing. The bot cannot hold favorites.
- A signer without NIP-44 is read-and-carry only, with a line on screen. The
  NIP-04 fallback in `selfEncrypt.js` is forbidden here.

## What Is Next

1. ~~The relay reader~~ built 2026-09-08.
2. ~~The writer~~ built 2026-09-08.
3. ~~The heart~~ built 2026-09-08, show surfaces live, episode surfaces gated.
4. ~~The `#favorites` section~~ built 2026-09-08.
5. ~~The dropdown rows~~ built 2026-09-08.
6. Later, and the real reason to do it: the collector indexes public lists and
   "favorited by N members" becomes a show stat or chart component.
