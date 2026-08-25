#!/usr/bin/env bash

set -euo pipefail

generation="$1"
working_directory="$2"
shift 2
stop_grace_attempts=10
stop_grace_seconds=0.1
host_pid=""

# shellcheck source=.config/ags/scripts/runtime-artifacts.sh
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/runtime-artifacts.sh"
require_private_runtime_directory
cd -- "$working_directory"

stop_host() {
	if [[ -z "$host_pid" ]]; then
		return
	fi
	if ! kill -0 -- "-$host_pid" >/dev/null 2>&1; then
		return
	fi
	kill -TERM -- "-$host_pid" >/dev/null 2>&1 || true
	for ((attempt = 0; attempt < stop_grace_attempts; attempt++)); do
		if ! kill -0 -- "-$host_pid" >/dev/null 2>&1; then
			return
		fi
		sleep "$stop_grace_seconds" || true
	done
	kill -KILL -- "-$host_pid" >/dev/null 2>&1 || true
}

trap 'cleanup_runtime_artifact_generation "$generation"' EXIT
trap stop_host INT TERM
setsid "$@" &
host_pid=$!
status=0
wait "$host_pid" || status=$?
stop_host
exit "$status"
