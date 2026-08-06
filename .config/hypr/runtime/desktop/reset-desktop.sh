#!/usr/bin/env dash

set -eu

# Rebuild compositor-bound desktop UI workers. It leaves minimized state, PiP,
# gaming watchdog, Gamescope clipboard sync, and night light running because
# they retain independent state or do not need the rebuilt desktop UI.

wait_for_shutdown() {
  name="$1"
  shift
  attempts=0
  while "$@" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'reset-desktop: %s did not stop\n' "$name" >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_shutdowns() {
  wait_for_shutdown "AGS" pgrep -x gjs &
  ags_pid=$!
  wait_for_shutdown "Foot server" pgrep -f "foot --server" &
  foot_pid=$!
  wait_for_shutdown "waybar" pgrep -x waybar &
  waybar_pid=$!
  wait_for_shutdown "hyprpaper" pgrep -x hyprpaper &
  hyprpaper_pid=$!
  wait_for_shutdown "waybar monitor" pgrep -f "waybar-monitor\.(sh|lua)" &
  waybar_monitor_pid=$!
  wait_for_shutdown "window capture" pgrep -f "window-capture-daemon\.(sh|lua)" &
  window_capture_pid=$!
  wait_for_shutdown "window state" pgrep -f "window-state(-daemon)?\.(sh|lua)" &
  window_state_pid=$!
  wait_for_shutdown "custom layout" pgrep -f "custom-layout-drag-resize(-daemon)?\.(sh|lua)" &
  custom_layout_pid=$!

  status=0
  for pid in "$ags_pid" "$foot_pid" "$waybar_pid" "$hyprpaper_pid" "$waybar_monitor_pid" "$window_capture_pid" "$window_state_pid" "$custom_layout_pid"; do
    if wait "$pid"; then
      continue
    fi

    status=1
  done

  [ "$status" -eq 0 ]
}

pkill waybar 2>/dev/null || true
pkill gjs 2>/dev/null || true
pkill -f "foot --server" 2>/dev/null || true
pkill -f "waybar-monitor.sh" 2>/dev/null || true
pkill -f "waybar-monitor.lua" 2>/dev/null || true
pkill -f window-state.sh 2>/dev/null || true
pkill -f window-state-daemon.lua 2>/dev/null || true
pkill -CONT -f window-capture-daemon 2>/dev/null || true
pkill -f window-capture-daemon 2>/dev/null || true
pkill -f "custom-layout-drag-resize.sh daemon" 2>/dev/null || true
pkill -f custom-layout-drag-resize-daemon.lua 2>/dev/null || true
pkill -f hyprpaper 2>/dev/null || true

wait_for_shutdowns

hyprctl reload

uwsm-app -s s -- waybar &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-monitor.sh &
uwsm-app -s b -- foot --server &
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
