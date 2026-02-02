#!/usr/bin/env bash
# Smart waybar toggle that checks cursor position
# Only hides waybar if cursor is NOT in the waybar area

# shellcheck disable=SC1091
# Source shared library
source "$(dirname "$0")/waybar-lib.sh"

# Get monitor height and cursor position
monitor_height=$(hyprctl monitors -j 2>/dev/null | jq -r '.[0].height')
cursor_y=$(hyprctl cursorpos 2>/dev/null | cut -d',' -f2 | tr -d ' ')

# Calculate distance from bottom
distance_from_bottom=$((monitor_height - cursor_y))

# Check if waybar should stay visible
if should_waybar_stay_visible "$distance_from_bottom" 60; then
    # Debug: log the decision
    echo "$(date): distance=$distance_from_bottom, menu_visible=$START_MENU_VISIBLE, swaync_visible=$SWAYNC_VISIBLE, will_hide=no" >> /tmp/waybar-debug.log
    exit 0
else
    # Cursor is away from waybar and both menus are closed - toggle it (hide)
    echo "$(date): distance=$distance_from_bottom, menu_visible=$START_MENU_VISIBLE, swaync_visible=$SWAYNC_VISIBLE, will_hide=yes" >> /tmp/waybar-debug.log
    echo "$(date): HIDING WAYBAR" >> /tmp/waybar-debug.log
    pkill -SIGUSR2 waybar
fi
