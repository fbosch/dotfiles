#!/usr/bin/env bash

set -euo pipefail

have() {
  command -v "$1" >/dev/null 2>&1
}

list_gamescope_displays() {
  declare -A displays=()
  local line

  while IFS= read -r line; do
    while [[ "$line" =~ :([0-9]+) ]]; do
      displays[":${BASH_REMATCH[1]}"]=1
      line="${line#*:"${BASH_REMATCH[1]}"}"
    done
  done < <(pgrep -af 'Xwayland.*-terminate.*-force-xrandr-emulation' || true)

  if [[ ${#displays[@]} -eq 0 ]]; then
    return 1
  fi

  printf '%s\n' "${!displays[@]}"
}

sync_text_to_gamescope_clipboards() {
  local text="$1"
  local display

  while IFS= read -r display; do
    [[ -n "$display" ]] || continue
    printf '%s' "$text" | DISPLAY="$display" xclip -selection clipboard -in >/dev/null 2>&1 || true
    printf '%s' "$text" | DISPLAY="$display" xclip -selection primary -in >/dev/null 2>&1 || true
  done < <(list_gamescope_displays)
}

paste_into_latest_gamescope_window() {
  local latest_display

  latest_display="$(list_gamescope_displays | sort -V | tail -n 1)"
  [[ -n "$latest_display" ]] || return 1

  if have xdotool; then
    DISPLAY="$latest_display" xdotool key --clearmodifiers ctrl+v >/dev/null 2>&1 || true
  fi
}

have wl-paste || exit 0
have xclip || exit 0

clipboard_text="$(wl-paste --no-newline --type text/plain 2>/dev/null || true)"
[[ -n "$clipboard_text" ]] || exit 0

sync_text_to_gamescope_clipboards "$clipboard_text"
paste_into_latest_gamescope_window
