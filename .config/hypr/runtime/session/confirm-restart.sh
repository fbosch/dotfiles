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
    "confirmCommand": "/home/fbb/.config/hypr/runtime/session/hyprshutdown-session.sh -t \"Restarting...\" --post-cmd \"systemctl reboot\"",
    "variant": "warning",
    "audioFile": "/home/fbb/.config/hypr/assets/warn.ogg",
    "showDelay": 180
  }
}'
