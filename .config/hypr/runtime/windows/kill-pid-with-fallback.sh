#!/usr/bin/env dash

set -eu

pid="${1:-}"

case "$pid" in
  ''|*[!0-9]*|0)
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a Hyprland "Kill failed" "Invalid PID: ${pid:-empty}"
  fi
  exit 1
  ;;
esac

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
