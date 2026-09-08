/**
 * favorites-merge.js — the kind:10333 PC 2.0 Favorites merge, as the spec's
 * own reference implementation, adapted for this site.
 *
 * SOURCE: https://github.com/ChadFarrow/PC20-Nostr conformance/reference/favorites.mjs
 * at commit 0fc52c4 (2026-09-08, PR #38, the fix for issue #37 this site
 * reported), lifted with Chad's OK (via Reed, 2026-09-07). Every rule below
 * cites the section of pc20-favorites.md it comes from, and the spec's 29
 * vectors run against THIS file: `node scripts/test-favorites-merge.mjs`
 * (scripts/vendor/pc20-favorites/ holds the vectors and the SHA they came from).
 * A change here that the vectors do not cover is a change to the spec; raise it
 * upstream as an issue or PR before shipping it, that is the deal — issue #37
 * (a removal never propagated on a private list) is what that looks like.
 *
 * WHAT DIFFERS FROM THE REFERENCE, and nothing else does:
 *
 *   1. No fake codec. The reference seals the private half with a reversible,
 *      unauthenticated stand-in so its vectors need no crypto. That code is
 *      NOT here: a stand-in that ships is a private half anyone can read. The
 *      real half is NIP-44 encrypt-to-self through the signer, which is ASYNC,
 *      so `plan` takes the private half's PLAINTEXT in and hands the plaintext
 *      to encrypt back out (`readPrivate`, `privatePlaintext` below). The test
 *      shim injects a sync `codec` to drive the vectors unchanged.
 *   2. `plaintextBytes` counts with TextEncoder, not Buffer: this runs in a
 *      browser.
 *
 * Dependency-free on purpose, the rank.js discipline: nothing here reads a
 * clock, a locale, the DOM or the network. It decides a publish; something
 * else reads relays, signs, and sends.
 */

export const KIND = 10333;
export const ALT = 'PC 2.0 Favorites';
/** The tag naming which half the whole list lives in. Multi-letter on purpose:
 *  relays index single-letter tags, and `#v=private` would enumerate the
 *  pubkeys that keep one. */
export const VISIBILITY = 'visibility';

/**
 * Position 1 of a feed favorite AND of an item favorite: the feed's
 * `<podcast:guid>`, as the NIP-73 identifier `podcast:guid:<feedGuid>`.
 *
 * An item guid is unique inside its feed and is NOT globally unique, so it is
 * not an address on its own — the Podcast Index `/episodes/byguid` lookup
 * refuses the call outright without a `feedid`, `feedurl` or `podcastguid`
 * beside it. The pair is the address, and it is written in the order
 * `<podcast:remoteItem>` writes it: the required `feedGuid` first, then the
 * optional `itemGuid`. Data Structure, "One favorite, one tag".
 */
const FEED_PREFIX = 'podcast:guid:';

/** The bare feed guid inside a `podcast:guid:` identifier. */
export const feedGuidOf = (identifier) =>
  typeof identifier === 'string' && identifier.startsWith(FEED_PREFIX)
    ? identifier.slice(FEED_PREFIX.length)
    : null;

/** The `podcast:guid:` identifier for a bare feed guid. */
export const feedIdOf = (guid) => FEED_PREFIX + guid;

/**
 * The item identifier at position 2, or null when the tag carries none.
 *
 * Its PRESENCE is the whole distinction between a feed favorite and an item
 * favorite, because both carry the same identifier at position 1.
 * `<podcast:remoteItem>` draws the line in the same place: `feedGuid` alone
 * points at the feed, `feedGuid` plus `itemGuid` points at one item in it.
 *
 * Position 2 is a full `podcast:item:guid:` identifier, not a bare guid. It
 * costs about 18 bytes an entry and buys a tag that says what each half of it
 * is without a table — the same reason position 1 is not a bare feed guid.
 * A position 2 this writer cannot recognise is NOT an item entry: the tag is
 * carried whole and untouched instead of guessed at (rule 4).
 */
export function itemIdOf(tag) {
  const g = tag?.[2];
  return typeof g === 'string' && kindOf(g) === 'podcast:item:guid' ? g : null;
}

/**
 * What makes an entry unique, and therefore what a baseline claims and what a
 * dedupe collapses.
 *
 * A FEED or an ARTIST is its identifier. An ITEM is the PAIR: the same item
 * guid under two different feed guids is two different items, because an item
 * guid is only unique within its feed. Deduping on the identifier alone would
 * merge two real favorites into one.
 *
 * Position 1 no longer separates them either. A feed favorite and an item
 * favorite of that same feed carry the SAME string at position 1 — only the
 * item's position 2 tells them apart — so an entry key that reads position 1
 * alone folds a feed favorite together with every item favorite under it.
 *
 * Relay `#i` filters match position 1 alone, which is now the feed guid for
 * both. A `#i` for a feed therefore returns the feed favorite and every item
 * favorite from it, and a per-item `#i` on this kind is not available. See
 * "What this format does not do".
 */
export const keyOf = (entry) =>
  entry.feed === null || entry.feed === undefined
    ? entry.id
    : itemClaim(entry.id, entry.feed);

/**
 * The baseline claim for one item favorite.
 *
 * A baseline records what THIS device asserted, so its entries must be as
 * unique as the things they stand for. An item is the pair, so a claim on an
 * item is the pair. The exact string is this writer's own business — nothing
 * on the wire carries it — but an adapter must export this so the vectors can
 * hand it a baseline in the shape it writes one.
 */
