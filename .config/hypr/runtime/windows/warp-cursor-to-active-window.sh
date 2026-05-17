#!/usr/bin/env dash
set -eu

delay="${1:-0}"
if [ "$delay" != "0" ]; then
  sleep "$delay"
fi

socket_path="${XDG_RUNTIME_DIR:-}/hypr/${HYPRLAND_INSTANCE_SIGNATURE:-}/.socket.sock"

use_socket=false
if [ -S "$socket_path" ] && command -v nc >/dev/null 2>&1; then
  use_socket=true
  window_json="$(printf 'j/activewindow' | nc -U "$socket_path" 2>/dev/null || true)"
else
  window_json="$(hyprctl activewindow -j 2>/dev/null || true)"
fi

if [ -z "$window_json" ]; then
  exit 0
fi

geometry="$(printf '%s\n' "$window_json" | jq -r 'select(.mapped == true) | [.at[0], .at[1], .size[0], .size[1]] | @tsv')"
set -- $geometry

if [ "$#" -ne 4 ]; then
  exit 0
fi

x="$1"
y="$2"
width="$3"
height="$4"

cursor_x=$((x + width / 2))
cursor_y=$((y + height / 2))

dispatch="hl.dsp.cursor.move({ x = $cursor_x, y = $cursor_y })"
if [ "$use_socket" = true ]; then
  printf 'dispatch %s' "$dispatch" | nc -U "$socket_path" >/dev/null 2>&1 || true
else
  hyprctl dispatch "$dispatch" >/dev/null
fi
