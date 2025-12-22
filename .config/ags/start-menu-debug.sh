#!/usr/bin/env bash
# Simple wrapper for start menu command
# Works with bundled AGS mode - sends request to bundled instance
if ags list 2>/dev/null | grep -q "ags-bundled"; then
    ags request -i ags-bundled '{"action":"toggle","window":"start-menu"}'
else
    echo "AGS bundled daemon not running"
    exit 1
fi