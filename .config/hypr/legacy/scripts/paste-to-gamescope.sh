#!/usr/bin/env bash

set -euo pipefail

have() {
  command -v "$1" >/dev/null 2>&1
}

using_wl_clipboard_wrapper() {
  xclip -version 2>&1 | grep -qi 'wl-clipboard-x11'
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
    while IFS= read -r line; do
      while [[ "$line" =~ :([0-9]+) ]]; do
        displays[":${BASH_REMATCH[1]}"]=1
        line="${line#*:"${BASH_REMATCH[1]}"}"
      done
    done < <(pgrep -af 'Xwayland' || true)
  fi

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

have wl-paste || exit 0
have xclip || exit 0
using_wl_clipboard_wrapper && exit 1

clipboard_text="$(wl-paste --no-newline --type text/plain 2>/dev/null || true)"
if [[ -z "$clipboard_text" ]]; then
  clipboard_text="$(wl-paste --no-newline --type text 2>/dev/null || true)"
fi
[[ -n "$clipboard_text" ]] || exit 0

sync_text_to_gamescope_clipboards "$clipboard_text"