export const itemClaim = (itemId, feedGuid) => itemId + ' @ ' + feedGuid;

/**
 * The known-kinds table. Data Structure, "Derive the kind from a known-kinds
 * table rather than by scanning the string": item guids are routinely
 * permalink URLs, so "everything before the last colon" on
 * `podcast:item:guid:https://example.com/ep/42` yields `podcast:item:guid:https`.
 *
 * Longest first so a prefix can never shadow a longer one.
 */
const KNOWN_KINDS = [
  'podcast:publisher:guid',
  'podcast:item:guid',
  'podcast:guid',
];

/** The kind of an identifier, or null when no writer here knows it. */
export function kindOf(identifier) {
  if (typeof identifier !== 'string') return null;
  for (const k of KNOWN_KINDS) {
    if (identifier.startsWith(k + ':')) return k;
  }
  return null;
}

const isFeedKind = (k) => k === 'podcast:guid';

/**
 * The kind an ENTRY declares, which is not always the kind of its identifier.
 *
 * `podcast:guid:<feedGuid>` with an item guid beside it IS an item entry, so
 * it declares `podcast:item:guid`. Reading the prefix alone would drop that
 * kind off every list whose item favorites are all written the current way,
 * and `#k` discovery would stop finding item favorites entirely.
 *
 * The legacy two-element `podcast:item:guid:<itemGuid>` form already carries
 * its kind in the prefix, so it needs no special case here.
 */
export function kindOfTag(tag) {
  const item = itemIdOf(tag);
  if (item !== null && isFeedKind(kindOf(tag?.[1]))) return kindOf(item);
  return kindOf(tag?.[1]);
}

/**
 * A kind that is an entry in its own right and nests nothing.
 *
 * An artist. Favoriting one says "show me this artist's whole catalogue", and
 * the catalogue comes from resolving the publisher feed — the albums under it
 * are named there, not on this list. So it opens no group, closes none, and is
 * never an item of the group above it. Data Structure, "An artist is a
 * favorite that opens nothing".
 *
 * This USED to be a feed kind here, which made a track after an artist entry
 * parse with the artist as its parent. Both shipped writers place it as a
 * loose entry instead, so the reference was the outlier and the two answers
 * disagreed about which album a track came from. Vector 28.
 */
const isStandaloneKind = (k) => k === 'podcast:publisher:guid';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Tag array in, structure out.
 *
 *   - `medium` is a RUNNING value, applying to every entry after it. It is the
 *     only positional thing left in the format.
 *   - A `podcast:guid:` `i` with NOTHING at position 2 is a feed favorite.
 *     Its presence IS the favorite: nothing is on this list for structural
 *     reasons, so there is nothing to label.
 *   - A `podcast:guid:` `i` WITH a `podcast:item:guid:` identifier at
 *     position 2 is an item favorite — the feed at position 1, the item at
 *     position 2, the order `<podcast:remoteItem>` uses. It does not depend on
 *     the entry above it, so sorting or rebuilding the array cannot move it to
 *     another feed.
 *   - A `podcast:guid:` `i` with something UNREADABLE at position 2 is
 *     neither. It is carried whole rather than read as a feed favorite, or a
 *     newer writer's entry silently becomes a followed show.
 *   - An entry before any `medium` tag has an UNKNOWN medium — null here,
 *     never defaulted to 'podcast'.
 *   - `k` takes no part in anything and is never used to derive an entry's
 *     kind. Both `k` layouts therefore parse identically (vector 7).
 *   - An unparseable `i` is carried whole (rule 4).
 *
 * LEGACY: a two-element `podcast:item:guid:` tag predates all of this, and
 * every list published before this revision is full of them. Its feed comes
 * from the most recent feed entry above it, which is where the old format kept
 * it. Dropping that path does not merely lose a label — an item guid alone is
 * not an address, so it would make every published item favorite unresolvable.
 */
export function parseTags(tags) {
  let medium = null;
  let openFeed = null; // legacy only: the feed a bare item tag belongs to
  const entries = [];
  const kinds = [];
  const foreign = [];

  (tags ?? []).forEach((tag, index) => {
    const name = tag[0];
    const value = tag[1];

    if (name === 'medium') {
      medium = value ?? null;
      openFeed = null; // a medium tag ended a legacy run
      return;
    }
    if (name === 'k') {
      kinds.push(value);
      return;
    }
    if (name === 'alt') return;

    if (name !== 'i') {
      foreign.push({ index, tag });
      return;
    }

    const kind = kindOf(value);
    if (kind === null) {
      // Unreadable identifier. Carried whole, and a legacy run stays open.
      foreign.push({ index, tag });
      return;
    }

    const itemId = itemIdOf(tag);
    const slot2 = tag[2];

    if (isFeedKind(kind)) {
      if (itemId === null && typeof slot2 === 'string' && slot2 !== '') {
        // A feed identifier with SOMETHING at position 2 that this writer
        // cannot read. It is not a feed favorite — a later revision may have
        // put another kind of entry here — so guessing turns one saved
        // episode into a followed show. Carry it whole (rule 4), and do not
        // open a legacy run on it either.
        foreign.push({ index, tag });
        return;
      }
      if (itemId === null) {
        // A feed favorite. It still opens a run for the legacy path below.
        openFeed = feedGuidOf(value);
        entries.push({ id: value, kind, medium, index, feed: null, favorited: true });
      } else {
        // An item favorite: this feed, that item. Note it does NOT open a
        // legacy run — the feed is here because the ITEM needs it, and the
        // user may never have favorited the feed at all.
        entries.push({
          id: itemId,
          kind: 'podcast:item:guid',
          medium,
          index,
          feed: feedGuidOf(value),
          legacy: false,
        });
      }
    } else if (isStandaloneKind(kind)) {
      // An artist. Always a favorite: nothing else puts one on the list, and
      // it belongs to no feed.
      entries.push({ id: value, kind, medium, index, feed: null, favorited: true });
    } else {
      // A two-element `podcast:item:guid:` tag — legacy only. Its feed is
      // whichever feed entry was last opened above it.
      entries.push({
        id: value,
        kind,
        medium,
        index,
        feed: openFeed,
        legacy: true,
      });
    }
  });

  for (const e of entries) e.key = keyOf(e);

  // Which feeds the user favorited. A feed entry means exactly that, so the
  // question the marker used to answer does not arise.
  const favorited = new Map();
  for (const e of entries) {
    if (isFeedKind(e.kind)) favorited.set(e.id, true);
  }

  return { entries, kinds, foreign, favorited };
}

