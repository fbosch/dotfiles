#!/usr/bin/env bash

set -euo pipefail

list_gamescope_display() {
  local line
  local best_display=""
  local best_number=-1

  while IFS= read -r line; do
    while [[ "$line" =~ :([0-9]+) ]]; do
      local number="${BASH_REMATCH[1]}"
      if (( number > best_number )); then
        best_number=$number
        best_display=":$number"
      fi
      line="${line#*:"$number"}"
    done
  done < <(pgrep -af 'Xwayland' || true)

  if [[ -n "$best_display" ]]; then
    printf '%s\n' "$best_display"
    return 0
  fi

  return 1
}

if command -v wl-paste >/dev/null 2>&1; then
  :
else
  exit 0
fi

if command -v xclip >/dev/null 2>&1; then
  :
else
  exit 0
fi

clipboard_text="$(wl-paste --no-newline --type text/plain 2>/dev/null || true)"

if [[ -z "$clipboard_text" ]]; then
  exit 0
fi

gamescope_display="$(list_gamescope_display || true)"

if [[ -z "$gamescope_display" ]]; then
  exit 0
fi

if command -v xdotool >/dev/null 2>&1; then
  DISPLAY="$gamescope_display" xdotool type --clearmodifiers --delay 2 -- "$clipboard_text" >/dev/null 2>&1 || true
  exit 0
fi

printf '%s' "$clipboard_text" | DISPLAY="$gamescope_display" xclip -selection clipboard -in >/dev/null 2>&1
printf '%s' "$clipboard_text" | DISPLAY="$gamescope_display" xclip -selection primary -in >/dev/null 2>&1
