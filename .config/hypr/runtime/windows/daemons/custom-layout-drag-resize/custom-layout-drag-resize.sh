#!/usr/bin/env dash
set -eu

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
  printf 'custom-layout-drag-resize: XDG_RUNTIME_DIR is required\n' >&2
  exit 1
fi

runtime_dir="$XDG_RUNTIME_DIR/hypr-custom-layout-drag-resize"
command_socket="$runtime_dir/command.sock"
lock_file="$runtime_dir/daemon.lock"
mode="${1:-start}"
daemon="${HOME}/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize-daemon.lua"
shutdown_wait_attempts=20
shutdown_wait_interval=0.01

command_response() {
  [ -S "$command_socket" ] || return 1
  printf 'ping\n' | nc -w 1 -U "$command_socket" 2>/dev/null
}

daemon_is_live() {
  [ "$(command_response || true)" = "ok" ]
}

socket_accepts_connections() {
  [ -S "$command_socket" ] || return 1
  printf 'ping\n' | nc -w 1 -U "$command_socket" >/dev/null 2>&1
}

ensure_daemon() {
  if daemon_is_live; then
    return
  fi

  mkdir -p "$runtime_dir"
  if socket_accepts_connections; then
    printf 'custom-layout-drag-resize: incompatible daemon socket\n' >&2
    return 1
  fi
  "$0" daemon >/dev/null 2>&1 &

  tries=0
  while ! daemon_is_live && [ "$tries" -lt 20 ]; do
    tries=$((tries + 1))
    sleep 0.005
  done

  daemon_is_live
}

send_command() {
  ensure_daemon
  response="$(printf '%s\n' "$1" | nc -w 1 -U "$command_socket" 2>/dev/null || true)"
  if [ "$response" != "ok" ]; then
    printf 'custom-layout-drag-resize: daemon command failed\n' >&2
    exit 1
  fi
}

run_daemon() {
  mkdir -p "$runtime_dir"

  if daemon_is_live; then
    exit 0
  fi

  if socket_accepts_connections; then
    printf 'custom-layout-drag-resize: incompatible daemon socket\n' >&2
    exit 1
  fi

  if ! command -v flock >/dev/null 2>&1; then
    printf 'custom-layout-drag-resize: flock is required\n' >&2
    exit 1
  fi

  exec 9>"$lock_file"
  if ! flock -n 9; then
    exit 0
  fi

  if daemon_is_live; then
    exit 0
  fi

  if socket_accepts_connections; then
    printf 'custom-layout-drag-resize: incompatible daemon socket\n' >&2
    exit 1
  fi

  # The exclusive lock proves an unresponsive socket has no current owner.
  rm -f "$command_socket"

  child_pid=""
  shutdown_requested=0
  graceful_shutdown() {
    [ -S "$command_socket" ] || return
    printf 'stop\n' | nc -w 1 -U "$command_socket" >/dev/null 2>&1 || true
    printf 'quit\n' | nc -w 1 -U "$command_socket" >/dev/null 2>&1 || true
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

  cleanup() {
    if [ -n "$child_pid" ]; then
      graceful_shutdown
      wait_for_shutdown
    fi
    rm -f "$command_socket" "$runtime_dir/daemon.pid"
  }

  request_shutdown() {
    shutdown_requested=1
    if [ -n "$child_pid" ]; then
      graceful_shutdown
    fi
  }

  trap cleanup EXIT
  trap request_shutdown INT TERM

  luajit "$daemon" &
  child_pid="$!"

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

  return "$status"
}

case "$mode" in
  stop)
    send_command stop
    exit 0
    ;;
  start)
    send_command start
    ;;
  daemon)
    run_daemon
    ;;
  *)
    printf 'usage: %s start|stop\n' "$0" >&2
    exit 2
    ;;
esac
