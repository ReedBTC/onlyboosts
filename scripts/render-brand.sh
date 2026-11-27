#!/usr/bin/env bash
# Renders the brand PNGs from the SVG masters in assets/brand/ with Playwright's
# headless Chromium (no other rasterizer on Reed's .2 box). Run from the repo root:
#   bash scripts/render-brand.sh
# The banner composes the D5 tile with the wordmark cropped out of the previous
# banner (assets/brand/wordmark_clear.png), which is raster artwork with no vector source here.
set -euo pipefail
CHROME=${CHROME:-$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-*/chrome-headless-shell 2>/dev/null | tail -1)}
[ -x "$CHROME" ] || { echo "no headless chromium found; set CHROME=" >&2; exit 1; }
B=assets/brand
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
shot() { # svg-or-html  width height out  [bg]
  local src=$1 w=$2 h=$3 out=$4 page="$TMP/p.html"
  if [[ $src == *.svg ]]; then
    printf '<!doctype html><html><body style="margin:0;background:transparent">' > "$page"
    sed "s/width=\"64\" height=\"64\"/width=\"$w\" height=\"$h\"/" "$src" >> "$page"
    printf '</body></html>' >> "$page"
  else cp "$src" "$page"; cp "$B"/wordmark_clear.png "$B"/onlyboosts_mark_d5.svg "$TMP"/; fi
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$w,$h" --screenshot="$out" "file://$page" >/dev/null 2>&1
  echo "$out"
}
# The site's own marks keep their filenames, so every page, the manifest and the widget pick them up.
shot $B/onlyboosts_pfp_d5.svg      1400 1400 assets/onlyboosts_pfp.png
shot $B/onlyboosts_favicon_d5.svg   256  256 assets/onlyboosts_favicon.png
# The rounded-tile mark at the app-icon sizes (assets/brand/README.md).
for n in 32 180 192 512; do shot $B/onlyboosts_mark_d5.svg $n $n $B/onlyboosts_mark_d5_$n.png; done
# Nostr kind 0 pictures (Reed sets them himself).
shot $B/onlyboosts_pfp_d5.svg      1024 1024 $B/nostr_pfp_onlyboosts.png
shot $B/onlyboosts_bot_pfp_d5.svg  1024 1024 $B/nostr_pfp_boostbot.png
# Banners: clear for the page, white for og:image.
shot $B/banner.html 1800 600 assets/onlyboosts_banner_clear.png
sed 's/--ground:transparent/--ground:#ffffff/' $B/banner.html > "$TMP/white.html"; cp "$TMP/white.html" "$B/.banner_white.html"
shot $B/.banner_white.html 1800 600 assets/onlyboosts_banner.png; rm -f "$B/.banner_white.html"
# The link-preview cards (assets/brand/og_card.html), 1200x630, rendered in place: the
# template loads ../fonts/outfit.woff2 and the mark beside it. The generic card is every
# page's og:image and the fallback of the image routes; a page card adds ?t=<title>&s=<sub>.
card() { # out  query
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --virtual-time-budget=3000 --screenshot="$1" \
    "file://$PWD/$B/og_card.html$2" >/dev/null 2>&1
  echo "$1"
}
card assets/og/onlyboosts.png ""
# /charts/<year>, one per year in YEAR_CARDS (functions/_shared/year-page.js).
for y in 2026; do
  card assets/og/charts-$y.png "?t=$y%20Charts&s=Top%2033%20Songs%2C%20Artists%2C%7CPodcasts%20and%20Boosters"
done
# The page cards (2026-11-27): META[...].card in functions/_shared/charts-page.js and
# the movers list in functions/discover/[key].js name these files.
card assets/og/weekly-charts.png  "?t=Weekly%20Charts&s=This%20Week%E2%80%99s%20Top%2010%20Podcasts%2C%7CSongs%20and%20Artists"
card assets/og/podcast-charts.png "?t=Podcast%20Charts&s=Every%20Show%20and%20Episode%7CRanked%20by%20Nostr%20Boosts"
card assets/og/music-charts.png   "?t=Music%20Charts&s=Every%20Song%2C%20Album%20and%20Artist%7CRanked%20by%20Nostr%20Boosts"
card assets/og/top-members.png    "?t=Top%20Members&s=The%20Members%20Who%20Boost%7Cthe%20Most%20Podcasts%20and%20Music"
card assets/og/boosts.png         "?t=Boosts&s=Every%20Boost%20Shared%20on%20Nostr%2C%7CAs%20It%20Is%20Sent"
card assets/og/podcast-movers.png "?t=Podcast%20Movers&s=The%20Podcasts%20Climbing%20the%20Charts%7COver%20the%20Last%207%20Days"
