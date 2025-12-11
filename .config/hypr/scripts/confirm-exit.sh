#!/usr/bin/env bash
# Show AGS confirmation dialog before exiting Hyprland

# Use the daemon approach for instant launch via AGS request
~/.config/hypr/scripts/confirm-dialog-show.sh \
    --icon "⚠" \
    --title "Exit Hyprland" \
    --message "This will end your Wayland session" \
    --confirm-label "Exit" \
    --cancel-label "Cancel" \
    --confirm-command "uwsm stop" \
    --variant "danger"
