#!/usr/bin/env bash
# Daily outbox-expansion cycle: discover every booster's NIP-65 write relays,
# deep-walk any not yet scanned, sweep the known ones for recent boosts, then
# enrich → export → push. Widens coverage beyond the 12 core relays. Read-only
# against Nostr/Podcast Index; the only outward write is the rsync of static JSON.
set -euo pipefail
cd "$(dirname "$0")"
PY=/usr/bin/python3
BOT=onlyboosts_globalscan.py

# Share the pipeline lock with the incremental job. Outbox is daily, so it WAITS
# (up to 10 min) for a running incremental to finish rather than skipping its slot.
exec 9>data/pipeline.lock
flock -w 600 9 || { echo "[skip] pipeline still busy after 10min — skipping this outbox run"; exit 0; }

echo "=== $(date -u +%FT%TZ) OnlyBoosts outbox expansion ==="
"$PY" "$BOT" outbox --refresh     # re-resolve outbox relays, deep-walk new, sweep known
"$PY" "$BOT" enrich               # metadata/profiles for anything new the wider scan found
"$PY" "$BOT" export --per-show
"$PY" "$BOT" push
"$PY" d1_sync.py --remote-delta   # push newly-found boosts to the D1 query layer (/api/v1)
echo "=== $(date -u +%FT%TZ) outbox cycle done ==="
