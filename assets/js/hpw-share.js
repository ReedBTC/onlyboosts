/* The 40 HPW share control: Post to Nostr, Copy link, Share image.
 *
 * A VERB, attached after the board is painted, on the tab (members-board.js
 * mounts one per board) and on /hpw/<week> (hpw-page.js). The board's markup
 * is the two-sided hpw-board.js and carries no button; this appends a footer
 * row to it. Two surfaces, one control, one file.
 *
 * What each action does with the two addresses a board has:
 *
 *   Copy link      the page URL, https://onlyboosts.social/hpw/<key>, which
 *                  previews with the card wherever a link unfurls.
 *   Share image    the card itself, /api/og/hpw/<key>.png — the collector's
 *                  Chromium screenshot, proxied by this origin. On a phone the
 *                  Web Share sheet takes it as a FILE, so it lands in any app
 *                  as a picture rather than a link; on a desktop it downloads.
 *                  ⚠️ THE PROXY ANSWERS THE SITE BANNER WHEN THE CARD IS NOT
 *                  RENDERED YET (X-OB-Image: fallback), and sharing the banner
 *                  as "the board" would be wrong, so that answer is refused
 *                  with a note rather than shared.
 *   Post to Nostr  a kind-1 through the signed-in account, prefilled with the
 *                  title, the page link and the image link, with `t`, `r`,
 *                  `imeta` (NIP-92) and `client` tags. The reader edits before
 *                  posting. Signed out, the widget is loaded and its login
 *                  opened; nothing is signed on anyone's behalf here.
 *
 * ⚠️ THE IMAGE IS THE LATEST RENDER, NOT A SNAPSHOT AT THE MOMENT OF SHARING.
 * A note posted on Wednesday shows the board as it stands when it is read.
 * That is the V1 decision (2026-08-29); a frozen copy per share would need the
 * collector to keep versioned files, which it does not yet.
 */
import { copyText, showToast } from '/assets/js/copy-npub.js?v=ob-v151'

const SITE = 'https://onlyboosts.social'
const WIDGET_SRC = '/assets/widgets/login-widget.js?v=ob-v151'

export function shareUrls(key) {
  return { page: `${SITE}/hpw/${key}`, image: `${SITE}/api/og/hpw/${key}.png` }
}

/* `key` is `YYYY-MM-DD` or `high-scores`; `title` is the board's own name
 * ("Week of Aug 24, 2026", "High Scores"). Idempotent per board element. */
export function mountShare(boardEl, { key, title }) {
  if (!boardEl || boardEl.querySelector('.hpw-share')) return
  const urls = shareUrls(key)
  const canShareFiles = typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })

  const host = document.createElement('div')
  host.className = 'hpw-share'
  host.innerHTML =
    `<span class="pcast-sort hpw-share-wrap">` +
      `<button type="button" class="pcast-sort-btn hpw-share-btn" aria-haspopup="menu" aria-expanded="false">` +
        `<span aria-hidden="true">↗</span> Share</button>` +
      `<div class="pcast-sort-menu hpw-share-menu" role="menu" hidden>` +
        `<button type="button" class="pcast-sort-item" role="menuitem" data-share="nostr">Post to Nostr</button>` +
        `<button type="button" class="pcast-sort-item" role="menuitem" data-share="link">Copy link</button>` +
        `<button type="button" class="pcast-sort-item" role="menuitem" data-share="image">${canShareFiles ? 'Share image' : 'Download image'}</button>` +
      `</div>` +
    `</span>`
  boardEl.appendChild(host)

  const btn = host.querySelector('.hpw-share-btn')
  const menu = host.querySelector('.hpw-share-menu')
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false') }
  btn.addEventListener('click', () => {
    const open = menu.hidden
    menu.hidden = !open
    btn.setAttribute('aria-expanded', String(open))
  })
  document.addEventListener('click', (e) => { if (!host.contains(e.target)) close() }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-share]')
    if (!item) return
    close()
    if (item.dataset.share === 'link') {
      const ok = await copyText(urls.page)
      showToast(ok ? 'Link copied' : 'Copy failed — clipboard blocked', !ok)
    } else if (item.dataset.share === 'image') {
      await shareImage(urls, key, title, canShareFiles)
    } else if (item.dataset.share === 'nostr') {
      await openComposer(boardEl, urls, title)
    }
  })
}

