/* opml-import.js — the OPML import panel, and the local list's manage view.
 *
 * Loaded on first use by favorites-ui.js (`OBFavorites.importOpml()`), which
 * hands it everything that touches a list: who is signed in, what is already
 * followed, how to add rows (one publish, or the local list), and the export.
 * This module owns the panel alone: reading the file or the pasted link,
 * planning what may leave the device (opml.js), the lookups against
 * /api/v1/feeds/resolve, the review, and the Add.
 *
 * The flow is BMB's two steps (ChadFarrow/boostmebitch #508): look up, then
 * review the counts and press Add. Nothing is written before the press, and
 * an import only ever ADDS (Reed's rule, 2026-11-07). ⚠️ A private-looking
 * feed address (a paid feed, a token in the query) is planned OUT before the
 * first request and is shown by its host only; see opml.js#looksPrivate. */
import {
  OPML_MAX_BYTES, OPML_LOOKUP_PER_RUN, OPML_FILE_ACCEPT,
  parseOpml, planOpmlImport, opmlLinkVerdict, opmlLinkName, sortOpmlAnswers,
} from '/assets/js/opml.js?v=ob-v269'

const RESOLVE_URL = '/api/v1/feeds/resolve'
const LINK_URL = '/api/v1/opml/link'
const MAX_ROUNDS = 8

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const hostOf = (u) => { try { return new URL(u).host } catch { return 'a private feed' } }

/**
 * Open the panel. `view` is 'import' or 'manage' (the local list). `ctx`:
 *   signedIn, isFollowed(guid), local() → rows, addRows(rows) → { status, added },
 *   removeLocal(guid), forgetLocal(), exportOpml(), requestLogin().
 */
