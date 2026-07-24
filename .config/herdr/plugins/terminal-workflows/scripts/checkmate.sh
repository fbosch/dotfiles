#!/usr/bin/env bash
set -euo pipefail

if ! todo_file="$("$HERDR_PLUGIN_ROOT/scripts/project.sh" todo "$PWD")"; then
	printf 'No todo file found in the project root.\n'
	read -r -p 'Press Enter to close.'
	exit 0
fi

exec nvim "$todo_file"
