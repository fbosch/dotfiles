#!/usr/bin/env bash

set -euo pipefail

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"

if [[ "${1:-}" == "--emit-wayland-event" ]]; then
  fifo_path="${2:-}"
  if [[ -z "$fifo_path" ]]; then
    exit 1
  fi

  value="$(cat)"
  payload="$(printf '%s' "$value" | base64 -w0)"
  printf 'wayland\t%s\n' "$payload" > "$fifo_path"
  exit 0
fi

LOCK_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-clipboard/gamescope-clipboard-sync.lockdir"
LOG_FILE="/tmp/hyprland-clipboard.log"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/hypr-clipboard"
EVENT_FIFO="$RUNTIME_DIR/gamescope-clipboard-sync.events"

mkdir -p "$RUNTIME_DIR"
if mkdir "$LOCK_DIR" 2>/dev/null; then
  :
else
  exit 0
fi

cleanup() {
  if [[ -n "${watch_pid:-}" ]]; then
    kill "$watch_pid" 2>/dev/null || true
  fi

  rm -f "$EVENT_FIFO"
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

sync_wayland_value_to_x11() {
  local value="$1"

  if [[ -z "$value" ]]; then
    return
  fi

  while IFS= read -r display; do
    [[ -n "$display" ]] || continue
    write_x11_clipboard "$display" "$value"
  done < <(list_xwayland_displays)
}

rm -f "$EVENT_FIFO"
mkfifo "$EVENT_FIFO"

initial_wayland_value="$(read_wayland_clipboard)"
sync_wayland_value_to_x11 "$initial_wayland_value"

wl-paste --type text/plain --watch "$SCRIPT_PATH" --emit-wayland-event "$EVENT_FIFO" >/dev/null 2>&1 &
watch_pid=$!

while IFS=$'\t' read -r source payload; do
  if [[ "$source" != "wayland" ]]; then
    continue
  fi

  value="$(printf '%s' "$payload" | base64 -d 2>/dev/null || true)"
  sync_wayland_value_to_x11 "$value"
done < "$EVENT_FIFO"
