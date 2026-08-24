#!/usr/bin/env bash

set -euo pipefail

instance="$1"
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
	ags quit -i "$instance" >/dev/null 2>&1 || true
	if kill -0 "$utility_pid" >/dev/null 2>&1; then
		kill -TERM -- "-$utility_pid" >/dev/null 2>&1 || true
	fi
}

trap stop_utility INT TERM
wait "$utility_pid"
