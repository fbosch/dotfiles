#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"
LOCK_FILE="$(hypr_instance_path "gaming-session-watchdog.lock")"
PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"

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
  "$PROFILECTL" sync-source gaming watchdog 0 >/dev/null 2>&1 || true
}

trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

"${HOME}/.config/hypr/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.lua" "$@" &
child_pid="$!"
wait "$child_pid"
