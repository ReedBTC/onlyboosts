// Server-side pieces shared by the two edge-rendered detail pages,
// functions/show/[guid].js and functions/episode/[guid].js.
//
// Underscore-prefixed → not routed, only imported. Same arrangement as
// functions/api/v1/_common.js.
//
// The show page was written first and every one of these came out of it
// unchanged; this is a move, not a rewrite. What lives here is what a page about
// a SHOW and a page about an EPISODE do identically: escaping, the number and
// date formats on the stat tiles, the bech32 decoder that turns a `nostr:` URI
// inside a boost message into an @Name chip, the wall of booster avatars, and
// the list of boosts at the foot.
//
// What deliberately does NOT live here is the nav and footer markup. Those are
// generated into each page file between NAV:START / NAV:END markers by
// scripts/sync-partials.js, which carries an EDGE_PAGES list — a shared module
// would put the markup one indirection away from the script that owns it.

export function htmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function jsonForScript(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
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

export function num(n) {
  return Number(n || 0).toLocaleString("en-US");
}

// Compact sats for the stat tiles: 45,045,439 reads worse than 45.0M at a
// glance, and the exact figure is in the title attribute.
export function compact(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1e4) return Math.round(v / 1e3) + "k";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
}

export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function isoDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function relTime(ts) {
  const sec = Math.floor(Date.now() / 1000) - Number(ts || 0);
  if (!Number.isFinite(sec) || sec < 0) return "";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`;
  return fmtDate(ts);
}

export function fmtDuration(sec) {
  const s = Number(sec || 0);
  if (!s || s < 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

// A booster with no kind-0 gets their npub, shortened. `booster.npub` is
// nullable where the pubkey is not, so fall back to hex.
export function shortId(npub, pk) {
  const s = npub || pk || "";
  if (s.length < 16) return s;
  return s.slice(0, 10) + "…" + s.slice(-4);
}

export function displayName(r) {
  return r.display_name || r.pr_dname || r.name || r.pr_name || null;
}

// ── nostr: URIs in boost messages ────────────────────────────────────────────
//
// The two client feeds render mentions through boosts-thread.js#parseSegments,
// which decodes with nostr-tools and paints an @Name chip. These pages cannot:
// importing that module would mean shipping boosts-thread.js (30KB),
// calendar-events.js (24KB) and nostr-tools (102KB) to a page whose stated
// design is that it reads with no JavaScript at all. So the same job is done
// server-side, and the output is deliberately the same `.nostr-mention` chip
// so the surfaces look identical.
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

/* Display names for any npub mentioned inside a boost message.
 *
 * One extra query, and only when a message actually carries a mention — most
 * don't. A mentioned npub need not be a booster, so a miss here is normal and
 * the chip falls back to a truncated identifier.
 *
 * Placeholders rather than json_each: both callers show a couple of dozen
 * boosts, so this list is tiny and always far inside D1's 100-bound-parameter
 * ceiling. The follows endpoint needs json_each because its author list runs to
 * thousands; here it would only add a dependency on a table-valued function
 * Cloudflare does not document. Sliced anyway, so a pathological message can't
 * blow the limit.
 */
export async function lookupMentionNames(env, messages) {
  const names = new Map();
  const mentioned = mentionedPubkeys(messages).slice(0, 90);
  if (!mentioned.length) return names;
  const rows = await env.DB.prepare(
    `SELECT pubkey, name, display_name FROM profiles
     WHERE pubkey IN (${mentioned.map(() => "?").join(",")})`
  ).bind(...mentioned).all();
  for (const p of rows.results || []) {
    const n = p.display_name || p.name;
    if (n) names.set(p.pubkey, n);
  }
  return names;
}

// A boost message as HTML: nostr: URIs become @Name chips, bare URLs become
// links, everything else is escaped text. Mirrors buildMentionEl() in
// boosts-thread.js, including the .nostr-mention class and the njump target.
export function renderMessage(text, names) {
  const src = truncate(String(text || ""), 420);
  const spans = [];
  for (const m of src.matchAll(NOSTR_URI_RE)) spans.push({ start: m.index, end: m.index + m[0].length, id: m[1], value: m[0], kind: "nostr" });
  for (const m of src.matchAll(URL_RE)) {
    if (spans.some((s) => m.index >= s.start && m.index < s.end)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, id: m[0], kind: "url" });
  }
  spans.sort((a, b) => a.start - b.start);

  let out = "", cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    out += htmlEscape(src.slice(cursor, s.start));
    cursor = s.end;
    if (s.kind === "url") {
      out += isSafeUrl(s.id)
        ? `<a href="${htmlEscape(s.id)}" target="_blank" rel="noopener noreferrer">${htmlEscape(truncate(s.id, 60))}</a>`
        : htmlEscape(s.id);
      continue;
    }
    // An identifier that fails its checksum is left as plain text rather than
    // linked. It would only ever open an empty njump tab, and it is also how
    // the one tokenizing edge case resolves itself: bech32's charset includes
    // `n`, so two mentions run together with no space ("…ckn ostr:npub1…")
    // greedily match one character too many. That over-long capture fails the
    // checksum, so it degrades to text instead of pointing at the wrong person.
    if (!bech32ToBytes(s.id)) { out += htmlEscape(s.value ?? s.id); continue; }
    const pk = pubkeyFromBech32(s.id);
    const name = pk ? names.get(pk) : null;
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

// ── The Nostr Community wall ─────────────────────────────────────────────────
//
// LB's supporters.html is the visual ancestor (circular avatars, name beneath,
// click-to-copy npub), but its TIER system is deliberately not carried over: LB
// bucketed by absolute lifetime sats (100k / 69k / 21k), which works across one
// show's whole audience and collapses per show. The median show here has one
// booster and only 209 of 1,384 have five or more, so absolute thresholds would
// file nearly everyone in the bottom tier. Relative standing replaces it: a
// podium for the top five, then a ranked grid.
//
// "Nostr Community" rather than "Supporters", and the distinction is the point.
// "Supporters" is a claim about who supports the show, and the wall cannot make
// it: a show with two hundred keysend supporters and three Nostr boosters would
// read as having three supporters. "Community" names the group this page can
// actually see, and the qualifier says which group that is. The count noun
// elsewhere stays "booster", because a person is a booster and only the set of
// them is a community. See the site-wide vocabulary note in CLAUDE.md.
//
// NO COUNT BADGE on the heading. It read as a size claim about the subject's
// community where it is a count of who published a boost to Nostr, and the
// sub-line under it already names the set precisely.

// How many boosters paint above the fold. The rest render behind a toggle
// rather than being dropped — a community wall that hides people is worse than
// a long page.
//
// PODIUM is the top row of larger cards. Five rather than three: the wall sits
// in a 60rem column, which fits five 9rem cards across with room to spare, so
// three left the row looking sparse against the grid beneath it. VISIBLE counts
// the podium, so the grid under it holds SUPPORTERS_VISIBLE - PODIUM.
export const SUPPORTERS_VISIBLE = 21;
export const PODIUM = 5;

// The class name, the data attribute and every `.sup-*` selector keep the
// "supporter" spelling on purpose. The rename to "community" was a SURFACE
// rename — the same seam as Podcasts → Episodes. See CLAUDE.md.
export function renderSupporters(rows, { sub, empty }) {
  if (!rows.length) {
    return `<section class="show-section" id="community">
      <h2>Nostr Community</h2>
      <p class="show-empty">${htmlEscape(empty)}</p>
    </section>`;
  }

  const podium = rows.slice(0, PODIUM);
  const rest = rows.slice(PODIUM);
  const hidden = Math.max(0, rest.length - (SUPPORTERS_VISIBLE - PODIUM));

  return `<section class="show-section" id="community">
    <div class="show-section-head">
      <h2>Nostr Community</h2>
      <p class="show-section-sub">${sub}</p>
    </div>

    <ol class="sup-podium">
      ${podium.map((r) => supporterCard(r, true)).join("\n      ")}
    </ol>

    ${rest.length ? `<ol class="sup-grid" data-supporter-grid>
      ${rest.map((r, i) => supporterCard(r, false, i >= SUPPORTERS_VISIBLE - PODIUM)).join("\n      ")}
    </ol>` : ""}

    ${hidden > 0 ? `<button type="button" class="btn btn-quiet show-more" data-show-more="supporter">
      Show ${num(hidden)} more booster${hidden === 1 ? "" : "s"}
    </button>` : ""}
  </section>`;
}

// No rank number. The wall is ordered by sats, so position already says
// standing, and a numeral on every avatar turned a community into a scoreboard.
// The podium's larger avatars are what mark the top of the order now.
function supporterCard(r, isPodium, hidden = false) {
  const name = displayName(r);
  const label = name || shortId(r.booster_npub, r.booster_pubkey);
  const pic = isSafeUrl(r.picture) ? r.picture : null;
  // npub is nullable where the pubkey is not; the copy button falls back to hex
  // so the control is never dead.
  const copyVal = r.booster_npub || r.booster_pubkey;

  // What the index couldn't supply is declared for the client to fill from
  // Primal (detail-page.js#hydrateProfiles). Nothing here waits on that: the
  // card is complete and readable as rendered, and a visitor with no JavaScript
  // keeps the shortened npub and the blank circle.
  const missing = [name ? null : "name", pic ? null : "pic"].filter(Boolean).join(" ");

  return `<li class="sup-card${isPodium ? " sup-card--podium" : ""}"${hidden ? " hidden data-overflow" : ""}${
        missing ? ` data-pk="${htmlEscape(r.booster_pubkey)}" data-missing="${missing}"` : ""}>
        <button type="button" class="sup-avatar${pic ? "" : " is-blank"}" data-copy-npub="${htmlEscape(copyVal)}" title="Copy npub" aria-label="Copy npub for ${htmlEscape(label)}">
          ${pic ? `<img src="${htmlEscape(pic)}" alt="" loading="lazy" />` : ""}
        </button>
        <span class="sup-name" title="${htmlEscape(label)}">${htmlEscape(label)}</span>
        <span class="sup-sats" title="${htmlEscape(num(r.sats))} sats across ${htmlEscape(num(r.boosts))} boosts">${htmlEscape(compact(r.sats))} sats</span>
      </li>`;
}

// ── The boost list ───────────────────────────────────────────────────────────
//
// NOT filtered to feed-level boosts on the show page, and that is the considered
// choice. Only 18% of qualifying shows have even one feed-level boost over six
// months and only 5% have three; UNGOVERNABLE, Citadel Dispatch and What Bitcoin
// Did would each show an empty section despite carrying 130+ boosts apiece.
// Whether a show accumulates them is an artifact of how listeners' apps build a
// boost, not a fact about the show. See docs/show-pages-spec.md.
//
// `target` is the "→ Ep. 3 · Title" line naming what a boost was sent to. It is
// the show page's: on an episode page every boost in the list targets the same
// episode the reader is already on, so the line would repeat the <h1> once per
// row. Pass `showTarget: false` there.
export function renderBoosts(rows, names, { heading, sub, itemAbbr, noun, showTarget = true }) {
  if (!rows.length) return "";

  return `<section class="show-section" id="boosts">
    <div class="show-section-head">
      <h2>${htmlEscape(heading)}</h2>
      <p class="show-section-sub">${htmlEscape(sub)}</p>
    </div>
    <ul class="boost-list">
      ${rows.map((r) => boostRow(r, names, { itemAbbr, noun, showTarget })).join("\n      ")}
    </ul>
  </section>`;
}

function boostRow(r, names, { itemAbbr, noun, showTarget }) {
  const realName = displayName(r);
  const name = realName || shortId(r.booster_npub, r.booster_pubkey);
  const pic = isSafeUrl(r.pr_pic) ? r.pr_pic : null;
  const copyVal = r.booster_npub || r.booster_pubkey;
  const missing = [realName ? null : "name", pic ? null : "pic"].filter(Boolean).join(" ");
  const target = r.e_title
    ? (r.e_num ? `${itemAbbr} ${htmlEscape(r.e_num)} · ${htmlEscape(truncate(r.e_title, 70))}` : htmlEscape(truncate(r.e_title, 70)))
    : `the ${noun}`;

  return `<li class="boost-row"${missing ? ` data-pk="${htmlEscape(r.booster_pubkey)}" data-missing="${missing}"` : ""}>
        <button type="button" class="sup-avatar sup-avatar--sm${pic ? "" : " is-blank"}" data-copy-npub="${htmlEscape(copyVal)}" title="Copy npub" aria-label="Copy npub for ${htmlEscape(name)}">
          ${pic ? `<img src="${htmlEscape(pic)}" alt="" loading="lazy" />` : ""}
        </button>
        <div class="boost-body">
          <p class="boost-meta">
            <span class="boost-who">${htmlEscape(name)}</span>
            <span class="boost-amt">${htmlEscape(num(r.sats))} sats</span>
            <span class="boost-when">${htmlEscape(relTime(r.created_at))}</span>
          </p>
          ${r.message ? `<p class="boost-msg">${renderMessage(r.message, names)}</p>` : ""}
          ${showTarget ? `<p class="boost-target">→ ${target}</p>` : ""}
        </div>
      </li>`;
}
