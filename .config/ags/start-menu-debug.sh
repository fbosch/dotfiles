#!/usr/bin/env bash
# Simple wrapper for start menu command
# Check if daemon is running
if pgrep -f "start-menu.tsx" > /dev/null; then
    ags request -i start-menu-daemon '{"action":"toggle"}'
else
    echo "Start menu daemon not running"
    exit 1
fi