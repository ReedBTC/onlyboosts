# OnlyBoosts — About the Data (source material for the About / FAQ page)

> **For the website agent:** this is raw source material, written to be accurate
> and complete — not final page copy. Distill, re-order, and rewrite it into an
> About / FAQ page in the site's voice. It's written to serve two audiences at
> once: Podcasting 2.0 people who may be new to Nostr, and Nostr people who may
> be new to podcast value-for-value. Keep the **What this is NOT** section
> prominent and honest — that candor is the point.

---

## In one sentence

OnlyBoosts is a searchable, near-real-time index of podcast **boosts** that
people have published to the **Nostr** network — pulled together from across the
network, cross-referenced with the Podcast Index, and served as an open feed.

---

## Quick bridge for each audience

**If you come from Podcasting 2.0 / value-for-value:** you already know boosts —
sats streamed to a show mid-episode, often with a message (a *boostagram*). What
you may not know is that several podcast apps *also* publish each boost as a
public post on **Nostr** (an open, relay-based social protocol). Those public
posts are what OnlyBoosts collects. Think of it as a cross-app boost wall,
assembled from what the apps themselves broadcast.

**If you come from Nostr:** a "boost" is a Lightning payment sent to a podcast
under the Podcasting 2.0 value-for-value model, usually split across everyone who
makes the show. Some podcast apps publish a `kind:1` note when a boost happens,
tagged (via **NIP-73**) to say which podcast and episode it was for. OnlyBoosts
indexes those notes and enriches them with real podcast metadata.

---

## What is a boost, exactly?

Podcasting 2.0 lets listeners send Bitcoin over the Lightning Network directly to
a podcast while they listen — "streaming sats" per minute, or a lump-sum **boost**
with an attached **boostagram** message. Who gets the money, and in what
proportions, is defined by a **value block** the podcaster publishes in their RSS
feed (a `<podcast:value>` block listing recipients and split percentages). A
single boost is typically **split** across many recipients — host, co-hosts,
producers, the hosting app, etc.

None of that requires Nostr. The Nostr part is optional and additive: some apps,
*after* handling the payment, also publish a public note announcing the boost.

---

## NIP-73: how a Nostr note says "this is about this podcast"

Nostr notes are normally free-form. **NIP-73 ("External Content IDs")** is a
small, open convention for pointing a note at something that lives *outside*
Nostr — a book, a URL, a movie… or a podcast. It works through two tags:

- an **`i`** tag = the external **identifier**
- a **`k`** tag = the **kind** of external thing it is

For podcasts, boost notes carry:

```
["i", "podcast:guid:<feed-guid>"]         ["k", "podcast:guid"]        ← the show
["i", "podcast:item:guid:<episode-guid>"] ["k", "podcast:item:guid"]   ← the episode
```

Those GUIDs are the **same identifiers the podcast publishes in its RSS feed**
(the Podcasting 2.0 `<podcast:guid>` and episode `<guid>`). That's the magic
link: it lets a Nostr note be tied, unambiguously and machine-readably, to a
specific podcast and episode — which is exactly what lets us match a boost to the
right show and pull in its artwork, title, and shownotes.

A **boost note**, then, is a `kind:1` note that (a) carries these NIP-73 podcast
tags and (b) shows evidence of a payment (an amount tag, a Lightning zap receipt,
or a boost-type topic tag).

---

## Where the data comes from (the pipeline, in plain terms)

1. **Scan.** We continuously ask a curated set of Nostr relays — plus the personal
   relays of everyone we've seen boost — for notes tagged as podcast boosts.
2. **Classify.** We keep the ones that are genuinely boosts (NIP-73 podcast tag +
   payment signal) and drop unrelated notes.
3. **Enrich.** We look each show/episode up in the **Podcast Index** by its GUID
   to attach the real title, artwork, air date, and shownotes, and we resolve the
   booster's public Nostr profile (name + avatar) where one exists.
4. **Serve.** The result is written out as plain JSON files and served openly.

A backfill reached back to roughly **October 2024** (as far as relays still
retain these notes); an incremental scan keeps it current every ~15 minutes, and
a daily pass widens the relay net.

---

## Who's publishing boost notes today

As far as we can tell, five sources are publishing NIP-73 podcast-boost notes
right now, one of which is this site:

- **Fountain** — publishes a note that references a Lightning **zap receipt** for
  the amount. (This is the bulk of the data.)
- **BoostMeBitch (BMB)** — publishes a note with an explicit `amount` tag.
- **Local Bitcoiners** — its website boost widget publishes a note with an
  `amount` tag.
- **Bowl After Bowl** — its own site publishes a note in the same shape as BMB's.
- **OnlyBoosts** — a boost sent from this site publishes a note when the booster
  is signed in and chooses to share it. We index our own output on the same terms
  as everyone else's: a boost sent from here and not shared to Nostr is not
  counted, the same as a boost sent from any app that publishes nothing.

That's it, today. But **NIP-73 is an open standard — any podcast app can adopt
it.** Nothing about OnlyBoosts is specific to these five; the moment another app
starts publishing boost notes the same way, they show up here automatically, and
the picture of value-for-value across podcasting gets richer and more accurate.
**The data will get better as adoption grows.**

