#!/usr/bin/env dash
set -eu

if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
  printf 'picture-in-picture: XDG_RUNTIME_DIR is required\n' >&2
  exit 1
fi

runtime_dir="$XDG_RUNTIME_DIR"
control_socket="$runtime_dir/hypr-pip-monitor.sock"
lock_file="$runtime_dir/hypr-pip-monitor.lock"
daemon="${HOME}/.config/hypr/runtime/windows/daemons/picture-in-picture.lua"
shutdown_wait_attempts=20
shutdown_wait_interval=0.01
startup_health_attempts=10
startup_health_interval=0.1
health_timeout_s=0.1

command_response() {
  [ -S "$control_socket" ] || return 1
  printf 'ping\n' | timeout "$health_timeout_s" nc -w 1 -U "$control_socket" 2>/dev/null
}

daemon_is_live() {
  [ "$(command_response || true)" = "ok" ]
}

socket_accepts_connections() {
  [ -S "$control_socket" ] || return 1
  printf 'ping\n' | timeout "$health_timeout_s" nc -w 1 -U "$control_socket" >/dev/null 2>&1
}

wait_for_daemon_health() {
  attempts=0
  while [ "$attempts" -lt "$startup_health_attempts" ]; do
    if [ "${shutdown_requested:-0}" -eq 1 ]; then
      return 1
    fi

    if daemon_is_live; then
      return 0
    fi

    attempts=$((attempts + 1))
    sleep "$startup_health_interval"
  done

  return 1
}

if ! command -v flock >/dev/null 2>&1; then
  printf 'picture-in-picture: flock is required\n' >&2
  exit 1
fi

if ! command -v timeout >/dev/null 2>&1; then
  printf 'picture-in-picture: timeout is required\n' >&2
  exit 1
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  if wait_for_daemon_health; then
    exit 0
  fi

  printf 'picture-in-picture: daemon lock is held without a healthy socket\n' >&2
  exit 1
fi

if daemon_is_live; then
  printf 'picture-in-picture: unmanaged daemon socket is already live\n' >&2
  exit 1
fi

if socket_accepts_connections; then
  printf 'picture-in-picture: incompatible daemon socket\n' >&2
  exit 1
fi

# The exclusive lock proves an unresponsive socket has no current owner.
rm -f "$control_socket"

child_pid=""
shutdown_requested=0

graceful_shutdown() {
  [ -S "$control_socket" ] || return 0
  printf 'quit\n' | nc -w 1 -U "$control_socket" >/dev/null 2>&1 || true
}

wait_for_shutdown() {
  attempts=0
  while kill -0 "$child_pid" >/dev/null 2>&1; do
    if [ "$attempts" -ge "$shutdown_wait_attempts" ]; then
      kill -TERM "$child_pid" >/dev/null 2>&1 || true
      break
    fi

    attempts=$((attempts + 1))
    sleep "$shutdown_wait_interval"
  done

  wait "$child_pid" >/dev/null 2>&1 || true
  child_pid=""
}

# shellcheck disable=SC2329
cleanup() {
  if [ -n "$child_pid" ]; then
    graceful_shutdown
    wait_for_shutdown
  fi
  rm -f "$control_socket"
}

# shellcheck disable=SC2329
request_shutdown() {
  shutdown_requested=1
  if [ -n "$child_pid" ]; then
    graceful_shutdown
  fi
}

trap cleanup EXIT
trap request_shutdown INT TERM

luajit "$daemon" 9>&- &
child_pid="$!"

if ! wait_for_daemon_health; then
  if [ "$shutdown_requested" -eq 1 ]; then
    exit 0
  fi

  printf 'picture-in-picture: daemon did not become healthy\n' >&2
  exit 1
fi

status=0
while [ -n "$child_pid" ]; do
  if [ "$shutdown_requested" -eq 1 ]; then
    graceful_shutdown
    wait_for_shutdown
    exit 0
  fi

  if wait "$child_pid"; then
    child_pid=""
    break
  else
    status=$?
    if [ "$shutdown_requested" -eq 1 ]; then
      graceful_shutdown
      wait_for_shutdown
      exit 0
    fi

    child_pid=""
  fi
done

exit "$status"
