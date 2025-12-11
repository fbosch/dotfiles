#!/usr/bin/env bash
# Show AGS confirmation dialog before exiting Hyprland
# Sends request directly to the AGS confirm-dialog daemon

ags request -i confirm-dialog-daemon '{
  "action": "show",
  "config": {
    "icon": "⚠",
    "title": "Exit Hyprland",
    "message": "This will end your Wayland session",
    "confirmLabel": "Exit",
    "cancelLabel": "Cancel",
    "confirmCommand": "uwsm stop",
    "variant": "danger"
  }
}'
