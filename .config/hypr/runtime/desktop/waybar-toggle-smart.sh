#!/usr/bin/env dash
# Smart waybar toggle that checks cursor position
# Only hides waybar if cursor is NOT in the waybar area

# shellcheck disable=SC1091
# Source shared library
. "$(dirname "$0")/waybar-lib.sh"

# Get monitor height and cursor position
monitor_height=$(hyprctl monitors -j 2>/dev/null | jq -r '.[0].height')
cursor_pos=$(hyprctl cursorpos 2>/dev/null)
IFS=', ' read -r _ cursor_y <<EOF
$cursor_pos
EOF

# Calculate distance from bottom
distance_from_bottom=$((monitor_height - cursor_y))

# Check if waybar should stay visible
if should_waybar_stay_visible "$distance_from_bottom" 60; then
    exit 0
else
    # Cursor is away from waybar and both menus are closed - toggle it (hide)
    pkill -SIGUSR2 waybar
fi
