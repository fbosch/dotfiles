#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_dir="$(mktemp -d)"
bin_dir="$test_dir/bin"
home_dir="$test_dir/home"
original_path="$PATH"

cleanup() {
  rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir -p "$bin_dir" "$home_dir/.config/hypr/runtime/desktop" "$home_dir/.config/hypr/runtime/profiles"

write_stub() {
  local name="$1"
  # shellcheck disable=SC2016
  printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "${0##*/}" "$*" >> "$FIXTURE_LOG"' 'exit 0' > "$bin_dir/$name"
  chmod +x "$bin_dir/$name"
}

write_stub hyprctl
write_stub systemctl
write_stub pkill
write_stub uwsm-app
write_stub swaync-client
write_stub notify-send
write_stub ps
# shellcheck disable=SC2016
printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "${0##*/}" "$*" >> "$FIXTURE_LOG"' 'exit 1' > "$bin_dir/pgrep"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$bin_dir/sleep"
printf '%s\n' '#!/bin/sh' 'printf "%s\n" fixture-icon' > "$home_dir/.config/hypr/runtime/desktop/nerd-icon-gen.sh"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"
chmod +x "$bin_dir/pgrep" "$bin_dir/sleep" "$home_dir/.config/hypr/runtime/desktop/nerd-icon-gen.sh" \
  "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"

assert_contains() {
  local file="$1" expected="$2"
  if ! grep -Fqx "$expected" "$file"; then
    printf 'missing log entry: %s\n' "$expected" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1" expected="$2"
  if grep -Fq "$expected" "$file"; then
    printf 'unexpected log entry: %s\n' "$expected" >&2
    exit 1
  fi
}

wait_for_log_count() {
  local file="$1" prefix="$2" expected="$3" attempts=0 count
  while (( attempts < 100 )); do
    count="$(grep -c "^$prefix" "$file" 2>/dev/null || true)"
    if (( count >= expected )); then
      return 0
    fi

    attempts=$((attempts + 1))
    /bin/sleep 0.01
  done

  printf 'timed out waiting for %s %s entries in %s\n' "$expected" "$prefix" "$file" >&2
  return 1
}

export HOME="$home_dir"
export PATH="$bin_dir:$original_path"

restart_log="$test_dir/restart.log"
FIXTURE_LOG="$restart_log" "$repo_root/runtime/desktop/restart-daemons.sh"
# The recovery script intentionally launches replacements in the background.
# Wait for every launcher stub before assertions or fixture cleanup can race it.
wait_for_log_count "$restart_log" uwsm-app 15
assert_contains "$restart_log" 'pkill -f minimized-state-daemon'
assert_contains "$restart_log" 'pkill -f gaming-session-watchdog'
assert_contains "$restart_log" 'pgrep -f minimized-state-daemon\.(sh|lua)'
assert_contains "$restart_log" 'pgrep -f gaming-session-watchdog\.(sh|lua)'
assert_contains "$restart_log" "uwsm-app -s b -- $home_dir/.config/hypr/runtime/windows/daemons/minimized-state/minimized-state-daemon.sh"
assert_contains "$restart_log" "uwsm-app -s b -- $home_dir/.config/hypr/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.sh"
assert_contains "$restart_log" 'uwsm-app -s s -- atuin daemon start'
assert_not_contains "$restart_log" 'pkill -f custom-layout-drag-resize'
assert_not_contains "$restart_log" 'pkill -f gamescope-clipboard-sync'

# Make every normal shutdown probe take one second. The hyprpaper probe reports
# a zombie; it must be ignored. Parallel waits keep reset below three seconds;
# serial waits would take at least six seconds.
# shellcheck disable=SC2016
printf '%s\n' '#!/bin/sh' 'if [ "$1" = "-x" ] && [ "$2" = "hyprpaper" ]; then printf "4242\n"; fi' '/bin/sleep 1' 'printf "%s %s\n" "${0##*/}" "$*" >> "$FIXTURE_LOG"' 'if [ "$1" = "-x" ] && [ "$2" = "hyprpaper" ]; then exit 0; fi' 'exit 1' > "$bin_dir/pgrep"
# shellcheck disable=SC2016
printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "${0##*/}" "$*" >> "$FIXTURE_LOG"' 'printf "Z\n"' 'exit 0' > "$bin_dir/ps"

reset_log="$test_dir/reset.log"
SECONDS=0
FIXTURE_LOG="$reset_log" "$repo_root/runtime/desktop/reset-desktop.sh"
if (( SECONDS > 2 )); then
  printf 'reset-desktop shutdown waits ran serially (%ss)\n' "$SECONDS" >&2
  exit 1
fi
wait_for_log_count "$reset_log" uwsm-app 8
wait_for_log_count "$reset_log" swaync-client 2
assert_contains "$reset_log" 'pkill -f custom-layout-drag-resize.sh daemon'
assert_contains "$reset_log" 'pkill -f custom-layout-drag-resize-daemon.lua'
assert_contains "$reset_log" 'pgrep -f custom-layout-drag-resize(-daemon)?\.(sh|lua)'
assert_contains "$reset_log" 'pgrep -x waybar'
assert_contains "$reset_log" 'pgrep -x hyprpaper'
assert_contains "$reset_log" 'ps -o stat= -p 4242'
assert_contains "$reset_log" 'pkill -CONT -f window-capture-daemon'
assert_contains "$reset_log" 'uwsm-app -s s -- hyprpaper'
assert_contains "$reset_log" "uwsm-app -s b -- $home_dir/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh daemon"
assert_not_contains "$reset_log" 'pkill -f minimized-state-daemon'
assert_not_contains "$reset_log" 'pkill -f gaming-session-watchdog'

printf 'PASS lifecycle recovery uses documented daemon subsets\n'
