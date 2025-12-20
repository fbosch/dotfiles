#!/usr/bin/env bash
# Smart waybar toggle that checks cursor position
# Only hides waybar if cursor is NOT in the waybar area

# Get monitor height and cursor position
monitor_height=$(hyprctl monitors -j 2>/dev/null | jq -r '.[0].height')
cursor_y=$(hyprctl cursorpos 2>/dev/null | cut -d',' -f2 | tr -d ' ')

# Waybar configuration
WAYBAR_HEIGHT=30
WAYBAR_START=$((monitor_height - WAYBAR_HEIGHT))

# Calculate if cursor is in waybar area (within 60px of bottom for some margin)
distance_from_bottom=$((monitor_height - cursor_y))

# Check if start menu is currently visible
start_menu_visible=$(ags request -i start-menu-daemon '{"action":"is-visible"}' 2>/dev/null || echo "false")

# Check if SwayNC notification center is currently visible (via DBus)
swaync_visible=$(busctl --user call org.erikreider.swaync.cc /org/erikreider/swaync/cc org.erikreider.swaync.cc GetVisibility 2>/dev/null | awk '{print $2}' || echo "false")

# Debug: log the decision
echo "$(date): distance=$distance_from_bottom, menu_visible=$start_menu_visible, swaync_visible=$swaync_visible, will_hide=$([ "$distance_from_bottom" -le 60 ] || [ "$start_menu_visible" = "true" ] || [ "$swaync_visible" = "true" ] && echo "no" || echo "yes")" >> /tmp/waybar-debug.log

# If cursor is in waybar area OR start menu is visible OR swaync is visible, don't hide
if [ "$distance_from_bottom" -le 60 ] || [ "$start_menu_visible" = "true" ] || [ "$swaync_visible" = "true" ]; then
    # Cursor is near/in waybar OR start menu is open OR swaync is open - keep waybar visible
    exit 0
else
    # Cursor is away from waybar and both menus are closed - toggle it (hide)
    echo "$(date): HIDING WAYBAR" >> /tmp/waybar-debug.log
    pkill -SIGUSR2 waybar
fi
