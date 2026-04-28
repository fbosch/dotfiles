#!/usr/bin/env bash

set -euo pipefail

TIMEOUT_BIN="$(command -v timeout 2>/dev/null || true)"

run_bounded() {
  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" 2s "$@" >/dev/null 2>&1 || true
    return 0
  fi

  "$@" >/dev/null 2>&1 || true
}

stop_known_blockers() {
  local unit

  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    systemctl --user kill --signal=TERM "$unit" >/dev/null 2>&1 || true
    systemctl --user kill --signal=KILL "$unit" >/dev/null 2>&1 || true
  done < <(systemctl --user --no-legend --plain list-units 'app-Hyprland-gamescope*x2dprofile*x2dwatchdog*.scope' | cut -d' ' -f1)
}

stop_known_blockers

if systemctl --user --quiet is-active wayland-session.target ||
  systemctl --user --quiet is-active wayland-session@hyprland.desktop.target; then
  run_bounded /run/current-system/sw/bin/uwsm stop
fi

if command -v hyprctl >/dev/null 2>&1; then
  run_bounded /run/current-system/sw/bin/hyprctl dispatch exit
fi

if [[ -n "${XDG_SESSION_ID:-}" ]]; then
  run_bounded /run/current-system/sw/bin/loginctl terminate-session "$XDG_SESSION_ID"
fi

exit 0
