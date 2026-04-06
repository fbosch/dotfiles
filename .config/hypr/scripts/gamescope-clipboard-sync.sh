#!/usr/bin/env bash

set -euo pipefail

LOCK_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-clipboard/gamescope-clipboard-sync.lockdir"
LOG_FILE="/tmp/hyprland-clipboard.log"
POLL_SECONDS=0.4

mkdir -p "$(dirname "$LOCK_DIR")"
if mkdir "$LOCK_DIR" 2>/dev/null; then
  :
else
  exit 0
fi

cleanup() {
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

if command -v wl-copy >/dev/null 2>&1; then
  :
else
  echo "wl-copy not found; exiting gamescope clipboard sync" >> "$LOG_FILE"
  exit 0
fi

if command -v wl-paste >/dev/null 2>&1; then
  :
else
  echo "wl-paste not found; exiting gamescope clipboard sync" >> "$LOG_FILE"
  exit 0
fi

if command -v xclip >/dev/null 2>&1; then
  :
else
  echo "xclip not found; exiting gamescope clipboard sync" >> "$LOG_FILE"
  exit 0
fi

echo "gamescope clipboard sync started (pid=$$, wayland=${WAYLAND_DISPLAY:-unset}, x11=${DISPLAY:-unset})" >> "$LOG_FILE"

declare -A last_written_to_display=()
last_wayland_value=""

list_xwayland_displays() {
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

  printf '%s\n' "${!displays[@]}"
}

read_wayland_clipboard() {
  wl-paste --no-newline --type text/plain 2>/dev/null || true
}

write_wayland_clipboard() {
  local value="$1"

  printf '%s' "$value" | wl-copy >/dev/null 2>&1 || true
  printf '%s' "$value" | wl-copy --primary >/dev/null 2>&1 || true
}

read_x11_clipboard() {
  local display="$1"
  DISPLAY="$display" xclip -selection clipboard -o 2>/dev/null || true
}

write_x11_clipboard() {
  local display="$1"
  local value="$2"

  printf '%s' "$value" | DISPLAY="$display" xclip -selection clipboard -in >/dev/null 2>&1 || true
  printf '%s' "$value" | DISPLAY="$display" xclip -selection primary -in >/dev/null 2>&1 || true
}

while true; do
  wayland_value="$(read_wayland_clipboard)"

  if [[ -n "$wayland_value" ]] && [[ "$wayland_value" != "$last_wayland_value" ]]; then
    while IFS= read -r display; do
      [[ -n "$display" ]] || continue
      write_x11_clipboard "$display" "$wayland_value"
      last_written_to_display["$display"]="$wayland_value"
    done < <(list_xwayland_displays)

    last_wayland_value="$wayland_value"
  fi

  while IFS= read -r display; do
    [[ -n "$display" ]] || continue

    x11_value="$(read_x11_clipboard "$display")"
    if [[ -z "$x11_value" ]]; then
      continue
    fi

    if [[ "${last_written_to_display[$display]:-}" == "$x11_value" ]]; then
      continue
    fi

    if [[ "$x11_value" == "$last_wayland_value" ]]; then
      continue
    fi

    write_wayland_clipboard "$x11_value"
    last_wayland_value="$x11_value"

    while IFS= read -r other_display; do
      [[ -n "$other_display" ]] || continue
      write_x11_clipboard "$other_display" "$x11_value"
      last_written_to_display["$other_display"]="$x11_value"
    done < <(list_xwayland_displays)
  done < <(list_xwayland_displays)

  sleep "$POLL_SECONDS"
done
