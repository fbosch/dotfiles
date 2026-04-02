#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gamescope-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
POLL_SECONDS=2

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if flock -n 9; then
  :
else
  exit 0
fi

cleanup() {
  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

get_gaming_count() {
  if command -v gamemoded >/dev/null 2>&1; then
    if gamemoded -s >/dev/null 2>&1; then
      printf '1\n'
      return
    fi

    printf '0\n'
    return
  fi

  pgrep -fc "(^|/)gamescope( |$)" 2>/dev/null || true
}

while true; do
  count="$(get_gaming_count)"

  if [[ "$count" =~ ^[0-9]+$ ]]; then
    :
  else
    count=0
  fi

  "$PROFILECTL" sync gaming "$count"
  sleep "$POLL_SECONDS"
done
