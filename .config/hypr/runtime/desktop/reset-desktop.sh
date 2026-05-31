#!/usr/bin/env dash

set -eu

pkill waybar 2>/dev/null || true
pkill gjs 2>/dev/null || true
pkill -f waybar-edge-monitor 2>/dev/null || true
pkill -f window-capture-daemon 2>/dev/null || true
pkill -f custom-layout-drag-resize-daemon.lua 2>/dev/null || true
pkill -f hyprpaper 2>/dev/null || true

sleep 0.2

uwsm-app -s s -- waybar &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-edge-monitor.sh &
uwsm-app -s s -- vicinae server --replace &
swaync-client -R &
swaync-client -rs &

uwsm-app -s b -- hyprpaper &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/window-capture-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/custom-layout-drag-resize.sh daemon &

sleep 1

~/.config/hypr/runtime/profiles/profilectl.sh reconcile || true

HYPR_ICON=""
ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "$HYPR_ICON" 64 "#58e1ff")
notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:hyprland-reset "Desktop Reset" -i "$ICON"
