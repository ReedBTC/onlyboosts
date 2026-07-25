# OnlyBoosts — Claude Code Notes

A Nostr client for podcast boosts. At heart it's an ordinary kind-1 client —
the difference is that it does **not** query relays for the feed. It reads a
pre-built JSON snapshot off the VPS (`relay.mynostr.app`), the same way
localbitcoiners' community feeds work.

**It is a single page.** `index.html` is the whole site: four hash-routed
tabs on two axes — what (boosts / podcasts) x whose (global / your follows).

| Tab | Hash | Renders |
|---|---|---|
| Boosts · Global | `#boosts-global` | the kind-1 boost notes themselves |
| Boosts · Follows | `#boosts-follows` | same, filtered to your kind-3 contacts |
| Podcasts · Global | `#podcasts-global` | episode/show rollup by boosts received |
| Podcasts · Follows | `#podcasts-follows` | same, filtered to your kind-3 contacts |

The inline tab controller in `index.html` owns activation and dispatches
`lb:feed-activate`; `assets/js/feeds.js` listens and lazily hydrates.
`feeds.html` and `boosts.html` were folded into this page and deleted —
their markup is the ancestor of the Podcasts and Boosts panels respectively.

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

## Theming

The shared stylesheets (`nav.css`, `footer.css`, `boosts-thread.css`,
`boost-actions.css`) read their colors as CSS custom properties off `:root`,
which the *page* defines. So `index.html`'s `:root` block is the single place
the theme lives.

Those stylesheets were written against localbitcoiners' token names
(`--cream`, `--navy`, `--orange`, `--green-d` …). Rather than rename ~300
usages across five files, the old names are kept as **aliases repointed at
the OnlyBoosts palette**. Trust the values, not the words — `--orange` is
brand cyan. New code should prefer `--brand` / `--ink` / `--surface`.

Brand colors are sampled from the supplied art: `--brand: #00aff0` (the
mark's cyan) and `--brand-d: #068ace` (its broadcast waves). The four feed
accents sit on one cyan→indigo ramp so the tab row reads as a single system.

One ordering trap: `.feed-tab { --tab: var(--muted) }` is a default that
appears *after* the per-tab `--tab` rules would naturally go. Same
specificity, so the per-tab rules must stay below it or every tab renders
grey.

## Site identity

| | |
|---|---|
| Domain | `onlyboosts.social` |
| npub | `npub1nmd7u4f5ewsjn6wp4zd9pc4jnadtmluanfhm2g0xryrdga7e7xxq0as4ck` |
| pubkey (hex) | `9edbee5534cba129e9c1a89a50e2b29f5abdff9d9a6fb521e61906d477d9f18c` |
| Lightning | `onlyboosts@getalby.com` |

The domain appears in `robots.txt`, `manifest.webmanifest`,
`functions/sitemap.xml.js`, the CORS allowlist in
`functions/api/community-boosts.js`, page canonical/OG tags, and the
`client` tags on published events — change them together. The npub is also
served for NIP-05 from `.well-known/nostr.json`.

## ⚠️ Money paths

Two separate things are both called "boost":

- **Boosting a podcast** — sats go to that show's own value split, parsed
  from its RSS feed. `externalBoost.js` / `externalBoostagram.js` /
  `payAllLegs.js`. This is the main event and it pays third parties.
- **Boosting the site** — a tip to OnlyBoosts, one leg at 100% to
  `RECIPIENT_LUD16`. `boostagram.js` + `BoostModal.jsx`, behind the nav's
  Boost button.

All LB payment and identity values were replaced on fork and the shipped
`assets/widgets/login-widget.js` was rebuilt — verified zero occurrences of
LB's address, npub, feed GUID, or host addresses. **`login-widget/` is a
build artifact: editing `login-widget/src/` changes nothing until you run
`npm run build`.** Verify after any change to a money path:

```sh
grep -c "onlyboosts@getalby.com" assets/widgets/login-widget.js   # expect >= 1
```

`LNADDRESS_OVERRIDES` in `recipientOverrides.js` is deliberately empty. An
entry there silently reroutes sats away from the address a show's RSS names,
without telling donor or recipient. That was defensible on LB (Reed's own
feed); here it would divert money from third-party shows. Only add one for a
feed OnlyBoosts owns.

`FEED_GUID` in `boostagram.js` is deliberately `null` — OnlyBoosts is a
client, not a podcast, so it has no feed to claim. Inheriting LB's GUID
would have mis-tagged every share note as a Local Bitcoiners boost and
polluted LB's own collector, which filters on exactly that GUID.

Code edits, dry runs, and read-only inspection are fine without asking.
**Confirm with Reed before running anything that signs or publishes a Nostr
event, or that moves sats.** Published events can't be unpublished.

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

1. **Three of the four feed loaders.** The tab shell, routing, and panels are
   done. `assets/js/feeds.js` only maps `podcasts-global` (which reads the
   snapshot and renders the episode rollup through `feeds-podcasts.js`); an
   unmapped feed is a no-op that leaves its static placeholder visible.
   `feeds.js` still carries LB's supporter-scoped data layer — that's the
   substance of items 2 and 3 below. The Events / Marketplace / Articles
   modules were deleted.

2. **"Follows" scoping.** LB filters feeds to *supporters* — the union of
   p-tags across the show's follow packs (`assets/js/supporter-set.js`).
   OnlyBoosts filters to the logged-in user's own **kind-3 follow list**.
   Same downstream filter, different source; `supporter-set.js` is the file
   to replace. Both `*-follows` panels currently show a "sign in" placeholder,
   which will stay correct — the feed genuinely needs a signed-in npub.

3. **The snapshot data source for the Boosts feeds.** `boosts-thread.js`
   still fetches one kind-1 megathread root nevent from Primal
   (`ROOT_NEVENT`) — that was LB's boost wall. OnlyBoosts reads the VPS JSON
   instead. Write a snapshot loader that feeds the *same* `renderChildCards()`
   and the card UI comes along free. `ROOT_NEVENT` and `EXCLUDED_NOTE_IDS`
   in that file are both LB leftovers.

4. **The collector bot.** `bots/community-scan/` is scoped to LB's
   supporters and skips LB's own show. OnlyBoosts wants network-wide
   coverage and skips nothing. Then point `COMMUNITY_BOOSTS_URL` in
   `functions/api/community-boosts.js` at the new file.

5. **Bug relay write-policy.** `BUG_TAG` is now `onlyboosts-alpha` in both
   `login-widget/src/lib/bugReport.js` and `bots/bug-watcher/watcher.js`,
   but `relay.mynostr.app`'s strfry write-policy plugin still has to
   whitelist that literal string. **VPS-side change — reports are silently
   rejected until it's made.**

6. **Typography.** The brand wordmark is a bold sans; the site is still on
   LB's Playfair Display / Source Serif 4 pairing. It reads fine, but the
   serif is inherited, not chosen — worth a deliberate decision. Only those
   two families are self-hosted in `assets/fonts/`.

   Branding art is otherwise done: `onlyboosts_pfp.png` (nav mark, apple-touch
   icon, PWA prompt, login modal, manifest), `onlyboosts_favicon.png`
   (favicon, manifest), `onlyboosts_banner.png` (masthead, OG image).
   `assets/avatar-fallback.svg` is *not* branding — it stands in for a person
   when a kind-0 has no picture, so keep it neutral.

## Naming note

Internal identifiers still use LB's `lb` prefix — `window.LBLogin`,
`lb_nostr_session` in localStorage, `lb-*` CSS classes, `lb:feed-activate`
events. Renaming is cosmetic and touches many files; it's deliberately not
done. Don't half-rename it.
