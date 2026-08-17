# OnlyBoosts Data API — for the website

Static JSON, served by Caddy off the VPS. No auth, plain `GET`. Same pattern as
LB's `community_boosts.json`. The collector rebuilds these on a timer and pushes
them; the site just reads them.

**Base URL:** `https://relay.mynostr.app/onlyboosts/`

## ⚠️ Read this first: a missing file returns 200, not 404

Any path that doesn't exist as a file falls through to the Nostr relay (strfry)
and returns **`HTTP 200` with `Content-Type: text/plain`** and the body
`Please use a Nostr client to connect.` — *not* a 404.

**So never branch on status code.** Treat a response as valid only if it parses
as JSON (or check `Content-Type: application/json`). A `text/plain` body means
the file isn't there.

**Consume server-side.** Fetch these from a Cloudflare Pages Function proxy (like
`functions/api/rss.js`), not the browser directly — consistent with how
`community_boosts.json` is already consumed, and it lets you set caching + bound
the upstream fetch.

Directories are **not** browsable (no listings). Discover exact filenames from
`index.json` (the manifest), never by enumerating a path.

---

## Endpoints

### `index.json` — the manifest (read this first)
```jsonc
{
  "generated_at": 1784995125,          // unix seconds, when the export ran
  "totals": {
    "boosts": 21956, "distinct_shows": 1376, "distinct_eps": 7067,
    "distinct_boosters": 1972, "total_sats": 42322812,
    "shows_enriched": 916, "eps_enriched": 6590, "profiles": 1920,
    "earliest": 1728259200, "latest": 1784995000   // unix seconds
  },
  "boosts": {
    "latest": "latest.json",
    "music": "boosts/music.json",      // all-time, music-medium shows only
    "months": [                        // newest first; use these to page back
      { "month": "2026-07", "count": 912, "file": "boosts/2026-07.json" },
      { "month": "2026-06", "count": 1043, "file": "boosts/2026-06.json" }
      // … 22 months, 2024-10 → 2026-07
    ]
  },
  "podcasts": { "index": "podcasts/index.json", "count": 1376 },
  "profiles": "profiles.json"
}
```
All `file` values are paths **relative to the base URL**.

### `latest.json` — most recent 1000 boosts (default first page)
```jsonc
{ "generated_at": 1784995125, "count": 1000, "boosts": [ <boost>, … ] }
```

### `boosts/YYYY-MM.json` — one month of boosts (paging / archive)
```jsonc
{ "generated_at": …, "month": "2026-07", "count": 912, "boosts": [ <boost>, … ] }
```
Boosts within a file are newest-first.

### `boosts/music.json` — every music boost, all-time (for Songs / Albums)
```jsonc
{ "generated_at": 1784995125, "count": 1195, "boosts": [ <boost>, … ] }
```
Same shape as `latest.json`, newest-first, **not windowed** — read it whole.
Currently 1,195 boosts across 474 shows and 601 episodes: 1.5MB raw, 0.34MB
gzipped, growing ~1MB of raw a year. **Take the path from the manifest**
(`boosts.music`), not from this heading.

Music is ~5% of the boost stream, so building a Songs feed by filtering the
windowed general feed shows a small and arbitrary fraction of it — three months
of archives yields 84 of those 601 episodes while downloading 4MB. This file is
that join done once, server-side, over all of history.

**Membership is the same projection as `medium` in `podcasts/index.json`** — the
export derives both from one list, so they can't disagree. Two consequences:
- **No `medium` field on the records.** The medium is a property of the *show*,
  and the point of this file is to avoid stamping it onto 22k boost records. If
  you need it per-show, join `podcast.guid` → `podcasts/index.json` as before.
- **A show with no declared medium is not here.** It defaults to `podcast`, per
  the namespace. The split is a partition, not a narrowing: `music` goes to
  Songs and Albums, *everything else* — podcasts, video, and feeds Podcast Index
  can't identify — goes to Episodes and Shows.

