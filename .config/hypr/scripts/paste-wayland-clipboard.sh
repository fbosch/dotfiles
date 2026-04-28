#!/usr/bin/env bash

set -euo pipefail

LOG_FILE="/tmp/hyprland-paste.log"

list_gamescope_display() {
  local line

  while IFS= read -r line; do
    if [[ "$line" =~ :([0-9]+) ]]; then
      printf ':%s\n' "${BASH_REMATCH[1]}"
      return 0
    fi
  done < <(pgrep -af 'Xwayland.*-terminate.*-force-xrandr-emulation' || true)

  return 1
}

if command -v wl-paste >/dev/null 2>&1; then
  :
else
  exit 0
fi

if command -v wtype >/dev/null 2>&1; then
  :
else
  exit 0
fi

active_class="$(hyprctl activewindow -j | jq -r '.class // .initialClass // empty' 2>/dev/null || true)"
if [[ "$active_class" != "gamescope" ]]; then
  hyprctl dispatch sendshortcut CTRL,V,activewindow >/dev/null 2>&1 || true
  exit 0
fi

clipboard_text="$(wl-paste --no-newline --type text/plain 2>/dev/null || wl-paste --no-newline 2>/dev/null || true)"

if [[ -z "$clipboard_text" ]]; then
  exit 0
fi

echo "paste hotkey triggered" >> "$LOG_FILE"

gamescope_display="$(list_gamescope_display || true)"
if [[ -n "$gamescope_display" ]] && command -v xdotool >/dev/null 2>&1; then
  printf '%s' "$clipboard_text" | DISPLAY="$gamescope_display" xclip -selection clipboard -in >/dev/null 2>&1 || true
  printf '%s' "$clipboard_text" | DISPLAY="$gamescope_display" xclip -selection primary -in >/dev/null 2>&1 || true
  DISPLAY="$gamescope_display" xdotool key --clearmodifiers ctrl+v >/dev/null 2>&1 || true
  echo "pasted via xclip+xdotool key on $gamescope_display" >> "$LOG_FILE"
  exit 0
fi

hyprctl dispatch sendshortcut CTRL,V,activewindow >/dev/null 2>&1 || true
echo "pasted via sendshortcut fallback" >> "$LOG_FILE"
