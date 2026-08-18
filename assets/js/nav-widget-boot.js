// ───────────────── NOSTR LOGIN WIDGET (lazy) ─────────────────
// Wires the two static nav placeholders — the Donate button and the
// identity slot — to the ~1MB login-widget bundle, which stays
// unloaded until a returning user's session restore or a nav click
// actually needs it.
//
// Loaded by every page (classic script at end of <body>, so it runs
// with the nav already parsed). Previously inlined in index.html; it's
// a file so the coming-soon pages get the same nav behavior without
// three more copies of it.
(function () {
  'use strict';

  // Shares one promise (window.__lbWidgetLoad) with every other trigger on
  // the page — assets/js/widget-loader.js for the module-side callers,
  // nav.js for the bug-report item. index.html has the most competing
  // triggers of any page, and the bundle is 1MB: without a shared promise, a
  // podcast-boost click (which awaits /api/value before injecting) racing a
  // nav Donate click appends a second <script> for a bundle already in
  // flight. The HTTP cache serves that duplicate, but the ~1MB parse+execute
  // is paid twice — on the click where the user is waiting on the modal.
  // Keep this in sync with widget-loader.js.
  function ensureWidgetLoaded() {
    if (window.LBLogin) return Promise.resolve();
    if (window.__lbWidgetLoad) return window.__lbWidgetLoad;

    window.__lbWidgetLoad = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="login-widget.js"]');
      if (existing) {
        const started = Date.now();
        const iv = setInterval(() => {
          if (window.LBLogin) { clearInterval(iv); resolve(); return; }
          if (Date.now() - started > 15000) {
            clearInterval(iv);
            window.__lbWidgetLoad = null;
            reject(new Error('login widget load timed out'));
          }
        }, 60);
        return;
      }
      const s = document.createElement('script');
      // Absolute — this file is shared by pages at more than one path.
      s.src = '/assets/widgets/login-widget.js?v=ob-v81';
      s.async = true;
      s.onload = () => { Promise.resolve().then(resolve); };
      s.onerror = () => {
        window.__lbWidgetLoad = null;
        reject(new Error('Failed to load login widget'));
      };
      document.head.appendChild(s);
    });
    return window.__lbWidgetLoad;
  }

  const boostPh = document.querySelector('[data-lb-boost-trigger="show"]');
  if (boostPh) {
    boostPh.addEventListener('click', async () => {
      boostPh.disabled = true;
      const long = boostPh.querySelector('.lb-label-long');
      const short = boostPh.querySelector('.lb-label-short');
      const prevLong = long ? long.textContent : '';
      const prevShort = short ? short.textContent : '';
      if (long) long.textContent = 'Loading…';
      if (short) short.textContent = '…';
      try {
        await ensureWidgetLoaded();
        if (window.LBLogin?.openShowBoost) window.LBLogin.openShowBoost();
      } catch (e) {
        if (long) long.textContent = prevLong;
        if (short) short.textContent = prevShort;
        boostPh.disabled = false;
        console.error('[lb] widget load failed', e);
      }
    });
  }

  const identitySlot = document.getElementById('lb-identity-slot');
  function renderIdentitySignIn() {
    if (!identitySlot) return;
    identitySlot.innerHTML =
      '<button type="button" class="lb-identity-placeholder" aria-label="Sign in with Nostr">Sign in</button>';
    const btn = identitySlot.querySelector('button');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = '…';
      try {
        await ensureWidgetLoaded();
        if (window.LBLogin?.requestLogin) window.LBLogin.requestLogin();
      } catch (e) {
        btn.textContent = prev;
        btn.disabled = false;
        console.error('[lb] widget load failed', e);
      }
    });
  }
  if (identitySlot) {
    let hasSession = false;
    try { hasSession = !!localStorage.getItem('lb_nostr_session'); } catch {}
    if (hasSession) {
      identitySlot.innerHTML = '<div class="lb-identity-restoring" aria-label="Loading account"></div>';
      ensureWidgetLoaded().catch((e) => {
        console.warn('[lb] eager widget load failed', e);
        renderIdentitySignIn();
      });
    } else {
      renderIdentitySignIn();
    }
  }
})();
