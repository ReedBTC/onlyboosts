/* Boost messages, bios and the identifiers inside them, as HTML.
 *
 * ⚠️ THIS MODULE IS IMPORTED FROM BOTH SIDES, and it is the first one that is.
 * `functions/_shared/detail-page.js` imports it by relative path, which esbuild
 * resolves off the filesystem when wrangler bundles the Pages Functions; the
 * browser imports it as `/assets/js/nostr-text.js?v=<VERSION>` like any other
 * module. Two rules follow from that and both are load-bearing:
 *
 *   1. NO DOM, NO `env`, NO `fetch`. Everything here is a pure string→string
 *      function, so the same call produces the same bytes at the edge and in the
 *      browser. That is the whole point: one message renderer rather than two
 *      that agree by inspection.
 *   2. IMPORTS ARE RELATIVE AND STAMPED — `'./thing.js?v=ob-v61'`. The browser
 *      resolves that against this module's own URL and gets the stamped absolute
 *      form; esbuild strips the query and reads the file. An ABSOLUTE
 *      `/assets/js/…` import would resolve in the browser and fail to bundle, so
 *      it is the one form a two-sided module may not use. scripts/stamp-assets.js
 *      knows about both shapes. (This file happens to need no imports at all.)
 *
 * WHERE IT CAME FROM. Every function below was `functions/_shared/detail-page.js`'s
 * and moved here unchanged when the episode card became one definition — the card
 * renders boost messages, and it renders them at the edge and in the browser, so
 * the tokenizer had to be reachable from both. That file re-exports all of it, so
 * nothing that imported these from there had to change.
 *
 * WHAT THE CLIENT FEEDS USED TO DO INSTEAD, and why they stopped. The homepage
 * built boost messages with `boosts-thread.js#parseSegments`, which decodes with
 * nostr-tools and paints the same `.nostr-mention` chip. Two renderers for one
 * string is exactly the drift the rendering rule exists to prevent, and this is
 * the one of the two that can run in both places — parseSegments needs 102KB of
 * nostr-tools and a DOM. One visible consequence: a `nostr:note1…` or
 * `nostr:nevent1…` inside a boost message is now a chip linking to njump on the
 * homepage as it already was on /show and /episode, rather than a quoted-note
 * chip. That is a convergence onto the behaviour three of the four surfaces
 * already had.
 */

export function htmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Matches assets/js/boosts-feed.js#isSafeUrl. Every image and link on these
// pages originates in third-party RSS by way of Podcast Index, so none of it
// reaches href/src unchecked.
export function isSafeUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

export function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

// ── nostr: URIs in boost messages ────────────────────────────────────────────
//
// Only bech32 DECODE is implemented, and only far enough to recover a pubkey.
// Links use the identifier exactly as it appeared in the note, so nothing has
// to be re-encoded; the decode exists purely to look a display name up.

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

// Returns the data part as bytes, or null. The checksum is verified: an
// identifier that fails it is left as plain text rather than being linked,
// since a corrupted npub would otherwise resolve to somebody else's profile.
function bech32ToBytes(str) {
  const s = String(str).toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length || s.length > 2000) return null;

  const words = [];
  for (let i = sep + 1; i < s.length; i++) {
    const v = BECH32_CHARSET.indexOf(s[i]);
    if (v === -1) return null;
    words.push(v);
  }

  // bech32 (not bech32m): the polymod of hrp-expansion ++ data must be 1.
  const hrp = s.slice(0, sep);
  const expanded = [];
  for (let i = 0; i < hrp.length; i++) expanded.push(hrp.charCodeAt(i) >> 5);
  expanded.push(0);
  for (let i = 0; i < hrp.length; i++) expanded.push(hrp.charCodeAt(i) & 31);
  let chk = 1;
  for (const v of expanded.concat(words)) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i];
  }
  if (chk !== 1) return null;

  // 5-bit groups back to 8-bit, dropping the 6-word checksum.
  const data = words.slice(0, -6);
  const out = [];
  let acc = 0, bits = 0;
  for (const v of data) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  // Any leftover must be zero padding, per the spec.
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) return null;
  return out;
}

const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

// npub → the pubkey. nprofile → the pubkey in its TLV type-0 record.
function pubkeyFromBech32(id) {
  const bytes = bech32ToBytes(id);
  if (!bytes) return null;
  if (/^npub1/i.test(id)) return bytes.length === 32 ? toHex(bytes) : null;
  if (/^nprofile1/i.test(id)) {
    for (let i = 0; i + 2 <= bytes.length; ) {
      const type = bytes[i], len = bytes[i + 1];
      if (i + 2 + len > bytes.length) return null;
      if (type === 0) return len === 32 ? toHex(bytes.slice(i + 2, i + 34)) : null;
      i += 2 + len;
    }
  }
  return null;
}

