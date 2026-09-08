/**
 * The contract `vectors.test.mjs` drives.
 *
 * Two pure functions do the work, and a handful of small ones beside them.
 * Everything the 29 vectors need is expressible through them, and keeping them
 * pure is what lets the suite run with no relay, no signer, no clock and no
 * network — so a failure is always your merge and never your test environment.
 *
 * These are types for reading. The suite is plain ESM and does not typecheck
 * them; if your app is TypeScript, implement the interface and export the two
 * functions from a `.mjs` shim.
 */

/** A kind:10333 event, or the parts of one this format cares about. */
export interface FavoritesEvent {
  kind?: 10333;
  tags: string[][];
  /**
   * The private half, or ''. NEVER a literal on a republish — see rule 4.
   * Vector 12 is the one that catches a default parameter here.
   */
  content: string;
}

/**
 * One feed on this device, and the items favorited from it.
 *
 * This is a convenient shape rather than a wire shape: an item needs the guid
 * of its feed, and grouping the items under the feed is the tidiest way to
 * supply it. Nothing about it reaches the event.
 */
export interface LocalGroup {
  /**
   * A `podcast:guid:…` feed, or a `podcast:publisher:guid:…` artist.
   *
   * An artist belongs to no feed and holds no items: it is emitted bare, and
   * any `items` beside one are not this format's to place. Vector 28.
   */
  id: string;
  /** The medium hint, or null when the feed never declared one. */
  medium: string | null;
  /** `podcast:item:guid:…` identifiers of items favorited FROM this feed. */
  items: string[];
  /**
   * Has the user favorited the FEED itself?
   *
   * A plain boolean, and false is an ordinary answer rather than a claim. A
   * feed entry is written only when this is true, so a feed you hold only to
   * supply its items' feed guid never reaches the list — which is the case the
   * old format could not express without a placement marker. Vectors 25, 26.
   */
  favorited?: boolean;
}

/**
 * What this device last agreed with the relay on, PER HALF.
 *
 * Two sets, not one. Moving an entry public -> private is a removal on one
 * side and an addition on the other; against a single shared baseline those
 * cancel and the entry is deleted outright.
 *
 * Stored privately on the device. Not on the wire, never seen by another app,
 * and no two writers need theirs to agree.
 */
export interface Baseline {
  public: string[];
  private: string[];
}

/**
 * A claim must be as unique as the thing it stands for.
 *
 * A feed or an artist is its identifier. An ITEM IS THE PAIR: an item guid is
 * unique inside its feed and is not globally unique, so a baseline keyed on
 * the identifier alone cannot tell two items in two feeds apart, and removing
 * one removes both. The reference joins them with ` @ `; the exact string is
 * yours, since nothing on the wire carries it, but you must export
 * `itemClaim` so the vectors can hand you a baseline in your own shape.
 * Vector 25.
 */
export type ItemClaim = string;

export interface PlanInput {
  /**
   * The event as read, or NULL when the read is not trustworthy.
   *
   * `null` and `{tags: [], content: ''}` are different questions and must
   * produce different answers: "the relay never answered" against "the relay
   * has nothing". Vector 2. Believing the second when you mean the first
   * republishes a whole library as empty.
   */
  read: FavoritesEvent | null;
  /** This device's favorites. */
  local: LocalGroup[];
  /** This device's claims, per half. */
  baseline: Baseline;
  /**
   * Which half this writer feeds — the user's privacy setting in your app.
   *
   * NULL means they have no stored setting yet, so this writer follows the
   * list: the `visibility` tag if it has one, otherwise whichever half holds
   * entries. When the list cannot say either — no tag, and both halves empty
   * or both populated — `plan` must return `publish: null` and your app must
   * ask. Publishing on a guess is how a favorite someone hid in another app
   * becomes a relay-indexed `i` tag. Vector 16.
   */
  mode: 'public' | 'private' | null;
  /**
   * Can this writer decrypt the private half?
   *
   * False for a signer with no NIP-44 — a NIP-55 app-to-app signer, a
   * read-only login — and it is a normal state for a real user, not an error.
   * A writer that cannot see a half may not move what is in it and may not
   * restate the mode; it carries `content` and says so on screen. Vector 17.
   *
   * Distinct from a payload your codec cannot parse, which `decodePrivate`
   * already answers with null. Both arrive at the same place.
   */
  canReadPrivate?: boolean;
  /**
   * Is the user CHOOSING this mode right now, as opposed to it being your
   * app's standing setting?
   *
   * Only a choice may write the `visibility` tag for the first time or change
   * one that is already there. A standing setting that merely disagrees with
   * the list is two apps holding different answers about one shared event, and
   * letting whichever loaded last win is how a list flips halves on a page
   * load with nothing on screen. Ask instead.
   *
   * It is also what licenses the private → public whole-list move, together
   * with `canReadPrivate`: the user asked, in an app that could see everything
   * it was about to disclose.
   */
  userChose?: boolean;
}

