/* OnlyBoosts data client — the static half.
 *
 * One place that knows how to talk to the collector's feed, so the four
 * views don't each re-derive paths or re-handle the upstream's quirks.
 *
 * There are two backends. This module is the static one: immutable JSON
 * shards on the CDN, which is where the two Global views get their data.
 * The live query API (D1, /api/v1/*) is `ob-live.js` — it exists because a
 * follow-scoped feed can't be served from a cacheable shard, since the
 * audience differs per visitor. Both return the same record shape, and
 * `normalizeBoosts` below is exported so both normalize it identically.
 *
 * Everything goes through /api/data/* (functions/api/data/[[path]].js), which
 * validates the path and guarantees the body is real JSON. That matters
 * because the upstream host answers a MISSING FILE with
 * `200 text/plain "Please use a Nostr client to connect."` — the relay's
 * catch-all, not a 404. The proxy turns that into a 404 for us, but
 * fetchJson below re-checks content-type anyway: if anyone ever points this
 * module straight at the origin, a text/plain body must not parse as data.
 *
 * Filenames come from the manifest (index.json), never built by hand — the
 * collector owns its own layout and the manifest is how it publishes it. The
 * one exception is the per-show shard, and even there the rollup carries a
 * `file` pointer we use verbatim.
 */
// ⚠️ RELATIVE AND STAMPED, NOT ABSOLUTE, and that is deliberate: this module is
// imported by the Pages Functions that server-render episode cards as well as by
// the browser. esbuild strips the query and reads the file off disk; the browser
// resolves it against this module's own stamped URL and gets
// `/assets/js/cover-art.js?v=<VERSION>`, exactly as an absolute import would. An
// absolute `/assets/js/…` specifier cannot be bundled, so it is the one form a
// two-sided module may not use. See the header of episode-card.js, and
// scripts/stamp-assets.js, which stamps both shapes.
import { coverChain } from './cover-art.js?v=ob-v83'

/* ⚠️ THE FETCHING HALF OF THIS MODULE IS GONE, and this is what it was.
 *
 * `fetchJson`, `getManifest`, `getLatestBoosts`, `getBoostMonths`,
 * `getBoostMonth`, `getPodcastIndex`, `getShowMediums`, `getShowAuthors`,
 * `getPodcastDetail` and `mediumPredicate` read the collector's static shards
 * under /api/data/. Every feed on the site moved to the D1 query API, and by the
 * time they were removed NOT ONE of them had a caller — verified per function,
 * and including the ones this file called internally, which is what hid
 * `mediumPredicate`: three modules and CLAUDE.md still referred to it as the
 * live medium split, but all four references were COMMENTS.
 *
 * They were kept for a while on the reasoning that the shards remain a published
 * dataset. That is still true and is unaffected: `functions/api/data/[[path]].js`
 * still proxies them and /about still reads meta.json. Publishing a dataset does
 * not require shipping an unused client for it to every visitor.
 *
 * `git show <this commit>^:assets/js/ob-data.js` has the whole thing if a reader
 * is ever wanted again.
 *
 * WHAT REMAINS IS SHAPE ONLY. normalizeBoosts, toEpisodeShape, boosterLabel and
 * episodeApiToBoosts are why every consumer downstream of a fetch sees one model,
 * and they have callers throughout.
 */

// Almost every display field is nullable — measured against a 1,000-row
// sample: msg 16%, booster.pic 15%, episode.title 11%, episode.num 61%,
// podcast.guid 2%. So this flattens to a shape where the *only* fields a
// caller may assume are id, ts and booster.pk, and everything else is
// explicitly nullable. Callers must still handle the nulls; the point is
// that they're uniform.
//
// Two shape notes worth keeping:
//   - episode.guid is sometimes a URL rather than a UUID, so it's only ever
//     used as an opaque key, never parsed.
//   - the per-show shard stringifies some numerics ("9", "55987", "None"),
//     which is why num() exists rather than trusting typeof.
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v) {
  return (typeof v === 'string' && v.trim()) ? v : null
}

export function normalizeBoosts(d) {
  const arr = Array.isArray(d?.boosts) ? d.boosts : (Array.isArray(d) ? d : [])
  const out = []
  for (const b of arr) {
    const id = str(b?.id)
    const pk = str(b?.booster?.pk)
    const ts = num(b?.ts)
    // Without an id we can't render actions or dedupe; without a pubkey we
    // can't attribute or follows-filter; without a timestamp we can't order.
    if (!id || !pk || ts == null) continue
    out.push({
      id: id.toLowerCase(),
      ts,
      sats: num(b?.sats),
      src: str(b?.src),
      msg: str(b?.msg),
      client: str(b?.client),
      booster: {
        pk: pk.toLowerCase(),
        npub: str(b?.booster?.npub),
        name: str(b?.booster?.name),
        pic: str(b?.booster?.pic),
      },
      podcast: {
        guid: str(b?.podcast?.guid),
        title: str(b?.podcast?.title),
        img: str(b?.podcast?.img),
        // Second-chance artwork: the OTHER of the feed's two artwork URLs
        // (RSS <image><url> vs <itunes:image>), published only when it differs
        // from `img`. Nullable like everything else here. See cover-art.js.
        art2: str(b?.podcast?.art2),
        feed: str(b?.podcast?.feed),
      },
      episode: {
        guid: str(b?.episode?.guid),
        title: str(b?.episode?.title),
        img: str(b?.episode?.img),
        date: num(b?.episode?.date),
        num: num(b?.episode?.num),
        url: str(b?.episode?.url),
      },
    })
  }
  // latest.json already arrives newest-first, but the month archives and the
  // per-show shards make no such promise — sort so callers never have to care.
  out.sort((a, b) => b.ts - a.ts)
  return out
}

