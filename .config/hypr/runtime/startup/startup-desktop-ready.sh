#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC1091
source "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

readonly TARGET_MONITOR="DP-2"
readonly PORTRAIT_MONITOR="HDMI-A-2"
readonly BOOT_SOUND_FILE="$HOME/.config/hypr/assets/bootup.ogg"
readonly BOOT_SOUND_DELAY_SECONDS=1.2
readonly STARTUP_LOG_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-startup-desktop-ready.log"

lua_quote() {
  jq -Rn --arg value "$1" '$value'
}

log_startup() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$STARTUP_LOG_FILE" 2>/dev/null || true
}

move_cursor_to_monitor_center() {
  local monitor x y width height target_x target_y

  monitor="$(hypr_query j/monitors | jq -c --arg name "$TARGET_MONITOR" 'first(.[] | select(.name == $name)) // empty')"
  [[ -z "$monitor" ]] && return 0

  IFS=$'\t' read -r x y width height < <(jq -r '[.x, .y, .width, .height] | @tsv' <<< "$monitor")
  [[ -z "$x" || -z "$y" || -z "$width" || -z "$height" ]] && return 0

  target_x=$((x + width / 2))
  target_y=$((y + height / 2))

  hypr_dispatch_lua "hl.dsp.cursor.move({ x = ${target_x}, y = ${target_y} })" || true
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

apply_startup_workspace_routing() {
	hypr_dispatch_lua "hl.dsp.workspace.move({ workspace = \"1\", monitor = $(lua_quote "$PORTRAIT_MONITOR") })" || true
	hypr_dispatch_lua "hl.dsp.workspace.move({ workspace = \"2\", monitor = $(lua_quote "$TARGET_MONITOR") })" || true
	hypr_dispatch_lua "hl.dsp.workspace.move({ workspace = \"10\", monitor = $(lua_quote "$TARGET_MONITOR") })" || true
	hypr_dispatch_lua 'hl.dsp.focus({ workspace = "2" })' || true
	hypr_dispatch_lua "hl.dsp.focus({ monitor = $(lua_quote "$TARGET_MONITOR") })" || true
	move_cursor_to_monitor_center
}

run_startup_ready_actions() {
  log_startup "startup_actions_begin"
  apply_startup_workspace_routing
  log_startup "workspace_routing_applied"
  play_bootup_sound
  log_startup "startup_actions_done"
}

run_startup_ready_actions
