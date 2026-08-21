#!/usr/bin/env bash
# Daily PC 2.0 snapshot: pull Podcast Index's public value-block and stats
# files, archive them gzipped, and rebuild the local current-state SQLite.
#
# No pipeline lock: this bot shares nothing with the boost collector — it
# reads only podcastindex.org's public files and writes only its own data/.
# Read-only outward. Nothing here signs, publishes, or pays.
set -euo pipefail
cd "$(dirname "$0")"
echo "=== $(date -u +%FT%TZ) PC 2.0 stats snapshot ==="
/usr/bin/python3 onlyboosts_pc20stats.py snapshot
echo "=== $(date -u +%FT%TZ) snapshot done ==="