---

## What this data IS

- A window into **public** boost activity across podcasting, assembled from what
  the apps themselves broadcast to Nostr.
- **Sender-authored messages**, kept **verbatim** (we never edit or strip a
  boostagram — including any mentions or links the sender wrote).
- **Best-effort and continuously updated** — an open, re-usable feed anyone can
  build on.

## What this data is NOT (please read this)

This is the important part, and we'd rather be plainly honest than oversell it.

- **It is NOT proof that any sats were actually sent or received.** A boost note
  is a *claim*, made by the sender's app and signed with the sender's Nostr key.
  Nostr and Lightning are separate systems, and there is **no cryptographic link**
  in the note proving the payment happened, that it settled, or that the recipient
  got it. We record what the app said, not an audited settlement. Treat amounts as
  a strong social signal, not a receipt.

- **The number is the *intended* boost, and splits can partially fail.** A boost
  is split across many recipients per the show's value block. Individual legs fail
  routinely (a recipient's node is offline, a route can't be found), so the sats
  that actually *land* can be **less than the total the note claims**. The note
  usually reflects what was *attempted*, not what was *delivered*.

- **It is NOT a complete record of all boosts.** We only see boosts that (a) an
  app chose to publish to Nostr as a NIP-73 note and (b) landed on a relay we
  scan. Huge amounts of boosting — keysend boosts, apps that don't post to Nostr
  at all — are simply invisible here. Absence from OnlyBoosts means nothing.

- **Amounts vary in how they're derived** (see the table below), from a structured
  tag to, in some older cases, a number parsed out of the note's text. We label
  the source so you can judge it.

- **Identity is a Nostr public key, not a verified person.** The "booster" is
  whoever controls the signing key. For Fountain, that's often a
  Fountain-managed key rather than the person's main Nostr identity, and some
  boosts are anonymous. A name/avatar shown here is self-declared profile data.

- **Podcast metadata can be missing or wrong.** Titles/art/shownotes come from the
  Podcast Index, keyed by GUID; feeds not in the Index show limited info, and some
  episode GUIDs (URLs, opaque strings) can't be resolved at all.

- **History is bounded by relay retention.** We reach back only as far as relays
  still hold these notes (~Oct 2024). Older boosts that have aged off relays are
  gone.

- **Deletions may linger.** If someone deletes their boost note on Nostr, a copy
  may persist in our cache for a while.

- **Everything here was already public.** OnlyBoosts publishes nothing private —
  these notes are openly broadcast on Nostr by design. We just gather and organize
  them.

---

## How the amount is determined (transparency)

Every boost record carries an **`amount_source`** so you can see how much to trust
the number:

| Source | Meaning | Confidence |
|---|---|---|
| `amount_tag` | The note carries a structured `amount` tag (millisats). | Strongest — an explicit machine-readable figure from the app (BMB, Local Bitcoiners). |
| `zap_receipt` | The amount is read from a Lightning **zap receipt** the note references. | Strong — a receipt exists for a paid invoice (Fountain). Still per-leg, and not proof the whole split settled. |
| `content` | The sats were **parsed from the note's text** because there was no amount tag or receipt. | Weakest — a human-readable number, no structured backing (older Local Bitcoiners notes). |
| `t_tag` / `none` | Recognized as a boost, but no amount could be determined. | Shown without a sats figure. |

In every case, remember the top-line caveat: this is the amount **claimed**, not a
**verified** transfer.

---

## FAQ (seed questions — expand/trim as you like)

**Is OnlyBoosts an official podcast directory or the Podcast Index?**
No. We *use* the Podcast Index for metadata, but OnlyBoosts is an independent index
of boost *activity* published to Nostr.

**Do you move money, or can I boost "through" OnlyBoosts?**
The data side is read-only — it takes no custody of funds and processes no
payments; it only reads and organizes notes that already exist publicly on Nostr.
(Any boosting the website itself offers is a separate feature of the site.)

**Why is my boost not here?**
Most likely your app didn't publish it to Nostr as a NIP-73 note, or it landed
only on a relay we don't scan. It may also be too old (aged off relays), or it was
dropped because it lacked a detectable payment signal.

**Why does an amount look off, or show as unknown?**
Amounts are self-reported by the sending app and reflect the *intended* boost;
splits can partially fail, and some notes carry no structured amount at all. See
"How the amount is determined."

**My podcast has no title/art here — why?**
The show or episode GUID isn't resolvable in the Podcast Index. The boost is still
counted; it just can't be dressed up with metadata.

**I run a podcast app — how do I get our boosts included?**
Publish a `kind:1` boost note with the NIP-73 podcast tags
(`podcast:guid` + `podcast:item:guid`) and a payment signal — ideally an `amount`
tag in millisats, like BoostMeBitch, and/or a `t:boostagram` topic tag. Do that
and your boosts will appear here automatically. No sign-up, no permission needed —
that's the point of an open standard.

**Is this private / did I consent to being here?**
Everything indexed was already broadcast publicly on Nostr by the app you used.
OnlyBoosts adds no private data.
