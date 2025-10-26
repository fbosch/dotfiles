#!/usr/bin/env bash

set -euo pipefail

hyprctl reload

# Gracefully stop relevant background services if they are running.
pkill waybar 2>/dev/null || true
pkill hyprpaper 2>/dev/null || true
pkill waycorners 2>/dev/null || true

sleep 0.2

# Relaunch the desktop helpers.
waybar &
hyprpaper &
swaync-client -R &
swaync-client -rs &
waycorners --config /home/fbb/.config/waycorner/config.toml &
