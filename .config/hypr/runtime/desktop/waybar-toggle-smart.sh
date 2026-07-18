#!/usr/bin/env dash
# Smart waybar toggle that checks cursor position
# Only hides waybar if cursor is NOT in the waybar area

# shellcheck disable=SC1091
# Source shared library
. "$(dirname "$0")/waybar-lib.sh"
# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

cursor_pos=$(hypr_query 'cursorpos')
IFS=', ' read -r cursor_x cursor_y <<EOF
$cursor_pos
EOF

distance_from_bottom=$(hypr_query 'j/monitors' | jq -r --argjson x "$cursor_x" --argjson y "$cursor_y" '
    map(select($x >= .x and $x < (.x + .width) and $y >= .y and $y < (.y + .height)))
    | first
    | if . == null then -1 else (.height - ($y - .y)) end
')

# Check if waybar should stay visible
if should_waybar_stay_visible "$distance_from_bottom" 60; then
    exit 0
else
    # Cursor is away from waybar and both menus are closed - toggle it (hide)
    pkill -SIGUSR2 waybar
fi
