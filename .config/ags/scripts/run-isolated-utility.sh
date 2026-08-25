#!/usr/bin/env bash

set -euo pipefail

parent_pid="$1"
bundled_executable="$2"
source_config="$3"
stop_grace_attempts=10
stop_grace_seconds=0.1

if command -v ags-bundle-runtime >/dev/null 2>&1 && [[ -x "$bundled_executable" ]]; then
	setsid ags-bundle-runtime "$bundled_executable" &
else
	(
		cd -- "$(dirname "$source_config")"
		exec setsid ags run "$(basename "$source_config")"
	) &
fi
utility_pid=$!

stop_utility() {
	if ! kill -0 -- "-$utility_pid" >/dev/null 2>&1; then
		return
	fi
	kill -TERM -- "-$utility_pid" >/dev/null 2>&1 || true
	for ((attempt = 0; attempt < stop_grace_attempts; attempt++)); do
		if ! kill -0 -- "-$utility_pid" >/dev/null 2>&1; then
			return
		fi
		sleep "$stop_grace_seconds" || true
	done
	kill -KILL -- "-$utility_pid" >/dev/null 2>&1 || true
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
