#!/usr/bin/env dash
set -eu

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

runtime_dir="${XDG_RUNTIME_DIR:-}/hypr-custom-layout-drag-resize"
mode="${1:-start}"
daemon="${HOME}/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize-daemon.lua"

daemon_supervisor_name="custom-layout-drag-resize"
daemon_supervisor_socket="$runtime_dir/command.sock"
daemon_supervisor_lock_file="$runtime_dir/daemon.lock"
daemon_supervisor_health_timeout=1
daemon_supervisor_start_attempts=20
daemon_supervisor_start_interval=0.005
daemon_supervisor_health_attempts=20
daemon_supervisor_shutdown_commands="stop quit"
daemon_supervisor_shutdown_attempts=20
daemon_supervisor_shutdown_interval=0.01
daemon_supervisor_cleanup_paths="$runtime_dir/daemon.pid"

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/daemon-supervisor.sh"

case "$mode" in
  stop)
    daemon_supervisor_ensure "$0" daemon
    daemon_supervisor_send stop
    ;;
  start)
    daemon_supervisor_ensure "$0" daemon
    daemon_supervisor_send start
    ;;
  daemon)
    daemon_supervise luajit "$daemon"
    ;;
  *)
    printf 'usage: %s start|stop\n' "$0" >&2
    exit 2
    ;;
esac
