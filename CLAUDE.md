# OnlyBoosts — Claude Code Notes

A Nostr client for podcast boosts. Four feeds: **Global Boosts**, **Follows
Boosts**, **Global Podcasts**, **Follows Podcasts**. At heart it's an
ordinary kind-1 client — the difference is that it does **not** query relays
for the feed. It reads a pre-built JSON snapshot off the VPS
(`relay.mynostr.app`), the same way localbitcoiners' community feeds work.

## Where this code came from

This repo is a hard fork of **ReedBTC/localbitcoiners** (cloned at `lb-v43`,
history intact). Upstream is wired as the `lb` remote with pushes disabled:

```
git fetch lb
git log lb/main --oneline          # see what's new upstream
git cherry-pick <sha>              # pull a specific LB fix across
git show lb/main:path/to/file.js   # read a file that was stripped here
```

Anything deleted during the strip is still recoverable that way — reach for
`git show lb/main:...` before rewriting something from scratch.

Design and code are also expected to be pulled from:
- `~/Desktop/Files/nostr/mynostr` — the full React Nostr client
- `ChadFarrow/boostmebitch` (BMB) — Podcast Index proxy, wallet rails,
  signed-out boosts via a server-side identity, live-stream zaps

## Stack

Vanilla HTML + ES modules, no build step for the site itself. Cloudflare
Pages + Pages Functions. The one thing that *does* build is
`login-widget/` (Vite + React), which compiles to
`assets/widgets/login-widget.js`:

```
cd login-widget && npm install && npm run build
```

Local dev: `wrangler pages dev .` (so `/api/*` Functions resolve).

## Conventions carried over from LB — keep these

- **CSP meta tag on every page.** All pages share one policy so tightening
  happens in lockstep.
- **Shared nav/footer are generated.** Edit `partials/nav.html` /
  `partials/footer.html`, then run `node scripts/sync-partials.js`. Never
  edit the copies inside page files — they're between `NAV:START`/`NAV:END`
  markers and get overwritten.
- **Pages Functions bound every upstream fetch**: wall-clock timeout, byte
  cap, *and* a streamed read (`resp.text()` buffers before you can check
  size). See `functions/api/community-boosts.js` for the reference shape.
- **CORS origin allowlists are exact-match `Set` lookups**, never
  `startsWith` — a prefix check lets a lookalike origin get reflected into
  `Access-Control-Allow-Origin`.
- **`isSafeUrl()` before any user-supplied URL** reaches `href`/`src`.
- **Bump `VERSION` in `sw.js`** when shipping changed assets that returning
  visitors must get on the *first* navigation rather than the second.

## ⚠️ Before any deploy

The **"boost the show" path still carries Local Bitcoiners' live payment and
identity values**, inherited from the fork. It moves **real sats** — shipping
it unchanged routes OnlyBoosts users' boosts into the LB wallet. The files:

- `login-widget/src/lib/boostagram.js` — `RECIPIENT_LUD16`
  (`localbitcoiners@getalby.com`) and `RECIPIENT_NPUB`
- `login-widget/src/lib/recipientOverrides.js` — LB lightning addresses
- `login-widget/src/lib/episodeData.js` — builds `LocalBitcoinersEpNNN`
  invoice-comment markers, which `payAllLegs.js` filters on

Decide what "boost" means here first. If boosts always go to the *podcast
being boosted* via its own value split, this whole path is dead code and
should be **deleted**, not repointed — the live path is `externalBoost.js` /
`externalBoostagram.js`. Only repoint the constants if OnlyBoosts has its own
house wallet. Client/app identification tags were already repointed to
`onlyboosts.com`; the money values deliberately were not, so they stay
visible.

More generally: code edits, dry runs, and read-only inspection are fine
without asking. **Confirm with Reed before running anything that signs or
publishes a Nostr event, or that moves sats.** Published events can't be
unpublished.

## What's built vs. what isn't

**Working, ported from LB:**
- `assets/js/boosts-thread.js` — the kind-1 card renderer, profile cache,
  mention/quote/embed resolution. This is the client core.
- `assets/js/boost-actions.js` — reply / like / repost / zap
- `login-widget/` — NIP-07/46/nsec login, NWC + WebLN wallets, boost modals,
  multi-leg value-split payments, bug-report modal
- `partials/` + `scripts/sync-partials.js` — shared nav/footer
- `functions/api/community-boosts.js` — the VPS snapshot proxy
- `bots/bug-watcher/` — polls the bug relay, opens GitHub issues
- `bots/community-scan/` + `bots/shared/` — the boost classifier: NIP-73
  `podcast:item:guid` tags, zap-receipt unwrapping for Fountain-style notes
  with no `amount` tag, Podcast Index enrichment

**Still to build:**

1. **The four feeds.** `feeds.html` / `assets/js/feeds.js` are still LB's
   tab shell (Events / Marketplace / Podcast Boosts / Articles) — kept
   deliberately as the template. Rework to the OnlyBoosts four. The tab
   controller, lazy per-tab loading, and the `lb:feed-activate` event
   pattern all transfer.

2. **"Follows" scoping.** LB filters feeds to *supporters* — the union of
   p-tags across the show's follow packs (`assets/js/supporter-set.js`).
   OnlyBoosts filters to the logged-in user's own **kind-3 follow list**.
   Same downstream filter, different source; `supporter-set.js` is the file
   to replace.

3. **The snapshot data source.** `boosts.html` currently reads one kind-1
   megathread root nevent from Primal (`ROOT_NEVENT` in
   `boosts-thread.js`). OnlyBoosts reads the VPS JSON instead. Replace
   `fetchBoostThread()` with a snapshot loader that feeds the *same*
   `renderChildCards()` — the card UI comes along free.

4. **The collector bot.** `bots/community-scan/` is scoped to LB's
   supporters and skips LB's own show. OnlyBoosts wants network-wide
   coverage and skips nothing. Then point `COMMUNITY_BOOSTS_URL` in
   `functions/api/community-boosts.js` at the new file.

5. **Bug relay write-policy.** `BUG_TAG` is now `onlyboosts-alpha` in both
   `login-widget/src/lib/bugReport.js` and `bots/bug-watcher/watcher.js`,
   but `relay.mynostr.app`'s strfry write-policy plugin still has to
   whitelist that literal string. **VPS-side change — reports are silently
   rejected until it's made.**

6. **Branding.** No logo, favicon, or OG image exists yet (LB's were
   stripped). Colors and fonts are still LB's cream/navy/orange — see the
   TODO in `index.html`. The domain is assumed to be `onlyboosts.com` in
   `robots.txt`, `manifest.webmanifest`, `functions/sitemap.xml.js`, and the
   CORS allowlist — change all four together if that's wrong.

## Naming note

Internal identifiers still use LB's `lb` prefix — `window.LBLogin`,
`lb_nostr_session` in localStorage, `lb-*` CSS classes, `lb:feed-activate`
events. Renaming is cosmetic and touches many files; it's deliberately not
done. Don't half-rename it.
