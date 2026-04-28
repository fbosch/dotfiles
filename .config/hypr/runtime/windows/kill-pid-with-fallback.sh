#!/usr/bin/env bash

set -euo pipefail

pid="${1:-}"

if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]]; then
  :
else
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a Hyprland "Kill failed" "Invalid PID: ${pid:-empty}"
  fi
  exit 1
fi

if kill "$pid" 2>/dev/null; then
  exit 0
fi

if kill -9 "$pid" 2>/dev/null; then
  exit 0
fi

if command -v notify-send >/dev/null 2>&1; then
  notify-send -a Hyprland "Kill failed" "PID: $pid"
fi

exit 1
