#!/usr/bin/env bash

set -euo pipefail

hyprctl reload

# Gracefully stop relevant background services if they are running.
pkill waybar 2>/dev/null || true
pkill gjs 2>/dev/null || true  # Kill AGS instances
pkill -f waybar-edge-monitor 2>/dev/null || true
pkill -f window-capture-daemon 2>/dev/null || true

sleep 0.2

# Relaunch the desktop helpers.
uwsm app -- waybar &
uwsm app -- swaync-client -R &
uwsm app -- swaync-client -rs &

# Launch AGS daemons via start-daemons script
uwsm app -- bash ~/.config/ags/start-daemons.sh &

# Launch waybar auto-hide monitor
~/.config/hypr/scripts/waybar-edge-monitor.sh &

# Launch window capture daemon
~/.config/hypr/scripts/window-capture-daemon.sh &

# Wait for services to be ready before showing notification
sleep 1
HYPR_ICON=""
ICON=$(~/.config/hypr/scripts/nerd-icon-gen.sh "$HYPR_ICON" 64 "#58e1ff")
notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:hyprland-reset "Config Reloaded" -i "$ICON"
