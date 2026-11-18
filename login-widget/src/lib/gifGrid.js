// VENDORED from https://gifs.nostr.build/developers/grid on 2026-11-12, as
// that guide asks ("Copy them, then change the look in the CSS"). Everything
// below this header is nostr.build's file, byte for byte, so a later copy can
// be diffed against it; do not edit it here. Its styles are the `.gif-grid`
// block in `src/styles.css`, and `components/GifPicker.jsx` is the only caller.
//
// gif-grid.js: a GIF grid for the gifs.nostr.build API. One file, no
// dependencies. Why each rule is here: https://gifs.nostr.build/developers/grid
//
//   import { gifGrid } from './gif-grid.js'
//   const grid = gifGrid(document.querySelector('.gif-grid'), {
//     onPick: (gif) => insertIntoNote(gif.url),
//   })
//   await grid.search('cat')
//
// Each tile shows its blurred placeholder until it comes near the screen.
// There its MP4 loads into a <video> from a small pool and waits, paused on
// its first frame. It plays as soon as a tenth of it is on screen. Only a
// tile with no MP4 (or one that failed) uses an <img>: its animated preview,
// or its still where nothing should move. Use it with gif-grid.css.

const API = 'https://gifs.nostr.build'

/** How far from the screen a tile's video loads: half a screen each way. */
const NEAR = '50% 0px'
/** How far ahead an MP4 is asked for with a HEAD, to warm the cache. */
const AHEAD = '150% 0px'
/** Near, or on screen, this long before anything loads: a tile flung past
 *  loads nothing. */
const SETTLE_MS = 150
/** How much of a tile must show before its video plays. */
const ON_SCREEN = 0.1
/** The video's fade-in, as in gif-grid.css. */
const FADE_MS = 350
/** iOS Safari loads only the metadata of a video that is not playing, so
 *  nothing is drawn. Asking for a start time makes it load and draw that
 *  frame. */
const FIRST_FRAME = '#t=0.001'
const MIN_COLUMN = 180
const GAP = 8
const SEARCH_MS = 15_000
const PRIME_MS = 60_000
const PRIMES_AT_ONCE = 3

/** Trimmed, single-spaced, lowercase, at most the API's 500 characters
 *  (UTF-16 units). Cut between characters, never inside an emoji: by
 *  grapheme where the browser can tell, by code point where it can't. The
 *  same text twice gives the same result: one spelling, one cache key. */
export function normalise(q) {
	const s = q.trim().replace(/\s+/g, ' ').toLowerCase()
	if (s.length <= 500) return s
	const parts =
		typeof Intl.Segmenter === 'function'
			? Array.from(new Intl.Segmenter().segment(s), (p) => p.segment)
			: Array.from(s)
	let out = ''
	for (const p of parts) {
		if (out.length + p.length > 500) break
		out += p
	}
	// One "character" longer than the whole limit (a letter with hundreds of
	// accents): cut it by code point rather than send nothing.
	if (!out)
		for (const c of s) {
			if (out.length + c.length > 500) break
			out += c
		}
	return out.trimEnd()
}

/** Worth a request: two characters, or one emoji or ideograph. A single
 *  Latin letter matches nothing useful and spends the reader's budget. */
export function searchable(q) {
	if ([...q].length >= 2) return true
	return /\p{Extended_Pictographic}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
		q
	)
}

const FILTERS = ['kind', 'min_size', 'max_bytes', 'quality', 'sticker']

/** The API's optional filters as query parameters, in the API's own order:
 *  the same filters always make the same URL, which the API caches once.
 *  `{ kind, min_size, max_bytes, quality, sticker }`, the API's own names
 *  and values; leave them out for the default results. */
export function filterQuery(filters) {
	if (!filters) return ''
	let out = ''
	for (const k of FILTERS) {
		const v = filters[k]
		if (
			v !== undefined &&
			v !== '' &&
			!(k === 'sticker' && String(v) === '0')
		)
			out += `&${k}=${encodeURIComponent(String(v))}`
	}
	return out
}