### The `<boost>` record (same shape everywhere it appears)
```jsonc
{
  "id":  "3c2d…a4d9",        // nostr event id (hex) — dedupe/react/reply key
  "ts":  1784980386,          // unix seconds
  "sats": 4500,               // integer, or null if the amount couldn't be resolved
  "src": "zap_receipt",       // how sats were derived: amount_tag | zap_receipt | t_tag | none
  "msg": "…boostagram text…", // verbatim (may contain nostr: mentions / URLs); may be ""
  "client": null,             // RAW NIP-89 client tag, as signed. Null on 98.7% — see below
  "client_id": "fountain",    // DERIVED: the app that PUBLISHED the note. Null = unattributed
  "client_via": null,         // DERIVED: for a RELAYED boost, the app it came from
  "booster": {
    "pk":   "0427…63e5",      // pubkey hex
    "npub": "npub1…",         // always present
    "name": "2a3dex",         // nullable → fall back to npub short form
    "pic":  "https://…"       // nullable
  },
  "podcast": {
    "guid":  "856cd618-…",    // podcast:guid (RFC-4122 UUID)
    "title": "No Agenda Show",// nullable if the show isn't in Podcast Index
    "img":   "https://…",     // nullable
    "art2":  "https://…",     // nullable fallback art URL; render `img`, on 404 try `art2`. See the art2 note.
    "feed":  "https://…/rss.xml" // nullable
  },
  "episode": {
    "guid":  "http://1888.noagendanotes.com", // podcast:item:guid — MAY BE A URL, not a UUID
    "title": "1888 - \"In The Mourning\"",     // nullable
    "img":   "https://…",     // nullable (falls back to show image)
    "date":  1784853959,      // air date, unix seconds, nullable
    "num":   null,            // episode number, nullable
    "url":   "https://…mp3"   // listen/enclosure URL, nullable
  }
}
```
`episode.guid` is `null` for show-level boosts (no episode named).

### `podcasts/index.json` — per-show rollup (for Podcasts · Global)
```jsonc
{
  "generated_at": …, "count": 1376,
  "podcasts": [                        // sorted by `latest` desc (most recent boost first)
    {
      "guid": "856cd618-…", "title": "No Agenda Show",
      "img": "https://…", "art2": "https://…", // art2 nullable; fallback when `img` 404s — see the art2 note
      "feed": "https://…/rss.xml",
      "medium": "podcast",             // podcast:medium — 'music', 'video', … ; defaults to 'podcast'
      "author": "Adam Curry & John C. Dvorak", // <itunes:author>; nullable. See the author note below.
      "language": "en",                // RSS <language>, primary subtag only; NULLABLE — see the language note
      "boosts": 542, "sats": 487214, "boosters": 96, "episodes": 130,
      "latest": 1784980386,            // unix seconds of newest boost
      "file": "podcasts/856cd618-….json",  // exact per-show shard path — use this, don't build it
      "podroll": 22,                   // KEY IS ABSENT when zero — see the podroll section
      "podrolled_by": 12               // ditto. Counts only; the cards are in the shard
    }
  ]
}
```

