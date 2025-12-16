#!/bin/bash
# Auto-hide waybar when mouse moves away from the bottom edge

# Kill any existing instance of this script
pkill -f "waybar-autohide.sh" -o $$

# Wait for mouse to move away from bottom edge (y < screen_height - waybar_height)
# Check every 100ms for 10 seconds max
for i in {1..100}; do
    # Get cursor position using hyprctl
    cursor_y=$(hyprctl cursorpos | cut -d',' -f2 | tr -d ' ')
    
    # Get monitor height
    monitor_height=$(hyprctl monitors -j | jq -r '.[0].height')
    
    # If cursor moved up from bottom (more than 60px from bottom edge), hide waybar
    if [ "$cursor_y" -lt $((monitor_height - 60)) ]; then
        pkill -SIGUSR2 waybar
        exit 0
    fi
    
    sleep 0.1
done

# Timeout after 10 seconds - hide anyway
pkill -SIGUSR2 waybar
