#!/usr/bin/env python3
"""Hold the clipped-row guard against real card pages, both ways, and measure
each card kind's row ceiling.

The guard is the only thing standing between a card page that grows a row and a
share card that silently loses its tenth row, so it is worth knowing it
actually fires. This drives the SHIPPED `clip_report` and the SHIPPED `capture`
— a copy of the measurement written in here would agree with itself forever
while the real one rotted.

It also prints, per card, what the site's CLAUDE.md calls the budget: the list
box's height, the row heights the page actually laid out, and the ceiling
(room / rows) a row may grow to before the last one falls out. The ceiling is
per card KIND — the shows/artists cards carry a column head and a rank triplet
the members cards do not — and it moves with ANY chrome change around the
list, so re-run this after touching a card page and paste the numbers into the
README rather than deriving them.

    ./test-clip-guard.py [origin] [key ...]

Keys default to one of each kind on the live week. A key is anything the bot's
`--only` accepts.
"""
import sys
from playwright.sync_api import sync_playwright
import onlyboosts_hpwcards as bot

args = sys.argv[1:]
ORIGIN = args.pop(0) if args and args[0].startswith("http") else "https://onlyboosts.social"
bot.SITE = ORIGIN


def live_keys():
    """One board of each kind, on the live week, from the API itself."""
    keys = ["high-scores"]
    try:
        keys.append(bot.week_date(bot.hours("week")["week_start"]))
    except Exception as e:
        print(f"  (no hpw week: {e})")
    try:
        ws = bot.week_date(bot.chart_week("shows")["week_start"])
        keys += [f"shows-{ws}", f"artists-{ws}"]
        keys += [f"{k}-{bot.WEEKS_AT_1}" for k in bot.CHART_ONES_KINDS]
    except Exception as e:
        print(f"  (no chart boards at {ORIGIN}: {e})")
    return keys


KEYS = args or live_keys()
fails = []


def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    for key in KEYS:
        url = bot.card_url(key)
        print(f"\n{key}  {url}")

        # 1. the card as shipped: every row inside the list, and capture returns
        ctx = b.new_context(viewport=bot.VIEWPORT, device_scale_factor=1)
        pg = ctx.new_page()
        pg.goto(url, wait_until="load")
        pg.wait_for_selector(bot.READY_SELECTOR, state="attached", timeout=bot.READY_TIMEOUT_MS)
        rep = bot.clip_report(pg)
        if rep is None:
            check("empty board renders no list (legitimate)", pg.locator("[data-card-list]").count() == 0)
            ctx.close()
            continue
        check("clean card reports no clipped rows", rep["clipped"] == 0, str(rep))
        check("clean card has rows to lose", rep["rows"] > 0, f"{rep['rows']} rows")
        ceiling = rep["room"] / rep["rows"] if rep["rows"] else 0
        print(f"        list {rep['listTop']} → {rep['listBottom']} ({rep['room']}px of room), "
              f"rows {rep['rowMin']}–{rep['rowMax']}px × {rep['rows']}, "
              f"ceiling {ceiling:.1f}px a row, "
              f"headroom {ceiling - rep['rowMax']:.1f}px")

        # 2. squeeze the list until rows fall out of it — the mutation the guard
        #    exists for, which is what a grown row does from the other direction
        pg.add_style_tag(content="[data-card-list]{max-height:150px;overflow:hidden}")
        pg.wait_for_timeout(120)
        rep2 = bot.clip_report(pg)
        check("squeezed card reports clipped rows", rep2 and rep2["clipped"] > 0, str(rep2))
        check("it names the first row lost", bool(rep2 and rep2["firstClipped"]),
              f"row {rep2['firstClipped'] if rep2 else '?'}")
        ctx.close()

        # 3. the guard fires through the real capture() path, not just the probe
        try:
            bot.capture(b, url, 1)
            check("capture() succeeds on the shipped card", True)
        except bot.CardOverflow as e:
            check("capture() succeeds on the shipped card", False, str(e))
    b.close()

print("\n" + ("PASS" if not fails else f"FAILED: {', '.join(fails)}"))
sys.exit(1 if fails else 0)
