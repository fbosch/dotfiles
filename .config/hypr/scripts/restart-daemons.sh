#!/usr/bin/env bash

set -euo pipefail

hyprctl reload

pkill waybar 2>/dev/null || true
pkill swaync 2>/dev/null || true
pkill hyprpaper 2>/dev/null || true
pkill hypridle 2>/dev/null || true
pkill swayosd-server 2>/dev/null || true
pkill flake-check-updates 2>/dev/null || true
pkill -f "vicinae server" 2>/dev/null || true
pkill -f "atuin daemon" 2>/dev/null || true
pkill -f "foot --server" 2>/dev/null || true
pkill -f "window-state.sh" 2>/dev/null || true
pkill -f "window-capture-daemon.sh" 2>/dev/null || true
pkill -f "gamescope-profile-watchdog.sh" 2>/dev/null || true
pkill -f "waybar-edge-monitor.sh" 2>/dev/null || true
pkill gjs 2>/dev/null || true

sleep 0.2

uwsm-app -s b -- hypridle &
uwsm-app -s s -- vicinae server &
uwsm-app -s s -- atuin daemon &
uwsm-app -s b -- foot --server &
uwsm-app -s b -- flake-check-updates &
uwsm-app -s b -- swayosd-server &
uwsm-app -s b -- ~/.config/hypr/scripts/window-state.sh &
uwsm-app -s b -- ~/.config/hypr/scripts/window-capture-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/scripts/gamescope-profile-watchdog.sh &
uwsm-app -s s -- waybar &
uwsm-app -s s -- hyprpaper &
uwsm-app -s s -- swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/scripts/waybar-edge-monitor.sh &