/**
 * Whole event in, structure plus the raw halves out.
 *
 * `readPrivate` is the private half ALREADY decrypted and decoded by the
 * caller (`decodePlaintext(await nip44Decrypt(content))`): a tag array, `[]`
 * for an empty `content`, or NULL when this signer cannot open it. The
 * reference decoded it here with its stand-in codec; the real one is async.
 */
export function parse(event, readPrivate = null) {
  const tags = event?.tags ?? [];
  const content = event?.content ?? '';
  return {
    ...parseTags(tags),
    content,
    private: readPrivate,
  };
}

// ---------------------------------------------------------------------------
// The private half
// ---------------------------------------------------------------------------


/**
 * The largest plaintext a writer may hand a signer, in UTF-8 bytes.
 *
 * NIP-44 v2 as first published capped plaintext at 65535 bytes; the current
 * text allows more and switches to a 6-byte length prefix at 65536, so a
 * library built to the older text REJECTS a payload across that line — and a
 * private half that cannot be decrypted is indistinguishable from an empty
 * one. Sized under the cliff with room for the 1.5x NIP-44 adds on the way to
 * `content`. Writing the private half, "Refuse to publish past 60,000 bytes".
 */
export const PRIVATE_PLAINTEXT_MAX = 60_000;

/** UTF-8 byte length, which is what the NIP-44 limit counts. */
export const plaintextBytes = (text) => new TextEncoder().encode(text).length;

/**
 * The bytes handed to the signer: a stringified tag array, with `?` written as
 * its six-character JSON escape.
 *
 * Writing the private half, "The plaintext carries no `?`": a NIP-55 signer
 * URL-decodes the whole `nostrsigner:` URI and only then splits it on `?`, so
 * one favorited track with a query string in its guid would otherwise break
 * every private publish on Android, forever. Every JSON reader already
 * understands the escape, so the other app decodes it without being told.
 */
export function encodePlaintext(tags) {
  return JSON.stringify(tags ?? []).replace(/\?/g, '\\u003f');
}

/**
 * The plaintext back into a tag array, or NULL when it is not one.
 *
 * Null, not `[]`, for valid JSON that is not an array of string arrays. A
 * `JSON.parse` that succeeds on `{}` would otherwise mark the half readable
 * and empty, and the next republish rewrites `content` from that emptiness.
 * Writing the private half, "A plaintext that is not a tag array is unreadable".
 */
