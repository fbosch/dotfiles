#!/usr/bin/env dash
# Show AGS confirmation dialog before exiting Hyprland
# Sends request directly to the AGS confirm-dialog daemon
# Audio and duplicate prevention handled by AGS component

ags request -i ags-bundled confirm-dialog '{
  "action": "show",
  "config": {
    "icon": "󰿅",
    "title": "Exit Hyprland",
    "message": "This will end your Wayland session",
    "confirmLabel": "Exit",
    "cancelLabel": "Cancel",
    "operation": { "type": "exit-session" },
    "variant": "danger",
    "playWarningSound": true,
    "showDelay": 180
  }
}'
