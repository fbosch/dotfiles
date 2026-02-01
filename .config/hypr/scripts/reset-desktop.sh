#!/usr/bin/env bash

set -euo pipefail

hyprctl reload

# Clear performance mode flag since hyprctl reload resets Hyprland state
rm -f /tmp/hypr-performance-mode

# Gracefully stop relevant background services if they are running.
pkill waybar 2>/dev/null || true
pkill gjs 2>/dev/null || true  # Kill AGS instances
pkill -f waybar-edge-monitor 2>/dev/null || true
pkill -f window-capture-daemon 2>/dev/null || true
pkill -f hyprpaper 2>/dev/null || true

sleep 0.2

# Relaunch the desktop helpers.
# High priority UI (-s s)
uwsm app -s s -- waybar &
uwsm app -s s -- ~/.config/ags/start-daemons.sh &
uwsm app -s s -- ~/.config/hypr/scripts/waybar-edge-monitor.sh &
swaync-client -R &
swaync-client -rs &

# Background services (-s b)
uwsm app -s b -- hyprpaper &
uwsm app -s b -- ~/.config/hypr/scripts/window-capture-daemon.sh &

# Wait for services to be ready before showing notification
sleep 1
HYPR_ICON=""
ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "$HYPR_ICON" 64 "#58e1ff")
notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:hyprland-reset "Config Reloaded" -i "$ICON"
