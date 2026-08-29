# Money Paths

*Split out of `CLAUDE.md` on 2026-08-29, when that file passed its size budget.
This is the authority for the subject; `CLAUDE.md` keeps the rules a change would
break and points here for the arguments and the measurements. Nothing was rewritten
on the way across — `git log -S <symbol> -- CLAUDE.md` still finds any paragraph
that used to live there.*

---

### A Lightning Address With No CORS Headers Cannot Be Paid From A Browser

Both LNURL hops run in the page, and a cross-origin response carrying no
`Access-Control-Allow-Origin` is unreadable to JavaScript however healthy the
server is. **The leg therefore dies before an invoice is ever requested**, and it
surfaces as a generic fetch failure indistinguishable from the host being down:
the browser sends the request and then refuses to hand us the answer, so nothing
upstream logs anything either.

**⚠️ EVERY PROVIDER THIS SITE HAD MEASURED SENDS `*`, WHICH IS WHY IT WENT
UNSEEN.** getalby.com and fountain.fm carry 58 of the 63 lightning-address legs
across the top thirty shows. A **self-hosted** address generally sends nothing.
Measured 2026-08-21 on `spencer@bowlafterbowl.com`, 44% of that show's value
block: the metadata document, the keysend document and the invoice callback all
answer 200 with no access-control headers at all. Bowl After Bowl could not be
boosted from this site.

`functions/api/lnurl.js` is the way out and is a **fallback, not the route**.
Every leg still tries the recipient's own server first, so a host that works
today never touches our edge and a Pages outage cannot take down a boost path
that never needed us; verified, a working host makes two direct calls and zero
proxied ones. Four rules hold it together:

- **⚠️ It accepts a lightning address and NEVER a URL**, so a caller cannot steer
  the outbound fetch. The callback the recipient's own metadata returns is held
  to the same host rule the client applies (`CALLBACK_HOST_ALLOWLIST`), which is
  restated in the Function because a Pages Function cannot import from
  `login-widget/src`. **The two copies must stay in step.**
- **An upstream error is mirrored, not replaced.** `readErrorReason` prints the
  recipient's own explanation, which is often the only account a donor gets of
  why a leg failed; answering with our own wording would delete it.
- **A served 4xx is never retried through the proxy.** The server understood and
  refused, and asking again through our edge gets the same refusal.
- **The client remembers which hosts proved unreadable**, per session and never
  persisted. The metadata hop is prefetched on mount, but the invoice hop happens
  with the donor watching, and `fetchJsonCapped` retries once with a 1.2s
  backoff, so a doomed direct attempt costs a visible ~2.5s per leg.

It is excluded from every service-worker cache; see the money-endpoint note
under **What The Service Worker Caches**.

**The invoice must demand what the leg asked for**, and nothing checked this
before, on either path. The split decides a leg's share and the wallet pays
whatever the bolt11 says, so a server answering with a larger figure spent the
donor's sats with nothing here noticing. `bolt11AmountMsats` reads the amount out
of the human-readable part; **an unreadable amount is allowed through**, because
the check exists to catch a mismatch and refusing an encoding nobody anticipated
would break a working payment.

`FEED_GUID` in `boostagram.js` is deliberately `null` — OnlyBoosts is a client,
not a podcast, so it has no feed to claim. Inheriting LB's GUID would have
mis-tagged every share note as a Local Bitcoiners boost and polluted LB's own
collector, which filters on exactly that GUID.

Code edits, dry runs, and read-only inspection are fine without asking.
**Confirm with Reed before running anything that signs or publishes a Nostr
event, or that moves sats.** Published events can't be unpublished. **New bots
start with `DRY_RUN = True`.**

### ⚠️ A Payment We Cannot Confirm Is Not A Payment That Failed

**LUD-21 has no negative signal.** `settled: false` means *not settled at the
moment I asked*; an invoice still in flight and an invoice that will never land
answer byte-identically. `confirmInvoiceSettled` in `boostagram.js` therefore
returns **`'settled'` or `'unknown'` and nothing else**, and its two callers
(`externalBoost.js`, `payAllLegs.js`) may never derive a failure from it.

**This cost a recipient a double payment on 2026-08-19.** The function used to
return `'unsettled'` whenever the verify endpoint answered at least once, over a
poll window of **4 attempts 1500ms apart, so 4.5 seconds**. A leg to
`chadf@getalby.com` settled after that window closed, was reported FAILED with
"your wallet wasn't charged", was re-paid by the donor on that advice, and the
recipient received the money twice. Both attempts settled and both were reported
failed, because the inference was deterministic rather than a race.

**FAILED and UNCERTAIN are now different claims, and only one of them may be
re-paid.**

| | Means | Button |
|---|---|---|
| `FAILED` | the wallet never sent it: a pre-payment error, or a clean decline (`isCleanDecline`) | **Retry**, which re-pays |
| `UNCERTAIN` | an invoice was handed over and no settlement was observed | **Check again**, which only re-polls |
| `PAID` | a preimage, or verify said settled | — |