const NOSTR_URI_RE = /nostr:((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

// Every pubkey mentioned across a set of boost messages, for the name lookup.
export function mentionedPubkeys(messages) {
  const out = new Set();
  for (const m of messages) {
    for (const match of String(m || "").matchAll(NOSTR_URI_RE)) {
      const pk = pubkeyFromBech32(match[1]);
      if (pk) out.add(pk);
    }
  }
  return [...out];
}

/* ⚠️ A BIO IS TYPED BY A HUMAN, SO ITS MENTIONS HAVE NO `nostr:` PREFIX.
 *
 * NIP-27 says a CLIENT composing note content emits `nostr:npub1…`, which is
 * what NOSTR_URI_RE above matches and why boost messages tokenize correctly. A
 * kind-0 `about` is not composed by a client — someone types it into a profile
 * editor — so the overwhelmingly common form there is a naked `npub1…`, or one
 * with a leading `@`. Measured on a live profile in the index
 * (npub1yvscx9v…, Sir Spencer): two mentions in the bio, both bare, both
 * rendering as 63 characters of raw bech32 because this pattern demanded the
 * scheme.
 *
 * Only npub and nprofile, because only those are PEOPLE. A `note1…` in a bio has
 * no face and no name to show, and pubkeyFromBech32 returns null for it anyway,
 * so it stays text.
 *
 * The lookbehind keeps `foonpub1…` from matching mid-token. The bech32 checksum
 * gate in the renderer is the real guard against a false positive: a word that
 * merely begins `npub1` fails it and degrades to text.
 *
 * An npub sitting INSIDE a URL (njump.me/npub1…) is handled by the ordering in
 * scanSpans rather than by this pattern: the URL span starts earlier, wins the
 * cursor, and the mention span inside it is skipped.
 */
const BIO_MENTION_RE = /(?<![0-9a-z])(?:nostr:|@)?((?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi;

/* Find the mentions and bare URLs in a string, in document order.
 *
 * Shared by renderMessage and renderBioText, which tokenize identically and
 * differ only in what they emit — and in which mention pattern they pass, which
 * is the whole reason it is a parameter. A URL that falls inside a mention span
 * is skipped rather than double-matched.
 */
function scanSpans(src, mentionRe = NOSTR_URI_RE) {
  const spans = [];
  for (const m of src.matchAll(mentionRe)) spans.push({ start: m.index, end: m.index + m[0].length, id: m[1], value: m[0], kind: "nostr" });
  for (const m of src.matchAll(URL_RE)) {
    if (spans.some((s) => m.index >= s.start && m.index < s.end)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, id: m[0], kind: "url" });
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/* One link, escaped and bounded. Shared by renderMessage and renderBioText.
 *
 * ⚠️ TRAILING SENTENCE PUNCTUATION IS NOT PART OF THE URL. The URL pattern is
 * greedy to the next whitespace, so "book at https://example.com/hire." put the
 * full stop inside the href and produced a link that 404s. It is trimmed back
 * and re-emitted as text after the anchor, which is what linkifyNotes on
 * /episode/<guid> has always done and what this had not.
 *
 * This corrects boost messages on every surface, since all of them now share
 * this function — the same defect was live on every message carrying a
 * sentence-final URL.
 */
function linkOut(url) {
  const raw = String(url).replace(/[.,;:!?)\]]+$/, "");
  const tail = String(url).slice(raw.length);
  const body = isSafeUrl(raw)
    ? `<a href="${htmlEscape(raw)}" target="_blank" rel="noopener noreferrer">${htmlEscape(truncate(raw, 60))}</a>`
    : htmlEscape(raw);
  return body + htmlEscape(tail);
}

/* A booster's kind-0 `about` as HTML, for the header on /booster/<npub>.
 *
 * Same tokenizer as renderMessage, two deliberate differences in what it emits:
 *
 * ⚠️ A MENTION IS NOT A LINK HERE. On a boost message an @Name chip opens njump,
 * which resolves any npub. In a bio the obvious destination would be
 * /booster/<npub> — and that page only exists for people who have BOOSTED, which
 * a mentioned npub need never have done. Rather than link some mentions and not
 * others, or link them all and 404 for most, none of them link. njump is not
 * used either: on this page, unlike a boost message, the mention sits inside a
 * two-line clamped paragraph where a row of outbound chips would read as the
 * bio's main content.
 *
 * ⚠️ IT SHOWS A FACE. The chip is a small avatar plus the display name, which is
 * how every Nostr client renders a mention and is why the profile lookup
 * returns pictures. A mention we cannot resolve degrades to `@npub1abc…`, and
 * carries data-pk/data-missing so booster-page.js can fill it from Primal in the
 * same batch it already fetches the subject with — most mentioned npubs are not
 * in our index at all, so that fallback is the common path rather than the edge.
 *
 * Truncated far longer than a boost message's 420: bios run to a measured
 * maximum of 4,965 characters, and the two-line clamp is what actually bounds
 * what a reader sees.
 */
export function renderBioText(text, profiles) {
  const src = truncate(String(text || ""), 2000);
  let out = "", cursor = 0;
  // BIO_MENTION_RE, not the scheme-only pattern the boost messages use — see
  // the warning over it. This is the difference between a bio's mentions
  // rendering and not.
  for (const s of scanSpans(src, BIO_MENTION_RE)) {
    if (s.start < cursor) continue;
    out += htmlEscape(src.slice(cursor, s.start));
    cursor = s.end;
    if (s.kind === "url") { out += linkOut(s.id); continue; }

    // Same checksum gate as renderMessage: a corrupted identifier is text, not
    // a mis-resolved person. It also fixes the one tokenizing edge case, where
    // two mentions run together capture one character too many.
    const pk = bech32ToBytes(s.id) ? pubkeyFromBech32(s.id) : null;
    if (!pk) { out += htmlEscape(s.value ?? s.id); continue; }

    const prof = profiles?.get(pk) || null;
    const label = prof?.name ? "@" + prof.name : "@" + s.id.slice(0, 14) + "…";
    const missing = [prof?.name ? null : "name", prof?.picture ? null : "pic"].filter(Boolean).join(" ");
    out += `<span class="bs-mention"${missing ? ` data-pk="${htmlEscape(pk)}" data-missing="${htmlEscape(missing)}"` : ""}>` +
      (prof?.picture
        ? `<img class="bs-mention-pic" src="${htmlEscape(prof.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : `<span class="bs-mention-pic is-blank" aria-hidden="true"></span>`) +
      `<span class="bs-mention-name">${htmlEscape(label)}</span></span>`;
  }
  return out + htmlEscape(src.slice(cursor));
}

/* A boost message as HTML: nostr: URIs become @Name chips, bare URLs become
 * links, everything else is escaped text.
 *
 * `names` is a Map of hex pubkey → display name. Both sides fill it from what
 * they already hold — the edge from a `profiles` lookup, the browser from the
 * identities the collector embeds in every boost record — so the same message
 * renders the same way in both places.
 */
export function renderMessage(text, names) {
  const src = truncate(String(text || ""), 420);
  const spans = scanSpans(src);

  let out = "", cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    out += htmlEscape(src.slice(cursor, s.start));
    cursor = s.end;
    if (s.kind === "url") { out += linkOut(s.id); continue; }
    // An identifier that fails its checksum is left as plain text rather than
    // linked. It would only ever open an empty njump tab, and it is also how
    // the one tokenizing edge case resolves itself: bech32's charset includes
    // `n`, so two mentions run together with no space ("…ckn ostr:npub1…")
    // greedily match one character too many. That over-long capture fails the
    // checksum, so it degrades to text instead of pointing at the wrong person.
    if (!bech32ToBytes(s.id)) { out += htmlEscape(s.value ?? s.id); continue; }
    const pk = pubkeyFromBech32(s.id);
    const name = pk ? names?.get(pk) : null;
    const label = name ? "@" + name : "@" + s.id.slice(0, 14) + "…";
    // An unresolved mention carries its pubkey so the client can ask Primal for
    // the name and swap the label in. A mentioned npub need never have boosted
    // anything, so missing from `profiles` is the normal case here rather than
    // the exceptional one.
    const hook = !name && pk ? ` data-pk="${htmlEscape(pk)}" data-missing="name"` : "";
    out += `<a class="nostr-mention" href="https://njump.me/${htmlEscape(s.id)}" target="_blank" rel="noopener noreferrer"${hook}>${htmlEscape(label)}</a>`;
  }
  out += htmlEscape(src.slice(cursor));
  return out;
}
