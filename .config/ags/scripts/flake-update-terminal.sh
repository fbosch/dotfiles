#!/usr/bin/env bash

set -euo pipefail

class_name="flake_update_terminal"
lock_file="/tmp/flake-update-terminal.lock"

exec 9>"$lock_file"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
fi

find_existing_window_address() {
  if command -v hyprctl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    hyprctl clients -j 2>/dev/null | jq -r --arg class "$class_name" 'first(.[] | select(.class == $class) | .address) // empty'
    return
  fi

  printf '%s' ""
}

launch_update_terminal() {
  if footclient -N -a "$class_name" fish -c 'flake_update_interactive --rebuild --cache --header --notify' >/dev/null 2>&1; then
    return
  fi

  foot -a "$class_name" fish -c 'flake_update_interactive --rebuild --cache --header --notify' >/dev/null 2>&1 &
}

if command -v footclient >/dev/null 2>&1 && command -v fish >/dev/null 2>&1; then
  address="$(find_existing_window_address)"
  if [[ -n "$address" ]]; then
    hyprctl dispatch focuswindow "address:$address" >/dev/null 2>&1 || true
    exit 0
  fi

  launch_update_terminal
  exit 0
fi

exit 1
