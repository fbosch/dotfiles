#!/usr/bin/env bash
# Show AGS confirmation dialog before exiting Hyprland

# Check if AGS confirm dialog is already running
if ags list | grep -q "confirm-exit"; then
    # Dialog already open, do nothing
    exit 0
fi

# Launch AGS confirmation dialog
ags run ~/.config/ags/confirm-exit.tsx
