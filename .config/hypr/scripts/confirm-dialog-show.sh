#!/usr/bin/env bash
# Client script to show confirm dialog via daemon
# Usage: confirm-dialog-show.sh --icon "⚠" --title "Exit" ...

CONFIG_FILE="$XDG_RUNTIME_DIR/ags-confirm-config.json"

# Build JSON config from arguments
icon="⚠"
title="Are you sure"
message="High-impact operation, please confirm"
confirmLabel="Confirm"
cancelLabel="Cancel"
confirmCommand=""
variant="danger"

while [[ $# -gt 0 ]]; do
  case $1 in
    --icon) icon="$2"; shift 2 ;;
    --title) title="$2"; shift 2 ;;
    --message) message="$2"; shift 2 ;;
    --confirm-label) confirmLabel="$2"; shift 2 ;;
    --cancel-label) cancelLabel="$2"; shift 2 ;;
    --confirm-command) confirmCommand="$2"; shift 2 ;;
    --variant) variant="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Write config to file (will trigger file monitor in daemon)
cat > "$CONFIG_FILE" <<EOF
{
  "action": "show",
  "config": {
    "icon": "$icon",
    "title": "$title",
    "message": "$message",
    "confirmLabel": "$confirmLabel",
    "cancelLabel": "$cancelLabel",
    "confirmCommand": "$confirmCommand",
    "variant": "$variant"
  }
}
EOF
