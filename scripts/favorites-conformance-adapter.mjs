// The shim `scripts/vendor/pc20-favorites/vectors.test.mjs` drives, per its
// adapter.d.ts: the SHIPPED merge module plus the spec's stand-in codec, which
// lives here and only here. The stand-in is reversible base64 and NOT
// encryption — the vectors only need "can this writer read the half or not" —
// and it must never reach assets/js (test-favorites-merge.mjs scans for it).
import * as M from '../assets/js/favorites-merge.js';

const PRIV_PREFIX = 'sealed:';
export const seal = (text) => PRIV_PREFIX + Buffer.from(text, 'utf8').toString('base64');
const unseal = (content) =>
  content.startsWith(PRIV_PREFIX)
    ? Buffer.from(content.slice(PRIV_PREFIX.length), 'base64').toString('utf8')
    : null;
export function encodePrivate(tags) {
  if (!tags || tags.length === 0) return '';
  return seal(M.encodePlaintext(tags));
}
export function decodePrivate(content) {
  if (!content) return [];
  const text = unseal(content);
  if (text === null) return null;
  return M.decodePlaintext(text);
}
export const codec = { encode: encodePrivate, decode: decodePrivate };

export const {
  KIND, ALT, VISIBILITY, PRIVATE_PLAINTEXT_MAX,
  feedGuidOf, feedIdOf, itemIdOf, keyOf, itemClaim, kindOf, kindOfTag,
  parseTags, plaintextBytes, encodePlaintext, decodePlaintext, statedVisibility,
} = M;
export const parse = (event) => M.parse(event, decodePrivate(event?.content ?? ''));
export const plan = (input) => M.plan({ ...input, codec });
