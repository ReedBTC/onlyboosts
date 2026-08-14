#!/usr/bin/env node
/**
 * Stamp every JS/CSS asset reference with the current VERSION.
 *
 * ⚠️ THIS EXISTS TO KILL THE FOUR-HOUR SKEW, which is the single worst failure
 * this repo has recorded. Cloudflare Pages serves assets as
 *
 *     cache-control: public, max-age=14400, must-revalidate
 *
 * and every module URL runs that four-hour clock ON ITS OWN. So a reader can
 * hold a three-hour-old `feed-controls.js` against a freshly-fetched renderer
 * that imports something the old copy does not export — and an unresolved named
 * import is a LINK-TIME error, so the renderer never executes at all. That is
 * `ob-v53`, which took all eight feeds down at once.
 *
 * Bumping sw.js does NOT close it: the service worker's cache is only consulted
 * for clients it already controls, and the HTTP cache underneath is per-URL
 * either way.
 *
 * Appending `?v=<VERSION>` closes it properly, because a URL then means exactly
 * one version of one file. A deploy references new URLs, so a stale copy is
 * unreachable rather than merely undesirable, and every asset on the page turns
 * over together instead of on twenty independent timers.
 *
 * WHAT THIS BUYS, beyond the outage:
 *
 *   - "Never add a named export to a module other modules import" stops being
 *     load-bearing. That rule cost real features and was remembered by luck.
 *   - Refactoring across modules becomes ordinary work.
 *   - One rule replaces several: BUMP VERSION WHEN YOU CHANGE AN ASSET, then run
 *     this. Consistency is guaranteed by construction rather than by discipline.
 *
 * VERSION is read from sw.js so there is exactly one source of truth, and the
 * bump you already make for the service worker drives this too.
 *
 * ⚠️ RUN IT AFTER scripts/sync-partials.js, not before. That script rewrites the
 * nav and footer into the page files; anything it injects has to be stamped
 * afterwards. The partials themselves are deliberately not processed — they
 * carry no <link> or <script> of their own, only images and a couple of
 * mentions inside comments.
 *
 * Usage:
 *   node scripts/stamp-assets.js            rewrite in place
 *   node scripts/stamp-assets.js --check    verify only; non-zero exit if stale
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

// ── The one source of truth ──────────────────────────────────────────────────
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const versionMatch = swSrc.match(/^const VERSION = '([^']+)';/m);
if (!versionMatch) {
  console.error('  ✗ could not read VERSION from sw.js — expected a line like:\n' +
                "      const VERSION = 'ob-v59';");
  process.exit(1);
}
const VERSION = versionMatch[1];

/* Which references get stamped.
 *
 * JS and CSS only. Images and fonts are deliberately left alone: the failure
 * this closes is two CODE files disagreeing about each other's contents, and a
 * stale logo is not a broken page. Fonts are preloaded and self-hosted and
 * change roughly never; stamping them would churn every page for no benefit.
 *
 * `widgets` is included because /assets/widgets/nostr-tools.js is imported by
 * URL from the feeds exactly as any other module is, and skews exactly as badly.
 * The files INSIDE that directory are build artifacts and vendored bundles, so
 * they are never processed — a rebuild would drop any stamp written into them.
 */
/* ⚠️ THE MATCH IS ANCHORED ON QUOTES, and it has to be. A bare
 * `/assets/js/...` pattern also matches PROSE — this repo's comments are full of
 * sentences like "behavior in /assets/js/nav.js." — and stamping those is worse
 * than useless twice over. It rewrites documentation, and the sentence's
 * trailing full stop then sits where a version suffix would, so the next run
 * parses it as part of the version, replaces it, and DELETES THE PERIOD. That is
 * a script that silently edits prose a little more on every run. Caught by
 * `--check` on the first attempt, which is what that mode is for.
 *
 * Requiring the same quote character on both ends means only a real code or
 * markup reference is touched: href="…", src="…", from '…', import('…'), and
 * the string literals in sw.js's PRECACHE_URLS. A URL in a comment has no
 * quotes around it and is correctly left alone.
 *
 * The version character class excludes `.` for the same reason — a version is
 * `ob-v59`, never `ob-v59.`, so it cannot swallow punctuation.
 */
const ASSET_RE = /(["'`])(\/assets\/(?:js|css|widgets)\/[A-Za-z0-9._\-/]+\.(?:js|css))(\?v=[A-Za-z0-9_-]*)?\1/g;

// Files that REFERENCE assets. Not the assets' own directory listing — a module
// is processed because it may `import` a sibling, not because it is one.
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // node_modules and the widget build output are never rewritten.
      if (entry.name === 'node_modules' || full.endsWith(path.join('assets', 'widgets'))) continue;
      walk(full, out);
    } else if (/\.(js|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const targets = [
  path.join(ROOT, 'sw.js'),
  ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, f)),
  ...walk(path.join(ROOT, 'assets', 'js')),
  ...walk(path.join(ROOT, 'functions')),
];

let changed = 0;
const stale = [];

for (const file of targets) {
  const src = fs.readFileSync(file, 'utf8');
  let hits = 0;
  const next = src.replace(ASSET_RE, (whole, quote, url, existing) => {
    hits++;
    const want = `${quote}${url}?v=${VERSION}${quote}`;
    if (whole !== want) stale.push(`${path.relative(ROOT, file)}  ${url}${existing || ''}`);
    return want;
  });
  if (!hits || next === src) continue;
  if (!CHECK) fs.writeFileSync(file, next);
  changed++;
  console.log(`  ${CHECK ? '✗' : '✓'} ${path.relative(ROOT, file)}`);
}

if (CHECK) {
  if (stale.length) {
    console.error(`\n  ✗ ${stale.length} asset reference(s) not stamped at ${VERSION}:`);
    for (const s of stale.slice(0, 20)) console.error(`      ${s}`);
    if (stale.length > 20) console.error(`      … and ${stale.length - 20} more`);
    console.error('\n  Run: node scripts/stamp-assets.js');
    process.exit(1);
  }
  console.log(`  ✓ every asset reference is stamped at ${VERSION}`);
} else {
  console.log(`\nDone — ${changed} file(s) stamped at ${VERSION}.`);
}
