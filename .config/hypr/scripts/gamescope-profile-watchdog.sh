#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gamescope-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
POLL_SECONDS=10

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if flock -n 9; then
  :
else
  exit 0
fi

while true; do
  count="$(pgrep -cx gamescope 2>/dev/null || true)"

  if [[ "$count" =~ ^[0-9]+$ ]]; then
    :
  else
    count=0
  fi

  "$PROFILECTL" sync gaming "$count"
  sleep "$POLL_SECONDS"
done
