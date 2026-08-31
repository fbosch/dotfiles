#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"
# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/daemon-lifecycle.sh"
LOCK_FILE="$(hypr_instance_path "gaming-session-watchdog.lock")"
PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"

exec 9>"$LOCK_FILE"
if flock -n 9; then
  :
else
  exit 0
fi

child_pid=""
lifecycle_child_pid=""
lifecycle_signal=""
lifecycle_recorded=0
daemon_lifecycle_name="gaming-session-watchdog"
daemon_lifecycle_file="$(hypr_instance_path "gaming-session-watchdog.lifecycle")"

# shellcheck disable=SC2329
cleanup() {
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" >/dev/null 2>&1 || true
    wait "$child_pid" >/dev/null 2>&1 || true
  fi
  "$PROFILECTL" sync-source gaming watchdog 0 >/dev/null 2>&1 || true
  if [[ "$lifecycle_recorded" -eq 0 ]]; then
    if [[ -n "$lifecycle_signal" ]]; then
      daemon_lifecycle_record_exit signal 0 "$lifecycle_child_pid" "$lifecycle_signal"
    else
      daemon_lifecycle_record_exit clean-exit 0 "$lifecycle_child_pid"
    fi
  fi
}

trap cleanup EXIT
trap 'lifecycle_signal=INT; exit 0' INT
trap 'lifecycle_signal=TERM; exit 0' TERM

"${HOME}/.config/hypr/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.lua" "$@" &
child_pid="$!"
lifecycle_child_pid="$child_pid"
daemon_lifecycle_record_running "$child_pid"
status=0
wait "$child_pid" || status=$?
child_pid=""
daemon_lifecycle_record_exit child-exit "$status" "$lifecycle_child_pid"
lifecycle_recorded=1
exit "$status"
