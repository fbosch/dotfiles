#!/usr/bin/env bash

set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-minimized-state-daemon.lock"
exec 9>"$LOCK_FILE"
if command -v flock &>/dev/null; then
    if ! flock -n 9; then
        printf 'Minimized state daemon already running, exiting\n' >&2
        exit 0
    fi
fi

exec "${HOME}/.config/hypr/runtime/windows/daemons/minimized-state/minimized-state-daemon.lua" "$@"