async function fetchCard(urls) {
  const resp = await fetch(urls.image, { headers: { Accept: 'image/png' } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  /* The banner is the proxy's "not rendered yet"; the header is what says so.
     A browser that strips it (an old cached answer) is caught by the type. */
  if (resp.headers.get('X-OB-Image') === 'fallback') return null
  const blob = await resp.blob()
  if (blob.type !== 'image/png') return null
  return blob
}

async function shareImage(urls, key, title, canShareFiles) {
  let blob
  try { blob = await fetchCard(urls) }
  catch (err) { console.warn('[hpw-share] image fetch failed', err); showToast('The image could not be fetched', true); return }
  if (!blob) { showToast('This board\'s image is not ready yet — try again in a few minutes', true); return }
  const file = new File([blob], `onlyboosts-40hpw-${key}.png`, { type: 'image/png' })
  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title: `Nostr Gang #40HPW: ${title}`, text: urls.page })
      return
    } catch (err) {
      if (err?.name === 'AbortError') return   // the reader closed the sheet
      console.warn('[hpw-share] share sheet failed, downloading instead', err)
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

// ── Post to Nostr ────────────────────────────────────────────────────

/* The widget is 1MB and loads on the gesture that needs it, through the
 * nav's own loader so there is one in-flight promise. If that hook is
 * missing (a stale nav-widget-boot.js), fall back to injecting the script. */
function ensureWidget() {
  if (window.LBLogin) return Promise.resolve()
  if (typeof window.__lbEnsureWidget === 'function') return window.__lbEnsureWidget()
  return new Promise((resolve, reject) => {
    if (!document.querySelector('script[src*="login-widget.js"]')) {
      const s = document.createElement('script')
      s.src = WIDGET_SRC
      s.async = true
      s.onerror = () => reject(new Error('Failed to load login widget'))
      document.head.appendChild(s)
    }
    const started = Date.now()
    const iv = setInterval(() => {
      if (window.LBLogin) { clearInterval(iv); resolve(); return }
      if (Date.now() - started > 15000) { clearInterval(iv); reject(new Error('login widget load timed out')) }
    }, 60)
  })
}

async function openComposer(boardEl, urls, title) {
  const existing = boardEl.querySelector('.reply-composer')
  if (existing) { existing.remove(); return }
  try { await ensureWidget() }
  catch (err) { console.warn('[hpw-share] widget failed', err); showToast('The login widget could not be loaded', true); return }
  if (!window.LBLogin?.getUser?.()) {
    /* Signed out: open the login. The reader presses Share again afterwards;
       a pending action that fires on login is a second path into a publish,
       which is the shape the money paths forbid for the same reason. */
    window.LBLogin?.requestLogin?.()
    showToast('Log in to post, then press Share again')
    return
  }

  const composer = document.createElement('div')
  composer.className = 'reply-composer hpw-composer'
  const ta = document.createElement('textarea')
  ta.rows = 5
  ta.value = `Nostr Gang #40HPW Challenge, ${title}\n\n${urls.page}\n${urls.image}`
  composer.appendChild(ta)
  const actions = document.createElement('div')
  actions.className = 'rc-actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'; cancel.className = 'rc-cancel'; cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => composer.remove())
  const send = document.createElement('button')
  send.type = 'button'; send.className = 'rc-send'; send.textContent = 'Post to Nostr'
  send.addEventListener('click', () => post(ta.value, urls, title, send, composer))
  actions.append(cancel, send)
  composer.appendChild(actions)
  boardEl.appendChild(composer)
  ta.focus()
}

export function buildShareTags(urls, title) {
  return [
    ['t', '40hpw'],
    ['r', urls.page],
    // NIP-92: what the image URL in the content is, so a client can lay it
    // out before fetching it. The screenshot is 1200x630 at 2x.
    ['imeta', `url ${urls.image}`, 'm image/png', `alt Nostr Gang #40HPW leaderboard, ${title}`],
    ['client', 'onlyboosts.social'],
  ]
}

async function post(content, urls, title, sendBtn, composer) {
  const text = (content || '').trim()
  if (!text) return
  if (!window.LBLogin?.getUser?.()) { window.LBLogin?.requestLogin?.(); return }
  sendBtn.disabled = true
  sendBtn.textContent = 'Posting…'
  try {
    const signed = await window.LBLogin.signAndPublish({ kind: 1, content: text, tags: buildShareTags(urls, title) })
    if (!signed || signed.kind !== 1 || typeof signed.sig !== 'string') throw new Error('widget returned no signed event')
    composer.remove()
    showToast('Posted to Nostr')
  } catch (err) {
    console.warn('[hpw-share] post failed', err)
    sendBtn.disabled = false
    sendBtn.textContent = 'Post to Nostr'
    showToast('Posting failed — nothing was published', true)
  }
}
