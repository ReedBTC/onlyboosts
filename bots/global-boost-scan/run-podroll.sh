#!/usr/bin/env bash
# Daily podroll cycle: re-read every indexed show's RSS feed for a
# <podcast:podroll> block, resolve the shows it points at, then re-export and
# publish. The only pass that fetches third-party RSS — Podcast Index carries no
# podroll — so it is deliberately NOT on the boost tick: a podroll changes when a
# publisher edits their feed, never when a boost arrives.
#
# Daily since 2026-08-11, and that is not 7x the crawling it was: the `podroll`
# step is age-gated by --max-age (6d), so most days it fetches the handful of
# shows first boosted since the last run (8 of 948 on the day it changed) and the
# full corpus still turns over about weekly. See CLAUDE.md.
#
# Read-only outward apart from the usual two publishes: the rsync of static JSON
# and the D1 projection. Nothing here signs or pays.
set -euo pipefail
cd "$(dirname "$0")"
PY=/usr/bin/python3
BOT=onlyboosts_globalscan.py

# Same pipeline lock as the incremental/outbox jobs so exports never overlap.
# Weekly, so it WAITS for a running job rather than skipping its slot.
exec 9>data/pipeline.lock
flock -w 900 9 || { echo "[skip] pipeline still busy after 15min — skipping this podroll run"; exit 0; }

echo "=== $(date -u +%FT%TZ) OnlyBoosts podroll refresh ==="
"$PY" "$BOT" podroll              # fetch feeds → parse podroll → resolve targets
"$PY" "$BOT" export --per-show    # podroll rides in the per-show shards + index counts
"$PY" "$BOT" push                 # rsync changed shards to the VPS
"$PY" d1_sync.py --remote-podroll # replace the podroll table in D1 (/api/v1 + /show pages)
echo "=== $(date -u +%FT%TZ) podroll cycle done ==="
