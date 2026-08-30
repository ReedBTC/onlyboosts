#!/usr/bin/env bash
# Render the #40HPW share cards. Called from run-incremental.sh AFTER the D1
# delta sync and BEFORE push, so the boards the screenshot captures are the ones
# the cycle just wrote, and the PNGs are on disk in time for the same rsync.
#
# ⚠️ BOUNDED, AND A TIMEOUT IS NOT AN ERROR. Chromium is the one thing in this
# pipeline that can hang rather than fail — a wedged renderer would hold the
# pipeline lock and stall the five-minute cycle behind it. So the whole step is
# capped and a cap that fires is reported and shrugged off: the previous cards
# stay on the VPS and the next tick tries again. Nothing here is worth failing a
# boost cycle for.
#
# HPW_TIMEOUT seconds, 0 to disable (a --all backfill needs that).
set -uo pipefail
cd "$(dirname "$0")"
PY=.venv/bin/python
BOT=onlyboosts_hpwcards.py
TIMEOUT="${HPW_TIMEOUT:-90}"

if [ ! -x "$PY" ]; then
  echo "[hpw-cards] [skip] no venv at $(pwd)/$PY — see README.md"
  exit 0
fi

if [ "$TIMEOUT" = "0" ]; then
  "$PY" "$BOT" "$@"
  exit $?
fi

timeout --signal=TERM --kill-after=15s "$TIMEOUT" "$PY" "$BOT" "$@"
rc=$?
if [ $rc -eq 124 ] || [ $rc -eq 137 ]; then
  echo "[hpw-cards] [skip] render exceeded ${TIMEOUT}s — previous cards stand, retrying next cycle"
  exit 0
fi
exit $rc
