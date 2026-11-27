# Brand Candidates

The OnlyBoosts mark. **D5 was adopted on branch `charts-2026` (2026-11-21), launching with the year charts.**
Every PNG the site and the Nostr accounts use is rendered from the SVGs here by
`bash scripts/render-brand.sh`; edit an SVG, rerun it, never edit a PNG by hand.

## D5: Boostagram Tile

A bright blue tile (`#00aff0`, the site's `--brand`) with a white outlined speech bubble and the three
Podcasting 2.0 broadcast arcs centred inside it. Chosen by Reed on 2026-11-17 from a contact sheet of
twelve concepts, pending feedback from a small group.

| File | Use |
|---|---|
| `onlyboosts_mark_d5.svg` | the master, a 64-unit grid; scale it, never redraw it |
| `onlyboosts_mark_d5_512.png` | profile picture, Nostr kind 0 `picture` |
| `onlyboosts_mark_d5_192.png` | web manifest icon |
| `onlyboosts_mark_d5_180.png` | `apple-touch-icon` |
| `onlyboosts_mark_d5_32.png` | favicon |

The `_d5_*.png` exports above are the rounded tile on transparency, kept as the master's renders.

## What The Site Uses

| Source | Renders to | Use |
|---|---|---|
| `onlyboosts_pfp_d5.svg` | `assets/onlyboosts_pfp.png` (1400), `nostr_pfp_onlyboosts.png` (1024) | nav logo, apple-touch-icon, manifest; the main account's kind 0 `picture` |
| `onlyboosts_favicon_d5.svg` | `assets/onlyboosts_favicon.png` (256) | favicon, the Log in button's mark; the small cut, a thicker outline and two arcs |
| `onlyboosts_bot_pfp_d5.svg` | `nostr_pfp_boostbot.png` (1024) | the boost bot's kind 0 `picture`: the same mark, cyan on navy |
| `banner.html` + `wordmark_clear.png` | `assets/onlyboosts_banner_clear.png`, `assets/onlyboosts_banner.png` (1800x600) | page banner and share cards (clear), `og:image` (white) |
| `og_card.html` | `assets/og/onlyboosts.png`, `assets/og/charts-<year>.png` (1200x630) | the link-preview cards: the generic one is every page's `og:image` and the image routes' fallback since 2026-11-27; `?t=&s=` makes a page card |

The profile pictures are full-bleed squares, because the nav, the Log in button and every Nostr client
crop them to a circle; the mark is scaled to sit inside that circle. The wordmark is raster artwork
cropped from the previous banner; a vector source would make the banners sharper at larger sizes.