/** The answer said no. `status` 429 means this reader's budget is spent
 *  for the minute: say so, and don't retry. */
export class GifApiError extends Error {
	constructor(status) {
		super(`GIF search answered ${status}`)
		this.status = status
	}
}

// --- The video pool, one for the page ---------------------------------

/** Videos not in use, emptied. Every <video> WebKit makes stays in its list
 *  of media sessions until it is garbage-collected, and that list is walked
 *  on every play and pause. Made anew for each tile, or for each grid,
 *  CPU climbs search after search. So the pool is shared by every grid and
 *  never emptied: a spare video holds nothing. */
const spare = []

function borrowVideo() {
	const pooled = spare.pop()
	if (pooled) return pooled
	const v = document.createElement('video')
	v.muted = true // iOS plays by itself only while muted
	v.loop = true
	v.playsInline = true // not full screen on iPhone
	v.preload = 'auto'
	v.disablePictureInPicture = true
	v.setAttribute('aria-hidden', 'true') // the tile's button names it
	return v
}

/** Paused, emptied (its decoder and frames go: `load()` with no src), out
 *  of the page, back in the pool. Removing an element does not reliably
 *  stop it or free its media. */
function returnVideo(v) {
	v.pause()
	v.removeAttribute('src')
	v.load()
	v.removeAttribute('data-shown')
	v.removeAttribute('data-at-once')
	v.remove()
	spare.push(v)
}

/** A transparent GIF also comes as video with its transparency (`webm`,
 *  `hevc`). One file per engine, set as the video's only source: Safari
 *  and every iOS browser show the HEVC's, Chrome, Edge and Firefox the
 *  WebM's. Never let the browser choose: Safari and Firefox each claim the
 *  other one's format and then play it on black. Anything else: the MP4. */
