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
      "img": "https://…", "feed": "https://…/rss.xml",
      "medium": "podcast",             // podcast:medium — 'music', 'video', … ; defaults to 'podcast'
      "author": "Adam Curry & John C. Dvorak", // <itunes:author>; nullable. See the author note below.
      "boosts": 542, "sats": 487214, "boosters": 96, "episodes": 130,
      "latest": 1784980386,            // unix seconds of newest boost
      "file": "podcasts/856cd618-….json"   // exact per-show shard path — use this, don't build it
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
  "show": { "guid": …, "title": …, "img": …, "feed": …, "medium": "podcast",
            "author": "Adam Curry & John C. Dvorak" },   // nullable; see the author note below
  "episodes": [
    { "guid": …, "title": …, "img": …, "date": …, "num": …, "url": …,
      "shownotes": "full plain-text shownotes…",   // uncapped; nullable
      "boosts": 9, "sats": 55987 }
  ],
  "boosts": [ <boost>, … ]             // every boost for this show, newest-first
}
```

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
  (In the D1 `/api/v1` layer this column is reserved but not yet populated — the show-page
  credit line reads the per-show shard, which has it; D1 `author` lands with the search work.)
- Data updates when the collector's timer runs; `generated_at` tells you how fresh a file is.
