#!/usr/bin/env dash

set -eu

wait_for_waybar_monitor_shutdown() {
  attempts=0
  while pgrep -f "waybar-monitor\.(sh|lua)" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'reset-desktop: waybar monitor did not stop\n' >&2
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

hyprctl reload

pkill waybar 2>/dev/null || true
pkill gjs 2>/dev/null || true
pkill -f "waybar-monitor.sh" 2>/dev/null || true
pkill -f "waybar-monitor.lua" 2>/dev/null || true
pkill -f window-state.sh 2>/dev/null || true
pkill -f window-state-daemon.lua 2>/dev/null || true
pkill -f window-capture-daemon 2>/dev/null || true
pkill -f custom-layout-drag-resize-daemon.lua 2>/dev/null || true
pkill -f hyprpaper 2>/dev/null || true

wait_for_waybar_monitor_shutdown
wait_for_window_capture_shutdown
wait_for_window_state_shutdown

uwsm-app -s s -- waybar &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-monitor.sh &
swaync-client -R &
swaync-client -rs &

uwsm-app -s b -- hyprpaper &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-state/window-state.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh daemon &

sleep 1

~/.config/hypr/runtime/profiles/profilectl.sh reconcile || true

HYPR_ICON=""
ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "$HYPR_ICON" 64 "#58e1ff")
notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:hyprland-reset "Desktop Reset" -i "$ICON"
