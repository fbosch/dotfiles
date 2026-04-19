#!/usr/bin/env bash
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
    "confirmCommand": "/home/fbb/.config/hypr/scripts/exit-session.sh",
    "variant": "danger",
    "audioFile": "/home/fbb/.config/hypr/assets/warn.ogg",
    "showDelay": 180
  }
}'
