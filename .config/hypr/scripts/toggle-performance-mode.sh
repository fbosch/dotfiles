#!/usr/bin/env bash

set -euo pipefail

PROFILECTL="$HOME/.config/hypr/scripts/profilectl.sh"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/toggle-performance-mode.lock"

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
fi

if "$PROFILECTL" is-active performance; then
  "$PROFILECTL" remove performance

  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󰠠" 64 "#dea721" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode "Performance Mode Disabled" -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode "Performance Mode Disabled"
  fi

  exit 0
fi

"$PROFILECTL" apply performance

ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󱤅" 64 "#73bc6f" 2>/dev/null || echo "")
if [[ -n "$ICON" && -f "$ICON" ]]; then
  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode "Performance Mode Enabled" -i "$ICON"
else
  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode "Performance Mode Enabled"
fi
