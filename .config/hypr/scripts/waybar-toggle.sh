#!/usr/bin/env bash
# Toggle waybar visibility and passthrough mode

# Check if waybar is currently visible by checking if it received SIGUSR1 recently
# We'll use a state file to track visibility
STATE_FILE="/tmp/waybar_visible_state"

if [ -f "$STATE_FILE" ]; then
    # Waybar is visible, hide it and enable passthrough
    pkill -SIGUSR2 waybar
    rm "$STATE_FILE"
else
    # Waybar is hidden, show it and disable passthrough
    pkill -SIGUSR1 waybar
    touch "$STATE_FILE"
fi
