#!/usr/bin/env bash
# Monitor mouse position and show/hide waybar based on screen edge proximity
# Adaptive polling for efficiency

WAYBAR_HEIGHT=45       # Height of waybar in pixels
SHOW_THRESHOLD=25      # Distance from bottom to trigger show (should be >= half waybar height)
HIDE_THRESHOLD=60      # Distance from bottom before hiding (waybar height + margin)
FAST_CHECK=0.05        # Fast polling when waybar visible or near edge (50ms)
SLOW_CHECK=0.3         # Slow polling when far from edge (300ms)

# Get monitor height once at startup
monitor_height=$(hyprctl monitors -j 2>/dev/null | jq -r '.[0].height')

# Track waybar state
waybar_visible=false

while true; do
    # Get cursor Y position
    cursor_y=$(hyprctl cursorpos 2>/dev/null | cut -d',' -f2 | tr -d ' ')
    
    if [ -z "$cursor_y" ]; then
        sleep "$SLOW_CHECK"
        continue
    fi
    
    # Calculate distance from bottom
    distance_from_bottom=$((monitor_height - cursor_y))
    
    # Show waybar if cursor is close to bottom edge
    if [ "$distance_from_bottom" -le "$SHOW_THRESHOLD" ] && [ "$waybar_visible" = false ]; then
        pkill -SIGUSR1 waybar
        waybar_visible=true
    fi
    
    # Hide waybar only if cursor moves away from the entire waybar area
    if [ "$waybar_visible" = true ]; then
        # Use fast polling while waybar is visible for responsive hiding
        check_interval="$FAST_CHECK"
        
        # Hide if cursor is far enough away
        if [ "$distance_from_bottom" -gt "$HIDE_THRESHOLD" ]; then
            pkill -SIGUSR2 waybar
            waybar_visible=false
        fi
    else
        # Adaptive polling when waybar is hidden
        if [ "$distance_from_bottom" -le "$((HIDE_THRESHOLD + 50))" ]; then
            check_interval="$FAST_CHECK"
        else
            check_interval="$SLOW_CHECK"
        fi
    fi
    
    sleep "$check_interval"
done
