#!/usr/bin/env node
// The Favorite heart (`assets/js/favorite-button.js`) and the controller that
// paints it (`assets/js/favorites-ui.js`): the markup on every surface, its
// escaping, what a press asks for, the key it is looked up by, and the two
// rules the controller must keep — episode hearts stay hidden behind the
// migration gate, and nothing here reaches NIP-04.
//
// node scripts/test-favorite-button.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const F = await import(pathToFileURL(path.join(root, 'assets/js/favorite-button.js')).href)

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`) }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n')[0]}`) }
}

// A stub element with just what setFavoriteState/changeFor/keyFor touch.
const el = (html) => {
  const attrs = Object.fromEntries([...html.matchAll(/ ([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')]))
  const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean))
  const icon = { textContent: html.includes('♥') ? '♥' : '♡' }
  const dataset = {}
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v
  return {
    attrs, dataset, title: attrs.title,
    hidden: html.includes(' hidden '),
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v) },
    classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c) }, contains: (c) => classes.has(c) },
    querySelector: (sel) => (sel === '.ob-fav-icon' ? icon : null),
  }
}

const GUID = '917393e3-1b1e-5cef-ace4-edaa54e1f810'
const ITEM = 'cc59b81e-28a0-4e55-a457-54285c06830a'

check('a show heart: hidden, full NIP-73 id, medium only when declared', () => {
  const html = F.favoriteButtonHtml({ kind: 'show', guid: GUID, medium: 'music', label: 'Album "One"' })
  assert.match(html, /^<button type="button" class="ob-fav-pill" hidden data-fav="show" data-fav-id="podcast:guid:917393e3-1b1e-5cef-ace4-edaa54e1f810" data-fav-medium="music" aria-pressed="false"/)
  assert.match(html, /title="Favorite Album &quot;One&quot;"/, 'the label is escaped')
  assert.match(html, /<span class="ob-fav-icon" aria-hidden="true">♡<\/span><span class="ob-fav-word">Favorite<\/span>/)
  const none = F.favoriteButtonHtml({ kind: 'show', guid: GUID, medium: null, label: 'x' })
  assert.doesNotMatch(none, /data-fav-medium/, 'no medium attribute when the feed declared none')
  assert.doesNotMatch(F.favoriteButtonHtml({ kind: 'show', guid: GUID, medium: '  ', label: 'x' }), /data-fav-medium/)
})

check('an episode heart carries the feed AND the item; an artist heart the publisher id', () => {
  const ep = F.favoriteButtonHtml({ kind: 'episode', guid: GUID, itemGuid: ITEM, label: 'Ep' })
  assert.match(ep, /data-fav="episode" data-fav-id="podcast:guid:917393e3-1b1e-5cef-ace4-edaa54e1f810" data-fav-item="podcast:item:guid:cc59b81e-28a0-4e55-a457-54285c06830a"/)
  const ar = F.favoriteButtonHtml({ kind: 'artist', guid: GUID, label: 'A' })
  assert.match(ar, /data-fav="artist" data-fav-id="podcast:publisher:guid:917393e3-1b1e-5cef-ace4-edaa54e1f810"/)
  const url = F.favoriteButtonHtml({ kind: 'episode', guid: GUID, itemGuid: 'https://example.com/ep/42?x=1&y=2', label: 'Ep' })
  assert.match(url, /data-fav-item="podcast:item:guid:https:\/\/example.com\/ep\/42\?x=1&amp;y=2"/, 'a URL-shaped item guid survives, escaped')
})

check('nothing to name, nothing rendered', () => {
  assert.equal(F.favoriteButtonHtml({ kind: 'show', guid: '', label: 'x' }), '')
  assert.equal(F.favoriteButtonHtml({ kind: 'show', guid: null, label: 'x' }), '')
  assert.equal(F.favoriteButtonHtml({ kind: 'episode', guid: GUID, itemGuid: null, label: 'x' }), '')
  assert.equal(F.favoriteButtonHtml({ kind: 'show', guid: 'has "quotes"', label: 'x' }), '', 'a guid with quote characters is refused rather than escaped into an identifier')
  assert.equal(F.favoriteButtonHtml({ kind: 'playlist', guid: GUID, label: 'x' }), '')
})

check('the hero variant adds the row\'s button class', () => {
  assert.match(F.favoriteButtonHtml({ kind: 'show', guid: GUID, label: 'x', extraClass: 'btn' }), /class="ob-fav-pill btn"/)
})

check('setFavoriteState: on fills the heart and flips the verb; unknown is neither', () => {
  const b = el(F.favoriteButtonHtml({ kind: 'show', guid: GUID, label: 'My Show' }))
  F.setFavoriteState(b, true)
  assert.equal(b.getAttribute('aria-pressed'), 'true')
  assert.equal(b.querySelector('.ob-fav-icon').textContent, '♥')
  assert.equal(b.getAttribute('aria-label'), 'Unfavorite My Show')
  assert.equal(b.title, 'Unfavorite My Show')
  assert.equal(b.classList.contains('is-on'), true)
  F.setFavoriteState(b, false)
  assert.equal(b.getAttribute('aria-label'), 'Favorite My Show')
  assert.equal(b.classList.contains('is-on'), false)
  F.setFavoriteState(b, null)
  assert.equal(b.classList.contains('is-unknown'), true)
  assert.equal(b.getAttribute('aria-pressed'), 'false')
})

