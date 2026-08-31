/* The 40 HPW share control: one button, one modal, one kind-1 note.
 *
 * A VERB, attached after the board is painted, on the tab (members-board.js
 * mounts one per board) and on /hpw/<week> (hpw-page.js). The board's markup
 * is the two-sided hpw-board.js and carries no button; this adds one to the
 * board's corner. Two surfaces, one control, one file.
 *
 * ⚠️ THE IMAGE IS FROZEN AT THE MOMENT OF SHARING. Reed's call, 2026-08-30,
 * over the first version, which put the proxy's URL (/api/og/hpw/<key>.png)
 * in the note: that file is re-rendered every collector cycle the board
 * moves, so "I'm in first so far!" posted with it stopped being backed by
 * the picture an hour later. Now the modal fetches the card the reader is
 * looking at and uploads THAT file to Blossom under the reader's own key;
 * Blossom addresses a file by its SHA-256, so the URL in the note can never
 * show anything but the file it was posted with. The proxy's URL keeps
 * moving (it is the page's og:image, where live is right); the note's cannot.
 *
 * The note is exactly:
 *
 *     <what they typed>
 *
 *     <blossom url>
 *
 *     <link>
 *
 * where the link is /#members for the live week (the live race) and the
 * week's own page for a past week or High Scores (Reed's call: a link to
 * the live board under last week's picture lands on a different board).
 * The image and the link are not in the textarea; they are shown as what
 * will be added, and added at publish. The suggestion is a placeholder,
 * never content.
 *
 * ⚠️ THE MODAL OPENS FOR EVERYONE. Signed out, Publish is a Log in button
 * and Download image still works, so a reader with no Nostr account can
 * take the picture to a text message or anywhere else. The upload needs a
 * signer (a kind-24242 auth event), so it starts once a session exists;
 * the site's bot key never signs one, for the reason it signs nothing
 * beyond the templated boost note. Publish is blocked until the image is
 * ready — a note without the picture is not what this control is for — and
 * a failed upload offers Retry.
 *
 * The card is the collector's last render, so it is up to one cycle (five
 * minutes) behind the board on screen. The proxy answers the site banner
 * while a week's card is not rendered yet (X-OB-Image: fallback); that is
 * refused with a note rather than uploaded as "the board".
 */
import { showToast } from '/assets/js/copy-npub.js?v=ob-v175'
import { getSessionPubkey } from '/assets/js/follow-set.js?v=ob-v175'

const SITE = 'https://onlyboosts.social'
const WIDGET_SRC = '/assets/widgets/login-widget.js?v=ob-v175'
/* The box-with-arrow share glyph (the iOS / most-websites one), inline so it
 * scales with the button and takes currentColor in either theme. Reed's call,
 * 2026-08-29: the icon rather than the word. */
const SHARE_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>'

// ── the pure parts, exported for scripts/test-hpw-cards.mjs ─────────────────

export function shareLink(key, isLive) {
  return isLive ? `${SITE}/#members` : `${SITE}/hpw/${key}`
}

/* The image is fetched from THIS origin: the absolute URL from a branch
 * preview is a cross-origin request to a route that has not merged. */
export function imageHere(key) {
  return `/api/og/hpw/${key}.png`
}

export function noteContent(message, imageUrl, link) {
  const text = String(message || '').trim()
  return [text, imageUrl, link].filter(Boolean).join('\n\n')
}

export function buildShareTags({ link, imageUrl, sha256, title }) {
  const imeta = [`url ${imageUrl}`, 'm image/png']
  if (sha256) imeta.push(`x ${sha256}`)
  imeta.push(`alt Nostr Gang #40HPW leaderboard, ${title}`)
  return [
    ['t', '40hpw'],
    ['r', link],
    // NIP-92: what the image URL in the content is, so a client can lay it
    // out before fetching it.
    ['imeta', ...imeta],
    ['client', 'onlyboosts.social'],
  ]
}

// ── the button ──────────────────────────────────────────────────────────────

/* `key` is `YYYY-MM-DD` or `high-scores`; `title` the board's own name
 * ("Week of Aug 24, 2026", "High Scores"); `isLive` whether this is the
 * week in progress. Idempotent per board element. */
export function mountShare(boardEl, { key, title, isLive = false }) {
  if (!boardEl || boardEl.querySelector('.hpw-share')) return
  const host = document.createElement('div')
  host.className = 'hpw-share'
  host.innerHTML =
    `<button type="button" class="pcast-sort-btn hpw-share-btn" aria-label="Share on Nostr" title="Share on Nostr">${SHARE_ICON}</button>`
  boardEl.appendChild(host)
  host.querySelector('button').addEventListener('click', () => openShareModal({ key, title, isLive }))
}

