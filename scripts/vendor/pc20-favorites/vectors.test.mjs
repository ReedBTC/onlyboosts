/**
 * The 28 test vectors of ../pc20-favorites.md, executable.
 *
 * The spec states them as behaviors "so they can be written against any test
 * runner". This is that, for one runner, driven through the pure functions
 * described in ./adapter.d.ts. Point ADAPTER at your own implementation and
 * the same 28 run against it.
 *
 * Two ways to point it. Edit the import below, or leave this file alone and
 * set `PC20_FAVORITES_ADAPTER` to the path of your shim — which is what lets
 * an app run this suite from its own checkout without copying it:
 *
 *   PC20_FAVORITES_ADAPTER=./scripts/conformance-adapter.mjs \
 *     node --test ../PC20-Nostr/conformance/vectors.test.mjs
 *
 * Numbering matches the spec exactly. If you add a vector there, add it here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ADAPTER = await import(
  process.env.PC20_FAVORITES_ADAPTER
    ? pathToFileURL(path.resolve(process.env.PC20_FAVORITES_ADAPTER)).href
    : './reference/favorites.mjs'
);

const {
  parseTags,
  kindOf,
  plan,
  decodePrivate,
  encodePrivate,
  encodePlaintext,
  decodePlaintext,
  seal,
  itemClaim,
} = ADAPTER;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FEED_A = 'podcast:guid:aaaaaaaa-0000-0000-0000-000000000001';
const ITEM_A1 = 'podcast:item:guid:aaaaaaaa-1111-0000-0000-000000000001';
const ITEM_A2 = 'podcast:item:guid:aaaaaaaa-1111-0000-0000-000000000002';
const FEED_B = 'podcast:guid:bbbbbbbb-0000-0000-0000-000000000002';
const ITEM_B1 = 'podcast:item:guid:bbbbbbbb-1111-0000-0000-000000000001';
const FEED_C = 'podcast:guid:cccccccc-0000-0000-0000-000000000003';

const ALT = ['alt', 'PC 2.0 Favorites'];
const VIS_PUBLIC = ['visibility', 'public'];
const VIS_PRIVATE = ['visibility', 'private'];
const K_FEED = ['k', 'podcast:guid'];
const K_ITEM = ['k', 'podcast:item:guid'];

const ev = (tags, content = '') => ({ kind: 10333, tags, content });
/**
 * A feed this device holds. `favorited` says whether the FEED itself is a
 * favorite; `items` are item favorites from that feed, which need the feed
 * guid and nothing else. Default true, because most fixtures here hold both.
 */
const feed = (id, medium, items = [], favorited = true) => ({
  id,
  medium,
  items,
  favorited,
});

/** The bare feed guid inside a `podcast:guid:` identifier. */
const guidOf = (feedId) => feedId.slice('podcast:guid:'.length);

/**
 * An item `i` tag: the FEED's identifier at position 1, the ITEM's identifier
 * at position 2 — `<podcast:remoteItem>`'s order, required feedGuid then
 * optional itemGuid, both written as full NIP-73 identifiers.
 */
const item = (itemId, feedId) => ['i', feedId, itemId];

/**
 * The full NIP-73 identifier an `i` tag names, whichever form it is in.
 *
 * A three-element `podcast:guid:` tag names an ITEM, so position 1 is not the
 * answer. Every assertion below is written in identifiers, so this is what
 * they look entries up by.
 */
const entryId = (tag) => {
  if (tag?.[0] !== 'i') return undefined;
  const g = tag[2];
  if (typeof g === 'string' && g.startsWith('podcast:item:guid:')) return g;
  return tag[1];
};

/**
 * The baseline claim for one item favorite. An item is the PAIR, so a claim on
 * one is the pair — a baseline keyed on the item guid alone cannot tell two
 * items in two feeds apart, and item guids are only unique within a feed.
 */
const claim = (itemId, feedId) => itemClaim(itemId, guidOf(feedId));
const base = (pub = [], priv = []) => ({ public: pub, private: priv });

/** Just the entry identifiers, in order. */
const ids = (tags) => (tags ?? []).filter((t) => t[0] === 'i').map(entryId);

/** Position of an identifier in a tag array, or -1. */
const at = (tags, id) => (tags ?? []).findIndex((t) => t[0] === 'i' && entryId(t) === id);

/** The whole `i` tag for an identifier, or undefined. */
const tagFor = (tags, id) => (tags ?? []).find((t) => t[0] === 'i' && entryId(t) === id);

/** Is this feed favorited? Its entry being on the list is the whole answer. */
const feedFavorite = (tags, id) => parseTags(tags).favorited.get(id) ?? false;

/** Entry shape without the tag index, so two layouts can be compared. */
const shape = (parsed) =>
  parsed.entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    medium: e.medium,
    feed: e.feed,
  }));

// ---------------------------------------------------------------------------

test('1. A foreign entry survives your republish', () => {
  // A feed group this app cannot resolve: not held locally, not in the
  // baseline. The natural way to write a publisher — emit local state — loses
  // it, and this is the vector that catches that.
  const read = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    ['medium', 'music'],
    ['i', FEED_B],
    K_FEED,
    K_ITEM,
  ]);

  const { publish } = plan({
    read,
    local: [feed(FEED_A, 'podcast', [ITEM_A1]), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });

  assert.ok(publish, 'adding a local favorite must produce a publish');
  assert.ok(at(publish.tags, FEED_B) !== -1, 'the foreign feed was dropped');

  // ...and in the same position: still under its own `medium music` run, and
  // still ahead of anything this device appended.
  const mediumMusic = publish.tags.findIndex(
    (t) => t[0] === 'medium' && t[1] === 'music',
  );
  assert.ok(mediumMusic !== -1, 'the foreign group lost its medium run');
  assert.ok(
    mediumMusic < at(publish.tags, FEED_B),
    'the foreign feed moved out of its medium run',
  );
  assert.ok(
    at(publish.tags, FEED_A) < at(publish.tags, ITEM_A1) &&
      at(publish.tags, ITEM_A1) < at(publish.tags, FEED_B),
    'entries read keep their relative order',
  );

  // Ours is appended — to the END OF ITS MEDIUM RUN, which is where the
  // grouping rules put a podcast feed, and not necessarily to the end of the
  // event. Either a second `medium podcast` run after FEED_B or a place in the
  // first one is conforming; what is not is landing under `medium music`.
  const parsed = parseTags(publish.tags);
  assert.equal(
    parsed.entries.find((e) => e.id === FEED_C).medium,
    'podcast',
    'our new feed was filed under the wrong medium',
  );
  assert.equal(
    parsed.entries.find((e) => e.id === FEED_B).medium,
    'music',
    'the foreign feed was re-labelled',
  );
});

test('2. An empty list is distinguishable from a read that never happened', () => {
  const local = [feed(FEED_A, 'podcast', [ITEM_A1])];

  // The relay never answered. Rule 1: never publish on a read you don't
  // trust. Believing this is how a whole library gets republished as empty.
  const never = plan({ read: null, local, baseline: base(), mode: 'public' });
  assert.equal(never.publish, null, 'published on an untrustworthy read');
  assert.deepEqual(
    never.baselineIfLanded,
    base(),
    'a skipped publish must not move the baseline',
  );

  // The relay answered "I have nothing". That is a real, empty list.
  const empty = plan({ read: ev([]), local, baseline: base(), mode: 'public' });
  assert.ok(empty.publish, 'an empty list must still accept our first entry');
  assert.deepEqual(ids(empty.publish.tags), [FEED_A, ITEM_A1]);
});

test('3. Idempotence', () => {
  const local = [feed(FEED_A, 'podcast', [ITEM_A1])];

  const first = plan({ read: ev([]), local, baseline: base(), mode: 'public' });
  assert.ok(first.publish);

  // Read our own output back and run the whole cycle again.
  const second = plan({
    read: first.publish,
    local,
    baseline: first.baselineIfLanded,
    mode: 'public',
  });

  assert.equal(
    second.publish,
    null,
    'a writer that is not idempotent has two apps rewriting the event forever',
  );
});

