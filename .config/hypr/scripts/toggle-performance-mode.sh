#!/usr/bin/env bash

set -euo pipefail

# State file to track performance mode
STATE_FILE="/tmp/hypr-performance-mode"

# Check if performance mode is currently enabled
if [[ -f "$STATE_FILE" ]]; then
  # Disable performance mode - restore normal operation
  echo "Disabling performance mode..."
  
  # Resume daemons
  pkill -CONT -f window-capture-daemon 2>/dev/null || true
  pkill -CONT -f waybar-edge-monitor 2>/dev/null || true
  
  # Set window switcher to previews mode
  ags request --instance ags-bundled window-switcher '{"action": "set-mode", "mode": "previews"}' 2>/dev/null || true
  
  # Re-enable animations and shadows, restore blur to 4 passes
  hyprctl keyword animations:enabled 1 >/dev/null
  hyprctl keyword decoration:blur:passes 4 >/dev/null
  hyprctl keyword decoration:shadow:enabled 1 >/dev/null
  
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
  
  # Pause background daemons
  pkill -STOP -f window-capture-daemon 2>/dev/null || true
  pkill -STOP -f waybar-edge-monitor 2>/dev/null || true
  
  # Set window switcher to icons mode (no preview loading)
  ags request --instance ags-bundled window-switcher '{"action": "set-mode", "mode": "icons"}' 2>/dev/null || true
  
  # Disable animations and shadows, reduce blur to 1 pass for performance
  hyprctl keyword animations:enabled 0 >/dev/null
  hyprctl keyword decoration:blur:passes 1 >/dev/null
  hyprctl keyword decoration:shadow:enabled 0 >/dev/null
  
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
