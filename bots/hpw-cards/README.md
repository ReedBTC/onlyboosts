# hpw-cards — the share-card renderer

Screenshots the site's boards into PNGs the site can hand to a preview crawler
or a share modal. Two families, one contract:

| Family | Boards |
|---|---|
| **hpw** | the Nostr Gang #40HPW boards: one card per week, plus the all-time board, Proof of #40HPW |
| **charts** (since 2026-09-03) | the OnlyBoosts Charts boards: the week's Shows and Artists Top 10 on the chart rule, and the three Weeks at #1 boards (shows, artists, members) |

The directory keeps its first name; the bot renders both.

```
onlyboosts_hpwcards.py            # dry run → ./preview, nothing published
onlyboosts_hpwcards.py --live     # → the shards tree + state.json
run-hpwcards.sh --live            # the same, bounded at 90s (what the cycle calls)
```

## Why a screenshot

The boards are already rendered by `assets/js/members-board.js` — laid out,
styled, contrast-checked, and kept correct by whoever edits that file. Drawing
them a second time here would be a second implementation of the same layout,
and it would start drifting the day somebody changes the real one. A screenshot
cannot drift. The cost is a browser on this box; the alternative's cost is a
card that quietly stops matching the site.

## What it writes

Inside the collector's shards tree, so
`onlyboosts_globalscan.py push` ships them with the JSON on the same rsync and
a `--delete` mirror run does not prune them:

```
../global-boost-scan/data/shards/hpw/<YYYY-MM-DD>.png              one week's #40HPW board
../global-boost-scan/data/shards/hpw/high-scores.png               the all-time board
../global-boost-scan/data/shards/hpw/index.json                    the manifest
../global-boost-scan/data/shards/charts/shows-<YYYY-MM-DD>.png     the week's Shows Top 10
../global-boost-scan/data/shards/charts/artists-<YYYY-MM-DD>.png   the week's Artists Top 10
../global-boost-scan/data/shards/charts/shows-weeks-at-1.png       Shows: Weeks at #1
../global-boost-scan/data/shards/charts/artists-weeks-at-1.png     Artists: Weeks at #1
../global-boost-scan/data/shards/charts/members-weeks-at-1.png     Members: Weeks at #1
../global-boost-scan/data/shards/charts/index.json                 the manifest
```

The site proxies them at `/api/og/hpw/<name>.png` and
`/api/og/charts/<name>.png`. A dry run writes the same two subdirectories under
`./preview/`.

Shapes are documented in `../global-boost-scan/DATA-API.md`. Every write is a
temp file plus a rename, so a failed render leaves the previous card serving
rather than a truncated one — at a URL the site already links, a broken image
is worse than a stale board.

## Why it does not render every cycle

Chromium's PNG output is not byte-stable, so re-rendering on every five-minute
tick would hand rsync a changed file every time for every board. So the *data*
is hashed instead — the `members` array of an hpw board's API response, the
`rows` array of a chart board's — and a board whose hash is unchanged is
skipped. That hash travels into the manifest as `source_hash`, which is how a
consumer tells a real re-render from a re-encode.

Each cycle checks the live week, high-scores, the three Weeks at #1 boards,
and the **12 most recent weeks** of every weekly kind: the collector fills in
episode durations after the fact, and a dedupe or an exclusion re-ranks a
past chart, so a *past* board can still move with no board code touched.
That is 40 boards and ~7s of API calls a cycle; a typical cycle then renders
the live-week boards and nothing else.

**Live boards render before history.** The wrapper cuts a run at 90s, and a
first cycle after a deploy has more boards than fit — so the all-time and
live-week boards go first, and **state and the manifests are saved after every
render**, not once at the end. A run the bound kills keeps what it rendered and
the next tick continues from there, rather than re-rendering the same first N
boards forever.

**The two families fail separately.** The chart endpoints did not exist on
production until the site's branch merged, and a bot that raised on that 404
would have stopped rendering the #40HPW cards too. A family whose API is
missing or down is a logged `[warn] … skipped this run`; only both failing is
a failed run.

## Why there is no week rule in this bot

Weeks start Monday 00:00 US Pacific, and that DST arithmetic already exists
twice — `assets/js/pacific-week.js` and the SQL twin inside
`functions/api/v1/members/hours.js` — held together by
`scripts/test-members-hours.mjs`. A third copy, in Python, on a box nothing
tests, would be the copy deciding *which* weeks get a card, so an hour's error
would render the wrong board under the right filename.

So this walks weeks **through the API**. To step back one week it asks for the
calendar date three days before the current week's start — the Friday of the
previous week — and the endpoint resolves it with the canonical rule. It is the
same three-day probe `prevWeek()` uses, evaluated server-side, and it costs
nothing: every week stepped over is one whose members had to be fetched anyway.
`/api/v1/charts/<kind>?week=` resolves a date exactly as the hours endpoint
does, so the chart weeks step with the same probe, through the Shows endpoint;
the Artists board for each week is fetched by the week's own Monday, and the
bot refuses to continue if the two endpoints ever disagree about a week.

Verified against production: 99 weeks back to 2024-10-07, every one a Monday,
every step exactly 7 calendar days, across all four DST transitions in the
corpus.

## Install

Python deps live in a venv here rather than system-wide — this box runs the
collector on `/usr/bin/python3` under PEP 668, and Playwright plus its browser
is ~400MB that has no business in system site-packages.

```sh
cd ~/onlyboosts/bots/hpw-cards
python3 -m venv .venv
.venv/bin/pip install playwright
.venv/bin/playwright install chromium          # ~130MB, no root
sudo .venv/bin/playwright install-deps chromium # 33 apt packages, NEEDS ROOT
```

