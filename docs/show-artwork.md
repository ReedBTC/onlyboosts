# Show Artwork: The `art2` Fallback

**Moved verbatim out of `CLAUDE.md` on 2026-09-09**, when that file passed its
size budget — the same treatment the seven `docs/` files got on 2026-08-29 and
`docs/tests.md` got the same day. Nothing was rewritten on the way across, so
`git log -S <symbol> -- CLAUDE.md` still finds any paragraph that used to live
there.

**What stayed in `CLAUDE.md` is the three rules a change elsewhere would
break**: the https promotion, the share card's type following its image, and
`og:image` staying on the primary. Everything else — the chain, the wiring, the
measurements behind each decision, and the `/booster` OG route — is here.

## The Chain

Some feeds publish two artwork URLs, RSS `<image><url>` and `<itunes:image>`, and
the first is sometimes dead while the second resolves. The collector publishes the
second as **`art2`**, null when identical to `img`; `assets/js/cover-art.js` walks
the chain on error.

```
episode art  →  show art (img)  →  show art2  →  glyph / placeholder
```

**⚠️ `coverChain()` PROMOTES `http://` TO `https://` BEFORE IT FILTERS.** Every
page here is https, so an http image is mixed content: Chrome auto-upgrades it
and **blocks it outright if https fails**, never falling back to the insecure
copy. The http URL was therefore already unreachable as written, and promoting
it only stops the console filling with warnings and stops the chain holding two
entries for one picture. Measured over 200 boosts on 2026-08-22: 7
`episode.img`, 5 `podcast.img`, 1 `booster.pic`. A host with no https at all is
not made worse — an upgraded URL that fails advances to the next source exactly
as a dead https URL always has, which is what makes this safe to do to a third
party's URL. `httpsUrl` is exported for the two avatar render sites
(`boost-list.js`, `episode-card.js`), which do not go through the chain.

`coverChain()` filters to http(s) and **dedupes** — `art2` is meant to be null
when it equals `img`, but the shards are third-party data and a repeat would cost
a second request for the URL that just failed. `wireCoverFallback()` advances on
each error and clears its own handler at the end, so an unreachable placeholder
cannot loop; it returns `false` for an empty chain, which is the caller's cue to
render its no-art state rather than an empty `<img>`.

Wired on the feeds through `ob-data.js` (`normalizeBoosts` carries
`podcast.art2`, `toEpisodeShape` builds `imageChain`), `shows-feed.js`,
`boosts-feed.js` and `feeds-podcasts.js`. On the detail pages it is a
**`data-art2` attribute, not a second `<img>` or an inline `onerror`**: the
Function emits the attribute and `detail-page.js#initArt2` wires the swap through
the same `cover-art.js` helpers, so there is **no fetch at all** and the
no-inline-handler convention holds. It also handles what a deferred module can't
observe directly — the hero is `loading="eager"`, so it may have already failed by
the time the module runs, which `img.complete && !img.naturalWidth` detects.

`wireArt2()` covers all three `/show` surfaces: the hero, the community rows and
the podroll tiles. **The community drawer row was the surface this was missed on**,
and the one where it mattered most: those rows are *other* shows' artwork, so a
single show with a dead primary rendered broken on every page listing it while its
own page had already recovered. The cause was the query rather than the render —
the community CTE selected `p.image` and not `p.artwork`.

The `/episode` hero is the one chain that is **two** fallbacks long, because an
episode with no art of its own falls back to the show's primary before the show's
second chance. `data-art3` is that third link and exists nowhere else.

**The `/show` episode drawer rows are deliberately outside this.** A row falls
back to the show's `img` when the episode has no art, and does not go on to
`art2`. It bites only where a show has a dead primary *and* an episode with no
art, and episode art was 100% present on every show sampled.

**⚠️ The share card's TYPE follows its image, on all four detail pages.** A
large-image card crops to roughly 1.91:1, and nothing these pages send is that
shape: podcast artwork is square by specification (Apple requires 1400x1400 to
3000x3000, and 12 of 12 sampled from the live index are exactly 1.00), and a
booster's avatar is square or portrait (0 of 26 sampled were wide enough; 13 were
exactly square, the rest ran down to 0.67). Every page shipped
`summary_large_image` until 2026-08-16, so every cover and every face was being
sliced into a horizontal band — **a worse failure than sending no image, because
it reads as a broken picture rather than a missing one.** Artwork now gets
`summary`; only the fallback keeps the large card, `OG_FALLBACK` being the
1800x600 site banner. Two shapes, two cards, chosen by which is in use.

