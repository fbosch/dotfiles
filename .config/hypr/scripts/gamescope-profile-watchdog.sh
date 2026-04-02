#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gamescope-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
ACTIVE_POLL_SECONDS=2
IDLE_POLL_SECONDS=5
MONITOR_FD=""
MONITOR_PID=""

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if flock -n 9; then
  :
else
  exit 0
fi

cleanup() {
  if [[ -n "$MONITOR_PID" ]]; then
    kill "$MONITOR_PID" >/dev/null 2>&1 || true
  fi

  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

start_event_monitor() {
  if command -v busctl >/dev/null 2>&1; then
    coproc GAME_MODE_MONITOR { busctl --user monitor com.feralinteractive.GameMode 2>/dev/null; }
    if [[ -n "${GAME_MODE_MONITOR_PID:-}" ]]; then
      MONITOR_PID="$GAME_MODE_MONITOR_PID"
    fi
    if [[ -n "${GAME_MODE_MONITOR[0]:-}" ]]; then
      MONITOR_FD="${GAME_MODE_MONITOR[0]}"
    fi
  fi
}

wait_for_next_check() {
  local wait_seconds="$1"

  if [[ -n "$MONITOR_FD" ]]; then
    read -r -t "$wait_seconds" -u "$MONITOR_FD" _ || true
    return
  fi

  sleep "$wait_seconds"
}

get_gaming_count() {
  if command -v busctl >/dev/null 2>&1; then
    local gamemode_live_count=0
    local gamemode_pid

    while read -r gamemode_pid; do
      if [[ "$gamemode_pid" =~ ^[0-9]+$ ]] && [[ -d "/proc/$gamemode_pid" ]]; then
        gamemode_live_count=$((gamemode_live_count + 1))
      fi
    done < <(busctl --user call com.feralinteractive.GameMode /com/feralinteractive/GameMode com.feralinteractive.GameMode ListGames 2>/dev/null \
      | awk '{ for (i = 3; i <= NF; i += 2) if ($i ~ /^[0-9]+$/) print $i }')

    if [[ "$gamemode_live_count" -gt 0 ]]; then
      printf '1\n'
    else
      printf '0\n'
    fi
    return
  fi

  pgrep -fc "(^|/)gamescope( |$)" 2>/dev/null || true
}

start_event_monitor

last_count=""
while true; do
  count="$(get_gaming_count)"

  if [[ "$count" =~ ^[0-9]+$ ]]; then
    :
  else
    count=0
  fi

  if [[ "$count" != "$last_count" ]]; then
    "$PROFILECTL" sync gaming "$count"
    last_count="$count"
  fi

  if [[ "$count" -gt 0 ]]; then
    wait_for_next_check "$ACTIVE_POLL_SECONDS"
  else
    wait_for_next_check "$IDLE_POLL_SECONDS"
  fi
done