### `podcasts/<guid>.json` — one show's detail (click-through; has shownotes)
Fetch via the `file` field from `podcasts/index.json` (filename is the guid,
sanitized — always use `file`, don't assemble it yourself).
```jsonc
{
  "generated_at": …,
  "show": { "guid": …, "title": …, "img": …, "art2": …, "feed": …, "medium": "podcast",
            "author": "Adam Curry & John C. Dvorak",
            "language": "en" },   // art2/author/language nullable; see notes below
  "episodes": [
    { "guid": …, "title": …, "img": …, "date": …, "num": …, "url": …,
      "shownotes": "full plain-text shownotes…",   // uncapped; nullable
      "boosts": 9, "sats": 55987 }
  ],
  "boosts": [ <boost>, … ],            // every boost for this show, newest-first

  // Both podroll keys are ABSENT when empty (not [] and not null).
  "podroll":        [ <podroll-card>, … ],  // what THIS show recommends, publisher's order
  "recommended_by": [ <podroll-card>, … ]   // the reverse edge, alphabetical by title
}
```

### The `<podroll-card>` record
`<podcast:podroll>` is a publisher's own list of other shows worth hearing. It
appears in both directions above with the same shape — in `podroll` the card
describes the show being recommended, in `recommended_by` the show doing the
recommending.
```jsonc
{
  "guid":   "917393e3-…",        // podcast:guid; nullable (a few feeds give only a URL)
  "title":  "Podcasting 2.0",    // nullable — 367 of 371 live edges have one
  "img":    "https://…",         // nullable
  "art2":   null,                // second-chance art URL; same fallback rule as everywhere else
  "medium": "podcast",           // nullable
  "author": "Adam Curry…",       // nullable
  "feed":   "https://…/rss.xml", // the target's feed URL
  "linked": true                 // ← READ THIS ONE
}
```
**`linked` is the whole contract.** `true` means the show has a `/show/<guid>`
page on this site and the card should link to it. `false` means it does not —
it has no boosts, or no title — and the card must point at `feed` (or render
unlinked) instead. Roughly **56% of live cards are `linked`**; a podroll
routinely recommends shows nobody in this corpus has boosted, and those cards
are still worth rendering because they carry real artwork and titles.

Do **not** re-derive `linked` by looking the guid up in `podcasts/index.json` —
that works today but it is the collector's rule to own, and it already accounts
for the titleless case.

The same data is in D1 as a `podroll` table for the server-rendered `/show`
pages, one row per edge with `source_*` and `target_*` columns carrying these
fields (`*_linked` as 0/1). Read it in whichever direction the page needs —
`WHERE source_guid = ?` ordered by `position`, or `WHERE target_guid = ?` — with
no join to `podcasts` needed, which is the point of denormalizing it: `podcasts`
holds only shows that have boosts, i.e. barely half the cards.

### `profiles.json` — booster identities keyed by pubkey hex
```jsonc
{
  "generated_at": …,
  "profiles": {
    "<pubkey_hex>": { "npub": "npub1…", "name": "inpc",
                      "display_name": null, "picture": "https://…",
                      "nip05": "inpc@inpc.cat",
                      "about": "Bitcoiner, podcaster…", "lud16": "inpc@getalby.com",
                      "lud06": null, "website": "https://…", "banner": null }
  }
}
```
Boost records already embed `booster.name`/`pic`, so you only need this for
extra fields (nip05/display_name/about/lud16) or a standalone lookup. ~51
boosters have no profile anywhere — they simply won't appear here (use the
npub). **Every field but `npub` is nullable**; they are whatever the booster's
newest kind-0 carried.

`lud16` and `lud06` are the same field in two forms and are deliberately NOT
coalesced: `lud16` is an addressable `user@host` a reader can copy into a
wallet, `lud06` a bech32 LNURL blob that is scanned rather than read. A profile
may carry either, both, or neither. Prefer `lud16` when both are present.

The same columns are in D1's `profiles` table, which the `/api/v1` layer reads.
A profile is re-fetched when its stored copy passes `db.PROFILE_MAX_AGE`
(30 days), so `about` and `lud16` track a booster who edits their kind-0 after
their first boost, rather than being frozen at whatever the first fetch saw.

### `meta.json`
Same numbers as `index.json`'s `totals`, standalone, for a cheap header/summary poll.

---

## Building the views

