# Two-Sided Modules, And What They Cost

*Split out of `CLAUDE.md` on 2026-08-29, when that file passed its size budget.
This is the authority for the subject; `CLAUDE.md` keeps the rules a change would
break and points here for the arguments and the measurements. Nothing was rewritten
on the way across — `git log -S <symbol> -- CLAUDE.md` still finds any paragraph
that used to live there.*

---

### ⚠️ One Module, Imported From Both Sides

This is the mechanism the whole thing rests on. A Pages Function imports
`../../assets/js/episode-card.js` by relative path and esbuild inlines it off the
filesystem; the browser imports `/assets/js/episode-card.js?v=<VERSION>` and gets
the same file. So a card rendered at the edge and the same card rebuilt in the
browser after a re-sort are byte-identical **by construction**. What a two-sided
module cannot use is an **absolute** `/assets/js/…` import, which the browser
resolves and esbuild cannot.

Two rules follow, both enforced by `scripts/stamp-assets.js`:

- **A two-sided module imports its siblings as `'./thing.js?v=<VERSION>'`.**
- **Everything a two-sided module imports must itself be two-sided.**
  `show-link.js`, `episode-link.js`, `booster-link.js`, `cover-art.js` and
  `nostr-text.js` are all dependency-free, which is what made this cheap.

The episode card is the worked example, split along the facts/verbs line:

| | |
|---|---|
| `assets/js/episode-card.js` | the FACTS, as an HTML **string**: artwork and its fallback chain, title, show, air date, rank, the `Nostr Stats:` line, and every boost note inside the drawer. No DOM, no `fetch`, no `Intl` defaults. |
| `assets/js/episode-card-actions.js` | the VERBS: the ⋮ subscribe menu, the boost pill, the drawer's hide control, the per-boost ⋮ menu, and the reply / like / repost / zap bars. |

**The show card is the second, and it exists because of the tabs.**
`assets/js/show-card.js` is the facts as a string and
`assets/js/show-card-actions.js` the verbs; `functions/_shared/show-cards.js` is
the server half, mirroring `episode-cards.js`. `shows-feed.js` is the feed
around that card rather than the card itself.

**⚠️ THREE FORMATTERS WERE SAFE IN A DOM BUILDER AND ARE NOT SAFE HERE**, and
none of them looks like anything when it breaks. `relTime()` read `Date.now()`
— at the edge that clock is the moment the response was *cached*, and the same
bytes go to everyone arriving inside the 300s window, so a server-rendered
"3m ago" is wrong for almost every reader of it and different again from what
the browser rebuilds. The timestamp is the fact and the relative time is a
reading of it, so the card renders `last boost Nov 14, 2023` with
`data-latest-ts` and the actions module rewrites it. `shortDate()` called
`toLocaleDateString(undefined, …)` and `plural()` called `n.toLocaleString()`
unpinned. All three are `en-US` in UTC now. `test-show-card.mjs` scans the
source for all three, because the test process is already en-US in UTC and a
render check passes regardless.

**The show card's drawer is a `<details>` and is always lazy.** Its rows come
from `/api/v1/podcasts/<guid>` scoped to the card's own range, so they are never
in hand when the card is built — at the edge or in the browser. There is no
inline counterpart to choose between, which is why this card has no `parts`
table the way the episode card does.

**⚠️ NO SURFACE PRINTS AN EPISODE NUMBER, ANYWHERE.** *Reed's call, 2026-08-24.*
Three did: the boost row's episode chip (`Ep. 42 · Title`), the `/show` episode
drawer's `.ep-num` span, and the `/episode` hero's facts line. **Most publishers
already put the number in the title they wrote**, so the site printed it twice —
"Ep. 42 · Episode 42: The Thing" — and the duplicate half was the one we added.
The title is the publisher's own name for the episode and is left to speak for
itself.

The `itemAbbr` copy key existed only to render it and is **gone from all three
`COPY` tables, from `renderBoosts`' signature and from the boost row's state
element**, so a repaint cannot reintroduce it on one surface. What is NOT gone is
the data: `episodes.episode_number` is still stored, still selected by
`BOOST_SELECT`, still `e_num` on the row shape and still `num` on `/api/v1`.
**`test-boost-row.mjs` asserts the chip renders the title alone** against a
fixture whose `e_num` is 42, because re-adding the prefix is a one-line change
that looks like an improvement. `.ep-num` is deleted from `show-page.css`.

**The boost row is the third worked example**, and the same split:
`assets/js/boost-list.js` is the facts (`renderBoosts`, `boostRows`, the three
comparators, the range filter) and `assets/js/boost-section.js` is the verbs.
See "Range And Sort On `#boosts`" under the detail pages.

**Three knobs decide what a surface shows of the card, and only three.**
`CARD_PARTS` in `episode-card.js` is the whole table:

