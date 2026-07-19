#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/gaming-session-watchdog.lock"
PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if flock -n 9; then
  :
else
  exit 0
fi

child_pid=""

cleanup() {
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" >/dev/null 2>&1 || true
    wait "$child_pid" >/dev/null 2>&1 || true
  fi
  "$PROFILECTL" sync gaming 0 >/dev/null 2>&1 || true
}

trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

"${HOME}/.config/hypr/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.lua" "$@" &
child_pid="$!"
wait "$child_pid"
