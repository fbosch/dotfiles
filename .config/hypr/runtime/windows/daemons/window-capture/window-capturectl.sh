#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
  printf 'window-capturectl: XDG_RUNTIME_DIR is required\n' >&2
  exit 1
fi

mode="${1:-status}"
daemon_lock_dir="$XDG_RUNTIME_DIR/hypr-window-capture-daemon.lock.d"
worker_owner_file="$XDG_RUNTIME_DIR/hypr-window-capture-worker.lock.d/owner"
script_dir="$(cd "$(dirname "$0")" && pwd -P)"
daemon_script="$script_dir/window-capture-daemon.lua"

proc_fields() {
  local pid="$1" stat remainder

  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/stat" ]] || return 1
  stat="$(<"/proc/$pid/stat")"
  remainder="${stat##*) }"
  read -r -a PROC_FIELDS <<< "$remainder"
}

daemon_pid=""
daemon_state="missing"

load_daemon_owner() {
  local owner_pid owner_start cmdline=()

  [[ -r "$daemon_lock_dir/owner" ]] || return 0
  IFS=$'\t' read -r owner_pid owner_start < "$daemon_lock_dir/owner" || [[ -n "$owner_pid" && -n "$owner_start" ]] || return 0
  [[ "$owner_pid" =~ ^[0-9]+$ && "$owner_start" =~ ^[0-9]+$ ]] || return 0
  proc_fields "$owner_pid" || return 0
  [[ "${PROC_FIELDS[19]:-}" == "$owner_start" ]] || return 0
  mapfile -d '' cmdline < "/proc/$owner_pid/cmdline" || return 0
  [[ "${cmdline[2]:-}" == daemon ]] || return 0
  [[ -n "${cmdline[1]:-}" && "$(readlink -f "${cmdline[1]}")" == "$(readlink -f "$daemon_script")" ]] || return 0

  daemon_pid="$owner_pid"
  daemon_state="${PROC_FIELDS[0]:-missing}"
}

worker_pid=""
worker_state="missing"

load_worker_owner() {
  local owner_pid

  [[ -n "$daemon_pid" && -r "$worker_owner_file" ]] || return 0
  IFS=$'\t' read -r owner_pid _ < "$worker_owner_file" || [[ -n "$owner_pid" ]] || return 0
  [[ "$owner_pid" =~ ^[0-9]+$ ]] || return 0
  proc_fields "$owner_pid" || return 0
  [[ "${PROC_FIELDS[1]:-}" == "$daemon_pid" ]] || return 0

  worker_pid="$owner_pid"
  worker_state="${PROC_FIELDS[0]:-missing}"
}

signal_owned_processes() {
  local signal="$1"

  load_daemon_owner
  load_worker_owner
  if [[ -n "$daemon_pid" ]]; then
    kill "-$signal" "$daemon_pid"
  fi
  if [[ -n "$worker_pid" ]]; then
    kill "-$signal" -- "-$worker_pid"
  fi

  return 0
}

status_name() {
  case "$1" in
    T|t) printf 'paused' ;;
    missing) printf 'missing' ;;
    *) printf 'running' ;;
  esac
}

case "$mode" in
  pause)
    signal_owned_processes STOP
    ;;
  resume)
    signal_owned_processes CONT
    ;;
  refresh)
    exec "$daemon_script" refresh-once
    ;;
  status)
    load_daemon_owner
    load_worker_owner
    printf 'daemon=%s\nworker=%s\n' "$(status_name "$daemon_state")" "$(status_name "$worker_state")"
    ;;
  *)
    printf 'usage: %s [pause|resume|refresh|status]\n' "$0" >&2
    exit 1
    ;;
esac
