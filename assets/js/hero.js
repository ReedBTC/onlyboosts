/* The discovery homepage's FEATURED CAROUSEL — facts, two-sided.
 *
 * Reed's call, 2026-10-19 (after Rotten Tomatoes, IMDb and Fountain's
 * discovery tab): a rotating hero at the top of the front door whose slides
 * are the FIRST PLACE OF EACH GENERIC RAIL, in the rails' order. Nothing is
 * hand-picked and nothing is personal, so the hero is the same for every
 * visitor, signed in or out, and functions/index.js renders it at the edge
 * from rows the rails already fetched: a slide can never disagree with the
 * tile under it. One slide per rail, nine today; a rail with nothing in it
 * has no slide.
 *
 * This module is the slide and the carousel's markup. The Function builds a
 * SLIDE SPEC per rail with the mappers below (showSlide, episodeSlide,
 * artistSlide, memberSlide), looks up the one thing the rails do not carry
 * (a description), and renders heroHtml(); discover.js runs the rotation,
 * the artwork fallback and the Boost pill, and rebuilds a slide for a rail
 * the edge could not fill with the same mappers, so the two sides agree by
 * construction. See "One Module, Imported From Both Sides" in CLAUDE.md.
 *
 * ⚠️ TWO-SIDED RULES: siblings imported as './x.js?v=…', no clock reads, no
 * unpinned locale, nothing from the DOM.
 *
 * ⚠️ THE BOOST PILL IS CHROME. It ships hidden; discover.js reveals it and
 * hands a click to the SAME handlers the feed cards use (show-card-actions'
 * onShowBoost for a show or album, episode-card-actions' onBoostClick for an
 * episode or song), which read the show off the slide's own data attributes
 * exactly as they read a card's. Those attribute names are their contract.
 */
import { coverChain } from './cover-art.js?v=ob-v246'
import { showPageHref, episodePageHref, publisherPageHref } from './show-link.js?v=ob-v246'
import { boosterPageHref } from './booster-link.js?v=ob-v246'
import { episodeBoostLink } from './episode-link.js?v=ob-v246'
import { statsLine, rankTripletHtml } from './rail-tile.js?v=ob-v246'

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
function attr(name, v) { return v ? ` ${name}="${esc(v)}"` : '' }

/** The eyebrow over each slide: the rail's rule in five words. Keyed by the
 *  rail so the edge and the browser print the same line for the same rail. */
export const EYEBROWS = {
  'shows-week': '#1 Podcast This Week',
  'albums-month': '#1 Album This Month',
  'hpw-week': 'Leading the #40HPW Challenge This Week',
  'episodes-year': '#1 Episode This Year',
  'songs-year': '#1 Song This Year',
  'artists-week': '#1 Artist This Week',
  'new-shows': 'New and Noteworthy Podcast',
  'new-music': 'New and Noteworthy Music',
  'movers': 'Biggest Climber This Week',
  'podroll': 'Most Recommended by Podcasters',
}

/* ── Row → slide spec, one mapper per subject. Each accepts the row shape
 * its rail's endpoint answers (the weekly chart's columns or the ranked
 * endpoints' records), like the tile mappers in rail-tile.js. ── */

/** A show or album row (weekly chart, ranked podcasts, or a plain podcasts
 *  row). `line` overrides the figure line (the New, Movers and Podroll rails
 *  say something other than the chart figures). */
export function showSlide(key, r, { eyebrow = EYEBROWS[key], line = null, href = showPageHref(r.guid), medium = r.medium } = {}) {
  const album = (medium || 'podcast') === 'music'
  return {
    key, kind: album ? 'album' : 'show', eyebrow, guid: r.guid, title: r.title, href,
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: album ? '🎵' : '🎙',
    ranks: rankTripletHtml(r),
    line: line ?? statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats }),
    from: album && r.author ? { title: r.author, href: null } : null,
    cta: album ? 'Open the album' : 'Open the show',
    boost: href ? { noun: album ? 'album' : 'show', guid: r.guid, feed: r.feed ?? r.feed_url ?? null, title: r.title } : null,
  }
}

