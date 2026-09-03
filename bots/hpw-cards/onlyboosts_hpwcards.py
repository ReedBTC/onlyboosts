#!/usr/bin/env python3
"""Render the site's share-card boards to PNGs, on this box.

Two families of board, one contract:

  hpw     the Nostr Gang #40HPW boards — one per week, plus Proof of #40HPW
          (the all-time board; `high-scores` is its filename, not its name)
  charts  the OnlyBoosts Charts boards (since 2026-09-03) — the week's Shows
          and Artists Top 10 on the chart rule, and the three Weeks at #1
          boards (shows, artists, members)

A share card is a REAL SCREENSHOT of the site's own card page, taken with
Playwright's Chromium here, not an image drawn from the data a second time.
That is the whole design: the boards are already rendered, styled and
contrast-checked by the site's two-sided board modules, and any renderer of
our own would be a second implementation of the same layout, drifting the
moment somebody edits the real one. A screenshot cannot drift.

READ-ONLY OUTWARD. GETs against onlyboosts.social's public API per board
checked, and the page loads themselves. No Nostr, no signing, no sats, and no
push of its own — the PNGs are written INSIDE the collector's shards tree, so
`onlyboosts_globalscan.py push` ships them with the JSON on the same rsync.
That placement is also what makes them safe from the mirror push: a `--delete`
run prunes what is not in the local tree, and these are in it.

  bots/global-boost-scan/data/shards/hpw/<YYYY-MM-DD>.png        one week's board
  bots/global-boost-scan/data/shards/hpw/high-scores.png         the all-time board
  bots/global-boost-scan/data/shards/hpw/index.json              the manifest
  bots/global-boost-scan/data/shards/charts/shows-<YYYY-MM-DD>.png    the week's Shows Top 10
  bots/global-boost-scan/data/shards/charts/artists-<YYYY-MM-DD>.png  the week's Artists Top 10
  bots/global-boost-scan/data/shards/charts/shows-weeks-at-1.png      Shows: Weeks at #1
  bots/global-boost-scan/data/shards/charts/artists-weeks-at-1.png    Artists: Weeks at #1
  bots/global-boost-scan/data/shards/charts/members-weeks-at-1.png    Members: Weeks at #1
  bots/global-boost-scan/data/shards/charts/index.json                the manifest

⚠️ WHY IT DOES NOT RE-RENDER EVERY CYCLE. Chromium's PNG output is not
byte-stable, so a render on every tick would hand rsync a changed file every
five minutes for every board — a few MB of pointless transfer an hour, and a
mtime churn that makes "what actually changed" unreadable in the logs. So the
DATA is hashed instead: the `members` array of an hpw board's API response,
the `rows` array of a chart board's. Same hash, same board, no render.
`source_hash` in state.json and in the manifest is that hash, which is also
what lets a reader of the manifest tell a re-render from a re-encode.

⚠️ THE WEEK RULE IS NOT REIMPLEMENTED HERE, DELIBERATELY. Weeks start Monday
00:00 US Pacific and the DST arithmetic already exists twice — in
`assets/js/pacific-week.js` and, for the all-time board's buckets, in SQL
inside `functions/api/v1/members/hours.js`. CLAUDE.md notes those two cannot
share code and are held together by `scripts/test-members-hours.mjs`. A third
copy, in Python, on a box nothing tests, is exactly the drift that note is
warning about — and it would be the copy that decides WHICH weeks get a card,
so a one-hour error would silently render the wrong board under the right
filename.

Instead this walks weeks THROUGH THE API, which resolves them with the
canonical rule. To step back one week it asks for the calendar date three days
before the current week's start: that is the Friday of the previous week
(week starts are Monday 07:00 or 08:00 UTC, so minus three days is Friday
morning UTC), the endpoint resolves it at noon UTC per its own documented rule,
and answers with that week's real `week_start`. It is the same three-day probe
`prevWeek()` uses in the JS module, evaluated server-side. It costs nothing
extra: every week stepped over is a week whose rows we had to fetch anyway to
hash them. `/api/v1/charts/<kind>?week=` resolves a date exactly the way
`/api/v1/members/hours` does, so the chart weeks step with the same probe.

⚠️ THE TWO FAMILIES FAIL SEPARATELY. The chart endpoints did not exist on
production until the site's `misc-updates` branch merged, and a bot that
raised on a 404 there would have stopped rendering the #40HPW cards too. So
each family collects its targets on its own: one family's API being missing or
down is a logged skip for that family and nothing else, and only both failing
is a failed run.

Usage:
    onlyboosts_hpwcards.py                 # dry run: render to ./preview, no state written
    onlyboosts_hpwcards.py --live          # write into the shards tree + state.json
    onlyboosts_hpwcards.py --all           # every week back to first_week (backfill; slow)
    onlyboosts_hpwcards.py --force         # ignore the hashes, re-render what is selected
    onlyboosts_hpwcards.py --only K[,K]    # named boards; see `--only` in the README for the keys
    onlyboosts_hpwcards.py --standin       # hpw only: screenshot /#members instead of the card page
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ── convention: a new bot does not write anywhere real until Reed flips it ────
DRY_RUN = True

HERE = Path(__file__).resolve().parent
SHARDS = HERE.parent / "global-boost-scan" / "data" / "shards"
PREVIEW_DIR = HERE / "preview"
STATE_FILE = HERE / "state.json"
LOCK_FILE = HERE / "hpw-cards.lock"

SITE = os.environ.get("OB_SITE", "https://onlyboosts.social")
UA = "onlyboosts-hpwcards/1.1 (+https://onlyboosts.social)"
HTTP_TIMEOUT = 20

# ⚠️ PORTRAIT, 4:5, NOT THE 1.91:1 OG BOX. Reed's call 2026-08-29, after
# downloading one: a share card is looked at on a phone, and a landscape card
# arrives as a letterbox strip a third of the screen tall. 720x900 at scale 2 is
# 1440x1800 — fewer pixels than the 2400x1260 it replaced, so the size headroom
# under the 900KB cap improved rather than shrank.
VIEWPORT = {"width": 720, "height": 900}
SCALE = 2
# The page sets this once its fonts and avatars have settled. Waiting on a
# SELECTOR rather than a sleep is the difference between a card that is right
# and a card that is right most of the time.
READY_SELECTOR = 'html[data-card-ready="1"]'
READY_TIMEOUT_MS = 20_000
# The site's proxy refuses anything larger; a card that will not be served is
# not a card. Retrying at scale 1 roughly quarters the pixels.
MAX_PNG_BYTES = 900 * 1024
# Durations get filled in later, so a PAST board can still move. Twelve weeks
# is the window over which that has been seen to happen. The chart boards take
# the same window: a dedupe or an exclusion moves a past week's chart the same
# way a late duration moves a past week's hours.
RECENT_WEEKS = 12

# The two families. `dir` is the subdirectory under the shards tree (and under
# ./preview on a dry run); `state` is the key in state.json that holds the
# family's cards — `cards` for hpw is the pre-2026-09-03 name, kept so the
# existing state.json needs no migration.
HPW = "hpw"
CHARTS = "charts"
FAMILY_DIR = {HPW: "hpw", CHARTS: "charts"}
FAMILY_STATE = {HPW: "cards", CHARTS: "charts"}

HIGH_SCORES = "high-scores"
# ⚠️ A PATH SEGMENT IN THE WILD once rendered — the site's ONES_KEY, and the
# bot screenshots the literal, so it does not move (the /hpw/high-scores rule).
WEEKS_AT_1 = "weeks-at-1"
CHART_WEEK_KINDS = ("shows", "artists")
CHART_ONES_KINDS = ("shows", "artists", "members")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CHART_WEEK_RE = re.compile(r"^(shows|artists)-(\d{4}-\d{2}-\d{2})$")
CHART_ONES_RE = re.compile(r"^(shows|artists|members)-weeks-at-1$")

# ── stand-in, until the card page is deployed ────────────────────────────────
# `/hpw/<date>/card` and `/hpw/high-scores/card` 404'd before 2026-08-30. The
# website agent owns them. Pointing at the live Members tab and clipping to the
# board element proved every other part of this pipeline. Superseded; kept as a
# fallback for the hpw family only — the chart boards never had one.
STANDIN_URL = f"{SITE}/#members"
STANDIN_CLIP = {
    "week": '[data-hpw-board="week"]',
    # The all-time board is the one `boardHtml` renders without the attribute.
    HIGH_SCORES: '.hpw-board:not([data-hpw-board])',
}


def log(msg):
    print(f"[hpw-cards] {msg}", flush=True)


# ── the site's API ───────────────────────────────────────────────────────────
def api(path, **params):
    url = f"{SITE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def hours(range_, week=None):
    return api("/api/v1/members/hours", range=range_, week=week)


def chart_week(kind, week=None):
    return api(f"/api/v1/charts/{kind}", week=week)


def chart_ones(kind):
    return api(f"/api/v1/charts/{kind}/{WEEKS_AT_1}")


def board_hash(envelope, field):
    """Hash the board itself, not the envelope around it.

    `generated`-style fields and the live week's moving `week_end` would change
    on every call and defeat the whole point; the `members` (hpw) or `rows`
    (charts) array is exactly what the card draws.
    """
    board = envelope.get(field) or []
    blob = json.dumps(board, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def members_hash(envelope):
    return board_hash(envelope, "members")


def rows_hash(envelope):
    return board_hash(envelope, "rows")


def week_date(ts):
    """A week start as the `YYYY-MM-DD` the site addresses it by.

    UTC is safe here for the same one-directional reason `weekDateString` in
    `pacific-week.js` gives: Pacific is BEHIND UTC, so Monday 00:00 Pacific is
    Monday 07:00 or 08:00 UTC and the instant is still a Monday in UTC.
    """
    return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%d")


def walk_weeks(fetch, limit=None):
    """(date, envelope) newest first, walking back through the API itself.

    `fetch(week=None)` returns the live week's envelope and `fetch(week=date)`
    the envelope of the week containing that date, in the hours endpoint's
    envelope shape (`week_start`, `current_week`, `first_week`). Stops at
    `first_week`, at `limit`, or the moment a step fails to move backwards —
    that last guard is what stops a changed endpoint spinning here forever.
    """
    env = fetch(None)
    ws = env.get("week_start") or env.get("current_week")
    first = env.get("first_week")
    if not ws:
        raise RuntimeError("the week endpoint returned no week_start")
    n = 0
    while True:
        yield week_date(ws), env
        n += 1
        if limit is not None and n >= limit:
            return
        if first and ws <= int(first):
            return
        probe = week_date(ws - 3 * 86400)     # the Friday of the week before
        env = fetch(probe)
        nxt = env.get("week_start")
        if not nxt or int(nxt) >= ws:
            log(f"[warn] week stepping made no progress at {week_date(ws)} — stopping")
            return
        ws = int(nxt)


def iter_weeks(limit=None):
    """The hpw weeks: (date, hours envelope) newest first."""
    return walk_weeks(lambda week: hours("week", week=week), limit=limit)


def iter_chart_weeks(limit=None):
    """The chart weeks: (date, {kind: envelope}) newest first.

    Stepped through the Shows endpoint; the Artists board for the same week is
    fetched by the week's own Monday date, which resolves to itself.
    """
    for date, shows in walk_weeks(lambda week: chart_week("shows", week=week), limit=limit):
        envs = {"shows": shows}
        for kind in CHART_WEEK_KINDS[1:]:
            env = chart_week(kind, week=date)
            got = env.get("week_start")
            if got and week_date(got) != date:
                # The two endpoints share one week rule, so this cannot happen
                # unless one of them changed; a card under the wrong name is
                # worse than a missing one.
                raise RuntimeError(f"charts/{kind}?week={date} resolved to {week_date(got)}")
            envs[kind] = env
        yield date, envs


# ── rendering ────────────────────────────────────────────────────────────────
class CardOverflow(RuntimeError):
    """A row was clipped out of the card's list box.

    ⚠️ THIS IS A FAILED RENDER, NOT A COSMETIC ONE, AND THE RENDERER IS THE ONLY
    SIDE THAT CAN SEE IT. The card page clips its list inside the board shell, so
    a row that no longer fits does not overflow into the footer any more — it
    simply stops being drawn. The page still returns 200, still sets
    `data-card-ready`, and still screenshots into a card that looks entirely
    correct; the tenth member is just gone from it while the board and the
    Members tab still list them. Nothing upstream can detect that, because
    nothing upstream measures the picture.

    So a clipped row publishes nothing: the previous PNG stays, and this is
    logged loudly. Website agent's call, 2026-08-29, written into the site's
    CLAUDE.md beside the card page so a row cannot grow without a re-measure.
    """


def clip_report(page):
    """What the card actually drew, measured in the page. None if it has no list.

    Every card frame marks its list with `data-card-list` (2026-09-03; it was
    read by class before, which would have needed one probe per board kind),
    and the rows are the list's children. `rowMin`/`rowMax`/`room` are for the
    per-kind ceiling measurement in test-clip-guard.py; the guard itself only
    reads `clipped`.

    An EMPTY board is not a failure — a week with no qualifying boosts renders
    an empty-line `<p>` and no list at all, which is a real and correct card.
    """
    return page.evaluate("""() => {
      const list = document.querySelector('[data-card-list]');
      if (!list) return null;                       // an empty board; legitimate
      const box = list.getBoundingClientRect();
      const lb = box.bottom;
      const rows = [...list.children];
      // Half a pixel of tolerance: the list bottom and a final row's bottom are
      // the same edge in the fitting case, and subpixel layout makes exact
      // equality a coin toss that would fail a card at random.
      const cut = rows.filter(r => r.getBoundingClientRect().bottom > lb + 0.5);
      const heights = rows.map(r => r.getBoundingClientRect().height);
      return {
        rows: rows.length,
        clipped: cut.length,
        firstClipped: cut.length ? rows.indexOf(cut[0]) + 1 : null,
        listTop: Math.round(box.top * 10) / 10,
        listBottom: Math.round(lb),
        room: Math.round(box.height * 10) / 10,
        lastRowBottom: rows.length ? Math.round(rows.at(-1).getBoundingClientRect().bottom) : null,
        rowMin: heights.length ? Math.round(Math.min(...heights) * 10) / 10 : null,
        rowMax: heights.length ? Math.round(Math.max(...heights) * 10) / 10 : null,
      };
    }""")


def family_of(key):
    """Which family a key belongs to, or None for a key nothing renders."""
    if key == HIGH_SCORES or DATE_RE.match(key):
        return HPW
    if CHART_WEEK_RE.match(key) or CHART_ONES_RE.match(key):
        return CHARTS
    return None


def card_url(key, standin=False):
    fam = family_of(key)
    if fam == HPW:
        if standin:
            return STANDIN_URL
        if key == HIGH_SCORES:
            return f"{SITE}/hpw/high-scores/card"
        return f"{SITE}/hpw/{key}/card"
    if fam == CHARTS:
        m = CHART_WEEK_RE.match(key)
        if m:
            return f"{SITE}/charts/{m.group(2)}/card/{m.group(1)}"
        m = CHART_ONES_RE.match(key)
        return f"{SITE}/charts/{WEEKS_AT_1}/card/{m.group(1)}"
    raise ValueError(f"not a board key: {key}")


def capture(browser, url, scale, clip_selector=None):
    ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=scale)
    try:
        page = ctx.new_page()
        page.goto(url, wait_until="load", timeout=READY_TIMEOUT_MS)
        if clip_selector:
            # Stand-in path: no ready flag to wait on, so settle the network
            # (avatars) and then clip to the board element.
            page.wait_for_load_state("networkidle", timeout=READY_TIMEOUT_MS)
            el = page.wait_for_selector(clip_selector, state="visible", timeout=READY_TIMEOUT_MS)
            return el.screenshot(type="png")
        page.wait_for_selector(READY_SELECTOR, state="attached", timeout=READY_TIMEOUT_MS)
        # Measured BEFORE the screenshot, and it raises rather than returning a
        # flag: a clipped card must not reach `write_atomic`. Scale does not
        # enter into it — the layout is identical in CSS pixels — so failing
        # here also correctly skips the scale-1 retry.
        rep = clip_report(page)
        if rep and rep["clipped"]:
            raise CardOverflow(
                f"{rep['clipped']} of {rep['rows']} row(s) clipped out of the card "
                f"(first is row {rep['firstClipped']}); list bottom {rep['listBottom']}, "
                f"last row bottom {rep['lastRowBottom']}"
            )
        return page.screenshot(type="png")
    finally:
        ctx.close()


def render(browser, key, standin=False):
    """PNG bytes for one board, dropping to scale 1 if scale 2 is too heavy."""
    standin = standin and family_of(key) == HPW
    url = card_url(key, standin)
    clip = STANDIN_CLIP["week" if key != HIGH_SCORES else HIGH_SCORES] if standin else None
    t0 = time.monotonic()
    png = capture(browser, url, SCALE, clip)
    scale = SCALE
    if len(png) > MAX_PNG_BYTES:
        log(f"  {key}: {len(png)/1024:.0f}KB at scale {SCALE} exceeds "
            f"{MAX_PNG_BYTES//1024}KB — re-capturing at scale 1")
        png = capture(browser, url, 1, clip)
        scale = 1
    took = time.monotonic() - t0
    if len(png) > MAX_PNG_BYTES:
        raise RuntimeError(f"{key}: {len(png)} bytes even at scale 1 — the proxy would refuse it")
    log(f"  {key}: {len(png)/1024:.0f}KB, scale {scale}, {took:.1f}s")
    return png


# ── output ───────────────────────────────────────────────────────────────────
def write_atomic(path, data):
    """Rename into place, so a failed render leaves the PREVIOUS card serving.

    A truncated or half-written PNG at a URL the site already links is worse
    than a stale one: stale is last week's board, truncated is a broken image.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def family_dir(root, family):
    return root / FAMILY_DIR[family]


