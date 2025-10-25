#!/usr/bin/env bash

set -euo pipefail

# Default to area capture when no mode is provided.
mode="${1:-area}"

case "$mode" in
    area)
        target="area"
        label="Selection"
        ;;
    screen)
        # Capture the currently focused output (monitor with the pointer).
        target="output"
        label="Active monitor"
        ;;
    *)
        notify-send "Screenshot failed" "Unknown mode: ${mode}"
        exit 1
        ;;
esac

shots_dir="${HOME}/Pictures/screenshots"
mkdir -p "${shots_dir}"

timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"
file="${shots_dir}/screenshot-${mode}-${timestamp}.png"

if ! grimblast copysave "${target}" "${file}"; then
    notify-send "Screenshot failed" "Could not capture ${label,,}."
    exit 1
fi

if command -v notify-send >/dev/null 2>&1; then
    (
        action=$(notify-send --wait --action=default=Open -i "${file}" "Screenshot saved" "${label} saved to ${file}") || true
        if [[ "${action}" == "default" ]]; then
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "${file}" >/dev/null 2>&1 &
            elif command -v gio >/dev/null 2>&1; then
                gio open "${file}" >/dev/null 2>&1 &
            fi
        fi
    ) &
fi