/** An episode or song record (the ranked episodes endpoint's shape). */
export function episodeSlide(key, r, { eyebrow = EYEBROWS[key] } = {}) {
  const song = (r.show?.medium || 'podcast') === 'music'
  const show = r.show || {}
  return {
    key, kind: song ? 'song' : 'episode', eyebrow, guid: r.guid, title: r.title,
    href: episodePageHref(r.guid, r.title),
    img: r.img || show.img, art2: show.art2, glyph: song ? '🎵' : '🎙',
    ranks: rankTripletHtml(r),
    line: statsLine({ boosters: r.boosters, sats: r.sats }),
    from: show.title ? { title: show.title, href: show.guid ? showPageHref(show.guid) : null } : null,
    cta: song ? 'Open the song' : 'Open the episode',
    boost: (show.guid || show.feed) ? {
      noun: song ? 'song' : 'episode', guid: r.guid, showGuid: show.guid || null, feed: show.feed || null,
      showTitle: show.title || '', title: r.title,
      boostUrl: episodeBoostLink({ itemGuid: r.guid, title: r.title, podcastGuid: show.guid || null, feedId: null }) || '',
    } : null,
  }
}

/** An artist row (the weekly artists chart). No boost: the tier has no
 *  boost button anywhere (PI cannot resolve most publisher feeds). */
export function artistSlide(key, r, { eyebrow = EYEBROWS[key] } = {}) {
  return {
    key, kind: 'artist', eyebrow, guid: r.guid, title: r.title, href: publisherPageHref(r.guid),
    img: r.image ?? r.img, art2: r.artwork ?? r.art2, glyph: '🎤',
    ranks: rankTripletHtml(r),
    line: statsLine({ boosters: r.booster_count ?? r.boosters, sats: r.total_sats ?? r.sats }),
    from: null, cta: 'Open the artist', boost: null,
  }
}

/** A #40HPW member (the hours endpoint's member shape): a person, round. */
export function memberSlide(key, m, goalHours = 40, { eyebrow = EYEBROWS[key] } = {}) {
  const h = Number(m.seconds) / 3600
  const eps = Number(m.episodes) || 0
  return {
    key, kind: 'member', eyebrow, pk: m.pk || null, title: m.name || (m.npub ? m.npub.slice(0, 12) + '…' : 'Unknown'),
    href: boosterPageHref(m.npub, m.pk),
    img: m.pic, art2: null, glyph: '👤', person: true, gold: h >= goalHours,
    ranks: null,
    line: `${h.toFixed(1)} hours of podcasts boosted this week · ${eps} episode${eps === 1 ? '' : 's'}`,
    from: null, cta: 'Open the profile', boost: null,
  }
}

/* ── The markup ── */

function boostAttrs(b, kind) {
  if (!b) return ''
  if (kind === 'episode' || kind === 'song') {
    return attr('data-guid', b.guid) + attr('data-show-guid', b.showGuid) + attr('data-feed-url', b.feed)
      + attr('data-show-title', b.showTitle) + attr('data-title', b.title) + attr('data-boost-url', b.boostUrl)
      + ` data-noun="${esc(b.noun)}"`
  }
  return attr('data-guid', b.guid) + attr('data-feed-url', b.feed) + attr('data-title', b.title) + ` data-noun="${esc(b.noun)}"`
}

/** One slide. `i` is its place (the first slide's images load eagerly: it is
 *  the page's largest paint); `n` the count, for the accessible label. */