| View | How |
|---|---|
| **Boosts · Global** | `latest.json` for page 1; page back through `boosts/<month>.json` (months from the manifest, newest→oldest). Each record renders a card directly. |
| **Boosts · Follows** | Same feed, keep records where `booster.pk` ∈ the signed-in user's follow set. |
| **Songs · Global** | `boosts/music.json` (path from the manifest's `boosts.music`), read whole — no windowing and no medium join needed, it's pre-filtered. Group by `episode.guid` to rank songs. |
| **Songs · Follows** | Same file, filtered on `booster.pk` like the other Follows views. |
| **Albums** | `boosts/music.json` grouped by `podcast.guid`; or `podcasts/index.json` filtered to `medium === "music"` for the rollup with its aggregates. Both agree by construction. |
| **Podcasts · Global** | `podcasts/index.json` → cards (already sorted by recency; re-sort by `sats`/`boosts` if you prefer). Click a card → fetch its `file` for episodes + shownotes + that show's boosts. |
| **Podcasts · Follows** | Filter the boost feed to follows, then group by `podcast.guid` and aggregate. (`podcasts/index.json` has no per-booster breakdown, so a follows-scoped podcast list must come from the filtered boosts.) |

**Follows set** = the signed-in user's kind-3 contact list (the pubkeys they
follow), which the client already resolves for a Nostr login. Build a `Set` of
those hex pubkeys and filter on `booster.pk`. Reading is anonymous; the two
Follows views light up only once someone signs in.