check('changeFor: the press asks for the opposite of the state, with the full identifiers', () => {
  const s = el(F.favoriteButtonHtml({ kind: 'show', guid: GUID, medium: 'podcast', label: 'x' }))
  assert.deepEqual(F.changeFor(s, false), { op: 'add', kind: 'feed', id: 'podcast:guid:' + GUID, medium: 'podcast' })
  assert.deepEqual(F.changeFor(s, true), { op: 'remove', kind: 'feed', id: 'podcast:guid:' + GUID, medium: 'podcast' })
  const e = el(F.favoriteButtonHtml({ kind: 'episode', guid: GUID, itemGuid: ITEM, label: 'x' }))
  assert.deepEqual(F.changeFor(e, false), { op: 'add', kind: 'item', feedId: 'podcast:guid:' + GUID, itemId: 'podcast:item:guid:' + ITEM, medium: null })
  const a = el(F.favoriteButtonHtml({ kind: 'artist', guid: GUID, label: 'x' }))
  assert.deepEqual(F.changeFor(a, false), { op: 'add', kind: 'artist', id: 'podcast:publisher:guid:' + GUID, medium: null })
})

check('keyFor agrees with the merge\'s keys: the id, or "item @ feedGuid"', () => {
  const s = el(F.favoriteButtonHtml({ kind: 'show', guid: GUID, label: 'x' }))
  assert.equal(F.keyFor(s), 'podcast:guid:' + GUID)
  const e = el(F.favoriteButtonHtml({ kind: 'episode', guid: GUID, itemGuid: ITEM, label: 'x' }))
  assert.equal(F.keyFor(e), `podcast:item:guid:${ITEM} @ ${GUID}`)
})

// ---- source rules
const strip = (src) => src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
const btnSrc = readFileSync(path.join(root, 'assets/js/favorite-button.js'), 'utf8')
const uiSrc = readFileSync(path.join(root, 'assets/js/favorites-ui.js'), 'utf8')
check('favorite-button.js is two-sided: no imports, no clock, no locale, no DOM globals', () => {
  const c = strip(btnSrc)
  assert.doesNotMatch(c, /^\s*import\s/m)
  assert.doesNotMatch(c, /Date\.now|toLocale|\bdocument\.|\bwindow\./)
})
check('every renderer of the heart imports it two-sided-safely', () => {
  for (const f of ['assets/js/show-card.js', 'assets/js/episode-card.js']) {
    const s = readFileSync(path.join(root, f), 'utf8')
    assert.match(s, /from '\.\/favorite-button\.js\?v=ob-v\d+'/, `${f} imports the heart by relative stamped path`)
    assert.match(s, /favoriteButtonHtml\(/, `${f} renders it`)
  }
  for (const f of ['functions/show/[guid].js', 'functions/episode/[guid].js']) {
    const s = readFileSync(path.join(root, f), 'utf8')
    assert.match(s, /from "\.\.\/\.\.\/assets\/js\/favorite-button\.js"/, `${f} imports the heart by relative path`)
    assert.match(s, /favoriteButtonHtml\(\{ kind: "(show|episode)"/, `${f} renders it`)
  }
})
check('the controller keeps the migration gate closed and never reaches NIP-04', () => {
  assert.match(uiSrc, /export const ITEMS_ALLOWED = false/, 'episode hearts stay hidden until both apps read the three-element item')
  assert.doesNotMatch(strip(uiSrc), /nip04|nip-04/i)
  assert.match(uiSrc, /from '\/assets\/js\/favorites-sync\.js\?v=ob-v\d+'/)
  assert.match(uiSrc, /from '\/assets\/js\/favorite-button\.js\?v=ob-v\d+'/)
  assert.match(uiSrc, /if \(btn\.dataset\.fav === 'episode'\) return ITEMS_ALLOWED/, 'the gate is what decides an episode heart\'s reveal')
})
check('the controller is loaded on every page by nav.js, lazily, and nowhere else', () => {
  assert.match(readFileSync(path.join(root, 'assets/js/nav.js'), 'utf8'), /import\('\/assets\/js\/favorites-ui\.js\?v=ob-v\d+'\)/, 'nav.js dynamic-imports it')
  for (const f of ['assets/js/feeds.js', 'assets/js/detail-page.js']) {
    assert.doesNotMatch(readFileSync(path.join(root, f), 'utf8'), /favorites-ui\.js/, `${f} no longer imports it`)
  }
  assert.match(uiSrc, /if \(buttons\(\)\.length\) reload\(\)/, 'a page with no hearts reads nothing')
  assert.match(uiSrc, /window\.OBFavorites = \{ getMode, setMode, reload/, 'the menu\'s API is exposed')
  assert.match(uiSrc, /syncFavorites\(null, \{ \.\.\.deps, store: window\.localStorage, itemsAllowed: ITEMS_ALLOWED, mode, userChose: true \}\)/, 'a mode change is a userChose cycle')
})

check('the account menu: the pill links to the member\'s page, the rows press the nav toggle and the site controller', () => {
  const jsx = readFileSync(path.join(root, 'login-widget/src/components/IdentityDropdown.jsx'), 'utf8')
  assert.match(jsx, /href=\{npub \? `\/booster\/\$\{encodeURIComponent\(npub\)\}` : undefined\}/)
  assert.match(jsx, /document\.querySelector\('\.nav-theme-toggle'\)/, 'dark mode goes through nav.js\'s own button')
  assert.match(jsx, /window\.OBFavorites/, 'the favorites row goes through the site controller')
  assert.match(jsx, /api\.setMode\(mode\)/)
  assert.doesNotMatch(jsx, /\[var\(--[a-z-]+\)\]\/\d/, 'no opacity modifier on a var() colour (emits nothing)')
  const bundle = readFileSync(path.join(root, 'assets/widgets/login-widget.js'), 'utf8')
  assert.ok(bundle.includes('OBFavorites') && bundle.includes('nav-theme-toggle'), 'the built bundle carries the rows')
})

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
