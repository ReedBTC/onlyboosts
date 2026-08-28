# Theming: Design Record

Moved out of CLAUDE.md on 2026-08-28 to keep that file within its size
budget. CLAUDE.md's "Theming" section holds the operating rules; this file holds the full record behind them: the dark-mode passes, the widget's CSS failure classes, and the measurements.
Headings are unchanged from CLAUDE.md, so `git log -S <text> -- CLAUDE.md`
still finds each section's earlier history there.

---

## Theming

The shared stylesheets (`nav.css`, `footer.css`, `boosts-thread.css`,
`boost-actions.css`) read their colors as CSS custom properties off `:root` and
don't define them — every page has to supply the tokens. That supply is
`assets/css/theme.css`: the palette, the `@font-face` rules, and the base
`body`/`a`/`img` styles. **Link it from every page, last among the shared
stylesheets** so a page's own inline `<style>` still wins.

`index.html` keeps one theme block of its own — the eight per-feed accents and
the `body[data-active-feed]` mapping. `assets/css/page.css` is the counterpart
for the plain content pages (`.page-header`, `.soon-card`).

### Dark Mode

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

**The login/boost widget is a fork of LB's and wore LB's dark palette until
2026-08-21** — `bg-neutral-900`, `border-neutral-700`, `text-orange-500` on every
primary button. OnlyBoosts is light, so pressing Boost took the reader out of the
site's visual world entirely. It is now on the site's own tokens.

**⚠️ THE TOKENS ARE READ, NOT COPIED.** `theme.css` defines the palette on
`:root`, the widget mounts into that same document through a portal, and Tailwind
runs there with **preflight off**, so `bg-[var(--modal-bg)]` works with no config
change. Never hardcode a hex into JSX; the palette has one source.

**⚠️ BUT EVERY `var()` CARRIES A LITERAL FALLBACK, AND AN INVISIBLE MODAL IS
WHY.** `scripts/stamp-assets.js` exists so one version of one file can never
meet another — except that **`assets/widgets/` files are stamped at the
reference site and never rewritten**, so `login-widget.js?v=ob-v94` and
`?v=ob-v95` are the same file on disk and the server returns the current build
for either. A browser holding `theme.css?v=ob-v94` in its four-hour HTTP cache
while fetching the widget fresh therefore gets **a new widget against an old
stylesheet**: the `ob-v53` failure class arriving through the one door the
stamper cannot close.

**An undefined custom property makes the whole declaration invalid at
computed-value time**, so `background-color: var(--modal-bg)` resolves to
*transparent*. Observed 2026-08-21: the boost modal rendered as a near-invisible
outline over the dimmed page, in the middle of a payment flow.

The fallbacks are **mirrors, not a second source of truth**:
`scripts/test-boost-modal-render.mjs` reads `theme.css` and asserts that every
`var()` in the widget has a fallback *and* that each one equals the token's
current value. Edit the palette without re-mirroring and that test fails. The
two font tokens are the deliberate exception, degrading to `Georgia,serif`,
because Tailwind strips the space out of `'Playfair Display'` unless it is
written `Playfair_Display` and `PlayfairDisplay` is not a font — a missing token
there costs the face, not legibility.

`theme.css` carries a block for exactly this: `--brand-tint`, `--brand-ring`,
`--ok`, `--warn`, `--danger`, `--scrim`, `--font-display`, `--font-body`.

**⚠️ THE THREE STATE COLOURS WERE RE-PICKED, NOT RE-TONED.** Amber is
`UNCERTAIN` and red is `FAILED`, and the whole double-pay guard rests on a donor
telling them apart at a glance: one may be re-paid and the other may never be.
The dark theme's `amber-400` and `red-400` are near-identical on cream. `--warn`
is a burnt orange and `--danger` a true red, different in hue as well as value.
`--warn` is also deliberately outside the brand family, since brand is cyan and
"warning" must not read as "in progress".

**⚠️ THE MODAL PANEL IS NOT PURE WHITE, DELIBERATELY.** Three surface tokens,
because a modal needs a panel, fields sunk into it and boxes raised off it, and
two cannot express that: `--modal-bg` (panel), `--modal-field` (inputs),
`--modal-inset` (sub-boxes). The panel was `--surface` and read as a slab — a
full-bleed `#fff` rectangle over a dimmed page is the brightest thing on screen
by a wide margin, which at modal size is glare rather than emphasis. The fields
are the white now, which is also the right way round: white is where you type.

**⚠️ THE WIDGET CARRIES ITS OWN SCOPED PREFLIGHT, AND EVERY PORTAL MUST WEAR
THE SCOPE.** Tailwind's preflight is off here — correctly, since this bundle
mounts into the live site and must not reset the host page — but preflight also
supplies two things every Tailwind UI silently assumes: `border-width:0;
border-style:solid` on everything, and a form-control reset. Without them the
modals rendered with the **browser's native button outlines** (reported as
"weird button outlines that make it look unprofessional" — they were the
operating system's) while every border the markup *did* ask for drew nothing.
Two opposite faults from one missing base layer, which is why the modals looked
simultaneously outlined and undefined.

