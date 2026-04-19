#!/usr/bin/env bash

set -euo pipefail

if command -v hyprctl >/dev/null 2>&1; then
  exec /run/current-system/sw/bin/hyprctl dispatch exit
fi

if systemctl --user --quiet is-active wayland-session.target ||
  systemctl --user --quiet is-active wayland-session@hyprland.desktop.target; then
  exec /run/current-system/sw/bin/uwsm stop
fi

if [[ -n "${XDG_SESSION_ID:-}" ]]; then
  exec /run/current-system/sw/bin/loginctl terminate-session "$XDG_SESSION_ID"
fi

exit 1
