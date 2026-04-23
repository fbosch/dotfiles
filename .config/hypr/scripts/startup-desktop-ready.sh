#!/usr/bin/env bash

set -euo pipefail

readonly TARGET_MONITOR="DP-2"
readonly SECONDARY_MONITOR="HDMI-A-2"
readonly EVENT_WAIT_SECONDS=15
readonly EVENT_SOCKET="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock"
readonly BOOT_SOUND_FILE="$HOME/.config/hypr/assets/bootup.ogg"
readonly BOOT_SOUND_DELAY_SECONDS=1.2
readonly STARTUP_LOG_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-startup-desktop-ready.log"

TIMEOUT_BIN="$(command -v timeout 2>/dev/null || true)"
readonly TIMEOUT_BIN

log_startup() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$STARTUP_LOG_FILE" 2>/dev/null || true
}

play_bootup_sound() {
  if [[ -f "$BOOT_SOUND_FILE" ]]; then
    :
  else
    log_startup "boot_sound:missing_file"
    return 0
  fi

  if command -v pw-play >/dev/null 2>&1; then
    :
  else
    log_startup "boot_sound:pw_play_missing"
    return 0
  fi

  sleep "$BOOT_SOUND_DELAY_SECONDS"

  if pw-play "$BOOT_SOUND_FILE" >/dev/null 2>&1; then
    log_startup "boot_sound:played"
    return 0
  fi

  sleep 0.6
  if pw-play "$BOOT_SOUND_FILE" >/dev/null 2>&1; then
    log_startup "boot_sound:played_retry"
    return 0
  fi

  log_startup "boot_sound:play_failed"
}

required_monitors_ready() {
  local monitors_json
  monitors_json=$(hyprctl monitors -j 2>/dev/null) || return 1
  jq -e --arg primary "$TARGET_MONITOR" --arg secondary "$SECONDARY_MONITOR" 'any(.[]; .name == $primary) and any(.[]; .name == $secondary)' >/dev/null <<<"$monitors_json"
}

apply_startup_workspace_routing() {
  hyprctl --batch "dispatch workspace 10 ; dispatch moveworkspacetomonitor 10 $TARGET_MONITOR ; dispatch workspace 1 ; dispatch moveworkspacetomonitor 1 $TARGET_MONITOR ; dispatch focusmonitor $TARGET_MONITOR ; dispatch workspace 1" >/dev/null 2>&1 || true
}

run_startup_actions() {
  log_startup "startup_actions_begin"
  uwsm-app -s s -- hyprpaper >/dev/null 2>&1 || true &
  uwsm-app -s s -- waybar >/dev/null 2>&1 || true &
  uwsm-app -s s -- swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css >/dev/null 2>&1 || true &
  uwsm-app -s s -- ~/.config/ags/start-daemons.sh >/dev/null 2>&1 || true &
  uwsm-app -s s -- ~/.config/hypr/scripts/waybar-edge-monitor.sh >/dev/null 2>&1 || true &
  apply_startup_workspace_routing
  log_startup "workspace_routing_applied"
  play_bootup_sound
  log_startup "startup_actions_done"
}

wait_for_required_monitor_event() {
  [[ -S "$EVENT_SOCKET" ]] || return 1

  local -a command
  if [[ -n "$TIMEOUT_BIN" ]]; then
    command=("$TIMEOUT_BIN" "${EVENT_WAIT_SECONDS}s" socat -U - "UNIX-CONNECT:$EVENT_SOCKET")
  else
    command=(socat -T "$EVENT_WAIT_SECONDS" -U - "UNIX-CONNECT:$EVENT_SOCKET")
  fi

  local event_line
  while IFS= read -r event_line; do
    case "$event_line" in
      monitoradded*|monitorremoved*)
        log_startup "monitor_event:$event_line"
        required_monitors_ready && return 0
        ;;
    esac
  done < <("${command[@]}" 2>/dev/null || true)

  required_monitors_ready && return 0

  return 1
}

if required_monitors_ready; then
  log_startup "monitor_gate:ready_immediate"
  run_startup_actions
  exit 0
fi

if wait_for_required_monitor_event; then
  log_startup "monitor_gate:ready_after_event"
  run_startup_actions
  exit 0
fi

log_startup "monitor_gate:timeout_or_no_event"
run_startup_actions
