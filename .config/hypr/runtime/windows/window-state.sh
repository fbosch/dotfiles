#!/usr/bin/env bash

set -euo pipefail

# Re-exec with SCHED_IDLE scheduling if not already running with it.
if [[ -z "${WINDOW_STATE_IDLE_SCHED:-}" ]]; then
    if command -v chrt &>/dev/null; then
        export WINDOW_STATE_IDLE_SCHED=1
        exec chrt -i 0 "$0" "$@"
    fi
fi

LOCK_FILE="${XDG_RUNTIME_DIR}/hypr-window-state.lock"
exec 9>"$LOCK_FILE"
if command -v flock &>/dev/null; then
    if ! flock -n 9; then
        printf 'Window state persistence already running, exiting\n' >&2
        exit 0
    fi
fi

exec "${HOME}/.config/hypr/runtime/windows/window-state-daemon.lua" "$@"
