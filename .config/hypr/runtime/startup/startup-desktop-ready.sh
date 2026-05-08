#!/usr/bin/env bash

set -euo pipefail

readonly TARGET_MONITOR="DP-2"
readonly BOOT_SOUND_FILE="$HOME/.config/hypr/assets/bootup.ogg"
readonly BOOT_SOUND_DELAY_SECONDS=1.2
readonly STARTUP_LOG_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-startup-desktop-ready.log"

lua_quote() {
  jq -Rn --arg value "$1" '$value'
}

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

apply_startup_workspace_routing() {
  hyprctl dispatch 'hl.dsp.focus({ workspace = "10" })' >/dev/null 2>&1 || true
  hyprctl dispatch "hl.dsp.workspace.move({ id = \"10\", monitor = $(lua_quote "$TARGET_MONITOR") })" >/dev/null 2>&1 || true
  hyprctl dispatch "hl.dsp.focus({ monitor = $(lua_quote "$TARGET_MONITOR") })" >/dev/null 2>&1 || true
}

run_startup_ready_actions() {
  log_startup "startup_actions_begin"
  apply_startup_workspace_routing
  log_startup "workspace_routing_applied"
  play_bootup_sound
  log_startup "startup_actions_done"
}

run_startup_ready_actions
