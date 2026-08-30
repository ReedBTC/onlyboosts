/* Shared nav helpers. Currently just the outside-click closer for the
   "More ▾" details dropdown — clicking anywhere outside an open
   dropdown collapses it, matching the affordance users expect from
   a top-of-page menu. */
(function () {
  'use strict'
  document.addEventListener('click', function (e) {
    var open = document.querySelectorAll('details.nav-more[open]')
    for (var i = 0; i < open.length; i++) {
      if (!open[i].contains(e.target)) open[i].removeAttribute('open')
    }
  })
  // Also collapse when the user picks an item — anchor clicks inside
  // the menu would otherwise leave the dropdown stuck open during
  // the same-page hash-jump.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('.nav-more-menu a')
    if (!a) return
    var d = a.closest('details.nav-more')
    if (d) d.removeAttribute('open')
  })

  // ── "Explore" menu (homepage) — same affordances, plus Esc, the ✕
  //    close button, and a body scroll-lock for the mobile overlay. ──
  function closeExplore() {
    var open = document.querySelectorAll('details.nav-explore[open]')
    for (var i = 0; i < open.length; i++) open[i].removeAttribute('open')
  }
  // Outside-click close.
  document.addEventListener('click', function (e) {
    var open = document.querySelectorAll('details.nav-explore[open]')
    for (var i = 0; i < open.length; i++) {
      if (!open[i].contains(e.target)) open[i].removeAttribute('open')
    }
  })
  // Close on link pick or the ✕ button.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest &&
      e.target.closest('.nav-explore-panel a, .nav-explore-close')
    if (!t) return
    var d = t.closest('details.nav-explore')
    if (d) d.removeAttribute('open')
  })
  // Esc closes.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeExplore()
  })
  // Lock body scroll while the mobile full-screen overlay is open. The
  // `toggle` event doesn't bubble, so listen in the capture phase.
  document.addEventListener('toggle', function (e) {
    var d = e.target
    if (d && d.tagName === 'DETAILS' && d.classList && d.classList.contains('nav-explore')) {
      document.body.classList.toggle('nav-explore-open', d.open)
    }
  }, true)

  // ── Dark-mode toggle ─────────────────────────────────────────────────
  // The boot script in the nav partial replays the stored choice before
  // first paint; this owns everything after — the click, the storage
  // write, the button's label, and cross-tab sync. Absence of the
  // attribute (and any stored value other than 'dark') is the light theme.
  function themeIsDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
  }
  function labelThemeToggles() {
    var dark = themeIsDark()
    var label = dark ? 'Switch to light mode' : 'Switch to dark mode'
    var btns = document.querySelectorAll('.nav-theme-toggle')
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-label', label)
      btns[i].setAttribute('title', label)
    }
  }
  function applyTheme(dark) {
    if (dark) document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
    labelThemeToggles()
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('.nav-theme-toggle')
    if (!b) return
    var dark = !themeIsDark()
    applyTheme(dark)
    // 'light' is stored explicitly rather than removed, so a pressed
    // choice stays distinguishable from never having pressed at all.
    try { localStorage.setItem('ob-theme', dark ? 'dark' : 'light') } catch (err) {}
  })
  // Another tab flipping the theme flips this one too — same pattern the
  // feed controller uses for lb_nostr_session.
  window.addEventListener('storage', function (e) {
    if (e.key !== 'ob-theme') return
    applyTheme(e.newValue === 'dark')
  })
  // The markup ships the light-mode label; correct it when the boot
  // script already set dark before this module ran.
  labelThemeToggles()

  // ── "Report a bug" trigger (More ▾ dropdown item, sitewide) ──────────
  // Lazy-loads the login-widget bundle on demand and opens the bug-report
  // modal (which gates login itself). The bundle has an internal
  // double-load guard, so injecting it here is safe even when a page also
  // lazy-loads it for boosts/identity.
  function ensureWidget() {
    if (window.LBLogin) return Promise.resolve()
    if (window.__lbWidgetLoad) return window.__lbWidgetLoad
    window.__lbWidgetLoad = new Promise(function (resolve, reject) {
      // If a page loader already injected the bundle, just wait for it.
      var existing = document.querySelector('script[src*="login-widget.js"]')
      if (existing && !window.LBLogin) {
        var iv = setInterval(function () { if (window.LBLogin) { clearInterval(iv); resolve() } }, 60)
        setTimeout(function () { clearInterval(iv); window.LBLogin ? resolve() : reject(new Error('widget load timeout')) }, 15000)
        return
      }
      var s = document.createElement('script')
      s.src = '/assets/widgets/login-widget.js?v=ob-v157'
      s.async = true
      s.onload = function () { Promise.resolve().then(resolve) }
      s.onerror = function () { window.__lbWidgetLoad = null; reject(new Error('widget load failed')) }
      document.head.appendChild(s)
    })
    return window.__lbWidgetLoad
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-lb-bug-trigger]')
    if (!t) return
    e.preventDefault()
    ensureWidget().then(function () {
      if (window.LBLogin && window.LBLogin.openBugReport) window.LBLogin.openBugReport()
    }).catch(function (err) { console.error('[lb] bug-report widget load failed', err) })
  })
})()
