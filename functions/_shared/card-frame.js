// THE SHARE-CARD FRAME: the fixed 720x900 document the collector's bot
// (bots/hpw-cards/) loads in headless Chromium and screenshots at 2x. One
// frame for every card — the 40 HPW boards (/hpw/<key>/card) and, since
// 2026-09-03, the chart boards (/charts/<key>/card/<kind>) — so the bot's
// contract is one contract: the viewport, the light palette (no theme boot
// script, so `data-theme` is never set), the ready signal, and
// `data-card-list` on the list the clip guard measures.
//
// Everything about it is fixed: the size, the palette, the type scale. It
// links the same stylesheets the tab's board is dressed by and the caller
// overrides only what a portrait 720x900 image needs — a larger base size so
// the rows fill the frame, faces to match, and no hover chrome anywhere.
//
// ⚠️ PORTRAIT, 4:5, since 2026-08-29. It shipped as a 1200x630 landscape,
// the link-preview shape, and the first thing Reed said on downloading one
// was "oh man, it's wide screen": the card is shared from phones into Nostr
// clients and chat apps, which show an image at its own shape, and a phone
// is tall. 720x900 at 2x is 1440x1800, the standard portrait social size, and
// well under the 900KB cap. The pages' twitter:card takes the square
// thumbnail rather than the large card for the same reason — a wide crop out
// of the middle of a tall board would show four rows and no title.
//
// ⚠️ THE VERTICAL BUDGET IS MEASURED, NOT DERIVED, AND THE LINE IS THE LIST
// BOX, NOT THE FOOTER. The landscape card overflowed its frame once (rows
// nine and ten painted through the footer; the collector's bot measured it,
// 2026-08-29) and the list has clipped inside its shell since, so an overrun
// is a cut-off tenth row rather than an overlap — a SILENT one, which is why
// the bot refuses to publish a card with a clipped row. The bot measured the
// portrait 40 HPW card against the live preview:
//
//   list box 269.5 → 829.5 (560px of room), footer top 853
//   rows 49.2–50.2px, ten rows, clipped 0
//   ceiling 56.0px a row: 56px fits, 57px loses row ten
//
// So an hpw row has about 5.8px of growth in hand. The ceiling is
// (listBottom − listTop) / 10 and ANY chrome change around the list moves
// it — trimming the footer to one line moved it 2.2px a row without a row
// being touched.
//
// The chart cards, measured by the bot on the misc-updates preview
// (2026-09-03; rows 49.2–50.2px on every kind):
//
//   shows / artists / members weeks-at-1   list 269.5 → 829, ceiling 56.0px, 5.8px in hand
//   shows / artists weekly Top 10          list 296.9 → 829, ceiling 53.3px, 3.1px in hand
//
// ⚠️ THE WEEKLY CHART CARDS ARE THE TIGHT ONES: the `rank in sats/boosters/
// boosts` column head costs 27.4px of the list box, so a weekly row may grow
// 3.1px before the tenth show drops off the card. The rank triplet itself
// does not make a row taller. Change a number in any card's css and have the
// bot re-measure (`bots/hpw-cards/test-clip-guard.py <origin>` reads every
// kind's `[data-card-list]` box) before believing a budget.

import { htmlEscape } from "../../assets/js/nostr-text.js";

export const CARD_W = 720;
export const CARD_H = 900;

/* The frame's own rules, shared by every card: the base size, the box, the
 * head and the footer. A caller adds the rules for its board's rows. */
const BASE_CSS = `
    html { font-size: 21px; background: var(--white); }
    html, body { margin: 0; padding: 0; }
    body {
      width: ${CARD_W}px; height: ${CARD_H}px; overflow: hidden;
      background: var(--white); color: var(--ink);
      --accent: var(--brand); --accent-d: var(--brand-d); --accent-dd: var(--brand-dd); --tint: rgba(0, 175, 240, 0.1);
    }
    .card { box-sizing: border-box; width: 100%; height: 100%; padding: 28px 32px 22px; display: flex; flex-direction: column; }
    .card-head { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 12px; flex: none; }
    .card-logo { height: 64px; width: auto; display: block; margin-bottom: 6px; }
    .card-kicker {
      font-family: 'Playfair Display', Georgia, serif; font-weight: 700; font-size: 1.2rem;
      color: var(--ink); letter-spacing: 0.01em;
    }
    .card-kicker small { display: block; font-family: 'Source Serif 4', Georgia, serif; font-weight: 400; font-size: 0.74rem; color: var(--muted); margin-top: 2px; }
    .card-foot { margin-top: 10px; flex: none; text-align: left; font-size: 0.72rem; font-weight: 700; color: var(--brand-dd); }
    /* A screenshot has no hover, focus or pointer. */
    .card a, .card button { text-decoration: none; color: inherit; pointer-events: none; }
    .card button { font: inherit; background: none; border: 0; padding: 0; cursor: default; text-align: inherit; }`;

/**
 * @param {object} o
 * @param {string} o.title        the <title>, "(card)" appended
 * @param {string} o.kicker       the line under the logo (escaped here)
 * @param {string} o.kickerSub    its small second line (escaped here)
 * @param {string} o.board        the board's HTML — the two-sided module's own
 * @param {string} o.footer       one line, left-aligned, plain text
 * @param {string} o.links        the <link rel="stylesheet"> tags, theme.css
 *   LAST — written in the caller's own template so scripts/stamp-assets.js
 *   sees an href="…" it can restamp; a filename list built here would carry
 *   a version the stamper never touches
 * @param {string} o.css          the board's card-scale rules
 */
export function cardHtml({ title, kicker, kickerSub, board, footer, links, css = "" }) {
  return `<!DOCTYPE html>
<html lang="en" data-card>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${CARD_W}" />
  <meta name="robots" content="noindex" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    font-src 'self' data:;
    connect-src 'self';
    base-uri 'self';
    form-action 'self';
    object-src 'none';
  " />
  <title>${htmlEscape(title)} (card)</title>
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/source-serif-4.woff2" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/playfair-display.woff2" crossorigin />
${links}
  <style>${BASE_CSS}
${css}
  </style>
</head>
<body>
<div class="card">
  <header class="card-head">
    <img class="card-logo" src="/assets/onlyboosts_banner_clear.png" alt="OnlyBoosts" width="192" height="64" />
    <div class="card-kicker">${htmlEscape(kicker)}<small>${htmlEscape(kickerSub)}</small></div>
  </header>
  ${board}
  <!-- One line, left-aligned, and nothing else. Reed's call, 2026-08-30. -->
  <footer class="card-foot">${htmlEscape(footer)}</footer>
</div>
<script>
/* The bot waits for html[data-card-ready="1"], never for a fixed sleep. Set
   once the two web fonts and every face have loaded or failed; and set anyway
   after 8s so a face that never answers cannot hold the render forever. */
(function () {
  var done = function () { document.documentElement.setAttribute('data-card-ready', '1'); };
  var imgs = Array.prototype.slice.call(document.images).map(function (img) {
    return img.complete ? Promise.resolve() : new Promise(function (r) {
      img.addEventListener('load', r); img.addEventListener('error', r);
    });
  });
  var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  Promise.all(imgs.concat([fonts])).then(done, done);
  setTimeout(done, 8000);
})();
</script>
</body>
</html>`;
}
