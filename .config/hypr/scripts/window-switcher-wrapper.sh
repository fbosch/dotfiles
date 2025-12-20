#!/usr/bin/env bash
# Wrapper script for window switching with fallback
# Usage: window-switcher-wrapper.sh [next|prev|commit|hide]

action="${1:-next}"

# Check if window-switcher daemon is ready
if ags request -i window-switcher-daemon "" &>/dev/null; then
  # Daemon is ready, use it (handles state and delayed UI internally)
  ags request -i window-switcher-daemon "{\"action\":\"$action\"}"
else
  # Daemon is dead/not ready, fallback to cycle-windows.sh
  case "$action" in
    next)
      bash ~/.config/hypr/scripts/cycle-windows.sh next
      ;;
    prev)
      bash ~/.config/hypr/scripts/cycle-windows.sh prev
      ;;
    commit|hide)
      # These actions don't apply to the fallback script
      exit 0
      ;;
    *)
      bash ~/.config/hypr/scripts/cycle-windows.sh next
      ;;
  esac
fi
