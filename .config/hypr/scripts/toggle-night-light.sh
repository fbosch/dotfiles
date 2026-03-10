#!/usr/bin/env bash

set -euo pipefail

TEMPERATURE=4000

# Check if night light is currently enabled
if pgrep -x hyprsunset >/dev/null; then
  # Disable night light - restore normal color temperature
  echo "Disabling night light..."
  
  # Kill hyprsunset to restore normal color temperature
  pkill -9 hyprsunset 2>/dev/null || true
  
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
  
  # Start hyprsunset with configured temperature
  hyprsunset -t "$TEMPERATURE" >/dev/null 2>&1 &
  
  # Show notification
  ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "󰖔" 64 "#e67e22" 2>/dev/null || echo "")
  if [[ -n "$ICON" && -f "$ICON" ]]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light \
      "Night Light Enabled" \
      "Color temperature set to ${TEMPERATURE}K" \
      -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:night-light \
      "Night Light Enabled" \
      "Color temperature set to ${TEMPERATURE}K"
  fi
  
  echo "Night light enabled"
fi
