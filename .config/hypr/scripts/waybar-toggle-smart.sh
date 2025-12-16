#!/usr/bin/env bash
# Smart waybar toggle that checks cursor position
# Only hides waybar if cursor is NOT in the waybar area

# Get monitor height and cursor position
monitor_height=$(hyprctl monitors -j 2>/dev/null | jq -r '.[0].height')
cursor_y=$(hyprctl cursorpos 2>/dev/null | cut -d',' -f2 | tr -d ' ')

# Waybar configuration
WAYBAR_HEIGHT=45
WAYBAR_START=$((monitor_height - WAYBAR_HEIGHT))

# Calculate if cursor is in waybar area (within 60px of bottom for some margin)
distance_from_bottom=$((monitor_height - cursor_y))

# If cursor is in waybar area (within 60px of bottom), don't hide
if [ "$distance_from_bottom" -le 60 ]; then
    # Cursor is near/in waybar - do nothing (keep it visible)
    exit 0
else
    # Cursor is away from waybar - toggle it (hide)
    pkill -SIGUSR2 waybar
fi
