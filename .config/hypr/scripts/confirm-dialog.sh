#!/usr/bin/env bash
# Generic AGS confirmation dialog
# Usage: confirm-dialog.sh --icon "🔄" --title "Restart" --message "Restart system?" --confirm-command "systemctl reboot" --variant "warning"

# Check if AGS confirm dialog is already running
if ags list | grep -q "confirm-exit"; then
    # Dialog already open, do nothing
    exit 0
fi

# Launch AGS confirmation dialog with passed parameters
ags run ~/.config/ags/confirm-exit.tsx -- "$@"
