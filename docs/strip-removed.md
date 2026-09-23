# What The Strip Removed

**Moved verbatim out of `CLAUDE.md` on 2026-09-23**, when that file passed its
size budget — the same treatment the seven `docs/` files got on 2026-08-29 and
`docs/tests.md` on 2026-09-09. Nothing was rewritten on the way across, so
`git log -S <symbol> -- CLAUDE.md` still finds any paragraph that used to
live there. What stayed in `CLAUDE.md` is the one rule a
future deletion must follow: verified by `test-boost-modal-render.mjs` and a
declared-versus-referenced diff, never by a green build.

The fork left LB's own products in the tree, unreachable but shipped. They were
deleted on 2026-08-23, before the `homepage` branch merged. **~6,600 lines of
source, and what a homepage visitor downloads went down by 202KB raw:**

| | |
|---|---|
| `assets/js/feeds.js` | 50.4KB → **12.4KB**. The whole Events path: `loadEvents`, the NIP-52 calendar machinery, the streaming relay subscription, the month browser. Unreachable since the Events tab went on fork — `LOADERS` never mapped it — and two endpoints it read, `/api/community-events` and `/api/meetups`, do not exist on this fork at all. |
| `assets/js/boosts-thread.js` | 29.6KB → **18.4KB**. `ROOT_NEVENT`, `EXCLUDED_NOTE_IDS`, `fetchBoostThread` and the six helpers only it called. |
| `assets/js/calendar-events.js` | **deleted** (24.4KB, and it was precached). |
| `assets/js/supporter-set.js` | **deleted** (7.1KB). Its only importer was `feeds.js`. |
| `assets/widgets/login-widget.js` | 1,051KB → **929KB**. 22 source files: `BoostModal`, `EpisodeBoostModal`, `MultiLegBoostForm`, `BoostProgressView`, `BoostExpectations`, and the entire LB meetup product (`CreateMeetupModal`, `MyMeetupsModal`, `SearchMeetupsModal`, `EventComposer`, `eventForm`, `eventPublish`, `eventTypes`, `eventAnnouncement`, `primalSearch`, …), plus `openShowBoost`, `openEpisodeBoost`, `openMeetupModal` and `mountFindFlow` out of `index.jsx`. |

**⚠️ THE CALENDAR CARD HAD ALREADY BEEN UNREACHABLE, AND THE NOTE HERE SAID
OTHERWISE FOR MONTHS.** This file used to claim `calendar-events.js` was
"retained because `boosts-thread.js` imports it to render calendar-event quotes
inside boost notes — that circular import is what makes the cleanup fiddly."
Both halves were wrong. There was no circular import: the module had two
ordinary importers. And the rich card could never appear, because the only
writer of the cache it read was `fetchBoostThread`, which has had no caller
since the fork — so every quoted calendar event fell through to the naddr chip,
every time. **The chip's own reading of the two NIP-52 kinds is what survives**,
inlined as two integers in `boosts-thread.js`, so a quoted event still links out
as "📅 Linked event on Nostr →" rather than as an article. Nothing a reader
could see changed.

**⚠️ THE BUILD DOES NOT CATCH A DELETION THAT GOES TOO FAR, AND THIS ONE DID.**
Cutting `index.jsx` by banner-comment ranges swallowed `BoostApp` — the nav's
Donate button — and `let mounted = false`, which `api.mount()` guards on. Vite
built both away without a word: an undeclared module-level identifier is a
runtime `ReferenceError`, not a build error, and there is no linter here.
`scripts/test-boost-modal-render.mjs` is what failed, because it walks for
`function BoostApp()` by name. **A widget deletion is verified by that test and
by a declared-versus-referenced diff against the previous revision, never by a
green build.**

**Two checks are worth reusing for any future strip**, and neither is a test in
the repo: a module-graph walk that resolves every import *and* every named
import against the target's exports (the `ob-v53` failure class), and a
reachability walk over `login-widget/src` from `index.jsx` that lists orphaned
files. The second one must count bare side-effect imports (`import './x.js'`)
or it reports `styles.css` and `navigationGuard.js` as dead.
