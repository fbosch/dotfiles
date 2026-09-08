#!/usr/bin/env dash

set -u

signature="${HYPRLAND_INSTANCE_SIGNATURE:-}"
case "$signature" in
  ''|*[!a-zA-Z0-9._-]*)
    printf 'waybar-process: valid HYPRLAND_INSTANCE_SIGNATURE is required\n' >&2
    exit 2
    ;;
esac

unit="app-Hyprland-waybar-demand-${signature}.service"

session_pids() {
  # Nix keeps argv[0] as waybar but names the process .waybar-wrapped.
  for pid in $(pgrep -x '(waybar|\.waybar-wrapped)' 2>/dev/null); do
    if tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null \
      | grep -Fqx "HYPRLAND_INSTANCE_SIGNATURE=$signature"; then
      printf '%s\n' "$pid"
    fi
  done
}

replace_unit() {
  # One timeout covers stopping the exact prior unit and the monitor-owned launch command.
  # shellcheck disable=SC2016
  timeout --foreground --kill-after=1 5s sh -c '
    if systemctl --user is-active --quiet "$1"; then
      systemctl --user stop "$1" || exit $?
    fi
    exec sh -c "$2"
  ' sh "$unit" "$1"
}

case "${1:-}" in
  running)
    [ "$#" -eq 1 ] || exit 2
    [ -n "$(session_pids)" ]
    ;;
  signal)
    [ "$#" -eq 2 ] || exit 2
    case "$2" in
      USR1|USR2|TERM) ;;
      *) exit 2 ;;
    esac
    found=false
    status=0
    for pid in $(session_pids); do
      found=true
      kill "-$2" "$pid" 2>/dev/null || status=1
    done
    "$found" || exit 1
    exit "$status"
    ;;
  replace-unit)
    [ "$#" -eq 2 ] || exit 2
    replace_unit "$2"
    ;;
  stop-unit)
    [ "$#" -eq 1 ] || exit 2
    if systemctl --user is-active --quiet "$unit"; then
      systemctl --user stop "$unit"
    fi
    ;;
  unit-name)
    [ "$#" -eq 1 ] || exit 2
    printf '%s\n' "$unit"
    ;;
  *)
    printf 'usage: %s {running|signal USR1|signal USR2|signal TERM|replace-unit COMMAND|stop-unit|unit-name}\n' "${0##*/}" >&2
    exit 2
    ;;
esac
