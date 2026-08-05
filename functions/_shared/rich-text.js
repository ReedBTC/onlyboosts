/* Publisher HTML → paragraphs of tokens.
 *
 * Podcast Index returns the longer of a feed's <description>, <itunes:summary>
 * and <content:encoded>, which means arbitrary publisher-authored HTML. It is
 * the same field at two levels — an episode's show notes and a show's own
 * description — so one parser serves both. Three things it has to get right:
 *
 *   1. PARAGRAPHS SURVIVE. This is most of the reason it exists. The
 *      collector's clean_html collapses all whitespace, so D1's copy is one
 *      block; a real show note is a summary, then links, then boilerplate, and
 *      running them together is what makes the truncated version read badly.
 *   2. ANCHORS SURVIVE AS LINKS. A publisher writes "get the book here" with
 *      the URL only in the href, so stripping tags the way LB does loses the
 *      link entirely and leaves a sentence pointing at nothing.
 *   3. NOTHING BECOMES MARKUP. The output is a token tree — paragraphs of
 *      { t: "text", v } and { t: "link", href, v } — never a string. On the
 *      client it becomes text nodes and anchors through DOM calls, and on the
 *      server it is escaped field by field. Returning cleaned HTML instead
 *      would be one innerHTML away from a third-party description writing
 *      markup into a page.
 *
 * Moved here verbatim from functions/api/episode-meta.js, which was its only
 * caller until /show/<guid> needed the same treatment for a show description.
 */

// A full description is a few thousand characters; the caps are for the feed
// that pastes a transcript into <content:encoded>, which is a real thing
// publishers do. Truncation here is a cliff rather than PI's ellipsis, so the
// ceilings are set well past anything a reader would finish.
const NOTES_MAX_INPUT = 60_000;
const NOTES_MAX_CHARS = 20_000;
const NOTES_MAX_PARAGRAPHS = 80;

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", bull: "•", middot: "·", trade: "™",
  copy: "©", reg: "®", deg: "°", eacute: "é", euro: "€", pound: "£",
};
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Codepoints outside the Unicode range, and the surrogate block, come
      // back as the original text rather than throwing.
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return m;
      if (cp >= 0xd800 && cp <= 0xdfff) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

// Tags that end a paragraph. Everything else (<b>, <i>, <span>, <em>) is
// inline and contributes nothing but its text.
const BLOCK_TAG = /^(p|div|br|li|ul|ol|tr|table|h[1-6]|blockquote|section|article|pre|hr)$/;

// Tags whose CONTENT is not prose. Their text is discarded rather than
// collected: nothing here can become markup — the output is a token tree, and
// both renderers escape every field — but a feed that pastes a tracking snippet
// into its description would otherwise print the script's source as a
// paragraph. An unclosed one swallows the rest of the description, which is the
// right way round: the alternative is printing code as copy.
const OPAQUE_TAG = /^(script|style|noscript|iframe|template|svg)$/;
const TAG_RE = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i;
const BARE_URL_RE = /https?:\/\/[^\s<>"']+/g;

function safeHref(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 2048) return null;
  const url = decodeEntities(raw).trim();
  // http(s) only, and never a scheme-relative or protocol-less string that a
  // browser would resolve somewhere unexpected.
  return /^https?:\/\//i.test(url) ? url : null;
}

/* One paragraph's plain text → tokens, linkifying bare URLs. Anchors are added
 * by the caller, which knows where they were; this only handles URLs a
 * publisher typed as text. */
function textTokens(text, out) {
  let cursor = 0;
  for (const m of text.matchAll(BARE_URL_RE)) {
    if (m.index > cursor) out.push({ t: "text", v: text.slice(cursor, m.index) });
    cursor = m.index + m[0].length;
    // A trailing sentence period belongs to the sentence, not the URL.
    const href = m[0].replace(/[.,;:)\]]+$/, "");
    const tail = m[0].slice(href.length);
    if (safeHref(href)) out.push({ t: "link", href, v: href });
    else out.push({ t: "text", v: href });
    if (tail) out.push({ t: "text", v: tail });
  }
  if (cursor < text.length) out.push({ t: "text", v: text.slice(cursor) });
}