def png_path(root, key):
    return family_dir(root, family_of(key)) / f"{key}.png"


def load_state():
    try:
        state = json.loads(STATE_FILE.read_text())
    except FileNotFoundError:
        state = {"version": 2}
    except Exception as e:
        log(f"[warn] unreadable state.json ({e}) — starting fresh, everything re-renders")
        state = {"version": 2}
    for fam in FAMILY_STATE.values():
        state.setdefault(fam, {})
    state["version"] = 2
    return state


def save_state(state):
    state["updated_at"] = int(time.time())
    tmp = STATE_FILE.with_name(STATE_FILE.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, STATE_FILE)


def write_json_atomic(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, indent=2) + "\n")
    os.replace(tmp, path)


def hpw_manifest(cards):
    weeks = {k: v for k, v in cards.items() if k != HIGH_SCORES}
    return {
        "generated": int(time.time()),
        "high_scores": cards.get(HIGH_SCORES),
        "weeks": dict(sorted(weeks.items(), reverse=True)),
    }


def charts_manifest(cards):
    """The hpw manifest's shape one level deeper: `weeks_at_1` where hpw has
    `high_scores`, keyed by kind, and `weeks` keyed by date and then by kind."""
    weeks = {}
    for key, card in cards.items():
        m = CHART_WEEK_RE.match(key)
        if m:
            weeks.setdefault(m.group(2), {})[m.group(1)] = card
    return {
        "generated": int(time.time()),
        "weeks_at_1": {kind: cards.get(f"{kind}-{WEEKS_AT_1}") for kind in CHART_ONES_KINDS},
        "weeks": {d: dict(sorted(weeks[d].items())) for d in sorted(weeks, reverse=True)},
    }


