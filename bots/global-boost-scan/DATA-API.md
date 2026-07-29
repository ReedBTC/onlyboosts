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

### The `<boost>` record (same shape everywhere it appears)
```jsonc
{
  "id":  "3c2d…a4d9",        // nostr event id (hex) — dedupe/react/reply key
  "ts":  1784980386,          // unix seconds
  "sats": 4500,               // integer, or null if the amount couldn't be resolved
  "src": "zap_receipt",       // how sats were derived: amount_tag | zap_receipt | t_tag | none
  "msg": "…boostagram text…", // verbatim (may contain nostr: mentions / URLs); may be ""
  "client": null,             // e.g. "Fountain" — often null (no client tag)
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
            "author": "Adam Curry & John C. Dvorak" },   // art2/author nullable; see notes below
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
                      "nip05": "inpc@inpc.cat" }
  }
}
```
Boost records already embed `booster.name`/`pic`, so you only need this for
extra fields (nip05/display_name) or a standalone lookup. ~52 boosters have no
profile anywhere — they simply won't appear here (use the npub).

### `meta.json`
Same numbers as `index.json`'s `totals`, standalone, for a cheap header/summary poll.

---

## Building the four views

| View | How |
|---|---|
| **Boosts · Global** | `latest.json` for page 1; page back through `boosts/<month>.json` (months from the manifest, newest→oldest). Each record renders a card directly. |
| **Boosts · Follows** | Same feed, keep records where `booster.pk` ∈ the signed-in user's follow set. |
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
