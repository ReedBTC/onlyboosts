/**
 * player.js — the episode player on /episode/<item-guid>.
 *
 * It replaces the browser's own audio controls with a bar of ours, because the
 * native control cannot draw anything on its seek line: the bar carries a tick
 * at every chapter and a shaded stretch for every song the episode plays (its
 * <podcast:valueTimeSplit> windows), and a line above the seek bar naming what
 * is on now, with the song's heart.
 *
 * ⚠️ THE <audio> ELEMENT IS STILL THE SERVER'S. The page ships a native player
 * with `controls`, and a reader with no JavaScript plays the episode with it.
 * This module takes the controls off that same element and drives it, so
 * there is one source of audio on the page and nothing to keep in step.
 *
 * ⚠️ IT DOCKS, IT DOES NOT FOLLOW. Once the episode is playing and the bar's
 * place on the page scrolls out of view, the bar fixes itself to the bottom
 * of the window, so the controls and the boost button stay in reach while the
 * reader scrolls the chapters, the notes and the boosts. It goes back to its
 * place when that place returns. It does not survive navigating to another
 * page: every link here is a full page load, and keeping audio across one
 * would mean the site stops doing full loads (Reed, 2026-11-23: "maybe
 * someday"). The module owns the audio for that reason, so the day a
 * site-wide player is wanted is a navigation change and not a new player.
 *
 * `window.LBPlayer` is the read side for anything else on the page (the boost
 * button, later): `state()` answers what is playing and where, and
 * `subscribe(fn)` calls back when that changes. Internal identifiers keep
 * LB's `lb` prefix, the repo's convention.
 *
 * Browser-only. Every string from a feed goes in through textContent.
 */

const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75]

