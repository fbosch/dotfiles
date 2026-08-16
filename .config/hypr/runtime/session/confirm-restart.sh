#!/usr/bin/env dash
# Show AGS confirmation dialog before restarting system
# Sends request directly to the AGS confirm-dialog daemon
# Audio and duplicate prevention handled by AGS component

ags request -i ags-bundled confirm-dialog '{
  "action": "show",
  "config": {
    "icon": "󰜉",
    "title": "Restart System",
    "message": "This will reboot your system",
    "confirmLabel": "Restart",
    "cancelLabel": "Cancel",
    "operation": { "type": "restart" },
    "variant": "warning",
    "playWarningSound": true,
    "showDelay": 180
  }
}'
