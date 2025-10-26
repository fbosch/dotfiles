#!/usr/bin/env bash

set -euo pipefail

TOGGLE_SCRIPT="${TOGGLE_SCRIPT:-$HOME/.config/hypr/scripts/toggle-waybar.sh}"
SOCKET_PATH="${XDG_RUNTIME_DIR:-/tmp}/hypr/${HYPRLAND_INSTANCE_SIGNATURE:-}/.socket2.sock"
HOVER_Y_THRESHOLD="${HOVER_Y_THRESHOLD:-auto}"
HOVER_Y_MARGIN="${HOVER_Y_MARGIN:-10}"
HOVER_DEBUG="${HOVER_DEBUG:-0}"

log_debug() {
    if [ "${HOVER_DEBUG}" != "0" ]; then
        printf '[waybar-hover] %s\n' "$*" >&2
    fi
}

if [ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then
    echo "waybar-hover: HYPRLAND_INSTANCE_SIGNATURE is not set; exiting." >&2
    exit 1
fi

if [ ! -S "${SOCKET_PATH}" ]; then
    echo "waybar-hover: Event socket ${SOCKET_PATH} not found; exiting." >&2
    exit 1
fi

if [ ! -x "${TOGGLE_SCRIPT}" ]; then
    echo "waybar-hover: Toggle script ${TOGGLE_SCRIPT} is not executable; exiting." >&2
    exit 1
fi

for tool in socat awk grep; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
        echo "waybar-hover: Required tool '${tool}' is missing." >&2
        exit 1
    fi
done

if [ "${HOVER_Y_THRESHOLD}" = "auto" ]; then
    if command -v hyprctl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
        if bottom=$(hyprctl -j monitors 2>/dev/null | jq -r '[ .[] | (.y + .height) ] | max' 2>/dev/null); then
            if [ -n "${bottom}" ] && [ "${bottom}" != "null" ]; then
                HOVER_Y_THRESHOLD=$(( bottom - HOVER_Y_MARGIN ))
                log_debug "Auto-detected hover threshold: ${HOVER_Y_THRESHOLD}"
            fi
        fi
    fi
fi

if [ "${HOVER_Y_THRESHOLD}" = "auto" ]; then
    echo "waybar-hover: Unable to determine hover threshold automatically; set HOVER_Y_THRESHOLD manually." >&2
    exit 1
fi

hover_active=0

socat -u - UNIX-CONNECT:"${SOCKET_PATH}" \
    | grep --line-buffered -E '^(mouseMove|cursorMoved)' \
    | while IFS= read -r line; do
        payload="${line#*>>}"
        IFS=',' read -r _ y_raw _ <<<"${payload}"

        if [ -z "${y_raw:-}" ]; then
            log_debug "Skipping event without Y coordinate: ${line}"
            continue
        fi

        y_value="${y_raw%.*}"
        log_debug "Cursor Y=${y_value} threshold=${HOVER_Y_THRESHOLD} active=${hover_active}"

        if (( y_value >= HOVER_Y_THRESHOLD )); then
            if (( hover_active == 0 )); then
                bash "${TOGGLE_SCRIPT}"
                log_debug "Triggered toggle script"
                hover_active=1
            fi
        else
            hover_active=0
        fi
    done
