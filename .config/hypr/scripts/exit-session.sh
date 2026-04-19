#!/usr/bin/env bash

set -euo pipefail

if systemctl --user --quiet is-active wayland-session.target; then
  exec /run/current-system/sw/bin/uwsm stop
fi

exec /run/current-system/sw/bin/hyprctl dispatch exit