export function decodePlaintext(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  for (const tag of parsed) {
    if (!Array.isArray(tag) || !tag.every((v) => typeof v === 'string')) return null;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

/**
 * One `i` per ENTRY KEY, first position wins.
 *
 * Only reachable from the both-halves state: an entry in BOTH halves is one
 * entry, and a whole-list move that concatenates the halves emits it twice.
 * The key is the pair for an item, so the same item guid under two different
 * feed guids is two entries and both survive — they are two different items.
 */
function dedupeEntries(tags) {
  const parsed = parseTags(tags);
  const keyAt = new Map();
  for (const e of parsed.entries) keyAt.set(e.index, e.key);

  const seen = new Set();
  const out = [];
  (tags ?? []).forEach((tag, index) => {
    const key = keyAt.get(index);
    if (key !== undefined) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(tag);
  });
  return out;
}

/**
 * The keys this device is asserting.
 *
 * A local group is a convenient shape for "these items, from this feed" — the
 * feed guid an item needs comes from the group holding it. `favorited` says
 * whether the FEED itself is a favorite; without it the group contributes only
 * its items, and no feed entry is written at all. That is the case the old
 * format could not express without a placement marker.
 */
const keysOf = (localGroups) => {
  const out = new Set();
  for (const g of localGroups ?? []) {
    const kind = kindOf(g.id);
    if (isStandaloneKind(kind)) {
      out.add(g.id);
      continue;
    }
    if ((g.favorited ?? false) === true) out.add(g.id);
    const feed = feedGuidOf(g.id);
    for (const item of g.items ?? []) out.add(item + ' @ ' + feed);
  }
  return out;
};

/**
 * The tag a local item is written as: the FEED at position 1, the item guid
 * bare at position 2. `<podcast:remoteItem>`'s order, and its optionality —
 * the required half names the feed, the optional half narrows it to one item.
 *
 * A null feed guid means a local group whose id is not a `podcast:guid:`
 * identifier — a caller error, not a wire state — and it emits the legacy form
 * rather than inventing a guid. An item READ off the wire that names no feed
 * never reaches here at all: the pass above carries it whole and untouched,
 * which is what vector 20 pins.
 */
const itemTag = (itemId, feedGuid) =>
  feedGuid === null ? ['i', itemId] : ['i', feedIdOf(feedGuid), itemId];

/**
 * Rule 3, over ONE half's tag array.
 *
 *   an entry you hold locally            keep it
 *   an entry not in your baseline        carry it — another app added it
 *   an entry in your baseline, absent    drop it — you removed it
 *   anything you can't parse             carry the whole tag
 *
 * Then append what you hold that was not on the list, unless the baseline
 * names it — that is another app's removal, and re-adding it is a
 * resurrection loop.
 *
 * `append: false` turns that second pass off, and is what the whole-list move
 * between halves needs — the move reads the half it is emptying, where an entry
 * this device holds is already on the list and appending it again would open a
 * second `medium` run for it. The three rows above still run: `append` decides
 * what is ADDED, never what is kept.
 *
 * There used to be an `adoptAll` flag here instead, and it was the wrong shape.
 * Row 2 already carries an entry this device neither holds nor claims, so the
 * flag's only effect was to suppress row 3 — every removal, silently, on both
 * move branches. The moving side never wanted an exemption from rule 3; it
 * wanted pass 2 off, which it got by being handed `[]` for `localGroups`, at
 * the cost of the `held` set row 3 needs to tell a removal from another app's
 * entry.
 *
 * There is no feed-survival rule any more. A feed entry held nothing up, so
 * dropping one never took another app's items with it.
 */
function mergeHalf(readTags, localGroups, baselineIds, { append = true } = {}) {
  const held = keysOf(localGroups);
  const claimed = new Set(baselineIds ?? []);
  const keep = (key) => held.has(key) || !claimed.has(key);

  const parsed = parseTags(readTags);
  const decision = new Map(); // tag index -> true/false
  const entryAt = new Map();
  for (const e of parsed.entries) {
    decision.set(e.index, keep(e.key));
    entryAt.set(e.index, e);
  }

  const out = [];
  let emittedMedium = null;
  (readTags ?? []).forEach((tag, index) => {
    const name = tag[0];
    if (name === 'alt' || name === 'k') return; // regenerated below
    if (name === 'medium') {
      // Carried, but only if something after it still needs it. Emitting a
      // medium run with no entries under it is a byte change for nothing.
      const nextMedium = (readTags ?? []).findIndex(
        (t, i) => i > index && t[0] === 'medium',
      );
      const end = nextMedium === -1 ? readTags.length : nextMedium;
      const anyKept = (readTags ?? []).some(
        (t, i) =>
          i > index &&
          i < end &&
          (decision.get(i) === true ||
            (decision.get(i) === undefined && t[0] === 'i')),
      );
      if (anyKept) {
        out.push(tag);
        emittedMedium = tag[1] ?? null;
      }
      return;
    }
    if (decision.has(index)) {
      if (decision.get(index)) {
        const e = entryAt.get(index);
        // THE MIGRATION, and it happens once per list. A legacy item tag
        // knows its feed only from the entry above it; rewriting it as
        // `['i', podcast:guid:<feed>, <item>]` is what makes it survive a
        // reorder. Nothing else in this function rebuilds a tag, so a tag
        // that is already self-addressing is pushed whole and rule 5 still
        // sees no change.
        if (e && e.legacy && e.feed !== null) out.push(itemTag(e.id, e.feed));
        else out.push(tag);
      }
      return;
    }
    out.push(tag); // foreign tag, or an `i` no writer here can parse — carried
  });

  // Pass 2: add what we hold that was not on the list.
  //
  // A new entry goes at the END OF ITS OWN MEDIUM RUN — never ahead of what
  // was read, which is the local-first order that has two apps rewriting the
  // event at each other forever, and never simply at the end of the event,
  // which opens a second run for a medium that already has one. Ordering no
  // longer decides which feed an item belongs to, so this is about churn and
  // contiguity rather than about correctness.
  const onList = new Set(parsed.entries.map((e) => e.key));

  /** Insert tags at the end of `medium`'s run, opening one if there is none. */
  const appendInRun = (medium, tags) => {
    if (tags.length === 0) return;
    // Where each emitted tag's run starts, walking what we have emitted.
    let run = null;
    let lastOfRun = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i][0] === 'medium') run = out[i][1] ?? null;
      if (run === medium) lastOfRun = i;
    }
    if (lastOfRun === -1) {
      if (medium !== null) out.push(['medium', medium]);
      out.push(...tags);
      emittedMedium = medium;
      return;
    }
    out.splice(lastOfRun + 1, 0, ...tags);
  };

  // `append: false` skips this pass and only this pass. The caller is merging
  // the half it is about to empty, where an entry we hold is already on the
  // list; what we hold is appended once, by the merge that owns the half it is
  // moving INTO.
  for (const g of append ? (localGroups ?? []) : []) {
    const kind = kindOf(g.id);
    const standalone = isStandaloneKind(kind);
    const feed = standalone ? null : feedGuidOf(g.id);

    const wantsFeed = standalone || (g.favorited ?? false) === true;
    const feedIsNew = wantsFeed && !onList.has(g.id) && !claimed.has(g.id);
    const newItems = standalone
      ? []
      : (g.items ?? []).filter((id) => {
          const key = itemClaim(id, feed);
          return !onList.has(key) && !claimed.has(key);
        });

    if (!feedIsNew && newItems.length === 0) continue;

    const fresh = [];
    if (feedIsNew) fresh.push(['i', g.id]);
    for (const id of newItems) fresh.push(itemTag(id, feed));
    appendInRun(g.medium ?? null, fresh);
  }

  // Pass 3: put each run in band order. `appendInRun` only kept a medium run
  // from being split in two; this is what decides where inside it an entry
  // sits, for read and local entries alike.
  return orderRun(out);
}