test('4. An unrecognized tag or identifier kind survives', () => {
  const read = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    ['i', 'future:thing:abc'], // an identifier kind not in our table
    ['zz', 'a tag type with no meaning here'],
    K_FEED,
    ['k', 'future:thing'], // a `k` naming a kind we never emit
  ]);

  const { publish } = plan({
    read,
    local: [feed(FEED_A, 'podcast'), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A]),
    mode: 'public',
  });

  assert.ok(publish);
  const flat = JSON.stringify(publish.tags);
  assert.ok(flat.includes('future:thing:abc'), 'unknown identifier dropped');
  assert.ok(flat.includes('a tag type with no meaning here'), 'unknown tag dropped');
  assert.ok(flat.includes('"future:thing"'), 'unknown `k` dropped');

  // Rule 4 again, and it still bites on the LEGACY layout. A two-element item
  // tag takes its feed from the entry above it, so an unreadable identifier
  // between the two must not end that run — do that and the item is left with
  // no feed guid at all, which makes it unresolvable rather than mislabelled.
  const parsed = parseTags([
    ['medium', 'podcast'],
    ['i', FEED_A],
    ['i', 'future:thing:abc'],
    ['i', ITEM_A2], // legacy: no feed guid of its own
  ]);
  const entry = parsed.entries.find((e) => e.id === ITEM_A2);
  assert.equal(
    entry.feed,
    guidOf(FEED_A),
    'an unparseable entry ended the legacy run and stranded the item',
  );

  // AND RULE 4 REACHES INSIDE THE TAG. A feed identifier with something at
  // position 2 that this writer cannot read is NOT a feed favorite. Reading it
  // as one turns a newer writer's entry into a followed show — the same class
  // of silent conversion the migration exists to prevent, arriving from the
  // other direction. Carry it whole, and do not open a legacy run on it.
  const FUTURE = ['i', FEED_B, 'future:thing:abc'];
  const withFuture = parseTags([
    ['medium', 'podcast'],
    ['i', FEED_A],
    FUTURE,
    ['i', ITEM_A2], // legacy: takes its feed from FEED_A, not from FEED_B
  ]);
  assert.equal(
    withFuture.favorited.get(FEED_B) ?? false,
    false,
    'an entry with an unreadable position 2 was read as a feed favorite',
  );
  assert.ok(
    withFuture.foreign.some((f) => JSON.stringify(f.tag) === JSON.stringify(FUTURE)),
    'an entry with an unreadable position 2 was not carried',
  );
  assert.equal(
    withFuture.entries.find((e) => e.id === ITEM_A2).feed,
    guidOf(FEED_A),
    'an unreadable position 2 opened a legacy run and stole the item',
  );

  const carried = plan({
    read: ev([ALT, ['medium', 'podcast'], ['i', FEED_A], FUTURE, K_FEED]),
    local: [feed(FEED_C, 'podcast', [], true)],
    baseline: base(),
    mode: 'public',
  });
  assert.ok(
    JSON.stringify(carried.publish.tags).includes('future:thing:abc'),
    'an entry with an unreadable position 2 was dropped on republish',
  );

  // AND A RUN HOLDING ONE IS EMITTED AS READ. Band order sorts entries by
  // level, and a tag with no level has no band. Rather than invent a place for
  // it — which is how a carried tag gets moved somewhere that changes what it
  // means — the whole run keeps its wire order. It degrades to the old
  // behaviour, and a writer that cannot sort still preserves what a writer
  // that can wrote.
  const ARTIST_4 = 'podcast:publisher:guid:0e8f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
  const unsortable = plan({
    read: ev([
      ALT,
      ['medium', 'podcast'],
      item(ITEM_A1, FEED_A), // a track ahead of its album, which banding moves
      ['i', FEED_A],
      ['i', 'future:thing:abc'], // no band
      ['i', ARTIST_4],
      K_FEED,
      K_ITEM,
    ]),
    local: [feed(FEED_C, 'music', [], true)], // a change, in another run
    baseline: base(),
    mode: 'public',
  });
  assert.ok(unsortable.publish);
  assert.deepEqual(
    ids(unsortable.publish.tags).slice(0, 4),
    [ITEM_A1, FEED_A, 'future:thing:abc', ARTIST_4],
    'a run holding an unclassifiable tag was reordered anyway',
  );
});

test('5. Placement', () => {
  const parsed = parseTags([
    ['i', FEED_C], // before any medium tag
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    ['medium', 'music'],
    ['i', FEED_B],
    item(ITEM_B1, FEED_B),
  ]);

  const by = (id) => parsed.entries.find((e) => e.id === id);

  // An item names its own feed, so the answer is on the entry rather than in
  // the entry above it.
  assert.equal(by(ITEM_A1).feed, guidOf(FEED_A));
  assert.equal(by(ITEM_B1).feed, guidOf(FEED_B));

  // ...and that survives a shuffle, which is the whole point. Reordering used
  // to reattach every item to whatever feed happened to precede it.
  const shuffled = parseTags([
    item(ITEM_B1, FEED_B),
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    ['i', FEED_B],
  ]);
  const byShuffled = (id) => shuffled.entries.find((e) => e.id === id);
  assert.equal(byShuffled(ITEM_B1).feed, guidOf(FEED_B), 'a reorder moved an item');
  assert.equal(byShuffled(ITEM_A1).feed, guidOf(FEED_A), 'a reorder moved an item');

  // Medium is a running value, and it is now the ONLY positional thing left.
  assert.equal(by(FEED_A).medium, 'podcast');
  assert.equal(by(FEED_B).medium, 'music');

  // An entry with no `medium` above it is UNKNOWN, never defaulted to
  // 'podcast'. Defaulting turns an absence into a claim.
  assert.equal(by(FEED_C).medium, null, 'medium was defaulted, not left unknown');
});

test('6. A URL-shaped item guid does not corrupt its `k` tag', () => {
  const urlItem = 'podcast:item:guid:https://example.com/ep/42';

  assert.equal(
    kindOf(urlItem),
    'podcast:item:guid',
    'the kind came from splitting the string, not from the table',
  );
  assert.notEqual(kindOf(urlItem), 'podcast:item:guid:https');

  // And it reaches the wire that way: a `k` no relay filter matches breaks
  // `#k` discovery without breaking anything visible.
  const { publish } = plan({
    read: ev([]),
    local: [feed(FEED_A, 'podcast', [urlItem])],
    baseline: base(),
    mode: 'public',
  });
  const kinds = publish.tags.filter((t) => t[0] === 'k').map((t) => t[1]);
  assert.ok(kinds.includes('podcast:item:guid'));
  assert.ok(!kinds.some((k) => k.includes('https')), `bad k tag: ${kinds}`);

  // THE ITEM ENTRY DECLARES A KIND ITS IDENTIFIER DOES NOT SAY. That `k` came
  // off a tag whose position 1 reads `podcast:guid:`, because the item guid is
  // at position 2 now. A writer that derives the kind from the prefix alone
  // emits `podcast:guid` and nothing else, and `#k` discovery stops finding
  // item favorites on every list whose items are all written this way.
  assert.equal(
    tagFor(publish.tags, urlItem)[1],
    FEED_A,
    'the item entry does not name its feed at position 1',
  );

  // The legacy two-element form is the one place a URL-shaped guid still
  // reaches the kind table through position 1, so pin it there too.
  const fromLegacy = plan({
    read: ev([ALT, ['medium', 'podcast'], ['i', FEED_A], ['i', urlItem], K_FEED, K_ITEM]),
    local: [feed(FEED_C, 'podcast', [], true)],
    baseline: base(),
    mode: 'public',
  });
  const legacyKinds = fromLegacy.publish.tags.filter((t) => t[0] === 'k').map((t) => t[1]);
  assert.ok(legacyKinds.includes('podcast:item:guid'));
  assert.ok(
    !legacyKinds.some((k) => k.includes('https')),
    `bad k tag: ${legacyKinds}`,
  );
});

