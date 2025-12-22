#!/usr/bin/env bash
# Show AGS confirmation dialog before shutting down system
# Sends request directly to the AGS confirm-dialog daemon
# Audio and duplicate prevention handled by AGS component

ags request -i ags-bundled confirm-dialog '{
  "action": "show",
  "config": {
    "icon": "󰐥",
    "title": "Shutdown System",
    "message": "This will power off your system",
    "confirmLabel": "Shutdown",
    "cancelLabel": "Cancel",
    "confirmCommand": "systemctl poweroff",
    "variant": "danger",
    "audioFile": "/home/fbb/.config/hypr/assets/warn.ogg",
    "showDelay": 180
  }
}'