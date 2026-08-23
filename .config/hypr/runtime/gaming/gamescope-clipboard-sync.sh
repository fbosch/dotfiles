#!/usr/bin/env bash

set -euo pipefail

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"

if [[ -z "${XDG_RUNTIME_DIR:-}" || -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
  printf 'gamescope-clipboard-sync: XDG_RUNTIME_DIR and HYPRLAND_INSTANCE_SIGNATURE are required\n' >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$(dirname "$SCRIPT_PATH")/../lib/hypr-ipc.sh"
RUNTIME_DIR="$(hypr_instance_path "gamescope-clipboard-sync")"
LOG_FILE="$RUNTIME_DIR/gamescope-clipboard-sync.log"
LAST_VALUE_FILE="$RUNTIME_DIR/gamescope-wayland-last.txt"

log() {
  printf 'gamescope-clipboard-sync: %s\n' "$1" >> "$LOG_FILE"
}

if [[ "${1:-}" == "--sync-wayland-value" ]]; then
  mkdir -p "$RUNTIME_DIR"
  value="$(cat)"
  [[ -n "$value" ]] || exit 0

  previous_value="$(cat "$LAST_VALUE_FILE" 2>/dev/null || true)"
  if [[ "$value" == "$previous_value" ]]; then
    exit 0
  fi
  last_value_tmp="$(mktemp "$RUNTIME_DIR/gamescope-wayland-last.XXXXXX")"
  printf '%s' "$value" > "$last_value_tmp"
  mv -f "$last_value_tmp" "$LAST_VALUE_FILE"

  declare -A displays=()
  while IFS= read -r line; do
    while [[ "$line" =~ :([0-9]+) ]]; do
      displays[":${BASH_REMATCH[1]}"]=1
      line="${line#*:"${BASH_REMATCH[1]}"}"
    done
  done < <(pgrep -af 'Xwayland.*-terminate.*-force-xrandr-emulation' || true)

  if [[ ${#displays[@]} -eq 0 ]]; then
    log "watch event skipped: no gamescope xwayland displays"
    exit 0
  fi

  for display in "${!displays[@]}"; do
    printf '%s' "$value" | DISPLAY="$display" xclip -selection clipboard -in >/dev/null 2>&1 || true
    printf '%s' "$value" | DISPLAY="$display" xclip -selection primary -in >/dev/null 2>&1 || true
  done

  log "watch event synced bytes=${#value} displays=${#displays[@]}"

  exit 0
fi

LOCK_FILE="$RUNTIME_DIR/gamescope-clipboard-sync.lock"
DISPLAY_CHECK_INTERVAL="${DISPLAY_CHECK_INTERVAL:-5}"

mkdir -p "$RUNTIME_DIR"

if ! command -v flock >/dev/null 2>&1; then
  log "flock not found; exiting"
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

cleanup() {
  if [[ -n "${watch_pid:-}" ]]; then
    kill -TERM "$watch_pid" 2>/dev/null || true
    wait "$watch_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM

if command -v wl-copy >/dev/null 2>&1; then
  :
else
  log "wl-copy not found; exiting"
  exit 0
fi

if command -v wl-paste >/dev/null 2>&1; then
  :
else
  log "wl-paste not found; exiting"
  exit 0
fi

if command -v xclip >/dev/null 2>&1; then
  :
else
  log "xclip not found; exiting"
  exit 0
fi

log "started pid=$$ wayland=${WAYLAND_DISPLAY:-unset} x11=${DISPLAY:-unset}"

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
    log "sync wayland->x11 bytes=${#value}"
  else
    log "sync skipped: no xwayland displays"
  fi
}

while true; do
  if ! has_xwayland_displays; then
    sleep "$DISPLAY_CHECK_INTERVAL"
    continue
  fi

  log "active"
  initial_wayland_value="$(read_wayland_clipboard)"
  sync_wayland_value_to_x11 "$initial_wayland_value"

  wl-paste --type text --watch bash "$SCRIPT_PATH" --sync-wayland-value 9>&- >/dev/null 2>&1 &
  watch_pid=$!

  while kill -0 "$watch_pid" 2>/dev/null; do
    if ! has_xwayland_displays; then
      log "paused: no xwayland displays"
      kill -TERM "$watch_pid" 2>/dev/null || true
      wait "$watch_pid" 2>/dev/null || true
      watch_pid=""
      break
    fi

    sleep "$DISPLAY_CHECK_INTERVAL"
  done

  if [[ -n "${watch_pid:-}" ]]; then
    wait "$watch_pid" 2>/dev/null || true
    watch_pid=""
  fi
done
