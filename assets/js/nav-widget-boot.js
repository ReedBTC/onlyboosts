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
      s.src = '/assets/widgets/login-widget.js?v=ob-v167';
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
  // Exposed for the modules that need the widget on a gesture of their own
  // (the 40 HPW share control's "Post to Nostr"), so there is one loader and
  // one in-flight promise rather than a second copy of this function.
  window.__lbEnsureWidget = ensureWidgetLoaded;

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
        // ⚠️ `openSiteDonation`, NOT `openShowBoost`. The nav's Donate button
        // used to open the LB tip form, which signs its note before paying and
        // therefore needs a signer by construction — so a visitor with no Nostr
        // account could not donate at all. It now opens the same modal a podcast
        // boost opens, with one leg at 100% to the site's own address.
        // `openShowBoost` is still exported and still works; nothing on this
        // fork calls it.
        // ⚠️ NO FALLBACK TO `openShowBoost`, DELIBERATELY. There was one, and it
        // is how this stayed broken: that method's first gate is a bare
        // `api.requestLogin()`, so a missing `openSiteDonation` degraded into
        // the exact login wall this flow exists to remove, silently and
        // plausibly. A method that is not there should do nothing visible and
        // say so in the console, not quietly run a different product.
        if (window.LBLogin?.openSiteDonation) window.LBLogin.openSiteDonation();
        else console.error('[lb] openSiteDonation missing; the widget bundle is stale');
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
      '<button type="button" class="lb-identity-placeholder" aria-label="Log in to OnlyBoosts">' +
      // ⚠️ THE MARK AND THE WORD MUST MATCH `LoginButton`'s nav skin, which
      // replaces this the moment the 1MB bundle lands. Any drift between the
      // two shows up as the button visibly changing shape on every page load.
      '<img src="/assets/onlyboosts_favicon.png" alt="" aria-hidden="true" width="18" height="18">Log in</button>';
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
