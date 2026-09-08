# PC 2.0 Favorites (kind 10333)

The design record for OnlyBoosts' support of Chad Farrow's cross-app podcast
favorites. **Status, 2026-09-07: phase one built, nothing on any surface, no
relay ever written.** The merge module and its test exist; the button, the
`/booster` section, the writer and the settings rows do not.

| | |
|---|---|
| Spec | https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites.md (re-read it before building on this file; it moved five times in the first week of September 2026, the last a rewrite of the item entry) |
| Vendored vectors | `scripts/vendor/pc20-favorites/` at the SHA in its `PROVENANCE` |
| The module | `assets/js/favorites-merge.js`, the spec's reference implementation with two adaptations |
| The test | `node scripts/test-favorites-merge.mjs` |
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
at commit fcb9d79, lifted with Chad's OK (via Reed, 2026-09-07). The reference's
own header says it has never served traffic; what makes it the right base is
that every rule in it cites the spec section it implements and the spec's 28
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

## Relays

Measured 2026-09-06 against Chad's own list (read-only): `relay.fountain.fm`
**refuses** the kind ("kinds not supported"); `nos.lol` and `relay.damus.io`
held the current event; `relay.ditto.pub` a copy 19 hours stale;
`relay.mostr.pub` a three-day-old copy from when the list was private, with
**zero public tags** (read alone it is an empty list); `relay.wavlake.com`
three weeks stale; `relay.primal.net`, `relay.snort.social` and
`theforest.nostr1.com` nothing, though both apps publish to primal.

So: **read** nos.lol, damus, ditto and mostr plus the user's NIP-65 write
relays; require two answers; newest `created_at` wins; **never publish on a
degraded read** (rule 1, and BMB's rule too). **Publish** to nos.lol, damus and
ditto plus the NIP-65 write relays. A throwaway-key publish test of primal is
still owed. Chad's own hardcoded set (BMB's `DEFAULT_RELAYS`) includes fountain
and primal and he reports it fine; the difference is that his apps have a local
library to fall back on and this site does not.

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

1. The relay reader: raw sockets or nostr-tools, two-relay agreement, newest
   wins, `null` for a degraded read.
2. The writer around `plan`: baseline per pubkey per half in `localStorage`,
   NIP-44 through the widget's signer, publish, record the baseline only on a
   relay's OK.
3. The heart on the six boost-button surfaces, and the `#favorites` section.
4. The dropdown rows and the Public/Private prompt.
5. Later, and the real reason to do it: the collector indexes public lists and
   "favorited by N members" becomes a show stat or chart component.
