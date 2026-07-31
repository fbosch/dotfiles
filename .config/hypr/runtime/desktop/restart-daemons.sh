#!/usr/bin/env dash

set -eu

wait_for_pip_shutdown() {
  attempts=0
  while pgrep -f "picture-in-picture\.(sh|lua)" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'restart-daemons: picture-in-picture did not stop\n' >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_waybar_monitor_shutdown() {
  attempts=0
  while pgrep -f "waybar-monitor\.(sh|lua)" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'restart-daemons: waybar monitor did not stop\n' >&2
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
      printf 'restart-daemons: window capture did not stop\n' >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

hyprctl reload
systemctl --user restart vicinae.service

pkill waybar 2>/dev/null || true
pkill swaync 2>/dev/null || true
pkill hyprpaper 2>/dev/null || true
pkill hypridle 2>/dev/null || true
pkill swayosd-server 2>/dev/null || true
pkill flake-check-updates 2>/dev/null || true
pkill -f "atuin daemon" 2>/dev/null || true
pkill -f "foot --server" 2>/dev/null || true
pkill -f "window-state.sh" 2>/dev/null || true
pkill -f "minimized-state-daemon" 2>/dev/null || true
pkill -f "window-capture-daemon" 2>/dev/null || true
pkill -f "gaming-session-watchdog" 2>/dev/null || true
pkill -f "picture-in-picture.sh" 2>/dev/null || true
pkill -f "picture-in-picture.lua" 2>/dev/null || true
pkill -f "waybar-monitor.sh" 2>/dev/null || true
pkill -f "waybar-monitor.lua" 2>/dev/null || true
pkill -f "night-light.sh daemon" 2>/dev/null || true
pkill gjs 2>/dev/null || true

wait_for_pip_shutdown
wait_for_waybar_monitor_shutdown
wait_for_window_capture_shutdown

uwsm-app -s b -- hypridle &
uwsm-app -s s -- atuin daemon &
uwsm-app -s b -- foot --server &
uwsm-app -s b -- flake-check-updates &
uwsm-app -s b -- swayosd-server &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-state/window-state.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/minimized-state/minimized-state-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/picture-in-picture.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/desktop/night-light.sh daemon &
uwsm-app -s s -- waybar &
uwsm-app -s s -- hyprpaper &
uwsm-app -s s -- swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-monitor.sh &
