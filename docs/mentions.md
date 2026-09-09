# @Mentions In The Composers

The design record for the people lookup in every note editor on the site.
**Built 2026-09-09**, Reed's ask: type `@` and a name in any composer, pick a
person from a menu ranked by followers, and publish a note that carries the
mention in the form other clients render.

| | |
|---|---|
| The lookup and the pure helpers | `assets/js/mention-search.js`, dependency-free, imported by the site's composers and inlined into the widget build |
| The menu on a plain textarea | `assets/js/mention-picker.js` (`attachMentionPicker`), the reply box, the zap message and the share modal |
| The menu in the boost modal | `login-widget/src/components/MentionAutocomplete.jsx`, over a controlled React field |
| The styles | the `.ob-mention-*` block at the foot of `assets/css/boost-actions.css`; the widget's menu is Tailwind on the modal tokens |
| The test | `node scripts/test-mentions.mjs` |
| The reference client | mynostr's `MentionAutocomplete.jsx` and `primal.js`, the shape this follows |

## The Four Composers

Every place a reader types text that becomes a Nostr event has the menu:

| Composer | File | What the mention reaches |
|---|---|---|
| The boost modal's message | `ExternalBoostModal.jsx` | the boost note's `💬 "…"` line, the boostagram TLV, the LNURL comment |
| The reply box under a boost note | `boost-actions.js#toggleReplyComposer` | the kind-1 reply |
| The zap message | `boost-actions.js#buildZapModal` | the kind-9734 zap request's content |
| The share modal's text | `hpw-share.js` | the kind-1 board share |

The bug-report modal is deliberately left out. Its text goes to the bug relay
and a GitHub issue, where a mention has no meaning.

## The Note Carries `nostr:npub1…`

**Reed's rule, and the reason the feature exists in this shape:** whatever the
editor shows, the published text contains `nostr:npub1…`, never `@npub1…` and
never the label. That is the form NIP-27 specifies; it is what Helipad prints
as a mention, what every Nostr client resolves to a name, and what this site's
own `nostr-text.js` links when the collector's `msg` field comes back around.

The editor shows `@reed`. A 63-character bech32 string in a 300-byte
message is unreadable, so the field holds a label and a per-composer map
(`createMentionMap`) holds the pubkey behind it. `expand()` is the note: it
replaces every registered `@label` with the URI, longest label first and
whole-token only (so `@reed` cannot eat `@reedbtc`), and then normalises
anything the typist pasted by hand: `@npub1…` and a bare `npub1…` become
`nostr:npub1…` when the checksum holds, an npub inside a URL is left alone, and
an existing `nostr:` URI is untouched.

**Every publish reads the picker, never the field.** `mentions.expand()` in the
three plain composers; `expandedMessage` in the boost modal, which is the only
form of the message anything below the field reads: the TLV, the note template,
the presign, the retry and the counter. `test-mentions.mjs` holds each of those
call sites by text scan, because the failure is silent: a note that says
`@reed` publishes fine and simply mentions nobody.

Two people with one handle get distinct labels (`reed` and `reed_abcd`, four
characters of the second npub). One person always gets the same label back.

## Ranked By Followers

The lookup is Primal's `user_search` on `cache1.primal.net`, the same cache
`primal-profiles.js` resolves missing names against. One round trip answers
both halves: the kind-0 profiles and a synthetic kind 10000133 whose content is
`{ pubkey: followerCount }` for every result. Measured 2026-09-09: ten profiles
and their counts in ~800ms cold, ~380ms on the open socket, a miss in ~140ms.
No second `user_infos` call, which mynostr makes and does not need.

**The order is followers, descending.** Reed's ask: a typeahead's job is to
guess who was meant, and the account with 2,233 followers is the one the
typist has heard of. Primal's own order is close to that but undocumented, so
it is only the tiebreak. A result with no count sorts last. The menu shows
eight.

The socket is a singleton with a thirty-second idle close, since a query per
keystroke through a fresh handshake spends the whole latency budget on TLS.
Identical in-flight queries share one promise: Primal answers a duplicate REQ
on the same socket with an empty EOSE. A dead cache is an empty menu, never a
broken composer.

## The Trigger

`@` opens the menu only at the start of the text or after whitespace or an
opening bracket or quote, so `reed@nostrplebs.com` never does. The lead-in
ends at whitespace or a second `@`, is at most forty characters, and is read
at the caret, not the end of the text. Results are requested 250ms after the
last keystroke and a late answer to a lead-in the typist has left is dropped.

Keys while the menu is open: ↑ ↓ move, Enter or Tab pick, Escape closes and
stays closed for that lead-in. A pointer pick is on mousedown with the default
prevented, so the field never blurs. Everything else falls through to the
field. A pick replaces the lead-in with `@label` and one space, and puts the
caret after the space.

## The `p` Tags

NIP-27 has a note tag every person it mentions, so their client can notify
them. **Which composers do:**

| Composer | `p` tags for mentions | Why |
|---|---|---|
| Reply | yes, deduplicated against the thread's own `p` tags | the donor's key signs |
| Share modal | yes, after the `imeta` | the donor's key signs |
| Boost note, donor route | yes, `mentionPubkeys` on both builders | the donor's key signs |
| Boost note, bot route | **no** | see below |
| Zap request | **no** | NIP-57 reads a zap request's single `p` as the recipient; a second one is a malformed request to every validator |

**⚠️ THE BOT ROUTE CARRIES NO `p` TAG, AND THE ORACLE ENFORCES IT.**
`functions/api/sign-boost.js` refuses `p` by omission from its allowlist: a note
that mentions strangers under an identity carrying the site's NIP-05 is the
harassment vehicle the allowlist exists to close, and nothing about a signed-out
boost changes that argument. So `buildExternalNoteTemplate` and
`buildDonationNoteTemplate` take `mentionPubkeys` as an **opt-in** that
defaults to empty, the modal passes the list on the donor route alone
(`noteRoute === 'donor'`), and `test-mentions.mjs` pins both halves: the
default template still validates, and a template carrying a mention `p` tag is
refused with `unsupported tag`. On the bot route the mention still rides in
the text and still renders as one in every client; it notifies nobody.

## The Cap Is Measured On The Wire

`MAX_MESSAGE_BYTES` is 300 bytes of UTF-8 (measured against the Lightning
onion on 2026-09-09; *The Boostagram Message Cap* in `docs/money-paths.md`),
and an expanded mention is 69 of them (`nostr:` plus the npub). The field's
own character count is not the number that matters, so the boost modal's
counter reads the expanded length in bytes, `onChange` refuses an edit whose
expansion would not fit (a deletion
is always accepted), and a pick that would not fit is declined with a line
under the field rather than inserted and cut, since a mention truncated
mid-npub names nobody. The `maxLength` attribute came off the textarea with
this; it measured the wrong string.

Two mentions in one boost message leave 162 bytes for words. That is the cost
of the onion, not of this feature, and it is the same cost every other client
pays.

## What Is Deliberately Not Built

- **Docking the menu above a phone's soft keyboard.** mynostr does this with
  `visualViewport` and a portal. Here the menu hangs under the field, which
  the keyboard can cover on a short screen. Wanted the first time somebody
  reports it, not before.
- **Styling the label in the field.** The textarea shows `@reed` in plain
  text. A highlighted token needs a contenteditable or a mirror overlay
  (mynostr's `EditorMirror`), and neither is worth its weight for a
  three-line message.
- **Mentions in the bug-report modal.** See above.
- **Resolving a label back to a name after publish.** Not needed: the
  published text is the URI, and every surface that renders it already
  resolves names through `primal-profiles.js`.
