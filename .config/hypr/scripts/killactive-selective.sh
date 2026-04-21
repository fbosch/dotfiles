#!/usr/bin/env bash

set -euo pipefail

PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
MINIMIZE_SCRIPT="$HOME/.config/hypr/scripts/toggle-minimized-window.sh"

readonly ACTION_KILL="kill"
readonly ACTION_BLOCK="block"
readonly ACTION_MINIMIZE="minimize"

dispatch_killactive() {
  hyprctl dispatch killactive >/dev/null
}

notify_close_action() {
  local summary="$1"
  local body="$2"

  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a Hyprland "$summary" "$body"
  fi
}

is_gaming_protected_window() {
  local app_class="$1"

  if [[ "$app_class" =~ ^(gamescope|steam_app_.*)$ ]]; then
    return 0
  fi

  return 1
}

is_steam_window() {
  local app_class="$1"

  if [[ "$app_class" =~ ^(Steam|steam)$ ]]; then
    return 0
  fi

  return 1
}

rule_block_gaming_protected_window() {
  local app_class="$1"

  if "$PROFILECTL" is-active gaming && is_gaming_protected_window "$app_class"; then
    printf '%s\n' "$ACTION_BLOCK"
    return 0
  fi

  return 1
}

rule_minimize_steam() {
  local app_class="$1"

  if is_steam_window "$app_class"; then
    printf '%s\n' "$ACTION_MINIMIZE"
    return 0
  fi

  return 1
}

resolve_close_action() {
  local app_class="$1"
  local rule

  for rule in \
    rule_block_gaming_protected_window \
    rule_minimize_steam
  do
    if action="$($rule "$app_class")"; then
      printf '%s\n' "$action"
      return
    fi
  done

  printf '%s\n' "$ACTION_KILL"
}

run_close_action() {
  local action="$1"
  local title="$2"

  if [[ "$action" == "$ACTION_BLOCK" ]]; then
    notify_close_action "Kill blocked" "Gamemoded window protected: $title"
    exit 0
  fi

  if [[ "$action" == "$ACTION_MINIMIZE" ]]; then
    "$MINIMIZE_SCRIPT"
    exit 0
  fi

  dispatch_killactive
}

active_window_json="$(hyprctl activewindow -j 2>/dev/null || printf '{}')"
app_class="$(jq -r '.class // .initialClass // ""' <<< "$active_window_json")"
title="$(jq -r '.title // ""' <<< "$active_window_json")"
action="$(resolve_close_action "$app_class")"

run_close_action "$action" "$title"