test('7. Both `k` layouts parse identically', () => {
  // The layout this document specifies: one `k` per distinct kind, at the end.
  const trailing = [
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    K_FEED,
    K_ITEM,
  ];

  // The layout an earlier revision wrote: a `k` beside every `i`.
  const paired = [
    ['medium', 'podcast'],
    ['i', FEED_A],
    K_FEED,
    item(ITEM_A1, FEED_A),
    K_ITEM,
  ];

  assert.deepEqual(
    shape(parseTags(paired)),
    shape(parseTags(trailing)),
    'a reader walking `i`/`k` in pairs shows an empty library, not an error',
  );

  // THE WRITER'S HALF OF THE SAME FACT. Both layouts are legal — a reader must
  // accept the paired one, a writer must emit the trailing one — so they
  // differ byte for byte while meaning the same list. Rule 5 therefore
  // compares the read PUT THROUGH YOUR OWN FRAMING, not the read as it
  // arrived. Compare it raw and reading a list the other app wrote reports a
  // change every single time, on a list nothing has changed about; if that app
  // compares raw too, neither of you ever stops. Vector 3 does not catch this,
  // because a writer reading its OWN output normalises by construction.
  const held = [feed(FEED_A, 'podcast', [ITEM_A1], true)];
  const claimed = base([FEED_A, claim(ITEM_A1, FEED_A)]);

  assert.equal(
    plan({ read: ev([ALT, ...paired]), local: held, baseline: claimed, mode: 'public' }).publish,
    null,
    'reading the other `k` layout republished a list nothing had changed',
  );
  assert.equal(
    plan({ read: ev([ALT, ...trailing]), local: held, baseline: claimed, mode: 'public' }).publish,
    null,
    'reading our own `k` layout republished a list nothing had changed',
  );
});

test('8. An entry you removed disappears; an entry you never published does not', () => {
  // ONE input — FEED_B is on the list and absent from local state — and two
  // baselines. Pinning only one direction lets an implementation that ignores
  // the baseline entirely pass.
  const read = ev([ALT, ['medium', 'podcast'], ['i', FEED_A], ['i', FEED_B], K_FEED]);
  const local = [feed(FEED_A, 'podcast')];

  const mine = plan({ read, local, baseline: base([FEED_A, FEED_B]), mode: 'public' });
  assert.ok(mine.publish, 'removing an entry must produce a publish');
  assert.ok(!ids(mine.publish.tags).includes(FEED_B), 'my own removal did not propagate');

  const theirs = plan({ read, local, baseline: base([FEED_A]), mode: 'public' });
  assert.equal(
    theirs.publish,
    null,
    'an entry we never published is not ours to remove — nothing should change',
  );
});

test('9. An entry another app removed is not resurrected', () => {
  // We hold it, our baseline claims it, and it is gone from the list. Another
  // app removed it. The obvious append-everything-local step re-adds it, and
  // because that step runs on every load the favorite returns forever, on
  // every device.
  const read = ev([ALT, ['medium', 'podcast'], ['i', FEED_A], K_FEED]);

  const { publish } = plan({
    read,
    local: [feed(FEED_A, 'podcast'), feed(FEED_B, 'podcast')],
    baseline: base([FEED_A, FEED_B]),
    mode: 'public',
  });

  assert.equal(publish, null, 'the removed entry was resurrected');
});

test('10. A baseline is never written for a publish that did not land', () => {
  const local = [feed(FEED_A, 'podcast', [ITEM_A1])];
  const start = base();

  const first = plan({ read: ev([]), local, baseline: start, mode: 'public' });
  assert.ok(first.publish);
  assert.notDeepEqual(
    first.baselineIfLanded,
    start,
    'the cycle should have something to record',
  );

  // Deciding a cycle must not record anything. An implementation that writes
  // the baseline as a side effect of planning has already recorded it before
  // anyone knows whether the event landed — which is the bug, in the one
  // place it is easiest to write by accident.
  assert.deepEqual(start, base(), 'planning recorded the baseline as a side effect');

  // The publish reached no relay. `baselineIfLanded` is the whole point of the
  // name: it is NOT recorded. Run the next cycle from the baseline we still
  // hold and the entries must be retried.
  const retry = plan({ read: ev([]), local, baseline: start, mode: 'public' });
  assert.ok(retry.publish, 'a lost publish became permanent');
  assert.deepEqual(ids(retry.publish.tags), [FEED_A, ITEM_A1]);
});

test('11. Removing a feed favorite never touches anybody\'s items', () => {
  // The rule this replaces: a feed group used to survive while any item under
  // it did, because the group was the only tag naming those items' feed.
  // Dropping it deleted another app's tracks. An item now carries its own feed
  // guid, so the two removals are independent and this cannot happen.
  const mineOnly = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    K_FEED,
    K_ITEM,
  ]);

  const gone = plan({
    read: mineOnly,
    local: [feed(FEED_C, 'podcast')],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  const out1 = ids(gone.publish.tags);
  assert.ok(!out1.includes(FEED_A), 'a feed favorite we took back should go');
  assert.ok(!out1.includes(ITEM_A1), 'an item favorite we took back should go');

  // ITEM_A2 belongs to another app. Our baseline claims the feed and ITEM_A1,
  // so both of ours go — and theirs stays, WITH ITS FEED GUID, even though no
  // feed entry for FEED_A is left on the list at all.
  const withForeign = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    item(ITEM_A2, FEED_A),
    K_FEED,
    K_ITEM,
  ]);

  const stays = plan({
    read: withForeign,
    local: [feed(FEED_C, 'podcast')],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });

  const out = ids(stays.publish.tags);
  assert.ok(out.includes(ITEM_A2), "another app's track was deleted");
  assert.ok(!out.includes(ITEM_A1), 'our own removal should still propagate');
  assert.ok(
    !out.includes(FEED_A),
    'the feed favorite was kept alive by an item that no longer needs it',
  );
  // The surviving item is still resolvable on its own. Under the old format
  // this is the assertion that could not be made: the feed guid lived in a tag
  // that was just deleted.
  assert.deepEqual(
    tagFor(stays.publish.tags, ITEM_A2),
    item(ITEM_A2, FEED_A),
    "the surviving item lost the feed guid it needs to be looked up",
  );
});

test('12. An opaque `content` survives a republish by a writer that cannot read it', () => {
  const OPAQUE = 'sealed-bytes-this-writer-has-no-meaning-for';
  assert.equal(decodePrivate(OPAQUE), null, 'the fixture must be unreadable to us');

  const read = ev([ALT, ['medium', 'podcast'], ['i', FEED_A], K_FEED], OPAQUE);

  const { publish } = plan({
    read,
    local: [feed(FEED_A, 'podcast'), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A]),
    mode: 'public',
  });

  assert.ok(publish, 'adding a favorite must publish');
  assert.equal(
    publish.content,
    OPAQUE,
    'content was blanked — this is the loss that happened in production on 2026-08-25',
  );

  // The inverse, in the same breath. Without it, a writer that simply never
  // touches the field passes on a technicality: it would return '' here too.
  const scratch = plan({
    read: ev([]),
    local: [feed(FEED_A, 'podcast')],
    baseline: base(),
    mode: 'public',
  });
  assert.equal(
    scratch.publish.content,
    '',
    'a list built from scratch is legitimately empty',
  );
});

test('13. Going private takes the whole list, and coming back does not', () => {
  // FEED_B is on the list, is not ours, and we cannot resolve it.
  const read = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    ['i', FEED_B],
    K_FEED,
  ]);
  const local = [feed(FEED_A, 'podcast')];

  // public -> private, as a CHOICE — the user pressed Private here. Every
  // entry moves, ours and theirs. It only ever reduces exposure and is
  // reversible by any app that can decrypt. Moving only what we wrote is what
  // left a real user 97% private.
  const hidden = plan({
    read,
    local,
    baseline: base([FEED_A]),
    mode: 'private',
    userChose: true,
  });
  assert.ok(hidden.publish);
  assert.deepEqual(ids(hidden.publish.tags), [], 'entries were left in the public half');

  const inPrivate = ids(decodePrivate(hidden.publish.content));
  assert.ok(inPrivate.includes(FEED_A), 'our own entry did not move');
  assert.ok(
    inPrivate.includes(FEED_B),
    "another app's entry stayed public — the user is now partly private with nothing saying which",
  );

  // private -> public is a DISCLOSURE. It publishes an `i` tag relays index
  // and it cannot be taken back. The list now SAYS private, and a writer whose
  // standing setting says public is in the conflict the visibility section
  // describes: a standing preference does not restate a stated mode, so it
  // follows the list or asks — both existing apps ask. A writer that does
  // publish here may return only what its own baseline claims. Both answers
  // are conforming; moving FEED_B is not.
  const shown = plan({
    read: hidden.publish,
    // What the device holds now — unchanged for a writer that carries, the
    // whole private half for one that paints the active half into its store.
    local: hidden.holds ?? local,
    baseline: hidden.baselineIfLanded,
    mode: 'public',
  });

  const after = shown.publish ?? hidden.publish;
  const backOut = ids(after.tags);
  assert.ok(
    !backOut.includes(FEED_B),
    "another app's private entry was published as a relay-indexed `i` tag",
  );
  assert.ok(
    ids(decodePrivate(after.content)).includes(FEED_B),
    'their entry should stay where it is, not be dropped',
  );
  assert.ok(
    ids(decodePrivate(after.content)).includes(FEED_A),
    'our own entry must not be lost either — it is private, or it is public, never gone',
  );
});