export function parseNotes(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const src = raw.slice(0, NOTES_MAX_INPUT);

  // Walk the tags. Text between them accumulates into the current paragraph,
  // either as free text or as the label of an open anchor.
  const paragraphs = [];
  let para = [];        // tokens for the paragraph being built
  let buf = "";         // plain text pending
  let href = null;      // the open anchor's target, if any
  let anchorText = "";

  const flushText = () => {
    if (!buf) return;
    // Runs of two or more newlines are the publisher's own paragraph breaks in
    // a plain-text description; a single one is a wrap and reads as a space.
    // Same rule LB applies to its stripped shownotes.
    const parts = decodeEntities(buf).split(/\n{2,}/);
    parts.forEach((part, i) => {
      if (i > 0) endPara();
      const t = part.replace(/[ \t\r\n]+/g, " ");
      if (t) textTokens(t, para);
    });
    buf = "";
  };
  const endPara = () => {
    // Adjacent text tokens are merged before anything else: a dropped anchor
    // (no label, or an unsafe href) leaves the text on either side of it split
    // in two, and rendering those separately puts a double space in the
    // sentence.
    const merged = [];
    for (const tok of para) {
      const prev = merged[merged.length - 1];
      if (tok.t === "text" && prev && prev.t === "text") prev.v += tok.v;
      else merged.push({ ...tok });
    }
    const tokens = [];
    for (const tok of merged) {
      if (tok.t === "text") {
        tok.v = tok.v.replace(/\s{2,}/g, " ");
        if (!tok.v.trim()) continue;
      }
      tokens.push(tok);
    }
    if (tokens.length) {
      // Trim the edges of the paragraph without disturbing the joins inside it.
      const first = tokens[0];
      if (first.t === "text") first.v = first.v.replace(/^\s+/, "");
      const last = tokens[tokens.length - 1];
      if (last.t === "text") last.v = last.v.replace(/\s+$/, "");
      paragraphs.push(tokens);
    }
    para = [];
  };

  let cursor = 0;
  let skip = null;      // the open opaque tag whose content is being discarded
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src)) !== null) {
    const chunk = src.slice(cursor, m.index);
    cursor = m.index + m[0].length;

    const name = m[1].toLowerCase();
    const closing = m[0][1] === "/";

    // Inside a <script> or a <style>: the text between the tags goes nowhere,
    // and only that element's own closing tag ends it.
    if (skip) {
      if (closing && name === skip) skip = null;
      continue;
    }

    if (href !== null) anchorText += chunk;
    else buf += chunk;

    if (!closing && OPAQUE_TAG.test(name)) {
      flushText();
      skip = name;
      continue;
    }

    if (name === "a") {
      if (closing) {
        if (href !== null) {
          const label = decodeEntities(anchorText).replace(/\s+/g, " ").trim();
          flushText();
          // An anchor with no text at all (an image link, usually) is dropped
          // rather than rendered as a bare href the publisher never wrote.
          if (label) para.push({ t: "link", href, v: label });
          href = null;
          anchorText = "";
        }
      } else {
        // A nested <a> is malformed; close the outer one first so its label is
        // not swallowed.
        if (href !== null) { const label = decodeEntities(anchorText).replace(/\s+/g, " ").trim(); if (label) para.push({ t: "link", href, v: label }); }
        const hm = m[0].match(HREF_RE);
        href = safeHref(hm ? (hm[1] ?? hm[2] ?? hm[3]) : null);
        anchorText = "";
        // An unsafe or missing href leaves the anchor's TEXT in the paragraph:
        // href stays null, so the label falls through to the plain-text path.
      }
      continue;
    }
    if (BLOCK_TAG.test(name)) {
      flushText();
      endPara();
    }
  }
  // The tail after the last tag, before the open-anchor flush rather than after
  // it: a description that ends inside an unclosed <a> carries that anchor's
  // label here, and checking the anchor first would push an empty link and then
  // print its text as loose prose.
  const tail = skip ? "" : src.slice(cursor);
  if (href !== null) anchorText += tail;
  else buf += tail;
  flushText();
  if (href !== null) {
    const label = decodeEntities(anchorText).replace(/\s+/g, " ").trim();
    if (label) para.push({ t: "link", href, v: label });
  }
  endPara();

  // Bound the result by total characters as well as paragraph count, and cut
  // INSIDE a paragraph rather than only between them — a feed that pastes a
  // transcript into <content:encoded> can put the whole thing in one <p>, which
  // a paragraph-count cap would wave through.
  const out = [];
  let budget = NOTES_MAX_CHARS;
  for (const p of paragraphs) {
    if (out.length >= NOTES_MAX_PARAGRAPHS || budget <= 0) break;
    const kept = [];
    for (const tok of p) {
      if (budget <= 0) break;
      if (tok.v.length <= budget) { kept.push(tok); budget -= tok.v.length; continue; }
      // A link is kept whole or not at all: half a label under a full href is
      // worse than dropping it.
      if (tok.t === "text") kept.push({ t: "text", v: `${tok.v.slice(0, budget)}…` });
      budget = 0;
    }
    if (kept.length) out.push(kept);
  }
  return out;
}
