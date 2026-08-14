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
import { coverChain } from '/assets/js/cover-art.js?v=ob-v59'

const BASE = '/api/data/'

// The manifest changes hourly at most; the month archives are immutable once
// written. Cache per-path in memory for the page's lifetime so switching tabs
// doesn't refetch a 1MB shard.
const cache = new Map()

/**
 * Fetch one JSON path under the data feed. Rejects on anything that isn't a
 * parseable JSON body, so callers never have to guess.
 */
export async function fetchJson(path) {
  if (cache.has(path)) return cache.get(path)

  const promise = (async () => {
    const resp = await fetch(BASE + path, { headers: { Accept: 'application/json' } })
    if (!resp.ok) throw new Error(`data ${path}: HTTP ${resp.status}`)
    // Defence in depth — see the module note. The proxy already enforces this.
    const ctype = resp.headers.get('content-type') || ''
    if (!ctype.includes('json')) throw new Error(`data ${path}: not JSON (${ctype})`)
    return resp.json()
  })()

  cache.set(path, promise)
  // A failed fetch shouldn't poison the cache for the rest of the session —
  // the user may just have been offline for a moment.
  promise.catch(() => cache.delete(path))
  return promise
}

/** The manifest: totals, the month list, and where everything lives. */
export function getManifest() {
  return fetchJson('index.json')
}

/** Most recent ~1,000 boosts, already newest-first. */
export async function getLatestBoosts() {
  const m = await getManifest()
  const file = m?.boosts?.latest || 'latest.json'
  const d = await fetchJson(file)
  return normalizeBoosts(d)
}

/**
 * Month archives, newest month first, as listed in the manifest.
 * @returns {Promise<Array<{month:string,count:number,file:string}>>}
 */
export async function getBoostMonths() {
  const m = await getManifest()
  const months = Array.isArray(m?.boosts?.months) ? m.boosts.months : []
  return months
    .filter((x) => x && typeof x.file === 'string' && typeof x.month === 'string')
    .sort((a, b) => (a.month < b.month ? 1 : -1))
}

/** One month archive of boosts. */
export async function getBoostMonth(file) {
  return normalizeBoosts(await fetchJson(file))
}

/** Per-show rollups, one row per podcast. */
export async function getPodcastIndex() {
  const m = await getManifest()
  const file = m?.podcasts?.index || 'podcasts/index.json'
  const d = await fetchJson(file)
  const rows = Array.isArray(d?.podcasts) ? d.podcasts : []
  return rows.filter((p) => p && typeof p.guid === 'string')
}

// ── podcast:medium ────────────────────────────────────────────────────
//
// <podcast:medium> is what separates a podcast from a music release: a "music"
// feed's items are tracks on an album, not episodes of a show. The collector
// projects the tag onto every row of podcasts/index.json, defaulting to
// "podcast" per the namespace where a feed carries none. Measured against the
// live index: 818 podcast, 465 music, 2 video.
//
// It is a property of the SHOW, so it is deliberately not on the boost record —
// the alternative is the collector stamping one show-level fact onto 22k boosts
// and rewriting every month archive. The episode-level feeds join through the
// published rollup instead. That file is ~103KB over the wire, cached for the
// page's lifetime by fetchJson above, and the show-level feeds load it anyway,
// so the join costs one request the first time and nothing after.

/** guid → medium, lowercased, from the published per-show rollup. */
export async function getShowMediums() {
  const rows = await getPodcastIndex()
  const map = new Map()
  for (const p of rows) {
    const m = str(p.medium)
    if (m) map.set(p.guid, m.toLowerCase())
  }
  return map
}

/**
 * guid → author, from the same rollup. `<itunes:author>`, which on a music
 * feed is the artist and on a podcast is whoever the publisher named there:
 * often the host, sometimes a network, occasionally a tagline.
 *
 * Verbatim, INCLUDING rows where the author merely repeats the show title
 * (~7% of them). The collector publishes it raw on purpose and each consumer
 * decides: a display surface hides the repeats, a search index does not care,
 * because matching a show by its own title is a no-op rather than a wrong hit.
 *
 * A second pass over the rows getShowMediums() already walked. Both read the
 * same cached file, so this costs no request.
 */
export async function getShowAuthors() {
  const rows = await getPodcastIndex()
  const map = new Map()
  for (const p of rows) {
    const a = str(p.author)
    if (a) map.set(p.guid, a)
  }
  return map
}

/**
 * A guid → boolean test for one side of the music / not-music split.
 *
 * `want` is 'music' (the Songs and Albums feeds) or 'other' (Episodes and
 * Shows — podcasts, plus the two video feeds, plus every show the collector
 * holds boosts for but Podcast Index can't identify). Anything falsy keeps
 * everything and costs no fetch, which is what the unsplit Boosts feeds pass.
 *
 * A show with no medium counts as not-music: the namespace's default is
 * "podcast", and filing an unidentified feed under Albums would be a claim
 * about it we can't support.
 *
 * @returns {Promise<{test:(guid:string|null)=>boolean, ok:boolean}>} `ok` is
 *   false when the rollup couldn't be read. The test then keeps everything on
 *   the 'other' side and nothing on the 'music' side, which is the right
 *   failure for each: an Episodes feed carrying a few stray tracks beats no
 *   feed at all, whereas an empty Songs feed is indistinguishable from a quiet
 *   week — so the music callers read `ok` and say what actually happened.
 */
export async function mediumPredicate(want) {
  if (!want) return { test: () => true, ok: true }
  const music = want === 'music'
  let mediums = new Map()
  let ok = true
  try {
    mediums = await getShowMediums()
  } catch (e) {
    console.warn('[ob-data] medium join unavailable', e)
    ok = false
  }
  return { test: (guid) => (mediums.get(guid) === 'music') === music, ok }
}

/** One show: { show, episodes[], boosts[] }. Takes the rollup's `file`. */
export async function getPodcastDetail(file) {
  const d = await fetchJson(file)
  return {
    show: d?.show || null,
    episodes: Array.isArray(d?.episodes) ? d.episodes : [],
    boosts: normalizeBoosts(d),
  }
}

// ── normalization ─────────────────────────────────────────────────────
//
// The wire record is:
//   { id, ts, sats, src, msg, client,
//     booster{pk,npub,name,pic}, podcast{guid,title,img,feed},
//     episode{guid,title,img,date,num,url} }
//
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
 * toEpisodeShape → buildEpisodes → episodeCard run completely unchanged over a
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