// ── the modal ───────────────────────────────────────────────────────────────

let modal = null
let session = null   // the open share, so a second press or a login lands on it

function buildModal() {
  const el = document.createElement('div')
  el.className = 'hpw-modal hpw-share-modal'
  el.hidden = true
  el.innerHTML =
    `<div class="hpw-modal-scrim" data-close></div>` +
    `<div class="hpw-modal-box hpw-share-box" role="dialog" aria-modal="true" aria-labelledby="hpw-share-title">` +
      `<div class="hpw-modal-head"><h3 id="hpw-share-title">Share on Nostr</h3>` +
        `<button type="button" class="hpw-modal-x" data-close aria-label="Close">×</button></div>` +
      `<div class="hpw-share-body">` +
        `<div class="hpw-share-preview" data-preview><span class="hpw-share-preview-empty" aria-hidden="true"></span></div>` +
        `<div class="hpw-share-main">` +
          `<p class="hpw-share-status" data-status aria-live="polite"></p>` +
          `<textarea class="hpw-share-text" data-text rows="4" placeholder=""></textarea>` +
          `<p class="hpw-share-hint" data-hint></p>` +
          `<div class="hpw-share-actions">` +
            `<button type="button" class="hpw-share-dl" data-download disabled>Download image</button>` +
            `<button type="button" class="hpw-share-publish" data-publish disabled>Publish note</button>` +
            `<button type="button" class="hpw-share-publish" data-login hidden>Log in to publish</button>` +
          `</div>` +
        `</div>` +
      `</div>` +
    `</div>`
  document.body.appendChild(el)
  for (const c of el.querySelectorAll('[data-close]')) c.addEventListener('click', closeShareModal)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) closeShareModal() })
  el.querySelector('[data-download]').addEventListener('click', () => session && download(session))
  el.querySelector('[data-publish]').addEventListener('click', () => session && publish(session))
  el.querySelector('[data-login]').addEventListener('click', () => login())
  /* A login completing while the modal is open starts the upload in place:
     the reader keeps what they typed. ⚠️ THE WIDGET DISPATCHES
     `lb:session-change` ON `window`, and a listener on `document` never
     hears it — the modal shipped that way once and sat on "Log in to
     publish" after a successful login (Reed, 2026-08-30). `storage` covers a
     login in another tab. */
  const onSession = () => { if (session && !modal.hidden) refresh(session) }
  window.addEventListener('lb:session-change', onSession)
  window.addEventListener('storage', (e) => { if (e.key === 'lb_nostr_session') onSession() })
  return el
}

function q(sel) { return modal.querySelector(sel) }

// One placeholder for every board. Reed's wording, 2026-08-30.
const PLACEHOLDER = 'Share your message about the #40hpw chart'

export function openShareModal({ key, title, isLive }) {
  if (!modal) modal = buildModal()
  session = {
    key, title, isLive,
    link: shareLink(key, isLive),
    blob: null,          // the card as fetched from this origin
    sha256: null,
    blossomUrl: null,    // set once the upload succeeds
    uploading: false,
    seq: (session?.seq || 0) + 1,
  }
  q('[data-text]').value = ''
  q('[data-text]').placeholder = PLACEHOLDER
  q('[data-hint]').textContent = `The image and a link to ${session.link.replace(/^https:\/\//, '')} will be added to your message`
  q('[data-preview]').innerHTML = '<span class="hpw-share-preview-empty" aria-hidden="true"></span>'
  q('[data-download]').disabled = true
  modal.hidden = false
  q('.hpw-modal-x').focus()
  fetchImage(session)
}

export function closeShareModal() {
  if (!modal) return
  modal.hidden = true
  session = null
}

function setStatus(text, kind = '') {
  const el = q('[data-status]')
  el.textContent = text
  el.className = `hpw-share-status${kind ? ` is-${kind}` : ''}`
}

function setStatusRetry(text, onRetry) {
  setStatus(text, 'error')
  const b = document.createElement('button')
  b.type = 'button'; b.className = 'hpw-share-retry'; b.textContent = 'Retry'
  b.addEventListener('click', onRetry)
  q('[data-status]').append(' ', b)
}

/* Step one: the card from this origin. Refused when the proxy answered the
   banner, which is its "not rendered yet". */
