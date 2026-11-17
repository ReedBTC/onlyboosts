# Brand Candidates

Logo concepts kept for possible use. **Nothing on the site references these files yet.**

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

The PNGs are transparent outside the tile. At 16 pixels the outline and the arcs run together; a
favicon cut with a thicker outline and two arcs has been suggested but not drawn.

Adopting it means replacing `assets/onlyboosts_favicon.png` and `assets/onlyboosts_pfp.png` (and the
manifest icons), bumping `VERSION` in `sw.js`, and stamping. The banners carry the old mark and the
wordmark, so they would need redrawing too.
