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
  if command -v busctl >/dev/null 2>&1; then
    local gamemode_live_count=0
    local gamemode_pid

    while read -r gamemode_pid; do
      if [[ "$gamemode_pid" =~ ^[0-9]+$ ]] && [[ -d "/proc/$gamemode_pid" ]]; then
        gamemode_live_count=$((gamemode_live_count + 1))
      fi
    done < <(busctl --user tree com.feralinteractive.GameMode 2>/dev/null \
      | awk 'match($0, /\/Games\/[0-9]+/) { segment = substr($0, RSTART, RLENGTH); sub(".*/", "", segment); print segment }')

    if [[ "$gamemode_live_count" -gt 0 ]]; then
      printf '1\n'
    else
      printf '0\n'
    fi
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
