#!/usr/bin/env bash

set -euo pipefail

# State file to track hypridle state
STATE_FILE="/tmp/hypr-caffeine-mode"

# Check if hypridle is currently disabled (caffeine mode enabled)
if [[ -f "$STATE_FILE" ]]; then
  # Disable caffeine mode - re-enable hypridle
  echo "Disabling caffeine mode, enabling hypridle..."
  
  # Start hypridle if it's not running
  if ! pgrep -x hypridle >/dev/null; then
    hypridle >/dev/null 2>&1 &
  fi
  
  # Remove state file
  rm -f "$STATE_FILE"
  
  # Show notification
  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󰾪" 64 "#73bc6f" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:caffeine \
      "Caffeine Mode Disabled" \
      "Screen will auto-lock when idle" \
      -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:caffeine \
      "Caffeine Mode Disabled" \
      "Screen will auto-lock when idle"
  fi
  
  echo "Caffeine mode disabled, hypridle enabled"
else
  # Enable caffeine mode - disable hypridle
  echo "Enabling caffeine mode, disabling hypridle..."
  
  # Kill hypridle to prevent auto-lock
  pkill -9 hypridle 2>/dev/null || true
  
  # Create state file
  touch "$STATE_FILE"
  
  # Show notification
  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󰅶" 64 "#e67e22" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:caffeine \
      "Caffeine Mode Enabled" \
      "Screen will not auto-lock" \
      -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:caffeine \
      "Caffeine Mode Enabled" \
      "Screen will not auto-lock"
  fi
  
  echo "Caffeine mode enabled, hypridle disabled"
fi
