#!/usr/bin/env dash
# shellcheck disable=SC2034
set -eu

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

mode="${1:-start}"
sequence="${2:-}"
daemon="${HOME}/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize-daemon.lua"

daemon_supervisor_name="custom-layout-drag-resize"
daemon_supervisor_socket="$(hypr_instance_socket_path clr.sock)"
daemon_supervisor_lock_file="$(hypr_instance_path custom-layout-drag-resize.lock)"
daemon_supervisor_health_timeout=1
daemon_supervisor_start_attempts=20
daemon_supervisor_start_interval=0.005
daemon_supervisor_health_attempts=20
daemon_supervisor_shutdown_commands="stop quit"
daemon_supervisor_shutdown_attempts=20
daemon_supervisor_shutdown_interval=0.01
daemon_supervisor_cleanup_paths="$(hypr_instance_path custom-layout-drag-resize.pid)"

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/daemon-supervisor.sh"

case "$mode" in
  start | stop)
    case "$sequence" in
      '' | *[!0-9]*)
        printf 'usage: %s start|stop SEQUENCE\n' "$0" >&2
        exit 2
        ;;
    esac
    daemon_supervisor_ensure "$0" daemon
    daemon_supervisor_send "$mode $sequence"
    ;;
  daemon)
    daemon_supervise luajit "$daemon"
    ;;
  *)
    printf 'usage: %s start|stop\n' "$0" >&2
    exit 2
    ;;
esac