`.lb-w` is the scope. `makeHost` puts it on every host div and **every
`createPortal` wraps its children in one**, because a portal renders into
`document.body` and would otherwise sit outside any scope. A new portal without
the wrapper is a modal back in OS chrome.

**⚠️ AND A WRAPPED PORTAL STILL HAS TO BE PASSED A CONTAINER.** Adding that
wrapper put the closing `</div>` on the wrong side of the comma in **eight of
ten** call sites, producing
`createPortal(<div className="lb-w">…document.body</div>)` — one argument, so
React rendered nothing. It is valid JSX (`document.body` just becomes text
inside the div), so **the build was silent and every test passed**, and the only
symptom was that the Boost button and the nav Log in button stopped opening
anything. `scripts/test-boost-modal-render.mjs` now walks to the matching paren
and counts top-level commas, because the broken form and the correct one differ
by six characters in the middle of a JSX block.

**⚠️ AND THE INNER `:where()` IS LOAD-BEARING FOR THE OPPOSITE REASON, BECAUSE
AN ATTRIBUTE SELECTOR CARRIES CLASS WEIGHT.** `:where(.lb-w) [type='button']`
has the scope correctly wrapped and is still **(0,1,0)** — dead level with
`.bg-[var(--brand-dd,#0a6fa8)]` — and `styles.css` is appended **after**
`@tailwind utilities`, so the tie broke in the reset's favour and
`background-color: transparent` won. **Every element in the widget carrying an
explicit `type="button"` had its `bg-*` utility silently killed**, from the day
the reset shipped until 2026-08-22. It surfaced as the four boost presets
rendering at `#f4fafd`, the modal's own background, with the picked one
white-on-white; it was reported as a colour bug and "fixed" as one twice before
anybody sampled the pixels and found all four buttons identical. A bare
`button` is (0,0,1) and was never the problem, which is exactly why it hid: the
buttons with no `type` attribute looked right. The list is wrapped —
`:where(.lb-w) :where(button, [type='button'], …)` — which takes the whole
selector to (0,0,0). **Tailwind's own preflight writes these unwrapped and gets
away with it because it lands in `@layer base` BEFORE the utilities; do not
"match upstream" here.** `test-boost-modal-render.mjs` now computes the real
specificity of every selector in the reset and demands (0,0,0), which is a
strictly stronger check than the `.lb-w`-is-wrapped one beside it.

**⚠️ `:where(.lb-w)` IS LOAD-BEARING, NOT TIDINESS.** Preflight's own selectors
are bare elements at specificity 0,0,0 and 0,0,1, which is exactly why `py-3`
beats the `padding: 0` preflight just set. Scoping naively to `.lb-w button`
makes it 0,1,1, which **beats `.py-3` and flattens every button in the widget**.
`:where()` contributes nothing, so these land at preflight's own weight. The
test counts any `.lb-w` used without it.

**Lists are reset too** (`list-style: none`): the host page's global
`*{padding:0}` had already flattened the indent, so UA disc markers sat *outside*
the content box and were clipped by the container's rounded border — the boost
progress list looked like every row had something cut off its left edge.

**No `img` / `svg` rule is included**, deliberately: preflight's
`max-width:100%; height:auto` would resize icons that are currently correct,
which is a visual change wearing the costume of a bug fix.

**⚠️ AND THE WIDGET RESTORES `border-style` ITSELF, IN THAT SAME LAYER.**
Tailwind's `border` utility sets `border-width` and nothing else; the
`border-style: solid` comes from **preflight**, which is off here so the bundle
cannot reset the host page. So `border-width: 1px` sat over CSS's initial
`border-style: none` and **every border in the widget drew nothing** —
`border-style` appeared nowhere in the built bundle at all. It survived the dark
theme because those surfaces differ by *fill*: a `#171717` panel on `#0a0a0a`
reads as an edge whether or not a line exists. On the light theme the borders
carry all the definition, so their absence flattened every modal into one pale
rectangle. `login-widget/src/styles.css` puts it back, keyed on the border
utility class names, which are safe to select globally **only because Tailwind
scans `./src/**` alone and the site styles itself with semantic classes.** If
the site ever adopts Tailwind, scope it. The test asserts the bundle carries
`border-style:solid`.

**⚠️ `--modal-line` IS A STEP DARKER THAN `--border`, and it earns the extra
token.** `--border` was drawn for cards on the cream *page*; inside a modal every
surface is within a few percent of every other, so the same line disappears.

**⚠️ TWO TAILWIND SHAPES FAIL SILENTLY HERE AND BOTH HAVE BITTEN.**