async function fetchImage(s) {
  setStatus('Fetching the image…', 'busy')
  try {
    const resp = await fetch(imageHere(s.key), { headers: { Accept: 'image/png' } })
    if (s !== session) return
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    if (resp.headers.get('X-OB-Image') === 'fallback') {
      setStatusRetry('This board\'s image is not ready yet; it is rendered a few minutes after the board changes.', () => fetchImage(s))
      return
    }
    const blob = await resp.blob()
    if (s !== session) return
    if (blob.type !== 'image/png') throw new Error('not a PNG')
    s.blob = blob
    s.sha256 = await sha256Hex(await blob.arrayBuffer())
    /* ⚠️ A data: URL, NOT createObjectURL: every page's CSP allows
       `img-src 'self' data: https:` and no `blob:`, so an object URL here was
       a broken-image icon (Reed's screenshot, 2026-08-30). Widening a policy
       every page shares for one preview is the wrong trade. */
    const img = document.createElement('img')
    img.alt = ''
    img.src = await dataUrl(blob)
    if (s !== session) return
    q('[data-preview]').replaceChildren(img)
    q('[data-download]').disabled = false
    refresh(s)
  } catch (err) {
    if (s !== session) return
    console.warn('[hpw-share] image fetch failed', err)
    setStatusRetry(`The image could not be fetched (${err?.message || 'network error'}).`, () => fetchImage(s))
  }
}

/* Step two, whenever the session or the image changes: decide between the
   Log in button, the upload, and Publish. */
function refresh(s) {
  if (s !== session || !s.blob) return
  const signedIn = !!(getSessionPubkey() || window.LBLogin?.getUser?.())
  q('[data-login]').hidden = signedIn
  q('[data-publish]').hidden = !signedIn
  if (!signedIn) {
    q('[data-publish]').disabled = true
    setStatus('Image ready. Log in to publish it on Nostr, or download it.', 'ok')
    return
  }
  if (s.blossomUrl) {
    q('[data-publish]').disabled = false
    setStatus('Image ready.', 'ok')
    return
  }
  if (!s.uploading) upload(s)
}

async function upload(s) {
  s.uploading = true
  q('[data-publish]').disabled = true
  setStatus('Uploading the image…', 'busy')
  try {
    await ensureWidget()
    if (s !== session) return
    if (typeof window.LBLogin?.uploadToBlossom !== 'function') throw new Error('the login widget is stale; reload the page')
    const file = new File([s.blob], `onlyboosts-40hpw-${s.key}.png`, { type: 'image/png' })
    const url = await window.LBLogin.uploadToBlossom(file)
    if (s !== session) return
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('no URL came back')
    s.blossomUrl = url
    s.uploading = false
    refresh(s)
  } catch (err) {
    s.uploading = false
    if (s !== session) return
    console.warn('[hpw-share] upload failed', err)
    setStatusRetry(`The image could not be uploaded (${err?.message || 'unknown error'}).`, () => upload(s))
  }
}

async function publish(s) {
  if (!s.blossomUrl) return
  if (!window.LBLogin?.getUser?.()) { login(); return }
  const btn = q('[data-publish]')
  btn.disabled = true
  const was = btn.textContent
  btn.textContent = 'Publishing…'
  try {
    const content = noteContent(q('[data-text]').value, s.blossomUrl, s.link)
    const signed = await window.LBLogin.signAndPublish({
      kind: 1, content,
      tags: buildShareTags({ link: s.link, imageUrl: s.blossomUrl, sha256: s.sha256, title: s.title }),
    })
    if (!signed || signed.kind !== 1 || typeof signed.sig !== 'string') throw new Error('widget returned no signed event')
    closeShareModal()
    showToast('Posted to Nostr')
  } catch (err) {
    console.warn('[hpw-share] publish failed', err)
    btn.disabled = false
    btn.textContent = was
    setStatus(`Publishing failed (${err?.message || 'unknown error'}); nothing was posted.`, 'error')
  }
}

function download(s) {
  if (!s.blob) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(s.blob)
  a.download = `onlyboosts-40hpw-${s.key}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

async function login() {
  try { await ensureWidget() }
  catch (err) { console.warn('[hpw-share] widget failed', err); setStatus('The login widget could not be loaded.', 'error'); return }
  /* Already signed in (a login the modal somehow missed): the press is the
     refresh, never a dead button. */
  if (window.LBLogin?.getUser?.()) { if (session) refresh(session); return }
  window.LBLogin?.requestLogin?.()
}

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

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

async function sha256Hex(buffer) {
  if (!crypto?.subtle) return null
  const d = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