test('14. A writer does not delete the half it does not write into (TWO cycles)', () => {
  // The half we do NOT publish into holds entries that are not ours.
  const foreignPrivate = encodePrivate([
    ['medium', 'podcast'],
    ['i', FEED_B],
  ]);
  const read = ev(
    [ALT, ['medium', 'podcast'], ['i', FEED_A], K_FEED],
    foreignPrivate,
  );
  const local = [feed(FEED_A, 'podcast')];

  // Cycle 1. Every single-cycle vector above passes over this: the bytes
  // emitted here are correct, and only the baseline recorded beside them is
  // wrong.
  const one = plan({ read, local, baseline: base([FEED_A]), mode: 'public' });
  const afterOne = one.publish ?? read;
  assert.ok(
    ids(decodePrivate(afterOne.content)).includes(FEED_B),
    'cycle 1 already lost the private half',
  );

  // Cycle 2, fed the baseline cycle 1 recorded. If that baseline claimed the
  // half we never write into, rule 3's "in your baseline, absent locally" row
  // now fires on the whole half at once.
  const two = plan({
    read: afterOne,
    local: one.holds ?? local,
    baseline: one.baselineIfLanded,
    mode: 'public',
  });
  const afterTwo = two.publish ?? afterOne;

  assert.ok(
    ids(decodePrivate(afterTwo.content)).includes(FEED_B),
    "cycle 2 deleted the other writer's half — the claims were recomputed, not carried",
  );

  // The control, in the same fixture. A writer that never claims anything
  // also survives the assertion above, and it is broken in the other
  // direction: a later move between halves copies instead of moving, and the
  // entries the user asked to hide stay in plaintext beside the encrypted copy.
  assert.ok(
    one.baselineIfLanded.public.includes(FEED_A),
    'a list adopted off the relay must still enter the baseline for the half we DO write into',
  );
});

test('15. A list found with entries in BOTH halves is carried, then converged once', () => {
  // The state: FEED_A is in both halves, FEED_C only in the private one, and
  // this device's private baseline claims nothing — which is how a real
  // account reached 284 entries in both halves at once.
  const read = ev(
    [ALT, ['medium', 'podcast'], ['i', FEED_A], ['i', FEED_B], K_FEED],
    encodePrivate([['medium', 'podcast'], ['i', FEED_A], ['i', FEED_C]]),
  );
  const local = [feed(FEED_A, 'podcast')];

  // A cycle may not converge the list on its own initiative. Emptying either
  // half deletes entries this writer never wrote, and an entry appearing
  // twice is not evidence that either copy is ours.
  const carried = plan({ read, local, baseline: base([FEED_A]), mode: 'public' });
  const after = carried.publish ?? read;
  assert.deepEqual(
    ids(after.tags),
    [FEED_A, FEED_B],
    'the public half was rewritten by a cycle that was only asked to carry it',
  );
  assert.deepEqual(
    ids(decodePrivate(after.content)),
    [FEED_A, FEED_C],
    'the private half was tidied away — an overlap is not permission to delete it',
  );

  // Converging, once the baseline claims the half. This device put FEED_A and
  // FEED_C in the private half and still holds both — a claim without the
  // entry behind it is a removal, rule 3 — so both come to the tags, and
  // FEED_A must appear ONCE: it was already there, and the claimed-back copy
  // is the same entry, not a second one. Concatenating the two opens a second
  // group for one feed and double-counts it for every reader. Only reachable
  // from this state, which is why no vector above catches it.
  const converged = plan({
    read,
    local: [feed(FEED_A, 'podcast'), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A], [FEED_A, FEED_C]),
    mode: 'public',
  });
  assert.ok(converged.publish, 'converging should publish');
  const out = ids(converged.publish.tags);
  assert.deepEqual(
    out.filter((id) => id === FEED_A).length,
    1,
    'the entry that was in both halves was emitted twice',
  );
  assert.ok(
    out.includes(FEED_C),
    'a claimed private-only entry was deleted rather than moved',
  );
  assert.deepEqual(
    ids(decodePrivate(converged.publish.content)),
    [],
    'the private half should be empty once its claimed entries have moved',
  );
});

test('16. The stated mode outranks whatever the halves happen to hold', () => {
  // FIXTURE 1 — the empty list, which nothing else in this file can reach.
  // Both halves are empty, so "whichever half holds entries is the mode" has
  // no answer, and every implementation before the tag had to guess. Guessing
  // `public` publishes this favorite as a relay-indexed `i` tag on the account
  // of someone who chose Private in another app.
  const emptyPrivate = ev([ALT, VIS_PRIVATE], '');
  const seeded = plan({
    read: emptyPrivate,
    local: [feed(FEED_A, 'podcast')],
    baseline: base(),
    mode: null, // no stored preference: follow the list
  });
  assert.ok(seeded.publish, 'a first favorite must still produce a publish');
  assert.deepEqual(
    ids(seeded.publish.tags),
    [],
    'the favorite was disclosed as a plaintext tag on a list that said private',
  );
  assert.deepEqual(ids(decodePrivate(seeded.publish.content)), [FEED_A]);

  // And with no tag, the same emptiness is a QUESTION. Publishing on a guess
  // is the disclosure; the writer must ask.
  const untagged = plan({
    read: ev([ALT], ''),
    local: [feed(FEED_A, 'podcast')],
    baseline: base(),
    mode: null,
  });
  assert.equal(
    untagged.publish,
    null,
    'an empty untagged list has no mode to infer — asking is the only safe answer',
  );

  // FIXTURE 2 — the tag says public and the private half still holds entries.
  // Only a writer that could read both halves may have written that tag, so it
  // is the user's stated intent for the whole list: finish the move.
  const halfConverged = ev(
    [ALT, VIS_PUBLIC, ['medium', 'podcast'], ['i', FEED_A], K_FEED],
    encodePrivate([['medium', 'podcast'], ['i', FEED_B]]),
  );
  const converged = plan({
    read: halfConverged,
    local: [feed(FEED_A, 'podcast')],
    baseline: base([FEED_A]),
    mode: 'public',
  });
  assert.ok(converged.publish, 'a half-converged list must be finished');
  assert.deepEqual(ids(converged.publish.tags), [FEED_A, FEED_B]);
  assert.deepEqual(
    ids(decodePrivate(converged.publish.content)),
    [],
    'the half the tag does not name must end up empty',
  );

  // The control, and it is the half that fails a naive implementation: the
  // SAME entries with no tag must NOT move. There is no stated intent, so
  // vector 13's conservative rule stands and moving FEED_B would be a
  // disclosure nobody asked for.
  const noTag = plan({
    read: ev(
      [ALT, ['medium', 'podcast'], ['i', FEED_A], K_FEED],
      encodePrivate([['medium', 'podcast'], ['i', FEED_B]]),
    ),
    local: [feed(FEED_A, 'podcast')],
    baseline: base([FEED_A]),
    mode: 'public',
  });
  // A writer may republish here — its canonical rendering of the private half
  // can differ from the bytes another app wrote — but it may not MOVE anything.
  const stillPrivate = noTag.publish ?? noTag.read ?? null;
  const settled = noTag.publish ?? {
    tags: [ALT, ['medium', 'podcast'], ['i', FEED_A], K_FEED],
    content: encodePrivate([['medium', 'podcast'], ['i', FEED_B]]),
  };
  assert.ok(
    !ids(settled.tags).includes(FEED_B),
    "without a stated mode there is nothing to say, and another app's private entry was disclosed",
  );
  assert.ok(
    ids(decodePrivate(settled.content)).includes(FEED_B),
    "without a stated mode another app's private entry stays private",
  );
  void stillPrivate;
});

