#!/usr/bin/env bash
# One incremental cycle for the OnlyBoosts feed: tail-scan new boosts, enrich any
# newly-seen shows/episodes/profiles, re-export the JSON shards, and push the
# changed ones to the VPS. Read-only against Nostr + Podcast Index; the only
# outward write is the rsync of static JSON. Driven by onlyboosts-incremental.timer.
set -euo pipefail
cd "$(dirname "$0")"
PY=/usr/bin/python3
BOT=onlyboosts_globalscan.py

# One pipeline lock shared with the outbox job so exports/pushes never overlap.
# Incremental is frequent + cheap, so it just skips this tick if the pipeline is busy.
exec 9>data/pipeline.lock
flock -n 9 || { echo "[skip] pipeline busy — another run holds the lock"; exit 0; }

echo "=== $(date -u +%FT%TZ) OnlyBoosts incremental cycle ==="
# First, and deliberately fatal: a malformed excludes.json must stop the cycle
# BEFORE anything is exported or pushed. Every db.connect() re-applies the list
# anyway, so this step exists to fail legibly here rather than as a traceback
# somewhere in the middle of a scan.
"$PY" "$BOT" excludes             # validate the exclusion list + report what it hides
"$PY" "$BOT" incremental          # new boosts since last run → SQLite
"$PY" "$BOT" resolve-guids        # canonicalize phantom guids (feed ids / item guids / slugs)
"$PY" "$BOT" dedupe               # mark relay-bot notes duplicating another app's note (7d window)
"$PY" "$BOT" enrich               # fill metadata/profiles for anything new
"$PY" "$BOT" durations            # derive durations for boosted episodes with none (#40HPW evenness; capped per tick)
"$PY" "$BOT" export --per-show    # rebuild the JSON shards
"$PY" "$BOT" push                 # rsync changed shards to the VPS (no --delete: nothing is removed on a tail run)
"$PY" d1_sync.py --remote-delta   # push new boosts to the D1 query layer (/api/v1); no-op if none / no CF creds

# ── #40HPW share cards ───────────────────────────────────────────────────────
# COMMENTED OUT UNTIL REED FLIPS IT. Uncomment all three lines to enable.
#
# ⚠️ IT RUNS AFTER THE D1 SYNC, WHICH IS WHY IT NEEDS A SECOND PUSH. The card is
# a screenshot of the LIVE SITE, and the live site reads D1 — so a render before
# `--remote-delta` photographs the previous cycle's board. But `push` is above
# the sync, so by the time the PNGs exist the rsync has already run. The second
# push is the cheap half of that trade: rsync -a transfers only what changed, so
# on a cycle that rendered nothing it is one SSH handshake and a file list.
#
# The alternative is moving `push` below the sync and keeping one — fewer moving
# parts, at the cost of delaying every shard by however long the D1 delta takes.
# Not done here: reordering an established pipeline to add a picture is the
# wrong way round, and this step is meant to be removable without a trace.
#
# Bounded at 90s inside the wrapper — a hung Chromium is a skipped render, never
# a failed cycle — and `|| true` is the second belt, since `set -e` would
# otherwise turn a missing card into a GitHub issue.
#
# The card page merged in 4ec28ae (2026-08-30) and the 99-week history is
# already on the VPS, so enabling this only keeps it current. See
# ../hpw-cards/README.md.
../hpw-cards/run-hpwcards.sh --live || true   # #40HPW boards → shards/hpw/*.png
"$PY" "$BOT" push                             # ship those PNGs on this cycle
echo "=== $(date -u +%FT%TZ) cycle done ==="
