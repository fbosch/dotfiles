#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gamescope-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
RECONNECT_DELAY_SECONDS=1
GAMING_WORKSPACE="10"
GAMING_OVERLAY_WORKSPACE="special:gaming-overlay"

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

overlay_window_count() {
  hyprctl clients -j 2>/dev/null | jq -r --arg overlay "$GAMING_OVERLAY_WORKSPACE" '[.[] | select(.workspace.name == $overlay)] | length'
}

maybe_show_gaming_overlay() {
  local current_count="$1"
  local last_count="$2"
  local target_monitor
  local overlay_visible

  if (( current_count <= last_count )); then
    return
  fi

  target_monitor="$(hyprctl monitors -j 2>/dev/null | jq -r --arg ws "$GAMING_WORKSPACE" 'first(.[] | select(.activeWorkspace.name == $ws) | .name) // empty')"
  if [[ -z "$target_monitor" ]]; then
    return
  fi

  overlay_visible="$(hyprctl monitors -j 2>/dev/null | jq -r --arg monitor "$target_monitor" --arg overlay "$GAMING_OVERLAY_WORKSPACE" 'first(.[] | select(.name == $monitor) | .specialWorkspace.name == $overlay) // false')"
  if [[ "$overlay_visible" == "true" ]]; then
    return
  fi

  hyprctl --batch "dispatch focusmonitor $target_monitor ; dispatch togglespecialworkspace ${GAMING_OVERLAY_WORKSPACE#special:}" >/dev/null 2>&1 || true
}

handle_event() {
  local event="$1"

  case "$event" in
    openwindow*|closewindow*|movewindow*|workspace*|activewindow*|fullscreen*)
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
last_overlay_count="$(overlay_window_count)"

if [[ "$last_overlay_count" =~ ^[0-9]+$ ]]; then
  :
else
  last_overlay_count=0
fi

while true; do
  while IFS= read -r line; do
    if handle_event "$line"; then
      current_overlay_count="$(overlay_window_count)"
      if [[ "$current_overlay_count" =~ ^[0-9]+$ ]]; then
        :
      else
        current_overlay_count="$last_overlay_count"
      fi

      maybe_show_gaming_overlay "$current_overlay_count" "$last_overlay_count"
      last_overlay_count="$current_overlay_count"

      last_count="$(sync_gaming_state "$last_count")"
    fi
  done < <(socat -U - "UNIX-CONNECT:$HYPR_SOCKET")

  sleep "$RECONNECT_DELAY_SECONDS"
done
