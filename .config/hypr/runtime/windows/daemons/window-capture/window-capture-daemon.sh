#!/usr/bin/env bash

set -euo pipefail

daemon="${HOME}/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.lua"
mode="${1:-daemon}"

if [[ "$mode" != "daemon" ]]; then
  exec "$daemon" "$@"
fi

if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
  printf 'window-capture: XDG_RUNTIME_DIR is required\n' >&2
  exit 1
fi

daemon_lock_dir="$XDG_RUNTIME_DIR/hypr-window-capture-daemon.lock.d"
worker_owner_file="$XDG_RUNTIME_DIR/hypr-window-capture-worker.lock.d/owner"
child_pid=""

stop_worker_group() {
  [[ -r "$worker_owner_file" ]] || return

  local worker_pid
  IFS=$'\t' read -r worker_pid _ < "$worker_owner_file" || return
  [[ "$worker_pid" =~ ^[0-9]+$ ]] || return
  kill -TERM -- "-$worker_pid" >/dev/null 2>&1 || true
}

cleanup() {
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" >/dev/null 2>&1 || true
    pkill -TERM -P "$child_pid" >/dev/null 2>&1 || true
    stop_worker_group
    wait "$child_pid" >/dev/null 2>&1 || true
  fi

  local lock_pid
  lock_pid="$(<"$daemon_lock_dir/pid" 2>/dev/null || true)"
  if [[ "$lock_pid" == "$child_pid" ]]; then
    rm -rf "$daemon_lock_dir"
  fi
}

trap cleanup EXIT
trap 'exit 0' INT TERM

"$daemon" daemon &
child_pid="$!"

status=0
wait "$child_pid" || status=$?
child_pid=""
exit "$status"
