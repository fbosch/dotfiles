#!/usr/bin/env bash

set -euo pipefail

PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"

dispatch_killactive() {
  hyprctl dispatch killactive >/dev/null
}

is_gamemoded_window() {
  local app_class="$1"

  if [[ "$app_class" =~ ^(gamescope|steam_app_.*)$ ]]; then
    return 0
  fi

  return 1
}

if "$PROFILECTL" is-active gaming; then
  active_window_json="$(hyprctl activewindow -j 2>/dev/null || printf '{}')"
  app_class="$(jq -r '.class // ""' <<< "$active_window_json")"
  title="$(jq -r '.title // ""' <<< "$active_window_json")"

  if is_gamemoded_window "$app_class"; then
    if command -v notify-send >/dev/null 2>&1; then
      notify-send -a Hyprland "Kill blocked" "Gamemoded window protected: $title"
    fi
    exit 0
  fi
fi

dispatch_killactive
