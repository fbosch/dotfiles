#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC1091
source "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gamescope-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"
RECONNECT_DELAY_SECONDS=1
EVENT_IDLE_TIMEOUT_SECONDS=5
GAMING_WORKSPACE="10"
GAMING_OVERLAY_WORKSPACE="special:gaming-overlay"

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if flock -n 9; then
  :
else
  exit 0
fi

lua_quote() {
  jq -Rn --arg value "$1" '$value'
}

cleanup() {
  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
}

trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

get_clients_json() {
  hypr_query 'j/clients' || printf '[]\n'
}

get_gaming_window_count() {
  local clients_json="${1:-}"
  local client_count=0

  [[ -n "$clients_json" ]] || clients_json="$(get_clients_json)"
  client_count="$(jq -r '[.[] | select((((.class // "") | ascii_downcase) | test("^(gamescope|steam_app_[0-9]+)$")) or (((.initialClass // "") | ascii_downcase) | test("^(gamescope|steam_app_[0-9]+)$")))] | length' <<< "$clients_json" 2>/dev/null || printf '0')"

  if [[ "$client_count" =~ ^[0-9]+$ ]] && [[ "$client_count" -gt 0 ]]; then
    printf '%s\n' "$client_count"
    return
  fi

  printf '0\n'
}

sync_gaming_state() {
  local count
  local last_count="$1"
  local clients_json="${2:-}"
  local force="${3:-0}"

  count="$(get_gaming_window_count "$clients_json")"
  if [[ "$count" =~ ^[0-9]+$ ]]; then
    :
  else
    count=0
  fi

  if [[ "$force" == "1" || "$count" != "$last_count" ]]; then
    "$PROFILECTL" sync gaming "$count"
    printf '%s\n' "$count"
    return
  fi

  printf '%s\n' "$last_count"
}

overlay_window_count() {
  local clients_json="${1:-}"

  [[ -n "$clients_json" ]] || clients_json="$(get_clients_json)"
  jq -r --arg overlay "$GAMING_OVERLAY_WORKSPACE" '[.[] | select(.workspace.name == $overlay)] | length' <<< "$clients_json" 2>/dev/null || printf '0\n'
}

maybe_show_gaming_overlay() {
  local current_count="$1"
  local last_count="$2"
  local monitors_json="${3:-}"
  local target_monitor
  local overlay_visible

  if (( current_count <= last_count )); then
    return
  fi

  [[ -n "$monitors_json" ]] || monitors_json="$(hypr_query 'j/monitors' || printf '[]\n')"

  target_monitor="$(jq -r --arg ws "$GAMING_WORKSPACE" 'first(.[] | select(.activeWorkspace.name == $ws) | .name) // empty' <<< "$monitors_json" 2>/dev/null)"
  if [[ -z "$target_monitor" ]]; then
    return
  fi

  overlay_visible="$(jq -r --arg monitor "$target_monitor" --arg overlay "$GAMING_OVERLAY_WORKSPACE" 'first(.[] | select(.name == $monitor) | .specialWorkspace.name == $overlay) // false' <<< "$monitors_json" 2>/dev/null)"
  if [[ "$overlay_visible" == "true" ]]; then
    return
  fi

  hypr_dispatch_lua_batch \
    "hl.dsp.focus({ monitor = $(lua_quote "$target_monitor") })" \
    "hl.dsp.workspace.toggle_special($(lua_quote "${GAMING_OVERLAY_WORKSPACE#special:}"))" \
    || true
}

handle_event() {
  local event="$1"

  case "$event" in
    configreloaded*)
      printf 'reload\n'
      return 0
      ;;
    openwindow*|closewindow*|movewindow*|workspace*|activewindow*|fullscreen*)
      printf 'window\n'
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
initial_clients_json="$(get_clients_json)"
last_count="$(sync_gaming_state "$last_count" "$initial_clients_json")"
last_overlay_count="$(overlay_window_count "$initial_clients_json")"

if [[ "$last_overlay_count" =~ ^[0-9]+$ ]]; then
  :
else
  last_overlay_count=0
fi

while true; do
  while IFS= read -r line; do
    event_kind="$(handle_event "$line")" || continue
    if [[ -n "$event_kind" ]]; then
      clients_json="$(get_clients_json)"
      current_overlay_count="$(overlay_window_count "$clients_json")"
      if [[ "$current_overlay_count" =~ ^[0-9]+$ ]]; then
        :
      else
        current_overlay_count="$last_overlay_count"
      fi

      monitors_json=""
      if (( current_overlay_count > last_overlay_count )); then
        monitors_json="$(hypr_query 'j/monitors' || printf '[]\n')"
      fi

      maybe_show_gaming_overlay "$current_overlay_count" "$last_overlay_count" "$monitors_json"
      last_overlay_count="$current_overlay_count"

      force_sync=0
      [[ "$event_kind" == "reload" ]] && force_sync=1
      last_count="$(sync_gaming_state "$last_count" "$clients_json" "$force_sync")"
    fi
  done < <(socat -T "$EVENT_IDLE_TIMEOUT_SECONDS" -U - "UNIX-CONNECT:$HYPR_SOCKET")

  sleep "$RECONNECT_DELAY_SECONDS"
done
