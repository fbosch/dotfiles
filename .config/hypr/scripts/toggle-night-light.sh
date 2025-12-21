#!/usr/bin/env bash

set -euo pipefail

# State file to track night light mode
STATE_FILE="/tmp/hypr-night-light"

# Check if night light is currently enabled
if [[ -f "$STATE_FILE" ]]; then
  # Disable night light - restore normal color temperature
  echo "Disabling night light..."
  
  # Kill hyprsunset to restore normal color temperature
  pkill -9 hyprsunset 2>/dev/null || true
  
  # Remove state file
  rm -f "$STATE_FILE"
  
  # Show notification
  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󰖨" 64 "#dea721" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light \
      "Night Light Disabled" \
      "Color temperature restored to normal" \
      -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light \
      "Night Light Disabled" \
      "Color temperature restored to normal"
  fi
  
  echo "Night light disabled"
else
  # Enable night light - warm color temperature
  echo "Enabling night light..."
  
  # Kill any existing hyprsunset instance
  pkill -9 hyprsunset 2>/dev/null || true
  
  # Start hyprsunset with 4000K temperature
  hyprsunset -t 4000 >/dev/null 2>&1 &
  
  # Create state file
  touch "$STATE_FILE"
  
  # Show notification
  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󰖔" 64 "#e67e22" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light \
      "Night Light Enabled" \
      "Color temperature set to 4000K" \
      -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light \
      "Night Light Enabled" \
      "Color temperature set to 4000K"
  fi
  
  echo "Night light enabled"
fi

