/**
 * Minimal dependency-free confetti burst.
 *
 * Fired once when a boost lands at least one successful leg — the
 * celebratory "it actually went through" signal borrowed from
 * boostmebitch. No npm dep: a single full-screen canvas, a few dozen
 * gravity-driven particles, self-removes when the burst finishes.
 *
 * Palette is the V4V / Nostr one: bolt-orange + nostr-magenta, plus a
 * couple of warm accents so the burst reads as "Lightning + Nostr".
 *
 * Honors prefers-reduced-motion: users who asked for less motion get no
 * animation at all (the success summary still renders — only the
 * confetti is skipped).
 */

const COLORS = ['#00aff0', '#068ace', '#7fd7f8', '#ffffff', '#0a6fa8']

export function fireConfetti({ count = 90, durationMs = 2400 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  try {
    if (window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
  } catch { /* matchMedia missing — proceed */ }

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    // Above the modal (z-71) and the boost banner (z-110); this is a
    // transient overlay that should sit on top of everything.
    zIndex: '2147483647',
  })
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) { canvas.remove(); return }

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  let W = canvas.width = Math.floor(window.innerWidth * dpr)
  let H = canvas.height = Math.floor(window.innerHeight * dpr)

  // Burst from horizontal center, a touch above the middle — reads as
  // bursting out of the boost modal.
  const originX = W / 2
  const originY = H * 0.42

  const particles = []
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5
    const speed = (4 + Math.random() * 7) * dpr
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3 * dpr,
      size: (5 + Math.random() * 6) * dpr,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
      life: 1,
    })
  }

  const gravity = 0.18 * dpr
  const drag = 0.985
  const start = performance.now()
  let raf = 0

  function frame(now) {
    const elapsed = now - start
    ctx.clearRect(0, 0, W, H)
    for (const p of particles) {
      p.vx *= drag
      p.vy = p.vy * drag + gravity
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vrot
      p.life = Math.max(0, 1 - elapsed / durationMs)
      ctx.save()
      ctx.globalAlpha = p.life
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      // Thin rectangles tumble like confetti flakes rather than dots.
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      ctx.restore()
    }
    if (elapsed < durationMs) {
      raf = requestAnimationFrame(frame)
    } else {
      canvas.remove()
    }
  }
  raf = requestAnimationFrame(frame)

  // Safety net: if the tab is backgrounded mid-burst rAF stalls and the
  // canvas would linger. Force-remove a beat after the burst should end.
  setTimeout(() => {
    if (canvas.isConnected) {
      cancelAnimationFrame(raf)
      canvas.remove()
    }
  }, durationMs + 1500)
}