## Field gotchas worth coding for
- **`sats` can be `null`** — show the boost without an amount, or hide it; small fraction.
- **`name`/`pic`/`title`/`img`/`date`/`url` are nullable** — always have a fallback (npub short form, show image, "Unknown show", etc.).
- **`art2` is a second-chance art URL — render `img`, fall back to `art2` on error.** PI
  splits a feed's channel art across `image` (RSS `<image><url>`) and `artwork`
  (`<itunes:image>`); `img` is the former, `art2` the latter, carried **only when it
  differs** from `img` (else null). Some feeds list a rotted `<image>` beside a live
  `<itunes:image>` (e.g. Homegrown Hits, whose `<image>` 404s), so an `<img>` that just
  points at `img` shows nothing. Wire an `onError` that advances `img → art2 → placeholder`
  tile (see BMB's `PodcastCover`). Present in the boost-feed `podcast` object and the
  per-show `show` object; **not yet in the D1 `/api/v1` `podcasts` table** (pending a remote
  `ALTER TABLE podcasts ADD COLUMN artwork TEXT` + backfill), so SSR/API consumers get null
  there until that ships.
- **⚠️ `client` IS ALMOST ALWAYS NULL; USE `client_id`.** The NIP-89 `client` tag is on
  **1.3%** of the corpus (291 of 22,968) and is absent from the app behind ~94% of it, so
  the raw tag alone reports the ecosystem as five hobby projects. `client_id` and
  `client_via` are the collector's own attribution (`clients.py`), derived from three
  signals: a `fountain.fm` URL in the NIP-73 i-tag (21,615 boosts), a known publisher
  pubkey (1,025), and the NIP-89 tag itself (291). ~39 boosts resolve to nothing and are
  left **null** rather than guessed. The raw `client` is never overwritten — a consumer
  has to be able to tell the publisher's own claim from our inference.
  Live split: `fountain` 21,615 · `chadf-boostbot` 994 · `boostmebitch` 193 ·
  `localbitcoiners` 70 · `lnaddress-music` 31 · `bowlafterbowl` 18 · `onlyboosts` 8 ·
  `pv4v` 2 · unattributed 39.
- **⚠️ `client_via` IS A SUBCATEGORY, NOT A CLIENT, and flattening the two misreports the
  ecosystem.** `chadf-boostbot` republishes boosts made in apps that speak **no NIP-73 at
  all** — Castamatic (294), StableKraft (260), PodcastGuru (157), CurioCaster (56),
  LN Beats (21), Podverse (3) — naming each in its own message body. Those apps published
  nothing to Nostr; the bot did. So they appear under `client_via`, nested inside the
  bot's row, and must never be promoted to a top-level client: doing so credits six apps
  with supporting a spec none of them implement. `GET /api/v1/clients` returns them nested
  for exactly this reason.
- **`episode.guid` may be a URL**, not a UUID — don't parse it as one.
- **`msg` is verbatim** — may contain `nostr:` mentions and links; render/escape accordingly (don't strip).
- **Timestamps are unix seconds** (multiply by 1000 for JS `Date`).
- **`author` is `<itunes:author>`, not a credit list.** Present on ~99.6% of *identified*
  shows (924/928). On **music** it's the artist (~97% distinct from the title — treat it as
  "Artist"). On **podcasts** it's a weak "by" line (~88% distinct): often a real host, but
  sometimes a network or publisher ("Jupiter Broadcasting"), so label it "By …", never
  "Host"/"Creator". It is **not** `<podcast:person>` — PI exposes no channel-level person
  data, and persons appear on only ~13% of feeds, so there is no persons/host-role field.
  The value is raw: hide it when it just repeats the title (normalize case, whitespace and a
  leading "The" before comparing) and when it's null. Because `medium` defaults to `podcast`,
  an untagged music feed reads as "By" rather than "Artist" — expected, not a bug.
  (Available in both paths: the per-show shard `show` object and the D1 `/api/v1` `podcasts`
  table — the latter enables author-in-search as a matched-only field.)
- **`language` is the feed's own `<language>`, normalized to the PRIMARY SUBTAG** — `en`,
  `de` — because the corpus describes ~21 languages in 36 distinct raw tags (`en`, `en-us`,
  `en-US`, `en-gb`, `en-au` are one language, and the case varies by publisher). Region is
  dropped on write, so a consumer never sees `en-US`.
  **⚠️ NULL MEANS THE FEED DECLARES NONE, AND THAT IS NOT ENGLISH.** Coverage splits hard
  by medium: **99% of podcasts (466/469) against 48% of music (232/485)**, because Wavlake
  — which hosts most of the music corpus — emits no `<language>` at all (198 of the 251
  music misses). Across the whole index that is **594 of 1,294 shows with no language**.
  So an untagged show is a populous, first-class state, not a gap to default away: a
  consumer filtering to `en` must **exclude** null rather than assume it, and must offer
  the untagged bucket or say plainly that filtering hides it — otherwise "filter by
  language" silently becomes "hide half the Albums feed", under a claim those publishers
  never made. Same partition reasoning as `medium`, where the unidentified shows are why
  the Shows feed is `not_medium=music` rather than `medium=podcast`.
  Boost-weighted the long tail is thinner than the show counts suggest: `en` 17,286 boosts,
  `de` 3,155 (40 shows, essentially the whole non-English story), `es` 319, and every other
  language under 50 — so a menu listing all 20 is mostly dead entries.
  Available in **both** paths: the shards above and the D1 `/api/v1` `podcasts` table.
  `GET /api/v1/languages` returns the live facet (counts per language, `medium`-aware) and
  is what a language control should be built from — the set grows whenever a show in a new
  language is first boosted, so a hardcoded list goes stale silently.
  `GET /api/v1/podcasts?lang=` and `GET|POST /api/v1/episodes?lang=` filter on it; the
  literal `lang=unknown` selects the untagged bucket, and a full tag (`lang=en-US`) is
  normalized rather than rejected.
- **Podroll is on ~7% of feeds — design the section to be absent, not empty.** 65 of
  925 reachable feeds carry the tag; 371 recommendation edges, median 4 per show and
  one outlier at 63, so cap or scroll the list. It reaches **109 show pages** because
  `recommended_by` lights up ~40 pages that publish no podroll themselves — build both
  directions or most of the value is left on the table. The counts on
  `podcasts/index.json` let you decide whether a page has a section **without** opening
  the shard; the keys are absent, so test with `in` / `?.`, not `> 0`.
- **Podroll refreshes WEEKLY, not hourly.** It's the one field parsed from the show's
  raw RSS (Podcast Index carries no podroll), so re-crawling ~900 third-party feeds on
  the hourly tick would be rude for data that changes when a publisher edits a feed.
  A newly-published podroll can take up to a week to appear. Everything else on the
  page is still hourly.
- Data updates when the collector's timer runs; `generated_at` tells you how fresh a file is.