export function slideHtml(s, i = 0, n = 1) {
  const chain = coverChain(s.img, s.art2)
  const eager = i === 0
  const art = chain.length
    ? `<img class="hero-art" alt="" referrerpolicy="no-referrer" src="${esc(chain[0])}"${attr('data-art2', chain[1])}${eager ? ' fetchpriority="high"' : ' loading="lazy"'} />`
    : `<span class="hero-art hero-art--none" aria-hidden="true">${esc(s.glyph || '🎙')}</span>`
  const bg = chain.length
    ? `<img class="hero-bg" alt="" aria-hidden="true" referrerpolicy="no-referrer" src="${esc(chain[0])}"${eager ? '' : ' loading="lazy"'} />`
    : ''
  const title = s.href
    ? `<a href="${esc(s.href)}">${esc(s.title || 'Untitled')}</a>`
    : esc(s.title || 'Untitled')
  const from = s.from
    ? `<p class="hero-from">${s.from.href ? `<a href="${esc(s.from.href)}">${esc(s.from.title)}</a>` : esc(s.from.title)}</p>`
    : ''
  const line = (s.ranks || s.line)
    ? `<p class="hero-line">${s.ranks ? `<span class="hero-ranks rt-ranks">${s.ranks}</span>` : ''}${s.ranks && s.line ? '<span class="hero-dot" aria-hidden="true">·</span>' : ''}${s.line ? `<span>${esc(s.line)}</span>` : ''}</p>`
    : ''
  const desc = s.desc ? `<p class="hero-desc">${esc(s.desc)}</p>` : ''
  const open = s.href ? `<a class="hero-btn" href="${esc(s.href)}">${esc(s.cta || 'Open')}</a>` : ''
  const boost = s.boost
    ? `<button type="button" class="ob-boost-pill hero-boost" data-hero-boost hidden title="Boost ${esc(s.title || '')}" aria-label="Boost ${esc(s.title || '')}">Boost</button>`
    : ''
  const cls = `hero-slide${s.person ? ' hero-slide--person' : ''}${s.gold ? ' hero-slide--gold' : ''}`
  return `<article class="${cls}" data-slide="${esc(s.key)}" data-kind="${esc(s.kind)}"${boostAttrs(s.boost, s.kind)} aria-roledescription="slide" aria-label="${i + 1} of ${n}: ${esc(s.eyebrow)}">`
    + bg
    + `<div class="hero-body">`
    + (s.href ? `<a class="hero-art-link" href="${esc(s.href)}" tabindex="-1" aria-hidden="true">${art}</a>` : art)
    + `<div class="hero-text">`
    + `<p class="hero-eyebrow">${esc(s.eyebrow)}</p>`
    + `<h2 class="hero-title">${title}</h2>`
    + from + line + desc
    + (open || boost ? `<div class="hero-actions">${open}${boost}</div>` : '')
    + `</div></div></article>`
}

/** The carousel: the slides in the order given, the arrows and the dots
 *  (hidden until discover.js can drive them). Empty input renders nothing:
 *  the Function then leaves its marker for the browser. */
export function heroHtml(slides) {
  if (!slides.length) return ''
  const n = slides.length
  const dots = slides.map((s, i) =>
    `<li><button type="button" data-hero-to="${i}" aria-label="Slide ${i + 1} of ${n}: ${esc(s.eyebrow)}"${i === 0 ? ' aria-current="true"' : ''}></button></li>`
  ).join('')
  return `<section class="hero" id="hero" data-hero aria-roledescription="carousel" aria-label="Featured">`
    + `<div class="hero-slides" data-hero-slides>${slides.map((s, i) => slideHtml(s, i, n)).join('')}</div>`
    + `<button type="button" class="hero-arrow hero-arrow--prev" data-hero-dir="-1" aria-label="Previous" hidden>‹</button>`
    + `<button type="button" class="hero-arrow hero-arrow--next" data-hero-dir="1" aria-label="Next" hidden>›</button>`
    + `<ol class="hero-dots" data-hero-dots hidden>${dots}</ol>`
    + `</section>`
}
