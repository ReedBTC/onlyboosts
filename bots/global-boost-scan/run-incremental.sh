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
"$PY" "$BOT" incremental          # new boosts since last run → SQLite
"$PY" "$BOT" resolve-guids        # canonicalize phantom guids (feed ids / item guids / slugs)
"$PY" "$BOT" enrich               # fill metadata/profiles for anything new
"$PY" "$BOT" export --per-show    # rebuild the JSON shards
"$PY" "$BOT" push                 # rsync changed shards to the VPS (no --delete: nothing is removed on a tail run)
"$PY" d1_sync.py --remote-delta   # push new boosts to the D1 query layer (/api/v1); no-op if none / no CF creds
echo "=== $(date -u +%FT%TZ) cycle done ==="
