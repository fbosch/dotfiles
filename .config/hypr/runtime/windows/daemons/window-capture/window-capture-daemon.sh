#!/usr/bin/env bash

set -euo pipefail

daemon="${HYPR_WINDOW_CAPTURE_DAEMON:-${HOME}/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.lua}"
mode="${1:-daemon}"

if [[ "$mode" != "daemon" ]]; then
  exec "$daemon" "$@"
fi

if [[ -z "${XDG_RUNTIME_DIR:-}" || -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
  printf 'window-capture: XDG_RUNTIME_DIR and HYPRLAND_INSTANCE_SIGNATURE are required\n' >&2
  exit 1
fi

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"
daemon_lock_dir="$(hypr_instance_path "window-capture-daemon.lock.d")"
worker_lock_dir="$(hypr_instance_path "window-capture-worker.lock.d")"
worker_owner_file="$worker_lock_dir/owner"
child_pid=""

# shellcheck disable=SC2329
stop_worker_group() {
  [[ -r "$worker_owner_file" ]] || return 0

  local worker_pid owner_line stat remainder fields
  owner_line="$(<"$worker_owner_file")"
  worker_pid="${owner_line%%$'\t'*}"
  [[ "$worker_pid" =~ ^[0-9]+$ && "$child_pid" =~ ^[0-9]+$ && -r "/proc/$worker_pid/stat" ]] || return 0
  stat="$(<"/proc/$worker_pid/stat")"
  remainder="${stat##*) }"
  read -r -a fields <<< "$remainder"
  [[ "${fields[1]:-}" == "$child_pid" ]] || return 0
  kill -CONT -- "-$worker_pid" >/dev/null 2>&1 || true
  kill -TERM -- "-$worker_pid" >/dev/null 2>&1 || true
}

# shellcheck disable=SC2329
cleanup_stopped_worker_lock() {
  [[ -r "$worker_owner_file" ]] || return 0

  local owner_line worker_pid
  owner_line="$(<"$worker_owner_file")"
  worker_pid="${owner_line%%$'\t'*}"
  [[ "$worker_pid" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$worker_pid" >/dev/null 2>&1 && return 0
  rm -rf "$worker_lock_dir"
}

# shellcheck disable=SC2329
cleanup() {
  if [[ -n "$child_pid" ]]; then
    kill -CONT "$child_pid" >/dev/null 2>&1 || true
    kill -TERM "$child_pid" >/dev/null 2>&1 || true
    pkill -TERM -P "$child_pid" >/dev/null 2>&1 || true
    stop_worker_group
    wait "$child_pid" >/dev/null 2>&1 || true
    cleanup_stopped_worker_lock
  fi

  local lock_pid
  lock_pid=""
  if [[ -r "$daemon_lock_dir/pid" ]]; then
    read -r lock_pid < "$daemon_lock_dir/pid" || true
  fi
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
