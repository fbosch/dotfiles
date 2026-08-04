#!/usr/bin/env dash

set -eu

# Rebuild compositor-bound desktop UI workers. It leaves minimized state, PiP,
# gaming watchdog, Gamescope clipboard sync, and night light running because
# they retain independent state or do not need the rebuilt desktop UI.

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

waybar_monitor_socket="$(hypr_instance_socket_path waybar-monitor.sock)"
custom_layout_socket="$(hypr_instance_socket_path clr.sock)"

stop_control_daemon() {
  socket_path="$1"
  [ -S "$socket_path" ] || return
  printf 'quit\n' | nc -U "$socket_path" >/dev/null 2>&1 || true
}

wait_for_control_socket_shutdown() {
  socket_path="$1"
  name="$2"
  attempts=0
  while [ -S "$socket_path" ]; do
    if [ "$attempts" -ge 100 ]; then
      printf 'reset-desktop: %s did not stop\n' "$name" >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_window_state_shutdown() {
  attempts=0
  while pgrep -f "window-state(-daemon)?\.(sh|lua)" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'reset-desktop: window state did not stop\n' >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_window_capture_shutdown() {
  attempts=0
  while pgrep -f "window-capture-daemon\.(sh|lua)" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'reset-desktop: window capture did not stop\n' >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

stop_control_daemon "$waybar_monitor_socket"
stop_control_daemon "$custom_layout_socket"
pkill waybar 2>/dev/null || true
pkill gjs 2>/dev/null || true
pkill -f window-state.sh 2>/dev/null || true
pkill -f window-state-daemon.lua 2>/dev/null || true
pkill -CONT -f window-capture-daemon 2>/dev/null || true
pkill -f window-capture-daemon 2>/dev/null || true
pkill -f hyprpaper 2>/dev/null || true

wait_for_control_socket_shutdown "$waybar_monitor_socket" "waybar monitor"
wait_for_window_capture_shutdown
wait_for_window_state_shutdown
wait_for_control_socket_shutdown "$custom_layout_socket" "custom layout"

hyprctl reload

uwsm-app -s s -- waybar &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-monitor.sh &
swaync-client -R &
swaync-client -rs &

uwsm-app -s s -- hyprpaper >/dev/null 2>&1 &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-state/window-state.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh daemon &

sleep 1

~/.config/hypr/runtime/profiles/profilectl.sh reconcile || true

HYPR_ICON=""
ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "$HYPR_ICON" 64 "#58e1ff")
notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:hyprland-reset "Desktop Reset" -i "$ICON"
