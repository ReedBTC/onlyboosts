# Dark Mode

**Moved verbatim out of `CLAUDE.md` on 2026-09-23**, when that file passed its
size budget — the same treatment the seven `docs/` files got on 2026-08-29 and
`docs/tests.md` on 2026-09-09. Nothing was rewritten on the way across, so
`git log -S <symbol> -- CLAUDE.md` still finds any paragraph that used to
live there. What stayed in `CLAUDE.md` is the handful of rules a
change elsewhere would break; this file is the design record.

**`data-theme="dark"` on `<html>`, set before first paint by the boot script in
`partials/nav.html` and toggled by the moon/sun button beside it; the choice is
per-browser in `localStorage` under `ob-theme`.** Absence of the attribute — and
any stored value other than `dark` — is the light theme, which is exactly what
every visitor saw before the toggle existed. `nav.js` owns the click, the
storage write, the button's label, and cross-tab sync via the `storage` event;
the boot script only replays the stored choice. Riding the nav partial is what
puts both on every page, the edge-rendered ones included, from one source —
which is also why **neither may contain a backtick or `${`** (sync-partials
exits nonzero if one appears; it bit once, in a comment).

The theme itself is `:root[data-theme="dark"]` blocks: the palette flip in
`theme.css`, the feed accent's flip in `index.html`'s inline block (one family
since the ramp retired — its `-d`/`-dd` steps lighten against the dark
background, the same derivation the light `-dd` used against white), and a short
dark section at the foot of each stylesheet that needed one. Every shipped value
was contrast-measured; text ≥ 4.5:1 on its surface, links and accents ≥ 6:1.

**⚠️ THE DARK GRAMMAR IS ONE GROUND, HAIRLINES, AND ONE ACCENT.** *Reed's call,
2026-08-27, against a Primal dark-mode screenshot* ("ours feels blocky and
choppy"). The first cut flipped each light surface to its own blue-tinted dark
shade and kept the navy chrome, which read as bands and boxes. What replaced it:
a near-neutral black ground; the nav, footer and `.page-header` band sit ON
that ground behind a 1px `--border` hairline instead of on their own navy; the
card (`--white`/`--surface`) and sunken (`--cream-d`) surfaces are within a few
percent of the ground, with borders doing the separating; and cyan appears only
as text, accents and fills, never as a wash a region wears (`--bg-tint` is
barely off the ground for the same reason). **Don't re-introduce a surface with
its own colour into dark mode** — that is the specific thing this pass removed.

**⚠️ TWO TOKENS DELIBERATELY DO NOT FLIP, AND `--navy` FLIPS TO THE GROUND:**

- **`--navy` becomes the page ground in dark**, which is what merges the nav
  and footer into the page. Three consequences carry scoped repairs: those
  components read `--cream`/`--cream-d`/`--white` as light TEXT, so `theme.css`
  re-supplies those inside `#top-nav`, `#site-footer` and `.page-header`; the
  `.tagblock` and `.lb-toast` fills vanished into the ground and became
  bordered surfaces (dark sections of `page.css` / `boost-actions.css`); and
  `boosts-thread.css` / `boost-actions.css` remap `--navy`/`--navy-l` *inside*
  the components that used them as text on light surfaces (`.note-card`,
  `.embed-note`, `.zap-modal`). **A new `--navy` fill needs a dark-scoped
  border or fill of its own**; a new navy-as-text usage needs a remap.
- **`--brand-dd` / `--brand-ddd`.** They are the AA fills under white on every
  filled widget button, read live by the bundle, so lightening them breaks the
  checkout. Where they were doing the *other* job — darkest text step on a
  light page — each stylesheet carries a dark-scoped override reading the
  lightened `--brand-d` instead. **A new `--brand-dd` text usage needs its own
  override**; a new filled button needs nothing.
- **`--warn` / `--danger`** are lightened, never re-hued: amber is UNCERTAIN
  and red is FAILED, and the double-pay guard rests on telling them apart in
  either theme.

**`--brand-d` inverts its role in dark**: it is the brand TEXT step (lightened),
so the two filled controls that hover onto it (`.ob-boost-pill`, `.show-main
.btn-boost`) carry scoped rules hovering to `--brand-dd` instead — contrast
still only ever increases.

**⚠️ A DARK OVERRIDE OF AN ALIASED TOKEN GOES ON THE ELEMENT THE ALIAS IS
DECLARED ON, AND THIS SHIPPED WRONG ONCE.** A custom property substitutes its
`var()` at computed-value time on the element that *declares* it, then inherits
as the resolved value. The accent families are aliases on `:root`
(`--eg-tint: var(--bg-tint)`), and the dark remap sat on `body` — so every
alias had already baked in the light value before body's override existed, and
dark mode rendered the feed panels on the light-mode cyan with the light
`--accent-d` (a blue picked for white, ~2.5:1 on a dark card) on every eyebrow
and link. Nothing errors; the page is simply the wrong colors. The remap lives
on `:root[data-theme="dark"]` now, and the inline comment beside it says why.
Reed's screenshots are what caught it — "still a lot of different shades".

Two structural notes. **The widget needed no change**: it reads the tokens live
off `:root`, so the dark `--modal-*`/state values reach the modals by
themselves, and its `var()` fallbacks stay mirrors of the *light* values — a
fallback only fires when a token is undefined (a stale `theme.css`), never in
dark mode. Which is also why **the dark block must stay below the base `:root`
block in `theme.css`**: `test-boost-modal-render.mjs` parses the first `:root`
block it finds. And the masthead needed no second banner — the clear PNG's
wordmark is cyan on transparency, which is what that file's split was for.