test('17. A writer that cannot read a half may not restate the mode', () => {
  // `content` this writer's codec cannot decode — another app's NIP-44, or a
  // signer with no `nip44` at all. The user has just chosen Public here.
  const opaque = ev([ALT, VIS_PRIVATE, K_FEED], 'not-something-we-can-decode');

  const { publish } = plan({
    read: opaque,
    local: [feed(FEED_A, 'podcast')],
    baseline: base(),
    mode: 'public',
    userChose: true,
  });

  // Nothing may be said at all. Everything this writer would publish belongs
  // in a half it cannot open, and the one thing it could technically emit —
  // `visibility: public` — would be a false statement about someone's privacy
  // that the next writer converges on the strength of.
  assert.equal(
    publish,
    null,
    'a writer that cannot open the half the list lives in has nothing it may say',
  );

  // The same shape one step along, and the reason `null` above is not enough
  // on its own: a writer that DOES publish here must carry the bytes whole.
  // The reference emitted an encoded empty array instead — rule 4's `content`
  // clause broken by the one branch written to honour it, in a state no
  // earlier vector reaches.
  const carrying = plan({
    read: opaque,
    local: [],
    baseline: base(),
    mode: 'private',
    userChose: true,
  });
  if (carrying.publish) {
    assert.equal(
      carrying.publish.content,
      opaque.content,
      'rule 4: bytes we cannot read are republished byte for byte',
    );
  }

  // The control, in the same fixture: content this writer CAN read. Now the
  // change is honest, so it must go through — an implementation that never
  // restates the mode passes the assertions above for the wrong reason.
  const readable = ev(
    [ALT, VIS_PRIVATE, K_FEED],
    encodePrivate([['medium', 'podcast'], ['i', FEED_B]]),
  );
  const allowed = plan({
    read: readable,
    local: [feed(FEED_A, 'podcast')],
    baseline: base(),
    mode: 'public',
    userChose: true,
  });
  assert.ok(allowed.publish, 'an honest mode change must publish');
  assert.ok(
    allowed.publish.tags.some((t) => t[0] === 'visibility' && t[1] === 'public'),
    'the user chose Public in an app that could see both halves',
  );
  assert.ok(
    ids(allowed.publish.tags).includes(FEED_B),
    'the whole list moves — a stated mode is what lifts the asymmetry',
  );
  assert.deepEqual(ids(decodePrivate(allowed.publish.content)), []);

  // And the boundary: an EMPTY `content` is readable by anybody, because there
  // is no half to be blind to. A signer with no NIP-44 must still be able to
  // set the mode on a fresh list — treating empty as opaque freezes every new
  // account on such a signer at whatever the first writer guessed.
  const fresh = plan({
    read: ev([ALT], ''),
    local: [feed(FEED_A, 'podcast')],
    baseline: base(),
    mode: 'public',
    canReadPrivate: false,
    userChose: true,
  });
  assert.ok(fresh.publish, 'a fresh list must still accept a first favorite');
  assert.ok(
    fresh.publish.tags.some((t) => t[0] === 'visibility' && t[1] === 'public'),
    'nothing was hidden from this writer, so it may say what the list is',
  );
});

test('18. A run is emitted in band order, and a new entry joins its own band', () => {
  // The writer holds one feed's items in a DIFFERENT order from the wire, plus
  // one new item for it. Two ways to get this wrong, and each is well-formed:
  //
  //   local order first   — the other app reads it back, imposes ITS order,
  //                         and the two rewrite the event at each other forever
  //   append to the event — the new item opens a second `medium podcast` run
  //
  // A third way used to exist and is now impossible: appending to the end of
  // the event once re-parented the new item to whatever feed was last opened.
  // The item names its own feed, so misplacing it costs contiguity, not data.
  // That is also what lets the run be SORTED at all rather than merely
  // preserved.
  const read = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    item(ITEM_A2, FEED_A),
    ['medium', 'music'],
    ['i', FEED_B],
    item(ITEM_B1, FEED_B),
    K_FEED,
    K_ITEM,
  ]);
  const ITEM_A3 = 'podcast:item:guid:aaaaaaaa-1111-0000-0000-000000000003';

  const { publish } = plan({
    read,
    local: [
      feed(FEED_A, 'podcast', [ITEM_A3, ITEM_A2, ITEM_A1]), // held in another order
      feed(FEED_B, 'music', [ITEM_B1]),
    ],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A), claim(ITEM_A2, FEED_A), FEED_B, claim(ITEM_B1, FEED_B)]),
    mode: 'public',
  });

  assert.ok(publish, 'a new item must produce a publish');
  assert.deepEqual(
    ids(publish.tags),
    [FEED_A, ITEM_A1, ITEM_A2, ITEM_A3, FEED_B, ITEM_B1],
    'read order kept, the new item at the end of its own medium run',
  );
  const parsed = parseTags(publish.tags);
  const a3 = parsed.entries.find((e) => e.id === ITEM_A3);
  assert.equal(a3.feed, guidOf(FEED_A), 'the new item lost its feed guid');
  assert.equal(a3.medium, 'podcast', 'the new item opened a second medium run');
  assert.equal(
    publish.tags.filter((t) => t[0] === 'medium' && t[1] === 'podcast').length,
    1,
    'the podcast run was split in two',
  );

  // BAND ORDER, on a run that arrives interleaved and holds one of each level.
  // Artists, then albums, then tracks grouped by the album they name. Inside a
  // band the read order stands and a new entry lands at the end of THAT band —
  // not at the end of the run, which is the answer that looks right until a
  // list has more than one level in it.
  const ARTIST = 'podcast:publisher:guid:0e8f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
  const ARTIST2 = 'podcast:publisher:guid:1f9e7b2c-3d4e-5f60-8a9b-0c1d2e3f4a5c';
  const ITEM_B2 = 'podcast:item:guid:bbbbbbbb-1111-0000-0000-000000000002';

  const interleaved = ev([
    ALT,
    ['medium', 'music'],
    item(ITEM_A1, FEED_A), // a track, above the album it names
    ['i', FEED_A],
    ['i', ARTIST],
    item(ITEM_B1, FEED_B),
    ['i', FEED_B],
    item(ITEM_A2, FEED_A), // the same album's second track, far from the first
    K_FEED,
    K_ITEM,
    ['k', 'podcast:publisher:guid'],
  ]);

  const banded = plan({
    read: interleaved,
    local: [
      feed(FEED_A, 'music', [ITEM_A1, ITEM_A2]),
      feed(FEED_B, 'music', [ITEM_B1, ITEM_B2]), // ITEM_B2 is new
      feed(FEED_C, 'music', [], true), // a new album
      feed(ARTIST, 'music', [], true),
      feed(ARTIST2, 'music', [], true), // a new artist
    ],
    baseline: base([
      FEED_A, claim(ITEM_A1, FEED_A), claim(ITEM_A2, FEED_A),
      FEED_B, claim(ITEM_B1, FEED_B), ARTIST,
    ]),
    mode: 'public',
  });

  assert.ok(banded.publish, 'three new favorites must produce a publish');
  assert.deepEqual(
    ids(banded.publish.tags),
    [
      ARTIST, ARTIST2,           // band 1: read order, the new one last
      FEED_A, FEED_B, FEED_C,    // band 2: read order, the new one last
      ITEM_A1, ITEM_A2,          // band 3: grouped by album, first appearance
      ITEM_B1, ITEM_B2,          //          and the new track joins its album
    ],
    'the run was not emitted as artists, then albums, then tracks by album',
  );
  assert.equal(
    banded.publish.tags.filter((t) => t[0] === 'medium').length,
    1,
    'banding split the medium run',
  );

  // And it is idempotent: reading the banded output back changes nothing.
  const again = plan({
    read: banded.publish,
    local: [
      feed(FEED_A, 'music', [ITEM_A1, ITEM_A2]),
      feed(FEED_B, 'music', [ITEM_B1, ITEM_B2]),
      feed(FEED_C, 'music', [], true),
      feed(ARTIST, 'music', [], true),
      feed(ARTIST2, 'music', [], true),
    ],
    baseline: banded.baselineIfLanded,
    mode: 'public',
  });
  assert.equal(again.publish, null, 'banding is not idempotent, so it never stops');
});