/**
 * The four bands of one `medium` run, in emit order.
 *
 *   0  an item that names NO feed
 *   1  artists
 *   2  albums and podcasts
 *   3  items, grouped by the feed they name
 *
 * BAND 0 IS NOT COSMETIC. A legacy `["i","podcast:item:guid:X"]` takes its
 * feed from the most recent feed entry above it. Put every feed entry above
 * every item and such an entry resolves to the LAST album in band 2 — a wrong
 * feed, which is worse than none, and worse than what it had. Ahead of band 2
 * there is no feed entry to mistake for its parent; an artist is never a feed,
 * so band 1 beside it is harmless. Vector 20.
 *
 * A resolvable legacy item never reaches band 0: the same publish rewrites it,
 * so it arrives in band 3 already naming its feed.
 */
const bandOf = (e) => {
  if (e.kind === 'podcast:publisher:guid') return 1;
  if (e.kind === 'podcast:item:guid') return e.feed === null ? 0 : 3;
  return 2; // a feed favorite
};

/**
 * Emit order inside each `medium` run. Data Structure, "Tag order".
 *
 * Applied ONCE, to the whole merged half, rather than threaded through the two
 * merge passes. That is what makes an entry land in the same place whether it
 * came off the wire or out of local state — two passes each doing half the job
 * is how two writers' orders drift apart.
 *
 * Order is prescribed rather than preserved, and the difference matters. The
 * old rule was "keep what you read, append yours", whose failure mode was two
 * apps imposing DIFFERENT orders and rewriting the event at each other. One
 * order in the document converges; "preserve what you read" only converges if
 * every writer preserves. This is available at all only because an entry names
 * its own feed — under the old format, moving a track away from its album
 * destroyed the association.
 *
 * WITHIN a band the read order is kept and new entries land at the end, so no
 * existing list is reshuffled. Band 3 groups by feed, groups in order of first
 * appearance, so an album's tracks stay together.
 *
 * A RUN HOLDING A TAG THIS WRITER CANNOT CLASSIFY IS EMITTED AS READ. Rule 4
 * carries an unparseable `i` or an unknown tag type untouched, and vector 4
 * pins that such a tag between a feed entry and a legacy item must not end the
 * run. Rather than invent a place for something with no band, leave the run
 * alone: it degrades to the old behaviour, and a writer that cannot sort still
 * preserves what a writer that can wrote.
 */
function orderRun(tags) {
  const parsed = parseTags(tags);
  const entryAt = new Map(parsed.entries.map((e) => [e.index, e]));
  const foreignAt = new Set(parsed.foreign.map((f) => f.index));

  // Split into runs: each `medium` tag opens one, and anything before the
  // first opens a headless run whose entries have an unknown medium.
  const runs = [];
  let current = { header: null, idx: [] };
  (tags ?? []).forEach((tag, index) => {
    if (tag[0] === 'medium') {
      runs.push(current);
      current = { header: tag, idx: [] };
      return;
    }
    current.idx.push(index);
  });
  runs.push(current);

  const out = [];
  for (const run of runs) {
    if (run.header) out.push(run.header);
    if (run.idx.length === 0) continue;

    if (run.idx.some((i) => foreignAt.has(i) || !entryAt.has(i))) {
      for (const i of run.idx) out.push(tags[i]);
      continue;
    }

    const bands = [[], [], [], []];
    for (const i of run.idx) bands[bandOf(entryAt.get(i))].push(i);

    // Band 3 groups by feed, groups in order of first appearance.
    const groups = new Map();
    for (const i of bands[3]) {
      const feed = entryAt.get(i).feed;
      if (!groups.has(feed)) groups.set(feed, []);
      groups.get(feed).push(i);
    }
    bands[3] = [...groups.values()].flat();

    for (const band of bands) for (const i of band) out.push(tags[i]);
  }
  return out;
}

/**
 * `alt` first, entries in the middle, one `k` per distinct kind at the end.
 *
 * `carried` holds `k` values read off the event that this writer does not
 * derive — a kind named by a writer newer than us. Rule 4: carried through
 * untouched, not dropped because we have no meaning for it. Regenerating the
 * derivable ones is what makes both `k` layouts (vector 7) converge on the
 * one the Data Structure section specifies.
 */