| | |
|---|---|
| `stats` | the `Nostr Stats:` line. Off on `/booster/<npub>`, where every card aggregates one person's boosts and the booster count is 1 by construction. |
| `layout` | `feed` or `compact`. Compact is the detail-page drawers and means three things that move together: no inline `<audio>`, no ⋮ subscribe menu, and the boost pill in a right-hand rail of its own, vertically centred. |
| `drawer` | `inline` or `lazy`. **Where the drawer's boost notes come from.** Inline (the default, and both detail pages) renders them into the `<details>` body with the card. Lazy (`HOME_CARD_PARTS`, the homepage only, and since Phase D declared by `feeds-podcasts.js` itself rather than by a Function) ships the body holding only its footer, and `episode-card-actions.js#fillLazyDrawer` fetches `/api/v1/episodes/<guid>?names=1` on the first open and renders the rows through the exported `boostRowsHtml`, the same function, so a fetched row is byte-identical to an inline one (verified against production data). |

**⚠️ Lazy is not the homepage being exempted from the rendering rule; it is the
rule's beneficiaries being named.** Server-rendered notes exist for the crawler,
and the crawler's pages are the ~930 show and ~2,000 episode pages in the
sitemap. The homepage is not one of them, and every card on it links to the
`/episode/<guid>` page where those same notes *are* in the document, so nothing
is un-indexed. What it buys is measured under The Cost, Stated. What it costs is
one small fetch per drawer opened, and the drawer becomes *complete*: the inline
rows are capped at 50 per episode by `include=boosts`, where the per-episode
endpoint returns all of them (cap 500, worst case 55). A failed fetch leaves a
status line and the footer's "See all boosts" link, and the next open retries.

**`include=boosts` stays on the homepage's query on both sides**, because the
drawer bar's booster faces are computed from the boost rows. The notes still
travel D1 → edge and, on a client-fetched page, D1 → browser as JSON; they stop
being *rendered* into the document. A lighter faces-only include is the follow-up
if that JSON ever matters.

The player and the ⋮ both come off for one reason: every card's title links to
that episode's own page, which carries both on a surface with room for them.
**The pill can only be centred because the ⋮ is gone** — they share the card's
right edge.

**⚠️ The Function declares the variant and it travels in the state element**, so
a client repaint cannot render a different card than the edge did. **Spacing is
not in that table** — the compact card's padding, artwork size and type scale are
CSS scoped to `.ce-scroll` in `episode-page.css`, because a padding value cannot
make the two sides render different markup.

**⚠️ `functions/index.js` fetches `/` from `env.ASSETS`, never `/index.html`.**
Pages 308-redirects `/index.html` to `/`, `/` is that Function, and returning the
redirect made the front door answer `ERR_TOO_MANY_REDIRECTS`. It shipped that way
once. A 3xx from the asset server is now never propagated.

The five surfaces the card serves, all one definition:

| Surface | Rendered by |
|---|---|
| Homepage Episodes / Songs | `feeds-podcasts.js` — **client-rendered since Phase D**, the front door having moved to Shows |
| `/episode/<guid>` `#community-episodes` | `functions/episode/[guid].js` |
| `/booster/<npub>` `#episodes` | `functions/booster/[npub].js` |
| every re-sort, range change and search pick | `feeds-podcasts.js` / `episode-section.js` |

`functions/_shared/episode-cards.js` is the server-side helper all three
Functions call (`itemsFromBoosts`, `renderCardPage`, `CARDS_PER_PAGE`).

**The homepage's front door is server-rendered too, and since Phase D it is the
SHOW card that renders there.** `functions/index.js` fetches `index.html` through
`env.ASSETS` and splices one ranked page into one marked slot
(`<!--OB:SSR-SHOWS-->`, inside the Shows panel); `shows-feed.js` finds those
cards and **adopts** them rather than refetching. It is a **fast path, not a
dependency** — a failed asset fetch, a D1 error or a missing marker all serve the
file untouched and the feed hydrates as before. See **The Landing Feed** below.

**⚠️ ONE FEED IS SERVER-RENDERED AND IT IS THE ONE ON SCREEN.** Rendering
Episodes as well would put a second ranked list in the document inside a hidden
panel: bytes every reader downloads, a feed nobody is looking at, and a crawler
shown two rankings on one URL. So `feeds-podcasts.js#adoptServerCards` has no
producer today. **It is kept rather than deleted**, marked as such at its own
definition: it is the client half of the landing-feed decision, it collapses to
`adoptedCount = 0` when it finds nothing, and it is what makes moving the front
door a change to the Function alone.

Three things that fell out of the split:

- **The drawer is a `<details>`**, not a button beside a hidden div. The boost
  notes inside it are facts and, on the detail pages, are in the document, so a
  control only JavaScript could open would leave them unreachable. On the
  homepage the same `<details>` fills on open; see the `drawer` knob above.
- **Dates are `en-US` in UTC on the feeds**, not the reader's locale, because the
  edge and the browser have to produce the same string. The site has one date
  format rather than two.
- **Boost messages tokenize through `nostr-text.js`**, so a `nostr:note1…` inside
  a message is the same njump chip on every surface.
