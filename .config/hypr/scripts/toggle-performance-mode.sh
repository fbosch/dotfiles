#!/usr/bin/env bash

set -euo pipefail

# State file to track performance mode
STATE_FILE="/tmp/hypr-performance-mode"

# Check if performance mode is currently enabled
if [[ -f "$STATE_FILE" ]]; then
  # Disable performance mode - restore normal operation
  echo "Disabling performance mode..."
  
  # Resume window capture daemon
  pkill -CONT -f window-capture-daemon 2>/dev/null || true
  
  # Set window switcher to previews mode
  ags request --instance window-switcher-daemon '{"action": "set-mode", "mode": "previews"}' 2>/dev/null || true
  
  # Remove state file
  rm -f "$STATE_FILE"
  
  # Show notification
  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󰠠" 64 "#dea721" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode \
      "Performance Mode Disabled" \
      -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode \
      "Performance Mode Disabled"
  fi
  
  echo "Performance mode disabled"
else
  # Enable performance mode - maximize performance
  echo "Enabling performance mode..."
  
  # Pause window capture daemon (stops taking screenshots)
  pkill -STOP -f window-capture-daemon 2>/dev/null || true
  
  # Set window switcher to icons mode (no preview loading)
  ags request --instance window-switcher-daemon '{"action": "set-mode", "mode": "icons"}' 2>/dev/null || true
  
  # Create state file
  touch "$STATE_FILE"
  
  # Show notification
  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󱤅" 64 "#73bc6f" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode \
      "Performance Mode Enabled" \
      -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:perf-mode \
      "Performance Mode Enabled"
  fi
  
  echo "Performance mode enabled"
fi