function frame(entryTags, carried = [], visibility = null) {
  const kinds = [];
  for (const t of entryTags) {
    if (t[0] !== 'i') continue;
    // `kindOfTag`, not `kindOf`: an item entry's identifier says
    // `podcast:guid` and the entry is `podcast:item:guid`. Reading the prefix
    // alone drops the item kind off the event, and `#k` discovery stops
    // finding item favorites.
    const k = kindOfTag(t);
    if (k && !kinds.includes(k)) kinds.push(k);
  }
  for (const k of carried) {
    if (k !== undefined && !kinds.includes(k)) kinds.push(k);
  }
  const head = visibility ? [['alt', ALT], [VISIBILITY, visibility]] : [['alt', ALT]];
  return [...head, ...entryTags, ...kinds.map((k) => ['k', k])];
}

/** Entry-bearing tags only — what `mergeHalf` consumes. */
const stripFrame = (tags) =>
  (tags ?? []).filter((t) => t[0] !== 'alt' && t[0] !== 'k' && t[0] !== VISIBILITY);

/**
 * The mode the event STATES, or null when it does not.
 *
 * Null is not "public". It means the list was written before this tag existed,
 * and the caller falls back to inferring the mode from whichever half holds
 * entries — which answers correctly for every list that has any, and cannot
 * answer at all for a list that has none.
 */
export function statedVisibility(tags) {
  for (const t of tags ?? []) {
    if (t[0] !== VISIBILITY) continue;
    if (t[1] === 'public' || t[1] === 'private') return t[1];
  }
  return null;
}

/** `k` values on the event that we cannot derive from our own entries. */
const foreignKinds = (tags) =>
  (tags ?? [])
    .filter((t) => t[0] === 'k')
    .map((t) => t[1])
    .filter((v) => !KNOWN_KINDS.includes(v));

const sameTags = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// One publish cycle
// ---------------------------------------------------------------------------

/**
 * Decide a cycle without sending it.
 *
 *   read      the event as read, or NULL when the read is not trustworthy
 *   local     this device's favorites, as feed groups
 *   baseline  { public: [ids], private: [ids] } — this device's claims,
 *             PER HALF (rule 2)
 *   mode      'public' | 'private' — the half this writer feeds
 *   readPrivate  the private half as read, DECRYPTED AND DECODED by the
 *             caller: a tag array, or NULL when this signer cannot open it.
 *             Ignored when `read.content` is '' (nothing to open) or when a
 *             `codec` is given. This is the async seam: NIP-44 goes through
 *             the signer, so the decrypt happens before `plan` is called.
 *   codec     OPTIONAL sync `{ decode(content) -> tags|null, encode(tags) -> string }`.
 *             The conformance shim supplies the spec's stand-in; production
 *             never passes one and reads `privatePlaintext` instead.
 *
 * Returns the event to publish (null = publish nothing) and the baseline to
 * record IF AND ONLY IF that publish lands. Recording it on a publish that
 * reached no relay is what makes a lost publish permanent (vector 10), so the
 * two are deliberately separate values rather than one side effect.
 */
