#!/usr/bin/env bash

ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "󰹑" 64 "#ffffff")
ERROR_ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "" 64 "#ef4444")

set -euo pipefail

# Requires grimblast, wl-copy, notify-send, and tesseract (for OCR mode).
# Optional: ImageMagick (magick/convert) for improved OCR preprocessing.
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
        notify-send \
            --app-name="Screenshot" \
            --hint=string:desktop-entry:org.gnome.Loupe \
            --icon="${ERROR_ICON}" \
            --urgency=critical \
            "Screenshot failed" \
            "Unknown mode: ${mode}"
        exit 1
        ;;
esac


if [[ "${mode}" == "ocr" ]]; then
    if ! command -v tesseract >/dev/null 2>&1; then
        notify-send \
            --app-name="OCR" \
            --icon="${ERROR_ICON}" \
            --urgency=critical \
            "Text extraction failed" \
            "tesseract is not installed."
        exit 1
    fi

    tmpdir="$(mktemp -d)"
    tmpfile="${tmpdir}/capture.png"
    trap 'rm -rf "${tmpdir}"' EXIT

    if ! grimblast save "${target}" "${tmpfile}"; then
        if [[ ! -s "${tmpfile}" ]]; then
            exit 0
        fi
        notify-send \
            --app-name="OCR" \
            --icon="${ERROR_ICON}" \
            --urgency=critical \
            "Text extraction failed" \
            "Could not capture selection."
        exit 1
    fi

    max_ocr_pixels=6000000
    image_pixels=""
    if command -v magick >/dev/null 2>&1; then
        if dimensions="$(magick identify -format '%w %h' "${tmpfile}" 2>/dev/null)"; then
            read -r image_width image_height <<< "${dimensions}"
            if [[ "${image_width}" =~ ^[0-9]+$ && "${image_height}" =~ ^[0-9]+$ ]]; then
                image_pixels=$((image_width * image_height))
            fi
        fi
    elif command -v identify >/dev/null 2>&1; then
        if dimensions="$(identify -format '%w %h' "${tmpfile}" 2>/dev/null)"; then
            read -r image_width image_height <<< "${dimensions}"
            if [[ "${image_width}" =~ ^[0-9]+$ && "${image_height}" =~ ^[0-9]+$ ]]; then
                image_pixels=$((image_width * image_height))
            fi
        fi
    fi

    if [[ -n "${image_pixels}" && "${image_pixels}" -gt "${max_ocr_pixels}" ]]; then
        notify-send \
            --app-name="OCR" \
            --icon="${ERROR_ICON}" \
            --urgency=critical \
            "Text extraction skipped" \
            "Selection is too large for OCR. Select a smaller area."
        exit 1
    fi

    notification_id="$(notify-send --app-name="OCR" --print-id "Reading text..." "Extracting text from screenshot...")"

    # Keep preprocessing bounded; large OCR selections can otherwise spike memory.
    preprocessed="${tmpdir}/preprocessed.png"
    max_preprocess_pixels=2000000
    resize_args=()
    if [[ -n "${image_pixels}" && "${image_pixels}" -le 1000000 ]]; then
        resize_args=(-resize 150%)
    fi

    if [[ -n "${image_pixels}" && "${image_pixels}" -gt "${max_preprocess_pixels}" ]]; then
        preprocessed="${tmpfile}"
    elif command -v magick >/dev/null 2>&1; then
        # ImageMagick v7 preprocessing:
        # - Upscale small captures 1.5x (helps with small text)
        # - Convert to grayscale
        # - Increase contrast and brightness
        # - Sharpen text edges
        MAGICK_MEMORY_LIMIT=256MiB MAGICK_MAP_LIMIT=512MiB timeout 8s magick "${tmpfile}" \
            "${resize_args[@]}" \
            -colorspace Gray \
            -brightness-contrast 10x30 \
            -sharpen 0x1 \
            "${preprocessed}" 2>/dev/null || cp "${tmpfile}" "${preprocessed}"
    elif command -v convert >/dev/null 2>&1; then
        # ImageMagick v6 preprocessing
        MAGICK_MEMORY_LIMIT=256MiB MAGICK_MAP_LIMIT=512MiB timeout 8s convert "${tmpfile}" \
            "${resize_args[@]}" \
            -colorspace Gray \
            -brightness-contrast 10x30 \
            -sharpen 0x1 \
            "${preprocessed}" 2>/dev/null || cp "${tmpfile}" "${preprocessed}"
    else
        # Fallback: use original image if ImageMagick not available
        preprocessed="${tmpfile}"
    fi

    # PSM 3 = Auto page segmentation (works better with mixed layouts)
    # Add --dpi 300 to hint at higher resolution
    # Add -l eng for explicit English (change to your language if needed)
    if ! raw_text="$(timeout 20s tesseract "${preprocessed}" stdout --psm 3 --oem 1 --dpi 300 -l eng 2>/dev/null)"; then
        notify-send \
            --app-name="OCR" \
            --replace-id="${notification_id}" \
            --icon="${ERROR_ICON}" \
            --urgency=critical \
            "Text extraction failed" \
            "Could not read text from image."
        exit 1
    fi

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
        notify-send --app-name="OCR" --replace-id="${notification_id}" "Text copied to clipboard" "${summary}"
    fi

    exit 0