- **A message keeps its line breaks.** `renderMessage` capped its text through
  `truncate`, which collapses *all* whitespace, so a multi-line note arrived as
  one run-on paragraph — with `white-space: pre-wrap` already set on all three
  message classes (`.pcast-boost-msg`, `.note-body`, `.boost-msg`), so the CSS
  had been ready the whole time and the newlines were being destroyed one layer
  above it. It shows up hardest on this site's **own** bot notes, which are
  structured. `capMessage` keeps newlines and collapses only runs of blank
  lines, so a note padded with six cannot push the rest off a card; spaces and
  tabs still collapse.
- **⚠️ AN IMAGE URL IS A LINK, NEVER AN `<img>`, AND THIS WAS TRIED THE OTHER
  WAY.** Inline images shipped on 2026-08-21 and were reverted the same day:
  **they make the notes way too big** (Reed). A boost card is a dense row in a
  long list and one picture turns it into a post — several to a screen instead
  of a dozen. That the height was capped is beside the point; the objection is
  to the block existing, so **it does not come back as a thumbnail either.**
  Nothing is lost — the URL still links out, and clients that render the picture
  inline are unaffected. `test-episode-card.mjs` asserts the revert stayed,
  because re-adding it is a two-line change that looks like an improvement.

### The Cost, Stated

More server rendering is more D1 reads and more edge CPU per request. A detail
page runs six or seven queries plus a Podcast Index fetch in one `Promise.all`.
The 300s edge cache absorbs most of it; the failure mode to watch for is a slow
TTFB rather than a blank page, which is the better failure of the two.

Measured against production when the episode card closed the last exception:

| | |
|---|---|
| Homepage first view | **206.6KB → 217.7KB brotli**, and one round trip instead of two. The 431KB JSON fetch is gone; the document went 14.5KB → 150.6KB br. |
| Homepage raw markup | **54KB → 1.15MB**: ~5,000 extra DOM nodes for 737 boost rows, all inside closed `<details>`. |

**And re-measured on 2026-08-18 when the homepage's drawers went lazy** (the
`drawer` knob), same capture, `test-server-render.mjs`:

| | inline drawers | lazy drawers |
|---|---|---|
| Document, raw | 1,190.7KB | **226.5KB** |
| Document, brotli | 153.8KB | **33.0KB** |
| First view, brotli (document + module graph) | 221.4KB | **100.6KB**, under the old two-round-trip page's 210.2KB for the first time |
| Elements in the card block | 9,774 | **1,449** |
| Feed-bar controller after the first card | 1,160,125 bytes | **~172KB** |

**And re-measured on 2026-08-23 when Phase D moved the front door to Shows**,
against a fresh capture of `/api/v1/podcasts?not_medium=music&sort=boosters`:

| | Episodes, lazy drawers | **Shows** |
|---|---|---|
| Cards on the opening page | 30 | **25** (`SHOW_CARDS_PER_PAGE`) |
| Document, raw | 226.5KB | **152.8KB** |
| Document, brotli | 33.0KB | **35.5KB** |
| First view, brotli (document + module graph) | 100.6KB | **103.7KB** |
| Feed-bar controller after the first card | ~172KB | **46.3KB** |

**⚠️ THE SAVING HERE IS A ROUND TRIP, NOT BYTES, and the numbers say so.** The
episode page removed a 431KB JSON fetch; the show page's own JSON is 3.2KB
brotli, so server-rendering it is +1.3KB on the first view against one fewer
request. The case for it is the rendering rule and the crawler, not weight — a
ranked list of shows with their boost figures is a FACT, and the front door is
the site's most-linked URL. The last row is the incidental win: the show card
carries no boost rows at all, so the controller sits 46KB behind the first card
rather than 172KB.

The last row of the table above it is the one that was the bug: with the controller 1.16MB after the
first card, the browser painted the whole Episodes · Global feed before any
script could read which feed the hash named, and every `#shows` / `#albums` /
`#members` load flashed Episodes first. **That flash was fixed here, at the
cause, and two patches for it were rejected on 2026-08-17 for that reason**:
skeletons painted over the server's cards, and a boot script in `<head>`
carrying its own copy of the feed-key list. Don't re-propose either.

**It did not touch the eager-avatar problem, and the two are easy to confuse**:
148 of the 236 distinct avatar URLs sit on the visible drawer *bar* as well as
in the rows inside, so those requests were never in the drawer markup. That was
fixed separately and earlier, by making every avatar `loading="lazy"`.
| `/episode/<guid>` | one extra query in the existing `Promise.all` — median 248 rows, capped at 2,000. ~190ms for a heavy episode against a page TTFB of ~170ms, so the page pays `max()` rather than `sum()`. |
| `/booster/<npub>` | the same, and cheaper: one indexed scan, heaviest booster 975 rows. |

**Both detail-page corpus queries are allowed to fail quietly**, the same
discipline the two podroll queries have: a rollup below the fold must never cost
a reader the page they came for. And **neither client module fetches the corpus
until the reader touches a control or presses "Load more"**.
