#!/usr/bin/env node
// The PC 2.0 Favorites merge (`assets/js/favorites-merge.js`), three halves:
//
//   1. THE SPEC'S OWN VECTORS, run against the SHIPPED module through the shim
//      `scripts/favorites-conformance-adapter.mjs`. The vectors are vendored in
//      scripts/vendor/pc20-favorites/ with the upstream SHA (PROVENANCE); a
//      vector failing after a re-vendor is the spec moving under us, and a
//      vector failing after an edit here is a change to the spec, which is
//      raised upstream before it ships.
//   2. THE ASYNC SEAM the reference does not have: without a `codec`, `plan`
//      hands back `privatePlaintext` to encrypt-to-self and a null `content`,
//      carries an opaque half byte for byte, and writes '' for an empty one.
//   3. A SOURCE SCAN: no stand-in codec, no Buffer, no clock, no locale, no
//      imports at all. The module decides; it never seals, signs or sends.
//
// node scripts/test-favorites-merge.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../assets/js/favorites-merge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
};

// 1. The spec's vectors.
{
  const vectors = path.join(root, 'scripts/vendor/pc20-favorites/vectors.test.mjs');
  const r = spawnSync(process.execPath, ['--test', vectors], {
    cwd: root,
    env: { ...process.env, PC20_FAVORITES_ADAPTER: 'scripts/favorites-conformance-adapter.mjs' },
    encoding: 'utf8',
  });
  const out = r.stdout + r.stderr;
  const n = (k) => Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) ?? [])[1] ?? NaN);
  check(`spec vectors: ${n('pass')} of ${n('tests')} pass, ${n('fail')} fail`, () => {
    assert.equal(r.status, 0, out.split('\n').filter((l) => /^not ok|Error/.test(l)).join(' | '));
    assert.ok(n('tests') >= 28, `expected the 28 vectors of e44843a or more, ran ${n('tests')}`);
    assert.equal(n('fail'), 0);
  });
  const prov = readFileSync(path.join(root, 'scripts/vendor/pc20-favorites/PROVENANCE'), 'utf8');
  check('PROVENANCE names the upstream commit', () => assert.match(prov, /commit [0-9a-f]{7,}/));
}

// 2. The async seam.
const FEED = 'podcast:guid:aaaaaaaa-0000-0000-0000-000000000001';
const ITEM = 'podcast:item:guid:aaaaaaaa-1111-0000-0000-000000000001';
const local = [{ id: FEED, medium: 'podcast', items: [ITEM], favorited: true }];
const empty = { public: [], private: [] };

check('private publish without a codec: content null, privatePlaintext is the exact plaintext', () => {
  const r = M.plan({
    read: { tags: [['alt', M.ALT], ['visibility', 'private']], content: '' },
    local, baseline: empty, mode: 'private',
  });
  assert.ok(r.publish, 'publishes');
  assert.equal(r.publish.content, null);
  const tags = M.decodePlaintext(r.publish.privatePlaintext);
  assert.ok(Array.isArray(tags), 'plaintext decodes to a tag array');
  // One favorite, one tag: the feed bare, the item as [feed, item].
  assert.deepEqual(tags.filter((t) => t[0] === 'i'), [['i', FEED], ['i', FEED, ITEM]]);
  assert.equal(r.publish.privatePlaintext, M.encodePlaintext(tags), 'byte-exact plaintext');
  assert.equal(r.publish.tags.some((t) => t[0] === 'i'), false, 'nothing leaks into the public half');
});

check('an opaque private half is carried byte for byte, privatePlaintext null', () => {
  const CIPHER = 'AkQB-not-ours-and-not-decodable';
  const r = M.plan({
    read: { tags: [['alt', M.ALT], ['visibility', 'public']], content: CIPHER },
    local, baseline: empty, mode: 'public', readPrivate: null,
  });
  assert.ok(r.publish, 'publishes our public entries');
  assert.equal(r.publish.content, CIPHER);
  assert.equal(r.publish.privatePlaintext, null);
});

check('readPrivate is what plan reasons about when the caller decrypted it', () => {
  const B = 'podcast:guid:bbbbbbbb-0000-0000-0000-000000000002';
  const readPrivate = [['medium', 'podcast'], ['i', B]];
  const r = M.plan({
    read: { tags: [['alt', M.ALT], ['visibility', 'private']], content: 'cipher-the-caller-opened' },
    local, baseline: empty, mode: 'private', readPrivate,
  });
  assert.ok(r.publish);
  const keys = M.decodePlaintext(r.publish.privatePlaintext).filter((t) => t[0] === 'i').map((t) => M.keyOf(M.parseTags([t]).entries[0]));
  assert.ok(keys.includes(M.keyOf(M.parseTags([['i', B]]).entries[0])), 'the other writer\'s private entry survives');
  assert.ok(keys.includes(M.keyOf(M.parseTags([['i', FEED]]).entries[0])), 'our feed favorite is added');
  assert.ok(keys.includes(M.keyOf(M.parseTags([['i', FEED, ITEM]]).entries[0])), 'our item favorite is added');
});

