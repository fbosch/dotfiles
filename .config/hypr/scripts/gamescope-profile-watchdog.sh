#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gamescope-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
RECONNECT_DELAY_SECONDS=1

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

get_gamescope_count() {
  local client_count=0
  local clients_json

  clients_json="$(hyprctl clients -j 2>/dev/null || true)"
  client_count="$(jq -r '[.[] | select((((.class // "") | ascii_downcase) == "gamescope") or (((.initialClass // "") | ascii_downcase) == "gamescope"))] | length' <<< "$clients_json" 2>/dev/null || printf '0')"

  if [[ "$client_count" =~ ^[0-9]+$ ]] && [[ "$client_count" -gt 0 ]]; then
    printf '%s\n' "$client_count"
    return
  fi

  printf '0\n'
}

sync_gaming_state() {
  local count
  local last_count="$1"

  count="$(get_gamescope_count)"
  if [[ "$count" =~ ^[0-9]+$ ]]; then
    :
  else
    count=0
  fi

  if [[ "$count" != "$last_count" ]]; then
    "$PROFILECTL" sync gaming "$count"
    printf '%s\n' "$count"
    return
  fi

  printf '%s\n' "$last_count"
}

handle_event() {
  local event="$1"

  case "$event" in
    openwindow*|openwindowv2*|closewindow*|closewindowv2*|movewindow*|movewindowv2*|workspace*|workspacev2*|activewindow*|activewindowv2*|fullscreen*|fullscreenv2*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if command -v hyprctl >/dev/null 2>&1; then
  :
else
  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
  exit 0
fi

if command -v jq >/dev/null 2>&1; then
  :
else
  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
  exit 0
fi

if [[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
  :
else
  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
  exit 0
fi

HYPR_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock"
if [[ -S "$HYPR_SOCKET" ]]; then
  :
else
  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
  exit 0
fi

last_count=""
last_count="$(sync_gaming_state "$last_count")"

while true; do
  while IFS= read -r line; do
    if handle_event "$line"; then
      last_count="$(sync_gaming_state "$last_count")"
    fi
  done < <(socat -U - "UNIX-CONNECT:$HYPR_SOCKET")

  sleep "$RECONNECT_DELAY_SECONDS"
done
