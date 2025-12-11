#!/usr/bin/env bash
# Show AGS confirmation dialog before exiting Hyprland

# Check if AGS confirm dialog is already running
if ags list | grep -q "confirm-exit"; then
    # Dialog already open, do nothing
    exit 0
fi

# Launch AGS confirmation dialog with uwsm stop parameters
ags run ~/.config/ags/confirm-exit.tsx -- \
    --icon "⚠" \
    --title "Exit Hyprland" \
    --message "This will end your Wayland session" \
    --confirm-label "Exit" \
    --cancel-label "Cancel" \
    --confirm-command "uwsm stop" \
    --variant "danger"
