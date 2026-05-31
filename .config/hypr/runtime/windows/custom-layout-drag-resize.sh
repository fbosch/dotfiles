#!/usr/bin/env dash
set -eu

. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/hypr-custom-layout-drag-resize"
command_socket="$runtime_dir/command.sock"
mode="${1:-start}"
daemon="${HOME}/.config/hypr/runtime/windows/custom-layout-drag-resize-daemon.lua"

ensure_daemon() {
  if [ -S "$command_socket" ]; then
    return
  fi

  mkdir -p "$runtime_dir"
  rm -f "$command_socket"
  lua "$daemon" >/dev/null 2>&1 &

  tries=0
  while [ ! -S "$command_socket" ] && [ "$tries" -lt 20 ]; do
    tries=$((tries + 1))
    sleep 0.005
  done
}

send_command() {
  ensure_daemon
  [ -S "$command_socket" ] || exit 1
  printf '%s\n' "$1" | nc -U "$command_socket"
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
    exec lua "$daemon"
    ;;
  *)
    printf 'usage: %s start|stop\n' "$0" >&2
    exit 2
    ;;
esac