export function openOpmlPanel(ctx) {
  document.querySelector('.ob-opml')?.remove()
  const wrap = document.createElement('div')
  wrap.className = 'ob-fav-ask ob-opml'
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-modal', 'true')
  wrap.setAttribute('aria-labelledby', 'ob-opml-title')
  const card = document.createElement('div')
  card.className = 'ob-fav-ask-card ob-opml-card'
  wrap.appendChild(card)

  let cancelled = false
  const close = () => { cancelled = true; wrap.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close() })
  document.body.appendChild(wrap)

  const frame = (title, body) => {
    card.innerHTML =
      `<div class="ob-opml-head"><h2 id="ob-opml-title">${esc(title)}</h2><button type="button" class="ob-opml-x" data-close aria-label="Close">×</button></div>` +
      body
    card.querySelector('[data-close]').onclick = close
  }

  /* ── Pick ─────────────────────────────────────────────────────────────── */
  function viewPick(note = '') {
    const localN = ctx.local().length
    frame('Import your podcasts', `
      ${note ? `<p class="ob-opml-note" role="status">${esc(note)}</p>` : ''}
      <p>Bring the list from your current app. Export an OPML file from it (Fountain, Apple Podcasts, Overcast, Pocket Casts and most others can), then choose it here or paste a link to it.</p>
      <label class="ob-opml-drop">
        <input type="file" accept="${OPML_FILE_ACCEPT}" data-file hidden />
        <strong>Choose an OPML file</strong><span>or drop one here</span>
      </label>
      <form class="ob-opml-link" data-link-form>
        <input type="url" inputmode="url" placeholder="https://…/subscriptions.opml" aria-label="Link to an OPML file" data-link required />
        <button type="submit" class="ob-cta">Look up</button>
      </form>
      <p class="ob-opml-fine">Importing only adds: nothing you already follow is removed. Only public feed addresses are looked up; a paid or private feed's address never leaves this browser.${ctx.signedIn ? '' : ' You are not logged in, so the list is kept in this browser and seeds your recommendations here; log in any time to save it to your Nostr account.'}</p>
      ${localN ? `<p class="ob-opml-fine"><button type="button" class="ob-opml-linkbtn" data-manage>Manage the ${plural(localN, 'podcast')} you imported</button></p>` : ''}
    `)
    const file = card.querySelector('[data-file]')
    file.onchange = () => { if (file.files?.[0]) readFile(file.files[0]) }
    const drop = card.querySelector('.ob-opml-drop')
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('is-over') }
    drop.ondragleave = () => drop.classList.remove('is-over')
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer?.files?.[0]; if (f) readFile(f) }
    card.querySelector('[data-link-form]').onsubmit = (e) => { e.preventDefault(); readLink(card.querySelector('[data-link]').value) }
    card.querySelector('[data-manage]')?.addEventListener('click', viewManage)
  }

  async function readFile(f) {
    if (f.size > OPML_MAX_BYTES) { viewPick(`That file is ${(f.size / 1048576).toFixed(0)} MB; the largest this reads is 16 MB.`); return }
    viewBusy('Reading the file…')
    let text
    try { text = await f.text() } catch { viewPick('Couldn’t read that file.'); return }
    const outlines = parseOpml(text)
    if (!outlines) { viewPick(`${f.name} is not an OPML file.`); return }
    run(outlines, f.name)
  }

  async function readLink(raw) {
    const v = opmlLinkVerdict(raw)
    if ('refused' in v) {
      viewPick(v.refused === 'private'
        ? 'That link carries a key or a password, so it stays on this device. Download the file and choose it instead.'
        : 'That is not a web address. Paste the whole link, starting with https://.')
      return
    }
    viewBusy(`Fetching ${opmlLinkName(v.url)}…`)
    try {
      const resp = await fetch(LINK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: v.url }) })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        viewPick(resp.status === 422 ? 'That link is not an OPML file.' : 'That link could not be fetched. Download the file and choose it instead.')
        return
      }
      run(j.outlines || [], j.name || opmlLinkName(v.url))
    } catch { viewPick('That link could not be fetched. Download the file and choose it instead.') }
  }

  function viewBusy(text) {
    frame('Import your podcasts', `<p class="ob-opml-progress" role="status" aria-live="polite" data-progress>${esc(text)}</p><p><button type="button" class="ob-fav-ask-cancel" data-cancel>Cancel</button></p>`)
    card.querySelector('[data-cancel]').onclick = () => { cancelled = false; viewPick() }
  }

  /* ── Look up ──────────────────────────────────────────────────────────── */
  async function run(outlines, name) {
    const plan = planOpmlImport(outlines)
    if (!plan.feeds.length && !plan.skipped.length) { viewPick(`${name} lists no feeds.`); return }
    const answers = {}
    await lookUp(plan.feeds, answers, name)
    viewReview(plan, answers, name)
  }

  async function lookUp(feeds, answers, name) {
    const myRun = (lookUp.run = (lookUp.run || 0) + 1)
    let remaining = feeds.map((f) => f.url)
    const total = feeds.length
    for (let round = 0; round < MAX_ROUNDS && remaining.length; round++) {
      const before = remaining.length
      const next = []
      for (let i = 0; i < remaining.length; i += OPML_LOOKUP_PER_RUN) {
        if (cancelled || lookUp.run !== myRun) return
        const batch = remaining.slice(i, i + OPML_LOOKUP_PER_RUN)
        progress(`Looking up ${Math.min(total, total - remaining.length + i + batch.length)} of ${total} feeds from ${name}…`)
        try {
          const resp = await fetch(RESOLVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: batch }) })
          const j = resp.ok ? await resp.json() : null
          const got = j?.feeds || {}
          for (const u of batch) {
            if (Object.prototype.hasOwnProperty.call(got, u)) answers[u] = got[u]
            else next.push(u)
          }
        } catch { next.push(...batch) }
      }
      remaining = next
      if (remaining.length === before) break // no progress: leave them unasked
    }
  }
  function progress(text) { const p = card.querySelector('[data-progress]'); if (p) p.textContent = text; else viewBusy(text) }

  /* ── Review ───────────────────────────────────────────────────────────── */
  function viewReview(plan, answers, name) {
    const sorted = sortOpmlAnswers(plan.feeds, answers, ctx.isFollowed)
    const pods = sorted.add.filter((a) => a.row.medium !== 'music')
    const albums = sorted.add.filter((a) => a.row.medium === 'music')
    const verb = (p, a) => [p && `follow ${plural(p, 'podcast')}`, a && `favorite ${plural(a, 'album')}`].filter(Boolean).join(' and ')
    const priv = plan.skipped.filter((s) => s.reason === 'private')
    const notWeb = plan.skipped.filter((s) => s.reason === 'not-web')
    const repeats = plan.skipped.filter((s) => s.reason === 'repeat')
    const line = (n, text, items) => n
      ? `<details class="ob-opml-line"><summary>${esc(text)}</summary><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`
      : ''
    frame(`${name}: ${plural(plan.feeds.length + plan.skipped.length, 'feed')}`, `
      ${sorted.add.length ? `
        <p>Ready to ${verb(pods.length, albums.length)}. Untick any you do not want.</p>
        <ul class="ob-opml-adds" data-adds>
          ${sorted.add.map((a, i) => `<li><label><input type="checkbox" checked data-add="${i}" /> <span class="ob-opml-title">${esc(a.row.title || a.feed.title || a.feed.url)}</span>${a.row.medium === 'music' ? ' <span class="ob-opml-tag">Album</span>' : ''}${a.row.indexed ? '' : ' <span class="ob-opml-tag">Not boosted here yet</span>'}</label></li>`).join('')}
        </ul>
        <button type="button" class="ob-cta" data-go>${esc(cap(verb(pods.length, albums.length)))}</button>
      ` : `<p>Nothing new to add from this list.</p>`}
      <div class="ob-opml-lines">
        ${line(sorted.already.length, `Already on your list: ${sorted.already.length}`, sorted.already.map((f) => f.title || f.url))}
        ${line(sorted.notFound.length, `Not in Podcast Index: ${sorted.notFound.length}`, sorted.notFound.map((f) => f.title || f.url))}
        ${line(sorted.noGuid.length, `In Podcast Index without a podcast guid, so not followable: ${sorted.noGuid.length}`, sorted.noGuid.map((f) => f.title || f.url))}
        ${line(priv.length, `Kept on this device, looks like a paid or private feed: ${priv.length}`, priv.map((s) => `${s.title || 'Untitled'} (${hostOf(s.url)})`))}
        ${line(notWeb.length, `Not a web address: ${notWeb.length}`, notWeb.map((s) => s.title || s.url))}
        ${line(repeats.length, `Listed twice in the file: ${repeats.length}`, repeats.map((s) => s.title || s.url))}
        ${plan.overCap ? `<p class="ob-opml-fine">${plan.overCap} more past the ${2000}-feed cap were not looked up.</p>` : ''}
        ${sorted.unasked.length ? `<p class="ob-opml-fine">Could not be looked up right now: ${sorted.unasked.length}. <button type="button" class="ob-opml-linkbtn" data-retry>Try again</button></p>` : ''}
      </div>
      <p><button type="button" class="ob-fav-ask-cancel" data-back>Choose another file</button></p>
    `)
    card.querySelector('[data-back]').onclick = () => viewPick()
    card.querySelector('[data-retry]')?.addEventListener('click', async () => {
      viewBusy('Looking up the rest…')
      await lookUp(sorted.unasked, answers, name)
      if (!cancelled) viewReview(plan, answers, name)
    })
    card.querySelector('[data-go]')?.addEventListener('click', async () => {
      const picked = [...card.querySelectorAll('[data-add]:checked')].map((el) => sorted.add[Number(el.dataset.add)].row)
      if (!picked.length) return
      viewBusy(ctx.signedIn ? 'Saving to your list… your signer will ask you to sign one update.' : 'Saving in this browser…')
      let r
      try { r = await ctx.addRows(picked) } catch (err) { console.warn('[opml] add', err); r = { status: 'error', added: 0 } }
      viewDone(r, picked.length)
    })
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

  function viewDone(r, asked) {
    const ok = r.status === 'published' || r.status === 'unchanged' || r.status === 'local'
    let text
    if (r.status === 'local') text = `${plural(r.added, 'podcast')} saved in this browser. Your recommendations on the homepage now take them into account. Log in to save the list to your Nostr account, where every Podcasting 2.0 app that reads your follows and favorites can see it.`
    else if (r.status === 'published') text = `${plural(r.added, 'podcast')} added to your follows and favorites, in one signed update.`
    else if (r.status === 'unchanged') text = 'Your list already had every one of them.'
    else if (r.status === 'cancelled') text = 'Nothing was saved: the public or private choice was not made.'
    else if (r.status === 'signer-wait') text = 'Your signer is still connecting. Try again in a moment; nothing was saved.'
    else if (r.status === 'degraded') text = 'Couldn’t reach enough relays to read your list safely, so nothing was saved. Try again in a moment.'
    else if (r.status === 'signed-out') text = 'Log in first, then import again.'
    else text = `Couldn’t save the list (${r.status}). Nothing was changed.`
    frame(ok ? 'Imported' : 'Not saved', `
      <p>${esc(text)}</p>
      <div class="ob-opml-actions">
        ${r.status === 'local' ? `<button type="button" class="ob-cta" data-login>Log in to save it to Nostr</button><button type="button" class="ob-cta ob-cta--quiet" data-manage>See the list</button>` : ''}
        ${!ok ? `<button type="button" class="ob-cta" data-again>Try again</button>` : ''}
        <button type="button" class="${ok && r.status !== 'local' ? 'ob-cta' : 'ob-fav-ask-cancel ob-opml-end'}" data-close2>${r.status === 'local' ? 'Later' : 'Done'}</button>
      </div>
    `)
    card.querySelector('[data-close2]').onclick = close
    card.querySelector('[data-again]')?.addEventListener('click', () => viewPick())
    card.querySelector('[data-manage]')?.addEventListener('click', viewManage)
    card.querySelector('[data-login]')?.addEventListener('click', () => { close(); ctx.requestLogin() })
  }

  /* ── Manage the local list ────────────────────────────────────────────── */
  function viewManage() {
    const rows = ctx.local()
    frame(`Your imported podcasts (${rows.length})`, `
      <p>Kept in this browser only. They seed your recommendations on the homepage. Log in to save them to your Nostr account.</p>
      <ul class="ob-opml-adds" data-rows>
        ${rows.map((r) => `<li><span class="ob-opml-title">${esc(r.title || r.guid)}</span>${r.medium === 'music' ? ' <span class="ob-opml-tag">Album</span>' : ''} <button type="button" class="ob-opml-linkbtn" data-remove="${esc(r.guid)}">Remove</button></li>`).join('') || '<li>Nothing imported.</li>'}
      </ul>
      <div class="ob-opml-actions">
        <button type="button" class="ob-cta" data-login>Log in to save to Nostr</button>
        <button type="button" class="ob-cta ob-cta--quiet" data-import>Import more</button>
        <button type="button" class="ob-cta ob-cta--quiet" data-export>Export as OPML</button>
        <button type="button" class="ob-fav-ask-cancel ob-opml-end ob-opml-forget" data-forget>Forget all</button>
      </div>
    `)
    card.querySelector('[data-import]').onclick = () => viewPick()
    card.querySelector('[data-export]').onclick = () => ctx.exportOpml()
    card.querySelector('[data-login]').onclick = () => { close(); ctx.requestLogin() }
    card.querySelector('[data-forget]').onclick = async () => {
      if (!confirm(`Forget all ${rows.length} imported podcasts from this browser?`)) return
      await ctx.forgetLocal()
      viewPick('Imported list forgotten.')
    }
    card.querySelector('[data-rows]').addEventListener('click', async (e) => {
      const b = e.target.closest?.('[data-remove]')
      if (!b) return
      await ctx.removeLocal(b.dataset.remove)
      viewManage()
    })
  }

  if (ctx.view === 'manage' && ctx.local().length) viewManage()
  else viewPick()
}
