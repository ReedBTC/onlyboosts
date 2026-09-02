# hpw-cards — #40HPW share-card renderer

Screenshots the Nostr Gang #40HPW boards into PNGs the site can hand to a
preview crawler. One card per week, plus the all-time board, Proof of #40HPW.

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
../global-boost-scan/data/shards/hpw/<YYYY-MM-DD>.png    one week's board
../global-boost-scan/data/shards/hpw/high-scores.png     the all-time board
../global-boost-scan/data/shards/hpw/index.json          the manifest
```

Shapes are documented in `../global-boost-scan/DATA-API.md`. Every write is a
temp file plus a rename, so a failed render leaves the previous card serving
rather than a truncated one — at a URL the site already links, a broken image
is worse than a stale board.

## Why it does not render every cycle

Chromium's PNG output is not byte-stable, so re-rendering on every five-minute
tick would hand rsync a changed file every time for every board. So the *data*
is hashed instead — the `members` array of the board's own API response — and a
board whose hash is unchanged is skipped. That hash travels into the manifest
as `source_hash`, which is how a consumer tells a real re-render from a
re-encode.

Each cycle checks the live week, high-scores, and the **12 most recent weeks**:
the collector fills in episode durations after the fact, so a *past* board can
still move with no board code touched.

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
| `--all` | every week back to `first_week` (~99 today), not the recent window |
| `--force` | re-render even where the hash matches |
| `--only KEY` | one board: a `YYYY-MM-DD`, or `high-scores` |
| `--standin` | screenshot `/#members` instead of the card page — see below |

`--all` needs `HPW_TIMEOUT=0` to escape the wrapper's 90s bound.

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


## Cadence

A commented three-line block at the foot of
`../global-boost-scan/run-incremental.sh`. It sits **after** the D1 delta sync,
because the card is a photograph of the live site and the live site reads D1 —
and that is below `push`, so it carries a second `push` to ship the PNGs on the
same cycle. The comment there explains the trade and the one-push alternative.

Bounded at 90s by `run-hpwcards.sh` (`HPW_TIMEOUT` to change, `0` to disable).
Chromium is the one thing in this pipeline that can hang rather than fail, and
a wedged renderer would hold the pipeline lock and stall the boost cycle behind
it. A cap that fires is logged and shrugged off: the previous cards stand.

## Outward reach

Read-only. Two GETs per board checked against `onlyboosts.social`'s public API,
the card page loads themselves, and nothing else. No Nostr, no signing, no
sats, and no push of its own — the rsync is the collector's, unchanged.
