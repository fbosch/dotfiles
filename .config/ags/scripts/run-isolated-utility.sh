#!/usr/bin/env bash

set -euo pipefail

parent_pid="$1"
bundled_executable="$2"
source_config="$3"

if command -v ags-bundle-runtime >/dev/null 2>&1 && [[ -x "$bundled_executable" ]]; then
	command=(ags-bundle-runtime "$bundled_executable")
else
	command=(ags run "$source_config")
fi

setsid "${command[@]}" &
utility_pid=$!

stop_utility() {
	if kill -0 "$utility_pid" >/dev/null 2>&1; then
		kill -TERM -- "-$utility_pid" >/dev/null 2>&1 || true
	fi
}

trap stop_utility INT TERM

# shortcut: poll the Linux parent PID until AGS exposes an instance-owner signal.
watch_parent() {
	while kill -0 "$parent_pid" >/dev/null 2>&1; do
		sleep 0.2
	done
	stop_utility
}

watch_parent &
watcher_pid=$!
status=0
wait "$utility_pid" || status=$?
kill "$watcher_pid" >/dev/null 2>&1 || true
wait "$watcher_pid" 2>/dev/null || true
exit "$status"
