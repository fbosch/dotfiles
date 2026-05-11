#!/usr/bin/env bash

set -euo pipefail

case "${1:-}" in
  start)
    systemctl --user start hyprwhspr-rs.service >/dev/null 2>&1 || true
    exec hyprwhspr-rs record start
    ;;
  stop)
    exec hyprwhspr-rs record stop
    ;;
  *)
    printf "usage: %s <start|stop>\n" "$0" >&2
    exit 2
    ;;
esac
