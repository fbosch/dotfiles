#!/usr/bin/env dash
set -eu

. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

delay="${1:-0}"
if [ "$delay" != "0" ]; then
  sleep "$delay"
fi

window_info="$(hypr_query 'activewindow' || true)"
if [ -z "$window_info" ]; then
  exit 0
fi

x=""
y=""
width=""
height=""

while IFS= read -r line; do
  case "$line" in
    *at:* )
      geometry="${line#at: }"
      geometry="${geometry#*: }"
      x="${geometry%%,*}"
      y="${geometry#*,}"
      ;;
    *size:* )
      geometry="${line#size: }"
      geometry="${geometry#*: }"
      width="${geometry%%,*}"
      height="${geometry#*,}"
      ;;
  esac
done <<EOF
$window_info
EOF

if [ -z "$x" ] || [ -z "$y" ] || [ -z "$width" ] || [ -z "$height" ]; then
  exit 0
fi

cursor_x=$((x + width / 2))
cursor_y=$((y + height / 2))

dispatch="hl.dsp.cursor.move({ x = $cursor_x, y = $cursor_y })"
hypr_dispatch_lua "$dispatch" || true
