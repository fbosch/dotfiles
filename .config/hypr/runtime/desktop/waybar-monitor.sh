#!/usr/bin/env dash
# shellcheck disable=SC2034
set -eu

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"
# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/daemon-lifecycle.sh"

daemon="${HOME}/.config/hypr/runtime/desktop/waybar-monitor.lua"

daemon_supervisor_name="waybar-monitor"
daemon_supervisor_socket="$(hypr_instance_socket_path waybar-monitor.sock)"
daemon_supervisor_lock_file="$(hypr_instance_path waybar-monitor.lock)"
daemon_supervisor_health_timeout=1
daemon_supervisor_start_attempts=10
daemon_supervisor_start_interval=0.1
daemon_supervisor_health_attempts=2
daemon_supervisor_shutdown_commands="quit"
daemon_supervisor_shutdown_attempts=20
daemon_supervisor_shutdown_interval=0.01
daemon_supervisor_cleanup_paths="$(hypr_instance_path waybar-launch.pending) $(hypr_instance_path waybar-visibility.state)"

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/daemon-supervisor.sh"

case "${1:-}" in
  layer-opened|layer-closed)
    if [ "$#" -ne 1 ]; then
      daemon_supervisor_log "usage: ${0##*/} [start|restart|layer-opened|layer-closed]"
      exit 2
    fi
    daemon_supervisor_send "$1"
    exit $?
    ;;
  show|hide|prewarm|hold|release)
    daemon_supervisor_log "public control intent must use waybar-control.sh"
    exit 2
    ;;
esac

daemon_supervisor_main "$@" -- luajit "$daemon"