test('19. The same feed twice on the wire loses no item', () => {
  // A duplicate feed entry is well-formed: two writers each stated the same
  // favorite. Under the old grouping it was dangerous — each copy opened a
  // group, and a writer that modelled groups by feed guid met the second one
  // already "taken" and dropped the items under it. Items name their own feed
  // now, so folding the duplicate cannot move anything.
  const read = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    ['i', FEED_A],
    item(ITEM_A2, FEED_A),
    K_FEED,
    K_ITEM,
  ]);

  const feedsOf = (tags) =>
    parseTags(tags)
      .entries.filter((e) => e.feed !== null)
      .map((e) => [e.id, e.feed]);

  // Carry it: nothing local, nothing claimed. Publishing nothing is fine;
  // publishing something must still hold both items against FEED_A.
  const carried = plan({ read, local: [], baseline: base(), mode: 'public' });
  const after = carried.publish ?? read;
  assert.deepEqual(
    feedsOf(after.tags).sort(),
    [
      [ITEM_A1, guidOf(FEED_A)],
      [ITEM_A2, guidOf(FEED_A)],
    ].sort(),
    'an item lost or moved when the duplicate feed entry was folded',
  );
  assert.ok(ids(after.tags).includes(FEED_A), 'the feed favorite itself was dropped');

  // Then a real change. Folding the duplicate is allowed; losing an item is
  // not, and neither is losing the favorite the duplicate stated.
  const ITEM_A3 = 'podcast:item:guid:aaaaaaaa-1111-0000-0000-000000000003';
  const { publish } = plan({
    read,
    local: [feed(FEED_A, 'podcast', [ITEM_A1, ITEM_A3])],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  assert.ok(publish, 'adding an item must publish');
  assert.deepEqual(
    feedsOf(publish.tags).sort(),
    [
      [ITEM_A1, guidOf(FEED_A)],
      [ITEM_A2, guidOf(FEED_A)],
      [ITEM_A3, guidOf(FEED_A)],
    ].sort(),
    "the duplicate's item did not survive the writer's own change",
  );
});

