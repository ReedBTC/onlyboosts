/* OnlyBoosts data client.
 *
 * One place that knows how to talk to the collector's feed, so the four
 * views don't each re-derive paths or re-handle the upstream's quirks.
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

function normalizeBoosts(d) {
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

/** Short, human display name for a booster with the documented fallback. */
export function boosterLabel(booster) {
  if (booster?.name) return booster.name
  if (booster?.npub) return booster.npub.slice(0, 12) + '…'
  return (booster?.pk || '').slice(0, 8) + '…'
}
