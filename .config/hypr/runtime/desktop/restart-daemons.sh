#!/usr/bin/env dash

set -eu

hyprctl reload

pkill waybar 2>/dev/null || true
pkill swaync 2>/dev/null || true
pkill hyprpaper 2>/dev/null || true
pkill hypridle 2>/dev/null || true
pkill swayosd-server 2>/dev/null || true
pkill flake-check-updates 2>/dev/null || true
pkill -f "atuin daemon" 2>/dev/null || true
pkill -f "foot --server" 2>/dev/null || true
pkill -f "window-state.sh" 2>/dev/null || true
pkill -f "minimized-state-daemon" 2>/dev/null || true
pkill -f "window-capture-daemon" 2>/dev/null || true
pkill -f "gamescope-profile-watchdog" 2>/dev/null || true
pkill -f "waybar-edge-monitor.sh" 2>/dev/null || true
pkill -f "toggle-night-light.sh daemon" 2>/dev/null || true
pkill gjs 2>/dev/null || true

sleep 0.2

uwsm-app -s b -- hypridle &
uwsm-app -s s -- atuin daemon &
uwsm-app -s b -- foot --server &
uwsm-app -s b -- flake-check-updates &
uwsm-app -s b -- swayosd-server &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-state/window-state.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/minimized-state/minimized-state-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/gamescope/daemons/gamescope-profile-watchdog/gamescope-profile-watchdog.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/desktop/toggle-night-light.sh daemon &
uwsm-app -s s -- waybar &
uwsm-app -s s -- hyprpaper &
uwsm-app -s s -- swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-edge-monitor.sh &