test('20. An item that names no feed is carried, in place, and never deleted', () => {
  // Every item published before this revision looks like this, and so does one
  // written by a writer that dropped position 2. Its feed guid is not
  // recoverable — no entry above it names one — so this writer cannot resolve
  // it, cannot render it, and must still not touch it. Deleting an entry is a
  // thing the user asked for.
  const ORPHAN = 'podcast:item:guid:00000000-9999-0000-0000-000000000001';
  const tags = [
    ALT,
    ['i', ORPHAN],
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    K_FEED,
    K_ITEM,
  ];

  const parsed = parseTags(tags);
  const by = (id) => parsed.entries.find((e) => e.id === id);
  assert.ok(by(ORPHAN), 'an item naming no feed is an entry, not junk');
  assert.equal(by(ORPHAN).feed, null, 'a feed guid was invented for it');
  assert.equal(
    by(ITEM_A1).feed,
    guidOf(FEED_A),
    'the unresolvable item disturbed the entry after it',
  );

  const { publish } = plan({
    read: ev(tags),
    local: [feed(FEED_A, 'podcast', [ITEM_A1]), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  assert.ok(publish);
  assert.ok(ids(publish.tags).includes(ORPHAN), 'the orphan was dropped');
  assert.deepEqual(
    tagFor(publish.tags, ORPHAN),
    ['i', ORPHAN],
    'a feed guid was invented for an item whose feed nobody knows',
  );

  // AND RE-PARSING THE OUTPUT STILL GIVES IT NO FEED. This is the assertion
  // that band order makes necessary: the tag itself is unchanged either way,
  // so a writer that sorted the orphan in beside the other tracks passes every
  // check above while having handed it whatever album now sits last. A wrong
  // feed guid resolves to the wrong thing, which is worse than the nothing it
  // had. So an item naming no feed is emitted ahead of every feed entry in its
  // run.
  assert.equal(
    parseTags(publish.tags).entries.find((e) => e.id === ORPHAN).feed,
    null,
    'the orphan was moved behind a feed entry and inherited its guid',
  );
  assert.ok(
    at(publish.tags, ORPHAN) < at(publish.tags, FEED_A),
    'the orphan was not emitted ahead of the feed entries in its run',
  );

  // The orphan above sits before any `medium` tag, in a run that holds no feed
  // entry at all — so nothing there could have been mistaken for its parent.
  // The dangerous case is an orphan INSIDE a run that also holds albums, which
  // is where band order would sweep it in behind them and hand it whichever
  // one landed last. It is only an orphan because no feed entry precedes it,
  // so the emitted run has to keep it that way.
  const INSIDE = 'podcast:item:guid:00000000-9999-0000-0000-000000000002';
  const together = [
    ALT,
    ['medium', 'podcast'],
    ['i', INSIDE], // first in the run, so it names no feed
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    ['i', FEED_B],
    K_FEED,
    K_ITEM,
  ];
  assert.equal(
    parseTags(together).entries.find((e) => e.id === INSIDE).feed,
    null,
    'the fixture is wrong: this item is not an orphan',
  );

  const moved = plan({
    read: ev(together),
    local: [feed(FEED_A, 'podcast', [ITEM_A1]), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  assert.ok(moved.publish);
  assert.deepEqual(tagFor(moved.publish.tags, INSIDE), ['i', INSIDE]);
  assert.equal(
    parseTags(moved.publish.tags).entries.find((e) => e.id === INSIDE).feed,
    null,
    'band order swept the orphan behind an album and gave it that guid',
  );
  assert.ok(
    at(moved.publish.tags, INSIDE) < at(moved.publish.tags, FEED_A) &&
      at(moved.publish.tags, INSIDE) < at(moved.publish.tags, FEED_B),
    'the orphan was not emitted ahead of every feed entry in its run',
  );
});

test('21. Exactly one `alt`, ours, first', () => {
  // A NIP-31 rendering hint, not user data. A writer regenerates it rather
  // than carrying a foreign value, because the event can hold only one and a
  // reader that has no definition for kind 10333 shows whatever is there.
  const read = ev([
    ['alt', 'Somebody else\'s label'],
    ['medium', 'podcast'],
    ['i', FEED_A],
    K_FEED,
  ]);
  const { publish } = plan({
    read,
    local: [feed(FEED_A, 'podcast'), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A]),
    mode: 'public',
  });
  assert.ok(publish);
  assert.deepEqual(publish.tags[0], ALT, 'alt is the first tag and carries the canonical label');
  assert.equal(
    publish.tags.filter((t) => t[0] === 'alt').length,
    1,
    'a foreign alt was carried beside ours',
  );
});

test('22. The private plaintext carries no `?`', () => {
  // A NIP-55 signer URL-decodes the whole `nostrsigner:` URI and only then
  // splits it on `?`. Item guids are routinely permalink URLs, so one favorited
  // track with a query string would otherwise break every private publish on
  // Android, forever, with an error that reads as "signer not installed". The
  // escape is JSON's own, so every reader already understands it.
  const QUERY_ITEM = 'podcast:item:guid:https://example.com/ep?id=42&x=y';
  const tags = [['medium', 'podcast'], ['i', FEED_A], ['i', QUERY_ITEM]];

  const text = encodePlaintext(tags);
  assert.ok(!text.includes('?'), `the plaintext still carries a "?": ${text}`);
  assert.deepEqual(JSON.parse(text), tags, 'the escape must be one JSON itself understands');
  assert.deepEqual(decodePlaintext(text), tags, 'and round-trip through the reader');

  // And through a whole cycle: what comes back out of `content` is the guid.
  const { publish } = plan({
    read: ev([]),
    local: [feed(FEED_A, 'podcast', [QUERY_ITEM])],
    baseline: base(),
    mode: 'private',
  });
  assert.ok(publish);
  assert.ok(ids(decodePrivate(publish.content)).includes(QUERY_ITEM));
});

test('23. A plaintext that is not a tag array is an unreadable half, not an empty one', () => {
  // `JSON.parse` succeeding is not the same as having read a list. Valid JSON
  // that is not an array of string arrays marks the half "readable and empty"
  // in the obvious implementation, and the next republish rewrites `content`
  // from that emptiness — another app's data gone, from a decrypt that worked.
  assert.equal(decodePlaintext('{"tags":[]}'), null);
  assert.equal(decodePlaintext('"a string"'), null);
  assert.equal(decodePlaintext('[["i","x"],"not a tag"]'), null);
  assert.equal(decodePlaintext('[["i","x"],["i",1]]'), null, 'a non-string element');
  assert.deepEqual(decodePlaintext('[]'), [], 'an empty array IS an empty list');

  // The same rule one level up: bytes this writer can open but not read as a
  // list are carried exactly as an opaque `content` is (vector 12), and a
  // writer may not publish INTO them.
  const notAList = seal('{"not":"a list"}');
  assert.equal(decodePrivate(notAList), null, 'the fixture must be unreadable-as-a-list');
  const read = ev([ALT, ['medium', 'podcast'], ['i', FEED_A], K_FEED], notAList);

  const carrying = plan({
    read,
    local: [feed(FEED_A, 'podcast'), feed(FEED_C, 'podcast')],
    baseline: base([FEED_A]),
    mode: 'public',
  });
  assert.ok(carrying.publish, 'a public-half change still publishes');
  assert.equal(carrying.publish.content, notAList, 'the bytes were rewritten');

  const into = plan({
    read,
    local: [feed(FEED_A, 'podcast')],
    baseline: base([FEED_A]),
    mode: 'private',
  });
  assert.equal(into.publish, null, 'published into a half this writer could not read');
});

test('24. A private half past the NIP-44 v2 cliff is refused, not published', () => {
  // NIP-44 v2 as first published capped plaintext at 65535 bytes, and a signer
  // built to that text rejects a payload across the line — so the list reads
  // back as EMPTY on that device, not as an error. The writer refuses at
  // 60,000 bytes of plaintext, which leaves room for what NIP-44 adds on the
  // way to `content`. Refusing costs one favorite; publishing costs the whole
  // list on the device that hits the cliff.
  const wide = (n) =>
    Array.from({ length: n }, (_, i) =>
      `podcast:item:guid:https://example.com/a-fairly-long-permalink-path/episode-${String(i).padStart(4, '0')}-of-many`,
    );

  // Grow the fixture from the writer's own plaintext, so the vector tracks the
  // cap rather than a guess about bytes per entry.
  let items = wide(200);
  while (encodePlaintext([['i', FEED_A], ...items.map((id) => ['i', id])]).length <= 60_000) {
    items = wide(items.length + 100);
  }
  const over = plan({
    read: ev([]),
    local: [feed(FEED_A, 'podcast', items)],
    baseline: base(),
    mode: 'private',
  });
  assert.equal(over.publish, null, 'a private half past the cliff was published');
  assert.deepEqual(over.baselineIfLanded, base(), 'a refused publish claims nothing');

  // The control: the same shape well under the line publishes.
  const under = plan({
    read: ev([]),
    local: [feed(FEED_A, 'podcast', wide(50))],
    baseline: base(),
    mode: 'private',
  });
  assert.ok(under.publish, 'a private half under the cliff must still publish');
});

test('25. A feed favorite and an item favorite are stated separately', () => {
  // Save one item from a feed you have not favorited. ONE tag: the item, with
  // the guid of its feed beside it. No feed entry at all.
  //
  // This is the case the old format could not write. It had to open a feed
  // entry to hold the item, so a feed the user never chose appeared on the
  // list — 114 of one real list's 196 — and a marker existed to say which of
  // them were real.
  const itemOnly = plan({
    read: ev([ALT, VIS_PUBLIC, K_FEED, K_ITEM]),
    local: [feed(FEED_A, 'podcast', [ITEM_A1], false)],
    baseline: base(),
    mode: 'public',
  });
  assert.ok(itemOnly.publish, 'saving an item must publish');
  assert.deepEqual(
    ids(itemOnly.publish.tags),
    [ITEM_A1],
    'a feed the user never favorited was written to the list',
  );
  assert.deepEqual(
    tagFor(itemOnly.publish.tags, ITEM_A1),
    item(ITEM_A1, FEED_A),
    'the item must carry the feed guid it cannot be looked up without',
  );
  assert.equal(feedFavorite(itemOnly.publish.tags, FEED_A), false);

  // The baseline claims the PAIR. An item guid alone cannot tell this favorite
  // from the same item guid in another feed.
  assert.deepEqual(itemOnly.baselineIfLanded.public, [claim(ITEM_A1, FEED_A)]);

  // Now favorite the feed as well. A second choice, so a second tag — and the
  // item is untouched.
  const both = plan({
    read: itemOnly.publish,
    local: [feed(FEED_A, 'podcast', [ITEM_A1], true)],
    baseline: itemOnly.baselineIfLanded,
    mode: 'public',
  });
  assert.ok(both.publish, 'favoriting the feed is a change and must publish');
  assert.equal(feedFavorite(both.publish.tags, FEED_A), true);
  assert.deepEqual(
    tagFor(both.publish.tags, ITEM_A1),
    item(ITEM_A1, FEED_A),
    'the item changed when the feed favorite was added beside it',
  );
  assert.deepEqual(
    ids(both.publish.tags).sort(),
    [FEED_A, ITEM_A1].sort(),
    'two favorites, two tags',
  );

  // AND THE TWO TAGS SHARE POSITION 1. That is what `<podcast:remoteItem>`
  // does — `feedGuid` alone points at the feed, `feedGuid` plus `itemGuid`
  // points at one item in it — so the element count is the whole difference
  // between them on the wire. A reader that tells entries apart by position 1,
  // or a dedupe keyed on it, folds the feed favorite together with every item
  // favorite under that feed and one of them disappears.
  assert.equal(
    tagFor(both.publish.tags, FEED_A)[1],
    tagFor(both.publish.tags, ITEM_A1)[1],
    'a feed favorite and an item favorite of that feed differ at position 1',
  );
  assert.equal(tagFor(both.publish.tags, FEED_A).length, 2);
  assert.equal(tagFor(both.publish.tags, ITEM_A1).length, 3);
  assert.equal(
    both.publish.tags.filter((t) => t[0] === 'i').length,
    2,
    'the feed favorite and its item favorite collapsed into one tag',
  );

  // Favoriting the feed alone is the mirror case: one tag, and no item.
  const feedOnly = plan({
    read: ev([ALT, VIS_PUBLIC, K_FEED]),
    local: [feed(FEED_B, 'podcast', [], true)],
    baseline: base(),
    mode: 'public',
  });
  assert.deepEqual(ids(feedOnly.publish.tags), [FEED_B]);
  assert.deepEqual(tagFor(feedOnly.publish.tags, FEED_B), ['i', FEED_B]);

  // An entry in BOTH halves is one entry, and a whole-list move must emit it
  // once. Vector 15 pins the public copy; this pins that the pair is what the
  // dedupe compares, so the feed favorite and the item favorite do not
  // collapse into each other.
  const folded = plan({
    read: ev(
      [ALT, VIS_PUBLIC, ['medium', 'podcast'], ['i', FEED_A], K_FEED, K_ITEM],
      encodePrivate([['medium', 'podcast'], item(ITEM_A1, FEED_A), ['i', FEED_A]]),
    ),
    local: [feed(FEED_A, 'podcast', [ITEM_A1], true)],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  assert.ok(folded.publish, 'a half-converged list must be finished');
  assert.equal(
    ids(folded.publish.tags).filter((id) => id === FEED_A).length,
    1,
    'the feed favorite that was in both halves was emitted twice',
  );
  assert.equal(
    ids(folded.publish.tags).filter((id) => id === ITEM_A1).length,
    1,
    'the item that was in both halves was emitted twice',
  );

  // IDENTITY IS THE PAIR. An item guid is unique inside its feed and is not
  // globally unique, so the same item guid under two feed guids is two
  // different items. A writer that keys entries on the identifier alone folds
  // them into one and deletes a favorite nobody can restate.
  const shared = ev([
    ALT,
    VIS_PUBLIC,
    ['medium', 'podcast'],
    item(ITEM_A1, FEED_A),
    item(ITEM_A1, FEED_B),
    K_ITEM,
  ]);
  const kept = plan({
    read: shared,
    local: [feed(FEED_C, 'podcast', [], true)],
    baseline: base(),
    mode: 'public',
  });
  assert.ok(kept.publish);
  assert.equal(
    ids(kept.publish.tags).filter((id) => id === ITEM_A1).length,
    2,
    'two items sharing an item guid were folded into one',
  );

  // And a baseline claim on one is not a claim on the other. Claiming the
  // FEED_A copy and no longer holding it removes exactly that one.
  const oneGone = plan({
    read: shared,
    local: [],
    baseline: base([claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  assert.ok(oneGone.publish);
  assert.deepEqual(
    oneGone.publish.tags.filter((t) => t[0] === 'i'),
    [item(ITEM_A1, FEED_B)],
    'a claim on one copy removed the other, or removed neither',
  );
});

test('26. Unfavoriting the feed keeps the item, and needs nothing to say so', () => {
  // The user drops the feed and keeps one item of it. Under the old format the
  // feed entry could not go — it was the only tag naming the item's feed — so
  // the removal had to be STATED with a `placement` marker, and a writer that
  // expressed it by leaving the marker off said "nobody knows" instead.
  //
  // The item names its own feed now. The removal is an ordinary removal.
  const read = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    item(ITEM_A1, FEED_A),
    K_FEED,
    K_ITEM,
  ]);

  const dropped = plan({
    read,
    local: [feed(FEED_A, 'podcast', [ITEM_A1], false)],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  assert.ok(dropped.publish, 'unfavoriting the feed must publish');
  assert.deepEqual(
    ids(dropped.publish.tags),
    [ITEM_A1],
    'the feed favorite survived, or the item went with it',
  );
  assert.deepEqual(
    tagFor(dropped.publish.tags, ITEM_A1),
    item(ITEM_A1, FEED_A),
    'the item lost the feed guid when its feed entry was removed',
  );
  assert.equal(feedFavorite(dropped.publish.tags, FEED_A), false);
  assert.deepEqual(
    dropped.baselineIfLanded.public,
    [claim(ITEM_A1, FEED_A)],
    'the baseline still claims a feed favorite this device gave up',
  );

  // The other direction from the same fixture: drop the item, keep the feed.
  const other = plan({
    read,
    local: [feed(FEED_A, 'podcast', [], true)],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  assert.ok(other.publish);
  assert.deepEqual(ids(other.publish.tags), [FEED_A]);

  // And the conflict. A feed favorite this baseline does NOT claim belongs to
  // another app. Holding it as not-favorited here does not beat it: overwrite
  // it and that app restates it next cycle, forever.
  const foreign = plan({
    read,
    local: [feed(FEED_A, 'podcast', [ITEM_A1], false)],
    baseline: base([claim(ITEM_A1, FEED_A)]),
    mode: 'public',
  });
  const stillThere = foreign.publish ? ids(foreign.publish.tags) : ids(read.tags);
  assert.ok(
    stillThere.includes(FEED_A),
    "another app's feed favorite was deleted by a device that never made it",
  );
  assert.ok(
    !foreign.baselineIfLanded.public.includes(FEED_A),
    'carrying a feed favorite is not claiming it',
  );
});

test('27. An entry is carried whole, and no writer invents a feed guid', () => {
  // Rule 4 inside an `i` tag, and the stakes went UP with this revision. A
  // writer that rebuilds entries from its own model emits `['i', id]` and
  // drops position 2 — which no longer costs a label, it costs the item's
  // address. An item guid is unique only inside its feed, so an item stripped
  // of its feed guid cannot be looked up by anyone, ever again.
  //
  // Position 3 belongs to nobody yet, which is why a tag carrying something
  // there is the one to test. Note that the element being carried sits past
  // the item guid, not past the feed guid — the pair fills positions 1 and 2.
  const NEWER = 'written-by-a-writer-newer-than-this-one';
  const read = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    [...item(ITEM_A1, FEED_A), NEWER],
    item(ITEM_B1, FEED_B),
    K_FEED,
    K_ITEM,
  ]);

  const carrying = plan({
    read,
    local: [feed(FEED_C, 'podcast', [], true)],
    baseline: base(),
    mode: 'public',
  });
  assert.ok(carrying.publish, 'adding a local favorite must produce a publish');
  assert.deepEqual(
    tagFor(carrying.publish.tags, ITEM_A1),
    [...item(ITEM_A1, FEED_A), NEWER],
    'the item guid and the element past it must come back byte-identical',
  );
  assert.deepEqual(tagFor(carrying.publish.tags, ITEM_B1), item(ITEM_B1, FEED_B));
  assert.deepEqual(tagFor(carrying.publish.tags, FEED_A), ['i', FEED_A]);
  assert.deepEqual(
    tagFor(carrying.publish.tags, FEED_C),
    ['i', FEED_C],
    'a feed entry took a second element it has no meaning for',
  );

  // Carrying a foreign entry is not claiming it.
  assert.ok(!carrying.baselineIfLanded.public.includes(FEED_A));
  assert.ok(!carrying.baselineIfLanded.public.includes(claim(ITEM_A1, FEED_A)));

  // THE MIGRATION. A legacy two-element item takes its feed from the entry
  // above it, and a writer that touches the list rewrites it with that guid on
  // the entry. It happens once, and after it the item survives a reorder.
  const legacy = ev([
    ALT,
    ['medium', 'podcast'],
    ['i', FEED_A],
    ['i', ITEM_A1],
    K_FEED,
    K_ITEM,
  ]);
  const upgraded = plan({
    read: legacy,
    local: [feed(FEED_C, 'podcast', [], true)],
    baseline: base(),
    mode: 'public',
  });
  assert.ok(upgraded.publish);
  assert.deepEqual(
    tagFor(upgraded.publish.tags, ITEM_A1),
    item(ITEM_A1, FEED_A),
    'a legacy item was republished still unable to name its own feed',
  );

  // ...and it is idempotent. Reading the upgraded list back changes nothing.
  const again = plan({
    read: upgraded.publish,
    local: [feed(FEED_C, 'podcast', [], true)],
    baseline: upgraded.baselineIfLanded,
    mode: 'public',
  });
  assert.equal(again.publish, null, 'the migration republishes on every load');
});

test('28. An artist entry is a favorite that belongs to no feed', () => {
  // Music has three levels — artist, album, track — and this list carries two.
  // Favoriting an artist says "show me their whole catalogue", and the
  // catalogue is named in the publisher feed, not here. So the entry stands
  // alone: it names no feed, and nothing names it.
  const ARTIST = 'podcast:publisher:guid:0e8f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
  const tags = [
    ALT,
    ['medium', 'music'],
    ['i', FEED_A],
    ['i', ARTIST],
    item(ITEM_A1, FEED_A),
    K_FEED,
    K_ITEM,
  ];

  const parsed = parseTags(tags);
  const by = (id) => parsed.entries.find((e) => e.id === id);
  assert.ok(by(ARTIST), 'an artist entry is an entry, not junk');
  assert.equal(by(ARTIST).feed, null, 'an artist was given a feed guid');
  assert.equal(
    by(ITEM_A1).feed,
    guidOf(FEED_A),
    'the artist entry disturbed the track after it',
  );
  assert.equal(by(ARTIST).favorited, true, 'nothing but a favorite puts an artist here');

  // Carried in place by a writer changing something else, and BARE. There is
  // no feed for an artist to belong to, so a second element on one states
  // nothing and costs bytes on every republish forever.
  const carried = plan({
    read: ev(tags),
    local: [feed(FEED_A, 'music', [ITEM_A1], true)],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A), ITEM_A2]),
    mode: 'public',
  });
  const out = carried.publish ?? ev(tags);
  assert.deepEqual(tagFor(out.tags, ARTIST), ['i', ARTIST]);
  assert.equal(
    parseTags(out.tags).entries.find((e) => e.id === ITEM_A1).feed,
    guidOf(FEED_A),
    'the track lost its feed across a republish',
  );
  // AND IT LANDS IN THE ARTIST BAND, ahead of the album it was read after.
  // This is the band order doing its job on a list that arrived interleaved:
  // artists, then albums, then tracks. The artist can move because it belongs
  // to no feed and nothing on the list belongs to it — under the old format,
  // moving an entry past a feed entry re-parented every item behind it.
  assert.ok(
    at(out.tags, ARTIST) < at(out.tags, FEED_A) && at(out.tags, FEED_A) < at(out.tags, ITEM_A1),
    'the run was not emitted in band order: artists, albums, then tracks',
  );

  // The same, from the app that HOLDS the artist — which is where a writer
  // reaches for an extra element, because it has state and somewhere to put it.
  const held = plan({
    read: ev(tags),
    local: [
      feed(FEED_A, 'music', [ITEM_A1, ITEM_A2], true),
      feed(ARTIST, 'music', [], true),
    ],
    baseline: base([FEED_A, claim(ITEM_A1, FEED_A), ARTIST]),
    mode: 'public',
  });
  assert.ok(held.publish, 'adding a track is a change');
  assert.deepEqual(
    tagFor(held.publish.tags, ARTIST),
    ['i', ARTIST],
    'an artist entry was given a second element',
  );

  // And a device can originate one.
  const own = plan({
    read: ev([]),
    local: [feed(ARTIST, 'music')],
    baseline: base(),
    mode: 'public',
  });
  assert.ok(own.publish, 'favoriting an artist must publish');
  assert.deepEqual(tagFor(own.publish.tags, ARTIST), ['i', ARTIST]);
  assert.ok(
    own.publish.tags.some((t) => t[0] === 'k' && t[1] === 'podcast:publisher:guid'),
    'the kind must reach the `k` tags, or `#k` discovery misses it',
  );
});
