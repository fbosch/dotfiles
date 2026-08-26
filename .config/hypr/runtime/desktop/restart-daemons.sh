#!/usr/bin/env dash

set -eu

# Broad desktop-service recovery. Gamescope clipboard sync remains live because
# it is independent of the desktop UI services restarted here.

resolve_supervised_daemon() {
  case "$1" in
    picture-in-picture)
      daemon_launcher="${HOME}/.config/hypr/runtime/windows/daemons/picture-in-picture.sh"
      ;;
    waybar-monitor)
      daemon_launcher="${HOME}/.config/hypr/runtime/desktop/waybar-monitor.sh"
      ;;
    *) return 1 ;;
  esac
}

restart_supervised_daemons() {
  requested_daemons=""
  for daemon_name in "$@"; do
    if ! resolve_supervised_daemon "$daemon_name"; then
      printf 'restart-daemons: unsupported daemon argument\n' >&2
      printf 'restart-daemons: supported daemons: picture-in-picture, waybar-monitor\n' >&2
      return 2
    fi
    case " $requested_daemons " in
      *" $daemon_name "*) ;;
      *) requested_daemons="$requested_daemons $daemon_name" ;;
    esac
  done

  status=0
  for daemon_name in $requested_daemons; do
    resolve_supervised_daemon "$daemon_name"
    if ! "$daemon_launcher" restart; then
      printf 'restart-daemons: failed to restart %s\n' "$daemon_name" >&2
      status=1
    fi
  done
  return "$status"
}

if [ "$#" -gt 0 ]; then
  restart_supervised_daemons "$@"
  exit $?
fi

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

wait_for_window_state_shutdown() {
  attempts=0
  while pgrep -f "window-state(-daemon)?\.(sh|lua)" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'restart-daemons: window state did not stop\n' >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_night_light_shutdown() {
  attempts=0
  while pgrep -f "night-light.sh daemon" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'restart-daemons: night light did not stop\n' >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

wait_for_gaming_watchdog_shutdown() {
  attempts=0
  while pgrep -f "gaming-session-watchdog\.(sh|lua)" >/dev/null 2>&1; do
    if [ "$attempts" -ge 100 ]; then
      printf 'restart-daemons: gaming watchdog did not stop\n' >&2
      exit 1
    fi

    attempts=$((attempts + 1))
    sleep 0.05
  done
}

hyprctl reload
systemctl --user restart vicinae.service

pkill -f '(^|/)waybar( |$)' 2>/dev/null || true
pkill swaync 2>/dev/null || true
pkill hyprpaper 2>/dev/null || true
pkill hypridle 2>/dev/null || true
pkill swayosd-server 2>/dev/null || true
pkill -f "atuin daemon" 2>/dev/null || true
pkill -f "foot --server" 2>/dev/null || true
# The wrapper execs Lua, so stop and wait for both before the lock can be reused.
pkill -f "window-state.sh" 2>/dev/null || true
pkill -f "window-state-daemon.lua" 2>/dev/null || true
pkill -f "window-capture-daemon" 2>/dev/null || true
pkill -f "gaming-session-watchdog" 2>/dev/null || true
pkill -f "picture-in-picture.sh" 2>/dev/null || true
pkill -f "picture-in-picture.lua" 2>/dev/null || true
pkill -f "waybar-monitor.sh" 2>/dev/null || true
pkill -f "waybar-monitor.lua" 2>/dev/null || true
# Night light owns hyprsunset; wait for its cleanup before starting a replacement.
pkill -f "night-light.sh daemon" 2>/dev/null || true
pkill gjs 2>/dev/null || true

wait_for_pip_shutdown
wait_for_waybar_monitor_shutdown
wait_for_window_capture_shutdown
wait_for_window_state_shutdown
wait_for_night_light_shutdown
wait_for_gaming_watchdog_shutdown

uwsm-app -s b -- hypridle &
uwsm-app -s s -- atuin daemon start &
uwsm-app -s b -- foot --server &
uwsm-app -s b -- swayosd-server &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-state/window-state.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/windows/daemons/picture-in-picture.sh &
uwsm-app -s b -- ~/.config/hypr/runtime/desktop/night-light.sh daemon &
uwsm-app -s s -- waybar &
uwsm-app -s s -- hyprpaper &
uwsm-app -s s -- swaync -c ~/.config/swaync/config.json -s ~/.config/swaync/style.css &
uwsm-app -s s -- ~/.config/ags/start-daemons.sh &
uwsm-app -s s -- ~/.config/hypr/runtime/desktop/waybar-monitor.sh &