MANIFEST = {HPW: hpw_manifest, CHARTS: charts_manifest}


def write_manifest(root, family, cards):
    """The manifest is how a consumer discovers filenames.

    DATA-API's standing rule: directories are not browsable on the VPS, so
    nothing builds a path by hand.
    """
    path = family_dir(root, family) / "index.json"
    write_json_atomic(path, MANIFEST[family](cards))
    return path


# ── the cycle ────────────────────────────────────────────────────────────────
def hpw_targets(args):
    """[(key, source_hash, is_history)] for the #40HPW family."""
    targets = [(HIGH_SCORES, members_hash(hours("all")), False)]
    limit = None if args.all else RECENT_WEEKS
    for i, (date, env) in enumerate(iter_weeks(limit=limit)):
        targets.append((date, members_hash(env), i > 0))
    return targets


def chart_targets(args):
    """[(key, source_hash, is_history)] for the charts family."""
    targets = [(f"{kind}-{WEEKS_AT_1}", rows_hash(chart_ones(kind)), False) for kind in CHART_ONES_KINDS]
    limit = None if args.all else RECENT_WEEKS
    for i, (date, envs) in enumerate(iter_chart_weeks(limit=limit)):
        for kind in CHART_WEEK_KINDS:
            targets.append((f"{kind}-{date}", rows_hash(envs[kind]), i > 0))
    return targets