export function videoOf(gif, ua = navigator.userAgent) {
	const hevc = media(gif.hevc)
	const webm = media(gif.webm)
	if (/AppleWebKit/.test(ua) && !/Chrome\//.test(ua) && hevc) return hevc
	if (/Chrome\/|Firefox\//.test(ua) && webm) return webm
	return media(gif.mp4)
}

/** A video URL we play: on the API's host, and with no `#` of its own (one
 *  would break the `#t=` first-frame fragment added to it). Else null. */
export function media(url) {
	return typeof url === 'string' &&
		url.startsWith(`${API}/`) &&
		!url.includes('#')
		? url
		: null
}

let h264
/** Plays our MP4s (H.264 Main). Some Linux builds can't: they still play a
 *  transparent GIF's WebM, and get the animated previews for the rest
 *  instead of one failed video per tile. Asked once, of a
 *  pooled video (a throwaway one would add a media session). */
function playsH264() {
	if (h264 === undefined) {
		const v = borrowVideo()
		h264 = v.canPlayType('video/mp4; codecs="avc1.4d401e"') !== ''
		spare.push(v)
	}
	return h264
}

/**
 * A grid in `container` (its own children are replaced).
 * Options:
 * - `api`: the API's origin.
 * - `init`: extra fetch options for the search, such as headers. A web page
 *   needs none: the API knows your site by its Origin once you register it.
 * - `root`: the element that scrolls the grid, when it isn't the page (a
 *   picker in a dialog). Its edges, not the window's, decide what is near.
 * - `maxColumns`: 2 or more. At least two columns, each at least 180 px.
 * - `onPick(gif)`: a tile was chosen. A `gifpick` event also bubbles from
 *   the container with `detail.gif`.
 * - `filters`: optional API filters, `{ kind, min_size, max_bytes, quality,
 *   sticker }` with the API's names and values (see the API reference), for
 *   example `{ sticker: '1', quality: 'good' }`. Left out: the default results.
 */
export function gifGrid(container, options = {}) {
	const {
		api = API,
		init = {},
		root = null,
		maxColumns = 4,
		onPick,
		filters,
	} = options
	const narrow = filterQuery(filters)
	const REDUCED = matchMedia('(prefers-reduced-motion: reduce)')
	/** Previews by the width of the window, not the screen's pixel density:
	 *  a 480 px preview on a phone is four times the pixels to decode. */
	const WIDE = matchMedia('(min-width: 40rem)')
	/** id -> tile */
	const tiles = new Map()
	/** Bumped by every search() call: only the latest call's answer lands. */
	let generation = 0
	/** Bumped when new results replace the tiles: a refusal from a play()
	 *  asked for older results doesn't count. Separate from `generation`, so
	 *  a call that sends nothing (an unsearchable query) doesn't make the grid
	 *  ignore a refusal for the tiles it still shows. */
	let view = 0
	/** The browser refused to start a video by itself (iOS Low Power Mode).
	 *  Stills for every tile until the next search. */
	let refused = false
	let destroyed = false

	container.replaceChildren()
	container.classList.add('gif-grid')

	// --- What a tile shows ---------------------------------------------
	/** It has a video this browser plays: a WebM (Chrome and Firefox always
	 *  have VP9), or an MP4 or HEVC where there is H.264 (every Apple browser;
	 *  a Linux WebKit without it has no HEVC either). */
	const plays = (t) => !!t.src && (t.src === t.webm || playsH264())
	const look = (t) => {
		// Far away, nothing: not even a still, or a grid in Low Power Mode
		// would load all 200 at once.
		if (!t.near) return 'none'
		if (REDUCED.matches || refused) return 'still'
		if (plays(t) && !t.videoFailed) return t.on ? 'video' : 'ready'
		// No video. A still costs no thread: it may stay while near. An
		// animated <img> only once the tile has settled on screen, never
		// ahead (WebKit keeps a decoding thread per animation).
		if (!t.preview.animated || t.animFailed) return 'still'
		return t.settled ? 'animated' : 'none'
	}

	const apply = (t) => {
		if (!tiles.has(t.gif.id)) return
		const l = look(t)
		if (l === 'video' || l === 'ready') showVideo(t, l === 'video')
		else stopVideo(t)
		const want =
			l === 'animated'
				? t.preview.animated
				: l === 'still'
					? t.preview.still
					: null
		if (want && t.img.getAttribute('src') !== want) t.img.src = want
		if (!want && t.img.hasAttribute('src')) {
			t.img.removeAttribute('src')
			if (!t.video?.hasAttribute('data-shown')) blur(t, true)
		}
	}
	const applyAll = () => {
		for (const t of tiles.values()) apply(t)
	}

	/** Shows or hides the blurred placeholder (the tile's background). It
	 *  must go once a picture or video is drawn: it would show through a
	 *  transparent GIF and as thin lines at a video's edges. */
	const blur = (t, show) => {
		t.el.style.backgroundImage = show && t.lqip ? `url("${t.lqip}")` : ''
	}

	const visible = (el) => {
		const r = el.getBoundingClientRect()
		const top = root ? root.getBoundingClientRect().top : 0
		const bottom = root ? root.getBoundingClientRect().bottom : innerHeight
		return r.bottom > top && r.top < bottom
	}

	/** Puts the tile's MP4 in a pooled video and plays it, or keeps it
	 *  paused on its first frame. The video's listeners belong to this use:
	 *  added here, removed when it goes back, so nothing from a video's last
	 *  tile lands on its next one. */
	const showVideo = (t, play) => {
		let v = t.video
		if (!v) {
			v = borrowVideo()
			const use = { v, timer: 0 }
			// Its first frame is up. It fades in over the placeholder, and the
			// placeholder goes once the fade is over (hidden at once, the
			// tile's background flashed through the fading video). Under a
			// transparent video it goes at once: it would show through the
			// clear pixels for the whole fade. A frame that comes up wholly
			// off screen shows at once: nobody would see the fade, and it
			// would still be running as the tile comes on.
			const up = () => blur(t, false)
			use.shown = () => {
				if (v.hasAttribute('data-shown')) return
				if (!visible(v)) v.setAttribute('data-at-once', '')
				v.setAttribute('data-shown', '')
				if (v.hasAttribute('data-at-once') || t.src !== t.mp4)
					return up()
				v.addEventListener('transitionend', up, { once: true })
				use.timer = setTimeout(up, FADE_MS + 100) // no transition, no event
			}
			use.up = up
			use.failed = () => {
				// A transparent video that fails: its MP4 (on black) next.
				if (t.src !== t.mp4 && t.mp4) t.src = t.mp4
				else t.videoFailed = true
				stopVideo(t)
				apply(t)
			}
			v.addEventListener('loadeddata', use.shown)
			v.addEventListener('playing', use.shown)
			v.addEventListener('error', use.failed)
			t.video = v
			t.use = use
			// Autoplay only while it should play: set before src, or the
			// browser starts a waiting one by itself (Chrome even off screen).
			v.autoplay = play
			v.src = t.src + FIRST_FRAME
			t.el.append(v)
		}
		if (!play) {
			v.autoplay = false
			// WebKit walks its media sessions on every pause(), even of a
			// paused video.
			if (!v.paused) v.pause()
			return
		}
		if (v.autoplay && !v.paused) return
		// Autoplay as well as play(): WebKit restarts a muted video after an
		// interruption (a call, another tab) only if it autoplays.
		v.autoplay = true
		const asked = view
		v.play().catch((e) => {
			// Refused: Low Power Mode. It holds for the whole grid, or every
			// later tile would load its MP4 only to be refused too. AbortError
			// means we paused it ourselves, and an older search's refusal is
			// not this one's.
			if (e?.name !== 'NotAllowedError' || refused) return
			if (asked !== view) return
			refused = true
			primes.clear()
			applyAll()
		})
	}

	/** The tile's video goes back to the pool, its listeners and fade timer
	 *  with it. The placeholder comes back unless a picture is drawn. */
	const stopVideo = (t) => {
		const v = t.video
		if (!v) return
		const u = t.use
		v.removeEventListener('loadeddata', u.shown)
		v.removeEventListener('playing', u.shown)
		v.removeEventListener('error', u.failed)
		v.removeEventListener('transitionend', u.up)
		clearTimeout(u.timer)
		t.video = null
		t.use = null
		returnVideo(v)
		if (
			!(
				t.img.complete &&
				t.img.naturalWidth > 0 &&
				t.img.hasAttribute('src')
			)
		)
			blur(t, true)
	}

	// --- Warming the MP4s ahead ------------------------------------------
	/** A HEAD for each MP4 a little ahead of the screen, three at a time. It
	 *  makes the server render the file if it never has (about 3 s cold) and
	 *  fills the CDN's cache, so the video's own requests are quick. Each is
	 *  asked once. A 404 means the GIF has no MP4; a timeout is not retried
	 *  (the tile's own request finishes the render). */
	const primes = (() => {
		const asked = new Set()
		const waiting = []
		let busy = 0
		const next = () => {
			while (busy < PRIMES_AT_ONCE && waiting.length) {
				const src = waiting.shift()
				busy++
				const signal =
					typeof AbortSignal.timeout === 'function'
						? AbortSignal.timeout(PRIME_MS)
						: undefined // Safari before 16: no limit
				fetch(src, { method: 'HEAD', signal })
					.catch(() => {})
					.finally(() => {
						busy--
						next()
					})
			}
		}
		return {
			ask(src) {
				if (asked.has(src)) return
				asked.add(src)
				waiting.push(src)
				next()
			},
			/** Not needed any more (the tile is loading it, or left). */
			drop(src) {
				const i = waiting.indexOf(src)
				if (i < 0) return
				waiting.splice(i, 1)
				asked.delete(src)
			},
			clear() {
				for (const src of waiting) asked.delete(src)
				waiting.length = 0
			},
		}
	})()

	// --- Watching the tiles ----------------------------------------------
	// Three observers, because a rootMargin widens the area watched, so a
	// ratio measured with it no longer says how much is on screen.
	const timers = new WeakMap()
	const later = (key, ms, fn) => {
		clearTimeout(timers.get(key))
		timers.set(key, setTimeout(fn, ms))
	}
	const tileOf = (el) => tiles.get(el.dataset.id)
	const nearIO = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				const t = tileOf(e.target)
				if (!t) continue
				if (e.isIntersecting)
					later(t.nearKey, SETTLE_MS, () => {
						t.near = true
						if (t.src) primes.drop(t.src)
						apply(t)
					})
				else {
					clearTimeout(timers.get(t.nearKey))
					t.near = false
					apply(t)
				}
			}
		},
		{ root, rootMargin: NEAR }
	)
	const onIO = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				const t = tileOf(e.target)
				if (!t) continue
				t.on = e.intersectionRatio >= ON_SCREEN
				if (t.on)
					later(t.onKey, SETTLE_MS, () => {
						t.settled = true
						apply(t)
					})
				else {
					clearTimeout(timers.get(t.onKey))
					t.settled = false
				}
				apply(t)
			}
		},
		{ root, threshold: ON_SCREEN }
	)
	const aheadIO = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				const t = tileOf(e.target)
				if (!t || !plays(t) || REDUCED.matches || refused) continue
				if (e.isIntersecting && !t.near) primes.ask(t.src)
				else if (!e.isIntersecting) primes.drop(t.src)
			}
		},
		{ root, rootMargin: AHEAD }
	)
	const onMotion = () => {
		if (REDUCED.matches) primes.clear()
		applyAll()
	}
	REDUCED.addEventListener('change', onMotion)

	// --- Layout: masonry columns, every height known before loading ------
	let width = 0
	const layout = () => {
		width = container.clientWidth
		if (!width) return
		const cols = Math.max(
			2,
			Math.min(maxColumns, Math.floor((width + GAP) / (MIN_COLUMN + GAP)))
		)
		const col = (width - GAP * (cols - 1)) / cols
		const heights = new Array(cols).fill(0)
		for (const t of tiles.values()) {
			// The shortest column takes the next GIF. Ratios clamped to 3:4
			// to 2:1, so no tile fills the screen or shrinks to a strip.
			const c = heights.indexOf(Math.min(...heights))
			const ratio = Math.min(
				2,
				Math.max(0.75, t.gif.width / t.gif.height)
			)
			const h = Math.round(col / ratio)
			Object.assign(t.el.style, {
				left: `${c * (col + GAP)}px`,
				top: `${heights[c]}px`,
				width: `${col}px`,
				height: `${h}px`,
			})
			heights[c] += h + GAP
		}
		container.style.height = `${Math.max(0, Math.max(...heights) - GAP)}px`
	}
	const resized = new ResizeObserver(() => {
		if (container.clientWidth !== width) layout()
	})
	resized.observe(container)

	// --- Tiles -------------------------------------------------------------
	const makeTile = (gif) => {
		const el = document.createElement('button')
		el.type = 'button'
		el.className = 'gif-tile'
		el.dataset.id = gif.id
		el.setAttribute('aria-label', gif.title || 'GIF')
		const img = document.createElement('img')
		img.alt = ''
		img.decoding = 'async'
		el.append(img)
		const preview = (WIDE.matches ? gif.previews?.w480 : null) ??
			gif.previews?.w240 ??
			gif.previews?.medium ?? { animated: null, still: null }
		const t = {
			gif,
			el,
			img,
			preview,
			// Only an inline image: lqip goes into CSS, so nothing else may.
			lqip: /^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/.test(
				gif.lqip ?? ''
			)
				? gif.lqip
				: null,
			near: false,
			on: false,
			settled: false,
			/** The video it plays (videoOf), null: none. */
			src: videoOf(gif),
			/** Its MP4, if we play it: where a transparent video falls back. */
			mp4: media(gif.mp4),
			webm: media(gif.webm),
			videoFailed: false,
			animFailed: false,
			video: null,
			nearKey: {},
			onKey: {},
		}
		img.addEventListener('load', () => {
			// Drawn: the placeholder goes, if this is still the picture asked for.
			const src = img.getAttribute('src')
			if (!src) return
			img.decode().then(
				() => {
					if (img.getAttribute('src') === src) blur(t, false)
				},
				() => {}
			)
		})
		img.addEventListener('error', () => {
			const src = img.getAttribute('src')
			if (!src) return // asked for nothing
			if (src === t.preview.animated) {
				t.animFailed = true
				apply(t)
			} else blur(t, true)
		})
		el.addEventListener('click', () => {
			onPick?.(gif)
			container.dispatchEvent(
				new CustomEvent('gifpick', { bubbles: true, detail: { gif } })
			)
		})
		blur(t, true)
		return t
	}

	/** Stops a tile's media before it leaves the page. Removing an element
	 *  does not reliably stop it or free its memory. */
	const release = (t) => {
		nearIO.unobserve(t.el)
		onIO.unobserve(t.el)
		aheadIO.unobserve(t.el)
		clearTimeout(timers.get(t.nearKey))
		clearTimeout(timers.get(t.onKey))
		stopVideo(t)
		t.img.removeAttribute('src')
		t.el.remove()
	}
	const clear = () => {
		const old = [...tiles.values()]
		tiles.clear()
		for (const t of old) release(t)
		primes.clear()
	}

	/** Items the grid can show: an id, a size, and something to draw. Each
	 *  id once (it is the tile's key). */
	const usable = (items) => {
		const seen = new Set()
		return items.filter((g) => {
			if (!g?.id || seen.has(g.id)) return false
			seen.add(g.id)
			return g.width > 0 && g.height > 0 && (media(g.mp4) || g.previews)
		})
	}

	return {
		/**
		 * Shows the GIFs for `q`: one request for up to 200, no paging. The
		 * request is never cancelled: a search sent twice (a dialog mounting
		 * twice, say) counts twice against the reader's budget. A newer
		 * search simply wins. Resolves to how many GIFs it shows, or to
		 * `undefined` when `q` is not worth a request (the grid keeps what it
		 * shows), a newer call came, or clear() or destroy() did; either way
		 * an older answer changes nothing. Throws GifApiError for an HTTP error, or the fetch's
		 * error: a network error after one retry, or a timeout.
		 */
		async search(q) {
			const query = normalise(q)
			const mine = ++generation
			if (!searchable(query) || destroyed) return undefined
			const current = () => mine === generation && !destroyed
			const url = `${api}/api/v1/search?q=${encodeURIComponent(query)}&limit=200${narrow}`
			const ask = () =>
				fetch(url, {
					...init,
					signal:
						init.signal ??
						(typeof AbortSignal.timeout === 'function'
							? AbortSignal.timeout(SEARCH_MS)
							: undefined),
				})
			let res
			let body
			try {
				try {
					res = await ask()
				} catch (e) {
					// Not reached at all (a TypeError): once more, a second
					// later. A timeout or an abort may have reached the API and
					// been counted, and an answer of any kind is never asked
					// again.
					if (!(e instanceof TypeError) || !current()) throw e
					await new Promise((r) => setTimeout(r, 1000))
					if (!current()) return undefined
					res = await ask()
				}
				if (!current()) return undefined
				if (!res.ok) throw new GifApiError(res.status)
				body = await res.json()
			} catch (e) {
				if (!current()) return undefined // a newer search took over
				throw e
			}
			if (!current()) return undefined
			clear()
			view++
			refused = false
			for (const gif of usable(body.items ?? [])) {
				const t = makeTile(gif)
				tiles.set(gif.id, t)
				container.append(t.el)
			}
			layout()
			for (const t of tiles.values()) {
				nearIO.observe(t.el)
				onIO.observe(t.el)
				aheadIO.observe(t.el)
			}
			return tiles.size
		},
		/** Takes the tiles away, their videos back to the pool, and a
		 *  search on its way no longer lands: after a failed search the old
		 *  results are not its answer. */
		clear() {
			if (destroyed) return
			generation++
			clear()
			layout()
		},
		/** Stops everything and empties the container. */
		destroy() {
			destroyed = true
			generation++
			clear()
			nearIO.disconnect()
			onIO.disconnect()
			aheadIO.disconnect()
			resized.disconnect()
			REDUCED.removeEventListener('change', onMotion)
			// The pool stays: the next grid on this page reuses its videos.
			container.replaceChildren()
			container.style.height = ''
		},
	}
}
