#!/usr/bin/env bash

set -euo pipefail

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"

if [[ "${1:-}" == "--sync-wayland-value" ]]; then
  LOG_FILE="/tmp/hyprland-clipboard.log"
  RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-clipboard"
  LAST_VALUE_FILE="$RUNTIME_DIR/gamescope-wayland-last.txt"

  mkdir -p "$RUNTIME_DIR"
  value="$(cat)"
  [[ -n "$value" ]] || exit 0

  previous_value="$(cat "$LAST_VALUE_FILE" 2>/dev/null || true)"
  if [[ "$value" == "$previous_value" ]]; then
    exit 0
  fi
  printf '%s' "$value" > "$LAST_VALUE_FILE"

  declare -A displays=()
  while IFS= read -r line; do
    while [[ "$line" =~ :([0-9]+) ]]; do
      displays[":${BASH_REMATCH[1]}"]=1
      line="${line#*:"${BASH_REMATCH[1]}"}"
    done
  done < <(pgrep -af 'Xwayland.*-terminate.*-force-xrandr-emulation' || true)

  if [[ ${#displays[@]} -eq 0 ]]; then
    echo "watch event skipped: no gamescope xwayland displays" >> "$LOG_FILE"
    exit 0
  fi

  for display in "${!displays[@]}"; do
    printf '%s' "$value" | DISPLAY="$display" xclip -selection clipboard -in >/dev/null 2>&1 || true
    printf '%s' "$value" | DISPLAY="$display" xclip -selection primary -in >/dev/null 2>&1 || true
  done

  echo "watch event synced bytes=${#value} displays=${#displays[@]}" >> "$LOG_FILE"

  exit 0
fi

LOCK_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-clipboard/gamescope-clipboard-sync.lockdir"
LOG_FILE="/tmp/hyprland-clipboard.log"
DISPLAY_CHECK_INTERVAL="${DISPLAY_CHECK_INTERVAL:-5}"

mkdir -p "$(dirname "$LOCK_DIR")"

if mkdir "$LOCK_DIR" 2>/dev/null; then
  :
else
  exit 0
fi

cleanup() {
  if [[ -n "${watch_pid:-}" ]]; then
    kill "$watch_pid" 2>/dev/null || true
  fi

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

list_xwayland_displays() {
  declare -A displays=()
  local line

  while IFS= read -r line; do
    while [[ "$line" =~ :([0-9]+) ]]; do
      displays[":${BASH_REMATCH[1]}"]=1
      line="${line#*:"${BASH_REMATCH[1]}"}"
    done
  done < <(pgrep -af 'Xwayland.*-terminate.*-force-xrandr-emulation' || true)

  printf '%s\n' "${!displays[@]}"
}

has_xwayland_displays() {
  [[ -n "$(list_xwayland_displays)" ]]
}

read_wayland_clipboard() {
  wl-paste --no-newline --type text 2>/dev/null || true
}

write_x11_clipboard() {
  local display="$1"
  local value="$2"

  printf '%s' "$value" | DISPLAY="$display" xclip -selection clipboard -in >/dev/null 2>&1 || true
  printf '%s' "$value" | DISPLAY="$display" xclip -selection primary -in >/dev/null 2>&1 || true
}

sync_wayland_value_to_x11() {
  local value="$1"
  local wrote=0

  if [[ -z "$value" ]]; then
    return
  fi

  while IFS= read -r display; do
    [[ -n "$display" ]] || continue
    write_x11_clipboard "$display" "$value"
    wrote=1
  done < <(list_xwayland_displays)

  if [[ $wrote -eq 1 ]]; then
    echo "sync wayland->x11 bytes=${#value}" >> "$LOG_FILE"
  else
    echo "sync skipped: no xwayland displays" >> "$LOG_FILE"
  fi
}

while true; do
  if ! has_xwayland_displays; then
    sleep "$DISPLAY_CHECK_INTERVAL"
    continue
  fi

  echo "gamescope clipboard sync active" >> "$LOG_FILE"
  initial_wayland_value="$(read_wayland_clipboard)"
  sync_wayland_value_to_x11 "$initial_wayland_value"

  wl-paste --type text --watch bash "$SCRIPT_PATH" --sync-wayland-value >/dev/null 2>&1 &
  watch_pid=$!

  while kill -0 "$watch_pid" 2>/dev/null; do
    if ! has_xwayland_displays; then
      echo "gamescope clipboard sync paused: no xwayland displays" >> "$LOG_FILE"
      kill "$watch_pid" 2>/dev/null || true
      wait "$watch_pid" 2>/dev/null || true
      watch_pid=""
      break
    fi

    sleep "$DISPLAY_CHECK_INTERVAL"
  done
done