check('an empty private half writes \'\', not null and not ciphertext', () => {
  const r = M.plan({
    read: { tags: [['alt', M.ALT], ['visibility', 'public']], content: '' },
    local, baseline: empty, mode: 'public',
  });
  assert.ok(r.publish);
  assert.equal(r.publish.content, '');
  assert.equal(r.publish.privatePlaintext, null);
});

check('parse takes the decoded private half from the caller', () => {
  const p = M.parse({ tags: [['alt', M.ALT], ['i', FEED]], content: 'x' }, [['i', FEED, ITEM]]);
  assert.deepEqual(p.private, [['i', FEED, ITEM]]);
  assert.equal(p.favorited.get(FEED), true);
});

// 2b. THE DEPARTURE FROM THE REFERENCE: a removal propagates on a private
// list, and across a licensed private -> public move. The reference's outer
// merge on those two branches carries `adoptAll`, which keeps a claimed entry
// this device no longer holds. Raised upstream 2026-09-08.
const FEED_B = 'podcast:guid:bbbbbbbb-0000-0000-0000-000000000002';
check('a claimed entry removed locally is dropped from a PRIVATE list', () => {
  const readPrivate = [['medium', 'podcast'], ['i', FEED], ['i', FEED_B]];
  const r = M.plan({
    read: { tags: [['alt', M.ALT], ['visibility', 'private']], content: 'cipher' },
    readPrivate,
    local: [{ id: FEED, medium: 'podcast', items: [], favorited: true }],
    baseline: { public: [], private: [FEED, FEED_B] },
    mode: 'private',
  });
  assert.ok(r.publish, 'the removal is a publish');
  const ids = M.decodePlaintext(r.publish.privatePlaintext).filter((t) => t[0] === 'i').map((t) => t[1]);
  assert.deepEqual(ids, [FEED]);
  assert.deepEqual(r.baselineIfLanded.private, [FEED]);
});
check('an unclaimed private entry is still carried, and an unclaimed public one still moves whole on going private', () => {
  const r = M.plan({
    read: { tags: [['alt', M.ALT], ['medium', 'podcast'], ['i', FEED_B]], content: 'cipher' },
    readPrivate: [['medium', 'podcast'], ['i', FEED]],
    local: [],
    baseline: { public: [], private: [] },
    mode: 'private', userChose: true,
  });
  assert.ok(r.publish);
  const ids = M.decodePlaintext(r.publish.privatePlaintext).filter((t) => t[0] === 'i').map((t) => t[1]);
  assert.deepEqual(ids.sort(), [FEED, FEED_B].sort(), 'nothing this device never claimed is dropped');
  assert.equal(r.publish.tags.some((t) => t[0] === 'i'), false, 'the public half is emptied by the move');
});
check('a claimed entry removed locally is dropped across a licensed private -> public move', () => {
  const r = M.plan({
    read: { tags: [['alt', M.ALT], ['visibility', 'public'], ['medium', 'podcast'], ['i', FEED_B]], content: 'cipher' },
    readPrivate: [['medium', 'podcast'], ['i', FEED]],
    local: [{ id: FEED, medium: 'podcast', items: [], favorited: true }],
    baseline: { public: [FEED_B], private: [] },
    mode: 'public',
  });
  assert.ok(r.publish);
  assert.deepEqual(r.publish.tags.filter((t) => t[0] === 'i'), [['i', FEED]], 'FEED_B, claimed and dropped locally, goes; FEED moves in');
});

// 3. Source scan.
const src = readFileSync(path.join(root, 'assets/js/favorites-merge.js'), 'utf8');
const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
check('no imports: the module is dependency-free', () => assert.doesNotMatch(code, /^\s*import\s/m));
check('no stand-in codec in the shipped module', () => {
  assert.doesNotMatch(code, /sealed:|PRIV1:|PRIV_PREFIX|\bseal\s*\(|encodePrivate\s*\(|decodePrivate\s*\(/);
});
check('no Buffer (browser module)', () => assert.doesNotMatch(code, /\bBuffer\./));
check('no clock, no locale', () => assert.doesNotMatch(code, /Date\.now|new Date\(|toLocale/));
check('no DOM, no network', () => assert.doesNotMatch(code, /\bdocument\.|\bwindow\.|\bfetch\(|WebSocket/));
check('the legacy two-element item reads its feed from the entry above (dual-read rule)', () => {
  const B = 'podcast:guid:bbbbbbbb-0000-0000-0000-000000000002';
  const { entries } = M.parseTags([['medium', 'podcast'], ['i', B], ['i', ITEM]]);
  const item = entries.find((e) => e.kind === 'podcast:item:guid');
  assert.ok(item, 'the legacy item parses as an item');
  assert.equal(item.feed, M.feedGuidOf(B), 'and its feed is the entry above');
});

check('the plaintext escapes ? for NIP-55 signers', () => {
  assert.equal(M.encodePlaintext([['i', 'podcast:item:guid:https://x/y?z=1']]).includes('?'), false);
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