*An arbitrary value Tailwind cannot classify emits the wrong property.* `font-[var(--font-display)]` compiled to
`font-weight: var(--font-display)` — it cannot tell a family from a weight in a
bare `font-[…]`, so it guessed, and the browser dropped the declaration. Every
heading was in the default sans while every class name in the markup looked
right. The fix is the type hint, `font-[family-name:var(--font-display)]`, and
the same trap sits on `ring-`, `text-` and `bg-` wherever a value could be read
as a length or a colour.

*An opacity modifier on an arbitrary `var()` colour emits nothing at all.*
`border-[var(--brand)]/40` produces **no rule**, so the element falls back to
`currentColor`. Five of these had crept in. There is no way to express it, so
the rule is: **an alpha on a var is a literal `rgba()` or a different token.**

**`scripts/test-boost-modal-render.mjs` catches both**, the first by asserting
against the **built bundle** that each token produces a real declaration, the
second by refusing the `/\d` shape in source. Nothing else about either failure
is visible: the class names look right, the build is silent, and the page is
simply unstyled in one place.

**⚠️ A FILLED BRAND BUTTON IS `--brand-dd`, NEVER `--brand`, AND THE RAMP HAS A
FOURTH STEP FOR ITS HOVER.** White on `--brand` measures **2.50:1** and on
`--brand-d` **3.79:1**, so both fail AA — and the pair failed in the wrong
direction too, since the old buttons went from one illegible fill to a slightly
less illegible one on hover. That is why the wallet menu's log-in button was
reported as "almost invisible until you hover over it" and why the boost
presets were reported twice. All fifteen filled buttons in the widget are now
`--brand-dd` (5.45:1) with `--brand-ddd` (6.96:1) on hover, so contrast only
ever increases. `--brand-ddd` exists for exactly this and has no other caller.

**Two surfaces stay dark on purpose**: `IdentityWidget`'s pill and
`BoostButton`, which sit on the navy nav bar rather than on a modal. Neither
carries the white-on-brand pairing, which is why the sweep above left them
alone.

**Known and deliberately not changed:** `boosts-thread.css` and
`boost-actions.css` still tint hover states with `rgba(247,147,26,…)`, LB's
bitcoin orange. Those are the site's own reaction bars, not the widget, and they
were out of scope for the widget restyle.

`assets/css/feed-cards.css` holds the **episode card and everything that hangs
off it** — the range/sort controls, the card, the boost drawer, the inline boost
thread, the copy toast, `.ob-stats-label` and `.feed-placeholder`. Every rule in
it reads `--accent` / `--accent-d` / `--tint`, so a page that links it has to
supply them.

Those stylesheets were written against LB's token names (`--cream`, `--navy`,
`--orange`, `--green-d` …). Rather than rename ~300 usages, the old names are
kept as **aliases repointed at the OnlyBoosts palette**. Trust the values, not
the words — `--orange` is brand cyan. New code should prefer `--brand` / `--ink`
/ `--surface`.

**⚠️ THE FEED ACCENT HAS A FOURTH STEP, `--*-accent-dd`, AND IT IS FOR TEXT.**
Same idea as `--brand-dd`: white on `--bg-accent` measures **2.50:1** and the
same colour as ink on cream is **2.29:1**, so anything small wearing the accent
is illegible. The phone's tab chips read it both ways — as a fill under white
when selected, as the label and border when not — which is where Reed saw it
(2026-08-23). The value is the least darkening of the cyan that reaches 6:1 on
white. `--accent-dd` is mapped beside `--accent` on every `body[data-active-feed]`
row, and `--tab-dd` rides beside `--tab` on the tabs because CSS cannot build
one custom property's name out of another's.

**⚠️ THE DESKTOP TAB AND THE SUB-ROW STILL USE `--accent` AND STILL MEASURE
2.50:1.** Only the phone chips were changed, which is what was asked for and
where the type is smallest. It is the same bug at a larger size; fixing it means
the selected tab and the block below it stop sharing a fill, which is the thing
the seam note under **The Three Tabs** exists to protect. A decision, not an
oversight.

Brand colors are sampled from the supplied art: `--brand: #00aff0` and
`--brand-d: #068ace`. **⚠️ THE PER-FEED ACCENT RAMP IS RETIRED.** *Reed's call,
2026-08-27, on seeing the feeds beside dark mode:* the eight feeds sat on one
cyan→indigo→violet ramp, the violet tail marking the music half of the medium
split, so switching feed shifted the page wash. Every feed now wears the one
brand-cyan family — the one Members · Global always wore, and the same accent
the detail pages supply — in both themes. **The retirement is values-only**: the
eight family names survive in `index.html` as aliases of `--bg-*`, the
`body[data-active-feed]` mapping is untouched, and the dark remap touches
`--bg-*` alone (a dark line for any other family would silently override the
aliasing — the inline comment says so). A revival is repointing the aliases; the
ramp's light and dark values and the reasoning that picked them are in git
before 2026-08-27. `--accent` / `--accent-d` / `--tint` remain the only names
the shared chrome sees.
