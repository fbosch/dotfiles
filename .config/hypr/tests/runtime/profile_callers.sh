#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

assert_contains() {
  local file="$1" expected="$2"

  grep -Fq -- "$expected" "$file" || {
    printf 'missing %s in %s\n' "$expected" "$file" >&2
    exit 1
  }
}

assert_not_contains() {
  local file="$1" unexpected="$2"

  if grep -Fq -- "$unexpected" "$file"; then
    printf 'unexpected %s in %s\n' "$unexpected" "$file" >&2
    exit 1
  fi
}

watchdog="$repo_root/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.lua"
watchdog_launcher="$repo_root/runtime/gaming/daemons/gaming-session-watchdog/gaming-session-watchdog.sh"
gaming_toggle="$repo_root/runtime/profiles/toggle-gaming-mode.sh"
powersave_action="$repo_root/actions/toggle-powersave-mode.lua"
keybinds="$repo_root/keybinds.lua"
test_dir="$(mktemp -d)"
home_dir="$test_dir/home"
bin_dir="$test_dir/bin"

cleanup() {
  rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir -p "$home_dir/.config/hypr/runtime/desktop" "$home_dir/.config/hypr/runtime/profiles" "$bin_dir"
# shellcheck disable=SC2016
printf '%s\n' '#!/bin/sh' 'if [ "$1" = status ]; then printf "%s" "$PROFILE_STATE"; exit 0; fi' 'printf "%s\n" "$*" >> "$PROFILE_LOG"' > "$home_dir/.config/hypr/runtime/profiles/profilectl.sh"
# shellcheck disable=SC2016
printf '%s\n' '#!/bin/sh' 'exit 0' > "$home_dir/.config/hypr/runtime/desktop/nerd-icon-gen.sh"
# shellcheck disable=SC2016
printf '%s\n' '#!/bin/sh' 'exit 0' > "$bin_dir/notify-send"
chmod +x "$home_dir/.config/hypr/runtime/profiles/profilectl.sh" "$home_dir/.config/hypr/runtime/desktop/nerd-icon-gen.sh" "$bin_dir/notify-send"

assert_toggle() {
  local script="$1" state="$2" expected="$3"

  PROFILE_STATE="$state" PROFILE_LOG="$test_dir/profile.log" HOME="$home_dir" PATH="$bin_dir:$PATH" dash "$script"
  assert_contains "$test_dir/profile.log" "$expected"
  : > "$test_dir/profile.log"
}

assert_contains "$watchdog" 'sync-source gaming watchdog'
assert_contains "$watchdog_launcher" 'sync-source gaming watchdog 0'
assert_contains "$gaming_toggle" 'status --json'
assert_contains "$gaming_toggle" 'clear-manual'
assert_contains "$gaming_toggle" 'set-manual'
assert_not_contains "$gaming_toggle" 'apply-source'
assert_not_contains "$gaming_toggle" 'remove-source'
assert_not_contains "$gaming_toggle" 'is-source-active'
assert_contains "$powersave_action" 'profile_state.read'
assert_contains "$powersave_action" 'clear-manual'
assert_contains "$powersave_action" 'set-manual'
assert_contains "$keybinds" 'toggle_powersave_mode.toggle_powersave_mode'
assert_not_contains "$keybinds" 'toggle-powersave-mode.sh'

: > "$test_dir/profile.log"
auto_gaming='{"generation":1,"selection":"auto","resolved":"gaming","sources":{"gaming":{"watchdog":1},"powersave":{}}}'
manual_gaming='{"generation":1,"selection":"gaming","resolved":"gaming","sources":{"gaming":{"watchdog":1},"powersave":{}}}'
assert_toggle "$gaming_toggle" "$auto_gaming" 'set-manual gaming'
assert_toggle "$gaming_toggle" "$manual_gaming" 'clear-manual'

printf 'PASS profile callers use the explicit controller contract\n'