**⚠️ `/booster`'s share image is served through `/api/og/booster/<npub>`, not
named as the raw avatar URL.** A preview fetcher makes one request and cannot
fall back, and it stops reading at a size the page cannot see: **Signal Desktop
at 1MB** (`MAX_IMAGE_BYTES_TO_LOAD`), Android and iOS at 2MB. Measured
2026-08-18 over the 49 stored avatars behind the last 100 boosts, 5 answered 404
and 7 were over 1MB (largest 4.3MB), so a quarter of booster pages drew a card
with no image on Desktop while the phones were fine. The route looks the picture
up **by npub in D1** (never off the query string, so it is not an open proxy),
fetches it bounded, asks Cloudflare to resize it to 600x600 JPEG on the way
through (`cf.image`; ignored on a zone without Image Transformations enabled),
and answers with the banner for anything that is not a 200 raster under 900KB.
The header `<img>` still uses the raw URL, because a browser can run `onerror`.
`X-OB-Image: avatar|fallback` on the response says which path answered.

Two things that follow. **A platform caches OG data per URL**, so a link shared
before a page existed keeps its 404 card until the TTL expires or someone forces
a re-scrape — worth knowing before concluding a card is broken. And **`node
--check` is not a syntax check for these Functions**: it accepted a template
literal broken by backticks inside an HTML comment. Import the module instead.

**⚠️ `og:image` stays on the primary, deliberately.** A crawler cannot run the
error handler, so the temptation is to prefer `art2` there — but `art2`'s presence
means the feed publishes *two different* URLs, not that the primary is dead.
Measured over all five shows that carry one: **four primaries return 200 and one
404s**. Preferring art2 would swap four working share cards to fix one.

Live coverage is small and real: 5 of 1,287 shows.

**⚠️ SHOW ROWS REFRESH ON THE EPISODE CADENCE SINCE 2026-09-04.** *Reed's ask*,
after Chad and Reeds Podcast showed its July cover for a month while every
episode row already had the new one: a show was read from Podcast Index once,
at first sight, and never again. `db.shows_needing_refresh` now re-reads a
boosted show daily when it has an episode aired in the last 90 days and
monthly otherwise — the same `_episode_stale_binds` as the episode gate, so
the two cannot disagree about "recent" — capped at `SHOW_BATCH` (25) a tick,
recent first, then longest-unchecked, then newest-aired. `upsert_show` became
content-aware with it: `checked_at` moves on every look, `updated_at` only
when one of `SHOW_CONTENT_COLS` differs, so the D1 drift pass and the publish
gate see a change only when there is one. A miss keeps the row.

**⚠️ `podcasts/byguid` RETURNS ONE FEED PER GUID AND IT IS NOT ALWAYS THE LIVE
ONE.** Found 2026-09-06 on Stacker News Live: the show moved from Anchor to a
Fountain-hosted feed in August 2025 and kept its guid, so Podcast Index holds
two feed ids under one `podcastGuid` and `byguid` answers the Anchor one, 404
since 2025-08-26 and still `dead: 0`. Every episode after the move exists only
on the other feed, so `episodes/byguid` with our feed id said "not found" and
the raw-RSS fallback fetched a 404, on every retry, for a year; the refresh
above then wrote the dead feed back over the live one the Fountain resolver had
set two days earlier. `enrich.resolve_show` now takes a **live sibling** when
`byguid`'s feed does not answer (`lastHttpStatus` outside 2xx/3xx): found
through the dead entry's own `itunesId`, then a title search, accepted only
when it names the same `podcastGuid` and answers, and re-read in full through
`byfeedid` because the thin objects drop `medium`. Anything else keeps
`byguid`'s answer as before. `bots/global-boost-scan/test_enrich_sibling.py`
pins the rule. Measured over the 388 shows boosted in the prior 120 days it was
the only show in this state; seven others sit on PI status 667 with no sibling.