export function fmtTime(totalSecs) {
  const s = Math.max(0, Math.floor(Number(totalSecs) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/* The window covering `t`, half-open [start, start + duration). Overlapping
 * windows are possible in the wild; the latest start wins, which is the song
 * that began most recently. */
export function songAt(songs, t) {
  let hit = null
  for (const s of songs) {
    if (s.start <= t && t < s.start + s.duration) {
      if (!hit || s.start >= hit.start) hit = s
    }
  }
  return hit
}

/* The chapter covering `t`: the last whose start is at or behind it. The
 * quarter second is so a click-seek lands on the chapter it came from. */
export function chapterAt(chapters, t) {
  let hit = null
  for (const c of chapters) {
    if (c.start <= t + 0.25) hit = c
    else break
  }
  return hit
}

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

/**
 * Take over one <audio> element. Returns the player, also set on
 * window.LBPlayer.
 *
 * @param {HTMLAudioElement} audio
 * @param {object} opts
 * @param {string} opts.itemGuid   the episode's item guid
 * @param {number} [opts.duration] its length in seconds from the index, used
 *   to place markers until the audio's own metadata arrives
 */
export function mountPlayer(audio, { itemGuid, duration = null } = {}) {
  const host = audio.parentElement
  audio.removeAttribute('controls')
  audio.hidden = true

  let chapters = []
  let songs = []
  let songHeart = () => null       // song → Node | null, set by the page
  const listeners = new Set()

  // The slot keeps the bar's height on the page while the bar is docked, so
  // the content under it does not jump.
  const slot = el('div', 'obp-slot')
  const bar = el('div', 'obp')
  bar.setAttribute('role', 'region')
  bar.setAttribute('aria-label', 'Episode player')

  const play = el('button', 'obp-play')
  play.type = 'button'
  const back = el('button', 'obp-skip', '−15')
  back.type = 'button'
  back.setAttribute('aria-label', 'Back 15 seconds')
  const fwd = el('button', 'obp-skip', '+30')
  fwd.type = 'button'
  fwd.setAttribute('aria-label', 'Forward 30 seconds')
  const rate = el('button', 'obp-rate', '1×')
  rate.type = 'button'
  rate.setAttribute('aria-label', 'Playback speed')

  const main = el('div', 'obp-main')
  const now = el('div', 'obp-now')
  const nowText = el('span', 'obp-now-text')
  const nowHeart = el('span', 'obp-now-heart')
  now.append(nowText, nowHeart)

  const track = el('div', 'obp-track')
  const songLayer = el('div', 'obp-songs')
  const fill = el('div', 'obp-fill')
  const ticks = el('div', 'obp-ticks')
  const range = el('input', 'obp-range')
  range.type = 'range'
  range.min = '0'
  range.max = '1000'
  range.step = '1'
  range.value = '0'
  range.setAttribute('aria-label', 'Seek')
  track.append(songLayer, fill, ticks, range)

  const times = el('div', 'obp-times')
  const cur = el('span', 'obp-cur', '0:00')
  const dur = el('span', 'obp-dur', duration ? fmtTime(duration) : '')
  times.append(cur, dur)
  main.append(now, track, times)

  bar.append(play, back, main, fwd, rate)
  slot.appendChild(bar)
  host.appendChild(slot)

  const length = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (duration || 0))

  function seek(secs, { start = true } = {}) {
    const t = Math.max(0, Number(secs) || 0)
    const apply = () => { try { audio.currentTime = t } catch { /* not seekable */ } }
    // preload="none": until play() starts the load there is no duration, and
    // an assignment to currentTime is silently dropped. Queue it.
    if (audio.readyState >= 1) apply()
    else audio.addEventListener('loadedmetadata', apply, { once: true })
    if (start) {
      const p = audio.play()
      if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay policy */ })
    }
    paintTime(t)
  }

  function paintPlay() {
    const playing = !audio.paused
    play.textContent = playing ? '❚❚' : '▶'
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    bar.classList.toggle('is-playing', playing)
  }

  let lastKey = ''
  function paintNow(t) {
    const song = songAt(songs, t)
    const chap = chapterAt(chapters, t)
    const key = song ? 's:' + song.itemGuid + song.start : chap ? 'c:' + chap.start : ''
    if (key === lastKey) return
    lastKey = key
    nowHeart.replaceChildren()
    if (song) {
      nowText.textContent = '♪ ' + (song.title || 'A song') + (song.artist || song.album ? ' · ' + (song.artist || song.album) : '')
      const h = songHeart(song)
      if (h) nowHeart.appendChild(h)
    } else if (chap) {
      nowText.textContent = chap.title
    } else {
      nowText.textContent = ''
    }
    now.hidden = !nowText.textContent
    for (const fn of listeners) { try { fn(state()) } catch { /* a listener's own fault */ } }
  }

  let dragging = false
  function paintTime(t = audio.currentTime) {
    const L = length()
    cur.textContent = fmtTime(t)
    if (L) dur.textContent = fmtTime(L)
    const frac = L ? Math.min(1, t / L) : 0
    fill.style.width = (frac * 100).toFixed(3) + '%'
    if (!dragging) range.value = String(Math.round(frac * 1000))
    paintNow(t)
  }

  function paintMarkers() {
    const L = length()
    ticks.replaceChildren()
    songLayer.replaceChildren()
    if (!L) return
    for (const c of chapters) {
      if (c.start <= 0 || c.start >= L) continue
      const tk = el('span', 'obp-tick')
      tk.style.left = (c.start / L * 100).toFixed(3) + '%'
      tk.title = c.title
      ticks.appendChild(tk)
    }
    for (const s of songs) {
      if (s.start >= L) continue
      const seg = el('span', 'obp-song')
      seg.style.left = (s.start / L * 100).toFixed(3) + '%'
      seg.style.width = (Math.min(s.duration, L - s.start) / L * 100).toFixed(3) + '%'
      seg.title = s.title || 'A song'
      songLayer.appendChild(seg)
    }
  }

  play.addEventListener('click', () => {
    if (audio.paused) {
      const p = audio.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } else audio.pause()
  })
  back.addEventListener('click', () => seek(audio.currentTime - 15, { start: !audio.paused }))
  fwd.addEventListener('click', () => seek(audio.currentTime + 30, { start: !audio.paused }))
  rate.addEventListener('click', () => {
    const i = RATES.indexOf(audio.playbackRate)
    const next = RATES[(i + 1) % RATES.length]
    audio.playbackRate = next
    rate.textContent = (next % 1 ? next : next.toFixed(0)) + '×'
  })
  range.addEventListener('input', () => {
    dragging = true
    const L = length()
    if (L) paintTime(Number(range.value) / 1000 * L)
  })
  range.addEventListener('change', () => {
    dragging = false
    const L = length()
    if (L) seek(Number(range.value) / 1000 * L, { start: !audio.paused || audio.currentTime === 0 })
  })

  audio.addEventListener('play', paintPlay)
  audio.addEventListener('pause', paintPlay)
  audio.addEventListener('ended', paintPlay)
  audio.addEventListener('timeupdate', () => paintTime())
  audio.addEventListener('seeked', () => paintTime())
  audio.addEventListener('loadedmetadata', () => { paintMarkers(); paintTime() })

  /* Docking. The slot is watched; once playback has started, the bar is fixed
   * to the bottom of the window whenever the slot is off screen, and back in
   * place when it returns. Before the first play nothing docks: a bar that
   * follows a reader who never pressed play is in the way. */
  const dock = (() => {
    let started = false, offscreen = false
    const apply = () => {
      const on = started && offscreen
      if (on) slot.style.minHeight = bar.offsetHeight + 'px'
      bar.classList.toggle('is-docked', on)
      document.documentElement.classList.toggle('obp-docked', on)
      if (!on) slot.style.minHeight = ''
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        for (const e of entries) offscreen = !e.isIntersecting
        apply()
      }).observe(slot)
    }
    return { started() { started = true; apply() } }
  })()
  audio.addEventListener('play', () => dock.started(), { once: true })

  function state() {
    const t = audio.currentTime || 0
    return {
      itemGuid,
      positionSec: t,
      playing: !audio.paused,
      // "Is this episode actually playing" is a position past zero, never a
      // position of zero (BMB's rule): a window authored at 0 would otherwise
      // claim a boost pressed before anyone pressed play.
      started: t > 0,
      song: songAt(songs, t),
      chapter: chapterAt(chapters, t),
    }
  }

  paintPlay()
  paintTime(0)

  const player = {
    audio,
    seek,
    state,
    setChapters(list) {
      chapters = (Array.isArray(list) ? list : [])
        .map((c) => ({ start: Math.max(0, Number(c.start) || 0), title: String(c.title || '') }))
        .sort((a, b) => a.start - b.start)
      lastKey = ''
      paintMarkers(); paintTime()
    },
    setSongs(list, { heart } = {}) {
      songs = (Array.isArray(list) ? list : []).filter((s) => Number(s.duration) > 0)
      if (typeof heart === 'function') songHeart = heart
      lastKey = ''
      paintMarkers(); paintTime()
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
  window.LBPlayer = player
  return player
}
