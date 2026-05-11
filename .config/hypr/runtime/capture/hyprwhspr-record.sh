#!/usr/bin/env bash

set -euo pipefail

wait_for_recorder() {
  local attempts=20

  while ((attempts > 0)); do
    if hyprwhspr-rs record status >/dev/null 2>&1; then
      return 0
    fi

    sleep 0.05
    attempts=$((attempts - 1))
  done

  return 1
}

case "${1:-}" in
  start)
    systemctl --user start hyprwhspr-rs.service >/dev/null 2>&1 || true
    wait_for_recorder || exit 1
    exec hyprwhspr-rs record start >/dev/null
    ;;
  stop)
    exec hyprwhspr-rs record stop >/dev/null
    ;;
  *)
    printf "usage: %s <start|stop>\n" "$0" >&2
    exit 2
    ;;
esac
