#!/usr/bin/env dash

set -eu

hyprctl reload

pkill waybar 2>/dev/null || true
pkill gjs 2>/dev/null || true
pkill -f waybar-edge-monitor 2>/dev/null || true
pkill -f window-state.sh 2>/dev/null || true
pkill -f window-state-daemon.lua 2>/dev/null || true
pkill -f window-capture-daemon 2>/dev/null || true
pkill -f custom-layout-drag-resize-daemon.lua 2>/dev/null || true
pkill -f hyprpaper 2>/dev/null || true

sleep 0.2

uwsm-app -s s -- waybar &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-edge-monitor.sh &
swaync-client -R &
swaync-client -rs &

uwsm-app -s b -- hyprpaper &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-state/window-state.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.lua &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh daemon &

sleep 1

~/.config/hypr/runtime/profiles/profilectl.sh reconcile || true

HYPR_ICON=""
ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "$HYPR_ICON" 64 "#58e1ff")
notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:hyprland-reset "Desktop Reset" -i "$ICON"
