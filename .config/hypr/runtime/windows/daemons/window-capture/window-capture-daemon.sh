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
# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/daemon-lifecycle.sh"
daemon_lock_dir="$(hypr_instance_path "window-capture-daemon.lock.d")"
worker_lock_dir="$(hypr_instance_path "window-capture-worker.lock.d")"
worker_owner_file="$worker_lock_dir/owner"
child_pid=""
lifecycle_child_pid=""
lifecycle_signal=""
lifecycle_recorded=0
daemon_lifecycle_name="window-capture"
daemon_lifecycle_file="$(hypr_instance_path "window-capture-daemon.lifecycle")"

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
  if [[ ! -r "$worker_owner_file" ]]; then
    rmdir "$worker_lock_dir" >/dev/null 2>&1 || true
    return 0
  fi

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
    # Preserve the parent relationship until worker ownership has been verified.
    stop_worker_group
    kill -TERM "$child_pid" >/dev/null 2>&1 || true
    pkill -TERM -P "$child_pid" >/dev/null 2>&1 || true
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

"$daemon" daemon &
child_pid="$!"
lifecycle_child_pid="$child_pid"
daemon_lifecycle_record_running "$child_pid"

status=0
wait "$child_pid" || status=$?
child_pid=""
daemon_lifecycle_record_exit child-exit "$status" "$lifecycle_child_pid"
lifecycle_recorded=1
exit "$status"
