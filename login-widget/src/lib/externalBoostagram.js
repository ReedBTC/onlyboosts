/**
 * Boostagram + Nostr-note builders for the EXTERNAL-episode boost flow.
 *
 * DELIBERATELY SEPARATE from lib/boostagram.js. That file drives the LB boost
 * (kind 30078 metadata for the LB bot, LB-branded kind-1 share). This file has
 * nothing to do with LB stats/bots: external boosts publish no 30078, and the
 * kind-1 note carries the *external* show's guid tags — none of the
 * OnlyBoostsEp / site-feed markers the site pipeline filters on.
 *
 * Wire format mirrors Boost Me Bitch / the Podcasting 2.0 boostagram spec so
 * the podcasters' tooling (Helipad, etc.) parses our boosts like any other.
 */

const TLV_BOOSTAGRAM = 7629169  // Podcasting 2.0 TLV record for the boostagram JSON
export const MAX_MESSAGE_CHARS = 200  // match Boost Me Bitch's message cap
// Rides in the TLV record, so it is what the recipient's Helipad (or any other
// boostagram reader) shows as the sending app. Left as LB's on fork; every
// boost sent before this was mislabelled to the podcaster.
const APP_NAME = 'OnlyBoosts'

// Hex-encode a UTF-8 string (browser — no Buffer).
export function hexEncode(str) {
  return [...new TextEncoder().encode(str)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 32-byte random preimage, hex. Some NWC wallets (Zeus embedded node) require
// the client to supply the keysend preimage; wallets that generate their own
// ignore it and return theirs.
export function randomPreimageHex() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Build a Podcasting 2.0 boostagram for a single leg.
 * @param {object} p
 * @param {number} p.legMsats     - this leg's amount (msats)
 * @param {number} p.totalMsats   - the whole boost's amount (msats)
 * @param {string} [p.message]
 * @param {string} [p.senderName]
 * @param {string} [p.senderPubkey] - hex pubkey when the booster is signed in
 * @param {string} [p.showTitle]
 * @param {string} [p.episodeTitle]
 * @param {string} [p.podcastGuid]
 * @param {string} [p.itemGuid]
 * @param {string} [p.url]         - the Boost Me Bitch episode URL
 * @param {string} [p.recipientName]
 * @param {string} [p.boostUuid]
 */
export function buildBoostagram({
  legMsats, totalMsats, message, senderName, senderPubkey,
  showTitle, episodeTitle, podcastGuid, itemGuid, url, recipientName, boostUuid,
}) {
  const b = {
    action: 'boost',
    app_name: APP_NAME,
    value_msat: legMsats,
    value_msat_total: totalMsats,
    ts: 0,
  }
  const msg = (message || '').trim()
  if (msg) b.message = msg.slice(0, MAX_MESSAGE_CHARS)
  if (senderName) b.sender_name = senderName
  if (senderPubkey) b.sender_id = senderPubkey
  if (showTitle) b.podcast = showTitle
  if (episodeTitle) b.episode = episodeTitle
  if (podcastGuid) b.guid = podcastGuid
  if (itemGuid) b.episode_guid = itemGuid
  if (url) { b.url = url; b.boost_link = url }
  if (recipientName) b.name = recipientName
  if (boostUuid) b.uuid = boostUuid
  return b
}

// NWC pay_keysend TLV records — values HEX-encoded per NIP-47.
export function toTlvHex(boostagram, recipient) {
  const records = [{ type: TLV_BOOSTAGRAM, value: hexEncode(JSON.stringify(boostagram)) }]
  if (recipient.customKey && recipient.customValue) {
    const ck = Number(recipient.customKey)
    if (Number.isFinite(ck)) records.push({ type: ck, value: hexEncode(recipient.customValue) })
  }
  return records
}

// WebLN keysend customRecords — PLAIN UTF-8. WebLN providers (Alby, Mutiny)
// hex-encode internally; pre-hexing here double-encodes and the receiver
// can't JSON.parse the boostagram.
export function toWeblnRecords(boostagram, recipient) {
  const records = { [String(TLV_BOOSTAGRAM)]: JSON.stringify(boostagram) }
  if (recipient.customKey && recipient.customValue) records[recipient.customKey] = recipient.customValue
  return records
}

/**
 * Unsigned kind-1 "I boosted" note for an external episode. Uses the external
 * show's NIP-73 guid tags + the Boost Me Bitch episode URL; keeps
 * client=onlyboosts.social; NO `nostr:` mention (external shows have no
 * Nostr identity we can vouch for). Published only when the booster is signed
 * in (user-signed), after settlement confirms — the caller enforces that.
 *
 * ⚠️ `paidSats` IS WHAT ACTUALLY SETTLED, NOT WHAT THE DONOR TYPED. A boost
 * distributes across a show's value block and any leg of it can fail, so the
 * two numbers differ on every partial. Reporting the intended amount credits
 * the donor with sats no recipient received, and because OnlyBoosts indexes
 * its own notes, that number then becomes a row in this site's own dataset —
 * the `amount` tag below is exactly what the collector reads. The caller
 * recomputes this from live leg state at the moment of sharing, so a leg that
 * succeeded on retry is counted.
 *
 * `legsPaid` / `legsTotal` disclose the shortfall in words. `legsTotal`
 * excludes legs allocated zero sats: a leg that was never attempted did not
 * fail, and counting it would understate the outcome.
 */
export function buildExternalNoteTemplate({
  paidSats, legsPaid, legsTotal, message, showTitle, episodeTitle, podcastGuid, itemGuid, bmbUrl,
}) {
  const sats = Number(paidSats) || 0
  const paid = Number(legsPaid) || 0
  const total = Number(legsTotal) || 0
  const msg = (message || '').trim()
  const showEp = episodeTitle
    ? `${showTitle || 'a podcast'} • ${episodeTitle}`
    : (showTitle || 'a podcast')
  const lines = [`⚡Just boosted ${sats.toLocaleString()} sats 📱 via onlyboosts.social`]
  // "splits" rather than "legs": it is the word the value-block spec and the
  // podcast apps use, and this line is read by people outside this codebase.
  if (total > 0 && paid < total) lines.push(`⚠️ ${paid} of ${total} splits paid`)
  if (msg) lines.push(`💬 "${msg.slice(0, MAX_MESSAGE_CHARS)}"`)
  lines.push('')
  lines.push(`🎙️ ${showEp}`)
  if (bmbUrl) lines.push(bmbUrl)

  const tags = [
    ['t', 'boost'],
    ['t', 'podcast'],
    // Topic tags NIP-73 boost consumers key on to tell a boost note from any
    // other kind 1. Our own collector also accepts a bare `t=boost`
    // (classify.py#BOOST_TOPIC_TAGS), but nothing else does, so a note without
    // these is invisible to every indexer but ours.
    ['t', 'boostagram'],
    ['t', 'value4value'],
    ['client', 'onlyboosts.social'],
  ]
  if (bmbUrl) tags.push(['r', bmbUrl])
  if (podcastGuid) { tags.push(['i', `podcast:guid:${podcastGuid}`]); tags.push(['k', 'podcast:guid']) }
  if (itemGuid) { tags.push(['i', `podcast:item:guid:${itemGuid}`]); tags.push(['k', 'podcast:item:guid']) }
  tags.push(['amount', String(Math.round(sats * 1000))])

  return { kind: 1, created_at: Math.floor(Date.now() / 1000), content: lines.join('\n'), tags }
}