**⚠️ THERE IS NO RE-PAY PATH OUT OF UNCERTAIN, ANYWHERE, AND THAT IS DELIBERATE**
(Reed's call, 2026-08-19). `handleRetry` used to fall through to a re-pay on
`'unsettled'` with the comment "safe to re-pay"; it was not. A donor whose leg
genuinely did not land boosts again from the top, which is one deliberate act
rather than a button that quietly risks their money. `canRepayLeg` and
`canCheckLeg` in `ExternalBoostModal.jsx` are the split.

**The 90-second watcher is the other half.** Waiting 4.5s inline is right, since
the leg loop is sequential and a donor should not watch a spinner; so every
unconfirmed lnaddress leg keeps being polled *after* the run, to a **90s**
wall-clock budget (`WATCH_MS`, 3s interval), and flips itself to Paid if it
lands late. A donor-pressed re-check runs 30s (`RECHECK_MS`). Most unconfirmed
legs resolve with no decision from anybody, which is the point: the bug was a
screen asking the donor to decide on bad information. `deadlineMs` and `signal`
on `confirmInvoiceSettled` exist for this.

**Two consequences for the share note**, both from the same rule that the note
is a *final statement*: Share is **withheld while any leg is still being
checked**, and once the note is published every row's button **goes inert**,
because a leg that changed afterwards could not be reflected in an event that
cannot be edited.

The one true negative signal is bolt11 expiry, which provably ends an invoice.
LNURL invoices typically live an hour, far too long to hold a modal open for, so
it is not used. Do not reintroduce a shorter inference in its place.

### What A Recipient's Server Says Is Shown To The Donor

`fetchJsonCappedOnce` threw `Request failed (${status})` and discarded the
response body. Measured on a real leg, 2026-08-19:
`intuitiveocelot66@zeuspay.com` answered the invoice request **HTTP 400** with
`{"success":false,"error":"Zaplocker payments are temporarily disabled. Check
back later."}`. The donor was shown `Request failed (400)` and pressed Retry
four times against a server that had already explained itself in plain English.

`readErrorReason` now reads that body, through the same bounded reader as any
other third-party response, and the leg prints **"Their Lightning provider said:
…"**. Three shapes, because LUD-06's `reason` is not what everyone sends:
`{status:'ERROR',reason}`, `{error}`, `{message}`. Capped at 2KB of body and 180
characters of message, control characters stripped; React escapes it at render.

**⚠️ A reason from the recipient's server is used VERBATIM and never passed
through `friendlyError`.** That function rewrites on keywords, so a provider
whose message happens to contain *declined* or *expired* would be reported to
the donor as **their own wallet** declining. That is a lie about whose fault it
is, and it sends them to check the wrong thing.

**A 4xx is never retried.** The server understood and refused; asking again
1.2s later gets the same answer and only delays the donor's first sight of the
reason. 5xx and network faults still get the retry.

**⚠️ ZEUS PAY ADDRESSES USE HODL INVOICES, AND THEY ARE THE CASE THE UNCERTAIN
RULE EXISTS FOR.** That endpoint's own metadata reads *"Hodl invoice will settle
when user comes online within 24hrs or you'll be refunded."* So a payment there
is **accepted and held**, not settled — LUD-21 will answer `settled: false` for
up to a day, and the payer's wallet may report a timeout. Under the pre-2026-08-19
code that is a guaranteed double payment: reported FAILED, offered a re-pay,
paid again, and both eventually settle. Under the current rule it is UNCERTAIN,
the 90s watcher gives up, and the only offer is **Check again**. Any
hodl-invoice recipient behaves this way **by design**, so this is a recurring
case and not an edge one.

### Waiting Is Not The Same Event As Giving Up

The unconfirmed-leg screen said both at once. A leg that returned no preimage
arrived carrying *"Don't re-send; it may already be on its way"* the instant the
pay run ended, under a heading reading *"Still checking the rest — don't re-send
them"*, in warning amber, and held that unchanged for the whole 90-second watch.
Every word was true. **Observed on a real boost on 2026-08-19**, a leg to a slow
provider settled after about a minute and the wait was the only part of the
boost that felt broken: it read as a fault, and as a *stuck* fault.

**⚠️ A SCREEN THAT CANNOT BE HURRIED AND NEVER CHANGES IS INDISTINGUISHABLE
FROM ONE THAT HAS STOPPED WORKING.** So the copy moves even though the state
does not. `CHECK_STAGES` in `ExternalBoostModal.jsx` escalates at 0, 15, 35 and
60 seconds, in patience rather than in alarm, and one line under the list
carries it however many legs are in flight.

**⚠️ THE LONGEST WAIT IS BEFORE THE WATCHER EVER STARTS, so `PAY_STAGES` is the
same ladder one state earlier.** Measured on a second real boost the same day,
four legs through one WebLN extension: `chadf@getalby.com` spent **45.5 seconds
inside the wallet's own `sendPayment`** while its siblings answered in 2.3s and
0.4s. The hang is in the wallet, and nothing here can hurry it, shorten it or
see progress inside it. `PAY_STAGES` times the paying leg from a `startedAt`
stamped in `externalBoost.js` where the wait actually is, at the moment the
wallet is handed the invoice; legs are sequential, so there is at most one. **Its
first stage is deliberately silent**, a normal leg paying in one to four seconds
and a reassurance that flashes up and vanishes making a fast boost look
eventful.

**⚠️ DO NOT SHORTEN THE WALLET ADAPTERS' TIMEOUTS TO MAKE THIS TIDIER** (90s for
WebLN, ~60s inside NWC's SDK). That leg took 45.5 seconds and then paid; a
tighter bound would have turned a successful payment into an UNCERTAIN one.

**The warning belongs at the end of the watch, not during it.** While the
watcher runs the donor has no decision to make, since an unconfirmed leg is
never offered a re-pay; when the watcher gives up, a decision arrives and the
give-up text it writes is where "check your wallet rather than re-sending"
lives. What the waiting copy must keep carrying is that **the sats may already
be moving**, because the double-pay risk on this screen was never a button. It
is a donor who closes the modal and boosts the episode again.

Three consequences a change would undo: a row suppresses its own message while
it is being watched, that message being the give-up message; the summary line
takes the sending phase's orange rather than a shortfall's amber while checking,
so the screen reads as continuous with the phase before it; and the escalating
line renders for **every** donor rather than only one who can share, an
anonymous booster being sat in front of the same spinner.

`externalBoost.js`'s UNCERTAIN string is the leg's **resting** message, not its
waiting message, and must not claim that checking is under way. What it serves
is the leg nothing is watching: a keysend, or a provider that returned no
verify URL.

### The Share Note Reports What Settled

A boost distributes across a value block and **any leg of it can fail**, so what
the donor typed and what recipients received are different numbers on every
partial. `buildExternalNoteTemplate` therefore takes `paidSats`, never the form
amount, and its `amount` tag carries the same figure. **⚠️ That tag is what this
site's own collector reads**, so an overstated note is not merely a wrong claim
on someone's feed; it is a wrong row in this index. It shipped that way until
2026-08-19.

**⚠️ THE INTENT IS DECLARED IN THE FORM AND THE FIGURES ARE NOT, and holding
those two apart is what keeps this honest.** This rule read "the share is a VERB
pressed on the done screen, not a checkbox ticked before paying" until Phase 2
shipped on 2026-08-21, and the half of it that was load-bearing is untouched:
**the settled total is unknown until every leg has run *and* the donor has
finished retrying**, an event cannot be edited, and a note published when the
first pass ends can never reflect a successful retry. So the figures are still
recomputed from live leg state at the moment of publishing, and the screen still
names the number the note will carry before it is signed.

What moved into the form is the **choice**: whether a note is posted at all, and
whose identity signs it. That is a decision about the donor rather than about
the outcome, and the done screen is the wrong place to ask it — see *The Boost
Modal Declares What Happens To The Note* below. **A pre-flight control over the
FIGURES is still the bug it always was**; a pre-flight control over the
*intent* is not the same object.

`legsTotal` **excludes SKIPPED legs**: a leg allocated zero sats by the split
was never attempted, and counting it would report a shortfall that never
happened. Where `legsPaid < legsTotal` the note adds one line, `⚠️ 2 of 3 splits
paid` — *splits* rather than *legs*, being the word the value spec and the
podcast apps use, and this line is read outside this codebase.

**⚠️ ONE BOOST PUBLISHES AT MOST ONE NOTE.** `shareState` latches at `shared`,
and a retry that lands afterwards does not republish. Two notes for one payment
would be two rows in the index, which is the same double-count the
OnlyBoosts-signs-it path has to avoid by never being offered alongside a
donor-signed note.

Withheld entirely when nothing paid, and **withheld entirely on an anonymous
boost** rather than shown disabled: signing with the donor's own npub would undo
the anonymity they chose one field up. A signed-out booster is served by the
site-signed path instead; see below.

**⚠️ THE LB PATH THAT USED TO SIT BESIDE THIS IS GONE, AND THE CONTRAST IS
STILL WORTH KNOWING.** `MultiLegBoostForm` signed its kind-1 *before* paying,
batched into one signer approval with the receipts, so its content was frozen
before any outcome was known — safe there only because the one surface using it
was the site tip, a single leg at 100% that cannot partial. It was deleted on
2026-08-23 along with the rest of the LB strip, so **there is now exactly one
publishing design on this fork** and the rule above is unconditional: the
figures are recomputed from live leg state at the moment of publishing.
`git show 75f88ef` has the presign-then-publish version if it is ever wanted.

### The Login Is Not A Gate On The Wallet

A boost is a payment, and a payment needs no Nostr identity. `openExternalBoost`
therefore has **no Gate 1**: a visitor with no account connects a wallet and
boosts with it. The gates that remain are conditional on there *being* an
identity, and each still earns its place for a signed-in user; a stub cannot
unlock the encrypted NWC blob, and a signer that has switched accounts would
sign a payload claiming the wrong pubkey. They are skipped, never weakened.

**⚠️ A WALLET CONNECTED WITH NO LOGIN IS SESSION-ONLY, and that is structural.**
Both at-rest schemes are keyed to an identity: NWC stores the connection URI
encrypted to the user's own signer, and WebLN stores a per-pubkey enabled bit.
With no signer there is nothing to encrypt to, so the connection lives in memory
and dies with the page. **⚠️ Never "fix" this by writing a plaintext NWC URI to
localStorage** — that URI is a bearer credential with a spend budget.
`getStatus().sessionOnly` is how the UI says so, in the connect modal before the
paste and in the identity dropdown afterwards.

**⚠️ A session-only disconnect leaves the stored blob alone.** Any blob present
belongs to an account that is not signed in, and a signed-out visitor
disconnecting the wallet they pasted this page must not delete the saved wallet
of whoever uses this browser signed in. `nwc.disconnect()` reads the flag; the
same rule governs the WebLN wipe in `wallet.connectWebln`.

**The identity slot has a second logged-out form**: a wallet pill with the
dropdown behind it, because that wallet is real, spendable and theirs to
disconnect. A signed-out visitor with no wallet still gets the plain Sign in
pill.

**Signing in afterwards does not save the wallet retroactively.** Only the live
client is held, never the URI, so the dropdown offers **Reconnect to save it**
rather than a one-tap save that would fail silently. Keeping a session wallet
across a sign-in is safe on the same reasoning that makes it session-only: it
cannot survive a page load, so it cannot reach a different visitor.

**`boostAnonymously` in `ExternalBoostModal` is the single derivation the wire
sites read** (`sender_id` and `sender_name`, on the first pass and on a retry);
it is *not* the toggle, because the toggle alone would be right by accident.
Under a signed-in profile it is false; **off the profile, whether by pressing
Anon or by being signed out, the typed name decides it**, absent meaning
anonymous. **⚠️ It must not grow a second meaning** — whether a note publishes
and who signs it is `noteRoute` beside it, a separate derivation. BMB shipped
that promise broken twice by letting one expression carry both.

**The identity toggle is still withheld when there is no identity**, but what
replaced it is no longer a notice. That was right when both of the toggle's
buttons would have sent the same empty fields; a typed name is what gives the
signed-out case something to say. See *The Boost Modal Declares What Happens To
The Note*.

**⚠️ THE SITE TIP USED TO BE THE EXCEPTION AND IS NOT ANY MORE.**
`openShowBoost` → `BoostModal` → `MultiLegBoostForm` signed a kind-1 before
paying, so it needed a signer by construction — which meant the nav's Donate
button demanded a Nostr account long after the episode boosts stopped doing so.
It opens `openSiteDonation` instead, and the whole `openShowBoost` chain was
**deleted on 2026-08-23**, so the wrong call is no longer available to make.
`_ensureWalletForPay` (the merch checkout) keeps its gate.

### The Boost Modal Declares What Happens To The Note

**Two controls in the form, four outcomes, and one automatic publish.** Shipped
2026-08-21; `boost-login.md` D12 through D15 carry the arguments.

**⚠️ ANONYMOUS AND PRIVATE ARE DIFFERENT ANSWERS TO DIFFERENT QUESTIONS.**
**Anonymous** is about whose name is on the boost: not the donor's Nostr
account, and optionally a name they type instead. **Private** is about whether a
note exists at all. So **an anonymous boost is still published**, by OnlyBoosts,
with no npub attached, which is the whole point: an anonymous booster still
counts in the feeds and the totals.

| Boost as | Note box | What happens |
|---|---|---|
| Yourself | unchecked | the donor's own npub signs it, on their press |
| Anon, name typed | unchecked | OnlyBoosts signs it, the name is a line of the body, published by itself on a clean boost |
| Anon, no name | unchecked | OnlyBoosts signs it with no name; the booster this index credits is the bot |
| Either | **checked** | nothing is published from any key, and the done screen says so |

**Signed out there is no "yourself" row and everything else is identical.** That
is the whole difference the login makes here.

**`usingProfile` (`signedIn && !anonymous`) is the one question everything
hangs off**, and the two ways it can be false behave identically. Two
derivations stand beside each other and neither may absorb the other:
`boostAnonymously` is the **boostagram's** answer and governs `sender_name` and
`sender_id` only; `noteRoute` (`'donor' | 'bot' | 'none'`) is who signs.
BMB shipped that promise broken twice by letting one expression carry both.
`signKindOneWithSite` in `login-widget/src/lib/siteSign.js` is the only
difference between the two publishing routes: both produce a signed event and
both publish it from the browser through the same relay set.

**⚠️ `'none'` IS REACHABLE ONLY THROUGH THE CHECKBOX.** Anon routes to the bot;
it does not suppress. The version that shipped for a few hours on 2026-08-21 had
Anon fall through to no note at all, reasoning from the true premise that the
donor's own npub must not sign it. That conclusion quietly cost an anonymous
booster their place in the index, which is the opposite of what this project is
for. **Reed's correction, same day.**

**⚠️ THE TWO ATTRIBUTION ROUTES ARE EXCLUSIVE AND THE FORM SHOWS IT.** The name
field is rendered when `!usingProfile` — so a signed-in donor who presses Anon
gets it too, since their position is identical to a signed-out one's. It is
**absent rather than disabled** while the profile is in use: a typed name beside
a signed-in identity would be a second identity claim on one note.

**⚠️ `sender_id` NEVER RIDES WITHOUT THE PROFILE BEHIND IT.** Recipient
aggregators resolve that pubkey to an avatar and a name, so carrying it on an
Anon boost would undo the anonymity in the one place the donor cannot see it.
That is the exact leak BMB shipped, twice.

**⚠️ THE CHECKBOX SUPPRESSES THE NOTE AND NOTHING ELSE, so its label carries
its own scope**: *Boost privately (no Nostr note)*, never a bare *Boost
privately*. The sats and the message still cross Lightning to the show's own
app, which is the half the word "privately" does not cover.

**⚠️ THE DONOR'S SIGNATURE IS TAKEN AT THE PRESS, NOT AFTER THE PAYMENT.**
Auto-publishing at the end put an approval dialog on screen up to a minute after
the donor thought they were finished, with nothing having asked for it. So the
donor route now **pre-signs**: `presignNote` runs inside `startPay`, before the
first leg, and the two prompts arrive back to back the way a checkout does.

**⚠️ AND IT DOES NOT REOPEN THE PHASE 0 BUG, BECAUSE OF ONE IDENTITY.**
`distributeSats` floors every leg then hands the remainder back a sat at a time,
so **the legs it will attempt sum to exactly the typed amount** (a leg allocated
zero is skipped and contributes zero). A note signed in advance for the full
amount, with no shortfall line, is therefore precisely correct in exactly one
case: every attempted leg pays. **The publish step re-checks that identity —
`pre.sats === paidSats && pre.legs === activeCount` — and discards the
pre-signed note if it does not hold**, falling back to the button, which signs
fresh against live leg state. Change the rounding in `distributeSats` and that
check is what catches it, not this paragraph.

Nothing about pre-signing is allowed to be fatal: a declined prompt, a signer
timeout or a dismissed extension all leave `presignedRef` null, the boost
proceeds regardless, and the done screen offers the press. **A boost must never
fail because a note could not be signed.**

**⚠️ A CLEAN BOOST PUBLISHES ITS NOTE BY ITSELF, ON BOTH ROUTES.** The press
survived on the donor path for one day, on the argument that a signer prompt has
to be asked for. Reed's correction, 2026-08-21: *"shouldn't the opt-in to share
be enough?"* It is. **The ask now happens in the form**, one field above the
amount, and leaving the private box unchecked *is* the request; asking again
afterwards puts the same question twice and reads as the first answer not having
counted.

It fires only when every active leg is `PAID` and nothing is being checked. A
shortfall or an `UNCERTAIN` leg is exactly the state in which a retry could
still change what the note should say, so those render the button **with a line
saying why** — without it the button appears at random rather than as a
decision. The withhold-while-checking rule is untouched and `shareState` still
latches at `shared`, so **one boost still publishes at most one note**.

**⚠️ ON THE DONOR ROUTE THE WAITING COPY IS AN INSTRUCTION, NOT A STATUS**:
*Approve this in your signer to post it to Nostr…* It is reached only when the
pre-sign did not happen or its figures no longer hold, so nothing was pressed
and the prompt arrives with no obvious cause.

**The form's other three controls**, all 2026-08-21 and all Reed's calls: the
amount **ships empty** with four presets (420 / 2100 / 3333 / 6969) rather than
prefilled at 1000, which is a number nobody chose and a donor in a hurry sends
by accident; the note checkbox reads **Private Boost** / *Do not share to
Nostr*; and the `From` field carries **five password-manager opt-out
attributes**, because `autoComplete="off"` is not one — LastPass ignores it
outright and was offering to fill it, and several managers match on the token in
the `id` before they read anything else.

**⚠️ THE LOGIN CONTROL IS ONE COMPONENT IN TWO SKINS**, `LoginButton.jsx`:
`nav` on the navy bar and `checkout` inside the boost modal. A visitor meets it
in the nav and again inside the modal, and if those read as two different things
the second is a stranger asking for an account at the moment they are about to
spend money. **It says "Log in" and shows the site's favicon, never the word
Nostr** — the same vocabulary rule the `From` field and `Private Boost` follow.
In the modal it is the **express-checkout shape**, offered under a divider
*below* the name field: an alternative, not a gate, because the boost works
without ever pressing it and putting it first would make an account look
required.

**⚠️ `nav-widget-boot.js`'s STATIC PLACEHOLDER AND `LoginButton`'s NAV SKIN MUST
MATCH TO THE PIXEL.** The React button replaces that element in place once the
1MB bundle lands, so any drift is a visible jump on every page load. The
placeholder's mark, word, padding, radius and type size are all pinned to it in
`nav.css` with a note saying so.

**⚠️ THE NOTE OPENS WITH A BANNER, AND THE ORACLE PINS THE EXACT URL.**
`BOOST_BANNER_URL` in `externalBoostagram.js` is a bare image URL on line one,
which is what Nostr clients render inline, so it is the note's picture rather
than a link in it. `functions/api/sign-boost.js` restates it as its own constant
and accepts **two** openings and no others: the boost line, or that URL plus a
newline plus the boost line. **The lazy version tests `/^⚡Just boosted /m` and
lets anything precede it**, which hands a caller a free paragraph of arbitrary
text at the top of a note published under our identity — a far better vehicle
for abuse than the boost line under it. The two copies must move together;
`scripts/test-sign-boost.mjs` feeds the validator from the shipped builder and
fails if they drift. **It is deliberately not an `r` tag**: `r` is the episode's
URL, which is what a client and this index both read as what the note is about.

**⚠️ A BLANK "From" IS REPLACED, NOT OMITTED.** `DEFAULT_SENDER_NAME` is
`onlyboosts.social user`, and it fills the boostagram's `sender_name` only. An
empty one renders blank in one aggregator and "Unknown" in the next, so a boost
with nobody's name on it presents differently everywhere it lands; the default
makes it one consistent thing, and it names the **site** rather than a person,
so it discloses nothing the note's own author does not. Same call BMB makes.
**It reaches the note as well**, so every bot-signed note carries a `👤 From`
line whether or not anybody typed. That was scoped to the boostagram for a day
and the absence was the first thing Reed went looking for. Without it an
anonymous note is only the bot's own voice, which reads as *OnlyBoosts boosted
this* rather than *OnlyBoosts published this for somebody* — a different claim,
and the wrong one. It also keeps the note and the boostagram saying the same
string, which is what a podcaster can cross-check. The field is labelled `From`,
placeholders the default, and says *Left blank, boosts are sent as
"onlyboosts.social user"*.

**⚠️ THE TYPED NAME IS PROSE AND NOTHING ELSE** (`👤 From <name>`). It rides the
boostagram TLV, which is what the podcaster's Helipad reads, and it becomes one
line of the bot's own body. It must never become a `p` tag, an author claim or a
`proxy_for_pubkey`: nothing can verify that the person named authorised a note
signed by a key they do not hold. Same treatment the `chadf-boostbot` rows and
the LB show account get. `sanitizeSenderName` bounds it at 40 characters and
strips **newlines** (the body is read line by line) and the **mobile-phone
emoji** (`📱 via <App>` is the line `clients.py#_VIA_RE` fills `client_via`
from). `scripts/test-sign-boost.mjs` pins all of that against the shipped
builder.

**⚠️ SILENCE IS WHAT A FAILURE LOOKS LIKE**, so the suppressed case says out
loud that nothing was posted and that it was the donor's own choice. Without it
the screen a private boost ends on is identical to the screen a broken one would
end on. For the same reason **a failed sign is never allowed to read as a failed
boost**: the sats are gone before the note is attempted, so the offer is another
attempt at the note and never anything resembling unwinding a payment.

**⚠️ THE ORACLE'S AMOUNT CAP AND THE MODAL'S ARE THE SAME NUMBER, 5,000,000
SATS, AND KEEPING THEM EQUAL IS THE POINT.** They were 100k and 5M until
2026-08-21, so a large Anon or signed-out boost paid fine and could then not be
posted, with the endpoint's whole account of itself being `invalid amount`. The
100k figure rested on "above the cap the donor still has the donor-signed path",
and Anon routing here took that escape away. It was raised on Reed's call, on
the reasoning that **the index already accepts unauthenticated writes from the
whole of Nostr** — anyone may publish a fabricated boost note from a burner key
— so a cap changes what a fake looks like, never whether one is possible. What
contains this endpoint is D11's argument, not this number.

`SITE_SIGN_MAX_SATS` in `login-widget/src/lib/siteSign.js` restates
`MAX_AMOUNT_MSAT` in `functions/api/sign-boost.js`; a Function cannot import
from the widget source and the bundle cannot import from `functions/`, the same
split `CALLBACK_HOST_ALLOWLIST` lives with. **`scripts/test-sign-boost.mjs` is
what enforces the equality**, asserting that exactly that figure validates and
one msat more does not. Lower either copy and it fails.

### A Donation Is The Boost Flow With One Leg

**The nav's Donate button opens `ExternalBoostModal`**, driven by a synthetic
bundle of one `lnaddress` recipient at 100% to `RECIPIENT_LUD16`. A donor gets
everything a podcast boost gets: the wallet gate behind the press, the four note
outcomes, Anon, Private Boost, per-leg retry, the 90-second watcher, and the
site-signed note for someone with no account. Writing a parallel modal would
have meant two copies of a money path, and the copy exercised less is the one
that rots.

**⚠️ REACT OWNS THAT BUTTON, NOT `nav-widget-boot.js`.** The boot script's click
handler governs only the press before the bundle lands; `createRoot(boostEl)`
then mounts `BoostApp` over `#lb-boost-slot` and owns every press after. Wiring
the boot script alone left Donate opening the login modal while every file
anyone would grep said otherwise. `test-boost-modal-render.mjs` walks `BoostApp`
and asserts it calls `openSiteDonation` and never `openShowBoost`, whose Gate 1
was a bare `api.requestLogin()`. **That assertion is kept although
`openShowBoost` no longer exists**: it is cheap, and it is what would catch a
future re-introduction of a login-gated flow behind the Donate button.

**⚠️ A DONATION NOTE IS NOT A BOOST NOTE, AND DROPPING THE NIP-73 TAGS IS NOT
ENOUGH TO MAKE THAT TRUE.** `classify.py` sets `is_boost` from **either** a `t`
tag in `{boostagram, value4value, boost}` **or** a positive `amount` tag. So
`buildDonationNoteTemplate` emits `t=donation`, `t=onlyboosts`, `client` and
`r`, and **no `amount` tag at all** — the figure lives in the text. Sats paid to
OnlyBoosts are not a podcast boost and must never be counted as one, which is
the decision `FEED_GUID = null` already records. The outer guard is `scan.py`,
which REQs `{kinds:[1], "#k": BOOST_FILTER_K}`, so a note with no `k` tag is
never fetched; the tag rules are the inner one.

**⚠️ SO THE ORACLE HAS TWO TEMPLATE FAMILIES AND THEY ARE DISJOINT.**
`validateBoostTemplate` **requires** `t=boostagram`, `t=value4value` and exactly
one `amount` — precisely what a donation must not have — so neither family is
reachable by relaxing the other. `validateTemplate` routes on the opening line
with **no fallback between them**: trying both and accepting either would turn
two strict shapes into one loose one. A donation carries no `amount` tag to cap,
so its headline is matched **whole** and the figure read back out of it.
`t` is an allowed tag name there, so a boost topic smuggled onto a donation is
refused **explicitly** rather than by the allowlist.

**A consequence to state plainly: site donations appear in no feed, no total and
no stat.** That is deliberate. If they should ever be counted, it is a different
tag design and a different decision.

### Getting A Boost Into Helipad

Helipad reads three tiers, and **it never reads Nostr at all** — it polls an LND
node (`LND_URL`, `LND_ADMINMACAROON`, `LND_TLSCERT`). The kind-1 note and its
tags are invisible to it.

| Tier | Source | Our path |
|---|---|---|
| 1 | boostagram TLV 7629169 on the HTLC | keysend legs, **and every lnaddress leg the upgrade can reach** |
| 2 | `rss::payment::boost <url>` in the invoice memo → HEAD → `x-rss-payment` | the lnaddress legs it cannot, via `/api/boostbox` |
| 3 | the memo verbatim | the bare message, which is what shipped before |

`functions/api/boostbox.js` stores the metadata with BoostBox
(podcast-namespace PR #734) and `buildLnurlComment` puts the returned URL in the
LNURL comment.

**⚠️ TIER ONE IS PREFERRED WHEREVER IT IS REACHABLE, AND THE REASON IS NOT
PERFORMANCE.** `parse_boost_from_invoice` reads the TLV in its **first** branch,
before any memo or metadata handling, so a keysend needs nothing switched on at
the podcaster's end; tier two is gated on Helipad's `fetch_metadata`, which
**defaults to false**, and puts a third party's service in the path of the
metadata. So the two are not alternatives of equal standing — tier two is the
answer for the legs tier one cannot have.

### The Keysend Upgrade

`login-widget/src/lib/keysendLookup.js` + `functions/api/keysend.js`. Some
providers publish `/.well-known/keysend/<name>` beside the usual
`/.well-known/lnurlp/<name>`, naming the node pubkey and the custom record that
routes a payment to that account. Where one exists, `resolveKeysendUpgrade` in
`externalBoost.js` swaps the destination and the leg runs the keysend branch the
value block's own node recipients have always run. **The boostagram builder, the
TLV encoding, both wallet calls and the UNCERTAIN rules are untouched; the whole
of the feature is which destination the branch is handed.**

Measured over the top-30 shows' value blocks, 2026-08-21: 48 of 111 legs were
already keysend, 34 more upgrade, 25 are at `fountain.fm` and are deliberately
excluded, 4 publish no usable document. **Tier-one coverage goes from 48 legs to
82.**

**⚠️ AN INVOICE IS MORE RELIABLE AND A KEYSEND IS MORE INFORMATIVE, WHICH IS
THE WHOLE TRADE.** An invoice carries route hints and reaches a node behind
unannounced channels; a keysend to a bare pubkey has none. Measured 2026-08-22,
`podcastindex@getalby.com` names a node with **no public channel record at
all**, which is exactly the shape that fails.

**So an upgraded leg the wallet CLEANLY DECLINES is re-paid as an invoice on the
same leg**, automatically, and the donor never sees it. `FAILED` is the only
status that reaches that branch, and it can only have come from
`isCleanDecline` — this codebase's standing definition of *the payment never
left the wallet*, and already the test that puts a **Retry which re-pays** in
front of a donor. So the fallback is exactly as safe as a button that already
ships; the one thing new about it is that nobody had to press it. The descriptor
runs on the fallback path, so such a leg still reaches tier two.

**⚠️ THE CLASSIFIER HAS TO RECOGNISE THE WALLET'S OWN CODES, AND IT DID NOT.**
Observed on a real boost, 2026-08-22: an upgraded leg to
`podcastindex@getalby.com` came back `Nip47WalletError:
FAILURE_REASON_NO_ROUTE`, and `isCleanPaymentDecline` looks for `no route` —
one underscore, and the leg was classified **UNCERTAIN instead of FAILED**.
**UNCERTAIN is the one status with no way out**: the fallback is gated on
FAILED, Retry is gated on FAILED, and "Check again" needs a verify URL a
keysend has never had. The donor was left with a leg offering no action at all,
in the exact case the fallback was built for. `WALLET_CLEAN_FAILURE_RE` in
`externalBoost.js` closes it, and **what it leaves out is the whole of its
safety**: `FAILURE_REASON_TIMEOUT` is excluded because an HTLC in flight when
the clock expired can still settle, and `FAILURE_REASON_ERROR` says nothing
about settlement. **Only add a code whose meaning is that no HTLC survived.**
**⚠️ AND THE FIX WAS IN THE WRONG FILE FOR TWO DAYS.** `WALLET_CLEAN_FAILURE_RE`
was a local constant in `externalBoost.js`, with a note saying the same gap in
`payAllLegs.js` was left alone because nothing calls that path and its error runs
the safe way. That was true of `payAllLegs` and **missed the third reader**:
`payInvoiceVerified` in `index.jsx` is the live **zap** path, and there a
`FAILURE_REASON_NO_ROUTE` fell through to `confirmInvoiceSettled` — which can
only answer `settled` or `unknown`, so the result was always `uncertain`, and
`boost-actions.js` **withholds the manual-invoice fallback** on uncertain. A user
whose wallet provably never sent anything was left with no way to pay. The codes
now live in `utils.js#isCleanPaymentDecline`, which all three read; the
keysend-capability layer stays in `externalBoost.js`, being the one thing only
that path can see. `assets/js/boost-actions.js` carries a **hand-copy** for its
raw-WebLN branch, since the site cannot import from `login-widget/src`, and
`test-keysend-upgrade.mjs` pins both against drift.

**⚠️ AND `UNCERTAIN` MUST NEVER REACH THAT BRANCH.** An attempt was made and
nothing observable came back, so re-paying it on another rail is the 2026-08-19
double payment. There is no re-pay out of UNCERTAIN anywhere on this site and
this is not the exception. `test-keysend-upgrade.mjs` pins the branch's
condition literally, and pins `payLnaddressLeg` at **exactly two call sites** —
the ordinary route and this one. A third is a path nobody has argued for.

Everything else that could disqualify a leg is asked up front, before anything
is attempted:

- **⚠️ THE WALLET IS ASKED FIRST, AND THAT GATE IS WHAT KEEPS THE UPGRADE FROM
  COSTING A PAYMENT.** An lnaddress leg pays over BOLT11, which every rail
  speaks; a keysend leg does not — most WebLN extensions have no `keysend`
  method and an NWC connection is only as capable as the wallet behind it. So
  upgrading blindly converts 34 of 111 legs into legs that cannot be paid, in
  exchange for metadata. **The metadata is a courtesy to the recipient; the
  payment is the point.** `walletCanKeysend` answers off `window.webln.keysend`
  or the NWC service's `pay_keysend` capability, cached for the session, and
  **every uncertainty answers no** — a wallet that will not answer `get_info` is
  treated as incapable, because a missed upgrade costs metadata where a wrong
  yes costs the payment. It is asked before the address probe so an incapable
  wallet costs one lookup for the whole boost rather than one per leg.
- **⚠️ AND WHAT THE WALLET *SAID* OUTRANKS WHAT IT ADVERTISED.** A capability
  error out of a real attempt latches for the session (`noteKeysendUnsupported`),
  so no later leg is upgraded. The leg it just cost is `FAILED`, so it carries a
  Retry, and the retry re-enters with the latch set and pays over LNURL. **Both
  capability memos are dropped on `wallet.onChange`**: going from a capable
  wallet to one without it and keeping the old yes upgrades legs the new wallet
  cannot pay. The address cache is a fact about recipients and deliberately
  survives.
- **⚠️ `fountain.fm` IS EXCLUDED THOUGH IT QUALIFIES, and this is the largest
  single decision in the file** — 25 of the 111 legs. It has keysend, it
  publishes the document, the payment arrives and the sats land; it just never
  surfaces the TLV to the recipient, so the upgrade fires and the metadata is
  discarded at the far end. The LUD-21 comment is the only channel Fountain
  shows, which is the channel `/api/boostbox` already fills. **Do not "correct"
  this by testing whether the host serves the well-known: it does, and that is
  the trap.** Nothing observable from our side separates a provider that renders
  the TLV from one that drops it. Membership in `LNURL_ONLY_DOMAINS` is
  knowledge about the provider, never a probe.
- **⚠️ THE EXCLUSION IS MATCHED EXACT-OR-PARENT, NEVER `endsWith`.** A bare
  suffix test also matches `notfountain.fm`, which hands anyone who can register
  a hostname the ability to strip the inline boostagram off other people's
  payments. The value block is attacker-authored text.
- **⚠️ THE PUBKEY IS VALIDATED STRICTLY** (`/^0[23][0-9a-f]{64}$/`), because
  there is no second chance. `primal.net` answers the probe **HTTP 200 with its
  SPA's HTML** — three legs of the measured corpus — so a status check alone
  reads them as upgradeable.
- **⚠️ THE ROUTING PAIR IS TAKEN WHOLE OR NOT AT ALL.** `customKey` and
  `customValue` address a sub-account on a shared node, so a key from one entry
  paired with a value from another pays a stranger and the payment still
  succeeds. The upgraded destination is built **field by field and never spread
  from the original recipient**, for the same reason one level up: a value
  block's own pair routes to an account on the node *it* named, which is not
  this node.

**⚠️ `/api/keysend` IS THE ROUTE, NOT A FALLBACK, WHICH IS THE OPPOSITE OF
`/api/lnurl`.** LNURL is browser-facing by design and those endpoints almost all
send CORS headers, so that proxy exists for the minority that do not. The
keysend well-known is a **server-to-server convention** and providers generally
send none, so a direct browser fetch is blocked for a *healthy* endpoint and the
client's catch reads that as "publishes no keysend document" — silently
downgrading every leg. That is exactly how BMB's own upgrade never fired. There
is no direct attempt before it.

**A non-2xx is the ordinary case here**, which is why that Function does not
share `/api/lnurl`'s helpers: mirroring the upstream status and surfacing the
recipient's own words is right where a donor is owed an explanation, and wrong
where the leg pays over LNURL either way. **Everything that is not a usable
document is one 404 with one reason.** The document comes back **verbatim** so
`keysendLookup.js` is the single parser. **It is not rate limited, deliberately**
— `/api/lnurl` is the same shape and carries no counter either; `/api/boostbox`
has one because it *writes*, under our key, to a third party.

**⚠️ THE LEG'S IDENTITY DOES NOT CHANGE, ONLY ITS DESTINATION.** `leg.recipient`
stays exactly as the value block published it — the lightning address is what
the donor sees, what a retry is issued against, what the boostagram credits, and
what the fallback pays. `leg.keysendUpgrade` / `leg.keysendFellBack` and a
`→keysend` or `→keysend→invoice` marker in the console line are the only trace,
and they exist because which rail a leg took is the first thing anyone debugging
a podcaster's missing row needs to know.

**⚠️ THE RSS `type` AND THE WELL-KNOWN ARE NOT IN CONFLICT, which is the frame
this decision turned on** (Reed's question, 2026-08-22). A publisher writing
`type="lnaddress"` and the provider publishing a keysend document *for that same
address* are not two claims to arbitrate between; the provider is naming a
second door to the same account, complete with the `customKey` / `customValue`
that routes to it. So the question was never whose declaration wins — it was
which door is more reliable, and the fallback is what stops us having to answer
that in advance for every recipient.

**Still unverified: a real upgraded leg reaching a real Helipad.** The wallet
gate, the exclusion and the parser are all covered by the test; the end-to-end
path has not been run with sats. **⚠️ And a self-paid leg cannot verify it** —
see the note above on an invoice that never settles.

**⚠️ IT PROXIES BECAUSE OF THE KEY, NOT BECAUSE OF CORS**, which is the opposite
of `/api/lnurl`. tardbox answers with `access-control-allow-origin: *`, so the
browser could call it directly; it must not, because a shared key in a 1MB
public bundle is one anyone can write records under our name with.
`BOOSTBOX_API_KEY` is a secret binding on Preview **and** Production, and Pages
binds at deploy time so a new secret needs a redeploy.

**⚠️ `feed_title` AND `item_title`, NEVER `podcast` AND `episode`.** Helipad
deserializes an `RssPayment` of exactly nine fields — `action`, `app_name`,
`feed_title`, `item_title`, `message`, `remote_feed_guid`, `remote_item_guid`,
`sender_name`, `value_msat_total` — and drops the rest. `podcast`/`episode` are
the **boostagram TLV's** names for the same two facts; sending those stored them
faithfully and rendered a podcaster's row with a sender, a total and no show.
The guids go in **twice** for the same reason: the plain pair drives BoostBox's
own page, the `remote_` pair is the only guid Helipad reads.

**⚠️ THE DESCRIPTOR IS WHOLE OR ABSENT.** Truncation cuts from the right with
the URL on the left, so `${desc} ${msg}`.slice() shortens the URL into a dead
link having spent the whole 255-character allowance on it.

**⚠️ AND A MISSING DESCRIPTOR IS NEVER FATAL.** Every failure — no key, no KV,
rate limit, timeout, upstream refusal — resolves to the bare message. It also
**warns to the console**, because the only other symptom is a row in somebody
else's Helipad. `sender_id` is deliberately never sent, so an anonymous boost
cannot leak a pubkey to a recipient's aggregator through this channel, and the
descriptor is skipped entirely on a site donation.

**⚠️ A SELF-PAID LEG NEVER SETTLES, AND IT IS NOT A BUG IN ANY OF THIS.** Where
the donor is also a split recipient, that leg is their own hub paying an address
it hosts; it can be credited internally with no HTLC, leaving the LND invoice
`OPEN` forever, so nothing reaches Helipad's stream. Measured 2026-08-22: the
memo was intact on the node and the invoice was never settled. **It costs an
ordinary donor nothing** — they are not a recipient of the show they boost — but
it means this phase cannot be verified on such a leg, by keysend or by
descriptor.

### The Wallet Gate Is Behind The Boost Button

**Compose first, pay second.** `openExternalBoost` ran the wallet gate before
the modal ever mounted, so a visitor who pressed Boost was asked to paste an NWC
connection string before seeing what they were boosting or what it would cost.
It now lives in `handleBoost`, where the connect modal arrives at the moment its
purpose is obvious, and the form says one more step is coming rather than
springing a second modal on the reader.

**⚠️ IT COSTS NOTHING TO PRESERVE, AND THE REASON IS Z-INDEX.**
`WalletConnectModal` is `z-[78/79]` and `LoginModal` is `z-[80]`, both already
above the boost modal's `z-[70/71]`. So the boost modal **stays mounted
underneath with its state intact**; there is no draft to save and restore, and
the LNURL prefetch that runs on mount gets the whole detour as extra runway.

**⚠️ THE RESUME IS THE MODAL'S OWN `wallet.onChange` SUBSCRIPTION, NEVER A
`pendingAction`.** That queue re-enters an api method from the top, and
re-entering `openExternalBoost` with the modal already open would mount a second
one over the first. `api.requestWalletForBoost` therefore queues nothing and its
promise is deliberately **not** the resume signal — a second path into
`startPay` is a second way to pay twice. It keeps everything else the retired
gate did: the at-rest restore first, so a returning visitor with a saved blob
never sees the connect modal; and `handleWalletGateFailure`'s distinction
between "no wallet" and "a remembered extension that stalled", since a slow
extension must not be told it has no wallet.

**⚠️ `remembered` IS NOT `connected`, AND MOVING THE GATE IS WHAT MADE THAT
VISIBLE.** `connected` means a live client; a saved NWC blob or an enabled
extension reports `remembered` and engages on the first press. The old gate ran
that unlock *before* the modal mounted, so the modal only ever saw a connected
wallet. Now it opens first — and the form's wallet hint told a returning user
with the identity dot showing green that they had no wallet. They are one press
from paying, so the line is withheld for `remembered` entirely. **Any new copy
about wallet state has to test both.**

### The Site Signs For A Booster Who Has No Key

`functions/api/sign-boost.js`. A visitor who boosted without a Nostr account has
paid a show and no way to put that boost in this index, because the index counts
notes and they have no key to sign one with. The endpoint signs a boost note
under the bot identity and **the browser publishes it** — the endpoint never
touches a relay, an outbound socket per request being a second thing to abuse.

Two bindings, and it refuses to run without either: `BOOSTBOT_NSEC` (secret) and
`SIGN_RATELIMIT` (**a KV namespace**), on Preview *and* Production. Unconfigured,
it answers 503 and the feature is simply off.

**⚠️ IT CANNOT VERIFY THAT ANYTHING WAS PAID, AND NO CHEAP VERSION OF IT CAN.**
Proof-of-payment was designed and rejected on 2026-08-19: a preimage proves only
that someone *knows* the preimage, which is the payer **or whoever issued the
invoice**, so an attacker self-issues an invoice for any amount and passes. A
caller-supplied LUD-21 verify URL is worse. The only real version has this server
issuing the invoices, which puts it in the middle of a money path. Don't
re-propose it in either form.

**So the evidence standard is the SAME as the donor-signed path's**: the
browser's own observation of what settled. That is Reed's call and the symmetry
is the argument — if the evidence is good enough to publish from the donor's
account it is good enough to publish from ours. What differs between the two
paths is not evidence but **accountability**: on the donor path, possession of
the key proves an identity chose to stake itself on the claim. Here there is no
key to possess, so what stands in for it is **containment**:

- one identifiable publisher, so the bot's whole output is a single filterable
  set (`client_src = publisher-pubkey`);
- `excludes.json` removes all of it in one edit, reversibly;
- the caps below bound what one caller can do with it.

Keep it in proportion: **the index already accepts unauthenticated writes from
the whole of Nostr**, since anyone may publish a boost note from a burner key and
the collector indexes it. The endpoint removes the friction of generating a key,
not the capability.

**⚠️ THE VALIDATOR IS AN ALLOWLIST, and `e` and `p` are refused by omission.**
Our template emits neither, so refusing them is provably not a regression — and
with an `e` tag a note signed by this key appears to **reply** to any note in the
world, which is a far better vehicle for harassment than a standalone post nobody
follows; with `p` tags it becomes a mention blast at strangers from an identity
carrying our NIP-05. **If `buildExternalNoteTemplate` ever emits a new tag, add
it to `ALLOWED_TAGS` in the same change** or every site-signed note starts
failing. `scripts/test-sign-boost.mjs` feeds the validator from the **shipped**
builder rather than a fixture, so that coupling fails in the test rather than in
production.

Four more rules, each closing something specific: the `amount` must be **plain
digits**, because `Number('1.5e6')` is an integer and the string `1.5e6` reads as
1,500,000 to a JavaScript consumer and raises in the collector's `int()`;
`client` is not caller-settable, being our own attribution; an `r` URL is checked,
being a link published under our identity; and `created_at` is held to ±5min.

**⚠️ THE RATE LIMIT IS FRICTION, NOT A SECURITY BOUNDARY, and Pages has no rate
limiting binding.** The supported binding types are KV, Durable Objects, R2, D1,
Vectorize, Workers AI, service bindings, Queues, Hyperdrive, Analytics Engine,
variables and secrets; a Pages Function can only *bind* to a Durable Object class
and never define one, so the textbook counter would mean standing up a separate
Worker. It is a fixed-window KV counter instead, 5/min/IP. KV is eventually
consistent so a caller spread across data centres is undercounted, the
read-modify-write loses concurrent increments, and an IP limit falls to anyone
with a proxy pool. It still **fails closed** with nothing bound, because refusing
to run is what makes the operator decide.

### The one boost button

Boosting a SHOW (as opposed to an episode) pays the **feed-level** value block —
`/api/value` with a `podcastGuid` and/or `feedUrl` and no `guid`.

**Every boost affordance on a card is the same control**: the button built by
`assets/js/boost-button.js`, styled as `.ob-boost-pill` in **theme.css** (there,
because it is the one class the homepage and the detail pages both need). It
reads `--brand`, never `--accent`: the feed accents only exist on `index.html`.
It rides the right end of the card's Nostr Stats line, pinned by its own
`margin-left: auto`. Solid brand blue, the word "Boost", no bolt.

| Surface | Handler | Pays |
|---|---|---|
| Episodes / Songs cards | `episode-card-actions.js#onBoostClick` | that episode |
| Shows / Albums cards | `shows-feed.js#onShowBoost` | that show's feed block |
| `/show` community drawer rows | `show-page.js#onCommunityBoost` | another show's |
| `/show` hero button | `show-page.js#initBoosting` | this show's |
| `/episode` hero button | `episode-page.js#initBoosting` | this episode |
| `/episode`, `/booster` cards | `episode-card-actions.js#onBoostClick` | another episode |

**`boost-button.js` is chrome, not a money path.** It builds a button and reports
clicks; each caller owns its own resolve-and-pay sequence, because what a boost
pays differs by surface. All go through `fromApiValue` → `applyExternalOverrides`.
Sharing the button and not the handler is the seam on purpose.

**It does not probe.** The hero button reveals itself only after a value block
resolves; a page can carry 150 community rows, so those reveal optimistically and
resolve on click, reporting an unpayable show in a toast at that point. Withheld
entirely from unidentified shows, which have no Podcast Index record.

**The community drawer is the only place on the site that pays a show other than
the one the surface is about.** The target guid and feed URL come off the row's
own data attributes and are threaded through `resolveValue` *and* `openBoost`
together — passing a guid to one and not the other would resolve one show's
splits and label the published note with another's.
