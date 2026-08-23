#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC1091
. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"
LOCK_FILE="$(hypr_instance_path "minimized-state-daemon.lock")"
exec 9>"$LOCK_FILE"
if command -v flock &>/dev/null; then
    if ! flock -n 9; then
        printf 'minimized-state-daemon: already running, exiting\n' >&2
        exit 0
    fi
fi

exec "${HOME}/.config/hypr/runtime/windows/daemons/minimized-state/minimized-state-daemon.lua" "$@"