export function plan({
  read,
  local = [],
  baseline,
  mode = 'public',
  canReadPrivate = true,
  userChose = false,
  readPrivate: readPrivateIn = null,
  codec = null,
}) {
  const base = {
    public: [...(baseline?.public ?? [])],
    private: [...(baseline?.private ?? [])],
  };

  // Rule 1. A read you don't trust is not an empty list. Publishing on one
  // republishes a whole library as empty.
  if (read === null || read === undefined) {
    return { publish: null, baselineIfLanded: base };
  }

  const readTags = stripFrame(read.tags);
  const readContent = read.content ?? '';
  // `canReadPrivate: false` stands in for a signer with no NIP-44. It is not
  // the same as an unparseable payload and it reaches the same place: bytes we
  // must carry and may not reason about.
  //
  // EXCEPT when there is nothing there. An empty `content` is readable by
  // anybody — there is no half to be blind to — so a signer with no NIP-44 may
  // still set the mode on a fresh list. Treating empty as opaque would freeze
  // every new account on such a signer at whatever the first writer guessed.
  const decode = codec ? codec.decode : (c) => (c === '' ? [] : readPrivateIn);
  const readPrivate =
    canReadPrivate || readContent === '' ? decode(readContent) : null;

  // What the EVENT says, which is not the same as what this writer wants.
  // Null means the list predates the tag.
  const stated = statedVisibility(read.tags);
  const opaque = readPrivate === null;

  // The fallback for a list with no tag: whichever half holds entries. It
  // answers for every list that has any, and it cannot answer for one that has
  // none — which is the gap the tag exists to close.
  const hasPublicEntries = readTags.some((t) => t[0] === 'i');
  const hasPrivateEntries = (readPrivate ?? []).some((t) => t[0] === 'i');
  const inferred =
    hasPublicEntries && !hasPrivateEntries
      ? 'public'
      : hasPrivateEntries && !hasPublicEntries
        ? 'private'
        : null; // both, or neither — a question, not an answer

  // `mode: null` is a writer with no stored preference: it follows the list.
  // If the list cannot say either, it must ASK — publishing on a guess is how
  // a favorite someone hid becomes a relay-indexed `i` tag.
  const listMode = stated ?? inferred;
  if (mode === null && listMode === null) {
    return { publish: null, baselineIfLanded: base };
  }
  const wanted = mode ?? listMode;

  // CHANGING A STATED MODE TAKES TWO THINGS, and neither is this writer's
  // standing preference.
  //
  //   the user asking for it — a stored setting that merely disagrees is two
  //   apps holding different answers about one shared event, and letting the
  //   one that loaded last win is how a list flips halves on a page load;
  //
  //   being able to read BOTH halves — an app whose signer has no NIP-44
  //   cannot move what it cannot see, so claiming the list is public would
  //   publish a false statement about someone's privacy, and the next writer
  //   to believe it converges on the strength of it.
  const mayChange = userChose && !opaque;
  // The list's own answer — stated, or inferred from a single populated half
  // — outranks this writer's standing setting. Acting on the setting is one
  // app silently overruling another; the apps ask instead, and following the
  // list is the answer that publishes nothing surprising. A choice may still
  // change it. Vector 13's second half.
  const effective =
    listMode && listMode !== wanted && !mayChange ? listMode : wanted;

  // The tag is carried forward once the list has one, and written for the
  // first time only when the user has actually chosen. A writer stamping its
  // own default on a legacy list would state a mode nobody picked — and on a
  // list that already has a private half, that stamp is what would license
  // disclosing it.
  const mayState = userChose || stated !== null;

  // The public direction is a DISCLOSURE, so it moves another app's entries
  // only on a stated intent. Without one, the conservative rule stands and we
  // take back only what our own baseline claims.
  const licensedPublic =
    effective === 'public' &&
    (stated === 'public' || (mayChange && wanted === 'public'));

  const goingPrivate = effective === 'private';
  const activeReadTags = goingPrivate ? (readPrivate ?? []) : readTags;
  const inactiveReadTags = goingPrivate ? readTags : (readPrivate ?? []);
  const activeBaseline = goingPrivate ? base.private : base.public;
  const inactiveBaseline = goingPrivate ? base.public : base.private;

  // We cannot read the private half. Carry the bytes and never touch them.
  // Rule 4's `content` clause: "Republish event.content byte for byte, unless
  // you encrypted the bytes you are replacing it with."
  const privateIsOpaque = opaque;

  let mergedActive;
  let mergedInactive;

  if (goingPrivate && privateIsOpaque) {
    // Another writer owns the private half and we cannot merge into it.
    // Do not switch on top of bytes we cannot read — that would drop them.
    //
    // NULL, not `[]`. An empty array is a private half we are asserting is
    // empty, and it re-encodes to real bytes that replace theirs — rule 4's
    // `content` clause broken by the one branch that exists to honour it.
    // Vector 17 is what caught this; vector 12 never reaches this branch,
    // because it reads the opaque half from the OTHER side.
    mergedActive = null;
    mergedInactive = readTags;
  } else if (goingPrivate) {
    // public → private takes the WHOLE list, ours and theirs. It only ever
    // reduces exposure, and it is reversible by any app that can decrypt.
    // Nothing needs an exemption from rule 3 to make that happen: another
    // app's entry is not in OUR baseline for the half it is leaving, so row 2
    // carries it, and it is not in our baseline for the half it is entering
    // either, so row 2 carries it again.
    //
    // `append: false`, not `[]` for the local state. Pass 2 is what had to go —
    // merging `local` into an empty public half appended our own groups a
    // second time, under a second `medium` run, a byte change on every
    // private-mode cycle, so the list never reached a fixed point. Handing this
    // merge `[]` turned pass 2 off and took the `held` set with it, and row 3
    // needs that set: without it every entry looks unheld, so an entry we
    // claim here and no longer hold — an unfavorite, made in this app — rode
    // the move into the private half instead of being dropped. There is no
    // second chance at it either. Our new private baseline cannot claim what
    // we do not hold, so no later cycle can remove it. Vector 29.
    const moving = mergeHalf(inactiveReadTags, local, inactiveBaseline, {
      append: false,
    });
    mergedActive = dedupeEntries(
      mergeHalf([...activeReadTags, ...moving], local, activeBaseline),
    );
    mergedInactive = [];
  } else if (licensedPublic && inactiveReadTags.some((t) => t[0] === 'i')) {
    // THE STATED MODE IS THE CONSENT, and it is the only thing that lifts the
    // private → public asymmetry. Two ways to have it: the event already says
    // public — which only a writer that could read both halves may have
    // written — or the user is choosing it right now, in an app that can see
    // everything it is about to disclose. Either way the whole list moves and
    // each entry is emitted once.
    // `append: false` on the moving side: `moving` is what the OTHER half
    // holds, not our own favorites a second time. The outer merge appends
    // those once, where they belong. Rule 3 runs on both merges — see the
    // going-private branch above for what suppressing it cost, and vector 29
    // for the case in this direction.
    const moving = mergeHalf(inactiveReadTags, local, inactiveBaseline, {
      append: false,
    });
    mergedActive = dedupeEntries(
      mergeHalf([...activeReadTags, ...moving], local, activeBaseline),
    );
    mergedInactive = [];
  } else {
    // private → public may NOT move another app's entries: it is a
    // disclosure, it publishes an `i` tag relays index, and it cannot be
    // taken back. Move only what our baseline says we put there.
    mergedActive = mergeHalf(activeReadTags, local, activeBaseline);
    if (privateIsOpaque) {
      mergedInactive = null; // carry the ciphertext verbatim
    } else {
      const returning = new Set(base.private);
      // Keys, not identifiers. An item is the pair, so the same item guid
      // under another feed guid is a different entry and is NOT ours to
      // reclaim.
      const inactiveKeyAt = new Map();
      for (const e of parseTags(inactiveReadTags).entries) {
        inactiveKeyAt.set(e.index, e.key);
      }
      mergedInactive = inactiveReadTags.filter((t, i) => {
        if (t[0] !== 'i') return true;
        return !returning.has(inactiveKeyAt.get(i));
      });
      // Skip anything the active half ALREADY holds. An entry can sit in both
      // halves at once — see vector 15 — and concatenating the claimed-back
      // ones unconditionally emits that identifier twice, which opens a second
      // group for the same feed and double-counts it for every reader. Only
      // reachable from the both-halves state, which is why no vector below 15
      // caught it.
      const already = new Set(parseTags(mergedActive).entries.map((e) => e.key));
      const claimedBack = inactiveReadTags.filter(
        (t, i) =>
          t[0] === 'i' &&
          returning.has(inactiveKeyAt.get(i)) &&
          !already.has(inactiveKeyAt.get(i)),
      );
      mergedActive = mergeHalf(
        [...mergedActive, ...claimedBack],
        local,
        activeBaseline,
      );
    }
  }

  const carriedKinds = foreignKinds(read.tags);
  const publicTags = frame(
    goingPrivate ? mergedInactive : mergedActive,
    carriedKinds,
    mayState ? effective : stated,
  );
  const privateTags = goingPrivate ? mergedActive : mergedInactive;

  // Rule 4: an opaque half is republished byte for byte. Note the shape —
  // `content` is a value threaded from the read, never a literal. A default
  // parameter is how a `''` gets written back in by habit.
  //
  // Without a codec the ciphertext cannot be produced here — NIP-44 runs in
  // the signer, asynchronously — so `content` is NULL and `privatePlaintext`
  // is the exact string to encrypt-to-self and put in its place. An empty
  // private half is '' either way (the reference sealed nothing for an empty
  // array), and a carried half is the read's bytes untouched.
  const privatePlaintext =
    privateTags === null || privateTags.length === 0 ? null : encodePlaintext(privateTags);
  const content =
    privateTags === null
      ? readContent
      : privateTags.length === 0
        ? ''
        : codec
          ? codec.encode(privateTags)
          : null;

  // Rule 5: compare against THE READ, byte for byte. Only that notices that
  // another app has edited the event since.
  //
  // Compare the DECODED private half, not the encoded bytes. Real NIP-44
  // draws a fresh nonce per encryption, so identical entries produce
  // different ciphertext every time and a bytes comparison always differs —
  // every load republishes, forever. The fake codec here is deterministic and
  // would hide that, so the comparison is written the way a real one must be.
  // RULE 5, AND THE COMPARISON IS AGAINST THE READ PUT BACK THROUGH `frame`,
  // never against `read.tags` as it arrived. Two conforming events differ:
  // a reader must accept a `k` beside every `i` while a writer must emit one
  // `k` per distinct kind at the end, and the positions of `alt` and
  // `visibility` and the order of the `k` tags are free besides. Compare the
  // raw bytes and reading a list the other app wrote reports a change every
  // time, on a list nothing has changed about — and if that app compares raw
  // too, neither ever stops. Vector 7.
  //
  // Framed AS IT WAS, though: its own `visibility`, not ours. Otherwise a list
  // that predates the tag differs from itself forever and every load
  // republishes. A list that genuinely lacks the tag does differ, once, and
  // that publish is the migration.
  const unchanged =
    sameTags(publicTags, frame(readTags, carriedKinds, stated)) &&
    JSON.stringify(privateTags ?? readPrivate) === JSON.stringify(readPrivate);

  // Writing the private half: a plaintext past the NIP-44 v2 cliff reads back
  // as EMPTY on an older signer, not as an error. Refusing costs one favorite;
  // publishing costs the whole list on that device. Vector 24.
  if (
    !unchanged &&
    privateTags !== null &&
    privateTags.some((t) => t[0] === 'i') &&
    plaintextBytes(encodePlaintext(privateTags)) > PRIVATE_PLAINTEXT_MAX
  ) {
    return { publish: null, baselineIfLanded: base };
  }

  const publish = unchanged
    ? null
    : codec
      ? { kind: KIND, tags: publicTags, content }
      : { kind: KIND, tags: publicTags, content, privatePlaintext };

  // Rule 2, per half. The half we did NOT publish into has no new
  // contribution, so its claims are CARRIED, never recomputed. Recompute them
  // and we claim every entry in it, another writer's included; nothing backs
  // the claim next cycle, so rule 3's "in your baseline, absent locally" row
  // fires on the whole half at once.
  //
  // Claims are ENTRY KEYS. A feed favorite is an ordinary entry now, so it
  // needs no claim of its own: its presence on the list is the favorite, and
  // removing it is an ordinary removal.
  const activeTags = goingPrivate ? privateTags ?? [] : publicTags;
  const heldLocally = keysOf(local);
  const activeClaims = parseTags(activeTags)
    .entries.map((e) => e.key)
    .filter((key) => heldLocally.has(key) || activeBaseline.includes(key));

  const carriedInactive = inactiveBaseline.filter(
    (id) => !activeClaims.includes(id),
  );

  const baselineIfLanded = goingPrivate
    ? { public: carriedInactive, private: activeClaims }
    : { public: activeClaims, private: carriedInactive };

  return { publish, baselineIfLanded };
}
