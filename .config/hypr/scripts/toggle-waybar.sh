#!/usr/bin/env bash

set -euo pipefail

# Toggle Waybar visibility via SIGUSR1; start Waybar if it is not running yet.
if pgrep -x waybar >/dev/null; then
    pkill -SIGUSR1 waybar
else
    exec waybar
fi