**⚠️ THE LAST LINE IS THE ONE THAT MATTERS AND IT IS EASY TO SKIP.** Chromium
will not start without it — this is a headless box with no desktop stack, so
`libatk-1.0.so.0` and friends are simply absent, and the failure is a launch
error rather than anything about fonts.

**⚠️ A MISSING FONT IS NOT AN ERROR, IT IS A BLANK BOX IN SOMEBODY'S NAME.**
That same command installs the fonts, and they are load-bearing for a reason
that is not obvious: the card page self-hosts its own text faces, so the layout
looks perfect while any character those faces do not carry falls through to a
system fallback that does not exist. Measured here before the fonts went in,
the all-time board rendered **"The Bullish ◻itcoiner"** — U+20BF, the bitcoin
sign, tofu'd in the #2 slot. Nothing logged it. Emoji are the same class of
problem and the more likely one; `fonts-noto-color-emoji` is in that package
list, and colour emoji, CJK and Cyrillic were all confirmed rendering
afterwards. **After any change to this box's fonts, look at a card.**

`.venv/` and `preview/` are gitignored. Disk, measured after the install: **153MB**
for the venv and **656MB** under `~/.cache/ms-playwright` — Playwright fetches the
full Chromium, the headless shell and ffmpeg, not just the one binary it runs. Call
it **~810MB**, plus the fonts apt pulls in.

## Flags

| | |
|---|---|
| *(none)* | dry run — renders to `./preview`, writes no state, publishes nothing |
| `--live` | write into the shards tree and `state.json` |
| `--all` | every week back to `first_week` (~99 hpw weeks, ~114 chart weeks × 2 kinds today), not the recent window |
| `--force` | re-render even where the hash matches |
| `--only K[,K…]` | named boards: `YYYY-MM-DD`, `high-scores`, `shows-<date>`, `artists-<date>`, `shows-weeks-at-1`, `artists-weeks-at-1`, `members-weeks-at-1` |
| `--standin` | hpw only: screenshot `/#members` instead of the card page — see below |

`--all` needs `HPW_TIMEOUT=0` to escape the wrapper's 90s bound (or, since the
state is checkpointed per render, it can simply be left to the cycle to finish
over several ticks).

## Which origin

`OB_SITE` picks the origin the bot both screenshots and hashes — always the
same one, so the picture and the `source_hash` beside it can never describe
different data. **It defaults to `https://onlyboosts.social` and that is now
the right answer: the card page merged to main in `4ec28ae` on 2026-08-30, so
nothing needs to override it.**

The variable earns its keep for the next card-page change: point it at a branch
preview to render and measure without touching what production serves.

```sh
OB_SITE=https://<branch>.onlyboosts.pages.dev ./run-hpwcards.sh   # dry run
```

⚠️ **A preview render must never reach the VPS.** Anything published from a
branch is a card of a page nobody can see yet, and `state.json` will happily
consider it current — the hash is of the DATA, which is the same either way, so
nothing detects the mismatch. Re-render with `--force` after a merge; that is
what closed out the three preview-era cards on 2026-08-30.

`--standin` predates the card page and clipped the board out of `/#members`.
Kept as a fallback, superseded.


## The row ceiling, per card kind

The card page clips its list inside the board shell, so a row that grows past
its budget is not an overlap but a **silently missing tenth row**; the bot
measures the `[data-card-list]` box before every screenshot and refuses to
publish a clipped card (`CardOverflow`, exit 2). The budget is measured, not
derived, and it moves with any chrome change around the list, so re-measure
after touching a card page:

```sh
.venv/bin/python test-clip-guard.py https://<branch>.onlyboosts.pages.dev
```

Measured 2026-09-03 on the `misc-updates` preview, 720x900 at scale 1
(layout is identical at scale 2):

| Card | List box | Room | Rows | Ceiling | Headroom |
|---|---|---|---|---|---|
| hpw week, Proof of #40HPW | 269.5 → 829 | 560px | 49.2–50.2px | **56.0px** | 5.8px |
| shows / artists / members weeks-at-1 | 269.5 → 829 | 560px | 49.2–50.2px | **56.0px** | 5.8px |
| shows / artists weekly | 296.9 → 829 | 532.6px | 49.2–50.2px | **53.3px** | 3.1px |

The weekly chart cards are the tight ones: the `rank in sats/boosters/boosts`
column head costs 27.4px of the list box and the rank triplet does not make the
row any taller. A row on those cards may grow **3.1px**, an hpw row 5.8px.

## Cadence

A commented three-line block at the foot of
`../global-boost-scan/run-incremental.sh`. It sits **after** the D1 delta sync,
because the card is a photograph of the live site and the live site reads D1 —
and that is below `push`, so it carries a second `push` to ship the PNGs on the
same cycle. The comment there explains the trade and the one-push alternative.

Bounded at 90s by `run-hpwcards.sh` (`HPW_TIMEOUT` to change, `0` to disable).
Chromium is the one thing in this pipeline that can hang rather than fail, and
a wedged renderer would hold the pipeline lock and stall the boost cycle behind
it. A cap that fires is logged and shrugged off: the previous cards stand, and
whatever this run rendered before the cap is already saved.

Measured 2026-09-03 against the branch preview: ~7s to check all 40 boards,
1.3–4.5s a render, ~30s for every chart board from cold. A steady-state cycle
is well inside the bound; the first cycle after the chart endpoints deploy
renders 27 chart boards and may need two ticks.

## Outward reach

Read-only. One GET per board checked against `onlyboosts.social`'s public API
(`/api/v1/members/hours`, `/api/v1/charts/*`), the card page loads themselves,
and nothing else. No Nostr, no signing, no
sats, and no push of its own — the rsync is the collector's, unchanged.
