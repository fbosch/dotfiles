#!/usr/bin/env bash

set -euo pipefail

# Requires grimblast, wl-copy, notify-send, and tesseract (for OCR mode).
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
    ocr)
        target="area"
        label="OCR"
        ;;
    *)
        notify-send "Screenshot failed" "Unknown mode: ${mode}"
        exit 1
        ;;
esac

if [[ "${mode}" == "ocr" ]]; then
    if ! command -v tesseract >/dev/null 2>&1; then
        notify-send "Screenshot OCR failed" "tesseract is not installed."
        exit 1
    fi

    tmpdir="$(mktemp -d)"
    tmpfile="${tmpdir}/capture.png"
    trap 'rm -rf "${tmpdir}"' EXIT

    if ! grimblast save "${target}" "${tmpfile}"; then
        if [[ ! -s "${tmpfile}" ]]; then
            # Assume the user cancelled the selection.
            exit 0
        fi
        notify-send "Screenshot OCR failed" "Could not capture selection."
        exit 1
    fi

    if ! raw_text="$(tesseract "${tmpfile}" stdout 2>/dev/null)"; then
        notify-send "Screenshot OCR failed" "tesseract could not read the image."
        exit 1
    fi

    # Cleanup temp files immediately after OCR completes.
    rm -rf "${tmpdir}"
    trap - EXIT

    text="${raw_text}"

    if command -v wl-copy >/dev/null 2>&1; then
        printf '%s' "${text}" | wl-copy -t text/plain || true
    fi

    summary="$(printf '%s' "${text}" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
    if [[ -z "${summary}" ]]; then
        summary="(no text detected)"
    elif (( ${#summary} > 120 )); then
        summary="${summary:0:117}..."
    fi

    if command -v notify-send >/dev/null 2>&1; then
        notify-send "OCR copied to clipboard" "${summary}"
    fi

    exit 0
fi

shots_dir="${HOME}/Pictures/screenshots"
mkdir -p "${shots_dir}"

timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"
file="${shots_dir}/screenshot-${mode}-${timestamp}.png"

if ! grimblast copysave "${target}" "${file}"; then
    if [[ "${target}" == "area" && ! -f "${file}" ]]; then
        # Assume user cancelled the selection.
        exit 0
    fi
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
