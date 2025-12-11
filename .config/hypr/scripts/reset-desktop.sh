#!/usr/bin/env bash

set -euo pipefail

hyprctl reload

# Gracefully stop relevant background services if they are running.
pkill waybar 2>/dev/null || true
pkill hyprpaper 2>/dev/null || true
pkill -f "waybar-hover.sh" 2>/dev/null || true
pkill gjs 2>/dev/null || true  # Kill AGS instances

sleep 0.2

# Relaunch the desktop helpers.
waybar &
hyprpaper &
swaync-client -R &
swaync-client -rs &
bash ~/.config/hypr/scripts/waybar-hover.sh &
ags run ~/.config/ags/confirm-dialog.tsx &