COLLECT = {HPW: hpw_targets, CHARTS: chart_targets}


def collect_targets(args):
    """{family: [(key, source_hash, is_history)]} for every family whose API
    answered. A family whose API is missing (404 — not deployed yet) or down is
    skipped with a log line; the other family still renders."""
    out = {}
    for family, collect in COLLECT.items():
        try:
            out[family] = collect(args)
        except urllib.error.HTTPError as e:
            log(f"[warn] {family}: the boards API answered HTTP {e.code} at {e.url} — "
                f"{family} cards skipped this run")
        except Exception as e:
            log(f"[warn] {family}: could not read the boards API ({e}) — "
                f"{family} cards skipped this run")
    return out


def main():
    ap = argparse.ArgumentParser(description="Render the #40HPW and Charts boards to share-card PNGs.")
    ap.add_argument("--live", action="store_true",
                    help="write into the shards tree and state.json (default is a dry run)")
    ap.add_argument("--dry-run", action="store_true", help="force a dry run (the default)")
    ap.add_argument("--all", action="store_true",
                    help="every week back to first_week, not just the recent window")
    ap.add_argument("--force", action="store_true", help="re-render even when the hash matches")
    ap.add_argument("--standin", action="store_true",
                    help="hpw only: screenshot /#members instead of the card page")
    ap.add_argument("--only", help="render just these keys (comma-separated): a YYYY-MM-DD, "
                                   "high-scores, shows-<date>, artists-<date>, <kind>-weeks-at-1")
    args = ap.parse_args()

    dry = DRY_RUN or args.dry_run
    if args.live and not args.dry_run:
        dry = False
    root = PREVIEW_DIR if dry else SHARDS

    only = set(filter(None, (args.only or "").split(",")))
    for key in only:
        if family_of(key) is None:
            log(f"[error] --only {key} is not a board key")
            return 1

    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("[skip] another hpw-cards run holds the lock")
        return 0

    log(f"{'DRY-RUN — ' if dry else ''}rendering to {root}/{{hpw,charts}}"
        + (" (stand-in: /#members)" if args.standin else ""))

    families = collect_targets(args)
    if not families:
        log("[error] no boards API answered — nothing rendered")
        return 1

    state = load_state()
    cards = {fam: dict(state.get(FAMILY_STATE[fam]) or {}) for fam in families}

    # A hash match is only a reason to skip if the PNG it describes is still
    # there. A card deleted by hand, or never written because a previous run
    # died between the render and the rename, must come back.
    checked = 0
    todo = []
    for fam, targets in families.items():
        for key, src, history in targets:
            if only and key not in only:
                continue
            checked += 1
            prev = cards[fam].get(key)
            have = png_path(root, key).exists()
            if not args.force and prev and prev.get("source_hash") == src and have:
                continue
            todo.append((history, fam, key, src))
    if only and not checked:
        log(f"[error] --only {args.only} matched no board this run")
        return 1
    # Live boards before history, so a run the wrapper's 90s bound cuts short
    # has rendered the cards people share today first. Stable, so within each
    # tier the order is the collection order: hpw, then charts, newest first.
    todo.sort(key=lambda t: t[0])

    log(f"{checked} board(s) checked, {len(todo)} to render")
    if not todo:
        if not dry:
            for fam in families:
                write_manifest(root, fam, cards[fam])
        return 0

    from playwright.sync_api import sync_playwright   # imported late: the API
    # half of this bot is useful (and testable) on a box with no browser.

    def checkpoint():
        # After EVERY successful render, not once at the end: the wrapper kills
        # a run at 90s, and a first cycle after a deploy (or a --all backfill)
        # has more boards than fit. Saving as it goes means a cut-short run
        # keeps what it rendered and the next tick continues from there, rather
        # than re-rendering the same first N boards forever.
        for fam in families:
            write_manifest(root, fam, cards[fam])
        if not dry:
            for fam in families:
                state[FAMILY_STATE[fam]] = cards[fam]
            save_state(state)

    failures = 0
    overflows = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for _history, fam, key, src in todo:
                try:
                    png = render(browser, key, args.standin)
                except CardOverflow as e:
                    # Louder than the rest on purpose: every other failure here
                    # is the network having a bad minute, where this one is the
                    # card page having quietly lost a row.
                    log(f"[ERROR] {key}: CARD OVERFLOW — NOT PUBLISHED, previous card stands")
                    log(f"[ERROR]   {e}")
                    log(f"[ERROR]   a row grew past the card's budget; re-measure before shipping")
                    overflows.append(key)
                    failures += 1
                    continue
                except Exception as e:
                    # One board failing is one stale card, not a failed cycle.
                    log(f"[warn] {key}: render failed, keeping the previous card — {e}")
                    failures += 1
                    continue
                write_atomic(png_path(root, key), png)
                cards[fam][key] = {
                    "sha256": hashlib.sha256(png).hexdigest(),
                    "bytes": len(png),
                    "rendered_at": int(time.time()),
                    "source_hash": src,
                }
                checkpoint()
        finally:
            browser.close()

    for fam in families:
        log(f"manifest → {write_manifest(root, fam, cards[fam])}")
    if dry:
        log("dry run: state.json not written, nothing enters the shards tree")
    else:
        for fam in families:
            state[FAMILY_STATE[fam]] = cards[fam]
        save_state(state)
    if failures:
        log(f"{failures} board(s) kept their previous card")
    if overflows:
        # Non-zero, so a manual run says so in its exit code. The cycle wrapper
        # guards with `|| true`, so this still cannot fail a boost run.
        log(f"[ERROR] {len(overflows)} board(s) overflowed the card: {', '.join(overflows)}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
