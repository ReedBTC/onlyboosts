#!/usr/bin/env bash
# Daily outbox-expansion cycle: discover every booster's NIP-65 write relays,
# deep-walk any not yet scanned, sweep the known ones for recent boosts, then
# enrich → export → push. Widens coverage beyond the 12 core relays. Read-only
# against Nostr/Podcast Index; the only outward write is the rsync of static JSON.
set -euo pipefail
cd "$(dirname "$0")"
PY=/usr/bin/python3
BOT=onlyboosts_globalscan.py

echo "=== $(date -u +%FT%TZ) OnlyBoosts outbox expansion ==="
"$PY" "$BOT" excludes             # validate the exclusion list first — see run-incremental.sh

# ── the scan runs OUTSIDE the pipeline lock (since 2026-09-06) ───────────────
# The lock exists so two exports/pushes never overlap. The scan is not one:
# it inserts boosts into SQLite in WAL mode, which the 24 walker threads
# already do beside each other and which the incremental tick can do beside
# them too (db.connect sets a 30s busy timeout; every write here is a short
# transaction). Holding the lock across it cost every incremental tick for
# the scan's whole duration — ~2 hours a day, 24 ticks on the 5-minute
# cadence, 60 on the 2-minute one — during which a fresh boost reached
# neither D1 nor the shards. Measured yield of the scan it was protecting:
# ~3.5 boosts a day.
#
# `--refresh` is gone with it: the resolver now resolves only boosters new
# since the last run and re-resolves everyone weekly (OUTBOX_CACHE_TTL);
# the flag still forces a full pass by hand.
"$PY" "$BOT" outbox               # resolve new boosters' relays, deep-walk (budgeted), sweep known

# ── publish steps take the lock, and WAIT for a running incremental ──────────
exec 9>data/pipeline.lock
flock -w 600 9 || { echo "[skip] pipeline still busy after 10min — skipping this outbox publish"; exit 0; }
"$PY" "$BOT" resolve-guids        # canonicalize phantom guids (feed ids / item guids / slugs)
"$PY" "$BOT" enrich               # metadata/profiles for anything new the wider scan found
"$PY" "$BOT" export --per-show
"$PY" "$BOT" push
"$PY" d1_sync.py --remote-delta   # push newly-found boosts to the D1 query layer (/api/v1)
echo "=== $(date -u +%FT%TZ) outbox cycle done ==="