export interface PlanResult {
  /**
   * The event to publish, or NULL to publish nothing.
   *
   * `null` is how rule 5 is expressed: the merged bytes match the bytes read,
   * so there is nothing to say. A writer that always publishes has two apps
   * rewriting the event against each other forever.
   */
  publish: FavoritesEvent | null;
  /**
   * The baseline to record IF AND ONLY IF that publish is confirmed by a
   * relay.
   *
   * Deliberately a returned value rather than a side effect. A baseline
   * written for an event that never landed says "I am already asserting
   * this", which is exactly what stops the entry from ever being retried —
   * the publish is lost permanently while the UI reports success. Vector 10
   * asserts that planning records nothing on its own.
   */
  baselineIfLanded: Baseline;
  /**
   * What this device holds once the publish lands — or absent when a cycle
   * leaves local state alone.
   *
   * Two models exist and both conform. A writer whose local state is a
   * DATABASE the merge never writes (StableKraft) is unchanged by a cycle:
   * foreign entries are carried and never held. A writer whose local state
   * is a CACHE OF THE MERGE (Boost Me Bitch) paints the active half whole —
   * an entry adopted that way is held from then on, claimed in the baseline,
   * and removed by this device only if the user unfavorites it here. The
   * multi-cycle vectors feed this back in as the next cycle's `local`, so
   * each model is tested against what it actually does; the disclosure rules
   * hold either way, because neither model adopts out of the INACTIVE half
   * beyond what its baseline claims.
   */
  holds?: LocalGroup[];
}

/** The parsed shape of one entry. Vectors 5, 6 and 7 read this. */
export interface ParsedEntry {
  /**
   * The full NIP-73 identifier, which for an ITEM is NOT what position 1 says.
   *
   * An item entry is
   * `['i', 'podcast:guid:<feedGuid>', 'podcast:item:guid:<itemGuid>']`, so an
   * item's identifier is position 2 and a feed's is position 1. Both positions
   * hold a full identifier, prefix included, so a baseline, a local group and
   * `itemClaim` are unchanged by the move — only the tag shape changed.
   */
  id: string;
  /**
   * From the known-kinds table, never by splitting the string — and read off
   * the entry's LAST identifier: position 2 when there is one, position 1
   * otherwise. So a three-element `podcast:guid:` tag is an item entry and its
   * kind is `podcast:item:guid`, which is what the trailing `k` tags must say
   * or `#k` discovery stops finding items. A position 2 whose kind is not
   * `podcast:item:guid` makes the whole tag unreadable — carry it, do not read
   * it as a feed favorite.
   */
  kind: string;
  /** The running `medium` value, or null when none preceded the entry. */
  medium: string | null;
  /**
   * The BARE feed guid this item belongs to, read off position 1 of its own
   * tag — the guid inside `podcast:guid:<feedGuid>`, not the entry above it.
   *
   * Null for a feed entry, for an artist, and for a legacy item that names no
   * feed and has no feed entry above it to borrow one from. An item guid alone
   * is not an address, so a null here means unresolvable, not merely
   * unlabelled: carry it, never delete it. Vector 20.
   */
  feed: string | null;
  /**
   * True when this entry came from a two-element `podcast:item:guid:` tag and
   * its feed was taken from the entry above it. A writer rewrites such a tag
   * as `['i', 'podcast:guid:<feedGuid>', 'podcast:item:guid:<itemGuid>']` —
   * the one-time migration, and note the identifier MOVES from position 1 to
   * position 2 rather than a third element being appended. Vector 27.
   */
  legacy?: boolean;
  /** Always true for a feed or artist entry: being on the list IS the favorite. */
  favorited?: boolean;
  /** What a baseline claims and a dedupe compares. See ItemClaim. */
  key?: string;
  /** Position in the tag array. `medium` is still positional; keep it. */
  index: number;
}

