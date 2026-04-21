#!/usr/bin/env bash

set -euo pipefail

readonly TARGET_MONITOR="DP-2"
readonly EVENT_WAIT_SECONDS=15
readonly EVENT_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock"

monitor_exists() {
  local monitors_json
  monitors_json=$(hyprctl monitors -j 2>/dev/null) || return 1
  jq -e --arg name "$TARGET_MONITOR" '.[] | select(.name == $name)' >/dev/null <<<"$monitors_json"
}

apply_startup_workspace_routing() {
  hyprctl --batch "dispatch workspace 10 ; dispatch moveworkspacetomonitor 10 $TARGET_MONITOR ; dispatch workspace 1 ; dispatch moveworkspacetomonitor 1 $TARGET_MONITOR ; dispatch focusmonitor $TARGET_MONITOR ; dispatch workspace 1" >/dev/null 2>&1 || true
}

wait_for_target_monitor_event() {
  [[ -S "$EVENT_SOCKET" ]] || return 1

  local -a command=(socat -U - "UNIX-CONNECT:$EVENT_SOCKET")
  if command -v timeout >/dev/null 2>&1; then
    command=(timeout "${EVENT_WAIT_SECONDS}s" "${command[@]}")
  fi

  while IFS= read -r event_line; do
    case "$event_line" in
      monitoradded*"$TARGET_MONITOR"*|monitoraddedv2*"$TARGET_MONITOR"*)
        return 0
        ;;
    esac
  done < <("${command[@]}" 2>/dev/null)

  return 1
}

if monitor_exists; then
  apply_startup_workspace_routing
  exit 0
fi

if wait_for_target_monitor_event; then
  apply_startup_workspace_routing
fi