fi

shots_dir="${HOME}/Pictures/screenshots"
mkdir -p "${shots_dir}"

timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"
file="${shots_dir}/screenshot-${mode}-${timestamp}.png"

if ! grimblast save "${target}" "${file}"; then
    if [[ "${target}" == "area" && ! -f "${file}" ]]; then
        # Assume user cancelled the selection.
        exit 0
    fi
    notify-send \
        --app-name="Screenshot" \
        --hint=string:desktop-entry:org.gnome.Loupe \
        --icon="${ERROR_ICON}" \
        --urgency=critical \
        "Screenshot failed" \
        "Could not capture ${label,,}."
    exit 1
fi

if command -v wl-copy >/dev/null 2>&1; then
    wl-copy < "${file}" || true
fi

if command -v notify-send >/dev/null 2>&1; then
    (
        # Get file size for display
        file_size=$(du -h "${file}" | cut -f1)
        
        # Use HTML img tag in body to show larger preview
        # Default action (clicking notification) opens the screenshot
        # Using Nerd Font icons:  = image,  = folder,  = trash
        action=$(notify-send \
            --wait \
            --app-name="Screenshot" \
            --hint=boolean:SWAYNC_BYPASS_DND:true \
            --hint=string:desktop-entry:org.gnome.Loupe \
            --icon="${ICON}" \
            --action="default=Open Screenshot" \
            --action="open=   View" \
            --action="folder=   Open" \
            --action="delete=   Delete" \
            "Screenshot Captured" \
            "<img src=\"${file}\"/>${label} screenshot saved (${file_size})") || true
        
        case "${action}" in
            default|open)
                if command -v xdg-open >/dev/null 2>&1; then
                    xdg-open "${file}" >/dev/null 2>&1 &
                elif command -v gio >/dev/null 2>&1; then
                    gio open "${file}" >/dev/null 2>&1 &
                fi
                ;;
            folder)
                if command -v xdg-open >/dev/null 2>&1; then
                    xdg-open "${shots_dir}" >/dev/null 2>&1 &
                elif command -v gio >/dev/null 2>&1; then
                    gio open "${shots_dir}" >/dev/null 2>&1 &
                fi
                ;;
            delete)
                rm -f "${file}"
                # notify-send --app-name="Screenshot" --transient "Screenshot Deleted" "Screenshot has been removed"
                ;;
        esac
    ) >/dev/null 2>&1 < /dev/null &
fi
