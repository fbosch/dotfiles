#!/usr/bin/env bash

set -euo pipefail

direction="${1:-next}"

# Grab the address of the currently focused window (may be null on empty workspace).
current_address="$(hyprctl activewindow -j | jq -r '.address // empty')"

# Sort windows with the same tuple Waybar uses when `sort-by-app-id=true`:
# app (class) first, then title, then address for stability.
mapfile -t windows < <(hyprctl clients -j | jq -r '
    map(select(.workspace.id != -1)) |
    sort_by([.class, (.title // ""), .address]) |
    .[].address
')

window_count=${#windows[@]}

(( window_count == 0 )) && exit 0
(( window_count == 1 )) && exit 0

current_index=-1
for i in "${!windows[@]}"; do
    if [[ "${windows[$i]}" == "${current_address}" ]]; then
        current_index=$i
        break
    fi
done

case "${direction}" in
    prev) step=-1 ;;
    next) step=1 ;;
    *)
        # Default to cycling backward if an unknown direction is passed.
        step=-1
        ;;
esac

if (( current_index == -1 )); then
    # Fallback: if the active window wasn't found in the list, start from either
    # the first or last entry depending on cycling direction.
    if (( step > 0 )); then
        next_index=0
    else
        next_index=$(( window_count - 1 ))
    fi
else
    next_index=$(( (current_index + step + window_count) % window_count ))
fi

hyprctl dispatch focuswindow "address:${windows[$next_index]}"
