#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gamescope-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
ACTIVE_POLL_SECONDS=2
IDLE_POLL_SECONDS=5
EVENT_SANITY_RECHECK_SECONDS=900
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

ensure_event_monitor() {
  if [[ -z "$MONITOR_PID" ]] || [[ -z "$MONITOR_FD" ]]; then
    MONITOR_FD=""
    MONITOR_PID=""
    start_event_monitor
    return
  fi

  if kill -0 "$MONITOR_PID" >/dev/null 2>&1; then
    return
  fi

  MONITOR_FD=""
  MONITOR_PID=""
  start_event_monitor
}

wait_for_gamemode_event() {
  local wait_seconds="$1"
  local line

  if [[ -z "$MONITOR_FD" ]]; then
    return 1
  fi

  while true; do
    if [[ "$wait_seconds" -gt 0 ]]; then
      if read -r -t "$wait_seconds" -u "$MONITOR_FD" line; then
        :
      else
        return 1
      fi
    else
      if read -r -u "$MONITOR_FD" line; then
        :
      else
        return 1
      fi
    fi

    if [[ "$line" == *"GameRegistered"* ]] || [[ "$line" == *"GameUnregistered"* ]] || [[ "$line" == *"ClientCount"* ]] || [[ "$line" == *"PropertiesChanged"* ]]; then
      return 0
    fi
  done
}

get_gaming_count() {
  if command -v busctl >/dev/null 2>&1; then
    local client_count=0

    client_count="$(busctl --user get-property com.feralinteractive.GameMode /com/feralinteractive/GameMode com.feralinteractive.GameMode ClientCount 2>/dev/null | awk '{print $2}')"

    if [[ "$client_count" =~ ^[0-9]+$ ]] && [[ "$client_count" -gt 0 ]]; then
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
count=0
while true; do
  ensure_event_monitor

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

  if [[ -n "$MONITOR_FD" ]]; then
    if wait_for_gamemode_event "$EVENT_SANITY_RECHECK_SECONDS"; then
      :
    else
      ensure_event_monitor
    fi
  elif [[ "$count" -gt 0 ]]; then
    sleep "$ACTIVE_POLL_SECONDS"
  else
    sleep "$IDLE_POLL_SECONDS"
  fi
done