export interface ParsedList {
  entries: ParsedEntry[];
  /**
   * Feed identifiers the user favorited, mapped to true.
   *
   * There is no group list any more, and no question for one to answer: a feed
   * entry on this list IS a feed favorite, because nothing is on the list for
   * structural reasons.
   */
  favorited: Map<string, boolean>;
  /** `k` values as read. Never used to derive an entry's kind. */
  kinds: string[];
  /** Tags and identifiers no writer here understands. Carried, not parsed. */
  foreign: Array<{ index: number; tag: string[] }>;
}

export interface FavoritesAdapter {
  /** Tag array in, structure out. Vectors 5, 6, 7. */
  parseTags(tags: string[][]): ParsedList;

  /**
   * The kind of an IDENTIFIER, or null. Vector 6.
   *
   * This is the string-level lookup, and it still matters: the legacy
   * two-element form puts `podcast:item:guid:<itemGuid>` at position 1, and an
   * item guid is routinely a permalink URL. It is not the whole answer for an
   * entry — see `ParsedEntry.kind`.
   */
  kindOf(identifier: string): string | null;

  /**
   * The baseline claim for one item favorite, from the item's identifier and
   * the BARE feed guid it belongs to.
   *
   * Exported so the vectors can build a baseline in your shape rather than the
   * reference's. Whatever you return, the same pair must always produce it and
   * two different pairs must never collide. See ItemClaim. Vector 25.
   */
  itemClaim(itemId: string, feedGuid: string): string;

  /** One publish cycle, decided but not sent. */
  plan(input: PlanInput): PlanResult;

  /**
   * The private half decoded, or NULL when this writer cannot read the bytes.
   *
   * `null` is not an error. It is the ordinary case rule 4 is about: another
   * app's half, which you carry verbatim and never parse. Vector 12.
   *
   * `null` ALSO for bytes you can open that are not a tag array — see
   * `decodePlaintext`. Vector 23.
   */
  decodePrivate(content: string): string[][] | null;

  /** The inverse: `seal(encodePlaintext(tags))`. Real writers use NIP-44. */
  encodePrivate(tags: string[][]): string;

  /**
   * The bytes handed to the signer, BEFORE encryption: the tag array
   * stringified, with every `?` written as its JSON escape `\u003f`.
   *
   * A NIP-55 signer URL-decodes the whole `nostrsigner:` URI and only then
   * splits it on `?`, and item guids are routinely permalink URLs. Vector 22.
   *
   * `plan` refuses to publish a private half whose plaintext exceeds 60,000
   * UTF-8 bytes — NIP-44 v2's 65,535-byte cliff, less what NIP-44 adds on the
   * way to `content`. Past it the list reads back as EMPTY on an older
   * signer, not as an error. Vector 24.
   */
  encodePlaintext(tags: string[][]): string;

  /**
   * The plaintext back into a tag array, or NULL when it is not one.
   *
   * Valid JSON that is not an array of string arrays is `null`, never `[]`.
   * "Readable and empty" is what the next republish overwrites `content`
   * from. Vector 23.
   */
  decodePlaintext(text: string): string[][] | null;

  /**
   * Encrypt an arbitrary plaintext the way `encodePrivate` does, so a vector
   * can put bytes in `content` that decrypt but are not a list. Vector 23.
   * The reference's codec is a reversible stand-in; a real shim may wrap
   * NIP-44 with a fixed key.
   */
  seal(text: string): string;
}