/**
 * Project normalized rows into the flat {boosts, episodes, shows} shape the
 * episode feed was written against.
 *
 * feeds-podcasts.js predates this data feed: it groups a flat boost list by
 * `item_guid` and looks episode/show metadata up in side tables. The new feed
 * embeds that metadata in every boost instead. Rather than rewrite a working
 * UI around the new shape — and lose the boost drawer, range filters and sort
 * menu with it — this adapts the data to the consumer.
 *
 * Two fields the new feed doesn't carry, and what happens without them:
 *   - `feed_id` / `itunes_id` (Podcast Index numerics) — drive the "listen on"
 *     links and the /api/value split lookup. The proxy resolves a feed id from
 *     `feedUrl` instead, so boosting still works; the pod.link / PI links are
 *     simply omitted for shows we can't identify.
 *   - `description` / `enclosure_type` — only in the per-show shard, which is
 *     too expensive to fetch per card. The card degrades to no blurb and lets
 *     the browser sniff the audio type.
 */
export function toEpisodeShape(rows) {
  const boosts = []
  const episodes = {}
  const shows = {}
  // Booster identities ride along in every record now, so the consumer can
  // seed its profile map from this and skip the network lookup entirely.
  const profiles = new Map()

  for (const b of rows) {
    const itemGuid = b.episode.guid
    // The episode feed keys everything off item_guid; a boost without one
    // can't be grouped into a card at all.
    if (!itemGuid) continue
    const podGuid = b.podcast.guid || `unknown:${itemGuid}`

    boosts.push({
      event_id: b.id,
      booster_pubkey: b.booster.pk,
      booster_npub: b.booster.npub,
      created_at: b.ts,
      sats: b.sats || 0,
      message: b.msg || '',
      item_guid: itemGuid,
      podcast_guid: podGuid,
      item_url: b.episode.url,
      show_url: b.podcast.feed,
      client: b.client,
    })

    if (!episodes[itemGuid]) {
      episodes[itemGuid] = {
        item_guid: itemGuid,
        podcast_guid: podGuid,
        title: b.episode.title,
        // `image` stays the single primary URL every existing consumer reads.
        // `imageChain` is the ordered fallback for the ones that want it: an
        // episode's own art first, then the show's two. cover-art.js walks it.
        image: b.episode.img || b.podcast.img,
        imageChain: coverChain(b.episode.img, b.podcast.img, b.podcast.art2),
        published: b.episode.date,
        episode_number: b.episode.num,
        enclosure_url: b.episode.url,
        // Deliberately absent: description, enclosure_type, feed_id.
      }
    }
    if (b.booster.name || b.booster.pic) {
      if (!profiles.has(b.booster.pk)) {
        profiles.set(b.booster.pk, {
          pubkey: b.booster.pk,
          name: b.booster.name,
          picture: b.booster.pic,
          npub: b.booster.npub,
        })
      }
    }

    if (!shows[podGuid]) {
      shows[podGuid] = {
        podcast_guid: podGuid,
        title: b.podcast.title,
        image: b.podcast.img,
        imageChain: coverChain(b.podcast.img, b.podcast.art2),
        feed_url: b.podcast.feed,
      }
    }
  }
  return { boosts, episodes, shows, profiles }
}

/** Short, human display name for a booster with the documented fallback. */
export function boosterLabel(booster) {
  if (booster?.name) return booster.name
  if (booster?.npub) return booster.npub.slice(0, 12) + '…'
  return (booster?.pk || '').slice(0, 8) + '…'
}

/* API episode records → flat boost records, so the existing chain can run.
 *
 * /api/v1/episodes?include=boosts returns each episode already grouped, with
 * its notes inline and the podcast/episode blocks stripped from them — the
 * parent carries those, so repeating them per note would be the bulk of the
 * response. This puts them back, which is what lets normalizeBoosts →
 * toEpisodeShape → buildEpisodes → episodeCardHtml run completely unchanged over a
 * corpus that came from D1 rather than from the static shards.
 *
 * ⚠️ THE FIGURES DO NOT COME FROM THESE ROWS. Inline notes are capped at 50 per
 * episode while the record's own `boosts` / `boosters` / `sats` are the true
 * all-time totals, so recounting the rows would understate the one episode in
 * the index that exceeds the cap. `totals` is returned alongside for the caller
 * to stamp back onto the built items: notes from the rows, numbers from the
 * aggregates.
 *
 * An episode with no inline notes still yields its totals, so a card can be
 * built for it even though its drawer would be empty.
 */
export function episodeApiToBoosts(records) {
  const boosts = []
  const totals = new Map()
  for (const r of Array.isArray(records) ? records : []) {
    const guid = r?.guid
    if (!guid) continue
    const show = r.show || {}
    // The blocks every inline note is missing, rebuilt once per episode and
    // shared by reference — normalizeBoosts reads them and never mutates.
    const podcast = {
      guid: show.guid || null,
      title: show.title || null,
      img: show.img || null,
      art2: show.art2 || null,
      feed: show.feed || null,
    }
    const episode = {
      guid,
      title: r.title || null,
      img: r.img || null,
      date: r.date || null,
      num: r.num || null,
      url: r.url || null,
    }
    totals.set(guid, {
      boosts: num(r.boosts) || 0,
      boosters: num(r.boosters) || 0,
      sats: num(r.sats) || 0,
      latest: num(r.latest) || 0,
      // The signal that this episode's drawer is a prefix rather than the whole
      // of it: the endpoint caps inline notes at 50 and reports the true count.
      truncated: (r.boosts_inline?.length || 0) < (num(r.boosts) || 0),
    })
    for (const b of r.boosts_inline || []) {
      boosts.push({ ...b, podcast, episode })
    }
  }
  return { boosts, totals }
}
