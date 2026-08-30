#!/usr/bin/env python3
"""Hold the clipped-row guard against a real card page, both ways.

The guard is the only thing standing between a card page that grows a row and a
share card that silently loses its tenth member, so it is worth knowing it
actually fires. This drives the SHIPPED `clip_report` and the SHIPPED `capture`
— a copy of the measurement written in here would agree with itself forever
while the real one rotted.

    ./test-clip-guard.py [origin]
"""
import sys
from playwright.sync_api import sync_playwright
import onlyboosts_hpwcards as bot

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else "https://hpw-share-cards.onlyboosts.pages.dev"
fails = []


def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    for key in ("high-scores", "2026-08-24"):
        url = f"{ORIGIN}/hpw/{key}/card"
        print(f"\n{key}")

        # 1. the card as shipped: every row inside the list, and capture returns
        ctx = b.new_context(viewport=bot.VIEWPORT, device_scale_factor=1)
        pg = ctx.new_page()
        pg.goto(url, wait_until="load")
        pg.wait_for_selector(bot.READY_SELECTOR, state="attached", timeout=bot.READY_TIMEOUT_MS)
        rep = bot.clip_report(pg)
        check("clean card reports no clipped rows", rep and rep["clipped"] == 0, str(rep))
        check("clean card has rows to lose", rep and rep["rows"] > 0, f"{rep['rows']} rows")

        # 2. squeeze the list until rows fall out of it — the mutation the guard
        #    exists for, which is what a grown row does from the other direction
        pg.add_style_tag(content=".hpw-list{max-height:150px;overflow:hidden}")
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
