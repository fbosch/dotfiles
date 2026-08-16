#!/usr/bin/env dash
# Show AGS confirmation dialog before suspending system
# Sends request directly to the AGS confirm-dialog daemon
# Audio and duplicate prevention handled by AGS component

ags request -i ags-bundled confirm-dialog '{
  "action": "show",
  "config": {
    "icon": "󰒲",
    "title": "Suspend System",
    "message": "This will suspend your system to RAM",
    "confirmLabel": "Suspend",
    "cancelLabel": "Cancel",
    "operation": { "type": "suspend" },
    "variant": "suspend",
    "playWarningSound": true,
    "showDelay": 180
  }
}'
