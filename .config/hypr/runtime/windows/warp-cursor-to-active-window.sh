#!/usr/bin/env dash
set -eu

sleep 0.03

window_json="$(hyprctl activewindow -j 2>/dev/null || true)"
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

hyprctl dispatch "hl.dsp.cursor.move({ x = $cursor_x, y = $cursor_y })" >/dev/null
