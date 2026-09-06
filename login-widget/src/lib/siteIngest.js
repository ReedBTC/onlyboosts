/**
 * Hand a just-published boost note to the site's own index, so it is on the
 * feeds now rather than after the collector's next five-minute cycle.
 *
 * The client half of `functions/api/v1/boosts/ingest.js`, which carries the
 * reasoning. Two rules from it that this side enforces:
 *
 * ⚠️ ONLY A NOTE THAT REACHED A RELAY IS HANDED OVER. The index counts notes
 * on Nostr; a note no relay acked is not on Nostr, and a row for it would be
 * an orphan the collector sweeps a few hours later — the boost would appear,
 * then vanish. The caller passes `publishSignedKindOne`'s answer and this
 * function does nothing when it was not published.
 *
 * ⚠️ EVERY FAILURE HERE IS INVISIBLE TO THE DONOR, and that is deliberate.
 * The sats are gone and the note is published; the only thing at stake is
 * whether the boost shows up in seconds or in minutes, and the collector
 * closes that gap on its own. So this never throws, never changes the share
 * state, and is called without being awaited.
 */

export const SITE_INGEST_ENDPOINT = '/api/v1/boosts/ingest'

/**
 * @param {object} signedEvent  the published kind-1, as returned by the signer
 * @param {{ published?: boolean }} publishResult  `publishSignedKindOne`'s answer
 * @param {object|null} episode  the modal's episode payload (titles are the
 *   only fields read; they seed a stub row when the index has never seen the
 *   episode, and the collector replaces the stub on its next tick)
 * @returns {Promise<object|null>} the endpoint's answer, or null
 */
export async function ingestBoostNote(signedEvent, publishResult, episode) {
  if (!publishResult?.published) return null
  if (!signedEvent?.id || !signedEvent?.sig) return null
  // A donation carries no podcast and the endpoint refuses it by shape; the
  // check here only saves the request.
  if (!episode?.podcastGuid) return null
  try {
    const res = await fetch(SITE_INGEST_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The modal may close before this resolves; keepalive lets the request
      // outlive the page the way a beacon does.
      keepalive: true,
      body: JSON.stringify({
        event: signedEvent,
        episode: {
          title: episode.episodeTitle || null,
          showTitle: episode.showTitle || null,
        },
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.info('[lb] boost not indexed at the edge; the collector will catch up', res.status, data?.error || '')
      return null
    }
    return data
  } catch (e) {
    console.info('[lb] boost not indexed at the edge; the collector will catch up', e?.message || e)
    return null
  }
}
